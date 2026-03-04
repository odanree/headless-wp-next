import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Stripe from 'stripe';

// ─── Checkout Success page ─────────────────────────────────────────────────────
// Stripe redirects here after a successful payment with ?session_id=cs_...
//
// Step 1 — retrieve the Checkout Session from Stripe (server-side only).
// Step 2 — confirm payment_status === 'paid'; redirect to /cart if not.
// Step 3 — mint the member_token httpOnly cookie (same mechanism as login).
//           Value: "stripe:<session_id>" → distinguishable from password login.
// Step 4 — render a personalised confirmation with the customer's email.
//
// The cookie grants middleware access to /article/* immediately — no page
// reload required because the browser re-evaluates cookies on the next
// navigation, which the "Go to Members" link triggers.

export const metadata: Metadata = {
  title: 'Payment Successful',
  robots: { index: false },
};

// Force dynamic so Next.js always re-runs this on every request (never cached).
// Required because we write a Set-Cookie header at render time.
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { session_id?: string };
}

export default async function CheckoutSuccessPage({ searchParams }: PageProps) {
  const sessionId = searchParams.session_id;

  // No session_id → not a real Stripe redirect; send back to cart
  if (!sessionId) {
    redirect('/cart');
  }

  // Verify the session with Stripe (server-side — secret key never leaves server)
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-02-25.clover',
  });

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    // Invalid or expired session_id
    redirect('/cart');
  }

  // Guard: only grant access for confirmed paid sessions
  if (session.payment_status !== 'paid') {
    redirect('/cart');
  }

  // Mint the member_token cookie — same httpOnly/SameSite pattern as /api/auth/login
  // Value encodes the Stripe session so it's auditable without a DB
  const isProduction = (process.env.NODE_ENV as string) === 'production';
  const cookieStore = cookies();
  cookieStore.set('member_token', `stripe:${session.id}`, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

  const email = session.customer_details?.email ?? null;

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 max-w-md w-full text-center">
        {/* Success icon */}
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg
            className="w-8 h-8 text-green-600"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment successful</h1>
        {email ? (
          <p className="text-gray-500 mb-2">
            A receipt has been sent to <span className="font-medium text-gray-700">{email}</span>.
          </p>
        ) : null}
        <p className="text-gray-500 mb-8">
          Your member access has been activated. You can now read all articles in the library.
        </p>

        <div className="flex flex-col gap-3">
          <Link
            href="/members"
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg transition-colors"
          >
            Go to Member Articles →
          </Link>
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Back to catalogue
          </Link>
        </div>
      </div>
    </main>
  );
}
