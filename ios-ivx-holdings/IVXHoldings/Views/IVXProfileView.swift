import SwiftUI

struct IVXProfileView: View {
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 14) {
                        Image(systemName: "person.crop.circle.fill")
                            .font(.system(size: 46))
                            .foregroundStyle(Color.ivxCopper)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("IVX Investor")
                                .font(.headline)
                            Text("Secure member workspace")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 6)
                }

                Section("Workspace") {
                    Label("Notifications", systemImage: "bell")
                    Label("Security & privacy", systemImage: "lock")
                    Label("Help center", systemImage: "questionmark.circle")
                }

                Section {
                    Text("IVX Holdings provides a clear, secure way to follow private-market opportunities.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Profile")
        }
    }
}

#Preview {
    IVXProfileView()
}