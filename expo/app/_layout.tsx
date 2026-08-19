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

/** Visible build stamp so the installed binary can be identified on-device. */
export const BUILD_STAMP = '1.10.20 (118)';

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
// FATAL ERROR SHIELD — THIS IS THE BLACK SCREEN FIX.
//
// React error boundaries only catch errors thrown during RENDER. An error
// thrown from a timer, an event handler, a native callback or any async
// continuation never reaches them.
//
// React Native routes those to ErrorUtils' global handler. When it is invoked
// with isFatal=true, the DEFAULT handler tears down the JS context. The Android
// Activity stays alive, so the system status bar and navigation bar keep
// drawing — but the React root view is emptied. The result is a black content
// area with system bars still visible, no crash dialog, no error text, and no
// log, because the JS that would report it is already dead.
//
// That is exactly the failure being seen. It is not a render error, which is
// why RootErrorBoundary (correct, and kept) could never catch it.
//
// This shield installs at MODULE SCOPE — before any provider, timer or feature
// code can run — and refuses to forward isFatal onward. The error is surfaced
// as React state and rendered as a readable screen instead of destroying the
// runtime.
// -------------------------------------------------------------------
type FatalListener = (error: Error) => void;

/**
 * Persist the fatal error to device storage immediately.
 *
 * Loaded lazily to keep this module's synchronous import surface minimal. If a
 * future failure still manages to blank the screen, the NEXT launch reads this
 * record and displays it — the failure can no longer erase its own evidence.
 */
function persistCrash(err: Error, isFatal: boolean): void {
  try {
    const { recordCrash } = require('@/lib/crash-log') as typeof import('@/lib/crash-log');
    recordCrash({ message: err.message, stack: err.stack ?? null, isFatal, build: BUILD_STAMP });
  } catch {
    // never cascade from an error handler
  }
}

let fatalListener: FatalListener | null = null;
let pendingFatal: Error | null = null;

function publishFatal(error: Error): void {
  pendingFatal = error;
  if (fatalListener) fatalListener(error);
}

function installFatalShield(): void {
  const errorUtils = (globalThis as unknown as {
    ErrorUtils?: {
      setGlobalHandler?: (cb: (error: Error, isFatal?: boolean) => void) => void;
      getGlobalHandler?: () => ((error: Error, isFatal?: boolean) => void) | undefined;
    };
  }).ErrorUtils;

  if (!errorUtils?.setGlobalHandler) return;
  const previous = errorUtils.getGlobalHandler?.();

  errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[IVX] Global JS error', { isFatal: Boolean(isFatal), message: err.message, stack: err.stack });

    // The splash may still be covering the screen at this point.
    SplashScreen.hideAsync().catch(() => {});
    persistCrash(err, Boolean(isFatal));
    publishFatal(err);

    // NEVER forward isFatal=true. Doing so lets the default handler destroy the
    // JS context, which blanks the root view to black. Downgrading to
    // non-fatal keeps React alive so the error screen above can render.
    try {
      previous?.(err, false);
    } catch {
      // a failing downstream handler must never re-enter this path
    }
  });
}

installFatalShield();

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
      <Text style={loadingStyles.elapsed}>{`Build ${BUILD_STAMP}`}</Text>
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
        {`Build ${BUILD_STAMP} — screenshot this screen.`}
      </Text>
    </View>
  );
}

// -------------------------------------------------------------------
// Screen shown when a PREVIOUS launch recorded a crash.
// -------------------------------------------------------------------
interface PriorCrash {
  message: string;
  stack: string | null;
  isFatal: boolean;
  build: string;
  at: string;
}

function PriorCrashScreen({ record, onDismiss }: { record: PriorCrash; onDismiss: () => void }) {
  useEffect(() => {
    logHideSplash();
  }, []);
  return (
    <View style={crashStyles.container}>
      <Text style={crashStyles.title}>Previous Crash Detected</Text>
      <Text style={crashStyles.message}>{record.message}</Text>
      {record.stack ? <Text style={crashStyles.stack}>{record.stack.slice(0, 1200)}</Text> : null}
      <Text style={crashStyles.hint}>
        {`Build ${record.build} · fatal=${record.isFatal} · ${record.at}`}
      </Text>
      <TouchableOpacity style={crashStyles.button} onPress={onDismiss}>
        <Text style={crashStyles.buttonText}>Continue to app</Text>
      </TouchableOpacity>
      <Text style={crashStyles.hint}>Screenshot this screen — it names the exact defect.</Text>
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
    persistCrash(err, false);
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
  const [fatalError, setFatalError] = useState<Error | null>(pendingFatal);
  const [priorCrash, setPriorCrash] = useState<PriorCrash | null>(null);
  const [priorCrashChecked, setPriorCrashChecked] = useState(false);

  // Read any crash recorded by a PREVIOUS launch. This is what surfaces the
  // error when a failure blanked the screen before it could be displayed.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { readLastCrash } = await import('@/lib/crash-log');
        const record = await readLastCrash();
        if (!cancelled && record) setPriorCrash(record);
      } catch {
        // never block startup on diagnostics
      } finally {
        if (!cancelled) setPriorCrashChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to fatal runtime errors captured by the module-scope shield,
  // including any that fired before this component mounted.
  useEffect(() => {
    fatalListener = (err: Error) => setFatalError(err);
    if (pendingFatal) setFatalError(pendingFatal);
    return () => {
      fatalListener = null;
    };
  }, []);

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

  // Phase 0a: a previous launch crashed. Show that recorded error once, so a
  // failure that blanked the screen still gets reported.
  if (priorCrashChecked && priorCrash) {
    return (
      <PriorCrashScreen
        record={priorCrash}
        onDismiss={() => {
          void import('@/lib/crash-log')
            .then((m) => m.clearLastCrash())
            .catch(() => {});
          setPriorCrash(null);
        }}
      />
    );
  }

  // Phase 0b: a fatal runtime error was intercepted. Show it instead of letting
  // the JS context die to a black screen.
  if (fatalError) {
    return (
      <ImportCrashScreen
        title="IVX Runtime Error"
        error={fatalError}
        onRetry={() => {
          pendingFatal = null;
          setFatalError(null);
          setAttempt((a) => a + 1);
        }}
      />
    );
  }

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
