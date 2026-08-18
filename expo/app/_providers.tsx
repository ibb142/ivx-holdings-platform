/**
 * Full provider tree — ALL providers imported synchronously.
 *
 * The tree structure NEVER changes between renders. Every provider is
 * wrapped in a ProviderBoundary so a crash in one provider does not
 * kill the entire app. This is the stable approach: no dynamic imports,
 * no staged loading, no tree restructure that unmounts the navigation
 * stack and causes a black screen.
 *
 * If a provider module crashes during import evaluation, the
 * DiagnosticErrorBoundary at the top level catches it and shows the
 * error on screen with a retry button.
 */
import React, { Component, type ReactNode } from 'react';
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

// All providers imported synchronously — the tree is stable from first render.
import { I18nProvider } from '@/lib/i18n-context';
import { AuthProvider } from '@/lib/auth-context';
import { AnalyticsProvider } from '@/lib/analytics-context';
import { IPXProvider } from '@/lib/ipx-context';
import { WalletProvider } from '@/lib/wallet-context';
import { EarnProvider } from '@/lib/earn-context';
import { EmailProvider } from '@/lib/email-context';
import { NetworkProvider } from '@/lib/network-context';

/**
 * Cache-first/offline-first session policy for modules using React Query.
 * Cached data stays visible during navigation and reconnect refreshes happen
 * without forcing full-screen loading. Sensitive financial data is not
 * indiscriminately persisted to device storage by this provider.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15 * 60_000,
      gcTime: 24 * 60 * 60_000,
      retry: 1,
      retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 3_000),
      refetchOnMount: false,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
      networkMode: 'offlineFirst',
      structuralSharing: true,
    },
    mutations: {
      retry: 1,
      networkMode: 'offlineFirst',
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

function AppStack() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0A0A0F' },
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

/**
 * STABLE TREE: The provider nesting never changes between renders.
 * Every provider is wrapped in a ProviderBoundary so a crash in one
 * provider shows an error screen for THAT provider only, without
 * unmounting the rest of the tree.
 *
 * The order matters: QueryClient must be outside everything that uses
 * React Query. Auth must be inside QueryClient (uses React Query).
 * The extra providers (Analytics, IPX, Wallet, Earn, Email, Network)
 * are also inside QueryClient and Auth because they depend on auth state.
 */
export function AppProviders() {
  React.useEffect(() => {
    logStartup('PROVIDERS_STARTED');
    logStartup('PROVIDERS_COMPLETED');
    logStartup('PROVIDERS_MOUNTED');

    try {
      injectWebKeyboardCSS();
    } catch (err) {
      console.warn('[IVX] injectWebKeyboardCSS failed:', err);
    }

    checkForUpdates().catch((err) => {
      console.warn('[IVX] OTA update check failed (non-fatal):', err);
    });

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
    }, 3000);

    return () => clearTimeout(deferredTimer);
  }, []);

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
                                          <StatusBar style="light" />
                                          <AppStack />
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
