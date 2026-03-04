# Deployment Guide — Headless WP + Next.js on DigitalOcean

**Stack**: WordPress (DO Droplet, WordOps) → Next.js (Vercel)

---

## Architecture Overview

```
Browser
  │
  ├── Static/ISR pages ──→ Vercel CDN (Next.js 14)
  │                              │
  │                              │  fetch() with Bearer token
  │                              ▼
  │                    WordPress REST API
  │                    (DO Droplet, WordOps)
  │                              │
  │                              │  save_post hook → POST /api/revalidate
  │                              └──────────────────────────────────────▶ Vercel
  │
  ├── /join  ──→ Stripe Checkout Session
  │                              │
  │                              │  Stripe webhook → /api/webhooks/stripe
  │                              │  → POST /wp-json/headless/v1/grant-membership
  │                              │
  │              /api/auth/stripe-callback?session_id=...
  │              (sets member_token httpOnly cookie)
  │                              │
  └── /members ──→ Edge Middleware checks cookie ──→ serve or redirect /join
```

---

## Part 1 — DigitalOcean Droplet (WordPress)

### Step 1: Create the Droplet

1. Log into [cloud.digitalocean.com](https://cloud.digitalocean.com)
2. **Create** → **Droplets**
3. Settings:
   - **Image**: Ubuntu 24.04 LTS x64
   - **Plan**: Basic — Regular — **$12/mo** (2 GB RAM / 1 CPU / 50 GB SSD)
   - **Region**: pick closest to your users
   - **Authentication**: SSH Key (recommended) or Password
4. Click **Create Droplet**
5. Note the **Droplet IP** shown after creation

### Step 2: Point DNS to the Droplet

In your domain registrar or DNS provider, add an **A record**:

| Type | Name            | Value         | TTL   |
|------|-----------------|---------------|-------|
| A    | `cms`           | `<DROPLET_IP>`| 300   |

This makes `cms.yourdomain.com` point to your Droplet.  
Wait ~5 minutes for propagation before running the setup script.

### Step 3: SSH into the Droplet

```bash
ssh root@<DROPLET_IP>
```

### Step 4: Upload and Run `do-setup.sh`

From your **local machine**:

```bash
# Upload the scripts folder to the Droplet
scp scripts/do-setup.sh scripts/do-seed-articles.php root@<DROPLET_IP>:/root/

# SSH in and run setup
ssh root@<DROPLET_IP>
chmod +x /root/do-setup.sh
./do-setup.sh cms.yourdomain.com your-api-token https://your-app.vercel.app your-revalidation-secret
```

**What the script does (8 steps):**
1. System update
2. Installs WordOps (Nginx + PHP 8.2 + MySQL 8.0 + Redis + WP-CLI)
3. Creates WordPress site with SSL (Let's Encrypt)
4. Downloads and activates the `headless-wp-members` plugin
5. Injects `HEADLESS_API_TOKEN`, `NEXT_REVALIDATE_URL`, `REVALIDATION_SECRET` into `wp-config.php`
6. Flushes WordPress rewrite rules (enables pretty permalinks)
7. Copies `do-seed-articles.php` to `/root/` with the correct WP path
8. Configures UFW firewall (SSH + 80 + 443)

At the end, the script prints the Vercel env vars you need to add — **copy them**.

### Step 5: Complete the WordPress Wizard

Open in your browser:

```
https://cms.yourdomain.com/wp-admin/install.php
```

Fill in:
- **Site Title**: anything (e.g. "Headless WP Backend")
- **Admin Username** / **Password**: save these securely
- **Admin Email**: your email
- Click **Install WordPress**

### Step 6: Verify Plugin is Active

1. Log into `https://cms.yourdomain.com/wp-admin`
2. Go to **Plugins**
3. Confirm **Headless WP Members** is listed and **Active**

If it's not active, activate it manually. If it's missing, upload it:

```bash
scp wordpress-plugin/headless-wp-members.php \
  root@<DROPLET_IP>:/var/www/cms.yourdomain.com/htdocs/wp-content/plugins/headless-wp-members/
```

Then activate via WP Admin → Plugins.

### Step 7: Seed Demo Articles

On the Droplet:

```bash
php /root/do-seed-articles.php
```

Expected output:
```
Created #4 : Getting Started with Headless WordPress
Created #5 : Auth at the Edge: Next.js Middleware + httpOnly Cookies
Created #6 : ISR vs On-Demand Revalidation — When to Use Each
Created #7 : Server + Client Component Composition in the App Router
Created #8 : Exposing WordPress Custom Post Types via REST API

Done. Created: 5  Skipped (already existed): 0
```

Safe to re-run — duplicate slugs are skipped automatically.

---

## Part 2 — Vercel (Next.js)

### Step 8: Add Environment Variables in Vercel

In the [Vercel dashboard](https://vercel.com) → your project → **Settings** → **Environment Variables**, add:

| Variable | Value | Example |
|---|---|---|
| `WORDPRESS_URL` | `https://cms.yourdomain.com` | `https://cms.acme.com` |
| `WORDPRESS_API_TOKEN` | your API token | `my-secret-token-abc123` |
| `REVALIDATION_SECRET` | revalidation secret (printed by setup script) | `a3f8c2...` |
| `STRIPE_SECRET_KEY` | from Stripe Dashboard → Developers → API keys | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | from Stripe Dashboard → Webhooks | `whsec_...` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key | `pk_live_...` |
| `NEXT_PUBLIC_SITE_URL` | your Vercel deployment URL | `https://your-app.vercel.app` |

> **Note**: `WOOCOMMERCE_URL` is optional. Leave it unset if you're not using WooCommerce — the app silently falls back to mock product data.

### Step 9: Redeploy on Vercel

After adding env vars, trigger a redeployment:
- Vercel Dashboard → **Deployments** → **Redeploy** latest
- Or push a commit — Vercel auto-deploys on `main`

### Step 10: Register the Stripe Webhook

In [Stripe Dashboard](https://dashboard.stripe.com) → **Developers** → **Webhooks** → **Add endpoint**:

| Field | Value |
|---|---|
| **Endpoint URL** | `https://your-app.vercel.app/api/webhooks/stripe` |
| **Events** | `checkout.session.completed` |

After creating, copy the **Signing secret** (`whsec_...`) and add it to Vercel as `STRIPE_WEBHOOK_SECRET`.

---

## Part 3 — Verification

### Step 11: Run the Verifier

From your **local machine**:

```bash
chmod +x scripts/do-verify.sh
./do-verify.sh cms.yourdomain.com https://your-app.vercel.app your-api-token your-revalidation-secret
```

Expected output (all green):
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Headless WP → Next.js Deployment Verifier
 WordPress : https://cms.yourdomain.com
 Next.js   : https://your-app.vercel.app
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

── WordPress ────────────────────────────────────────
✓ WP REST API root reachable — HTTP 200
✓ Public articles endpoint (no auth) — HTTP 200
  Articles returned: 5
✓ Member articles endpoint (Bearer token) — HTTP 200
✓ Auth guard rejects bad token — HTTP 401
✓ grant-membership endpoint (Bearer token) — HTTP 200

── Next.js / Vercel ─────────────────────────────────
✓ Next.js homepage reachable — HTTP 200
✓ Next.js /api/revalidate (tags: articles, public-articles) — HTTP 200
✓ Next.js /join page reachable — HTTP 200
✓ Next.js /members redirects unauthenticated users — HTTP 307

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ✓ All 10 checks passed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 12: End-to-End Checkout Test

1. Open `https://your-app.vercel.app/join`
2. Add a product to cart and click **Checkout**
3. Complete with Stripe test card `4242 4242 4242 4242` (any future expiry, any CVC)
4. Confirm redirect to `/checkout/success` with email displayed
5. Navigate to `/members` — you should be admitted (cookie set)
6. Check Stripe Dashboard → **Events** → confirm `checkout.session.completed` delivered
7. Check WP Admin → **Users** → confirm new user created with `subscriber` role

---

## Maintenance

### Updating the Plugin

```bash
# On the Droplet
scp wordpress-plugin/headless-wp-members.php \
  root@<DROPLET_IP>:/var/www/cms.yourdomain.com/htdocs/wp-content/plugins/headless-wp-members/headless-wp-members.php
```

No WordPress restart needed — PHP reads the file on each request.

### Clearing the Next.js Cache Manually

```bash
curl -X POST https://your-app.vercel.app/api/revalidate \
  -H "Content-Type: application/json" \
  -d '{"tags":["articles","public-articles"],"secret":"your-revalidation-secret"}'
```

### Renewing SSL (automatic)

WordOps sets up a `cron` job for Let's Encrypt renewal automatically. To check:

```bash
# On the Droplet
certbot certificates
```

### Droplet Backups

Enable in DO Control Panel → your Droplet → **Backups** → **Enable** (adds ~20% to Droplet cost). Recommended for production.

---

## Environment Variables Reference

### WordPress (`wp-config.php` constants — injected by `do-setup.sh`)

| Constant | Purpose |
|---|---|
| `HEADLESS_API_TOKEN` | Bearer token — Next.js includes this in every WP API request |
| `NEXT_REVALIDATE_URL` | `https://your-app.vercel.app/api/revalidate` — called on `save_post` |
| `REVALIDATION_SECRET` | Shared secret verified by `/api/revalidate` route |

### Next.js (Vercel environment variables)

| Variable | Required | Purpose |
|---|---|---|
| `WORDPRESS_URL` | Yes | `https://cms.yourdomain.com` |
| `WORDPRESS_API_TOKEN` | Yes | Must match `HEADLESS_API_TOKEN` in wp-config |
| `REVALIDATION_SECRET` | Yes | Must match `REVALIDATION_SECRET` in wp-config |
| `STRIPE_SECRET_KEY` | Yes | Stripe server-side key |
| `STRIPE_WEBHOOK_SECRET` | Yes | From Stripe Webhook dashboard |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Yes | Stripe client-side key |
| `NEXT_PUBLIC_SITE_URL` | Yes | Your Vercel URL (for Stripe `success_url`) |
| `WOOCOMMERCE_URL` | No | Only if WooCommerce is installed on the Droplet |
