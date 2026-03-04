# Lessons Learned

Issues that required 2 or more commits to fully resolve.

---

## 1. localStorage + SSR = Hydration Mismatch (hit twice)

**Commits:** `fix(navbar)` → `fix(articlecard)`

### What happened
NavBar and ArticleCard both read from CartContext, which rehydrates cart state from `localStorage` on the client via a `useEffect`. On the server, `itemCount` is `0` and `alreadyInCart` is `false`. On the client, after the context effect fires, those values may be nonzero/true — React sees the DOM differ and throws:

```
Error: Text content does not match server-rendered HTML.
Text content did not match. Server: "Purchase Access — $99.00/yr" Client: "✓ In Cart"
```

The NavBar badge was fixed first. The exact same pattern was then found in ArticleCard a short time later because both components share the same antipattern: using context-derived, localStorage-backed state directly in render without accounting for SSR.

### Root cause
Any value that originates from `localStorage` (or any browser-only API) will always differ between the server pass (`undefined`/default) and the first client render (persisted value). Using it directly in JSX without a guard is guaranteed to cause a hydration error if the persisted value differs from the default.

### Fix
Introduce a `mounted` guard in every component that uses cart state in render:

```tsx
const [mounted, setMounted] = useState(false);
useEffect(() => { setMounted(true); }, []);

// Use mounted to suppress localStorage-derived values until after hydration
const alreadyInCart = mounted && annualPass != null && state.cart.items.some(...);
const displayCount  = mounted ? itemCount : 0;
```

Server and client HTML are now identical on the initial pass. The real values appear instantly after hydration with no visible flicker.

### Rule going forward
**Any component that reads from CartContext (or any context backed by localStorage) and uses that value in rendered output must include a `mounted` guard.** Search for `useCart()` usages before assuming a component is hydration-safe.

---

## 2. CSS Module Deletion Left One File Behind

**Commits:** `feat(content)` (build failed) → hotfix during same session

### What happened
After converting all components from CSS Modules to Tailwind and deleting the `.module.css` files, the build failed:

```
Module not found: Can't resolve './article.module.css'
./app/members/[id]/page.tsx
```

`app/members/[id]/page.tsx` was identified for conversion but the import strip was missed. All other files were cleaned, but this one's `import styles from './article.module.css'` remained after the module file was deleted.

### Root cause
The migration was done component-by-component. `members/[id]/page.tsx` was listed in the plan but the import removal step was not applied before deleting the CSS file. The bracket in the directory name (`[id]`) also caused `Remove-Item` with a glob path to silently skip the file, so the CSS module itself wasn't deleted either — requiring a separate `-LiteralPath` invocation.

### Fix
1. Strip the `import styles` line from `app/members/[id]/page.tsx`
2. Convert all `styles.*` classNames to Tailwind utilities
3. Delete CSS module with `-LiteralPath` to handle square brackets:

```powershell
Remove-Item -LiteralPath 'app\members\[id]\article.module.css' -Force
```

### Rule going forward
- **Always run `npm run build` before committing a CSS module migration.** The TypeScript compiler will catch any remaining `styles` references immediately.
- **Use `-LiteralPath` in PowerShell when paths contain `[` or `]`** — glob patterns treat brackets as character classes and silently skip matching files.
- After any mass deletion, verify with: `Get-ChildItem -Recurse -Filter "*.module.css"` to confirm zero results.

---

## 3. Stripe SDK Initialized at Module Scope — Throws at Vercel Build Time

**Commits:** `010b1db fix(stripe): initialize Stripe lazily inside handlers`

### What happened
Vercel build failed with:
```
Error: Neither apiKey nor config.authenticator provided
```
During static page generation (`next build`), Next.js evaluates module-level code in route files. All three Stripe routes had:
```typescript
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { ... });
```
at the top level of the module. At build time, `STRIPE_SECRET_KEY` is `undefined` — Stripe's constructor throws immediately.

### Root cause
Module-level SDK initialization runs at import time — which includes build time in Next.js. Environment variables are only available at runtime (request time), not during the build.

### Fix
Move all SDK initialization inside the handler function:
```typescript
export async function POST(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { ... }); // ← inside handler
  ...
}
```
This defers instantiation to request time when env vars are guaranteed to be present.

### Rule going forward
**Never initialize third-party SDKs at module scope in Next.js route files.** Always construct SDK clients inside the handler or use a lazy singleton (initialize on first call, cache the instance).

---

## 4. `generateStaticParams` Calling External API — Build Fails When CMS Unreachable

**Commits:** `5d24719 fix(build): gracefully handle unreachable WordPress`

### What happened
Vercel build failed with:
```
Error: fetch failed — ENOTFOUND cms.danhle.net
```
`app/article/[id]/page.tsx` and `app/members/[id]/page.tsx` both called `getMemberArticles()` inside `generateStaticParams`. During Vercel's build, `cms.danhle.net` did not yet exist (DNS not propagated, Droplet not fully configured). The unhandled `fetch` error propagated out of `generateStaticParams` and crashed the entire build.

### Root cause
`generateStaticParams` runs at build time. Any external HTTP call inside it can fail if the backend is unreachable — and if the error isn't caught, Next.js treats it as a fatal build error.

### Fix
Wrap in try/catch returning an empty array, and add `dynamicParams = true`:
```typescript
export const dynamicParams = true;

export async function generateStaticParams() {
  try {
    const { articles } = await getMemberArticles();
    return articles.map(a => ({ id: String(a.id) }));
  } catch {
    return []; // build succeeds; pages render on-demand at runtime
  }
}
```
`dynamicParams = true` ensures that paths not returned by `generateStaticParams` are rendered on demand rather than returning 404.

### Rule going forward
**Every `generateStaticParams` that calls an external service must be wrapped in try/catch.** The build environment does not have guaranteed access to production services. Always pair with `dynamicParams = true`.

---

## 5. Unhandled Error Re-throw Surfaced as 500 on Members Page

**Commits:** `f716e14 fix(members): handle network errors gracefully`

### What happened
After the WordPress backend was provisioned, the members page was throwing `500` in Vercel logs. The cause was a catch block in `app/members/page.tsx` that re-threw network errors:
```typescript
} catch (err) {
  if (err instanceof WordPressAuthError) { ... }
  if (err instanceof WordPressAPIError) { ... }
  throw err; // ← any other error becomes unhandled → 500
}
```
Generic network errors (ECONNREFUSED, ENOTFOUND during cold starts) hit the final `throw err` and surfaced as an unhandled exception.

### Fix
Replace the final `throw` with a graceful fallback UI:
```typescript
} catch (err) {
  if (err instanceof WordPressAuthError) { /* specific message */ }
  if (err instanceof WordPressAPIError) { /* specific message */ }
  // Catch-all: render a warning banner rather than crashing the page
  return <div className="warning">Content temporarily unavailable. Please try again shortly.</div>;
}
```

### Rule going forward
**Server Components that fetch external data must never have an unguarded `throw` in their catch block.** All error paths should either render a degraded UI or return a meaningful error state — never re-throw a network error that becomes a 500.

---

## 6. Middleware Matcher Missing `/members` Routes — Auth Gate Bypassed

**Commits:** `c374150 fix(auth): add /members routes to middleware matcher`

### What happened
After verifying the middleware, `/members` was returning 200 for unauthenticated users instead of 307. The verify script confirmed `/article/:path*` was gated correctly, but `/members` and `/members/:path*` were not redirecting.

### Root cause
`middleware.ts` had:
```typescript
export const config = {
  matcher: ['/article/:path*'],
};
```
Next.js middleware only runs for routes listed in `matcher`. `/members` was not listed, so the middleware was never invoked for that path — auth check skipped entirely.

### Fix
```typescript
export const config = {
  matcher: ['/article/:path*', '/members/:path*', '/members'],
};
```
Both the index route (`/members`) and dynamic sub-routes (`/members/[id]`) must be listed explicitly.

### Rule going forward
**When adding a new protected route, always update the middleware `matcher` immediately.** The matcher is not a "match all routes by default" guard — it is an explicit allowlist of routes the middleware runs for. An unprotected route silently passes all traffic.

---

## 7. `set_role('subscriber')` Demoted Admin — Replaced by Member CPT Architecture

**Commits:** `1a45c3a fix(plugin): guard against downgrading elevated roles` → `d3bfeb7 feat(plugin): store members as CPT instead of WP users`

### What happened
During the first end-to-end Stripe checkout test using the admin email, the WordPress plugin's `hwp_grant_membership` function called `$user->set_role('subscriber')` unconditionally. This replaced the administrator role with subscriber, locking the admin out of WP Admin.

A role guard was added in the first commit. However, the deeper issue — WP user accounts being created for paying customers at all — led to a second commit replacing the entire approach.

### Root cause (first layer)
`WP_User::set_role()` **replaces** the user's entire role, it does not add to it. Calling it on an existing user with an elevated role silently downgrades them.

### Root cause (second layer)
Creating WP user accounts for paying customers was architecturally wrong for this system:
- Customers authenticate via Stripe cookie, never via WP credentials
- The WP Users list became polluted with customer accounts
- Any `set_role` call on an existing user carries role-collision risk

### Fix (final design)
Replace `wp_create_user` + `set_role` with a `member` custom post type:
```php
// Find-or-create a CPT post — no WP user created
$member_id = wp_insert_post([
  'post_type'   => 'member',
  'post_status' => 'publish',
  'post_title'  => $email,  // email as title for admin visibility
]);
update_post_meta($member_id, 'member_email', $email);
update_post_meta($member_id, 'stripe_session_id', $session_id);
update_post_meta($member_id, 'membership_granted_at', current_time('mysql'));
```
Customer records appear in WP Admin → **Members** (not Users). The Users list is reserved for content authors and site admins only.

### Rule going forward
**Never use WP Users to store records for accounts that authenticate outside WordPress.** Use a CPT or custom table for any entity that doesn't need WP login. If you must use WP Users, always guard `set_role` against overwriting elevated roles.
