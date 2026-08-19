/**
 * Blank screen watchdog — the last line of defence against a silent black screen.
 *
 * Renders nothing in the normal case. If no screen reports a successful paint
 * within a bounded window, the route tree resolved to nothing and the user is
 * staring at an empty root view. Instead of leaving them with a black frame,
 * this shows what happened and offers real recovery actions.
 *
 * This exists because a "renders nothing" failure throws no error: boundaries,
 * the global fatal shield and the crash log are all silent by design.
 *
 * DEFECT THIS FIXES — the watchdog could not fire after login.
 *
 * The previous version armed on `hasNeverPainted()`, a single process-wide flag.
 * The login screen reports a paint, so that flag was already false by the time
 * the owner signed in. Every navigation after login was therefore invisible to
 * this watchdog: a blank Home screen could persist forever with no diagnostic and
 * no recovery button, which is exactly what was recorded on device — 15 seconds
 * of black with no overlay.
 *
 * It now re-arms on every route change and asks whether THIS route painted since
 * it was entered.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import {
  getLastPaintedScreen,
  hasRouteFailedToPaint,
  isRouteInstrumented,
} from '@/lib/screen-paint-watchdog';

const BLANK_SCREEN_TIMEOUT_MS = 8000;

export function BlankScreenWatchdog({ build }: { build: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isBlank, setIsBlank] = useState(false);
  const dismissedRouteRef = useRef<string | null>(null);

  useEffect(() => {
    // A route the user already dismissed must not re-accuse itself in a loop.
    if (dismissedRouteRef.current === pathname) return;
    // Only judge routes that actually report paint. Accusing an uninstrumented
    // screen of being blank would cover working UI with an error overlay.
    if (!isRouteInstrumented(pathname)) {
      setIsBlank(false);
      return;
    }

    const enteredAt = Date.now();
    setIsBlank(false);

    const timer = setTimeout(() => {
      if (hasRouteFailedToPaint(pathname, enteredAt)) {
        console.warn('[IVX] Blank screen watchdog fired — route painted nothing', {
          pathname,
          lastPainted: getLastPaintedScreen(),
        });
        setIsBlank(true);
      }
    }, BLANK_SCREEN_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pathname]);

  const goHome = useCallback(() => {
    dismissedRouteRef.current = pathname;
    setIsBlank(false);
    try {
      router.replace('/(tabs)/home');
    } catch (err) {
      console.warn('[IVX] Watchdog home recovery failed', err);
    }
  }, [router, pathname]);

  const goLogin = useCallback(() => {
    dismissedRouteRef.current = pathname;
    setIsBlank(false);
    try {
      router.replace('/login');
    } catch (err) {
      console.warn('[IVX] Watchdog login recovery failed', err);
    }
  }, [router, pathname]);

  if (!isBlank) return null;

  return (
    <View style={styles.overlay} testID="blank-screen-watchdog">
      <Text style={styles.title}>Screen failed to load</Text>
      <Text style={styles.body}>
        The app navigated to a route that rendered no content. No error was thrown, so this
        recovery screen is shown instead of a blank display.
      </Text>
      <Text style={styles.meta}>{`Route: ${pathname || 'unknown'}`}</Text>
      <Text style={styles.meta}>{`Last painted: ${getLastPaintedScreen() ?? 'none'}`}</Text>
      <Text style={styles.meta}>{`Build ${build}`}</Text>
      <TouchableOpacity style={styles.button} onPress={goHome} testID="watchdog-go-home">
        <Text style={styles.buttonText}>Go to Home</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondary} onPress={goLogin} testID="watchdog-go-login">
        <Text style={styles.secondaryText}>Back to Login</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0A0A0F',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    zIndex: 9999,
  },
  title: { color: '#FFD700', fontSize: 20, fontWeight: 'bold' as const, marginBottom: 12 },
  body: { color: '#CCCCCC', fontSize: 14, textAlign: 'center' as const, lineHeight: 20, marginBottom: 18 },
  meta: { color: '#777777', fontSize: 11, fontFamily: 'monospace' as const, marginBottom: 4 },
  button: {
    backgroundColor: '#FFD700',
    borderRadius: 14,
    paddingHorizontal: 34,
    paddingVertical: 14,
    marginTop: 22,
  },
  buttonText: { color: '#000000', fontSize: 16, fontWeight: 'bold' as const },
  secondary: { marginTop: 14, paddingVertical: 10, paddingHorizontal: 20 },
  secondaryText: { color: '#8A8A8A', fontSize: 14 },
});

export default BlankScreenWatchdog;
