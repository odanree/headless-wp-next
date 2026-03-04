import type { WordPressArticle, WordPressArticlesResponse } from '@/types/wordpress';

// ─────────────────────────────────────────────────────────────────────────────
// Mock data — used when WORDPRESS_URL is not set.
// Shape is identical to what the real WordPress plugin returns so
// swapping in a live WP backend requires zero code changes.
// ─────────────────────────────────────────────────────────────────────────────

export const MOCK_ARTICLES: WordPressArticle[] = [
  {
    id: 1,
    slug: 'getting-started-headless-wordpress',
    title: 'Getting Started with Headless WordPress',
    excerpt:
      'How to decouple your WordPress backend from the frontend using the REST API and a modern JS framework.',
    content: `
      <p>Headless WordPress separates the content management layer (WordPress) from the presentation layer (Next.js, Nuxt, SvelteKit, etc.). WordPress becomes a pure API backend — you write content in the familiar Gutenberg editor and expose it via <code>wp-json/</code>.</p>
      <h2>Why go headless?</h2>
      <ul>
        <li><strong>Performance</strong> — Pre-render pages at build time or at the edge. No PHP execution on every request.</li>
        <li><strong>Developer experience</strong> — Use the JS tooling you already know (TypeScript, CSS Modules, Vitest).</li>
        <li><strong>CDN-friendly</strong> — Static or ISR output sits on a global CDN; WordPress only gets hit on cache misses or webhook-triggered revalidation.</li>
      </ul>
      <h2>The request flow</h2>
      <p>Next.js Server Components call <code>fetch()</code> directly against <code>/wp-json/wp/v2/posts</code>. The response is cached with <code>next: { revalidate: 300 }</code>. On-demand invalidation is triggered by a WordPress <code>save_post</code> hook POSTing to <code>/api/revalidate</code>.</p>
    `,
    date: '2026-02-10T09:00:00Z',
    readTime: 7,
    category: 'Architecture',
  },
  {
    id: 2,
    slug: 'nextjs-middleware-auth-cookies',
    title: 'Auth at the Edge: Next.js Middleware + httpOnly Cookies',
    excerpt:
      'Why httpOnly cookies beat localStorage for auth tokens, and how Edge Middleware enforces access before a single byte of page JS loads.',
    content: `
      <p>localStorage is readable by any JavaScript on the page — including injected third-party scripts. An httpOnly cookie is completely invisible to JavaScript; only the browser's HTTP layer can read it. That makes it the right choice for storing session tokens in a headless app.</p>
      <h2>The Middleware pattern</h2>
      <p>Next.js Middleware runs on the <strong>Edge</strong> — before the router resolves, before Server Components execute, before any bundle is sent. It's the cheapest possible place to enforce authentication.</p>
      <pre><code>// middleware.ts
export function middleware(request) {
  const token = request.cookies.get('member_token')?.value;
  if (!token) return NextResponse.redirect('/join');
  // forward the token value to Server Components via a header
  const res = NextResponse.next();
  res.headers.set('x-member-token', token);
  return res;
}</code></pre>
      <p>The token rides from the cookie to a request header inside the Vercel edge network — it never touches the browser.</p>
    `,
    date: '2026-02-17T11:30:00Z',
    readTime: 6,
    category: 'Security',
  },
  {
    id: 3,
    slug: 'isr-on-demand-revalidation',
    title: 'ISR vs On-Demand Revalidation — When to Use Each',
    excerpt:
      'Time-based ISR is simple but blunt. On-demand revalidation with revalidateTag() lets WordPress trigger precise cache busts without a redeploy.',
    content: `
      <p>Incremental Static Regeneration (ISR) regenerates a page in the background after a defined staleness window. It's a great default — but it means content updates can take up to <code>revalidate</code> seconds to appear (<code>stale-while-revalidate</code> semantics).</p>
      <h2>On-demand revalidation</h2>
      <p>Next.js 14 adds <code>revalidateTag()</code>. Tag your fetches:</p>
      <pre><code>fetch(url, { next: { tags: ['articles'] } })</code></pre>
      <p>Then from a WordPress <code>save_post</code> hook, POST to your Next.js revalidation API route:</p>
      <pre><code>// app/api/revalidate/route.ts
import { revalidateTag } from 'next/cache';
export async function POST(req) {
  const { tag, secret } = await req.json();
  if (secret !== process.env.REVALIDATION_SECRET) return Response.json({ ok: false }, { status: 401 });
  revalidateTag(tag);
  return Response.json({ revalidated: true });
}</code></pre>
      <p>Content is live in milliseconds after a WordPress save — no polling, no TTL expiry, no redeploy.</p>
    `,
    date: '2026-02-22T14:00:00Z',
    readTime: 8,
    category: 'Performance',
  },
  {
    id: 4,
    slug: 'server-client-component-composition',
    title: 'Server + Client Component Composition in the App Router',
    excerpt:
      'The App Router default is Server Components. Client Components are opt-in. Understanding the boundary is the key skill interviewers test.',
    content: `
      <p>Every component in the App Router is a Server Component by default. It renders on the server (or at build time), sends HTML to the browser, and ships <strong>zero JavaScript</strong> to the client — unless you explicitly opt in with <code>'use client'</code>.</p>
      <h2>The composition rule</h2>
      <p>Server Components <em>can</em> render Client Components as children. Client Components <em>cannot</em> import Server Components — but they <em>can</em> accept them as <code>children</code> props (the "donut" pattern).</p>
      <pre><code>// page.tsx (Server Component — fetches data)
import { LogoutButton } from './LogoutButton'; // 'use client'

export default async function MembersPage() {
  const articles = await getMemberArticles(); // runs on server
  return (
    &lt;main&gt;
      &lt;LogoutButton /&gt;  {/* client island for interaction */}
      {articles.map(a => &lt;ArticleCard key={a.id} article={a} /&gt;)}
    &lt;/main&gt;
  );
}</code></pre>
      <p>The data fetching, auth validation, and HTML rendering stay on the server. Only the logout button ships client-side JS.</p>
    `,
    date: '2026-02-25T08:00:00Z',
    readTime: 5,
    category: 'Next.js',
  },
  {
    id: 5,
    slug: 'wordpress-custom-post-types-rest',
    title: 'Exposing WordPress Custom Post Types via REST API',
    excerpt:
      'register_post_type() with show_in_rest: true is just the start. Custom endpoints, field sanitization, and Bearer token auth make it production-ready.',
    content: `
      <p>WordPress core exposes all public post types at <code>/wp-json/wp/v2/{type}</code> when you set <code>show_in_rest: true</code> during registration. But the default REST response is verbose and exposes fields you may not want public.</p>
      <h2>Custom REST endpoints</h2>
      <p>For finer control, register your own namespace:</p>
      <pre><code>register_rest_route( 'myplugin/v1', '/articles', [
  'methods'             => 'GET',
  'callback'            => 'my_get_articles',
  'permission_callback' => 'my_check_bearer_token',
] );</code></pre>
      <h2>Bearer token auth</h2>
      <p>For server-to-server calls from Next.js, a shared secret is simpler than OAuth. Store it in both <code>wp-config.php</code> (as a constant) and your Next.js <code>.env.local</code>. Always compare with <code>hash_equals()</code> — not <code>===</code> — to prevent timing attacks.</p>
    `,
    date: '2026-03-01T10:00:00Z',
    readTime: 9,
    category: 'WordPress',
  },
];

export function getMockArticles(): WordPressArticlesResponse {
  return {
    articles: MOCK_ARTICLES,
    total: MOCK_ARTICLES.length,
    totalPages: 1,
  };
}

export function getMockArticleById(id: number): WordPressArticle | null {
  return MOCK_ARTICLES.find((a) => a.id === id) ?? null;
}
