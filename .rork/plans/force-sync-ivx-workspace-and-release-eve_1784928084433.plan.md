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