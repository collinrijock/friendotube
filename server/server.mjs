// FriendoTube API: friend groups share what YouTube puts in their feeds, and recommend videos to each other.
// Zero dependencies: node:http + node:sqlite (Node 22).
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.FRIENDOTUBE_DB ?? new URL("../data/friendotube.db", import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 4330);
const DAY = 86_400_000;
const FEED_WINDOW = 3 * DAY; // friends' feed items newer than this are shown
const KEEP = 14 * DAY; // sightings and recs older than this are pruned

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS members (group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (group_id, user_id));
  CREATE TABLE IF NOT EXISTS sightings (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, video_id TEXT NOT NULL, title TEXT NOT NULL, channel TEXT NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY (user_id, video_id));
  CREATE INDEX IF NOT EXISTS sightings_seen ON sightings(seen_at);
  CREATE TABLE IF NOT EXISTS recs (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, video_id TEXT NOT NULL, title TEXT NOT NULL, channel TEXT NOT NULL, note TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS recs_group ON recs(group_id, created_at);
`);

// Tokens are stored as SHA-256: a leaked DB has no usable keys, and lookups by hash leak nothing about the token.
const hashToken = (t) => createHash("sha256").update(t).digest("hex");
for (const u of db.prepare("SELECT id, token FROM users WHERE length(token) != 64").all()) {
  db.prepare("UPDATE users SET token = ? WHERE id = ?").run(hashToken(u.token), u.id);
}

// Per-IP fixed-window rate limits. shortcut: in-memory, resets on restart and is per process; fine for one mini.
const LIMITS = { signup: [5, 3_600_000], join: [20, 3_600_000], write: [120, 60_000], read: [300, 60_000] };
const hits = new Map();
function limit(bucket, ip) {
  const [max, windowMs] = LIMITS[bucket];
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  let h = hits.get(key);
  if (!h || h.reset <= now) hits.set(key, (h = { n: 0, reset: now + windowMs }));
  h.n++;
  if (h.n > max) throw Object.assign(new HttpError(429, "too many requests, slow down"), { retryAfter: Math.ceil((h.reset - now) / 1000) });
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.reset <= now) hits.delete(k); }, 60_000).unref();

const prune = () => {
  const cutoff = Date.now() - KEEP;
  db.prepare("DELETE FROM sightings WHERE seen_at < ?").run(cutoff);
  db.prepare("DELETE FROM recs WHERE created_at < ?").run(cutoff);
};
prune();
setInterval(prune, 3_600_000).unref();

const page = (name) => readFileSync(new URL(`pages/${name}.html`, import.meta.url), "utf8");
const PAGES = { "/": page("index"), "/privacy": page("privacy") };

const EXTENSION_ORIGIN = /^(chrome|moz|safari-web|webkit)-extension:\/\/[a-z0-9-]+$/i;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const code = () => randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 8).toUpperCase();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const need = (cond, status, message) => { if (!cond) throw new HttpError(status, message); };

function cleanVideo(v) {
  need(v && VIDEO_ID.test(v.id ?? v.videoId), 400, "bad video id");
  return { id: v.id ?? v.videoId, title: text(v.title, 200) || "(untitled)", channel: text(v.channel, 100) };
}

function myGroups(userId) {
  const groups = db.prepare("SELECT g.id, g.name, g.code FROM groups g JOIN members m ON m.group_id = g.id WHERE m.user_id = ? ORDER BY g.id").all(userId);
  const names = db.prepare("SELECT u.name FROM users u JOIN members m ON m.user_id = u.id WHERE m.group_id = ? ORDER BY u.name");
  return groups.map((g) => ({ ...g, members: names.all(g.id).map((r) => r.name) }));
}

function join(userId, groupId) {
  db.prepare("INSERT OR IGNORE INTO members (group_id, user_id) VALUES (?, ?)").run(groupId, userId);
}

const dropEmptyGroups = () => db.exec("DELETE FROM groups WHERE id NOT IN (SELECT group_id FROM members)");

// Users who share at least one group with me.
const FRIENDS = `SELECT DISTINCT m2.user_id FROM members m1 JOIN members m2 ON m2.group_id = m1.group_id WHERE m1.user_id = :me AND m2.user_id != :me`;

const routes = {
  "POST /api/signup": (_, body) => {
    const name = text(body.name, 40);
    need(name, 400, "name required");
    const token = randomBytes(32).toString("base64url");
    const { lastInsertRowid } = db.prepare("INSERT INTO users (name, token, created_at) VALUES (?, ?, ?)").run(name, hashToken(token), Date.now());
    return { token, user: { id: Number(lastInsertRowid), name } };
  },

  "GET /api/me": (me) => ({ user: { id: me.id, name: me.name }, groups: myGroups(me.id) }),

  "POST /api/groups": (me, body) => {
    const name = text(body.name, 60);
    need(name, 400, "name required");
    const { lastInsertRowid } = db.prepare("INSERT INTO groups (name, code, created_at) VALUES (?, ?, ?)").run(name, code(), Date.now());
    join(me.id, Number(lastInsertRowid));
    return { groups: myGroups(me.id) };
  },

  "POST /api/groups/join": (me, body) => {
    const group = db.prepare("SELECT id FROM groups WHERE code = ?").get(text(body.code, 20).toUpperCase());
    need(group, 404, "no group with that code");
    join(me.id, group.id);
    return { groups: myGroups(me.id) };
  },

  "POST /api/groups/leave": (me, body) => {
    db.prepare("DELETE FROM members WHERE group_id = ? AND user_id = ?").run(Number(body.groupId), me.id);
    dropEmptyGroups();
    return { groups: myGroups(me.id) };
  },

  // The extension reports what YouTube recommended to this user.
  "POST /api/sightings": (me, body) => {
    need(Array.isArray(body.videos) && body.videos.length <= 200, 400, "videos must be an array of at most 200");
    const upsert = db.prepare(`INSERT INTO sightings (user_id, video_id, title, channel, seen_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, video_id) DO UPDATE SET title = excluded.title, channel = excluded.channel, seen_at = excluded.seen_at`);
    const now = Date.now();
    let saved = 0;
    for (const raw of body.videos) {
      if (!VIDEO_ID.test(raw?.id ?? "")) continue;
      const v = cleanVideo(raw);
      upsert.run(me.id, v.id, v.title, v.channel, now);
      saved++;
    }
    return { saved };
  },

  "POST /api/recs": (me, body) => {
    const v = cleanVideo(body);
    const note = text(body.note, 280);
    const groups = myGroups(me.id).map((g) => g.id).filter((id) => body.groupId == null || id === Number(body.groupId));
    need(groups.length, 400, "join a group first");
    const insert = db.prepare("INSERT INTO recs (user_id, group_id, video_id, title, channel, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const g of groups) insert.run(me.id, g, v.id, v.title, v.channel, note, Date.now());
    return { sent: groups.length };
  },

  // What the extension shows on your YouTube home: friends' picks, then videos from friends' feeds you didn't get.
  "GET /api/friends-feed": (me) => {
    const recs = db.prepare(`
      SELECT r.video_id AS id, MAX(r.title) AS title, MAX(r.channel) AS channel, u.name AS "from", MAX(r.note) AS note, MAX(r.created_at) AS at
      FROM recs r JOIN users u ON u.id = r.user_id
      WHERE r.user_id != :me AND r.group_id IN (SELECT group_id FROM members WHERE user_id = :me)
      GROUP BY r.video_id, r.user_id ORDER BY at DESC LIMIT 30`).all({ me: me.id });
    const feed = db.prepare(`
      SELECT s.video_id AS id, MAX(s.title) AS title, MAX(s.channel) AS channel, GROUP_CONCAT(DISTINCT u.name) AS friends,
             COUNT(DISTINCT s.user_id) AS n, MAX(s.seen_at) AS at
      FROM sightings s JOIN users u ON u.id = s.user_id
      WHERE s.user_id IN (${FRIENDS}) AND s.seen_at > :since
        AND s.video_id NOT IN (SELECT video_id FROM sightings WHERE user_id = :me)
      GROUP BY s.video_id ORDER BY n DESC, at DESC LIMIT 60`).all({ me: me.id, since: Date.now() - FEED_WINDOW });
    return { recs, feed: feed.map(({ friends, ...v }) => ({ ...v, friends: friends.split(",") })) };
  },

  "POST /api/forget-me": (me) => {
    db.prepare("DELETE FROM users WHERE id = ?").run(me.id);
    dropEmptyGroups();
    return { ok: true };
  },
};

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    need(size <= 256_000, 413, "body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) ?? {}; } catch { throw new HttpError(400, "bad json"); }
}

export const server = http.createServer(async (req, res) => {
  // CORS only for extension pages (a self-hosted server isn't in host_permissions); websites get no access.
  const origin = req.headers.origin ?? "";
  const cors = EXTENSION_ORIGIN.test(origin)
    ? { "access-control-allow-origin": origin, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST" }
    : {};
  const send = (status, data, extra = {}) => {
    res.writeHead(status, { "content-type": "application/json", "x-content-type-options": "nosniff", vary: "Origin", ...cors, ...extra });
    res.end(status === 204 ? undefined : JSON.stringify(data));
  };
  try {
    const path = new URL(req.url, "http://x").pathname;
    // The app was called FriendTube; 308 keeps POSTs POSTs.
    if (/^friendtube\./.test(req.headers.host ?? "")) {
      res.writeHead(308, { location: `https://friendotube.collinrijock.com${req.url}` });
      return res.end();
    }
    if (req.method === "OPTIONS") return send(204, {});
    if (req.method === "GET" && PAGES[path]) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:", "referrer-policy": "no-referrer" });
      return res.end(PAGES[path]);
    }
    const route = routes[`${req.method} ${path}`];
    need(route, 404, "not found");
    // Only cloudflared reaches 127.0.0.1, and Cloudflare overwrites CF-Connecting-IP, so it can't be spoofed.
    const ip = req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress;
    limit(req.method === "POST" ? "write" : "read", ip);
    if (path === "/api/signup") limit("signup", ip);
    if (path === "/api/groups/join") limit("join", ip);
    let me = null;
    if (path !== "/api/signup") {
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      me = token && db.prepare("SELECT id, name FROM users WHERE token = ?").get(hashToken(token));
      need(me, 401, "sign in first");
    }
    const body = req.method === "POST" ? await readJson(req) : {};
    send(200, route(me, body));
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    send(err.status ?? 500, { error: err.status ? err.message : "server error" }, err.retryAfter ? { "retry-after": String(err.retryAfter) } : {});
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, "127.0.0.1", () => console.log(`friendotube on :${PORT}, db ${DB_PATH}`));
}
