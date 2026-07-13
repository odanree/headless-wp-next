# ADR-001: Clone the production headless stacks production architecture into this repo

- **Status:** Proposed
- **Date:** 2026-07-13
- **Deciders:** Danh Le
- **Relates to:** [`ARCHITECTURE.md`](../ARCHITECTURE.md) (this ADR extends the stage-1 demo into a stage-2 "production-shaped" architecture).

## Context

`headless-wp-next` already ships the core production headless stacks modernization pattern — Next.js App Router + WordPress REST as headless data plane + on-demand cache invalidation via `revalidateTag()` triggered by a `save_post` hook. Sitting at ~60% architectural parity with what production headless stacks actually runs in production.

Forensic inspection of `example.com` (via `curl -I` against `/plans/`) exposed the remaining ~40% delta:

| Layer | production headless stacks (measured) | This repo (today) |
|---|---|---|
| Framework | Next.js 15+ App Router (evidence: `Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch` — the last header is Next.js 15+ specific) | Next.js **14** App Router |
| Rendering strategy | ISR with route-segment revalidation | ✅ same |
| On-demand invalidation | `revalidateTag()` from CMS hooks | ✅ same |
| Origin page cache | Varnish 7.3 (`Via: mintsim-wp-varnish (Varnish/7.3)`, `X-Varnish: <upstream> <downstream>`) | ❌ direct Node.js origin |
| Global edge cache | AWS CloudFront (`Via: cloudfront`, `X-Amz-Cf-Pop: LAX50-P4`) | Vercel-native (functionally similar) |
| WAF + bot + edge personalization | Cloudflare in front of CloudFront (multi-CDN) | ❌ no WAF layer |
| A/B testing | Optimizely edge personalization (`ox-decisions-payload` header, `OPTIMIZELY_USER_ID` cookie set at edge) | ❌ no A/B path |
| Security headers | HSTS, CSP with third-party allowlist, X-Content-Type-Options, etc. | ⚠️ Next.js defaults only |
| Content-hashed assets | `_next/static/css/<hash>.css?dpl=<deploy-id>` | ✅ (Next.js native) |

The unshipped ~40% is not decorative. Each layer that's missing represents a **production pattern this repo currently only claims via prose** ("*would use in production*") rather than by running code. For interview purposes, running code that emits the same `curl -I` forensics as `example.com` is a materially different asset than a README paragraph describing the same design.

## Decision

Ship the four-piece build:

1. **Bump Next.js 14 → 15+.** Unlocks `next-router-segment-prefetch` (visible in response `Vary` header) and the modern App Router surface that production headless stacks is on.
2. **Add Varnish 7.3 to the local Docker stack** as an origin-side page cache sitting between Next.js and WordPress. Not just for headers-parity — Varnish provides real request coalescing under ISR revalidation storms.
3. **Extend the Edge Middleware to do A/B assignment** — cookie-based sticky variant assignment set at the edge, base HTML stays cacheable, client component reads the cookie and swaps content. Same architectural shape as Optimizely.
4. **Add security headers via `next.config.js` `headers()` config** — HSTS, CSP with third-party allowlist, standard hardening set.

**Explicit goal:** after this ADR ships, `curl -I` against a deployed instance of this repo produces response headers that mirror the ones from `example.com/plans/` — same `Vary` values, `X-Varnish`, per-file-type cache-control, CSP allowlist. Interview-verifiable end-to-end.

**Explicit non-goal:** don't clone production headless stacks's multi-CDN topology (Cloudflare in front of CloudFront). Vercel's edge is functionally equivalent for a portfolio-scale demo, and the operational cost of dual-CDN doesn't earn its keep here.

## Alternatives considered

| Option | Reason rejected |
|---|---|
| **Do nothing — leave headless-wp-next at current parity** | Interview cost. Feedback surfaced that "I've done ISR at $company" is measurably weaker than "here's my repo running the same pattern — inspect the headers yourself." |
| **Document production headless stacks's architecture in prose only** | Prose doesn't compound. Running code that emits production-shape-shaped headers is a durable asset that future interviewers can click into. |
| **Full multi-CDN clone (Cloudflare + CloudFront + Varnish)** | Portfolio-scale cost/benefit doesn't justify running dual CDN vendors. Vercel already handles the "global edge cache" role. Adds ops complexity without observable pattern difference for interview purposes. |
| **Rebuild from scratch in a new repo** | This repo already has 60% of the shape. Extending is 3-4h; rewriting is 20h+. |
| **Only ship pieces 1 + 2 (Next.js 15 + Varnish)** | Was the original scope. Reconsidered because pieces 3 and 4 are individually small (~1-2h each) but each closes a distinct interview-visible gap. All-four is only ~2h more than pieces-1-and-2. |

## Consequences

### Positive
- **`curl -I` parity with `example.com`.** Response headers become forensically indistinguishable in shape (not values, but structure). Every architectural claim in interview is verifiable via one shell command.
- **Real origin coalescing.** Varnish handles the thundering-herd problem during ISR revalidation windows. Not currently a problem at portfolio scale, but demonstrates awareness of the issue.
- **Cacheable-personalization pattern shipped.** A/B testing on static content is a known-hard problem; shipping the "cookie at edge, DOM swap at client" pattern demonstrates the design.
- **Interview receipt.** Any reviewer can click into the repo and see the exact pattern that runs at production headless stacks in production, not "would run" or "should run."
- **Establishes ADR convention** in this repo (this is ADR-001).

### Negative
- **~3-4 hours of build work** across four discrete pieces.
- **Local Docker stack grows** by one service (Varnish). Marginal — `docker compose up -d` still works.
- **Next.js 15 migration risk.** The `fetch()` cache default changed (was `force-cache`, now `no-store`) — every explicit `next: { revalidate: N }` on this repo still works, but any unmarked `fetch()` calls will need explicit caching directives. Audit required.
- **A/B experiment is a demo** — one fake experiment (hero copy variant) is enough to demonstrate the pattern; interviewer scrutiny wouldn't reveal a real business KPI moving. Framed honestly as "the architecture, not the business decision."

## Roadmap

Four phases, each individually reversible. Ship in order; every phase's completion is separately valuable.

### Phase 1 — Next.js 15 upgrade (~30 min)

**Files touched:**
- `package.json` — bump `next` to `^15`, `react` + `react-dom` to `^19`
- Any `fetch()` calls without explicit `next: { revalidate: N }` — audit and add explicit caching directives
- Async `cookies()`, `headers()`, `params`, `searchParams` — Next.js 15 made these async; add `await` where needed
- `next.config.js` — sanity check for deprecated options

**Success criteria:**
- `npm run build` succeeds cleanly
- `npm run dev` boots without warnings
- Deploy to Vercel succeeds
- `curl -I https://<deploy-url>/` response contains `Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding` — mirroring `example.com`

**Rollback:** `git revert` the PR. All existing routes keep working; only the response-header shape changes.

### Phase 2 — Varnish at origin (~1 hour)

**Files touched:**
- `docker-compose.yml` — new `varnish` service, Varnish 7.3 image, port 8081 → 6081
- `docker/varnish/default.vcl` — new file, VCL config
- `lib/wordpress.ts` — swap `WORDPRESS_URL` default from `http://localhost:8080` to `http://localhost:8081` (Varnish port), or add `WORDPRESS_ORIGIN_URL` env var

**Varnish config (`default.vcl`) covers:**
- Backend: `wordpress:80` (Docker service DNS)
- TTL: 5 min default on GET responses, 0 on POST/PUT/DELETE
- Grace mode: serve stale up to 24h during backend outage
- PURGE support: match on `X-VC-Cache-Key` header for on-demand invalidation from Next.js
- Strip `Set-Cookie` on cacheable responses (WP sends session cookies that would defeat caching)
- Emit `X-Varnish` (built-in) + `X-Cache: HIT|MISS` (custom header)

**Success criteria:**
- `docker compose up -d` brings up all services healthy
- `curl -I http://localhost:8081/wp-json/headless/v1/articles` shows `X-Varnish: <id>` and `Via: 1.1 varnish (Varnish/7.3)` — matching production headless stacks
- Second request to same URL shows `X-Cache: HIT` in response header
- Next.js still works end-to-end (articles load, revalidation still works)

**Rollback:** remove `varnish` service from `docker-compose.yml`, revert `WORDPRESS_URL` to direct WordPress port. No data migration.

### Phase 3 — Edge A/B assignment (~1-2 hours)

**Files touched:**
- `middleware.ts` — extend existing auth middleware to also assign A/B variant cookie on entry to any page
- `lib/experiments.ts` — new file, experiment registry (`{ hero_copy: { variants: ['A','B'], weights: [0.5, 0.5] } }`)
- `components/HeroCopy.tsx` — new client component that reads variant cookie and renders variant A or B
- `app/page.tsx` — mount `<HeroCopy />` on the home page

**Middleware logic:**
- If request has no `ab_bucket` cookie: assign one via crypto-random seeded on user-agent + IP hash (deterministic, no PII stored)
- Read experiment registry, assign variant per experiment, encode as `ab:hero_copy=A;other_exp=B` in the cookie
- Set cookie with 90-day expiry, SameSite=Lax
- Add `Vary: Cookie` to response header so CDN caches per-variant (optional, kills caching efficiency — trade-off documented)

**Success criteria:**
- First request to `/` in a clean browser sets `ab_bucket` cookie
- Client `<HeroCopy />` reads the cookie and renders variant A or B accordingly
- Two clean browsers see roughly 50/50 split across ~10 requests
- Client-side content swap doesn't cause layout shift (CLS < 0.05)
- Response headers still cache-friendly (`Cache-Control` remains `s-maxage=...`) — critical: base HTML must stay cacheable

**Rollback:** revert `middleware.ts` changes, delete `experiments.ts` + `HeroCopy.tsx`, remove mount from `page.tsx`. Cookie will just sit unused.

### Phase 4 — Security headers + CSP (~30-60 min)

**Files touched:**
- `next.config.js` — add `async headers()` returning per-path header lists

**Header set:**
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN` (matching production headless stacks's SAMEORIGIN)
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(*), usb=(), interest-cohort=()`
- `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com https://checkout.stripe.com; frame-src https://js.stripe.com https://hooks.stripe.com; connect-src 'self' https://api.stripe.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline';`
  - Allowlists Stripe (used for gated membership)
  - Blocks everything else
  - `frame-ancestors 'self'` (matches production headless stacks's frame-ancestors including `*.example.com *.optimizely.com`)

**Success criteria:**
- `curl -I https://<deploy-url>/` shows all seven headers
- Stripe checkout flow still works (CSP doesn't block it)
- Browser DevTools Console shows zero CSP violations on any page
- Lighthouse Best Practices score ≥ 95

**Rollback:** remove the `headers()` config from `next.config.js`. No functional impact.

## Success metrics (whole ADR)

- **Header-forensics parity:** `curl -I` against deployed instance emits headers whose shape matches `example.com/plans/` — `Vary: rsc, next-router-*`, `X-Varnish: <id>`, CSP, HSTS, HKDF cache-control per file type.
- **Zero regressions:** all existing routes render correctly, `/api/revalidate` still triggers on-demand invalidation, Stripe checkout still works, member auth gate still redirects.
- **Interview-ready story:** a natural 60-second architecture-speak paragraph exists in this repo's README, verifiable by any curl-comfortable interviewer without additional context.

## References

- Live target: `curl -I https://www.example.com/plans/` — the reference response headers
- `ARCHITECTURE.md` in this repo — the stage-1 demo doc; this ADR is the stage-2 production-shape build
