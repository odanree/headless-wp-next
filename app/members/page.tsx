import Link from 'next/link';
import type { Metadata } from 'next';
import { getMemberArticles, WordPressAuthError, WordPressAPIError } from '@/lib/wordpress';
import { LogoutButton } from './LogoutButton';

export const metadata: Metadata = {
  title: 'Members',
  robots: { index: false },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default async function MembersPage() {
  let data;

  try {
    data = await getMemberArticles();
  } catch (err) {
    if (err instanceof WordPressAuthError) {
      return (
        <main className="max-w-4xl mx-auto px-6 py-12">
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-sm text-red-700">
            <p>Session expired. <Link href="/join" className="underline font-medium">Sign in again →</Link></p>
          </div>
        </main>
      );
    }
    if (err instanceof WordPressAPIError) {
      return (
        <main className="max-w-4xl mx-auto px-6 py-12">
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-sm text-red-700">
            <p>Could not load articles (WordPress API error). Try refreshing.</p>
          </div>
        </main>
      );
    }
    throw err;
  }

  const { articles } = data;

  return (
    <main className="max-w-4xl mx-auto px-6 py-12">
      <header className="flex items-start justify-between mb-10">
        <div>
          <Link href="/" className="text-sm text-blue-600 hover:underline font-medium mb-2 block">← Home</Link>
          <h1 className="text-2xl font-bold text-gray-900">Members Articles</h1>
          <p className="text-sm text-gray-500 mt-1">
            {articles.length} article{articles.length !== 1 ? 's' : ''} · members only
          </p>
        </div>
        <LogoutButton />
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {articles.map((article) => (
          <Link
            key={article.id}
            href={`/article/${article.id}`}
            className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow flex flex-col gap-2 no-underline"
          >
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span className="bg-blue-50 text-blue-600 font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full text-[0.65rem]">
                {article.category}
              </span>
              <span>{article.readTime} min read</span>
            </div>
            <h2 className="text-base font-bold text-gray-900 leading-snug">{article.title}</h2>
            <p className="text-sm text-gray-500 line-clamp-2 flex-1">{article.excerpt}</p>
            <span className="text-xs text-gray-400 mt-auto">{formatDate(article.date)}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
