# Step 2 — File-by-file reconciliation matrix

**No source, credentials, dependencies, commits, pushes, deployments, or autonomous jobs were changed.**

Baseline: workspace `64e24331…`; owner GitHub and production `d1d232a6…`. A recommendation does not select by timestamp or size. It prioritizes the owner-controlled deployed baseline, then tested newer functionality, and rejects generated/runtime artifacts from source recovery.

## Status legend

- **WG**: present in both, content differs. GitHub context is `d1d232a` (2026-08-01) and is production-aligned.
- **W-only**: absent from owner GitHub.
- **G-only**: absent from workspace and present in owner GitHub at `d1d232a`.
- Runtime-affecting WG files require target tests, typechecking, full related suite, CI, and SHA-matched deployment verification before release.

## Matrix

| Path | Category / purpose | Status and change context | Effects | Action / risk / required validation |
|---|---|---|---|---|
| `.gitmodules` | Self-referential submodule metadata | W-only; `a45d552a`, 2026-07-28 | Repo/deployment; not chat/worker | **ARCHIVE_OBSOLETE** — Gitlink points to the owner repo itself. High structure risk. Verify zero gitlinks/submodules after later approved cleanup. |
| `expo/src/modules/chat/services/ivxSendTriggerPolicy.ts` | Local-first IVX IA send policy | W-only; `758bb437`, 2026-08-02 | IVX IA Chat, Expo, Android | **KEEP_WORKSPACE** — direct documented stall repair; low code size but high behavior risk. Run its unit test, owner-chat/watchdog tests, Expo typecheck/lint. |
| `expo/__tests__/ivx-send-trigger-policy.test.ts` | Policy unit coverage | W-only; `758bb437` | IVX IA Chat, Expo, Android, tests | **KEEP_WORKSPACE** — direct coverage for retained policy. Run focused plus Expo suite. |
| `data/enterprise-reports/ent_report_2026-08-02T01-11-58-172Z.json` | Timestamped report | W-only; `0f895368`, 2026-08-02 | Data only | **IGNORE_GENERATED** — generated runtime report. |
| `data/enterprise-reports/ent_report_2026-08-02T01-15-35-273Z.json` | Timestamped report | W-only; `c84c3387`, 2026-08-02 | Data only | **IGNORE_GENERATED** — generated runtime report. |
| `data/enterprise-reports/ent_report_2026-08-02T01-15-38-924Z.json` | Timestamped report | W-only; `c84c3387`, 2026-08-02 | Data only | **IGNORE_GENERATED** — generated runtime report. |
| `ios-ivx-ia/.gitignore` | iOS metadata | W-only; `28b89f78`, 2026-08-02 | iOS | **NEEDS_OWNER_DECISION** — owner main does not establish this separate iOS product. |
| `ios-ivx-ia/IVXIA.xcodeproj/project.xcworkspace/contents.xcworkspacedata` | iOS workspace | W-only; `28b89f78` | iOS | **NEEDS_OWNER_DECISION** — retain only if native IA is in product scope. |
| `ios-ivx-ia/IVXIA/Assets.xcassets/AccentColor.colorset/Contents.json` | iOS asset metadata | W-only; `28b89f78` | iOS | **NEEDS_OWNER_DECISION** — separate product scope unresolved. |
| `ios-ivx-ia/IVXIA/Assets.xcassets/AppIcon.appiconset/Contents.json` | iOS icon manifest | W-only; `28b89f78` | iOS | **NEEDS_OWNER_DECISION** — separate product scope unresolved. |
| `ios-ivx-ia/IVXIA/Assets.xcassets/AppIcon.appiconset/icon.png` | iOS icon binary | W-only; `28b89f78` | iOS | **NEEDS_OWNER_DECISION** — binary alone proves no required runtime update. |
| `ios-ivx-ia/IVXIA/Assets.xcassets/Contents.json` | iOS asset catalog | W-only; `28b89f78` | iOS | **NEEDS_OWNER_DECISION** — separate product scope unresolved. |
| `ios-ivx-knowledge-base/IVXKnowledgeBase/Assets.xcassets/AppIcon.appiconset/icon.png` | iOS icon binary | W-only; `94ed3d5b`, 2026-07-29 | iOS | **NEEDS_OWNER_DECISION** — owner main lacks it. |
| `backend/api/ivx-developer-proof-v618.ts` | Developer proof endpoint | G-only; owner `d1d232a` | Backend, IVX IA, autonomous, production | **KEEP_GITHUB** — owner/deployed-only endpoint. Run backend route tests. |
| `backend/services/ivx-autonomous-improvements/{improvement-570c1af9,improvement-5a9241c0,improvement-ce34046e}.ts` | Generated autonomous-loop evidence | G-only; owner `d1d232a` | Autonomous artifact only | **ARCHIVE_OBSOLETE** — verify no imports before archival. |
| `backend/services/ivx-generated-features/{add-a-new-endpoint-for-investor-reports-e3af1248,add-a-new-feature-flag-to-the-backend-ca-2b102118,add-a-new-feature-flag-to-the-backend-ca-ff346f56,create-a-new-ios-app-from-scratch-write--b34ddb4f,create-a-new-module-from-scratch-called--215810f3,create-a-new-module-from-scratch-called--c0cd5d71}.ts` | Generated feature manifests | G-only; owner `d1d232a` | Autonomous artifact only | **ARCHIVE_OBSOLETE** — manifests are not proven registered runtime features; check references first. |
| `backend/services/ivx-senior-developer-samples/apps/test-module/{README.md,index.test.ts,index.ts,package.json}` | Generated sample module | G-only; owner `d1d232a` | Tests/sample only | **ARCHIVE_OBSOLETE** — not product runtime source; import check then archive. |
| `backend/services/ivx-senior-developer-samples/apps/test-module-with-build-metadata-features/{README.md,index.test.ts,index.ts,package.json}` | Generated sample module | G-only; owner `d1d232a` | Tests/sample only | **ARCHIVE_OBSOLETE** — not product runtime source; import check then archive. |
| `.gitattributes` | Git normalization | WG; workspace `2e6e9081`, owner `d1d232a` | Repo/CI | **KEEP_GITHUB** — owner deployed baseline; only two owner additions. Low risk; run checkout/diff check. |
| `.github/workflows/{android-emulator-qa,ios-simulator-qa,ivx-ci,ivx-qa-suite}.yml` | CI and mobile QA | WG; workspace recent `c4e7481e`/`55af3831`, owner `d1d232a` | CI, Expo, Android/iOS; chat + worker verification | **MERGE_MANUALLY** — retain workspace Bun/frozen-lockfile/reporter/failure-propagation repairs and owner workflow steps. High risk. Run workflow syntax plus each job in CI. |
| `.github/workflows/ivx-e2e.yml` | E2E workflow | WG; workspace `1c09e5b1`, owner `d1d232a` | CI, Expo, iOS, IVX IA Chat | **KEEP_GITHUB** — owner version is deployed repair that runs Playwright from Expo and boots iOS after Metro readiness. Run E2E CI. |
| `backend/__tests__/ivx-failure-recovery.test.ts` | Backend recovery test | WG; workspace `90c345fc`, owner `d1d232a` | Backend, autonomous, tests | **MERGE_MANUALLY** — one-line assertion delta can change behavior claim. Run focused and backend suite. |
| `backend/api/{ivx-app-generator,ivx-autonomous-runs,ivx-autonomous-task-engine-api,ivx-autonomy,ivx-build-metadata-buildmetadata,ivx-db-migration,ivx-enterprise-master,ivx-enterprise-registration-api,ivx-owner-registration,ivx-scoped-memory}.ts` | Runtime route set | WG; workspace commits span 2026-07-26…08-01; owner `d1d232a` | Backend, production, IVX IA Chat, autonomous | **MERGE_MANUALLY** — preserve deployed owner behavior and line-review any valid workspace fixes. Highest backend risk. Run route tests, backend typecheck/full suite, authenticated staging smoke. |
| `backend/services/ivx-scoped-memory-store.ts` | Conversation/state storage | WG; workspace `6b97e032`, owner `d1d232a` | Backend, chat, autonomous | **MERGE_MANUALLY** — memory isolation semantics are high risk. Run scoped-memory tests and chat context acceptance. |
| `backend/services/ivx-generated-apps/app-gate5-materialize-test/blueprint.json` | Generated app fixture | WG; workspace `55af3831`, owner `d1d232a` | Autonomous/test artifact | **ARCHIVE_OBSOLETE** — generated fixture, no confirmed production registration. Verify references. |
| `data/enterprise-reports/{latest-report,report-index}.json` | Generated report/current pointer | WG; workspace `c84c3387`, owner `d1d232a` | Data only | **IGNORE_GENERATED** — not source. |
| `expo/.maestro/{ivx-app-launch,ivx-chat-qa-full}.yaml` | Mobile smoke and chat QA | WG; workspace `c4e7481e`/`55af3831`, owner `d1d232a` | Expo, Android, iOS, CI, IVX IA Chat | **MERGE_MANUALLY** — retain valid selector and swipe fixes only after simulator replay. |
| `expo/app/ivx/chat.tsx` | IVX IA Chat UI and queue | WG; workspace `758bb437`, owner `d1d232a` | Expo, Android, IVX IA Chat, autonomous console | **MERGE_MANUALLY** — workspace contains tested optimistic local-first repair; owner has additional deployed behavior. Highest UI risk. Run focused queue/watchdog tests, Expo suite, Playwright and device flow. |
| `expo/deploy-landing.mjs` | Landing deployment | WG; workspace `81ad5122`, owner `d1d232a` | Expo/deployment | **KEEP_GITHUB** — owner side has 534 additional lines and is production baseline. Run deployment-script dry validation only. |
| `ios-ivx-ia/IVXIA.xcodeproj/project.pbxproj` | Xcode project configuration | WG; workspace `28b89f78`, owner `d1d232a` | iOS | **MERGE_MANUALLY** — equal-size divergent config; requires Xcode build. |
| `ios-ivx-ia/IVXIA/{ContentView.swift,IVXIAApp.swift}` | Native IA app source | WG; workspace `28b89f78`, owner `d1d232a` | iOS, IVX IA | **MERGE_MANUALLY** — native product scope unresolved; decide behavior line-by-line then build. |
| `ios-ivx-ia/IVXIATests/IVXIATests.swift` | Native unit test | WG; workspace `28b89f78`, owner `d1d232a` | iOS/tests | **MERGE_MANUALLY** — align after source decision; run Xcode tests. |
| `ios-ivx-ia/IVXIAUITests/{IVXIAUITests,IVXIAUITestsLaunchTests}.swift` | Native UI tests | WG; workspace `28b89f78`, owner `d1d232a` | iOS/tests | **MERGE_MANUALLY** — align after source decision; run UI tests. |

The JSON matrix contains the machine-readable expanded fields and exact context for these entries.
