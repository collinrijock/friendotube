// node --test server/server.test.mjs  — end-to-end check of the API against a throwaway DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

process.env.FRIENDOTUBE_DB = `${tmpdir()}/friendotube-test-${process.pid}.db`;
const { server } = await import("./server.mjs");
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

async function call(token, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, ...(await res.json()) };
}

test("friends see each other's feeds and recs, strangers don't", async () => {
  const a = (await call(null, "POST", "/api/signup", { name: "Collin" })).token;
  const b = (await call(null, "POST", "/api/signup", { name: "Rafa" })).token;
  const c = (await call(null, "POST", "/api/signup", { name: "Stranger" })).token;
  assert.equal((await call(null, "GET", "/api/me")).status, 401);

  const { groups } = await call(a, "POST", "/api/groups", { name: "The boys" });
  assert.equal((await call(b, "POST", "/api/groups/join", { code: groups[0].code.toLowerCase() })).groups[0].members.length, 2);
  assert.equal((await call(c, "POST", "/api/groups/join", { code: "NOPE" })).status, 404);

  await call(b, "POST", "/api/sightings", { videos: [
    { id: "dQw4w9WgXcQ", title: "Never Gonna", channel: "Rick" },
    { id: "aaaaaaaaaaa", title: "Both saw this", channel: "X" },
    { id: "<script>bad", title: "rejected" },
  ] });
  await call(c, "POST", "/api/sightings", { videos: [{ id: "ccccccccccc", title: "Stranger's", channel: "Z" }] });
  await call(a, "POST", "/api/sightings", { videos: [{ id: "aaaaaaaaaaa", title: "Both saw this", channel: "X" }] });

  const feed = await call(a, "GET", "/api/friends-feed");
  assert.deepEqual(feed.feed.map((v) => v.id), ["dQw4w9WgXcQ"]); // not mine, not the stranger's
  assert.deepEqual(feed.feed[0].friends, ["Rafa"]);

  assert.equal((await call(c, "POST", "/api/recs", { videoId: "dQw4w9WgXcQ", title: "t" })).status, 400); // no group
  assert.equal((await call(b, "POST", "/api/recs", { videoId: "dQw4w9WgXcQ", title: "Never Gonna", note: "classic" })).sent, 1);
  const recs = (await call(a, "GET", "/api/friends-feed")).recs;
  assert.equal(recs[0].from, "Rafa");
  assert.equal(recs[0].note, "classic");
  assert.equal((await call(b, "GET", "/api/friends-feed")).recs.length, 0); // own recs aren't echoed back

  await call(b, "POST", "/api/forget-me");
  assert.equal((await call(a, "GET", "/api/friends-feed")).feed.length, 0);
  server.close();
});

test("pages and the old-domain redirect", async () => {
  if (!server.listening) await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  assert.match(await (await fetch(`http://127.0.0.1:${port}/privacy`)).text(), /Limited Use/);
  const { request } = await import("node:http");
  const res = await new Promise((r) => request({ port, path: "/api/me?x=1", method: "POST", headers: { host: "friendtube.collinrijock.com" } }, r).end());
  assert.equal(res.statusCode, 308);
  assert.equal(res.headers.location, "https://friendotube.collinrijock.com/api/me?x=1");
  server.close();
});

test("security: rate limits, hashed tokens, extension-only CORS, no HTML sinks in the extension", async () => {
  if (!server.listening) await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const signup = (ip) => fetch(`${url}/api/signup`, { method: "POST", headers: { "cf-connecting-ip": ip }, body: JSON.stringify({ name: "x" }) });

  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await signup("203.0.113.9")).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  assert.equal((await signup("203.0.113.10")).status, 200); // another IP isn't affected
  const limited = await signup("203.0.113.9");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);

  const { token } = await (await signup("203.0.113.11")).json();
  const { DatabaseSync } = await import("node:sqlite");
  const stored = new DatabaseSync(process.env.FRIENDOTUBE_DB).prepare("SELECT token FROM users ORDER BY id DESC LIMIT 1").get().token;
  assert.match(stored, /^[0-9a-f]{64}$/);
  assert.notEqual(stored, token);
  assert.equal((await fetch(`${url}/api/me`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
  assert.equal((await fetch(`${url}/api/me`, { headers: { authorization: `Bearer ${stored}` } })).status, 401); // the hash isn't a key

  const ext = await fetch(`${url}/api/me`, { headers: { origin: "chrome-extension://abcdefghijklmnop" } });
  assert.equal(ext.headers.get("access-control-allow-origin"), "chrome-extension://abcdefghijklmnop");
  const site = await fetch(`${url}/api/me`, { headers: { origin: "https://evil.example" } });
  assert.equal(site.headers.get("access-control-allow-origin"), null);

  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("../extension/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => /\.(js|html)$/.test(f))) {
    assert.doesNotMatch(readFileSync(new URL(f, dir), "utf8"), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/, f);
  }
  server.close();
});
