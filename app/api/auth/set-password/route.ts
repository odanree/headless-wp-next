import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * POST /api/auth/set-password
 *
 * Body: { email: string; password: string }
 *
 * Requires an active member_token cookie (set by stripe-callback) to prove
 * the caller just completed a valid Stripe payment. Forwards the password to
 * the WordPress plugin which bcrypt-hashes and stores it on the member record.
 * The plaintext password travels over HTTPS only — never stored in Next.js.
 */
export async function POST(request: Request) {
  const cookieStore = cookies();
  const token = cookieStore.get('member_token')?.value;

  if (!token || !token.startsWith('stripe:')) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  if (!body?.email || !body?.password) {
    return NextResponse.json(
      { error: 'email and password are required' },
      { status: 400 },
    );
  }

  if (typeof body.password !== 'string' || body.password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters.' },
      { status: 400 },
    );
  }

  const wpUrl = process.env.WORDPRESS_URL;
  const wpToken = process.env.WORDPRESS_API_TOKEN;

  if (!wpUrl || !wpToken) {
    return NextResponse.json(
      { error: 'Service not configured.' },
      { status: 503 },
    );
  }

  const res = await fetch(`${wpUrl}/wp-json/headless/v1/set-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${wpToken}`,
    },
    body: JSON.stringify({ email: body.email, password: body.password }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(
      { error: (data as { message?: string }).message ?? 'Failed to set password.' },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
