# IVX Holdings — Security Model

**Last updated:** 2026-08-01

---

## 1. Authentication

### Owner Authentication

- **Method:** Passwordless login with emergency code
- **Endpoint:** `POST /api/ivx/owner-passwordless-login`
- **Token:** JWT (signed with `JWT_SECRET`)
- **Token lifetime:** Configurable via `IVX_OWNER_TOKEN_TTL`
- **Emergency code:** Stored in `IVX_OWNER_TOKEN` env var

### Member Authentication

- **Method:** Email + password registration
- **Endpoint:** `POST /api/members/register`
- **Backend:** Supabase Auth
- **Required fields:** firstName, lastName, email, password, phone, acceptTerms, dateOfBirth, gender, roles

### Token Security

- JWT tokens signed with `JWT_SECRET` (server-only env var)
- Owner-only endpoints guarded by `assertIVXOwnerOnly()` middleware
- Tokens never logged or exposed in client code

---

## 2. Authorization

### Owner-Only Endpoints

All sensitive endpoints require owner authentication:
- `/api/ivx/owner-ai` — Owner AI chat
- `/api/ivx/developer-deploy/action` — Deploy control
- `/api/ivx/owner-operations/*` — Owner operations
- `/api/ivx/autonomous/*` — Autonomous system

### Deploy Approval

- **Single-use:** Each approval is bound to one task and commit
- **Time-limited:** Approvals expire after a configurable window
- **Confirmation phrase:** `CONFIRM_IVX_RENDER_DEPLOY` required
- **Replay-protected:** Approval hash includes commit SHA + timestamp

---

## 3. Data Security

### Database (Supabase)

- **Service role key:** Server-only, never exposed to client
- **Anon key:** Client-safe, protected by RLS policies
- **RLS:** Row-level security on sensitive tables (investors, buyers, deals)
- **Backups:** Supabase automated daily backups

### Secrets Management

- All secrets stored as Render environment variables
- Secrets never logged (logging filters redact known secret patterns)
- `SUPABASE_SERVICE_ROLE_KEY` never sent to client
- `IVX_OPENAI_API_KEY` never sent to client
- AI provider keys accessed only server-side

---

## 4. AI Provider Security

### Key Isolation

- `IVX_OPENAI_API_KEY` — Owner-owned, server-only
- `IVX_ANTHROPIC_API_KEY` — Owner-owned, server-only
- `AI_GATEWAY_API_KEY` — Legacy (Rork-managed), to be removed

### Cost Controls

- Daily spend limit (default: $50)
- Monthly spend limit (default: $500)
- Emergency stop (owner-controlled, disables all AI activity)
- Per-request cost tracking

### Provider Failover

- Primary → Fallback → Error
- 3 retry attempts with exponential backoff (1s, 2s, 4s)
- Auth failures (401/403) never retried with same key
- Rate limit (429) retried with backoff

---

## 5. Autonomous Execution Security

### Path Safety

- Patch operations validated against path traversal (`..`)
- Unsafe paths rejected before file writes
- File operations scoped to project root

### Content Verification

- Every patch verified: file must contain `newText` after write
- Pilot sentinel: autonomous coder can only modify files with specific sentinel markers
- Revert on failure: patched files reverted to original if tests fail

### Owner Controls

- Pause all jobs
- Cancel a job
- Deploy approval required (owner-gated)
- Emergency stop (disables all AI activity)
- Rollback production

---

## 6. Independence Guards

### Rork Domain Blocking

```typescript
function isRorkDomain(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('toolkit.rork.com')
    || lower.includes('api.rork.com')
    || lower.endsWith('.rork.com')
    || lower.includes('rork-direct.workers.dev');
}
```

- Applied to all AI gateway URL candidates
- Prevents stale env vars from routing through Rork
- Applied in both `ivx-ai-runtime.ts` and `ivx-provider-autodetect.ts`

### Dependency Audit

- `GET /api/ivx/rork-independence` — Live independence status
- `GET /api/ivx/owner-control-proof` — Rork dependency checker
- `GET /api/ivx/owner-operations/rork-removal/preflight` — Removal readiness

---

## 7. Known Security Risks

| Risk | Severity | Status | Mitigation |
|---|---|---|---|
| AI_GATEWAY_API_KEY is Rork-managed | HIGH | BLOCKED | Owner must set IVX_OPENAI_API_KEY |
| GITHUB_TOKEN is Rork-managed | HIGH | BLOCKED | Owner must generate own PAT |
| RENDER_API_KEY is Rork-managed | MEDIUM | BLOCKED | Owner must generate own Render key |
| No MFA on owner account | MEDIUM | PENDING | Owner should enable MFA |
| No rate limiting on AI chat | LOW | MONITORED | Queue gating in place |

---

## 8. Credential Rotation Checklist

| Credential | Current Owner | Action | Status |
|---|---|---|---|
| AI_GATEWAY_API_KEY | Rork/Vercel | Replace with IVX_OPENAI_API_KEY | NOT STARTED |
| GITHUB_TOKEN | Rork-managed | Generate owner PAT | NOT STARTED |
| RENDER_API_KEY | Rork-managed | Generate owner Render key | NOT STARTED |
| SUPABASE_ACCESS_TOKEN | Rork-managed | Generate owner Supabase token | NOT STARTED |
| SUPABASE_SERVICE_ROLE_KEY | IVX-owned | Verify backup copy | VERIFY |
| AWS_ACCESS_KEY_ID | IVX-owned | Verify backup copy | VERIFY |
| AWS_SECRET_ACCESS_KEY | IVX-owned | Verify backup copy | VERIFY |
| JWT_SECRET | IVX-owned | Rotate after independence | PENDING |
