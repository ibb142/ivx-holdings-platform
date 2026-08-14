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
 * visible loading screen. Then _providers.tsx is require()'d inside a
 * try/catch — if it throws, we show the full error on screen.
 */
import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
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
function VisibleLoadingScreen() {
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
// Error screen shown when provider import fails.
// -------------------------------------------------------------------
function ImportCrashScreen({ error }: { error: Error }) {
  return (
    <View style={crashStyles.container}>
      <Text style={crashStyles.title}>IVX Startup Error</Text>
      <Text style={crashStyles.message}>{error.message}</Text>
      {error.stack ? (
        <Text style={crashStyles.stack}>{error.stack.slice(0, 1500)}</Text>
      ) : null}
      <Text style={crashStyles.hint}>
        If this persists, clear app data or reinstall.
      </Text>
    </View>
  );
}

// -------------------------------------------------------------------
// Root component.
// -------------------------------------------------------------------
export default function RootLayout() {
  const [providersModule, setProvidersModule] = useState<{ AppProviders: React.ComponentType } | null>(null);
  const [importError, setImportError] = useState<Error | null>(null);

  useEffect(() => {
    // Defer provider loading to the next frame so the loading screen paints first.
    const timer = setTimeout(() => {
      try {
        // Dynamic require — if any provider module throws during import
        // evaluation, we catch it here and show the error on screen.
        const mod = require('./_providers');
        setProvidersModule({ AppProviders: mod.AppProviders });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('[IVX] Provider import crashed:', error.message, error.stack);
        setImportError(error);
        // Still hide splash if it hasn't been hidden yet.
        logHideSplash();
      }
    }, 50);

    return () => clearTimeout(timer);
  }, []);

  // Phase 1: show visible loading screen (no providers, no Stack).
  if (!providersModule && !importError) {
    return <VisibleLoadingScreen />;
  }

  // Phase 2: provider import failed — show error.
  if (importError) {
    return <ImportCrashScreen error={importError} />;
  }

  // Phase 3: providers loaded successfully — render the full app.
  const { AppProviders } = providersModule!;
  return <AppProviders />;
}

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
    color: '#555555',
    fontSize: 13,
    marginTop: 12,
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
  hint: {
    color: '#888',
    fontSize: 12,
  },
});
