// Renders store/icon.svg into the extension's PNG icons, and the store promo tile. node store/render.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT ?? "playwright-core");
const dir = new URL(".", import.meta.url).pathname;
const svg = readFileSync(dir + "icon.svg", "utf8");
const b = await chromium.launch();
const p = await b.newPage();
for (const size of [16, 32, 48, 128]) {
  const pad = size === 128 ? 16 : 0; // store guideline: 96px art inside 128 with 16px transparent border
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<body style="margin:0;background:transparent"><div style="padding:${pad}px;width:${size - 2 * pad}px;height:${size - 2 * pad}px">${svg.replace("<svg ", `<svg width="${size - 2 * pad}" height="${size - 2 * pad}" `)}</div>`);
  await p.screenshot({ path: `${dir}../extension/icons/icon${size}.png`, omitBackground: true });
}
await p.setViewportSize({ width: 440, height: 280 });
await p.setContent(`<body style="margin:0;width:440px;height:280px;display:flex;align-items:center;gap:22px;padding:0 34px;box-sizing:border-box;background:linear-gradient(135deg,#0f0f0f,#272727);font-family:Roboto,Arial,sans-serif;color:#fff">
  ${svg.replace("<svg ", '<svg width="120" height="120" ')}
  <div><div style="font-size:38px;font-weight:800;letter-spacing:-1px">FriendoTube</div>
  <div style="font-size:15px;color:#cfcfcf;margin-top:6px;line-height:1.35">See what YouTube shows<br>your friends, and send<br>each other videos.</div></div></body>`);
await p.screenshot({ path: `${dir}promo-440x280.png` });
await b.close();
