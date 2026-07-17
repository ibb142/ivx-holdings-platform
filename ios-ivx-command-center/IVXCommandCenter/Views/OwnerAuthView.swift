import SwiftUI

/// Owner Authentication tab — live Owner Auth Guardian probes, incidents,
/// continuous QA scheduler status and SMS alert log, all from production.
struct OwnerAuthView: View {
    let viewModel: DashboardViewModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    overallCard
                    probesSection
                    incidentsSection
                    qaSchedulerSection
                    smsSection
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .background(Theme.background)
            .navigationTitle("Owner Authentication")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .refreshable {
                await viewModel.refreshGuardian()
            }
        }
        .task {
            await viewModel.refreshGuardian()
        }
    }

    private var overallCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Auth Guardian", trailing: viewModel.guardian?.marker ?? "live probe")
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Circle()
                        .fill(overallColor)
                        .frame(width: 12, height: 12)
                    Text(viewModel.guardian?.overall ?? (viewModel.isLoadingGuardian ? "PROBING…" : "PULL TO REFRESH"))
                        .font(.system(size: 15, weight: .bold, design: .monospaced))
                        .foregroundStyle(overallColor)
                    Spacer()
                    if viewModel.isLoadingGuardian {
                        ProgressView()
                            .tint(Theme.amber)
                    }
                }
                if let guardian = viewModel.guardian {
                    Text("run #\(guardian.totalRuns ?? 0) · \(guardian.generatedAt ?? "—")")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Theme.textTertiary)
                }
                if let errorMessage = viewModel.guardianError {
                    Text(errorMessage)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.red)
                }
            }
            .commandPanel()
        }
    }

    private var overallColor: Color {
        guard let overall = viewModel.guardian?.overall else { return Theme.textTertiary }
        return overall == "HEALTHY" ? Theme.green : Theme.red
    }

    private var probesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Live Probes", trailing: "\(viewModel.guardian?.probes?.count ?? 0)")
            ForEach(viewModel.guardian?.probes ?? []) { probe in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Circle()
                            .fill(probe.ok ? Theme.green : Theme.red)
                            .frame(width: 9, height: 9)
                        Text(probe.name)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                        Spacer()
                        StatusPill(text: probe.ok ? "OK" : "FAIL", color: probe.ok ? Theme.green : Theme.red)
                    }
                    Text("HTTP \(probe.httpStatus.map(String.init) ?? "—") · \(probe.latencyMs) ms · \(probe.detail)")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Theme.textSecondary)
                }
                .commandPanel()
            }
        }
    }

    private var incidentsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Open Incidents", trailing: "\(viewModel.guardian?.openIncidents?.count ?? 0)")
            if let incidents = viewModel.guardian?.openIncidents, !incidents.isEmpty {
                ForEach(incidents) { incident in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(incident.incidentId)
                                .font(.system(size: 12, weight: .bold, design: .monospaced))
                                .foregroundStyle(Theme.red)
                            Spacer()
                            StatusPill(text: incident.status, color: Theme.red)
                        }
                        Text(incident.detail)
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.textSecondary)
                        Text("opened \(incident.openedAt)")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(Theme.textTertiary)
                    }
                    .commandPanel()
                }
            } else {
                Text(viewModel.guardian == nil ? "Waiting for live data…" : "No open authentication incidents.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .commandPanel()
            }
        }
    }

    private var qaSchedulerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Continuous QA", trailing: qaBadgeText)
            VStack(alignment: .leading, spacing: 10) {
                if let qa = viewModel.qaStatus {
                    HStack {
                        Circle()
                            .fill(qa.schedulerRunning == true ? Theme.green : Theme.red)
                            .frame(width: 10, height: 10)
                        Text(qa.schedulerRunning == true ? "RUNNING 24/7" : "STOPPED")
                            .font(.system(size: 13, weight: .bold, design: .monospaced))
                            .foregroundStyle(qa.schedulerRunning == true ? Theme.green : Theme.red)
                        Spacer()
                        Text("\(qa.totalRuns ?? 0) runs")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(Theme.textTertiary)
                    }
                    Text("health 5m · auth 15m · full matrix 2h")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Theme.textSecondary)
                    ForEach((qa.recentRuns ?? []).prefix(6)) { run in
                        HStack(alignment: .top, spacing: 8) {
                            Circle()
                                .fill(run.ok ? Theme.green : Theme.red)
                                .frame(width: 8, height: 8)
                                .padding(.top, 3)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(run.runId) · \(run.kind)")
                                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                    .foregroundStyle(Theme.textPrimary)
                                Text("\(run.at) · \(run.summary)")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(Theme.textTertiary)
                            }
                        }
                    }
                } else {
                    Text("Waiting for QA scheduler data…")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .commandPanel()
        }
    }

    private var qaBadgeText: String {
        guard let qa = viewModel.qaStatus else { return "—" }
        let healthState = qa.healthOk == true ? "health OK" : "health ?"
        let authState = qa.authOk == true ? "auth OK" : "auth ?"
        return "\(healthState) · \(authState)"
    }

    private var smsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "SMS Owner Alerts", trailing: viewModel.guardian?.smsProvider?.ready == true ? "READY" : "NOT READY")
            VStack(alignment: .leading, spacing: 8) {
                if let provider = viewModel.guardian?.smsProvider {
                    HStack {
                        Text((provider.provider ?? "aws_sns").uppercased())
                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                            .foregroundStyle(Theme.textPrimary)
                        Spacer()
                        StatusPill(
                            text: provider.awsCredentialsConfigured == true ? "CREDS OK" : "CREDS MISSING",
                            color: provider.awsCredentialsConfigured == true ? Theme.green : Theme.red
                        )
                    }
                    Text("phone \(provider.ownerPhoneMasked ?? "—") · \(provider.phoneSource ?? "—") · \(provider.awsRegion ?? "—")")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Theme.textSecondary)
                    if provider.awsCredentialsConfigured != true {
                        Text("Owner action: set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY on the Render service to activate SMS alerts.")
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.amber)
                    }
                } else {
                    Text("Waiting for live data…")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                }
                ForEach((viewModel.guardian?.recentAlerts ?? []).prefix(5)) { alert in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text("\(alert.alertId) · \(alert.severity)")
                                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                .foregroundStyle(Theme.textPrimary)
                            Spacer()
                            StatusPill(
                                text: alert.smsStatus.uppercased(),
                                color: alert.smsStatus == "sent" ? Theme.green : Theme.red
                            )
                        }
                        Text("\(alert.problem) · to \(alert.toMasked) · \(alert.sentAt)")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(Theme.textTertiary)
                        if let messageId = alert.messageId {
                            Text("MessageId \(messageId)")
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(Theme.green)
                        }
                    }
                }
            }
            .commandPanel()
        }
    }
}

#Preview {
    OwnerAuthView(viewModel: DashboardViewModel())
}
