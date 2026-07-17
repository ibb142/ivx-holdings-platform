import Foundation

/// A git commit created by the program, kept for traceability.
struct CommitRecord: Identifiable {
    let id: String
    let sha: String
    let message: String
    let deployed: Bool
}
