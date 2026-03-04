'use client';

import { useEffect } from 'react';
import { useCart } from '@/contexts/CartContext';

/**
 * Invisible client component — clears the cart once after a successful
 * payment. Rendered inside the success page Server Component.
 *
 * Why a separate component:
 *   The success page is a Server Component (no Stripe SDK, no cookie logic).
 *   useCart() requires a client context, so cart-clearing must live here.
 *   This keeps the island as small as possible — zero rendered output.
 */
export default function ClearCartOnMount() {
  const { dispatch } = useCart();

  useEffect(() => {
    dispatch({ type: 'CLEAR_CART' });
  }, [dispatch]);

  return null;
}
