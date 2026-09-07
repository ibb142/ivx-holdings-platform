# IVX Holdings — System Architecture

**Last updated:** 2026-09-06
**Production commit:** See `/health` endpoint
**Canonical repository:** `ibb142/ivx-holdings-platform` (GitHub)

---

## 1. Platform Overview

IVX Holdings is a real estate investment platform with an autonomous AI engineering system (IVX IA). The platform consists of:

- **Backend API** — Hono-based TypeScript server running on Render
- **Mobile app** — Expo React Native (Android + iOS)
- **Web app** — Vite + React (landing pages, marketing)
- **Database** — Supabase (PostgreSQL + Auth + Storage + Edge Functions)
- **AI provider** — OpenAI/Anthropic via IVX-owned provider layer (replacing Vercel AI Gateway)
- **Autonomous worker** — IVX IA autonomous coder pipeline
- **CI/CD** — GitHub → Render auto-deploy

### Canonical Autonomous operating constitution

The canonical fleet is **12 command agents (IA-001..IA-012) plus 100 execution agents (IA-013..IA-112)**. Autonomous is the single production mutation authority. Health monitors and GitHub Actions may observe, test, and certify, but they do not independently resume, retry, cancel, enqueue fleet work, or deploy.

“112 agents working simultaneously” has one executable meaning: one production snapshot contains 112 distinct active agent identities, 112 distinct task leases, 112 fresh heartbeats, known claiming worker identities, deployed concurrency of at least 112, zero stale/blocked agents, an inactive emergency stop, one mutation authority, and an atomic PostgreSQL row queue. A 112-name registry, queued jobs, workflow fan-out, HTTP responses, or cumulative database calls do not satisfy this contract.

Scale is staged. The system first proves stable rates and evidence at 12 slots, then proves distributed atomic claims, unique worker identities, graceful shutdown/drain, lease recovery, idempotency, and zero duplicate execution. Only then may capacity rise toward 112. The current legacy JSON-document queue is not approved for horizontal multi-instance execution.

Owner controls outrank autonomy. Emergency stop, pause, approvals, spending limits, secrets, auth, payments, destructive data changes, infrastructure changes, and production release gates remain owner-controlled and fail closed.

---

## 2. Repository Structure

```
ivx-holdings-platform/
├── backend/                    # Hono API server (567 .ts files, 156 test files)
│   ├── hono.ts                 # Main server (368KB, all routes)
│   ├── ivx-ai-runtime.ts       # AI runtime with provider auto-detection
│   ├── api/                    # API route handlers
│   │   ├── ivx-owner-ai.ts     # Owner AI chat endpoint
│   │   ├── ivx-developer-deploy-control.ts  # Deploy pipeline
│   │   ├── ivx-independence-status.ts       # Independence audit
│   │   ├── ivx-owner-control-proof.ts       # Rork dependency checker
│   │   └── ...
│   ├── services/               # Business logic services
│   │   ├── ivx-ai-provider/    # IVX-owned AI provider layer (Phase 4)
│   │   ├── ivx-autonomous-coder.ts  # Autonomous execution engine
│   │   ├── ivx-durable-store.ts     # Supabase-backed persistence
│   │   ├── ivx-failure-recovery.ts  # Failure recovery service
│   │   ├── ivx-owner-conversation-state.ts  # Conversation state machine
│   │   ├── ivx-senior-engineer-persona.ts   # Senior engineer persona
│   │   └── ...
│   └── __tests__/              # Test suites
├── expo/                       # Expo React Native app (790 .ts/.tsx files)
│   ├── app/                    # Expo Router screens (251 screens)
│   ├── components/             # 70 UI components
│   ├── lib/                    # 171 lib modules
│   └── android/                # Android native build
├── docs/                       # Documentation
├── deploy/                     # Deployment scripts
├── data/                       # Data files
└── render.yaml                 # Render service configuration
```

---

## 3. Production Infrastructure

| Service | Provider | Owner | Resource ID |
|---|---|---|---|
| API server | Render | IVX Holdings | `srv-d7t9ivreo5us73ftose0` |
| Database | Supabase | IVX Holdings | `kvclcdjmjghndxsngfzb` |
| Code repository | GitHub | IVX Holdings (`ibb142`) | `ivx-holdings-platform` |
| AI provider | OpenAI (pending owner key) | Owner | `IVX_OPENAI_API_KEY` |
| Media storage | AWS S3 | IVX Holdings | Owner credentials |
| CDN | AWS CloudFront | IVX Holdings | Owner distribution |
| Mobile builds | Expo/EAS | IVX Holdings | Expo project |

---

## 4. AI Provider Architecture

### Current (transitional)

```
Owner chat → backend/ivx-ai-runtime.ts → getIVXAIGatewayApiKey()
    → IVX_OPENAI_API_KEY (owner) → api.openai.com/v1     [INDEPENDENT]
    → IVX_ANTHROPIC_API_KEY (owner) → api.anthropic.com   [INDEPENDENT]
    → AI_GATEWAY_API_KEY (Rork/Vercel) → ai-gateway.vercel.sh  [LEGACY]
```

### Target (after owner provides OpenAI key)

```
Owner chat → backend/ivx-ai-runtime.ts → IVX_OPENAI_API_KEY
    → api.openai.com/v1 (direct, no gateway)
    → Fallback: IVX_ANTHROPIC_API_KEY → api.anthropic.com
    → Emergency stop: owner-controlled
    → Cost tracking: daily/monthly limits
```

### IVX AI Provider Layer (`backend/services/ivx-ai-provider/index.ts`)

- Provider adapters: OpenAI, Anthropic, Vercel Gateway (legacy, disabled)
- Owner controls: emergency stop, daily/monthly cost limits, provider priority
- Failover: primary → fallback → error
- Retry: 3 attempts with exponential backoff
- Timeout: AbortController cancellation
- Health checks: per-provider status
- Cost tracking: per-request, daily, monthly

---

## 5. Autonomous Execution Pipeline

```
OWNER REQUEST
    → REQUIREMENT ANALYSIS (LLM)
    → TECHNICAL PLAN (LLM, separate call)
    → RISK CLASSIFICATION
    → TASK CREATION (durable store)
    → BRANCH CREATION (GitHub API)
    → CODE CHANGES (LLM patch generation)
    → TESTS (bun test)
    → TYPECHECK (tsc --noEmit)
    → SECURITY CHECKS (path traversal, unsafe ops)
    → EVIDENCE PACKAGE (diff, test results, commits)
    → OWNER APPROVAL (when required)
    → DEPLOYMENT (Render API, owner-gated)
    → PRODUCTION VERIFICATION (/health check)
    → CLOSE OR ROLLBACK
```

### Job States

QUEUED → PLANNING → RUNNING → TESTING → BLOCKED / APPROVAL_REQUIRED → DEPLOYING → VERIFYING → COMPLETED / FAILED / ROLLED_BACK / CANCELLED

### Owner Controls

- Pause all jobs
- Cancel a job
- Deploy approval (single-use, time-limited, commit-bound)
- Emergency stop (disables all AI activity)
- Rollback production

---

## 6. Key Files

| File | Purpose | Lines |
|---|---|---|
| `backend/hono.ts` | Main API server, all routes | 368KB |
| `backend/ivx-ai-runtime.ts` | AI runtime with provider auto-detection | ~900 |
| `backend/services/ivx-ai-provider/index.ts` | IVX-owned AI provider layer | 565 |
| `backend/services/ivx-autonomous-coder.ts` | Autonomous execution engine | 2400+ |
| `backend/api/ivx-owner-ai.ts` | Owner AI chat + conversation state | ~7000 |
| `backend/services/ivx-senior-engineer-persona.ts` | Senior engineer system prompt | ~500 |
| `backend/services/ivx-owner-conversation-state.ts` | Conversation state machine | ~800 |
| `backend/services/ivx-durable-store.ts` | Supabase-backed persistence | ~400 |
| `backend/api/ivx-developer-deploy-control.ts` | Deploy pipeline (GitHub + Render) | ~1800 |
| `backend/api/ivx-independence-status.ts` | Independence audit endpoint | ~240 |
| `backend/api/ivx-owner-control-proof.ts` | Rork dependency checker | ~230 |

---

## 7. Test Commands

```bash
# Backend tests
cd /home/user/rork-app && bun test backend/

# Expo tests
cd /home/user/rork-app/expo && bun test

# Type check (if tsc available)
cd /home/user/rork-app && node node_modules/typescript/bin/tsc --noEmit
```

---

## 8. Deployment Commands

```bash
# Deploy via backend API (owner-gated)
POST /api/ivx/developer-deploy/action
  action: "render_trigger_deploy"
  confirm: true
  confirmText: "CONFIRM_IVX_RENDER_DEPLOY"

# Check deploy status
POST /api/ivx/developer-deploy/action
  action: "render_get_deploy_status"

# Check production health
GET https://api.ivxholding.com/health
```

---

## 9. Critical Workflows

- **Owner login:** `POST /api/ivx/owner-passwordless-login` with emergency code
- **Owner AI chat:** `POST /api/ivx/owner-ai` with bearer token
- **Member registration:** `POST /api/members/register`
- **Investor discovery:** `GET /api/ivx/investor-discovery`
- **Buyer discovery:** `GET /api/ivx/buyer-discovery`
- **Deal tracking:** `GET /api/ivx/deal-tracking`
- **Autonomous jobs:** `POST /api/ivx/agent-jobs` + `GET /api/ivx/agent-jobs/:id`
- **Deploy control:** `POST /api/ivx/developer-deploy/action`
- **Independence status:** `GET /api/ivx/rork-independence`
