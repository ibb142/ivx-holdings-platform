# Rork Dependency Register — IVX Holdings Independence Audit

**Created:** 2026-08-01
**Auditor:** Rork agent (inside Rork sandbox — cannot self-revoke)
**Production commit:** 24e896f89eae98fa04ae0255458de8f126d2be16
**Render service:** srv-d7t9ivreo5us73ftose0
**Supabase project:** kvclcdjmjghndxsngfzb

---

## Summary

| Category | Dependencies Found | Status |
|---|---|---|
| AI Gateway (Vercel) | 1 active | **BLOCKED — requires owner API key** |
| Rork SDK (Expo) | 0 (removed 2026-05-12) | RESOLVED |
| Rork URLs in code | 6 (all defensive guards) | RESOLVED (guards, not calls) |
| Rork env vars | 5 orphaned (no code reads them) | RESOLVED (cosmetic cleanup) |
| Rork GitHub access | 1 (GITHUB_TOKEN is Rork-managed) | BLOCKED — owner must rotate |
| Rork Render access | 1 (RENDER_API_KEY is Rork-managed) | BLOCKED — owner must rotate |
| Rork Supabase access | 1 (SUPABASE_ACCESS_TOKEN is Rork-managed) | BLOCKED — owner must rotate |
| Rork webhooks | 0 found | RESOLVED |
| Rork telemetry | 0 found | RESOLVED |
| Rork worker services | 0 (IVX owns its own worker) | RESOLVED |

---

## DEP-001: Vercel AI Gateway (AI_GATEWAY_API_KEY)

- **Dependency ID:** DEP-001
- **Exact files:** `backend/api/ivx-credentials-status.ts:524`, `backend/api/ivx-owner-ai.ts:3593,5612`, `backend/ivx-ai-runtime.ts` (all generateText calls)
- **Environment variable:** `AI_GATEWAY_API_KEY` (value starts with `vck_`)
- **Runtime purpose:** All AI chat, code generation, and autonomous coder LLM calls route through Vercel AI Gateway
- **Production impact:** CRITICAL — without this key, IVX IA chat returns "could not reach the AI model" and autonomous coder cannot generate patches
- **Replacement component:** `backend/services/ivx-ai-provider/` (IVX-owned provider layer with direct OpenAI/Anthropic adapters)
- **Migration risk:** HIGH — the key is embedded in Render env vars and used by every AI feature
- **Migration status:** NOT STARTED — requires owner to provide own OpenAI/Anthropic API key
- **Test required:** Phase 7 Test 8 (Rork-blocked test) — must pass with IVX-owned key only

**Owner action required:** Provide your own OpenAI API key (or Anthropic key) to replace the Vercel AI Gateway key. Set it as `IVX_OPENAI_API_KEY` on Render.

---

## DEP-002: Rork SDK (@rork-ai/toolkit-sdk)

- **Dependency ID:** DEP-002
- **Exact files:** None in current code (removed 2026-05-12)
- **Historical location:** `expo/package.json`, `expo/metro.config.js`
- **Runtime purpose:** Was used for Rork-managed Expo bundler config
- **Production impact:** NONE — already removed
- **Replacement component:** Default Expo Metro config (already in place)
- **Migration status:** RESOLVED (2026-05-12)
- **Test required:** `expo/scripts/verify-expo-sdk.mjs` regression guard (already passing)

---

## DEP-003: Rork URL guards (toolkit.rork.com, api.rork.com)

- **Dependency ID:** DEP-003
- **Exact files:** `backend/ivx-ai-runtime.ts:226-228`, `backend/services/ivx-provider-autodetect.ts:23-25`
- **Runtime purpose:** DEFENSIVE — these are URL BLOCKERS, not callers. They prevent stale env vars from routing AI calls through Rork domains.
- **Production impact:** NONE — these guard AGAINST Rork routing, they don't cause it
- **Replacement component:** Keep as-is (defensive guards should remain even after independence)
- **Migration status:** RESOLVED (guards, not dependencies)

---

## DEP-004: Orphaned EXPO_PUBLIC_RORK_* env vars

- **Dependency ID:** DEP-004
- **Exact files:** None in code (all references removed 2026-05-12)
- **Environment variables:** EXPO_PUBLIC_RORK_API_BASE_URL, EXPO_PUBLIC_RORK_APP_KEY, EXPO_PUBLIC_RORK_AUTH_URL, EXPO_PUBLIC_RORK_FUNCTIONS_URL, EXPO_PUBLIC_RORK_TOOLKIT_URL, EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY
- **Runtime purpose:** None — no code reads these anymore
- **Production impact:** NONE
- **Replacement component:** N/A
- **Migration status:** RESOLVED (cosmetic cleanup only — owner may delete from Render/Expo dashboard)

---

## DEP-005: Rork-managed GITHUB_TOKEN

- **Dependency ID:** DEP-005
- **Exact files:** `backend/api/ivx-developer-deploy-control.ts` (used for GitHub API calls)
- **Environment variable:** `GITHUB_TOKEN` (Rork-managed, in private env vars)
- **Runtime purpose:** GitHub commits, branch operations, webhook management
- **Production impact:** HIGH — autonomous coder and deploy pipeline depend on this
- **Replacement component:** Owner-generated GitHub Personal Access Token with repo + workflow scopes
- **Migration risk:** MEDIUM — token rotation requires updating Render env var and verifying deploy still works
- **Migration status:** NOT STARTED — requires owner action
- **Test required:** Phase 9 — deploy from IVX-owned GitHub token only

**Owner action required:** Generate a new GitHub PAT at https://github.com/settings/tokens with `repo` and `workflow` scopes. Set it as `GITHUB_TOKEN` on Render (replacing the Rork-managed value).

---

## DEP-006: Rork-managed RENDER_API_KEY

- **Dependency ID:** DEP-006
- **Exact files:** `backend/api/ivx-developer-deploy-control.ts` (used for deploy triggers)
- **Environment variable:** `RENDER_API_KEY` (Rork-managed)
- **Runtime purpose:** Triggering Render deploys, checking deploy status
- **Production impact:** HIGH — deploy pipeline depends on this
- **Replacement component:** Owner-generated Render API key from https://dashboard.render.com/u/settings#api-keys
- **Migration risk:** LOW — straightforward key rotation
- **Migration status:** NOT STARTED — requires owner action

**Owner action required:** Generate a Render API key at https://dashboard.render.com/u/settings#api-keys. Set it as `RENDER_API_KEY` on Render.

---

## DEP-007: Rork-managed SUPABASE_ACCESS_TOKEN

- **Dependency ID:** DEP-007
- **Exact files:** `backend/api/ivx-supabase-management.ts` (if present)
- **Environment variable:** `SUPABASE_ACCESS_TOKEN` (Rork-managed, starts with `sbp_`)
- **Runtime purpose:** Supabase Management API — project status, database backups
- **Production impact:** MEDIUM — management operations only (runtime uses service role key separately)
- **Replacement component:** Owner-generated Supabase access token from https://supabase.com/dashboard/account/tokens
- **Migration status:** NOT STARTED — requires owner action

**Owner action required:** Generate a Supabase access token. Set it as `SUPABASE_ACCESS_TOKEN` on Render.

---

## DEP-008: Rork sandbox environment

- **Dependency ID:** DEP-008
- **Exact files:** N/A (infrastructure, not code)
- **Runtime purpose:** This Rork agent session runs inside a Rork sandbox — all code changes are made from Rork infrastructure
- **Production impact:** NONE on production runtime (production runs on Render, not Rork)
- **Replacement component:** Owner must deploy from their own machine or CI/CD pipeline
- **Migration status:** BLOCKED — cannot self-revoke from inside Rork

**Owner action required:** After all credentials are rotated and the IVX AI provider layer is tested, deploy from a non-Rork environment to verify independence.

---

## Runtime Network Audit

**Note:** Full runtime network logs require access to Render logs (not available from this sandbox). The source code audit above is comprehensive. To complete the network audit:

1. Check Render logs for outbound HTTP requests to `*.rork.com` or `*.vercel.sh`
2. Verify no hidden remote configuration endpoints
3. Confirm all AI calls go to the IVX-owned provider (after Phase 4 cutover)

**Expected Rork network requests after cutover:** ZERO
**Current Rork network requests:** The Vercel AI Gateway (`ai-gateway.vercel.sh`) is called for every AI request — this is the primary dependency to replace.

---

## Credential Rotation Checklist

| Credential | Current Owner | Action Required | Status |
|---|---|---|---|
| AI_GATEWAY_API_KEY | Rork (Vercel) | Replace with owner OpenAI key | NOT STARTED |
| GITHUB_TOKEN | Rork-managed | Replace with owner GitHub PAT | NOT STARTED |
| RENDER_API_KEY | Rork-managed | Replace with owner Render key | NOT STARTED |
| SUPABASE_ACCESS_TOKEN | Rork-managed | Replace with owner Supabase token | NOT STARTED |
| SUPABASE_SERVICE_ROLE_KEY | IVX-owned | Verify owner has backup | VERIFY |
| AWS_ACCESS_KEY_ID | IVX-owned | Verify owner has backup | VERIFY |
| AWS_SECRET_ACCESS_KEY | IVX-owned | Verify owner has backup | VERIFY |

---

## Access Revocation Checklist

After all credentials are rotated and verified:

- [ ] Remove Rork GitHub App access from repo settings
- [ ] Remove Rork webhooks (if any found in GitHub repo settings)
- [ ] Remove Rork from Render team/collaborator access
- [ ] Remove Rork from Supabase project access
- [ ] Remove all EXPO_PUBLIC_RORK_* env vars from Render
- [ ] Delete AI_GATEWAY_API_KEY from Render (after IVX provider is live)
- [ ] Verify zero network requests to *.rork.com in production logs
- [ ] 72-hour stability validation with zero Rork dependencies
