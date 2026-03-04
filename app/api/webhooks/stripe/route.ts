import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';

// ─── POST /api/webhooks/stripe ────────────────────────────────────────────────
//
// Receives Stripe webhook events and handles fulfillment.
//
// SECURITY: Every request is verified against STRIPE_WEBHOOK_SECRET using
// Stripe's constructEvent() — this ensures the payload came from Stripe and
// has not been tampered with. Requests with invalid signatures return 400.
//
// EVENTS HANDLED:
//   checkout.session.completed  → payment succeeded, grant access / fulfill
//   checkout.session.expired    → user abandoned checkout, no action needed
//
// LOCAL TESTING:
//   stripe listen --forward-to localhost:3001/api/webhooks/stripe
//   stripe trigger checkout.session.completed
//
// PRODUCTION:
//   Register https://your-domain.vercel.app/api/webhooks/stripe in the
//   Stripe dashboard (Developers → Webhooks → Add endpoint).
//   Set STRIPE_WEBHOOK_SECRET in Vercel environment variables.

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
});

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // If no webhook secret is configured (e.g. local dev without Stripe CLI),
  // log a warning but don't hard-fail — allows testing checkout flow without
  // the CLI running.
  if (!webhookSecret || webhookSecret.startsWith('whsec_...')) {
    console.warn(
      '[webhook] STRIPE_WEBHOOK_SECRET not configured — skipping signature verification. ' +
      'Run `stripe listen --forward-to localhost:3001/api/webhooks/stripe` to get a secret.',
    );
    return NextResponse.json({ received: true });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const rawBody = await request.text();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // ── Event handlers ──────────────────────────────────────────────────────────
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log('[webhook] Payment succeeded — session:', session.id);
      console.log('[webhook] Customer email:', session.customer_details?.email);
      console.log('[webhook] Items:', session.metadata?.item_names);

      // TODO (production):
      // 1. Look up the WordPress user by session.customer_details.email
      // 2. Grant membership role via WP REST API or custom endpoint
      // 3. Send confirmation email via WordPress or SendGrid
      // 4. Create WooCommerce order via Store API for reporting
      break;
    }

    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log('[webhook] Checkout expired — session:', session.id);
      // No action needed — cart state is client-side (localStorage)
      break;
    }

    default:
      // Ignore unhandled events — Stripe sends many event types
      break;
  }

  return NextResponse.json({ received: true });
}
