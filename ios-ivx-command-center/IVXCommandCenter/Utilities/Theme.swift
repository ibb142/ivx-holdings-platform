import SwiftUI

/// Central design tokens for the IVX Command Center dark ops aesthetic.
enum Theme {
    static let background = Color(red: 0.043, green: 0.059, blue: 0.078)
    static let panel = Color(red: 0.078, green: 0.102, blue: 0.133)
    static let panelBorder = Color.white.opacity(0.07)
    static let amber = Color(red: 1.0, green: 0.69, blue: 0.125)
    static let green = Color(red: 0.204, green: 0.827, blue: 0.6)
    static let red = Color(red: 0.973, green: 0.443, blue: 0.443)
    static let blue = Color(red: 0.376, green: 0.647, blue: 0.98)
    static let textPrimary = Color.white.opacity(0.92)
    static let textSecondary = Color.white.opacity(0.55)
    static let textTertiary = Color.white.opacity(0.35)

    static func panelCard() -> some ShapeStyle {
        panel
    }
}

extension View {
    /// Standard command-center panel styling.
    func commandPanel() -> some View {
        self
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.panel)
            .clipShape(.rect(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(Theme.panelBorder, lineWidth: 1)
            )
    }
}
