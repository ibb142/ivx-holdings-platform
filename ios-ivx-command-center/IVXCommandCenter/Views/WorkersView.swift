import SwiftUI

/// Workers tab: all 8 autonomous workstreams with drill-down detail.
struct WorkersView: View {
    let viewModel: DashboardViewModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(viewModel.snapshot.workers) { worker in
                        NavigationLink(value: worker.id) {
                            WorkerCard(worker: worker)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .background(Theme.background)
            .navigationTitle("AI Workers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .navigationDestination(for: String.self) { workerId in
                if let worker = viewModel.snapshot.workers.first(where: { $0.id == workerId }) {
                    WorkerDetailView(worker: worker)
                }
            }
        }
    }
}

/// Summary card for one worker in the list.
struct WorkerCard: View {
    let worker: Worker

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(worker.code)
                    .font(.system(size: 13, weight: .bold, design: .monospaced))
                    .foregroundStyle(Theme.amber)
                Text(worker.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Spacer()
                StatusPill(text: worker.state.rawValue, color: worker.state.color)
            }

            Text(worker.currentTask)
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(2)

            HStack(spacing: 8) {
                ProgressBarView(value: worker.progress, tint: worker.state.color)
                Text("\(Int(worker.progress * 100))%")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(Theme.textTertiary)
                    .frame(width: 32, alignment: .trailing)
            }

            HStack {
                Label("\(worker.backlog.count) backlog", systemImage: "list.bullet")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(Theme.textTertiary)
                Spacer()
                if worker.blocker != nil {
                    Label("blocked", systemImage: "hand.raised.fill")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(Theme.red)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .commandPanel()
    }
}
