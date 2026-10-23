# FriendoTube, formally

A Lean 4 model of FriendoTube's security-critical core, with machine-checked proofs.
`lake build` checks every proof; CI also fails on any `sorry` and on any drift between the
Lean limits and the JS that uses them.

```sh
cd formal
lake build                  # model + proofs + generator
lake env lean Check.lean    # lists each theorem's axioms (no sorryAx allowed)
lake exe gen ..             # regenerate server/limits.gen.mjs and extension/limits.gen.js
```

| File | What it is |
|---|---|
| `FriendoTube/Limits.lean` | Every cap and the video-id alphabet. **Source of truth** for the JS (generated). |
| `FriendoTube/Model.lean` | The API as a pure function `handle : State → token → Req → State × Resp`, one case per route. |
| `FriendoTube/Auth.lean` | Authentication, authorization and group-membership theorems. |
| `FriendoTube/Bounds.lean` | Input-bound theorems. |
| `FriendoTube/Render.lean` | The extension's DOM writes and the rendering theorems. |
| `Gen.lean` | Writes the JS limits from `Limits.lean`. |

## What is proven

**Auth**
- `auth_required`: every route except signup, called without a token that matches a stored key hash, returns 401 and leaves the state unchanged.
- `auth_sound`, `handle_cases`: a request either fails that way or runs as exactly one stored user, the one whose `tokenHash = hash token`.
- `authed_never_issues_tokens`: only signup returns a token.

**A user only reads and writes their own data and their groups**
- `authed_new_sightings_own`, `authed_keeps_others_sightings`: a request only creates the caller's sightings and never removes anyone else's.
- `authed_new_recs_own`: new recommendations are the caller's and go only to groups the caller is a member of.
- `authed_keeps_others_members`, `authed_users`: nobody else's memberships or account are ever removed, and no request but signup creates an account.
- `authed_feed`: every feed item is a stored sighting from someone else who shares a group with the reader; every rec is someone else's and was sent to one of the reader's groups; reading changes nothing.
- `authed_groups_visible`: group listings show only groups the caller belongs to.

**Group membership**
- `authed_new_members`: a new membership is always the caller's, and comes either from creating the group (as its first member) or from `join` with a code equal to that group's code.
- `shares_sound`: "friends" means sharing at least one group.

**Input bounds**
- `text_le`, `normCode_le`: every stored string is cut to its cap (`Limits.lean`).
- `cleanVideo_ok`, `validId_alphabet`, `validId_length`: accepted videos have an 11-character id from `idAlphabet` and capped title and channel.
- `sightings_cap`: a batch over `maxVideos` is rejected and changes nothing.
- `handle_bounded`: every route preserves `Bounded`, so nothing in the database ever exceeds a cap.

**Rendering**
- `shelf_safe`, `card_safe`, `toast_safe`, `prompt_safe`, `sendButton_safe`, `popup_safe`, `groupRow_safe`: no renderer writes `innerHTML`, and untrusted data (anything from the server) only reaches plain-text sinks: `textContent`, dialog text and the clipboard.
- `shelf_urls`: the only URL sinks (`href`, `img.src`) get a fixed prefix plus the id of a card whose id passed `validId`.
- `idAlphabet_inert`: that id can't contain a quote, `<`, `>`, `:`, `/`, `?`, `#`, `&`, `%`, `=`, a backtick, a backslash or whitespace.

## How the JS is tied to the model

- **Generated:** every cap and the video-id regex in `server/limits.gen.mjs` and `extension/limits.gen.js`. CI regenerates them and fails on a diff.
- **Mirrored 1:1:** each route in `server/server.mjs` and each renderer in `extension/content.js` and `popup.js` carries a `Lean:` comment naming the definition it implements and the theorems that depend on it. Change both together.
- **Linted:** CI fails if the extension uses `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` or an `on…` attribute, so `el(…, text)` → `textContent` stays the only path text takes into the DOM.

## The trusted boundary (not proven)

The proofs are about the model. These are assumed:

- **The JS matches the model.** The mirror is checked by review and by the `Lean:` comments, not by a proof. Where they knowingly differ:
  - String lengths: Lean counts code points, and the JS does too (`[...s]`). Lone UTF-16 surrogates, which Lean's `Char` can't represent, are treated as one character each.
  - The feed SQL's `GROUP BY` and `LIMIT` merge and drop rows of the modelled result set, and the server adds names. Neither is modelled.
  - A batch of sightings with the same id twice keeps the last one in SQL; the model keeps both. Same set of ids, same owner.
  - Signup's fresh token, new group codes and the clock come from outside the model (arguments).
- **SQLite** runs the parameterized queries as written, enforces `PRIMARY KEY`, `UNIQUE` and `ON DELETE CASCADE`, and is the only writer.
- **Crypto:** `randomBytes(32)` is unpredictable, and SHA-256 has no practical collisions or preimages (`hash` is an abstract function in the model).
- **The browser:** `textContent`, `prompt`/`confirm` and the clipboard never parse markup; an `href`/`src` built from a fixed prefix and inert characters goes where it says; the extension's isolated world and MV3 CSP hold.
- **Transport and hosting:** Cloudflare TLS, the tunnel, the server listening only on 127.0.0.1, and Cloudflare setting `CF-Connecting-IP`.
- **Not modelled at all:** rate limiting (per-IP, in `server.mjs`), the 256 KB body cap, 404/413/429 responses, pruning after 14 days, the static `/` and `/privacy` pages, the old-domain redirect, the background service worker, and reading YouTube's page (`scan`). None of them grants access; they only refuse or delete.
- **Lean itself:** the kernel and the standard axioms `propext`, `Classical.choice`, `Quot.sound` (`Check.lean` lists them per theorem).
