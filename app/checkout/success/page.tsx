import Link from 'next/link';
import type { Metadata } from 'next';
import ClearCartOnMount from './ClearCartOnMount';

// ─── Checkout Success page ─────────────────────────────────────────────────────
// Pure display page — no Stripe SDK, no cookie logic.
//
// Cookie is set upstream in GET /api/auth/stripe-callback (a Route Handler),
// which is the only context where cookies().set() is permitted in Next.js 14
// App Router. That handler verifies the Stripe session, sets member_token,
// then redirects here with ?email= for personalised display.

export const metadata: Metadata = {
  title: 'Payment Successful',
  robots: { index: false },
};

interface PageProps {
  searchParams: { email?: string };
}

export default async function CheckoutSuccessPage({ searchParams }: PageProps) {
  const email = searchParams.email ?? null;

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      {/* Clears localStorage cart after successful payment — renders nothing */}
      <ClearCartOnMount />
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
