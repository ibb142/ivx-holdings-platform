# Candidate lease and evidence store

`CandidateStore` uses the existing `pg` repair pool and transaction deadline
helper. It does not create a new pool or rely on ambient PG defaults. Each method
calls one PostgreSQL function; the database controls the complete mutation and
its clock. Connection, statement and lock deadlines remain bounded by the
existing pool configuration. An uncertain commit response is never retried
automatically or reported as a confirmed success.

An event has one active lease. An expired lease can be reacquired at the same or
a higher version, but versions never decrease. A strictly higher version may
preempt an active older version. Every save checks event, owner, token, version
and database expiry after locking the row, and checks expiry again immediately
before recording completion. Callers must supply the event's authoritative
version; this internal API is not an authorization endpoint for end users.

Candidate insertion and lease completion are atomic. The first candidate is
immutable. The original owner/token can repeat the identical completed payload
and receive `duplicate: true`; a different payload is rejected. Candidate status
remains `CANDIDATE`, not verified or certified. This store does not promote
hypotheses into active lessons or certify agents.

Candidates and phase failures have independent retention, with no cascade from
leases. A retained candidate also prevents reacquisition after administrative
lease cleanup. The backend role may append and read evidence but cannot update
or delete it. All three tables have RLS and explicit grants; public and ordinary
authenticated users cannot access them or execute these functions. Database
administrators remain privileged and are outside the worker fencing boundary.

`recordPhaseFailure(eventId, phase, reason, attempt)` records an explicit attempt
and safe reason code. Callers must check its acknowledgement. No component can
promise a durable failure log while the database itself is unavailable; the
adapter returns the actual failure without recursively trying another write.

The production senior worker now calls `persistCoderCandidate` after an actual
autonomous-coder result, before storing its final job receipt. It requires a
fenced worker identity, agent identity, inspected source files, a full starting
SHA, a diagnosis and a proposed technical plan. An incomplete proof is explicitly
`NOT_APPLICABLE`; no placeholder lesson is manufactured.

The bounded runner protects only this candidate-evidence phase with a 30-second
lease. Long code execution retains the existing primary queue lease, heartbeat,
emergency-stop and owner gates. The candidate callback checks that primary
authority again. The candidate event hashes job ID, persisted attempt, agent and
source SHA; it is immutable at candidate version 0. That version is not the
primary queue's fencing version. Candidates remain unverified hypotheses.

The job result's `candidateEvidence` receipt distinguishes `COMMITTED`,
`CONTENDED`, `ALREADY_RECORDED`, `FAILED` and `NOT_APPLICABLE`. It preserves any
failure-journal rejection and unknown commit outcome without rerunning code,
changing a real deploy outcome or claiming a successful evidence write. Late
callback results after timeout cannot save. No tokens are logged. Existing
learning stores are not replaced and no automatic promotion is introduced.

The dashboard reconnects stalled sockets and ignores late messages from retired
connections. Retained rows stay visible; evidence still expires after 15 seconds
and must match the dashboard's backend SHA. A successful socket authentication
alone is not a live snapshot. Recovery must be demonstrated against production;
local transport tests do not prove the database has recovered.

Run `node scripts/ops/audit-112-fleet-activity.mjs` with the backend's existing
`SUPABASE_DB_URL` (or `DATABASE_URL`). This read-only audit reports current lease
holders and tasks separately from registry heartbeats. It measures full timestamp
age, including hours. Incomplete observations fail with a nonzero exit. It does
not evaluate productive evidence or hours and leaves those counts null.

The proposed production role/index SQL is unnecessary for the audited schema:
`authenticated` already has a 15-second statement timeout, `anon` has 3 seconds,
and `anonymous` does not exist. The 112 registry rows use `active`, not `RUNNING`;
current work comes from the task lease table. No role settings or indexes are
changed by this patch. Any future concurrent index must be outside a transaction
and justified by the actual query plan.

The existing deployment governor keeps its real SHA, health and inference
checks, now with bounded requests and an artifact identifying the failing
stage. Chat POST requests are not retried. The separate live-status workflow's
failure description refers to the complete verification, including telemetry,
instead of declaring that every failure is a SHA mismatch.

The CI suite uses isolated PostgreSQL 17 and separate connections to exercise
claim and save races. The optional PGlite local run omits multi-connection tests.
The lease primary key already indexes event lookup; an extra event/token index
would be redundant. Query plans are measured with 10,000 retained leases. A
fast indexed lookup alone does not certify all end-to-end requests below 50 ms.

References: [PostgreSQL INSERT](https://www.postgresql.org/docs/17/sql-insert.html),
[PostgreSQL CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html).
