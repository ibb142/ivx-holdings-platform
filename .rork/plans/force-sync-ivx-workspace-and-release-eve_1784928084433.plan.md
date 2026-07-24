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
- iOS: build the current iOS app and validate it in the simulator. The current local iOS app is still an empty starter screen, so it will be recorded honestly as a buildable shell unless a full iOS product interface is implemented before release.

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
- iOS distribution: signed build artifact exists, but TestFlight/App Store delivery and physical-device QA remain unverified.
- Remaining validation gaps: Expo Go/physical-device validation, Android protected release signing and Play delivery, iOS TestFlight/App Store submission, physical Android/iOS QA, and full worker retry/dead-letter recovery coverage.