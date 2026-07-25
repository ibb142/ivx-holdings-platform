import SwiftUI

struct ContentView: View {
    @State private var selectedTab: Tab = .overview

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        Text("IVX Holdings")
                            .font(.largeTitle.bold())
                        Text("Portfolio command center")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        VStack(alignment: .leading, spacing: 10) {
                            Label("Live infrastructure", systemImage: "checkmark.seal.fill")
                                .font(.headline)
                                .foregroundStyle(.green)
                            Text("Your release status, portfolio activity, and owner controls appear here.")
                                .foregroundStyle(.secondary)
                        }
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.thinMaterial, in: .rect(cornerRadius: 20))

                        Text("Today")
                            .font(.title2.bold())
                        ForEach(["Review current holdings", "Check investment activity", "Open secure owner controls"], id: \.self) { item in
                            Label(item, systemImage: "arrow.up.right.circle")
                                .padding(.vertical, 8)
                        }
                    }
                    .padding()
                }
                .navigationTitle("Overview")
            }
            .tabItem { Label("Overview", systemImage: "rectangle.3.group.fill") }
            .tag(Tab.overview)

            NavigationStack {
                ContentUnavailableView("Portfolio", systemImage: "chart.pie.fill", description: Text("Portfolio holdings will appear here."))
                    .navigationTitle("Portfolio")
            }
            .tabItem { Label("Portfolio", systemImage: "chart.pie.fill") }
            .tag(Tab.portfolio)

            NavigationStack {
                ContentUnavailableView("Activity", systemImage: "clock.arrow.circlepath", description: Text("Recent activity will appear here."))
                    .navigationTitle("Activity")
            }
            .tabItem { Label("Activity", systemImage: "clock.arrow.circlepath") }
            .tag(Tab.activity)

            NavigationStack {
                ContentUnavailableView("Profile", systemImage: "person.crop.circle", description: Text("Owner settings will appear here."))
                    .navigationTitle("Profile")
            }
            .tabItem { Label("Profile", systemImage: "person.crop.circle") }
            .tag(Tab.profile)
        }
        .tint(.teal)
    }

    private enum Tab: Hashable {
        case overview
        case portfolio
        case activity
        case profile
    }
}

#Preview {
    ContentView()
}
