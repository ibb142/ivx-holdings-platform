/**
 * IVX Tokenized Participation Page
 *
 * Route: /deal/[slug]/tokenized
 *
 * Features:
 * - Project information + status
 * - $50 default share price (server-side)
 * - Share count selector (server-calculated max)
 * - Total amount (server-calculated: shares × price)
 * - ACH bank debit payment
 * - Agreement acceptance
 * - Payment processing screen
 * - Receipt + portfolio result
 *
 * Security: server recalculates amount from share_count — never trusts client price.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  useWindowDimensions,
  RefreshControl} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ArrowLeft,
  Minus,
  Plus,
  Building2,
  Shield,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Clock,
  FileText,
  Loader2,
  Receipt,
  Briefcase} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import {
  fetchPaymentConfig,
  createPayment,
  getPaymentStatus,
  formatCents,
  generateIdempotencyKey,
  type PaymentConfigResponse} from '@/lib/payment-api-client';
import { DIRECT_API_BASE_URL } from '@/lib/public-api';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

interface DealPathwayData {
  id: string;
  title: string;
  tokenized_enabled: boolean;
  tokenized_status: string;
  share_price: number;
  total_shares: number;
  available_shares: number;
  sold_shares: number;
  minimum_shares: number;
  maximum_shares_per_investor: number;
  tokenized_capital_target: number;
  tokenized_capital_raised: number;
  kyc_required: boolean;
  buyer_asking_price: number;
  city: string;
  state: string;
  country: string;
  description: string;
  expected_roi: number;
}

type PaymentStep = 'select' | 'processing' | 'success' | 'failed';

export default function TokenizedParticipationPage() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { width: screenWidth } = useWindowDimensions();

  const [shareCount, setShareCount] = useState<number>(1);
  const [paymentMethod, setPaymentMethod] = useState<'ach_debit'>('ach_debit');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [step, setStep] = useState<PaymentStep>('select');
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pollCount, setPollCount] = useState(0);

  // Fetch deal pathway data
  const { data: dealData, isLoading: dealLoading } = useQuery<DealPathwayData>({
    queryKey: ['deal-pathway', slug],
    queryFn: async () => {
      const url = DIRECT_API_BASE_URL || 'https://api.ivxholding.com';
      const res = await fetch(`${url}/api/ivx/deals/${slug}/pathways`);
      const data = await res.json();
      return data.deal as DealPathwayData;
    },
    enabled: !!slug});

  // Fetch payment config
  const { data: paymentConfig } = useQuery<PaymentConfigResponse>({
    queryKey: ['payment-config'],
    queryFn: fetchPaymentConfig,
    staleTime: 60000});

  const sharePrice = dealData?.share_price || 50;
  const maxShares = useMemo(() => {
    if (!dealData) return 1;
    const byAvailability = dealData.available_shares || 0;
    const byInvestorMax = dealData.maximum_shares_per_investor > 0
      ? dealData.maximum_shares_per_investor
      : byAvailability;
    return Math.min(byAvailability, byInvestorMax);
  }, [dealData]);

  const totalAmount = shareCount * sharePrice;
  const totalCents = Math.round(totalAmount * 100);

  // Adjust share count if exceeds max
  useEffect(() => {
    if (shareCount > maxShares) setShareCount(Math.max(1, maxShares));
  }, [maxShares, shareCount]);

  // Poll payment status when processing
  useEffect(() => {
    if (step !== 'processing' || !paymentId || pollCount >= 30) return;
    const timer = setTimeout(async () => {
      const status = await getPaymentStatus(paymentId);
      setPollCount(c => c + 1);
      if (status.payment?.state === 'SUCCEEDED' || status.payment?.state === 'COMPLETED') {
        setStep('success');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (status.payment?.state === 'FAILED') {
        setStep('failed');
        setError('Payment failed. Please try again.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [step, paymentId, pollCount]);

  const canSubmit = dealData?.tokenized_enabled
    && dealData?.tokenized_status === 'TOKENIZED_OPEN'
    && shareCount >= (dealData?.minimum_shares || 1)
    && shareCount <= maxShares
    && acceptedTerms
    && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !user || !dealData) return;
    setSubmitting(true);
    setError(null);
    setStep('processing');
    setPollCount(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const result = await createPayment({
        dealId: dealData.id,
        pathway: 'tokenized',
        paymentMethod,
        shareCount,
        acceptedTerms: true,
        idempotencyKey: generateIdempotencyKey(user.id, dealData.id)});

      if (result.ok && result.paymentId) {
        setPaymentId(result.paymentId);
        // In test mode, simulate success after a delay
        if (result.testMode) {
          setTimeout(() => {
            setStep('success');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }, 3000);
        }
        // In live mode, the polling effect will pick up the webhook-driven state change
      } else {
        setStep('failed');
        setError(result.error || 'Payment creation failed');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (err: any) {
      setStep('failed');
      setError(err.message || 'Network error. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, user, dealData, paymentMethod, shareCount]);

  // ── Render ──

  if (dealLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ShimmerIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading deal...</Text>
      </View>
    );
  }

  if (!dealData?.tokenized_enabled) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft color={Colors.text} size={24} />
          </TouchableOpacity>
        </View>
        <View style={styles.unavailableContainer}>
          <AlertCircle color={Colors.warning} size={48} />
          <Text style={styles.unavailableTitle}>Tokenized Not Available</Text>
          <Text style={styles.unavailableText}>Tokenized participation is not enabled for this project.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (dealData.tokenized_status !== 'TOKENIZED_OPEN') {
    const statusLabels: Record<string, string> = {
      TOKENIZED_COMING_SOON: 'Coming Soon',
      TOKENIZED_WAITLIST: 'Waitlist Open',
      TOKENIZED_PAUSED: 'Temporarily Paused',
      TOKENIZED_FULLY_ALLOCATED: 'Fully Allocated',
      TOKENIZED_CLOSED: 'Closed',
      TOKENIZED_NOT_AVAILABLE: 'Not Available'};
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft color={Colors.text} size={24} />
          </TouchableOpacity>
        </View>
        <View style={styles.unavailableContainer}>
          <Clock color={Colors.warning} size={48} />
          <Text style={styles.unavailableTitle}>{statusLabels[dealData.tokenized_status] || 'Unavailable'}</Text>
          <Text style={styles.unavailableText}>Tokenized participation is {statusLabels[dealData.tokenized_status]?.toLowerCase() || 'not available'} for this project.</Text>
          {dealData.tokenized_status === 'TOKENIZED_WAITLIST' && (
            <TouchableOpacity
              style={styles.waitlistButton}
              onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
            >
              <Text style={styles.waitlistButtonText}>Join Waitlist</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'success') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScrollView contentContainerStyle={styles.successContainer}>
          <View style={styles.successIconWrap}>
            <CheckCircle2 color={Colors.success} size={64} />
          </View>
          <Text style={styles.successTitle}>Investment Confirmed!</Text>
          <Text style={styles.successSubtitle}>
            You've purchased {shareCount} {shareCount === 1 ? 'share' : 'shares'} of {dealData.title}
          </Text>
          <View style={styles.successCard}>
            <View style={styles.successRow}>
              <Text style={styles.successLabel}>Shares</Text>
              <Text style={styles.successValue}>{shareCount}</Text>
            </View>
            <View style={styles.successRow}>
              <Text style={styles.successLabel}>Price per Share</Text>
              <Text style={styles.successValue}>${sharePrice.toFixed(2)}</Text>
            </View>
            <View style={styles.successDivider} />
            <View style={styles.successRow}>
              <Text style={styles.successTotalLabel}>Total Invested</Text>
              <Text style={styles.successTotalValue}>${totalAmount.toFixed(2)}</Text>
            </View>
          </View>
          <View style={styles.successActions}>
            <TouchableOpacity
              style={styles.successButton}
              onPress={() => router.push('/(tabs)/portfolio')}
            >
              <Briefcase color="#000" size={20} />
              <Text style={styles.successButtonText}>View Portfolio</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.successSecondaryButton}
              onPress={() => router.back()}
            >
              <Text style={styles.successSecondaryText}>Back to Deal</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (step === 'processing') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.processingContainer}>
          <View style={styles.processingIconWrap}>
            <Loader2 color={Colors.primary} size={56} />
          </View>
          <Text style={styles.processingTitle}>Processing Payment...</Text>
          <Text style={styles.processingSubtitle}>
            {paymentMethod === 'ach_debit'
              ? 'ACH payments take 2-3 business days to settle. You will be notified when complete.'
              : 'Securing your investment...'}
          </Text>
          <View style={styles.processingCard}>
            <View style={styles.processingRow}>
              <Text style={styles.processingLabel}>Deal</Text>
              <Text style={styles.processingValue}>{dealData.title}</Text>
            </View>
            <View style={styles.processingRow}>
              <Text style={styles.processingLabel}>Shares</Text>
              <Text style={styles.processingValue}>{shareCount}</Text>
            </View>
            <View style={styles.processingRow}>
              <Text style={styles.processingLabel}>Amount</Text>
              <Text style={styles.processingValue}>${totalAmount.toFixed(2)}</Text>
            </View>
            <View style={styles.processingRow}>
              <Text style={styles.processingLabel}>Method</Text>
              <Text style={styles.processingValue}>ACH Bank Debit</Text>
            </View>
          </View>
          {paymentConfig?.config.testMode && (
            <View style={styles.testModeBadge}>
              <Text style={styles.testModeText}>TEST MODE — No real charges</Text>
            </View>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'failed') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.failedContainer}>
          <View style={styles.failedIconWrap}>
            <AlertCircle color={Colors.error} size={56} />
          </View>
          <Text style={styles.failedTitle}>Payment Failed</Text>
          <Text style={styles.failedSubtitle}>{error || 'Something went wrong. Please try again.'}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => { setStep('select'); setError(null); setPaymentId(null); }}
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.failedBackButton}
            onPress={() => router.back()}
          >
            <Text style={styles.failedBackText}>Back to Deal</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Main selection screen
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft color={Colors.text} size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Tokenized Investment</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Deal info */}
        <View style={styles.dealCard}>
          <Text style={styles.dealTitle}>{dealData.title}</Text>
          <Text style={styles.dealLocation}>
            {[dealData.city, dealData.state, dealData.country].filter(Boolean).join(', ')}
          </Text>
          <View style={styles.dealMetrics}>
            <View style={styles.metricBox}>
              <Text style={styles.metricValue}>{((dealData.tokenized_capital_raised / (dealData.tokenized_capital_target || 1)) * 100).toFixed(0)}%</Text>
              <Text style={styles.metricLabel}>Funded</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricBox}>
              <Text style={styles.metricValue}>{dealData.available_shares}</Text>
              <Text style={styles.metricLabel}>Available</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricBox}>
              <Text style={styles.metricValue}>{dealData.expected_roi}%</Text>
              <Text style={styles.metricLabel}>Target ROI</Text>
            </View>
          </View>
        </View>

        {/* Share selector */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Select Shares</Text>
          <Text style={styles.sectionSubtitle}>${sharePrice.toFixed(2)} per share</Text>

          <View style={styles.shareSelector}>
            <TouchableOpacity
              style={styles.shareButton}
              onPress={() => {
                setShareCount(Math.max(dealData.minimum_shares || 1, shareCount - 1));
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              disabled={shareCount <= (dealData.minimum_shares || 1)}
            >
              <Minus color={Colors.text} size={20} />
            </TouchableOpacity>

            <View style={styles.shareCountBox}>
              <Text style={styles.shareCountText}>{shareCount}</Text>
              <Text style={styles.shareCountLabel}>shares</Text>
            </View>

            <TouchableOpacity
              style={styles.shareButton}
              onPress={() => {
                setShareCount(Math.min(maxShares, shareCount + 1));
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              disabled={shareCount >= maxShares}
            >
              <Plus color={Colors.text} size={20} />
            </TouchableOpacity>
          </View>

          {/* Quick amounts */}
          <View style={styles.quickAmounts}>
            {[5, 10, 25, 50].map(n => (
              <TouchableOpacity
                key={n}
                style={[styles.quickAmountButton, shareCount === n && styles.quickAmountActive]}
                onPress={() => {
                  setShareCount(Math.min(maxShares, n));
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                disabled={n > maxShares}
              >
                <Text style={[styles.quickAmountText, shareCount === n && styles.quickAmountTextActive]}>
                  {n}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Max shares info */}
          <Text style={styles.maxSharesInfo}>
            Max {maxShares} shares available · Min {dealData.minimum_shares || 1}
          </Text>
        </View>

        {/* Total */}
        <View style={styles.totalCard}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Shares</Text>
            <Text style={styles.totalValue}>{shareCount} × ${sharePrice.toFixed(2)}</Text>
          </View>
          <View style={styles.totalDivider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalAmountLabel}>Total Investment</Text>
            <Text style={styles.totalAmountValue}>${totalAmount.toFixed(2)}</Text>
          </View>
        </View>

        {/* Payment method */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Payment Method</Text>

          <TouchableOpacity
            style={[styles.methodButton, paymentMethod === 'ach_debit' && styles.methodActive]}
            onPress={() => { setPaymentMethod('ach_debit'); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          >
            <Building2 color={paymentMethod === 'ach_debit' ? Colors.primary : Colors.textSecondary} size={24} />
            <View style={styles.methodInfo}>
              <Text style={[styles.methodTitle, paymentMethod === 'ach_debit' && styles.methodTitleActive]}>ACH Bank Debit</Text>
              <Text style={styles.methodSubtitle}>2-3 business days · FREE</Text>
            </View>
            {paymentMethod === 'ach_debit' && <CheckCircle2 color={Colors.primary} size={20} />}
          </TouchableOpacity>
        </View>

        {/* Terms */}
        <TouchableOpacity
          style={styles.termsContainer}
          onPress={() => { setAcceptedTerms(!acceptedTerms); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <View style={[styles.checkbox, acceptedTerms && styles.checkboxActive]}>
            {acceptedTerms && <CheckCircle2 color="#000" size={16} />}
          </View>
          <Text style={styles.termsText}>
            I agree to the <Text style={styles.termsLink}>Terms of Service</Text>,{' '}
            <Text style={styles.termsLink}>Investment Agreement</Text>, and acknowledge that{' '}
            investments involve risk and are not FDIC insured.
          </Text>
        </TouchableOpacity>

        {/* Test mode badge */}
        {paymentConfig?.config.testMode && (
          <View style={styles.testModeBadge}>
            <Shield color={Colors.warning} size={14} />
            <Text style={styles.testModeText}>TEST MODE — No real charges will occur</Text>
          </View>
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          <Text style={styles.submitButtonText}>
            Invest ${totalAmount.toFixed(2)}
          </Text>
        </TouchableOpacity>

        {/* Risk disclosure */}
        <View style={styles.riskDisclosure}>
          <Text style={styles.riskTitle}>Risk Disclosure</Text>
          <Text style={styles.riskText}>
            All investments involve risk. Past performance is not indicative of future results.
            Securities offered through IVX Holdings LLC. Not FDIC insured. Not bank guaranteed.
            May lose value.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  loadingContainer: { flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#909090', marginTop: 12, fontSize: 14 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#2A2A2A'},
  backButton: { padding: 4 },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  dealCard: {
    backgroundColor: '#141414', borderRadius: 16, padding: 20, marginBottom: 16,
    borderWidth: 1, borderColor: '#2A2A2A'},
  dealTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  dealLocation: { color: '#909090', fontSize: 14, marginBottom: 16 },
  dealMetrics: { flexDirection: 'row', alignItems: 'center' },
  metricBox: { flex: 1, alignItems: 'center' },
  metricValue: { color: '#E6C200', fontSize: 20, fontWeight: '700' },
  metricLabel: { color: '#909090', fontSize: 11, marginTop: 2 },
  metricDivider: { width: 1, height: 32, backgroundColor: '#2A2A2A' },
  sectionCard: {
    backgroundColor: '#141414', borderRadius: 16, padding: 20, marginBottom: 16,
    borderWidth: 1, borderColor: '#2A2A2A'},
  sectionTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  sectionSubtitle: { color: '#909090', fontSize: 13, marginBottom: 16 },
  shareSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  shareButton: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: '#1A1A1A',
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#2A2A2A'},
  shareCountBox: { flex: 1, alignItems: 'center', marginHorizontal: 16 },
  shareCountText: { color: '#FFFFFF', fontSize: 32, fontWeight: '700' },
  shareCountLabel: { color: '#909090', fontSize: 12, marginTop: 2 },
  quickAmounts: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 12 },
  quickAmountButton: {
    width: 48, height: 36, borderRadius: 8, backgroundColor: '#1A1A1A',
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#2A2A2A'},
  quickAmountActive: { borderColor: '#E6C200', backgroundColor: 'rgba(230,194,0,0.1)' },
  quickAmountText: { color: '#909090', fontSize: 14, fontWeight: '600' },
  quickAmountTextActive: { color: '#E6C200' },
  maxSharesInfo: { color: '#666666', fontSize: 12, textAlign: 'center' },
  totalCard: {
    backgroundColor: '#141414', borderRadius: 16, padding: 20, marginBottom: 16,
    borderWidth: 1, borderColor: '#2A2A2A'},
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { color: '#909090', fontSize: 14 },
  totalValue: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  totalDivider: { height: 1, backgroundColor: '#2A2A2A', marginVertical: 12 },
  totalAmountLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  totalAmountValue: { color: '#E6C200', fontSize: 20, fontWeight: '700' },
  methodButton: {
    flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 12,
    backgroundColor: '#1A1A1A', marginBottom: 8, borderWidth: 1, borderColor: '#2A2A2A'},
  methodActive: { borderColor: '#E6C200', backgroundColor: 'rgba(230,194,0,0.05)' },
  methodInfo: { flex: 1, marginLeft: 12 },
  methodTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  methodTitleActive: { color: '#E6C200' },
  methodSubtitle: { color: '#909090', fontSize: 12, marginTop: 2 },
  termsContainer: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, marginBottom: 8 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#2A2A2A',
    marginRight: 12, marginTop: 2, justifyContent: 'center', alignItems: 'center'},
  checkboxActive: { backgroundColor: '#E6C200', borderColor: '#E6C200' },
  termsText: { color: '#909090', fontSize: 13, flex: 1, lineHeight: 18 },
  termsLink: { color: '#E6C200', fontWeight: '600' },
  testModeBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: 8, padding: 10, marginBottom: 16, gap: 6},
  testModeText: { color: '#F59E0B', fontSize: 12, fontWeight: '600' },
  submitButton: {
    backgroundColor: '#E6C200', borderRadius: 16, paddingVertical: 18,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16},
  submitButtonDisabled: { backgroundColor: '#333333' },
  submitButtonText: { color: '#000000', fontSize: 18, fontWeight: '700' },
  riskDisclosure: { padding: 16, backgroundColor: '#0A0A0A', borderRadius: 12, marginBottom: 16 },
  riskTitle: { color: '#666666', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  riskText: { color: '#555555', fontSize: 11, lineHeight: 16 },
  unavailableContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  unavailableTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  unavailableText: { color: '#909090', fontSize: 14, textAlign: 'center' },
  waitlistButton: {
    marginTop: 24, backgroundColor: '#E6C200', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32},
  waitlistButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  processingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  processingIconWrap: { marginBottom: 24 },
  processingTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  processingSubtitle: { color: '#909090', fontSize: 14, textAlign: 'center', marginBottom: 24 },
  processingCard: { backgroundColor: '#141414', borderRadius: 16, padding: 20, width: '100%', borderWidth: 1, borderColor: '#2A2A2A' },
  processingRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  processingLabel: { color: '#909090', fontSize: 14 },
  processingValue: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  successContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  successIconWrap: { marginBottom: 24 },
  successTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '700', marginBottom: 8 },
  successSubtitle: { color: '#909090', fontSize: 15, textAlign: 'center', marginBottom: 24 },
  successCard: { backgroundColor: '#141414', borderRadius: 16, padding: 20, width: '100%', borderWidth: 1, borderColor: '#2A2A2A' },
  successRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  successLabel: { color: '#909090', fontSize: 14 },
  successValue: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  successDivider: { height: 1, backgroundColor: '#2A2A2A', marginVertical: 12 },
  successTotalLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  successTotalValue: { color: '#E6C200', fontSize: 22, fontWeight: '700' },
  successActions: { width: '100%', marginTop: 24 },
  successButton: {
    flexDirection: 'row', backgroundColor: '#E6C200', borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12},
  successButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  successSecondaryButton: { paddingVertical: 12, alignItems: 'center' },
  successSecondaryText: { color: '#909090', fontSize: 14 },
  failedContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  failedIconWrap: { marginBottom: 24 },
  failedTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  failedSubtitle: { color: '#909090', fontSize: 14, textAlign: 'center', marginBottom: 24 },
  retryButton: { backgroundColor: '#E6C200', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, marginBottom: 12 },
  retryButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  failedBackButton: { paddingVertical: 12 },
  failedBackText: { color: '#909090', fontSize: 14 }});
