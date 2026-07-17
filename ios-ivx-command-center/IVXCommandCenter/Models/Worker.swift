import SwiftUI

enum WorkerState: String {
    case active = "ACTIVE"
    case blocked = "BLOCKED"
    case queued = "QUEUED"

    var color: Color {
        switch self {
        case .active: return Theme.green
        case .blocked: return Theme.red
        case .queued: return Theme.textTertiary
        }
    }
}

enum ApprovalState: String {
    case notRequired = "NOT REQUIRED"
    case pendingOwner = "PENDING OWNER"
    case approved = "APPROVED"

    var color: Color {
        switch self {
        case .notRequired: return Theme.textTertiary
        case .pendingOwner: return Theme.amber
        case .approved: return Theme.green
        }
    }
}

/// A dedicated autonomous workstream (Worker 1–12).
struct Worker: Identifiable {
    let id: String
    let code: String
    let name: String
    let focus: String
    let state: WorkerState
    let currentTask: String
    let backlog: [String]
    let blocker: String?
    let estimatedCompletion: String
    let evidence: [String]
    let approval: ApprovalState
    /// 0.0 – 1.0 completion of this worker's critical backlog.
    let progress: Double
}
