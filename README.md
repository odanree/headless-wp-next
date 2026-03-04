# headless-wp-next

A minimal, production-structured headless WordPress frontend built with **Next.js 14 App Router**.

Runs in **mock mode** by default — no WordPress install required. Swap in real WordPress credentials to connect to a live backend.

---

## What this demonstrates

| Concept | Where |
|---|---|
| Edge Middleware auth gate | [`middleware.ts`](middleware.ts) |
| httpOnly cookie session | [`app/api/auth/login/route.ts`](app/api/auth/login/route.ts) |
| Server Component data fetching | [`app/members/page.tsx`](app/members/page.tsx) |
| Server + Client Component composition | `page.tsx` (SC) + `LogoutButton.tsx` (CC) |
| Mock → live data swap | [`lib/wordpress.ts`](lib/wordpress.ts) |
| ISR + on-demand revalidation | [`lib/wordpress.ts`](lib/wordpress.ts) + [`app/api/revalidate/route.ts`](app/api/revalidate/route.ts) |
| WordPress CPT + Bearer token REST API | [`wordpress-plugin/headless-wp-members.php`](wordpress-plugin/headless-wp-members.php) |
| Semantic HTML & ADA focus management | [`app/join/JoinForm.tsx`](app/join/JoinForm.tsx) + [`app/members/LogoutButton.tsx`](app/members/LogoutButton.tsx) |

---

## Request flow

```
Browser
  │
  ├─ GET /members
  │      │
  │      ▼  (Edge — before any page loads)
  │   middleware.ts
  │      ├─ no cookie ──────────────▶ 302 /join?redirectBack=/members
  │      └─ cookie present
  │             │ injects x-member-token header
  │             ▼
  │   app/members/page.tsx  (Server Component)
  │             │  await getMemberArticles()
  │             ▼
  │   lib/wordpress.ts
  │             ├─ WORDPRESS_URL not set ──▶ lib/mock-data.ts (instant)
  │             └─ WORDPRESS_URL set ──────▶ fetch() → WordPress REST API
  │                                                 Authorization: Bearer <token>
  │                                                 next: { revalidate: 300, tags: ['articles'] }
  │
  ├─ POST /api/auth/login
  │      │  { username, password }
  │      └─ validates → Set-Cookie: member_token=<token>; HttpOnly; Secure
  │
  ├─ POST /api/auth/logout
  │      └─ Set-Cookie: member_token=; MaxAge=0
  │
  └─ POST /api/revalidate
         │  { tag: 'articles', secret: '...' }
         └─ revalidateTag('articles') — instant CDN cache bust
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

Open [http://localhost:3000](http://localhost:3000).

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

## Deploying to Vercel

1. Push to GitHub
2. **Vercel → Add New Project** → import the repo
3. Framework: **Next.js** (auto-detected)
4. Add environment variables (at minimum `DEMO_MEMBER_PASSWORD`)
5. Deploy

In mock mode (no `WORDPRESS_URL` set), the Vercel deployment works out of the box.

---

## Senior Architectural Trade-offs

> These are the decisions worth articulating in an interview — not just "what did you build" but "why did you build it this way."

### Demo vs. production membership: cookie simulation → JWT entitlement

The membership gate in this repo uses a verified Stripe session to set an httpOnly cookie — real server-side verification, but the access grant lives only in the browser. The production upgrade path moves to a **webhook-driven entitlement system** where:

1. `checkout.session.completed` writes membership status to WordPress User Meta (the IdP)
2. Login mints a signed JWT embedding membership claims + expiry
3. `middleware.ts` verifies the JWT at the Edge in ~0.1 ms — no database round-trip

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the full two-stage design, a side-by-side security comparison, and interview talking points on JWT revocation, PCI scope, and why the webhook is the source of truth.

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

### WooCommerce integration path

The current auth flow issues a single httpOnly cookie. WooCommerce's Store API (`/wp-json/wc/store/v1/cart`) authenticates via WordPress Nonces. The extension path is:
1. On login, fetch a nonce from the WP REST API using the admin Bearer token (server-side only)
2. Store it as a second httpOnly cookie: `woo_nonce`
3. All WooCommerce Cart API calls forward it as `X-WP-Nonce`

The customer's credentials never touch client-side JS at any step.

---

### ADA / WCAG 2.1 compliance approach

- `aria-live="assertive"` on the login error region announces failures immediately to screen readers without requiring focus shift
- `aria-busy` on the submit button signals to assistive technology that a network request is in-flight
- All form inputs use `<label>` elements with implicit `for` association (wrapping pattern) — no `placeholder`-only labelling
- `LogoutButton.tsx` carries an explicit `aria-label` so screen readers announce the action, not just "button"
- Color contrast ratios for all text/background pairings target WCAG AA (4.5:1 minimum)

---

## Project structure

```
headless-wp-next/
├── middleware.ts                    # Edge auth gate
├── next.config.js
├── vercel.json
├── .env.example
│
├── types/
│   └── wordpress.ts                 # Shared TypeScript interfaces
│
├── lib/
│   ├── mock-data.ts                 # 5 realistic articles — no WP needed
│   └── wordpress.ts                 # WP REST client + mock fallback
│
├── wordpress-plugin/
│   └── headless-wp-members.php      # Drop-in WP plugin
│
└── app/
    ├── globals.css
    ├── layout.tsx
    ├── page.tsx                     # Public home
    ├── home.module.css
    │
    ├── api/
    │   ├── auth/login/route.ts      # Issues httpOnly cookie
    │   ├── auth/logout/route.ts     # Expires cookie
    │   └── revalidate/route.ts      # On-demand ISR cache bust
    │
    ├── members/
    │   ├── page.tsx                 # Protected article listing (Server Component)
    │   ├── members.module.css
    │   ├── LogoutButton.tsx         # 'use client' — SC+CC composition demo
    │   └── [id]/
    │       ├── page.tsx             # Article detail (Server Component)
    │       └── article.module.css
    │
    └── join/
        ├── page.tsx                 # Server Component — passes redirectBack to form
        ├── JoinForm.tsx             # 'use client' — CTA + login form
        └── join.module.css
```
