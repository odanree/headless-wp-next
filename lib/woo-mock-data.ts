// ─── WooCommerce mock product catalogue ──────────────────────────────────────
// Used when WORDPRESS_URL is not set (local dev / CI / Vercel preview without
// a live WP backend).  The shape mirrors WooProduct exactly so switching to
// the real Store API requires zero code changes — only the env var.
//
// Pricing rationale (mirrors common digital-access SaaS tiers):
//   Annual Pass  → best value, drives LTV, anchors Monthly against itself
//   Monthly Pass → recurring, lower friction, lower commitment
//   Single Article→ impulse / trial purchase, often converts to Monthly

import type { WooProduct, WooCart } from '@/types/woocommerce';

export const MOCK_PRODUCTS: WooProduct[] = [
  {
    id: 101,
    name: 'Annual Digital Access Pass',
    slug: 'annual-access-pass',
    sku: 'ACCESS-ANNUAL-2024',
    price: '$99.00',
    regularPrice: '$119.00',
    salePrice: '$99.00',
    shortDescription: 'Unlimited access to all member articles for 12 months.',
    description:
      'Get full access to the entire IEEE member article library — ' +
      'architecture deep-dives, security breakdowns, performance case studies, ' +
      'and more. Billed once annually. Cancel any time.',
    stockStatus: 'instock',
    type: 'subscription',
  },
  {
    id: 102,
    name: 'Monthly Access Pass',
    slug: 'monthly-access-pass',
    sku: 'ACCESS-MONTHLY-2024',
    price: '$12.00',
    regularPrice: '$12.00',
    salePrice: null,
    shortDescription: 'Unlimited access to all member articles, billed monthly.',
    description:
      'Full member-article access on a rolling monthly subscription. ' +
      'Ideal for readers who want flexibility. Upgrade or cancel any time.',
    stockStatus: 'instock',
    type: 'subscription',
  },
  {
    id: 103,
    name: 'Single Article Purchase',
    slug: 'single-article-purchase',
    sku: 'ACCESS-SINGLE-2024',
    price: '$4.99',
    regularPrice: '$4.99',
    salePrice: null,
    shortDescription: 'Permanent access to one member article of your choice.',
    description:
      'Purchase lifetime access to a single article. ' +
      'Prefer to try before you commit? This is the lowest-risk entry point.',
    stockStatus: 'instock',
    type: 'simple',
  },
];

/** Convenience lookup by product id */
export function getMockProductById(id: number): WooProduct | undefined {
  return MOCK_PRODUCTS.find((p) => p.id === id);
}

/** An empty cart — starting state for CartContext */
export const MOCK_EMPTY_CART: WooCart = {
  items: [],
  itemsCount: 0,
  totals: {
    subtotal: '$0.00',
    total: '$0.00',
    currency: 'USD',
    currencyCode: 'USD',
  },
};
