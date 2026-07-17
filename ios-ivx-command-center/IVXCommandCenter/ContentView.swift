import SwiftUI

/// Root of the IVX Command Center — five dashboard tabs on a dark ops theme.
struct ContentView: View {
    @State private var viewModel = DashboardViewModel()

    var body: some View {
        TabView {
            DashboardView(viewModel: viewModel)
                .tabItem {
                    Label("Overview", systemImage: "gauge.with.dots.needle.67percent")
                }

            WorkersView(viewModel: viewModel)
                .tabItem {
                    Label("Workers", systemImage: "cpu")
                }

            JobsView(viewModel: viewModel)
                .tabItem {
                    Label("Jobs", systemImage: "list.bullet.rectangle")
                }

            HealthView(viewModel: viewModel)
                .tabItem {
                    Label("Health", systemImage: "waveform.path.ecg")
                }

            ApprovalsView(viewModel: viewModel)
                .tabItem {
                    Label("Approvals", systemImage: "checkmark.shield")
                }
        }
        .tint(Theme.amber)
        .preferredColorScheme(.dark)
    }
}

#Preview {
    ContentView()
}
