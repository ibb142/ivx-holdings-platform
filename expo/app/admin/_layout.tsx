import React, { useMemo, useRef } from 'react';
import {View, Text, StyleSheet } from "react-native";
import { Stack } from 'expo-router';
import Colors from '@/constants/colors';
import { useAdminGuard } from '@/hooks/useAdminGuard';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

// IVX Crash Shield: route-level error boundary for every admin screen.
export { ErrorBoundary } from 'expo-router';

const ADMIN_GUARD_OPTIONS = { redirectOnFail: true } as const;

const ADMIN_STACK_SCREEN_OPTIONS = {
  headerShown: false,
  contentStyle: { backgroundColor: Colors.background },
  animation: 'slide_from_right' as const} as const;

const layoutStyles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background},
  loadingText: {
    color: '#97A0AF',
    fontSize: 14,
    marginTop: 12}});

export default function AdminLayout() {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  if (renderCountRef.current === 1 || renderCountRef.current % 10 === 0) {
    console.log('[AdminLayout][render-trace] render count:', renderCountRef.current);
  }

  const guardOptions = useMemo(() => ADMIN_GUARD_OPTIONS, []);
  const { isAdmin, isVerifying } = useAdminGuard(guardOptions);

  if (isVerifying) {
    return (
      <View style={layoutStyles.loading}>
        <ShimmerIndicator size="large" color={Colors.primary} />
        <Text style={layoutStyles.loadingText}>Verifying access...</Text>
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={layoutStyles.loading}>
        <Text style={layoutStyles.loadingText}>Access denied</Text>
      </View>
    );
  }

  return (
    <Stack screenOptions={ADMIN_STACK_SCREEN_OPTIONS}>
      <Stack.Screen name="index" />
      <Stack.Screen name="owner-controls" />
      <Stack.Screen name="members" />
      <Stack.Screen name="transactions" />
      <Stack.Screen name="applications" />
      <Stack.Screen name="investor-profits" />
      <Stack.Screen name="properties" />
      <Stack.Screen name="marketing" />
      <Stack.Screen name="team" />
      <Stack.Screen name="fees" />
      <Stack.Screen name="land-partners" />
      <Stack.Screen name="engagement" />
      <Stack.Screen name="broadcast" />
      <Stack.Screen name="growth" />
      <Stack.Screen name="influencers" />
      <Stack.Screen name="banners" />
      <Stack.Screen name="intro" />
      <Stack.Screen name="app-docs" />
      <Stack.Screen name="social-command" />
      <Stack.Screen name="member" />
      <Stack.Screen name="title-companies" />
      <Stack.Screen name="lender-directory" />
      <Stack.Screen name="lender-network" />
      <Stack.Screen name="ai-outreach" />
      <Stack.Screen name="lender-search" />
      <Stack.Screen name="outreach-analytics" />
      <Stack.Screen name="email-engine" />
      <Stack.Screen name="lender-sync" />
      <Stack.Screen name="ai-video" />
      <Stack.Screen name="developer-handoff" />
      <Stack.Screen name="api-keys" />
      <Stack.Screen name="email-inbox" />
      <Stack.Screen name="email-management" />
      <Stack.Screen name="email-accounts" />
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="lead-intelligence" />
      <Stack.Screen name="traffic-control" />
      <Stack.Screen name="viral-growth" />
      <Stack.Screen name="landing-analytics" />
      <Stack.Screen name="system-monitor" />
      <Stack.Screen name="chat-room" />
      <Stack.Screen name="visitor-intelligence" />
      <Stack.Screen name="staff-activity" />
      <Stack.Screen name="retargeting" />
      <Stack.Screen name="jv-deals" />
      <Stack.Screen name="trash-bin" />
      <Stack.Screen name="system-map" />
      <Stack.Screen name="audit-log" />
      <Stack.Screen name="data-recovery" />
      <Stack.Screen name="publication-log" />
      <Stack.Screen name="supabase-scripts" />
      <Stack.Screen name="image-backup" />
      <Stack.Screen name="landing-control" />
      <Stack.Screen name="feature-control" />
      <Stack.Screen name="sync-diagnostics" />
      <Stack.Screen name="landing-submissions" />
      <Stack.Screen name="deploy-waitlist" />
      <Stack.Screen name="waitlist-admin" />
      <Stack.Screen name="registration-audit" />
      <Stack.Screen name="quality-control" />
      <Stack.Screen name="control-tower" />
      <Stack.Screen name="ivx-developer-workspace" />
      <Stack.Screen name="ivx-developer-actions" />
      <Stack.Screen name="ivx-agent-jobs" />
      <Stack.Screen name="ivx-auth-debug" />
      <Stack.Screen name="intent-engine" />
      <Stack.Screen name="admin-reels" />
      <Stack.Screen name="restore-center" />
      <Stack.Screen name="access-control" />
      <Stack.Screen name="business-overview" />
      <Stack.Screen name="diagnostics" />
    </Stack>
  );
}
