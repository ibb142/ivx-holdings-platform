import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ModuleErrorBoundary } from '@/components/ModuleErrorBoundary';
import {
  Bell,
  ChevronRight,
  Clapperboard,
  Shield,
  TrendingUp,
  Award,
  CheckCircle2,
  Users,
  Building2,
  Brain,
  BarChart3,
  Home,
  Handshake,
  Sparkles,
  Lock,
} from 'lucide-react-native';
import { useRouter, Link } from 'expo-router';
import { useScreenFocusState } from '@/hooks/useScreenFocusState';
import Colors from '@/constants/colors';
import { getResponsiveSize, isCompactScreen, isExtraSmallScreen } from '@/lib/responsive';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { resolvePrimaryDealPhoto, usePublishedJVDeals, triggerManualJVRefresh } from '@/lib/parse-deal';
import { HomeSkeleton } from '@/components/SkeletonLoader';
import { supabase } from '@/lib/supabase';
import { useJVRealtime, usePublicationWatchdog } from '@/lib/jv-realtime';
import { useTranslation } from '@/lib/i18n-context';
import { useAnalytics } from '@/lib/analytics-context';
import { useAuth } from '@/lib/auth-context';
import { isOpenAccessModeEnabled } from '@/lib/open-access';
import QuickBuyModal from '@/components/QuickBuyModal';
import InvestorFirstFeed from '@/components/InvestorFirstFeed';
import type { JVAgreement } from '@/types/jv';

function getPrimaryDealPhoto(deal: JVAgreement): string | undefined {
  const primaryPhoto = resolvePrimaryDealPhoto({
    id: deal.id,
    title: deal.title,
    projectName: deal.projectName,
    photos: deal.photos,
    publishedAt: deal.publishedAt,
    createdAt: deal.createdAt,
    updatedAt: deal.updatedAt,
    updated_at: typeof (deal as unknown as Record<string, unknown>).updated_at === 'string'
      ? ((deal as unknown as Record<string, unknown>).updated_at as string)
      : undefined,
  });

  if (primaryPhoto) {
  }

  return primaryPhoto;
}



function ExploreDealsSection({ router }: { router: ReturnType<typeof useRouter> }) {
  const actions = useMemo(
    () => [
      {
        icon: Home,
        title: 'Buy Property Shares',
        subtitle: 'Fractional ownership in premium real estate',
        tint: Colors.gold,
        onPress: () => router.push('/(tabs)/market' as any),
        testID: 'explore-buy-shares',
      },
      {
        icon: Handshake,
        title: 'JV Partnerships',
        subtitle: 'View JV Deals',
        tint: Colors.blue,
        onPress: () => router.push('/(tabs)/invest' as any),
        testID: 'explore-jv-partnerships',
      },
      {
        icon: Brain,
        title: 'Smart Investing',
        subtitle: 'Get Started',
        tint: Colors.green,
        onPress: () => router.push('/(tabs)/chat' as any),
        testID: 'explore-smart-investing',
      },
      {
        icon: BarChart3,
        title: 'Investor Dashboard',
        subtitle: 'Track performance & distributions',
        tint: Colors.orange,
        onPress: () => router.push('/(tabs)/portfolio' as any),
        testID: 'explore-investor-dashboard',
      },
      {
        icon: TrendingUp,
        title: 'Performance Center',
        subtitle: 'ROI, distributions & deal metrics',
        tint: Colors.primary,
        onPress: () => router.push('/investor-performance' as any),
        testID: 'explore-investor-performance',
      },
    ],
    [router],
  );

  return (
    <View style={exploreStyles.container}>
      <View style={exploreStyles.header}>
        <Text style={exploreStyles.title}>Explore Deals</Text>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => router.push('/(tabs)/market' as any)}
          testID="explore-all-options"
        >
          <View style={exploreStyles.seeAll}>
            <Text style={exploreStyles.seeAllText}>All Options</Text>
            <ChevronRight size={14} color={Colors.primary} />
          </View>
        </TouchableOpacity>
      </View>
      <View style={exploreStyles.grid}>
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <TouchableOpacity
              key={action.testID}
              style={exploreStyles.card}
              activeOpacity={0.7}
              onPress={action.onPress}
              testID={action.testID}
              accessibilityRole="button"
              accessibilityLabel={action.title}
            >
              <View style={[exploreStyles.iconWrap, { backgroundColor: action.tint + '15' }]}>
                <Icon size={22} color={action.tint} />
              </View>
              <Text style={exploreStyles.cardTitle}>{action.title}</Text>
              <Text style={exploreStyles.cardSubtitle}>{action.subtitle}</Text>
              <ChevronRight size={16} color={Colors.textTertiary} style={exploreStyles.cardArrow} />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const exploreStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700' as const,
  },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seeAllText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 14,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  cardTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
    marginBottom: 4,
    paddingRight: 18,
  },
  cardSubtitle: {
    color: Colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
  },
  cardArrow: {
    position: 'absolute',
    top: 14,
    right: 14,
  },
});

function InlineTrustBadges({ t }: { t: (key: any) => string }) {
  return (
    <View style={styles.inlineTrustRow}>
      <View style={styles.inlineTrustBadge}>
        <Shield size={12} color={Colors.success} />
        <Text style={styles.inlineTrustText}>{t('secCompliant')}</Text>
      </View>
      <View style={styles.inlineTrustDot} />
      <View style={styles.inlineTrustBadge}>
        <CheckCircle2 size={12} color={Colors.success} />
        <Text style={styles.inlineTrustText}>{t('fdicEscrow')}</Text>
      </View>
      <View style={styles.inlineTrustDot} />
      <View style={styles.inlineTrustBadge}>
        <Award size={12} color={Colors.success} />
        <Text style={styles.inlineTrustText}>{t('audited')}</Text>
      </View>
    </View>
  );
}

function TrustBadge({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <View style={trustStyles.row}>
      <View style={trustStyles.iconWrap}>{icon}</View>
      <View style={trustStyles.text}>
        <Text style={trustStyles.title}>{title}</Text>
        <Text style={trustStyles.subtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

const trustStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 14,
    marginBottom: 8,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
  },
  title: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  subtitle: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
});

class JVErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: any) { console.error('[JV Section] Error caught:', error); }
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ padding: 20 }}>
          <Text style={{ color: Colors.textSecondary, textAlign: 'center' }}>JV section temporarily unavailable</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function HomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { isAuthenticated, isLoading: authLoading, userRole } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [quickBuyVisible, setQuickBuyVisible] = useState(false);
  const [quickBuyDeal, setQuickBuyDeal] = useState<{
    id: string;
    title: string;
    projectName: string;
    totalInvestment: number;
    expectedROI: number;
    photo?: string;
    propertyAddress?: string;
    type?: string;
    minInvestment?: number;
    propertyMarketValue?: number;
    salePrice?: number;
    fractionalSharePrice?: number;
    timelineMin?: number;
    timelineMax?: number;
    priceChange1h?: number;
    priceChange2h?: number;
  } | null>(null);
  const { t } = useTranslation();
  const analytics = useAnalytics();
  const screenSize = getResponsiveSize(width);
  const isCompact = isCompactScreen(screenSize);
  const isXs = isExtraSmallScreen(screenSize);

  useJVRealtime('home-jv-deals', true);
  usePublicationWatchdog(true);

  useEffect(() => {
    analytics?.trackScreen?.('Home');
  }, [analytics]);

  const isScreenFocused = useScreenFocusState(true);
  const publishedJV = usePublishedJVDeals({ refetchIntervalMs: isScreenFocused ? 1000 * 90 : false });

  const jvDealsLoading = publishedJV.isLoading;
  const jvDeals = useMemo(() => {
    try {
      const rawDeals = publishedJV.deals;
      const backendDeals = (Array.isArray(rawDeals) ? rawDeals : []) as unknown as JVAgreement[];
      const validBackendDeals = backendDeals.filter(d => {
        if (!d || !d.id) return false;
        if (!d.title && !d.projectName) return false;
        const s = d.status as string;
        if (s === 'trashed' || s === 'archived' || s === 'permanently_deleted') return false;
        return true;
      });

      const mapped = validBackendDeals.map(deal => {
        const base = {
          ...deal,
          title: deal.title || deal.projectName || 'Untitled Deal',
          projectName: deal.projectName || deal.title || '',
          partners: (deal.partners as any),
          profitSplit: Array.isArray(deal.profitSplit) ? deal.profitSplit : [],
        };
        return base;
      }) as JVAgreement[];

      if (mapped.length > 0) {
        return mapped;
      }
      return [];
    } catch (err) {
      console.error('[Home JV] Error processing deals:', err);
      return [];
    }
  }, [publishedJV.deals]);

  const queryClient = useQueryClient();

  const unreadQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { count: 0 };
      const { count, error } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('read', false);
      if (error) return { count: 0 };
      return { count: count || 0 };
    },
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 1000 * 60 * 10,
  });

  const unreadNotifications = unreadQuery.data?.count ?? 0;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      triggerManualJVRefresh();
      await Promise.all([
        unreadQuery.refetch(),
        publishedJV.refetch(),
        queryClient.invalidateQueries({ queryKey: ['ivx-home-feed'] }),
      ]);
    } catch (err) {
    } finally {
      setRefreshing(false);
    }
  }, [unreadQuery, publishedJV, queryClient]);

  const openQuickBuy = useCallback((deal: JVAgreement) => {
    const primaryPhoto = getPrimaryDealPhoto(deal);
    const rawDeal = deal as unknown as Record<string, unknown>;
    const marketVal = typeof rawDeal.property_market_value === 'number' ? rawDeal.property_market_value
      : typeof rawDeal.propertyMarketValue === 'number' ? rawDeal.propertyMarketValue
      : typeof rawDeal.market_value === 'number' ? rawDeal.market_value
      : undefined;
    const trustMarket = rawDeal.trustMarket as {
      minInvestment?: number;
      salePrice?: number;
      explicitSalePrice?: number;
      fractionalSharePrice?: number;
      timelineMin?: number;
      timelineMax?: number;
      priceChange1h?: number;
      priceChange2h?: number;
    } | undefined;
    setQuickBuyDeal({
      id: deal.id,
      title: deal.title,
      projectName: deal.projectName,
      totalInvestment: deal.totalInvestment,
      expectedROI: deal.expectedROI,
      photo: primaryPhoto,
      propertyAddress: deal.propertyAddress,
      type: deal.type,
      minInvestment: trustMarket?.minInvestment ? Math.max(trustMarket.minInvestment, 1) : 50,
      propertyMarketValue: marketVal as number | undefined,
      salePrice: trustMarket?.explicitSalePrice,
      fractionalSharePrice: trustMarket?.fractionalSharePrice,
      timelineMin: trustMarket?.timelineMin,
      timelineMax: trustMarket?.timelineMax,
      priceChange1h: trustMarket?.priceChange1h,
      priceChange2h: trustMarket?.priceChange2h,
    });
    setQuickBuyVisible(true);
  }, []);

  const handleOpenOwnerLogin = useCallback((): void => {
    try {
      router.push('/login?ownerMode=1' as any);
    } catch (pushError) {
    }
  }, [router]);

  useEffect(() => {
  }, [authLoading, isAuthenticated, userRole]);

  void handleOpenOwnerLogin;

  const isOwner = useMemo(() => {
    if (isOpenAccessModeEnabled()) return true;
    const role = (userRole ?? '').toLowerCase();
    return role === 'owner' || role === 'admin';
  }, [userRole]);

  return (
    <View style={styles.container}>
      <ModuleErrorBoundary moduleName="Home">
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
        <View style={[styles.header, { paddingHorizontal: isXs ? 16 : 16 }]}>
          <View style={styles.brandContainer}>
            <Text style={styles.brandTitle}>IVXHOLDINGS</Text>
            <Text style={styles.brandSubtitle}>Institutional Real Estate Investment</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => router.push({ pathname: '/videos', params: { type: 'reel' } } as any)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Project Reels"
              accessibilityHint="Opens the dedicated Project Reels module — construction updates and drone footage"
              testID="home-reels-button"
            >
              <Clapperboard size={isXs ? 22 : 24} color={Colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => router.push('/notifications' as any)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={unreadNotifications > 0 ? `Notifications, ${unreadNotifications} unread` : 'Notifications'}
              accessibilityHint="Opens notifications screen"
              testID="home-notification-button"
            >
              <Bell size={isXs ? 22 : 24} color={Colors.text} />
              {unreadNotifications > 0 ? (
                <View style={styles.notificationBadge}>
                  <Text style={styles.notificationBadgeText}>{unreadNotifications}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          style={[styles.scrollView, Platform.OS === 'web' && styles.scrollViewWeb]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
            />
          }
        >
          {jvDealsLoading && jvDeals.length === 0 && !refreshing && (
            <HomeSkeleton />
          )}

          {(!jvDealsLoading || jvDeals.length > 0) && (
            <>
              <View style={[styles.welcomeSection, { paddingHorizontal: isXs ? 16 : 20 }]}>
                <InlineTrustBadges t={t} />
              </View>

              <ExploreDealsSection router={router} />

              <JVErrorBoundary>
                <InvestorFirstFeed
                  jvDeals={jvDeals}
                  jvDealsLoading={jvDealsLoading}
                  isXs={isXs}
                  cardWidth={width}
                  openQuickBuy={openQuickBuy}
                />
              </JVErrorBoundary>
            </>
          )}

          <View style={{ paddingHorizontal: isXs ? 16 : 20, marginBottom: 24 }}>
            <TrustBadge
              icon={<Sparkles size={20} color={Colors.primary} />}
              title="AI Investing"
              subtitle="Smart analysis picks the best deals for you"
            />
            <TrustBadge
              icon={<Lock size={20} color={Colors.primary} />}
              title="Secure Escrow"
              subtitle="Escrow-protected funds on every investment"
            />
            <TrustBadge
              icon={<BarChart3 size={20} color={Colors.primary} />}
              title="Beating Markets"
              subtitle="Performance-focused real estate strategies"
            />
            <TrustBadge
              icon={<TrendingUp size={20} color={Colors.primary} />}
              title="Instant Liquidity"
              subtitle="Trade shares 24/7 — no lockup periods"
            />
          </View>

          {isOwner && (
            <View style={{ paddingHorizontal: isXs ? 16 : 20, marginBottom: 20 }}>
              <Link
                href={{ pathname: '/login', params: { ownerMode: '1' } } as any}
                asChild
              >
                <TouchableOpacity
                  style={styles.ownerCTA}
                  onPress={handleOpenOwnerLogin}
                  activeOpacity={0.8}
                  testID="home-owner-login-entry"
                  accessibilityRole="button"
                  accessibilityLabel="Owner Login, direct owner sign in inside the app"
                >
                  <View style={styles.ownerCTALeft}>
                    <View style={styles.ownerCTAIcon}>
                      <Shield size={20} color={Colors.primary} />
                    </View>
                    <View style={styles.ownerCTAMeta}>
                      <Text style={styles.ownerCTATitle}>Owner Login</Text>
                      <Text style={styles.ownerCTASubtitle}>Direct approved-owner route inside the app.</Text>
                    </View>
                  </View>
                  <ChevronRight size={18} color={Colors.primary} />
                </TouchableOpacity>
              </Link>
            </View>
          )}

          <Text style={styles.footer}>IVX HOLDINGS LLC</Text>

          <View style={styles.bottomPadding} />
        </ScrollView>
      </SafeAreaView>
      </ModuleErrorBoundary>

      <QuickBuyModal
        visible={quickBuyVisible}
        onClose={() => setQuickBuyVisible(false)}
        deal={quickBuyDeal}
        onNavigateToFullInvest={(dealId) => {
          router.push({ pathname: '/jv-invest', params: { jvId: dealId } } as any);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  brandContainer: {
    flexDirection: 'column',
    justifyContent: 'center',
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '900' as const,
    color: Colors.primary,
    letterSpacing: 0.5,
  },
  brandSubtitle: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  notificationButton: {
    position: 'relative' as const,
    padding: 8,
  },
  notificationBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: Colors.error,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  notificationBadgeText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: '700' as const,
  },
  welcomeSection: {
    paddingTop: 4,
    paddingBottom: 8,
  },
  inlineTrustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
    flexWrap: 'wrap',
  },
  inlineTrustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  inlineTrustText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  inlineTrustDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: Colors.textTertiary,
  },
  ownerCTA: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  ownerCTALeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  ownerCTAIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerCTAMeta: {
    flex: 1,
    minWidth: 0,
  },
  ownerCTATitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  ownerCTASubtitle: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  footer: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const,
    textAlign: 'center',
    marginTop: 8,
  },
  bottomPadding: {
    height: 120,
  },
  scrollView: {
    backgroundColor: Colors.background,
  },
  scrollViewWeb: {
    // @ts-ignore: web-only CSS property to hide scrollbar
    scrollbarWidth: 'none',
    // @ts-ignore: web-only CSS property
    msOverflowStyle: 'none',
  } as any,
});
