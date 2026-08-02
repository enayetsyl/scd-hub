# Runbook — provisioning the book plane and the first live render

**Status:** LIVE procedure — 2026-08-02
**Owner:** Principal
**Covers:** SB-1..SB-6 are merged to `dev`. This is everything between "the code is deployed" and "a PDF exists".
**Decisions:** D-#404 (book plane), D-#407 (vendored renderer), D-#413/#423 (host), D-#422 (sharp upscale), D-#431–#434.

> **Verified vs untested.** Steps marked ✅ were executed on the VM on 2026-08-02 and their
> output is quoted. Steps marked ⚠️ are written from the code but have **not** been run —
> mongod is not installed and no book exists yet. Treat ⚠️ as "expected to work", not
> "known to work", and read the failure notes beside each.

---

## §0 — What state you are in now

| | |
|---|---|
| Code | SB-1..SB-6 merged to `dev`, auto-deployed |
| Book database | **not provisioned** — the module is inert |
| Chromium 150 (snap) | ✅ installed, `/snap/bin/chromium` |
| `python3-pil` 10.2.0 | ✅ installed |
| `pdffonts`, `soffice` | ✅ already present |
| `book-pipeline/` | vendored in the repo; **deps not installed on the VM** |
| Any book | **none** — the plane is empty |

**The module is safe in this state.** `connectBookDb()` is not called at boot, so every
book resolver answers `বই-প্রোডাকশন ডেটাবেস কনফিগার করা হয়নি` and nothing else in the app
changes behaviour. You can stop after any section below and the app stays healthy.

---

## §1 — Provision the book database ⚠️

The book plane is a **separate MongoDB** (D-#404). Nothing here touches the Atlas
database that holds the real roster.

```bash
ssh -i ~/.ssh/scdhub_vm deploy@<VM>

# MongoDB 8.0 for Ubuntu 24.04 (noble), arm64
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc \
  | sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
echo "deb [ arch=arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" \
  | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
sudo apt-get update && sudo apt-get install -y mongodb-org
```

> **If `noble` 404s**, the arm64 repo for 24.04 may lag. Fall back to the `jammy`
> component — the binaries run fine on noble — or use the distro's `mongodb` package.
> Do not "fix" this by pointing `BOOK_MONGODB_URI` at Atlas: that would put book rows on
> the identity cluster and quietly undo the whole point of D-#404.

**Cap the cache — this is not optional (D-#404).** WiredTiger defaults to half of
(RAM − 1 GB), which on this 23 GB host is ~11 GB claimed for a database holding under
100 MB of JSON, contending with the renderer for memory the VM has no swap to cover.

```bash
sudo tee -a /etc/mongod.conf >/dev/null <<'YAML'
storage:
  wiredTiger:
    engineConfig:
      cacheSizeGB: 1
YAML
sudo systemctl enable --now mongod
```

**Verify:**
```bash
systemctl is-active mongod                      # expect: active
mongosh --quiet --eval 'db.serverStatus().wiredTiger.cache["maximum bytes configured"]'
# expect ~1073741824 (1 GB). A number near 11e9 means the config did not take.
```

**Backups** ride the existing nightly cron (`/opt/scdhub/backup.log`) — add the new
database to it rather than growing a second mechanism.

---

## §2 — Environment ⚠️

Add to **`/opt/scdhub/dev/.env`** first. Do dev before prod; there is no reason for the
first render to happen on the production instance.

```bash
BOOK_MONGODB_URI=mongodb://127.0.0.1:27017/scdhub_books_dev
PUPPETEER_EXECUTABLE_PATH=/snap/bin/chromium
BOOK_WORK_ROOT=/home/deploy/scdhub-book-work
BOOK_PIPELINE_ROOT=/opt/scdhub/dev/book-pipeline
```

**`BOOK_WORK_ROOT` is load-bearing, not tidiness (D-#434).** The snap Chromium has a
**private `/tmp` namespace** and cannot see files this server writes to the host's
`/tmp` — where the renderer would otherwise put the book folder. The page silently
fails to load; you get an empty render or an opaque non-zero exit that never mentions
namespaces. `$HOME` reads fine, verified under `systemd-run` as the `deploy` user.

```bash
sudo mkdir -p /home/deploy/scdhub-book-work
sudo chown deploy:deploy /home/deploy/scdhub-book-work
```

Optional, for SB-6 only:
```bash
BOOK_AUTHOR_MODEL=gemini-flash-latest            # GEMINI_API_KEY is already set
BOOK_AUTHOR_MONTHLY_TOKEN_CEILING=5000000
```

---

## §3 — Install the renderer's own dependencies ⚠️

`book-pipeline/` is **deliberately not an npm workspace** — as one, every CI run would
pull puppeteer and sharp for a package CI never executes. It installs on the render host
only.

```bash
cd /opt/scdhub/dev/book-pipeline && npm install
```

The `.npmrc` there sets `puppeteer_skip_download=true`. That is correct and must stay:
Puppeteer publishes **no linux-arm64 Chromium**, so the download cannot produce anything
launchable — which is why `PUPPETEER_EXECUTABLE_PATH` exists.

**Verify the renderer runs at all**, before involving the app:
```bash
node src/validate-studybook.js /path/to/any/book.json
# expect: "=== study-book validator — <ID> ===" and a RED/GREY count
```

**Then verify Chromium launches under the SERVICE, not just your shell** — snap
confinement behaves differently under systemd, and this is the check that catches it:
```bash
sudo systemd-run --uid=deploy --gid=deploy --setenv=HOME=/home/deploy --wait --pipe --collect \
  /snap/bin/chromium --headless --no-sandbox --disable-gpu \
  --dump-dom "file:///home/deploy/scdhub-book-work/probe.html"
```
(Create `probe.html` with any markup first.) If this prints your markup, the render path
is sound. If it prints nothing, **stop** — nothing downstream will work and the error you
get later will not point here.

---

## §4 — Restart, and confirm the plane is live ⚠️

```bash
sudo systemctl restart scdhub-dev
curl -s https://dev.scdhub.shafayet.me/healthz     # expect {"ok":true}
```

Then, as a Principal login, run any book query. Before §1–§3 it answered
"not configured"; now it should answer with data (an empty list is the correct answer
here — there are no books yet):

```graphql
query { supportBooks { bookId titleBn lessonCount } }
```

---

## §5 — Start the render worker ⚠️

The worker is a **separate process** (D-#407): Chromium is hundreds of MB per render and
a 54-lesson book is minutes of work; an OOM there must not take down attendance.

Manually first, so you can watch it:
```bash
cd /opt/scdhub/dev && npm run worker:book --workspace=server
# expect: [book-worker] <host>-<pid> up
```

Once a render has succeeded, make it a unit (`/etc/systemd/system/scdhub-book-worker-dev.service`):

```ini
[Unit]
Description=SCD Hub book render worker (dev)
After=network-online.target mongod.service

[Service]
User=deploy
WorkingDirectory=/opt/scdhub/dev
EnvironmentFile=/opt/scdhub/dev/.env
ExecStart=/usr/bin/npm run worker:book:prod --workspace=server
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Concurrency is 1 by design** (D-#423) — `claimNextJob` refuses while any job is
RUNNING, so even two worker processes cannot exceed the host's memory budget. Do not
"scale" this by running a second copy; it will simply idle.

`SIGTERM` finishes the current job rather than killing a render mid-PDF, so a deploy
during a build waits rather than corrupting.

---

## §6 — The mutation sequence ⚠️

All of this runs as a **Principal** login, which holds all seven `book:*` grants (D-#424).

### 6.1 Create the book

```graphql
mutation {
  createSupportBook(
    bookId: "C1-BAN", bookType: "SUPPORT_BOOK",
    classLevel: 1, subject: "BAN", titleBn: "আমার বাংলা সহায়িকা — প্রথম শ্রেণি",
    mode: "R", hasTextEn: false
  ) { bookId status lessonCount }
}
```

### 6.2 Load the governance as DATA (D-#403)

Policy lives in the database, never in the repo. Do **all** of these — a thin set is
recorded in the hash and reported, but the model and the letter audit need the real
thing. Bodies come from `SB-Governance/`.

```graphql
mutation { activateSupportBookPolicy(docKey: "README",               body: "…") { hash missing } }
mutation { activateSupportBookPolicy(docKey: "PROJECT_INSTRUCTIONS", body: "…") { hash missing } }
mutation { activateSupportBookPolicy(docKey: "SCHEMA",              body: "…") { hash missing } }
mutation { activateSupportBookPolicy(docKey: "REF1_CURATION",       body: "…") { hash missing } }
mutation { activateSupportBookPolicy(docKey: "REF2_REGISTER",       body: "…") { hash missing } }
mutation { activateSupportBookPolicy(docKey: "ASSEMBLY",            body: "…") { hash missing } }
mutation { activateSupportBookPolicy(docKey: "DECISIONS",           body: "…") { hash missing } }

# Per-book — REQUIRED for a C1/C2 বাংলা book, or the letter audit RED-fails the merge.
mutation {
  activateSupportBookPolicy(
    docKey: "LETTER_INVENTORY", bookId: "C1-BAN",
    body: "<the raw JSON text of letter_inventory_C1-BAN.json>"
  ) { hash missing }
}
```

`missing` should come back **empty**. If it names a key, the set is thin and every hash
stamped from here on records that.

### 6.3 Merge one lesson

Take **one** lesson object from the existing `book.json` and wrap it as a SCHEMA §5
patch. `patchJson` is the envelope as a JSON **string**:

```graphql
mutation {
  submitSupportBookPatch(
    patchJson: "{\"schema_version\":\"1.0\",\"book_id\":\"C1-BAN\",\"patch_id\":\"patch_C1-BAN_L001_v1\",\"task\":\"CONTENT\",\"lessons\":[ … one complete lesson object … ]}"
    source: "DESKTOP_UPLOAD"
  ) {
    merged redCount greyCount lessonNos policyMissing
    findings { check severity message lessonNo blockId unit }
  }
}
```

> **Expect a RED on your first try, and expect it to be right.** The app's gate is
> **stricter than the CLI's**: it adds the five README §6 checks the pipeline never
> implemented (codes, genre, source-note, stripe language, map-derivable) plus the letter
> audit. On the real C1-BAN book the CLI reports RED 0 while the port reports RED 9 —
> one lesson missing codes, three stray `/` in decodable text, five conjuncts at পাঠ the
> inventory's own `open_items` flags as unresolved. Those are content questions for a
> human, which is what the gate is for. `merged: false` means nothing was written.

### 6.4 Upload the compliant images

Not GraphQL — a multipart POST, one per slot. The crop → upscale → strip chain still runs
on your laptop (D-#409); upload the **finished** file.

```bash
curl -X POST https://dev.scdhub.shafayet.me/files/book \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@L001-img-01_school.png" \
  -F "bookId=C1-BAN" -F "lessonNo=1" -F "slotId=L001-img-01" \
  -F "stage=COMPLIANT" -F "generatorTool=ChatGPT"
# → { fileId, assetId, stage, slotId, lessonNo, … }
```

`stage` is one of `APPROVED | CROPPED | UPSCALED | COMPLIANT`. **The renderer only reads
COMPLIANT.** Uploading the intermediate stages is optional and only buys you lineage
history; uploading *just* COMPLIANT is fine for a first render.

The filename must match the slot's `filename` in `book.json` — the renderer resolves
filenames, not slot ids.

Check what is outstanding:
```graphql
query { supportBookSlots(bookId: "C1-BAN", lessonNo: 1) {
  slotId prompt approved cropped upscaled compliant hasStale } }
```

### 6.5 Check the gate before spending Chromium

```graphql
query { supportBookAssemblyGate(bookId: "C1-BAN", lessonNos: [1]) { ok reasons } }
```

`reasons` lists **everything** blocking, not the first thing — stale artifacts by file,
unresolved escalations (an ANSWERED one counts: someone still has to apply the ruling),
an empty scope.

### 6.6 Queue the render

```graphql
mutation {
  queueSupportBookBuild(bookId: "C1-BAN", scope: "LESSON", lessonNos: [1])
  { jobId state profiles }
}
```

Watch it live (SSE; the log is tailed from the database because the worker is a separate
process):

```bash
curl -N -H "Authorization: Bearer $TOKEN" \
  https://dev.scdhub.shafayet.me/book-builds/<jobId>/stream
```

Or poll:
```graphql
query { supportBookBuildJobs(bookId: "C1-BAN", limit: 1) {
  state failureReason outputFileIds log } }
```

A `SUCCEEDED` job carries `outputFileIds`; fetch each with `GET /files/<id>`.

---

## §7 — When it fails, look here first

| Symptom | Cause | Fix |
|---|---|---|
| Every book query says "not configured" | `BOOK_MONGODB_URI` unset or mongod down | §1, §2, restart |
| Worker idles, job stays QUEUED | another job stuck RUNNING | boot requeues after 30 min; or set that row to QUEUED |
| Render fails instantly, log mentions no browser | Puppeteer found no Chromium | `PUPPETEER_EXECUTABLE_PATH` (§2) |
| Render "succeeds" but the PDF is blank / job FAILS with *no readable PDF* | Chromium could not read the work dir | `BOOK_WORK_ROOT` is not under `/home/deploy` (D-#434) |
| Build refuses with stale files | an image was re-approved, downstream never re-run | re-upload the downstream stages, or re-run the strip chain |
| Merge RED on letter audit | text uses a বর্ণ/কারচিহ্ন not yet taught | fix the text — never widen the allowlist |
| Merge RED, `LETTER_INVENTORY` missing | §6.2's per-book upload was skipped | upload it; the audit will not run unaudited |
| Python image tools fail on import | Pillow | ✅ already installed |

---

## §8 — What this runbook does NOT cover

- **Prod.** Do dev first, in full, including a real render.
- **The other 53 lessons and ~200 images.** §6 is one lesson end to end on purpose:
  it exercises every component while the surface area is small enough to debug.
- **The Expo UI.** None of the above has a screen yet; it is all API.
- **SB-7 image generation** — deferred; images stay ChatGPT → upload.
- **The model bake-off** for SB-6 (3–5 real পাঠ through both model families, compared on
  first-emit RED count). Worth doing before anyone relies on the in-app chat, since
  C1-BAN and the governance documents were both produced against Claude.
