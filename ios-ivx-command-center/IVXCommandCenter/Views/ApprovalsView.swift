import SwiftUI

/// Approvals tab: actions waiting on explicit owner sign-off.
struct ApprovalsView: View {
    let viewModel: DashboardViewModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    policyCard
                    SectionHeader(title: "Waiting on Owner", trailing: "\(viewModel.snapshot.approvals.count)")
                    ForEach(viewModel.snapshot.approvals) { approval in
                        ApprovalCard(approval: approval)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .background(Theme.background)
            .navigationTitle("Owner Approvals")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        }
    }

    private var policyCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Approval Policy", systemImage: "lock.shield.fill")
                .font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundStyle(Theme.amber)
            Text("Owner approval is required only for: production schema changes, destructive database actions, credential rotation, DNS changes, payment changes, production releases, and rollback. All analysis, testing, code fixes, and builds proceed autonomously.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
        }
        .commandPanel()
    }
}

/// Card for one pending owner approval.
struct ApprovalCard: View {
    let approval: ApprovalItem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                StatusPill(text: approval.category, color: Theme.amber)
                Spacer()
                Text("requested by \(approval.requestedBy)")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(Theme.textTertiary)
            }
            Text(approval.title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
            Text(approval.detail)
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
        }
        .commandPanel()
    }
}
