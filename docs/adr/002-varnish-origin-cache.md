# ADR-002: Varnish 7.3 as the WordPress origin page cache

- Status: Accepted
- Date: 2026-07-12
- Deciders: Danh Le
- Related: [ADR-001](./001-production-shape-architecture-clone.md) (Phase 2)

## Context

production headless stacks fronts every request with two independent cache layers:

1. **Edge**: multi-CDN (Cloudflare + CloudFront) — geographic latency reduction.
2. **Origin**: Varnish sitting in front of the render tier — request coalescing + grace so a TTL expiry never stampedes the database.

Before this change, `headless-wp-next` had layer 1 (Vercel ISR via `next: { revalidate, tags }`) but no origin cache. When the edge TTL expired, the background regeneration hit Apache → PHP → MySQL directly. Under load, a single popular tag expiring at the same second means N simultaneous MySQL queries. That's the classic thundering herd.

## Decision

Add **Varnish 7.3** as the origin page cache in front of Apache. WordPress traffic from the Next.js fetch client is routed through Varnish (`WORDPRESS_URL=http://varnish` in the docker network, `:8081` on the host).

## VCL shape

- **Backend**: `wordpress:80` — compose service name.
- **Cache scope**: only `^/wp-json/` responses. `wp-admin`, `wp-login`, preview, and any request bearing a `wordpress_logged_in` cookie bypass the cache.
- **TTL**: 5 minutes default for REST endpoints. Defence-in-depth against edge-cache misses — not the source-of-truth for freshness.
- **Grace mode**: 60 seconds. When TTL expires, the first request refetches in the background while everyone else gets the stale copy. Request coalescing is Varnish's default — one origin fetch per URL regardless of concurrency.
- **Cookie/Authorization strip**: before the hash, so responses aren't fragmented per session. The Next.js server holds the API token; downstream clients never see it.
- **Purge model**:
  - `PURGE /path` — URL-scoped, called by `revalidateTag()` sibling in `/api/revalidate`.
  - `BAN /` with `X-Cache-Tag: <tag>` — wildcard tag invalidation, swept by the ban lurker.
  - Both are ACL-gated to the docker private network + localhost.

## Two-layer eviction

On editor publish in WordPress:

1. WP `save_post` hook → `POST /api/revalidate` on Next.js.
2. `revalidateTag(tag)` — Vercel edge drops the tag's rendered HTML.
3. Fire-and-forget `BAN` to Varnish with `X-Cache-Tag: <tag>` — origin drops the raw REST response.
4. Next visitor → edge miss → background regeneration → Varnish miss (just banned) → Apache → Redis (warm) → response in ~100ms.

Both layers evict in lockstep. A Varnish outage falls through to the 5m TTL as an automatic backstop; edge revalidation never blocks on it.

## Failure modes considered

- **Varnish down at revalidate time**: `BAN` is `catch`-swallowed. Origin cache eventually expires on 5m TTL. Edge is already invalidated. Acceptable degradation.
- **PURGE ACL bypass**: only reachable from docker network + RFC1918 private ranges. Never expose Varnish's `:6082` admin port publicly.
- **Auth leakage via cache**: `Cookie` + `Authorization` stripped in `vcl_recv` for `/wp-json/`. Logged-in editors are shunted to `pass` by the cookie-match rule so they never see a stale public copy.
- **Cache poisoning via `X-Cache-Tag`**: header is stripped in `vcl_deliver` before the response reaches the client.

## Alternatives considered

- **Redis full-page cache** (via `wp-super-cache` or similar). Rejected: adds a WordPress plugin that would ship at deploy time, and its invalidation semantics are less precise than Varnish's tag-ban model. Redis stays as the L1 object cache inside PHP.
- **Cloudflare Workers as origin cache**. Rejected for the local/demo target: Varnish runs identically in dev and prod, and grace-mode semantics match production headless stacks's actual origin more closely than a Worker.
- **Just increase edge revalidate window**. Rejected: doesn't solve the stampede on TTL expiry, only postpones it.

## References

- Varnish 7.3 VCL reference: https://varnish-cache.org/docs/7.3/reference/vcl.html
- production headless stacks architecture reconstruction: `../architecture-notes.md` (private)
- Layered cache flow diagram (inline in `app/api/revalidate/route.ts` docstring)
