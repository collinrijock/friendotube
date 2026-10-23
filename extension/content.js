// FriendoTube on youtube.com: report what YouTube recommends you, show what it recommends your friends.
const api = (method, path, body) => chrome.runtime.sendMessage({ type: "api", method, path, body });
const VIDEO_ID = /[?&]v=([A-Za-z0-9_-]{11})/;
const ITEMS = "ytd-rich-item-renderer, ytd-compact-video-renderer, yt-lockup-view-model";

let settings = {};
chrome.storage.local.get(["token", "shareFeed"]).then((s) => (settings = s));
chrome.storage.onChanged.addListener(() => chrome.storage.local.get(["token", "shareFeed"]).then((s) => { settings = s; feedAt = 0; }));
const signedIn = () => !!settings.token;

const firstText = (root, selectors) => {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    const t = (el?.textContent || el?.getAttribute?.("title") || "").trim();
    if (t) return t;
  }
  return "";
};

// --- 1. Collect your feed (home grid + watch-page sidebar) --------------------------------
const sent = new Set();
const pending = new Map();

function scan() {
  if (location.pathname !== "/" && location.pathname !== "/watch") return;
  for (const item of document.querySelectorAll(ITEMS)) {
    if (item.closest(".ft-shelf, ytd-ad-slot-renderer")) continue;
    const id = item.querySelector('a[href*="/watch?v="]')?.href.match(VIDEO_ID)?.[1];
    if (!id || sent.has(id) || pending.has(id)) continue;
    const title = firstText(item, ["#video-title", "h3 a", "h3"]);
    if (!title) continue; // not rendered yet; next scan picks it up
    const channel = firstText(item, ["ytd-channel-name #text", "ytd-channel-name a", 'a[href^="/@"]', "yt-content-metadata-view-model .ytContentMetadataViewModelMetadataText", ".yt-content-metadata-view-model__metadata-text"]);
    pending.set(id, { id, title, channel });
  }
}

async function flush() {
  if (!pending.size || !signedIn() || settings.shareFeed === false) return;
  const videos = [...pending.values()].slice(0, 200);
  const r = await api("POST", "/api/sightings", { videos });
  if (r?.error) return; // keep them pending and retry
  for (const v of videos) { pending.delete(v.id); sent.add(v.id); }
}

// --- 2. "From your friends" shelf on the home page ------------------------------------------
let feed = null, feedAt = 0, loading = false;

async function loadFeed() {
  if (Date.now() - feedAt < 60_000) return feed;
  feedAt = Date.now();
  const r = await api("GET", "/api/friends-feed");
  feed = r?.error ? null : r;
  return feed;
}

const names = (list) => list.length <= 2 ? list.join(" & ") : `${list.slice(0, 2).join(", ")} +${list.length - 2}`;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text; // friend data is never parsed as HTML
  return e;
}

function card(v) {
  const a = el("a", "ft-card");
  a.href = `/watch?v=${v.id}`;
  const img = el("img", "ft-thumb");
  img.src = `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
  img.loading = "lazy";
  img.alt = "";
  const share = el("button", "ft-share", "Recommend");
  share.title = "Recommend this to your friend groups";
  share.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); recommend(v); });
  a.append(img, el("div", "ft-title", v.title), el("div", "ft-meta", v.channel), el("div", v.rec ? "ft-label ft-rec" : "ft-label", v.label));
  if (v.note) a.append(el("div", "ft-note", `“${v.note}”`));
  a.append(share);
  return a;
}

async function renderShelf() {
  if (location.pathname !== "/" || !signedIn() || loading) return;
  const grid = document.querySelector('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer');
  if (!grid || grid.querySelector(":scope > .ft-shelf")) return;
  loading = true;
  const data = await loadFeed().finally(() => (loading = false));
  if (!data || grid.querySelector(":scope > .ft-shelf")) return;

  const seen = new Set();
  const items = [
    ...data.recs.map((r) => ({ ...r, rec: true, label: `${r.from} recommends` })),
    ...data.feed.map((v) => ({ ...v, label: `In ${names(v.friends)}'s feed` })),
  ].filter((v) => /^[A-Za-z0-9_-]{11}$/.test(v.id) && !seen.has(v.id) && seen.add(v.id)).slice(0, 30); // ids go into URLs: never trust the server
  if (!items.length) return;

  const shelf = el("section", "ft-shelf");
  const head = el("div", "ft-head");
  head.append(el("span", "ft-h", "From your friends"), el("span", "ft-sub", "what YouTube is showing them, and what they sent you"));
  const row = el("div", "ft-row");
  row.append(...items.map(card));
  shelf.append(head, row);
  const contents = grid.querySelector(":scope > #contents");
  contents ? grid.insertBefore(shelf, contents) : grid.prepend(shelf);
}

// --- 3. Recommend: from the shelf, or the video you're watching ----------------------------
async function recommend(v) {
  const note = prompt(`Recommend “${v.title}” to your friends.\nAdd a note (optional):`, "");
  if (note === null) return;
  const r = await api("POST", "/api/recs", { videoId: v.id, title: v.title, channel: v.channel, note });
  toast(r?.error ? `FriendoTube: ${r.error}` : `Sent to ${r.sent} group${r.sent === 1 ? "" : "s"}`);
}

function watchButton() {
  let btn = document.querySelector(".ft-send");
  const onWatch = location.pathname === "/watch" && signedIn();
  if (!onWatch) return btn?.remove();
  if (btn) return;
  btn = el("button", "ft-send", "Send to friends");
  btn.addEventListener("click", () => {
    const id = location.search.match(VIDEO_ID)?.[1];
    if (!id) return;
    recommend({
      id,
      title: firstText(document, ["ytd-watch-metadata h1", "h1.ytd-watch-metadata"]) || document.title.replace(/ - YouTube$/, ""),
      channel: firstText(document, ["ytd-watch-metadata ytd-channel-name a", "#owner ytd-channel-name a"]),
    });
  });
  document.body.append(btn);
}

function toast(message) {
  const t = el("div", "ft-toast", message);
  document.body.append(t);
  setTimeout(() => t.remove(), 3000);
}

setInterval(() => { scan(); renderShelf(); watchButton(); }, 2000);
setInterval(flush, 10_000);
