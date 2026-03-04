#!/usr/bin/env bash
# ─── DigitalOcean WordPress Setup ────────────────────────────────────────────
#
# Provisions a fresh Ubuntu 24.04 Droplet as a headless WordPress backend.
# Installs: Nginx, PHP 8.2, MySQL, Redis, WP-CLI, SSL (Let's Encrypt)
# Uses WordOps for the server stack — battle-tested, one command per site.
#
# Usage (run as root after SSH into your Droplet):
#   chmod +x do-setup.sh
#   ./do-setup.sh cms.yourdomain.com your-api-token
#
# Prerequisites:
#   1. Droplet created (Ubuntu 24.04, Basic $12/mo, any region)
#   2. A record: cms.yourdomain.com → Droplet IP (propagation ~5 min)
#   3. Port 80+443 reachable (DO Cloud Firewall or ufw)
#
# What runs after this script:
#   1. Open http://cms.yourdomain.com/wp-admin/install.php (WP setup wizard)
#   2. Run: php /root/do-wp-config.php
#   3. Run: php /root/do-seed-articles.php
#   4. Run: ./do-verify.sh cms.yourdomain.com https://your-vercel-app.vercel.app your-api-token

set -euo pipefail

DOMAIN="${1:-}"
API_TOKEN="${2:-}"
NEXT_URL="${3:-https://your-vercel-app.vercel.app}"
REVALIDATION_SECRET="${4:-$(openssl rand -hex 24)}"

if [[ -z "$DOMAIN" || -z "$API_TOKEN" ]]; then
  echo "Usage: ./do-setup.sh <domain> <api-token> [next-url] [revalidation-secret]"
  echo "Example: ./do-setup.sh cms.example.com my-secret-token https://example.vercel.app"
  exit 1
fi

WP_PATH="/var/www/${DOMAIN}/htdocs"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Headless WP → Next.js DO Setup"
echo " Domain       : $DOMAIN"
echo " WP Path      : $WP_PATH"
echo " Next.js URL  : $NEXT_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. System update ──────────────────────────────────────────────────────────
echo "[1/8] Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

# ── 2. Install WordOps ────────────────────────────────────────────────────────
# WordOps installs Nginx, PHP 8.2, MySQL 8.0, Redis, WP-CLI, Certbot
echo "[2/8] Installing WordOps..."
if ! command -v wo &>/dev/null; then
  curl -sSL https://wordops.net/install | bash
  source /etc/profile.d/wordops.sh 2>/dev/null || true
fi

# ── 3. Create WordPress site with Redis ───────────────────────────────────────
echo "[3/8] Creating WordPress site: $DOMAIN ..."
wo site create "$DOMAIN" --wp --php82 --redis --letsencrypt

# ── 4. Install the headless plugin ───────────────────────────────────────────
echo "[4/8] Installing headless-wp-members plugin..."
PLUGIN_DIR="${WP_PATH}/wp-content/plugins/headless-wp-members"
mkdir -p "$PLUGIN_DIR"

# Attempt to download from GitHub (update this URL to your actual repo)
PLUGIN_SRC="https://raw.githubusercontent.com/YOUR_GITHUB_USER/headless-wp-next/master/wordpress-plugin/headless-wp-members.php"
if curl -fsSL "$PLUGIN_SRC" -o "${PLUGIN_DIR}/headless-wp-members.php" 2>/dev/null; then
  echo "  Plugin downloaded from GitHub."
else
  echo "  ⚠ Could not fetch from GitHub. Upload manually:"
  echo "    scp ./wordpress-plugin/headless-wp-members.php root@DROPLET_IP:${PLUGIN_DIR}/"
fi

# Activate via WP-CLI
cd "$WP_PATH" && \
  wp plugin activate headless-wp-members --allow-root 2>/dev/null && \
  echo "  Plugin activated." || \
  echo "  ⚠ Activate manually: WP Admin → Plugins → Headless WP Members"

# ── 5. Inject wp-config constants ─────────────────────────────────────────────
echo "[5/8] Injecting wp-config.php constants..."
cat > /root/do-wp-config.php <<PHPSCRIPT
<?php
// Injected by do-setup.sh — $(date)
\$config_file = '${WP_PATH}/wp-config.php';
\$marker      = "/* That's all, stop editing!";
\$inject      = <<<'CONSTANTS'
define( 'HEADLESS_API_TOKEN',    '${API_TOKEN}' );
define( 'NEXT_REVALIDATE_URL',   '${NEXT_URL}/api/revalidate' );
define( 'REVALIDATION_SECRET',   '${REVALIDATION_SECRET}' );
CONSTANTS;

\$content = file_get_contents(\$config_file);
if (strpos(\$content, 'HEADLESS_API_TOKEN') !== false) {
    echo "Constants already present — skipping.\n";
    exit(0);
}
\$content = str_replace(\$marker, \$inject . "\n" . \$marker, \$content);
file_put_contents(\$config_file, \$content);
echo "wp-config.php updated.\n";
PHPSCRIPT

php /root/do-wp-config.php

# ── 6. Flush rewrite rules ────────────────────────────────────────────────────
echo "[6/8] Flushing WordPress rewrite rules..."
cd "$WP_PATH" && \
  wp rewrite structure '/%postname%/' --allow-root && \
  wp rewrite flush --allow-root && \
  echo "  Rewrites flushed."

# ── 7. Copy seed script ───────────────────────────────────────────────────────
echo "[7/8] Copying article seed script to /root/..."
SEED_SCRIPT="$(dirname "$0")/do-seed-articles.php"
if [[ -f "$SEED_SCRIPT" ]]; then
  sed "s|/var/www/html/wp-load.php|${WP_PATH}/wp-load.php|g" \
    "$SEED_SCRIPT" > /root/do-seed-articles.php
  echo "  Seed script ready at /root/do-seed-articles.php"
  echo "  Run: php /root/do-seed-articles.php"
else
  echo "  ⚠ do-seed-articles.php not found — upload it manually."
fi

# ── 8. Firewall ───────────────────────────────────────────────────────────────
echo "[8/8] Configuring UFW firewall..."
ufw --force enable
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw status

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " ✓ Server setup complete"
echo ""
echo " NEXT STEPS:"
echo "   1. Complete WP wizard: https://${DOMAIN}/wp-admin/install.php"
echo "   2. Log into WP Admin and verify the plugin is active"
echo "   3. Run: php /root/do-seed-articles.php"
echo "   4. Add to Vercel environment variables:"
echo "        WORDPRESS_URL=${DOMAIN}"
echo "        WORDPRESS_API_TOKEN=${API_TOKEN}"
echo "        REVALIDATION_SECRET=${REVALIDATION_SECRET}"
echo "        NEXT_REVALIDATE_URL=${NEXT_URL}/api/revalidate"
echo "   5. Run: ./do-verify.sh ${DOMAIN} ${NEXT_URL} ${API_TOKEN}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
