import SwiftUI

/// Health tab: live production probe, deployments, builds, commits, security.
struct HealthView: View {
    let viewModel: DashboardViewModel

    private var snapshot: ProgramSnapshot { viewModel.snapshot }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    liveHealthCard
                    deploymentsSection
                    buildsSection
                    commitsSection
                    securitySection
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .background(Theme.background)
            .navigationTitle("Health & Releases")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .refreshable {
                await viewModel.refreshHealth()
            }
        }
        .task {
            await viewModel.refreshHealth()
        }
    }

    private var liveHealthCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Live Production Probe")
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 12, height: 12)
                    Text("api.ivxholding.com/health")
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundStyle(Theme.textPrimary)
                    Spacer()
                    if viewModel.isProbing {
                        ProgressView()
                            .tint(Theme.amber)
                    }
                }
                if let health = viewModel.health {
                    Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                        GridRow {
                            gridLabel("STATUS")
                            gridValue(health.isReachable ? "HTTP \(health.httpStatus) OK" : "UNREACHABLE",
                                      color: health.isReachable ? Theme.green : Theme.red)
                        }
                        GridRow {
                            gridLabel("LATENCY")
                            gridValue("\(health.latencyMs) ms", color: Theme.textPrimary)
                        }
                        GridRow {
                            gridLabel("DEPLOYED SHA")
                            gridValue(health.commitSha, color: Theme.textPrimary)
                        }
                        GridRow {
                            gridLabel("TRACEABILITY")
                            gridValue(viewModel.shaMatchesProduction ? "GitHub == Render == /health ✓" : "verify pending",
                                      color: viewModel.shaMatchesProduction ? Theme.green : Theme.amber)
                        }
                    }
                } else {
                    Text("Pull to refresh or wait for the automatic probe.")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textTertiary)
                }
            }
            .commandPanel()
        }
    }

    private var statusColor: Color {
        guard let health = viewModel.health else { return Theme.textTertiary }
        return health.isReachable ? Theme.green : Theme.red
    }

    private func gridLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .foregroundStyle(Theme.textTertiary)
    }

    private func gridValue(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .medium, design: .monospaced))
            .foregroundStyle(color)
    }

    private var deploymentsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Deployments", trailing: "\(snapshot.deployments.count)")
            ForEach(snapshot.deployments) { deployment in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(deployment.deployId)
                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                            .foregroundStyle(Theme.textPrimary)
                        Spacer()
                        StatusPill(text: deployment.status, color: Theme.green)
                    }
                    Text(deployment.service)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Theme.textSecondary)
                    Text("sha \(deployment.commitSha) — \(deployment.note)")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Theme.textTertiary)
                }
                .commandPanel()
            }
        }
    }

    private var buildsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Mobile Builds", trailing: "\(snapshot.builds.count)")
            ForEach(snapshot.builds) { build in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("\(build.platform) \(build.version) (\(build.buildNumber))")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                        Spacer()
                        StatusPill(
                            text: build.status,
                            color: build.status == "DELIVERED" ? Theme.green : (build.status == "BUILT" ? Theme.blue : Theme.textTertiary)
                        )
                    }
                    Text("\(build.sizeDescription) · \(build.checksumShort) · \(build.signing)")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Theme.textSecondary)
                    Text(build.note)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textTertiary)
                }
                .commandPanel()
            }
        }
    }

    private var commitsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Git Commits", trailing: "\(snapshot.commits.count) this phase")
            VStack(alignment: .leading, spacing: 10) {
                ForEach(snapshot.commits) { commit in
                    HStack(alignment: .top, spacing: 10) {
                        Text(commit.sha)
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundStyle(Theme.amber)
                        Text(commit.message)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary)
                        Spacer()
                        if commit.deployed {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 11))
                                .foregroundStyle(Theme.green)
                        }
                    }
                }
            }
            .commandPanel()
        }
    }

    private var securitySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Security Findings", trailing: "\(snapshot.securityFindings.count)")
            ForEach(snapshot.securityFindings) { finding in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(finding.title)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                        Spacer()
                        StatusPill(text: finding.status.rawValue, color: finding.status.color)
                    }
                    if finding.severity != "—" {
                        Text("SEVERITY: \(finding.severity)")
                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                            .foregroundStyle(finding.severity == "CRITICAL" ? Theme.red : Theme.amber)
                    }
                    Text(finding.detail)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textTertiary)
                }
                .commandPanel()
            }
        }
    }
}
