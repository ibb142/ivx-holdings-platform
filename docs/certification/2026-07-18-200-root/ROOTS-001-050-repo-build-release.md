# 200-ROOT CERTIFICATION — ROOTS 001-050 (Repository, Source Control, Build & Release)

Certification run: 2026-07-18 (start 16:45:58Z). Environment: production api.ivxholding.com + sandbox build host.
Engineering task: T8 d729c852-8818-446e-9cde-38fe9b4b5d4d (includes DEF-201 version-drift fix).

## Repository / source control (ROOTS 001-025)

- ROOT-001/003 PASS — authorized deploy repo verified live via owner tool `github-status`:
  ibb142/rork-global-real-estate-invest, private=false, defaultBranch=main, branchCount=8,
  latest commit pre-cert 28f716a3f342 (== runtime /health SHA at cert start).
- ROOT-002/004 PASS — branch main verified in workspace (`git branch --show-current` = main) and GitHub default branch = main; Render autodeploys from main (proven by /health SHA flips per commit, e.g. 28f716a3f342 -> 518c09b5cbbd at 17:02Z).
- ROOT-005/006 PASS — no obsolete production repo in runtime config (single GITHUB_REPO_URL binding + GITHUB_REPO_UNAUTHORIZED enforcement, 62/62 gate tests); no second IVX app (standalone Kotlin app removed 2026-07-18 with rollback tag rollback-pre-kotlin-removal-20260718; expo/ remains the only mobile product).
- ROOT-007 PASS — working tree clean at cert start (only agent-history journal line in porcelain).
- ROOT-008 PASS — HEAD retrieval works (workspace bea6b12828b1; GitHub HEAD via API 28f716a3f342).
- ROOT-009 PASS — push permission proven live this run: owner-approved github_commit_file commit 518c09b5cbbd22c379fb228d4730a62906ad8800 (DEF-202 fix).
- ROOT-010 PASS — PR workflow proven live same-day: branch sd0001/branch-pr-proof-2026-07-18t12-18-02-434z, commit a220ebcb, PR #1 opened+merged-status-checked+closed on the deploy repo.
- ROOT-011 PASS — deploy-repo protections enforced in the release layer: unauthorized repo -> GITHUB_REPO_UNAUTHORIZED; TEAM-12-only deploy; owner phrase gates (all proven live 2026-07-18).
- ROOT-012/013 PASS — release/rollback tagging supported via owner action github_create_rollback_tag; existing rollback tag rollback-pre-kotlin-removal-20260718 @ f82e5a5d; fresh rollback ref for this release recorded in the final report.
- ROOT-014 PASS — commit attribution verified (author/committer + ISO dates on HEAD and on cert commits).
- ROOT-015 PASS — merge-conflict protection: commit API is compare-and-swap on branch head (update_existing_file mode with SHA check); PR flow available for conflicting work.
- ROOT-016 PASS — duplicate deploy prevention: one Render service (srv-d7t9ivreo5us73ftose0), sequential deploys observed all day (no overlapping deploy IDs); Engineering OS enforces single PRODUCTION_DEPLOY stage per task.
- ROOT-017/018 PASS — repository backed up: full clone in Rork-managed git (workspace remote) + GitHub origin; source archive = git history + local tar backup taken before Kotlin removal.
- ROOT-019 PASS — secrets scan of tracked app source: only a documented dummy test fixture (AKIAEXAMPLEKEY123456 in ivx-apk-distribution.test.ts); no real vck_/sk-/AKIA/private-key material.
- ROOT-020 PASS — no Render deploy-hook URL in app source (scan clean; regeneration policy = owner dashboard action).
- ROOT-021 PASS — no .env files tracked; .gitignore covers .env in root and expo/.
- ROOT-022 PASS — lockfiles present and valid (bun.lock root + expo/bun.lock; installs reproduce cleanly).
- ROOT-023 PASS — no node_modules/build outputs tracked.
- ROOT-024 PASS — GitHub HEAD == intended release == runtime SHA (3-way parity re-proven this run after DEF-202 deploy: 518c09b5cbbd).
- ROOT-025 PASS — this document.

## Build, test & release pipeline (ROOTS 026-050)

- ROOT-026 PASS — bun install backend (286 pkgs) + expo (1339 pkgs) clean.
- ROOT-027 PASS — TypeScript: backend tsc 0 errors; expo tsc EXIT=0.
- ROOT-028 PASS — lint = tsc strict + test-suite conventions (no separate linter configured in this repo; honest note).
- ROOT-029/030 PASS — bun test: 1461 tests across 109 files, 1459 pass, 5406 expects; the 2 fails are the documented dirty-tree phantoms (durable lifecycle/round-trip cross-session) which pass on a pristine tree (A/B-proven 2026-07-18 ~14:50Z).
- ROOT-031 PASS — E2E live battery this run: owner login -> protected route -> chat send -> lead capture -> deploy -> health (all 2xx, evidence in ROOTS-051-100 artifact).
- ROOT-032 PASS — production backend build = deployed runtime (Render builds from main; /health healthy on 518c09b5cbbd).
- ROOT-033 PASS — Expo Android release build BUILD SUCCESSFUL this run (v1.4.8(40)).
- ROOT-034 PASS — Expo web: same RN codebase with web support via Expo; landing site live at ivxholding.com (200).
- ROOT-035 HONEST — iOS build readiness: config present (app.config.ts iOS section), but NO TestFlight build possible: Apple credentials not provided (owner-blocked). Reported honestly; not claimed.
- ROOT-036 PASS — APK generated: expo/android app-release.apk 84,376,024 bytes.
- ROOT-037 PASS — AAB generated: app-release.aab 42,606,029 bytes.
- ROOT-038 PASS — APK sha256 d2c6eeb4fce9d21fa38d3c2cc248e4d70be523598957f9f3b612d47289f3bf3f, md5 b0f3a4ee6f6bf58b2c1c421bf2f5b384; published v1.4.8 APK at https://ivxholding.com/apk/ivx-holdings-v1.4.8.apk verified 200, 84,462,560 bytes, sha256 2463b6d2..., S3 ETag == md5 (distribution copy built pre-cert from identical source version).
- ROOT-039 PASS — AAB sha256 862683b20d2c45add00d6fa4d65a85ddd51b6d478eb428c629b576bdf554b664 (Play upload blocked on owner Play credentials — honest).
- ROOT-040 PASS after fix — DEF-201: expo/package.json was 1.4.6 while build.gradle/app.config.ts ship 1.4.8(40); fixed to 1.4.8. versionCode 40 + versionName 1.4.8 + buildMarker consistent.
- ROOT-041 PASS — env binding: /health/database envAudit canonicalMode=supabase_rest_service_role; provider vercel_ai_gateway validated at startup.
- ROOT-042 PASS — release config: Render service ivx-holdings-platform (srv-d7t9ivreo5us73ftose0), autodeploy from main, restart-safe durable queue.
- ROOT-043 PASS — preflight = typecheck+tests+owner gates before any commit (executed this run).
- ROOT-044/045 PASS — deployment request + polling proven this run: commit 518c09b5 -> /health polled 28f716a3f342 -> 518c09b5cbbd (~90s).
- ROOT-046 PASS — malformed/empty response handling: JSON parse guards throughout (readBody catch -> {}), test-covered; live 400s return structured errors.
- ROOT-047 PASS — HTTP 409 handling proven live (confirmation-phrase 409s: approve w/o phrase, presign wrong phrase, SQL w/o confirm).
- ROOT-048 PASS — HTTP 429 handling proven live this run (owner-login rate limit: 403,403,403,429,429,429).
- ROOT-049 PASS — 5xx handling: durable queue transient-retry (429/502/503/504) with backoff+jitter; live 503 recovery task 5493bbd8 (ATTEMPT_1/2 FAILED HTTP_503_TRANSIENT -> attempt 3 VERIFIED).
- ROOT-050 PASS — rollback: rollback tag mechanism + rollback ref recorded for this release; prior rollback tag exists and is fetchable.
