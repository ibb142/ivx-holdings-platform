import SwiftUI

struct IVXPortfolioView: View {
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Your allocation")
                        .font(.system(.title2, design: .serif, weight: .semibold))
                        .foregroundStyle(Color.ivxInk)
                    Text("Connect with the IVX team to review available investments and build your allocation.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    VStack(alignment: .leading, spacing: 14) {
                        Label("Portfolio reporting", systemImage: "chart.bar.xaxis")
                            .font(.headline)
                            .foregroundStyle(Color.ivxInk)
                        Text("Your portfolio will appear here once an investment is active.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Button("Explore opportunities") {}
                            .buttonStyle(.borderedProminent)
                            .tint(.ivxCopper)
                    }
                    .padding(20)
                    .background(.background, in: .rect(cornerRadius: 22))
                    .overlay {
                        RoundedRectangle(cornerRadius: 22)
                            .stroke(Color.ivxCopper.opacity(0.16), lineWidth: 1)
                    }
                }
                .padding(16)
            }
            .background(Color.ivxSand.opacity(0.26))
            .navigationTitle("Portfolio")
        }
    }
}

#Preview {
    IVXPortfolioView()
}
