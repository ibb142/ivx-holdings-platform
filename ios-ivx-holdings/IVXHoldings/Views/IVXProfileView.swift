import SwiftUI

struct IVXProfileView: View {
    @Environment(IVXAuthService.self) private var authService
    @State private var apiClient = IVXAPIClient.shared

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 14) {
                        Image(systemName: "person.crop.circle.fill")
                            .font(.system(size: 46))
                            .foregroundStyle(Color.ivxCopper)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(authService.userEmail ?? "IVX Investor")
                                .font(.headline)
                            Text(authService.userRole == "owner" ? "Owner" : "Member")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 6)
                }

                Section("Platform") {
                    LabeledContent("Status") {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(apiClient.isLive ? .green : .red)
                                .frame(width: 8, height: 8)
                            Text(apiClient.healthStatus)
                                .foregroundStyle(apiClient.isLive ? .green : .red)
                        }
                    }
                    LabeledContent("Version", value: "v\(IVXConfig.appVersion)")
                    LabeledContent("Commit", value: apiClient.commitShort)
                    LabeledContent("API", value: "ivx-holdings-platform.onrender.com")
                }

                Section("Workspace") {
                    Label("Notifications", systemImage: "bell")
                    Label("Security & privacy", systemImage: "lock")
                    Label("Help center", systemImage: "questionmark.circle")
                }

                Section {
                    Button(role: .destructive) {
                        authService.logout()
                    } label: {
                        Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }

                Section {
                    Text("IVX Holdings provides a clear, secure way to follow private-market opportunities.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Profile")
            .task {
                await apiClient.checkHealth()
            }
        }
    }
}

#Preview {
    IVXProfileView()
        .environment(IVXAuthService())
}
