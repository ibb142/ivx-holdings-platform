import SwiftUI

struct IVXDashboardView: View {
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    marketPulse
                    portfolioCard
                    sectionHeader
                    dealRows
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
            }
            .background(Color.ivxSand.opacity(0.26))
            .navigationTitle("IVX Holdings")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Alerts", systemImage: "bell") {}
                        .accessibilityLabel("View alerts")
                }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("Private markets, made legible.")
                .font(.system(.title2, design: .serif, weight: .semibold))
                .foregroundStyle(Color.ivxInk)
            Text("Wednesday, July 24")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.top, 4)
    }

    private var marketPulse: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.seal.fill")
                .font(.title2)
                .foregroundStyle(Color.ivxCopper)
            VStack(alignment: .leading, spacing: 3) {
                Text("MARKET PULSE")
                    .font(.caption2.weight(.bold))
                    .tracking(1.2)
                    .foregroundStyle(.secondary)
                Text("Portfolio reporting is on schedule")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.ivxInk)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(.background, in: .rect(cornerRadius: 18))
        .overlay {
            RoundedRectangle(cornerRadius: 18)
                .stroke(Color.ivxCopper.opacity(0.18), lineWidth: 1)
        }
    }

    private var portfolioCard: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack {
                Text("PORTFOLIO VALUE")
                    .font(.caption2.weight(.bold))
                    .tracking(1.3)
                    .foregroundStyle(.white.opacity(0.72))
                Spacer()
                Image(systemName: "lock.fill")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.72))
            }
            Text("$0.00")
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(.white)
            HStack {
                Label("Securely connected", systemImage: "checkmark.circle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.ivxSand)
                Spacer()
                Text("Live")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(.white.opacity(0.16), in: Capsule())
            }
        }
        .padding(20)
        .background(Color.ivxInk, in: .rect(cornerRadius: 24))
    }

    private var sectionHeader: some View {
        HStack {
            Text("Featured opportunities")
                .font(.headline)
                .foregroundStyle(Color.ivxInk)
            Spacer()
            Button("Browse") {}
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.ivxCopper)
        }
    }

    private var dealRows: some View {
        VStack(spacing: 10) {
            dealRow(title: "Development pipeline", subtitle: "New opportunities are being reviewed", icon: "building.2")
            dealRow(title: "Investor updates", subtitle: "No new documents to review", icon: "doc.text")
        }
    }

    private func dealRow(title: String, subtitle: String, icon: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(Color.ivxCopper)
                .frame(width: 42, height: 42)
                .background(Color.ivxCopper.opacity(0.1), in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.ivxInk)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption.weight(.bold))
                .foregroundStyle(.tertiary)
        }
        .padding(14)
        .background(.background, in: .rect(cornerRadius: 16))
    }
}

#Preview {
    IVXDashboardView()
}