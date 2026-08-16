import SwiftUI

struct ContentView: View {
    @Environment(IVXAuthService.self) private var authService
    @State private var apiClient = IVXAPIClient.shared

    var body: some View {
        TabView {
            Tab("Overview", systemImage: "square.grid.2x2.fill") {
                IVXDashboardView()
            }

            Tab("Portfolio", systemImage: "chart.line.uptrend.xyaxis") {
                IVXPortfolioView()
            }

            Tab("Activity", systemImage: "bolt.horizontal.circle.fill") {
                IVXActivityView()
            }

            Tab("Profile", systemImage: "person.crop.circle") {
                IVXProfileView()
                    .environment(authService)
            }
        }
        .tint(.ivxCopper)
        .task {
            apiClient.setAuthToken(authService.authToken)
            await apiClient.checkHealth()
        }
    }
}

#Preview {
    ContentView()
        .environment(IVXAuthService())
}
