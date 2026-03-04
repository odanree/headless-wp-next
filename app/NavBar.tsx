'use client';

// ─── NavBar ───────────────────────────────────────────────────────────────────
// Client Component — reads CartContext for the item count badge.
// Lives inside CartProvider (root layout), which is the client boundary.

import Link from 'next/link';
import { useCart } from '@/contexts/CartContext';
import { useEffect, useState } from 'react';

export default function NavBar() {
  const { itemCount } = useCart();
  // Guard against server/client hydration mismatch: localStorage cart is
  // unavailable on the server so itemCount starts at 0 there but may be >0
  // on the client after the context useEffect fires. Suppress the badge
  // until after hydration to keep the DOM identical on both passes.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const displayCount = mounted ? itemCount : 0;

  return (
    <nav className="sticky top-0 z-50 bg-[#1a1a2e] border-b border-white/10 h-14 flex items-center" aria-label="Main navigation">
      <div className="flex items-center gap-8 max-w-6xl w-full mx-auto px-6">

        <Link href="/" className="text-white font-extrabold text-lg tracking-tight shrink-0" aria-label="Headless WP home">
          Headless<span className="text-blue-400">WP</span>
        </Link>

        <ul className="flex items-center gap-6 list-none p-0 m-0 flex-1" role="list">
          <li>
            <Link href="/" className="text-white/70 hover:text-white text-sm font-medium transition-colors">
              Articles
            </Link>
          </li>
          <li>
            <Link href="/members" className="text-white/70 hover:text-white text-sm font-medium transition-colors">
              Members
            </Link>
          </li>
          <li>
            <Link href="/join" className="text-white/70 hover:text-white text-sm font-medium transition-colors">
              Join
            </Link>
          </li>
        </ul>

        <Link
          href="/cart"
          className="relative text-white/80 hover:text-white transition-colors ml-auto"
          aria-label={displayCount > 0 ? `Cart — ${displayCount} item${displayCount !== 1 ? 's' : ''}` : 'Cart — empty'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
          {displayCount > 0 && (
            <span className="absolute -top-2 -right-2 bg-blue-600 text-white text-[0.65rem] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1 ring-2 ring-[#1a1a2e]" aria-hidden="true">
              {displayCount > 99 ? '99+' : displayCount}
            </span>
          )}
        </Link>

      </div>
    </nav>
  );
}
