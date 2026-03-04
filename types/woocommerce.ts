// ─── WooCommerce Store API v1 types ───────────────────────────────────────────
// Mirrors the shape returned by /wp-json/wc/store/v1/ endpoints.
// In production these fields come directly off the API response; in mock mode
// (WORDPRESS_URL unset) lib/woo-mock-data.ts returns data with this exact shape.

export interface WooProduct {
  id: number;
  name: string;
  slug: string;
  /** SKU used as a stable identifier across environments */
  sku: string;
  /** Formatted price string, e.g. "$99.00" */
  price: string;
  regularPrice: string;
  salePrice: string | null;
  description: string;
  shortDescription: string;
  stockStatus: 'instock' | 'outofstock';
  /** simple = one-time, variable = has variants, subscription = recurring */
  type: 'simple' | 'variable' | 'subscription';
}

export interface WooCartItem {
  /** Cart item key — opaque string from WooCommerce, used to remove/update */
  key: string;
  id: number;
  name: string;
  quantity: number;
  /** Unit price string */
  price: string;
  /** quantity × price */
  lineTotal: string;
  imageUrl?: string;
}

export interface WooCartTotals {
  subtotal: string;
  total: string;
  currency: string;
  /** ISO 4217 currency code */
  currencyCode: string;
}

export interface WooCart {
  items: WooCartItem[];
  itemsCount: number;
  totals: WooCartTotals;
}

// ─── Store API response shapes ─────────────────────────────────────────────────

/** Raw item as returned by /wc/store/v1/cart before normalisation */
export interface RawStoreCartItem {
  key: string;
  id: number;
  name: string;
  quantity: number;
  prices: {
    price: string;          // minor units, e.g. "9900" for $99.00
    line_total: string;
    currency_code: string;
  };
  images: Array<{ src: string }>;
}

export interface RawStoreCart {
  items: RawStoreCartItem[];
  items_count: number;
  totals: {
    total_price: string;    // minor units
    total_items: string;
    currency_code: string;
    currency_symbol: string;
  };
}
