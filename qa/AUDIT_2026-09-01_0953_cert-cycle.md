# QA Audit — 2026-09-01 09:53Z (112 IA Global Certification cycle)

## Mission
15/15 GREEN Global Certification on ibb142/ivx-holdings-platform (MAIN == PRODUCTION SHA),
followed by Phase 2 (landing QA + App Factory + 112 IA finishing IVX Holdings).

## State at this audit
- GitHub main: d179e9011441 (owner PRs #672 OIDC allowlist, #674 runtime continuity refill, #679 OIDC refresh + tail retry merged).
- Render backend: new GITHUB_TOKEN added to runtime env (owner commit a0061b7a8); owner-approved GitHub write endpoints available at /api/ivx/developer-deploy/action (bearer-gated).
- Cert fixes staged in workspace (reels Chrome-channel visual gate + dynamic APK upload) — verified present in mirror main 3302a470d, missing on GitHub main; this sync re-lands them.
- Worker Cert step 07 failures root-cause candidates: throttled tail agents (fixed by #679), per-agent evidence contract.

## Gates monitored on d179e9011 (as of 09:47Z)
- QA Suite #2385: failure (parity race — prod was 20327662 at run time; re-run required post-parity)
- War Room #406: failure (same parity race window)
- Worker Cert #722, Reels #951, Render Live #958, Auto-Deploy #206, E2E #2656, 4-Phase #210: in progress
- Prod: 20327662 boot 09:46:13Z; auto-deploy #206 deploying d179e9011

## Fail-closed rule
No gate is marked GREEN without RUN_ID + SHA + deploy/E2E evidence on the exact certified SHA.
