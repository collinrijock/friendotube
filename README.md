# FriendoTube

A Chrome (and Copper) extension that lets a friend group see what YouTube is recommending each other, and send each other videos.

- **Your feed goes up:** on youtube.com home and the watch-page sidebar, the extension reports the recommended videos (id, title, channel) to the server. Turn it off in the popup ("Share my YouTube home feed").
- **Friends' feeds come down:** a "From your friends" row at the top of your YouTube home shows friends' recommendations first, then videos from their feeds (last 3 days) that YouTube didn't show you.
- **Sharing:** hover any card → **Recommend**, or the **Send to friends** button on any watch page. Optional note.
- **Groups:** create one in the popup, send friends the invite code. You can be in several. Data older than 14 days is deleted; "Delete my account" removes everything of yours.

## Install (friends)

1. Download `friendotube-extension.zip`, unzip it.
2. Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → pick the `extension` folder. Copper: Settings → Extensions → load from folder.
3. Click the FriendoTube icon → enter your name → join with an invite code.

There are no passwords: the browser holds a random key. Signing out loses the account.

## Server

`server/server.mjs` — Node 22, no dependencies (`node:http` + `node:sqlite`). Runs on the Mac mini (`~/srv/friendotube`, LaunchAgent `com.collinrijock.friendotube`, port 4330, DB `~/srv/friendotube/data/friendotube.db`, log `~/Library/Logs/friendotube.log`), exposed as `https://friendotube.collinrijock.com` by a direct cloudflared ingress rule (not via Caddy).

- Test: `node --test server/server.test.mjs`
- Live extension test against real youtube.com (YouTube's markup drifts; run when the shelf breaks): `PLAYWRIGHT=<path>/node_modules/playwright-core node test/e2e.mjs`
- Deploy: `./deploy/deploy.sh`
- Store zip (manifest at root): `cd extension && python3 -m zipfile -c ../friendotube-1.0.0.zip manifest.json bg.js content.js content.css popup.html popup.js icons`; listing, privacy answers and assets in `store/` (`store/STORE.md`)
