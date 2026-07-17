import Foundation

/// Full state of the autonomous execution program at a point in time.
struct ProgramSnapshot {
    let reportNumber: Int
    let generatedAt: String
    let missionStatement: String
    let workers: [Worker]
    let jobs: [Job]
    let readiness: [ReadinessMetric]
    let deployments: [Deployment]
    let builds: [BuildArtifact]
    let commits: [CommitRecord]
    let securityFindings: [SecurityFinding]
    let approvals: [ApprovalItem]
    let criticalAlerts: [String]

    var overallReadiness: Double {
        guard let metric = readiness.first(where: { $0.id == "enterprise" }) else {
            let currents = readiness.map { $0.current }
            return currents.isEmpty ? 0 : currents.reduce(0, +) / Double(currents.count)
        }
        return metric.current
    }

    var overallCompletion: Double {
        let values = workers.map { $0.progress }
        return values.isEmpty ? 0 : values.reduce(0, +) / Double(values.count)
    }

    func jobCount(_ state: JobState) -> Int {
        jobs.filter { $0.state == state }.count
    }
}
