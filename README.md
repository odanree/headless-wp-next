# headless-wp-next

A minimal, production-structured headless WordPress frontend built with **Next.js 15 App Router** (React 19).

Runs in **mock mode** by default — no WordPress install required. Swap in real WordPress credentials to connect to a live backend. Ships with a Varnish 7.3 origin cache, edge A/B assignment, and a strict CSP so the deployed header shape matches production headless-Next.js stacks. See [`docs/adr/`](docs/adr/) for per-decision write-ups.

---

## What this demonstrates

| Concept | Where |
|---|---|
| Edge Middleware — auth gate + A/B assignment | [`middleware.ts`](middleware.ts) |
| Edge A/B: cookie-bucketed, Server-rendered variants | [`lib/experiments.ts`](lib/experiments.ts) + [`lib/getVariant.ts`](lib/getVariant.ts) + [`app/HeroCopy.tsx`](app/HeroCopy.tsx) |
| httpOnly cookie session | [`app/checkout/success/page.tsx`](app/checkout/success/page.tsx) |
| Stripe Checkout + webhook fulfillment | [`app/api/checkout/route.ts`](app/api/checkout/route.ts) + [`app/api/webhooks/stripe/route.ts`](app/api/webhooks/stripe/route.ts) |
| Server Component data fetching (Next 15 async APIs) | [`app/members/page.tsx`](app/members/page.tsx) |
| Server + Client Component composition | `page.tsx` (SC) + `LogoutButton.tsx` (CC) |
| Mock → live data swap | [`lib/wordpress.ts`](lib/wordpress.ts) |
| Two-layer cache: ISR (edge) + Varnish (origin) | [`lib/wordpress.ts`](lib/wordpress.ts) + [`varnish/default.vcl`](varnish/default.vcl) + [`app/api/revalidate/route.ts`](app/api/revalidate/route.ts) |
| Origin coalescing + grace mode (5m TTL + 60s grace) | [`varnish/default.vcl`](varnish/default.vcl) |
| Strict `default-src 'none'` CSP + HSTS + COOP + FLoC opt-out | [`next.config.js`](next.config.js) |
| WordPress CPT + Bearer token REST API | [`wordpress-plugin/headless-wp-members.php`](wordpress-plugin/headless-wp-members.php) |
| Member CPT — customer records outside WP Users | [`wordpress-plugin/headless-wp-members.php`](wordpress-plugin/headless-wp-members.php) |
| Lazy SDK init (build-time safety) | [`app/api/webhooks/stripe/route.ts`](app/api/webhooks/stripe/route.ts) |
| generateStaticParams build resilience | [`app/article/[id]/page.tsx`](app/article/%5Bid%5D/page.tsx) |
| Semantic HTML & ADA focus management | [`app/join/JoinForm.tsx`](app/join/JoinForm.tsx) + [`app/members/LogoutButton.tsx`](app/members/LogoutButton.tsx) |

---

## Request flow

```
Browser
  │
  ├─ GET *  (any human-facing route)
  │      ▼  (Vercel Edge — before any page renders)
  │   middleware.ts
  │      ├─ Auth (matched on /article/*, /members/*):
  │      │    no member_token cookie ──▶ 307 /join?redirectBack=...
  │      │    cookie present          ──▶ forward via x-member-token header
  │      │
  │      └─ Experiments (every matched route):
  │           read `exp` cookie
  │           roll variants for any registered experiment missing one
  │           stamp cookie (90d, SameSite=Lax) + forward assignment
  │           via `x-experiment` header — Server Components read this
  │           instead of reparsing cookies. See lib/experiments.ts.
  │
  ├─ POST /api/checkout
  │      └─ creates Stripe Checkout Session → returns { url }
  │         client redirects to stripe.com hosted page
  │         (card data never crosses our server — SAQ-A PCI scope)
  │
  ├─ stripe.com (hosted checkout)
  │      ├─ [async] POST /api/webhooks/stripe
  │      │         event: checkout.session.completed
  │      │         verified via stripe.webhooks.constructEvent()
  │      │         → POST /wp-json/headless/v1/grant-membership
  │      │            finds-or-creates Member CPT post by email
  │      │            stores stripe_session_id + membership_granted_at
  │      │
  │      └─ GET /api/auth/stripe-callback?session_id=cs_...
  │                stripe.checkout.sessions.retrieve() — server-side only
  │                guard: payment_status === 'paid'
  │                Set-Cookie: member_token=stripe:<session_id>; HttpOnly; Secure
  │                → 307 /checkout/success
  │
  ├─ GET /members or /article/*  (authenticated)
  │      ▼
  │   middleware.ts  (auth + experiment stamp — as above)
  │      ▼
  │   Server Component  →  lib/wordpress.ts
  │      ├─ WORDPRESS_URL not set ──▶ lib/mock-data.ts (instant, mock mode)
  │      └─ WORDPRESS_URL set ──────▶ fetch() → Varnish (origin cache)
  │                                         5m TTL + 60s grace + coalescing
  │                                    ──▶ Apache/PHP → WordPress REST API
  │                                         Authorization: Bearer <token>
  │                                         next: { revalidate: 300, tags: ['articles'] }
  │
  └─ POST /api/revalidate  (fired by WP save_post hook)
         │  { secret, tags: ['articles', 'public-articles', 'article-<id>'] }
         ├─ revalidateTag() — instant Vercel edge cache bust
         └─ BAN X-Cache-Tag: <tag>  ──▶ Varnish origin cache eviction
                                       (fire-and-forget; Varnish outage
                                        falls through to 5m TTL backstop)
```

---

## Quick start

```bash
# 1. Install
cd headless-wp-next
npm install

# 2. Copy env file (mock mode works without any changes)
cp .env.example .env.local

# 3. Run
npm run dev
```

Open [http://localhost:3004](http://localhost:3004).

- Click **Members Articles →** — you'll be redirected to Sign In (no cookie yet)
- Sign in with any username + password `members-only-2026`
- Browse the 5 mock articles, click into any to read the full content
- Sign out via the button in the header

---

## Connecting to real WordPress

### 1. Install the plugin

```bash
cp wordpress-plugin/headless-wp-members.php /path/to/wp-content/plugins/headless-wp-members/headless-wp-members.php
```

Activate in **WP Admin → Plugins**.

### 2. Configure wp-config.php

```php
define( 'HEADLESS_API_TOKEN', 'your-secret-token' );

// Optional — enables on-demand cache busting when articles are saved
define( 'NEXT_REVALIDATE_URL', 'https://your-next-app.vercel.app/api/revalidate' );
define( 'REVALIDATION_SECRET', 'your-revalidation-secret' );
```

### 3. Update .env.local

```env
WORDPRESS_URL=https://your-wp-site.com
WORDPRESS_API_TOKEN=your-secret-token
DEMO_MEMBER_PASSWORD=your-login-password

# Optional — needed for on-demand revalidation
REVALIDATION_SECRET=your-revalidation-secret
```

### 4. Create some Member Articles

WP Admin → **Member Articles** → Add New. The `article_category` and `read_time` custom fields are used by the API; they're optional (defaults to `General` / auto-calculated).

---

## Deploying

### Vercel (Next.js frontend)

1. Push to GitHub
2. **Vercel → Add New Project** → import the repo
3. Framework: **Next.js** (auto-detected)
4. Add environment variables (at minimum `DEMO_MEMBER_PASSWORD`)
5. Deploy

In mock mode (no `WORDPRESS_URL` set), the Vercel deployment works out of the box.

### Hetzner (WordPress backend)

The WordPress side of a live deployment runs on a Hetzner VPS — LEMP stack with Varnish 7.3 fronting Apache, and the `headless-wp-members.php` plugin dropped into `wp-content/plugins/`. Vercel is the front, Hetzner is the back; the two talk over the WP REST API with a Bearer token stored server-side. Route DNS at `cms.<your-domain>.com` → Varnish → Apache.

The plugin uses **blocking `wp_remote_post`** for revalidation calls so PHP-FPM guarantees the request is delivered before returning — non-blocking left the ISR cache stale intermittently under load.

### Password-based re-login (returning members)

A returning customer whose Stripe cookie has expired can re-authenticate with a password set at checkout ([`app/checkout/set-password/`](app/checkout/set-password/) + [`app/api/auth/set-password/`](app/api/auth/set-password/route.ts)), which issues a fresh httpOnly cookie without another Stripe round-trip.

---

## Senior Architectural Trade-offs

> These are the decisions worth articulating in an interview — not just "what did you build" but "why did you build it this way."

### Webhook as source of truth — not the success page redirect

The `/checkout/success` page only runs if the user's browser completes the round-trip from Stripe. If the tab is closed mid-redirect, the payment is captured but the cookie is never set. The `/api/webhooks/stripe` endpoint fires from Stripe's infrastructure **regardless of browser state** — tab closed, network dropped, ad blocker, anything. This is why the webhook is treated as the authoritative fulfillment path, with the success page redirect as a UX convenience on top.

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the full two-stage design, a side-by-side security comparison, and interview talking points on JWT revocation, PCI scope, and why the webhook is the source of truth.

### Member CPT vs. WP Users for customer records

Paying customers are stored as **Member custom post type records** in WordPress, not as WP user accounts. Each Member post has `member_email`, `stripe_session_id`, and `membership_granted_at` in post meta — visible in WP Admin → Members, completely separate from the Users list.

The reasons:
1. **No WP login needed** — customers authenticate via Stripe cookie, never via WP credentials. Creating a WP user account implies a login workflow that doesn't exist here.
2. **Role safety** — `set_role('subscriber')` blindly overwrites any existing role, which demoted an admin account during development before this design was adopted.
3. **Clean admin surface** — customer records don't pollute the Users list, which is reserved for content authors and admins.

The access check remains purely cookie-based — the Member CPT is an audit trail, not an auth store.

---

### Why REST over GraphQL?

Chosen for this PoC to demonstrate **native WordPress capability without installing a third-party plugin**. The WP REST API ships with every WordPress install since 4.7 — zero additional dependencies.

That said, **WPGraphQL is the better choice for production** when the data model is relational — e.g., articles with nested authors, tags, related posts, and featured media all in one request. REST requires N+1 round-trips; GraphQL collapses them into one.

**Interview answer:** "I'd default to REST for a quick integration or when minimizing plugin footprint, and move to WPGraphQL when the frontend starts making multiple sequential fetches for related data."

---

### Why Edge Middleware for auth?

Middleware runs **before the router resolves** — the request is bounced before any Server Component executes, any database is queried, or any bundle is sent. For a membership gate, this is the cheapest possible security layer.

The trade-off: Edge Middleware must stay lightweight (1MB code limit, no long-running operations). The current implementation is O(1) — just a cookie read. If the access check requires a live DB call (e.g., verify membership is still active), that logic belongs in the **Server Component**, not the middleware. The middleware verifies the JWT *signature*; the Server Component checks *permissions*.

---

### Why httpOnly cookies over localStorage?

localStorage is readable by any JavaScript on the page — including third-party analytics, chat widgets, or injected ad scripts. An httpOnly cookie is **invisible to JavaScript entirely**; only the browser's HTTP layer attaches it to requests.

For an organization where XSS via a compromised third-party script is a real threat surface, httpOnly cookies are not optional.

---

### Why ISR over SSR or SSG?

| | SSG | SSR | ISR (chosen) |
|---|---|---|---|
| Performance | Best | Worst | Near-SSG |
| Freshness | Stale until redeploy | Always fresh | Fresh within TTL |
| Server load | Zero | Every request | Cache misses only |
| On-demand bust | No | N/A | Yes — `revalidateTag()` |

ISR with `revalidateTag()` gives SSG-level performance while allowing a WordPress `save_post` hook to bust the cache in milliseconds — no redeploy, no polling.

---

### Why Varnish at the origin (not just Vercel's edge cache)?

Vercel handles the edge — CDN-side caching per region, `revalidateTag()` invalidation, per-tag purge. But when the edge cache expires and the background regeneration fires, that request hits Apache → PHP → MySQL directly. Under a popular tag expiring at the same second, that's N simultaneous MySQL queries from the same Vercel POP: classic thundering herd.

Varnish 7.3 sits between Next.js's fetch client and Apache with three defence-in-depth properties:

1. **Request coalescing** — a single origin fetch per URL regardless of concurrency. If ten simultaneous requests hit the same expired key, nine wait for the tenth.
2. **Grace mode (60s)** — while a background refetch runs, everyone else gets the stale copy immediately. No wait state.
3. **Tag-based BAN invalidation** — `/api/revalidate` fires a sibling `BAN X-Cache-Tag: <tag>` alongside `revalidateTag()`, so edge + origin evict in lockstep. Fire-and-forget: Varnish outage falls through to the 5m TTL as an automatic backstop. Edge revalidation never blocks on it.

ACL is scoped to the Docker network + RFC1918 ranges — Varnish's admin port is never internet-facing. See [`docs/adr/002-varnish-origin-cache.md`](docs/adr/002-varnish-origin-cache.md) for the full VCL rationale.

---

### Why edge A/B assignment (not client-side JS)?

Client-side A/B swap flashes the control variant, hydrates, then repaints to the assigned variant. That flash tanks the experiment's signal — users see (and react to) content that isn't the variant they were bucketed into.

The pattern here is **write at the edge, read at the server**:

- **Edge write** — `middleware.ts` reads the `exp` cookie on every matched request. For any registered experiment missing a variant, it rolls one via weighted random and stamps a 90-day `SameSite=Lax` cookie. The full assignment is forwarded on the request as an `x-experiment` header.
- **Server read** — Server Components call `getVariant('exp_id')` from [`lib/getVariant.ts`](lib/getVariant.ts). That reads the header via `headers()` and falls back to the control variant when the header is missing — deterministic rendering, no `undefined` in JSX.

Adding an experiment is a one-line change to the [`EXPERIMENTS`](lib/experiments.ts) registry. Middleware picks it up on the next request without any middleware edit. Retiring an experiment: remove the entry — old cookie values become no-ops without breaking anything. Full rationale in [`docs/adr/003-edge-ab-assignment.md`](docs/adr/003-edge-ab-assignment.md).

---

### Why strict CSP with an explicit per-directive allowlist?

CSP is the defence-in-depth layer for markup injection. Even if a bug lets an attacker slip a `<script>` into a WordPress-authored article body, CSP prevents that script from executing, phoning home, or loading remote assets outside what's explicitly trusted.

The policy is written as a JS object in [`next.config.js`](next.config.js) — declaring each directive as an array makes adding a third-party (analytics, chat widget) a one-line edit that shows exactly what's being trusted in the diff. Baseline is `default-src 'none'`; every capability is opted in.

Deliberately deferred: `'strict-dynamic'` + per-request nonces. That needs the RSC serializer to thread a nonce through every inline `<script>` — a follow-up PR once we've audited the script emit paths. Written up in [`docs/adr/004-security-headers-csp.md`](docs/adr/004-security-headers-csp.md).

Companion headers (also in `next.config.js`): HSTS 2y + preload, `X-Frame-Options DENY`, `X-Content-Type-Options nosniff`, `Referrer-Policy strict-origin-when-cross-origin`, `Permissions-Policy` denying camera/mic/geo + FLoC opt-out, `Cross-Origin-Opener-Policy same-origin`.

---

### WooCommerce integration path

The current auth flow issues a single httpOnly cookie. WooCommerce's Store API (`/wp-json/wc/store/v1/cart`) authenticates via WordPress Nonces. The extension path is:
1. On login, fetch a nonce from the WP REST API using the admin Bearer token (server-side only)
2. Store it as a second httpOnly cookie: `woo_nonce`
3. All WooCommerce Cart API calls forward it as `X-WP-Nonce`

The customer's credentials never touch client-side JS at any step.

---

### Accessibility — Semantic HTML & ADA focus management

Targets WCAG 2.1 AA-level patterns for the interactive surfaces; not third-party audited.

- `aria-live="assertive"` on the login error region announces failures immediately to screen readers without requiring focus shift
- `aria-busy` on the submit button signals to assistive technology that a network request is in-flight
- All form inputs use `<label>` elements with implicit `for` association (wrapping pattern) — no `placeholder`-only labelling
- `LogoutButton.tsx` carries an explicit `aria-label` so screen readers announce the action, not just "button"
- Color contrast ratios for all text/background pairings target WCAG AA (4.5:1 minimum)

---

## Project structure

```
headless-wp-next/
├── middleware.ts                    # Edge auth gate + A/B experiment assignment
├── next.config.js                   # Strict CSP + security headers via async headers()
├── docker-compose.yml               # WordPress + MySQL + Varnish 7.3 dev stack
├── vercel.json
├── .env.example
│
├── docs/
│   ├── ARCHITECTURE.md              # Two-stage auth + webhook-as-source-of-truth
│   ├── DEPLOYMENT.md                # Vercel + Hetzner + Stripe wiring
│   ├── LEARNINGS.md                 # Postmortems (unreachable-WP build resilience, etc.)
│   └── adr/                         # Architecture Decision Records (MADR)
│       ├── 001-production-shape-upgrade.md
│       ├── 002-varnish-origin-cache.md
│       ├── 003-edge-ab-assignment.md
│       └── 004-security-headers-csp.md
│
├── varnish/
│   └── default.vcl                  # Varnish 7.3 config: 5m TTL + 60s grace + BAN by tag
│
├── types/
│   └── wordpress.ts                 # Shared TypeScript interfaces
│
├── lib/
│   ├── mock-data.ts                 # 5 realistic articles — no WP needed
│   ├── wordpress.ts                 # WP REST client + mock fallback
│   ├── woocommerce.ts               # WooCommerce Store API client
│   ├── experiments.ts               # A/B registry + assignment helpers
│   └── getVariant.ts                # Server Component reader for x-experiment header
│
├── contexts/
│   └── CartContext.tsx              # Client-side cart state
│
├── wordpress-plugin/
│   └── headless-wp-members.php      # Drop-in WP plugin
│
├── scripts/
│   ├── do-verify.sh                 # Smoke test the WP + Next.js contract
│   └── wp-setup.sh                  # One-shot local WP configuration
│
└── app/
    ├── globals.css
    ├── layout.tsx                   # Async root layout (Next 15) — reads member cookie
    ├── NavBar.tsx
    ├── ArticleCard.tsx
    ├── HeroCopy.tsx                 # Server Component; renders assigned A/B variant
    ├── page.tsx                     # Public catalogue home
    │
    ├── api/
    │   ├── auth/login/route.ts
    │   ├── auth/logout/route.ts
    │   ├── auth/set-password/route.ts
    │   ├── auth/stripe-callback/route.ts   # Post-Stripe cookie issuance + redirect
    │   ├── checkout/route.ts               # Creates Stripe Checkout Session
    │   ├── revalidate/route.ts             # revalidateTag() + Varnish BAN
    │   └── webhooks/stripe/route.ts        # Signature-verified fulfillment
    │
    ├── article/[id]/
    │   └── page.tsx                 # Public article detail — dynamic params (Next 15)
    │
    ├── members/
    │   ├── page.tsx
    │   ├── LogoutButton.tsx
    │   └── [id]/page.tsx
    │
    ├── join/
    │   ├── page.tsx
    │   └── JoinForm.tsx
    │
    ├── cart/
    │   └── page.tsx
    │
    └── checkout/
        ├── success/page.tsx         # Post-Stripe success display (cookie is set upstream)
        └── set-password/page.tsx    # Re-login credential setup for returning members
```
