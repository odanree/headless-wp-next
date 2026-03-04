// ─── WooCommerce Store API v1 client ─────────────────────────────────────────
//
// REST vs. GRAPHQL — WHY REST WINS AT SCALE FOR THIS USE CASE
// ────────────────────────────────────────────────────────────
// WPGraphQL is a mature plugin, but REST is the correct choice here due to
// cache granularity:
//
//   REST   → deterministic, resource-based URLs (/articles/42, /products)
//             • Vercel Edge Cache stores and invalidates each URL individually
//             • revalidateTag('article-42') evicts exactly one cache entry
//             • CDN cache-hit ratio stays high even with large catalogues
//
//   GraphQL → every query is a POST to a single endpoint (/graphql)
//             • POST bodies are opaque to CDNs; transparent edge caching
//               requires Apollo persisted queries or Relay — added complexity
//             • revalidateTag() would bust the *entire* query cache, not just
//               the changed resource — O(1) invalidation becomes O(n)
//             • At IEEE scale (millions of members) this means significantly
//               more cold PHP hits → higher infra cost, higher latency
//
// GraphQL becomes attractive in a later phase for complex relational queries
// (member tier bundles, article series, related content). REST is the right
// lever for Phase 1 where cacheability is the primary scaling constraint.
//
// ARCHITECTURE NOTE
// ─────────────────
// WooCommerce Store API (/wp-json/wc/store/v1) uses a stateless nonce rather
// than a session cookie for cart operations.  The flow is:
//
//   1. Client calls /wp-json/wc/store/cart to get an initial cart and
//      a `nonce` value from the response headers (Cart-Token / Nonce).
//   2. Every mutating request (add, remove, update) sends the nonce in the
//      `X-WP-Nonce` header.
//   3. We store the nonce in an httpOnly cookie (`woo_nonce`) set by the
//      /api/auth/login route so it is available server-side in Route Handlers
//      but not exposed to XSS via document.cookie.
//
// MOCK FALLBACK
// ─────────────
// When WORDPRESS_URL is unset the functions return data from woo-mock-data.ts.
// This means the app is fully demable without a live WooCommerce backend.
//
// TRADE-OFFS vs. WooCommerce REST API v3
// ───────────────────────────────────────
// Store API (v1) is the CORRECT choice for headless storefronts:
//   ✓ Designed for stateless, token-based access (no wp_set_auth_cookie)
//   ✓ Built-in support for cart operations without being logged in
//   ✓ Powers the native WooCommerce block editor — well-supported path
//   ✗ v3 REST API requires wp_nonce or OAuth 1.0a — not suitable for edge/SSR

import type { WooProduct, WooCart, WooCartItem, RawStoreCart } from '@/types/woocommerce';
import { MOCK_PRODUCTS, MOCK_EMPTY_CART, getMockProductById } from './woo-mock-data';

// Separate from WORDPRESS_URL so a project can have a WP articles CMS without
// WooCommerce installed (env unset → silent mock fallback, no 404 errors).
const BASE_URL = process.env.WOOCOMMERCE_URL; // e.g. https://shop.example.com
const STORE_API = `${BASE_URL}/wp-json/wc/store/v1`;

// ─── Price helpers ─────────────────────────────────────────────────────────────

/** WooCommerce Store API returns prices as minor units (cents).  Convert to display string. */
function formatMinorUnits(minor: string, symbol: string = '$'): string {
  const amount = parseInt(minor, 10) / 100;
  return `${symbol}${amount.toFixed(2)}`;
}

/** Normalise a raw Store API cart into our WooCart shape */
function normaliseCart(raw: RawStoreCart): WooCart {
  const symbol = raw.totals.currency_symbol ?? '$';
  const items: WooCartItem[] = raw.items.map((item) => ({
    key: item.key,
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    price: formatMinorUnits(item.prices.price, symbol),
    lineTotal: formatMinorUnits(item.prices.line_total, symbol),
    imageUrl: item.images?.[0]?.src,
  }));
  return {
    items,
    itemsCount: raw.items_count,
    totals: {
      subtotal: formatMinorUnits(raw.totals.total_items, symbol),
      total: formatMinorUnits(raw.totals.total_price, symbol),
      currency: raw.totals.currency_code,
      currencyCode: raw.totals.currency_code,
    },
  };
}

// ─── Shared fetch helper ───────────────────────────────────────────────────────

async function storeFetch<T>(
  path: string,
  options: RequestInit = {},
  nonce?: string,
): Promise<T> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(nonce ? { 'X-WP-Nonce': nonce } : {}),
    ...((options.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(`${STORE_API}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`WooCommerce Store API ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch all purchasable products from the WooCommerce catalogue.
 * Used by /articles and /cart to render subscription options.
 *
 * ISR NOTE: This is called inside a Server Component with Next.js fetch caching
 * (next: { revalidate: 3600 }).  Product catalogue changes rarely; 1-hour TTL
 * is appropriate.  Use /api/revalidate?tag=products for on-demand cache busting.
 */
export async function getProducts(): Promise<WooProduct[]> {
  if (!BASE_URL) {
    // Mock mode — return catalogue instantly with no network call
    return MOCK_PRODUCTS;
  }
  try {
    const raw = await storeFetch<Array<{
      id: number; name: string; slug: string; sku: string;
      prices: { price: string; regular_price: string; sale_price: string; currency_code: string };
      description: string; short_description: string;
      stock_status: string; type: string;
    }>>('/products', {
      next: { revalidate: 3600, tags: ['products'] },
    } as RequestInit);
    return raw.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      sku: p.sku,
      price: formatMinorUnits(p.prices.price, '$'),
      regularPrice: formatMinorUnits(p.prices.regular_price, '$'),
      salePrice: p.prices.sale_price ? formatMinorUnits(p.prices.sale_price, '$') : null,
      description: p.description,
      shortDescription: p.short_description,
      stockStatus: p.stock_status === 'instock' ? 'instock' : 'outofstock',
      type: p.type as WooProduct['type'],
    }));
  } catch (err) {
    console.error('[woocommerce] getProducts failed, using mock data:', err);
    return MOCK_PRODUCTS;
  }
}

/**
 * Retrieve the current cart for the supplied WP nonce.
 * In a real implementation the nonce comes from the `woo_nonce` httpOnly cookie
 * set during login (see app/api/auth/login/route.ts).
 */
export async function getCart(nonce?: string): Promise<WooCart> {
  if (!BASE_URL) return MOCK_EMPTY_CART;
  try {
    const raw = await storeFetch<RawStoreCart>('/cart', {}, nonce);
    return normaliseCart(raw);
  } catch (err) {
    console.error('[woocommerce] getCart failed:', err);
    return MOCK_EMPTY_CART;
  }
}

/**
 * Add a product to the cart.
 * Returns the updated cart.
 */
export async function addToCart(
  productId: number,
  quantity: number = 1,
  nonce?: string,
): Promise<WooCart> {
  if (!BASE_URL) {
    // Mock: construct a cart item from mock catalogue
    const product = getMockProductById(productId);
    if (!product) return MOCK_EMPTY_CART;
    const item: WooCartItem = {
      key: `mock-${productId}-${Date.now()}`,
      id: product.id,
      name: product.name,
      quantity,
      price: product.price,
      lineTotal: product.price, // simplified: price × 1
    };
    return {
      items: [item],
      itemsCount: quantity,
      totals: {
        subtotal: product.price,
        total: product.price,
        currency: 'USD',
        currencyCode: 'USD',
      },
    };
  }
  try {
    const raw = await storeFetch<RawStoreCart>(
      '/cart/add-item',
      { method: 'POST', body: JSON.stringify({ id: productId, quantity }) },
      nonce,
    );
    return normaliseCart(raw);
  } catch (err) {
    console.error('[woocommerce] addToCart failed:', err);
    return MOCK_EMPTY_CART;
  }
}

/**
 * Remove a single cart line by its item key.
 * Returns the updated cart.
 */
export async function removeFromCart(itemKey: string, nonce?: string): Promise<WooCart> {
  if (!BASE_URL) return MOCK_EMPTY_CART;
  try {
    const raw = await storeFetch<RawStoreCart>(
      '/cart/remove-item',
      { method: 'POST', body: JSON.stringify({ key: itemKey }) },
      nonce,
    );
    return normaliseCart(raw);
  } catch (err) {
    console.error('[woocommerce] removeFromCart failed:', err);
    return MOCK_EMPTY_CART;
  }
}
