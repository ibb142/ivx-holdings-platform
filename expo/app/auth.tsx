import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';
import { IVXAuthCard } from '@/components/IVXAuthCard';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { ErrorState } from '@/components/ivx';
import { RefreshControl } from 'react-native';

/**
 * Unified premium auth route — replaces the old popup-based login/signup flow.
 *
 * Supports:
 * - /auth            → defaults to Sign In tab
 * - /auth?mode=signup → opens Sign Up tab
 * - /auth?mode=owner → owner-only login (no tab switcher)
 */
export default function AuthScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const params = useLocalSearchParams<{ mode?: string }>();

  const initialMode = params.mode === 'signup' ? 'signup' : 'login';
  const ownerMode = params.mode === 'owner';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <IVXAuthCard initialMode={initialMode} ownerMode={ownerMode} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000'}});
