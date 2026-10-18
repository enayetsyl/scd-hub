# Origin lockdown plan (D-#765 follow-up)

**Status:** planned, not started. Run it as its own session; it needs the Cloudflare
dashboard and the Oracle Cloud console, so the operator must take part.

**Repo is public:** this file uses `<domain>` for the zone and `<vm-ip>` for the server.
The real values live in the operator's notes, never here.

## Why

The VM's own address is public. Two DNS records point straight at it with the Cloudflare
proxy off ("grey cloud"):

- `dev.scdhub.<domain>`: two labels deep, so Cloudflare's free certificate cannot cover
  it, and it was left unproxied on purpose.
- `errors.scdhub.<domain>`: a leftover. Caddy stopped serving it when GlitchTip moved to
  the single-label `scdhub-errors.<domain>`, but the DNS record was never deleted.

Anyone who looks up either name gets `<vm-ip>`. Requests sent straight there skip
Cloudflare's firewall (the managed rules that blocked the WordPress and React-RCE probes
in the 2026-10-18 review).

**Already mitigated (D-#764/#765, 2026-10-18):** Caddy now accepts `Cf-Connecting-Ip`
only from Cloudflare's address ranges and passes the result as `X-Real-IP`. So the
login lockout's network rule cannot be dodged by skipping Cloudflare and forging the
header. The plan below removes the bypass itself.

## Steps

### 0. Quick cleanup (any time, about 5 minutes)

1. **Fix `scripts/deploy.sh` first.** The web source-map upload still names
   `https://errors.scdhub.<domain>`. That host's TLS already fails, so the upload is
   failing on every deploy and saying only "non-fatal". Point it at
   `https://scdhub-errors.<domain>`, deploy, and confirm the deploy log has no
   "sentry sourcemap upload failed" line.
2. In Cloudflare → DNS, **delete the `errors.scdhub` record**.

### 1. Give dev a single-label name

1. Cloudflare DNS: add `scdhub-dev.<domain>` → `<vm-ip>`, **proxied (orange)**.
2. VM Caddyfile: rename the `dev.scdhub.<domain>` site block to `scdhub-dev.<domain>`
   and keep everything inside it (basic auth, `import security_headers`, the
   `X-Real-IP` line). `caddy validate`, back up, then `systemctl reload caddy`.
3. Update everything that names the dev host: the dev `.env` on the VM
   (`EXPO_PUBLIC_API_URL` used by the dev web build), bookmarks, and any APK or OTA
   channel built against dev. `grep` the VM's `/opt/scdhub/dev` env files for the old name.
4. Check the dev site loads through Cloudflare and the dev API answers.
5. Delete the old `dev.scdhub` DNS record.

After this step, **no DNS record points at `<vm-ip>` with the proxy off.** Check the
whole zone for anything else that does (A, AAAA or CNAME).

### 2. Make the origin accept only Cloudflare

Two options; do (a), and (b) as well if you want both layers.

**(a) Authenticated Origin Pulls (free, recommended).** Cloudflare presents a client
certificate on every request to the origin, and Caddy refuses any connection without it.
No IP lists to maintain.

1. Cloudflare → SSL/TLS → Origin Server: **create an Origin CA certificate** for
   `<domain>` and `*.<domain>` and install the cert and key on the VM
   (`/etc/caddy/certs/`, owner `caddy`, mode 600 for the key). Caddy then stops using
   Let's Encrypt for these hosts, which matters because step (b) would block Let's
   Encrypt's HTTP-01 check on port 80.
2. Download Cloudflare's origin-pull CA certificate to `/etc/caddy/certs/cf-origin-pull-ca.pem`.
3. In each proxied site block:

   ```
   tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin.key {
       client_auth {
           mode require_and_verify
           trusted_ca_cert_file /etc/caddy/certs/cf-origin-pull-ca.pem
       }
   }
   ```

4. Cloudflare → SSL/TLS → Origin Server: turn **Authenticated Origin Pulls** on, and keep
   the SSL mode at **Full (strict)**.
5. Do this on dev first, check it, then prod, then `scdhub-errors`.

**(b) Firewall (optional second layer).** Allow 80/443 only from Cloudflare's ranges
(https://www.cloudflare.com/ips) in **both** the Oracle security list (console) and
`ufw`. Leave 22 open: the GitHub Actions deploy reaches the VM over SSH from addresses
that change, and SSH already accepts keys only (password login confirmed off, 2026-10-18).

### 3. Verify

- `curl --resolve <host>:443:<vm-ip> https://<host>/healthz` must **fail** for every host
  (today it returns 200).
- The prod and dev web apps load; login works; `/pdf` and `/export` downloads work; the
  `/downloads` APK and `version.json` are reachable.
- A push to `dev` deploys green (SSH path unaffected).
- GlitchTip still receives app events at `scdhub-errors.<domain>`.
- After the next failed login, the `LOGIN_FAIL` audit row's `meta.ip` shows a real visitor
  address, not a Cloudflare one.

### 4. Rollback

- Caddy: every edit keeps a dated `Caddyfile.bak-*` next to the live file. Copy it back and
  `systemctl reload caddy`.
- Authenticated Origin Pulls: switch the toggle off in Cloudflare. Caddy's `client_auth` must
  also come out, or the origin refuses Cloudflare's connections.
- Firewall: re-add `0.0.0.0/0` on 80/443 in the security list and `ufw`.

## Upkeep

The Caddyfile's `trusted_proxies` line lists Cloudflare's ranges by hand. Cloudflare
rarely changes them, but check https://www.cloudflare.com/ips twice a year. A new range
missing from the list only means those visitors' lockout IP is recorded as a Cloudflare
address: logins keep working, and the per-account lockout is unaffected.
