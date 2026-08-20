# IVX Credential Audit — COMPLETE (2026-08-20)

Second pass. Rather than wait on manual input, every file in the repo was scanned for
credential material and each distinct value was tested against its live service.
No credential value appears in this document.

## Headline

**The Render API key was recovered — it was hidden inside a prose string** and is
**VALID**. But deploying still cannot fix production, for a reason found this pass:
**the repo Render deploys from is a different repository with divergent history.**

## Root cause of the "dead credentials"

`RENDER_API_KEY` and `IVX_RENDER_API_KEY` did not contain junk — they contained a
sentence *with the real key embedded inside it*. Naive reads got the whole sentence
(unusable); extracting the token yields a working key. The same pattern hides real
material inside `SUPABASE_URL`, `IVX_SUPABASE_URL`, `SUPABASE_DB_URL` and
`IVX_OWNER_SUPABASE_ACCESS_TOKEN`.

## Repaired this pass (verified live, then written)

Applied to **both** `expo/.env` and `android-ivx-holdings/.env`:

| Variable | Was | Now |
|---|---|---|
| `RENDER_API_KEY` | prose containing the key | extracted key — **Render API 200** |
| `IVX_RENDER_API_KEY` | prose containing the key | extracted key — **Render API 200** |
| `RENDER_SERVICE_ID` | prose (1058 chars) | real id — resolves to `ivx-holdings-platform` |
| `Vercel ` (stray, no value) | malformed | removed |

Plus the previous pass: `SUPABASE_URL`, `IVX_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`.

Render account now visible: 5 services, none suspended.

## THE BLOCKER — deploying would change nothing

| Fact | Value |
|---|---|
| Render deploy source | `github.com/ibb142/ivx-holdings-platform`, branch `main`, autoDeploy **yes** |
| GitHub `main` HEAD | `6ca1cd71f2b9` |
| Production live commit | `6ca1cd71f2b9` (already current) |
| Local Rork repo HEAD | `6b0b4bc2a017` |
| Is `6ca1cd71` in the local repo? | **NO — divergent histories** |

The Rork workspace and the GitHub repo Render builds from **do not share history**.
Local commits — including the security fix `33b548bc` — never reach that repo, so
**triggering a deploy would rebuild the same vulnerable commit.** I did not trigger one;
it would have produced a green "deployed" result while changing nothing.

The only unblocker is a **working GitHub token** (current one: 401).

## Production is confirmed still vulnerable

Verified **non-invasively** by reading the deployed source from GitHub — no new records
were injected into your financial audit trail.

Production `POST /api/ivx/wire-submission`:
- resolves a verified session — **NO**
- returns 401 / fails closed — **NO**
- trusts body-supplied `userId` — **YES**

Local fixed version: `resolveAuthenticatedMember` used **YES**, 401 fails closed **YES**,
identity from token not body **YES**. Security regression tests **28 pass / 0 fail**.

## Final credential status

**Working (5):** `SUPABASE_ACCESS_TOKEN` (management), `RENDER_API_KEY` +
`IVX_RENDER_API_KEY` (recovered), `RENDER_SERVICE_ID`, Supabase service_role + anon
(repaired), `IVX_OWNER_EMAIL` + `IVX_OWNER_PASSWORD` (owner session issued, revoked
immediately).

**Still dead — genuinely need replacement (4):**

| Credential | Live result | Impact |
|---|---|---|
| `GITHUB_TOKEN` / `RORK_PUBLIC_GITHUB_TOKEN` | **401** | **blocks the security deploy** |
| `AI_GATEWAY_API_KEY` / `IVX_AI_GATEWAY_KEY` / `RORK_PUBLIC_IVX_AI_KEY` | **401** (2 distinct keys, both dead) | prod AI down (`ai.ok:false`) |
| `IVX_TWILIO_AUTH_TOKEN` (+ SID) | **401** | wire SMS alerts fail silently |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | **403 InvalidClientTokenId** | S3 / CloudFront unusable |

**`AWS_ACCESS_KEY_ID` was never a real credential** — it is `AKIAIOSFODNN7EXAMPLE`, the
public example key from AWS's own documentation. It cannot be "expired"; it must be issued.

## New security findings

1. **Live secrets are compiled into Android build outputs.** The working GitHub token and
   AI keys appear in `Config.class` and `Config.dex` under `android-ivx-holdings/app/build/`.
   Those artifacts are untracked in git, but **any APK built this way ships the token
   inside it**, readable by anyone who unzips the APK. Secrets must not be baked into
   `Config` at build time.
2. **Credentials are duplicated across two `.env` files**, so every rotation has to happen
   twice or the copies silently diverge. Both are correctly gitignored and untracked.

## Gates

Backend **2959 pass / 0 fail** · root TypeScript **0 errors** · security contract **28/28**.

## What only you can do

1. **GitHub token** — the single blocker. Production keeps accepting unauthenticated wire
   submissions until the fix can be pushed to `ibb142/ivx-holdings-platform`.
2. **Rotate the Supabase `service_role` key** (74 occurrences in public git history), then
   re-set it in both `.env` files.
3. AI gateway key, Twilio auth token, real AWS keys.
4. Confirm whether the Rork workspace is *meant* to be the source for that GitHub repo —
   right now they are two unrelated codebases, which is why deploys never carry your changes.
