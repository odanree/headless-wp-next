'use client';

import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      aria-label="Sign out"
      className="text-sm text-gray-500 hover:text-gray-800 underline transition-colors"
    >
      Sign out
    </button>
  );
}
