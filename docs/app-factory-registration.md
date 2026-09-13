# App Factory: registration contract

This change registers a four-track application plan. It does not start code
generation agents, provision infrastructure or certify delivery in 10–30 days.
The existing coder factory and campaign dispatcher remain the execution systems.

## Server API

```ts
import { AppFactoryEngine } from '../services/app-factory-engine';

const engine = new AppFactoryEngine();
const result = await engine.submitAppBuildTarget(command.appName, command.days, {
  requestId: command.requestId, // a UUID persisted with the original owner command
  ownerId: authenticatedOwner.id, // from the verified server auth context
  instructions: command.instructions,
});
```

The caller must authenticate the owner before invoking the service. There is no
new public endpoint in this change. Reuse the same UUID after a timeout or lost
response. Reusing it with another owner, name, duration or specification raises
`FACTORY_REQUEST_CONFLICT`. A new UUID is a new build request.

The default connection comes from the existing bounded worker pool. An explicit
pool may be injected for a separately configured environment. The service never
creates one connection per agent or closes a pool owned by the application.
New tables in the current database are logical separation, not separate compute.

Apply the generated registration migration through the normal reviewed migration
pipeline before using this API. Anonymous and authenticated Data API roles have
no privileges on the two tables. The backend service role has SELECT and INSERT
only; registration cannot mark a task BUILDING or VERIFIED.

## Transaction and retry behavior

The transaction creates one immutable request record and four tasks: DATABASE,
BACKEND, FRONTEND and QA. PostgreSQL computes the deadline once. A failure before
commit rolls back the whole plan. A lost commit acknowledgement returns an
explicit unconfirmed error; retrying the same request retrieves the stored plan.
There is no automatic mutation replay or false success log.

Full UUID-based task identities and `(request_id, component_type)` uniqueness
replace truncated random suffixes. Existing task states and deadlines are
preserved on a retry. Missing stored components cause an incomplete-plan error;
registration does not silently recreate failed or deleted work.

The payload records the dependency graph: DATABASE → BACKEND → FRONTEND; QA
depends on all three. These are planning references. The future dispatcher bridge
must enforce them; writing them into JSON does not provide scheduling enforcement.

The queue index orders by an explicit priority expression, creation time and
task ID. A future consumer must use the same ordering. No latency guarantee is
inferred from creating an index.

## Existing activation correction

The legacy activation path recognized an agent ID and name, then reported
security, QA and supervised work as verified without execution artifacts.
It now returns BLOCKED for those unverified checks and records no fictional
tool use. Failed or malformed roster reads remain unavailable instead of becoming
successful empty lists. This does not deactivate existing rows or change their
stored history. A real verifier is required to enable new verified activation.

## Verification

```sh
bun test backend/services/app-factory-engine.test.ts
bun test backend/services/ivx-factory-activation.test.ts
bun test qa/app-factory-registration.test.ts
bun qa/app-factory-concurrency.ts
```

The SQL contract uses isolated PGlite, located through `IVX_PGLITE_MODULE`.
It covers rollback of the fourth component, lost commit acknowledgement,
idempotency conflicts, terminal-state preservation and role grants.

The concurrency proof requires a fresh PostgreSQL database named
`ivx_factory_test` on loopback through `IVX_FACTORY_TEST_DATABASE_URL`. It runs
100 identical submissions, then 100 distinct submissions, and requires exactly
101 requests and 404 queued tasks. It creates no model calls. That is a
registration-concurrency proof, not a 100-agent code-generation benchmark.

## Work required for an operating factory

1. Bind authenticated owner commands and persisted request UUIDs to this API.
2. Bridge each registered component to exactly one native worker job, preserving
   task/job/commit evidence across retries and restarts.
3. Enforce dependency completion, leases, process fencing, retry limits,
   cancellation and emergency stop through the execution system.
4. Create actual isolated workspaces per attempt and integrate artifacts from a
   verified common base. A workspace key is not a filesystem sandbox.
5. Reserve provider budget atomically before calls; preserve and reconcile
   uncertain charges. Agent inventory is separate from inference concurrency.
6. Bind real permission checks, test logs, artifacts and exact commit identity
   to activation and completion. Never turn a stored PASSED flag into evidence.
7. Require approved CI and owner deployment authorization before production.
8. Measure registration/claim latency under representative load, demonstrate
   parallel real work, crash recovery without duplicate effects and 24-hour
   operation before making those claims.
