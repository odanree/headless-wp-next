'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type View = 'cta' | 'login';

export function JoinForm({ redirectBack }: { redirectBack: string }) {
  const router = useRouter();

  const [view, setView] = useState<View>('cta');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error ?? 'Login failed. Please try again.');
      return;
    }

    router.push(redirectBack);
    router.refresh();
  }

  if (view === 'login') {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-16">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 w-full max-w-md">
          <button
            className="text-sm text-blue-600 hover:underline mb-6 block"
            onClick={() => setView('cta')}
          >
            ← Back
          </button>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Sign in to your account</h1>
          <p className="text-sm text-gray-500 mb-7">Enter your credentials to access member articles.</p>

          <form onSubmit={handleLogin} className="space-y-5">
            <label className="block text-sm font-medium text-gray-700">
              Username
              <input
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your-username"
                required
                autoFocus
              />
            </label>

            <label className="block text-sm font-medium text-gray-700">
              Password
              <input
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </label>

            {/* aria-live="assertive" announces errors immediately to screen readers (ADA) */}
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
              aria-label={loading ? 'Signing in, please wait' : 'Sign in'}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-5 text-xs text-gray-400 text-center">
            Demo password: <code className="bg-gray-100 px-1 py-0.5 rounded font-mono">members-only-2026</code>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-16">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 w-full max-w-md">
        <Link href="/" className="text-sm text-blue-600 hover:underline mb-6 block">← Home</Link>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Members-only content</h1>
        <p className="text-sm text-gray-500 mb-7">
          Sign in to access the full article library.
        </p>

        <ul className="space-y-2 mb-7 text-sm text-gray-700 list-disc list-inside">
          <li>In-depth technical articles</li>
          <li>Architecture deep-dives</li>
          <li>WordPress + Next.js best practices</li>
          <li>On-demand ISR and caching patterns</li>
        </ul>

        <button
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors mb-4"
          onClick={() => setView('login')}
        >
          Sign in →
        </button>

        <p className="text-xs text-gray-400 text-center">
          Already have an account?{' '}
          <button
            className="text-blue-600 hover:underline text-xs"
            onClick={() => setView('login')}
          >
            Sign in here
          </button>
        </p>
      </div>
    </main>
  );
}
