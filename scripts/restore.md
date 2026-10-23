# Disaster Recovery — restore from a Drive backup (ADR-011/016, DEP-4)

`scripts/backup.sh` runs `mongodump --archive --gzip` of the prod DB and uploads it to
the school Google Drive: **hourly** to **SCD-Hub-Backups-Hourly** (newest 48 kept), and
**nightly** to **SCD-Hub-Backups** (7 daily / 4 weekly / 3 monthly). See D-#818.
Since 2026-10-23 the database runs on the VM's own mongod (D-#817). To rebuild the
whole VM, follow `docs/runbook-vm-rebuild.md`; this page is the database restore alone. This runbook restores one of those backups. It is
**tested by doing** — the DEP-4 drill restored the latest backup into
`scdhub_dev` and verified the counts (see CHANGELOG).

## Where to run
Run on the **VM** (`/opt/scdhub/prod`). It has `mongorestore`, `node`, the Drive creds in
`/opt/scdhub/prod/.env`, and the Mongo passwords in `/opt/scdhub/mongo-credentials.env`
(also in the break-glass kit). The database only listens on 127.0.0.1, so restore from
the VM itself. On a **fresh** VM, run the rebuild runbook first.

## 1. Download a backup from Drive
```bash
cd /opt/scdhub/prod
node scripts/restore-fetch.mjs latest                       # newest of the hourly + nightly pools
# or a specific one:
node scripts/restore-fetch.mjs scdhub_prod-2026-06-14_022000.archive.gz
# -> writes /tmp/restore.archive.gz
```

## 2. Restore
**CRITICAL:** the `--uri` must be **db-less** (`.../?...`, no `/dbname` path).
A db path is treated like `--db` and silently overrides `--nsFrom/--nsTo`, so the
namespace remap matches nothing and **0 documents restore**.

Restore as the `admin` user (each app user can only write its own database). This URI
is already db-less:
```bash
set -a; . /opt/scdhub/mongo-credentials.env; set +a
URI="mongodb://admin:${MONGO_ADMIN_PASSWORD}@127.0.0.1:27017/?authSource=admin&replicaSet=rs0"
```

**Real disaster recovery** — restore prod back into `scdhub_prod` (same names, no remap):
```bash
mongorestore --uri="$URI" --gzip --archive=/tmp/restore.archive.gz --drop
```

**Drill / refresh a non-prod DB** — restore prod data into `scdhub_dev` (remap):
```bash
mongorestore --uri="$URI" --gzip --archive=/tmp/restore.archive.gz --drop \
  --nsFrom='scdhub_prod.*' --nsTo='scdhub_dev.*'
```

## 3. Verify
```bash
cd /opt/scdhub/prod
U="$URI" node -e "const {MongoClient}=require('mongodb');(async()=>{const c=new MongoClient(process.env.U);await c.connect();const d=c.db('scdhub_prod');console.log('students='+await d.collection('students').countDocuments()+' guardians='+await d.collection('guardians').countDocuments());await c.close();})()"
```
Expect (as of the 2026-06-14 backup): students 91, guardians 129, staff 23,
content 239 (counts grow over time).

## 4. Point the app at the restored DB and restart
```bash
sudo systemctl restart scdhub-prod
curl -fsS http://localhost:4000/readyz   # {"ok":true}
```

## Cleanup
```bash
rm -f /tmp/restore.archive.gz
```
