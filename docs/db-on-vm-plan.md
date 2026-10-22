# Plan — Production MongoDB moves from Atlas M0 to the VM

Status: **DRAFT, 2026-10-22**. Owner approves the open questions (§9), then the phases run in order.
Decision row: **D-#817** (to be appended when the cutover is scheduled).

## 1. Why

- Atlas M0 is capped at **512 MB of dataSize + indexSize across the whole cluster**. This is a hard cap:
  writes fail with error 8000 once it's exceeded. Measured 2026-10-22: **~453 MB** (prod 393, local 32,
  dev 27.5). Growth is ~30–40 MB/month, and one bulk question import would fill it.
  PR #1138 (D-#815/#816) buys months, not a fix.
- The VM is **already the single point of failure for availability**: app, Caddy, GlitchTip, the
  book plane's `mongod` and the book worker all run on it. Atlas protects only the data. Moving the DB
  changes the **data-loss window (RPO)** and the **recovery time (RTO)**, not uptime.
- On the VM: no size cap (77 GB free disk), localhost latency instead of a round trip to Atlas, no
  M0 throttling, no cost (Oracle Pay-As-You-Go, inside the Always Free allowance).

**Targets:** RPO ≤ 1 hour (hourly off-site backup). RTO ≤ 2 hours (scripted rebuild, drilled once).

## 2. Facts this plan rests on (checked 2026-10-22)

| Item | Value |
|---|---|
| VM | Oracle A1 ARM, 4 OCPU, 24 GB RAM, 96 GB disk (77 GB free), Ubuntu 24.04, load ~0.1 |
| Account | Pay-As-You-Go (owner; no idle-reclaim) |
| Local `mongod` | 8.0.28, systemd `mongod`, `127.0.0.1:27017`, **no auth, no replica set, WiredTiger cache 1 GB**; holds `scdhub_books_prod` |
| Atlas | 8.0.34 (same major; dump/restore is safe) |
| Transactions / change streams in the app | **none** (`startSession` is not used), so a standalone `mongod` works. The replica set is for hardening, not a requirement. |
| Current backup | `scripts/backup.sh`, cron 02:30 daily: `mongodump` prod → Drive `SCD-Hub-Backups`, rotation 7 daily / 4 weekly / 3 monthly. Prod dump = **55 MB gz in 16 s**. GlitchTip Postgres + book plane also dumped nightly (non-fatal). |
| Backup monitor | `BackupService` (SH-7) bands newest-archive age in **days** |
| Host alert | `scripts/host-alert.sh` exists (disk/RAM → email) but is **not in crontab** |
| Deploy | GitHub Actions secrets `VM_HOST`, `VM_USER`, `VM_SSH_KEY`; `scripts/deploy.sh` |
| Services | `scdhub-prod` (4000), `scdhub-dev` (4001), `scdhub-book-worker-prod`, `caddy`, `mongod`, `docker` (GlitchTip) |
| Not in the repo | systemd unit files, `/etc/caddy/Caddyfile`, `/etc/mongod.conf`, GlitchTip `compose.yml` |
| Not backed up | book pipeline working files on disk (`BOOK_WORK_ROOT`, `BOOK_PIPELINE_ROOT`) |

## 3. Phase 0 — Preconditions (owner)

- [x] 0.1 Oracle account is Pay-As-You-Go.
- [ ] 0.2 **Secrets vault off the VM** (password manager). Store each item below, then tick:
  - prod `.env`: all 18 keys, including `MONGODB_URI`, `JWT_SECRET`, `GOOGLE_OAUTH_*`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`,
    `WEB_PUSH_VAPID_*`, `GEMINI_API_KEY`, `SENTRY_DSN`, `BOOK_MONGODB_URI`
  - dev `.env`: its own `JWT_SECRET` + the same Google/VAPID keys
  - `/etc/caddy/certs/origin.pem`, `origin.key`, `cf-origin-pull-ca.pem` (the pull CA expires 2029-11-01)
  - GlitchTip: `/opt/glitchtip/compose.yml` + `admin-credentials.txt`
  - the new Mongo user passwords from Phase 1
  - logins: Oracle, Cloudflare, GitHub, the Google account that owns Drive, Expo
  - the deploy SSH key `scdhub-deploy-2026` (already on the laptop; keep a second copy in the vault)
- [ ] 0.3 Merge PR #1138 and run the snapshot backfill (`APPLY=1`). This is optional, but it makes every
  hourly dump ~30% smaller.

## 4. Phase 1 — Harden the VM `mongod` (Claude, auto mode OFF)

Done **before** any prod data lands there. The book plane gets a short (~1 minute) blip.

1. Back up `/etc/mongod.conf` and dump `scdhub_books_prod` to `/opt/scdhub/backups/`.
2. **Users** (created while auth is still off):
   - `admin` (`root`)
   - `scdhub_prod` (readWrite `scdhub_prod`)
   - `scdhub_dev` (readWrite `scdhub_dev`)
   - `scdhub_books` (readWrite `scdhub_books_prod`)
   - `scdhub_backup` (`backup` + `restore` roles)
3. Write `BOOK_MONGODB_URI` with the `scdhub_books` credentials into prod `.env` (still works while auth is off).
4. `mongod.conf`:
   - `security.authorization: enabled` + `security.keyFile` (generated with `openssl rand -base64 756`,
     owned by `mongodb`, mode 400). A replica set with auth requires a keyFile.
   - `replication.replSetName: rs0`
   - `wiredTiger.engineConfig.cacheSizeGB: 6` (24 GB RAM; leaves room for node ×2, the book worker's
     Chromium, and GlitchTip)
   - keep `bindIp: 127.0.0.1`
5. Restart `mongod` → `rs.initiate({_id:"rs0", members:[{_id:0, host:"127.0.0.1:27017"}]})`.
   Then restart the book worker and `scdhub-prod`, and check that a book page loads.
6. Commit the sanitised `mongod.conf` (no secrets) to `ops/mongod.conf`, so a rebuild uses the same file.

URI shape: `mongodb://<user>:<pass>@127.0.0.1:27017/<db>?replicaSet=rs0&authSource=admin`.

## 5. Phase 2 — Hourly off-site backups + alerts (Claude, code PR + VM)

1. **`scripts/backup.sh` gains a mode.** With no argument it is the existing nightly run.
   `backup.sh hourly`:
   - dumps prod only
   - uploads to the Drive folder `SCD-Hub-Backups-Hourly`
   - keeps the newest **48** (2 days)
   - also keeps the last 3 locally in `/opt/scdhub/backups/hourly/` for fast rollback
   - the source URI comes from a new `.env` key `BACKUP_MONGODB_URI` (the `scdhub_backup` user), so
     backups keep working when `MONGODB_URI` changes at cutover
2. **`scripts/drive-backup.mjs`:** a `--keep-newest N` rotation for the hourly pool. The daily
   grandfather-father-son pool is unchanged.
3. **Cron:** `5 * * * * backup.sh hourly`. The nightly 02:30 run stays as it is. Drive cost: ~55 MB × 48
   ≈ 2.6 GB.
4. **Monitor (SH-7):** a second card for the hourly folder. Warn when the newest is older than **2 h**,
   critical when older than **6 h**. The daily card is unchanged.
5. **Alert on failure:** `backup.sh` sends an email on any failed run, using the same `mail` path as
   `host-alert.sh`, which also goes into cron (`*/15`).
6. **Restore check:** a weekly cron restores the newest hourly dump into a throwaway `scdhub_restorecheck`
   database, compares per-collection counts with prod (±1 hour of writes), drops it, and logs the result.
   A backup that is never restored is not a backup.

Gate: the PR's Jest + typecheck. Then on the VM: run one manual `backup.sh hourly`, confirm the Drive
upload, confirm the card shows "ok", and force a failure (bad URI) to confirm the alert email arrives.

## 6. Phase 3 — Rebuild runbook + one drill (Claude writes, owner and Claude drill)

**Deliverables (repo):**
- `docs/runbook-vm-rebuild.md`
- `scripts/vm-bootstrap.sh` (idempotent)
- `ops/` holding:
  - the systemd units
  - the Caddyfile
  - `mongod.conf`
  - GlitchTip `compose.yml`
  - `.env.example`

All are sanitised: secrets stay in the vault, and **no IP addresses are committed** (deployment §0).

**Runbook steps** (target: under 2 hours, with timings written down during the drill):

1. Provision an Ubuntu 24.04 ARM VM (Oracle A1, or any provider), add the deploy user and key, and
   open 80/443 (Oracle iptables).
2. `vm-bootstrap.sh`: Node 20, `mongodb-org` 8.0 + database-tools, Caddy, Docker, Chromium (book worker), Python3 +
   jsonschema; install the units from `ops/`.
3. Secrets from the vault → `.env` files (mode 600), Caddy certs, `mongod` keyFile.
4. `mongod`: config from `ops/`, users, `rs.initiate`.
5. Data: `node scripts/restore-fetch.mjs latest-hourly` (new: newest of the hourly pool, falling back to
   the daily pool) → `mongorestore --drop`. Then the book plane and GlitchTip from their nightly pools.
6. Clone the repo into `/opt/scdhub/prod` (main) and `/opt/scdhub/dev` (dev), then run `deploy.sh` for each.
7. Cloudflare: change the A record to the new IP (proxied, so it takes effect in seconds). Update the GitHub
   secret `VM_HOST`.
8. Verify:
   - `/healthz` and `/readyz` respond
   - a staff login and a guardian login work
   - today's attendance is visible
   - the Drive upload of a manual backup succeeds
   - cron is installed
9. Book pipeline working files are **lost** in a rebuild (not backed up). See §9 Q4.

**Drill:** once, on a temporary VM, end to end, stopping before the Cloudflare switch. The drill
restores into the temporary VM, never prod. Record the actual RTO in the runbook.

## 7. Phase 4 — Cutover (owner picks the night; Claude runs it, auto mode OFF)

**Rehearsal first: move `dev` on an earlier day using the same procedure.** It is the low-risk dry run,
and it also frees ~28 MB on Atlas.

**T-1 day:**
- Announce ~15 minutes of downtime.
- No bulk imports after this point.
- Restore the latest Atlas dump into `scdhub_prod_rehearsal` on the VM to time it and compare counts, then drop it.

**Cutover night:**
1. `systemctl stop scdhub-prod` (this also stops the scheduler). The dev site and book plane stay up.
2. Final `mongodump` from Atlas (~20 s) → `/opt/scdhub/backups/cutover-<stamp>/` + Drive.
3. `mongorestore` into local `scdhub_prod` → compare **every collection's document and index counts**
   with Atlas. Any difference: stop and roll back (step R).
4. Back up prod `.env`, switch `MONGODB_URI` to the local URI, then `systemctl start scdhub-prod`.
5. Verify: `/readyz`, staff and guardian login, a known student's attendance and homework, the System Health
   panel, a manual `backup.sh hourly`.
6. Re-open. Total downtime target: **≤ 15 minutes.**

**Rollback (R):**
- Revert the one `.env` line and restart. Atlas is untouched, so this is instant.
- After re-opening, rollback loses whatever was written on the VM. So the window is **the first
  evening only**. After that, roll forward: fix on the VM, and use the hourly backups if needed.

## 8. Phase 5 — After the cutover

- **System Health (code PR):** the DB card stops presenting an Atlas M0 cap. It shows DB size against the
  VM disk, and the disk card already exists. Retire `ATLAS_M0_LIMIT_BYTES` and keep the env override.
- **Atlas:** keep it untouched for **14 days** as a cold copy, then drop `scdhub_dev`/`scdhub_local`, and decide
  whether to delete the cluster or keep it as an emergency target (§9 Q3).
- **Docs:** `deployment.md` topology, `architecture.md` ADR-011 note, `scripts/restore.md`, and **D-#817**.
- **Optional extra layer:** an Oracle boot-volume backup policy (weekly, keep 4; inside the free 5-backup
  allowance). It restores the whole VM quickly on a disk fault, but it is **not** protection against
  losing the account, which is why the Drive copies stay the primary backup.

## 9. Open questions (owner)

1. **Drill VM:** the free A1 allowance (4 OCPU / 24 GB) is fully used by the current VM. Choose one:
   - a temporary paid A1 VM for ~2 hours (cents on Pay-As-You-Go)
   - a Docker rehearsal on the laptop, which does not test provisioning
2. **Alert channel:** which email address receives backup-failure and disk/RAM alerts? Does the GlitchTip
   SMTP account work for sending?
3. **Atlas after 14 days:** delete the cluster, or keep M0 as an emergency restore target? It stops
   fitting once prod passes ~500 MB.
4. **Book pipeline working files:** add them to the nightly backup (size to be measured), or accept that
   a rebuild loses in-progress book jobs?
5. **Cutover night:** which date? Weekend night, after 22:00 Dhaka?

## 10. Order and owners

| # | Phase | Who | Blocks |
|---|---|---|---|
| 0 | Vault + #1138 | owner (+ Claude for the backfill) | — |
| 1 | Harden `mongod` | Claude (auto mode off) | 0.2 (passwords go to the vault) |
| 2 | Hourly backups + alerts | Claude (PR + VM) | 1, Q2 |
| 3 | Runbook + drill | Claude writes; drill together | 2, Q1 |
| 4a | Dev move (rehearsal) | Claude | 1 |
| 4b | Prod cutover | Claude, owner present | 2, 3, 4a, Q5 |
| 5 | Health card, Atlas, docs | Claude | 4b + 14 days |
