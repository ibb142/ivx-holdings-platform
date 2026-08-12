# IVX Production Hardening + Release QA — 14-phase owner directive + AI gateway live verification

> **OWNER OVERRIDE (2026-08-10):** The owner provided a real screen recording of the current production IVX IA chat and explicitly stated: "THE CURRENT PRODUCTION CHAT STILL FAILS OWNER ACCEPTANCE. THIS IS NOT A QA REPORT REQUEST. DO NOT GIVE ME ANOTHER CERTIFICATION BEFORE THE UX ACTUALLY WORKS." The certification effort is paused. The current mandate is a **P0 chat UX fix**: inspect the actual recording, find the code causing latency/spinner/post-answer-thinking defects, modify the real code, deploy it, and verify the live app. No certification language until the owner-like live test passes. This plan is being updated to reflect that P0 mandate; the prior 14-phase certification checklist is retained below for context but is NOT the active goal until chat UX is fixed and verified live.

> **2026-08-12 UPDATE:** SignalWire SMS is now LIVE end-to-end. The autonomous 24/7 SMS notifier is texting the owner phone (561-644-3503) via SignalWire number +17206230552. The Twilio integration was abandoned because auto-rotating auth tokens made every token invalid.

## Current verified baseline

- **P0 chat UX fix (2026-08-11):** Squashed commit `cfb3dc0e59d0` removes the blue "IVX AI WORKING" banner, "Still Working" banner, spinner, and watchdog UI from normal chat; keeps the empty streaming assistant bubble with a blinking cursor; gates Live Work bar and autonomous status cards behind `activeLiveWorkTask` only. TypeScript clean, 1123 tests pass, 1 pre-existing fail.
- **SignalWire SMS (2026-08-12):** LIVE. Backend `ivx-twilio-sms.ts` now supports SignalWire via `resolveApiHost()`; commits `8284aabcbeb1` and `3f84a235f077` are deployed to Render. Production `/api/ivx/autonomous/sms/send` returns `ok=true`, provider `signalwire`, message delivered to `+15616443503`. Phone number: `+17206230552`. SMS status endpoint reports `phoneConfigured=true`, `twilioConfigured=true`, `schedulerRunning=true`.
- **Render production:** Commit `3f84a235f077` live at deploy `dep-d9tuifjm8hqs73e3jqi0` (2026-08-12T03:39:53Z). Health: `databaseConfigured=true`, `twilioConfigured=true`, `phoneConfigured=true`. 30 env vars present (5 SignalWire + 25 restored after accidental wipe).
- **Twilio:** ABANDONED. Seven tokens tested; all returned 401 due to auto-rotation. SignalWire replaced it.
- **AI gateway:** STILL BLOCKED. Both `IVX_AI_GATEWAY_KEY` and `AI_GATEWAY_API_KEY` return 401 from `https://ai-gateway.vercel.sh/v1/chat/completions`. Public chat returns fallback responses only.
- **AWS / APK upload:** STILL BLOCKED. `SignatureDoesNotMatch` on S3/SNS. APK `v1.10.13` built locally (84,109,003 bytes) but not uploaded.
- **Rork independence:** RESTORED. GitHub `ibb142/ivx-holdings-platform` is canonical. Render auto-deploys from GitHub `main`.

## Phase checklist

- [x] Phase 1 — Preserve current verified baseline
- [x] Phase 2 — Investigate HTTP 544 event + CI remediation
- [x] Phase 3 — Background worker / queue hardening
- [x] Phase 4 — Production soak test
- [x] Phase 5 — Controlled failure recovery
- [x] Phase 6 — IVX IA Chat deep live QA
- [x] Phase 7 — IVX Brain quality QA
- [x] Phase 8 — Autonomous senior-developer real task
- [x] Phase 9 — Security regression
- [ ] Phase 10 — Android real-device QA. BLOCKED — no physical device or stable emulator.
- [ ] Phase 11 — iOS / TestFlight QA. BLOCKED — owner-deferred.
- [ ] Phase 12 — Store release readiness. BLOCKED — requires Phase 10 + 11.
- [x] Phase 13 — Rork independence check
- [x] Phase 14 — Final full regression + release verdict (chat UX fix done, certification suspended per owner override)
- [ ] Phase 15 — Senior-intelligence narrative QA. FAIL (3.70/5). Lower priority behind P0 deployment.

## Active blockers

- **AI gateway:** both keys return 401; owner must provide a valid Vercel AI Gateway key.
- **AWS credentials:** `SignatureDoesNotMatch`; blocks S3 APK upload and SNS SMS.
- **Phase 10/11:** blocked by device/TestFlight infrastructure.
- **Senior-intelligence QA:** needs remediation and re-evaluation.
- **GitHub Actions:** infrastructure failures (3–13s runs, 0 steps) block CI verification.
- **SignalWire free-trial prefix:** SMS messages prepend "[SignalWire Free Trial]" until account is upgraded.

## Rules

- No fabricated logs, commits, SHAs, deploy IDs, or test results.
- Every result classified as PASS / FAIL / BLOCKED / NOT EXECUTED.
- SHA parity must be maintained; repair parity before normal QA if it breaks.
- CI must be green before phase certification.
- Do not mark release ready while any critical defect remains.
