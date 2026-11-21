# SCD Telegram bot — requirements (PRD, TB-1 built first) (owner 20 Nov 2026; supersedes the 16 Nov proposal)

## Owner decisions
1. Build it. Staff first; **guardians later** (design for them from day 1, switched OFF).
2. Bug report = screenshots + a Bangla voice note (or text) → AI writes the report → **the reporter taps ঠিক আছে** before a
   ticket is made; "সংশোধন" lets them correct by text/voice and the AI rewrites.
3. **A separate Gemini key** for the bot (the owner will give it) — NOT the app's AiSetting Gemini key.
4. All four functions get set up, in phases: bug reports, help, alerts, document requests.
5. **Tickets go to GitHub issues in the PUBLIC repo enayetsyl/scd-hub** (owner, 20 Nov, confirmed twice): label `bug-report`
   (+ `from-telegram`, role label `staff`/`guardian`), screenshots included — the owner accepts they are public.
6. Build first; the owner gives the BotFather token, the Gemini key and a GitHub token later. Until then the bot code
   ships switched off (no token → the webhook route answers 503 and nothing runs).

## Phases (one PR each, to dev; owner approves merge/promote)
**TB-1 Link + bug reports (staff)**
- Account link: app button "Telegram-এ যুক্ত হোন" (profile/settings) → deep link `t.me/<bot>?start=<one-time token>`
  (expires 15 min, single use) → the bot stores `{userId, role, chatId}`. Unlinked chats get a short Bangla refusal
  (no data). Unlink from the app and with /stop.
- Report flow: photos (up to 5) + voice/text → bot replies "লিখছি…" → Gemini (bot key) transcribes the voice and returns
  strict JSON {title, screen, what_happened, expected, steps[], severity} in plain Bangla → bot shows it with buttons
  **ঠিক আছে** / **সংশোধন** / **বাদ দিন** → on OK: ticket created, reply "টিকিট #N তৈরি হয়েছে".
- Ticket = a **GitHub issue** in enayetsyl/scd-hub via the REST API (fine-grained token, env `BOT_GITHUB_TOKEN`, scope:
  Issues read/write + Contents read/write on this repo only). Title = the AI title; body = the report fields, the
  transcript, reporter (name + role — no phone), app screen, date, and the screenshots as images.
- Screenshots: GitHub has no API to attach files to issues, so commit them with the Contents API to a separate
  orphan branch **`bug-assets`** (path `tg/<yyyy-mm>/<issue-or-uuid>-<n>.jpg`, never to dev/main → no CI/deploy) and embed
  them by their raw URL in the issue body. Resize to ≤ 1600 px JPEG first.
- Keep a small Mongo collection `TelegramLink` {userId, role, chatId, linkedAt} and `TelegramReport` {chatId, userId,
  issueNumber, state} only for linking and notifications — the ticket itself lives on GitHub.
- Reporter notifications: when the issue is closed or labelled `fixed`, tell the reporter on Telegram (poll the GitHub
  API every 15 min for issues with label `from-telegram` updated since the last run, or a GitHub webhook — poll is simpler).
- Status changes notify the reporter on Telegram ("আপনার #N ঠিক হয়েছে ✓").
- The owner gets a Telegram alert for every new ticket.
- The Claude sessions read the queue straight from GitHub (`gh issue list --label bug-report`).

**TB-2 Help**
- Any message that is a question ("কীভাবে…", "কোথায়…") or /help → search the 314 in-app help guides
  (server/assets/help/guides/*.json: title, intro, keywords, steps) **filtered by the user's permissions**, reply with
  the best 3 guide titles + a one-line answer + a link that opens the guide in the web app. Optional AI answer from the
  guide text only (cheap model), never invented steps.

**TB-3 Alerts (owner + chosen admins)**
- Subscriptions per user (/alerts): new bug ticket · daily school report summary (existing daily report service) ·
  error spikes (GlitchTip count over a threshold) · deploy/OTA done · a scheduled job failed. Quiet hours.

**TB-4 Document requests**
- /doc or "চিঠি/নোটিশ/সার্টিফিকেট লাগবে" → the bot asks the few needed fields (type, for whom, purpose, date) →
  creates a WORK-BOARD task for the Office/Principal (existing work board) with the details; the bot tells the requester
  when it is done. Never generates an official document without a person approving it.

**TB-5 Guardians (switch, OFF by default)**
- Same link button in the guardian app; guardians can report a problem (same flow, their own tickets only) and ask
  help (guardian guides only). Switch `telegram_guardian` (default OFF); Principal turns it on.

## Technical notes
- Telegram Bot API over fetch (no SDK), **webhook** mode: route `POST /telegram/webhook/<secret-path>` + check header
  `X-Telegram-Bot-Api-Secret-Token`. A new top-level route prefix needs the VM **Caddyfile @api matcher** too
  (memory: caddy-api-matcher-allowlist) — or mount it under an existing allowed prefix.
- Voice notes arrive as OGG/Opus (audio/ogg) — Gemini accepts it inline; files ≤ 20 MB download limit.
- Secrets (env only, never committed/printed): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `BOT_GEMINI_API_KEY`,
  `BOT_GITHUB_TOKEN` (+ optional `BOT_GEMINI_MODEL`, `BOT_GITHUB_REPO`=enayetsyl/scd-hub). The owner creates the bot with @BotFather and gives the token + the Gemini key; the
  lead/owner puts them into the VM env (the server guard blocks Claude from reading .env — ask the owner to paste them
  via a safe path, e.g. a one-time file the service reads, never into chat logs).
- Meter every AI call (AiUsage, feature `telegram_bot`, provider gemini) so cost shows on the AI usage screen; a
  monthly cap like D-#1662.
- Rate limit per chat (e.g. 10 reports/day), idempotent update handling (Telegram retries), Bangla replies throughout,
  audit events for link/unlink/ticket status.
- Help guides: every new screen (desk, link button) gets its guide in the same PR (D-#973).
- Tests: link token (expiry, single use), unlinked refusal, report JSON parse/repair, OK → ticket, permission gates,
  webhook secret check; mock Telegram + Gemini. jest --runInBand targeted; full suite --maxWorkers=2 by the lead.

## Owner actions needed (later — build does not wait for them)
1. Create the bot with @BotFather (e.g. "SCD Hub Help"), give the token privately.
2. Give the separate Gemini API key.
3. Give a fine-grained GitHub token for enayetsyl/scd-hub (Issues + Contents read/write), or let the server Claude use
   the gh login it already has if the owner prefers (decide at go-live).

## Environment (names only — values live in the server env, never in the repo)
TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_USERNAME (optional; else getMe), BOT_GEMINI_API_KEY,
BOT_GEMINI_MODEL, BOT_GEMINI_FALLBACK_MODEL, BOT_GITHUB_TOKEN, BOT_GITHUB_REPO. Optional: TELEGRAM_GUARDIAN_ENABLED
(the `telegram_guardian` switch, default OFF), TELEGRAM_WEBHOOK_URL (go-live script only).
- Only prod holds them. One bot = one webhook, so dev/local run on mocks. With none set the code no-ops and the webhook
  answers 503.
- Gemini notes: the primary model can answer 503 "high demand", so the bot retries on the fallback (lite) model.
- Go-live: `cd server && npx tsx scripts/telegram-set-webhook.ts` (after the owner approves); `--delete` switches it off.

## Build notes (TB-1, D-#1666)
- Module `server/src/modules/telegram/`; webhook `POST /triggers/telegram/webhook` (under the existing /triggers Caddy prefix).
- Gemini calls are metered as AiUsage feature `telegram_bot`; registered in AI_FEATURES (owner switch, $3 monthly cap, school budget); the bot uses its OWN key and checks switch + caps before each Gemini call.
- Closed tickets: a scheduler sweep (every 15 min, not awaited) tells the reporter once.
