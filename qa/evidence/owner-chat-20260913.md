# Owner chat incident — 13 September 2026

The Android screenshot is a real failure, not a completed end-to-end certificate.
This change addresses confirmed client-state defects and an authentication-error
classification defect, plus excessive per-agent reads in the Autonomous control
plane. It does not certify the APK currently installed by the owner.

## Follow-up audit and dashboard correction

- The updated branch incorporates main `e52bfee89187eff24f19e618bcd619d63b33a7c7`
  (PR #1870), preserving its live-fleet endpoint, shared JSON contract, and Expo
  dashboard. That main SHA was confirmed live on both Render API and worker;
  it does not contain this PR's chat client changes.
- The previous PR head `035761791c820d11f34cd4e9aab8f7af70e764d4` had 25 successful
  checks, one skipped check and one failed check. These results do not certify the
  updated commit. The [native job](https://github.com/ibb142/ivx-holdings-platform/actions/runs/34781316160/job/103788728436)
  built the QA APK, then failed the owner-home `IVXHOLDINGS` assertion after a
  120-second wait. It never reached the chat/dashboard acceptance flows.
- In that native job's login window, Render recorded two
  `/api/members/login` responses with HTTP 503, at 20:51:39 and 20:51:56 UTC,
  taking about 16 seconds each. The application logged
  `Sign-in upstream timed out after retry`, `stage: aborted`, `elapsedMs: 8000`.
  The failing stage is the upstream identity-service request with two bounded
  attempts. The underlying reason that service did not respond is still open.
  Raising the emulator wait does not establish that authentication works.
- At 22:01:24 UTC the API's `worker_repair` pool logged 84–86 waiters, a pool
  size of one, and checkout failures after about 1500 ms. Query hash
  `1b5e164d5a63209e` matches `SENIOR_QUEUE_JOB_SQL` exactly. The real
  control-plane GET launched one `getSeniorDeveloperJob` call per assignment
  through `Promise.all`; up to 112 distinct IDs defeated the existing per-ID
  in-flight coalescing. This confirms a source of dashboard pool pressure;
  it does not prove that the same pressure caused the identity-service outage.
- The GET now reads the selected jobs in one bounded statement through the
  existing repair pool. It preserves complete selected job evidence, rejects
  duplicate/mismatched IDs, retains missing jobs as missing, and keeps mutation
  authority on its existing separate checks. Identical simultaneous batches share
  only their outstanding read; every caller gets an independent snapshot, and
  mutation attempts invalidate outstanding reads even if acknowledgement fails.
- The control-plane auth catch also preserves typed upstream outages as retryable
  503; cached telemetry remains behind authentication. Database failures remain
  errors rather than successful empty fleets.
- The new selected-job SQL passed against isolated PostgreSQL (PGlite 0.3.14):
  112 jobs, missing IDs, later observations, duplicate identities, malformed IDs,
  and SQL-looking bound input. This is a correctness check, not a production
  latency benchmark. Production latency after deployment remains unmeasured.
- Local follow-up validation: 19 backend batch/bridge/handler tests, six SQL
  test entries (five subtests plus their parent), three existing truth-contract
  tests, six existing live-fleet endpoint tests, and the 16 chat regressions pass.
  Backend TypeScript and `git diff --check` pass. The SQL test now runs in the
  existing recovery workflow; the native workflow checks out the exact expected
  commit, not a moving branch. No acceptance assertion was relaxed.
- The separate main dashboard APK job for version 1.10.32 / build 130 completed
  its signed build/upload steps. That build certificate is not an authenticated
  chat execution certificate and does not include this PR's client corrections.

The proposed moving-time partial index was not applied. PostgreSQL requires index
expressions and predicates to use immutable functions, so `clock_timestamp()`
cannot define a rolling 60-second index. An index on `(agent_number, status)` is
also not a case-insensitive lookup. See
[CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html).
The proposed `ALTER ROLE` statements change broad role defaults rather than the
project's telemetry pool. Supabase's standard API roles are `anon` and
`authenticated`; role/session-specific scope must be verified before changing
timeouts. See [Supabase timeouts](https://supabase.com/docs/guides/database/postgres/timeouts).
No role, index, emergency-stop, budget, or task-state production writes were made.

## Observed evidence

- Inspected source and API deployment: `fcc452be87d5214051df8eed58b77433508b0d71`.
- Render API deployment: `dep-daje9bqjnfac73ev8cf0`, live since 18:01:45 UTC.
- In the 19:52 UTC Android request window, `/api/ivx/owner-ai` returned 503 with
  `AUTH_SERVICE_UNAVAILABLE`, `source: authentication_unavailable`, `retryable: true`.
  One interrupted request returned 499. An example failure trace is
  `ownerai-1789329140833-g3a2z5`.
- `/api/ivx/owner-ai/proxy-status` returned 403 during the same failure window.
  The registered-owner guard wrapped identity-provider unavailability as 403.
- Later requests passed owner verification and returned HTTP 200. That alone does
  not prove an answer rendered on the device or that the earlier request recovered.
- A read-only Supabase sample at 20:17:20 UTC found 39 client connections: 33 idle,
  four active, two idle in transaction. The longest active query was under one
  second. This later sample does not establish the cause of the earlier outage.
- The installed Android build/version is not established by the screenshot.

## Confirmed defects and changes

| Defect | Change |
| --- | --- |
| An intentionally empty streaming placeholder immediately hit the invalid-reply fallback. | Active streaming rows render the existing inline cursor; only empty terminal replies use the error fallback. |
| The fallback exposed Retry/Remove with no handlers. | Failed-message actions render only when connected. Owner retry/remove retains the original message. |
| Optional watchdog tracing controlled whether real streaming deltas rendered. | Deltas render independently of tracing. |
| An older request's cleanup could clear a newer request's streaming state. | Cleanup and progress are scoped to the active reply identity. |
| Empty placeholders could satisfy the visible-result invariant. | A terminal bubble must contain text or an attachment. |
| The send queue's completion never updated the route's pending owner status. | Queue completion/failure updates the original pending row and preserves its text. |
| Queue results discarded the real persisted message ID and persistence scope. | The actual result is carried through queue state and the hook. Device saves are distinguished from remote acknowledgements. |
| Local storage failures could be reported as saved. | Failed device writes reject; device-only messages retain that status when mirrored. |
| The route invented owner/assistant read receipts for loaded owner messages. | Rendering no longer fabricates read receipts. |
| The composer displayed “Assistant ready” after failure or during a pending reply. | It reports a failed last reply, stays quiet during streaming, and uses “Ready to send” while idle. |
| Identity-provider unavailability became owner-forbidden on the status probe. | Preserve the typed cause and 503, with Retry-After and no-store headers. Missing/invalid credentials remain denied. |

## Validation

- New production-code harness: 16 passing tests. It executes the route renderer,
  message bubble, transport, local-write acknowledgement and registered-owner/proxy
  handlers with controlled I/O. This is not a native Android runtime.
- Before the fix, the first 14 regression cases produced 11 failures and three
  passes against the inspected deployment source. The screenshot's false error,
  dead controls, dropped deltas and auth 403 are reproduced by those failures.
- Existing Expo streaming, auth propagation and transport suites: 28 passing.
- Existing backend auth availability and response suites: 26 passing.
- Existing owner-profile concurrency/revocation suite: 11 passing.
- Existing device mirror concurrency/recovery suite: six passing. A failed local
  append now explicitly rejects; subsequent writes still succeed.
- `git diff --check`: clean.
- The PR adds an independent CI regression job and includes the harness in the
  existing real-owner Android certification workflow. CI/native results must be
  read from the exact PR commit; local harness results do not substitute for them.

Reproduce the new tests with `node --test qa/chat-reply-state.test.mjs` after
installing Expo's pinned TypeScript 5.9 compiler API. The root TypeScript 7 CLI
does not expose that compiler API.

## Remaining closure criteria

1. Determine why the identified upstream identity-service requests time out.
   The client-state and status-code fixes do not restore an unavailable identity provider.
2. Complete CI on the updated head and the real authenticated Android send/stream/error/
   retry/reload flow on the generated APK. Capture the APK source SHA and request ID.
3. Merge/deploy only with authorization covering this concrete change, then verify
   API SHA and install/test the corresponding APK. A backend deployment alone
   cannot update the client code shown in the screenshot.
4. Confirm subsequent observation windows before making any reliability claim.
5. Measure dashboard query checkout and response latency after deploying the
   batch-read fix. Independently resolve the live AI budget admission gate and
   durable enqueue timeouts before certifying productive autonomous execution.

There are no database migrations, financial reconciliations, emergency-stop changes
or fleet requeue operations in this patch. Rollback is a normal code revert and
redeployment/rebuild of the previous API/APK; no database rollback is required.

Authentication review follows [Supabase getUser documentation](https://supabase.com/docs/reference/javascript/auth-getuser):
identity remains verified by the auth server; an unavailable lookup never grants owner access.
