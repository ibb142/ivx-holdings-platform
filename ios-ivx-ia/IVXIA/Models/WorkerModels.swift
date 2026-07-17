import Foundation

/// Template modes accepted by the IVX Senior Developer worker queue.
nonisolated enum WorkerTemplateMode: String, CaseIterable, Identifiable {
    case newApp = "NEW_APP"
    case newModule = "NEW_MODULE"
    case bugFix = "BUG_FIX"
    case qaAudit = "QA_AUDIT"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .newApp: return "New App From Scratch"
        case .newModule: return "New Module"
        case .bugFix: return "Bug Fix"
        case .qaAudit: return "QA Audit"
        }
    }

    var subtitle: String {
        switch self {
        case .newApp: return "Scaffold and build a new app end to end"
        case .newModule: return "Add a new feature module to production"
        case .bugFix: return "Diagnose and fix a defect"
        case .qaAudit: return "Run production QA and report"
        }
    }

    var systemImage: String {
        switch self {
        case .newApp: return "sparkles.rectangle.stack"
        case .newModule: return "puzzlepiece.extension"
        case .bugFix: return "ant"
        case .qaAudit: return "checkmark.shield"
        }
    }
}

nonisolated struct WorkerEnqueueResponse: Codable {
    let ok: Bool?
    let jobId: String?
    let stage: String?
    let attached: Bool?
    let error: String?
    let message: String?
}

nonisolated struct WorkerJobResult: Codable, Equatable {
    let finalStatus: String?
    let healthOk: Bool?
    let testsPassed: Bool?
    let commitSha: String?
    let summary: String?
}

nonisolated struct WorkerJob: Codable, Equatable, Identifiable {
    let jobId: String?
    let goal: String?
    let stage: String?
    let status: String?
    let progressPercent: Int?
    let templateMode: String?
    let createdAt: String?
    let result: WorkerJobResult?

    var id: String { jobId ?? UUID().uuidString }

    var isTerminal: Bool {
        let s = (stage ?? status ?? "").uppercased()
        return s.contains("COMPLETED") || s.contains("FAILED") || s.contains("CANCELLED") || s.contains("BLOCKED")
    }
}

nonisolated struct WorkerJobDetailResponse: Codable {
    let ok: Bool?
    let job: WorkerJob?
    let error: String?
}

nonisolated struct WorkerActiveResponse: Codable {
    let ok: Bool?
    let activeJob: WorkerJob?
}

nonisolated struct WorkerLedgerResponse: Codable {
    let ok: Bool?
    let jobs: [WorkerJob]?
    let ledger: [WorkerJob]?

    var allJobs: [WorkerJob] { jobs ?? ledger ?? [] }
}

nonisolated struct WorkerStatusResponse: Codable {
    let ok: Bool?
    let singleFlight: Bool?
    let perOwnerSingleFlight: Bool?
    let marker: String?
}
