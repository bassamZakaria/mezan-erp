# Mezan cloud edition on a Contabo VPS

One Ubuntu VPS running Docker Compose: the `mezan` app container, a `postgres:17.6` container holding the books, and a stock `caddy:2` in front. CI builds the image; the VPS only pulls it.

```
internet ─▶ :80/:443 Caddy (TLS, security headers, x-mezan-origin) ─▶ mezan:9090 (compose network only)
                                                                         │
                         /srv/mezan/data  ◀──────────────────────────────┤  (keys, exports, backups/)
                               │                  mezan-postgres:5432 ◀──┘  (db network only; data in /srv/mezan/pg/data)
                               │
            restic (systemd timer, hourly) ─▶ Contabo Object Storage bucket #1 (encrypted, versioned)
            app audit anchors (every 15 min) ─▶ bucket #2 (Object Lock)
```

| File | Goes to | What it is |
| --- | --- | --- |
| `docker-compose.yml`, `Caddyfile`, `caddy.d/`, `deploy.sh`, `backup/`, `monitor/`, `postgres-init/` | `/opt/mezan/` | this folder, copied as is |
| `.env.example` | `/srv/mezan/env` (root, 0600) | the app's environment, including its database login `MEZAN_DATABASE_URL` and `MEZAN_TENANT_DB_SECRET` |
| `pg.env.example` | `/srv/mezan/pg.env` (root, 0600) | the Postgres superuser (`POSTGRES_*` only); the only file the postgres container reads, never given to the app |
| `shared.env.example` | `/srv/mezan/shared.env` (root, 0600) | domain, ACME e-mail and the origin secret; the only file Caddy reads |
| `backup/restic.env.example` | `/srv/mezan/restic.env` (root, 0600) | backup repository and its password |
| `monitor/health-prod.env.example`, `monitor/health-staging.env.example` | `/srv/mezan/health-prod.env`, `/srv/mezan/health-staging.env` (root, 0600) | per environment: the public `/readyz` URL and its heartbeat check |
| `docker-compose.shared-caddy.example.yml` | `/opt/mezan/docker-compose.override.yml` | only on a server whose Caddy already serves other apps ("Server that already runs Caddy"); keep it across updates |
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
apt update && apt install -y ufw fail2ban unattended-upgrades rsync sqlite3 restic rclone curl
ufw default deny incoming && ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw enable
dpkg-reconfigure -plow unattended-upgrades
printf '[sshd]\nenabled = true\nbackend = systemd\n' > /etc/fail2ban/jail.local   # 24.04 logs sshd to the journal only
systemctl enable --now fail2ban
```

Install Docker Engine (27 or newer) from Docker's own apt repository (docs.docker.com/engine/install/ubuntu), then write `/etc/docker/daemon.json`:

```json
{ "userland-proxy": false, "ip6tables": true }
```

and `systemctl restart docker`. **Why:** ufw does not filter Docker-published ports, which is why the app publishes none and only Caddy's 80/443 are published. With the userland proxy on, IPv6 clients reach Caddy through `docker-proxy` and all arrive from one gateway address, so every per-address throttle and lockout would key on that one address. The compose network has IPv6 enabled for the same reason. Check after go-live: from a phone on mobile data (usually IPv6), get a company code throttled with wrong passwords, then confirm a laptop on another network can still sign in to it at once. If it cannot, every caller shares one address: remove the `AAAA` record until this is fixed.

**Disk encryption:** Contabo VPS disks are not encrypted at rest. Either accept that (the provider can read the disk) or set up LUKS from the rescue system before installing. The privacy policy (`apps/server/src/legal-content.ts`) says the server disk is not encrypted; if you set up LUKS, follow the `[[TODO: …]]` there to say it is. Off-box backups are always encrypted by restic before they leave the box.

## 2. DNS, mail, monitors

- **DNS:** `A` (and `AAAA` once the Docker IPv6 step above is done) for the apex, for example `mezan.example.com`, pointing at the VPS. No wildcard in code mode. DNS only (grey cloud) is simplest. Cloudflare's proxy (orange cloud) also works: the Caddyfile believes `CF-Connecting-IP` only from Cloudflare's published ranges and hands the app that address as `X-Forwarded-For`, so per-address throttles still see each visitor and a direct caller cannot forge one. `X-Forwarded-Host`/`-Proto` are always overwritten, because trusting a range would otherwise pass them through from the caller. The range list is a manual copy: refresh it if Cloudflare changes its ranges. `SITE_DOMAIN` may list several names, comma-separated.
- **Mail:** a transactional SMTP provider (Postmark, Mailgun, Brevo …) with SPF and DKIM on the sending domain. Mail sent straight from a fresh VPS address goes to spam, and the server's alerts depend on mail. Set `MEZAN_SMTP_*`, `MEZAN_PUBLIC_URL` and `MEZAN_ALERT_EMAIL=bassam.s.zakaria@gmail.com`.
- **Uptime:** UptimeRobot HTTP(s) monitor on `https://<domain>/readyz`, 5 minutes, keyword `"ready"` (docs/OPERATIONS.md).
- **Health heartbeat (free, from the VPS):** one healthchecks.io check per environment (prod: period 10 minutes, grace 15 minutes; staging: period 1 day, grace 1 hour); its URL is `HEALTH_HEARTBEAT_URL` in `/srv/mezan/health-<env>.env`. Every 10 minutes `mezan-health@<env>.timer` fetches the public `/readyz`: a good answer pings the check, a bad one pings `<url>/fail` (alert now), and no ping at all (the VPS is down) alerts after the grace. Behind Cloudflare's proxy (orange cloud) Bot Fight Mode answers a bare `curl` from a datacenter address with a 403, so every run would alert: keep that hostname DNS only, or Bot Fight Mode off. This check runs on the VPS itself; it does not replace an outside monitor.
- **Backup heartbeat:** a healthchecks.io check (period 1 hour, grace 2 hours) or an UptimeRobot heartbeat monitor; its URL is `BACKUP_HEARTBEAT_URL`. A missed ping is the alert that backups stopped. The Postgres jobs have one check each: `PG_DUMP_HEARTBEAT_URL` (hourly), `PG_BASE_HEARTBEAT_URL` (daily), `PG_DRILL_HEARTBEAT_URL` (weekly), all in `restic.env`.

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
# pg.env: POSTGRES_PASSWORD=$(openssl rand -hex 32)
# env:    MEZAN_DATABASE_URL=postgres://mezan_app:$(openssl rand -hex 32)@postgres:5432/mezan
#         MEZAN_TENANT_DB_SECRET=$(openssl rand -hex 32)
#         MEZAN_AUDIT_CHAIN_KEY=$(openssl rand -hex 32)   before the first boot, never changed afterwards
mkdir -p /srv/mezan/pg/data    # must be EMPTY: the C locale and data checksums are set only by initdb
```

The app logs in as `mezan_app`, which is not a superuser: it may create, alter and drop the per-company roles and schemas, nothing else. `deploy.sh` creates it (`postgres-init/10-mezan-app.sql`, also run by the image on an empty data directory), sets its password from `MEZAN_DATABASE_URL` on every deploy and refuses to start the app if that user is a superuser. The superuser in `pg.env` is used only by `deploy.sh` and the backup jobs. By design `mezan_app` is a member of every company's role (it creates them, and needs that to create and drop their schemas); that does not widen what an SQL injection can reach: a company's statements run on pools logged in as that company's `NOINHERIT` role, the `mezan_app` pool runs only fixed provisioning statements, and the process already holds `MEZAN_TENANT_DB_SECRET`, from which every company's password derives. `deploy.sh` sends its password as a SCRAM-SHA-256 verifier computed on the host, so the plain password never reaches Postgres or its logs.

On a server whose Caddy already serves other apps, first follow "Server that already runs Caddy" below. Then set up the automatic deploy (§5) and push to `staging`. To deploy by hand instead, log in once with a `read:packages` token (`docker login ghcr.io --password-stdin`; it stays in `/root/.docker/config.json`) and run `/opt/mezan/deploy.sh <tag>`. On first boot without `MEZAN_PLATFORM_OWNER_PASSWORD` the owner password is written to `/srv/mezan/data/platform-owner-password.txt`: sign in at `/platform/login`, change it, delete the file.

Then enable the backups:

```
cp /opt/mezan/backup/*.service /opt/mezan/backup/*.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now mezan-backup.timer mezan-backup-prune.timer mezan-backup-check.timer mezan-pg-dump.timer mezan-pg-base.timer mezan-pg-drill.timer
systemctl start mezan-pg-dump.service mezan-pg-base.service && journalctl -u mezan-pg-dump.service -n 30
systemctl start mezan-backup.service && journalctl -u mezan-backup.service -n 30
```

Then enable the health check:

```
for e in prod staging; do cp /opt/mezan/monitor/health-$e.env.example /srv/mezan/health-$e.env && chmod 600 /srv/mezan/health-$e.env; done   # fill in HEALTH_HEARTBEAT_URL in each
cp /opt/mezan/monitor/*.service /opt/mezan/monitor/*.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now mezan-health@prod.timer mezan-health@staging.timer
systemctl start mezan-health@prod.service mezan-health@staging.service && journalctl -u 'mezan-health@*' -n 20
```

Both checks must show **Up** on healthchecks.io afterwards: a check that was never pinged stays **New** and never alerts.

After the first deploy, in a browser: sign in to a tenant, print an invoice and a label sheet, open the owner digest preview, upload an attachment, take an attendance selfie; the browser console must show no `Content-Security-Policy` violation. Check `curl -sI https://<domain>/` carries `strict-transport-security` and `content-security-policy`.

## 5. Update and rollback

Push to `staging` or `production` → the **Release image** workflow pushes `ghcr.io/bassamzakaria/mezan-erp:<sha>` (linux/amd64). Its `deploy` job then runs `deploy.sh <sha>@sha256:<digest>` over SSH on that branch's own VPS (`staging` → the staging VPS, `production` → the production VPS; one stack per VPS), so every push to either branch goes live (about a minute of downtime). The deploy runs detached from the SSH session and logs to `/var/log/mezan-deploy.log`; re-sending the running tag succeeds without a restart.

**Automatic deploy (once per VPS):** a `deploy` user whose only key is GitHub's, forced to `ci-deploy.sh`; the workflow's short-lived `GITHUB_TOKEN` is the registry login, so no GitHub token is stored on the box. The user is `deploy` on the production VPS and `mezan-deploy` on the staging VPS (it shares the box with other apps): on staging, read `mezan-deploy` for `deploy` in the commands below and in `/home/deploy` paths.

```
adduser --disabled-password --comment "" deploy
install -o root -g root -m 0755 /opt/mezan/ci-deploy.sh /usr/local/bin/mezan-ci-deploy
install -o deploy -g deploy -m 700 -d /home/deploy/.ssh
# /home/deploy/.ssh/authorized_keys (deploy, 0600), one line:
#   restrict,command="/usr/local/bin/mezan-ci-deploy" <public half of DEPLOY_SSH_KEY>
echo 'deploy ALL=(root) NOPASSWD: /usr/local/bin/mezan-ci-deploy' > /etc/sudoers.d/91-deploy && chmod 440 /etc/sudoers.d/91-deploy
```

Each VPS has its own GitHub environment, which admits only its branch, so no other branch can reach its secrets (a manual run on that branch deploys like a push): `contabo` ← `production`, `contabo-staging` ← `staging`. While an environment's `DEPLOY_HOST` is the placeholder `CHANGE_ME`, its deploy is skipped with a warning. Secrets of each environment: `DEPLOY_HOST` (the VPS address), `DEPLOY_SSH_KEY` (the private key), `DEPLOY_KNOWN_HOSTS` (`<address> ssh-ed25519 <host key>`, from `ssh-keyscan -t ed25519 <address>` checked against the key you saw on first login). To stop automatic deploys, delete `/home/deploy/.ssh/authorized_keys`; to deploy by hand, on the VPS:

```
sudo /opt/mezan/deploy.sh <sha>
sudo /opt/mezan/deploy.sh --rollback        # the tag that ran before, on the current books
```

`deploy.sh` pulls first, then: stops the app (SIGTERM, up to 90 s) and **refuses to go on** unless it exited 0 and removed its `mezan-running.json` marker; starts Postgres and re-applies the `mezan_app` role; copies the stopped data directory (not `backups/`) and one `pg_dump` per schema to `/srv/mezan-predeploy/<old tag>/` (`pg-dump/<schema>.dump`, the same layout as the hourly dumps; the last three copies are kept); starts the new tag and waits up to 120 s for the healthcheck (`/readyz`). Before stopping anything it refuses unless the disk has room for twice the data directory plus `pg_database_size('mezan')`. If anything fails after the app was stopped but before the tag was switched, it starts the old version again; after the switch it logs that the site may be down and points here and to §6 Restore.

If the new tag never gets ready it **always** moves what the failed version wrote to `/srv/mezan-predeploy/failed-<tag>-<time>/` (files and per-schema dumps), restores the pre-deploy copy and starts the old tag. **Whatever companies did on the site during the failed tag's window (a minute or two) is in that `failed-…` copy only, NOT in the live books;** re-enter it, or merge it by hand from that copy. `deploy.sh` never prunes a `failed-…` copy: delete it by hand once merged. The Postgres restore goes schema by schema, platform last, each dropped (`CASCADE`, so tables the failed version added go too) and rebuilt in its own transaction, so a failure leaves that schema as it was; a company role the cluster no longer has (a company purged since) is first created as a `NOLOGIN` placeholder, and the app's boot gives each served company's role its login back. A schema the copy does not hold was created by the failed version: it is dropped with its role (its data is in the `failed-…` copy). Schemas in the copy with no row in `platform.tenant` are logged as a `WARNING` and kept: drop them by hand once checked.

`--rollback` is different: it deploys the previous image **on the current books**, without restoring anything. If that image cannot run on them it never gets ready, and the failure path above puts the books back as they were and returns to the current tag. To go back to the books from before a deploy, restore its `/srv/mezan-predeploy/<tag>/pg-dump/` (§6). The first tag that ran on Postgres is recorded in `/srv/mezan/data/postgres-cutover-tag`; `--rollback` from that tag is refused, because the tag before it served the SQLite books, which stopped changing at the cutover. (If this script first runs on a box already on Postgres, the marker names that deploy's tag, so a rollback from it is refused too: deploy the wanted tag by name.) `deploy.sh <tag>` by name cannot tell a pre-cutover tag apart: never deploy one by hand.

**Downtime:** about a minute per deploy (the Postgres cutover with `--migrate-sqlite` takes longer: see its step 6). The old and new versions never run at once.

The server's own shutdown budget is 75 s (`apps/server/src/process-lifecycle.ts`); if a backup run takes longer the process exits 1 with the marker left behind and `deploy.sh` refuses. Wait a minute, `docker compose start mezan`, and deploy again.

**App port 9090 (changed from 8080).** An automatic deploy changes only the image, and `/opt/mezan/docker-compose.yml` pins `PORT`, so a box keeps 8080 until its files are updated, and `deploy.sh` cannot see a Caddy/app port mismatch (its healthcheck runs inside the container). Switch a box in a quiet hour, all on one line, then check the public address straight away:

```
cd /opt/mezan && rsync -a <repo>/deploy/contabo/ /opt/mezan/ && docker compose up -d && docker compose restart caddy && curl -fsS https://<address>/readyz
```

`rsync` brings every change in `deploy/contabo/` since the box was last synced, so read `git diff` for that folder first. On a server with a shared Caddy, change its Mezan site's upstream to `mezan:9090` in the same step.

## Server that already runs Caddy

When the box's own Caddy already serves other apps on ports 80/443 (the staging VPS), Mezan uses that Caddy instead of starting its own. The steps above for Docker, the `deploy` user, `/srv/mezan/*` env files and backups are unchanged; only Mezan's own Caddy is skipped.

1. A network for Mezan and that Caddy only: `docker network create mezan-proxy && docker network connect mezan-proxy <existing caddy container>`. Never attach the other apps' containers to it: whatever reaches `mezan:9090` directly skips the proxy.
2. `cp /opt/mezan/docker-compose.shared-caddy.example.yml /opt/mezan/docker-compose.override.yml`. `deploy.sh` reads the override when it exists; without it nothing changes. A Caddy installed on the host instead of in Docker: follow the comments in that file.
3. Give the existing Caddy `MEZAN_ORIGIN_SECRET` as an environment variable (the same value as `/srv/mezan/shared.env`, from an env file outside that Caddy's own repo), never as a literal in its Caddyfile. Staging has its own secret, never production's.
4. Check that Caddy's global `servers { trusted_proxies … }`: it applies to every site on it. Behind Cloudflare it must hold only Cloudflare's ranges **and** `client_ip_headers CF-Connecting-IP`, as in [Caddyfile](Caddyfile); otherwise `trusted_proxies` stays empty. Anything else (a private range, or Cloudflare's ranges without that header) lets a caller forge the visitor address Mezan throttles on.
5. Add this site (staging address; upstream `127.0.0.1:9090` for a host Caddy). Mount `/opt/mezan/caddy.d` into that Caddy at `/etc/caddy/mezan.d` for the import, or the platform-console allowlist is not active:

```
staging.example.com {
	import /etc/caddy/mezan.d/*.caddyfile
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		?Referrer-Policy "strict-origin-when-cross-origin"
		Content-Security-Policy "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://cloudflareinsights.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-src https://*.firebaseapp.com https://accounts.google.com; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'"
		-Server
	}
	reverse_proxy mezan:9090 {
		header_up X-Mezan-Origin {env.MEZAN_ORIGIN_SECRET}
		header_up X-Forwarded-For {client_ip}
		header_up X-Forwarded-Host {host}
		header_up X-Forwarded-Proto {scheme}
		header_up X-Request-Id {http.request.uuid}
	}
}
```

6. Reload that Caddy, and remove a Mezan Caddy left from an earlier deploy: `docker rm -f mezan-caddy`. Proxy logs are that Caddy's, not `docker compose logs caddy`. Then check the secret reached the app through that Caddy: `curl -s https://<staging address>/api/session | grep -q ORIGIN_REQUIRED && echo 'origin secret mismatch'` must print nothing (repeat after rotating the secret: the health check alone does not catch it). On staging also set `MEZAN_ENV=staging` in `/srv/mezan/env` for the STAGING badge, and point `HEALTH_URL` in `/srv/mezan/health-staging.env` at the staging address.

## Cutover to Postgres (once, on a box that ran the SQLite books)

Done by hand, as root on the VPS, from a checkout of the commit you will deploy. **The SQLite books are carried over** by `deploy.sh --migrate-sqlite`: after it has stopped the app and copied `/srv/mezan/data` to `/srv/mezan-predeploy/<old tag>/`, it runs the new tag's migrator (`apps/server/src/sqlite-to-postgres-cli.ts migrate`) in a one-off container before the new tag starts. The migrator works on scratch copies, proves which audit chain key verifies each book, brings the copies to the new tag's shape, copies the platform and every active or suspended company (archived ones get no schema; a company still provisioning makes it refuse, naming it) with their ids, then compares row counts, row hashes and posted debit/credit per account on both sides and appends a `MIGRATED_FROM_SQLITE` event to each audit chain (recording the source file's SHA-256, the old chain head and the row counts) before verifying it. Any difference drops every schema it created and takes the normal failure path below. Without the flag the cutover starts Postgres **empty** (the owner is seeded afresh and every company signs up again); that path still works.

Keep, and copy to the password manager, everything the migrated books still need: `MEZAN_AUDIT_CHAIN_KEY` (the old chains were sealed with it and the new schemas' keys derive from it; an `audit-chain.key` file beside `platform.db` or in `tenants/`, if one exists, is what sealed those chains instead), `MEZAN_SECRETS_KEY` or `secrets.key` (stored SMTP and webhook secrets are copied sealed), every `tenants/<id>.db.evidence-signing.key` (evidence packs signed before the cutover are checked with it; Postgres signs new ones with a derived key) and `audit-anchors/` (the signed history of each SQLite chain up to the cutover). The old files are left where they are and are not read as books any more: `platform.db`, `tenants/` and `backups/` in `/srv/mezan/data`, plus the copy in `/srv/mezan-predeploy/<old tag>/`. Delete the databases once nobody needs them; never the keys above.

1. Stop automatic deploys for the duration: `mv /home/deploy/.ssh/authorized_keys /root/deploy-authorized_keys`.
2. Copy this folder over the old one, keeping `/opt/mezan/.env` (the running tag): `rsync -a deploy/contabo/ /opt/mezan/`, then `install -o root -g root -m 0755 /opt/mezan/ci-deploy.sh /usr/local/bin/mezan-ci-deploy`.
3. Env files (all root, 0600):
   - `/srv/mezan/pg.env` from `pg.env.example`: `POSTGRES_USER=mezan_owner`, `POSTGRES_PASSWORD=$(openssl rand -hex 32)`, `POSTGRES_DB=mezan`, and **nothing else** (`deploy.sh` refuses any `MEZAN_*` line there).
   - `/srv/mezan/env`: add `MEZAN_DATABASE_URL=postgres://mezan_app:$(openssl rand -hex 32)@postgres:5432/mezan` and `MEZAN_TENANT_DB_SECRET=$(openssl rand -hex 32)`; keep `MEZAN_AUDIT_CHAIN_KEY`, or set it with `openssl rand -hex 32` if missing (the evidence and audit keys of every schema derive from it).
   - `/srv/mezan/restic.env`: add `PG_DUMP_HEARTBEAT_URL`, `PG_BASE_HEARTBEAT_URL`, `PG_DRILL_HEARTBEAT_URL` (one healthchecks.io check each, periods in `restic.env.example`).
   - Copy all of them to the password manager.
4. `mkdir -p /srv/mezan/pg/data` and check it is **empty** (`ls -A`). The image runs `initdb` (C locale, UTF-8, data checksums) and `postgres-init/` only on an empty directory; if an earlier attempt left files, `docker compose -f /opt/mezan/docker-compose.yml rm -sf postgres` and move the directory aside first.
5. Timers: `cp /opt/mezan/backup/*.service /opt/mezan/backup/*.timer /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now mezan-pg-dump.timer mezan-pg-base.timer mezan-pg-drill.timer`.
Images built before the server was bundled run the same CLIs as `node --import tsx apps/server/src/<name>.ts`; use that form while such a tag is running (for example right after a `--rollback`).

6. Dry run the migration with the tag from the **Release image** run's notice: `docker login ghcr.io` (a `read:packages` token), `cd /opt/mezan && MEZAN_IMAGE_TAG=<sha>@sha256:<digest> docker compose pull mezan`. The running app holds its books locked, so the check needs it stopped (the site is down meanwhile): `docker compose stop mezan`, `install -d -o 1000 -g 1000 -m 700 /srv/mezan/data/.migrate-scratch`, `MEZAN_IMAGE_TAG=<sha>@sha256:<digest> docker compose run --rm --no-deps -T -e TMPDIR=/data/.migrate-scratch -e MEZAN_LOG_STDERR=1 mezan node --enable-source-maps apps/server/dist/sqlite-to-postgres-cli.js check --data /data > /root/sqlite-check.json`, then `rm -rf /srv/mezan/data/.migrate-scratch && docker start mezan` (the plain `docker start`: after step 2 the compose file makes `mezan` depend on a `postgres` that is not running yet, so `docker compose start mezan` refuses and leaves the site down). (`TMPDIR` puts the scratch copies on the data disk; the container's `/tmp` is a 1 GB tmpfs.) It needs no Postgres and changes no book. Exit 0 and `"ok": true` are required; otherwise `"error"` and each book's `"problems"` name the table, column or chain at fault, and a book still locked means the app was not stopped. `"chainKeySource"` says which key verified each chain (`env`, `file`, or `empty-chain`); `"translatedSeparators"` counts legacy keys whose NUL separator becomes U+001F; each table entry carries its row count in `"sourceRows"`. The gap between `"startedAt"` and `"finishedAt"` is a lower bound for the migration's share of the step 7 downtime (it also writes Postgres and compares both sides); make sure the disk holding `/srv/mezan` has five times the size of the SQLite books free, as step 7 checks.
7. Deploy by hand: `/opt/mezan/deploy.sh --migrate-sqlite <sha>@sha256:<digest>`.
8. Check: read the report `deploy.sh` named, `/srv/mezan-predeploy/sqlite-to-postgres-report-<time>.json` (`"ok": true`; every table `"match": true`; each company's `"accounts"` has no `"mismatches"`, equal `totalDebit`/`totalCredit`, and the same totals as that company in `/root/sqlite-check.json` from step 6 unless it was written to between the two runs; every `"targetAudit"` is `"ok": true`); `cat /srv/mezan/data/postgres-cutover-tag` names that tag; `docker logs mezan` shows the books on Postgres; the owner signs in with the **existing** platform password (no new `platform-owner-password.txt` is written); open each company and its trial balance (ميزان المراجعة) and compare it with the figure from before the cutover; `/audit/verify` of a company reads `ok`; `systemctl start mezan-pg-dump.service mezan-pg-base.service` and `journalctl -u mezan-pg-dump.service -n 20` succeed; a few minutes later `/srv/mezan/data/backups/pg-wal/` holds `*.gz` files owned by uid 999.
9. Re-enable automatic deploys: `mv /root/deploy-authorized_keys /home/deploy/.ssh/authorized_keys`.

**If the cutover deploy fails** (the migration refuses or finds a difference, or the tag never gets ready), `deploy.sh` puts the SQLite tag back and, because the pre-deploy copy holds no Postgres schema, drops every `platform` and `t_*` schema and role the failed tag created (kept in `/srv/mezan-predeploy/failed-<tag>-<time>/pg-dump/`). `postgres-cutover-tag` is not written. The migration's report and its stderr name the cause: the report is `/srv/mezan-predeploy/sqlite-to-postgres-report-<time>.json`, outside `/srv/mezan/data` so the restore does not remove it. A migration still running after 30 minutes is stopped (`docker rm -f mezan-sqlite-migrate`) and takes the same path. Each attempt adds a `failed-…` copy the size of the books; remove the ones already read before the next attempt, or the disk check refuses. Fix the cause and deploy again from step 6. The migration refuses to run while any `platform` or `t_*` schema exists, so a second `--migrate-sqlite` never lands on half-copied books.

**If a migration was interrupted** (the host rebooted, or `deploy.sh` itself was killed) and `platform` or `t_*` schemas or roles are left behind, the cluster holds nothing else yet, so the simplest cleanup is to start it again empty: `docker compose -f /opt/mezan/docker-compose.yml rm -sf postgres`, move `/srv/mezan/pg/data` aside, and go back to step 4. To keep the cluster instead, for each schema `s` that `docker exec mezan-postgres psql -U mezan_owner -d mezan -Atc "SELECT nspname FROM pg_namespace WHERE nspname = 'platform' OR nspname ~ '^t_'"` lists, run as `mezan_owner`: `DROP OWNED BY s CASCADE; SET ROLE mezan_app; REVOKE ALL ON DATABASE mezan FROM s; RESET ROLE; DROP SCHEMA IF EXISTS s CASCADE; DROP ROLE IF EXISTS s;` (a migration that failed but could not drop a schema prints this same SQL as `CLEANUP FAILED`). Without the flag, with `platform` gone, the next boot seeds the owner afresh and writes a new `platform-owner-password.txt` (the failed tag's file went to the `failed-…` copy with the rest of its data directory).

From here `--rollback` refuses to go back past the cutover tag (§5).

## Settings changed from the console

The platform console's **Site settings** page changes only the support e-mail, support phone, WhatsApp number and the landing-page switch. It saves them to `env-overrides.json` in the data folder (`/srv/mezan/data` on the host), which the server reads at start-up after `/srv/mezan/env`; any other key in that file is ignored. Every other setting (mail, Paymob, keys, URLs, proxy, backups) stays in `/srv/mezan/env`. To drop the console's values, delete the file and restart:

```bash
sudo rm /srv/mezan/data/env-overrides.json && cd /opt/mezan && sudo docker compose restart mezan
```

## 6. Restore

### Postgres (the books)

Every company is a schema `t_<tenant id, with - replaced by _>` owned by a role of the same name, beside one `platform` schema (role `platform`), in the `mezan` database of the `mezan-postgres` container. `mezan-pg-backup.sh` writes under `/srv/mezan/data/backups/` (files mode 0600, shipped off the box by the hourly restic job):

- `pg-dump/<stamp>/<schema>.dump` every hour, 48 kept locally. The run fails (and pings `PG_DUMP_HEARTBEAT_URL/fail`) if the schema list cannot be read, if any active or suspended company has no schema, if any dump is missing or empty, or if WAL archiving is failing (`pg_stat_archiver`: the last failure is newer than the last success; the base run checks the same).
- `pg-base/<stamp>.tar.gz` (base backup) and `pg-base/<stamp>.globals.sql` (every role, no passwords) every day, 2 kept; `PG_BASE_HEARTBEAT_URL`.
- `pg-wal/<segment>.gz`, the archived WAL, gzipped, at least every 5 minutes (`archive_timeout=300`), so the whole cluster can be recovered to within about 5 minutes.
- Every Sunday the drill restores the newest dumps into a scratch database and refuses if a company's posted journal does not balance; `PG_DRILL_HEARTBEAT_URL`.

Find a company's schema from its company code:

```
docker exec -i mezan-postgres psql -U mezan_owner -d mezan -Atc "SELECT 't_' || replace(id, '-', '_') FROM platform.tenant WHERE code = '<company code>'"
```

One company, to the last hourly dump:

```
cd /opt/mezan && docker compose stop mezan
docker exec -i mezan-postgres psql -U mezan_owner -d mezan -c 'DROP SCHEMA t_<id> CASCADE'
# only if the role is gone (the company was purged): a placeholder, the boot restores its login
docker exec -i mezan-postgres psql -U mezan_owner -d mezan -c 'CREATE ROLE t_<id> NOLOGIN'
docker exec -i mezan-postgres pg_restore -U mezan_owner -d mezan --single-transaction < /srv/mezan/data/backups/pg-dump/<stamp>/t_<id>.dump
docker exec -i mezan-postgres psql -U mezan_owner -d mezan -v ON_ERROR_STOP=1 -q < /opt/mezan/postgres-init/10-mezan-app.sql
docker compose start mezan
```

The whole database from a pre-deploy copy (`/srv/mezan-predeploy/<tag>/pg-dump/`): the same way `deploy.sh` does it after a failed deploy (`restore_pg_dumps` in `deploy.sh`), app stopped: drop (with its role) any `platform`/`t_*` schema that has no dump there, then for each dump, companies first and `platform.dump` last, one transaction each: create its role as `NOLOGIN` if missing, `DROP SCHEMA … CASCADE`, then `pg_restore -f - < <schema>.dump | psql --single-transaction`; finally re-run `10-mezan-app.sql` as above. Never restore every schema in one transaction: each takes ~900 locks and the lock table (`max_locks_per_transaction` in `docker-compose.yml`) is shared.

The whole cluster to a point in time: stop both containers, move `/srv/mezan/pg/data` aside, unpack the newest `pg-base/*.tar.gz` into an empty `/srv/mezan/pg/data` (`tar -xzf … -C …`, owner 999, mode 700), add `restore_command = 'gunzip -c /wal-archive/%f.gz > %p'` and `recovery_target_time = '<UTC time>'` to its `postgresql.auto.conf`, `touch recovery.signal`, start `postgres` alone, check, then `SELECT pg_wal_replay_resume();` and start `mezan` (its boot re-sets every company role's password). The roles live in the base backup; `<stamp>.globals.sql` is for rebuilding them on a fresh cluster before restoring dumps (the passwords then come from the app's boot).

**What the weekly drill does not prove.** It restores the newest per-schema dumps with `--no-owner` into a scratch database and checks each posted journal balances. It does not test the base backup, the WAL archive, the roles or ownership, the off-box copy in restic, or that the app can open the result.

**Monthly: replay the base backup and WAL** (on the VPS; about the size of the database in free disk; touches nothing live):

```
d=/srv/mezan-pitr-drill && rm -rf $d && mkdir -p $d/data && chmod 700 $d/data
tar -xzf "$(ls /srv/mezan/data/backups/pg-base/*.tar.gz | tail -n 1)" -C $d/data
printf "restore_command = 'gunzip -c /wal-archive/%%f.gz > %%p'\n" >> $d/data/postgresql.auto.conf
touch $d/data/recovery.signal && chown -R 999:999 $d/data
# archive_mode=off: the drill must never write into the live archive, which it mounts read-only.
docker run -d --name mezan-pitr-drill --network none -v $d/data:/var/lib/postgresql/data \
  -v /srv/mezan/data/backups/pg-wal:/wal-archive:ro postgres:17.6 -c archive_mode=off -c max_connections=200 -c max_locks_per_transaction=1024
docker logs -f mezan-pitr-drill     # wait for "archive recovery complete" / "ready to accept connections"
docker exec mezan-pitr-drill psql -U mezan_owner -d mezan -At -c "SELECT count(*) FROM platform.tenant" -c "SELECT max(updated_at) FROM platform.tenant"
docker exec mezan-postgres psql -U mezan_owner -d mezan -At -c "SELECT count(*) FROM platform.tenant"   # the live count
docker rm -f mezan-pitr-drill && rm -rf $d
```

The tenant count must match the live one and the latest `updated_at` must be within minutes of now; pick one company and run the drill's balance query on its schema. Restore one restic snapshot of `pg-base/` and `pg-wal/` to `/root/restore` once a quarter and repeat from there, which is the only proof the off-box copy works.

### Files (keys, anchors, older SQLite snapshots)

Local snapshots: the app writes one per open tenant and one of the platform database every `MEZAN_BACKUP_INTERVAL_MINUTES` (keep it at 30 or less: a tenant idle for 30 minutes is closed and skipped) under `/srv/mezan/data/backups/`, keeping 12 per folder. Off-box: restic keeps every snapshot from the last 7 days; the hourly run forgets older ones and the weekly `mezan-backup-prune.timer` (Sunday 04:00) deletes their data.

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

The tenant's db file name is its `dbFile` on the platform console. The platform database is restored the same way from `backups/platform/` onto `platform.db`. Afterwards verify the tenant's audit chain against its anchors (docs/ENVIRONMENTS.md, "Audit trail anchors"): run the CLI with `docker compose exec mezan node --enable-source-maps apps/server/dist/audit-anchor-cli.js verify ...` on a copy.

Restoring an older snapshot is, to the anchors, a rollback: the anchor sweep then refuses to re-anchor that tenant and logs `audit_anchor.refused_possible_tampering` at error level every interval (and the error-rate alert follows). Once the restore is confirmed legitimate, accept it on the console (tenant page → «اعتماد الاستعادة», typed reason + your password) or, with the service stopped (`docker compose stop mezan`), with `docker compose run --rm mezan node --enable-source-maps apps/server/dist/audit-anchor-cli.js accept-restore --db <db> --scope <tenant id | platform> --reason "..." --actor <you>` — the only way for the `platform` scope. Anchoring resumes and the verifier keeps reporting the superseded history (docs/ENVIRONMENTS.md, "Audit trail anchors").

A lost VPS: new VPS, steps 1 to 4 with the same `/srv/mezan/env` (from the password manager), restore `platform.db` and every tenant from restic, start. The audit chains verify only with the key they were written with: `MEZAN_AUDIT_CHAIN_KEY` if it was set, otherwise the `audit-chain.key` files the backup job also copies (restore each beside its database, owner 1000, mode 0600) before the first start.

**Keep in the password manager:** `/srv/mezan/env` (in particular `MEZAN_AUDIT_CHAIN_KEY`, `MEZAN_DATABASE_URL`, `MEZAN_TENANT_DB_SECRET`, `MEZAN_AUDIT_ANCHOR_SIGNING_KEY`, SMTP and Paymob keys), `/srv/mezan/shared.env`, `/srv/mezan/pg.env` (the superuser password), and `RESTIC_PASSWORD`.

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
