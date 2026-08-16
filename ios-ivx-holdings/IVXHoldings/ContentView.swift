import SwiftUI

struct ContentView: View {
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
            }
        }
        .tint(.ivxCopper)
    }
}

#Preview {
    ContentView()
}

extension Color {
    static let ivxInk: Color = Color(red: 0.055, green: 0.071, blue: 0.075)
    static let ivxCopper: Color = Color(red: 0.76, green: 0.42, blue: 0.20)
    static let ivxSand: Color = Color(red: 0.94, green: 0.90, blue: 0.82)
}