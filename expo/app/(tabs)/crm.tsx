/**
 * BLOCK 27 — Owner CRM landing (IVX → CRM).
 *
 * This route replaces the old debug/duplicate `index` tab. It is the dedicated
 * owner-only CRM hub for all tokenized deals: Capital, Sales, and Execution
 * sections that open the existing owner-gated CRM screens, with live dashboard
 * badge counts. Hidden from public/investor/buyer roles at the tab layer; the
 * screen itself also guards content so a non-owner who deep-links here sees an
 * access-restricted state instead of CRM data.
 */
import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ModuleErrorBoundary } from '@/components/ModuleErrorBoundary';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  Users,
  Building2,
  Handshake,
  Landmark,
  Send,
  Megaphone,
  Gauge,
  Crosshair,
  GitBranch,
  ClipboardList,
  Target,
  ChevronRight,
  ShieldAlert,
  Lock,
  type LucideIcon,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { isOpenAccessModeEnabled } from '@/lib/open-access';
import { listInvestors } from '@/src/modules/ivx-developer/investorCrmService';
import { listPipelineEntries } from '@/src/modules/ivx-developer/capitalPipelineService';
import { listOutreachMessages } from '@/src/modules/ivx-developer/outreachService';
import { listDeals } from '@/src/modules/ivx-developer/dealTrackingService';
import { getDealMatching } from '@/src/modules/ivx-developer/dealMatchingService';

type CrmRoute =
  | '/ivx/investors'
  | '/ivx/capital-network'
  | '/ivx/capital-outreach'
  | '/ivx/outreach'
  | '/ivx/lead-scoring'
  | '/ivx/deal-matching'
  | '/ivx/capital-pipeline'
  | '/ivx/deal-tracking'
  | '/ivx/opportunity-engine';

type CrmLink = {
  label: string;
  description: string;
  icon: LucideIcon;
  route: CrmRoute;
  testID: string;
};

type CrmSection = {
  title: string;
  accent: string;
  links: CrmLink[];
};

const CRM_SECTIONS: CrmSection[] = [
  {
    title: 'Capital',
    accent: Colors.gold,
    links: [
      { label: 'Investors', description: 'Investor CRM & relationships', icon: Users, route: '/ivx/investors', testID: 'crm-link-investors' },
      { label: 'Buyers', description: 'Buyer prospects & matching', icon: Building2, route: '/ivx/capital-network', testID: 'crm-link-buyers' },
      { label: 'Partners', description: 'Strategic partners network', icon: Handshake, route: '/ivx/capital-network', testID: 'crm-link-partners' },
      { label: 'Lenders', description: 'Financing & private credit', icon: Landmark, route: '/ivx/capital-network', testID: 'crm-link-lenders' },
    ],
  },
  {
    title: 'Sales',
    accent: Colors.info,
    links: [
      { label: 'Outreach', description: 'Capital outreach strategy', icon: Send, route: '/ivx/capital-outreach', testID: 'crm-link-outreach' },
      { label: 'Campaigns', description: 'Automated message campaigns', icon: Megaphone, route: '/ivx/outreach', testID: 'crm-link-campaigns' },
      { label: 'Lead Scores', description: 'Hot / warm / cold scoring', icon: Gauge, route: '/ivx/lead-scoring', testID: 'crm-link-lead-scores' },
      { label: 'Matching', description: 'Deal-to-investor matching', icon: Crosshair, route: '/ivx/deal-matching', testID: 'crm-link-matching' },
    ],
  },
  {
    title: 'Execution',
    accent: Colors.success,
    links: [
      { label: 'Pipeline', description: 'Capital pipeline stages', icon: GitBranch, route: '/ivx/capital-pipeline', testID: 'crm-link-pipeline' },
      { label: 'Deal Tracking', description: 'Lifecycle & outcome metrics', icon: ClipboardList, route: '/ivx/deal-tracking', testID: 'crm-link-deal-tracking' },
      { label: 'Active Opportunities', description: "Today's best opportunities", icon: Target, route: '/ivx/opportunity-engine', testID: 'crm-link-active-opportunities' },
    ],
  },
];

type BadgeData = {
  investors: number;
  buyers: number;
  activeDeals: number;
  pendingOutreach: number;
  matchesToday: number;
};

async function loadCrmBadges(): Promise<BadgeData> {
  const [investors, pipeline, outreach, deals, matching] = await Promise.allSettled([
    listInvestors(),
    listPipelineEntries(),
    listOutreachMessages(),
    listDeals(),
    getDealMatching(),
  ]);

  const investorsCount = investors.status === 'fulfilled' ? investors.value.summary?.total ?? investors.value.investors.length : 0;
  const buyersCount = pipeline.status === 'fulfilled' ? pipeline.value.summary?.activeBuyers ?? 0 : 0;
  const activeDeals =
    deals.status === 'fulfilled'
      ? (deals.value.metrics?.byStatus.open ?? 0) + (deals.value.metrics?.byStatus.in_progress ?? 0)
      : 0;
  const pendingOutreach = outreach.status === 'fulfilled' ? outreach.value.summary?.pendingApproval ?? 0 : 0;
  const matchesToday = matching.status === 'fulfilled' ? matching.value?.summary.strongMatches ?? 0 : 0;

  return {
    investors: investorsCount,
    buyers: buyersCount,
    activeDeals,
    pendingOutreach,
    matchesToday,
  };
}

type StatTile = { key: keyof BadgeData; label: string };

const STAT_TILES: StatTile[] = [
  { key: 'investors', label: 'Investors' },
  { key: 'buyers', label: 'Buyers' },
  { key: 'activeDeals', label: 'Active Deals' },
  { key: 'pendingOutreach', label: 'Pending Outreach' },
  { key: 'matchesToday', label: 'Matches Today' },
];

export default function CrmScreen() {
  const router = useRouter();
  const { profileData } = useAuth();

  const isOwner = useMemo(() => {
    // Mirror useAdminGuard: open-access builds (dev/preview) bypass the owner
    // gate so Admin → Members and CRM routes are reachable without a session.
    // Production builds keep the strict owner/admin role check.
    if (isOpenAccessModeEnabled()) return true;
    const role = ((profileData as { role?: string } | null)?.role ?? '').toLowerCase();
    return role === 'owner' || role === 'admin';
  }, [profileData]);

  const badgesQuery = useQuery({
    queryKey: ['crm-dashboard-badges'],
    queryFn: loadCrmBadges,
    enabled: isOwner,
    staleTime: 1000 * 30,
    refetchOnWindowFocus: true,
  });

  const openRoute = useCallback(
    (route: CrmRoute) => {
      router.push(route as never);
    },
    [router],
  );

  if (!isOwner) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.restricted} testID="crm-access-restricted">
          <View style={styles.restrictedIcon}>
            <Lock color={Colors.gold} size={30} strokeWidth={2.2} />
          </View>
          <Text style={styles.restrictedTitle}>Owner access only</Text>
          <Text style={styles.restrictedBody}>
            The CRM is restricted to the IVX owner. Sign in with an owner account to manage capital, sales, and execution.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const badges = badgesQuery.data;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ModuleErrorBoundary moduleName="CRM">
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={badgesQuery.isRefetching}
            onRefresh={() => badgesQuery.refetch()}
            tintColor={Colors.gold}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerBadge}>
            <ShieldAlert color={Colors.black} size={13} strokeWidth={2.6} />
            <Text style={styles.headerBadgeText}>OWNER</Text>
          </View>
          <Text style={styles.title}>CRM</Text>
          <Text style={styles.subtitle}>Capital deployment across all tokenized deals</Text>
        </View>

        <View style={styles.statsRow}>
          {STAT_TILES.map((tile) => (
            <View key={tile.key} style={styles.statTile} testID={`crm-stat-${tile.key}`}>
              {badgesQuery.isLoading ? (
                <ActivityIndicator color={Colors.gold} size="small" />
              ) : (
                <Text style={styles.statValue}>{badges ? badges[tile.key] : 0}</Text>
              )}
              <Text style={styles.statLabel}>{tile.label}</Text>
            </View>
          ))}
        </View>

        {badgesQuery.isError && (
          <Text style={styles.errorNote}>
            Live counts unavailable. Pull to refresh, or open a section directly below.
          </Text>
        )}

        {CRM_SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionDot, { backgroundColor: section.accent }]} />
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
            <View style={styles.card}>
              {section.links.map((link, idx) => {
                const Icon = link.icon;
                return (
                  <TouchableOpacity
                    key={link.testID}
                    style={[styles.row, idx === section.links.length - 1 && styles.rowLast]}
                    onPress={() => openRoute(link.route)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${link.label}`}
                    testID={link.testID}
                  >
                    <View style={[styles.rowIcon, { borderColor: section.accent }]}>
                      <Icon color={section.accent} size={19} strokeWidth={2.2} />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.rowLabel}>{link.label}</Text>
                      <Text style={styles.rowDescription}>{link.description}</Text>
                    </View>
                    <ChevronRight color={Colors.textTertiary} size={18} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        <View style={styles.footerSpace} />
      </ScrollView>
      </ModuleErrorBoundary>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  header: {
    marginBottom: 20,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    backgroundColor: Colors.gold,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 10,
  },
  headerBadgeText: {
    color: Colors.black,
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 0.6,
  },
  title: {
    color: Colors.text,
    fontSize: 32,
    fontWeight: '800' as const,
    letterSpacing: -0.5,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  statTile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 76,
  },
  statValue: {
    color: Colors.gold,
    fontSize: 24,
    fontWeight: '800' as const,
  },
  statLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600' as const,
    marginTop: 4,
    textAlign: 'center',
  },
  errorNote: {
    color: Colors.warning,
    fontSize: 12,
    marginTop: -12,
    marginBottom: 18,
  },
  section: {
    marginBottom: 22,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    marginLeft: 2,
  },
  sectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: 16,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 11,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.backgroundSecondary,
  },
  rowText: {
    flex: 1,
    marginLeft: 13,
  },
  rowLabel: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
  },
  rowDescription: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  restricted: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  restrictedIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  restrictedTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800' as const,
    marginBottom: 8,
  },
  restrictedBody: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  footerSpace: {
    height: 24,
  },
});
