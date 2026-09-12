# Bounded real-provider admission and recovery experiment

This reviewed experiment exercises the installed AI SDK, the unchanged
production budgeted HTTP transport, the actual shared PostgreSQL budget RPCs,
and real Gateway generation receipts. It does not alter the global policy,
pause the fleet, or use a fixture in place of the provider.

The fixed campaign allows three paid logical requests with a total conservative
liability no greater than USD 1, inside the already authorized shared policy.
Two child processes obtain independent reservations, then hold their original
Gateway responses before consumption. A third SDK call must be denied by the
real shared capacity check, make zero provider HTTP attempts, and honor its
two-second Retry-After across exactly three bounded SDK admission attempts.
This matches production PR #1783: temporary capacity returns local HTTP 429;
monetary, uncertain-admission and duplicate failures remain HTTP 402.
The first child drains its response; the second cancels after a real text delta
under controlled consumer bandwidth, forwarding original bytes unchanged.
Cancellation uses the installed OpenAI-compatible SDK against the same Gateway
and shared transport; that protocol exposes its generation ID in the first
content chunk. Completion and recovery use the Gateway SDK protocol. The prior
native SDK cancellation did not expose its generation ID before abort; those
two historical unknown liabilities remain fully retained and unclaimed as
reconciled. The Chat Completions cancellation must retain its generation ID
and full uncertain liability. A repeated
reservation must be denied without a provider attempt. A final fresh call must
complete and settle. All three generation IDs are checked against real receipts.

Holding original responses establishes overlapping shared admissions. It does
not establish simultaneous computation by the native provider or its sustainable
maximum. The evidence states this distinction explicitly.

Durable IDs are derived from the reviewed campaign and logical role, independent
of source SHA and workflow attempt. Existing records stop a repeated campaign;
changing code or re-running CI cannot silently spend again using those IDs.
Unknown charges are never refunded to make the test pass. No other reservation
is selected or changed. No credentials, prompts, or private model answers are
written to the artifact.

The real job runs only for the named verification branch or an explicitly
dispatched reviewed campaign. PR validation runs guards, compilation and the
existing isolated budget/SDK tests with no new paid calls. The workflow does
not run inference on routine main pushes.

## Scope of a passing result

The artifact separately records native budget availability. Missing management
credentials remain `UNOBSERVED`. Listing budgets is not proof of active-key
coverage or native enforcement. `item11_4Closed` and `item11_5Closed` remain false
until their remaining native-control requirements have separate evidence.

Native provider 429/retry-after behavior is not manufactured from local
capacity 429 or monetary 402 responses. Paid Gateway requests have no Gateway rate limit;
upstream provider limits still apply and require a suitable controlled test.

Official references:
- [Gateway rate limits and budget distinction](https://vercel.com/docs/ai-gateway/rate-limits)
- [Generation receipt lookup and asynchronous ingestion](https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api)
- [Database functions](https://supabase.com/docs/guides/database/functions)

The first real attempt completed two calls but did not finish the experiment.
A separate no-call diagnostic proved duplicate admission refusal. The next
reviewed campaign uses new fixed identities; old reservations and evidence remain.
The cancellation case paces original bytes so a buffered completion cannot
finish consumption before the consumer can abort. This does not claim that
provider computation or billing stopped at the time of consumer cancellation.
