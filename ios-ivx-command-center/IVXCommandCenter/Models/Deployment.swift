import Foundation

/// A production deployment record with traceability evidence.
struct Deployment: Identifiable {
    let id: String
    let service: String
    let deployId: String
    let commitSha: String
    let status: String
    let note: String
}
