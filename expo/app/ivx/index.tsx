import React from 'react';
import { Redirect } from 'expo-router';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { ErrorState } from '@/components/ivx';
import { RefreshControl } from 'react-native';

export default function IVXOwnerIndexRoute() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  return <Redirect href="/ivx/inbox" />;
}
