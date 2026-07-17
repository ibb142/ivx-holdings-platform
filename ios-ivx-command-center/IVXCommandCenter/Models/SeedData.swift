import Foundation

/// Report #2 ledger snapshot of the IVX Autonomous Execution Program,
/// restructured to the 12-worker mandate (W1–W12).
/// Every evidence line references a real artifact produced during the
/// owner-login-recovery and stabilization sessions. Production health is
/// probed live by HealthService; this ledger is the last verified state.
enum SeedData {
    static let snapshot = ProgramSnapshot(
        reportNumber: 2,
        generatedAt: "2026-07-17 20:09 UTC",
        missionStatement: "Complete the existing IVX platform, then enable autonomous app creation end to end — evidence-backed, 12 workstreams.",
        workers: workers,
        jobs: jobs,
        readiness: readiness,
        deployments: deployments,
        builds: builds,
        commits: commits,
        securityFindings: securityFindings,
        approvals: approvals,
        criticalAlerts: criticalAlerts
    )

    private static let workers: [Worker] = [
        Worker(
            id: "w1",
            code: "W1",
            name: "Architecture & Code Consistency",
            focus: "Module boundaries, dead code, strict typing, duplication",
            state: .queued,
            currentTask: "Inventory of mock modules in production paths (30 files) and expo/lib duplication map (179 files)",
            backlog: [
                "Remove mock modules from production code paths",
                "Consolidate duplicated auth logic in expo/lib",
                "Strict TypeScript pass across backend services (342 files)",
                "Module dependency map and boundary enforcement",
            ],
            blocker: nil,
            estimatedCompletion: "4 sessions",
            evidence: [],
            approval: .notRequired,
            progress: 0.10
        ),
        Worker(
            id: "w2",
            code: "W2",
            name: "Owner Authentication & Authorization",
            focus: "Owner login, logout, session persistence, password recovery",
            state: .blocked,
            currentTask: "Send official Supabase password reset email to owner (P0)",
            backlog: [
                "Complete owner password reset via official email",
                "Owner login on physical Android device (signInWithPassword)",
                "20-test owner auth QA matrix on device",
                "Non-owner rejection tests on owner-only routes",
            ],
            blocker: "Supabase email quota: /auth/v1/recover HTTP 429 over_email_send_rate_limit — last attempt 20:08 UTC",
            estimatedCompletion: "Blocked on email quota + owner device",
            evidence: [
                "Old exposed password PROVEN rejected: error_code=invalid_credentials, token_issued=False",
                "Global sign-out verified: logout?scope=global → 204; old refresh 400, old access 403",
                "Client self-heal removed: commit 6e011658 (deployed)",
                "Repair endpoint hard-gated to HTTP 410: commit 3e221781 (deployed)",
            ],
            approval: .pendingOwner,
            progress: 0.55
        ),
        Worker(
            id: "w3",
            code: "W3",
            name: "Security & Secret Management",
            focus: "Credential rotation, secret scanning, exposure remediation",
            state: .blocked,
            currentTask: "Service-role key rotation (owner Supabase-dashboard action) + old-key 401 verification",
            backlog: [
                "Verify rotated service-role key (old key must return 401)",
                "Purge exposed key from Git history",
                "Automated secret scanning on every build",
                "RLS policy audit across Supabase tables",
            ],
            blocker: "Key rotation is an owner-only Supabase dashboard action; old key still valid and in Git history",
            estimatedCompletion: "Minutes after owner rotates key",
            evidence: [
                "Final APK secret scan PASSED: exactly 1 JWT (anon role), zero service-role/session tokens",
            ],
            approval: .pendingOwner,
            progress: 0.45
        ),
        Worker(
            id: "w4",
            code: "W4",
            name: "Android & iOS Mobile Stability",
            focus: "Release builds, crash-free sessions, device QA",
            state: .blocked,
            currentTask: "Physical-device QA of Android v1.4.6 (38) — waiting on owner's phone",
            backlog: [
                "30-test physical Android QA matrix with recording",
                "Real release keystore (current APK debug-signed)",
                "Crash reporting with symbolicated traces",
                "iOS production build parity",
            ],
            blocker: "Owner's physical Android phone required; no device attached to build environment",
            estimatedCompletion: "1 session after owner installs APK",
            evidence: [
                "APK v1.4.6 (38) arm64 built, signed, apksigner verify PASSED",
                "SHA-256 0b7ced1b…894c7, 45.3 MB (47% smaller than universal)",
                "Delivered via owner storage bucket, download HEAD 200 (7-day URL)",
            ],
            approval: .pendingOwner,
            progress: 0.60
        ),
        Worker(
            id: "w5",
            code: "W5",
            name: "Backend APIs & Supabase",
            focus: "API contracts, database bindings, storage policy, migrations",
            state: .blocked,
            currentTask: "Wire database credentials so migrations can run (supabase_execute_sql)",
            backlog: [
                "SUPABASE_DB_URL on backend for SQL migrations",
                "Raise owner-files bucket limit above 50 MB",
                "API error-contract audit across 144 endpoint files",
                "Database backup and recovery verification (P0)",
            ],
            blocker: "Backend missing SUPABASE_DB_URL / DATABASE_URL — verified again via /developer-deploy/status (both false)",
            estimatedCompletion: "1 session after DB credential provided",
            evidence: [
                "Storage 413 limit measured: 40 MB OK, 82–86 MB rejected",
                "owner-access-repair lockdown deployed and live",
            ],
            approval: .pendingOwner,
            progress: 0.20
        ),
        Worker(
            id: "w6",
            code: "W6",
            name: "Members, Investors, Buyers, Properties & Deals",
            focus: "Business-module reconciliation: routes, screens, APIs, CRUD, states",
            state: .queued,
            currentTask: "Module verification matrix: route/screen/API/DB binding/CRUD/loading/empty/error per module",
            backlog: [
                "Members module full verification",
                "Investors + investment cards verification",
                "Buyers and properties reconciliation",
                "Deals lifecycle verification",
                "Owner access + non-owner rejection per module",
            ],
            blocker: nil,
            estimatedCompletion: "3 sessions",
            evidence: [],
            approval: .notRequired,
            progress: 0.05
        ),
        Worker(
            id: "w7",
            code: "W7",
            name: "Reels, Chat, Media & Documents",
            focus: "Messaging reliability, media upload, playback, documents",
            state: .queued,
            currentTask: "Queued — chat storage consistency audit (chat-storage.ts + 39 module files)",
            backlog: [
                "Chat persistence and keyboard behavior (P1)",
                "Media upload size handling with resumable uploads",
                "Reels playback QA on real device",
                "Documents module verification",
            ],
            blocker: nil,
            estimatedCompletion: "2 sessions after W4 device baseline",
            evidence: [],
            approval: .notRequired,
            progress: 0.05
        ),
        Worker(
            id: "w8",
            code: "W8",
            name: "Owner Dashboard, Admin Hub & Settings",
            focus: "Owner-facing control surfaces incl. this Autonomous Dashboard",
            state: .active,
            currentTask: "Autonomous Dashboard: 12-worker ledger restructure + live production probe (this app)",
            backlog: [
                "Wire dashboard to backend job-ledger API (live records, not snapshots)",
                "Admin Hub verification pass",
                "Settings & Variables verification pass",
                "Approve/reject actions from the Approvals tab",
            ],
            blocker: nil,
            estimatedCompletion: "Ledger API next session",
            evidence: [
                "Dashboard app builds clean; live /health probe decodes production commit SHA",
                "12-worker mandate live in app (this ledger)",
            ],
            approval: .notRequired,
            progress: 0.45
        ),
        Worker(
            id: "w9",
            code: "W9",
            name: "Testing, Regression & Production QA",
            focus: "Test matrices, smoke tests, regression gates",
            state: .active,
            currentTask: "Author 20-test auth matrix + 30-test device matrix as executable checklists",
            backlog: [
                "Post-deploy smoke test hitting /health and login path",
                "Regression suite for auth flows",
                "QA evidence archive with timestamps",
                "Web production tests for landing + registration",
            ],
            blocker: nil,
            estimatedCompletion: "2 sessions",
            evidence: [
                "Production /health verified after every deploy (HTTP 200, sha match)",
            ],
            approval: .notRequired,
            progress: 0.15
        ),
        Worker(
            id: "w10",
            code: "W10",
            name: "CI/CD, GitHub, Render & EAS",
            focus: "Traceable deploys, CI pipelines, release channels",
            state: .blocked,
            currentTask: "Register APK-build CI workflow on GitHub",
            backlog: [
                "Commit .github/workflows/build-apk-release.yml (authored, unregistered)",
                "GitHub token with workflow scope",
                "GitHub Releases channel for APK artifacts",
                "EAS build pipeline evaluation for iOS",
            ],
            blocker: "GitHub token lacks workflow scope — workflow commit and dispatch both return HTTP 404",
            estimatedCompletion: "1 session after token scope granted",
            evidence: [
                "Render deploy proof: dep-d9d7vrm1a83c738h6gqg on srv-d7t9ivreo5us73ftose0",
                "GitHub HEAD == Render SHA == /health SHA (aab9661d) verified 19:57 & 20:08 UTC",
            ],
            approval: .pendingOwner,
            progress: 0.50
        ),
        Worker(
            id: "w11",
            code: "W11",
            name: "Performance, Monitoring & Scalability",
            focus: "Bundle size, latency baselines, caching, monitoring",
            state: .active,
            currentTask: "API latency baselines for top 10 endpoints (health: 0.77–1.45s measured)",
            backlog: [
                "Permanent ABI splits in Gradle release config",
                "Error tracking / monitoring integration",
                "Image caching policy audit",
                "Cold-start profiling on device",
            ],
            blocker: nil,
            estimatedCompletion: "3 sessions",
            evidence: [
                "APK reduced 86 MB → 45.3 MB by stripping non-arm64 ABIs",
                "/health latency samples: 0.775s, 0.856s, 0.888s, 1.455s",
            ],
            approval: .notRequired,
            progress: 0.25
        ),
        Worker(
            id: "w12",
            code: "W12",
            name: "Autonomous App-Generation Platform",
            focus: "App-from-scratch lifecycle: request → repo → build → deploy → QA",
            state: .queued,
            currentTask: "Queued (P2) — starts after P0/P1 stabilization per prioritized order",
            backlog: [
                "20-step lifecycle orchestration design",
                "Owner-controlled repo scaffolding via GitHub API",
                "Controlled test project end-to-end certification",
                "Rollback instruction generation per deploy",
            ],
            blocker: nil,
            estimatedCompletion: "After P0/P1 queue clears",
            evidence: [],
            approval: .notRequired,
            progress: 0.0
        ),
    ]

    private static let jobs: [Job] = [
        Job(id: "JOB-0001", title: "Rotate compromised owner password (admin, in-memory only)", workerCode: "W2", state: .completed, evidence: "invalid_credentials proof on old password"),
        Job(id: "JOB-0002", title: "Remove client self-heal password overwrite", workerCode: "W2", state: .completed, evidence: "commit 6e011658, deployed"),
        Job(id: "JOB-0003", title: "Hard-gate owner-access-repair endpoint (HTTP 410)", workerCode: "W2", state: .completed, evidence: "commit 3e221781, deployed"),
        Job(id: "JOB-0004", title: "Verify session revocation (local + global)", workerCode: "W2", state: .completed, evidence: "204 → refresh 400 / access 403"),
        Job(id: "JOB-0005", title: "Send official password reset email (P0)", workerCode: "W2", state: .blocked, evidence: "HTTP 429 over_email_send_rate_limit, last 20:08 UTC"),
        Job(id: "JOB-0006", title: "Service-role key rotation + old-key 401 verification", workerCode: "W3", state: .blocked, evidence: "Owner Supabase dashboard action required"),
        Job(id: "JOB-0007", title: "Build APK v1.4.6 (38) universal", workerCode: "W4", state: .completed, evidence: "BUILD SUCCESSFUL, 85.9 MB, SHA 931a1927…2908"),
        Job(id: "JOB-0008", title: "Build + sign arm64 APK under 50 MB, verify signature", workerCode: "W4", state: .completed, evidence: "45.3 MB, apksigner VERIFY_OK, SHA 0b7ced1b…894c7"),
        Job(id: "JOB-0009", title: "Deliver APK via owner channel with direct URL", workerCode: "W4", state: .completed, evidence: "Storage upload 200, signed URL HEAD 200"),
        Job(id: "JOB-0010", title: "Physical device QA (30-test matrix) (P0)", workerCode: "W4", state: .blocked, evidence: "Owner phone required"),
        Job(id: "JOB-0011", title: "Secret scan of final APK bundle", workerCode: "W3", state: .completed, evidence: "1 JWT total = anon role; zero service-role keys"),
        Job(id: "JOB-0012", title: "Direct Render deployment + traceability proof", workerCode: "W10", state: .completed, evidence: "dep-d9d7vrm1a83c738h6gqg, GitHub==Render==/health"),
        Job(id: "JOB-0013", title: "Register CI workflow build-apk-release.yml", workerCode: "W10", state: .blocked, evidence: "HTTP 404 — token lacks workflow scope"),
        Job(id: "JOB-0014", title: "Owner Autonomous Dashboard app (this app)", workerCode: "W8", state: .running, evidence: "Build checks passed; live /health probe active"),
        Job(id: "JOB-0015", title: "Restructure ledger to 12-worker mandate", workerCode: "W8", state: .completed, evidence: "This ledger, Report #2"),
        Job(id: "JOB-0016", title: "Wire dashboard to backend job-ledger API", workerCode: "W8", state: .queued, evidence: nil),
        Job(id: "JOB-0017", title: "Raise storage bucket limit for full-size builds", workerCode: "W5", state: .blocked, evidence: "supabase_execute_sql: DB URL unset (verified via status route)"),
        Job(id: "JOB-0018", title: "Database backup & recovery verification (P0)", workerCode: "W5", state: .blocked, evidence: "Requires SUPABASE_DB_URL"),
        Job(id: "JOB-0019", title: "Auth QA matrix authoring (20 tests)", workerCode: "W9", state: .running, evidence: nil),
        Job(id: "JOB-0020", title: "Device QA matrix authoring (30 tests)", workerCode: "W9", state: .running, evidence: nil),
        Job(id: "JOB-0021", title: "Chat storage consistency audit", workerCode: "W7", state: .queued, evidence: nil),
        Job(id: "JOB-0022", title: "Mock-module removal from production paths", workerCode: "W1", state: .queued, evidence: nil),
        Job(id: "JOB-0023", title: "API latency baselines (top 10 endpoints)", workerCode: "W11", state: .running, evidence: "/health samples 0.77–1.45s"),
        Job(id: "JOB-0024", title: "Create real release keystore", workerCode: "W4", state: .blocked, evidence: "Owner approval required (credential)"),
        Job(id: "JOB-0025", title: "Business-module verification matrix (members/investors/buyers/properties/deals)", workerCode: "W6", state: .queued, evidence: nil),
        Job(id: "JOB-0026", title: "App-from-scratch controlled test project", workerCode: "W12", state: .queued, evidence: "P2 — after stabilization"),
    ]

    private static let readiness: [ReadinessMetric] = [
        ReadinessMetric(id: "vision", name: "Product Vision", baseline: 9, current: 9, target: 9),
        ReadinessMetric(id: "features", name: "Feature Breadth", baseline: 9, current: 9, target: 9),
        ReadinessMetric(id: "architecture", name: "Architecture Potential", baseline: 7, current: 7, target: 9),
        ReadinessMetric(id: "consistency", name: "Code Consistency", baseline: 5, current: 5, target: 9),
        ReadinessMetric(id: "qa", name: "Production QA Reliability", baseline: 3, current: 4, target: 9),
        ReadinessMetric(id: "security", name: "Security Maturity", baseline: 4, current: 6, target: 9),
        ReadinessMetric(id: "mobile", name: "Mobile Stability", baseline: 4, current: 5, target: 9),
        ReadinessMetric(id: "traceability", name: "Deployment Traceability", baseline: 6, current: 8, target: 9),
        ReadinessMetric(id: "enterprise", name: "Enterprise Readiness", baseline: 4, current: 5, target: 9),
    ]

    private static let deployments: [Deployment] = [
        Deployment(
            id: "d1",
            service: "srv-d7t9ivreo5us73ftose0 (Render)",
            deployId: "dep-d9d7vrm1a83c738h6gqg",
            commitSha: "aab9661d1778",
            status: "LIVE",
            note: "GitHub HEAD == Render SHA == /health SHA; re-verified 20:08 UTC, boot 19:19 UTC, blockers []"
        ),
    ]

    private static let builds: [BuildArtifact] = [
        BuildArtifact(
            id: "b1",
            platform: "Android",
            version: "1.4.6",
            buildNumber: "38",
            sizeDescription: "45.3 MB (arm64)",
            checksumShort: "0b7ced1b…894c7",
            signing: "Debug keystore (flagged)",
            status: "DELIVERED",
            note: "apksigner verify passed; direct download URL issued to owner (7-day)"
        ),
        BuildArtifact(
            id: "b2",
            platform: "Android",
            version: "1.4.6",
            buildNumber: "38",
            sizeDescription: "85.9 MB (universal)",
            checksumShort: "931a1927…2908",
            signing: "Debug keystore (flagged)",
            status: "BUILT",
            note: "Exceeds 50 MB storage limit — held until bucket limit raised"
        ),
        BuildArtifact(
            id: "b3",
            platform: "iOS",
            version: "—",
            buildNumber: "—",
            sizeDescription: "—",
            checksumShort: "—",
            signing: "—",
            status: "QUEUED",
            note: "iOS parity build queued under W4 (P2 in prioritized order)"
        ),
    ]

    private static let commits: [CommitRecord] = [
        CommitRecord(id: "c1", sha: "aab9661d", message: "package.json expo.autolinking exclude (HEAD, deployed)", deployed: true),
        CommitRecord(id: "c2", sha: "3657a3f7", message: "build.gradle versionCode 38", deployed: true),
        CommitRecord(id: "c3", sha: "756f132f", message: "app.config version 1.4.6 / build 38", deployed: true),
        CommitRecord(id: "c4", sha: "3e221781", message: "Hard-gate owner-access-repair to HTTP 410", deployed: true),
        CommitRecord(id: "c5", sha: "6e011658", message: "Remove client self-heal password overwrite", deployed: true),
    ]

    private static let securityFindings: [SecurityFinding] = [
        SecurityFinding(id: "s1", title: "Client self-heal could overwrite owner password", severity: "CRITICAL", status: .fixed, detail: "Any typed password became the owner password. Removed in commit 6e011658; deployed."),
        SecurityFinding(id: "s2", title: "owner-access-repair endpoint accepted client passwords", severity: "CRITICAL", status: .fixed, detail: "Returns HTTP 410 unless explicitly re-enabled server-side. Commit 3e221781; deployed."),
        SecurityFinding(id: "s3", title: "Owner password exposed in chat history", severity: "CRITICAL", status: .fixed, detail: "Rotated to random in-memory value; old password proven rejected (invalid_credentials)."),
        SecurityFinding(id: "s4", title: "Service-role key present in Git history", severity: "HIGH", status: .open, detail: "Key still valid. Owner must rotate in Supabase dashboard; then old-key 401 will be verified."),
        SecurityFinding(id: "s5", title: "App bundles secret scan", severity: "—", status: .verified, detail: "Final APK contains exactly 1 JWT (anon role). Zero service-role or session tokens."),
        SecurityFinding(id: "s6", title: "Release APK signed with debug keystore", severity: "MEDIUM", status: .open, detail: "Acceptable for owner QA only. Real release keystore required before public distribution."),
    ]

    private static let approvals: [ApprovalItem] = [
        ApprovalItem(id: "a1", title: "Rotate Supabase service-role key", category: "CREDENTIAL ROTATION", detail: "Supabase Dashboard → Settings → API → rotate service_role. Agent then updates Render env and verifies old key returns 401. Rollback: re-issue key; no data impact.", requestedBy: "W3"),
        ApprovalItem(id: "a2", title: "Complete password reset from official email", category: "CREDENTIAL ROTATION", detail: "When the reset email arrives, set a new private password. Never paste it into chat. Rollback: repeat reset flow.", requestedBy: "W2"),
        ApprovalItem(id: "a3", title: "Create production release keystore", category: "PRODUCTION RELEASE", detail: "Required to replace debug-keystore signing before any public APK distribution. Rollback: none needed until first public release.", requestedBy: "W4"),
        ApprovalItem(id: "a4", title: "Grant GitHub token workflow scope", category: "CREDENTIAL ROTATION", detail: "Needed to register the CI build pipeline (build-apk-release.yml). Rollback: revoke scope.", requestedBy: "W10"),
        ApprovalItem(id: "a5", title: "Provide SUPABASE_DB_URL to backend", category: "PRODUCTION SCHEMA", detail: "Unblocks bucket limit change, backup verification and future migrations. Rollback: remove env var.", requestedBy: "W5"),
    ]

    private static let criticalAlerts: [String] = [
        "P0: Password reset email blocked by Supabase quota (HTTP 429, last attempt 20:08 UTC)",
        "P0: Service-role key still valid and present in Git history — rotation awaits owner",
        "P0: Physical Android login QA cannot run — owner's phone required",
        "P0: Database backup verification blocked — SUPABASE_DB_URL unset on backend",
        "P1: CI pipeline unregistered — GitHub token lacks workflow scope",
    ]
}
