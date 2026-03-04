import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * POST /api/auth/logout
 *
 * Expires the member_token cookie immediately.
 */
export async function POST() {
  const cookieStore = cookies();
  cookieStore.set('member_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  return NextResponse.json({ ok: true });
}
