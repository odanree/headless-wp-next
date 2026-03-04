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
