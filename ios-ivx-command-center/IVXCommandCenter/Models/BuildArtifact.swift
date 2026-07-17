import Foundation

/// A mobile build artifact (APK / IPA) tracked by the program.
struct BuildArtifact: Identifiable {
    let id: String
    let platform: String
    let version: String
    let buildNumber: String
    let sizeDescription: String
    let checksumShort: String
    let signing: String
    let status: String
    let note: String
}
