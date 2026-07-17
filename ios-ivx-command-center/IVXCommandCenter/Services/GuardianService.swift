import Foundation

nonisolated struct GuardianProbe: Codable, Identifiable {
    let id: String
    let name: String
    let target: String
    let ok: Bool
    let httpStatus: Int?
    let latencyMs: Int
    let detail: String
    let checkedAt: String
}

nonisolated struct GuardianIncident: Codable, Identifiable {
    let incidentId: String
    let probeId: String
    let openedAt: String
    let closedAt: String?
    let status: String
    let detail: String

    var id: String { incidentId }
}

nonisolated struct GuardianAlert: Codable, Identifiable {
    let alertId: String
    let severity: String
    let area: String
    let problem: String
    let smsStatus: String
    let messageId: String?
    let toMasked: String
    let sentAt: String
    let test: Bool

    var id: String { alertId }
}

nonisolated struct GuardianSmsProvider: Codable {
    let provider: String?
    let awsCredentialsConfigured: Bool?
    let awsRegion: String?
    let ownerPhoneMasked: String?
    let phoneSource: String?
    let ready: Bool?
}

nonisolated struct GuardianResponse: Codable {
    let ok: Bool
    let marker: String?
    let generatedAt: String?
    let totalRuns: Int?
    let overall: String?
    let probes: [GuardianProbe]?
    let openIncidents: [GuardianIncident]?
    let smsProvider: GuardianSmsProvider?
    let recentAlerts: [GuardianAlert]?
}

nonisolated struct QARunEntry: Codable, Identifiable {
    let runId: String
    let kind: String
    let at: String
    let ok: Bool
    let summary: String

    var id: String { runId }
}

nonisolated struct QASchedulerResponse: Codable {
    let ok: Bool
    let schedulerRunning: Bool?
    let lastHealthAt: String?
    let lastAuthAt: String?
    let lastMatrixAt: String?
    let healthOk: Bool?
    let authOk: Bool?
    let totalRuns: Int?
    let recentRuns: [QARunEntry]?
}

nonisolated struct OwnerLoginResponse: Codable {
    let accessToken: String?
}

/// Live Owner Auth Guardian + continuous QA data from the production API.
nonisolated enum GuardianService {
    private static let baseURL = "https://api.ivxholding.com"
    private static let ownerEmail = "iperez4242@gmail.com"

    enum GuardianError: LocalizedError {
        case loginFailed(Int)
        case requestFailed(Int)

        var errorDescription: String? {
            switch self {
            case .loginFailed(let status):
                return "Owner login failed (HTTP \(status))."
            case .requestFailed(let status):
                return "Guardian request failed (HTTP \(status))."
            }
        }
    }

    /// Short-lived owner token via the passwordless login route (~15 min TTL).
    static func ownerToken() async throws -> String {
        var request = URLRequest(url: URL(string: "\(baseURL)/api/ivx/owner-passwordless-login")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["email": ownerEmail])
        request.timeoutInterval = 20

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200,
              let token = try? JSONDecoder().decode(OwnerLoginResponse.self, from: data).accessToken,
              !token.isEmpty else {
            throw GuardianError.loginFailed(status)
        }
        return token
    }

    private static func authorizedGet<T: Codable>(_ path: String, token: String, as type: T.Type) async throws -> T {
        var request = URLRequest(url: URL(string: "\(baseURL)\(path)")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 25

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else {
            throw GuardianError.requestFailed(status)
        }
        return try JSONDecoder().decode(type, from: data)
    }

    static func fetchGuardian(token: String) async throws -> GuardianResponse {
        try await authorizedGet("/api/ivx/autonomous/auth-guardian", token: token, as: GuardianResponse.self)
    }

    static func fetchQAStatus(token: String) async throws -> QASchedulerResponse {
        try await authorizedGet("/api/ivx/autonomous/qa", token: token, as: QASchedulerResponse.self)
    }
}
