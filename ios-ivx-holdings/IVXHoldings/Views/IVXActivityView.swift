import SwiftUI

struct IVXActivityView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Today") {
                    activityRow(title: "Account ready", detail: "Your secure investor workspace is active.", icon: "checkmark.seal.fill")
                }
                Section("Coming next") {
                    activityRow(title: "Opportunity review", detail: "New investment materials will appear here.", icon: "eye.fill")
                    activityRow(title: "Document center", detail: "Statements and notices stay organized in one place.", icon: "folder.fill")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.ivxSand.opacity(0.26))
            .navigationTitle("Activity")
        }
    }

    private func activityRow(title: String, detail: String, icon: String) -> some View {
        HStack(alignment: .top, spacing: 13) {
            Image(systemName: icon)
                .foregroundStyle(Color.ivxCopper)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.ivxInk)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    IVXActivityView()
}