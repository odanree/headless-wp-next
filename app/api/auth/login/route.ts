import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * POST /api/auth/login
 *
 * Body: { username: string; password: string }
 *
 * On success → sets httpOnly member_token cookie and returns { ok: true }.
 * The cookie value is the WORDPRESS_API_TOKEN (or a fixed demo token in
 * mock mode). It never appears in JS — only in the browser's cookie jar.
 *
 * WOOCOMMERCE NONCE — CART SESSION BINDING + CSRF MITIGATION
 *   The WooCommerce Store API uses a nonce primarily for *cart session binding*:
 *   it ties mutations to the specific authenticated session that generated it,
 *   preventing one user from modifying another user's cart. CSRF prevention is
 *   a secondary benefit — because the nonce lives in an httpOnly cookie it is
 *   never accessible to browser JS, so a cross-origin attacker cannot read it.
 *
 *   Note: this is distinct from a general CSRF token. The nonce is scoped to
 *   the Store API session, not to individual form submissions.
 *
 *   Integration steps for live WooCommerce:
 *     1. After validating credentials, fetch a WP nonce via
 *        GET /wp-json/wp/v2/users/me?context=edit (using the admin token).
 *     2. Set a second httpOnly cookie: `woo_nonce=<nonce>; SameSite=Lax`.
 *     3. Next.js Route Handlers forward it as the `X-WP-Nonce` header on
 *        every Store API mutation (add-item, remove-item, checkout).
 *   Nonce never appears in browser JS or any response visible to XSS.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body?.username || !body?.password) {
    return NextResponse.json(
      { error: 'username and password are required' },
      { status: 400 },
    );
  }

  const expectedPassword = process.env.DEMO_MEMBER_PASSWORD ?? 'members-only-2026';

  if (body.password !== expectedPassword) {
    // Constant-time-ish delay to avoid enumeration timing
    await new Promise((r) => setTimeout(r, 300));
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // In mock mode we issue a fixed demo token.
  // In live mode this would be the real WORDPRESS_API_TOKEN.
  const token = process.env.WORDPRESS_API_TOKEN ?? 'demo-member-token';

  const isProduction = process.env.NODE_ENV === 'production';

  const cookieStore = cookies();
  cookieStore.set('member_token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });

  return NextResponse.json({ ok: true });
}
