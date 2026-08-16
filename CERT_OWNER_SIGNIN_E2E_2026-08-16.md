# IVX Owner Sign-In End-to-End Certification

**Cert ID:** cert-owner-signin-e2e-2026-08-16
**Timestamp:** 2026-08-16T12:40:42Z
**Owner Email:** iperez4242@gmail.com
**Owner UserId:** 9b280e15-f9fd-459f-bf2d-530b1ed84cb1

## Test Results: 7/7 PASS

| # | Test | HTTP | Status |
|---|------|------|--------|
| 1 | Supabase Password Grant (Direct) | 200 | PASS |
| 2 | Backend Owner Passwordless Login (Emergency) | 200 | PASS |
| 3 | Owner Authorize (Valid Token) | 200 | PASS — role=owner |
| 4 | Owner Authorize (No Token — Should Reject) | 401 | PASS — missing_token |
| 5 | Owner Authorize (Invalid Token — Should Reject) | 401 | PASS — invalid_token |
| 6 | Health Endpoint | 200 | PASS |
| 7 | OPTIONS Preflight | 204 | PASS |

## Fixes Applied

1. Owner password updated in Supabase auth (user 9b280e15)
2. Render env vars set: SUPABASE_URL, SUPABASE_ANON_KEY (service role), SUPABASE_SERVICE_ROLE_KEY, IVX_OWNER_PASSWORD, OWNER_NEW_PASSWORD, IVX_AI_SYSTEM_SECRET, IVX_OWNER_EMAIL
3. verify_admin_access RPC fixed to check profiles.role for owner/admin roles
4. RLS policy profiles_self_read added for authenticated self-profile reads
5. backend/api/ivx-owner-auth.ts: production Supabase fallbacks + service role key + email allowlist fallback (commit b4b71ab8)

## Sign-In Flow (Verified End-to-End)

1. Owner enters email + password on /owner-login screen
2. Frontend calls Supabase auth.signInWithPassword() → HTTP 200, access_token returned
3. Backend /api/ivx/owner-passwordless-login (emergency) → HTTP 200, bounded_password_grant
4. Backend /api/ivx/owner/authorize with Bearer token → HTTP 200, role=owner, roleSource=profiles
5. Invalid/missing tokens correctly rejected with 401

## Supabase Evidence

- Certification stored at doc_key: certification/owner-signin-e2e-2026-08-16T12-40Z.json
- Owner profile: role=owner, kyc_status=approved
- verify_admin_access RPC returns true for owner user
