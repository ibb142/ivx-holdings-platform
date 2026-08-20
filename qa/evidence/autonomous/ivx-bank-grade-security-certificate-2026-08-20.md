# IVX Bank-Grade Security Remediation — Evidence Record

**CERTIFIED: FALSE / UNVERIFIED**

Reason: production does not serve the final SHA, and several required gates
(Playwright, Maestro, Supabase advisor, live SQL privilege verification, live
registration/sign-in/wire E2E) did not execute in this environment. Per the
certification rule, any queued/skipped/unavailable gate forces CERTIFIED = FALSE.

---

## 1. Git state

| Item | Value |
|---|---|
| Branch | `security/bank-grade-hardening-2026-08-20` |
| Base SHA | `16e886c8ba86814e74a518a5e8b2d6d34dbfe7bd` |
| **Final SHA** | **`8a7a132a496e6157d5fe255533d9386ed8c6608c`** |
| Working tree at final SHA | clean |
| PR state | **none** — branch is local only; push to GitHub blocked (all 3 tokens revoked, HTTP 401) |
| Merged to main | **no** (not authorized) |

Starting state was `main`, clean. A feature branch was created before any write, per
the order's feature-branch-only constraint.

## 2. Files changed

```
A  backend/__tests__/ivx-bank-grade-security-contract.test.ts
M  expo/lib/wallet-service.ts
M  expo/metro.config.js
M  expo/package.json
M  package.json
M  bun.lock
D  .rork/history/**  (317 files)
D  .rork/plans/**    (1 file)
```

No unrelated work was overwritten; a test-artifact change to
`app-gate5-materialize-test/blueprint.json` was reverted rather than committed.

## 3. Vulnerability found and remediated — client-authored wallet ledger writes

**Severity: critical. Member wallet self-credit.**

Four functions in `expo/lib/wallet-service.ts` performed a client-side
read-modify-write of `wallets.available` / `.total` / `.invested`:

| Function | Old behaviour |
|---|---|
| `creditWallet` | RPC refused → client wrote `available + amount` directly |
| `debitWallet` | RPC refused → client recomputed and wrote balance |
| `processSaleCredit` | always client-side read-modify-write |
| `processWithdrawalDebit` | client-side balance check + write |

The failure mode is the important part: **the database hardening triggered the
vulnerability.** Revoking `EXECUTE` on `atomic_wallet_operation` from
`anon`/`authenticated` made the RPC refuse, and the fallback interpreted that refusal
as a reason to perform the write from the client instead — defeating the hardening.
A member could mint balance with no verified deposit.

All four now route exclusively through server-side atomic settlement and **fail
closed**. Sufficient-funds checks and balance arithmetic are server-authored;
client-side checks are advisory only.

## 4. Secret remediation — triaged individually, not blanket-untracked

Initial flagged set: **89 tracked files**. Every file was classified before action.

| Classification | Count | Action |
|---|---|---|
| Rork chat transcripts (`.rork/history`, `.rork/plans`) | 77 | **Untracked** — see proof below |
| Supabase **anon** key in source (public by design, RLS-protected) | 5 | **Kept tracked** — legitimate source |
| Test fixtures / documentation examples | 7 | **Kept tracked** — legitimate source |

**Proof justifying the untracking** — JWT payloads were decoded and only the `role`
claim inspected (never the token value):

- `service_role` JWT occurrences: **74 — all inside `.rork/history/`**
- `service_role` JWT occurrences in tracked source: **0**

A `service_role` key bypasses all row-level security. These are generated private
transcripts, not source, and independently proven to carry real credentials — which
is the condition the order requires before untracking. No legitimate source file was
untracked to force the gate green.

**Result: `secret_scan` → PASS, `matchedFileCount = 0`** on the final SHA. The 12
remaining flagged files are correctly classified as anon/fixture by the gate's own
classifier and remain tracked.

> **Rotation still required (owner action).** The 74 exposed `service_role`
> occurrences were pushed to a public repository. Untracking stops future exposure but
> does not invalidate what is already in git history. The Supabase `service_role` key
> must be rotated, and the three GitHub PATs are already revoked.

## 5. Wire destination integrity

| Check | Result |
|---|---|
| Alternate beneficiary in wire/payment code | **none** — only `IVX HOLDINGS LLC` |
| Third-party payment redirect (Stripe/PayPal/Venmo/Cash App) | **none** |
| Crypto addresses (EVM / BTC) | **none** in wire/payment code |
| Real routing/account numbers in shipped instructions | **none** — all bracketed placeholders |
| 9-digit routing-like values found | 4, all test fixtures or docs (`ivx-investor-protection.test.ts`, a `placeholder=` prop, an ECR URI example, and an audit note) |

## 6. Regression tests added — 19 tests, all passing

`backend/__tests__/ivx-bank-grade-security-contract.test.ts`

- **Credential containment (3)** — no `service_role` JWT in tracked source; no private
  key blocks; anon key must remain `anon` and never a stronger role.
- **Wire destination integrity (3)** — IVX-only beneficiary; no third-party payment
  redirect or crypto destination; no real routing/account in shipped instructions.
- **Wallet settlement safety (3)** — no client-authored balance write; no non-RPC
  fallback; no Expo runtime module invokes a service-role-only RPC.
- **RLS contract (3)** — RLS enabled on all member tables; every "own"-scoped policy
  bound to `auth.uid()`; no blanket `anon USING (true)` on member data.
- **Audit instrument integrity (4)** — fails if the fleet audit reverts to hardcoded
  pass **or** hardcoded fail; all three rejection controls preserved; role verification
  kept separate from engineering certification.
- **Approval gating (3)** — write/deploy tools stay approval-gated; money movement,
  trade and legal execution stay permanently prohibited; research-only agents hold no
  engineering tools.

Two of these tests initially failed against my own first draft. Both were defects in
the *test*, not the system — one matched SQL DDL text in an admin console screen
instead of a live RPC call, the other failed to resolve a spread in the gated-tool
list. Both were made **more** precise, not weakened.

## 7. Gate results on final SHA `8a7a132a`

| Gate | Result |
|---|---|
| Secret scan | **PASS** — `matchedFileCount = 0` |
| TypeScript (root, `tsc --noEmit`) | **PASS** — 0 errors |
| Expo static checks (tsc + lint + structure) | **PASS** — 0 errors |
| Backend unit tests | **PASS** — 2950 pass / 0 fail / 29 skip |
| Expo unit tests | **PASS** — 1245 pass / 0 fail |
| Security/privacy regression tests | **PASS** — 19 / 19 |
| Vendor independence gate | **PASS** — 12 / 12 |
| Playwright web E2E | **NOT RUN** |
| Maestro mobile E2E | **NOT RUN** — no runner available |
| Supabase security advisor | **NOT RUN** — no DB credentials in process env |
| Explicit SQL privilege verification | **UNVERIFIED** — see §8 |
| Registration / sign-in E2E (live) | **NOT RUN** |
| Wire E2E (live) | **NOT RUN** |

Two pre-existing regressions were found and fixed to reach green, neither caused by
this work: a missing `@supabase/supabase-js` dependency (37 backend failures) and the
build vendor reintroduced into `expo/package.json`, `node_modules` and
`metro.config.js` (4 expo failures). `metro.config.js` was rewritten self-contained,
zero vendor references.

## 8. What could NOT be verified, and why

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` are **absent from the
process environment** in this sandbox (they exist only as prose-polluted values inside
`expo/.env`). Therefore:

- No live `pg_proc` / `information_schema.role_routine_grants` query was executed.
- The `EXECUTE` grants on `ivx_query_auth_user_by_email`, `ivx_exec_sql` and
  `atomic_wallet_operation` are **NOT** confirmed against the live catalog.
- RLS `ENABLE` state and policy definitions on `investor_profiles`,
  `member_financial_summary`, `classification_audit`, `ivx_durable_documents` and
  `ivx_durable_events` are **NOT** confirmed against the live catalog.

What §7 proves is the **repository contract** — what the migrations declare and what
the shipped client code does. That is a real and permanent guarantee against
regression, but it is not a live-database proof and is not presented as one.

## 9. Production deployment state

| Item | Value |
|---|---|
| Service | `srv-d7t9ivreo5us73ftose0` (ivx-holdings-platform) |
| Latest deploy | `dep-da3gs36417fc73e9brtg` — status `live`, finished 2026-08-20T14:25:27Z |
| **Production SHA** | **`6ca1cd71f2b9602d079c141805f918279888e7da`** |
| Public URL | `https://ivx-holdings-platform.onrender.com` → HTTP 200 |
| **Serves final SHA?** | **NO** |

The wallet self-credit remediation is **committed but NOT deployed**. Production still
runs the vulnerable code. Deployment of `8a7a132a` requires the branch to reach GitHub
(auto-deploy is enabled on `main`), which is blocked on revoked tokens, and would
require owner authorization to merge.

## 10. Required owner actions

1. **Rotate the Supabase `service_role` key** — 74 occurrences were pushed publicly.
2. **Issue a new GitHub PAT** via the secrets channel (all three are revoked).
3. **Authorize merge** of `security/bank-grade-hardening-2026-08-20` to `main` — until
   then production runs the wallet self-credit vulnerability.
4. **Provide service-role DB credentials** to the execution environment if live SQL
   privilege and RLS verification is required for certification.
5. Consider making the repository **private** — the revoked tokens and the exposed
   `service_role` key remain readable in git history.

---

Nothing in this record was simulated. Gates that did not run are reported as not run.
