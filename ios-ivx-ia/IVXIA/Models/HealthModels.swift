import Foundation

nonisolated struct HealthAIValidation: Codable {
    let ok: Bool?
    let provider: String?
    let model: String?
    let keyLoaded: Bool?
}

nonisolated struct HealthSeniorDevRuntime: Codable {
    let enabled: Bool?
    let variablesValidated: Bool?
    let toolRegistryReady: Bool?
    let commitSha: String?
}

/// Subset of the production `/health` payload the app displays.
nonisolated struct HealthResponse: Codable {
    let ok: Bool?
    let status: String?
    let commit: String?
    let commitShort: String?
    let bootTime: String?
    let service: String?
    let aiEnabled: Bool?
    let openAIModel: String?
    let aiStartupValidation: HealthAIValidation?
    let seniorDeveloperRuntime: HealthSeniorDevRuntime?
    let routes: [String]?
}
