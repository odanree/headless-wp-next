import Link from 'next/link';
import type { Metadata } from 'next';

// ─── Checkout Success page ─────────────────────────────────────────────────────
// Stripe redirects here after a successful payment with ?session_id=cs_...
// In production: fetch the session from Stripe to display order details,
// confirm membership access was granted, and show a personalised message.

export const metadata: Metadata = {
  title: 'Payment Successful',
  robots: { index: false },
};

export default function CheckoutSuccessPage() {
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
        <p className="text-gray-500 mb-8">
          Your access has been activated. Welcome to the member library.
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
