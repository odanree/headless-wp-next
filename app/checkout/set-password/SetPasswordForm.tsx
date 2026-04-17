'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SetPasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [skipped, setSkipped] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    const res = await fetch('/api/auth/set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error ?? 'Something went wrong. Please try again.');
      return;
    }

    router.push(`/checkout/success${email ? `?email=${encodeURIComponent(email)}` : ''}`);
  }

  function handleSkip() {
    setSkipped(true);
    router.push(`/checkout/success${email ? `?email=${encodeURIComponent(email)}` : ''}`);
  }

  if (skipped) return null;

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-16">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 w-full max-w-md">
        {/* Success icon */}
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-6">
          <svg
            className="w-6 h-6 text-green-600"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-1">Payment successful!</h1>
        <p className="text-sm text-gray-500 mb-7">
          Set a password so you can sign back in any time without paying again.
          {email ? (
            <>
              {' '}Your account email is{' '}
              <span className="font-medium text-gray-700">{email}</span>.
            </>
          ) : null}
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="block text-sm font-medium text-gray-700">
            Password
            <input
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              autoFocus
              minLength={8}
            />
          </label>

          <label className="block text-sm font-medium text-gray-700">
            Confirm password
            <input
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              required
            />
          </label>

          <p
            role="alert"
            aria-live="assertive"
            className="text-sm text-red-600 min-h-[1.25rem]"
            style={{ display: error ? undefined : 'none' }}
          >
            {error}
          </p>

          <button
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition-colors"
            type="submit"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? 'Saving…' : 'Set password & continue'}
          </button>
        </form>

        <button
          className="mt-4 w-full text-sm text-gray-400 hover:text-gray-600 transition-colors"
          onClick={handleSkip}
        >
          Skip for now
        </button>
      </div>
    </main>
  );
}
