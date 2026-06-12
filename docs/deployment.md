# Deployment Plan — SCD Hub go-live + dev pipeline

**Status:** PLANNED (no slice executed)
**Owner:** Principal (operator) + Claude Code (executor of scripted steps)
**Date:** 2026-06-12
**Traceability:** D-#90–D-#93 · ADR-001/002 (one deployable monolith) · ADR-011/016 (daily
Atlas→Drive backup + restore drill) · ADR-012 (CI gate before deploy) · ADR-005 (PII firewall —
the live DB already holds the real roster) · architecture.md §2 (hosting: Oracle Always Free,
else low-cost VPS — settled; this plan implements it)

---

## 0. Operator checklist (tick in order; each box = one slice gate)

- [ ] **DEP-1** Oracle account + Always-Free VM up; SSH-key-only; ports 22/80/443 only; domain
      A records (`@` and `dev`) point at the VM
- [ ] **DEP-2** Production install green: app served over HTTPS on the domain; server under
      systemd; Atlas allow-list = VM IP only; `/healthz` returns OK
- [ ] **DEP-3** Live golden-path verification executed and recorded (clears the standing
      "not verified live" debt across all built slices)
- [ ] **DEP-4** Nightly backup cron running + **one executed restore drill passed**
- [ ] **DEP-5** `dev` branch + dev environment live (`dev.` subdomain, separate dev DB with
      seed data, never the real roster)
- [ ] **DEP-6** GitHub Actions wired: push→`dev` = test + auto-deploy dev; merge→`main` =
      full gate + auto-deploy production; one end-to-end rehearsal of each lane passed

**Hard rule (repo is public):** the domain name, VM IP, Atlas URIs, JWT secret, SSH keys, and
any tokens appear ONLY in the VM's `.env` files, GitHub Actions **encrypted secrets**, and the
operator's password manager. Never in this doc, STATUS, CHANGELOG, workflow YAML in plaintext,
or any commit. `.env.example` documents variable NAMES only.

---

## 1. Goal

Take the built monolith (server + Expo web export; Atlas M0 already live with the real roster)
from "runs on the developer's machine, never verified live" to: a production deployment on the
school's HTTPS domain, a parallel dev environment on a `dev` branch for testing before release,
an automated GitHub Actions pipeline for both, nightly backups with a tested restore, and a
recorded live verification — so staff can rely on it daily.

## 2. Gap table

| # | Current state (STATUS 2026-06-11 + session facts) | Gap to target |
|---|---|---|
| G1 | No hosting account exists | Oracle account + VM (DEP-1) |
| G2 | Domain owned, unpointed | DNS `@` + `dev` records, TLS (DEP-1/2) |
| G3 | Server runs only via `npm run dev:server` (tsx watch) | Production build + systemd unit, restart on crash/boot (DEP-2) |
| G4 | Expo web bundle compiles green, never served | Static export served same-origin by the reverse proxy (DEP-2) |
| G5 | `/pdf` routes lack CORS (Slice-4 follow-up) | Dissolved by same-origin serving — follow-up closes, no code change (DEP-2) |
| G6 | Atlas network access from dev setup (likely open) | Allow-list = VM IP only (DEP-2) |
| G7 | Every recent slice "not verified live" | One scripted live golden-path session (DEP-3) |
| G8 | ADR-011/016 backup + restore drill designed, never run | Cron export→Drive + rotation + executed restore drill (DEP-4) |
| G9 | Single `main` branch; no test environment | `dev` branch + dev instance + dev DB (DEP-5) |
| G10 | All verification manual on the dev machine | GitHub Actions CI/CD for both lanes (DEP-6) |
| G11 | NativeWind transform disabled (Windows, no watchman) | CI runs on Linux — re-enable becomes possible there (DEP-6, optional sub-step) |

## 3. Topology (D-#90)

One Oracle Always-Free VM (Ubuntu, ARM Ampere shape) runs everything server-side:

```
                  ┌──────────────── Oracle VM ────────────────┐
yourdomain  ──►   │ Caddy (auto-HTTPS, reverse proxy)         │
dev.yourdomain ─► │  ├─ / → prod web export   (static files)  │
                  │  ├─ /graphql,/pdf,/healthz → prod server  │──► Atlas M0 (prod DB)
                  │  └─ dev.* → dev web + dev server          │──► Atlas (separate dev DB)
                  │ systemd: scdhub-prod.service              │
                  │          scdhub-dev.service               │
                  │ cron: nightly Atlas→Drive backup (prod)   │
                  └───────────────────────────────────────────┘
```

- **Caddy** chosen for automatic TLS issuance/renewal (zero-touch certificates for a solo
  operator). Nginx is the fallback if Caddy misbehaves on the ARM shape.
- **Same-origin serving** (web app and API behind one domain) is what dissolves G5/CORS.
- The Python import harness and the backup cron run natively on the VM — full parity between
  dev and prod (this is why the backend-dev is NOT on Vercel; serverless has no Python
  child_process or cron). Frontend-dev MAY additionally deploy to Vercel later; optional,
  not a gate.
- Native iOS/Android builds remain out of scope (§7); web is the delivery surface.

## 4. Slices

### DEP-1 — Account, VM, DNS (operator-heavy; Claude Code supplies exact commands)
1. Create the Oracle Cloud account (identity card check; Always-Free tier — no charge).
2. Provision one Always-Free VM (Ampere A1, Ubuntu LTS), download the SSH key pair.
3. Lock ingress: security list allows 22 (SSH), 80, 443 only. SSH password auth disabled.
4. OS hardening baseline: `ufw` mirror of the same three ports, unattended-upgrades on,
   a non-root deploy user with sudo.
5. DNS at the registrar: A record `@` → VM public IP; A record `dev` → same IP.
6. **Gate:** `ssh deploy@<vm>` works by key; `ping yourdomain` resolves to the VM.

### DEP-2 — Production install
1. Install Node LTS (ARM build), Python 3, git, Caddy.
2. Clone the repo to `/opt/scdhub/prod`, checkout `main`.
3. Create `/opt/scdhub/prod/.env` from `.env.example` (prod Atlas URI, JWT secret, port).
   File mode 600, owned by the deploy user.
4. Build: shared workspace → server typecheck → `expo export --platform web` → static
   output to the Caddy-served directory.
5. systemd unit `scdhub-prod.service`: runs the server, `Restart=always`, starts on boot.
6. Caddyfile: domain → static web root + reverse-proxy `/graphql`, `/pdf`, `/healthz`,
   `/readyz` to the prod server port. Caddy obtains TLS automatically.
7. Atlas: network access list reduced to the VM's public IP (delete any 0.0.0.0/0 entry).
8. Write `scripts/deploy.sh` (idempotent: pull → install → build → restart → health check)
   and `scripts/rollback.sh` (checkout previous ref → build → restart). These two scripts
   are ALSO what GitHub Actions invokes in DEP-6 — one procedure, two callers.
9. **Gate:** over HTTPS on the real domain — login works, `/healthz` OK, a PDF renders
   (NotoSansBengali present), import harness invocable (`validate_import.py` runs).

### DEP-3 — Live golden-path verification (clears the "not verified live" debt)
One scripted session against production, real logins, recorded as a checklist in the session
log: staff login → content tree + plan view + PDF → question bank filter + basket → assemble
HW/AS/CT set → tracker open/entry/summary + wa.me link → homework declare→reconcile→check →
plan-review round → routine views + cover assign → admin import (one envelope through the
gate). Any failure = file the bug, fix rides the normal lane; DEP-3 re-runs until clean.
**Gate:** every journey ticked in one session against the live domain.

### DEP-4 — Backup + restore drill (implements ADR-011/016)
1. Backup script: `mongodump` (or collection-level JSON export per ADR-016) → compress →
   upload to the school Drive backup folder; rotation 7 daily / 4 weekly / 3 monthly.
2. Cron on the VM, nightly, off-peak; failure writes to a log the operator checks weekly.
3. **Restore drill (mandatory, once):** restore the latest backup into the DEV database,
   point the dev instance at it, log in, see real-shaped data. Document the exact restore
   commands in `scripts/restore.md` as written-by-doing.
4. **Gate:** one green drill. An untested backup is not a backup.

### DEP-5 — `dev` branch + dev environment (D-#91, D-#92)
1. Create branch `dev` from `main`; protect `main` (PRs only, no force-push).
2. **Branch rules (D-#91):** feature/fix code → `dev`; `dev → main` merge happens only after
   dev-environment testing, triggered deliberately by the Principal. **Docs/planning commits
   (STATUS, DECISIONS, CHANGELOG, /docs) go straight to `main`** — they deploy nothing and
   the live cursor must stay live. Handoff prompts for feature work now say "push to dev".
3. Clone to `/opt/scdhub/dev`, own `.env` with the **dev Atlas URI** — a separate database
   seeded via the existing `seed.ts` (never the real roster; never the prod URI).
4. `scdhub-dev.service` + Caddy block for `dev.yourdomain` (HTTP basic-auth on the dev
   site, so the half-tested app is not publicly browsable).
5. **Gate:** dev site reachable, logs in against seed data; prod untouched.

### DEP-6 — GitHub Actions automation (D-#93)
1. Repo secrets (encrypted): `VM_HOST`, `VM_SSH_KEY`, `VM_USER`. Nothing in YAML plaintext.
2. Workflow `ci.yml` — on every push/PR to `dev` and `main`: install → shared build →
   typecheck (shared/server/app) → vocab verifier → jest (full suite) → expo web export.
   This is ADR-012 made structural: red CI blocks the lane.
3. Workflow `deploy-dev.yml` — on push to `dev`, after CI green: SSH to the VM, run
   `scripts/deploy.sh dev`.
4. Workflow `deploy-prod.yml` — on push to `main` **when code paths changed** (path filter
   excludes docs-only commits), after CI green: SSH, run `scripts/deploy.sh prod`.
5. Rollback = revert the merge commit on `main`, push; Actions redeploys the prior state.
6. Optional sub-step (G11): attempt NativeWind re-enable in CI's Linux build per the inline
   notes in `app/babel.config.js` / `app/metro.config.js`; if green, it ships — if not, it
   stays disabled with no further time spent.
7. **Gate:** one rehearsal of each lane — a trivial change pushed to `dev` auto-appears on
   the dev site; its merge to `main` auto-appears on production.

## 5. Journeys (Given/When/Then)

- **J-D1 (ship a feature):** Given CI green on `dev`, When the Principal merges `dev → main`,
  Then Actions deploys production within minutes and `/healthz` stays OK.
- **J-D2 (bad release):** Given a fault found on production, When the merge commit is
  reverted and pushed, Then production returns to the prior state in one cycle.
- **J-D3 (disaster):** Given the VM or DB is lost, When the operator follows
  `scripts/restore.md` on a fresh VM, Then the app is back with at-most-1-day-old data.
- **J-D4 (secret hygiene):** Given the repo is public, When anyone reads any committed file
  or workflow log, Then no credential, URI, IP, or domain is recoverable from it.

## 6. Out of scope
Native iOS/Android builds (Expo EAS — later); WhatsApp Cloud API / SMS / push transport
(deferred messaging pipeline); Vercel frontend mirror (optional, post-DEP-6); load/perf
testing beyond M0/Always-Free graceful-degradation posture (architecture §11); staging
beyond the single dev environment; guardian portal exposure.

## 7. Reused / unchanged
The wire contract, vocab, harness, all feature code — untouched (this plan is infra + process).
Hosting choice (architecture §2) implemented, not reopened. ADR-011/016 backup design executed
as specified. The Slice-4 `/pdf` CORS follow-up closes via same-origin serving with no code
change. `seed.ts` reused for the dev DB. `assertCanWrite`/auth stack unchanged — production
adds transport security (TLS, IP allow-list), not new authz.

## 8. Open items (none blocking DEP-1)
- Whether dev-DB seed should include an anonymized routine/groups snapshot for richer testing
  (decide at DEP-5; default = `seed.ts` only).
- Vercel frontend mirror — revisit after DEP-6 if preview deploys per PR become wanted.

> **Pre-flight notes (recorded at commit, live repo wins):**
> 1. **Numbering:** the planning handoff proposed D-#59–D-#62; D-#59–#89 are all taken
>    in the live repo — renumbered to D-#90–D-#93.
> 2. **Stale assumptions vs the live repo:** the "uncommitted AT-4" the handoff expected is
>    long resolved (AT-4 is committed on `feat/attendance-at4`); the guardian portal has since
>    been live-verified against Atlas, so G7's "not verified live" debt now excludes it (the
>    rest of DEP-3's journey list stands). The §3 topology diagram arrived with its box-drawing
>    broken by paste formatting and was restored as a fenced code block — content unchanged.
> 3. D-#91 changes the standing handoff contract: once DEP-5 executes, feature handoffs say
>    "push to dev"; until then feature PRs continue to target `main`.
