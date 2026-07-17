import SwiftUI

/// Circular gauge showing a score out of 10 against a target.
struct ScoreRing: View {
    let score: Double
    let target: Double
    let label: String

    @State private var animatedFraction: Double = 0

    private var fraction: Double {
        min(1, max(0, score / 10))
    }

    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                Circle()
                    .stroke(Color.white.opacity(0.08), lineWidth: 10)
                Circle()
                    .trim(from: 0, to: animatedFraction)
                    .stroke(
                        AngularGradient(
                            colors: [Theme.amber.opacity(0.6), Theme.amber],
                            center: .center
                        ),
                        style: StrokeStyle(lineWidth: 10, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                Circle()
                    .trim(from: min(1, target / 10) - 0.002, to: min(1, target / 10) + 0.002)
                    .stroke(Theme.green, style: StrokeStyle(lineWidth: 16, lineCap: .butt))
                    .rotationEffect(.degrees(-90))

                VStack(spacing: 2) {
                    Text(String(format: "%.1f", score))
                        .font(.system(size: 34, weight: .bold, design: .monospaced))
                        .foregroundStyle(Theme.textPrimary)
                    Text("of 10")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Theme.textTertiary)
                }
            }
            .frame(width: 140, height: 140)

            Text(label)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(Theme.textSecondary)
        }
        .onAppear {
            withAnimation(.spring(duration: 1.2)) {
                animatedFraction = fraction
            }
        }
    }
}
