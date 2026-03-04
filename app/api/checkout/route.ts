import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';

// ─── POST /api/checkout ────────────────────────────────────────────────────────
//
// Creates a Stripe Checkout Session from the cart items passed in the request
// body and returns the session URL for the client to redirect to.
//
// FLOW:
//   1. Client POSTs cart items from CartContext
//   2. This route creates a Stripe Checkout Session (hosted on stripe.com)
//   3. Returns { url } — client does window.location.href = url
//   4. User completes payment on Stripe's hosted page (SAQ-A — no card data
//      ever touches our server)
//   5. Stripe redirects to /checkout/success?session_id={CHECKOUT_SESSION_ID}
//   6. Stripe fires checkout.session.completed webhook → /api/webhooks/stripe
//
// PCI NOTE: Because we redirect to Stripe's hosted Checkout page, we qualify
// for PCI DSS SAQ-A — the lowest burden tier. Card data never crosses our
// Next.js server or Vercel infrastructure.

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
});

interface CartLineItem {
  name: string;
  price: string;   // e.g. "$49.00" or "49.00"
  quantity: number;
}

function parsePriceCents(price: string): number {
  // Strip currency symbols and convert to cents
  const numeric = parseFloat(price.replace(/[^0-9.]/g, ''));
  return Math.round(numeric * 100);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { items: CartLineItem[] };
    const { items } = body;

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    const origin = request.headers.get('origin') ?? 'http://localhost:3001';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: items.map((item) => ({
        price_data: {
          currency: 'usd',
          unit_amount: parsePriceCents(item.price),
          product_data: {
            name: item.name,
          },
        },
        quantity: item.quantity,
      })),
      // Redirect URLs after Stripe-hosted checkout
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cart`,
      // Store cart metadata for the webhook fulfillment handler
      metadata: {
        item_count: String(items.length),
        item_names: items.map((i) => i.name).join(', ').slice(0, 500),
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('[/api/checkout]', err);
    const message = err instanceof Error ? err.message : 'Stripe error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
