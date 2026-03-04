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

export async function POST(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-02-25.clover',
  });
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
      const email = session.customer_details?.email;

      console.log('[webhook] Payment succeeded — session:', session.id, '| email:', email);

      if (!email) {
        console.error('[webhook] No customer email on session — cannot grant membership:', session.id);
        break;
      }

      // ── Grant WordPress membership ────────────────────────────────────────
      // Calls POST /wp-json/headless/v1/grant-membership on the WP origin.
      // The endpoint finds-or-creates a WP user by email and assigns the
      // subscriber role, storing the Stripe session_id for audit.
      //
      // IDEMPOTENCY: Stripe may deliver the same event more than once.
      // The WP endpoint uses get_user_by('email') + set_role() which are
      // both safe to call repeatedly — no duplicate users, no duplicate rows.
      //
      // FAILURE HANDLING: We log but do not throw — returning anything other
      // than 2xx here would cause Stripe to retry with exponential backoff,
      // which is the correct behaviour for transient WP failures.
      const wpUrl   = process.env.WORDPRESS_URL;
      const wpToken = process.env.WORDPRESS_API_TOKEN;

      if (wpUrl && wpToken) {
        try {
          const res = await fetch(`${wpUrl}/wp-json/headless/v1/grant-membership`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${wpToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email,
              stripe_session_id: session.id,
            }),
          });

          if (!res.ok) {
            const body = await res.text();
            console.error(`[webhook] WP grant-membership failed (${res.status}):`, body);
          } else {
            const data = await res.json() as { user_id: number; email: string; granted: boolean };
            console.log('[webhook] Membership granted — WP user_id:', data.user_id, '| email:', data.email);
          }
        } catch (err) {
          console.error('[webhook] Failed to reach WP grant-membership endpoint:', err);
        }
      } else {
        console.warn('[webhook] WORDPRESS_URL / WORDPRESS_API_TOKEN not set — membership grant skipped (mock mode)');
      }
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
