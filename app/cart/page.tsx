'use client';

// ─── Cart page ────────────────────────────────────────────────────────────────
//
// CLIENT COMPONENT — cart state lives in CartContext (React useReducer).
//
// CHECKOUT FLOW:
//   1. "Proceed to Checkout" → POST /api/checkout with cart line items
//   2. Server creates a Stripe Checkout Session (hosted on stripe.com)
//   3. Client redirects to session.url (Stripe's card form)
//   4. Stripe redirects to /checkout/success after payment
//   5. Stripe fires checkout.session.completed → /api/webhooks/stripe
//
// PCI: Card data never crosses our server — qualifies for SAQ-A.
// TAX:  Digital goods only — no shipping. Tax handled by WooCommerce/TaxJar.

import Link from 'next/link';
import { useState } from 'react';
import { useCart } from '@/contexts/CartContext';

export default function CartPage() {
  const { state, removeItem, dispatch } = useCart();
  const { cart, loading } = state;
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  async function handleCheckout() {
    setCheckoutLoading(true);
    setCheckoutError('');
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.items.map((item) => ({
            name: item.name,
            price: item.price,
            quantity: item.quantity,
          })),
        }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? 'Could not create checkout session');
      }
      window.location.href = data.url;
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Checkout failed');
      setCheckoutLoading(false);
    }
  }

  function handleQuantityChange(key: string, newQty: number) {
    if (newQty < 1) return;
    dispatch({ type: 'UPDATE_QUANTITY', payload: { key, quantity: newQty } });
  }

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto px-6 py-12">
        <p className="text-gray-500 text-center" aria-live="polite">
          Loading cart…
        </p>
      </main>
    );
  }

  if (cart.items.length === 0) {
    return (
      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-center py-20">
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Your Cart</h1>
          <p className="text-gray-500 mb-6">Your cart is empty.</p>
          <Link href="/" className="text-blue-600 hover:underline text-sm font-medium">
            ← Browse Articles
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-8">Your Cart</h1>

        {/* ── Line items ─────────────────────────────────────────────────── */}
        <ul className="divide-y divide-gray-200 mb-8" aria-label="Cart items">
          {cart.items.map((item) => (
            <li key={item.key} className="py-5 flex flex-wrap items-center gap-4">
              {/* Item info */}
              <div className="flex-1 min-w-0">
                <span className="block font-semibold text-gray-900 truncate">{item.name}</span>
                <span className="text-sm text-gray-500">{item.price}</span>
              </div>

              {/* Quantity controls */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="w-7 h-7 rounded border border-gray-300 text-gray-600 hover:border-blue-500 hover:text-blue-600 text-lg leading-none flex items-center justify-center disabled:opacity-40"
                  onClick={() => handleQuantityChange(item.key, item.quantity - 1)}
                  aria-label={`Decrease quantity of ${item.name}`}
                  disabled={item.quantity <= 1}
                >
                  −
                </button>
                <span className="w-6 text-center text-sm font-medium" aria-label={`Quantity: ${item.quantity}`}>
                  {item.quantity}
                </span>
                <button
                  type="button"
                  className="w-7 h-7 rounded border border-gray-300 text-gray-600 hover:border-blue-500 hover:text-blue-600 text-lg leading-none flex items-center justify-center"
                  onClick={() => handleQuantityChange(item.key, item.quantity + 1)}
                  aria-label={`Increase quantity of ${item.name}`}
                >
                  +
                </button>
              </div>

              {/* Line total */}
              <span className="text-sm font-semibold text-gray-900 min-w-[60px] text-right">{item.lineTotal}</span>

              {/* Remove button */}
              <button
                type="button"
                className="text-xs text-red-500 hover:text-red-700 underline transition-colors"
                onClick={() => removeItem(item.key)}
                aria-label={`Remove ${item.name} from cart`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        {/* ── Summary / totals ───────────────────────────────────────────── */}
        <div className="border-t border-gray-200 pt-6 mb-6 space-y-2">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Subtotal</span>
            <span>{cart.totals.subtotal}</span>
          </div>
          <div className="flex justify-between text-base font-bold text-gray-900">
            <span>Total</span>
            <strong>{cart.totals.total}</strong>
          </div>
        </div>

        {/* ── Checkout CTA ───────────────────────────────────────────────── */}
        <div className="space-y-3">
          <button
            type="button"
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors"
            onClick={handleCheckout}
            disabled={checkoutLoading}
            aria-busy={checkoutLoading}
          >
            {checkoutLoading ? 'Redirecting to Stripe…' : 'Proceed to Checkout'}
          </button>
          {checkoutError && (
            <p role="alert" className="text-xs text-red-500 text-center">{checkoutError}</p>
          )}
          <p className="text-xs text-gray-400 text-center">
            Secured by{' '}
            <a
              href="https://stripe.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-600"
            >
              Stripe
            </a>
            {' '}· SAQ-A PCI compliant
          </p>
        </div>

        {/* ── Back link ──────────────────────────────────────────────────── */}
        <Link href="/" className="inline-block mt-6 text-sm text-blue-600 hover:underline font-medium">
          ← Continue Shopping
        </Link>
      </div>
    </main>
  );
}
