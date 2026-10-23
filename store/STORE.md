# Chrome Web Store submission — FriendoTube 1.0.0

**Submitted 2026-10-22, pending review.** Item `flolldilpofpclolpfojcfebhdeeleem`, publisher `f9352e97-b2ea-4491-9d1e-6f32ae8d1c9e` (Collin Rijock, non-trader, collinrijock@gmail.com). Test instructions give reviewers invite code `TTDM7BJQ` ("Store review" group, kept alive by `deploy/demo.mjs`).

Upload `friendotube-1.0.0.zip` (manifest at the zip root) at https://chrome.google.com/webstore/devconsole → **New item**. Then fill in:

## Store listing
- **Name:** FriendoTube (from manifest)
- **Summary:** See what YouTube is recommending your friends, and send each other videos. Join a friend group with an invite code.
- **Category:** Social & Communication · **Language:** English
- **Icon:** `extension/icons/icon128.png` · **Small promo tile:** `store/promo-440x280.png`
- **Screenshots (1280×800):** `store/screenshot-1-home.png`, `store/screenshot-2-recommend.png`, `store/screenshot-3-groups.png`
- **Homepage:** https://friendotube.collinrijock.com/ · **Support:** collinrijock@gmail.com
- **Description:**

> YouTube shows every one of your friends a different feed. FriendoTube lets your friend group peek into each other's.
>
> • A "From your friends" row at the top of your YouTube home page: videos your friends sent you, plus videos YouTube is recommending them that it didn't show you.
> • Recommend any of them with one click, or hit "Send to friends" on any video you're watching. Add a note if you like.
> • Make a group, share its invite code, done. Be in as many groups as you want.
>
> Privacy: FriendoTube uploads only the videos YouTube recommends you (video, title, channel) and the videos you choose to send, and only your groups can see them. No Google account, no watch history, no searches. Everything is deleted after 14 days, sharing can be switched off any time, and "Delete my account" removes all of it at once.

## Privacy practices tab
- **Single purpose:** Share the videos YouTube recommends you with your friend groups, show you theirs on your YouTube home page, and let you send each other videos.
- **`storage`:** keeps the user's access key, chosen server and the share on/off setting.
- **Host permission `https://www.youtube.com/*`:** reads the recommended videos (id, title, channel) on the YouTube home page and watch-page sidebar, and adds the "From your friends" row and "Send to friends" button.
- **Host permission `https://friendotube.collinrijock.com/*`:** the FriendoTube server that stores groups, shared feed videos and recommendations.
- **Remote code:** No, I am not using remote code.
- **Data collected:** tick **Personally identifiable information** (the display name the user picks), **Personal communications** (notes on recommendations) and **Website content** (titles/ids of videos YouTube recommends, notes the user writes). Leave everything else unticked (no web history, no location, no authentication info, no personal communications, no financial/health data).
- **Certify all three:** not sold to third parties; not used for unrelated purposes; not used for creditworthiness/lending.
- **Privacy policy URL:** https://friendotube.collinrijock.com/privacy

## Distribution
- **Visibility:** Public (or Unlisted to share by link only with the friend group). **Regions:** all. **Price:** free.
