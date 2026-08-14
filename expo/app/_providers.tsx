/**
 * Full provider tree — loaded in two stages so the app can paint quickly.
 *
 * Stage 1 (synchronous): essential providers only (I18n, Auth, QueryClient,
 * GestureHandlerRootView). This is enough to render the login screen.
 *
 * Stage 2 (asynchronous): remaining providers are loaded in the background
 * and wrapped around the app once ready. If they fail or hang, the app still
 * works with Stage 1 providers.
 */
import React, { useEffect, useState, Component, type ReactNode, type ComponentType } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { DiagnosticErrorBoundary } from '@/components/DiagnosticErrorBoundary';
import { injectWebKeyboardCSS } from '@/hooks/useWebKeyboard';
import { checkForUpdates } from '@/lib/app-update-checker';
import { logStartup, logStartupError } from '@/lib/startup-trace';
import Colors from '@/constants/colors';

// Stage 1: essential providers — keep these synchronous so the first paint is fast.
import { I18nProvider } from '@/lib/i18n-context';
import { AuthProvider } from '@/lib/auth-context';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnMount: false,
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

// --- Per-provider error boundary ---
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
  state: ProviderBoundaryState = { hasError: false, error: null, traceId: null };
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
  handleReset = () => {
    this.setState({ hasError: false, error: null, traceId: null });
  };
  render() {
    if (this.state.hasError) {
      const category = this.state.error ? classifyProviderError(this.state.error) : 'UNKNOWN_ERROR';
      return (
        <View style={providerErrorStyles.container}>
          <Text style={providerErrorStyles.title}>IVX Provider Error</Text>
          <Text style={providerErrorStyles.name}>{this.props.name}</Text>
          <Text style={providerErrorStyles.message}>
            {category}: {this.state.error?.message || 'Unknown error'}
          </Text>
          {this.state.traceId && (
            <Text style={providerErrorStyles.trace}>Trace: {this.state.traceId}</Text>
          )}
          <TouchableOpacity style={providerErrorStyles.button} onPress={this.handleReset}>
            <Text style={providerErrorStyles.buttonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

function ProviderMountProbe({ children }: { children: ReactNode }) {
  useEffect(() => {
    logStartup('PROVIDERS_STARTED');
    logStartup('PROVIDERS_COMPLETED');
    logStartup('PROVIDERS_MOUNTED');
  }, []);
  return <>{children}</>;
}

// Stage 2: remaining providers — loaded asynchronously so they cannot block first paint.
type ProviderComponent = ComponentType<{ children: ReactNode }>;
type ExtraProviders = {
  AnalyticsProvider: ProviderComponent;
  IPXProvider: ProviderComponent;
  WalletProvider: ProviderComponent;
  EarnProvider: ProviderComponent;
  EmailProvider: ProviderComponent;
  NetworkProvider: ProviderComponent;
};

async function loadExtraProviders(): Promise<ExtraProviders> {
  const [AnalyticsProvider, IPXProvider, WalletProvider, EarnProvider, EmailProvider, NetworkProvider] =
    await Promise.all([
      import('@/lib/analytics-context').then((m) => m.AnalyticsProvider),
      import('@/lib/ipx-context').then((m) => m.IPXProvider),
      import('@/lib/wallet-context').then((m) => m.WalletProvider),
      import('@/lib/earn-context').then((m) => m.EarnProvider),
      import('@/lib/email-context').then((m) => m.EmailProvider),
      import('@/lib/network-context').then((m) => m.NetworkProvider),
    ]);
  return {
    AnalyticsProvider,
    IPXProvider,
    WalletProvider,
    EarnProvider,
    EmailProvider,
    NetworkProvider,
  };
}

function AppStack() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="admin" options={{ headerShown: false }} />
      <Stack.Screen name="ivx" options={{ headerShown: false }} />
      <Stack.Screen name="property" options={{ headerShown: false }} />
      <Stack.Screen name="landing" options={{ headerShown: false }} />
      <Stack.Screen name="signup" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

function EssentialProviders({ children }: { children: ReactNode }) {
  return (
    <DiagnosticErrorBoundary>
      <GestureHandlerRootView
        style={providerStyles.root}
        {...(Platform.OS === 'web' ? { touchAction: 'auto' as const } : {})}
      >
        <QueryClientProvider client={queryClient}>
          <ProviderBoundary name="I18n">
            <I18nProvider>
              <ProviderBoundary name="Auth">
                <AuthProvider>{children}</AuthProvider>
              </ProviderBoundary>
            </I18nProvider>
          </ProviderBoundary>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </DiagnosticErrorBoundary>
  );
}

function FullProviders({ extras, children }: { extras: ExtraProviders; children: ReactNode }) {
  return (
    <ProviderBoundary name="Analytics">
      <extras.AnalyticsProvider>
        <ProviderBoundary name="IPX">
          <extras.IPXProvider>
            <ProviderBoundary name="Wallet">
              <extras.WalletProvider>
                <ProviderBoundary name="Earn">
                  <extras.EarnProvider>
                    <ProviderBoundary name="Email">
                      <extras.EmailProvider>
                        <ProviderBoundary name="Network">
                          <extras.NetworkProvider>{children}</extras.NetworkProvider>
                        </ProviderBoundary>
                      </extras.EmailProvider>
                    </ProviderBoundary>
                  </extras.EarnProvider>
                </ProviderBoundary>
              </extras.WalletProvider>
            </ProviderBoundary>
          </extras.IPXProvider>
        </ProviderBoundary>
      </extras.AnalyticsProvider>
    </ProviderBoundary>
  );
}

export function AppProviders() {
  const [extras, setExtras] = useState<ExtraProviders | null>(null);
  const [extrasError, setExtrasError] = useState<Error | null>(null);

  useEffect(() => {
    try {
      injectWebKeyboardCSS();
    } catch (err) {
      console.warn('[IVX] injectWebKeyboardCSS failed:', err);
    }

    checkForUpdates().catch((err) => {
      console.warn('[IVX] OTA update check failed (non-fatal):', err);
    });

    let cancelled = false;
    const loadExtras = async () => {
      try {
        const loaded = await Promise.race([
          loadExtraProviders(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Extra providers load timed out after 12s')), 12_000),
          ),
        ]);
        if (!cancelled) {
          setExtras(loaded);
          logStartup('EXTRA_PROVIDERS_LOADED');
        }
      } catch (err) {
        console.warn('[IVX] Extra providers failed to load (non-fatal):', err);
        if (!cancelled) {
          setExtrasError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };

    // Defer extra provider loading so the first paint is never blocked.
    const timer = setTimeout(() => {
      void loadExtras();
    }, 100);

    const deferredTimer = setTimeout(() => {
      try {
        const { installTextNodeGuard } = require('@/lib/text-node-guard');
        installTextNodeGuard();
      } catch (err) {
        console.warn('[IVX] installTextNodeGuard failed', err);
      }
      try {
        const { installIVXIncidentCapture } = require('@/lib/ivx-incident-client');
        installIVXIncidentCapture();
      } catch (err) {
        console.warn('[IVX] installIVXIncidentCapture failed', err);
      }
      try {
        const { installIVXWatchdogIncidentBridge } = require('@/lib/ivx-incident-client');
        const { ivxAIWatchdog } = require('@/src/modules/ivx-owner-ai/services/ivxAIWatchdog');
        installIVXWatchdogIncidentBridge((listener: unknown) => ivxAIWatchdog.subscribe(listener));
      } catch (err) {
        console.warn('[IVX] installIVXWatchdogIncidentBridge failed', err);
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(deferredTimer);
    };
  }, []);

  return (
    <EssentialProviders>
      <ProviderMountProbe>
        <StatusBar style="light" />
        {extras ? (
          <FullProviders extras={extras}>
            <AppStack />
          </FullProviders>
        ) : (
          <AppStack />
        )}
        {extrasError ? (
          <View style={extrasErrorStyles.banner} pointerEvents="none">
            <Text style={extrasErrorStyles.bannerText}>
              Some features are unavailable offline. Pull-to-refresh to retry.
            </Text>
          </View>
        ) : null}
      </ProviderMountProbe>
    </EssentialProviders>
  );
}

const providerStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
});

const providerErrorStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a0000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: {
    color: '#FF4444',
    fontSize: 18,
    fontWeight: 'bold' as const,
    marginBottom: 8,
  },
  name: {
    color: '#FFD700',
    fontSize: 14,
    fontWeight: 'bold' as const,
    marginBottom: 8,
  },
  message: {
    color: '#FFAAAA',
    fontSize: 12,
    fontFamily: 'monospace' as const,
    textAlign: 'center' as const,
    marginBottom: 8,
  },
  trace: {
    color: '#888',
    fontSize: 10,
    fontFamily: 'monospace' as const,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#FFD700',
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  buttonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold' as const,
  },
});

const extrasErrorStyles = StyleSheet.create({
  banner: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 215, 0, 0.3)',
  },
  bannerText: {
    color: '#FFD700',
    fontSize: 11,
    textAlign: 'center' as const,
  },
});
