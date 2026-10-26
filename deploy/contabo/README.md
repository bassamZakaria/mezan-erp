# Mezan cloud edition on a Contabo VPS

One Ubuntu VPS running Docker Compose: the `mezan` app container and a stock `caddy:2` in front of it. CI builds the image; the VPS only pulls it.

```
internet ─▶ :80/:443 Caddy (TLS, security headers, x-mezan-origin) ─▶ mezan:8080 (compose network only)
                                                                         │
                         /srv/mezan/data  ◀──────────────────────────────┘  (SQLite: platform.db, tenants/, backups/)
                               │
            restic (systemd timer, hourly) ─▶ Contabo Object Storage bucket #1 (encrypted, versioned)
            app audit anchors (every 15 min) ─▶ bucket #2 (Object Lock)
```

| File | Goes to | What it is |
| --- | --- | --- |
| `docker-compose.yml`, `Caddyfile`, `caddy.d/`, `deploy.sh`, `backup/` | `/opt/mezan/` | this folder, copied as is |
| `.env.example` | `/srv/mezan/env` (root, 0600) | the app's environment |
| `shared.env.example` | `/srv/mezan/shared.env` (root, 0600) | domain, ACME e-mail and the origin secret; the only file Caddy reads |
| `backup/restic.env.example` | `/srv/mezan/restic.env` (root, 0600) | backup repository and its password |
| — | `/opt/mezan/.env` | written by `deploy.sh`: `MEZAN_IMAGE_TAG`, `MEZAN_PREVIOUS_IMAGE_TAG` |

## Region and sizing

- **Region: European Union (Germany — Nuremberg or Munich).** It is the closest Contabo region to Egypt that sits under EU data-protection law; put the same region in the privacy policy. Object Storage in the same region (`eu2.contabostorage.com`).
- **VPS:** 4 vCPU / 8 GB RAM / NVMe (Cloud VPS 20 class), x86_64. One process serves every tenant and SQLite is single-writer; RAM is the headroom for open tenants and the 1 GB `/tmp` the backup drill uses. Keep disk use under 80% (the backup job refuses above that).

## 1. Harden Ubuntu (once)

```
adduser ops && usermod -aG sudo ops                         # then copy your SSH key to ops
# /etc/ssh/sshd_config.d/10-hardening.conf:
#   PasswordAuthentication no
#   KbdInteractiveAuthentication no
#   PermitRootLogin no
systemctl reload ssh
apt update && apt install -y ufw fail2ban unattended-upgrades rsync sqlite3 restic curl
ufw default deny incoming && ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw enable
dpkg-reconfigure -plow unattended-upgrades
printf '[sshd]\nenabled = true\nbackend = systemd\n' > /etc/fail2ban/jail.local   # 24.04 logs sshd to the journal only
systemctl enable --now fail2ban
```

Install Docker Engine (27 or newer) from Docker's own apt repository (docs.docker.com/engine/install/ubuntu), then write `/etc/docker/daemon.json`:

```json
{ "userland-proxy": false, "ip6tables": true }
```

and `systemctl restart docker`. **Why:** ufw does not filter Docker-published ports, which is why the app publishes none and only Caddy's 80/443 are published. With the userland proxy on, IPv6 clients reach Caddy through `docker-proxy` and all arrive from one gateway address, so every per-address throttle and lockout would key on that one address. The compose network has IPv6 enabled for the same reason. Check after go-live: from a phone on mobile data (usually IPv6), get a company code throttled with wrong PINs, then confirm a laptop on another network can still sign in to it at once. If it cannot, every caller shares one address: remove the `AAAA` record until this is fixed.

**Disk encryption:** Contabo VPS disks are not encrypted at rest. Either accept that (the provider can read the disk) or set up LUKS from the rescue system before installing. The privacy policy (`apps/server/src/legal-content.ts`) says the server disk is not encrypted; if you set up LUKS, follow the `[[TODO: …]]` there to say it is. Off-box backups are always encrypted by restic before they leave the box.

## 2. DNS, mail, monitors

- **DNS:** `A` (and `AAAA` once the Docker IPv6 step above is done) for the apex, for example `mezan.example.com`, pointing at the VPS. No wildcard in code mode. DNS only (grey cloud) is simplest. Cloudflare's proxy (orange cloud) also works: the Caddyfile believes `CF-Connecting-IP` only from Cloudflare's published ranges and hands the app that address as `X-Forwarded-For`, so per-address throttles still see each visitor and a direct caller cannot forge one. `X-Forwarded-Host`/`-Proto` are always overwritten, because trusting a range would otherwise pass them through from the caller. The range list is a manual copy: refresh it if Cloudflare changes its ranges. `SITE_DOMAIN` may list several names, comma-separated.
- **Mail:** a transactional SMTP provider (Postmark, Mailgun, Brevo …) with SPF and DKIM on the sending domain. Mail sent straight from a fresh VPS address goes to spam, and the server's alerts depend on mail. Set `MEZAN_SMTP_*`, `MEZAN_PUBLIC_URL` and `MEZAN_ALERT_EMAIL=bassam.s.zakaria@gmail.com`.
- **Uptime:** UptimeRobot HTTP(s) monitor on `https://<domain>/readyz`, 5 minutes, keyword `"ready"` (docs/OPERATIONS.md).
- **Backup heartbeat:** a healthchecks.io check (period 1 hour, grace 2 hours) or an UptimeRobot heartbeat monitor; its URL is `BACKUP_HEARTBEAT_URL`. A missed ping is the alert that backups stopped.

## 3. Object storage

Create the Object Storage in the EU region and note its access key and secret. Contabo keys reach every bucket of the account, so both buckets are protected by their own settings, not by key scope.

**Bucket #1 — backups** (`mezan-backups`): plain bucket, versioning on. Initialise once:

```
set -a; . /srv/mezan/restic.env; set +a
restic init
```

If `restic init` fails on the bucket lookup, add `-o s3.bucket-lookup=path` (and to the script's `restic` calls). Keep `RESTIC_PASSWORD` in your password manager as well: without it no backup can be read.

**Bucket #2 — audit anchors** (`mezan-audit-anchors`): Contabo enables Object Lock only when the bucket is created, only in GOVERNANCE mode, and only through the S3 API (help.contabo.com articles 103000282887, 103000282889, 103000282907):

```
aws --endpoint-url https://eu2.contabostorage.com --region default s3api create-bucket \
  --bucket mezan-audit-anchors --object-lock-enabled-for-bucket
aws --endpoint-url https://eu2.contabostorage.com --region default s3api put-bucket-versioning \
  --bucket mezan-audit-anchors --versioning-configuration Status=Enabled
```

Then test the one property the anchor sink relies on — a second write of the same key is refused (`--if-none-match` needs aws-cli 2.17 or newer):

```
echo a > /tmp/a.json
aws --endpoint-url https://eu2.contabostorage.com --region default s3api put-object --bucket mezan-audit-anchors --key test/1.json --body /tmp/a.json --if-none-match '*'
aws --endpoint-url https://eu2.contabostorage.com --region default s3api put-object --bucket mezan-audit-anchors --key test/1.json --body /tmp/a.json --if-none-match '*'
```

The second call must fail with **412 Precondition Failed**. This is not verified on Contabo yet. If it succeeds, or Object Lock cannot be enabled, put bucket #2 on Backblaze B2 or Wasabi instead (set `MEZAN_AUDIT_ANCHOR_S3_ENDPOINT`/`_REGION` and keys accordingly). GOVERNANCE mode can be bypassed by whoever holds the account keys; it guards against the app and a stolen app key overwriting history, not against the account owner.

Set `MEZAN_AUDIT_ANCHOR_SIGNING_KEY` (`openssl rand -hex 32`, also in the password manager) and the `MEZAN_AUDIT_ANCHOR_S3_*` variables in `/srv/mezan/env`.

## 4. First deploy

```
mkdir -p /opt/mezan /srv/mezan/data && chown 1000:1000 /srv/mezan/data && chmod 700 /srv/mezan/data
# copy this folder to /opt/mezan, then:
cp /opt/mezan/.env.example /srv/mezan/env && cp /opt/mezan/shared.env.example /srv/mezan/shared.env
cp /opt/mezan/backup/restic.env.example /srv/mezan/restic.env
cp /opt/mezan/pg.env.example /srv/mezan/pg.env
chmod 600 /srv/mezan/env /srv/mezan/shared.env /srv/mezan/restic.env /srv/mezan/pg.env   # then fill them in
# pg.env: POSTGRES_PASSWORD and MEZAN_TENANT_DB_SECRET from `openssl rand -hex 32`, never changed afterwards
# before the first boot: MEZAN_AUDIT_CHAIN_KEY=$(openssl rand -hex 32) in /srv/mezan/env, never changed afterwards
```

Then set up the automatic deploy (§5) and push to `staging`. To deploy by hand instead, log in once with a `read:packages` token (`docker login ghcr.io --password-stdin`; it stays in `/root/.docker/config.json`) and run `/opt/mezan/deploy.sh <tag>`. On first boot without `MEZAN_PLATFORM_OWNER_PASSWORD` the owner password is written to `/srv/mezan/data/platform-owner-password.txt`: sign in at `/platform/login`, change it, delete the file.

Then enable the backups:

```
cp /opt/mezan/backup/*.service /opt/mezan/backup/*.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now mezan-backup.timer mezan-backup-check.timer mezan-pg-dump.timer mezan-pg-base.timer mezan-pg-drill.timer
systemctl start mezan-pg-dump.service mezan-pg-base.service && journalctl -u mezan-pg-dump.service -n 30
systemctl start mezan-backup.service && journalctl -u mezan-backup.service -n 30
```

After the first deploy, in a browser: sign in to a tenant, print an invoice and a label sheet, open the owner digest preview, upload an attachment, take an attendance selfie; the browser console must show no `Content-Security-Policy` violation. Check `curl -sI https://<domain>/` carries `strict-transport-security` and `content-security-policy`.

## 5. Update and rollback

Push to `staging` or `production` → the **Release image** workflow pushes `ghcr.io/bassamzakaria/mezan-erp:<sha>` (linux/amd64). For `staging` only, its `deploy` job then runs `deploy.sh <sha>@sha256:<digest>` on this VPS over SSH, so every push to `staging` goes live (about a minute of downtime). The deploy runs detached from the SSH session and logs to `/var/log/mezan-deploy.log`; re-sending the running tag succeeds without a restart.

**Automatic deploy (once per VPS):** a `deploy` user whose only key is GitHub's, forced to `ci-deploy.sh`; the workflow's short-lived `GITHUB_TOKEN` is the registry login, so no GitHub token is stored on the box.

```
adduser --disabled-password --comment "" deploy
install -o root -g root -m 0755 /opt/mezan/ci-deploy.sh /usr/local/bin/mezan-ci-deploy
install -o deploy -g deploy -m 700 -d /home/deploy/.ssh
# /home/deploy/.ssh/authorized_keys (deploy, 0600), one line:
#   restrict,command="/usr/local/bin/mezan-ci-deploy" <public half of DEPLOY_SSH_KEY>
echo 'deploy ALL=(root) NOPASSWD: /usr/local/bin/mezan-ci-deploy' > /etc/sudoers.d/91-deploy && chmod 440 /etc/sudoers.d/91-deploy
```

Secrets of the GitHub environment `contabo` (deployment branches: `staging` only, so no other branch or manual run can reach them): `DEPLOY_HOST` (the VPS address), `DEPLOY_SSH_KEY` (the private key), `DEPLOY_KNOWN_HOSTS` (`<address> ssh-ed25519 <host key>`, from `ssh-keyscan -t ed25519 <address>` checked against the key you saw on first login). To stop automatic deploys, delete `/home/deploy/.ssh/authorized_keys`; to deploy by hand, on the VPS:

```
sudo /opt/mezan/deploy.sh <sha>
sudo /opt/mezan/deploy.sh --rollback        # back to the tag that ran before
```

`deploy.sh` pulls first, then: stops the app (SIGTERM, up to 90 s) and **refuses to go on** unless it exited 0 and removed its `mezan-running.json` marker; copies the stopped data directory (databases with their `-wal`/`-shm`, not `backups/`) to `/srv/mezan-predeploy/<old tag>/` (the last three are kept); starts the new tag and waits up to 120 s for the healthcheck (`/readyz`). If it never gets ready it goes back to the old tag, and if the failed version changed any database's `PRAGMA user_version` (or the old version answers `SchemaTooNewError`), it moves the data aside to `/srv/mezan-predeploy/failed-<tag>-<time>/` and restores the pre-deploy copy first. An image-only rollback works only between releases with the same schema version; anything written by the failed version after the copy is in that `failed-` folder.

**Downtime:** about a minute per deploy. The app is the only writer of its SQLite files (`MEZAN_SQLITE_EXCLUSIVE=1`), so the old and new versions cannot overlap.

The server's own shutdown budget is 75 s (`apps/server/src/process-lifecycle.ts`); if a backup run takes longer the process exits 1 with the marker left behind and `deploy.sh` refuses. Wait a minute, `docker compose start mezan`, and deploy again.

## Settings changed from the console

The platform console's **Site settings** page changes only the support e-mail, support phone, WhatsApp number and the landing-page switch. It saves them to `env-overrides.json` in the data folder (`/srv/mezan/data` on the host), which the server reads at start-up after `/srv/mezan/env`; any other key in that file is ignored. Every other setting (mail, Paymob, keys, URLs, proxy, backups) stays in `/srv/mezan/env`. To drop the console's values, delete the file and restart:

```bash
sudo rm /srv/mezan/data/env-overrides.json && cd /opt/mezan && sudo docker compose restart mezan
```

## 6. Restore

### Postgres (the books)

Every tenant is a schema `t_<code>` with its own role, beside one `platform` schema, in the `mezan` database of the `mezan-postgres` container. `mezan-pg-backup.sh` writes under `/srv/mezan/data/backups/` (shipped off the box by the hourly restic job): `pg-dump/<stamp>/<schema>.dump` every hour (48 kept locally), a `pg-base/` base backup every day (2 kept) and the archived WAL in `pg-wal/` (every 60 s), so the whole cluster can be recovered to any minute. Every Sunday the drill restores the newest dumps into a scratch database and refuses if a tenant's posted journal does not balance (`PG_BACKUP_HEARTBEAT_URL` in `restic.env` reports it).

One tenant, to the last hourly dump:

```
cd /opt/mezan && docker compose stop mezan
docker exec -i mezan-postgres psql -U mezan_owner -d mezan -c 'DROP SCHEMA t_<code> CASCADE'
docker exec -i mezan-postgres pg_restore -U mezan_owner -d mezan --single-transaction < /srv/mezan/data/backups/pg-dump/<stamp>/t_<code>.dump
docker compose start mezan
```

The whole cluster to a point in time: stop both containers, move `/srv/mezan/pg/data` aside, unpack the newest `pg-base/*.tar.gz` into it (owner 999, mode 700), add `restore_command = 'cp /wal-archive/%f %p'` and `recovery_target_time = '<UTC time>'` to its `postgresql.auto.conf`, `touch recovery.signal`, start `postgres` alone, check, then `SELECT pg_wal_replay_resume();` and start `mezan`.

### Files (keys, anchors, older SQLite snapshots)

Local snapshots: the app writes one per open tenant and one of the platform database every `MEZAN_BACKUP_INTERVAL_MINUTES` (keep it at 30 or less: a tenant idle for 30 minutes is closed and skipped) under `/srv/mezan/data/backups/`, keeping 12 per folder. Off-box: restic keeps 48 hourly, 30 daily, 12 weekly, 12 monthly.

```
set -a; . /srv/mezan/restic.env; set +a
restic snapshots --tag mezan
restic restore <snapshot id> --target /root/restore --include /srv/mezan/data/backups/tenants/<tenant id>
cd /opt/mezan && docker compose stop mezan              # must exit 0, marker gone
# The databases are in WAL mode: delete the stale -wal and -shm BEFORE placing the restored file,
# or SQLite replays the old log over it.
rm -f /srv/mezan/data/<the tenant's db file>-wal /srv/mezan/data/<the tenant's db file>-shm
cp /root/restore/srv/mezan/data/backups/tenants/<tenant id>/<stamp>.sqlite /srv/mezan/data/<the tenant's db file>
chown 1000:1000 /srv/mezan/data/<the tenant's db file>
docker compose start mezan
```

The tenant's db file name is its `dbFile` on the platform console. The platform database is restored the same way from `backups/platform/` onto `platform.db`. Afterwards verify the tenant's audit chain against its anchors (docs/ENVIRONMENTS.md, "Audit trail anchors"): run the CLI with `docker compose exec mezan node --import tsx apps/server/src/audit-anchor-cli.ts verify ...` on a copy.

Restoring an older snapshot is, to the anchors, a rollback: the anchor sweep then refuses to re-anchor that tenant and logs `audit_anchor.refused_possible_tampering` at error level every interval (and the error-rate alert follows). Once the restore is confirmed legitimate, accept it on the console (tenant page → «اعتماد الاستعادة», typed reason + your password) or, with the service stopped (`docker compose stop mezan`), with `docker compose run --rm mezan node --import tsx apps/server/src/audit-anchor-cli.ts accept-restore --db <db> --scope <tenant id | platform> --reason "..." --actor <you>` — the only way for the `platform` scope. Anchoring resumes and the verifier keeps reporting the superseded history (docs/ENVIRONMENTS.md, "Audit trail anchors").

A lost VPS: new VPS, steps 1 to 4 with the same `/srv/mezan/env` (from the password manager), restore `platform.db` and every tenant from restic, start. The audit chains verify only with the key they were written with: `MEZAN_AUDIT_CHAIN_KEY` if it was set, otherwise the `audit-chain.key` files the backup job also copies (restore each beside its database, owner 1000, mode 0600) before the first start.

**Keep in the password manager:** `/srv/mezan/env` (in particular `MEZAN_AUDIT_CHAIN_KEY`, `MEZAN_AUDIT_ANCHOR_SIGNING_KEY`, SMTP and Paymob keys), `/srv/mezan/shared.env`, `/srv/mezan/pg.env` (`MEZAN_TENANT_DB_SECRET` derives every tenant role's password), and `RESTIC_PASSWORD`.

## 7. Logs

```
docker logs --since 1h mezan
docker logs -f mezan | grep '"level":"error"'
docker compose -f /opt/mezan/docker-compose.yml logs caddy
```

JSON lines, capped at 5 × 20 MB per container (docs/OPERATIONS.md). They live on the VPS and are lost with it; UptimeRobot, the backup heartbeat and the mailed alerts are what tell you about a box that is gone.

## Subdomain mode (optional, later)

One subdomain per tenant (`<code>.mezan.example.com`) needs a wildcard certificate, so HTTP-01 is not enough: build Caddy with your DNS provider's plugin (`xcaddy build --with github.com/caddy-dns/<provider>`), keep that provider's API token on the box, add a wildcard DNS record, set `MEZAN_TENANT_DOMAIN` and serve `{$SITE_DOMAIN}, *.{$SITE_DOMAIN}` with `tls { dns <provider> {env.DNS_API_TOKEN} }`. Code mode needs none of that: the web app sends `x-mezan-tenant` and the server accepts it.

## Owner-only platform console (optional)

Copy `caddy.d/platform-allowlist.caddyfile.example` to `caddy.d/platform-allowlist.caddyfile`, put your addresses in it and reload Caddy. `/platform*` and `/api/platform*` then answer 404 to everyone else.
