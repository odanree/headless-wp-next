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
 *     Cookie present → forward token via x-member-token header so Server
 *     Components can read it without parsing cookies themselves.
 *
 *  2) EDGE A/B ASSIGNMENT (new — ADR-003)
 *     Read the `exp` cookie; if any registered experiment is missing a
 *     variant, roll one via weighted random and stamp the cookie on the
 *     response with a 90-day max-age. The full assignment is forwarded as
 *     `x-experiment` on the request so Server Components can render the
 *     right variant with zero client-side DOM swap. Same shape commercial
 *     A/B tooling (Optimizely et al.) runs: bucket at the edge, render on
 *     the server.
 *
 * SCALABILITY NOTE (unchanged):
 *   Membership check remains O(1). Adding experiment bucketing is also O(1)
 *   — no network call, just Math.random() + cookie codec. This stays well
 *   under the Edge Middleware size/time budget.
 */

export const EXPERIMENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

function applyExperiments(request: NextRequest, response: NextResponse): void {
  const raw = request.cookies.get(EXPERIMENT_COOKIE)?.value;
  const existing = decodeAssignments(raw);
  const { assignments, assigned } = ensureAssignments(existing);

  const encoded = encodeAssignments(assignments);

  // Forward the full assignment to the render layer regardless of whether we
  // just rolled new buckets — Server Components read this header, never the
  // cookie directly.
  response.headers.set('x-experiment', encoded);

  if (assigned) {
    response.cookies.set(EXPERIMENT_COOKIE, encoded, {
      httpOnly: false,       // client analytics can read it if we bolt on GA
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: EXPERIMENT_MAX_AGE_SECONDS,
    });
  }
}

export function middleware(request: NextRequest): NextResponse {
  const isMemberRoute =
    request.nextUrl.pathname.startsWith('/article') ||
    request.nextUrl.pathname.startsWith('/members');

  if (isMemberRoute) {
    const token = request.cookies.get('member_token')?.value;
    if (!token) {
      const redirectBack = encodeURIComponent(
        request.nextUrl.pathname + request.nextUrl.search,
      );
      const redirect = NextResponse.redirect(
        new URL(`/join?redirectBack=${redirectBack}`, request.url),
      );
      // Stamp the experiment cookie even on the redirect so /join can render
      // the assigned variant of the join_cta headline on first paint.
      applyExperiments(request, redirect);
      return redirect;
    }

    const response = NextResponse.next();
    response.headers.set('x-member-token', token);
    applyExperiments(request, response);
    return response;
  }

  // Non-member routes: just apply experiments and pass through.
  const response = NextResponse.next();
  applyExperiments(request, response);
  return response;
}

export const config = {
  // Match everything except static assets, images, and the API surface —
  // experiment bucketing should live on human-facing pages only.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
