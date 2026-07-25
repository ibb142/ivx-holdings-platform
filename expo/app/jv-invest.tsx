import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Platform,
  Animated,
  KeyboardAvoidingView,
  Keyboard,
  TouchableWithoutFeedback,
  ActivityIndicator,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ArrowLeft,
  Shield,
  TrendingUp,
  DollarSign,
  Info,
  CheckCircle,
  CreditCard,
  Banknote,
  Wallet,
  Lock,
  Clock,
  Users,
  Percent,
  Calendar,
  MapPin,
  FileText,
  Handshake,
  BarChart3,
  Landmark,
  UserPlus,
  ChevronRight,
  LogIn,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { formatCurrencyWithDecimals, formatNumber, formatAmountInput } from '@/lib/formatters';
import { buildOwnershipSnapshot } from '@/lib/ownership-math';
import { formatTrustTimelineLabel, resolveTrustMarket } from '@/lib/trust-market';
import { useInvestmentGuard } from '@/hooks/useInvestmentGuard';
import InvestorDisclosure from '@/components/InvestorDisclosure';
import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { purchaseJVInvestment } from '@/lib/investment-service';
import { fetchJVDealById } from '@/lib/jv-storage';
import type { PoolTier } from '@/types/jv';
import { sanitizeDealPhotosForDeal } from '@/constants/deal-photos';


type PaymentMethod = 'wallet' | 'bank' | 'wire';
type InvestmentPool = 'jv_direct';
type Step = 'pool' | 'amount' | 'review' | 'success';

interface DealTrustMarket {
  minInvestment: number;
  timelineMin: number;
  timelineMax: number;
  salePrice: number;
  fractionalSharePrice: number;
  priceChange1h: number;
  priceChange2h: number;
}

interface DealData {
  id: string;
  title: string;
  projectName: string;
  description: string;
  type: string;
  status: string;
  published: boolean;
  propertyAddress: string;
  city: string;
  state: string;
  country: string;
  totalInvestment: number;
  propertyValue: number;
  expectedROI: number;
  managementFee: number;
  performanceFee: number;
  minimumHoldPeriod: number;
  startDate: string;
  endDate: string;
  governingLaw: string;
  disputeResolution: string;
  distributionFrequency: string;
  exitStrategy: string;
  confidentialityPeriod: number;
  nonCompetePeriod: number;
  profitSplit: string;
  photos: string[];
  poolTiers: PoolTier[];
  partners: Array<{ name: string; role: string; share: number }>;
  trustMarket: DealTrustMarket;
}



function parseJsonField(val: unknown, fallback: unknown = []): unknown {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return val;
}

function str(val: unknown, fallback: string = ''): string {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return fallback;
}

function num(val: unknown, fallback: number = 0): number {
  if (val === null || val === undefined) return fallback;
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

function buildTrustMarket(row: Record<string, unknown>, totalInvestment: number, propertyValue: number): DealTrustMarket {
  const rawTrust = parseJsonField(row.trust_info ?? row.trustInfo, {}) as Record<string, unknown>;
  const resolved = resolveTrustMarket({
    salePrice: rawTrust.salePrice,
    propertyValue,
    totalInvestment,
    minInvestment: rawTrust.minInvestment,
    fractionalSharePrice: rawTrust.fractionalSharePrice,
    timelineMin: rawTrust.timelineMin,
    timelineMax: rawTrust.timelineMax,
    timelineUnit: rawTrust.timelineUnit,
    priceChange1h: rawTrust.priceChange1h,
    priceChange2h: rawTrust.priceChange2h,
  });

  return {
    minInvestment: resolved.minInvestment,
    timelineMin: resolved.timelineMin,
    timelineMax: resolved.timelineMax,
    salePrice: resolved.salePrice,
    fractionalSharePrice: resolved.fractionalSharePrice,
    priceChange1h: resolved.priceChange1h,
    priceChange2h: resolved.priceChange2h,
  };
}

function formatMarketCap(value: number): string {
  if (value >= 1000000) {
    const millions = value / 1000000;
    return Number.isInteger(millions) ? `${millions.toFixed(0)}M` : `${millions.toFixed(2)}M`;
  }
  if (value >= 1000) {
    const thousands = value / 1000;
    return Number.isInteger(thousands) ? `${thousands.toFixed(0)}K` : `${thousands.toFixed(1)}K`;
  }
  return formatCurrencyWithDecimals(value);
}

function mapRowToDeal(row: Record<string, unknown>): DealData {
  const now = new Date();
  const twoYears = new Date(now);
  twoYears.setFullYear(twoYears.getFullYear() + 2);

  let photos = parseJsonField(row.photos, []) as string[];
  if (!Array.isArray(photos)) photos = [];
  photos = sanitizeDealPhotosForDeal({
    title: str(row.title),
    projectName: str(row.project_name ?? row.projectName),
  }, photos.filter((p: string) =>
    typeof p === 'string' && p.length > 5 && (p.startsWith('http') || p.startsWith('data:image/'))
  ));

  let poolTiers = parseJsonField(row.pool_tiers ?? row.poolTiers, []) as PoolTier[];
  if (!Array.isArray(poolTiers) || poolTiers.length === 0) {
    const total = num(row.total_investment ?? row.totalInvestment);
    poolTiers = [
      {
        id: 'default-jv',
        label: 'JV Direct Investment',
        type: 'jv_direct' as const,
        targetAmount: total,
        minInvestment: 1000,
        currentRaised: 0,
        investorCount: 0,
        status: 'open' as const,
      },
    ];
  }

  const partners = parseJsonField(row.partners, []) as Array<{ name: string; role: string; share: number }>;
  const totalInvestment = num(row.total_investment ?? row.totalInvestment);
  const propertyValue = num(row.property_value ?? row.propertyValue ?? row.estimated_value);
  const trustMarket = buildTrustMarket(row, totalInvestment, propertyValue);

  return {
    id: str(row.id),
    title: str(row.title),
    projectName: str(row.project_name ?? row.projectName),
    description: str(row.description),
    type: str(row.type, 'development'),
    status: str(row.status, 'active'),
    published: Boolean(row.published),
    propertyAddress: str(row.property_address ?? row.propertyAddress),
    city: str(row.city),
    state: str(row.state),
    country: str(row.country),
    totalInvestment,
    propertyValue,
    expectedROI: num(row.expected_roi ?? row.expectedROI),
    managementFee: num(row.management_fee ?? row.managementFee, 2),
    performanceFee: num(row.performance_fee ?? row.performanceFee, 20),
    minimumHoldPeriod: num(row.minimum_hold_period ?? row.minimumHoldPeriod, 12),
    startDate: str(row.start_date ?? row.startDate, now.toISOString()),
    endDate: str(row.end_date ?? row.endDate, twoYears.toISOString()),
    governingLaw: str(row.governing_law ?? row.governingLaw, 'State of Florida'),
    disputeResolution: str(row.dispute_resolution ?? row.disputeResolution, 'Binding Arbitration'),
    distributionFrequency: str(row.distribution_frequency ?? row.distributionFrequency, 'quarterly'),
    exitStrategy: str(row.exit_strategy ?? row.exitStrategy, 'Sale upon completion'),
    confidentialityPeriod: num(row.confidentiality_period ?? row.confidentialityPeriod, 24),
    nonCompetePeriod: num(row.non_compete_period ?? row.nonCompetePeriod, 12),
    profitSplit: str(row.profit_split ?? row.profitSplit, '70/30 Developer/Investor'),
    photos,
    poolTiers,
    partners: Array.isArray(partners) ? partners : [],
    trustMarket,
  };
}

const PAYMENT_METHODS: { id: PaymentMethod; label: string; desc: string; icon: typeof Wallet }[] = [
  { id: 'wallet', label: 'Wallet Balance', desc: 'Instant settlement', icon: Wallet },
  { id: 'bank', label: 'Bank Transfer (ACH)', desc: '1-3 business days', icon: Banknote },
  { id: 'wire', label: 'Wire Transfer', desc: 'Same day', icon: CreditCard },
];

const POOL_CONFIG: Record<InvestmentPool, { label: string; desc: string; icon: typeof Landmark; color: string }> = {
  jv_direct: {
    label: 'JV Investment',
    desc: 'Direct equity stake in the project with profit sharing',
    icon: Landmark,
    color: '#00C48C',
  },

};

export default function JVInvestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { jvId } = useLocalSearchParams<{ jvId: string }>();
  const queryClient = useQueryClient();

  const [selectedPool, setSelectedPool] = useState<InvestmentPool>('jv_direct');
  const [investAmount, setInvestAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bank');
  const [step, setStep] = useState<Step>('pool');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [confirmationNum, setConfirmationNum] = useState('');
  const { canInvest, checkAndProceed } = useInvestmentGuard();

  const successAnim = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0)).current;

  const dealQuery = useQuery({
    queryKey: ['jv-invest-deal', jvId],
    queryFn: async (): Promise<DealData> => {
      if (!jvId) throw new Error('No deal ID provided');
      try {
        const row = await fetchJVDealById(jvId);
        if (row) {
          const mapped = mapRowToDeal(row as Record<string, unknown>);
          if (mapped.title || mapped.projectName || mapped.totalInvestment) {
            return mapped;
          }
        } else {
        }
      } catch (e) {
      }
      throw new Error('Deal not found. It may need to be published from the admin panel.');
    },
    enabled: !!jvId,
    retry: 2,
    retryDelay: (attempt: number) => Math.min(1000 * Math.pow(2, attempt), 3000),
    staleTime: 30000,
  });

  const deal = dealQuery.data ?? null;

  const balanceQuery = useQuery({
    queryKey: ['wallet-balance-jv'],
    queryFn: async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return 0;
        const { data } = await supabase.from('wallets').select('available').eq('user_id', user.id).single();
        return Number((data as Record<string, unknown> | null)?.available ?? 0);
      } catch {
        return 0;
      }
    },
    enabled: canInvest,
    staleTime: 60000,
  });
  const walletBalance = balanceQuery.data ?? 0;

  const openPools = useMemo(() => {
    if (!deal?.poolTiers) return [];
    return deal.poolTiers.filter(t => t.status === 'open');
  }, [deal]);

  const selectedPoolData = useMemo(() => {
    return openPools.find(p => p.type === selectedPool) ?? null;
  }, [openPools, selectedPool]);

  const amount = useMemo(() => parseFloat(investAmount.replace(/,/g, '')) || 0, [investAmount]);
  const estimatedReturn = deal ? amount * ((deal.expectedROI) / 100) : 0;
  const poolRemaining = selectedPoolData ? selectedPoolData.targetAmount - selectedPoolData.currentRaised : (deal?.totalInvestment ?? 0);
  const resolvedTrustMarket = useMemo(() => {
    return resolveTrustMarket({
      salePrice: deal?.trustMarket.salePrice,
      propertyValue: deal?.propertyValue,
      totalInvestment: deal?.totalInvestment,
      minInvestment: selectedPoolData?.minInvestment ?? deal?.trustMarket.minInvestment,
      fractionalSharePrice: deal?.trustMarket.fractionalSharePrice,
      timelineMin: deal?.trustMarket.timelineMin,
      timelineMax: deal?.trustMarket.timelineMax,
      timelineUnit: 'months',
      priceChange1h: deal?.trustMarket.priceChange1h,
      priceChange2h: deal?.trustMarket.priceChange2h,
    });
  }, [deal?.propertyValue, deal?.totalInvestment, deal?.trustMarket.fractionalSharePrice, deal?.trustMarket.minInvestment, deal?.trustMarket.priceChange1h, deal?.trustMarket.priceChange2h, deal?.trustMarket.salePrice, deal?.trustMarket.timelineMax, deal?.trustMarket.timelineMin, selectedPoolData?.minInvestment]);
  const liveSalePrice = resolvedTrustMarket.salePrice;
  const investmentRaise = Number(deal?.totalInvestment ?? 0);
  const ownershipSnapshot = buildOwnershipSnapshot(amount, liveSalePrice);
  const equityPercent = ownershipSnapshot.ownershipPercent;
  const estimatedProfit = estimatedReturn;
  const estimatedTotalPayout = amount + estimatedProfit;
  const minInvestment = resolvedTrustMarket.minInvestment;
  const shareEntryPrice = resolvedTrustMarket.fractionalSharePrice;
  const sharePrice1h = Number((shareEntryPrice * (1 + (resolvedTrustMarket.priceChange1h / 100))).toFixed(2));
  const sharePrice2h = Number((shareEntryPrice * (1 + (resolvedTrustMarket.priceChange2h / 100))).toFixed(2));
  const timelineLabel = formatTrustTimelineLabel(resolvedTrustMarket);

  const totalRaised = useMemo(() => {
    if (!deal?.poolTiers) return 0;
    return deal.poolTiers.reduce((s, t) => s + t.currentRaised, 0);
  }, [deal]);

  const fundingProgress = deal && deal.totalInvestment > 0 ? (totalRaised / deal.totalInvestment) * 100 : 0;
  const poolLabel = POOL_CONFIG[selectedPool].label;

  const investMutation = useMutation({
    mutationFn: async () => {
      if (!deal) throw new Error('No deal data');
      return purchaseJVInvestment({
        jvDealId: deal.id,
        jvTitle: deal.title,
        jvProjectName: deal.projectName,
        investmentPool: selectedPool,
        amount,
        equityPercent,
        expectedROI: deal.expectedROI,
        paymentMethod,
      });
    },
    onSuccess: (result) => {
      if (result.success) {
        setConfirmationNum(result.confirmationNumber);
        setStep('success');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        void queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
        void queryClient.invalidateQueries({ queryKey: ['wallet-balance-jv'] });
        void queryClient.invalidateQueries({ queryKey: ['holdings'] });
        void queryClient.invalidateQueries({ queryKey: ['transactions'] });

        Animated.sequence([
          Animated.timing(successAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.spring(checkScale, { toValue: 1, friction: 4, tension: 50, useNativeDriver: true }),
        ]).start();
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Investment Failed', result.message);
      }
    },
    onError: (error: Error) => {
      Alert.alert('Error', error.message || 'Something went wrong.');
    },
  });

  const handleAmountChange = useCallback((text: string) => {
    const clean = text.replace(/[^0-9]/g, '');
    if (clean === '') { setInvestAmount(''); return; }
    const num = parseInt(clean, 10);
    setInvestAmount(formatAmountInput(String(num)));
  }, []);

  const handleSelectPool = useCallback((pool: InvestmentPool) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedPool(pool);
  }, []);

  const handleContinueToAmount = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStep('amount');
  }, []);

  const handleContinueToReview = useCallback(() => {
    checkAndProceed(() => {
      if (amount < minInvestment) {
        Alert.alert('Below Minimum', `Minimum investment is ${formatCurrencyWithDecimals(minInvestment)}`);
        return;
      }
      if (amount > poolRemaining) {
        Alert.alert('Exceeds Available', `Maximum available is ${formatCurrencyWithDecimals(poolRemaining)}`);
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setStep('review');
    });
  }, [checkAndProceed, amount, minInvestment, poolRemaining]);

  const handleConfirmInvestment = useCallback(() => {
    if (!canInvest) {
      checkAndProceed(() => {});
      return;
    }
    if (!agreedToTerms) {
      Alert.alert('Agreement Required', 'Please agree to the terms before proceeding.');
      return;
    }
    if (paymentMethod === 'wallet' && walletBalance < amount) {
      Alert.alert('Insufficient Funds', 'Your wallet balance is not enough.');
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    investMutation.mutate();
  }, [canInvest, checkAndProceed, agreedToTerms, paymentMethod, walletBalance, amount, investMutation]);

  const goBack = useCallback(() => {
    if (step === 'amount') setStep('pool');
    else if (step === 'review') setStep('amount');
    else router.back();
  }, [step, router]);

  const stepTitles: Record<Step, string> = {
    pool: 'Choose Investment',
    amount: 'Investment Amount',
    review: 'Review & Confirm',
    success: 'Success',
  };

  // Timeout: if loading takes more than 10 seconds, show retry state
  const [loadingTimedOut, setLoadingTimedOut] = useState<boolean>(false);
  useEffect(() => {
    if (!dealQuery.isLoading) {
      setLoadingTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setLoadingTimedOut(true), 10000);
    return () => clearTimeout(timer);
  }, [dealQuery.isLoading]);

  if (dealQuery.isLoading && loadingTimedOut) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centerWrap}>
          <View style={styles.errorCircle}>
            <Clock size={36} color={Colors.warning} />
          </View>
          <Text style={styles.errorTitle}>Request Timed Out</Text>
          <Text style={styles.errorSubtext}>The deal is taking too long to load. Check your connection and try again.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoadingTimedOut(false); void dealQuery.refetch(); }} testID="retry-btn">
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.goBackBtn} onPress={() => router.back()}>
            <Text style={styles.goBackBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (dealQuery.isLoading) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centerWrap}>
          <View style={styles.loadingPulse}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
          <Text style={styles.loadingTitle}>Loading Deal</Text>
          <Text style={styles.loadingSubtext}>Fetching investment details...</Text>
        </View>
      </View>
    );
  }

  if (dealQuery.isError || !deal) {
    const errorMsg = dealQuery.error instanceof Error ? dealQuery.error.message : '';
    const isNotFound = errorMsg.includes('not found') || errorMsg.includes('Deal not found');
    const isNetworkError = errorMsg.includes('network') || errorMsg.includes('fetch') || errorMsg.includes('connect');
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centerWrap}>
          <View style={styles.errorCircle}>
            <Info size={36} color={Colors.textTertiary} />
          </View>
          <Text style={styles.errorTitle}>
            {isNotFound ? 'Deal Not Found' : isNetworkError ? 'Network Error' : dealQuery.isError ? 'Failed to Load' : 'Deal Not Found'}
          </Text>
          <Text style={styles.errorSubtext}>
            {isNotFound
              ? `Deal "${jvId}" was not found. It may need to be published from the admin panel.`
              : isNetworkError
                ? 'Could not connect to the server. Check your connection and try again.'
                : 'An unexpected error occurred. Please try again.'}
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void dealQuery.refetch()} testID="retry-btn">
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
          {!canInvest && (
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: Colors.success, marginBottom: 10 }]}
              onPress={() => router.push('/login' as never)}
            >
              <Text style={styles.retryBtnText}>Sign In</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.goBackBtn} onPress={() => router.back()}>
            <Text style={styles.goBackBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (step === 'success') {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScrollView contentContainerStyle={[styles.successScroll, { paddingTop: insets.top + 40 }]}>
          <Animated.View style={[styles.successBadge, { opacity: successAnim, transform: [{ scale: checkScale }] }]}>
            <View style={styles.successBadgeInner}>
              <Handshake size={56} color={Colors.primary} />
            </View>
          </Animated.View>
          <Animated.View style={{ opacity: successAnim, width: '100%', alignItems: 'center' as const }}>
            <Text style={styles.successTitle}>Investment Confirmed!</Text>
            <Text style={styles.successSubtitle}>
              You are now an investor in {deal.projectName}
            </Text>

            <View style={styles.successCard}>
              {[
                { label: 'Deal', value: deal.title },
                { label: 'Type', value: poolLabel },
                { label: 'Amount', value: formatCurrencyWithDecimals(amount), highlight: true },
                { label: 'Ownership', value: `${equityPercent.toFixed(2)}%` },
                { label: 'Expected ROI', value: `${deal.expectedROI}%`, color: Colors.success },
                { label: 'Confirmation', value: confirmationNum || `INV-${Date.now().toString(36).toUpperCase()}` },
              ].map((item, idx) => (
                <View key={idx} style={[styles.successRow, idx === 0 && { paddingTop: 0 }]}>
                  <Text style={styles.successLabel}>{item.label}</Text>
                  <Text style={[
                    styles.successValue,
                    item.highlight && { color: Colors.primary, fontWeight: '800' as const, fontSize: 16 },
                    item.color ? { color: item.color } : undefined,
                  ]}>{item.value}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => router.push('/jv-agreement' as never)}
              testID="view-agreements-btn"
            >
              <FileText size={18} color={Colors.black} />
              <Text style={styles.primaryBtnText}>View Agreements</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.push('/(tabs)/portfolio' as never)}
            >
              <Text style={styles.secondaryBtnText}>Go to Portfolio</Text>
            </TouchableOpacity>
          </Animated.View>
          <View style={{ height: insets.bottom + 20 }} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.headerBack} onPress={goBack} testID="back-btn">
          <ArrowLeft size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{stepTitles[step]}</Text>
          <View style={styles.stepIndicator}>
            {(['pool', 'amount', 'review'] as Step[]).map((s, i) => (
              <View
                key={s}
                style={[
                  styles.stepDot,
                  (step === s || (['pool', 'amount', 'review'].indexOf(step) > i)) && styles.stepDotActive,
                ]}
              />
            ))}
          </View>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={{ paddingBottom: 160 + insets.bottom }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces
          >
            <View style={styles.dealCard}>
              <View style={styles.dealCardTop}>
                <View style={styles.dealCardIcon}>
                  <Landmark size={24} color={Colors.primary} />
                </View>
                <View style={styles.dealCardInfo}>
                  <Text style={styles.dealName} numberOfLines={1}>{deal.title}</Text>
                  {deal.propertyAddress ? (
                    <View style={styles.addressRow}>
                      <MapPin size={11} color={Colors.textTertiary} />
                      <Text style={styles.addressText} numberOfLines={1}>{deal.propertyAddress}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <View style={styles.dealStats}>
                <View style={styles.dealStatItem}>
                  <DollarSign size={13} color={Colors.primary} />
                  <Text style={styles.dealStatValue}>{formatMarketCap(investmentRaise)}</Text>
                </View>
                <View style={styles.dealStatDivider} />
                <View style={styles.dealStatItem}>
                  <TrendingUp size={13} color={Colors.success} />
                  <Text style={[styles.dealStatValue, { color: Colors.success }]}>{deal.expectedROI}% ROI</Text>
                </View>
                <View style={styles.dealStatDivider} />
                <View style={styles.dealStatItem}>
                  <Users size={13} color={Colors.info} />
                  <Text style={styles.dealStatValue}>{timelineLabel}</Text>
                </View>
              </View>
              <View style={styles.marketSnapshot}>
                <View style={styles.marketSnapshotCard}>
                  <Text style={styles.marketSnapshotLabel}>Sale price</Text>
                  <Text style={styles.marketSnapshotValue}>{formatCurrencyWithDecimals(liveSalePrice)}</Text>
                </View>
                <View style={styles.marketSnapshotCard}>
                  <Text style={styles.marketSnapshotLabel}>Fractional share</Text>
                  <Text style={styles.marketSnapshotValue}>{formatCurrencyWithDecimals(shareEntryPrice)}</Text>
                </View>
                <View style={styles.marketSnapshotCard}>
                  <Text style={styles.marketSnapshotLabel}>1 hour</Text>
                  <Text style={[styles.marketSnapshotValue, styles.marketSnapshotValueUp]}>{formatCurrencyWithDecimals(sharePrice1h)}</Text>
                </View>
              </View>

              <Text style={styles.marketSnapshotHint}>
                Investment and sale price stay separate. Ownership syncs only to the live sale price, while raise progress stays tied to the investment amount.
              </Text>

              <View style={styles.fundingSection}>
                <View style={styles.fundingRow}>
                  <Text style={styles.fundingLabel}>Raised</Text>
                  <Text style={styles.fundingValue}>
                    {formatCurrencyWithDecimals(totalRaised)} / {formatCurrencyWithDecimals(deal.totalInvestment)}
                  </Text>
                </View>
                <View style={styles.fundingTrack}>
                  <View style={[styles.fundingFill, { width: `${Math.min(fundingProgress, 100)}%` }]} />
                </View>
                <Text style={styles.fundingPercent}>{fundingProgress.toFixed(0)}% funded</Text>
              </View>
            </View>

            {step === 'pool' && (
              <>
                <Text style={styles.sectionHeading}>Select Investment Type</Text>
                <Text style={styles.sectionSubheading}>
                  Choose how you want to invest. Open to all investors.
                </Text>

                {(Object.keys(POOL_CONFIG) as InvestmentPool[]).map(poolId => {
                  const config = POOL_CONFIG[poolId];
                  const isSelected = selectedPool === poolId;
                  const poolData = openPools.find(p => p.type === poolId);
                  const raised = poolData?.currentRaised ?? 0;
                  const target = poolData?.targetAmount ?? 0;
                  const remaining = target - raised;
                  const progress = target > 0 ? (raised / target) * 100 : 0;
                  const investors = poolData?.investorCount ?? 0;
                  const IconComp = config.icon;

                  return (
                    <TouchableOpacity
                      key={poolId}
                      style={[styles.poolCard, isSelected && styles.poolCardSelected]}
                      onPress={() => handleSelectPool(poolId)}
                      activeOpacity={0.8}
                      testID={`pool-${poolId}`}
                    >
                      <View style={styles.poolTop}>
                        <View style={[styles.poolIcon, { backgroundColor: config.color + '18' }]}>
                          <IconComp size={22} color={config.color} />
                        </View>
                        <View style={styles.poolInfo}>
                          <Text style={styles.poolTitle}>{config.label}</Text>
                          <Text style={styles.poolDesc}>{config.desc}</Text>
                        </View>
                        <View style={[styles.radio, isSelected && styles.radioSelected]}>
                          {isSelected && <View style={styles.radioDot} />}
                        </View>
                      </View>

                      {poolData && (
                        <View style={styles.poolMeta}>
                          <View style={styles.poolProgressRow}>
                            <View style={styles.poolTrack}>
                              <View style={[styles.poolFill, { width: `${Math.min(progress, 100)}%`, backgroundColor: config.color }]} />
                            </View>
                            <Text style={styles.poolPercent}>{progress.toFixed(0)}%</Text>
                          </View>
                          <View style={styles.poolMetaRow}>
                            <View style={styles.poolMetaItem}>
                              <Text style={styles.poolMetaLabel}>Target</Text>
                              <Text style={styles.poolMetaValue}>{formatCurrencyWithDecimals(target)}</Text>
                            </View>
                            <View style={styles.poolMetaSep} />
                            <View style={styles.poolMetaItem}>
                              <Text style={styles.poolMetaLabel}>Available</Text>
                              <Text style={[styles.poolMetaValue, { color: Colors.success }]}>{formatCurrencyWithDecimals(remaining)}</Text>
                            </View>
                            <View style={styles.poolMetaSep} />
                            <View style={styles.poolMetaItem}>
                              <Text style={styles.poolMetaLabel}>Investors</Text>
                              <Text style={styles.poolMetaValue}>{investors}</Text>
                            </View>
                          </View>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}

                {!canInvest && (
                  <TouchableOpacity
                    style={styles.authBanner}
                    onPress={() => router.push('/login' as never)}
                    activeOpacity={0.8}
                  >
                    <LogIn size={16} color={Colors.primary} />
                    <View style={styles.authBannerText}>
                      <Text style={styles.authBannerTitle}>Sign In to Start Investing</Text>
                      <Text style={styles.authBannerSub}>Create a free account — no restrictions, open to everyone</Text>
                    </View>
                    <ChevronRight size={16} color={Colors.primary} />
                  </TouchableOpacity>
                )}

                <View style={styles.openBanner}>
                  <UserPlus size={16} color={Colors.info} />
                  <Text style={styles.openBannerText}>
                    Open to everyone — private lenders, individuals, and institutions.
                  </Text>
                </View>

                <View style={styles.termsCard}>
                  <Text style={styles.termsCardTitle}>Deal Terms</Text>
                  {[
                    { icon: Calendar, label: 'Duration', value: `${formatDateShort(deal.startDate)} — ${formatDateShort(deal.endDate)}` },
                    { icon: Clock, label: 'Timeline', value: timelineLabel },
                    { icon: Percent, label: 'Management Fee', value: `${deal.managementFee}%` },
                    { icon: BarChart3, label: 'Performance Fee', value: `${deal.performanceFee}%` },
                    { icon: Clock, label: 'Distributions', value: capitalize(deal.distributionFrequency) },
                    { icon: Lock, label: 'Min Hold', value: `${deal.minimumHoldPeriod} months` },
                    { icon: FileText, label: 'Exit Strategy', value: deal.exitStrategy },
                  ].map((term, idx) => {
                    const TermIcon = term.icon;
                    return (
                      <View key={idx} style={styles.termRow}>
                        <TermIcon size={14} color={Colors.textTertiary} />
                        <Text style={styles.termLabel}>{term.label}</Text>
                        <Text style={styles.termValue} numberOfLines={1}>{term.value}</Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            {step === 'amount' && (
              <>
                <View style={styles.selectedPoolTag}>
                  <View style={styles.selectedPoolInfo}>
                    <Text style={styles.selectedPoolLabel}>{poolLabel}</Text>
                    <Text style={styles.selectedPoolMeta}>
                      Min: {formatCurrencyWithDecimals(minInvestment)} · {formatCurrencyWithDecimals(poolRemaining)} available
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.changeBtn} onPress={() => setStep('pool')}>
                    <Text style={styles.changeBtnText}>Change</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.amountWrap}>
                  <Text style={styles.fieldLabel}>Investment Amount (USD)</Text>
                  <View style={styles.amountField}>
                    <Text style={styles.dollarSign}>$</Text>
                    <TextInput
                      style={styles.amountInput}
                      value={investAmount}
                      onChangeText={handleAmountChange}
                      keyboardType="numeric"
                      returnKeyType="done"
                      onSubmitEditing={Keyboard.dismiss}
                      placeholder="0"
                      placeholderTextColor={Colors.textTertiary}
                      testID="amount-input"
                    />
                  </View>
                </View>

                <View style={styles.quickAmounts}>
                  {[100, 500, 1000, 5000, 10000, 50000].filter(v => v <= poolRemaining).map(qty => (
                    <TouchableOpacity
                      key={qty}
                      style={[styles.quickBtn, amount === qty && styles.quickBtnActive]}
                      onPress={() => { Keyboard.dismiss(); setInvestAmount(formatAmountInput(String(qty))); }}
                    >
                      <Text style={[styles.quickBtnText, amount === qty && styles.quickBtnTextActive]}>
                        {`${formatNumber(qty)}`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.summaryCard}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Investment Amount</Text>
                    <Text style={styles.summaryValue}>{formatCurrencyWithDecimals(amount)}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Ownership Share</Text>
                    <Text style={[styles.summaryValue, { color: Colors.primary }]}>{equityPercent.toFixed(2)}%</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Live Sale Price</Text>
                    <Text style={styles.summaryValue}>{formatCurrencyWithDecimals(liveSalePrice)}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Fractional Market</Text>
                    <Text style={styles.summaryValue}>${shareEntryPrice.toFixed(2)} → ${sharePrice1h.toFixed(2)}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Projected ROI</Text>
                    <Text style={[styles.summaryValue, { color: Colors.success }]}>{deal.expectedROI}%</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryBoldLabel}>Estimated Profit</Text>
                    <Text style={[styles.summaryBoldValue, { color: Colors.success }]}>{formatCurrencyWithDecimals(estimatedProfit)}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryBoldLabel}>Estimated Total Payout</Text>
                    <Text style={[styles.summaryBoldValue, { color: Colors.primary }]}>{formatCurrencyWithDecimals(estimatedTotalPayout)}</Text>
                  </View>
                </View>

                <View style={styles.protectionCard}>
                  {[
                    { icon: Shield, text: 'Protected by JV Operating Agreement', color: Colors.info },
                    { icon: Lock, text: 'Funds held in escrow-protected accounts', color: Colors.primary },
                    { icon: FileText, text: `Governed by ${deal.governingLaw}`, color: Colors.success },
                  ].map((item, idx) => {
                    const PIcon = item.icon;
                    return (
                      <View key={idx} style={styles.protectionRow}>
                        <PIcon size={15} color={item.color} />
                        <Text style={styles.protectionText}>{item.text}</Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            {step === 'review' && (
              <>
                <Text style={styles.fieldLabel}>Payment Method</Text>
                {PAYMENT_METHODS.map(pm => {
                  const PmIcon = pm.icon;
                  const isActive = paymentMethod === pm.id;
                  return (
                    <TouchableOpacity
                      key={pm.id}
                      style={[styles.paymentCard, isActive && styles.paymentCardActive]}
                      onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPaymentMethod(pm.id); }}
                      testID={`payment-${pm.id}`}
                    >
                      <View style={[styles.paymentIcon, isActive && styles.paymentIconActive]}>
                        <PmIcon size={20} color={isActive ? Colors.primary : Colors.textSecondary} />
                      </View>
                      <View style={styles.paymentInfo}>
                        <Text style={[styles.paymentLabel, isActive && { color: Colors.primary }]}>{pm.label}</Text>
                        <Text style={styles.paymentDesc}>
                          {pm.id === 'wallet' ? `Balance: ${formatCurrencyWithDecimals(walletBalance)}` : pm.desc}
                        </Text>
                      </View>
                      <View style={[styles.radio, isActive && styles.radioSelected]}>
                        {isActive && <View style={styles.radioDot} />}
                      </View>
                    </TouchableOpacity>
                  );
                })}

                <View style={styles.reviewCard}>
                  <Text style={styles.reviewCardTitle}>Investment Summary</Text>
                  {[
                    { label: 'Deal', value: deal.title },
                    { label: 'Type', value: poolLabel },
                    { label: 'Investment Amount', value: formatCurrencyWithDecimals(amount) },
                    { label: 'Ownership Share', value: `${equityPercent.toFixed(2)}%`, color: Colors.primary },
                    { label: 'Live Sale Price', value: formatCurrencyWithDecimals(liveSalePrice) },
                    { label: 'Fractional Market', value: `${shareEntryPrice.toFixed(2)} → ${sharePrice1h.toFixed(2)} → ${sharePrice2h.toFixed(2)}`, color: Colors.info },
                    { label: 'Projected ROI', value: `${deal.expectedROI}%`, color: Colors.success },
                    { label: 'Estimated Profit', value: formatCurrencyWithDecimals(estimatedProfit), color: Colors.success },
                    { label: 'Distribution', value: capitalize(deal.distributionFrequency) },
                    { label: 'Timeline', value: timelineLabel },
                    { label: 'Min Hold', value: `${deal.minimumHoldPeriod} months` },
                  ].map((item, idx) => (
                    <View key={idx} style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>{item.label}</Text>
                      <Text style={[styles.reviewValue, item.color ? { color: item.color } : undefined]}>{item.value}</Text>
                    </View>
                  ))}
                  <View style={styles.reviewDivider} />
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewBoldLabel}>Estimated Total Payout</Text>
                    <Text style={styles.reviewBoldValue}>{formatCurrencyWithDecimals(estimatedTotalPayout)}</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.termsCheck}
                  onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAgreedToTerms(v => !v); }}
                  testID="terms-checkbox"
                >
                  <View style={[styles.checkbox, agreedToTerms && styles.checkboxActive]}>
                    {agreedToTerms && <CheckCircle size={15} color={Colors.primary} />}
                  </View>
                  <Text style={styles.termsText}>
                    I agree to the Investment Agreement, understand the risks, and acknowledge the {deal.minimumHoldPeriod}-month minimum hold period.
                  </Text>
                </TouchableOpacity>

                <View style={styles.disclaimer}>
                  <Info size={13} color={Colors.textTertiary} />
                  <Text style={styles.disclaimerText}>
                    Investments involve risk. Past performance does not guarantee future results. Disputes resolved via {deal.disputeResolution}.
                  </Text>
                </View>

                <InvestorDisclosure compact />
              </>
            )}
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        {step === 'pool' && (
          <TouchableOpacity style={styles.ctaBtn} onPress={handleContinueToAmount} testID="continue-pool-btn">
            <Text style={styles.ctaBtnText}>{canInvest ? `Continue with ${poolLabel}` : `Explore ${poolLabel}`}</Text>
            <ChevronRight size={18} color={Colors.black} />
          </TouchableOpacity>
        )}
        {step === 'amount' && (
          <TouchableOpacity
            style={[styles.ctaBtn, amount < minInvestment && styles.ctaBtnDisabled]}
            onPress={handleContinueToReview}
            disabled={amount < minInvestment}
            testID="continue-amount-btn"
          >
            <Text style={styles.ctaBtnText}>Continue — {formatCurrencyWithDecimals(amount)}</Text>
            <ChevronRight size={18} color={Colors.black} />
          </TouchableOpacity>
        )}
        {step === 'review' && (
          <TouchableOpacity
            style={[styles.ctaBtn, (!agreedToTerms || investMutation.isPending) && styles.ctaBtnDisabled]}
            onPress={handleConfirmInvestment}
            disabled={!agreedToTerms || investMutation.isPending}
            testID="confirm-btn"
          >
            {investMutation.isPending ? (
              <View style={styles.ctaRow}>
                <ActivityIndicator size="small" color={Colors.black} />
                <Text style={styles.ctaBtnText}>Processing...</Text>
              </View>
            ) : (
              <View style={styles.ctaRow}>
                <Handshake size={18} color={Colors.black} />
                <Text style={styles.ctaBtnText}>Confirm Investment</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function formatDateShort(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch {
    return 'TBD';
  }
}

function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  loadingPulse: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  loadingTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 6,
  },
  loadingSubtext: {
    fontSize: 14,
    color: Colors.textTertiary,
  },
  errorCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text,
    marginBottom: 8,
    textAlign: 'center' as const,
  },
  errorSubtext: {
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: 'center' as const,
    lineHeight: 19,
    marginBottom: 24,
  },
  retryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 12,
    marginBottom: 10,
  },
  retryBtnText: {
    color: Colors.black,
    fontWeight: '700' as const,
    fontSize: 15,
  },
  goBackBtn: {
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  goBackBtnText: {
    color: Colors.textSecondary,
    fontWeight: '600' as const,
    fontSize: 14,
  },
  authBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    backgroundColor: Colors.primary + '0C',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.primary + '30',
  },
  authBannerText: {
    flex: 1,
  },
  authBannerTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.primary,
    marginBottom: 2,
  },
  authBannerSub: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.background,
  },
  headerBack: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  stepIndicator: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  stepDot: {
    width: 24,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: Colors.surfaceBorder,
  },
  stepDotActive: {
    backgroundColor: Colors.primary,
  },
  headerSpacer: {
    width: 40,
  },
  scroll: {
    flex: 1,
  },
  dealCard: {
    margin: 16,
    marginBottom: 4,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  dealCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  dealCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dealCardInfo: {
    flex: 1,
  },
  dealName: {
    fontSize: 17,
    fontWeight: '800' as const,
    color: Colors.text,
    marginBottom: 3,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addressText: {
    fontSize: 12,
    color: Colors.textTertiary,
    flex: 1,
  },
  dealStats: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    marginBottom: 14,
  },
  dealStatItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  dealStatValue: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  dealStatDivider: {
    width: 1,
    height: 16,
    backgroundColor: Colors.surfaceBorder,
  },
  marketSnapshot: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  marketSnapshotCard: {
    flex: 1,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  marketSnapshotLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  marketSnapshotValue: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  marketSnapshotValueUp: {
    color: Colors.success,
  },
  marketSnapshotHint: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  fundingSection: {},
  fundingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  fundingLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  fundingValue: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  fundingTrack: {
    height: 6,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  fundingFill: {
    height: 6,
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  fundingPercent: {
    fontSize: 11,
    color: Colors.textTertiary,
    textAlign: 'right' as const,
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 4,
  },
  sectionSubheading: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginHorizontal: 16,
    marginBottom: 16,
    lineHeight: 18,
  },
  poolCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: Colors.surfaceBorder,
  },
  poolCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '06',
  },
  poolTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  poolIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poolInfo: {
    flex: 1,
  },
  poolTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 3,
  },
  poolDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.textTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  radioSelected: {
    borderColor: Colors.primary,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.primary,
  },
  poolMeta: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
  },
  poolProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  poolTrack: {
    flex: 1,
    height: 5,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 2.5,
    overflow: 'hidden',
  },
  poolFill: {
    height: 5,
    borderRadius: 2.5,
  },
  poolPercent: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  poolMetaRow: {
    flexDirection: 'row',
  },
  poolMetaItem: {
    flex: 1,
    alignItems: 'center',
  },
  poolMetaLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginBottom: 3,
  },
  poolMetaValue: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  poolMetaSep: {
    width: 1,
    backgroundColor: Colors.surfaceBorder,
    marginVertical: 2,
  },
  openBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 12,
    backgroundColor: Colors.info + '0C',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.info + '20',
  },
  openBannerText: {
    flex: 1,
    fontSize: 13,
    color: Colors.info,
    lineHeight: 18,
    fontWeight: '500' as const,
  },
  termsCard: {
    marginHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  termsCardTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  termRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  termLabel: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  termValue: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
    maxWidth: 160,
    textAlign: 'right' as const,
  },
  selectedPoolTag: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 16,
    padding: 12,
    backgroundColor: Colors.primary + '0C',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.primary + '25',
  },
  selectedPoolInfo: {
    flex: 1,
  },
  selectedPoolLabel: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  selectedPoolMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  changeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.surface,
  },
  changeBtnText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  amountWrap: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    marginBottom: 10,
    marginHorizontal: 16,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  amountField: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 16,
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dollarSign: {
    fontSize: 28,
    fontWeight: '300' as const,
    color: Colors.textTertiary,
  },
  amountInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  quickAmounts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 20,
  },
  quickBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  quickBtnActive: {
    backgroundColor: Colors.primary + '18',
    borderColor: Colors.primary,
  },
  quickBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  quickBtnTextActive: {
    color: Colors.primary,
  },
  summaryCard: {
    marginHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  summaryValue: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '500' as const,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: Colors.surfaceBorder,
    marginVertical: 4,
  },
  summaryBoldLabel: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  summaryBoldValue: {
    fontSize: 18,
    fontWeight: '900' as const,
  },
  protectionCard: {
    marginHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 12,
  },
  protectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  protectionText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  paymentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.surfaceBorder,
    marginBottom: 8,
    gap: 12,
  },
  paymentCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '06',
  },
  paymentIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentIconActive: {
    backgroundColor: Colors.primary + '18',
  },
  paymentInfo: {
    flex: 1,
  },
  paymentLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  paymentDesc: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  reviewCard: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  reviewCardTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  reviewLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  reviewValue: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '500' as const,
  },
  reviewDivider: {
    height: 1,
    backgroundColor: Colors.surfaceBorder,
    marginVertical: 6,
  },
  reviewBoldLabel: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  reviewBoldValue: {
    fontSize: 20,
    fontWeight: '900' as const,
    color: Colors.primary,
  },
  termsCheck: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 16,
    marginBottom: 12,
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.textTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '12',
  },
  termsText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  disclaimer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    gap: 8,
    alignItems: 'flex-start',
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    color: Colors.textTertiary,
    lineHeight: 17,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
  },
  ctaBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  ctaBtnDisabled: {
    opacity: 0.35,
  },
  ctaBtnText: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.black,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  successScroll: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  successBadge: {
    marginBottom: 24,
  },
  successBadgeInner: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    fontSize: 26,
    fontWeight: '900' as const,
    color: Colors.text,
    textAlign: 'center' as const,
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    marginBottom: 28,
    lineHeight: 22,
  },
  successCard: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 28,
  },
  successRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  successLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  successValue: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.black,
  },
  secondaryBtn: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
});
