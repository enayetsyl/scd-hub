# Disaster Recovery — restore from a Drive backup (ADR-011/016, DEP-4)

Nightly `scripts/backup.sh` runs `mongodump --archive --gzip` of the prod DB and
uploads it to the school Google Drive folder **SCD-Hub-Backups** (rotation: 7
daily / 4 weekly / 3 monthly). This runbook restores one of those backups. It is
**tested by doing** — the DEP-4 drill restored the latest backup into
`scdhub_dev` and verified the counts (see CHANGELOG).

## Where to run
Run on the **VM** (`/opt/scdhub/prod`). The VM's IP is permanently on the Atlas
allow-list and it has `mongorestore`, `node`, and the Drive creds in
`/opt/scdhub/prod/.env`. The laptop's IP is dynamic and unreliable for Atlas —
don't restore from it. On a **fresh** VM, first add its IP to the Atlas
allow-list and create `/opt/scdhub/prod/.env`.

## 1. Download a backup from Drive
```bash
cd /opt/scdhub/prod
node scripts/restore-fetch.mjs latest                       # newest backup
# or a specific one:
node scripts/restore-fetch.mjs scdhub_prod-2026-06-14_022000.archive.gz
# -> writes /tmp/restore.archive.gz
```

## 2. Restore
**CRITICAL:** the `--uri` must be **db-less** (`.../?...`, no `/dbname` path).
A db path is treated like `--db` and silently overrides `--nsFrom/--nsTo`, so the
namespace remap matches nothing and **0 documents restore**.

Read the connection from the relevant `.env` and strip the db path, e.g.:
```bash
URI=$(grep -E '^MONGODB_URI=' /opt/scdhub/prod/.env | cut -d= -f2- | sed -E 's#/[A-Za-z0-9_-]+\?#/?#')
```

**Real disaster recovery** — restore prod back into `scdhub_prod` (same names, no remap):
```bash
mongorestore --uri="$URI" --gzip --archive=/tmp/restore.archive.gz --drop
```

**Drill / refresh a non-prod DB** — restore prod data into `scdhub_dev` (remap):
```bash
# URI here = the db-less scdhub_dev connection string
mongorestore --uri="$DEV_URI" --gzip --archive=/tmp/restore.archive.gz --drop \
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
