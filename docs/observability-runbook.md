# Observability Build Runbook — Monitoring & Error Reporting (MON-1..MON-6)

**Status:** Ready to execute. Nothing built yet. **This is the HOW; the WHAT/WHY is
[docs/prd-observability.md](prd-observability.md).**
**Owner:** Principal (operator) · **Executor:** a Claude Code session (server/app code + CI) +
the operator (VM / DNS / external accounts / secrets).
**Traceability:** D-#252 / D-#253 (ratified 2026-06-15) · ADR-005 (firewall — *untouched*) · DEP-1..6
(the live VM + Caddy + CI/CD this plugs into) · ADR-010 (Expo web/Android/iOS) · ADR-012 (executed gate).

> **For the executing session — read this first.** This runbook is written so a *fresh* Claude session
> can build the whole module without re-deriving anything. Before touching code: read
> `AGENTS.md` (hard rules), `docs/prd-observability.md` (the contract), and DECISIONS D-#252/#253. Then
> follow the slices in order. **Two non-negotiables:** (1) **Executed verification is the only gate** —
> each slice's *Acceptance* must print/show green in your session, an SDK merely being installed is not
> "done"; (2) **§0 secrets discipline** — concrete IP / domain / DSN / SMTP values are **operator-side
> only** (password manager + untracked notes file), **never committed**. This doc uses `<PLACEHOLDERS>`;
> resolve them from the operator at run time, never hard-code them into a tracked file.

---

## §0 — Ground rules, current state, and the operator/executor split

### 0.1 Legend — who does each step
- **[OP]** = operator / VM / DNS / external SaaS / secrets. The executing session **hands these to the
  human as a checklist** (or runs them over SSH only if the operator grants access this session). They
  cannot be done from the repo alone.
- **[EX]** = executor (the Claude session): in-repo code, config, CI edits, run the gate. Build in a
  **worktree off `dev`**, one PR to `dev` (§0.4).

### 0.2 Current state (preconditions already met)
- The live VM, Caddy auto-HTTPS, systemd services (`scdhub-prod`/`scdhub-dev`), nightly Drive backup, and
  GitHub Actions CI/CD all exist (DEP-1..6).
- **The GlitchTip subdomain is created** (`errors.<PROD_DOMAIN>`, operator-side value) and was
  **verified pointing at the VM on 2026-06-15** (one resolver already returned the VM IP; the rest were
  propagating). **Before the Caddy cert step (MON-1 step 7), re-confirm global propagation:**
  `dig +short errors.<PROD_DOMAIN>` must return the **same IP as `scdhub.<PROD_DOMAIN>`** on Google
  (8.8.8.8) + Cloudflare (1.1.1.1), or Let's Encrypt issuance can briefly fail.
- **Nothing else exists** — no tracker, no SDKs, no `ErrorBoundary`, no global urql error handler.
  Today server errors go to `console.error` → the systemd journal; app errors surface per-screen via
  `friendlyError`.

### 0.3 Values to obtain (never commit — §0 hard rule)
| Placeholder | What it is | Where the executor gets it |
|---|---|---|
| `<VM_PUBLIC_IP>` | the Oracle VM IP | operator notes / `dig +short scdhub.<PROD_DOMAIN>` |
| `<PROD_DOMAIN>` | the app domain | operator notes (the prod/dev subdomains already use it) |
| `<GLITCHTIP_DOMAIN>` | `https://errors.<PROD_DOMAIN>` | derived from above |
| `<GT_SERVER_DSN>` / `<GT_APP_DSN>` | the two project DSNs | GlitchTip UI after MON-1 (Settings → Projects → Client Keys) |
| `<SMTP_URL>` / `<FROM_EMAIL>` / `<ALERT_EMAIL>` | mail for GlitchTip + host alerts | operator's SMTP (e.g. the school mailbox / a transactional SMTP) |
| `<SENTRY_AUTH_TOKEN>` | source-map/symbol upload token | GlitchTip UI (Profile → Auth Tokens); CI/build secret only |
| `<GT_SECRET_KEY>` / `<GT_DB_PASSWORD>` | GlitchTip internals | operator generates random; stored in `/opt/glitchtip/.env` (mode 600) |

These go in **`.env` files (mode 600)** on the VM and **GitHub Actions secrets** — *not* the repo. The only
app-bundled value is `EXPO_PUBLIC_SENTRY_DSN` (a DSN is a write-only ingest key, safe to ship, like the
existing `EXPO_PUBLIC_*`). `SENTRY_AUTH_TOKEN` is **never** `EXPO_PUBLIC_*` and never bundled.

### 0.4 Branch / PR strategy
- One worktree off `dev` (e.g. `worktree-observability`); fresh-worktree setup per AGENTS (`npm install`
  then `npm run build --workspace=shared`).
- **Vocab-free / contract-free:** this module does **not** touch `shared/vocab.ts`,
  `docs/import-contract.schema.json`, `NOTIFICATION_KINDS`, or app RBAC. So the **verifier is untouched**
  and **jest is unaffected** — confirm with `git diff -- shared docs/import-contract.schema.json` (empty).
- The code slices (MON-2/3/4) can land as **one PR to `dev`** (they share the SDK wiring) or stacked
  per-slice; either way each slice's Acceptance is proven before merge. MON-1 and MON-5's [OP] pieces land
  as operator runbook actions + (for MON-5's host script) a small `scripts/` addition.
- **D-#252/#253 are already recorded.** Add only a **build ruling** D-# (next free number, currently
  **D-#254+**) if a real decision arises mid-build; otherwise no new DECISIONS rows.

---

## MON-1 — GlitchTip self-host on the VM  **[OP]** (executor produces the checklist; operator runs)

**Goal:** a locked-down, self-hosted, Sentry-API-compatible error backend at `<GLITCHTIP_DOMAIN>`, on the
existing VM, with retention + quota + nightly backup.

> **ARM note:** the Oracle A1.Flex VM is **arm64**. GlitchTip, Postgres, and Valkey/Redis images are all
> multi-arch (arm64) — they run natively, no emulation.

1. **Install Docker + the compose plugin** on the VM (if not present): the official Docker apt repo for
   Ubuntu arm64; verify `docker compose version`.
2. **Lay down the stack** under `/opt/glitchtip/`:
   - Download the **canonical compose** (the docs ship it, not inline): GlitchTip's
     `compose.sample.yml` → save as `/opt/glitchtip/compose.yml`. It defines the services **web**,
     **worker**, **migrate** (one-shot), **postgres**, and **valkey** (cache/queue).
   - **Bind the web port to localhost only** so Caddy is the sole public entry — in `compose.yml` set the
     web service ports to `127.0.0.1:<GT_LOCAL_PORT>:8080` (pick an unused local port, e.g. `8050`).
3. **Create `/opt/glitchtip/.env`** (mode 600) — exact env var names per the current GlitchTip docs:
   ```ini
   SECRET_KEY=<GT_SECRET_KEY>                       # any long random string
   DATABASE_URL=postgres://postgres:<GT_DB_PASSWORD>@postgres:5432/postgres
   VALKEY_URL=redis://valkey:6379/0                 # cache/queue (Valkey speaks the redis:// URL)
   GLITCHTIP_DOMAIN=<GLITCHTIP_DOMAIN>              # MUST include scheme, e.g. https://errors.<PROD_DOMAIN>
   DEFAULT_FROM_EMAIL=<FROM_EMAIL>
   EMAIL_URL=<SMTP_URL>                             # smtp://user:pass@host:port — enables alert emails
   GLITCHTIP_EVENT_RETENTION_DAYS=30               # 30-day retention (D-#252). NB: older builds use
                                                    #   GLITCHTIP_MAX_EVENT_LIFE_DAYS — confirm the exact
                                                    #   name in YOUR downloaded compose.sample.yml.
   ENABLE_USER_REGISTRATION=true                    # TEMPORARY — flip to false after step 5
   ENABLE_ORGANIZATION_CREATION=false
   ```
4. **Start + migrate:** `docker compose up -d`; ensure the `migrate` service ran (or
   `docker compose run --rm web ./manage.py migrate`). Check `docker compose ps` all healthy.
5. **Create the admin user, then close signup:** either register the first user in the web UI (with
   `ENABLE_USER_REGISTRATION=true`) **or** `docker compose run --rm web ./manage.py createsuperuser`.
   Then set `ENABLE_USER_REGISTRATION=false` in `.env` and `docker compose up -d` to apply. **No open
   signup remains.**
6. **Create org + projects:** one organization (e.g. `scd`); two **projects** — `scdhub-server` and
   `scdhub-app`; set up two **environments** (`production`, `development`). Copy each project's **DSN**
   (→ `<GT_SERVER_DSN>`, `<GT_APP_DSN>`) and create an **Auth Token** (→ `<SENTRY_AUTH_TOKEN>`).
7. **Caddy vhost** — add to the Caddyfile (the DEP-2 pattern; **re-confirm DNS propagation first**, §0.2):
   ```caddy
   errors.<PROD_DOMAIN> {
       reverse_proxy 127.0.0.1:<GT_LOCAL_PORT>
       # optional extra gate on the dashboard (the dev-site basic-auth pattern):
       # basicauth { <user> <bcrypt-hash> }   # NOTE: do NOT basic-auth the ingest path /api/*  —
       #                                       # SDKs must POST events unauthenticated-by-basic-auth
   }
   ```
   Reload Caddy; confirm `https://errors.<PROD_DOMAIN>` serves the GlitchTip login over a valid cert.
   *(If you basic-auth the dashboard, scope it so it does NOT cover the `/api/` ingest routes, or client
   events will be rejected. Simplest: rely on GlitchTip's own login and skip Caddy basic-auth.)*
8. **Quota / throttle:** set a per-organization **event throttle / rate limit** in the GlitchTip UI
   (Organization → Settings) so a crash loop can't flood the disk. Retention is already 30d (step 3).
9. **Backup [OP/VM]:** fold the GlitchTip Postgres into the nightly Drive backup (DEP-4). Add to
   `scripts/backup.sh` (runs on the VM) a step alongside the Mongo dump:
   ```bash
   # GlitchTip Postgres → gzip → same Drive rotation as the Mongo archive
   docker exec glitchtip-postgres pg_dump -U postgres postgres \
     | gzip > "/tmp/glitchtip-$(date +%F).sql.gz"
   # then hand /tmp/glitchtip-*.sql.gz to scripts/drive-backup.mjs (GlitchTip subfolder, same 7d/4w/3m rotation)
   ```
   *(Adjust the container name + DB to match your compose.)*

**Acceptance (executed):** `https://errors.<PROD_DOMAIN>` loads over HTTPS with the GlitchTip login; a
manual test event reaches the `scdhub-server` project —
`npx @sentry/cli send-event -m "MON-1 smoke" --url <GLITCHTIP_DOMAIN>` with the DSN, **or** a `curl` to the
store endpoint; retention=30 + the org throttle are set; signup is closed; a `glitchtip-*.sql.gz` lands in
the backup target.

---

## MON-2 — Server error capture (`@sentry/node`)  **[EX]**

**Goal:** every unhandled server failure + GraphQL resolver error lands in GlitchTip with role + operation,
secrets scrubbed.

1. `npm install @sentry/node --workspace=server`.
2. **Init first.** Create `server/src/observability/sentry.ts` and import it at the **very top** of
   [server/src/index.ts](../server/src/index.ts) (before any other import, so instrumentation hooks load
   early):
   ```ts
   // server/src/observability/sentry.ts
   import * as Sentry from "@sentry/node";

   const dsn = process.env.SENTRY_DSN;
   if (dsn) {
     Sentry.init({
       dsn,
       environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
       release: process.env.GIT_SHA,            // set in CI/deploy (the git sha)
       tracesSampleRate: 0,                     // errors only; GlitchTip tracing is light (PRD §2)
       // Scrub secrets even though PII-in-errors is allowed (D-#252 guardrail):
       beforeSend(event) {
         const h = event.request?.headers as Record<string, string> | undefined;
         if (h) { delete h.authorization; delete h.Authorization; delete h.cookie; }
         // drop any password/token/jwt-ish fields anywhere we attach extra data
         return event;
       },
     });
   }
   export { Sentry };
   ```
   ```ts
   // server/src/index.ts — FIRST line:
   import "./observability/sentry";
   ```
   `@sentry/node` auto-captures `uncaughtException` + `unhandledRejection`.
3. **GraphQL/resolver errors.** Yoga masks errors to clients, so capture server-side in a Yoga/Envelop
   plugin. Add to the `createYoga({ plugins: [...] })` (or via `maskError`) a hook that reports non-client
   errors with context:
   ```ts
   // a minimal Yoga plugin — capture executor errors with role + operation
   import { Sentry } from "./observability/sentry";
   const sentryErrorPlugin = {
     onExecute({ args }: any) {
       return {
         onExecuteDone({ result }: any) {
           for (const err of result?.errors ?? []) {
             // skip expected client errors (validation/Bangla 4xx) — only capture real faults
             if (err?.extensions?.code && err.extensions.code !== "INTERNAL_SERVER_ERROR") continue;
             Sentry.captureException(err.originalError ?? err, {
               tags: { operation: args?.operationName ?? "anonymous" },
               extra: { role: args?.contextValue?.auth?.role ?? "anon" },
             });
           }
         },
       };
     },
   };
   ```
   Wire `sentryErrorPlugin` into the Yoga `plugins` array in
   [server/src/index.ts](../server/src/index.ts). *(Adjust the shapes to the installed Envelop version;
   `@envelop/sentry` is an alternative if you prefer a maintained plugin.)*
4. **Release/env:** ensure the deploy lane exports `SENTRY_DSN` + `SENTRY_ENVIRONMENT` (prod=`production`,
   dev=`development`) into each service's `.env` [OP], and `GIT_SHA` at build [EX/CI].
5. **Temporary debug hook (remove after acceptance):** a guarded route that throws, e.g.
   `app.get("/debug/sentry", () => { throw new Error("MON-2 server smoke"); })` — **only when
   `NODE_ENV !== "production"`**.

**Acceptance (executed):** hitting `/debug/sentry` on a dev run **and** forcing a resolver throw both
appear in the `scdhub-server` project with the right `operation` tag + `role`, tagged with the
environment + release; inspect the event JSON and confirm **no `Authorization`/JWT/cookie** is present.
Remove the debug route. Server gate: `npm run typecheck --workspace=server` + `npm run test --workspace=server` green (jest unchanged — no logic touched).

---

## MON-3 — App capture (web + Android + iOS) + symbolication + feedback  **[EX]** + build steps

**Goal:** JS + native crashes on all three clients captured and **readable** (symbolicated); users can
self-report.

1. **Install:** `cd app && npx expo install @sentry/react-native`.
2. **Init at boot** in [app/App.tsx](../app/App.tsx) — the **GlitchTip-specific** options (sessions off):
   ```ts
   import * as Sentry from "@sentry/react-native";
   Sentry.init({
     dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
     tracesSampleRate: 0.01,
     autoSessionTracking: false,      // REQUIRED — GlitchTip does not support sessions
     environment: process.env.EXPO_PUBLIC_ENV ?? "production",
   });
   // wrap the root so native crashes + the boundary are registered:
   export default Sentry.wrap(App);
   ```
3. **Config plugin + Metro (for source maps / native symbols):**
   - `app.json` / `app.config.*` → add the plugin **`@sentry/react-native/expo`** with the **self-hosted
     url**:
     ```json
     ["@sentry/react-native/expo", { "url": "https://errors.<PROD_DOMAIN>", "organization": "scd", "project": "scdhub-app" }]
     ```
   - `metro.config.js` → wrap with `@sentry/react-native/metro` (`getSentryExpoConfig`).
   - Android build: enable the Sentry React-Native Gradle step (the plugin does this) so **ProGuard
     mapping + source maps upload** at build; provide `android/sentry.properties` (or env) with
     `defaults.url=https://errors.<PROD_DOMAIN>`, `defaults.org=scd`, `defaults.project=scdhub-app`,
     `auth.token=<SENTRY_AUTH_TOKEN>` (**build secret / EAS secret, never committed, never EXPO_PUBLIC**).
4. **Top-level `ErrorBoundary`** (web white-screen + render crashes) — wrap the navigation root. Use
   `Sentry.ErrorBoundary` with a friendly fallback (Bangla-friendly per the app's audience), e.g.:
   ```tsx
   <Sentry.ErrorBoundary fallback={<AppErrorFallback />}>{/* navigation root */}</Sentry.ErrorBoundary>
   ```
   `AppErrorFallback` = a simple "কিছু একটা সমস্যা হয়েছে / Something went wrong" screen with a reload +
   a "Report a problem" action (step 6).
5. **Global urql error capture** — add an error-reporting exchange to
   [app/src/graphql/client.ts](../app/src/graphql/client.ts) so GraphQL/network failures are recorded:
   ```ts
   import { mapExchange } from "urql";
   import * as Sentry from "@sentry/react-native";
   // in exchanges: [cacheExchange, errorReportExchange, fetchExchange]
   const errorReportExchange = mapExchange({
     onError(error) { Sentry.captureException(error); },
   });
   ```
6. **"Report a problem"** — a button available to **any authenticated user** (e.g. on a Settings/Profile
   screen + the error fallback). Capture the current screen + role and send user feedback:
   ```ts
   const id = Sentry.captureMessage("user_feedback");
   Sentry.captureFeedback({ associatedEventId: id, message: userText, /* + screen, role */ });
   ```
7. **Web source-map upload in CI [EX/CI]:** in the web deploy lane (`.github/workflows/deploy-*.yml`),
   after `expo export --platform web`, add:
   ```yaml
   - run: npx sentry-cli sourcemaps upload --url https://errors.<PROD_DOMAIN> \
            --org scd --project scdhub-app --release "$GIT_SHA" dist/
     env: { SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }} }
   ```
8. **Env [OP]:** `EXPO_PUBLIC_SENTRY_DSN=<GT_APP_DSN>` in `app/.env` (web runtime) + the native build env;
   `SENTRY_AUTH_TOKEN` as a CI secret + EAS secret (build-time only).

**Acceptance (executed):** a forced JS crash on **web** (a temp throw button) appears **symbolicated** in
`scdhub-app` with the release; build an **Android APK** (internal dist — the ratified first native target,
D-#252 §10) and force a crash → it appears **symbolicated** with the app version; the "Report a problem"
button produces a feedback event. App gate: `tsc --noEmit` + `expo export --platform web` green; no
server/shared drift (`git diff -- server shared` empty).

---

## MON-4 — Notification-delivery monitoring (the silent-failure path)  **[EX]**

**Goal:** catch delivery failures that **throw no exception** — the product's core is delivery.

1. **Push receipt errors** → GlitchTip. In
   [server/src/modules/platform/services/ExpoPush.ts](../server/src/modules/platform/services/ExpoPush.ts),
   where Expo push **tickets/receipts** are inspected, on an error status capture it (minimal context —
   no message body):
   ```ts
   import { Sentry } from "../../../observability/sentry";
   // on a failed ticket/receipt:
   Sentry.captureMessage("expo_push_delivery_failed", {
     level: "warning",
     tags: { kind: notificationKind },
     extra: { errorCode: receipt?.details?.error, recipientCount },
   });
   ```
   (Today these `DeviceNotRegistered` / receipt errors are dropped silently.)
2. **Ticker watchdog.** In
   [server/src/modules/notifications/services/SchedulerService.ts](../server/src/modules/notifications/services/SchedulerService.ts),
   record a module-level `lastTickAt` updated every tick, and expose a tiny endpoint (e.g. extend
   `/readyz` or add `GET /internal/ticker` → `{ lastTickAt, ageSeconds }`). MON-5's external monitor (or a
   GlitchTip uptime monitor) watches it and **alerts if `ageSeconds > 2 × tickInterval`** (the ticker is
   60s, so alert past ~150s).

**Acceptance (executed):** a simulated bad push token surfaces an `expo_push_delivery_failed` event in
`scdhub-server`; stopping the ticker makes `/internal/ticker` age exceed the threshold and the watchdog
alert fires within its window. Server gate green.

---

## MON-5 — Availability & host monitoring (the self-monitoring + host blind-spots)  **[OP]** + small `scripts/` add

**Goal:** know when the app is **down** or the **VM is failing** — even when GlitchTip itself is down
(it's on the same box, so it can't report its own outage).

1. **External, off-box uptime [OP]** — UptimeRobot (free) or equivalent, alerting to **`<ALERT_EMAIL>`**.
   Create monitors for:
   - `https://scdhub.<PROD_DOMAIN>/healthz` (prod)
   - `https://dev.scdhub.<PROD_DOMAIN>/healthz` (dev)
   - `https://errors.<PROD_DOMAIN>/` (GlitchTip itself)
   - `https://scdhub.<PROD_DOMAIN>/internal/ticker` keyword-monitor for a stale tick (MON-4)
2. **VM disk/RAM alert [OP/VM]** — add `scripts/host-alert.sh` [EX writes it] + a cron [OP installs]:
   ```bash
   #!/usr/bin/env bash
   # scripts/host-alert.sh — warn before disk-full / OOM takes down prod AND GlitchTip together.
   set -euo pipefail
   DISK=$(df --output=pcent / | tail -1 | tr -dc '0-9')
   MEMFREE=$(free | awk '/Mem:/ {printf "%d", $7/$2*100}')   # % available
   ALERT_TO="<ALERT_EMAIL>"
   msg=""
   [ "$DISK" -ge 85 ]   && msg+="DISK ${DISK}% used on $(hostname). "
   [ "$MEMFREE" -le 10 ] && msg+="MEM only ${MEMFREE}% free on $(hostname). "
   [ -n "$msg" ] && echo "$msg" | mail -s "[scdhub] host alert" "$ALERT_TO"   # or msmtp via EMAIL_URL
   ```
   Cron [OP]: `*/15 * * * * /opt/scdhub/prod/scripts/host-alert.sh` (needs a working `mail`/`msmtp`,
   reusing the GlitchTip SMTP). Keep thresholds in sync with disk reality (GlitchTip Postgres + retention
   + nightly dumps all grow on `/`).

**Acceptance (executed):** stopping `scdhub-prod` triggers the UptimeRobot down-email; forcing a low-disk
threshold (temporarily lower the `85` to below current usage) fires the host-alert email; restore the
threshold.

---

## MON-6 — Centralized structured logs (phase 2, OPTIONAL — not launch-blocking)  **[EX]**

**Goal:** debug "it didn't crash but behaved wrong" without SSH-ing to read the journal.
- Add `pino` structured JSON logging on the server (request id + role + operation); ship to a lightweight
  store (Better Stack free tier, or self-hosted Loki) **or** at minimum retain + index the journal.
- **Acceptance:** a request's structured log line is searchable off the VM with request id + role + op.
- **Deferrable** — MON-1..5 are the launch set; do MON-6 only if/when non-crash debugging needs it.

---

## §Final — gate, housekeeping, live-verification debt

- **Repo gate (every code slice):** `git diff -- shared docs/import-contract.schema.json` **empty**
  (vocab/contract untouched) → the verifier need not change and **jest is unaffected**; still run
  `npm run typecheck --workspace=server` + `npm run test --workspace=server` (server slices) and
  `tsc --noEmit` + `expo export --platform web` (app slice) and confirm green.
- **Session-end ritual (AGENTS):** append a `CHANGELOG.md` line per landed slice (with the commit hash);
  update `STATUS.md` "Now / next"; **D-#252/#253 are already in DECISIONS** — add a build-ruling D-#
  (next free, **≥ D-#254**) only if a genuine decision arises.
- **Live-verification debt:** the **[EX]** code can be unit-gated in-repo, but the module is only truly
  "working" once the **[OP]** VM steps (MON-1, MON-5) are done and a real crash from each client shows up
  in GlitchTip. Mark every slice **"not verified live"** until then, per the standing convention.
- **Secrets recap:** nothing sensitive is committed — DSNs/tokens/SMTP/IP/domain live in `.env` (600) +
  Actions/EAS secrets + the operator notes file. The only bundled value is `EXPO_PUBLIC_SENTRY_DSN`
  (a write-only ingest key).

**Build order:** MON-1 [OP] → MON-2 [EX] → MON-3 [EX] → MON-4 [EX] → MON-5 [OP] (MON-6 later).
**Effort:** ~1 day for MON-1..3 (the core), ~½ day MON-4..5.

---
### Sources (for the version-sensitive specifics above)
- GlitchTip install / env vars: <https://glitchtip.com/documentation/install/>
- GlitchTip React-Native SDK (init + `autoSessionTracking:false`): <https://glitchtip.com/sdkdocs/react-native/>
- Sentry + Expo (config plugin `@sentry/react-native/expo`, Metro, source maps): <https://docs.expo.dev/guides/using-sentry/>
