import SwiftUI

enum FindingStatus: String {
    case fixed = "FIXED"
    case open = "OPEN"
    case verified = "VERIFIED"

    var color: Color {
        switch self {
        case .fixed, .verified: return Theme.green
        case .open: return Theme.red
        }
    }
}

/// A security audit finding with remediation state.
struct SecurityFinding: Identifiable {
    let id: String
    let title: String
    let severity: String
    let status: FindingStatus
    let detail: String
}
