# IVX Holdings — Independent Development Environment

> **Complete setup guide for developing, testing, building, and deploying IVX
> entirely outside Rork.** No Rork sandbox, no Rork toolkit, no Rork APIs.

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 22+ (LTS) | Backend runtime (Render uses node:22-alpine) |
| Bun | 1.3.9+ | Package manager + test runner |
| Git | 2.40+ | Version control |
| Expo CLI | included in deps | Mobile app bundler |
| EAS CLI | included in deps | Standalone mobile builds |
| Docker | 24+ | Local backend container (optional) |

## 1. Clone the Repository

```bash
git clone https://github.com/ibb142/ivx-holdings-platform.git
cd ivx-holdings-platform
```

No Rork authentication required. The repository is a standard GitHub repo
with branch protection on `main` (PR reviews required, linear history enforced).

## 2. Install Dependencies

```bash
# Root (backend + shared tooling)
bun install

# Expo mobile app
cd expo
bun install
cd ..
```

Dependencies resolve from `package.json` + `bun.lock`. No `@rork-ai/*` packages
are declared — the Rork SDK was removed during the build-independence cutover.

## 3. Configure Environment Variables

Copy the template and fill in owner-controlled credentials:

```bash
cp .env.example .env
```

Edit `.env` with real values. See `.env.example` for variable names and
descriptions. **Never commit `.env` to git.**

### Critical Variables

| Variable | Source | Notes |
|---|---|---|
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway dashboard | `vck_` prefix; server-side only |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project dashboard | Public; inlined into client bundle |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase project dashboard | Public; inlined into client bundle |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project dashboard | Server-side only; never in EXPO_PUBLIC_ |
| `GITHUB_TOKEN` | GitHub Settings → Developer settings → PAT | `repo` scope for autonomous worker |
| `RENDER_API_KEY` | Render dashboard → API keys | For deploy control endpoints |
| `RENDER_SERVICE_ID` | Render dashboard → service details | `srv-d7t9ivreo5us73ftose0` |
| `AWS_ACCESS_KEY_ID` | AWS IAM console | S3 + CloudFront |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM console | S3 + CloudFront |

### Variables NOT Required (Rork-Only)

The following were Rork-managed and are NOT needed outside Rork:

- `EXPO_PUBLIC_RORK_API_BASE_URL` — Rork API; replaced by `EXPO_PUBLIC_IVX_API_BASE_URL`
- `EXPO_PUBLIC_RORK_AUTH_URL` — Rork auth; replaced by `EXPO_PUBLIC_IVX_AUTH_URL`
- `EXPO_PUBLIC_RORK_FUNCTIONS_URL` — Rork functions; replaced by direct backend calls
- `EXPO_PUBLIC_RORK_TOOLKIT_URL` — Rork toolkit; removed entirely
- `EXPO_PUBLIC_RORK_APP_KEY` — Rork app identifier; removed entirely
- `EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY` — Rork toolkit secret; removed entirely
- `RORK_PUBLIC_GITHUB_TOKEN` — Rork-injected GitHub token; use `GITHUB_TOKEN` directly

## 4. Start Backend Locally

```bash
# From repository root
bun run dev:backend

# Or with tsx directly
npx tsx server.ts
```

The backend starts on `http://localhost:3000` with all 77 routes registered.

Verify:
```bash
curl http://localhost:3000/health
# Expected: {"status":"healthy","routes":77,...}
```

## 5. Start Expo Mobile App Locally

```bash
cd expo
bun run start
```

This launches the Expo dev server. Scan the QR code with Expo Go, or press:
- `a` — Android emulator
- `i` — iOS simulator
- `w` — Web browser

The app reads `EXPO_PUBLIC_IVX_API_BASE_URL` to connect to the backend.
For local development, set it to `http://localhost:3000` in `expo/.env`.

## 6. Run Tests

```bash
# Backend tests (2500+ tests)
bun run test:backend

# Expo tests (1085+ tests)
bun run test:expo

# Full QA suite
bun run test:all

# Independence audit
bun run audit:independence
```

No Rork sandbox is required. Tests run with `bun test` and use injected mocks
for external services (GitHub, Render, Supabase, AI Gateway).

## 7. Build Mobile App

### Expo Go (Development)
Already supported — `bun run start` in `expo/`.

### Standalone Android APK/AAB
```bash
cd expo
# APK (for testing)
eas build --platform android --profile preview --non-interactive

# AAB (for Google Play)
eas build --platform android --profile production --non-interactive
```

### Standalone iOS
```bash
cd expo
# Simulator build
eas build --platform ios --profile ios-simulator-qa --non-interactive

# Device build
eas build --platform ios --profile ios-device-qa --non-interactive

# App Store build
eas build --platform ios --profile production --non-interactive
```

EAS requires an Expo account with `EXPO_PUBLIC_EAS_PROJECT_ID` configured.

### Native Build (No EAS)
```bash
# Android
cd expo/android
./gradlew assembleRelease

# Output: expo/android/app/build/outputs/apk/release/app-release.apk
```

## 8. Deploy Backend to Render

### Automatic (via GitHub push)
Render auto-deploys on push to `main`:
```bash
git push origin main
# Render detects the push and builds automatically
```

### Manual (via Render API)
```bash
# Trigger a deploy using the Render API
curl -X POST "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"commitId":"'"$(git rev-parse HEAD)"'"}'
```

### Verify Deployment
```bash
# Health check
curl https://api.ivxholding.com/health

# Version check
curl https://api.ivxholding.com/version

# SHA parity check
PROD_SHA=$(curl -s https://api.ivxholding.com/health | jq -r .commit)
LOCAL_SHA=$(git rev-parse HEAD)
[ "$PROD_SHA" = "$LOCAL_SHA" ] && echo "SHA PARITY ✅" || echo "SHA MISMATCH ❌"
```

## 9. Deploy Landing Page

```bash
cd expo
bun run build-landing
bun run deploy-landing
```

Deploys to S3 + CloudFront. Requires `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `CLOUDFRONT_DISTRIBUTION_ID`.

## 10. Start Autonomous Worker

The autonomous senior-developer worker runs inside the backend server process:

```bash
IVX_SENIOR_DEV_WORKER_ENABLED=true npx tsx server.ts
```

It polls `ivx_owner_ai_tasks` for `senior-dev-*` tasks and executes the full
8-phase engineering pipeline: analyze → code → test → commit → PR → merge →
deploy → verify.

All GitHub operations use `GITHUB_TOKEN` (not Rork). All Render operations use
`RENDER_API_KEY` (not Rork). All AI operations use `AI_GATEWAY_API_KEY` (not Rork).

## 11. Independence Audit

Run the built-in audit to verify zero Rork runtime dependencies:

```bash
cd expo
node scripts/ivx-independence-audit.mjs
```

Expected output:
```
✓ PASS  package.json — no @rork-ai/* in dependencies
✓ PASS  metro.config.js — plain Expo Metro config
✓ PASS  rork.json — absent
✓ PASS  expo/.env — no Rork-prefixed env keys
✓ PASS  expo app code — no Rork runtime imports/URLs
```

## Troubleshooting

### Backend won't start
- Check `PORT` is not already in use: `lsof -i :3000`
- Ensure `SUPABASE_SERVICE_ROLE_KEY` is set (required for Supabase client)
- Check `AI_GATEWAY_API_KEY` is set (required for AI provider)

### Expo app can't connect to backend
- Verify `EXPO_PUBLIC_IVX_API_BASE_URL` points to your backend
- For Android emulator, use `http://10.0.2.2:3000` (not `localhost`)
- For physical device, use your machine's LAN IP

### Tests fail
- Most failures are environment-dependent (missing API keys, network timeouts)
- Run env-independent tests only: `bun run test:backend:env-independent`
- Check that `GITHUB_TOKEN` is set for autonomous worker tests

### EAS build fails
- Verify `EXPO_PUBLIC_EAS_PROJECT_ID` is set
- Ensure you're logged into Expo: `eas login`
- Check the EAS project is linked: `eas init`

### Render deploy fails
- Check the Dockerfile builds locally: `docker build -t ivx-test .`
- Verify all required env vars are set in Render dashboard
- Check Render build logs for specific errors
