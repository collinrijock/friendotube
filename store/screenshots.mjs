// Store screenshots (1280x800) against real youtube.com with a local throwaway server.
// PLAYWRIGHT=/path/to/playwright-core node store/screenshots.mjs
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";

process.env.FRIENDOTUBE_DB = `${tmpdir()}/friendotube-shots-${process.pid}.db`;
const { server } = await import("../server/server.mjs");
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (token, method, path, body) =>
  (await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) })).json();

const signup = async (name) => (await call(null, "POST", "/api/signup", { name })).token;
const [me, rafa, ben, maya] = await Promise.all(["Collin", "Rafa", "Ben", "Maya"].map(signup));
const { code } = (await call(me, "POST", "/api/groups", { name: "The group chat" })).groups[0];
for (const t of [rafa, ben, maya]) await call(t, "POST", "/api/groups/join", { code });

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT ?? "playwright-core");
const ext = new URL("../extension", import.meta.url).pathname;
const out = new URL(".", import.meta.url).pathname;
const ctx = await chromium.launchPersistentContext(mkdtempSync(`${tmpdir()}/ft-shots-`), {
  headless: true, channel: "chromium", viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
const as = (token) => worker.evaluate(([server, token]) => chrome.storage.local.set({ server, token }), [base, token]);
const page = await ctx.newPage();

// Friends' feeds: a fixed set of well-known videos (titles from YouTube oEmbed), so the shots are stable and clean.
const IDS = { rafa: ["9bZkp7q19f0", "OPf0YbXqDm0", "fJ9rUzIMcZQ"], ben: ["kJQP7kiw5Fk", "OPf0YbXqDm0", "hT_nvWreIhg"], maya: ["JGwWNGJdvx8", "RgKAFK5djSk", "YQHsXMglC9A"] };
const meta = async (id) => {
  const o = await (await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`)).json();
  return { id, title: o.title, channel: o.author_name };
};
for (const [token, ids] of [[rafa, IDS.rafa], [ben, IDS.ben], [maya, IDS.maya]]) {
  await call(token, "POST", "/api/sightings", { videos: await Promise.all(ids.map(meta)) });
}
await call(rafa, "POST", "/api/recs", { ...(await meta("dQw4w9WgXcQ")), videoId: "dQw4w9WgXcQ", note: "you HAVE to watch this" });
await call(maya, "POST", "/api/recs", { ...(await meta("jNQXAC9IVRw")), videoId: "jNQXAC9IVRw", note: "where it all started" });

await as(me);
const hideEmptyPrompt = () => page.addStyleTag({ content: "ytd-feed-nudge-renderer, ytd-rich-grid-renderer #contents { display: none !important }" });

// 1. Home with the friends row.
await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".ft-shelf", { timeout: 30_000 });
await hideEmptyPrompt();
await page.waitForTimeout(2500); // thumbnails
await page.hover(".ft-card:nth-child(2)");
await page.screenshot({ path: `${out}screenshot-1-home.png` });

// 2. Recommending a friend's video from the row.
await page.hover(".ft-card:nth-child(4)");
page.once("dialog", (d) => d.accept("this is so us"));
await page.click(".ft-card:nth-child(4) .ft-share");
await page.waitForSelector(".ft-toast");
await page.screenshot({ path: `${out}screenshot-2-recommend.png` });

// 3. The popup: groups and invite code.
const id = new URL(worker.url()).host;
await page.goto(`chrome-extension://${id}/popup.html`);
await page.waitForSelector(".group");
await page.addStyleTag({ content: "html{background:linear-gradient(135deg,#0f0f0f,#272727);height:100%} body{margin:90px auto;background:#fff;border-radius:12px;box-shadow:0 10px 40px #0008;transform:scale(1.35);transform-origin:top center}" });
await page.screenshot({ path: `${out}screenshot-3-groups.png` });

await ctx.close();
server.close();
console.log("screenshots written to", out);
