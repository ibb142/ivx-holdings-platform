import SwiftUI

@main
struct IVXHoldingsApp: App {
    @State private var authService = IVXAuthService()

    var body: some Scene {
        WindowGroup {
            if authService.isAuthenticated {
                ContentView()
                    .environment(authService)
            } else {
                IVXLoginView(authService: authService)
            }
        }
    }
}
