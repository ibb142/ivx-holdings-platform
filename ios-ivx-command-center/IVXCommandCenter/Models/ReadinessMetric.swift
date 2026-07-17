import Foundation

/// One axis of the enterprise readiness assessment (score out of 10).
struct ReadinessMetric: Identifiable {
    let id: String
    let name: String
    let baseline: Double
    let current: Double
    let target: Double

    var progressToTarget: Double {
        guard target > baseline else { return 1.0 }
        return min(1.0, max(0.0, (current - baseline) / (target - baseline)))
    }
}
