---
name: "Force-sync IVX workspace and release every target"
overview: "The local IVX workspace will become the release source, then each delivery surface will be rebuilt and checked in order. The release will include a complete evidence record, while clearly marking any checks that require a physical device."
createdAt: 2026-07-24T21:21:24.433Z
---
# Force-sync IVX workspace and release every target

The local IVX workspace will become the release source, then each delivery surface will be rebuilt and checked in order. The release will include a complete evidence record, while clearly marking any checks that require a physical device.

## Features
- Make the local IVX workspace the source of truth when it conflicts with the currently live version.
- Publish every local-only feature and replace conflicting live files as authorized.
- Deliver the backend, website, background automation, Android release, and iOS release in a controlled sequence.
- Capture a release evidence record for each step: source revision, validation result, deployment status, and live response.

## Release sequence
- Capture the current live revision and create a recovery point before any replacement.
- Publish the local source in small, auditable batches: backend and autonomous-worker support first, then web experience, then Android, then iOS.
- For live-only features that would be removed by the local source, preserve their exact previous content in the recovery point rather than silently discarding it.
- Rebuild and validate each batch before moving to the next one; stop the release if a required validation fails.
- Deploy the API, website, and background worker after their source is published, then verify the live revision matches the published revision.
- Build and validate Android and iOS separately; publish only artifacts that pass their build checks.

## IVX IA and autonomous audit
- Exercise the senior-developer workflow using the released source: approval gate, queued job, status tracking, stale-job handling, verification timeout, failure recording, and recovery evidence.
- Run focused checks for the autonomous worker and task state model before deployment.
- Record which recovery behaviors remain unavailable, including retry/dead-letter coverage, rather than treating them as verified.

## Proof and verification
- Produce a release ledger with the ordered source batches, source revision IDs, test/build results, deployment IDs, runtime revision match, health response, and artifact hashes where available.
- Run live API and web checks after every successful deployment.
- Mark physical Android and iOS behavior as not verified until a device run is completed; simulator/build proof is not a substitute.
- Report the final status by evidence layer: coded, tested, published, deployed, live API checked, live interface checked, physical Android checked, physical iOS checked, and owner accepted.

## Delivery surfaces
- API and owner automation: publish the local backend and autonomous-worker source, deploy it, and verify health plus the live revision.
- Web experience: publish the local web source, rebuild it, deploy it, and check the public routes.
- Android: reconcile local Android source, create a release build, verify its package and checksum, and publish only after build success.
- iOS: build the current iOS app and validate it in the simulator. The current local iOS app provides Overview, Portfolio, Activity, and Profile screens; build proof is recorded separately from TestFlight and physical-device verification.

## Safety and rollback
- Do not delete the previous live version; keep a recoverable release point before forced replacement.
- Use the authorized owner-gated release actions for every source publication and production deployment.
- If any batch cannot build, deploy, or match its live revision, halt that batch and report the exact evidence instead of claiming completion.

## Release evidence ledger — 2026-07-24

- Recovery point: `rollback-live-2026-07-24-4652a693` preserves the previous live revision `4652a6930a99142b339e43872c5221a04efeab21`.
- Backend and worker source: published as `33691995d2383f1d73096c021c66e22efa51ec1e`; Render deployment `dep-d9htokkfnr2s73anlpr0` reached `live`, with the health endpoint revision matched before subsequent work.
- Landing source: published as `30ac6344dbd728ca6de34a0e4a935194c342ba71`; deployed to S3 and CloudFront. Public root, capture routes, robots, sitemap, health, and both public deal feeds returned HTTP 200. Render subsequently reported this revision live.
- Chat source: published as `33940e9b112ec29dded6e470ec889720040ad1dd`; Render reported it live and API health matched the revision.
- iOS source: published as `934e7e5eb7436d0a56b9b1974abf0a870110f848` (project, SwiftUI screens, and tests); iOS build checks passed. Render deployment `dep-d9hu011c0rfc738hshm0` reached `live` and health plus worker revision both matched this commit.
- Expo checks: TypeScript passed; lint completed with existing warnings only; APK link consistency passed for version `1.4.37`.
- Android artifact: local release APK checksum `ee5fc9c7e00f720538993c73dc87638bd0a0ce99903466822b0a806f759bd7e9`, size `18,137,834` bytes. It remains debug-signed, so it is build evidence only and is not Play-distribution ready.
- iOS distribution: signed build artifact exists. A fresh iOS build check passed on 2026-07-24; TestFlight/App Store delivery and physical-device QA remain unverified.
- Autonomous deploy verification: owner-approved job `ivx-worker-69a27687-7744-4f9b-906d-ace172511052` completed with terminal state `VERIFIED`. It performed a deploy-only release of main revision `934e7e5eb7436d0a56b9b1974abf0a870110f848`; Render deployment `dep-d9hu14kfnr2s73anrtj0` was independently confirmed `live`. The durable worker ledger records focused tests passed, health HTTP 200, live commit parity, and `endToEndProductionComplete: true`.
- Autonomous-worker focused validation: 55 tests passed across the worker queue, task-state, and live-commit verification suites. This covers owner gating, queuing/attach, cancel/resume, stale-job sweep, terminal transition guards, deploy-proof requirements, and version parity behavior. The local test environment emitted a non-fatal emergency-stop Supabase 401 warning and failed open as designed.
- IVX IA chat audit patch (local, pending publication): reproduced that unauthenticated execution prompts on `POST /api/public/chat` received a raw HTTP 409 gate payload without the normal chat `answer` field. Clients that treat non-2xx as a failed turn could therefore present the reply as missing. The public-chat handler now persists and returns the same truth-first `STATE: BLOCKED` evidence as a normal HTTP 200 chat response, including task ID, blocker code, exact blocker, owner action, and gate metadata; it makes no execution, deployment, commit, or test claim.
- IVX IA chat audit validation: the focused public gate and signed-deployment authorization suite now passes 71 checks. The iOS build check also passed on 2026-07-25. Root TypeScript validation remains blocked by pre-existing type errors outside this release scope.
- Current release status (2026-07-25): local source includes the renderable public-chat blocker response plus HMAC worker authorization and single-use owner approvals. GitHub `main` and the live API still report `934e7e5eb7436d0a56b9b1974abf0a870110f848`; no new production deployment is claimed.
- Deployment blocker: the current Render account exposes the production API and chat frontend but not the configured `ivx-senior-dev-01` worker service. A real Supabase owner JWT is also required to create a live one-time deployment approval; the available legacy static tokens are deliberately not accepted. Until the reviewed source is published and the worker service is provisioned with the matching internal secret, live chat and signed-worker verification remain pending.
- Release attempt evidence (2026-07-25): a valid Supabase owner JWT successfully authorized job `ivx-worker-639a1564-5ea8-4f2c-8000-2997728b338a`. The deployed worker incorrectly classified the requested code-change release as `QA_ONLY`, produced no changed files and no commit, then re-used the old commit `934e7e5eb7436d0a56b9b1974abf0a870110f848` and deployment `dep-d9hu14kfnr2s73anrtj0`. Independent GitHub and API probes confirmed that SHA remains current and `POST /api/public/chat` with `deploy now` still returns HTTP 409. This job is not accepted as release proof.
- Remaining validation gaps: authenticated owner-chat production probe for this patch, source publication, Render deployment and commit-parity verification, provisioned worker secret binding, live one-time approval consumption, Expo Go/physical-device validation, Android protected release signing and Play delivery, iOS TestFlight/App Store submission, physical Android/iOS QA, and a live retry/dead-letter recovery drill.