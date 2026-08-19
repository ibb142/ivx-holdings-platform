import { Tabs } from 'expo-router';
import { BarChart3, Briefcase, Home, LayoutDashboard, MessageCircle, Sparkles, TrendingUp, User } from 'lucide-react-native';
import { DiagnosticErrorBoundary } from '@/components/DiagnosticErrorBoundary';
import React, { useEffect, useMemo } from 'react';
import { Platform, StyleSheet, View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FloatingChatButton from '@/components/FloatingChatButton';
import { useAuth } from '@/lib/auth-context';
import { isOpenAccessModeEnabled } from '@/lib/open-access';
import { Skeleton } from '@/components/InstantSkeleton';
import { logStartup, logStartupError } from '@/lib/startup-trace';

export function ErrorBoundary(props: { children: React.ReactNode }) {
  return <DiagnosticErrorBoundary>{props.children}</DiagnosticErrorBoundary>;
}

const tabColors = {
  active: '#FFD700',
  inactive: '#777777',
  background: '#0A0A0F',
  border: '#242424'};

function AuthTransitionScreen({ message }: { message: string }) {
  return (
    <View style={styles.loadingContainer} testID="tabs-auth-transition">
      <View style={{ width: '80%', gap: 10, marginBottom: 20 }}>
        <Skeleton width="60%" height={20} borderRadius={10} />
        <Skeleton width="90%" height={14} />
        <Skeleton width="70%" height={14} />
      </View>
      <Text style={styles.loadingText}>{message}</Text>
    </View>
  );
}

export default function TabsLayout() {
  logStartup('ROUTER_READY');
  logStartup('INITIAL_ROUTE_SELECTED', 'tabs');
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profileData, isAuthenticated, isLoading } = useAuth();
  const openAccess = isOpenAccessModeEnabled();

  const isOwner = useMemo(() => {
    const role = ((profileData as { role?: string } | null)?.role ?? '').toLowerCase();
    return role === 'owner' || role === 'admin';
  }, [profileData]);

  useEffect(() => {
    if (openAccess || isLoading || isAuthenticated) {
      return;
    }
    const timer = setTimeout(() => {
      try {
        router.replace('/login');
      } catch (err) {
        logStartupError('ROUTER_READY', err);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [openAccess, isLoading, isAuthenticated, router]);

  // Never render an empty/black tab surface while auth state is resolving or
  // while the router is moving an unauthenticated user back to login.
  if (isLoading) {
    return <AuthTransitionScreen message="Loading secure session…" />;
  }

  if (!openAccess && !isAuthenticated) {
    return <AuthTransitionScreen message="Opening sign in…" />;
  }

  logStartup('INITIAL_ROUTE_RENDERED', 'tabs');
  logStartup('APP_INTERACTIVE');

  const androidBottomInset = Platform.OS === 'android' ? Math.max(insets.bottom, 10) : insets.bottom;
  const tabBarHeight = Platform.select({
    ios: 82,
    android: 76 + androidBottomInset,
    default: 72 + androidBottomInset});
  const tabBarPaddingBottom = Platform.select({
    ios: 22,
    android: androidBottomInset,
    default: androidBottomInset});

  return (
    <View style={styles.root}>
      <Tabs
        initialRouteName="(home)"
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: '#0A0A0F' },
          tabBarActiveTintColor: tabColors.active,
          tabBarInactiveTintColor: tabColors.inactive,
          tabBarHideOnKeyboard: true,
          tabBarStyle: [styles.tabBar, { height: tabBarHeight, paddingBottom: tabBarPaddingBottom }],
          tabBarLabelStyle: styles.tabBarLabel,
          tabBarItemStyle: styles.tabBarItem,
          tabBarIconStyle: styles.tabBarIcon}}
      >
        <Tabs.Screen
          name="(home)"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => <Home color={color} size={size} strokeWidth={2.3} />,
            tabBarButtonTestID: 'tab-home'}}
        />
        <Tabs.Screen
          name="invest"
          options={{
            title: 'Invest',
            tabBarIcon: ({ color, size }) => <TrendingUp color={color} size={size} strokeWidth={2.3} />,
            tabBarButtonTestID: 'tab-invest'}}
        />
        <Tabs.Screen
          name="market"
          options={{
            title: 'Market',
            tabBarIcon: ({ color, size }) => <BarChart3 color={color} size={size} strokeWidth={2.3} />,
            tabBarButtonTestID: 'tab-market'}}
        />
        <Tabs.Screen
          name="portfolio"
          options={{
            title: 'Portfolio',
            tabBarIcon: ({ color, size }) => <Briefcase color={color} size={size} strokeWidth={2.3} />,
            tabBarButtonTestID: 'tab-portfolio'}}
        />
        <Tabs.Screen
          name="chat"
          options={{
            title: 'Chat',
            tabBarIcon: ({ color, size }) => <MessageCircle color={color} size={size} strokeWidth={2.3} />,
            tabBarButtonTestID: 'tab-chat'}}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size }) => <User color={color} size={size} strokeWidth={2.3} />,
            tabBarButtonTestID: 'tab-profile'}}
        />
        <Tabs.Screen
          name="crm"
          options={{
            title: 'CRM',
            tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} strokeWidth={2.3} />,
            tabBarButtonTestID: 'tab-crm',
            href: isOwner ? undefined : null}}
        />
        <Tabs.Screen
          name="aura"
          options={{
            title: 'Aura',
            tabBarIcon: ({ color, size }) => <Sparkles color={color} size={size} strokeWidth={2.3} />,
            tabBarButtonTestID: 'tab-aura',
            href: isOwner ? undefined : null}}
        />
      </Tabs>
      <FloatingChatButton />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0A0F'},
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0A0A0F',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24},
  loadingText: {
    color: '#FFD700',
    fontSize: 14,
    fontWeight: '600' as const,
    marginTop: 12,
    textAlign: 'center' as const},
  tabBar: {
    backgroundColor: tabColors.background,
    borderTopColor: tabColors.border,
    borderTopWidth: 0.5,
    paddingTop: Platform.select({ ios: 6, android: 8, default: 8 })},
  tabBarItem: {
    paddingVertical: 0,
    justifyContent: 'center'},
  tabBarIcon: {
    marginTop: 0,
    marginBottom: 1},
  tabBarLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    marginTop: 0}});
