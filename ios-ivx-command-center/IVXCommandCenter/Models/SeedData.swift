import Foundation

/// Report #1 snapshot of the IVX Autonomous Execution Program.
/// Every evidence line references a real artifact produced during the
/// owner-login-recovery and stabilization sessions.
enum SeedData {
    static let snapshot = ProgramSnapshot(
        reportNumber: 1,
        generatedAt: "2026-07-17 19:45 UTC",
        missionStatement: "Raise IVX enterprise readiness from 4/10 to 9/10 through continuous, evidence-backed engineering.",
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
            name: "Authentication & Security",
            focus: "Owner login recovery, credential hygiene, session control",
            state: .blocked,
            currentTask: "Send official Supabase password reset email to owner",
            backlog: [
                "Complete owner password reset via official email",
                "Verify service-role key rotation (old key must return 401)",
                "Run 20-test owner auth QA matrix on physical device",
                "Add automated secret scanning to every build",
                "Purge exposed service-role key from Git history",
            ],
            blocker: "Supabase email quota exhausted — /auth/v1/recover returns 429 continuously since 18:31 UTC",
            estimatedCompletion: "Blocked on email quota + owner device",
            evidence: [
                "Old exposed password PROVEN rejected: error_code=invalid_credentials, token_issued=False",
                "Global sign-out verified: logout?scope=global → 204; old refresh token 400, old access token 403",
                "Client self-heal removed: commit 6e011658",
                "Server repair endpoint hard-gated to HTTP 410: commit 3e221781",
            ],
            approval: .pendingOwner,
            progress: 0.55
        ),
        Worker(
            id: "w2",
            code: "W2",
            name: "Mobile Stability (Android + iOS)",
            focus: "Crash-free sessions, release builds, device QA",
            state: .blocked,
            currentTask: "Physical-device QA of Android v1.4.6 (38) — waiting on owner's phone",
            backlog: [
                "30-test physical Android QA matrix with screen recording",
                "Create real release keystore (current APK signed with debug keystore)",
                "Add crash reporting with symbolicated stack traces",
                "iOS build parity for owner app",
                "Cold-start time budget and measurement",
            ],
            blocker: "Owner's physical Android phone required; no device attached to build environment",
            estimatedCompletion: "1 session after owner installs APK",
            evidence: [
                "APK v1.4.6 (38) arm64 built, signed, apksigner verify PASSED",
                "SHA-256 0b7ced1b…894c7, 45.3 MB (47% smaller than universal build)",
                "Delivered via owner storage bucket, download HEAD 200",
            ],
            approval: .pendingOwner,
            progress: 0.60
        ),
        Worker(
            id: "w3",
            code: "W3",
            name: "Backend / API & Database",
            focus: "API contracts, database integrity, storage policy",
            state: .blocked,
            currentTask: "Wire database credentials so migrations can run (supabase_execute_sql)",
            backlog: [
                "Provide SUPABASE_DB_URL to backend for SQL migrations",
                "Raise owner-files bucket size limit above 50 MB",
                "API error-contract audit across 144 endpoint files",
                "Add rate limiting to owner-passwordless-login",
                "Index review for hot query paths",
            ],
            blocker: "Backend missing SUPABASE_DB_URL / DATABASE_URL — supabase_execute_sql fails",
            estimatedCompletion: "1 session after DB credential provided",
            evidence: [
                "Storage 413 limit measured: 40 MB OK, 82–86 MB rejected",
                "owner-access-repair lockdown deployed and live",
            ],
            approval: .pendingOwner,
            progress: 0.20
        ),
        Worker(
            id: "w4",
            code: "W4",
            name: "Chat, Reels & Media",
            focus: "Messaging reliability, media upload, playback QA",
            state: .queued,
            currentTask: "Queued — starts after W2 device QA baseline exists",
            backlog: [
                "Chat storage consistency audit (chat-storage.ts, 39 module files)",
                "Media upload size handling with resumable uploads",
                "Reels playback QA on real device",
                "Offline message queue behavior",
            ],
            blocker: nil,
            estimatedCompletion: "2 sessions",
            evidence: [],
            approval: .notRequired,
            progress: 0.05
        ),
        Worker(
            id: "w5",
            code: "W5",
            name: "Performance & Scalability",
            focus: "Bundle size, latency baselines, caching",
            state: .active,
            currentTask: "APK size reduction — arm64 split shipped",
            backlog: [
                "Adopt ABI splits in Gradle release config permanently",
                "API latency baselines for top 10 endpoints",
                "Image caching policy audit",
                "Cold-start profiling on device",
            ],
            blocker: nil,
            estimatedCompletion: "3 sessions",
            evidence: [
                "APK reduced 86 MB → 45.3 MB by stripping x86/x86_64/armeabi-v7a for owner delivery",
            ],
            approval: .notRequired,
            progress: 0.25
        ),
        Worker(
            id: "w6",
            code: "W6",
            name: "Production QA & Regression",
            focus: "Test matrices, smoke tests, regression gates",
            state: .active,
            currentTask: "Author 20-test auth matrix + 30-test device matrix as executable checklists",
            backlog: [
                "Post-deploy smoke test hitting /health and login path",
                "Regression suite for auth flows",
                "QA evidence archive with timestamps",
            ],
            blocker: nil,
            estimatedCompletion: "2 sessions",
            evidence: [
                "Production /health verified after every deploy this session (HTTP 200, sha match)",
            ],
            approval: .notRequired,
            progress: 0.15
        ),
        Worker(
            id: "w7",
            code: "W7",
            name: "Deployment, CI/CD & Release",
            focus: "Traceable deploys, CI pipelines, release channels",
            state: .blocked,
            currentTask: "Register APK-build CI workflow on GitHub",
            backlog: [
                "Commit .github/workflows/build-apk-release.yml (authored, not registered)",
                "GitHub token with workflow scope",
                "Automated GitHub Release channel for APKs",
                "Deploy annotations linking commit → deploy → health",
            ],
            blocker: "GitHub token lacks workflow scope — workflow commit and dispatch both return HTTP 404",
            estimatedCompletion: "1 session after token scope fixed",
            evidence: [
                "Direct Render deploy proof: dep-d9d7vrm1a83c738h6gqg on srv-d7t9ivreo5us73ftose0",
                "GitHub HEAD == Render deployed SHA == /health SHA (aab9661d)",
            ],
            approval: .pendingOwner,
            progress: 0.50
        ),
        Worker(
            id: "w8",
            code: "W8",
            name: "Architecture & Technical Debt",
            focus: "Module boundaries, dead code, strict typing",
            state: .queued,
            currentTask: "Queued — inventory of expo/lib (179 files) and mocks in production paths",
            backlog: [
                "Remove mock modules from production code paths (30 mock files)",
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
    ]

    private static let jobs: [Job] = [
        Job(id: "j1", title: "Rotate compromised owner password (admin, in-memory only)", workerCode: "W1", state: .completed, evidence: "invalid_credentials proof on old password"),
        Job(id: "j2", title: "Remove client self-heal password overwrite", workerCode: "W1", state: .completed, evidence: "commit 6e011658, deployed"),
        Job(id: "j3", title: "Hard-gate owner-access-repair endpoint (HTTP 410)", workerCode: "W1", state: .completed, evidence: "commit 3e221781, deployed"),
        Job(id: "j4", title: "Verify session revocation (local + global)", workerCode: "W1", state: .completed, evidence: "204 → refresh 400 / access 403"),
        Job(id: "j5", title: "Send official password reset email", workerCode: "W1", state: .blocked, evidence: "429 over_email_send_rate_limit, 25+ retries"),
        Job(id: "j6", title: "Service-role key rotation + old-key 401 verification", workerCode: "W1", state: .blocked, evidence: "Owner dashboard action required"),
        Job(id: "j7", title: "Build APK v1.4.6 (38) universal", workerCode: "W2", state: .completed, evidence: "BUILD SUCCESSFUL, 85.9 MB"),
        Job(id: "j8", title: "Build + sign arm64 APK under 50 MB, verify signature", workerCode: "W2", state: .completed, evidence: "45.3 MB, apksigner VERIFY_OK"),
        Job(id: "j9", title: "Deliver APK via owner channel with direct URL", workerCode: "W2", state: .completed, evidence: "Storage upload 200, signed URL HEAD 200"),
        Job(id: "j10", title: "Physical device QA (30-test matrix)", workerCode: "W2", state: .blocked, evidence: "Owner phone required"),
        Job(id: "j11", title: "Secret scan of final APK bundle", workerCode: "W1", state: .completed, evidence: "1 JWT total = anon role; zero service-role keys"),
        Job(id: "j12", title: "Direct Render deployment proof", workerCode: "W7", state: .completed, evidence: "dep-d9d7vrm1a83c738h6gqg, sha match"),
        Job(id: "j13", title: "Register CI workflow build-apk-release.yml", workerCode: "W7", state: .blocked, evidence: "HTTP 404 — token lacks workflow scope"),
        Job(id: "j14", title: "Owner Command Center dashboard app", workerCode: "W7", state: .running, evidence: "This app"),
        Job(id: "j15", title: "Raise storage bucket limit for full-size builds", workerCode: "W3", state: .blocked, evidence: "supabase_execute_sql missing DB credentials"),
        Job(id: "j16", title: "Auth QA matrix authoring (20 tests)", workerCode: "W6", state: .running, evidence: nil),
        Job(id: "j17", title: "Chat storage consistency audit", workerCode: "W4", state: .queued, evidence: nil),
        Job(id: "j18", title: "Mock-module removal from production paths", workerCode: "W8", state: .queued, evidence: nil),
        Job(id: "j19", title: "API latency baselines", workerCode: "W5", state: .queued, evidence: nil),
        Job(id: "j20", title: "Create real release keystore", workerCode: "W2", state: .blocked, evidence: "Owner approval required (credential)"),
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
            note: "GitHub HEAD == Render SHA == /health SHA verified"
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
            note: "iOS parity build queued under Worker 2"
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
        ApprovalItem(id: "a1", title: "Rotate Supabase service-role key", category: "CREDENTIAL ROTATION", detail: "Supabase Dashboard → Settings → API → rotate service_role. Agent then updates Render env and verifies old key returns 401.", requestedBy: "W1"),
        ApprovalItem(id: "a2", title: "Complete password reset from official email", category: "CREDENTIAL ROTATION", detail: "When the reset email arrives, set a new private password. Never paste it into chat.", requestedBy: "W1"),
        ApprovalItem(id: "a3", title: "Create production release keystore", category: "PRODUCTION RELEASE", detail: "Required to replace debug-keystore signing before any public APK distribution.", requestedBy: "W2"),
        ApprovalItem(id: "a4", title: "Grant GitHub token workflow scope", category: "CREDENTIAL ROTATION", detail: "Needed to register the CI build pipeline (build-apk-release.yml).", requestedBy: "W7"),
        ApprovalItem(id: "a5", title: "Provide SUPABASE_DB_URL to backend", category: "PRODUCTION SCHEMA", detail: "Unblocks storage bucket limit change and future migrations.", requestedBy: "W3"),
    ]

    private static let criticalAlerts: [String] = [
        "Password reset email blocked by Supabase hourly quota (HTTP 429) — retry pending",
        "Service-role key still valid and present in Git history — rotation awaits owner",
        "Physical Android QA cannot run — owner's phone required",
        "CI pipeline unregistered — GitHub token lacks workflow scope",
    ]
}
