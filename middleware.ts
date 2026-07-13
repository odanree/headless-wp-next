import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  EXPERIMENT_COOKIE,
  decodeAssignments,
  encodeAssignments,
  ensureAssignments,
} from '@/lib/experiments';

/**
 * Edge Middleware — two jobs at the request boundary:
 *
 *  1) MEMBER AUTH GATE (existing)
 *     No member_token cookie → 302 to /join preserving redirectBack.
 *     Cookie present → forward token via x-member-token on the REQUEST so
 *     Server Components can read it without parsing cookies themselves.
 *
 *  2) EDGE A/B ASSIGNMENT (ADR-003)
 *     Read the `exp` cookie; if any registered experiment is missing a
 *     variant, roll one via weighted random and stamp the cookie on the
 *     response with a 90-day max-age. The full assignment is forwarded as
 *     `x-experiment` on the REQUEST so Server Components can render the
 *     right variant with zero client-side DOM swap. Same shape commercial
 *     A/B tooling (Optimizely et al.) runs: bucket at the edge, render on
 *     the server.
 *
 * REQUEST-HEADER vs RESPONSE-HEADER (the fix):
 *   Middleware sets `x-experiment` + `x-member-token` on the FORWARDED
 *   REQUEST via NextResponse.next({ request: { headers } }) — not on the
 *   outbound response. Server Components read them via next/headers; the
 *   browser never sees them. Setting on `response.headers` leaks internal
 *   state to any DevTools user.
 *
 * SCALABILITY NOTE (unchanged):
 *   Membership check remains O(1). Adding experiment bucketing is also O(1)
 *   — no network call, just Math.random() + cookie codec. This stays well
 *   under the Edge Middleware size/time budget.
 */

export const EXPERIMENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

export function middleware(request: NextRequest): NextResponse {
  // ── A/B bucket assignment ──────────────────────────────────────────────
  const raw = request.cookies.get(EXPERIMENT_COOKIE)?.value;
  const { assignments, assigned } = ensureAssignments(decodeAssignments(raw));
  const encoded = encodeAssignments(assignments);

  // Forward assignment via REQUEST headers so Server Components read it
  // through next/headers() — but the browser never sees it.
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set('x-experiment', encoded);

  // ── Member auth gate ───────────────────────────────────────────────────
  const isMemberRoute =
    request.nextUrl.pathname.startsWith('/article') ||
    request.nextUrl.pathname.startsWith('/members');

  let response: NextResponse;

  if (isMemberRoute) {
    const token = request.cookies.get('member_token')?.value;
    if (!token) {
      const redirectBack = encodeURIComponent(
        request.nextUrl.pathname + request.nextUrl.search,
      );
      response = NextResponse.redirect(
        new URL(`/join?redirectBack=${redirectBack}`, request.url),
      );
      // Stamp the experiment cookie on the redirect so /join can render the
      // assigned variant of join_cta on first paint. No request-header
      // forward needed — the redirect renders nothing.
    } else {
      forwardedHeaders.set('x-member-token', token);
      response = NextResponse.next({ request: { headers: forwardedHeaders } });
    }
  } else {
    response = NextResponse.next({ request: { headers: forwardedHeaders } });
  }

  // ── Sticky cookie stamp (only when we rolled a new bucket) ─────────────
  if (assigned) {
    response.cookies.set(EXPERIMENT_COOKIE, encoded, {
      httpOnly: false,       // client analytics can read it if we bolt on GA
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: EXPERIMENT_MAX_AGE_SECONDS,
    });
  }

  return response;
}

export const config = {
  // Match everything except static assets, images, and the API surface —
  // experiment bucketing should live on human-facing pages only.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
