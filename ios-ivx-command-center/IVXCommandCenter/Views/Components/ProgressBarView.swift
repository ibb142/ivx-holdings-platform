import SwiftUI

/// Thin animated progress bar with an amber fill on a dark track.
struct ProgressBarView: View {
    let value: Double
    var tint: Color = Theme.amber

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.08))
                Capsule()
                    .fill(tint)
                    .frame(width: max(4, geometry.size.width * min(1, max(0, value))))
            }
        }
        .frame(height: 6)
        .animation(.spring(duration: 0.6), value: value)
    }
}
