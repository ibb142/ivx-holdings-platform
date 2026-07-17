import Foundation
import Observation

@Observable
final class DashboardViewModel {
    let snapshot: ProgramSnapshot = SeedData.snapshot
    private(set) var health: HealthReport?
    private(set) var isProbing: Bool = false
    private(set) var guardian: GuardianResponse?
    private(set) var qaStatus: QASchedulerResponse?
    private(set) var guardianError: String?
    private(set) var isLoadingGuardian: Bool = false

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

    /// Live Owner Auth Guardian + continuous QA refresh from production.
    func refreshGuardian() async {
        guard !isLoadingGuardian else { return }
        isLoadingGuardian = true
        guardianError = nil
        do {
            let token = try await GuardianService.ownerToken()
            async let guardianTask = GuardianService.fetchGuardian(token: token)
            async let qaTask = GuardianService.fetchQAStatus(token: token)
            guardian = try await guardianTask
            qaStatus = try? await qaTask
        } catch {
            guardianError = error.localizedDescription
        }
        isLoadingGuardian = false
    }
}
