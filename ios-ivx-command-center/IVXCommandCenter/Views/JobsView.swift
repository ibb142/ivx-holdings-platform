import SwiftUI

/// Jobs tab: every tracked unit of work, filterable by state.
struct JobsView: View {
    let viewModel: DashboardViewModel

    @State private var selectedFilter: JobState? = nil

    private var filteredJobs: [Job] {
        guard let selectedFilter else { return viewModel.snapshot.jobs }
        return viewModel.snapshot.jobs.filter { $0.state == selectedFilter }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                filterBar
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(filteredJobs) { job in
                            JobRow(job: job)
                        }
                        if filteredJobs.isEmpty {
                            Text("No jobs in this state")
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(Theme.textTertiary)
                                .padding(.top, 40)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 24)
                }
            }
            .background(Theme.background)
            .navigationTitle("Jobs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        }
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                filterChip(nil, label: "ALL (\(viewModel.snapshot.jobs.count))")
                ForEach(JobState.allCases, id: \.self) { state in
                    filterChip(state, label: "\(state.rawValue) (\(viewModel.snapshot.jobCount(state)))")
                }
            }
        }
        .contentMargins(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private func filterChip(_ state: JobState?, label: String) -> some View {
        let isSelected = selectedFilter == state
        let color = state?.color ?? Theme.amber
        return Button {
            withAnimation(.spring(duration: 0.25)) {
                selectedFilter = state
            }
        } label: {
            Text(label)
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundStyle(isSelected ? Theme.background : color)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(isSelected ? color : color.opacity(0.12))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

/// Single job row with state icon and evidence line.
struct JobRow: View {
    let job: Job

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: job.state.icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(job.state.color)
                .frame(width: 22)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 4) {
                Text(job.title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textPrimary)
                if let evidence = job.evidence {
                    Text(evidence)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Theme.textTertiary)
                }
            }

            Spacer()

            Text(job.workerCode)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(Theme.amber)
        }
        .commandPanel()
    }
}
