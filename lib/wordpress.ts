/**
 * lib/wordpress.ts
 *
 * WordPress REST API client.
 *
 * MOCK MODE (default):
 *   When WORDPRESS_URL is not set, returns built-in mock data.
 *   The app runs fully without a WordPress install — ideal for local dev
 *   and Vercel preview deployments.
 *
 * LIVE MODE:
 *   Set WORDPRESS_URL + WORDPRESS_API_TOKEN in .env.local to connect
 *   to a real WordPress site running the headless-wp plugin.
 *
 * IMAGE OPTIMIZATION NOTE:
 *   WordPress articles may contain technical diagrams and figures served
 *   from the WP media library. For production, configure a custom Next.js
 *   Image loader in next.config.js:
 *
 *     images: {
 *       loader: 'custom',
 *       loaderFile: './lib/wp-image-loader.ts',
 *     }
 *
 *   The loader rewrites WordPress media URLs to serve WebP/AVIF via the
 *   WordPress Photon CDN or a custom Sharp pipeline, reducing payload by
 *   ~60-80% for PNG-heavy technical diagrams.
 */

import { revalidateTag } from 'next/cache';
import type { WordPressArticle, WordPressArticlesResponse, ArticleSummaryResponse } from '@/types/wordpress';
import { getMockArticles, getMockArticleById } from '@/lib/mock-data';

export { revalidateTag };

// ─── Custom error types ───────────────────────────────────────────────────────

export class WordPressAuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'WordPressAuthError';
  }
}

export class WordPressAPIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'WordPressAPIError';
  }
}

// ─── Internal fetch wrapper ───────────────────────────────────────────────────
//
// CACHE LAYER RESPONSIBILITIES
// ─────────────────────────────
// This function sits at the boundary between Edge cache (Next.js ISR) and
// Origin cache (WordPress + Redis). Understanding which layer handles what
// is critical for debugging performance under load:
//
//   next: { revalidate, tags }  → instructs the Next.js Edge Cache how long
//                                  to hold the *rendered output* and which
//                                  tag to listen for on-demand invalidation.
//                                  Lives at the CDN — never touches MySQL.
//
//   WordPress Redis Object Cache → caches raw PHP/DB objects at the Origin.
//                                  When ISR TTL expires and a background
//                                  re-generation calls this function, the WP
//                                  REST endpoint hits Redis (L1) rather than
//                                  MySQL. Warm Redis = ~100 ms origin response.
//                                  Cold (no Redis, MySQL hit) = ~2 s+ which
//                                  can time out the Edge regeneration request.
//
// The tags passed here (e.g. 'article-123', 'public-articles') map to the
// namespaced keys used in Redis invalidation (ieee:article:123:*).
// POST /api/revalidate calls revalidateTag() to purge the Edge layer;
// the WordPress save_post hook optionally flushes the Redis layer in parallel.
//
type FetchOptions = {
  revalidate?: number;
  tags?: string[];
  fresh?: boolean;
};

async function wpFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const baseUrl = process.env.WORDPRESS_URL;
  const token = process.env.WORDPRESS_API_TOKEN;

  const url = `${baseUrl}/wp-json/headless/v1${path}`;

  const cacheOpts: RequestInit['next'] = {};
  if (opts.fresh) {
    cacheOpts.revalidate = 0;
  } else if (opts.revalidate !== undefined) {
    cacheOpts.revalidate = opts.revalidate;
  }
  if (opts.tags?.length) {
    cacheOpts.tags = opts.tags;
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    next: cacheOpts,
  });

  if (res.status === 401 || res.status === 403) {
    throw new WordPressAuthError();
  }

  if (!res.ok) {
    throw new WordPressAPIError(`WordPress API error: ${res.statusText}`, res.status);
  }

  return res.json() as Promise<T>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns all member articles — mock data if WORDPRESS_URL is not configured. */
export async function getMemberArticles(): Promise<WordPressArticlesResponse> {
  if (!process.env.WORDPRESS_URL) {
    return getMockArticles();
  }

  return wpFetch<WordPressArticlesResponse>('/articles', {
    revalidate: 300,
    tags: ['articles'],
  });
}

/** Returns a single member article by id — mock data fallback applies. */
export async function getMemberArticleById(
  id: number,
): Promise<WordPressArticle | null> {
  if (!process.env.WORDPRESS_URL) {
    return getMockArticleById(id);
  }

  try {
    return await wpFetch<WordPressArticle>(`/articles/${id}`, {
      revalidate: 300,
      tags: [`article-${id}`],
    });
  } catch (err) {
    if (err instanceof WordPressAPIError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Returns public article summaries with NO auth requirement.
 * Consumed by the public /articles teaser page.
 *
 * ISR: revalidate 3600 (1 hour) — public catalogue changes rarely.
 * Tag: 'public-articles' — bust via POST /api/revalidate?tag=public-articles.
 *
 * TRADE-OFF vs getMemberArticles():
 *  - No Bearer token → safe to call from a CDN edge node
 *  - Higher TTL (3600 vs 300) → fewer cold WP PHP hits at scale
 *  - Returns same mock data in dev so the /articles page always has content
 */
export async function getPublicArticles(): Promise<ArticleSummaryResponse> {
  if (!process.env.WORDPRESS_URL) {
    // Mock mode — return the same articles as member mode (all articles are
    // "public teasers" in the mock; in production the WP endpoint would filter
    // to only return excerpt/title, not full content)
    return getMockArticles();
  }

  return wpFetch<ArticleSummaryResponse>('/articles/public', {
    revalidate: 3600,
    tags: ['public-articles'],
  });
}
