# ADR-003: Edge A/B assignment via middleware + Server Component render

- Status: Accepted
- Date: 2026-07-12
- Deciders: Danh Le
- Related: [ADR-001](./001-production-shape-upgrade.md) (Phase 3)

## Context

Production A/B tooling on headless stacks follows a repeatable shape — **variant assignment at the edge, render on the server**: a cookie is stamped on first visit, subsequent requests carry the cookie, and the render layer emits the assigned variant. Two properties matter:

1. **No client-side flicker.** The visitor never sees variant A repaint into variant B after hydration — the wrong variant would tank the experiment's signal.
2. **Cookie-scoped, not JS-scoped.** Bots without cookies get the control; humans keep their assignment across sessions for the full experiment window.

The prior `middleware.ts` handled auth but had no experiment hook. Adding one requires two seams: an edge write path and a server read path.

## Decision

Two-layer assignment split:

- **Write at the edge** (`middleware.ts` runs on every matched request).
  - Read the `exp` cookie (compact form `id:variant|id:variant`).
  - For every registered experiment missing a variant, weighted-random bucket.
  - Stamp the cookie on the response with a 90-day `max-age`, `sameSite=lax`.
  - Forward the full assignment as `x-experiment` on the request headers so Server Components can render without reparsing cookies.

- **Read at the server** (`lib/getVariant.ts` — Server Component only).
  - Reads `x-experiment` via `headers()`.
  - Falls back to the control variant (registry index 0) if the header is missing — e.g. a direct-to-RSC path that bypassed middleware. Deterministic fallback keeps JSX safe from `undefined`.

## Registry shape

Single source of truth in `lib/experiments.ts`:

```ts
export const EXPERIMENTS = {
  hero_headline: { variants: ['A', 'B'], weights: [0.5, 0.5] },
  join_cta: { variants: ['control', 'urgency', 'value'], weights: [0.34, 0.33, 0.33] },
};
```

- Adding an experiment: append here + call `getVariant('id')` in the target Server Component. No middleware edit required — `ensureAssignments()` walks the registry on every request.
- Retiring: remove the entry from the registry. Old cookie values become no-ops and existing entries stay in the cookie without effect until it naturally rotates.

## Middleware matcher change

Prior matcher scoped middleware to `/article/*` + `/members/*` (auth-gated paths only). New matcher runs on every human-facing route so bucketing lands on the marketing homepage too:

```ts
matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
```

Cost: edge middleware size ticked from 34 kB → 34.5 kB (bucket logic + codec).

## Failure modes considered

- **Bots or first request with `Cache-Control: no-cookie`**: `assigned=true` fires every request, cookie never persists. Acceptable — bots get control-equivalent behavior because we render deterministically from whatever the header says.
- **Registry mutation between deploys**: variant names change and old cookie values reference dead variants. `ensureAssignments()` re-rolls unknown variants; `getVariant()` returns control if the cookie's variant is unrecognized. Safe by default.
- **ISR incompatibility**: pages that consume experiments must be dynamic or use PPR (partial pre-render). The homepage already carries `export const dynamic = 'force-dynamic'` — no change. If we later expand experiments to fully-static routes, the pattern is to move variant reading into a Client Component behind Suspense with a `useEffect` cookie read.
- **PII in cookie**: intentionally none — variant IDs only. No user identifier, no session token, no tie to `member_token`.

## Alternatives considered

- **Full commercial A/B platform** (Optimizely, LaunchDarkly, VWO). Rejected for this demo: adds a third-party JS bundle, a network call before render, and CSP allowlist entries. The point of ADR-001 is to reproduce the shape, not the vendor.
- **Client-side assignment with a flash-of-wrong-content**. Rejected: kills the experiment signal, adds hydration flicker.
- **Vercel Edge Config**. Rejected: adds a hosted dependency; the local dev story is the same as prod's when the pattern lives in code.

## References

- Registry: `lib/experiments.ts`
- Edge write: `middleware.ts`
- Server read: `lib/getVariant.ts`
- First consumer: `app/HeroCopy.tsx`
