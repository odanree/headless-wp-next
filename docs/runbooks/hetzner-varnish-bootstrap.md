# Runbook — Hetzner Varnish bootstrap

One-time setup so `.github/workflows/deploy-varnish-hetzner.yml` can hot-reload `varnish/default.vcl` on every push to `master`.

**Pattern:** GitHub Actions → SSH deploy key → `scp` new VCL → `varnishadm vcl.load` / `vcl.use` graceful reload. No downtime, no dropped requests.

Assumes: Debian 12 (Bookworm) or Ubuntu 22.04+ on the Hetzner VPS, Apache already listening for WordPress traffic, DNS `cms.<your-domain>.com` → this VPS.

---

## 1. Install Varnish on the VPS

```bash
ssh <you>@<vps>

# Debian's `varnish` package ships version 7.x on Bookworm+, matching the
# 7.3-alpine image used in dev.
sudo apt update
sudo apt install -y varnish varnish-modules

# Confirm version — must be 7.x for the VCL syntax level in this repo.
varnishd -V
```

Expected: `varnishd (varnish-7.x.x ...)`.

## 2. Move Apache off :80, hand :80 to Varnish

Varnish sits in front of Apache. Apache listens on `127.0.0.1:8080` (loopback only, not internet-facing); Varnish binds `:80` and forwards misses/PURGE to Apache.

```bash
# Apache config — change Listen 80 → Listen 127.0.0.1:8080
sudo sed -i 's/^Listen 80$/Listen 127.0.0.1:8080/' /etc/apache2/ports.conf
sudo sed -i 's|<VirtualHost \*:80>|<VirtualHost 127.0.0.1:8080>|' /etc/apache2/sites-enabled/*.conf

# Test + reload
sudo apachectl configtest
sudo systemctl reload apache2

# Confirm Apache is off :80
sudo ss -tlnp | grep ':80 '   # should be empty
sudo ss -tlnp | grep ':8080'  # should show apache2
```

## 3. Configure Varnish to bind :80 and use the repo VCL

```bash
# systemd override — Varnish's default is :6081; we want :80.
sudo mkdir -p /etc/systemd/system/varnish.service.d
sudo tee /etc/systemd/system/varnish.service.d/override.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/sbin/varnishd \
  -a :80 \
  -a localhost:6082,PROXY \
  -f /etc/varnish/default.vcl \
  -s malloc,256m \
  -T localhost:6082 \
  -p feature=+http2 \
  -j unix,user=vcache
EOF

sudo systemctl daemon-reload
```

## 4. VCL topology — two files in the repo

Two VCLs live in `varnish/`:

- `varnish/default.vcl` — dev topology (backend = `wordpress:80`, a docker-compose service name). Used by the local `docker compose up` stack.
- `varnish/hetzner.vcl` — prod topology (backend = `127.0.0.1:8080`, Apache on this VPS). What the GitHub Actions workflow ships to this box.

The workflow `scp`s `varnish/hetzner.vcl` to `/tmp/varnish-deploy/hetzner.vcl`, validates it against the installed `varnishd`, and atomically `install`s it to `/etc/varnish/default.vcl` (the path the systemd override points at). No repo-side edit required.

**Only the backend block and PURGE ACL differ between the two files.** Everything else (grace mode, cookie-strip rules, PURGE/BAN handling, `vcl_deliver` cache-hit visibility) is identical. Change policy in both when policy changes — or refactor to share via `include` if the two drift.

## 5. First-run start + smoke

```bash
sudo systemctl enable --now varnish
sudo systemctl status varnish --no-pager --lines=10

# Smoke — first request is MISS, second is HIT
curl -sI http://127.0.0.1/wp-json/ | grep -iE 'X-Cache|X-Varnish|Via'
curl -sI http://127.0.0.1/wp-json/ | grep -iE 'X-Cache|X-Varnish|Via'
```

Expected on the second curl: `X-Cache: HIT`, `Via: 1.1 varnish (Varnish/7.x)`.

## 6. Set up the deploy key GitHub Actions will use

On the VPS, create a **deploy-only** SSH user (not `root`) with sudo rights scoped narrowly to `varnishadm`, `install`, `systemctl reload varnish`:

```bash
# 1. Create user + home
sudo adduser --disabled-password --shell /bin/bash gh-deploy

# 2. Generate a keypair for this repo/deploy only
ssh-keygen -t ed25519 -N '' -C 'gh-actions@headless-wp-next' -f ~/gh-deploy.ed25519

# 3. Authorize the public key
sudo mkdir -p /home/gh-deploy/.ssh
sudo tee /home/gh-deploy/.ssh/authorized_keys < ~/gh-deploy.ed25519.pub
sudo chown -R gh-deploy:gh-deploy /home/gh-deploy/.ssh
sudo chmod 700 /home/gh-deploy/.ssh
sudo chmod 600 /home/gh-deploy/.ssh/authorized_keys

# 4. Sudoers — narrowly scoped: only these binaries, no password prompt
sudo tee /etc/sudoers.d/gh-deploy <<'EOF'
gh-deploy ALL=(root) NOPASSWD: /usr/sbin/varnishadm, /usr/bin/install, /bin/systemctl reload varnish, /bin/systemctl status varnish, /usr/sbin/varnishd
EOF
sudo chmod 440 /etc/sudoers.d/gh-deploy
```

Now copy `~/gh-deploy.ed25519` (the private half) off the box — you'll paste it into GitHub Secrets in step 8. Delete it from the VPS after.

```bash
# Copy to your workstation
cat ~/gh-deploy.ed25519
# Then, on the VPS:
shred -u ~/gh-deploy.ed25519 ~/gh-deploy.ed25519.pub
```

## 7. Grab the host key fingerprint (prevents MITM)

The workflow uses strict host-key verification. Get the fingerprint from the VPS:

```bash
ssh-keyscan -t ed25519 <vps-hostname> 2>/dev/null | ssh-keygen -lf -
# Output looks like:  256 SHA256:aBcD...xyz <vps-hostname> (ED25519)
```

The `SHA256:aBcD...xyz` part is what GitHub Actions needs.

## 8. Set GitHub Actions secrets

At `https://github.com/odanree/headless-wp-next/settings/environments/hetzner-prod` create the environment (or reuse an existing one), then add these secrets:

| Secret | Value |
|---|---|
| `HETZNER_HOST` | The VPS hostname or IP (e.g. `cms.<your-domain>.com`) |
| `HETZNER_USER` | `gh-deploy` |
| `HETZNER_SSH_KEY` | Entire private key blob from step 6 (`-----BEGIN OPENSSH PRIVATE KEY-----` through the closing footer) |
| `HETZNER_HOST_FINGERPRINT` | `SHA256:aBcD...xyz` from step 7 (just the base64 hash portion) |
| `HETZNER_SSH_PORT` | *(optional)* if you moved sshd off `:22` |

Consider making the environment "Required reviewers" so a merge to master doesn't auto-deploy — you approve the run before it fires. Optional; skip for now if trust-your-CI is fine.

## 9. Verify the workflow end-to-end

Trigger a manual run first (`Actions` tab → `Deploy Varnish VCL to Hetzner` → `Run workflow`). The workflow:

1. Runs `varnishd -Cf` in a Docker image locally on the runner (syntax check before touching the VPS).
2. `scp`s `varnish/default.vcl` to `/tmp/varnish-deploy/` on the VPS.
3. Re-validates with the *installed* varnishd (catches version-specific module gotchas).
4. Atomic-`install`s to `/etc/varnish/default.vcl`.
5. `varnishadm vcl.load <label> && vcl.use <label>` — hot reload, no dropped connections.
6. Discards old VCL labels beyond the last two (keeps immediate rollback available).
7. Smoke-tests with `curl -sf http://127.0.0.1:80/wp-json/`.

Watch the run's Summary panel for the `VCL label` — that's what you'd `vcl.use` if you need to roll back.

## Rollback

Hot rollback (no restart, ~50ms):

```bash
sudo varnishadm vcl.list
# Look for `available` entries, most recent first.
sudo varnishadm vcl.use deploy-<earlier-timestamp>-<sha>
```

Full restart fallback (if the daemon itself is unhappy):

```bash
sudo systemctl restart varnish
```

Nuclear option — bypass Varnish, point DNS or a load balancer straight at Apache on `:8080` — is a whole-topology change, not a rollback.

## Ongoing ops

- **Cache stats:** `sudo varnishstat` (interactive TUI) or `varnishstat -1 -f MAIN.cache_hit,MAIN.cache_miss` for one-shot.
- **See what's cached:** `sudo varnishlog -q 'ReqURL ~ "/wp-json"'`.
- **Manually purge a URL:** `sudo varnishadm 'ban req.url == /wp-json/headless/v1/articles/123'`.
- **Manually purge a tag:** `sudo varnishadm 'ban obj.http.X-Cache-Tag ~ article-123'` — matches the tag-based invalidation the Next.js `/api/revalidate` route fires.
