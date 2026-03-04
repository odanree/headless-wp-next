'use client';

// ─── ArticleCard ──────────────────────────────────────────────────────────────
// Client component so it can call useCart() for the "Add to Cart" interaction.
// The parent page.tsx is a Server Component — this keeps interactivity isolated
// to the card level (RSC islands pattern).

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useCart } from '@/contexts/CartContext';
import type { ArticleSummary } from '@/types/wordpress';
import type { WooProduct } from '@/types/woocommerce';

interface ArticleCardProps {
  article: ArticleSummary;
  /** Annual Access Pass product used for the primary "Purchase Access" CTA */
  annualPass: WooProduct | null;
}

export default function ArticleCard({ article, annualPass }: ArticleCardProps) {
  const { addProductToCart, state } = useCart();
  const [added, setAdded] = useState(false);
  // Guard against hydration mismatch: cart is rehydrated from localStorage on
  // the client. Suppress cart-derived state until after first render so the
  // server and client HTML are identical on the initial pass.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const alreadyInCart =
    mounted && annualPass != null && state.cart.items.some((i) => i.id === annualPass.id);

  function handleAddToCart() {
    if (!annualPass || alreadyInCart) return;
    addProductToCart({
      id: annualPass.id,
      name: annualPass.name,
      price: annualPass.price,
      sku: annualPass.sku,
    });
    setAdded(true);
    // Reset confirmation text after 2 s
    setTimeout(() => setAdded(false), 2000);
  }

  return (
    <article
      className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col gap-3 hover:shadow-md transition-shadow"
      aria-labelledby={`article-title-${article.id}`}
    >
      {/* Category badge */}
      {article.category && (
        <span
          className="self-start text-[0.7rem] font-semibold uppercase tracking-widest bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full"
          aria-label={`Category: ${article.category}`}
        >
          {article.category}
        </span>
      )}

      {/* Title */}
      <h2
        id={`article-title-${article.id}`}
        className="text-lg font-bold text-gray-900 leading-snug"
      >
        {article.title}
      </h2>

      {/* Excerpt / teaser — 3-line clamp */}
      <p className="text-sm text-gray-600 line-clamp-3 flex-1">{article.excerpt}</p>

      {/* Meta row */}
      <div className="flex items-center gap-3 text-xs text-gray-400">
        <time dateTime={article.date}>
          {new Date(article.date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </time>
        {article.readTime && (
          <span className="before:content-['·'] before:mr-3">{article.readTime} read</span>
        )}
      </div>

      {/* CTA row */}
      <div className="flex flex-wrap gap-2 mt-1">
        {/* Primary: Read full article — gated by middleware → /article/[id] */}
        <Link
          href={`/article/${article.id}`}
          className="flex-1 text-center bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors"
          aria-label={`Read full article: ${article.title}`}
        >
          Read Full Article →
        </Link>

        {/* Secondary: add Annual Access Pass to cart */}
        {annualPass && (
          <button
            type="button"
            className={
              alreadyInCart || added
                ? 'flex-1 text-center bg-green-100 text-green-700 text-sm font-semibold py-2 px-4 rounded-lg cursor-default'
                : 'flex-1 text-center border border-blue-600 text-blue-600 hover:bg-blue-50 text-sm font-semibold py-2 px-4 rounded-lg transition-colors'
            }
            onClick={handleAddToCart}
            disabled={alreadyInCart || added}
            aria-label={
              alreadyInCart
                ? 'Annual Access Pass already in cart'
                : `Purchase Annual Access Pass for ${annualPass.price}`
            }
          >
            {alreadyInCart
              ? '✓ In Cart'
              : added
              ? '✓ Added!'
              : `Purchase Access — ${annualPass.price}/yr`}
          </button>
        )}
      </div>
    </article>
  );
}
