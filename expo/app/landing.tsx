import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  ScrollView,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
  Alert,
  Share,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import {
  TrendingUp,
  Shield,
  Users,
  Lock,
  ArrowRight,
  CheckCircle2,
  Coins,
  Clock,
  Mail,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  MapPin,
  Landmark,
  Building2,
  BarChart3,
  Globe,
  ChevronRight,
  Star,
  Zap,
  Instagram,
  MessageCircle,
  Linkedin,
  ExternalLink,
  ScanLine,
  Play,
} from 'lucide-react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { landingTracker } from '@/lib/landing-tracker';

import ErrorBoundary from '@/components/ErrorBoundary';
import { renderSafeViewChildren } from '@/components/SafeViewChildren';
import Colors from '@/constants/colors';
import { IVX_LOGO_SOURCE } from '@/constants/brand';
import { fetchCanonicalDeals } from '@/lib/canonical-deals';
import type { PublishedDealCardModel } from '@/lib/published-deal-card-model';
import type { ParsedJVDeal } from '@/lib/parse-deal';
import InvestorIntakeForm from '@/components/InvestorIntakeForm';
import InvestmentCard, { type InvestmentCardData } from '@/components/InvestmentCard';
import { resolveDealTrustMarket, resolveDealPhotos } from '@/lib/parse-deal';
import { buildOwnershipSnapshot } from '@/lib/ownership-math';
import { resolveCanonicalDealIdentity } from '@/lib/deal-identity';
import { buildTimelineSummary, type TimelineSummary } from '@/lib/timeline-stages';
import { canonicalCardToParsedDeal } from '@/lib/canonical-deals';
import InvestorSupportChat, { type HumanSupportRequestResult } from '@/components/InvestorSupportChat';
import {
  diagnoseDealPhotos,
  type DealPhotoDiagnostic,
} from '@/lib/deal-photo-health';
import { useAuth, type OwnerDirectAccessAuditResult } from '@/lib/auth-context';
import type { ChatMessage } from '@/types';
import {
  type CreateSupportTicketParams,
  type SupportTicketRow,
  buildLiveSupportTicketDraft,
  createSupportTicket,
} from '@/lib/support-chat';
import { isOpenAccessModeEnabled } from '@/lib/open-access';

const IVX_BUSINESS_CARD_URL = 'https://r2-pub.rork.com/projects/j2l8t44588ix9ns7b57mu/assets/13a98cc9-5275-4104-8380-38ee2d5b1fca.png';

const SOCIAL_LINKS = [
  { id: 'website', label: 'ivxholding.com', url: 'https://ivxholding.com', icon: Globe, color: '#FFD700' },
  { id: 'instagram', label: '@IVXHolding', url: 'https://www.instagram.com/ivxholding?igsh=MXYzZWtxMGxxOGRucg==', icon: Instagram, color: '#E1306C' },
  { id: 'tiktok', label: '@IVXInvesting', url: 'https://www.tiktok.com/@IVXInvesting', icon: Zap, color: '#00F2EA' },
  { id: 'linkedin', label: 'IVX Holdings', url: 'https://www.linkedin.com/company/ivxholdings', icon: Linkedin, color: '#0A66C2' },
];

const GOLD = '#FFD700';
const GOLD_DIM = '#C9A800';
const SURFACE_ELEVATED = '#181818';
const ACCENT_GREEN = '#00C48C';
const ACCENT_BLUE = '#4A90D9';

const STATS = [
  { value: '3', label: 'Upcoming Deals', icon: Building2 },
  { value: '$50', label: 'Min Investment', icon: Coins },
  { value: '25%+', label: 'Target ROI', icon: TrendingUp },
];

const FEATURES = [
  {
    icon: Coins,
    gradient: ['#00C48C', '#00A376'] as const,
    title: 'Start from $50',
    desc: 'Own fractional shares in premium real estate projects worldwide',
  },
  {
    icon: Shield,
    gradient: ['#4A90D9', '#357ABD'] as const,
    title: 'Escrow Protected',
    desc: 'Funds held in escrow until deal milestones are verified and met',
  },
  {
    icon: TrendingUp,
    gradient: [GOLD, GOLD_DIM] as const,
    title: 'Target 25%+ ROI',
    desc: 'Curated deals with strong projected returns and transparent financials',
  },
  {
    icon: Lock,
    gradient: ['#E040FB', '#AA00FF'] as const,
    title: 'LLC Structure',
    desc: 'Each deal backed by a dedicated LLC entity for maximum protection',
  },
];

const TRUST_ITEMS = [
  { text: 'LLC-Backed Investments', icon: Building2 },
  { text: 'Escrow-Protected Funds', icon: Shield },
  { text: 'Title Insurance Verified', icon: CheckCircle2 },
  { text: 'Permit-Approved Projects', icon: Star },
];

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Create Your Account',
    desc: 'Request investor access, complete onboarding, and review the active offering terms before participating.',
    accent: ACCENT_GREEN,
  },
  {
    step: '02',
    title: 'Review Live Real Estate Deals',
    desc: 'Explore curated properties with photos, financials, entity details, and deal-specific disclosures.',
    accent: ACCENT_BLUE,
  },
  {
    step: '03',
    title: 'Commit When Terms Fit',
    desc: 'Eligible investors can participate from $50 on supported offerings, subject to each deal’s terms.',
    accent: GOLD,
  },
];

const COMPANY_FACTS = [
  {
    id: 'entity',
    label: 'Legal entity',
    value: 'IVX Holdings LLC',
    detail: 'Deal disclosures, offering terms, and investor communications are issued under the IVX entity.',
    icon: Building2,
    accent: GOLD,
  },
  {
    id: 'contact',
    label: 'Investor relations',
    value: 'investors@ivxholding.com',
    detail: 'Response target within 24 hours for inbound investor questions.',
    icon: Mail,
    accent: ACCENT_GREEN,
  },
  {
    id: 'address',
    label: 'Business address',
    value: '1001 Brickell Bay Drive, Suite 2700, Miami, FL 33131',
    detail: 'Primary investor correspondence and diligence support location.',
    icon: MapPin,
    accent: ACCENT_BLUE,
  },
  {
    id: 'team',
    label: 'Founder / team diligence',
    value: 'Leadership introductions available during active diligence',
    detail: 'Prospective investors can request a live call with management and deal operations before committing.',
    icon: Users,
    accent: GOLD_DIM,
  },
];

const INVESTOR_DISCLOSURES = [
  {
    id: 'risk',
    title: 'Risk disclaimer',
    text: 'All investments involve risk, including partial or total loss of capital. Past performance does not predict future results.',
  },
  {
    id: 'fees',
    title: 'Fees',
    text: 'Fees, operating expenses, and sponsor compensation vary by offering and should be reviewed in the deal terms before participating.',
  },
  {
    id: 'liquidity',
    title: 'Liquidity / exit terms',
    text: 'Real estate offerings are typically illiquid. Exit timing, hold periods, and repayment waterfalls are defined per deal.',
  },
  {
    id: 'returns',
    title: 'No guaranteed returns',
    text: 'Projected ROI, distributions, and timelines are underwriting estimates only. They can change based on project performance.',
  },
];

const MEMBER_READY_ITEMS = [
  {
    id: 'registration',
    title: 'Member registration',
    text: 'Approved applicants move from public intake into a verified member account before live allocation access is opened.',
    icon: Users,
    accent: ACCENT_GREEN,
  },
  {
    id: 'profile',
    title: 'Investor profiles',
    text: 'Member profiles store verified contact data, onboarding status, and deal access readiness for each investor.',
    icon: ShieldCheck,
    accent: ACCENT_BLUE,
  },
  {
    id: 'wallet',
    title: 'Wallet readiness',
    text: 'Funding methods and wallet access are prepared inside the platform before a member moves into live deal execution.',
    icon: Landmark,
    accent: GOLD,
  },
  {
    id: 'records',
    title: 'Transaction records',
    text: 'Statements, transaction history, and investment status records remain visible inside approved member accounts.',
    icon: BarChart3,
    accent: GOLD_DIM,
  },
];

const INVESTOR_FAQS = [
  {
    id: 'registration',
    question: 'Do you have member registration already?',
    answer: 'Yes. Qualified applicants can move from the public intake into verified member registration once investor review is complete.',
  },
  {
    id: 'profiles-wallets',
    question: 'Do approved members get profiles and wallet access?',
    answer: 'Yes. The platform supports member profiles, onboarding status, and wallet readiness before funding is enabled for a live deal.',
  },
  {
    id: 'records',
    question: 'Are transaction records and statements tracked?',
    answer: 'Yes. Member accounts are designed to surface transaction records, statements, and investment status visibility after approval.',
  },
  {
    id: 'management',
    question: 'Can investors speak with management before committing?',
    answer: 'Yes. Qualified prospects can request a management diligence call during active review before moving into final commitment steps.',
  },
];

const LANDING_CHAT_QUICK_REPLIES = [
  'How do I start investing?',
  'Show me live deals',
  'Frontend or app issue',
  'AWS or backend support',
  'ChatGPT integration help',
  'Can I speak with management?',
] as const;

const LANDING_CHAT_WELCOME_MESSAGE = 'Hello! Welcome to IVX investor support. Ask about live deals, investor approval, frontend or backend support, AWS operations, or ChatGPT and OpenAI integration.';

function AnimatedCounter({ value, delay }: { value: string; delay: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    const timeout = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, tension: 100, friction: 14, useNativeDriver: true }),
      ]).start();
    }, delay);
    return () => clearTimeout(timeout);
  }, [opacity, translateY, delay]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <Text style={styles.statValue}>{value}</Text>
    </Animated.View>
  );
}

function FadeInView({ delay = 0, children, style }: { delay?: number; children: React.ReactNode; style?: object }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    const timeout = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, tension: 80, friction: 12, useNativeDriver: true }),
      ]).start();
    }, delay);
    return () => clearTimeout(timeout);
  }, [opacity, translateY, delay]);

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {renderSafeViewChildren(children)}
    </Animated.View>
  );
}



type LandingShowcaseDeal = PublishedDealCardModel & {
  resolvedPhotos: string[];
  photoDiagnostic: DealPhotoDiagnostic;
};

function buildLandingShowcaseDeal(deal: LandingShowcaseDeal): ParsedJVDeal {
  const trustInfo = deal.rawTrustInfo;
  const publishedAt = deal.publishedAt || '';

  return {
    id: deal.id,
    title: deal.title,
    projectName: deal.projectName,
    type: deal.dealType || 'development',
    expectedROI: deal.expectedROI,
    totalInvestment: deal.totalInvestment,
    propertyValue: deal.propertyValue || deal.salePrice,
    salePrice: deal.explicitSalePrice,
    partners: deal.partnersCount,
    description: deal.descriptionShort,
    propertyAddress: deal.addressFull || deal.addressShort,
    distributionFrequency: deal.distributionFrequency,
    exitStrategy: deal.exitStrategy,
    photos: deal.resolvedPhotos,
    published: true,
    publishedAt,
    created_at: publishedAt,
    status: deal.status,
    trustInfo,
    trustMarket: {
      salePrice: deal.salePrice || deal.propertyValue || deal.totalInvestment,
      explicitSalePrice: deal.explicitSalePrice,
      minInvestment: deal.minInvestment,
      fractionalSharePrice: deal.fractionalSharePrice,
      timelineMin: trustInfo?.timelineMin,
      timelineMax: trustInfo?.timelineMax,
      timelineUnit: trustInfo?.timelineUnit ?? 'months',
      priceChange1h: trustInfo?.priceChange1h ?? 10,
      priceChange2h: trustInfo?.priceChange2h ?? 18,
      ownershipLabel: deal.ownershipText || trustInfo?.ownershipLabel,
    },
    city: deal.city,
    state: deal.state,
    country: deal.country,
    developerName: deal.developerName,
  };
}

function LandingDealsShowcase({ scrollToForm }: { scrollToForm: () => void }) {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [userId, setUserId] = useState<string | null>(null);
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = Math.min(screenWidth - 48, 380);

  // Resolve user ID for engagement tracking
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      try {
        const { supabase } = await import('@/lib/supabase');
        const { data: { session } } = await supabase.auth.getSession();
        if (!cancelled && session?.user?.id) setUserId(session.user.id);
      } catch {}
    };
    if (isAuthenticated) void resolve();
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  const dealsQuery = useQuery<LandingShowcaseDeal[]>({
    queryKey: ['landing-deals-showcase'],
    queryFn: async (): Promise<LandingShowcaseDeal[]> => {
      try {
        const canonicalResult = await fetchCanonicalDeals(false, 'public_api');
        const cards = canonicalResult.deals.slice(0, 5);
        const resolvedDeals = await Promise.all(cards.map(async (card) => {
          const photoDiagnostic = await diagnoseDealPhotos(card);
          const resolvedPhotos = photoDiagnostic.resolvedPhotos;
          return { ...card, resolvedPhotos, photoDiagnostic };
        }));
        return resolvedDeals;
      } catch (err) {
        return [];
      }
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchInterval: 1000 * 60 * 5,
    refetchIntervalInBackground: false,
  });

  const deals = dealsQuery.data ?? [];
  const isLoading = dealsQuery.isPending;

  return (
    <FadeInView delay={200}>
      <View style={dealStyles.section} testID="landing-featured-deals-section">
        <View style={dealStyles.sectionHeader}>
          <View style={dealStyles.sectionLabelRow}>
            <Zap size={12} color={ACCENT_GREEN} />
            <Text style={dealStyles.sectionLabel}>LIVE OPPORTUNITIES</Text>
          </View>
          <Text style={dealStyles.sectionTitle}>Featured Deals</Text>
          <Text style={dealStyles.sectionSubtitle}>Real properties with photos, financials, and projected returns</Text>
        </View>

        {isLoading ? (
          <View style={[dealStyles.statusCard, dealStyles.statusCardLoading]}>
            <ActivityIndicator size="small" color={GOLD} />
            <Text style={dealStyles.statusTitle}>Loading live deals</Text>
            <Text style={dealStyles.statusText}>Fetching the same published deals used by the app.</Text>
          </View>
        ) : deals.length === 0 ? (
          <View style={dealStyles.statusCard}>
            <Landmark size={28} color={GOLD} />
            <Text style={dealStyles.statusTitle}>No live deals are published yet</Text>
            <Text style={dealStyles.statusText}>The featured deals section is active. It will populate automatically when published deals are available in the shared source.</Text>
            <TouchableOpacity style={dealStyles.investBtn} onPress={scrollToForm} activeOpacity={0.85} testID="landing-deals-empty-cta">
              <Text style={dealStyles.investBtnText}>Request Investor Review</Text>
              <ArrowRight size={15} color="#000" />
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            horizontal
            pagingEnabled={false}
            snapToInterval={cardWidth + 14}
            snapToAlignment="start"
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 0 }}
          >
            {deals.map((deal, idx) => {
              const sharedDeal = buildLandingShowcaseDeal(deal);
              const rawDeal = canonicalCardToParsedDeal(deal) as unknown as Record<string, unknown>;

              const trustMarket = resolveDealTrustMarket(rawDeal);
              const ownershipSnapshot = buildOwnershipSnapshot(trustMarket.minInvestment, trustMarket.salePrice);
              const identity = resolveCanonicalDealIdentity(rawDeal);
              const timelineSummary: TimelineSummary | null = buildTimelineSummary(
                trustMarket.timelineMin,
                trustMarket.timelineMax,
                trustMarket.timelineUnit,
                (rawDeal.timeline_stages as any) ?? null,
                deal.publishedAt ?? null,
              );

              const salePrice = trustMarket.explicitSalePrice ?? trustMarket.salePrice ?? null;
              const totalInvestment = deal.totalInvestment ?? null;
              const minInvestment = deal.minInvestment ?? trustMarket.minInvestment ?? null;

              const cardData: InvestmentCardData = {
                dealId: deal.id,
                title: deal.title ?? identity.title ?? 'IVX Investment',
                location: deal.addressShort ?? deal.city ?? null,
                photos: deal.resolvedPhotos.slice(0, 8),
                roi: deal.expectedROI ?? null,
                minimumInvestment: minInvestment,
                status: deal.status ?? 'published',
                category: deal.dealType ?? null,
                dealUrl: `https://ivxholding.com/invest/${deal.id}`,
                likeCount: 0,
                commentCount: 0,
                saveCount: 0,
                shareCount: 0,
                isLiked: false,
                isSaved: false,
                salePrice: salePrice && salePrice > 0 ? salePrice : null,
                totalInvestment: totalInvestment && totalInvestment > 0 ? totalInvestment : null,
                timelineMin: trustMarket.timelineMin ?? null,
                timelineMax: trustMarket.timelineMax ?? null,
                timelineUnit: trustMarket.timelineUnit ?? null,
                minimumOwnershipPercent: ownershipSnapshot.ownershipPercent > 0 ? ownershipSnapshot.ownershipPercent : null,
                fractionalStartAmount: minInvestment ?? trustMarket.fractionalSharePrice ?? null,
                developerName: identity.developerName ?? deal.developerName ?? null,
                developerLogo: null,
                investmentDetails: deal.descriptionShort ?? null,
                timelineSummary,
              };

              return (
                <View key={deal.id || `deal-${idx}`} style={{ width: cardWidth, marginRight: idx < deals.length - 1 ? 14 : 0 }} testID={`landing-deal-card-${deal.id || idx}`}>
                  <InvestmentCard
                    data={cardData}
                    onOpenDeal={(d) => {
                      router.push(`/jv-invest?jvId=${d.dealId}` as any);
                    }}
                    onInvest={() => {
                      scrollToForm();
                    }}
                    onLike={() => {}}
                    onComment={() => {}}
                    onSave={() => {}}
                    onShare={async (d: InvestmentCardData) => {
                      try { await Share.share({ message: `${d.title} — ${d.dealUrl}` }); } catch {}
                    }}
                    testIDPrefix="landing-card"
                  />
                </View>
              );
            })}
          </ScrollView>
        )}

        <Text style={dealStyles.disclaimer}>
          Deal information is for preliminary review. Projected returns, distributions, fees, and timelines vary by offering and are not guaranteed.
        </Text>
      </View>
    </FadeInView>
  );
}

const dealStyles = StyleSheet.create({
  section: {
    paddingHorizontal: 24,
    marginBottom: 48,
  },
  sectionHeader: {
    marginBottom: 20,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  sectionLabel: {
    color: ACCENT_GREEN,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.8,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800' as const,
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  sectionSubtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  card: {
    backgroundColor: SURFACE_ELEVATED,
    borderRadius: 18,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: '#252525',
  },
  cardContent: {
    padding: 18,
  },
  liveBadgeRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 10,
    marginBottom: 10,
  },
  liveBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    backgroundColor: ACCENT_GREEN + '15',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: ACCENT_GREEN,
  },
  liveBadgeText: {
    color: ACCENT_GREEN,
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 1,
  },
  sourceBadge: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  sourceBadgeText: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.8,
  },
  dealTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800' as const,
    marginBottom: 6,
  },
  locationRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginBottom: 14,
  },
  locationText: {
    color: Colors.textTertiary,
    fontSize: 13,
  },
  metricsRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#0E0E0E',
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1E1E1E',
  },
  metric: {
    flex: 1,
    alignItems: 'center' as const,
  },
  metricValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800' as const,
    marginBottom: 2,
  },
  metricLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '600' as const,
  },
  metricDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#252525',
  },
  proofGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
    marginBottom: 12,
  },
  marketStrip: {
    flexDirection: 'row' as const,
    gap: 10,
    marginBottom: 14,
  },
  marketPill: {
    flex: 1,
    backgroundColor: '#0E0E0E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E1E1E',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  marketPillLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
    marginBottom: 6,
    textTransform: 'uppercase' as const,
  },
  marketPillValue: {
    color: '#F5F5F5',
    fontSize: 12,
    fontWeight: '800' as const,
  },
  proofCard: {
    width: '47%',
    backgroundColor: '#101010',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#222',
    padding: 12,
    minHeight: 74,
  },
  proofLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
    marginBottom: 6,
  },
  proofValue: {
    color: '#F5F5F5',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600' as const,
  },
  exitProjectionCard: {
    backgroundColor: '#0D1310',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: ACCENT_GREEN + '20',
    padding: 14,
    marginBottom: 14,
  },
  exitProjectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 10,
    marginBottom: 10,
  },
  exitProjectionTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800' as const,
    flex: 1,
  },
  exitProjectionTimeline: {
    color: ACCENT_GREEN,
    fontSize: 11,
    fontWeight: '700' as const,
  },
  exitProjectionGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
  },
  exitProjectionItem: {
    width: '47%',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  exitProjectionLabel: {
    color: '#6E8B78',
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
    marginBottom: 6,
  },
  exitProjectionValue: {
    color: '#F5F5F5',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700' as const,
  },
  cardDisclosure: {
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 17,
    marginBottom: 14,
  },
  investBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: GOLD,
    borderRadius: 14,
    paddingVertical: 14,
  },
  investBtnText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '800' as const,
  },
  disclaimer: {
    color: Colors.textTertiary,
    fontSize: 10,
    textAlign: 'center' as const,
    marginTop: 16,
    lineHeight: 15,
    fontStyle: 'italic' as const,
  },
  statusCard: {
    backgroundColor: SURFACE_ELEVATED,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#252525',
    paddingHorizontal: 18,
    paddingVertical: 22,
    alignItems: 'center' as const,
    gap: 10,
  },
  statusCardLoading: {
    minHeight: 180,
    justifyContent: 'center' as const,
  },
  statusTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800' as const,
    textAlign: 'center' as const,
  },
  statusText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center' as const,
    maxWidth: 320,
    marginBottom: 4,
  },
  photoFallback: {
    backgroundColor: '#0E0E0E',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
  },
  photoFallbackText: {
    color: Colors.textTertiary,
    fontSize: 12,
  },
  photoLoading: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    zIndex: 1,
    backgroundColor: '#0A0A0A',
  },
  photoGradient: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
  },
  counterBadge: {
    position: 'absolute' as const,
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    zIndex: 2,
  },
  counterText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600' as const,
  },
  dotsRow: {
    position: 'absolute' as const,
    bottom: 14,
    left: 0,
    right: 0,
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: 5,
    zIndex: 2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    backgroundColor: '#fff',
    width: 20,
  },
  dotInactive: {
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
});


function LandingWaitlistForm() {
  return (
    <InvestorIntakeForm
      variant="landing"
      source="landing_page"
      pagePath="/"
      testIdPrefix="landing-investor"
    />
  );
}



export default function LandingScreen() {
  const router = useRouter();
  const openAccessMode = isOpenAccessModeEnabled();
  const {
    isAuthenticated,
    isAdmin,
    isOwnerIPAccess,
    isLoading: authLoading,
    auditOwnerDirectAccess,
    ownerDirectAccess,
    ownerAccessLoading,
  } = useAuth();
  const heroFade = useRef(new Animated.Value(0)).current;
  const heroSlide = useRef(new Animated.Value(50)).current;
  const logoScale = useRef(new Animated.Value(0.6)).current;
  const logoRotate = useRef(new Animated.Value(0)).current;
  const ctaFade = useRef(new Animated.Value(0)).current;
  const ctaSlide = useRef(new Animated.Value(30)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const scrollRef = useRef<ScrollView>(null);
  const scrollMilestones = useRef<Set<number>>(new Set());
  const sectionViewsTracked = useRef<Set<string>>(new Set());
  const [formSectionY, setFormSectionY] = useState<number>(0);
  const [ownerAccessAudit, setOwnerAccessAudit] = useState<OwnerDirectAccessAuditResult | null>(null);
  const landingSupportMutation = useMutation<SupportTicketRow, Error, CreateSupportTicketParams>({
    mutationFn: createSupportTicket,
  });

  useEffect(() => {
    try {
      void landingTracker.init();
      landingTracker.trackPageView();
    } catch (e) {
    }

    return () => {
      try {
        landingTracker.trackSessionEnd();
        landingTracker.destroy();
      } catch (e) {
      }
    };
  }, []);

  const trackSectionOnce = useCallback((section: string) => {
    try {
      if (!sectionViewsTracked.current.has(section)) {
        sectionViewsTracked.current.add(section);
        landingTracker.trackSectionView(section);
      }
    } catch {}
  }, []);

  const handleScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number }; layoutMeasurement: { height: number }; contentSize: { height: number } } }) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    const scrollableHeight = contentSize.height - layoutMeasurement.height;
    if (scrollableHeight <= 0) return;
    const pct = Math.round((contentOffset.y / scrollableHeight) * 100);
    const milestones = [25, 50, 75, 100];
    for (const m of milestones) {
      if (pct >= m && !scrollMilestones.current.has(m)) {
        scrollMilestones.current.add(m);
        landingTracker.trackScroll(m);
      }
    }
    if (pct >= 5) trackSectionOnce('hero');
    if (pct >= 20) trackSectionOnce('features');
    if (pct >= 35) trackSectionOnce('deals');
    if (pct >= 50) trackSectionOnce('how_it_works');
    if (pct >= 65) trackSectionOnce('trust_security');
    if (pct >= 80) trackSectionOnce('waitlist_form');
    if (pct >= 95) trackSectionOnce('footer');
  }, [trackSectionOnce]);

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(logoScale, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }),
        Animated.timing(logoRotate, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(heroFade, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.spring(heroSlide, { toValue: 0, tension: 40, friction: 10, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(ctaFade, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(ctaSlide, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
      ]),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 2000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
      ])
    ).start();
  }, [heroFade, heroSlide, logoScale, logoRotate, ctaFade, ctaSlide, pulseAnim]);

  const handleFormLayout = useCallback((event: LayoutChangeEvent) => {
    const nextY = event.nativeEvent.layout.y;
    setFormSectionY(nextY);
  }, []);

  const refreshOwnerAccessAudit = useCallback(async () => {
    try {
      const audit = await auditOwnerDirectAccess();
      setOwnerAccessAudit(audit);
    } catch (e) {
      setOwnerAccessAudit(null);
    }
  }, [auditOwnerDirectAccess]);

  useEffect(() => {
    if (openAccessMode || authLoading || isAuthenticated) {
      return;
    }
    void refreshOwnerAccessAudit();
  }, [authLoading, isAuthenticated, openAccessMode, refreshOwnerAccessAudit]);

  const handleOwnerEntry = useCallback(async () => {
    try {
      if (openAccessMode) {
        router.replace('/admin' as any);
        return;
      }
      const result = await ownerDirectAccess();
      if (result.success) {
        router.replace('/(tabs)/(home)/home' as any);
        return;
      }
      await refreshOwnerAccessAudit();
      Alert.alert('Owner Access Unavailable', result.message);
    } catch (e) {
      Alert.alert('Error', 'Could not complete owner access. Please try again.');
    }
  }, [openAccessMode, ownerDirectAccess, refreshOwnerAccessAudit, router]);

  const scrollToForm = () => {
    try { landingTracker.trackCtaClick('join_waitlist'); } catch {}
    if (!scrollRef.current) {
      return;
    }

    if (formSectionY > 0) {
      scrollRef.current.scrollTo({ y: Math.max(0, formSectionY - 24), animated: true });
      return;
    }

    scrollRef.current.scrollToEnd({ animated: true });
  };

  const openExternalLink = useCallback(async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('Link unavailable', 'Please try again in a moment.');
    }
  }, []);

  const handleLandingHumanSupport = useCallback(
    async (messages: ChatMessage[]): Promise<HumanSupportRequestResult> => {
      const draft = buildLiveSupportTicketDraft(messages, 'Landing Live Chat');

      try {
        const data = await landingSupportMutation.mutateAsync({
          subject: draft.subject,
          category: draft.category,
          message: draft.message,
          priority: draft.priority,
        });
        return {
          ok: true,
          message: `Your request has been submitted (Ticket #${data.id.slice(-6)}). Investor support will follow up shortly by email with the right team for this issue.`,
        };
      } catch (error) {
        console.error('[Landing] Live support request failed:', error);
        return {
          ok: false,
          message: 'We could not create your live support request right now. Please email investors@ivxholding.com.',
        };
      }
    },
    [landingSupportMutation]
  );

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={true}
          keyboardShouldPersistTaps="handled"
          onScroll={handleScroll}
          scrollEventThrottle={200}
        >
          {/* NAV BAR */}
          <SafeAreaView edges={['top']} style={styles.safeTop}>
            <View style={styles.topBar}>
              <View style={styles.topBarBrand}>
                <Image source={IVX_LOGO_SOURCE} style={styles.topBarLogo} resizeMode="contain" />
                <View>
                  <Text style={styles.topBarName}>IVX</Text>
                  <Text style={styles.topBarTagline}>HOLDINGS</Text>
                </View>
              </View>
              <View style={styles.topBarActions}>
                {openAccessMode ? (
                  <>
                    <TouchableOpacity
                      style={[styles.ownerConsoleLink, styles.ownerConsoleLinkReady]}
                      onPress={() => router.push({ pathname: '/login', params: { ownerMode: '1' } } as any)}
                      activeOpacity={0.7}
                      testID="landing-owner-login"
                    >
                      <ShieldCheck size={14} color={GOLD} />
                      <Text style={[styles.ownerConsoleLinkText, styles.ownerConsoleLinkTextReady]}>Owner Login</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.ownerConsoleLink, styles.ownerConsoleLinkReady]}
                      onPress={() => router.push('/admin' as any)}
                      activeOpacity={0.7}
                      testID="landing-owner-console"
                    >
                      <ScanLine size={14} color={GOLD} />
                      <Text style={[styles.ownerConsoleLinkText, styles.ownerConsoleLinkTextReady]}>Admin</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.loginLink}
                      onPress={() => {
                        try { landingTracker.trackCtaClick('videos'); } catch {}
                        router.push('/videos' as any);
                      }}
                      activeOpacity={0.7}
                      testID="landing-videos"
                    >
                      <Play size={13} color={GOLD} />
                      <Text style={styles.loginLinkText}>Videos</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.loginLink}
                      onPress={() => {
                        try { landingTracker.trackCtaClick('open_app'); } catch {}
                        router.push('/(tabs)/(home)/home' as any);
                      }}
                      activeOpacity={0.7}
                      testID="landing-login"
                    >
                      <Text style={styles.loginLinkText}>Open App</Text>
                      <ChevronRight size={14} color={GOLD} />
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity
                      style={[
                        styles.ownerConsoleLink,
                        (ownerAccessAudit?.eligible || isOwnerIPAccess || (isAuthenticated && isAdmin)) && styles.ownerConsoleLinkReady,
                      ]}
                      onPress={() => router.push({ pathname: '/login', params: { ownerMode: '1' } } as any)}
                      activeOpacity={0.7}
                      testID="landing-owner-login"
                    >
                      <ScanLine
                        size={14}
                        color={(ownerAccessAudit?.eligible || isOwnerIPAccess || (isAuthenticated && isAdmin)) ? GOLD : Colors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.ownerConsoleLinkText,
                          (ownerAccessAudit?.eligible || isOwnerIPAccess || (isAuthenticated && isAdmin)) && styles.ownerConsoleLinkTextReady,
                        ]}
                      >
                        Owner Login
                      </Text>
                    </TouchableOpacity>
                    {ownerAccessAudit?.eligible ? (
                      <TouchableOpacity
                        style={[styles.ownerEntryLink, ownerAccessLoading && styles.ownerEntryLinkDisabled]}
                        onPress={() => { void handleOwnerEntry(); }}
                        disabled={ownerAccessLoading}
                        activeOpacity={0.7}
                        testID="landing-owner-entry"
                      >
                        {ownerAccessLoading ? (
                          <ActivityIndicator size="small" color={GOLD} />
                        ) : (
                          <ShieldCheck size={14} color={GOLD} />
                        )}
                        <Text style={styles.ownerEntryLinkText}>Restore</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={styles.loginLink}
                      onPress={() => {
                        try { landingTracker.trackCtaClick('videos'); } catch {}
                        router.push('/videos' as any);
                      }}
                      activeOpacity={0.7}
                      testID="landing-videos-guest"
                    >
                      <Play size={13} color={GOLD} />
                      <Text style={styles.loginLinkText}>Videos</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.memberRegisterButton}
                      onPress={() => {
                        try { landingTracker.trackCtaClick('member_register'); } catch {}
                        router.push('/auth?mode=signup' as any);
                      }}
                      activeOpacity={0.7}
                      testID="landing-member-register"
                    >
                      <Text style={styles.memberRegisterButtonText}>Get Started</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.loginLink}
                      onPress={() => {
                        try { landingTracker.trackCtaClick('sign_in'); } catch {}
                        router.push('/auth' as any);
                      }}
                      activeOpacity={0.7}
                      testID="landing-login"
                    >
                      <Text style={styles.loginLinkText}>Sign In</Text>
                      <ChevronRight size={14} color={GOLD} />
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          </SafeAreaView>

          {/* HERO */}
          <Animated.View style={[styles.heroSection, {
            opacity: heroFade,
            transform: [{ translateY: heroSlide }],
          }]}>
            {!openAccessMode && ownerAccessAudit?.eligible ? (
              <TouchableOpacity
                style={[styles.ownerVerifiedPill, ownerAccessLoading && styles.ownerVerifiedPillDisabled]}
                onPress={() => { void handleOwnerEntry(); }}
                disabled={ownerAccessLoading}
                activeOpacity={0.82}
                testID="landing-owner-entry-pill"
              >
                {ownerAccessLoading ? (
                  <ActivityIndicator size="small" color={GOLD} />
                ) : (
                  <ShieldCheck size={13} color={GOLD} />
                )}
                <Text style={styles.ownerVerifiedPillText}>
                  {ownerAccessLoading
                    ? 'Opening owner modules…'
                    : `Owner access ready${ownerAccessAudit.currentIP ? ` · ${ownerAccessAudit.currentIP}` : ''}`}
                </Text>
                <ArrowRight size={13} color={GOLD} />
              </TouchableOpacity>
            ) : null}
            <Animated.View style={[styles.heroLogoWrap, { transform: [{ scale: logoScale }] }]}>
              <View style={styles.heroLogoCard}>
                <Image source={IVX_LOGO_SOURCE} style={styles.heroLogo} resizeMode="contain" />
              </View>
            </Animated.View>

            <View style={styles.comingSoonBadge}>
              <Clock size={11} color={ACCENT_GREEN} />
              <Text style={styles.comingSoonText}>INVESTOR INTAKE OPEN</Text>
            </View>

            <Text style={styles.heroTitle}>
              Invest in{'\n'}
              <Text style={styles.heroTitleGold}>Real Estate</Text>
              {'\n'}from Anywhere
            </Text>

            <Text style={styles.heroSubtitle}>
              Request investor access to review curated real estate offerings, investor disclosures, and deal-specific terms. Fractional access starts from $50 on eligible deals.
            </Text>

            <View style={styles.openAccessPill} testID="landing-open-access-pill">
              <Globe size={14} color={GOLD} />
              <View style={styles.openAccessCopy}>
                <Text style={styles.openAccessTitle}>Review offer eligibility</Text>
                <Text style={styles.openAccessText}>Availability depends on each deal’s terms and onboarding review.</Text>
              </View>
            </View>

            <View style={styles.statsRow}>
              {STATS.map((stat, i) => (
                <View key={stat.label} style={[styles.statBlock, i < STATS.length - 1 && styles.statBlockBorder]}>
                  <stat.icon size={16} color={GOLD} style={{ marginBottom: 6 }} />
                  <AnimatedCounter value={stat.value} delay={600 + i * 250} />
                  <Text style={styles.statLabel}>{stat.label}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.statsDisclaimer}>Target returns are projections only. All investments involve risk.</Text>
          </Animated.View>

          {/* CTA BUTTONS */}
          <Animated.View style={[styles.ctaSection, {
            opacity: ctaFade,
            transform: [{ translateY: ctaSlide }],
          }]}>
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={scrollToForm}
                activeOpacity={0.85}
                testID="landing-get-started"
              >
                <LinearGradient
                  colors={[GOLD, '#E6B800']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.primaryBtnGradient}
                >
                  <Text style={styles.primaryBtnText}>Request Investor Access</Text>
                  <ArrowRight size={20} color="#000" />
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => {
                try { landingTracker.trackCtaClick(openAccessMode ? 'open_workspace' : 'sign_in_approved'); } catch {}
                router.push((openAccessMode ? '/(tabs)/(home)/home' : '/login') as any);
              }}
              activeOpacity={0.8}
              testID="landing-sign-in"
            >
              <Text style={styles.secondaryBtnText}>{openAccessMode ? 'Workspace is open now. ' : 'Already have an account? '}</Text>
              <Text style={[styles.secondaryBtnText, { color: GOLD }]}>{openAccessMode ? 'Open App' : 'Sign In'}</Text>
            </TouchableOpacity>

            {!openAccessMode ? (
              <TouchableOpacity
                style={styles.openOwnerLoginBtn}
                onPress={() => {
                  try { landingTracker.trackCtaClick('open_owner_login'); } catch {}
                  router.push({ pathname: '/auth', params: { mode: 'owner' } } as any);
                }}
                activeOpacity={0.85}
                testID="open-owner-login"
                accessibilityLabel="Open Owner Login"
                accessibilityRole="button"
              >
                <ShieldCheck size={18} color={GOLD} />
                <Text style={styles.openOwnerLoginBtnText}>Open Owner Login</Text>
                <ArrowRight size={16} color={GOLD} />
              </TouchableOpacity>
            ) : null}
          </Animated.View>

          {/* FEATURES */}
          <FadeInView delay={100}>
            <View style={styles.featuresSection}>
              <View style={styles.sectionLabelRow}>
                <BarChart3 size={12} color={GOLD} />
                <Text style={[styles.sectionLabel, { color: GOLD }]}>WHY INVESTORS CHOOSE US</Text>
              </View>
              <Text style={styles.sectionTitle}>Built for Modern Investors</Text>

              <View style={styles.featuresGrid}>
                {FEATURES.map((feat) => (
                  <View key={feat.title} style={styles.featureCard}>
                    <LinearGradient
                      colors={[feat.gradient[0] + '20', feat.gradient[1] + '08']}
                      style={styles.featureIconWrap}
                    >
                      <feat.icon size={22} color={feat.gradient[0]} />
                    </LinearGradient>
                    <Text style={styles.featureTitle}>{feat.title}</Text>
                    <Text style={styles.featureDesc}>{feat.desc}</Text>
                  </View>
                ))}
              </View>
            </View>
          </FadeInView>

          {/* LIVE DEALS */}
          <ErrorBoundary fallbackTitle="Deals temporarily unavailable">
            <LandingDealsShowcase scrollToForm={scrollToForm} />
          </ErrorBoundary>

          {/* INVESTMENT OPTIONS */}
          <FadeInView delay={100}>
            <View style={styles.investTypesSection}>
              <View style={styles.sectionLabelRow}>
                <Globe size={12} color={ACCENT_BLUE} />
                <Text style={[styles.sectionLabel, { color: ACCENT_BLUE }]}>INVESTMENT OPTIONS</Text>
              </View>
              <Text style={styles.sectionTitle}>Two Ways to Invest</Text>

              <View style={styles.investTypeCard}>
                <LinearGradient
                  colors={[ACCENT_GREEN + '20', ACCENT_GREEN + '05']}
                  style={styles.investTypeIcon}
                >
                  <Coins size={26} color={ACCENT_GREEN} />
                </LinearGradient>
                <View style={styles.investTypeContent}>
                  <View style={styles.previewLabelRow}>
                    <Text style={styles.investTypeTitle}>Fractional Shares</Text>
                    <View style={styles.previewBadge}><Text style={styles.previewBadgeText}>Preview</Text></View>
                  </View>
                  <Text style={styles.investTypeDesc}>
                    Buy property shares from $50. Earn projected returns from real estate development projects.
                  </Text>
                  <TouchableOpacity style={styles.investTypeCta} onPress={scrollToForm} activeOpacity={0.7}>
                    <Text style={[styles.investTypeCtaText, { color: ACCENT_GREEN }]}>Request Access</Text>
                    <ArrowRight size={13} color={ACCENT_GREEN} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.investTypeCard}>
                <LinearGradient
                  colors={[GOLD + '20', GOLD + '05']}
                  style={styles.investTypeIcon}
                >
                  <Users size={26} color={GOLD} />
                </LinearGradient>
                <View style={styles.investTypeContent}>
                  <View style={styles.previewLabelRow}>
                    <Text style={styles.investTypeTitle}>JV Partnerships</Text>
                    <View style={styles.previewBadge}><Text style={styles.previewBadgeText}>Preview</Text></View>
                  </View>
                  <Text style={styles.investTypeDesc}>
                    Direct equity stake in live deals. Partner with developers on premium real estate projects.
                  </Text>
                  <TouchableOpacity style={styles.investTypeCta} onPress={scrollToForm} activeOpacity={0.7}>
                    <Text style={[styles.investTypeCtaText, { color: GOLD }]}>Request Deal Access</Text>
                    <ArrowRight size={13} color={GOLD} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </FadeInView>

          {/* HOW IT WORKS */}
          <FadeInView delay={100}>
            <View style={styles.howItWorksSection}>
              <View style={styles.sectionLabelRow}>
                <Sparkles size={12} color={GOLD} />
                <Text style={[styles.sectionLabel, { color: GOLD }]}>SIMPLE PROCESS</Text>
              </View>
              <Text style={styles.sectionTitle}>How It Works</Text>

              {HOW_IT_WORKS.map((item, i) => (
                <View key={`step-${i}`} style={styles.stepCard}>
                  <View style={[styles.stepNumber, { backgroundColor: item.accent + '18' }]}>
                    <Text style={[styles.stepNumberText, { color: item.accent }]}>{item.step}</Text>
                  </View>
                  <View style={styles.stepContent}>
                    <Text style={styles.stepTitle}>{item.title}</Text>
                    <Text style={styles.stepDesc}>{item.desc}</Text>
                  </View>
                  {i < HOW_IT_WORKS.length - 1 && (
                    <View style={styles.stepConnector} />
                  )}
                </View>
              ))}
            </View>
          </FadeInView>

          {/* TRUST */}
          <FadeInView delay={100}>
            <View style={styles.trustSection}>
              <LinearGradient
                colors={[GOLD + '15', GOLD + '05']}
                style={styles.trustShield}
              >
                <Shield size={30} color={GOLD} />
              </LinearGradient>
              <Text style={styles.trustTitle}>Built for Investor Diligence</Text>
              <Text style={styles.trustSubtitle}>Each live deal is presented with entity structure, document checks, and a clearer payment flow before commitment.</Text>

              <View style={styles.trustGrid}>
                {TRUST_ITEMS.map((item) => (
                  <View key={item.text} style={styles.trustItem}>
                    <item.icon size={16} color={ACCENT_GREEN} />
                    <Text style={styles.trustItemText}>{item.text}</Text>
                  </View>
                ))}
              </View>
            </View>
          </FadeInView>

          {/* COMPANY CREDIBILITY */}
          <FadeInView delay={100}>
            <View style={styles.credibilitySection} testID="landing-credibility-section">
              <View style={styles.sectionLabelRow}>
                <Building2 size={12} color={ACCENT_GREEN} />
                <Text style={[styles.sectionLabel, { color: ACCENT_GREEN }]}>COMPANY CREDIBILITY</Text>
              </View>
              <Text style={styles.sectionTitle}>Who investors are dealing with</Text>
              <Text style={styles.credibilityIntro}>
                Clear company identity, contact points, and diligence access reduce friction before paid traffic starts.
              </Text>
              <View style={styles.credibilityGrid}>
                {COMPANY_FACTS.map((item) => (
                  <View key={item.id} style={styles.credibilityCard}>
                    <View style={[styles.credibilityIconWrap, { backgroundColor: item.accent + '18' }]}> 
                      <item.icon size={18} color={item.accent} />
                    </View>
                    <Text style={styles.credibilityLabel}>{item.label}</Text>
                    <Text style={styles.credibilityValue}>{item.value}</Text>
                    <Text style={styles.credibilityDetail}>{item.detail}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.credibilityActions}>
                <TouchableOpacity
                  style={[styles.credibilityActionButton, styles.credibilityActionPrimary]}
                  onPress={() => { void openExternalLink('mailto:investors@ivxholding.com'); }}
                  activeOpacity={0.85}
                  testID="landing-email-investor-relations"
                >
                  <Mail size={15} color="#000" />
                  <Text style={styles.credibilityActionPrimaryText}>Email Investor Relations</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.credibilityActionButton}
                  onPress={() => { void openExternalLink('mailto:investors@ivxholding.com?subject=Management%20Call%20Request'); }}
                  activeOpacity={0.8}
                  testID="landing-call-management"
                >
                  <MessageCircle size={15} color={GOLD} />
                  <Text style={styles.credibilityActionText}>Request Management Call</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.credibilityActionButton}
                  onPress={() => router.push('/trust-center' as any)}
                  activeOpacity={0.8}
                  testID="landing-open-trust-center"
                >
                  <ExternalLink size={15} color={GOLD} />
                  <Text style={styles.credibilityActionText}>Open Trust Center</Text>
                </TouchableOpacity>
              </View>
            </View>
          </FadeInView>

          {/* INVESTOR DISCLOSURES */}
          <FadeInView delay={100}>
            <View style={styles.disclosureSection} testID="landing-disclosure-section">
              <View style={styles.sectionLabelRow}>
                <AlertCircle size={12} color={GOLD} />
                <Text style={[styles.sectionLabel, { color: GOLD }]}>INVESTOR DISCLOSURES</Text>
              </View>
              <Text style={styles.sectionTitle}>Review these before you click in</Text>
              <View style={styles.disclosureCard}>
                {INVESTOR_DISCLOSURES.map((item, index) => (
                  <View key={item.id} style={[styles.disclosureRow, index < INVESTOR_DISCLOSURES.length - 1 && styles.disclosureRowBorder]}>
                    <View style={styles.disclosureBullet} />
                    <View style={styles.disclosureTextWrap}>
                      <Text style={styles.disclosureTitle}>{item.title}</Text>
                      <Text style={styles.disclosureText}>{item.text}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </FadeInView>

          <FadeInView delay={100}>
            <View style={styles.memberAccessSection} testID="landing-member-access-section">
              <View style={styles.sectionLabelRow}>
                <CheckCircle2 size={12} color={ACCENT_GREEN} />
                <Text style={[styles.sectionLabel, { color: ACCENT_GREEN }]}>MEMBER ACCESS READINESS</Text>
              </View>
              <Text style={styles.sectionTitle}>What unlocks after approval</Text>
              <Text style={styles.memberAccessIntro}>
                The public page now shows the path into verified member registration, profile activation, wallet preparation, and record visibility.
              </Text>
              <View style={styles.memberAccessGrid}>
                {MEMBER_READY_ITEMS.map((item) => (
                  <View key={item.id} style={styles.memberAccessCard}>
                    <View style={[styles.memberAccessIconWrap, { backgroundColor: item.accent + '18' }]}> 
                      <item.icon size={18} color={item.accent} />
                    </View>
                    <Text style={styles.memberAccessTitle}>{item.title}</Text>
                    <Text style={styles.memberAccessText}>{item.text}</Text>
                  </View>
                ))}
              </View>
            </View>
          </FadeInView>

          <FadeInView delay={100}>
            <View style={styles.chatSection} testID="landing-chat-section">
              <View style={styles.sectionLabelRow}>
                <MessageCircle size={12} color={ACCENT_BLUE} />
                <Text style={[styles.sectionLabel, { color: ACCENT_BLUE }]}>INVESTOR CHAT</Text>
              </View>
              <Text style={styles.sectionTitle}>The same IVX chat now lives on the landing page</Text>
              <Text style={styles.chatIntro}>
                Visitors can ask investor questions, get technical-support answers about the app, backend, AWS, and AI integrations from the same chat used in the app, and request live support without leaving the landing flow.
              </Text>
              <View style={styles.chatHighlights}>
                <View style={styles.chatHighlightCard}>
                  <Text style={styles.chatHighlightTitle}>App-parity experience</Text>
                  <Text style={styles.chatHighlightText}>The landing page now exposes the same IVX support chat used inside the app.</Text>
                </View>
                <View style={styles.chatHighlightCard}>
                  <Text style={styles.chatHighlightTitle}>AI first, human when needed</Text>
                  <Text style={styles.chatHighlightText}>Visitors can self-serve fast answers on deals, technical issues, AWS, and AI integrations or escalate to investor support for follow-up.</Text>
                </View>
                <View style={styles.chatHighlightCard}>
                  <Text style={styles.chatHighlightTitle}>Conversion without friction</Text>
                  <Text style={styles.chatHighlightText}>Questions about deals, approval, and management access are answered before the intake form.</Text>
                </View>
              </View>
              <ErrorBoundary fallbackTitle="Support chat temporarily unavailable">
                <InvestorSupportChat
                  variant="card"
                  style={styles.chatShell}
                  source="landing"
                  testIdPrefix="landing-support-chat"
                  requestHumanLabel="Request Live Investor Support"
                  welcomeMessage={LANDING_CHAT_WELCOME_MESSAGE}
                  quickReplies={LANDING_CHAT_QUICK_REPLIES}
                  onRequestHumanSupport={handleLandingHumanSupport}
                />
              </ErrorBoundary>
            </View>
          </FadeInView>

          <FadeInView delay={100}>
            <View nativeID="waitlist" style={styles.waitlistFormSection} onLayout={handleFormLayout} testID="landing-waitlist-section">
              <LinearGradient
                colors={[ACCENT_GREEN + '08', 'transparent']}
                style={styles.waitlistFormGlow}
              />
              <View style={styles.waitlistFormBadge}>
                <Sparkles size={13} color={GOLD} />
                <Text style={styles.waitlistFormBadgeText}>INVESTOR ACCESS</Text>
              </View>
              <Text style={styles.waitlistFormTitle}>Request Investor Access</Text>
              <Text style={styles.waitlistFormSubtitle}>
                Submit your details for investor review, deal updates, and management follow-up.
              </Text>

              <ErrorBoundary fallbackTitle="Form temporarily unavailable">
                <LandingWaitlistForm />
              </ErrorBoundary>
            </View>
          </FadeInView>

          <FadeInView delay={100}>
            <View style={styles.faqSection} testID="landing-investor-faq-section">
              <View style={styles.sectionLabelRow}>
                <ShieldCheck size={12} color={GOLD} />
                <Text style={[styles.sectionLabel, { color: GOLD }]}>INVESTOR FAQ</Text>
              </View>
              <Text style={styles.sectionTitle}>Questions serious investors ask first</Text>
              <View style={styles.faqGrid}>
                {INVESTOR_FAQS.map((item) => (
                  <View key={item.id} style={styles.faqCard}>
                    <Text style={styles.faqQuestion}>{item.question}</Text>
                    <Text style={styles.faqAnswer}>{item.answer}</Text>
                  </View>
                ))}
              </View>
            </View>
          </FadeInView>

          {/* QR BUSINESS CARD */}
          <FadeInView delay={100}>
            <View style={cardStyles.section}>
              <View style={cardStyles.wrap}>
                <View style={cardStyles.imageWrap}>
                  <Image
                    source={{ uri: IVX_BUSINESS_CARD_URL }}
                    style={cardStyles.cardImage}
                    resizeMode="contain"
                  />
                  <View style={cardStyles.scanBadge}>
                    <ScanLine size={12} color={GOLD} />
                    <Text style={cardStyles.scanBadgeText}>QR ENABLED</Text>
                  </View>
                </View>

                <View style={cardStyles.copyWrap}>
                  <Text style={cardStyles.eyebrow}>QUICK ACCESS</Text>
                  <Text style={cardStyles.title}>Scan to access IVX instantly</Text>
                  <Text style={cardStyles.desc}>
                    Open the IVX platform, explore live deals, and connect with us directly.
                  </Text>

                  <View style={cardStyles.actions}>
                    <TouchableOpacity
                      style={cardStyles.primaryBtn}
                      onPress={() => router.push('/(tabs)/(home)/home' as any)}
                      activeOpacity={0.85}
                      testID="card-open-ivx"
                    >
                      <LinearGradient
                        colors={['#f3d36b', '#b8860b']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={cardStyles.primaryBtnGrad}
                      >
                        <Text style={cardStyles.primaryBtnText}>Open IVX</Text>
                        <ExternalLink size={14} color="#000" />
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              <View style={cardStyles.socialSection}>
                <Text style={cardStyles.socialTitle}>Connect With Us</Text>
                <View style={cardStyles.socialGrid}>
                  {SOCIAL_LINKS.map((link) => (
                    <TouchableOpacity
                      key={link.id}
                      style={cardStyles.socialCard}
                      onPress={() => { void openExternalLink(link.url); }}
                      activeOpacity={0.75}
                      testID={`card-social-${link.id}`}
                    >
                      <View style={[cardStyles.socialIconWrap, { backgroundColor: link.color + '18' }]}>
                        <link.icon size={18} color={link.color} />
                      </View>
                      <Text style={cardStyles.socialLabel} numberOfLines={1}>{link.label}</Text>
                      <ChevronRight size={12} color="#555" />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          </FadeInView>

          {/* FOOTER */}
          <SafeAreaView edges={['bottom']}>
            <View style={styles.footer}>
              <Image source={IVX_LOGO_SOURCE} style={styles.footerLogo} resizeMode="contain" />
              <Text style={styles.footerBrand}>IVX HOLDINGS LLC</Text>
              <Text style={styles.footerText}>Premium Real Estate Investment Platform</Text>
              <View style={styles.footerContactRow}>
                <Text style={styles.footerContactText}>investors@ivxholding.com</Text>
              </View>
              <Text style={styles.footerAddress}>1001 Brickell Bay Drive, Suite 2700, Miami, FL 33131</Text>
              <View style={styles.footerDivider} />
              <Text style={styles.footerLegal}>
                {'\u00A9'} {new Date().getFullYear()} IVX Holdings LLC. All rights reserved.
              </Text>
              <Text style={styles.footerDisclaimer}>
                This platform is not registered with the SEC or any state securities regulator. Investments offered here are speculative and involve substantial risk, including the possible loss of your entire investment. Projected returns are estimates only and are not guaranteed. Nothing on this site constitutes an offer to sell or a solicitation of an offer to buy securities.
              </Text>
            </View>
          </SafeAreaView>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const _formStyles = StyleSheet.create({
  container: {
    width: '100%',
    paddingTop: 8,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#252525',
    paddingHorizontal: 14,
    height: 52,
    gap: 10,
    marginBottom: 10,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    fontWeight: '500' as const,
    height: 52,
  },
  phoneRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  phoneInput: {
    flex: 1,
  },
  otpSendBtn: {
    backgroundColor: GOLD,
    borderRadius: 14,
    height: 52,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  otpSendBtnDisabled: {
    backgroundColor: '#222',
  },
  otpSendBtnText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '700' as const,
  },
  otpSection: {
    marginBottom: 4,
  },
  otpInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  otpInput: {
    flex: 1,
  },
  otpVerifyBtn: {
    backgroundColor: ACCENT_GREEN,
    borderRadius: 14,
    height: 52,
    paddingHorizontal: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  otpVerifyBtnDisabled: {
    backgroundColor: '#222',
  },
  otpVerifyBtnText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700' as const,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  errorText: {
    color: Colors.error,
    fontSize: 12,
    fontWeight: '500' as const,
    flex: 1,
  },
  verifiedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: ACCENT_GREEN + '12',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: ACCENT_GREEN + '25',
  },
  verifiedText: {
    color: ACCENT_GREEN,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#333',
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  consentText: {
    flex: 1,
    color: '#777',
    fontSize: 12,
    lineHeight: 18,
  },
  formErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.error + '12',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  formErrorText: {
    color: Colors.error,
    fontSize: 13,
    fontWeight: '500' as const,
    flex: 1,
  },
  submitBtn: {
    backgroundColor: ACCENT_GREEN,
    borderRadius: 16,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 2,
  },
  submitBtnDisabled: {
    opacity: 0.35,
  },
  submitBtnText: {
    color: '#000',
    fontSize: 17,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
  },
  privacyText: {
    color: '#555',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 16,
    paddingHorizontal: 12,
  },
  successWrap: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  successIconWrap: {
    marginBottom: 18,
  },
  successTitle: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '900' as const,
    textAlign: 'center',
    marginBottom: 10,
  },
  successSubtitle: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  returnBtn: {
    backgroundColor: SURFACE_ELEVATED,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#252525',
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  returnBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700' as const,
  },
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  scrollContent: {
    flexGrow: 1,
  },
  safeTop: {
    backgroundColor: 'transparent',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap' as const,
    justifyContent: 'flex-end',
  },
  topBarBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  topBarLogo: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2D2B1E',
    backgroundColor: '#090909',
  },
  topBarName: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900' as const,
    letterSpacing: 3,
    lineHeight: 24,
  },
  topBarTagline: {
    color: GOLD,
    fontSize: 8,
    fontWeight: '700' as const,
    letterSpacing: 3,
    marginTop: -1,
  },
  ownerConsoleLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2B2B2B',
    backgroundColor: '#101010',
  },
  ownerConsoleLinkReady: {
    borderColor: GOLD + '35',
    backgroundColor: '#11160D',
  },
  ownerConsoleLinkText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  ownerConsoleLinkTextReady: {
    color: GOLD,
  },
  ownerSignupLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GOLD + '35',
    backgroundColor: '#1A1507',
  },
  ownerSignupLinkText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: '800' as const,
    letterSpacing: 0.2,
  },
  ownerEntryLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GOLD + '45',
    backgroundColor: '#11160D',
  },
  ownerEntryLinkDisabled: {
    opacity: 0.7,
  },
  ownerEntryLinkText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: '800' as const,
    letterSpacing: 0.4,
  },
  loginLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GOLD + '30',
    backgroundColor: GOLD + '08',
  },
  loginLinkText: {
    color: GOLD,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  memberRegisterButton: {
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  memberRegisterButtonText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '800' as const,
  },
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 36,
  },
  ownerVerifiedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0F1710',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: GOLD + '30',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 18,
  },
  ownerVerifiedPillDisabled: {
    opacity: 0.72,
  },
  ownerVerifiedPillText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  heroLogoWrap: {
    marginBottom: 24,
  },
  heroLogoCard: {
    backgroundColor: '#090909',
    borderRadius: 32,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2D2B1E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.32,
    shadowRadius: 22,
    elevation: 10,
  },
  heroLogo: {
    width: 124,
    height: 124,
    borderRadius: 24,
    backgroundColor: '#090909',
  },
  comingSoonBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: ACCENT_GREEN + '12',
    borderWidth: 1,
    borderColor: ACCENT_GREEN + '25',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 24,
  },
  comingSoonText: {
    color: ACCENT_GREEN,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.8,
  },
  heroTitle: {
    color: '#fff',
    fontSize: 38,
    fontWeight: '900' as const,
    textAlign: 'center',
    lineHeight: 46,
    letterSpacing: -0.8,
  },
  heroTitleGold: {
    color: GOLD,
  },
  heroSubtitle: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginTop: 16,
    paddingHorizontal: 4,
  },
  openAccessPill: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
    backgroundColor: '#101511',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: ACCENT_GREEN + '30',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  openAccessCopy: {
    flex: 1,
  },
  openAccessTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800' as const,
    marginBottom: 2,
  },
  openAccessText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 32,
    backgroundColor: SURFACE_ELEVATED,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#252525',
    overflow: 'hidden',
    width: '100%',
  },
  statBlock: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 20,
  },
  statBlockBorder: {
    borderRightWidth: 1,
    borderRightColor: '#252525',
  },
  statValue: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900' as const,
    letterSpacing: -0.5,
  },
  statLabel: {
    color: '#666',
    fontSize: 10,
    fontWeight: '600' as const,
    marginTop: 4,
    letterSpacing: 0.3,
  },
  statsDisclaimer: {
    color: '#444',
    fontSize: 9,
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  openOwnerLoginBtn: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: GOLD,
    backgroundColor: 'rgba(255,215,0,0.08)',
  },
  openOwnerLoginBtnText: {
    color: GOLD,
    fontSize: 15,
    fontWeight: '700' as const,
    letterSpacing: 0.4,
  },
  ctaSection: {
    paddingHorizontal: 24,
    marginBottom: 48,
  },
  primaryBtn: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  primaryBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 60,
    borderRadius: 18,
  },
  primaryBtnText: {
    color: '#000',
    fontSize: 18,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },
  secondaryBtn: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  secondaryBtnText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600' as const,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.8,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800' as const,
    marginBottom: 20,
    letterSpacing: -0.5,
  },
  featuresSection: {
    paddingHorizontal: 24,
    marginBottom: 48,
  },
  featuresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  featureCard: {
    backgroundColor: SURFACE_ELEVATED,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#222',
    minWidth: 150,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '45%' as any,
  },
  featureIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  featureTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700' as const,
    marginBottom: 6,
  },
  featureDesc: {
    color: '#777',
    fontSize: 12,
    lineHeight: 18,
  },
  investTypesSection: {
    paddingHorizontal: 24,
    marginBottom: 48,
  },
  investTypeCard: {
    flexDirection: 'row',
    backgroundColor: SURFACE_ELEVATED,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#222',
    marginBottom: 12,
    gap: 14,
  },
  investTypeIcon: {
    width: 54,
    height: 54,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  investTypeContent: {
    flex: 1,
  },
  previewLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  investTypeTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700' as const,
  },
  previewBadge: {
    backgroundColor: '#FFD70020',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  previewBadgeText: {
    color: '#FFD700',
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
  },
  investTypeDesc: {
    color: '#888',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 10,
  },
  investTypeCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
  },
  investTypeCtaText: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  howItWorksSection: {
    paddingHorizontal: 24,
    marginBottom: 48,
  },
  stepCard: {
    flexDirection: 'row' as const,
    backgroundColor: SURFACE_ELEVATED,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#222',
    marginBottom: 12,
    gap: 14,
    position: 'relative' as const,
  },
  stepNumber: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  stepNumberText: {
    fontSize: 16,
    fontWeight: '900' as const,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700' as const,
    marginBottom: 4,
  },
  stepDesc: {
    color: '#888',
    fontSize: 13,
    lineHeight: 19,
  },
  stepConnector: {
    position: 'absolute' as const,
    bottom: -12,
    left: 38,
    width: 2,
    height: 12,
    backgroundColor: '#252525',
  },
  trustSection: {
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 48,
  },
  trustShield: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: GOLD + '25',
  },
  trustTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800' as const,
    marginBottom: 8,
  },
  trustSubtitle: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
  },
  trustGrid: {
    width: '100%',
    gap: 10,
  },
  trustItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: SURFACE_ELEVATED,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: '#222',
  },
  trustItemText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600' as const,
  },
  credibilitySection: {
    paddingHorizontal: 24,
    marginBottom: 48,
  },
  credibilityIntro: {
    color: '#888',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
  },
  credibilityGrid: {
    gap: 12,
  },
  credibilityCard: {
    backgroundColor: SURFACE_ELEVATED,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#222',
  },
  credibilityActions: {
    gap: 10,
    marginTop: 16,
  },
  credibilityActionButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: GOLD + '22',
    backgroundColor: '#101010',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  credibilityActionPrimary: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  credibilityActionText: {
    color: '#F5D97A',
    fontSize: 13,
    fontWeight: '700' as const,
  },
  credibilityActionPrimaryText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '800' as const,
  },
  credibilityIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 12,
  },
  credibilityLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    marginBottom: 6,
  },
  credibilityValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700' as const,
    lineHeight: 22,
    marginBottom: 6,
  },
  credibilityDetail: {
    color: '#888',
    fontSize: 13,
    lineHeight: 19,
  },
  disclosureSection: {
    paddingHorizontal: 24,
    marginBottom: 40,
  },
  disclosureCard: {
    backgroundColor: '#0E0E0E',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: GOLD + '20',
    overflow: 'hidden' as const,
  },
  disclosureRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  disclosureRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  disclosureBullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GOLD,
    marginTop: 6,
  },
  disclosureTextWrap: {
    flex: 1,
  },
  disclosureTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700' as const,
    marginBottom: 4,
    textTransform: 'capitalize' as const,
  },
  disclosureText: {
    color: '#888',
    fontSize: 13,
    lineHeight: 19,
  },
  memberAccessSection: {
    paddingHorizontal: 24,
    marginBottom: 40,
  },
  memberAccessIntro: {
    color: '#888',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
  },
  memberAccessGrid: {
    gap: 12,
  },
  memberAccessCard: {
    backgroundColor: '#0F1211',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: ACCENT_GREEN + '16',
    padding: 18,
  },
  memberAccessIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 12,
  },
  memberAccessTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700' as const,
    marginBottom: 6,
  },
  memberAccessText: {
    color: '#888',
    fontSize: 13,
    lineHeight: 19,
  },
  chatSection: {
    paddingHorizontal: 24,
    marginBottom: 40,
  },
  chatIntro: {
    color: '#888',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
  },
  chatHighlights: {
    gap: 10,
    marginBottom: 18,
  },
  chatHighlightCard: {
    backgroundColor: '#0D1216',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: ACCENT_BLUE + '20',
    padding: 16,
  },
  chatHighlightTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700' as const,
    marginBottom: 4,
  },
  chatHighlightText: {
    color: '#888',
    fontSize: 12,
    lineHeight: 18,
  },
  chatShell: {
    minHeight: 680,
    flex: 0,
  },
  waitlistFormSection: {
    marginHorizontal: 24,
    marginBottom: 32,
    backgroundColor: SURFACE_ELEVATED,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: ACCENT_GREEN + '20',
    padding: 24,
    position: 'relative',
    overflow: 'hidden',
    alignItems: 'center',
  },
  waitlistFormGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  waitlistFormBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: GOLD + '12',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 16,
  },
  waitlistFormBadgeText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
  },
  waitlistFormTitle: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '900' as const,
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  waitlistFormSubtitle: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  faqSection: {
    paddingHorizontal: 24,
    marginBottom: 40,
  },
  faqGrid: {
    gap: 12,
  },
  faqCard: {
    backgroundColor: '#0E0E0E',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1F1F1F',
    padding: 18,
  },
  faqQuestion: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700' as const,
    lineHeight: 21,
    marginBottom: 8,
  },
  faqAnswer: {
    color: '#888',
    fontSize: 13,
    lineHeight: 20,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderTopColor: '#1A1A1A',
  },
  footerLogo: {
    width: 52,
    height: 52,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2D2B1E',
    backgroundColor: '#090909',
  },
  footerBrand: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800' as const,
    letterSpacing: 2,
    marginBottom: 4,
  },
  footerText: {
    color: '#555',
    fontSize: 12,
    marginBottom: 10,
  },
  footerContactRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
    marginBottom: 8,
  },
  footerContactText: {
    color: '#B8B8B8',
    fontSize: 12,
    fontWeight: '600' as const,
  },
  footerContactDot: {
    color: '#555',
    fontSize: 12,
  },
  footerAddress: {
    color: '#6D6D6D',
    fontSize: 11,
    textAlign: 'center' as const,
    lineHeight: 17,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  footerDivider: {
    width: 40,
    height: 1,
    backgroundColor: '#252525',
    marginBottom: 16,
  },
  footerLegal: {
    color: '#555',
    fontSize: 11,
    textAlign: 'center',
  },
  footerDisclaimer: {
    color: '#444',
    fontSize: 9,
    textAlign: 'center',
    lineHeight: 14,
    marginTop: 14,
    paddingHorizontal: 12,
    opacity: 0.8,
  },
});

const cardStyles = StyleSheet.create({
  section: {
    paddingHorizontal: 24,
    marginBottom: 40,
  },
  wrap: {
    backgroundColor: '#050505',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.18)',
    padding: 20,
    overflow: 'hidden' as const,
  },
  imageWrap: {
    position: 'relative' as const,
    marginBottom: 20,
  },
  cardImage: {
    width: '100%',
    aspectRatio: 1.78,
    borderRadius: 18,
    backgroundColor: '#000',
  },
  scanBadge: {
    position: 'absolute' as const,
    top: 12,
    right: 12,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: GOLD + '30',
  },
  scanBadgeText: {
    color: GOLD,
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 1.2,
  },
  copyWrap: {
    paddingHorizontal: 4,
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 2,
    color: '#caa94e',
    fontWeight: '700' as const,
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: '#f3d36b',
    lineHeight: 28,
    marginBottom: 10,
  },
  desc: {
    color: 'rgba(255, 236, 170, 0.82)',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 18,
  },
  actions: {
    flexDirection: 'row' as const,
    gap: 10,
    flexWrap: 'wrap' as const,
  },
  primaryBtn: {
    borderRadius: 999,
    overflow: 'hidden' as const,
  },
  primaryBtnGrad: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingHorizontal: 24,
    height: 46,
    borderRadius: 999,
  },
  primaryBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700' as const,
  },
  socialSection: {
    marginTop: 20,
  },
  socialTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600' as const,
    letterSpacing: 1.5,
    textTransform: 'uppercase' as const,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  socialGrid: {
    gap: 8,
  },
  socialCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#111',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#1E1E1E',
    gap: 12,
  },
  socialIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  socialLabel: {
    flex: 1,
    color: '#ddd',
    fontSize: 14,
    fontWeight: '600' as const,
  },
});
