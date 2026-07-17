import Foundation

/// Authenticated owner session returned by the passwordless login endpoint.
nonisolated struct OwnerSession: Codable, Equatable {
    let accessToken: String
    let email: String
    let userId: String?
    /// Local expiry estimate — production tokens expire in ~15 minutes.
    let obtainedAt: Date

    var isExpiringSoon: Bool {
        Date().timeIntervalSince(obtainedAt) > 12 * 60
    }
}

nonisolated struct OwnerLoginResponse: Codable {
    let success: Bool?
    let accessToken: String?
    let refreshToken: String?
    let userId: String?
    let email: String?
    let error: String?
    let message: String?
}
