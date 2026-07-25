//
//  ContentView.swift
//  IVXHoldings
//
//  Created by Rork on July 25, 2026.
//

import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            PortfolioView()
                .tabItem { Label("Portfolio", systemImage: "chart.pie.fill") }

            ActivityView()
                .tabItem { Label("Activity", systemImage: "waveform.path.ecg") }

            ProfileView()
                .tabItem { Label("Profile", systemImage: "person.crop.circle") }
        }
        .tint(Color(red: 0.72, green: 0.48, blue: 0.10))
    }
}

private struct PortfolioView: View {
    private let holdings: [(name: String, value: String, change: String)] = [
        ("Industrial Income Fund", "$482,400", "+4.8%"),
        ("Sunbelt Multifamily", "$318,250", "+2.1%"),
        ("Private Credit", "$146,800", "+6.4%")
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text("IVX HOLDINGS")
                        .font(.caption.weight(.bold))
                        .tracking(2)
                        .foregroundStyle(.secondary)

                    Text("Your portfolio")
                        .font(.largeTitle.bold())

                    VStack(alignment: .leading, spacing: 10) {
                        Text("NET ASSET VALUE")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text("$947,450")
                            .font(.system(size: 42, weight: .bold, design: .rounded))
                        Label("$38,920 this quarter", systemImage: "arrow.up.right")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.green)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(24)
                    .background(Color(red: 0.10, green: 0.15, blue: 0.13))
                    .foregroundStyle(.white)
                    .clipShape(.rect(cornerRadius: 24))

                    Text("Holdings")
                        .font(.title2.bold())

                    ForEach(holdings, id: \.name) { holding in
                        HStack(spacing: 14) {
                            Image(systemName: "building.2.fill")
                                .frame(width: 42, height: 42)
                                .background(Color(red: 0.91, green: 0.85, blue: 0.70))
                                .foregroundStyle(Color(red: 0.30, green: 0.20, blue: 0.05))
                                .clipShape(.circle)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(holding.name).font(.headline)
                                Text(holding.change).font(.subheadline.weight(.medium)).foregroundStyle(.green)
                            }
                            Spacer()
                            Text(holding.value).font(.headline)
                        }
                        .padding(.vertical, 8)
                    }
                }
                .padding(20)
            }
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct ActivityView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                "No new activity",
                systemImage: "checkmark.seal.fill",
                description: Text("Portfolio updates and distributions will appear here.")
            )
            .navigationTitle("Activity")
        }
    }
}

private struct ProfileView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Account") {
                    Label("Investor profile", systemImage: "person.text.rectangle")
                    Label("Documents", systemImage: "doc.text")
                }
                Section("Support") {
                    Label("Contact IVX", systemImage: "bubble.left.and.bubble.right")
                }
            }
            .navigationTitle("Profile")
        }
    }
}

#Preview {
    ContentView()
}
