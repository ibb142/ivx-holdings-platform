import SwiftUI

/// Full worker record: current task, backlog, blocker, ETA, evidence, approval.
struct WorkerDetailView: View {
    let worker: Worker

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerCard
                currentTaskCard
                if let blocker = worker.blocker {
                    blockerCard(blocker)
                }
                backlogCard
                if !worker.evidence.isEmpty {
                    evidenceCard
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(Theme.background)
        .navigationTitle(worker.code)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(worker.name)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                StatusPill(text: worker.state.rawValue, color: worker.state.color)
            }
            Text(worker.focus)
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)

            HStack(spacing: 8) {
                ProgressBarView(value: worker.progress, tint: worker.state.color)
                Text("\(Int(worker.progress * 100))%")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(Theme.textSecondary)
            }

            Divider().background(Theme.panelBorder)

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("EST. COMPLETION")
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundStyle(Theme.textTertiary)
                    Text(worker.estimatedCompletion)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Theme.textPrimary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("OWNER APPROVAL")
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundStyle(Theme.textTertiary)
                    StatusPill(text: worker.approval.rawValue, color: worker.approval.color)
                }
            }
        }
        .commandPanel()
    }

    private var currentTaskCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Current Task")
            Text(worker.currentTask)
                .font(.system(size: 13))
                .foregroundStyle(Theme.textPrimary)
                .commandPanel()
        }
    }

    private func blockerCard(_ blocker: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Blocker")
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "hand.raised.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.red)
                Text(blocker)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            }
            .commandPanel()
        }
    }

    private var backlogCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Backlog", trailing: "\(worker.backlog.count) items")
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(worker.backlog.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .top, spacing: 10) {
                        Text(String(format: "%02d", index + 1))
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundStyle(Theme.amber)
                            .padding(.top, 2)
                        Text(item)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            .commandPanel()
        }
    }

    private var evidenceCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Evidence", trailing: "\(worker.evidence.count) items")
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(worker.evidence.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.green)
                            .padding(.top, 1)
                        Text(item)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            .commandPanel()
        }
    }
}
