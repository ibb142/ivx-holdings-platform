/**
 * Root initial route — redirects to /login on every cold launch.
 *
 * Without this file, Expo Router has no route for "/" and may render a
 * blank/black screen or fall through to +not-found. The auth context
 * signs out any persisted Supabase session on cold launch, so the owner
 * must always enter credentials manually.
 *
 * If the user is already authenticated (e.g. hot-reload in dev), redirect
 * to the tabs so they don't get stuck on login.
 */
import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { isOpenAccessModeEnabled } from '@/lib/open-access';
import { logStartup } from '@/lib/startup-trace';
import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const INDEX_LOADING_TIMEOUT_MS = 4000;

export default function IndexScreen() {
  const { isAuthenticated, isLoading } = useAuth();
  const [forceLogin, setForceLogin] = useState(false);

  useEffect(() => {
    logStartup('INITIAL_ROUTE_SELECTED', 'index');
  }, []);

  // Hard timeout: never stay on a loading spinner longer than 4s.
  // If auth bootstrap hangs for any reason, send the user to login.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isLoading) {
        console.warn('[Index] Auth bootstrap hard timeout — redirecting to login');
        setForceLogin(true);
      }
    }, INDEX_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isLoading]);

  // During the brief auth bootstrap window, show a dark loading screen
  // instead of a black frame. isLoading is set to false in a microtask
  // so this is at most one frame.
  if (isLoading && !forceLogin) {
    return (
      <View style={styles.container}>
        <ShimmerIndicator size="large" color="#FFD700" />
      </View>
    );
  }

  // Open access mode bypasses login (dev only — disabled in production).
  if (isOpenAccessModeEnabled()) {
    return <Redirect href="/(tabs)/home" />;
  }

  // Cold launch: always go to login. The auth context has already
  // signed out any persisted session, so isAuthenticated is false.
  if (!isAuthenticated) {
    return <Redirect href="/login" />;
  }

  // Already authenticated (e.g. hot reload): go to the app.
  return <Redirect href="/(tabs)/home" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
