/**
 * Root route `/` — resolves the cold-launch destination.
 *
 * THIS ROUTE WAS THE BLACK SCREEN.
 *
 * Every earlier version returned a bare `<Redirect />` on all three decision
 * branches. `<Redirect />` renders `null`. So for the entire window between
 * mounting this route and the router actually committing the new destination,
 * route `/` painted ZERO pixels of content — the user saw the root view's
 * `#0A0A0F` background and nothing else. If the destination never committed
 * (auth still resolving, router not yet mounted, a competing `replace` from the
 * tabs auth guard cancelling this one), that empty container stayed on screen
 * indefinitely, threw no error, and logged nothing. The device recording
 * measured exactly that: 14 continuous seconds of `rgb(12,8,14)`.
 *
 * Two independent defects converged here:
 *
 *   1. `/` was listed in the watchdog's INSTRUMENTED_ROUTES — meaning the
 *      watchdog was allowed to judge it — but NO screen in the entire app ever
 *      reported a paint under the root key. Only `/home` and `/login` reported.
 *      So `/` could never satisfy the paint check: it was guaranteed to be
 *      declared blank 8 seconds after landing on it. Always. By construction.
 *   2. v1.10.24's recovery button navigated the user ONTO `/` to force a
 *      remount. Straight into the one route that renders nothing and is
 *      guaranteed to be accused. Tap recovery, wait 8s, get accused again.
 *
 * The fix is structural, not a timing tweak: this route now ALWAYS renders
 * visible branded content, and reports that paint honestly. The redirect is a
 * sibling of that content rather than a replacement for it, so the transition
 * shows a real screen instead of an empty container — and if the destination
 * never commits, the user sees the IVX loading state, not a black void.
 */
import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { isOpenAccessModeEnabled } from '@/lib/open-access';
import { logStartup } from '@/lib/startup-trace';
import { markScreenPainted, markScreenUnmounted } from '@/lib/screen-paint-watchdog';
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const INDEX_LOADING_TIMEOUT_MS = 4000;

export default function IndexScreen() {
  const { isAuthenticated, isLoading } = useAuth();
  const [forceLogin, setForceLogin] = useState<boolean>(false);

  useEffect(() => {
    logStartup('INITIAL_ROUTE_SELECTED', 'index');
  }, []);

  // Report the paint for `/` and release it on unmount. Without this the
  // watchdog judged a route that could never answer, so landing here for more
  // than 8 seconds ALWAYS produced a "Screen failed to load" overlay.
  useEffect(() => {
    markScreenPainted('/');
    return () => markScreenUnmounted('/');
  }, []);

  // Hard timeout: never wait on auth bootstrap longer than 4s.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isLoading) {
        console.warn('[Index] Auth bootstrap hard timeout — redirecting to login');
        setForceLogin(true);
      }
    }, INDEX_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isLoading]);

  // Resolve the destination. `null` means auth is still bootstrapping, so no
  // redirect is emitted yet — but content is still rendered below either way.
  const destination: string | null = (() => {
    if (isLoading && !forceLogin) return null;
    if (isOpenAccessModeEnabled()) return '/(tabs)/home';
    if (!isAuthenticated) return '/login';
    return '/(tabs)/home';
  })();

  // ALWAYS render visible content. The redirect rides alongside it instead of
  // replacing it, so this route can never be an empty container.
  return (
    <View style={styles.container} testID="index-route">
      <Text style={styles.brand}>IVX</Text>
      <ShimmerIndicator size="large" color="#FFD700" />
      <Text style={styles.status}>
        {destination === null ? 'Preparing your account…' : 'Opening IVX Holdings…'}
      </Text>
      <Text style={styles.stageLabel}>STAGE 2 · ROUTING</Text>
      {destination !== null ? <Redirect href={destination as never} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // Deliberately NOT #0A0A0F. Each waiting stage owns a distinct colour so a
    // single screenshot of a stuck app identifies which stage is stuck.
    backgroundColor: '#0B1220',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  stageLabel: {
    color: '#2E4468',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700' as const,
  },
  brand: {
    color: '#FFD700',
    fontSize: 34,
    fontWeight: 'bold' as const,
    letterSpacing: 6,
  },
  status: {
    color: '#8A8A8A',
    fontSize: 13,
  },
});
