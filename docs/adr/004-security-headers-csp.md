# ADR-004: Security headers + Content-Security-Policy

- Status: Accepted
- Date: 2026-07-12
- Deciders: Danh Le
- Related: [ADR-001](./001-production-shape-architecture-clone.md) (Phase 4)

## Context

production headless stacks ships a strict `Content-Security-Policy` in production alongside the usual HSTS / X-Frame / Referrer-Policy trio. That's the defence-in-depth layer that lives at the render tier: even if a bug lets an attacker inject markup into a WordPress-authored article body, CSP prevents that markup from executing script, phoning home, or loading remote assets outside the explicit allowlist.

Before this change, `headless-wp-next` returned no security headers at all. Any inline `<script>` in a WordPress post body would execute; the app was framable; MIME sniffing was permitted.

## Decision

Configure `async headers()` in `next.config.js` to return a strict `default-src 'none'` CSP plus the standard header set, applied to every route via the `/:path*` source glob.

### CSP shape

Declared as a JS object so directives are diff-friendly and adding a third-party (analytics, chat widget) is a one-line edit that shows exactly what's being trusted:

```js
{
  'default-src': ["'none'"],
  'script-src': ["'self'", "'unsafe-inline'", 'https://js.stripe.com'],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', 'https://*.wordpress.com', 'https://*.gravatar.com'],
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'", 'https://api.stripe.com', 'http://localhost:8080', 'http://localhost:8081'],
  'frame-src': ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'upgrade-insecure-requests': [],
}
```

Third-party allowlist entries — every one is a deliberate trust boundary:

- `js.stripe.com` + `hooks.stripe.com` — Stripe Checkout requires script + frame from these hosts.
- `api.stripe.com` — Stripe webhook + payment intent calls.
- `*.wordpress.com` + `*.gravatar.com` — WordPress media library / Photon CDN and avatar imagery.
- `localhost:8080` + `localhost:8081` — the local WordPress + Varnish stack. Swap for the prod origin in production config.

### Companion headers

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` — 2 years, ready for HSTS preload submission.
- `X-Frame-Options: DENY` — belt-and-braces alongside `frame-ancestors 'none'` for legacy browsers.
- `X-Content-Type-Options: nosniff` — kills MIME sniffing attacks.
- `Referrer-Policy: strict-origin-when-cross-origin` — leaks only the origin, never the path, cross-site.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()` — denies unrequested browser feature access; `interest-cohort=()` opts out of FLoC.
- `Cross-Origin-Opener-Policy: same-origin` — isolates the top-level browsing context.

## What's deliberately deferred

- **`'strict-dynamic'` + nonces.** The proper next step: emit a per-request nonce, drop `'unsafe-inline'` from `script-src`, and let Next.js's script tags carry the nonce. That requires nonce injection at every `<script>` emit path plus a middleware header write. Deferred to a follow-up once we have a script-emit audit — CSP's current `'unsafe-inline'` covers the demo without opening the door to arbitrary remote scripts.
- **CSP report-only rollout**. Prod deployments should first ship `Content-Security-Policy-Report-Only` with a report endpoint, catch violations from real traffic, then flip to enforcing. Not wired here because there's no real traffic yet.
- **`require-trusted-types-for`**. Next.js's RSC serializer would need updating to emit `TrustedHTML`. Not viable today.

## Failure modes considered

- **Inline `<script>` from a WP-authored article body**. `'unsafe-inline'` currently allows this — mitigated because WordPress admins are trusted authors and the plugin sanitizes post content. Nonces would close the gap.
- **Third-party host compromise** (Stripe, Gravatar). Blast radius is scoped to those allowlisted directives — an attacker gaining control of `gravatar.com` couldn't exfiltrate to a new host because `connect-src` doesn't list them.
- **Local dev break**. `connect-src` allows both `:8080` (WordPress direct) and `:8081` (Varnish). Swap these for the prod origin before deploy — flagged in ADR body so it doesn't get missed.
- **Route-specific relaxation** (e.g. an OG image endpoint that needs to embed cross-origin). Individual routes can override via their own response headers; the `/:path*` source is the floor, not a ceiling.

## Alternatives considered

- **Middleware-set headers**. Rejected: middleware runs on the Vercel Edge and would be re-executed for every request. `next.config.js` headers are wired into the response at build/deploy time and don't burn edge invocation budget.
- **Server Action for header emission**. Not applicable — headers must be present on the very first response, before any RSC render.
- **Third-party CSP builder library** (e.g. `helmet`). Rejected: the policy is short enough that a hand-rolled object is more inspectable and diff-friendly.

## References

- Config: `next.config.js`
- CSP spec: https://www.w3.org/TR/CSP3/
- MDN header reference: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers
- Google web.dev on strict CSP + nonces: https://web.dev/articles/strict-csp
