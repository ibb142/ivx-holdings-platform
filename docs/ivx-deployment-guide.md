# IVX Holdings — Deployment Guide

**Last updated:** 2026-08-01

---

## Production Deployment

### Infrastructure

| Component | Service | Details |
|---|---|---|
| API Server | Render | Service ID: `srv-d7t9ivreo5us73ftose0` |
| Database | Supabase | Project: `kvclcdjmjghndxsngfzb` |
| Code | GitHub | Repo: `ibb142/ivx-holdings-platform`, Branch: `main` |
| Domain | `api.ivxholding.com` | Points to Render service |

### Deploy Flow

1. Code committed to GitHub `main` branch
2. Render auto-deploys (detects GitHub webhook)
3. Render builds: `bun install` → `bun run build` → start command
4. Production boots, `/health` endpoint goes live
5. Verify: `GET https://api.ivxholding.com/health` returns HTTP 200

### Manual Deploy (owner-gated)

```bash
# Get owner token
TOKEN=$(curl -s -X POST https://api.ivxholding.com/api/ivx/owner-passwordless-login \
  -H "Content-Type: application/json" \
  -d '{"email":"iperez4242@gmail.com","emergency":"ivx_emergency_recovery"}' \
  | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('accessToken',''))")

# Trigger deploy
curl -X POST https://api.ivxholding.com/api/ivx/developer-deploy/action \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"render_trigger_deploy","confirm":true,"confirmText":"CONFIRM_IVX_RENDER_DEPLOY"}'

# Check deploy status
curl -X POST https://api.ivxholding.com/api/ivx/developer-deploy/action \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"render_get_deploy_status"}'

# Verify production health
curl -s https://api.ivxholding.com/health | python3 -m json.tool
```

### Environment Variables (Render)

**Required for production:**
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (server-only)
- `IVX_OPENAI_API_KEY` — Owner OpenAI API key (replaces AI_GATEWAY_API_KEY)
- `GITHUB_TOKEN` — GitHub PAT (repo + workflow scopes)
- `RENDER_API_KEY` — Render API key
- `JWT_SECRET` — JWT signing secret
- `APP_SECRET` — App signing secret
- `IVX_OWNER_TOKEN` — Owner authentication token
- `IVX_OWNER_REGISTRATION_EMAILS` — Owner email whitelist

**Legacy (to be removed after independence):**
- `AI_GATEWAY_API_KEY` — Vercel AI Gateway key (Rork-managed)
- `EXPO_PUBLIC_RORK_*` — Orphaned Rork env vars (no code reads them)

### Build Configuration

- **Build command:** `bun install && bun run build`
- **Start command:** `bun run start`
- **Node version:** 20+
- **Package manager:** bun

---

## Rollback Guide

### Rollback via Render Dashboard

1. Go to Render dashboard → `ivx-holdings-platform` service
2. Click "Deploys" tab
3. Find the last known-good deploy
4. Click "Rollback to this deploy"

### Rollback via API

```bash
# Get current production SHA
CURRENT_SHA=$(curl -s https://api.ivxholding.com/health | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('commit',''))")

# Rollback via GitHub (force push previous commit)
# This requires GitHub API access with the owner's PAT
```

### Rollback via Autonomous Coder

The autonomous coder has a built-in rollback mechanism:
- If deploy succeeds but `/health` returns a different commit SHA, rollback is triggered automatically
- If rollback fails, job status is set to `FAILED` with error details

---

## Health Verification

```bash
# Basic health
curl -s https://api.ivxholding.com/health

# Expected response:
{
  "status": "healthy",
  "commit": "<sha>",
  "bootTime": "<ISO timestamp>",
  "environment": "production",
  "serviceName": "ivx-holdings-platform",
  ...
}
```

### Key Health Markers

- `llmPatchGenerationV619` — V6.19 AbortController fix
- `abortControllerEnabled` — AbortController active
- `splitPlanningStage` — Split planning active
- `seniorEngineerPersonaV5` — Senior engineer persona
- `deployCodeExecutionV610` — Deploy execution wired

---

## Mobile Build (Android APK)

```bash
cd expo/
bun install

# Build release APK
cd android && ./gradlew assembleRelease

# Output
# expo/android/app/build/outputs/apk/release/app-release.apk
```

### APK Configuration

- **Version:** Defined in `expo/app.config.ts`
- **Version code:** In `expo/android/app/build.gradle`
- **Build marker:** In `expo/app.config.ts` (proves which commit the APK was built from)
- **Architectures:** arm64-v8a, armeabi-v7a, x86, x86_64

---

## iOS Build

**Status:** Deferred — requires macOS/Xcode environment.

When ready:
1. Install Xcode on a macOS machine
2. `cd expo/ && npx expo prebuild --platform ios`
3. Open `ios/*.xcworkspace` in Xcode
4. Configure signing credentials
5. Archive and upload to App Store Connect
