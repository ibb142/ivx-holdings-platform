import { Redirect, Tabs } from 'expo-router';
import { BarChart3, Briefcase, Home, LayoutDashboard, MessageCircle, ShieldCheck, Sparkles, TrendingUp, User } from 'lucide-react-native';
import { DiagnosticErrorBoundary } from '@/components/DiagnosticErrorBoundary';

export function ErrorBoundary(props: { children: React.ReactNode }) {
  return <DiagnosticErrorBoundary>{props.children}</DiagnosticErrorBoundary>;
}
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FloatingChatButton from '@/components/FloatingChatButton';
import { useAuth } from '@/lib/auth-context';
import { isOpenAccessModeEnabled } from '@/lib/open-access';
import { Skeleton } from '@/components/InstantSkeleton';
import { logStartup, logStartupError } from '@/lib/startup-trace';

const tabColors = { active: '#FFD700', inactive: '#777777', background: '#0A0A0F', border: '#242424'};
const TABS_LOADING_TIMEOUT_MS = 12000;
export const unstable_settings = { anchor: 'home', initialRouteName: 'home'} as const;

export default function TabsLayout() {
  logStartup('ROUTER_READY');
  logStartup('INITIAL_ROUTE_SELECTED', 'tabs');
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profileData, isAuthenticated, isLoading } = useAuth();
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [authInitError, setAuthInitError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading) { setLoadingTimedOut(false); setAuthInitError(null); return; }
    const timer = setTimeout(() => { setLoadingTimedOut(true); setAuthInitError('IVX startup took too long. Tap below to open Owner Login.'); }, TABS_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isLoading]);

  const effectiveLoading = isLoading && !loadingTimedOut;
  const openAccessMode = isOpenAccessModeEnabled();
  const isOwner = useMemo(() => {
    const role = ((profileData as { role?: string } | null)?.role ?? '').toLowerCase();
    return role === 'owner' || role === 'admin';
  }, [profileData]);

  if (effectiveLoading) {
    return <View style={styles.loadingContainer}><View style={{ width: '80%', gap: 10, marginBottom: 20 }}><Skeleton width="60%" height={20} borderRadius={10} /><Skeleton width="90%" height={14} /><Skeleton width="70%" height={14} /></View><Text style={styles.stageLabel}>STAGE 3 · SIGNING IN</Text></View>;
  }

  if (authInitError) {
    return <View style={styles.loadingContainer}><Text style={styles.loadingText}>IVX startup timed out</Text><Text style={styles.errorText}>{authInitError}</Text><TouchableOpacity style={styles.retryButton} onPress={() => { setLoadingTimedOut(false); setAuthInitError(null); try { router.replace('/login'); } catch (err) { logStartupError('ROUTER_READY', err); } }}><Text style={styles.retryButtonText}>Open Owner Login</Text></TouchableOpacity></View>;
  }

  if (!openAccessMode && !isAuthenticated) {
    logStartup('INITIAL_ROUTE_SELECTED', 'login-from-tabs-auth-gate');
    return <View style={styles.authGateContainer} testID="tabs-auth-gate"><Text style={styles.authGateBrand}>IVX</Text><Text style={styles.authGateText}>Opening secure sign in…</Text><Text style={styles.authGateStage}>STAGE 3 · AUTH ROUTE</Text><Redirect href="/login" /></View>;
  }

  logStartup('INITIAL_ROUTE_RENDERED', 'tabs');
  logStartup('APP_INTERACTIVE');
  const androidBottomInset = Platform.OS === 'android' ? Math.max(insets.bottom, 10) : insets.bottom;
  const tabBarHeight = Platform.select({ ios: 82, android: 76 + androidBottomInset, default: 72 + androidBottomInset});
  const tabBarPaddingBottom = Platform.select({ ios: 22, android: androidBottomInset, default: androidBottomInset});

  return <View style={styles.root}><Tabs initialRouteName="home" screenOptions={{ headerShown: false, tabBarActiveTintColor: tabColors.active, tabBarInactiveTintColor: tabColors.inactive, tabBarHideOnKeyboard: true, tabBarStyle: [styles.tabBar, { height: tabBarHeight, paddingBottom: tabBarPaddingBottom }], tabBarLabelStyle: styles.tabBarLabel, tabBarItemStyle: styles.tabBarItem, tabBarIconStyle: styles.tabBarIcon }}>
    <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Home color={color} size={size} strokeWidth={2.3} />, tabBarButtonTestID: 'tab-home'}} />
    <Tabs.Screen name="invest" options={{ title: 'Invest', tabBarIcon: ({ color, size }) => <TrendingUp color={color} size={size} strokeWidth={2.3} />, tabBarButtonTestID: 'tab-invest'}} />
    <Tabs.Screen name="market" options={{ title: 'Market', tabBarIcon: ({ color, size }) => <BarChart3 color={color} size={size} strokeWidth={2.3} />, tabBarButtonTestID: 'tab-market'}} />
    <Tabs.Screen name="portfolio" options={{ title: 'Portfolio', tabBarIcon: ({ color, size }) => <Briefcase color={color} size={size} strokeWidth={2.3} />, tabBarButtonTestID: 'tab-portfolio'}} />
    <Tabs.Screen name="chat" options={{ title: 'Chat', tabBarIcon: ({ color, size }) => <MessageCircle color={color} size={size} strokeWidth={2.3} />, tabBarButtonTestID: 'tab-chat'}} />
    <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <User color={color} size={size} strokeWidth={2.3} />, tabBarButtonTestID: 'tab-profile'}} />
    <Tabs.Screen name="owner-console" options={{ title: 'Owner', tabBarIcon: ({ color, size }) => <ShieldCheck color={color} size={size} strokeWidth={2.3} />, tabBarButtonTestID: 'tab-owner-console', href: isOwner ? undefined : null }} />
    <Tabs.Screen name="crm" options={{ title: 'CRM', tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} strokeWidth={2.3} />, tabBarButtonTestID: 'tab-crm', href: isOwner ? undefined : null}} />
    <Tabs.Screen name="aura" options={{ title: 'Aura', tabBarIcon: ({ color, size }) => <Sparkles color={color} size={size} strokeWidth={2.3} />, tabBarButtonTestID: 'tab-aura', href: isOwner ? undefined : null}} />
  </Tabs><FloatingChatButton /></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, loadingContainer: { flex: 1, backgroundColor: '#141007', alignItems: 'center', justifyContent: 'center', padding: 24 }, stageLabel: { color: '#6E5A1E', fontSize: 11, letterSpacing: 2, marginTop: 18, fontWeight: '700' as const }, loadingText: { color: '#FFD700', fontSize: 14, fontWeight: '600' as const, marginTop: 12, textAlign: 'center' as const }, errorText: { color: '#888', fontSize: 12, textAlign: 'center' as const, marginTop: 8, marginBottom: 24, lineHeight: 18 }, retryButton: { backgroundColor: '#FFD700', borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14 }, retryButtonText: { color: '#000', fontSize: 16, fontWeight: '700' as const }, authGateContainer: { flex: 1, backgroundColor: '#0B1220', alignItems: 'center', justifyContent: 'center', gap: 14 }, authGateBrand: { color: '#FFD700', fontSize: 34, fontWeight: 'bold' as const, letterSpacing: 6 }, authGateText: { color: '#B6B6B6', fontSize: 14, fontWeight: '600' as const }, authGateStage: { color: '#2E4468', fontSize: 11, letterSpacing: 2, fontWeight: '700' as const }, tabBar: { backgroundColor: tabColors.background, borderTopColor: tabColors.border, borderTopWidth: 0.5, paddingTop: Platform.select({ ios: 6, android: 8, default: 8 }) }, tabBarItem: { paddingVertical: 0, justifyContent: 'center' }, tabBarIcon: { marginTop: 0, marginBottom: 1 }, tabBarLabel: { fontSize: 10, fontWeight: '600' as const, marginTop: 0 },
});
