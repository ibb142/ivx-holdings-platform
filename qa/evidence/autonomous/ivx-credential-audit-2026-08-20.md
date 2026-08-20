# IVX Credential Audit — 2026-08-20

Every variable was checked two ways: **present in the environment** and **accepted by the
live service**. Presence alone is not a pass — 8 credentials exist and are dead.
No credential value is printed anywhere in this document.

## Headline

- **41 of 42** expected variables are present (`EXPO_PUBLIC_RORK_APP_KEY` missing).
- **9 were unusable.** 6 contained **prose descriptions instead of values** ("Supabase acc…",
  "Render key …"); 2 were **Supabase's published demo keys**; 1 was a stray malformed entry.
- **5 repaired automatically** (verified live before writing).
- **8 still dead — only you can replace these.**

## Repaired this pass (verified live, then written)

| Variable | Was | Now |
|---|---|---|
| `SUPABASE_URL` | prose "Supabase acc…" (739 chars) | real project URL — **REST 200** |
| `IVX_SUPABASE_URL` | prose (739 chars) | real project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **demo** key (`iss=supabase-demo`) | real key — **REST 200** |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase **demo** key | real key — **auth 200** |
| `RENDER_SERVICE_ID` | prose "Render key …" (1058 chars) | real service id |
| `Vercel ` (stray key, no value) | malformed | removed |

Real values were obtained from your **working Supabase management token**, not guessed.
Post-repair live proof: backend data layer **200**, app sign-in path **200**, owner
login end-to-end **200** (test session revoked immediately).

## Still dead — replacement required

| Credential | Live result | What is broken |
|---|---|---|
| `GITHUB_TOKEN`, `RORK_PUBLIC_GITHUB_TOKEN` | **401** | no push, no PR |
| `RENDER_API_KEY`, `IVX_RENDER_API_KEY` | prose, not a key | **cannot deploy the security fix** |
| `AI_GATEWAY_API_KEY`, `IVX_AI_GATEWAY_KEY`, `RORK_PUBLIC_IVX_AI_KEY` | **401** | AI features down — confirmed in prod (`ai.ok:false`) |
| `IVX_TWILIO_AUTH_TOKEN` (+SID) | **401** | **wire SMS alerts silently fail** |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | **403 InvalidClientTokenId** | S3 / CloudFront unusable |
| `SUPABASE_DB_URL` | prose | direct DB tooling unusable |
| `IVX_OWNER_SUPABASE_ACCESS_TOKEN` | prose | owner-scoped Supabase calls unusable |
| `EXPO_PUBLIC_RORK_APP_KEY` | absent | — |

## Working

| Credential | Live result |
|---|---|
| `SUPABASE_ACCESS_TOKEN` (management) | **200**, 1 project visible |
| `IVX_OWNER_EMAIL` + `IVX_OWNER_PASSWORD` | **200**, owner session issued (revoked after test) |
| Supabase service_role (after repair) | **200** |
| Supabase anon (after repair) | **200** |

## Scope correction — local vs production

`expo/.env` is **local and gitignored (not tracked in git)**. The broken values above were
blocking *local and agent* tooling; they are not automatically production's values.
Production reports `databaseConfigured: true`, so its Supabase credentials are set
independently and working. But production also reports **`ai.ok: false`**, so the AI
gateway key is dead **in production too** — not just locally.

## Correction to a prior finding

In the earlier security audit I recorded anon probes as "DENIED (401)". Re-tested with the
real anon key: `investor_profiles` returns **401 "permission denied for table"** — a genuine
RLS/permission denial, and `landing_submissions` returns 200 with `[]`. The security
conclusion (anon cannot read member data) stands, but the mechanism is a permission
denial, not an invalid key.

## Gates after the repair

Backend **2959 pass / 0 fail** · root TypeScript **0 errors**.

37 tests failed mid-audit from `@supabase/supabase-js`, `ai`, `@types/node` and `bun-types`
being pruned from `node_modules` again (same recurring environment issue, unrelated to the
credential repair). Restored with `bun install`; suite returned to 2959/0.

## Priority

1. **Render API key** — the wire-authentication fix from the security pass is still
   **committed but not deployed**. Production runs the vulnerable code until this lands.
2. **Rotate the Supabase `service_role` key** — 74 occurrences are in public git history.
   After rotation the repaired `.env` entry must be re-set.
3. AI gateway key (prod AI is down), Twilio (wire alerts silent), GitHub, AWS.
