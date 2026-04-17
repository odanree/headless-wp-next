import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * POST /api/auth/login
 *
 * Body: { username: string (email); password: string }
 *
 * In production: verifies credentials against the WordPress member record
 * via POST /wp-json/headless/v1/verify-credentials. On success, re-issues
 * the member_token cookie (stripe:<session_id>) for a 7-day session.
 *
 * In development (WORDPRESS_URL not set): falls back to DEMO_MEMBER_PASSWORD
 * for local testing without a live WordPress instance.
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

  const isProduction = (process.env.NODE_ENV as string) === 'production';
  const wpUrl = process.env.WORDPRESS_URL;
  const wpToken = process.env.WORDPRESS_API_TOKEN;

  let memberSessionId: string | null = null;

  if (wpUrl && wpToken) {
    // Live mode — verify against the WordPress member record.
    const res = await fetch(`${wpUrl}/wp-json/headless/v1/verify-credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${wpToken}`,
      },
      body: JSON.stringify({ email: body.username, password: body.password }),
    });

    if (!res.ok) {
      await new Promise((r) => setTimeout(r, 300));
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const data = await res.json() as { valid: boolean; session_id?: string };

    if (!data.valid) {
      await new Promise((r) => setTimeout(r, 300));
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    memberSessionId = data.session_id ?? null;
  } else {
    // Dev/mock mode — use DEMO_MEMBER_PASSWORD env var.
    const expectedPassword = process.env.DEMO_MEMBER_PASSWORD;
    if (!expectedPassword) {
      return NextResponse.json(
        { error: 'Demo login is not configured' },
        { status: 503 },
      );
    }

    if (body.password !== expectedPassword) {
      await new Promise((r) => setTimeout(r, 300));
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
  }

  const token = memberSessionId
    ? `stripe:${memberSessionId}`
    : (process.env.WORDPRESS_API_TOKEN ?? 'demo-member-token');

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
