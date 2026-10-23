// Keeps a demo friend ("FriendoTube Demo") active in the "Store review" group so Chrome Web Store
// reviewers can see the friends row. Runs daily on the mini (LaunchAgent com.collinrijock.friendotube-demo).
import { readFileSync, writeFileSync } from "node:fs";
const base = "http://127.0.0.1:4330";
const file = new URL("../data/demo.json", import.meta.url).pathname;
const call = async (token, method, path, body) => {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${data.error}`);
  return data;
};
let demo;
try { demo = JSON.parse(readFileSync(file, "utf8")); await call(demo.token, "GET", "/api/me"); }
catch {
  const { token } = await call(null, "POST", "/api/signup", { name: "FriendoTube Demo" });
  const { groups } = await call(token, "POST", "/api/groups", { name: "Store review" });
  demo = { token, code: groups[0].code };
  writeFileSync(file, JSON.stringify(demo));
}
const videos = [
  ["9bZkp7q19f0", "PSY - GANGNAM STYLE(강남스타일) M/V", "officialpsy"],
  ["OPf0YbXqDm0", "Mark Ronson - Uptown Funk (Official Video) ft. Bruno Mars", "MarkRonsonVEVO"],
  ["fJ9rUzIMcZQ", "Queen – Bohemian Rhapsody (Official Video Remastered)", "Queen Official"],
  ["kJQP7kiw5Fk", "Luis Fonsi - Despacito ft. Daddy Yankee", "LuisFonsiVEVO"],
].map(([id, title, channel]) => ({ id, title, channel }));
await call(demo.token, "POST", "/api/sightings", { videos });
await call(demo.token, "POST", "/api/recs", { videoId: "jNQXAC9IVRw", title: "Me at the zoo", channel: "jawed", note: "the first YouTube video ever" });
console.log(new Date().toISOString(), "demo refreshed, invite code", demo.code);
