import Foundation

/// An action that requires explicit owner approval before execution.
struct ApprovalItem: Identifiable {
    let id: String
    let title: String
    let category: String
    let detail: String
    let requestedBy: String
}
