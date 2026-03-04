# Architecture: Membership & Entitlement System

This document describes the two-stage design of the membership system: the **demo implementation** that ships in this repository, and the **production upgrade path** that would replace it in a real deployment.

The core problem is the same in both stages: *how do you cryptographically prove, at the CDN edge, that a request comes from a user who has paid — without blocking every request with a round-trip to a database?*

---

## Stage 1 — Demo: Redirect-Based Cookie Grant

### What ships in this repo

```
Browser
  │
  ├─ POST /api/checkout          (CartContext items → Stripe Checkout Session)
  │      └─ returns { url }  →  client redirects to stripe.com hosted page
  │
  ├─ stripe.com (hosted checkout) ──── card data never crosses our server
  │
  ├─ GET /checkout/success?session_id=cs_...
  │      │  [Server Component — runs on Node.js, not Edge]
  │      ├─ stripe.checkout.sessions.retrieve(sessionId)  ← server-side only
  │      ├─ guard: payment_status === 'paid'
  │      └─ Set-Cookie: member_token=stripe:<session_id>; HttpOnly; Secure
  │
  └─ GET /article/*
         │
         ▼  (Vercel Edge — before any page renders)
      middleware.ts
         ├─ no member_token cookie  ──▶  302 /join?redirectBack=...
         └─ cookie present          ──▶  forward via x-member-token header
                                         Server Component reads it directly
```

**Key files:**

| File | Role |
|---|---|
| [`app/api/checkout/route.ts`](../app/api/checkout/route.ts) | Creates Stripe Checkout Session, returns hosted URL |
| [`app/checkout/success/page.tsx`](../app/checkout/success/page.tsx) | Verifies paid session; mints `member_token` cookie |
| [`middleware.ts`](../middleware.ts) | Edge gate — O(1) cookie presence check |
| [`app/api/auth/login/route.ts`](../app/api/auth/login/route.ts) | Demo-only password login (returns 404 in production) |
| [`app/api/webhooks/stripe/route.ts`](../app/api/webhooks/stripe/route.ts) | Receives Stripe events; fulfillment TODOs live here |

### The critical edge case this design doesn't solve

The redirect success page (`/checkout/success`) only runs if the user's browser reaches it. If the tab is closed during the Stripe redirect, payment is captured by Stripe but the cookie is never set — the user paid and has no access.

The webhook (`POST /api/webhooks/stripe`) fires regardless of browser state. In this demo it logs the event; in production it becomes the source of truth.

---

## Stage 2 — Production: Webhook-Driven Entitlement + JWT

### The architectural shift: Client-Side Trust → Server-Side Authority

| Dimension | Demo (Stage 1) | Production (Stage 2) |
|---|---|---|
| Trust model | Cookie presence — easy to forge | JWT — cryptographically signed |
| Source of truth | Browser redirect completing | Stripe webhook writing to DB |
| Tab-close resilience | ✗ Payment without access | ✓ Webhook fires regardless |
| Expiry enforcement | 1-year cookie age (`maxAge`) | Checked at Edge on every request |
| Revocation | Requires cookie deletion | Flip `membership_active` in WP meta |
| WP as Identity Provider | Not used | User meta is the authoritative state |

### Production request flow

```
Stripe
  │
  ├─ [webhook] POST /api/webhooks/stripe
  │      │  event: checkout.session.completed
  │      │  verified via stripe.webhooks.constructEvent()  ← already implemented
  │      │
  │      ├─ Look up WP user by session.customer_details.email
  │      │     GET /wp-json/wp/v2/users?search=<email>  (admin Bearer token, server-side)
  │      │
  │      ├─ Write WP User Meta
  │      │     POST /wp-json/wp/v2/users/<id>
  │      │     body: { meta: { membership_active: true, membership_expires: <ISO date> } }
  │      │
  │      └─ 200 OK  (Stripe retries on non-2xx — idempotency matters here)
  │
Browser
  │
  ├─ POST /api/auth/login   { username, password }
  │      │  validates credentials against WP Application Password
  │      │
  │      ├─ Fetch user meta to verify membership_active === true
  │      │
  │      ├─ Mint JWT
  │      │     payload: { sub: userId, email, membershipActive: true, exp: <unix ts> }
  │      │     signed with HS256 / RS256 using JWT_SECRET
  │      │
  │      └─ Set-Cookie: member_token=<jwt>; HttpOnly; Secure; SameSite=Lax
  │
  └─ GET /article/*
         │
         ▼  (Vercel Edge)
      middleware.ts
         ├─ no cookie  ──▶  302 /join
         └─ cookie present
                ├─ jose.jwtVerify(token, secret)     ← ~0.1ms, no network
                ├─ check payload.membershipActive     ← embedded in token
                ├─ check payload.exp < Date.now()     ← expiry at Edge
                └─ allowed  ──▶  forward decoded claims via request header
                                  Server Component receives structured data
                                  without re-parsing the JWT
```

### Why WordPress as the Identity Provider

WordPress ships with a user management system, roles, and a REST API that exposes arbitrary user meta. Treating WP user meta as the entitlement store gives you:

1. **Single admin UI** — membership status visible and editable in WP Admin
2. **Revocation without code** — flip `membership_active: false` in WP to instantly revoke access on the next middleware check
3. **Audit trail** — WP stores meta change timestamps; every grant is traceable to a Stripe session ID

The webhook handler writes `membership_expires` alongside `membership_active`. The JWT embeds an `exp` claim matching this date. Middleware rejects expired tokens without any network call — the expiry is baked into the signed token.

---

## Stage 2 Variant — Implemented: Member CPT Instead of WP Users

In the production build of this repo, Stage 2's WP-as-IdP model was adapted: rather than creating WP user accounts for paying customers and storing entitlement in user meta, paying customers are stored as **Member custom post type records**.

### Why CPT over WP Users

| Concern | WP Users approach | Member CPT approach (implemented) |
|---|---|---|
| Auth mechanism | WP credentials + Application Password | Stripe cookie — no WP login |
| Role collision risk | `set_role()` overwrites existing roles | No roles involved |
| Admin surface | Customer accounts appear in Users list | Customers appear in Members CPT |
| Revocation | Delete/deactivate WP user | Delete Member post |
| Data ownership | Coupled to WP auth system | Fully independent |

The core insight: customers in this system **never authenticate via WordPress**. They authenticate via a Stripe-issued cookie. Creating a WP user account implies a WP login workflow that does not exist — it adds risk (role collisions, password reset emails, Users list pollution) with no benefit.

### Member CPT record structure

Each paying customer creates one `member` CPT post:
- **Post title**: customer email (for admin visibility)
- **`member_email`** meta: email address
- **`stripe_session_id`** meta: Stripe Checkout Session ID for audit/refund lookup
- **`membership_granted_at`** meta: UTC timestamp of fulfillment

Visible in **WP Admin → Members**. The Users list remains reserved for content authors and site admins.

### JWT upgrade path still applies

The cookie-based auth model (`member_token=stripe:<session_id>`) and the JWT upgrade described in Stage 2 above are **orthogonal to whether customers are WP users or CPT posts**. The JWT upgrade replaces the cookie value with a signed token — the membership store backing it can be either WP user meta or CPT post meta. The CPT approach actually simplifies the JWT upgrade: instead of looking up WP user meta, the `/api/auth/login` route would query the `member` CPT by email to verify an active membership before minting the token.

### JWT implementation detail

The middleware currently does:

```typescript
// Stage 1 (demo) — cookie presence only
const token = request.cookies.get('member_token')?.value;
if (!token) redirect('/join');
```

The Stage 2 upgrade is a drop-in replacement:

```typescript
import { jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.JWT_SECRET);
try {
  const { payload } = await jwtVerify(token, secret);
  if (!payload.membershipActive) return NextResponse.redirect('/join');
  // Inject claims for Server Components — no second parse needed
  const res = NextResponse.next();
  res.headers.set('x-membership-expires', String(payload.exp));
  return res;
} catch {
  // Expired or tampered token
  return NextResponse.redirect('/join');
}
```

`jose` is an Edge-compatible JWT library (no Node.js crypto module dependency). The `jwtVerify` call runs in ~0.1 ms — well within Vercel Edge's CPU budget.

The cookie value changes from `stripe:<session_id>` (auditable but not verifiable) to a signed JWT (verifiable without a DB call). The `Set-Cookie` mechanism is identical, so no browser-side changes are needed.

### WooCommerce nonce (cart session binding)

Covered in the login route comments. The production flow extends this:

1. On login, fetch a WordPress nonce server-side: `GET /wp-json/wp/v2/users/me`
2. Set a second httpOnly cookie: `woo_nonce=<nonce>; SameSite=Lax`
3. Every Route Handler that calls the WooCommerce Store API reads this cookie and forwards it as `X-WP-Nonce`

The nonce never appears in browser JS. A cross-origin attacker cannot read an httpOnly cookie, so this also functions as CSRF mitigation for cart mutations.

---

## Security properties comparison

### Cookie: `stripe:<session_id>` (Stage 1)

- **Not signed** — any string that `middleware.ts` finds in the `member_token` cookie grants access
- An attacker who can set a cookie (e.g., via subdomain cookie injection) gains access
- Mitigated partially by `HttpOnly` (no JS read) and `Secure` (HTTPS only), but the value itself carries no cryptographic proof

### Cookie: `<jwt>` (Stage 2)

- **HS256/RS256 signed** — the server refuses any token it did not sign
- Expiry is enforced at the Edge without a DB call
- Membership claims (active, expiry date, user ID) are embedded and integrity-protected
- Revocation gap: a JWT issued for 1 year remains valid until expiry even if WP meta is flipped. Mitigation: use short-lived tokens (15 min) + a refresh token pattern, or maintain a small revocation list in KV storage (Vercel KV / Upstash)

### PCI scope

Both stages qualify for **SAQ-A** — the lowest PCI DSS burden — because card data is handled exclusively on Stripe's hosted Checkout page. This is enforced by architecture: `/api/checkout` only creates a Checkout Session and returns a URL; it never handles card numbers.

---

## Interview talking points

**Q: Why not verify the Stripe session on every request instead of using a cookie?**

Stripe's API has rate limits (~100 req/s) and adds 200–400 ms latency. A CDN edge processes thousands of requests per second. Embedding the verification result in a signed JWT lets the Edge make the access decision in sub-millisecond time with zero external network calls — the same model used by every large-scale auth system (Google, GitHub, AWS IAM).

**Q: Why not store membership state in a cookie directly rather than JWT?**

An unsigned cookie is a promise the server made to itself with no way to verify it wasn't modified. A JWT is a verifiable claim — the signature proves the server issued it and the payload hasn't been altered. For anything that unlocks paid content, cryptographic proof is not optional.

**Q: What would you use for token revocation?**

Short-lived access tokens (15 min) backed by a long-lived refresh token stored in the DB (WP user meta or a Vercel KV store). On refresh, check `membership_active` in real time. This limits the revocation window to 15 minutes without adding latency to the hot path. At scale, a Redis-backed token blocklist handles immediate revocation when you need it.

**Q: Why is the webhook the source of truth rather than the success page redirect?**

The redirect only fires if the user's browser completes the round-trip. The webhook fires from Stripe's infrastructure regardless of browser state — tab closed, network dropped, ad blocker, anything. Treating a browser-initiated event as the entitlement source introduces a class of fulfillment failures (paid but no access) that are invisible in logs and require manual support resolution. The webhook eliminates this category entirely.
