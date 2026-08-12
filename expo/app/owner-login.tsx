import React from 'react';
import { LoginScreenContent } from './login';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { ErrorState } from '@/components/ivx';
import { RefreshControl } from 'react-native';

export default function OwnerLoginScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  return <LoginScreenContent ownerMode />;
}
