# Deploy Mezan staging on the shared VPS (beside the website and CRM)

The VPS already runs a host Caddy (`/etc/caddy/sites/*.caddy`) and a `deploy` user for the other two apps.
Mezan gets its own user, `mezan-deploy`, and goes behind the host Caddy.

Replace `<DOMAIN>` (e.g. `mezan-staging.cyag.net`), `<VPS_IP>` and `<you>` (your sudo user on the VPS) below.
Commands on the VPS use `sudo` because you are not root.

## Repo changes (already done, commit and push them)
- `deploy/contabo/docker-compose.yml`: no Caddy container; the app is published on `127.0.0.1:8081`.
- `deploy/contabo/deploy.sh`: no longer pulls a `caddy` image.
- `.github/workflows/release-image.yml`: connects as `mezan-deploy@`.
- `deploy/contabo/mezan.caddy.example`: the site file for the host Caddy (step 11).

## On your Ubuntu machine
1. Point `<DOMAIN>` DNS at `<VPS_IP>`.
2. Create the deploy key (new, not the production one):
   ```bash
   ssh-keygen -t ed25519 -N "" -C "github-actions-staging" -f ~/.ssh/mezan_staging_deploy
   ```
3. Get the host key:
   ```bash
   ssh-keyscan -t ed25519 <VPS_IP>
   ```

## On GitHub: Settings → Environments → `contabo-staging`
4. Add three secrets:
   - `DEPLOY_HOST`: `<VPS_IP>` (same value the host key line starts with).
   - `DEPLOY_SSH_KEY`: whole contents of `~/.ssh/mezan_staging_deploy` (BEGIN/END lines included).
   - `DEPLOY_KNOWN_HOSTS`: the single line from step 3.

## On the VPS
5. Create the limited user:
   ```bash
   sudo adduser --disabled-password --comment "" mezan-deploy
   sudo install -o mezan-deploy -g mezan-deploy -m 700 -d /home/mezan-deploy/.ssh
   ```
6. Folders, then copy the repo's `deploy/contabo/` into `/opt/mezan/`.
   ```bash
   sudo mkdir -p /opt/mezan /srv/mezan/data /srv/mezan/pg/data
   sudo chown 1000:1000 /srv/mezan/data && sudo chmod 700 /srv/mezan/data
   ```
   On your Ubuntu machine, from the repo root (copies your local edits):
   ```bash
   rsync -av deploy/contabo/ <you>@<VPS_IP>:/tmp/mezan-deploy/
   ```
   On the VPS:
   ```bash
   sudo rsync -a /tmp/mezan-deploy/ /opt/mezan/ && rm -rf /tmp/mezan-deploy
   ls /opt/mezan    # must list ci-deploy.sh, deploy.sh, docker-compose.yml, mezan.caddy.example
   ```
7. Deploy script and sudoers (own file, so the existing `deploy` rule is untouched):
   ```bash
   sudo install -o root -g root -m 0755 /opt/mezan/ci-deploy.sh /usr/local/bin/mezan-ci-deploy
   echo 'mezan-deploy ALL=(root) NOPASSWD: /usr/local/bin/mezan-ci-deploy' | sudo tee /etc/sudoers.d/92-mezan-deploy
   sudo chmod 440 /etc/sudoers.d/92-mezan-deploy
   sudo visudo -c
   ```
8. Public key (`~/.ssh/mezan_staging_deploy.pub`) into `/home/mezan-deploy/.ssh/authorized_keys`, one line, owner `mezan-deploy`, mode `0600`:
   ```
   restrict,command="/usr/local/bin/mezan-ci-deploy" ssh-ed25519 AAAA... github-actions-staging
   ```
   ```bash
   sudo nano /home/mezan-deploy/.ssh/authorized_keys
   sudo chown mezan-deploy:mezan-deploy /home/mezan-deploy/.ssh/authorized_keys
   sudo chmod 600 /home/mezan-deploy/.ssh/authorized_keys
   ```
9. Env files, from the examples. Fill each in, generate secrets with `openssl rand -hex 32`. See `deploy/contabo/README.md` §4 for the values.
   ```bash
   cd /opt/mezan
   sudo cp .env.example /srv/mezan/env
   sudo cp shared.env.example /srv/mezan/shared.env
   sudo cp pg.env.example /srv/mezan/pg.env
   sudo cp backup/restic.env.example /srv/mezan/restic.env
   sudo chmod 600 /srv/mezan/env /srv/mezan/shared.env /srv/mezan/pg.env /srv/mezan/restic.env
   sudo nano /srv/mezan/env   # then the other three
   ```
   `MEZAN_ORIGIN_SECRET` goes in `shared.env` only (needed again in step 11).
10. Docker is already installed (the CRM script did it). Check for name clashes: `docker ps`, `docker network ls`.
11. Host Caddy site file:
    ```bash
    sudo cp /opt/mezan/mezan.caddy.example /etc/caddy/sites/mezan.caddy
    sudo nano /etc/caddy/sites/mezan.caddy   # replace <DOMAIN> and <MEZAN_ORIGIN_SECRET>
    sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
    ```
    Behind Cloudflare: also add the `trusted_proxies` block described at the top of that file to `/etc/caddy/Caddyfile`, above the `import` line.

## Deploy
12. Commit and push to the `staging` branch. The `deploy · staging` job should show the deploy log.
13. First login: owner password is in `/srv/mezan/data/platform-owner-password.txt`. Sign in at `https://<DOMAIN>/platform/login`, change it, then `sudo rm` the file.

## If it fails
- "Host key verification failed": `DEPLOY_KNOWN_HOSTS` wrong, or its address differs from `DEPLOY_HOST`.
- "Permission denied (publickey)": public key missing from `authorized_keys`, or private key pasted incomplete.
- Site not reachable: `sudo journalctl -u caddy -f`, `docker logs mezan`, `sudo tail /var/log/mezan-deploy.log`.

After the secrets are saved, delete the private key from your machine or keep it somewhere safe.
