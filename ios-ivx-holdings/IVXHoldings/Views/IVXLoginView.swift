import SwiftUI

struct IVXLoginView: View {
    @ObservedObject var authService: IVXAuthService
    @State private var email: String = IVXConfig.ownerEmail
    @State private var password: String = ""
    @State private var showPassword: Bool = false

    var body: some View {
        ZStack {
            Color.ivxInk.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                VStack(spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(Color.ivxCopper)
                            .frame(width: 88, height: 88)
                        Text("IV")
                            .font(.system(.largeTitle, design: .rounded, weight: .heavy))
                            .foregroundStyle(Color.ivxInk)
                    }

                    Text("IVX Holdings")
                        .font(.system(.title, design: .serif, weight: .bold))
                        .foregroundStyle(.white)

                    Text("Unified Command Center")
                        .font(.subheadline)
                        .foregroundStyle(Color.ivxCopper)
                }

                Spacer()

                VStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("EMAIL")
                            .font(.caption2.weight(.bold))
                            .tracking(1.2)
                            .foregroundStyle(.white.opacity(0.5))

                        TextField("", text: $email, prompt: Text("you@company.com").foregroundStyle(.white.opacity(0.3)))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.emailAddress)
                            .textContentType(.emailAddress)
                            .padding(14)
                            .background(Color.white.opacity(0.06), in: .rect(cornerRadius: 14))
                            .foregroundStyle(.white)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("PASSWORD")
                            .font(.caption2.weight(.bold))
                            .tracking(1.2)
                            .foregroundStyle(.white.opacity(0.5))

                        HStack {
                            if showPassword {
                                TextField("", text: $password, prompt: Text("Enter password").foregroundStyle(.white.opacity(0.3)))
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .textContentType(.password)
                                    .foregroundStyle(.white)
                            } else {
                                SecureField("", text: $password, prompt: Text("Enter password").foregroundStyle(.white.opacity(0.3)))
                                    .textContentType(.password)
                                    .foregroundStyle(.white)
                            }
                            Button {
                                showPassword.toggle()
                            } label: {
                                Image(systemName: showPassword ? "eye.slash" : "eye")
                                    .foregroundStyle(.white.opacity(0.4))
                            }
                        }
                        .padding(14)
                        .background(Color.white.opacity(0.06), in: .rect(cornerRadius: 14))
                    }

                    if let error = authService.errorMessage {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red.opacity(0.8))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button {
                        Task {
                            await authService.login(email: email, password: password)
                        }
                    } label: {
                        HStack {
                            if authService.isLoading {
                                ProgressView()
                                    .tint(Color.ivxInk)
                            }
                            Text(authService.isLoading ? "Signing in..." : "Sign In")
                                .font(.headline.weight(.semibold))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(Color.ivxCopper, in: .rect(cornerRadius: 14))
                        .foregroundStyle(Color.ivxInk)
                    }
                    .disabled(authService.isLoading || email.isEmpty || password.isEmpty)
                    .opacity((authStateIsValid) ? 1.0 : 0.5)
                }
                .padding(24)
                .background(Color.white.opacity(0.04), in: .rect(cornerRadius: 24))

                Spacer()

                VStack(spacing: 4) {
                    Text("v\(IVXConfig.appVersion) (\(IVXConfig.buildNumber))")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.3))
                    Text("com.ivxholdings.app")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.3))
                }
                .padding(.bottom, 24)
            }
            .padding(.horizontal, 20)
        }
    }

    private var authStateIsValid: Bool {
        !email.isEmpty && !password.isEmpty && !authService.isLoading
    }
}

#Preview {
    IVXLoginView(authService: IVXAuthService())
}
