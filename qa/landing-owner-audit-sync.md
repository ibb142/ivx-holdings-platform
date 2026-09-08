# Private owner audit synchronization

This controller reads the owner-authorized work definition from an authenticated IVX structured audit set, verifies every item mapping, and submits one scoped low-risk repair at a time through the existing Senior Developer API. It preserves existing worker authorization, required CI, PR and deployment rules. QA-only items cannot change production records or sensitive infrastructure.

The public repository contains implementation code and synthetic contract tests only. The actual mission, historical findings, task receipts, progress and certificate references stay in the existing server-only durable document store. They are never committed to a GitHub branch, printed in workflow logs, written to step summaries, or uploaded as workflow artifacts by the sync job. A restart preserves the audit through the existing durable storage adapter. Database failures propagate instead of claiming a successful save.

`IVX_OWNER_AUDIT_ID` selects the authenticated set (the workflow has a fixed landing-audit default). Each native audit item has a JSON `verification` value containing its `definition` and `execution`. Item number 1 additionally contains `ownerAuditManifest` (mission metadata without the item array) and `missionState` (checkpoint metadata without the per-item execution map). The controller verifies all 144 mappings and all 112 lane owners before proceeding. Dates and the active owner priority policy bound new submissions and monitoring. Existing catalog rechecks continue in their assigned QA lanes.

An enqueue is persisted as SUBMITTING before the request. A matching job receipt is required for ACCEPTED. An unknown outcome is reconciled from recent jobs, and blocks new submissions until resolved. The job is polled by its actual ID; an unrelated job never counts toward the item. Failed or blocked jobs retain their exact private reason, and the controller advances to the next ordered eligible item. A completed code job is not a production certificate.

## Per-item certificate references

Only use artifacts whose creation and use are already authorized. Never copy the internal audit, credentials or user records to a public repository or public workflow output to satisfy a certificate. Store the following `proposedCertificate` reference inside the authenticated item's verification JSON:

```json
{"itemId":"IVX-LANDING-001","runId":123,"artifactId":456,"artifactSha256":"64 lowercase hexadecimal characters: SHA-256 of the downloaded artifact ZIP","reportPath":"item-report.json"}
```

The referenced test report must contain actual measured output:

```json
{"itemId":"IVX-LANDING-001","productionSha":"full live backend SHA","frontendVersion":"published frontend SHA for browser tests","startedAt":"UTC ISO timestamp","finishedAt":"UTC ISO timestamp","result":"PASS","command":"exact test command","exitCode":0,"assertions":[{"name":"specific assertion","status":"PASS","expected":"expected result","observed":"actual result"}],"repaired":true,"commitSha":"repair commit","prUrl":"actual PR URL","deployId":"actual deployment ID","postDeployPass":true}
```

The controller verifies artifact/run linkage and SHA-256, reads only the named JSON entry, requires every assertion to pass, and checks current production identity. Browser reports also need an independently published frontend version. A report from before this mission cannot issue a new certificate. The final certificate also requires all other item certificates. These checks attest to the declared test scope; reviewers must verify that the assertions cover the item's acceptance criteria.

Run `node --test qa/landing-owner-audit-sync.test.mjs qa/landing-owner-audit-store.test.mjs`. Tests use synthetic data and a mocked durable adapter. Production synchronization is proven separately by private API readback, worker receipts and durable records.
