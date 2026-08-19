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
 * DEFECT 1 THIS FIXES — the watchdog accused a screen that had painted.
 *
 * v1.10.23 asked `paintedAt < enteredAt`. Expo Router keeps tab screens mounted,
 * so Home reports its paint once and never again, while this component re-armed
 * `enteredAt` on every pathname change. Any return to Home therefore compared an
 * old paint against a new entry stamp and declared a fully rendered screen blank.
 * The device recording caught the contradiction in the overlay's own text:
 * `Route: /home` above `Last painted: /home`.
 *
 * It now asks whether the route holds a LIVE paint record — a mounted screen that
 * rendered content — which cannot be defeated by timestamp ordering.
 *
 * DEFECT 2 THIS FIXES — recovery landed on the same empty container and then
 * permanently blinded the watchdog.
 *
 * `goHome` replaced the current route with Home while the user was ALREADY on
 * Home: a no-op navigation that left the identical empty view on screen. It also
 * pinned `dismissedRouteRef` to that path forever, so Home could never be judged
 * again for the rest of the process. Recovery now bounces through the root route
 * so the tab tree genuinely re-resolves, and a dismissal only suppresses the
 * current stay on that route.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import {
  getLastPaintedScreen,
  hasRouteFailedToPaint,
  isRouteInstrumented,
} from '@/lib/screen-paint-watchdog';

/** Root route, used to force a genuine re-resolve of the tab tree. */
const ROOT_ROUTE = '/';

const BLANK_SCREEN_TIMEOUT_MS = 8000;

export function BlankScreenWatchdog({ build }: { build: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isBlank, setIsBlank] = useState(false);
  const dismissedRouteRef = useRef<string | null>(null);

  useEffect(() => {
    // A dismissal suppresses only the current stay on that route. Leaving it
    // re-arms the watchdog — v1.10.23 pinned this forever, so one tap on the
    // recovery button made Home permanently unjudgeable.
    if (dismissedRouteRef.current !== null && dismissedRouteRef.current !== pathname) {
      dismissedRouteRef.current = null;
    }
    if (dismissedRouteRef.current === pathname) return;
    // Only judge routes that actually report paint. Accusing an uninstrumented
    // screen of being blank would cover working UI with an error overlay.
    if (!isRouteInstrumented(pathname)) {
      setIsBlank(false);
      return;
    }

    setIsBlank(false);

    const timer = setTimeout(() => {
      // Liveness, not freshness: a mounted screen that painted is never accused,
      // however long ago it painted.
      if (hasRouteFailedToPaint(pathname)) {
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
      // Replacing the accused route with itself is a no-op that leaves the same
      // empty container on screen — recorded on device as 14 seconds of #0A0A0F
      // after tapping this button. Bounce through the root so the tab tree is
      // genuinely re-resolved and the screen actually remounts.
      const alreadyHome = pathname === '/home' || pathname === '/(tabs)/home';
      router.replace(alreadyHome ? ROOT_ROUTE : '/(tabs)/home');
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
