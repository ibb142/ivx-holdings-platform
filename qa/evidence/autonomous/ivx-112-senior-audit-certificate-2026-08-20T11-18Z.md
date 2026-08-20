# IVX 112-Agent Senior Developer Audit — Certificate

**Verdict: NOT-CERTIFIED**

- **Requested:** `IVX-112-SENIOR-DEVELOPER-10OF10-CERTIFIED`
- **Issued:** No
- **Audit SHA:** `c0533e74aefd6139e31380541c6881773b2835d2`
- **Recorded:** 2026-08-20T11:18:37Z
- **Evidence:** `qa/evidence/autonomous/audit-2026-08-20T11-18-37-034Z/` (112 agent files + summary)
- **Method:** `bun run qa/ivx-112-senior-audit.ts` — executes the real engineering tools, records only actual results

> Append-only. No prior certificate or agent evidence file was modified or overwritten.
> This file was written under the owner's explicit request for a certificate.

---

## Result

| Metric | Required | Actual |
|---|---|---|
| `acceptedBySeniorGate` | 112 / 112 | **0 / 112** |
| Workflows green on same SHA | 6 | **0** |

**Failing agents: ALL, 1 through 112.**

## Shared gates — all three RED

| Gate | Result | Detail |
|---|---|---|
| typecheck | **FAIL** | 2 errors (`TS2688` missing `bun` / `node` type defs) |
| tests | **FAIL** | 35 unique failing test names (counters 2359 pass / 57 fail) |
| secret_scan | **FAIL** | 79 files matched (names only) — all under `.rork/history/**`, **0 in application source** |

Both typecheck and test failures are **pre-existing** and unchanged by this session — proven by stashing the session's files and re-running: 2 tsc errors before and after, 35 failing test names before and after.

## Why every agent was rejected

**50 engineering-remit agents** — did produce real tool evidence (`local-exec://code_search…`, sha256 `628e962b5612…`), but rejected for:
- all three shared gates red
- `no_authored_changedFiles` — no reviewed code change authored in this window

**62 research-only agents** — rejected additionally for `no_engineering_capability`: their tool set cannot produce code, tests, typecheck or deployment evidence.

---

## What IS genuinely true

The engineering tools are **real and tested** — 21/21 pass, 57 assertions, module under test not stubbed. `code_read`'s sha256 is compared against an independent filesystem read, so a fabricating tool would fail. Path containment rejects absolute paths and `../` traversal.

- **Read-only, implemented:** `code_read`, `code_search`, `typecheck`, `run_tests`, `lint`, `secret_scan`
- **Owner-approval gated:** `code_write`, `code_patch_proposal`, `git_commit`, `git_push`, `deploy`, `prod_deploy`, `deploy_to_production`

**Building the capability is not the same as the fleet using it.** No agent has authored a reviewed change through these tools. That is why the count is 0, not 112.

## Claims refused

- **"112 senior developers, 10/10, end to end"** — 0/112 pass. Beyond the count, "10/10 senior developer" has no executable assertion. Even at 112/112 the honest statement would be *"112 agents produced verifiable typecheck/test/lint/secret-scan evidence on SHA X"* — a fact, not a grade.
- **"IVX IA chat at ChatGPT parity"** — no test can prove parity with another company's model.

---

## Security incident — caused by the agent, not the fleet

**Severity: HIGH.** A redaction pattern matched *past* a token instead of over it, printing a **live GitHub App installation token** in plaintext in chat. That transcript was saved to `.rork/history/main/**` — tracked in git — and pushed to GitHub in branch `rork-agent-engineering-tools` at commit `e602dee1`.

**Detected by the `secret_scan` gate built in this same session**, during this audit, before any further push. The gate failing is what caught it.

- Token type: GitHub App installation token, 1-hour lifetime
- Issued `2026-08-20T11:02:22Z` → expires `2026-08-20T12:02:22Z`

**Remediation applied:**
1. Remote branch `rork-agent-engineering-tools` **deleted** from `ibb142/ivx-holdings-platform`; verified via `git ls-remote` returning empty.
2. Subsequent deploy excludes `.rork/history/**` entirely.
3. Token is short-lived and Rork-rotated hourly.

**Owner action:** treat the token as compromised. It expires on its own at 12:02:22Z, but force rotation if you can.

*This is the second time in this engagement the agent printed a secret while running a command intended to redact secrets.*
