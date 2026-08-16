import Foundation

nonisolated struct LoginResponse: Codable {
    let success: Bool
    let accessToken: String?
    let refreshToken: String?
    let userId: String?
    let email: String?
    let role: String?
    let message: String?
}

nonisolated struct LoginRequest: Codable {
    let email: String
    let password: String
}

@MainActor
final class IVXAuthService: ObservableObject {
    @Published private(set) var isAuthenticated = false
    @Published private(set) var userEmail: String?
    @Published private(set) var userRole: String?
    @Published private(set) var authToken: String?
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        session = URLSession(configuration: config)
    }

    func login(email: String, password: String) async {
        isLoading = true
        errorMessage = nil

        var request = URLRequest(url: URL(string: "\(IVXConfig.apiBaseURL)\(IVXConfig.memberLoginPath)")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = LoginRequest(email: email, password: password)
        request.httpBody = try? JSONEncoder().encode(body)

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                errorMessage = "Invalid response"
                isLoading = false
                return
            }

            if http.statusCode == 200 {
                let result = try JSONDecoder().decode(LoginResponse.self, from: data)
                if result.success, let token = result.accessToken {
                    authToken = token
                    userEmail = result.email ?? email
                    userRole = result.role ?? "owner"
                    isAuthenticated = true
                    UserDefaults.standard.set(token, forKey: "ivx_auth_token")
                    UserDefaults.standard.set(result.email ?? email, forKey: "ivx_user_email")
                } else {
                    errorMessage = result.message ?? "Login failed"
                }
            } else {
                errorMessage = "Server error (\(http.statusCode))"
            }
        } catch {
            errorMessage = "Network error: \(error.localizedDescription)"
        }

        isLoading = false
    }

    func restoreSession() {
        if let token = UserDefaults.standard.string(forKey: "ivx_auth_token") {
            authToken = token
            userEmail = UserDefaults.standard.string(forKey: "ivx_user_email")
            userRole = "owner"
            isAuthenticated = true
        }
    }

    func logout() {
        authToken = nil
        userEmail = nil
        userRole = nil
        isAuthenticated = false
        UserDefaults.standard.removeObject(forKey: "ivx_auth_token")
        UserDefaults.standard.removeObject(forKey: "ivx_user_email")
    }
}
