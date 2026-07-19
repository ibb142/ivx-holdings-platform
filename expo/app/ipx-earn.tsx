import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { Stack } from 'expo-router';
import {
  X,
  ArrowDownLeft,
  ArrowUpRight,
  Percent,
  TrendingUp,
  Shield,
  Clock,
  Zap,
  PiggyBank,
  CircleDollarSign,
  BarChart3,
  Info,
  Landmark,
  Lock,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useEarn, PROFIT_TIERS } from '@/lib/earn-context';
import { formatCurrencyWithDecimals, formatAmountInput, parseAmountInput } from '@/lib/formatters';

export default function IPXEarnScreen() {
  // Safe access with fallbacks — useEarn() returns undefined if EarnProvider
  // is ever absent (hot-reload race, route above provider boundary). Without
  // the fallback, destructuring throws "Cannot read property 'totalDeposited'
  // of undefined", which is the exact portfolio crash the owner reported.
  const earnCtx = useEarn() ?? null;
  const totalDeposited = earnCtx?.totalDeposited ?? 0;
  const totalEarnings = earnCtx?.totalEarnings ?? 0;
  const totalBalance = earnCtx?.totalBalance ?? 0;
  const projectedMonthly = earnCtx?.projectedMonthly ?? 0;
  const projectedYearly = earnCtx?.projectedYearly ?? 0;
  const apyRate = earnCtx?.apyRate ?? 0.10;
  const currentTier = earnCtx?.currentTier ?? PROFIT_TIERS[0];
  const nextTier = earnCtx?.nextTier ?? null;
  const currentQuarterProfit = earnCtx?.currentQuarterProfit ?? 0;
  const quarterProgress = earnCtx?.quarterProgress ?? 0;
  const allTiers = earnCtx?.allTiers ?? PROFIT_TIERS;
  const payouts = earnCtx?.payouts ?? [];
  const deposit = earnCtx?.deposit ?? (async () => ({ success: false, error: 'Earn account unavailable' }));
  const withdraw = earnCtx?.withdraw ?? (async () => ({ success: false, error: 'Earn account unavailable' }));

  const apyPercent = Math.round(apyRate * 100);
  const maxApyPercent = Math.round(PROFIT_TIERS[PROFIT_TIERS.length - 1].apyRate * 100);

  const [depositModalVisible, setDepositModalVisible] = useState(false);
  const [withdrawModalVisible, setWithdrawModalVisible] = useState(false);
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const progressBarWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [fadeAnim, pulseAnim, slideAnim]);

  useEffect(() => {
    Animated.timing(progressBarWidth, {
      toValue: quarterProgress,
      duration: 1000,
      useNativeDriver: false,
    }).start();
  }, [quarterProgress, progressBarWidth]);

  const displayAmount = amount ? formatAmountInput(amount) : '';
  const quickAmounts = [500, 1000, 2500, 5000];

  const handleAmountChange = (value: string) => {
    setAmount(parseAmountInput(value));
  };

  const handleDeposit = useCallback(async () => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount');
      return;
    }
    setIsProcessing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await deposit(numAmount);
      if (result.success) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          'Deposit Successful',
          `${formatCurrencyWithDecimals(numAmount)} has been deposited into your IVXHOLDINGS Earn account. You'll start earning ${apyPercent}% APY immediately.`,
          [{ text: 'Great!', onPress: () => { setDepositModalVisible(false); setAmount(''); } }]
        );
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Deposit Failed', result.error || 'Something went wrong');
      }
    } catch (error) {
      console.error('[Earn] Deposit error:', error);
      Alert.alert('Error', 'An unexpected error occurred');
    } finally {
      setIsProcessing(false);
    }
  }, [amount, deposit, apyPercent]);

  const handleWithdraw = useCallback(async () => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount');
      return;
    }
    setIsProcessing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await withdraw(numAmount);
      if (result.success) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          'Withdrawal Successful',
          `${formatCurrencyWithDecimals(numAmount)} has been withdrawn to your wallet.`,
          [{ text: 'Done', onPress: () => { setWithdrawModalVisible(false); setAmount(''); } }]
        );
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Withdrawal Failed', result.error || 'Something went wrong');
      }
    } catch (error) {
      console.error('[Earn] Withdraw error:', error);
      Alert.alert('Error', 'An unexpected error occurred');
    } finally {
      setIsProcessing(false);
    }
  }, [amount, withdraw]);

  const recentPayouts = useMemo(() => payouts.slice(0, 10), [payouts]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const renderModal = (type: 'deposit' | 'withdraw') => {
    const isDeposit = type === 'deposit';
    const visible = isDeposit ? depositModalVisible : withdrawModalVisible;
    const onClose = () => {
      if (isDeposit) { setDepositModalVisible(false); } else { setWithdrawModalVisible(false); }
      setAmount('');
    };

    return (
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{isDeposit ? 'Deposit to Earn' : 'Withdraw from Earn'}</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {!isDeposit && (
              <View style={styles.availableBanner}>
                <Text style={styles.availableLabel}>Available Balance</Text>
                <Text style={styles.availableValue}>{formatCurrencyWithDecimals(totalBalance)}</Text>
              </View>
            )}

            <View style={styles.amountSection}>
              <Text style={styles.inputLabel}>Enter Amount</Text>
              <View style={styles.amountInputContainer}>
                <Text style={styles.currencySymbol}>$</Text>
                <TextInput
                  style={styles.amountInput}
                  value={displayAmount}
                  onChangeText={handleAmountChange}
                  placeholder="0.00"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="decimal-pad"
                  editable={!isProcessing}
                  autoFocus
                />
              </View>
              <View style={styles.quickAmountsRow}>
                {quickAmounts.map((qa) => (
                  <TouchableOpacity
                    key={qa}
                    style={[styles.quickAmountBtn, amount === qa.toString() && styles.quickAmountBtnActive]}
                    onPress={() => setAmount(qa.toString())}
                    disabled={isProcessing}
                  >
                    <Text style={[styles.quickAmountText, amount === qa.toString() && styles.quickAmountTextActive]}>
                      {formatCurrencyWithDecimals(qa)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {isDeposit && amount && parseFloat(amount) >= 100 && (
                <View style={styles.projectionBox}>
                  <TrendingUp size={16} color={Colors.success} />
                  <Text style={styles.projectionText}>
                    Projected yearly earnings: <Text style={styles.projectionAmount}>{formatCurrencyWithDecimals(parseFloat(amount) * apyRate)}</Text>
                  </Text>
                </View>
              )}
            </View>

            {isDeposit && (
              <View style={styles.infoRow}>
                <Shield size={14} color={Colors.primary} />
                <Text style={styles.infoRowText}>Min. deposit $100 · Withdraw anytime · No lock-up</Text>
              </View>
            )}

            <TouchableOpacity
              style={[
                styles.actionButton,
                isDeposit ? styles.depositActionBtn : styles.withdrawActionBtn,
                (isProcessing || !amount || parseFloat(amount) <= 0) && styles.actionButtonDisabled,
              ]}
              onPress={isDeposit ? handleDeposit : handleWithdraw}
              disabled={isProcessing || !amount || parseFloat(amount) <= 0}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color={isDeposit ? Colors.black : Colors.text} />
              ) : (
                <Text style={[styles.actionButtonText, isDeposit ? styles.depositActionText : styles.withdrawActionText]}>
                  {isDeposit ? 'Deposit & Start Earning' : `Withdraw ${amount ? formatCurrencyWithDecimals(parseFloat(amount)) : '$0.00'}`}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'IVXHOLDINGS Earn',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerShadowVisible: false,
        }}
      />

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <Animated.View style={[styles.heroCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.heroTop}>
            <Animated.View style={[styles.apyBadge, { transform: [{ scale: pulseAnim }] }]}>
              <Percent size={14} color={Colors.black} />
              <Text style={styles.apyBadgeText}>{apyPercent}% APY</Text>
            </Animated.View>
            {apyPercent > 10 && (
              <View style={styles.boostBadge}>
                <Zap size={12} color={Colors.primary} />
                <Text style={styles.boostBadgeText}>Boosted</Text>
              </View>
            )}
          </View>

          <Text style={styles.heroLabel}>Your Earn Balance</Text>
          <Text style={styles.heroBalance}>{formatCurrencyWithDecimals(totalBalance)}</Text>

          <View style={styles.heroBreakdown}>
            <View style={styles.breakdownItem}>
              <Text style={styles.breakdownLabel}>Deposited</Text>
              <Text style={styles.breakdownValue}>{formatCurrencyWithDecimals(totalDeposited)}</Text>
            </View>
            <View style={styles.breakdownDivider} />
            <View style={styles.breakdownItem}>
              <Text style={styles.breakdownLabel}>Earned</Text>
              <Text style={[styles.breakdownValue, { color: Colors.success }]}>
                +{formatCurrencyWithDecimals(totalEarnings)}
              </Text>
            </View>
          </View>

          <View style={styles.heroActions}>
            <TouchableOpacity
              style={styles.depositBtn}
              onPress={() => setDepositModalVisible(true)}
              activeOpacity={0.8}
            >
              <ArrowDownLeft size={18} color={Colors.black} />
              <Text style={styles.depositBtnText}>Deposit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.withdrawBtn}
              onPress={() => setWithdrawModalVisible(true)}
              activeOpacity={0.8}
            >
              <ArrowUpRight size={18} color={Colors.text} />
              <Text style={styles.withdrawBtnText}>Withdraw</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        <View style={styles.apyTierCard}>
          <View style={styles.tierHeader}>
            <View>
              <Text style={styles.tierHeaderTitle}>Dynamic APY Rate</Text>
              <Text style={styles.tierSubtitle}>Increases with IVX HOLDINGS profits</Text>
            </View>
            <View style={styles.currentRateBadge}>
              <Text style={styles.currentRateText}>{apyPercent}%</Text>
              <Text style={styles.currentRateLabel}>Current</Text>
            </View>
          </View>

          <View style={styles.tierProgressSection}>
            <View style={styles.tierProgressLabels}>
              <Text style={styles.tierProgressLabel}>{currentTier.label} Tier</Text>
              {nextTier && <Text style={styles.tierProgressNext}>Next: {nextTier.label} ({Math.round(nextTier.apyRate * 100)}%)</Text>}
            </View>
            <View style={styles.tierProgressBar}>
              <Animated.View
                style={[
                  styles.tierProgressFill,
                  {
                    width: progressBarWidth.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>
            <Text style={styles.tierProgressInfo}>
              Q1 Profit: {formatCurrencyWithDecimals(currentQuarterProfit)}
              {nextTier ? ` · ${formatCurrencyWithDecimals(nextTier.minProfit)} for next tier` : ' · Max tier reached!'}
            </Text>
          </View>

          <View style={styles.tierGrid}>
            {allTiers.map((tier) => (
              <View
                key={tier.label}
                style={[
                  styles.tierItem,
                  tier.label === currentTier.label && styles.tierItemActive,
                ]}
              >
                <Text style={[
                  styles.tierItemRate,
                  tier.label === currentTier.label && styles.tierItemRateActive,
                ]}>{Math.round(tier.apyRate * 100)}%</Text>
                <Text style={[
                  styles.tierItemLabel,
                  tier.label === currentTier.label && styles.tierItemLabelActive,
                ]}>{tier.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.projectionCards}>
          <View style={styles.projCard}>
            <View style={styles.projIconWrap}>
              <Clock size={18} color="#00B4D8" />
            </View>
            <Text style={styles.projLabel}>Monthly</Text>
            <Text style={styles.projValue}>{formatCurrencyWithDecimals(projectedMonthly)}</Text>
          </View>
          <View style={styles.projCard}>
            <View style={[styles.projIconWrap, { backgroundColor: Colors.success + '20' }]}>
              <BarChart3 size={18} color={Colors.success} />
            </View>
            <Text style={styles.projLabel}>Yearly</Text>
            <Text style={styles.projValue}>{formatCurrencyWithDecimals(projectedYearly)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How It Works</Text>
          <View style={styles.howItWorksCard}>
            {[
              {
                icon: <PiggyBank size={22} color={Colors.primary} />,
                title: 'You Deposit',
                desc: 'Transfer funds from your wallet into IVXHOLDINGS Earn. Min $100.',
              },
              {
                icon: <Landmark size={22} color="#00B4D8" />,
                title: 'IVXHOLDINGS Invests',
                desc: 'IVX HOLDINGS deploys capital into real estate deals & property investments.',
              },
              {
                icon: <CircleDollarSign size={22} color={Colors.success} />,
                title: `You Earn ${apyPercent}–${maxApyPercent}% APY`,
                desc: `IVXHOLDINGS shares ${apyPercent}–${maxApyPercent}% annual profit from its margin directly to you, accrued daily. Rate increases as IVX HOLDINGS profits grow.`,
              },
              {
                icon: <Lock size={22} color={Colors.primary} />,
                title: 'No Lock-Up',
                desc: 'Withdraw your funds anytime. No penalties, no hidden fees.',
              },
            ].map((step, idx) => (
              <View key={idx} style={styles.howStep}>
                <View style={styles.howStepIcon}>{step.icon}</View>
                <View style={styles.howStepContent}>
                  <Text style={styles.howStepTitle}>{step.title}</Text>
                  <Text style={styles.howStepDesc}>{step.desc}</Text>
                </View>
                {idx < 3 && <View style={styles.howStepConnector} />}
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Activity</Text>
            {payouts.length > 10 && (
              <TouchableOpacity>
                <Text style={styles.seeAllText}>See All</Text>
              </TouchableOpacity>
            )}
          </View>
          {recentPayouts.length === 0 ? (
            <View style={styles.emptyActivity}>
              <PiggyBank size={40} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>No activity yet</Text>
              <Text style={styles.emptySubtext}>Deposit funds to start earning up to {maxApyPercent}% APY</Text>
            </View>
          ) : (
            recentPayouts.map((payout) => (
              <View key={payout.id} style={styles.activityItem}>
                <View style={[
                  styles.activityIcon,
                  {
                    backgroundColor:
                      payout.type === 'deposit' ? Colors.success + '15' :
                      payout.type === 'withdrawal' ? Colors.error + '15' :
                      Colors.primary + '15',
                  },
                ]}>
                  {payout.type === 'deposit' && <ArrowDownLeft size={18} color={Colors.success} />}
                  {payout.type === 'withdrawal' && <ArrowUpRight size={18} color={Colors.error} />}
                  {payout.type === 'interest' && <TrendingUp size={18} color={Colors.primary} />}
                </View>
                <View style={styles.activityInfo}>
                  <Text style={styles.activityDesc}>{payout.description}</Text>
                  <Text style={styles.activityDate}>{formatDate(payout.createdAt)}</Text>
                </View>
                <Text style={[
                  styles.activityAmount,
                  { color: payout.amount >= 0 ? Colors.success : Colors.error },
                ]}>
                  {payout.amount >= 0 ? '+' : ''}{formatCurrencyWithDecimals(Math.abs(payout.amount))}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.disclaimerCard}>
          <View style={styles.disclaimerHeader}>
            <Info size={16} color={Colors.textSecondary} />
            <Text style={styles.disclaimerTitle}>Important Disclosure</Text>
          </View>
          <Text style={styles.disclaimerText}>
            IVXHOLDINGS Earn is a profit-sharing program where IVX HOLDINGS shares {apyPercent}–{maxApyPercent}% annual returns from its
            real estate investment margin. The APY rate starts at 10% and increases up to {maxApyPercent}% as IVX HOLDINGS's
            quarterly profits grow. Returns are variable and based on IVX HOLDINGS's actual performance —
            not guaranteed. Your principal is backed by IVX HOLDINGS's real estate portfolio. This is
            not a bank deposit and is not FDIC insured. Funds can be withdrawn at any time with no penalties.
          </Text>
        </View>

        <View style={styles.trustBadges}>
          <View style={styles.trustBadge}>
            <Shield size={16} color={Colors.success} />
            <Text style={styles.trustText}>Asset-Backed</Text>
          </View>
          <View style={styles.trustBadge}>
            <Lock size={16} color={Colors.primary} />
            <Text style={styles.trustText}>Secure</Text>
          </View>
          <View style={styles.trustBadge}>
            <Zap size={16} color="#00B4D8" />
            <Text style={styles.trustText}>Instant Access</Text>
          </View>
        </View>

        <View style={{ height: 160 }} />
      </ScrollView>

      {renderModal('deposit')}
      {renderModal('withdraw')}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: 20, paddingBottom: 140 },
  heroCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  apyBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  apyBadgeText: { fontSize: 11, fontWeight: '700' as const },
  heroLabel: { color: Colors.textTertiary, fontSize: 13 },
  heroBalance: { color: Colors.text, fontSize: 26, fontWeight: '800' as const, marginBottom: 4 },
  heroBreakdown: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, flexWrap: 'wrap' as const, gap: 8 },
  breakdownItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, flexShrink: 1 },
  breakdownLabel: { color: Colors.textSecondary, fontSize: 12, flexShrink: 1 },
  breakdownValue: { color: Colors.text, fontSize: 13, fontWeight: '600' as const },
  breakdownDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder },
  heroActions: { flexDirection: 'row', gap: 12 },
  depositBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  depositBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  withdrawBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  withdrawBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  projectionCards: { gap: 6 },
  projCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  projIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  projLabel: { color: Colors.textSecondary, fontSize: 13 },
  projValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  seeAllText: { color: Colors.primary, fontSize: 14, fontWeight: '600' as const },
  howItWorksCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  howStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10 },
  howStepIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  howStepContent: { flex: 1, gap: 4 },
  howStepTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  howStepDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  howStepConnector: { width: 2, height: 16, backgroundColor: Colors.surfaceBorder, marginLeft: 19 },
  emptyActivity: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptyTitle: { color: Colors.text, fontSize: 16, fontWeight: '600' as const },
  emptySubtext: { color: Colors.textSecondary, fontSize: 13 },
  activityItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  activityIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  activityInfo: { flex: 1 },
  activityDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  activityDate: { color: Colors.textTertiary, fontSize: 12 },
  activityAmount: { alignItems: 'flex-end', gap: 2 },
  disclaimerCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  disclaimerHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  disclaimerTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  disclaimerText: { color: Colors.textSecondary, fontSize: 13 },
  boostBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  boostBadgeText: { fontSize: 11, fontWeight: '700' as const },
  apyTierCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  tierHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  tierHeaderTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  tierSubtitle: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500' as const },
  currentRateBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  currentRateText: { color: Colors.textSecondary, fontSize: 13 },
  currentRateLabel: { color: Colors.textSecondary, fontSize: 13 },
  tierProgressSection: { marginBottom: 16 },
  tierProgressLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  tierProgressLabel: { color: Colors.textSecondary, fontSize: 13 },
  tierProgressNext: { color: Colors.textSecondary, fontSize: 12, marginTop: 4 },
  tierProgressBar: { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceBorder, overflow: 'hidden' as const, marginTop: 8 },
  tierProgressFill: { height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  tierProgressInfo: { flex: 1 },
  tierGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tierItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  tierItemActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  tierItemRate: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  tierItemRateActive: { color: Colors.primary },
  tierItemLabel: { color: Colors.textSecondary, fontSize: 13 },
  tierItemLabelActive: { color: Colors.primary },
  trustBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  trustBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  trustText: { color: Colors.textSecondary, fontSize: 12, flexShrink: 1 },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  closeButton: { padding: 8 },
  availableBanner: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  availableLabel: { color: Colors.textSecondary, fontSize: 13 },
  availableValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  amountSection: { marginBottom: 16 },
  inputLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginBottom: 6 },
  amountInputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: 14 },
  currencySymbol: { color: Colors.textSecondary, fontSize: 20, fontWeight: '600' as const, marginRight: 4 },
  amountInput: { flex: 1, color: Colors.text, fontSize: 24, fontWeight: '700' as const, paddingVertical: 14 },
  quickAmountsRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  quickAmountBtn: { flex: 1, backgroundColor: Colors.surface, borderRadius: 8, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  quickAmountBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  quickAmountText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
  quickAmountTextActive: { color: Colors.black },
  projectionBox: { gap: 6 },
  projectionText: { color: Colors.textSecondary, fontSize: 13 },
  projectionAmount: { gap: 6 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoRowText: { color: Colors.textSecondary, fontSize: 13 },
  actionButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  depositActionBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  withdrawActionBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  actionButtonDisabled: { opacity: 0.4 },
  actionButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  depositActionText: { color: '#000000', fontSize: 13, fontWeight: '600' as const },
  withdrawActionText: { color: '#000000', fontSize: 13, fontWeight: '600' as const },
  scrollView: { backgroundColor: Colors.background },
});
