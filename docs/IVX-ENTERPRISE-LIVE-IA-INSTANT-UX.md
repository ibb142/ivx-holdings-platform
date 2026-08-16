# IVX Enterprise Live IA + Instant UX

## Live IA control tower

The autonomous dashboard reports all 112 registered IA identities from the validated enterprise registry. Per-IA live telemetry is sourced from the durable autonomous campaign state and the real senior-developer worker queue.

Presence semantics:
- WORKING: an active worker stage is reported.
- QUEUED: a real queued worker job exists.
- IDLE: the IA is registered but has no active worker job.
- STALE: an active worker has exceeded the live heartbeat TTL.
- ATTENTION: the worker/campaign reports blocked, failed, or cancelled state.
- OFFLINE: the autonomous campaign is disabled.

Operating region is task jurisdiction/scope inferred from the current task or registered mission. It is not physical GPS. If no jurisdiction is evidenced, the UI reports `GLOBAL / UNASSIGNED` rather than inventing a location.

## Instant UX policy

The shared React Query client uses offline-first session behavior, long-lived in-memory cache, no refetch-on-mount blocking, reconnect refresh, and structural sharing. Existing image cache, media lifecycle, resumable upload, progressive/skeleton, optimistic UI, and offline queue systems continue to provide module-specific fast-path behavior.

The complete query cache is intentionally not persisted blindly to device storage because IVX can display sensitive investor and treasury information. Persistent offline storage must remain explicit and scoped to data that is safe to store locally.

## Evidence rule

No dashboard may display simulated IA activity, fake physical location, projected capital as realized capital, or a live/certified state without runtime evidence.
