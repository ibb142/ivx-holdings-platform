import Foundation
import Observation

@Observable
final class DashboardViewModel {
    let snapshot: ProgramSnapshot = SeedData.snapshot
    private(set) var health: HealthReport?
    private(set) var isProbing: Bool = false

    var expectedProductionSha: String {
        snapshot.deployments.first?.commitSha ?? "unknown"
    }

    var shaMatchesProduction: Bool {
        guard let health, health.isReachable else { return false }
        return health.commitSha == expectedProductionSha
    }

    func refreshHealth() async {
        guard !isProbing else { return }
        isProbing = true
        let report = await HealthService.probe()
        health = report
        isProbing = false
    }
}
