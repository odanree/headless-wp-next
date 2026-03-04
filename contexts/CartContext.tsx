'use client';

// ─── CartContext ───────────────────────────────────────────────────────────────
//
// ARCHITECTURE NOTE
// ─────────────────
// Cart state lives in React Context + useReducer (no extra dependencies).
// useReducer is the correct primitive here:
//   ✓ All state transitions are pure functions → easy to unit-test
//   ✓ Co-located action types make the data-flow auditable
//   ✓ No async concerns — mutations call woocommerce.ts client and then dispatch
//
// MIGRATION PATH to React Query / TanStack Query
// ──────────────────────────────────────────────
// When the WooCommerce backend is live and cart mutations need optimistic updates
// + background refetching, replace the manual fetch+dispatch pattern with:
//   • useQuery('cart', getCart) for reads
//   • useMutation(addToCart, { onSuccess: invalidateCart }) for writes
// The CartContext shell (provider + useCart hook) stays the same — only the
// internals of FETCH_CART_SUCCESS / mutation helpers change.
//
// PERSISTENCE
// ───────────
// Cart items are mirrored to localStorage under 'headless_wp_cart' so the
// basket survives a page refresh in mock mode.  In production WooCommerce
// maintains server-side cart state keyed by the woo_nonce cookie; localStorage
// is only used as an offline/optimistic cache.

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  type ReactNode,
  type Dispatch,
} from 'react';
import type { WooCart, WooCartItem } from '@/types/woocommerce';
import { MOCK_EMPTY_CART } from '@/lib/woo-mock-data';

// ─── State & Action types ──────────────────────────────────────────────────────

export interface CartState {
  cart: WooCart;
  loading: boolean;
  error: string | null;
}

export type CartAction =
  | { type: 'FETCH_CART_START' }
  | { type: 'FETCH_CART_SUCCESS'; payload: WooCart }
  | { type: 'FETCH_CART_ERROR'; payload: string }
  | { type: 'ADD_ITEM'; payload: WooCartItem }
  | { type: 'REMOVE_ITEM'; payload: { key: string } }
  | { type: 'UPDATE_QUANTITY'; payload: { key: string; quantity: number } }
  | { type: 'CLEAR_CART' };

const initialState: CartState = {
  cart: MOCK_EMPTY_CART,
  loading: false,
  error: null,
};

// ─── Pure reducer ─────────────────────────────────────────────────────────────

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'FETCH_CART_START':
      return { ...state, loading: true, error: null };

    case 'FETCH_CART_SUCCESS':
      return { ...state, loading: false, cart: action.payload };

    case 'FETCH_CART_ERROR':
      return { ...state, loading: false, error: action.payload };

    case 'ADD_ITEM': {
      const existing = state.cart.items.find((i) => i.id === action.payload.id);
      let items: WooCartItem[];
      if (existing) {
        items = state.cart.items.map((i) =>
          i.id === action.payload.id
            ? { ...i, quantity: i.quantity + action.payload.quantity }
            : i,
        );
      } else {
        items = [...state.cart.items, action.payload];
      }
      const itemsCount = items.reduce((n, i) => n + i.quantity, 0);
      return {
        ...state,
        cart: {
          ...state.cart,
          items,
          itemsCount,
          // Recalculate totals client-side in mock mode
          totals: recalcTotals(items),
        },
      };
    }

    case 'REMOVE_ITEM': {
      const items = state.cart.items.filter((i) => i.key !== action.payload.key);
      return {
        ...state,
        cart: {
          ...state.cart,
          items,
          itemsCount: items.reduce((n, i) => n + i.quantity, 0),
          totals: recalcTotals(items),
        },
      };
    }

    case 'UPDATE_QUANTITY': {
      const items = state.cart.items.map((i) =>
        i.key === action.payload.key ? { ...i, quantity: action.payload.quantity } : i,
      );
      return {
        ...state,
        cart: {
          ...state.cart,
          items,
          itemsCount: items.reduce((n, i) => n + i.quantity, 0),
          totals: recalcTotals(items),
        },
      };
    }

    case 'CLEAR_CART':
      return { ...state, cart: MOCK_EMPTY_CART };

    default:
      return state;
  }
}

// ─── Client-side total recalc (mock mode only) ────────────────────────────────

function parsePrice(price: string): number {
  return parseFloat(price.replace(/[^0-9.]/g, '')) || 0;
}

function recalcTotals(items: WooCartItem[]): WooCart['totals'] {
  const subtotal = items.reduce((sum, i) => sum + parsePrice(i.price) * i.quantity, 0);
  return {
    subtotal: `$${subtotal.toFixed(2)}`,
    total: `$${subtotal.toFixed(2)}`,
    currency: 'USD',
    currencyCode: 'USD',
  };
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface CartContextValue {
  state: CartState;
  dispatch: Dispatch<CartAction>;
  /** Adds a WooProduct to cart by building a WooCartItem and dispatching ADD_ITEM */
  addProductToCart: (product: { id: number; name: string; price: string; sku: string }) => void;
  /** Removes an item by cart key */
  removeItem: (key: string) => void;
  /** Total count of items — used by nav cart icon badge */
  itemCount: number;
}

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = 'headless_wp_cart';

// ─── Provider ─────────────────────────────────────────────────────────────────

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, initialState, (init) => {
    // Hydrate from localStorage on first render (client-only)
    if (typeof window === 'undefined') return init;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const cart: WooCart = JSON.parse(stored);
        return { ...init, cart };
      }
    } catch {
      // Corrupt storage — ignore and start fresh
    }
    return init;
  });

  // Persist cart to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.cart));
    } catch {
      // Storage quota exceeded — not critical
    }
  }, [state.cart]);

  const addProductToCart = useCallback(
    (product: { id: number; name: string; price: string; sku: string }) => {
      const item: WooCartItem = {
        key: `item-${product.id}-${Date.now()}`,
        id: product.id,
        name: product.name,
        quantity: 1,
        price: product.price,
        lineTotal: product.price,
      };
      dispatch({ type: 'ADD_ITEM', payload: item });
    },
    [],
  );

  const removeItem = useCallback((key: string) => {
    dispatch({ type: 'REMOVE_ITEM', payload: { key } });
  }, []);

  const itemCount = state.cart.itemsCount;

  return (
    <CartContext.Provider value={{ state, dispatch, addProductToCart, removeItem, itemCount }}>
      {children}
    </CartContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
