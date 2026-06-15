# PRD — Monitoring & Error Reporting (MON-1..MON-6)

**Status:** Planned — build contract. No feature code yet.
**Owner:** Principal (SCD) · **Module prefix:** MON · **Plane:** NEW observability/telemetry plane (see §5)
**Source:** the launch-readiness question — *"when users use the app via web/Android/iOS, how will I
know if they hit a problem? is there auto-reporting?"* (answer today: **no** — see §0).
**Traceability:** **proposed D-#252 / D-#253** (this module) · ADR-005 (PII firewall — *untouched*, see §5)
· ADR-010 (Expo: iOS+Android+Web) · ADR-012 (CI gate) · DEP-1..6 (the live VM + CI/CD this plugs into)

> The school's amanah extends to the people *using* the software. If a guardian's app crashes or a
> teacher's screen goes white, we should learn it from the system — not from a complaint days later.
> This module is the eyes: cross-platform crash/error capture, availability, and the silent-failure
> paths a plain error tracker misses.

> **NOT the Classroom Observation (CO) module.** "Observability" here = software telemetry. It shares
> no code, vocab, or permission with CO / `observation:*`.

## §0 — At a glance (read first)
- [ ] **Today there is NO auto-reporting.** Server errors go to `console.error` → the systemd journal
  on the VM ([server/src/index.ts:161](../server/src/index.ts#L161)); app errors surface per-screen via
  `friendlyError`. There is **no `ErrorBoundary`**, **no global urql error handler**
  ([app/src/graphql/client.ts](../app/src/graphql/client.ts)), and **no third-party/self-hosted tracker**.
  You find out a user hit a bug only if they tell you.
- [ ] **The shape:** self-host **GlitchTip** (open-source, Sentry-API-compatible) on the existing Oracle
  VM; wire the standard Sentry SDKs into server (`@sentry/node`) and app (`@sentry/react-native` via
  `sentry-expo`); add the silent-failure coverage (notification delivery, uptime, host) a crash tracker
  alone won't give. Errors **may carry identity** (the owner's scoped decision, §5) — kept on our own
  infra by self-hosting, so nothing leaves the VM.
- [ ] **ADR-005 is NOT touched.** This is a *new, separate* plane (§5). The corpus/analytics firewall
  and its fail-closed test stay exactly as they are. The carve-out is recorded as its own decision,
  not an edit to ADR-005.
- [ ] **No app RBAC change, no shared/vocab change, no wire-contract change.** GlitchTip has its own
  auth; the in-app "Report a problem" is available to any authenticated user. `shared/vocab.ts`, the
  import-envelope schema, `NOTIFICATION_KINDS`, and the verifier are **untouched** → parallel-safe with
  any in-flight feature branch.
- [ ] **New secrets** (DSNs, GlitchTip admin creds) → `.env` (mode 600) + GitHub Actions secrets.
  **Never committed** (§0 hard rule). Concrete host/DSN values live only in the operator's password
  manager + the untracked notes file, like the DEP-1 host/IP/domain.
- [ ] **Executed verification is the only gate (ADR-012 / Hard rules).** Each slice's acceptance =
  *a real error/crash/outage was induced and showed up in the dashboard/alert in this session* — not
  "the SDK is installed."

## §1 — Goal
Give the operator one place to see — across **web, Android, and iOS** — that users are hitting problems,
*without users having to report them*, and to cover the failure modes a crash tracker misses
(notification non-delivery, server downtime, the VM filling up). Concretely:
1. **Crash/error capture** on all three clients + the server, grouped, symbolicated, release-tagged.
2. **Availability** — uptime of prod + dev, watched from **off-box** so a VM outage can't hide itself.
3. **Silent-failure coverage** — Expo-push delivery failures and a stalled notification ticker.
4. **Self-hosted** — PII-bearing error data stays on our infra (the scoped decision, §5).
5. **Guardrails** — secrets never logged, identity-bearing data retention-bounded, dashboard locked.

## §2 — Scope boundary (in MON / not in MON)
| In MON (this module) | NOT in MON (deferred / out) |
|---|---|
| Self-hosted GlitchTip on the VM (systemd + Caddy, the DEP-2 pattern) | Managed Sentry SaaS (rejected for PII residency, §5/D-#253) |
| `@sentry/node` server capture + Yoga/resolver errors + request context | Deep APM / distributed tracing (OpenTelemetry) — GlitchTip tracing is light; defer |
| `@sentry/react-native` (`sentry-expo`) — JS + **native** crashes + ANRs on web/Android/iOS | Session replay (paid-Sentry only) — out |
| React `ErrorBoundary` (web white-screen) + global urql error capture | Full metrics dashboards (Prometheus/Grafana) beyond the disk/RAM alert — defer |
| Release + environment tagging tied to the `dev`/`main` CI/CD flow | Product analytics / RUM funnels — out (and firewall-sensitive) |
| Source-map upload (web) + dSYM/ProGuard symbolication (native) in CI | — |
| **Notification-delivery monitoring** (push receipts + ticker watchdog) — MON-4 | Replacing wa.me / Expo push themselves (that's the Messaging-automation roadmap item) |
| **External uptime backstop + VM disk/RAM alert** — MON-5 | — |
| In-app **"Report a problem"** user feedback → attached to an error event | A full in-app support/ticketing inbox — out |
| Centralized structured logs — MON-6 (phase 2, optional) | Long-term log warehousing / SIEM — out |

## §3 — Architecture (three planes; the firewall stays)
```
OPERATIONAL/IDENTITY plane (ADR-005)      CORPUS/ANALYTICS plane (ADR-005)
  users, guardians, students, …             de-identified events  ← firewall, NO identity path
        │                                         (UNCHANGED by this module)
        │ errors may reference a user
        ▼
TELEMETRY/OBSERVABILITY plane  ← NEW (this module), isolated; identity-bearing; self-hosted; retention-bounded
  GlitchTip (Postgres+Redis) on the VM  ◄── @sentry/node (server)
                                        ◄── @sentry/react-native (app: web/Android/iOS)
                                        ◄── push-receipt errors + ticker watchdog (MON-4)
  off-box uptime monitor  ──pings──►  /healthz /readyz (prod, dev) + GlitchTip itself   (MON-5, NO PII)
  VM disk/RAM threshold alert ─────►  operator (email/Telegram)                          (MON-5)
```
- The telemetry plane is a **third** plane. It is allowed to reference identity (§5); the corpus plane
  still cannot. No code path joins telemetry → corpus.
- GlitchTip rides the **DEP-2 deployment pattern**: a systemd unit + a Caddy vhost (auto-HTTPS), like
  `scdhub-prod`/`scdhub-dev`. Its Postgres is added to (or explicitly excluded from) the nightly
  Drive-backup story (§6).

## §4 — Slices

### MON-1 — GlitchTip self-host + the scoped decision + guardrails (infra)
**Goal:** a running, locked-down, self-hosted error backend on the VM; the carve-out recorded.
- Deploy GlitchTip via its official Docker Compose (web + worker + Postgres + Redis), fronted by a
  Caddy vhost on a dedicated subdomain (auto-HTTPS), bound to localhost upstreams like the app services.
- Create one organization, two **projects** (`scdhub-server`, `scdhub-app`) and two **environments**
  (`production`, `development`) so prod and dev errors separate (matches the deploy split).
- Lock it down: admin account only (no open signup), dashboard reachable only over HTTPS, single-operator
  access. Set **event retention** (default **30 days**, configurable) and a **per-project event quota**
  so a crash loop can't fill the disk.
- Ratify the scoped telemetry decision (§5, D-#252/#253) and add the guardrails (§6).
- **Acceptance (executed):** GlitchTip loads over HTTPS; a manually-sent test event (via `sentry-cli` or
  a curl to the DSN) appears in the `scdhub-server` project; retention + quota are set and shown.

### MON-2 — Server error capture (`@sentry/node`)
**Goal:** every unhandled server failure lands in GlitchTip with useful context.
- Init `@sentry/node` in [server/src/index.ts](../server/src/index.ts) **before** the app wiring; capture
  `uncaughtException` + `unhandledRejection`.
- Capture **GraphQL resolver errors** (a Yoga/Envelop plugin or the Yoga `maskError` hook) — Yoga masks
  errors to clients by default, so this is where the real cause is logged.
- Attach **request context**: caller `role`, GraphQL **operation name**, and the user id (identity
  allowed, §5). **Scrub secrets** (§6) — Authorization header, JWT, any `password`/token field — in
  `beforeSend`, regardless of the PII allowance.
- Tag every event with `release` (git sha) + `environment` (prod/dev).
- **Acceptance (executed):** a deliberately-thrown resolver error and a forced unhandled rejection both
  appear in GlitchTip with role + operation + release, and **no** Authorization/JWT value is present in
  the payload.

### MON-3 — App error capture (web + Android + iOS) + symbolication + feedback
**Goal:** crashes on all three clients are captured and readable; users can self-report.
- Add `sentry-expo` / `@sentry/react-native`; init at app boot; point at the app DSN via
  `EXPO_PUBLIC_SENTRY_DSN` (web reads it at runtime; native bakes it at build, like the existing
  `EXPO_PUBLIC_*` pattern).
- Add a top-level React **`ErrorBoundary`** that catches white-screen render crashes (web especially),
  shows a friendly "something went wrong" screen, and reports the error.
- Add a global **urql error capture** (an exchange) so GraphQL/network failures are recorded, not just
  thrown.
- **Symbolication:** wire **source-map upload** (web) and **dSYM (iOS) / ProGuard mapping (Android)**
  upload into the build so stack traces are readable, not minified — via the `sentry-expo` plugin / EAS
  hooks; in the GitHub Actions deploy flow for web.
- Tag `release` (app version) + `environment`; attach device/OS/app-version (automatic).
- **In-app "Report a problem"**: a button (any authenticated user) that captures the current screen +
  last error + user role and sends a Sentry user-feedback event.
- **Acceptance (executed):** a forced JS crash on **web** and on an **Android APK** (internal dist — the
  ratified first native target; iOS later) appears in GlitchTip with a **symbolicated** stack + app
  version; the "Report a problem" button produces a feedback event.

### MON-4 — Notification-delivery monitoring (the silent-failure path)
**Goal:** catch delivery failures that **throw no exception** — the product's core is delivery.
- Pipe **Expo push ticket/receipt errors** ([ExpoPush.ts](../server/src/modules/platform/services/ExpoPush.ts))
  into GlitchTip — invalid `DeviceNotRegistered` tokens, receipt errors, etc. (today they're silently
  dropped).
- **Ticker watchdog:** alert if the N-2 notification ticker
  ([SchedulerService.ts](../server/src/modules/notifications/services/SchedulerService.ts)) stops ticking
  (a heartbeat the off-box monitor or a GlitchTip cron-monitor checks).
- **Acceptance (executed):** a simulated bad push token surfaces a captured event; stopping the ticker
  triggers the watchdog alert within its window.

### MON-5 — Availability & host monitoring (the blind-spot fixes)
**Goal:** know when the app is **down** or the **VM is failing** — even when GlitchTip itself is down.
- **External, off-box uptime monitor** (UptimeRobot free tier or equivalent) pinging
  [/healthz](../server/src/index.ts#L85) + [/readyz](../server/src/index.ts#L86) for **prod and dev**,
  **and the GlitchTip URL itself** — so a whole-VM outage is reported from outside the box.
- **VM disk/RAM threshold alert** — a cron threshold check (or node-exporter + a single alert rule) that
  warns before disk-full / OOM takes down prod *and* GlitchTip together (GlitchTip's Postgres + retention
  + nightly backups all grow on the same disk).
- Alerts route to the operator by **email** (ratified 2026-06-15).
- **Acceptance (executed):** stopping `scdhub-prod` triggers the external down-alert; a forced low-disk
  threshold triggers the host alert.

### MON-6 — Centralized structured logs (phase 2, optional)
**Goal:** debug "it didn't crash but behaved wrong" without SSH-ing to read the journal.
- Structured JSON logging (`pino`) on the server; ship to a lightweight store (Better Stack free tier or
  self-hosted Loki) **or** at minimum retain + make the journal searchable.
- **Acceptance (executed):** a request's structured log line is searchable off the VM (or in the retained
  journal) with request id + role + operation.
- **Deferrable** — not launch-blocking; MON-1..5 are.

## §5 — The scoped telemetry decision (ADR-005 relationship)
**Proposed D-#252 — A telemetry/observability plane, isolated from the corpus firewall.**
The app gains a **third** data plane for software observability (errors/crashes/feedback). This plane
**MAY carry identity** (user id, and the real values that triggered a bug) **for debugging only**. It is
**isolated from the ADR-005 corpus/analytics firewall**: no code path joins telemetry → corpus, and
ADR-005 + its fail-closed test are **unchanged**. The plane is **access-controlled** (operator-only
dashboard) and **retention-bounded** (§6). *Rationale: error payloads need real context to be actionable;
the owner has approved PII in the error path specifically; keeping it self-hosted (D-#253) means that
identity never leaves our infra.* — **ratify before MON-1.**

**Proposed D-#253 — Self-host (GlitchTip) over managed SaaS for error tracking.**
Because the telemetry plane carries identity (D-#252), the tracker is **self-hosted on our VM** so
children's/guardians' PII never lands on a third party. The **only** external dependency is the **uptime
backstop** (MON-5), which sees **no PII** (it pings health URLs). Managed Sentry SaaS was considered and
rejected on data-residency grounds for a children's school app. *(GlitchTip < full Sentry in features —
no session replay, light tracing — accepted, §2.)* — **ratify before MON-1.**

> Append-only: these are **new** DECISIONS rows (D-#252/#253 — highest current is **D-#251**), **not**
> an edit to ADR-005. Per AGENTS Hard rules, ADR-005 stays as written.

## §6 — Guardrails (operational hygiene; some are non-negotiable)
- **Never send secrets** — even with PII allowed: Authorization headers, JWT, `password`/token fields are
  scrubbed in `beforeSend` on **both** SDKs. (PII-for-debugging ≠ credentials; leaking a token is a
  breach, not a debug aid.)
- **Retention-bounded** — identity-bearing error data auto-purges (default 30 days).
- **Quota** — per-project event quota + client-side rate-limiting / sampling so a crash loop can't flood
  the disk.
- **Dashboard locked** — operator-only; HTTPS-only; no open signup.
- **GlitchTip's own Postgres** — **folded into the nightly Drive backup** (the DEP-4 `backup.sh`/
  `drive-backup.mjs` story; ratified 2026-06-15).
- **Secrets handling** — DSNs + admin creds in `.env` (600) + Actions secrets; never committed (§0).

## §7 — Env / secrets / CI wiring (no values committed)
- **New env:** `SENTRY_DSN` (server), `EXPO_PUBLIC_SENTRY_DSN` (app), GlitchTip admin creds, `SENTRY_AUTH_TOKEN`
  (CI, for source-map/symbol upload). → `.env` + GitHub Actions secrets.
- **CI:** the existing `.github/workflows` deploy lanes gain a **source-map/symbol upload** step (web on
  deploy; native via EAS/`sentry-expo`) and pass `release`=git-sha so events tie to a deploy.
- **DNS/Caddy:** one new subdomain for GlitchTip (operator-managed, like the DEP-1 app subdomains; not
  committed).

## §8 — Verification gates (executed — ADR-012)
Per slice, the acceptance in §4 must print/show green **in-session**: a forced server error appears with
scrubbed secrets; a forced web crash + a forced native crash appear symbolicated; a bad push token is
captured; stopping prod fires the external alert; a low-disk threshold fires the host alert.
Plus the standing repo gate stays green (this module is server-wiring + app + infra; **no** shared/vocab
or contract change, so the vocab **verifier is untouched** and **jest is unaffected** — confirm
`git diff -- shared docs/import-contract.schema.json` is empty).

## §9 — Out / deferred (explicit)
- Managed Sentry SaaS; session replay; deep APM/tracing; product analytics/RUM; full Grafana dashboards;
  WhatsApp-Cloud/bulk-SMS delivery (Messaging-automation roadmap item — MON only *monitors* the existing
  wa.me/Expo-push rails, it doesn't replace them).
- Play Console (Android Vitals) + App Store Connect crash dashboards are **free, zero-setup** complementary
  signals once published (they also catch early-boot native crashes before the SDK initializes) — use
  them, no build work.

## §10 — Confirmations (RESOLVED 2026-06-15)
1. **D-#252 + D-#253 RATIFIED** (the scoped telemetry plane + self-host over SaaS) — owner sign-off given.
2. **GlitchTip subdomain** — suggested **`errors.<prod-host>`** (e.g. `errors.scdhub.<domain>`); operator
   picks the final value and keeps it uncommitted (§0). *Only open operator step before MON-1.*
3. **Retention window — 30 days** (confirmed).
4. **Alert channel — email** (confirmed).
5. **GlitchTip Postgres — folded into the nightly Drive backup** (confirmed; §6).
6. **First native target — Android APK** (internal dist) for the MON-3 native acceptance (confirmed; iOS
   later, needs the Apple program / TestFlight per the roadmap Distribution note).

---
**Build order:** MON-1 → MON-2 → MON-3 → MON-4 → MON-5 (MON-6 later). MON-1 is infra + the decision;
MON-2/3 are the capture core; MON-4/5 close the silent-failure + self-monitoring gaps so the launch
version is *complete*, not crash-only. **Rough effort:** ~1 day for MON-1..3 (the core), ~half a day for
MON-4..5. Nothing is built yet — this is the contract.

> **HOW to build it:** the step-by-step execution runbook (concrete commands, file snippets, code, the
> operator-vs-executor split, and per-slice acceptance gates) is **[docs/observability-runbook.md](observability-runbook.md)** —
> written so a fresh Claude session can build the whole module end-to-end.
