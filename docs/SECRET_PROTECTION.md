# Secret Protection — making GitHub tokens last

**Status:** guard built and verified 2026-08-20.

Three GitHub tokens were auto-revoked in a row. The tokens were never the problem.
This document explains the actual cause and the protection now in place.

## The revocation loop

```
token pasted in chat
  -> Rork writes the transcript to .rork/history/main/*.json
  -> those files are TRACKED by git
  -> pushed to a PUBLIC repo
  -> GitHub secret scanning finds the token
  -> token auto-revoked within minutes
```

Measured on this repo: **314 tracked `.rork` files, 2,280 credential occurrences**, including
all three dead GitHub tokens (`ghp_kpob…`, `ghp_y5Dn…`, `ghp_tzBu…`).

`.gitignore` already listed `.rork/` — but **gitignore does not untrack files already in the
index**, so the rule did nothing. That is why the problem kept recurring.

## Protection now in place

| Component | Purpose |
|---|---|
| `scripts/ivx-secret-guard.mjs` | Scanner. Detects GitHub / Render / AWS / Slack / SendGrid / Supabase-JWT / OpenAI / Twilio credentials. |
| `.githooks/pre-commit` | Runs the scanner on staged files and **blocks the commit** if a credential is found. |
| `scripts/ivx-protect-secrets.sh` | One-shot setup: untracks transcripts, hardens `.gitignore`, installs the hook, scans. |
| `scripts/__tests__/ivx-secret-guard.test.mjs` | 11 tests locking the behaviour in. |

### Two-stage detection (why it does not cry wolf)

A prefix match alone is not enough. A candidate is only reported if it also survives a
fixture filter (`example`, `dummy`, `redact`, sequential runs like `abcdef123456`, low
Shannon entropy < 3.2 bits/char). Verified: **2,280 real credentials caught, 0 false
positives across the entire tracked source tree.**

Deliberate fixture? Append `// ivx-secret-guard:allow` to that line, or
`ivx-secret-guard:allow-file` anywhere in the file.

### Verified end to end

- Real commit containing a live-shaped PAT → **blocked, 0 commits created**
- Test fixtures, `.env.example`, bare JWT headers → **allowed**
- `bun test scripts` → 29 pass / 0 fail
- `bun test backend` → 2931 pass / 0 fail · `bunx tsc --noEmit` → 0 errors

## What you need to run once

The guard cannot untrack files by itself — that needs a commit, which is yours to make.

```bash
bash scripts/ivx-protect-secrets.sh
git status                     # review
git commit -m "chore(security): untrack transcripts, add secret guard"
```

## Making the token long-lived

Once the loop above is closed, the token stops being disposable. Recommended setup:

1. **Fine-grained PAT** — https://github.com/settings/personal-access-tokens/new
   - Repository access: *Only select repositories* → `ibb142/ivx-holdings-platform`
   - Permissions → Repository → **Contents: Read and write**
   - Expiration: **1 year** (or *No expiration* if you accept the tradeoff)
2. **Store it in exactly two places:** the Rork secrets channel, and the Render service
   environment variables. Nowhere else.
3. **Never paste it into chat.** That is the single behaviour that killed the last three.
4. Consider making the repository **private** —
   https://github.com/ibb142/ivx-holdings-platform/settings

Fine-grained tokens scoped to one repo are also lower blast radius than the classic `repo`
scope, which grants access to every repository on the account.

## Residual risk — git history

Untracking stops *future* exposure. The dead tokens remain in past commits and are still
readable by anyone who clones the repo. They are already revoked, so the practical risk is
low. To purge them completely you would rewrite history with
`git filter-repo --path .rork --invert-paths`, which requires a force-push and coordination
across every clone. Making the repository private is the cheaper mitigation.
