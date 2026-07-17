import SwiftUI

/// IVX brand theme — luxury fintech dark palette with gold accent.
enum Theme {
    static let background = Color(red: 0.043, green: 0.051, blue: 0.063)      // #0B0D10
    static let surface = Color(red: 0.078, green: 0.090, blue: 0.110)         // #14171C
    static let surfaceElevated = Color(red: 0.110, green: 0.125, blue: 0.150)
    static let gold = Color(red: 0.831, green: 0.686, blue: 0.216)            // #D4AF37
    static let goldSoft = Color(red: 0.831, green: 0.686, blue: 0.216).opacity(0.15)
    static let textPrimary = Color(red: 0.95, green: 0.95, blue: 0.96)
    static let textSecondary = Color(red: 0.62, green: 0.65, blue: 0.70)
    static let success = Color(red: 0.0, green: 0.77, blue: 0.55)             // #00C48C
    static let warning = Color(red: 0.96, green: 0.62, blue: 0.04)
    static let danger = Color(red: 0.94, green: 0.33, blue: 0.31)
}
