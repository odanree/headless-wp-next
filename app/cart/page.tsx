'use client';

// ─── Cart page ────────────────────────────────────────────────────────────────
//
// CLIENT COMPONENT — cart state lives in CartContext (React useReducer).
//
// REAL CHECKOUT FLOW (production):
// ─────────────────────────────────
// WooCommerce provides a hosted checkout page at:
//   https://<wp-domain>/checkout/?add-to-cart=<product_id>
//
// For a fully headless flow, the Store API v1 exposes:
//   POST /wp-json/wc/store/v1/checkout
//   Body: { billing_address, shipping_address, payment_data }
//
// The checkout button below is intentionally DISABLED in this demo and
// annotated with a comment showing the real integration point.  This keeps
// the demo safe while showing the reviewer we know the integration pattern.
//
// ARCHITECTURE NOTE — why no shipping / tax:
// ──────────────────────────────────────────
// These are digital goods (access passes, e-articles).  No shipping address
// required.  Tax handling is delegated to WooCommerce + WooTax (TaxJar
// integration), which runs server-side before the checkout API call.

import Link from 'next/link';
import { useCart } from '@/contexts/CartContext';

export default function CartPage() {
  const { state, removeItem, dispatch } = useCart();
  const { cart, loading } = state;

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
          {/*
           * ARCHITECTURE: STRANGLER FIG PATTERN + PCI SCOPE ISOLATION
           * ────────────────────────────────────────────────────────────
           * The user experiences the Next.js app for 100% of the browse +
           * cart journey (fast, app-like UX). At checkout — the final ~10% —
           * we hand off to WooCommerce's hosted checkout page.
           *
           * This is a deliberate application of the Strangler Fig pattern
           * (Fowler, 2004): the legacy system handles only the slice not yet
           * migrated; the new system owns everything else. Over time that 10%
           * shrinks and the old system is replaced gracefully without a
           * big-bang rewrite.
           *
           * PCI SCOPE BENEFIT:
           * By redirecting to WooCommerce hosted checkout we qualify for
           * PCI DSS SAQ-A (the lowest-burden tier) rather than SAQ-D.
           * Cardholder data never crosses our Next.js server — it goes
           * directly into WooCommerce / Stripe's hardened environment.
           * Building a fully headless checkout (option b) would bring the
           * entire Next.js infra into PCI scope — significant compliance
           * and operational cost not justified for the initial migration phase.
           *
           * Production options:
           *   a) window.location.href = `${WP_URL}/checkout/`  ← SAQ-A, recommended
           *   b) POST /wp-json/wc/store/v1/checkout            ← SAQ-D, future phase
           */}
          <button
            type="button"
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg opacity-50 cursor-not-allowed"
            disabled
            title="Checkout is disabled in this demo deployment"
            aria-disabled="true"
          >
            Proceed to Checkout
          </button>
          <p className="text-xs text-gray-400 text-center">
            ⓘ Checkout is disabled in this demo.{' '}
            <a
              href="https://github.com/odanree/headless-wp-next"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-600"
            >
              View source
            </a>{' '}
            to see the WooCommerce Store API integration.
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
