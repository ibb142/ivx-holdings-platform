# IVX Credential Verification — GitHub & Render

**Date:** 2026-08-20
**Question:** Can the autonomous pipeline push to `ibb142/ivx-holdings-platform` and deploy to Render from this environment?
**Answer:** No. Both credential sets are non-functional. Root cause identified below.

---

## 1. Correction to the previous report

The earlier certificate stated `GITHUB_TOKEN` was "unset". That was **incomplete**: only the
shell process environment was checked. The tokens *are* present in `expo/.env` and
`android-ivx-holdings/.env`. They were located and tested directly.

## 2. GitHub token — REVOKED

| Check | Result |
|---|---|
| Present in `expo/.env` | Yes |
| Format | Valid classic PAT, 40 chars, `ghp_` prefix, charset OK |
| `GITHUB_TOKEN` vs `RORK_PUBLIC_GITHUB_TOKEN` | Byte-identical (same token) |
| `GET /user` | **HTTP 401 — "Bad credentials"** |
| `GET /repos/ibb142/ivx-holdings-platform` | **HTTP 401 — "Bad credentials"** |
| `git push --dry-run` to the real repo | **`remote: Invalid username or token.`** |

### False positive ruled out
`git ls-remote` against the real repo **succeeded** and returned live refs
(`HEAD = 6ca1cd71f2b9...`). This does **not** indicate a working token. The same command run
with a deliberately invalid garbage token also succeeded — the repository is **public**, so
`ls-remote` requires no authentication. Read access proves nothing about write access. The
authenticated `push --dry-run` is the decisive test, and it failed.

## 3. Root cause — the token leaked into the repo and was auto-revoked

`.rork/history/main/` contains the Rork conversation transcripts. **306 of these files are
tracked by git**, and several contain the token in plaintext:

```
HEAD:.rork/history/main/00msy1s8ff001_...assistant.json : 1 match
HEAD:.rork/history/main/00msy5wfse000_...assistant.json : 3 matches
HEAD:.rork/history/main/00msy6iqgb000_...assistant.json : 5 matches
```

Commits carrying it include `72b8479fe` (2026-08-20), `642378f38` and `70631842e` (2026-08-19).

The repository is public. GitHub secret scanning detects classic PATs pushed to public
repositories and **revokes them automatically**. That is precisely the observed state: a
well-formed token that GitHub refuses.

### Why re-sharing the token in chat cannot fix it
This is a loop, not a one-off:

```
token pasted into chat
  -> transcript written to .rork/history/main/*.json
  -> those files are tracked and committed
  -> pushed to the PUBLIC repo
  -> GitHub secret scanning revokes the token
  -> token returns 401
```

`.gitignore` does list `.rork`, `.rork/history/`, and `.rork/plans/` (lines 4-7) — but
**gitignore does not untrack files that are already tracked**. The 306 files remain in the
index, so the ignore rules have no effect on them. Any new token pasted into chat will be
committed and revoked the same way.

## 4. Render credentials — placeholders, not keys

Values in `expo/.env` are descriptive text, not credentials:

| Variable | Length | Assessment |
|---|---|---|
| `RENDER_API_KEY` | 44 | Begins with the literal text `Render ` — placeholder |
| `IVX_RENDER_API_KEY` | 44 | Begins with the literal text `Render ` — placeholder |
| `RENDER_SERVICE_ID` | 1058 | 1058 characters of prose; a real service ID is ~30 chars (`srv-...`) |

The `deploy` tool's refusal with `render_api_key_not_configured` is therefore **correct
behaviour**, not a defect.

## 5. Required to unblock

1. **Rotate the GitHub token** — the current one is dead and cannot be revived. Prefer a
   fine-grained PAT scoped to `ibb142/ivx-holdings-platform` with Contents: Read and write.
2. **Deliver it through the secrets channel, never in chat** — otherwise the leak/revoke loop
   repeats.
3. **Stop tracking the transcripts** — `git rm -r --cached .rork/history` so the existing
   `.gitignore` rules take effect. Until this is done the repo keeps publishing its own chat
   history. Consider making the repository private as well.
4. **Supply real Render values** — an `rnd_...` API key and an `srv-...` service ID.

Steps 1-3 are the prerequisite. Without them any new token has a short life.

---

**Verified state:** pipeline logic proven (11/11 E2E, real commit + push to a real remote);
live GitHub push and live Render deploy remain **NOT EXECUTED** for want of valid credentials.
No part of this was simulated.
