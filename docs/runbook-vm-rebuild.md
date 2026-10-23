# Runbook — rebuild SCD Hub on a new VM

**Use this when the VM is gone or unusable**: Oracle reclaimed it, the disk died, or the account
is locked. Target: the app back on a new VM in **about 2 hours**, losing at most the time since
the newest backup (1 hour once prod's database is on the VM; up to ~12 hours before that).

Plan: `docs/db-on-vm-plan.md` (Phase 3). Decision: D-#819. Scripts: `scripts/vm-bootstrap.sh`,
`scripts/restore-fetch.mjs`, `scripts/deploy.sh`, `scripts/vm-drill.sh`. Reference copies of the
VM's config: `ops/` (`mongod.conf`, `systemd/`, `Caddyfile`, `crontab`).

> **What you need before you start** (all in the **break-glass kit**,
> `SCD-break-glass-<date>.7z`, on the USB stick and on Google Drive, password on paper):
> `vm/vm-files.tgz` (both `.env` files, `mongo-credentials.env`, Caddyfile + Cloudflare certs,
> GlitchTip files), `laptop/deploy-ssh-key`, and `LOGINS.txt` (Oracle, Cloudflare, GitHub,
> Google). The repo is public: `https://github.com/enayetsyl/scd-hub`.
>
> Never paste kit contents into chat, email or a screenshot. Copy files with `scp`.

---

## 1. Decide: rebuild, or wait?

- **Oracle shows the VM but it is stopped / unreachable** → try *Reboot* in the Oracle console first
  (5 min). Rebuild only if it does not come back.
- **The VM or the account is gone** → rebuild. Do steps 2–9 in order and write down the time
  of each step in §6.

## 2. Provision a new VM (Oracle console, ~15 min)

1. Log in at `cloud.oracle.com` → Cloud Account Name `enayetflweb` (LOGINS.txt).
2. Compute → Instances → **Create instance**:
   - Image **Canonical Ubuntu 24.04**; shape **VM.Standard.A1.Flex**, 4 OCPU / 24 GB
     (any provider works: 2+ CPU, 8+ GB RAM, 50+ GB disk, Ubuntu 24.04).
   - SSH key: paste `laptop/deploy-ssh-key.pub` from the kit.
   - Boot volume 100 GB.
3. Networking → the subnet's **security list**: allow TCP 22 (anywhere) and TCP 80, 443.
   (The VM's own firewall narrows 80/443 to Cloudflare in step 3.)
4. Note the **public IP**.

> Oracle's Ubuntu images ship `iptables` REJECT rules in `/etc/iptables/rules.v4`. The old VM
> runs **ufw** instead. If ports 80/443 stay closed after step 3, run
> `sudo iptables -L INPUT --line-numbers` and remove the REJECT line
> (`sudo iptables -D INPUT <n>`; then `sudo netfilter-persistent save`).

## 3. Bootstrap the OS (~10 min)

```bash
# from the laptop (the kit's key; first login uses the image's default user "ubuntu")
ssh -i deploy-ssh-key ubuntu@<NEW_IP>
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/enayetsyl/scd-hub.git /opt/scdhub/prod

# the kit's Mongo passwords, so the .env URIs from the kit keep working
#   (scp vm-files.tgz to the VM first, then:)
tar xzf vm-files.tgz -C /tmp/kit
sudo mkdir -p /opt/scdhub && sudo cp /tmp/kit/opt/scdhub/mongo-credentials.env /opt/scdhub/

sudo bash /opt/scdhub/prod/scripts/vm-bootstrap.sh
```

The script installs Node 20, MongoDB 8.0 (+ mongosh, tools), Caddy and Docker. It creates the
`deploy` user (passwordless sudo, SSH keys only), creates the five Mongo users from the kit
passwords, and turns on auth + keyFile + replica set `rs0`. It opens 22 to all and 80/443 to
Cloudflare only, and installs the systemd units and the deploy crontab. Safe to re-run.

Then give `deploy` the key and the checkouts:

```bash
sudo mkdir -p /home/deploy/.ssh && sudo cp ~/.ssh/authorized_keys /home/deploy/.ssh/
sudo chown -R deploy:deploy /home/deploy/.ssh /opt/scdhub
# from now on: ssh -i deploy-ssh-key deploy@<NEW_IP>
cd /opt/scdhub/prod && git checkout main
git clone -b dev https://github.com/enayetsyl/scd-hub.git /opt/scdhub/dev
```

> `ops/mongod.conf` sets a **6 GB** cache. On a VM with less than 16 GB RAM, lower
> `cacheSizeGB` in `/etc/mongod.conf` (≈ 40% of RAM) and `sudo systemctl restart mongod`.

## 4. Secrets from the kit (~10 min)

```bash
cp /tmp/kit/opt/scdhub/prod/.env /opt/scdhub/prod/.env
cp /tmp/kit/opt/scdhub/dev/.env  /opt/scdhub/dev/.env
chmod 600 /opt/scdhub/*/.env
sudo cp /tmp/kit/etc/caddy/Caddyfile /etc/caddy/Caddyfile
sudo cp /tmp/kit/etc/caddy/certs/* /etc/caddy/certs/ && sudo chown -R caddy:caddy /etc/caddy/certs
```

**Check `MONGODB_URI` in both `.env` files:**
- If prod was **already on the VM** (after the Phase 4 cutover), the kit's URIs point at
  `127.0.0.1` and are correct as they are.
- If prod was **still on Atlas**, the choice is yours. Either keep using Atlas (no restore needed,
  skip §5), or move to the new VM's mongod now:
  `MONGODB_URI=mongodb://scdhub_prod:<MONGO_PROD_PASSWORD>@127.0.0.1:27017/scdhub_prod?authSource=admin&replicaSet=rs0`.
  Note that Atlas only accepts allow-listed IPs: add the new IP in Atlas → Network Access, or the
  app cannot reach it.

The app's web build also reads `app/.env` (the Sentry DSN, the env label and the upload token).
Copy it from the old VM's backup or the kit if present; the app runs without it (no web crash
reports).

## 5. Restore the data (~5 min)

```bash
cd /opt/scdhub/prod
node scripts/restore-fetch.mjs latest /tmp/restore.archive.gz     # newest of the hourly + nightly pools
set -a; . /opt/scdhub/mongo-credentials.env; set +a
mongorestore --uri="mongodb://admin:${MONGO_ADMIN_PASSWORD}@127.0.0.1:27017/?authSource=admin&replicaSet=rs0" \
  --archive=/tmp/restore.archive.gz --gzip --drop --nsInclude='scdhub_prod.*'
```

The last line must read `N document(s) restored successfully. 0 document(s) failed to restore.`
GlitchTip (optional): its Postgres dumps are in Drive `SCD-Hub-Backups-GlitchTip`. Bring it up
with `docker compose up -d` in `/opt/glitchtip` (files from the kit) and restore the newest dump
with `pg_restore`/`psql`.

## 6. Build + start (~10 min)

```bash
bash /opt/scdhub/prod/scripts/deploy.sh prod      # build shared+server+web, restart, wait for /readyz
bash /opt/scdhub/prod/scripts/deploy.sh dev
sudo -u caddy caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

## 7. Point the world at the new VM (~5 min)

1. **Cloudflare** (LOGINS.txt) → `shafayet.me` → DNS: change the **A** records `scdhub`,
   `scdhub-dev` and `scdhub-errors` to `<NEW_IP>`. Leave them **proxied** (orange cloud). Because
   traffic goes through Cloudflare, the switch takes effect in seconds.
2. **GitHub** → repo → Settings → Secrets → Actions: set `VM_HOST` to `<NEW_IP>`, so deploys
   reach the new VM. `VM_USER` stays `deploy`, and `VM_SSH_KEY` stays the kit key.
3. **Atlas** (only if still used): Network Access → add `<NEW_IP>`.

## 8. Verify (~10 min)

- [ ] `https://scdhub.shafayet.me/healthz` → 200
- [ ] Staff login and guardian login work; today's attendance is visible
- [ ] A class note opens; a PDF downloads (`/pdf…`)
- [ ] System Health: database, disk and both backup cards look right
- [ ] `bash scripts/backup.sh hourly` (only runs at 14:00 while the DB is on Atlas; on the VM it runs
      at once). Then `tail /opt/scdhub/backup.log` shows `done`.
- [ ] `crontab -l` (as deploy) lists the four backup/alert lines
- [ ] Phones: the app reaches the server (it uses the domain, so nothing to change)

## 9. Afterwards

- Rerun the kit (`make-kit.ps1`) — the VM IP and any regenerated passwords changed.
- Note what went wrong / took longest in §10 and fix the runbook.

## 10. Timings

Measured by `scripts/vm-drill.sh` (container on the old VM; covers steps 3, 5 and 6) plus
estimates for the console steps:

| Step | Drill | Estimate |
|---|---|---|
| 2 provision (console) | — | 15 min |
| 3 bootstrap | _see §11_ | 10 min |
| 4 secrets | — | 10 min |
| 5 restore | _see §11_ | 5 min |
| 6 build + start | _see §11_ | 10 min |
| 7 DNS + GitHub | — | 5 min |
| 8 verify | — | 10 min |

## 11. Drill log

`scripts/vm-drill.sh [git-ref]` rebuilds everything above **inside a throwaway Ubuntu 24.04
container on the current VM**: the same OS and the same ARM CPU, and no second VM to pay for.
It uses the newest real backup. Its network is cut before the app starts, so the restored
school data cannot send a push, email or Drive call. Run it every few months, and after any
change to the bootstrap or to `deploy.sh`.

| Date | Ref | Result | Total |
|---|---|---|---|
