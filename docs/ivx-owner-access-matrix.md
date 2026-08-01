# IVX Holdings — Owner Access Matrix

**Last updated:** 2026-08-01

---

## Infrastructure Ownership

| Service | Account Owner | Access Method | MFA | Status |
|---|---|---|---|---|
| GitHub repo `ibb142/ivx-holdings-platform` | Owner (`ibb142`) | GitHub username/password | PENDING | IVX-owned |
| Render service `srv-d7t9ivreo5us73ftose0` | IVX Holdings | Render dashboard | PENDING | IVX-owned |
| Supabase project `kvclcdjmjghndxsngfzb` | IVX Holdings | Supabase dashboard | PENDING | IVX-owned |
| AWS account `138045599684` | IVX Holdings | AWS console | PENDING | IVX-owned |
| Expo/EAS project | IVX Holdings | Expo dashboard | N/A | IVX-owned |
| Domain `ivxholding.com` | IVX Holdings | Registrar dashboard | N/A | IVX-owned |

---

## Credential Ownership

| Credential | Stored On | Current Owner | Rotation Required | Status |
|---|---|---|---|---|
| IVX_OPENAI_API_KEY | Render env | Owner (PENDING) | Owner must provide | BLOCKED |
| IVX_ANTHROPIC_API_KEY | Render env | Owner (PENDING) | Owner must provide | OPTIONAL |
| AI_GATEWAY_API_KEY | Render env | Rork/Vercel | Replace with owner key | BLOCKED |
| GITHUB_TOKEN | Render env | Rork-managed | Owner must rotate | BLOCKED |
| RENDER_API_KEY | Render env | Rork-managed | Owner must rotate | BLOCKED |
| SUPABASE_ACCESS_TOKEN | Render env | Rork-managed | Owner must rotate | BLOCKED |
| SUPABASE_SERVICE_ROLE_KEY | Render env | IVX-owned | Verify backup | VERIFY |
| SUPABASE_URL | Render env | IVX-owned | No rotation needed | OK |
| AWS_ACCESS_KEY_ID | Render env | IVX-owned | Verify backup | VERIFY |
| AWS_SECRET_ACCESS_KEY | Render env | IVX-owned | Verify backup | VERIFY |
| JWT_SECRET | Render env | IVX-owned | Rotate after independence | PENDING |
| APP_SECRET | Render env | IVX-owned | Rotate after independence | PENDING |
| IVX_OWNER_TOKEN | Render env | IVX-owned | No rotation needed | OK |
| IVX_OWNER_REGISTRATION_EMAILS | Render env | IVX-owned | No rotation needed | OK |

---

## Access Revocation Checklist

After all credentials are rotated and verified:

- [ ] Remove Rork GitHub App access from repo settings
- [ ] Remove Rork webhooks from GitHub repo settings
- [ ] Remove Rork from Render team/collaborator access
- [ ] Remove Rork from Supabase project members
- [ ] Delete all EXPO_PUBLIC_RORK_* env vars from Render
- [ ] Delete AI_GATEWAY_API_KEY from Render (after IVX_OPENAI_API_KEY is live)
- [ ] Verify zero network requests to *.rork.com in production logs
- [ ] Run 72-hour stability validation with zero Rork dependencies

---

## Vendor Dependency Register

See `docs/rork-dependency-register.md` for the full dependency audit with exact file/line locations.

---

## Known Risks

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Rork AI gateway key revoked before owner key set | AI features stop working | MEDIUM | Owner must set IVX_OPENAI_API_KEY first |
| GITHUB_TOKEN expired | Deploy pipeline stops | LOW | Owner must rotate token |
| Render build minutes exhausted | Cannot deploy | MEDIUM | Owner upgraded to Performance plan |
| No MFA on owner accounts | Account compromise | MEDIUM | Owner should enable MFA on all services |
| Single OpenAI provider | No AI failover if OpenAI down | LOW | Anthropic fallback available |

---

## 30/60/90-Day Improvement Plan

### 30 Days

1. Owner provides OpenAI API key → AI_GATEWAY_API_KEY removed
2. Owner rotates GITHUB_TOKEN, RENDER_API_KEY, SUPABASE_ACCESS_TOKEN
3. Enable MFA on GitHub, Render, Supabase, AWS accounts
4. Verify zero Rork network requests in production logs
5. Run 72-hour independence validation

### 60 Days

1. Set up Anthropic as failover AI provider
2. Implement automated backup verification
3. Add monitoring alerts for AI cost thresholds
4. Create disaster recovery runbook
5. Security audit of all endpoints

### 90 Days

1. Deploy from non-Rork CI/CD pipeline (GitHub Actions)
2. Implement automated credential rotation
3. Add performance monitoring and alerting
4. Complete iOS build and App Store submission
5. Full penetration test
