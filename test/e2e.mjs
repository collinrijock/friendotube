// Live check of the extension against real youtube.com (YouTube's DOM drifts; run this when the shelf breaks).
// PLAYWRIGHT=/path/to/node_modules/playwright-core node test/e2e.mjs
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";

process.env.FRIENDOTUBE_DB = `${tmpdir()}/friendotube-e2e-${process.pid}.db`;
const { server } = await import("../server/server.mjs");
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (token, method, path, body) =>
  (await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) })).json();

// A friend with a feed and a recommendation, and me in the same group.
const rafa = (await call(null, "POST", "/api/signup", { name: "Rafa" })).token;
const { groups } = await call(rafa, "POST", "/api/groups", { name: "Boys" });
await call(rafa, "POST", "/api/sightings", { videos: [{ id: "jNQXAC9IVRw", title: "Me at the zoo", channel: "jawed" }] });
await call(rafa, "POST", "/api/recs", { videoId: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", channel: "Rick Astley", note: "trust me" });
const me = (await call(null, "POST", "/api/signup", { name: "Collin" })).token;
await call(me, "POST", "/api/groups/join", { code: groups[0].code });

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT ?? "playwright-core");
const ext = new URL("../extension", import.meta.url).pathname;
const ctx = await chromium.launchPersistentContext(mkdtempSync(`${tmpdir()}/ft-profile-`), {
  headless: true, channel: "chromium", args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
await worker.evaluate(([server, token]) => chrome.storage.local.set({ server, token }), [base, me]);

const page = await ctx.newPage();
const fail = (msg) => { console.error("FAIL:", msg); process.exitCode = 1; };

// Watch page: sidebar gets collected, and the send button appears.
await page.goto("https://www.youtube.com/watch?v=jNQXAC9IVRw", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".ft-send", { timeout: 20_000 }).catch(() => fail("no Send to friends button"));
page.once("dialog", (d) => d.accept("zoo!"));
await page.click(".ft-send").catch(() => {});
await page.waitForSelector(".ft-toast", { timeout: 5_000 }).catch(() => fail("no toast after sending"));
const sentRec = (await call(rafa, "GET", "/api/friends-feed")).recs[0];
console.log("rec Rafa got:", sentRec);
if (sentRec?.id !== "jNQXAC9IVRw" || sentRec.note !== "zoo!" || !sentRec.channel) fail("watch-page recommend didn't arrive intact");
await page.waitForTimeout(15_000); // scan every 2 s, flush every 10 s
const rafaFeed = await call(rafa, "GET", "/api/friends-feed");
console.log(`sidebar videos reported: ${rafaFeed.feed.length}`, rafaFeed.feed.slice(0, 3).map((v) => `${v.title} / ${v.channel}`));
if (!rafaFeed.feed.length) fail("nothing from the watch sidebar reached the server");
else if (rafaFeed.feed.some((v) => !v.channel)) console.warn("WARN: some videos have no channel");

// Home page: the friends shelf renders (signed-out YouTube may show no grid; that's reported, not failed).
await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
const shelf = await page.waitForSelector(".ft-shelf", { timeout: 20_000 }).catch(() => null);
if (shelf) {
  const cards = await page.$$eval(".ft-card", (cs) => cs.map((c) => c.innerText.replace(/\s+/g, " ").trim()));
  console.log("shelf cards:", cards);
  if (!cards.some((c) => c.includes("Rafa recommends"))) fail("Rafa's rec missing from shelf");
  await page.screenshot({ path: `${tmpdir()}/friendotube-home.png` });
  console.log(`screenshot: ${tmpdir()}/friendotube-home.png`);
} else {
  const grid = await page.$('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer');
  console.warn(grid ? "FAIL-ish: home grid exists but no shelf" : "WARN: signed-out home has no feed grid, shelf not testable here");
  if (grid) process.exitCode = 1;
}
await ctx.close();
server.close();
console.log(process.exitCode ? "e2e: FAILED" : "e2e: ok");
