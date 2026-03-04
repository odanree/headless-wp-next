import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getMemberArticleById, getMemberArticles } from '@/lib/wordpress';
import { LogoutButton } from '@/app/members/LogoutButton';

// ─── Article detail ───────────────────────────────────────────────────────────
// SERVER COMPONENT — reads auth-keyed WordPress content via ISR.
//
// Route: /article/[id]
// Guard: middleware.ts redirects unauthenticated users to /join before render.
//
// Schema.org "metered paywall" signal:
//   The .article-full-content CSS class is referenced by the JSON-LD script
//   in app/layout.tsx so Googlebot knows where the gated content begins.
//   See: https://developers.google.com/search/docs/appearance/structured-data/paywalled-content

type Props = { params: { id: string } };

// Allow paths not returned by generateStaticParams to be rendered on-demand.
// This means the build never hard-fails when WordPress is unreachable —
// articles simply render dynamically at request time instead.
export const dynamicParams = true;

export async function generateStaticParams() {
  // Best-effort: pre-render known articles at build time for faster cold loads.
  // Falls back to an empty array (fully dynamic) when WordPress is unreachable
  // (e.g. during Vercel build before the DO Droplet is provisioned).
  try {
    const { articles } = await getMemberArticles();
    return articles.map((a) => ({ id: String(a.id) }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = await getMemberArticleById(Number(params.id));
  if (!article) return { title: 'Article not found' };
  return {
    title: article.title,
    description: article.excerpt,
    robots: { index: false },
  };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default async function ArticlePage({ params }: Props) {
  const article = await getMemberArticleById(Number(params.id));

  if (!article) notFound();

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      {/* Top nav bar */}
      <nav className="flex items-center justify-between mb-10">
        <Link
          href="/"
          className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
        >
          ← All Articles
        </Link>
        <LogoutButton />
      </nav>

      <article>
        {/* Article meta */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <span className="text-[0.7rem] font-semibold uppercase tracking-widest bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
            {article.category}
          </span>
          <span className="text-xs text-gray-400">{article.readTime} min read</span>
          <time className="text-xs text-gray-400" dateTime={article.date}>
            {formatDate(article.date)}
          </time>
        </div>

        <h1 className="text-3xl font-extrabold text-gray-900 leading-tight mb-4">
          {article.title}
        </h1>

        <p className="text-lg text-gray-500 mb-8">{article.excerpt}</p>

        <hr className="border-gray-200 mb-8" />

        {/*
         * .article-full-content ← schema.org CSS selector target.
         * JSON-LD in layout.tsx references this class to signal to Googlebot
         * that the content below is the gated paywall section.
         */}
        <div
          className="article-full-content prose prose-gray max-w-none text-gray-800 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: article.content }}
        />
      </article>
    </main>
  );
}
