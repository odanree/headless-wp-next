<?php
require('/var/www/html/wp-load.php');

$articles = [
  [
    'title'    => 'Getting Started with Headless WordPress',
    'excerpt'  => 'How to decouple your WordPress backend from the frontend using the REST API and a modern JS framework.',
    'content'  => '<p>Headless WordPress separates the content management layer (WordPress) from the presentation layer (Next.js, Nuxt, SvelteKit, etc.). WordPress becomes a pure API backend — you write content in the familiar Gutenberg editor and expose it via <code>wp-json/</code>.</p><h2>Why go headless?</h2><ul><li><strong>Performance</strong> — Pre-render pages at build time or at the edge. No PHP execution on every request.</li><li><strong>Developer experience</strong> — Use the JS tooling you already know (TypeScript, CSS Modules, Vitest).</li><li><strong>CDN-friendly</strong> — Static or ISR output sits on a global CDN; WordPress only gets hit on cache misses or webhook-triggered revalidation.</li></ul><h2>The request flow</h2><p>Next.js Server Components call <code>fetch()</code> directly against <code>/wp-json/wp/v2/posts</code>. The response is cached with <code>next: { revalidate: 300 }</code>. On-demand invalidation is triggered by a WordPress <code>save_post</code> hook POSTing to <code>/api/revalidate</code>.</p>',
    'category' => 'Architecture',
    'readTime' => 7,
    'date'     => '2026-02-10 09:00:00',
    'slug'     => 'getting-started-headless-wordpress',
  ],
  [
    'title'    => 'Auth at the Edge: Next.js Middleware + httpOnly Cookies',
    'excerpt'  => 'Why httpOnly cookies beat localStorage for auth tokens, and how Edge Middleware enforces access before a single byte of page JS loads.',
    'content'  => '<p>localStorage is readable by any JavaScript on the page — including injected third-party scripts. An httpOnly cookie is completely invisible to JavaScript; only the browser\'s HTTP layer can read it.</p><h2>The Middleware pattern</h2><p>Next.js Middleware runs on the <strong>Edge</strong> — before the router resolves, before Server Components execute, before any bundle is sent.</p><pre><code>// middleware.ts\nexport function middleware(request) {\n  const token = request.cookies.get(\'member_token\')?.value;\n  if (!token) return NextResponse.redirect(\'/join\');\n  const res = NextResponse.next();\n  res.headers.set(\'x-member-token\', token);\n  return res;\n}</code></pre><p>The token rides from the cookie to a request header inside the Vercel edge network — it never touches the browser.</p>',
    'category' => 'Security',
    'readTime' => 6,
    'date'     => '2026-02-17 11:30:00',
    'slug'     => 'nextjs-middleware-auth-cookies',
  ],
  [
    'title'    => 'ISR vs On-Demand Revalidation — When to Use Each',
    'excerpt'  => 'Time-based ISR is simple but blunt. On-demand revalidation with revalidateTag() lets WordPress trigger precise cache busts without a redeploy.',
    'content'  => '<p>Incremental Static Regeneration (ISR) regenerates a page in the background after a defined staleness window.</p><h2>On-demand revalidation</h2><p>Next.js 14 adds <code>revalidateTag()</code>. Tag your fetches:</p><pre><code>fetch(url, { next: { tags: [\'articles\'] } })</code></pre><p>Then from a WordPress <code>save_post</code> hook, POST to your Next.js revalidation API route to bust the cache immediately — no polling, no TTL expiry, no redeploy.</p>',
    'category' => 'Performance',
    'readTime' => 8,
    'date'     => '2026-02-22 14:00:00',
    'slug'     => 'isr-on-demand-revalidation',
  ],
  [
    'title'    => 'Server + Client Component Composition in the App Router',
    'excerpt'  => 'The App Router default is Server Components. Client Components are opt-in. Understanding the boundary is the key skill interviewers test.',
    'content'  => '<p>Every component in the App Router is a Server Component by default. It renders on the server (or at build time), sends HTML to the browser, and ships <strong>zero JavaScript</strong> to the client — unless you explicitly opt in with <code>\'use client\'</code>.</p><h2>The composition rule</h2><p>Server Components <em>can</em> render Client Components as children. Client Components <em>cannot</em> import Server Components — but they <em>can</em> accept them as <code>children</code> props (the "donut" pattern). The data fetching, auth validation, and HTML rendering stay on the server. Only interactive islands ship client-side JS.</p>',
    'category' => 'Next.js',
    'readTime' => 5,
    'date'     => '2026-02-25 08:00:00',
    'slug'     => 'server-client-component-composition',
  ],
  [
    'title'    => 'Exposing WordPress Custom Post Types via REST API',
    'excerpt'  => 'register_post_type() with show_in_rest: true is just the start. Custom endpoints, field sanitization, and Bearer token auth make it production-ready.',
    'content'  => '<p>WordPress core exposes all public post types at <code>/wp-json/wp/v2/{type}</code> when you set <code>show_in_rest: true</code> during registration. But the default REST response is verbose and exposes fields you may not want public.</p><h2>Custom REST endpoints</h2><p>For finer control, register your own namespace and limit the response to whitelisted fields only.</p><h2>Bearer token auth</h2><p>For server-to-server calls from Next.js, a shared secret is simpler than OAuth. Store it in both <code>wp-config.php</code> (as a constant) and your Next.js <code>.env.local</code>. Always compare with <code>hash_equals()</code> — not <code>===</code> — to prevent timing attacks.</p>',
    'category' => 'WordPress',
    'readTime' => 9,
    'date'     => '2026-03-01 10:00:00',
    'slug'     => 'wordpress-custom-post-types-rest',
  ],
];

foreach ($articles as $a) {
    $post_id = wp_insert_post([
        'post_type'    => 'member_article',
        'post_status'  => 'publish',
        'post_title'   => $a['title'],
        'post_content' => $a['content'],
        'post_excerpt' => $a['excerpt'],
        'post_name'    => $a['slug'],
        'post_date'    => $a['date'],
    ]);

    if (is_wp_error($post_id)) {
        echo "ERROR: " . $a['title'] . " — " . $post_id->get_error_message() . PHP_EOL;
    } else {
        update_post_meta($post_id, 'read_time', $a['readTime']);
        update_post_meta($post_id, 'article_category', $a['category']);
        echo "Created #$post_id: " . $a['title'] . PHP_EOL;
    }
}

echo "Done." . PHP_EOL;
