# Runbook — Hetzner portfolio-varnish bootstrap

One-time setup so [`.github/workflows/deploy-varnish-hetzner.yml`](../../.github/workflows/deploy-varnish-hetzner.yml) can hot-reload `varnish/hetzner.vcl` into the `portfolio-varnish` container on every push to `master`.

**Pattern:** GitHub Actions → SSH → `docker cp` VCL into the container → `docker exec portfolio-varnish varnishadm vcl.load / vcl.use` graceful hot-reload. No downtime, no dropped requests.

**Topology:** Interposed origin cache. Caddy (`portfolio-caddy`, edge) → Varnish (`portfolio-varnish`, this container) → WordPress (`portfolio-wordpress`, origin) — all three attached to the shared Docker network `portfolio-infra_portfolio-net`. Service discovery is Docker DNS: Caddy sees `portfolio-varnish`, Varnish sees `wordpress`. No host loopback, no host-published ports, no cross-container port mapping.

Assumes: Debian/Ubuntu VPS with Docker + docker-compose. The [`portfolio-infra`](https://github.com/odanree/portfolio-infra) compose project at `/opt/portfolio-infra/` runs on this box.

---

## Prerequisite — merge the companion portfolio-infra PR

The `portfolio-varnish` container is defined in [`portfolio-infra` PR #21](https://github.com/odanree/portfolio-infra/pull/21). This runbook assumes that PR is merged and deployed. If it isn't yet:

```bash
ssh <you>@<vps>
cd /opt/portfolio-infra
git pull
docker compose up -d
docker ps | grep portfolio-varnish   # should show "Up X seconds"
```

Confirm `cms.<your-domain>` still resolves — Caddy's routing target flipped from `wordpress:80` to `portfolio-varnish:6081`, so if Varnish is broken the domain 502s.

Also retire the (now dangling) host-installed Varnish left over from an older topology:

```bash
sudo systemctl disable --now varnish
sudo apt purge varnish varnish-modules
```

## 1. Set up the deploy user

Deploy-only SSH user with `sudo` scoped narrowly to the `docker` binary (which is all the workflow needs — it invokes `docker cp`, `docker exec`, `docker ps`, `docker compose`).

```bash
# Create user + home
sudo adduser --disabled-password --shell /bin/bash gh-deploy

# Membership in docker group so `docker` doesn't need sudo
sudo usermod -aG docker gh-deploy

# Generate a keypair for THIS repo + THIS deploy only
ssh-keygen -t ed25519 -N '' -C 'gh-actions@headless-wp-next' -f ~/gh-deploy.ed25519

# Authorize the public key
sudo mkdir -p /home/gh-deploy/.ssh
sudo tee /home/gh-deploy/.ssh/authorized_keys < ~/gh-deploy.ed25519.pub
sudo chown -R gh-deploy:gh-deploy /home/gh-deploy/.ssh
sudo chmod 700 /home/gh-deploy/.ssh
sudo chmod 600 /home/gh-deploy/.ssh/authorized_keys

# Copy the private key OFF the box (you'll paste into GitHub Secrets)
cat ~/gh-deploy.ed25519
# After copying, delete from the VPS:
shred -u ~/gh-deploy.ed25519 ~/gh-deploy.ed25519.pub
```

**Docker group is powerful — treat this key as root-equivalent.** A user in the docker group can start any container with any bind mount, effectively giving them root on the host. That's why:

- The key is scoped to THIS repo and THIS workflow (no reuse for other automation).
- The workflow uses strict host-key verification (below) so a compromised DNS record can't MITM.
- The GitHub Environment (`hetzner-prod`) supports required-reviewer gating if you want approval-before-deploy.

## 2. Grab the host key fingerprint (prevents MITM)

The workflow uses strict host-key verification — no TOFU. Get the fingerprint from the VPS:

```bash
ssh-keyscan -t ed25519 <vps-hostname> 2>/dev/null | ssh-keygen -lf -
# Output looks like:  256 SHA256:aBcD...xyz <vps-hostname> (ED25519)
```

The `SHA256:aBcD...xyz` portion is what GitHub Actions needs.

## 3. Set GitHub Actions secrets

At `https://github.com/odanree/headless-wp-next/settings/environments/hetzner-prod` create the `hetzner-prod` environment, then add these secrets:

| Secret | Value |
|---|---|
| `HETZNER_HOST` | VPS hostname or IP (e.g. `cms.<your-domain>.com` — anything DNS-resolvable) |
| `HETZNER_USER` | `gh-deploy` |
| `HETZNER_SSH_KEY` | Entire private key blob from step 1 (`-----BEGIN OPENSSH PRIVATE KEY-----` through the closing footer) |
| `HETZNER_HOST_FINGERPRINT` | `SHA256:aBcD...xyz` from step 2 (just the base64 hash portion, not the whole `256 SHA256:… host (ED25519)` line) |
| `HETZNER_SSH_PORT` | *(optional)* if sshd is off `:22` |

Consider wiring "Required reviewers" on the `hetzner-prod` environment — one extra click per merge, but you're never surprised by a bad VCL going live automatically.

## 4. Verify the workflow end-to-end (dry run)

Manual dispatch first (`Actions` tab → `Deploy Varnish VCL to Hetzner (docker exec)` → `Run workflow`). The workflow:

1. Runs `varnishd -Cf` in a local `varnish:7.1-alpine` container — syntax check before touching the VPS. The `.host = "wordpress"` backend won't resolve at compile time, but that's fine (backend resolution is at `vcl.load` time on the VPS, where the docker-network DNS makes it resolvable).
2. `scp`s `varnish/hetzner.vcl` to `/tmp/varnish-deploy/hetzner.vcl` on the VPS.
3. SSH-in and:
   - Confirms `portfolio-varnish` is running (`docker ps` grep).
   - `docker cp` staged file → `portfolio-varnish:/etc/varnish/hot.vcl` (container-writable path, not bind-mounted).
   - Re-validates with the container's own `varnishd -Cf` (catches VMOD drift the local validator can't).
   - `varnishadm vcl.load <label> && vcl.use <label>` — hot reload, no dropped connections.
   - Discards old labels beyond the last two — keeps immediate rollback available.
   - Smoke curl `http://127.0.0.1:6081/wp-json/` inside the container.

Watch the run's Summary panel for the `VCL label` — that's what you'd `vcl.use` if you need to roll back.

## Rollback

**Hot rollback (~50ms, no restart, no dropped connections):**

```bash
docker exec portfolio-varnish varnishadm vcl.list
# Look for `available` entries, most recent first.
docker exec portfolio-varnish varnishadm vcl.use deploy-<earlier-timestamp>-<sha>
```

**Container restart fallback** (drops the workflow-loaded label, comes back on bootstrap VCL):

```bash
docker compose -f /opt/portfolio-infra/docker-compose.yml restart varnish
```

After that, either manual-dispatch the deploy workflow to reload the last known-good VCL, or leave Varnish on the pass-through bootstrap while you diagnose.

**Nuclear option** — bypass Varnish entirely: edit `/opt/portfolio-infra/caddy/Caddyfile`, change `cms.${DOMAIN}` back to `reverse_proxy wordpress:80`, `docker exec portfolio-caddy caddy reload --config /etc/caddy/Caddyfile`. Requests bypass Varnish; origin is exposed to the full traffic. Fine as a temporary bypass, not as a permanent stance.

## Ongoing ops

- **Cache stats:** `docker exec portfolio-varnish varnishstat -1 -f MAIN.cache_hit,MAIN.cache_miss,MAIN.client_req`
- **See what's cached (live tail):** `docker exec portfolio-varnish varnishlog -q 'ReqURL ~ "/wp-json"'`
- **Manually purge a URL:** `docker exec portfolio-varnish varnishadm 'ban req.url == /wp-json/headless/v1/articles/123'`
- **Manually purge a tag:** `docker exec portfolio-varnish varnishadm 'ban obj.http.X-Cache-Tag ~ article-123'` — matches the tag-based invalidation `/api/revalidate` fires alongside `revalidateTag()`.
- **List active + available VCLs:** `docker exec portfolio-varnish varnishadm vcl.list`
- **Discard a specific label:** `docker exec portfolio-varnish varnishadm vcl.discard <label>`
