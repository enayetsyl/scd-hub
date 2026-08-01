# PRD — System health (free-tier headroom)

**Slices:** SH-1 (the read + screen), SH-2 (egress snapshots), SH-3 (bands), SH-4 (trend + projection),
SH-5 (scheduler heartbeat), SH-6 (prunable), SH-7 (backup freshness), SH-8 (the Drive ceiling).
**Decisions:** D-#414 (SH-1..3), D-#416 (SH-4..6), D-#425 (SH-7 rewritten, SH-8). **Owner ask (2026-08-01):** *"is it possible to add a part in the principal ui
to see the vs and mongodb status so that he can take step to keep within free tire limit."*

## 1. Why

The school runs on free/cheap infrastructure. Nothing in the app reported how close it was to any
ceiling, so the first symptom of a full database would be **writes failing** — attendance not saving,
a homework record refusing to persist — with no warning and no obvious cause. The Principal is the
person who decides to prune, archive, or start paying, so the numbers belong in their UI.

## 2. The three ceilings, measured before designing

Measured against the live cluster/account on 2026-08-01 (read-only), because which limit actually
binds was an open question:

| Ceiling | Reading | Verdict |
|---|---|---|
| **Atlas M0 — 512 MB, cluster-wide** | 76.2 MB (14.9%) | **The one that binds.** |
| **Google Drive** | **51.57 GB of 100 GB (51.6%)** — see SH-8 | Second-tightest. The first reading here (1.3% of a pooled quota) was WRONG; corrected in D-#425. |
| **VM disk / RAM / egress** | host-dependent | Worth watching; egress needs snapshots. |

Two findings shaped the build:

- **The Atlas cap is per CLUSTER, not per database**, and the cluster carries `scdhub_prod` (41.7 MB)
  **plus** `scdhub_local` (18.2 MB) and `scdhub_dev` (16.4 MB). The test copies consume ~45% of
  current usage — i.e. production's headroom. A per-database panel would have hidden that entirely,
  so the read is cluster-wide and lists every database.
- **Uploaded bytes are not in the database.** `StoredFile` holds only a handle; the bytes live in
  Drive (D-#70). So file growth does *not* threaten the 512 MB — which is why Drive is reported
  separately rather than folded into one "storage" number.

## 3. Acceptance criteria

- **SH1.1** A Principal-only screen shows three cards — Database, Server, Drive — each with
  used / limit, a percentage, and a bar.
- **SH1.2** Gated on **`audit:read`** (Principal-only in the role map). **No new permission**: a new
  one would mean the two-place contract sync for a read-only panel, and D-#281 set the precedent of
  reusing an existing gate.
- **SH1.3** The Database card lists **every database on the cluster** with the current one marked,
  and the **top 10 collections** of the current database, so the lever is visible — "notifications is
  17,786 rows" is what turns a number into an action.
- **SH1.4** The Atlas limit is a **documented constant** (`ATLAS_M0_LIMIT_BYTES`, overridable by
  `ATLAS_STORAGE_LIMIT_MB`). No command reports a cluster's plan limit, so this is honest config
  rather than a silently drifting bar.
- **SH1.5** If the DB user cannot `listDatabases`, the panel says **"this database only — real usage
  is higher"** instead of presenting a partial total as complete.
- **SH2.1** One `NetSnapshot` row per day holds the VM's cumulative `/proc/net/dev` counters,
  captured by the existing notification ticker (no new scheduler, per D-#73), **above the school-day
  gate** — traffic does not stop on a holiday — and idempotent on the date key.
- **SH2.2** Month-to-date egress is the **sum of day-to-day deltas**, never the raw counter. A
  reading lower than the previous day is a **reboot**: that day contributes its raw counter and the
  month is flagged **partial**, because the traffic between the last snapshot and the reboot is
  unrecoverable. One snapshot yields **null**, not zero — a single reading cannot be a delta.
- **SH2.3** Off Linux (`/proc` absent) the capture is a **no-op**, not an error.
- **SH3.1** Bands: **amber at 70%**, **red at 85%** — early enough that pruning is a choice rather
  than an emergency. A missing or zero limit yields **unknown**, never a false all-clear.
- **SH3.2** Every section carries its **own error** and the query still answers. One dead probe must
  never hide the two numbers that were fine.
- **SH3.3** Drive is a network hop, so its answer is **cached for 5 minutes** — refreshing the panel
  must not hammer Google or make the two local probes wait.

### SH-4 — Trend + projection *(**D-#416**, owner ask: charts, and earlier data)*
- **SH4.1** A daily `HealthSnapshot` row of point-in-time GAUGES (storage per database, tracked
  collections, disk, Drive, process RSS). Kept SEPARATE from `NetSnapshot`, which holds cumulative
  COUNTERS: the two need opposite arithmetic, and one row holding both invites reading a gauge as a
  delta.
- **SH4.2** History from before the feature shipped is **reconstructed from document creation times**,
  so the chart is not empty on day one. Counts are **exact** (every document carries `_id`); **bytes
  are not recoverable**, so a backfilled day is `count × today's bytes-per-document` and the row is
  flagged `estimated`. The app draws those bars in muted ink **and** says so in words — the
  distinction never rests on colour alone.
- **SH4.3** A backfilled day adds a **constant baseline** for what the walk cannot see (the other
  databases, this database's untracked tail). Without it the series changes units mid-chart:
  reconstructed days sum ~9 MB of one database while measured days report the ~76 MB cluster total
  that the cap counts, producing an eight-fold cliff on the day of the deploy and a projection fitted
  across two different quantities. Caught by running the real service against the dev database — not
  by review.
- **SH4.4** The projection is a least-squares fit that **refuses to guess**: fewer than three points is
  not a trend; a flat or shrinking series has no crossing date; already past the limit reports zero
  days, never a negative. Null values are gaps, never zeroes.
- **SH4.5** The chart scales to the DATA, not to the cap. At 15% of the limit, scaling to the limit
  would flatten every movement into one line along the bottom.

### SH-5 — The scheduler heartbeat *(**D-#416**)*
- **SH5.1** The panel shows when the notification ticker last ran — amber past 150s, red past 600s
  (2.5× and 10× the 60s interval: one skipped pass is noise, ten minutes of silence is a stopped
  scheduler). A stall silently stops homework auto-DUE/auto-ISSUE, attendance reminders, class-note
  prompts, library sweeps and every escalation, so the consequence is named **in words**, not left to
  the colour of a chip.
- **SH5.2** The heartbeat moved to its own leaf module. The health service reports it, and the
  scheduler imports the health service for its snapshots; keeping the state in `SchedulerService`
  would close a require cycle that TypeScript compiles happily and Node can resolve to `undefined` at
  runtime depending on load order.

### SH-6 — Prunable estimates *(**D-#416**)*
- **SH6.1** Per collection: "N records older than X days ≈ Y MB reclaimable", from an **allowlist**.
- **SH6.2** `audits` is excluded **by rule** — ADR-008 makes it append-only, and a "reclaim 300 KB"
  suggestion against it would be an invitation to break that. School records (homework, assignments,
  attendance, reports) are excluded because they are the product, not exhaust. A test pins both.
- **SH6.3** **Report only.** Nothing in the app deletes. The panel makes the case; a person decides.

### SH-7 — Backup freshness *(**D-#425**, superseding D-#416's version)*
- **SH7.1** The panel **WATCHES the school's existing nightly backup**; it does not take one.
  `scripts/backup.sh` has run from cron since 2026-06-30 (ADR-011) — `mongodump --archive --gzip` of
  prod into the Drive folder `SCD-Hub-Backups`, with a tested restore runbook (`scripts/restore.md`,
  DEP-4 drill). D-#416 built a second, competing job on the false premise that no backup existed;
  that job is **deleted**, not merely disabled.
- **SH7.2** The band comes from the **newest archive's age alone** — amber at 2 days, red at 3, for a
  nightly job. It must **never** be derived from the spacing between files: `drive-backup.mjs` rotates
  grandfather-father-son (7 daily / 4 weekly / 3 monthly), so older archives legitimately thin out and
  a spacing check would cry wolf every week. *(This is exactly the misreading the owner caught: the
  folder looks weekly before the last 7 days, and nothing is wrong.)*
- **SH7.3** A **missing folder** and an **empty folder** are both red — either way there is no restore
  point. The folder is never auto-created: a missing one is a finding, and conjuring an empty one
  would hide it.
- **SH7.4** An **unreachable Drive is "unknown", never "no backups"** — reporting a disaster because a
  network call failed would send someone hunting a problem that is not happening.
- **SH7.5** Read-only: it lists and reports, never writes, uploads or deletes. A monitor that could
  delete its own subject is not a monitor.
- **SH7.6** The listing is cached for 5 minutes but the **age is recomputed on every read** — the
  folder changes once a day, while "how old is it" changes continuously, and a cached age would keep
  claiming last night's backup indefinitely.

### SH-8 — The Drive ceiling is configuration, not Google's number *(**D-#425**)*
- **SH8.1** The card shows **`usageInDrive`** against a **configured** limit (`DRIVE_LIMIT_GB`,
  default 100 GB) — the pair the account's own Drive page shows, and therefore the pair a person can
  check. The API's `usage` (all Google services) and `limit` (a 100 TiB pooled sentinel) are **not**
  usable here: taken together they rendered the card as **1.3% "Healthy"** when the real position was
  **51.6% of 100 GB**. A headroom panel that understates a ceiling by 40× has inverted its own job.
- **SH8.2** `usageInDriveTrash` is shown **separately as reclaimable** — trash still counts against the
  quota until the bin is emptied (11.61 GB of it live, ~a fifth of usage).

## 4. Out of scope

- **Acting from the panel** — no prune/delete button. Deleting school data from a dashboard is a
  different decision with different safety requirements; this slice reports.
- **Atlas's non-storage M0 limits** (connection cap, throttling) — not visible to the driver, so the
  panel cannot honestly show them.
- **Alerting.** The Principal sees this when they open it; a push notification at 85% is a later
  slice if the owner wants one.
- **Per-day history / growth forecast.** The snapshots make it possible later; this slice shows
  present state only.

## 5. Privacy

Counters only — no student, guardian, or user document is read, so no path is opened across the
ADR-005 identity firewall. The payload deliberately excludes the connection string, any credential,
and the storing Google account's address.
