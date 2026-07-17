import Foundation

/// A single message in the IVX IA owner chat.
nonisolated struct ChatMessage: Identifiable, Equatable {
    enum Role: String {
        case owner
        case assistant
    }

    let id: UUID
    let role: Role
    let text: String
    let timestamp: Date

    init(role: Role, text: String) {
        self.id = UUID()
        self.role = role
        self.text = text
        self.timestamp = Date()
    }
}

nonisolated struct OwnerAIResponse: Codable {
    let status: String?
    let answer: String?
    let response: String?
    let conversationId: String?
    let model: String?
    let error: String?

    var bestAnswer: String {
        answer ?? response ?? error ?? "No response received."
    }
}
