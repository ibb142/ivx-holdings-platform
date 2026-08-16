import Foundation

nonisolated struct HealthResponse: Codable {
    let ok: Bool?
    let status: String?
    let commit: String?
    let databaseConfigured: Bool?
    let queue: QueueInfo?
}

nonisolated struct QueueInfo: Codable {
    let workerRunning: Bool?
    let activeTasks: Int?
}

@MainActor
final class IVXAPIClient: ObservableObject {
    static let shared = IVXAPIClient()

    @Published private(set) var healthStatus: String = "Connecting..."
    @Published private(set) var isLive: Bool = false
    @Published private(set) var commitShort: String = ""

    private let session: URLSession
    private var authToken: String?

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        session = URLSession(configuration: config)
    }

    func setAuthToken(_ token: String?) {
        authToken = token
    }

    func checkHealth() async {
        guard let url = URL(string: "\(IVXConfig.apiBaseURL)\(IVXConfig.healthPath)") else { return }

        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                healthStatus = "Offline"
                isLive = false
                return
            }
            let health = try? JSONDecoder().decode(HealthResponse.self, from: data)
            if health?.ok == true {
                isLive = true
                healthStatus = "Live"
                if let commit = health?.commit {
                    commitShort = String(commit.prefix(8))
                }
            } else {
                healthStatus = "Degraded"
                isLive = false
            }
        } catch {
            healthStatus = "Offline"
            isLive = false
        }
    }

    func fetchJSON<T: Codable>(_ path: String, requireAuth: Bool = false) async -> T? {
        guard let url = URL(string: "\(IVXConfig.apiBaseURL)\(path)") else { return nil }

        var request = URLRequest(url: url)
        if requireAuth, let token = authToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { return nil }
            guard http.statusCode == 200 else { return nil }
            return try? JSONDecoder().decode(T.self, from: data)
        } catch {
            return nil
        }
    }
}
