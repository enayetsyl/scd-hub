# Help-guide pictures: local capture runs

The procedure behind `docs/prd-help-centre.md` §5 (D-#970, D-#992). Pictures come from the real
app running locally on example data. Nothing here may ever point at the school's database.

## Files

| File | What |
|---|---|
| `mem.cjs <port>` | in-memory MongoDB (run from **PowerShell inside `server/`**) |
| `fixture.ts [--reset]` | the base example school (`seedBaseSchool()`; logins and ids are in its header) |
| `fixtures/<area>.ts` | an area's extra data, built on `seedBaseSchool()` (create-only, local-only guard) |
| `serve-web.cjs --dir <web> --port <p> --api <apiPort>` | serves a prebuilt web export and proxies `/graphql`, `/files`, … to the local server |
| `capture.cjs --spec <name> --base http://localhost:<p>` | walks a spec, takes the pictures, fills `shot` / `size` / `box` in the guide files, clears `draft` |
| `specs/<name>.cjs` | one walk per area (`exports.run = async (h) => …`; helpers: `login`, `shot`, `tap`, `openMenu`, `topmost`) |

## One run, start to finish

```powershell
# 1. Web build, once, with NO EXPO_PUBLIC_API_URL (the web app then calls /graphql on its own origin).
cd app; npx expo export --platform web --clear --output-dir C:/w/hc-web
# 2. Database, data, server, web, each on its own free ports.
cd server; node scripts/help/mem.cjs 27911
$env:MONGODB_URI='mongodb://127.0.0.1:27911/hc'; npx tsx scripts/help/fixtures/<area>.ts --reset
$env:PORT='4311'; $env:TZ='Asia/Dhaka'; $env:GOOGLE_OAUTH_CLIENT_ID='dummy'; $env:GOOGLE_OAUTH_CLIENT_SECRET='dummy'; $env:GOOGLE_OAUTH_REFRESH_TOKEN='dummy'; npx tsx src/index.ts
node scripts/help/serve-web.cjs --dir C:/w/hc-web --port 8311 --api 4311
# 3. Pictures.
$env:PLAYWRIGHT_CORE='C:/w/pw/node_modules/playwright-core'; node scripts/help/capture.cjs --spec <area> --base http://localhost:8311
node ../skills/_tools/verify_help_guides.mjs
```

The server needs the repo `.env` (JWT secret) copied into the worktree root; the dummy Google
values keep it from touching the school's Drive. The server loads guide files once, so restart it
to see new guides in the app.

## Writing a guide

- One small task per guide, at most 4 screens and 8 steps. One step = one button or field on the
  picture, named in `<b>…</b>`. The app adds the number: "<b>মঞ্জুর</b> চাপুন" → "মঞ্জুর (২) চাপুন".
- Bangla only, guardian-friendly. Use the owner's words (শাখা, বাড়ির কাজ, উপস্থিতি, শিক্ষার্থী,
  শ্রেণি শিক্ষক, রিমাইন্ডার, চাপুন, বরাদ্দ), and quote a button exactly as it appears on screen.
- `perms` = the catalogue action(s) the task needs (any-of); `audience: "ALL_STAFF"` for SELF tasks,
  `"GUARDIAN"` for the guardian app. `screens` = the `Tab/Screen` names whose header ? opens it;
  `goTo` = where এই পাতায় যান leads; `order` = position in its category.
- Write the guide with `"draft": true` and `box: null`, then let `capture.cjs` fill it in.
- No `<…>` in text other than `<b>`. Write real example names, e.g. "যেমন C1_MATH.tree.json".
- Pictures: phone viewport 412×860. Pick targets that are really on screen (hidden stack screens
  stay mounted, so `topmost` checks `elementFromPoint`). Use `{ anchor }` to scroll a group into view.
