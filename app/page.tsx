// app/page.tsx  Public article catalogue (homepage)
//
// INFORMATION ARCHITECTURE:
// 
// Mirrors IEEE Xplore's structure: the catalogue IS the landing page.
// Abstracts + titles are the front door; no separate marketing hero.
// "Read Full Article"  /article/[id] (Edge Middleware gated).
// The abstract is indexed by Google; the full text is the product.
//
// schema.org isAccessibleForFree: false signals a legitimate paywall
// to Googlebot  not cloaking. ISR revalidate: 3600 + tag 'public-articles'.

import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getPublicArticles } from '@/lib/wordpress';
import { getProducts } from '@/lib/woocommerce';
import ArticleCard from './ArticleCard';

// Dynamic — reads cookies() to detect auth state for the purchase CTA.
// Article data fetches are ISR-cached independently via wpFetch tags.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Member Articles',
  description:
    'In-depth technical articles on headless CMS architecture, edge authentication, ' +
    'ISR performance, and WordPress REST API development. Join to read in full.',
};

export default async function HomePage() {
  const cookieStore = cookies();
  const isAuthenticated = !!cookieStore.get('member_token')?.value;

  const [articlesResponse, products] = await Promise.all([
    getPublicArticles(),
    getProducts(),
  ]);

  const articles = articlesResponse.articles;
  const annualPass = products.find((p) => p.sku === 'ACCESS-ANNUAL-2024') ?? products[0];

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            name: 'Member Articles',
            description: metadata.description,
            itemListElement: articles.map((article, idx) => ({
              '@type': 'ListItem',
              position: idx + 1,
              item: {
                '@type': 'Article',
                '@id': `https://headless-wp-demo.vercel.app/article/${article.id}`,
                headline: article.title,
                description: article.excerpt,
                datePublished: article.date,
                isAccessibleForFree: false,
                hasPart: {
                  '@type': 'WebPageElement',
                  isAccessibleForFree: false,
                  cssSelector: '.article-full-content',
                },
              },
            })),
          }),
        }}
      />

      <div className="mb-10">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Member Articles</h1>
        <p className="text-base text-gray-500 max-w-2xl">
          Deep dives into headless CMS architecture, edge authentication, ISR, and more.
          <br />
          Preview titles and abstracts — full access requires membership.
        </p>
      </div>

      {annualPass && (
        <div className="flex flex-wrap items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 mb-8 text-sm">
          <span className="font-semibold text-blue-700">Unlock all articles:</span>
          <span className="text-gray-700">
            <strong>{annualPass.price}/yr</strong> (Annual) &nbsp;&nbsp;
            <strong>$12.00/mo</strong> (Monthly) &nbsp;&nbsp;
            <strong>$4.99</strong> per article
          </span>
        </div>
      )}

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" aria-label="Article previews">
        {articles.map((article) => (
          <ArticleCard
            key={article.id}
            article={article}
            annualPass={annualPass ?? null}
            isAuthenticated={isAuthenticated}
          />
        ))}
      </section>
    </main>
  );
}
