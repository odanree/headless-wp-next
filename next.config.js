/** @type {import('next').NextConfig} */

// ─── Content-Security-Policy ─────────────────────────────────────────────────
// Same shape production headless stacks ships in production: a strict default-src 'none' base
// with explicit allowlists per directive. Directives are declared as arrays so
// adding a third-party (analytics, chat widget) is a one-line edit, and the
// diff shows exactly what's being trusted.
//
// 'strict-dynamic' + a nonce would be the next hardening step, but that
// requires nonce injection at every <script> — deferred to a follow-up PR
// once we have a script-emit audit.

const csp = {
  'default-src': ["'none'"],
  'script-src': [
    "'self'",
    // Next.js emits inline scripts for hydration + RSC serialization. Until we
    // wire nonces (or hashes) through, `'unsafe-inline'` is unavoidable.
    "'unsafe-inline'",
    'https://js.stripe.com',
  ],
  'style-src': [
    "'self'",
    "'unsafe-inline'", // Tailwind emits inline styles for atomic classes.
  ],
  'img-src': [
    "'self'",
    'data:',
    'blob:',
    'https://*.wordpress.com',   // WP media library / Photon CDN
    'https://*.gravatar.com',
  ],
  'font-src': ["'self'", 'data:'],
  'connect-src': [
    "'self'",
    'https://api.stripe.com',
    // WordPress origin — set to your host in prod. Left permissive-http here
    // so `docker compose up` works out of the box against the local WP box.
    'http://localhost:8080',
    'http://localhost:8081',
  ],
  'frame-src': ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"], // clickjacking defence
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'upgrade-insecure-requests': [],
};

function serializeCsp(policy) {
  return Object.entries(policy)
    .map(([directive, values]) =>
      values.length === 0 ? directive : `${directive} ${values.join(' ')}`,
    )
    .join('; ');
}

// ─── Security headers ────────────────────────────────────────────────────────
// Applied to every response via next.config's async headers(). These are the
// defence-in-depth pieces that live at the render layer — Varnish (ADR-002)
// covers cache-side hardening; middleware.ts covers auth + experiments.

const securityHeaders = [
  { key: 'Content-Security-Policy', value: serializeCsp(csp) },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig = {
  async headers() {
    return [
      {
        // Apply to every route — Route Handlers included. Individual routes
        // that need to relax a header (e.g. an OG image) can override via
        // their own response headers.
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
