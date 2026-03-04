import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Edge Middleware — auth gate for all /members/* routes.
 *
 * Runs at the Vercel edge before any page renders:
 *   - No member_token cookie  →  302 redirect to /join (preserves redirectBack)
 *   - Cookie present          →  forward token value via x-member-token header
 *                                so Server Components can read it without
 *                                parsing cookies themselves
 *
 * SCALABILITY NOTE (PoC trade-off):
 *   This middleware checks only for the presence and value of a cookie — O(1),
 *   no network call, no DB lookup. This is intentional.
 *   If membership validation becomes more complex (e.g., checking a live
 *   membership DB or role-permissions table), the right pattern is:
 *     1. Keep Middleware fast: verify only the JWT *signature* here.
 *     2. Move the heavy permission fetching into the Server Component,
 *        which runs in a full Node.js environment with no Edge size/time limits.
 *   This keeps the Edge layer sub-millisecond and avoids the 1MB code limit.
 *
 * SEO NOTE:
 *   Search engine crawlers (Googlebot) cannot log in, so /members/* content
 *   will not be indexed — which is intentional for this PoC.
 *   For a production build where public abstracts should be indexed:
 *     - Detect the User-Agent and serve a schema.org `NewsArticle` with
 *       `isAccessibleForFree: false` and `hasPart: { @type: WebPageElement,
 *       cssSelector: '.full-content', isAccessibleForFree: false }` —
 *       this is Google's documented "metered paywall" signal and avoids
 *       cloaking penalties while still surfacing article metadata.
 */
export function middleware(request: NextRequest): NextResponse {
  const token = request.cookies.get('member_token')?.value;

  if (!token) {
    const redirectBack = encodeURIComponent(
      request.nextUrl.pathname + request.nextUrl.search,
    );
    return NextResponse.redirect(
      new URL(`/join?redirectBack=${redirectBack}`, request.url),
    );
  }

  const response = NextResponse.next();
  response.headers.set('x-member-token', token);
  return response;
}

export const config = {
  matcher: ['/article/:path*'],
};
