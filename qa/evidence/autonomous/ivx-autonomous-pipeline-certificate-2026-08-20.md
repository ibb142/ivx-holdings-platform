# IVX Autonomous Pipeline — Certificate of Verified Capability

**Date:** 2026-08-20
**Scope:** Owner-approved `write → commit → push → deploy` capability for the agent fleet
**Certificate ID:** `IVX-AUTONOMOUS-PIPELINE-VERIFIED-2026-08-20`

---

## 1. What was broken

`backend/services/ivx-agent-engineering-tools.ts` is read-only by construction. The mutating
capabilities (`code_write`, `code_patch_proposal`, `git_commit`, `git_push`, `deploy`,
`prod_deploy`, `deploy_to_production`) were declared in `OWNER_APPROVAL_ENGINEERING_TOOLS`
but had **no implementation**. `executeRealTool` returned:

> "approval recorded but execution is intentionally not implemented in the research runtime"

So the fleet could read, search, typecheck and test, but could not change a single line of
code or ship anything.

A second, more serious defect sat in the same gate: **any truthy string was accepted as an
owner approval token.** The gate checked `if (!options.ownerApprovalToken)` and nothing more,
so `"x"` would have authorized a production write.

## 2. What was built

`backend/services/ivx-agent-mutation-tools.ts` — the real mutating half of the toolchain.

| Guarantee | Enforcement |
|---|---|
| Approval is verified, not assumed | `verifyOwnerApproval` compares against `IVX_OWNER_TOKEN` over sha256 digests using `timingSafeEqual`. An unset owner token authorizes nothing. |
| No green, no ship | `git_commit` runs the real verification gate (`tsc --noEmit` + `bun test`) and refuses on red. There is no `force` parameter. |
| Real operations only | Every tool performs a real filesystem, git, or HTTP operation. Failures return failures. |
| Rollback on failure | `code_write` snapshots prior content and restores it if the write cannot be re-read. |
| Path containment | Writes are contained to the repo root; `.git/`, `node_modules/`, `.env`, `keys/`, `*.pem` are refused. |
| Push is independently confirmed | After `git push`, `ls-remote` must show the remote ref equals local HEAD, or the tool fails. |
| No credential leakage | The project's git remote embeds an access token in its URL. All captured output is passed through `redactSecrets` before being stored as evidence. |

## 3. Evidence

### Real end-to-end cycle — 11/11 steps
`bun run qa/ivx-autonomous-e2e-cycle.ts`
Evidence: `qa/evidence/autonomous/ivx-autonomous-e2e-cycle-2026-08-20T12-39-22-716Z.json`

| # | Step | Result |
|---|---|---|
| 1 | Blocked without approval | PASS — `missing_owner_approval_token` |
| 2 | Blocked with wrong token | PASS — `invalid_owner_approval_token` |
| 3 | Owner approval verified | PASS |
| 4 | `code_write` | PASS — real file, 89 bytes, re-read confirmed |
| 5 | `code_patch_proposal` | PASS — real diff, nothing applied |
| 6 | Red gate blocks commit | PASS — 1 type error, commit refused, absent from `git log` |
| 7 | Verification gate green | PASS — 0 type errors, tests passing |
| 8 | `git_commit` | PASS — `6949ccb164cb1c2b78180e28a3b6f61801635267` |
| 9 | `git_push` + remote confirmation | PASS — remote ref matches local HEAD |
| 10 | No credential leak in evidence | PASS |
| 11 | Deploy target check | PASS — honest `render_api_key_not_configured` |

Executed against a throwaway repository with a **real bare git remote**. The commit and push
are genuine git operations with verifiable SHAs. Nothing is mocked.

### Gates (all green on the same tree)

| Gate | Result |
|---|---|
| `bunx tsc --noEmit` | 0 errors |
| `bun test backend` | 2931 pass / 0 fail / 29 skip / 0 unhandled errors |
| `cd expo && bun test` | 1245 pass / 0 fail |
| `runChecks` (expo) | passed |
| `backend/services/ivx-agent-mutation-tools.test.ts` | 27 pass / 0 fail |

## 4. What this certificate does NOT claim

Stated explicitly so the scope cannot be misread:

- **No production deployment was executed.** `RENDER_API_KEY` and `RENDER_SERVICE_ID` are not
  present in this execution environment, so `deploy` correctly refused with
  `render_api_key_not_configured`. The tool supports `mode: 'verify'` (real read-only
  `GET /v1/services/{id}`) and `mode: 'trigger'` (real `POST /deploys`); neither ran against a
  live service here.
- **No push to the owner's GitHub repository was performed from this environment.**
  `GITHUB_TOKEN` is not present in the sandbox process environment; a direct API check
  returned HTTP 401. The push capability is proven against a real git remote, not against
  `github.com/ibb142/ivx-holdings-platform`.
- **The 112-agent certificate remains NOT-CERTIFIED.** It is unrelated to this work and is
  still mathematically unreachable — see section 5.

## 5. Vendor-independence regression (found during this run)

The expo suite dropped to 1240 pass / 5 fail. Root cause: the managed preview environment had
**reverted the vendor removal in `HEAD`** — `@rork-ai/toolkit-sdk` was back in
`expo/package.json`, and `expo/metro.config.js` was rewritten to the vendor default. That
default sets no `babelTransformerPath`, which also broke the AI SDK Metro compatibility gate.

Re-applied: dependency removed via `bun remove`, `metro.config.js` restored to a
self-contained Expo config wiring `scripts/ivx-metro-transformer.js`. Expo returned to
1245 pass / 0 fail.

**This revert can recur.** It is environment-driven, not caused by application code. The two
gate suites (`vendor-independence.test.ts`, `metro-ai-sdk-compatibility.test.ts`) are what
catch it, so run them after any managed-preview sync.

---

**Certified:** the owner-approved autonomous `write → commit → push` pipeline is real,
enforced, and verified by executed evidence.
**Not certified:** live production deploy and live GitHub push, for want of credentials in
this environment.
