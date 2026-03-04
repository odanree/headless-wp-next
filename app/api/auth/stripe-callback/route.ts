import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';

// ─── GET /api/auth/stripe-callback ────────────────────────────────────────────
//
// Stripe's success_url points here (not directly to /checkout/success) because
// cookies().set() is only permitted in Route Handlers and Server Actions —
// not in Server Component pages (Next.js 14 App Router constraint).
//
// Flow:
//   1. Stripe redirects to /api/auth/stripe-callback?session_id=cs_...
//   2. This handler verifies the session with the Stripe SDK
//   3. Sets the httpOnly member_token cookie (Set-Cookie response header)
//   4. Redirects to /checkout/success?email=... for display
//
// The success page is now a pure display component — no Stripe SDK, no cookies.

export async function GET(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-02-25.clover',
  });
  const sessionId = request.nextUrl.searchParams.get('session_id');

  if (!sessionId) {
    redirect('/cart');
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    redirect('/cart');
  }

  if (session.payment_status !== 'paid') {
    redirect('/cart');
  }

  // Set the httpOnly member_token cookie — Route Handler context allows this.
  const isProduction = (process.env.NODE_ENV as string) === 'production';
  cookies().set('member_token', `stripe:${session.id}`, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

  // Pass email to the success page as a query param for personalised display.
  // Email is not sensitive here — it was already shown on the Stripe hosted page.
  const email = session.customer_details?.email ?? '';
  const successUrl = email
    ? `/checkout/success?email=${encodeURIComponent(email)}`
    : '/checkout/success';

  redirect(successUrl);
}
