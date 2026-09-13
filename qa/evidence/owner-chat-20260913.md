# Owner chat incident — 13 September 2026

The Android screenshot is a real failure, not a completed end-to-end certificate.
This change addresses confirmed client-state defects and an authentication-error
classification defect. It does not certify the APK currently installed by the owner.

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
- `git diff --check`: clean.
- The PR adds an independent CI regression job and includes the harness in the
  existing real-owner Android certification workflow. CI/native results must be
  read from the exact PR commit; local harness results do not substitute for them.

Reproduce the new tests with `node --test qa/chat-reply-state.test.mjs` after
installing Expo's pinned TypeScript 5.9 compiler API. The root TypeScript 7 CLI
does not expose that compiler API.

## Remaining closure criteria

1. Determine the exact upstream stage/cause of the live authentication outage.
   The client-state and status-code fixes do not restore an unavailable identity provider.
2. Complete CI/type checking and the real authenticated Android send/stream/error/
   retry/reload flow on the generated APK. Capture the APK source SHA and request ID.
3. Merge/deploy only with authorization covering this concrete change, then verify
   API SHA and install/test the corresponding APK. A backend deployment alone
   cannot update the client code shown in the screenshot.
4. Confirm subsequent observation windows before making any reliability claim.

There are no database migrations, financial reconciliations, emergency-stop changes
or fleet requeue operations in this patch. Rollback is a normal code revert and
redeployment/rebuild of the previous API/APK; no database rollback is required.

Authentication review follows [Supabase getUser documentation](https://supabase.com/docs/reference/javascript/auth-getuser):
identity remains verified by the auth server; an unavailable lookup never grants owner access.
