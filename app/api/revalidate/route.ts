import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

/**
 * POST /api/revalidate
 *
 * On-demand cache invalidation triggered by a WordPress save_post hook.
 *
 * Body: { tag: string; secret: string }
 *
 * WordPress plugin sends:
 *   wp_remote_post( NEXT_REVALIDATE_URL, [
 *     'body' => json_encode(['tag' => 'article-123', 'secret' => REVALIDATION_SECRET])
 *   ]);
 *
 * ── TWO-LAYER CACHE ARCHITECTURE ────────────────────────────────────────────
 *
 * This endpoint is the join point between two independent cache layers:
 *
 *   LAYER 1 — Redis Object Cache (WordPress Origin)
 *   ─────────────────────────────────────────────────
 *   Installed on the WP server (e.g. wordpress-redis plugin + Redis 7).
 *   Caches raw PHP objects / DB query results using a namespaced key strategy:
 *
 *     ieee:article:123:content     → full article body (long TTL)
 *     ieee:member:456:permissions  → access tier for a member (short TTL)
 *     ieee:wc_cart:789:nonce       → Store API session nonce
 *
 *   Namespacing matters: you can DEL ieee:article:123:* to surgically evict
 *   one article without flushing the entire cache. Global flushes kill warm
 *   data for all concurrent users — unacceptable during a conference spike.
 *
 *   Redis is single-threaded; atomic operations are free. This enables:
 *     • Distributed locks  — SETNX ieee:lock:register → prevents duplicate
 *       account creation when 100 simultaneous "Join IEEE" requests arrive
 *     • Rate limiting      — INCR ieee:ratelimit:<ip> + EXPIRE
 *
 *   LAYER 2 — Next.js ISR / Edge Cache (Vercel CDN)
 *   ─────────────────────────────────────────────────
 *   Caches the *rendered HTML* for public pages at the Edge (globally).
 *   `next: { tags: ['article-123'] }` in wpFetch() registers the fetch
 *   against a tag. Under the hood, Vercel maps that tag to the set of
 *   cached responses that depended on it. This call — revalidateTag() —
 *   atomically marks every response in that set as stale.
 *
 *   ISR vs Redis — the distinction that matters at scale:
 *   "ISR caches rendered HTML at the Edge. Redis caches raw data objects
 *    at the Origin. When the ISR TTL expires (stale-while-revalidate), the
 *    background re-generation hits WordPress. With Redis warm, that round-trip
 *    is ~100 ms. Without Redis, MySQL handles it — potentially 2 s+, which
 *    risks timing out the Edge regeneration request entirely."
 *
 *   THE FULL FLOW on 'editor hits Publish in WordPress':
 *     1. WP save_post hook fires
 *     2. WP plugin calls this endpoint: { tag: 'article-123', secret: ... }
 *     3. revalidateTag('article-123') purges the specific Edge cache entries
 *     4. The *next* visitor triggers a background ISR re-generation
 *     5. That re-generation calls wpFetch() → hits WP REST API
 *     6. WP REST API hits Redis (warm L1 cache) → returns in ~100 ms
 *     7. Next.js renders and stores the fresh HTML at the Edge
 *
 *   Result: surgical, zero-downtime invalidation. No global flush.
 *   MySQL is reserved for writes only (new memberships, commerce transactions).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body?.secret || !body?.tag) {
    return NextResponse.json({ error: 'Missing secret or tag' }, { status: 400 });
  }

  const expectedSecret = process.env.REVALIDATION_SECRET;

  // If no secret is configured, skip validation in dev/mock mode
  if (expectedSecret && body.secret !== expectedSecret) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
  }

  revalidateTag(body.tag as string);

  return NextResponse.json({ revalidated: true, tag: body.tag });
}
