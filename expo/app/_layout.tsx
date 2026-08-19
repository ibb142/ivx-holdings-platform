/**
 * Root layout — MINIMAL module surface.
 *
 * This file imports ONLY React, expo-router, expo-splash-screen, and basic
 * react-native primitives. All provider imports are deferred to _providers.tsx
 * which is loaded dynamically AFTER the first paint.
 *
 * Why: if any provider module crashes during `import` evaluation (a missing
 * native binding, a circular dependency, a Supabase init throw), the error
 * boundary can never catch it because the module never finishes evaluating.
 * In a production APK this produces a permanent black screen with no error.
 *
 * By keeping _layout.tsx ultra-minimal, the first frame always paints a
 * visible loading screen. Then _providers.tsx is import()'d asynchronously.
 * If it throws or times out, we show the full error on screen.
 */
import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

// Prevent native splash from auto-hiding.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Hard deadline: force-hide splash even if React never mounts useEffect.
let splashFallbackTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
  splashFallbackTimer = null;
  console.warn('[IVX] Splash hard deadline reached — forcing hide');
  SplashScreen.hideAsync().catch(() => {});
}, 2500);

// Re-export expo-router's ErrorBoundary for route-level catches.
export { ErrorBoundary } from 'expo-router';

// -------------------------------------------------------------------
// Visible loading screen — always renders on first paint.
// -------------------------------------------------------------------
function VisibleLoadingScreen({ elapsedMs }: { elapsedMs: number }) {
  useEffect(() => {
    // Hide splash as soon as this visible loading screen paints.
    requestAnimationFrame(() => {
      logHideSplash();
    });
  }, []);
  return (
    <View style={loadingStyles.container}>
      <Text style={loadingStyles.title}>IVX Holdings</Text>
      <ActivityIndicator size="large" color="#E6C200" style={{ marginTop: 24 }} />
      <Text style={loadingStyles.subtitle}>Loading secure session…</Text>
      <Text style={loadingStyles.elapsed}>{`Elapsed: ${(elapsedMs / 1000).toFixed(1)}s`}</Text>
    </View>
  );
}

function logHideSplash() {
  SplashScreen.hideAsync().catch(() => {});
  if (splashFallbackTimer) {
    clearTimeout(splashFallbackTimer);
    splashFallbackTimer = null;
  }
}

// -------------------------------------------------------------------
// Error screen shown when provider import fails or times out.
// -------------------------------------------------------------------
function ImportCrashScreen({
  error,
  onRetry,
  title = 'IVX Startup Error',
}: {
  error: Error;
  onRetry: () => void;
  title?: string;
}) {
  return (
    <View style={crashStyles.container}>
      <Text style={crashStyles.title}>{title}</Text>
      <Text style={crashStyles.message}>{error.message}</Text>
      {error.stack ? (
        <Text style={crashStyles.stack}>{error.stack.slice(0, 1500)}</Text>
      ) : null}
      <TouchableOpacity style={crashStyles.button} onPress={onRetry}>
        <Text style={crashStyles.buttonText}>Retry</Text>
      </TouchableOpacity>
      <Text style={crashStyles.hint}>
        If this persists, clear app data or reinstall.
      </Text>
    </View>
  );
}

// -------------------------------------------------------------------
// Last-resort render boundary.
//
// THIS IS THE BLACK SCREEN FIX.
//
// When a render error is not caught by ANY error boundary, React 18 does not
// leave the last good UI on screen — it unmounts the entire tree. In a release
// APK there is no red box, so the result is an empty root view: a totally black
// screen with no text, no error, no tab bar, and no way back.
//
// Every other safety net in this app (DiagnosticErrorBoundary, ProviderBoundary,
// ModuleErrorBoundary, CardBoundary) lives INSIDE <AppProviders />. So anything
// that throws while rendering AppProviders itself — or any provider above those
// inner boundaries — had nothing above it to catch the error and took the whole
// app down to black, destroying the very nets meant to report it.
//
// This boundary sits ABOVE AppProviders, using only the primitives this minimal
// root layout already imports, so a crash always renders a readable message and
// a Retry button instead of silence.
// -------------------------------------------------------------------
interface RootBoundaryProps {
  children: React.ReactNode;
  onReset: () => void;
}

interface RootBoundaryState {
  error: Error | null;
}

class RootErrorBoundary extends React.Component<RootBoundaryProps, RootBoundaryState> {
  state: RootBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): RootBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }): void {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[IVX] Root render crash:', err.message, err.stack, info?.componentStack);
    // The splash may still be up if the crash happened before first paint.
    logHideSplash();
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <ImportCrashScreen
          title="IVX Render Error"
          error={error}
          onRetry={() => {
            this.setState({ error: null });
            this.props.onReset();
          }}
        />
      );
    }
    return <>{this.props.children}</>;
  }
}

// -------------------------------------------------------------------
// Root component.
// -------------------------------------------------------------------
const PROVIDER_LOAD_TIMEOUT_MS = 15000;

function RootLayout(): React.ReactElement {
  const [providersModule, setProvidersModule] = useState<{ AppProviders: React.ComponentType } | null>(null);
  const [importError, setImportError] = useState<Error | null>(null);
  const [startTime] = useState(() => Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const elapsedTimer = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 200);
    return () => clearInterval(elapsedTimer);
  }, [startTime]);

  useEffect(() => {
    let cancelled = false;

    const loadProviders = async () => {
      if (!cancelled) {
        setProvidersModule(null);
        setImportError(null);
      }
      try {
        const mod = await Promise.race([
          import('./_providers'),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Provider bundle load timed out after ${PROVIDER_LOAD_TIMEOUT_MS}ms`)),
              PROVIDER_LOAD_TIMEOUT_MS,
            ),
          ),
        ]);
        if (!cancelled) {
          setProvidersModule({ AppProviders: mod.AppProviders });
        }
      } catch (err) {
        if (!cancelled) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error('[IVX] Provider import crashed:', error.message, error.stack);
          setImportError(error);
          logHideSplash();
        }
      }
    };

    // Defer provider loading to the next frame so the loading screen paints first.
    const timer = setTimeout(() => {
      void loadProviders();
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [attempt]);

  // Phase 1: show visible loading screen (no providers, no Stack).
  if (!providersModule && !importError) {
    return <VisibleLoadingScreen elapsedMs={elapsedMs} />;
  }

  // Phase 2: provider import failed — show error.
  if (importError) {
    return (
      <ImportCrashScreen
        error={importError}
        onRetry={() => setAttempt((a) => a + 1)}
      />
    );
  }

  // Phase 3: providers loaded successfully — render the full app.
  // Wrapped so an uncaught render error shows a readable screen instead of
  // unmounting the tree to a silent black screen.
  const { AppProviders } = providersModule!;
  return (
    <RootErrorBoundary key={attempt} onReset={() => setAttempt((a) => a + 1)}>
      <AppProviders />
    </RootErrorBoundary>
  );
}

// Keep the default export separate from the function declaration. The managed
// preview transformer otherwise injects its full developer SDK into this file,
// which pulls Node-only AI SDK helpers into Metro's mobile and web bundles.
export default RootLayout;

// -------------------------------------------------------------------
// Styles
// -------------------------------------------------------------------
const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0F',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    color: '#E6C200',
    fontSize: 28,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  subtitle: {
    color: '#888888',
    fontSize: 13,
    marginTop: 12,
  },
  elapsed: {
    color: '#555555',
    fontSize: 11,
    marginTop: 8,
  },
});

const crashStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a0000',
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    color: '#FF4444',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  message: {
    color: '#FFAAAA',
    fontSize: 14,
    fontFamily: 'monospace',
    marginBottom: 16,
  },
  stack: {
    color: '#DDAAAA',
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 14,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#FFD700',
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
    alignSelf: 'center',
    marginBottom: 16,
  },
  buttonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  hint: {
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
  },
});
