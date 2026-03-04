#!/usr/bin/env bash
# ─── DigitalOcean Deployment Verifier ────────────────────────────────────────
#
# Hits every endpoint in the headless WP → Next.js stack and reports pass/fail.
# Run this after completing the full DO setup to confirm everything is wired up.
#
# Usage (from your local machine OR on the Droplet):
#   chmod +x do-verify.sh
#   ./do-verify.sh <wp-domain> <next-url> <api-token> [revalidation-secret]
#
# Example:
#   ./do-verify.sh cms.example.com https://example.vercel.app my-secret-token my-revalidation-secret
#
# Exit code: 0 = all checks passed, 1 = one or more checks failed

set -uo pipefail

DOMAIN="${1:-}"
NEXT_URL="${2:-}"
API_TOKEN="${3:-}"
REVALIDATION_SECRET="${4:-}"

if [[ -z "$DOMAIN" || -z "$NEXT_URL" || -z "$API_TOKEN" ]]; then
  echo "Usage: ./do-verify.sh <wp-domain-or-url> <next-url> <api-token> [revalidation-secret]"
  echo "Example: ./do-verify.sh http://64.23.165.167 https://example.vercel.app my-token my-secret"
  echo "Example: ./do-verify.sh cms.example.com https://example.vercel.app my-token my-secret"
  exit 1
fi

# Accept full URLs (http:// or https://) or bare domain/IP (defaults to https://)
if [[ "$DOMAIN" == http://* || "$DOMAIN" == https://* ]]; then
  WP_BASE="${DOMAIN}"
else
  WP_BASE="https://${DOMAIN}"
fi
PASS=0
FAIL=0

# ── Helpers ───────────────────────────────────────────────────────────────────

green() { echo -e "\033[32m✓\033[0m $1"; }
red()   { echo -e "\033[31m✗\033[0m $1"; }
info()  { echo -e "\033[90m  $1\033[0m"; }

check() {
  local label="$1"
  local status="$2"
  local body="$3"
  local expect_key="${4:-}"

  if [[ "$status" -ge 200 && "$status" -lt 300 ]]; then
    if [[ -n "$expect_key" ]] && ! echo "$body" | grep -q "$expect_key"; then
      red  "$label — HTTP $status but response missing '$expect_key'"
      info "Response: $(echo "$body" | head -c 200)"
      ((FAIL++))
    else
      green "$label — HTTP $status"
      ((PASS++))
    fi
  else
    red "$label — HTTP $status"
    info "Response: $(echo "$body" | head -c 200)"
    ((FAIL++))
  fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Headless WP → Next.js Deployment Verifier"
echo " WordPress : $WP_BASE"
echo " Next.js   : $NEXT_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. WordPress is up ────────────────────────────────────────────────────────
echo "── WordPress ────────────────────────────────────────"

RESP=$(curl -sS -o /dev/null -w "%{http_code}" "${WP_BASE}/wp-json/")
check "WP REST API root reachable" "$RESP" ""

# ── 2. Public articles (no auth required) ─────────────────────────────────────
BODY=$(curl -sS "${WP_BASE}/wp-json/headless/v1/articles/public" 2>/dev/null)
STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "${WP_BASE}/wp-json/headless/v1/articles/public")
check "Public articles endpoint (no auth)" "$STATUS" "$BODY" "id"

ARTICLE_COUNT=$(echo "$BODY" | grep -o '"id"' | wc -l | tr -d ' ')
info "Articles returned: $ARTICLE_COUNT"

# ── 3. Bearer-gated articles ──────────────────────────────────────────────────
BODY=$(curl -sS -H "Authorization: Bearer ${API_TOKEN}" "${WP_BASE}/wp-json/headless/v1/articles" 2>/dev/null)
STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${API_TOKEN}" "${WP_BASE}/wp-json/headless/v1/articles")
check "Member articles endpoint (Bearer token)" "$STATUS" "$BODY" "id"

# ── 4. Bearer-gated articles — wrong token should 401 ─────────────────────────
STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -H "Authorization: Bearer WRONG_TOKEN" "${WP_BASE}/wp-json/headless/v1/articles")
if [[ "$STATUS" == "401" || "$STATUS" == "403" ]]; then
  green "Auth guard rejects bad token — HTTP $STATUS"
  ((PASS++))
else
  red   "Auth guard did NOT reject bad token — HTTP $STATUS (expected 401/403)"
  ((FAIL++))
fi

# ── 5. grant-membership endpoint ──────────────────────────────────────────────
TEST_EMAIL="verify-test-$(date +%s)@example.com"
BODY=$(curl -sS -X POST \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${TEST_EMAIL}\",\"stripe_session_id\":\"cs_verify_test\"}" \
  "${WP_BASE}/wp-json/headless/v1/grant-membership" 2>/dev/null)
STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${TEST_EMAIL}2\",\"stripe_session_id\":\"cs_verify_test_2\"}" \
  "${WP_BASE}/wp-json/headless/v1/grant-membership")
check "grant-membership endpoint (Bearer token)" "$STATUS" "$BODY" "success"

# ── 6. Next.js is up ──────────────────────────────────────────────────────────
echo ""
echo "── Next.js / Vercel ─────────────────────────────────"

STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "${NEXT_URL}/")
check "Next.js homepage reachable" "$STATUS" ""

# ── 7. On-demand revalidation ─────────────────────────────────────────────────
if [[ -n "$REVALIDATION_SECRET" ]]; then
  BODY=$(curl -sS -X POST \
    -H "Content-Type: application/json" \
    -d "{\"tags\":[\"articles\",\"public-articles\"],\"secret\":\"${REVALIDATION_SECRET}\"}" \
    "${NEXT_URL}/api/revalidate" 2>/dev/null)
  STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d "{\"tags\":[\"articles\",\"public-articles\"],\"secret\":\"${REVALIDATION_SECRET}\"}" \
    "${NEXT_URL}/api/revalidate")
  check "Next.js /api/revalidate (tags: articles, public-articles)" "$STATUS" "$BODY" "revalidated"
else
  echo "  SKIP: REVALIDATION_SECRET not provided — skipping revalidate check"
fi

# ── 8. Join / members pages ────────────────────────────────────────────────────
STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "${NEXT_URL}/join")
check "Next.js /join page reachable" "$STATUS" ""

# Members page should redirect (302/307) without a cookie
STATUS=$(curl -sS -o /dev/null -w "%{http_code}" --max-redirs 0 "${NEXT_URL}/members")
if [[ "$STATUS" == "302" || "$STATUS" == "307" || "$STATUS" == "308" ]]; then
  green "Next.js /members redirects unauthenticated users — HTTP $STATUS"
  ((PASS++))
else
  red   "Next.js /members did NOT redirect — HTTP $STATUS (expected 302/307)"
  ((FAIL++))
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
TOTAL=$((PASS + FAIL))
if [[ $FAIL -eq 0 ]]; then
  echo -e " \033[32m✓ All $TOTAL checks passed\033[0m"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
else
  echo -e " \033[31m✗ $FAIL of $TOTAL checks FAILED\033[0m   ($PASS passed)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi
