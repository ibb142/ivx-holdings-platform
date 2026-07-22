import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, Component, type ReactNode } from "react";
import { StyleSheet, View, Text, Platform, TouchableOpacity } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Diagnostic error boundary — shows the FULL crash on screen
import { DiagnosticErrorBoundary } from "@/components/DiagnosticErrorBoundary";
import { injectWebKeyboardCSS } from "@/hooks/useWebKeyboard";
import { checkForUpdates } from "@/lib/app-update-checker";
import { logStartup, logStartupError } from "@/lib/startup-trace";

// Static imports — all providers with per-provider error boundaries
import { I18nProvider } from "@/lib/i18n-context";
import { AuthProvider } from "@/lib/auth-context";
import { AnalyticsProvider } from "@/lib/analytics-context";
import { IPXProvider } from "@/lib/ipx-context";
import { WalletProvider } from "@/lib/wallet-context";
import { EarnProvider } from "@/lib/earn-context";
import { EmailProvider } from "@/lib/email-context";
import { NetworkProvider } from "@/lib/network-context";
import Colors from "@/constants/colors";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 2,
      refetchOnMount: true,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
      networkMode: 'online',
    },
    mutations: {
      retry: 1,
      networkMode: 'online',
    },
  },
});

// Prevent native splash from auto-hiding before React renders.
// Without this, Android dismisses the native splash before the JS bundle
// has loaded and rendered the first screen, producing a black screen.
SplashScreen.preventAutoHideAsync().catch((err: unknown) => {
  console.warn("[IVX] SplashScreen.preventAutoHideAsync failed:", err);
});

// Re-export expo-router's ErrorBoundary for route-level catches
export { ErrorBoundary } from "expo-router";

// --- Per-provider error boundary: isolates which provider crashed
interface ProviderBoundaryProps {
  name: string;
  children: ReactNode;
}
interface ProviderBoundaryState {
  hasError: boolean;
  error: Error | null;
  traceId: string | null;
}
function classifyProviderError(error: Error): 'RENDER_ERROR' | 'AUTH_ERROR' | 'NETWORK_ERROR' | 'CONFIG_ERROR' | 'UNKNOWN_ERROR' {
  const msg = (error.message || '').toLowerCase();
  if (msg.includes('maximum update depth') || msg.includes('render') || msg.includes('component')) return 'RENDER_ERROR';
  if (msg.includes('auth') || msg.includes('session') || msg.includes('token')) return 'AUTH_ERROR';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) return 'NETWORK_ERROR';
  if (msg.includes('supabase url') || msg.includes('config') || msg.includes('api key')) return 'CONFIG_ERROR';
  return 'UNKNOWN_ERROR';
}
class ProviderBoundary extends Component<ProviderBoundaryProps, ProviderBoundaryState> {
  constructor(props: ProviderBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, traceId: null };
  }
  static getDerivedStateFromError(error: Error): Partial<ProviderBoundaryState> {
    return {
      hasError: true,
      error,
      traceId: 'IVX-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8),
    };
  }
  componentDidCatch(error: Error) {
    const category = classifyProviderError(error);
    console.warn(`[IVX] Provider "${this.props.name}" crashed — category: ${category}`, error.message, error.stack);
  }
  render() {
    if (this.state.hasError) {
      const category = this.state.error ? classifyProviderError(this.state.error) : 'UNKNOWN_ERROR';
      return (
        <View style={styles.providerError}>
          <Text style={styles.providerErrorName}>IVX encountered a rendering error</Text>
          <Text style={styles.providerErrorMsg}>
            {category}: {this.state.error?.message || "Unknown error"}
          </Text>
          {this.state.traceId && (
            <Text style={styles.providerErrorTrace}>Trace ID: {this.state.traceId}</Text>
          )}
          <TouchableOpacity style={styles.providerErrorButton} onPress={() => this.setState({ hasError: false, error: null, traceId: null })}>
            <Text style={styles.providerErrorButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

/** Lightweight probe that logs the checkpoint when the provider tree is mounted. */
function ProviderMountProbe({ children }: { children: ReactNode }) {
  useEffect(() => {
    logStartup('PROVIDERS_STARTED');
    logStartup('PROVIDERS_COMPLETED');
    logStartup('PROVIDERS_MOUNTED');
  }, []);
  return <>{children}</>;
}

export default function RootLayout() {
  logStartup('ROOT_COMPONENT_MOUNTED');
  logStartup('APP_MOUNTED');
  logStartup('ROOT_LAYOUT_RENDERED');
  logStartup('ERROR_BOUNDARY_MOUNTED');

  useEffect(() => {
    // Inject Samsung keyboard CSS on web — ensures inputs are focusable
    // and editable on Samsung Internet / Android Chrome.
    try {
      injectWebKeyboardCSS();
    } catch (err) {
      console.warn("[IVX] injectWebKeyboardCSS failed:", err);
    }

    // Defer splash screen dismissal to the next frame so the React tree has
    // rendered at least one frame before the native splash disappears.
    // This prevents the black frame between splash and first paint.
    const hideTimer = setTimeout(() => {
      logStartup('SPLASH_HIDE_STARTED');
      SplashScreen.hideAsync()
        .then(() => {
          logStartup('SPLASH_HIDE_COMPLETED');
          logStartup('APP_INTERACTIVE');
        })
        .catch((err: unknown) => {
          logStartupError('SPLASH_HIDE_COMPLETED', err);
          // Even if splash hide fails, the React tree is already rendered
          // underneath — the app is interactive.
          logStartup('APP_INTERACTIVE');
          console.warn('[IVX] SplashScreen.hideAsync failed:', err);
        });
    }, 0);

    // Non-fatal OTA update check — runs in background, NEVER crashes the app.
    // If the update server is unreachable, the app continues with the
    // embedded or cached bundle. See lib/ota-error-handler.ts for details.
    checkForUpdates().catch((err) => {
      console.warn("[IVX] OTA update check failed (non-fatal):", err);
    });

    // Defer all startup instrumentation to after first paint.
    // These modules (incident capture, owner AI watchdog) are owner-only
    // and should not block the initial bundle download or app boot.
    const deferredTimer = setTimeout(() => {
      try {
        const { installTextNodeGuard } = require("@/lib/text-node-guard");
        installTextNodeGuard();
      } catch (err) {
        console.warn("[IVX] installTextNodeGuard failed", err);
      }
      try {
        const { installIVXIncidentCapture } = require("@/lib/ivx-incident-client");
        installIVXIncidentCapture();
      } catch (err) {
        console.warn("[IVX] installIVXIncidentCapture failed", err);
      }
      // Owner AI watchdog bridge — only needed when owner chat is active.
      // Load lazily so it doesn't block startup for non-owner users.
      try {
        const { installIVXWatchdogIncidentBridge } = require("@/lib/ivx-incident-client");
        const { ivxAIWatchdog } = require("@/src/modules/ivx-owner-ai/services/ivxAIWatchdog");
        installIVXWatchdogIncidentBridge((listener: unknown) =>
          ivxAIWatchdog.subscribe(listener),
        );
      } catch (err) {
        console.warn("[IVX] installIVXWatchdogIncidentBridge failed", err);
      }
    }, 3000);

    return () => {
      clearTimeout(hideTimer);
      clearTimeout(deferredTimer);
    };
  }, []);

  return (
    <DiagnosticErrorBoundary>
      <GestureHandlerRootView
        style={styles.root}
        {...(Platform.OS === 'web' ? { touchAction: 'auto' as const } : {})}
      >
        <QueryClientProvider client={queryClient}>
          <ProviderBoundary name="I18n">
            <I18nProvider>
              <ProviderBoundary name="Auth">
                <AuthProvider>
                  <ProviderBoundary name="Analytics">
                    <AnalyticsProvider>
                      <ProviderBoundary name="IPX">
                        <IPXProvider>
                          <ProviderBoundary name="Wallet">
                            <WalletProvider>
                              <ProviderBoundary name="Earn">
                                <EarnProvider>
                                  <ProviderBoundary name="Email">
                                    <EmailProvider>
                              <ProviderBoundary name="Network">
                                    <NetworkProvider>
                              <ProviderMountProbe>
                                <StatusBar style="light" />
                                <Stack
                                  screenOptions={{
                                    headerShown: false,
                                    contentStyle: { backgroundColor: Colors.background },
                                  }}
                                >
                                  <Stack.Screen name="login" options={{ headerShown: false }} />
                                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                                  <Stack.Screen name="admin" options={{ headerShown: false }} />
                                  <Stack.Screen name="ivx" options={{ headerShown: false }} />
                                  <Stack.Screen name="property" options={{ headerShown: false }} />
                                  <Stack.Screen name="landing" options={{ headerShown: false }} />
                                  <Stack.Screen name="signup" options={{ headerShown: false }} />
                                  <Stack.Screen name="modal" options={{ presentation: "modal" }} />
                                </Stack>
                              </ProviderMountProbe>
                                    </NetworkProvider>
                                  </ProviderBoundary>
                                    </EmailProvider>
                                  </ProviderBoundary>
                                </EarnProvider>
                              </ProviderBoundary>
                            </WalletProvider>
                          </ProviderBoundary>
                        </IPXProvider>
                      </ProviderBoundary>
                    </AnalyticsProvider>
                  </ProviderBoundary>
                </AuthProvider>
              </ProviderBoundary>
            </I18nProvider>
          </ProviderBoundary>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </DiagnosticErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  providerError: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  providerErrorName: {
    color: Colors.error,
    fontSize: 16,
    fontWeight: "700" as const,
    marginBottom: 8,
  },
  providerErrorMsg: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: "monospace" as const,
    textAlign: "center" as const,
    marginBottom: 8,
  },
  providerErrorTrace: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontFamily: "monospace" as const,
    textAlign: "center" as const,
    marginBottom: 16,
  },
  providerErrorButton: {
    backgroundColor: Colors.gold,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  providerErrorButtonText: {
    color: Colors.black,
    fontSize: 16,
    fontWeight: "700" as const,
  },
});
