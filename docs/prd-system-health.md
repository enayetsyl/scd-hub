# PRD — System health (free-tier headroom)

**Slices:** SH-1 (the read + screen), SH-2 (egress snapshots), SH-3 (bands).
**Decision:** D-#414. **Owner ask (2026-08-01):** *"is it possible to add a part in the principal ui
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
| **Google Drive** | 1.33 TB of 100 TB pooled Workspace quota | Not a risk; reported for completeness. |
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
