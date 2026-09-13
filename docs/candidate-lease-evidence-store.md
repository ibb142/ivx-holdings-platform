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

Use the existing worker's identity with `acquireLock`, retain its returned token,
then pass the same event/version to `saveCandidateWithLease`. The service is an
internal persistence component; adding it does not start 112 workers or wire a
new learning pipeline. Existing learning stores are not replaced by this patch.

The CI suite uses isolated PostgreSQL 17 and separate connections to exercise
claim and save races. The optional PGlite local run omits multi-connection tests.
The lease primary key already indexes event lookup; an extra event/token index
would be redundant. Query plans are measured with 10,000 retained leases. A
fast indexed lookup alone does not certify all end-to-end requests below 50 ms.

References: [PostgreSQL INSERT](https://www.postgresql.org/docs/17/sql-insert.html),
[PostgreSQL CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html).
