import Foundation

struct ChatMessage: Identifiable, Equatable {
    let id: String
    let role: MessageRole
    let content: String
    let provider: String?
    let timestamp: Date
    var isStreaming: Bool

    enum MessageRole: String, Codable {
        case user
        case assistant
    }

    init(id: String = UUID().uuidString, role: MessageRole, content: String, provider: String? = nil, timestamp: Date = Date(), isStreaming: Bool = false) {
        self.id = id
        self.role = role
        self.content = content
        self.provider = provider
        self.timestamp = timestamp
        self.isStreaming = isStreaming
    }
}

struct ChatResponse: Decodable {
    let ok: Bool
    let answer: String?
    let provider: String?
    let source: String?
    let model: String?
    let error: String?
}

struct HealthResponse: Decodable {
    let status: String
    let commit: String
    let bootTime: String?
}

struct OwnerLoginResponse: Decodable {
    let success: Bool
    let accessToken: String?
    let error: String?
}
