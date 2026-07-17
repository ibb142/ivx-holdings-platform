import Foundation

nonisolated struct HealthRuntimeInfo: Codable {
    let commitSha: String?
}

nonisolated struct HealthResponse: Codable {
    let status: String?
    let seniorDeveloperRuntime: HealthRuntimeInfo?
}

/// Result of a live production health probe.
struct HealthReport {
    let isReachable: Bool
    let httpStatus: Int
    let commitSha: String
    let latencyMs: Int
    let checkedAt: Date
}

/// Probes the live IVX production API.
nonisolated enum HealthService {
    private static let healthURL = URL(string: "https://api.ivxholding.com/health")!

    static func probe() async -> HealthReport {
        let start = Date()
        var request = URLRequest(url: healthURL)
        request.timeoutInterval = 15

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let latency = Int(Date().timeIntervalSince(start) * 1000)
            let httpStatus = (response as? HTTPURLResponse)?.statusCode ?? 0
            let decoded = try? JSONDecoder().decode(HealthResponse.self, from: data)
            let sha = decoded?.seniorDeveloperRuntime?.commitSha ?? "unknown"

            return HealthReport(
                isReachable: httpStatus == 200,
                httpStatus: httpStatus,
                commitSha: String(sha.prefix(12)),
                latencyMs: latency,
                checkedAt: Date()
            )
        } catch {
            let latency = Int(Date().timeIntervalSince(start) * 1000)
            return HealthReport(
                isReachable: false,
                httpStatus: 0,
                commitSha: "unreachable",
                latencyMs: latency,
                checkedAt: Date()
            )
        }
    }
}
