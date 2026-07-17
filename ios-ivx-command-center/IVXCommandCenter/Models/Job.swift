import SwiftUI

enum JobState: String, CaseIterable {
    case running = "RUNNING"
    case queued = "QUEUED"
    case blocked = "BLOCKED"
    case completed = "COMPLETED"
    case failed = "FAILED"

    var color: Color {
        switch self {
        case .running: return Theme.blue
        case .queued: return Theme.textTertiary
        case .blocked: return Theme.red
        case .completed: return Theme.green
        case .failed: return Theme.red
        }
    }

    var icon: String {
        switch self {
        case .running: return "arrow.triangle.2.circlepath"
        case .queued: return "clock"
        case .blocked: return "hand.raised.fill"
        case .completed: return "checkmark.circle.fill"
        case .failed: return "xmark.octagon.fill"
        }
    }
}

/// A single unit of engineering work tracked by the program.
struct Job: Identifiable {
    let id: String
    let title: String
    let workerCode: String
    let state: JobState
    let evidence: String?
}
