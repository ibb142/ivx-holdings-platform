import SwiftUI

/// Overview tab: readiness gauge, assessment axes, job counts, alerts.
struct DashboardView: View {
    let viewModel: DashboardViewModel

    private var snapshot: ProgramSnapshot { viewModel.snapshot }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    headerCard
                    readinessCard
                    jobCountsRow
                    workerStrip
                    alertsCard
                    productionCard
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .background(Theme.background)
            .navigationTitle("Command Center")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        }
        .task {
            await viewModel.refreshHealth()
        }
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("IVX AUTONOMOUS EXECUTION PROGRAM")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .foregroundStyle(Theme.amber)
                Spacer()
                StatusPill(text: "REPORT #\(snapshot.reportNumber)", color: Theme.blue)
            }
            Text(snapshot.missionStatement)
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
            Text("Updated \(snapshot.generatedAt)")
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(Theme.textTertiary)
        }
        .commandPanel()
    }

    private var readinessCard: some View {
        VStack(spacing: 16) {
            HStack(spacing: 20) {
                ScoreRing(
                    score: snapshot.overallReadiness,
                    target: 9,
                    label: "ENTERPRISE READINESS"
                )
                VStack(alignment: .leading, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("OVERALL COMPLETION")
                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                            .foregroundStyle(Theme.textTertiary)
                        Text("\(Int(snapshot.overallCompletion * 100))%")
                            .font(.system(size: 26, weight: .bold, design: .monospaced))
                            .foregroundStyle(Theme.textPrimary)
                        ProgressBarView(value: snapshot.overallCompletion)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("TARGET")
                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                            .foregroundStyle(Theme.textTertiary)
                        Text("9.0 / 10")
                            .font(.system(size: 15, weight: .semibold, design: .monospaced))
                            .foregroundStyle(Theme.green)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            VStack(spacing: 10) {
                ForEach(snapshot.readiness) { metric in
                    ReadinessRow(metric: metric)
                }
            }
        }
        .commandPanel()
    }

    private var jobCountsRow: some View {
        VStack(spacing: 10) {
            SectionHeader(title: "Jobs", trailing: "\(snapshot.jobs.count) total")
            HStack(spacing: 8) {
                MetricTile(value: "\(snapshot.jobCount(.running))", label: "RUNNING", color: Theme.blue)
                MetricTile(value: "\(snapshot.jobCount(.queued))", label: "QUEUED", color: Theme.textSecondary)
                MetricTile(value: "\(snapshot.jobCount(.completed))", label: "DONE", color: Theme.green)
                MetricTile(value: "\(snapshot.jobCount(.blocked))", label: "BLOCKED", color: Theme.red)
                MetricTile(value: "\(snapshot.jobCount(.failed))", label: "FAILED", color: Theme.red)
            }
        }
    }

    private var workerStrip: some View {
        VStack(spacing: 10) {
            SectionHeader(title: "AI Workers", trailing: "8 assigned")
            VStack(spacing: 8) {
                ForEach(snapshot.workers) { worker in
                    HStack(spacing: 10) {
                        Text(worker.code)
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundStyle(Theme.amber)
                            .frame(width: 28, alignment: .leading)
                        Text(worker.name)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        Spacer()
                        ProgressBarView(value: worker.progress, tint: worker.state.color)
                            .frame(width: 64)
                        StatusPill(text: worker.state.rawValue, color: worker.state.color)
                    }
                }
            }
            .commandPanel()
        }
    }

    private var alertsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Critical Alerts", trailing: "\(snapshot.criticalAlerts.count)")
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(snapshot.criticalAlerts.enumerated()), id: \.offset) { _, alert in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.red)
                            .padding(.top, 1)
                        Text(alert)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            .commandPanel()
        }
    }

    private var productionCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Production", trailing: viewModel.isProbing ? "probing…" : nil)
            HStack(spacing: 12) {
                Circle()
                    .fill(healthColor)
                    .frame(width: 10, height: 10)
                VStack(alignment: .leading, spacing: 2) {
                    Text(healthLine)
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundStyle(Theme.textPrimary)
                    Text(healthDetail)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Theme.textTertiary)
                }
                Spacer()
                Button {
                    Task { await viewModel.refreshHealth() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.amber)
                        .frame(width: 44, height: 44)
                }
            }
            .commandPanel()
        }
    }

    private var healthColor: Color {
        guard let health = viewModel.health else { return Theme.textTertiary }
        return health.isReachable ? Theme.green : Theme.red
    }

    private var healthLine: String {
        guard let health = viewModel.health else { return "api.ivxholding.com — awaiting probe" }
        return health.isReachable
            ? "LIVE — HTTP \(health.httpStatus) · \(health.latencyMs)ms"
            : "UNREACHABLE"
    }

    private var healthDetail: String {
        guard let health = viewModel.health else { return "" }
        let match = viewModel.shaMatchesProduction ? "matches deploy ✓" : "sha mismatch"
        return "sha \(health.commitSha) — \(match)"
    }
}

/// One row of the assessment breakdown showing baseline → current → target.
struct ReadinessRow: View {
    let metric: ReadinessMetric

    var body: some View {
        VStack(spacing: 4) {
            HStack {
                Text(metric.name)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                Text("\(formatted(metric.baseline)) → \(formatted(metric.current)) / \(formatted(metric.target))")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(metric.current > metric.baseline ? Theme.green : Theme.textTertiary)
            }
            ProgressBarView(
                value: metric.current / 10,
                tint: metric.current >= metric.target ? Theme.green : Theme.amber
            )
        }
    }

    private func formatted(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
    }
}
