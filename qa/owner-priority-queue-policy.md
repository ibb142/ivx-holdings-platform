# IVX Owner-Controlled Priority Queue

Status: REQUIRED ENTERPRISE POLICY

## Control invariant
The queue never owns the mission. The Owner/Autonomous control plane owns the queue.

## Priority classes
- P0-OWNER: explicit owner mission. Preempts lower-priority autonomous work.
- P1-RELEASE: production blocker for the active owner mission.
- P2-RECOVERY: worker/agent recovery required to keep P0/P1 moving.
- P3-QA: validation/regression for the active owner mission.
- P4-BACKGROUND: scheduled maintenance, reports, experiments, and non-blocking work.

## Landing emergency mission
Until Landing is complete, the canonical ordering is:
1. P0-OWNER: Landing completion and owner-requested fixes.
2. P1-RELEASE: Landing deploy, E2E, production parity, broken conversion paths.
3. P2-RECOVERY: revive/reassign idle or failed 112 agents and Autonomous workers.
4. P3-QA: Landing QA/certification.
5. P4-BACKGROUND: all unrelated regression, factory, research, and maintenance jobs.

## Scheduler behavior
- A new P0 owner mission may cancel superseded P3/P4 runs.
- A P0 mission must not wait behind an older P3/P4 run for the same control lane.
- Duplicate runs for the same mission+SHA collapse into one lane.
- P1/P2 work is attached to the active P0 mission rather than creating competing top-level lanes.
- Background schedules must yield while an owner mission is active.

## Completion rule
The control plane is healthy only when the owner can change priority without editing code and the active mission can preempt lower-priority queue items automatically.
