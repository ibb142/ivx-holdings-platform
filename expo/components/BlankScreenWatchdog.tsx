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
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { getLastPaintedScreen, hasNeverPainted } from '@/lib/screen-paint-watchdog';

const BLANK_SCREEN_TIMEOUT_MS = 8000;

export function BlankScreenWatchdog({ build }: { build: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isBlank, setIsBlank] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (hasNeverPainted()) {
        console.warn('[IVX] Blank screen watchdog fired — no screen painted', { pathname });
        setIsBlank(true);
      }
    }, BLANK_SCREEN_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pathname]);

  const goHome = useCallback(() => {
    setIsBlank(false);
    try {
      router.replace('/(tabs)/(home)/home');
    } catch (err) {
      console.warn('[IVX] Watchdog home recovery failed', err);
    }
  }, [router]);

  const goLogin = useCallback(() => {
    setIsBlank(false);
    try {
      router.replace('/login');
    } catch (err) {
      console.warn('[IVX] Watchdog login recovery failed', err);
    }
  }, [router]);

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
