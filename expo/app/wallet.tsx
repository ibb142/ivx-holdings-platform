import React, { useState, useMemo, useCallback } from 'react';
import logger from '@/lib/logger';
import { useRouter } from 'expo-router';
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
} from 'react-native';
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  X,
  CreditCard,
  Building,
  Smartphone,
  Check,
  AlertCircle,
  CheckCircle,
  Copy,
  Info,
  Zap,
  Shield,
  ChevronRight,
  Globe,
  Banknote,
  ArrowLeft,
  Clock,
  Timer,
  CircleDollarSign,
  Star,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';

import { useWallet } from '@/lib/wallet-context';
import { formatNumber, formatCurrencyWithDecimals, formatAmountInput, parseAmountInput } from '@/lib/formatters';
import { paymentService, PaymentMethodType, PaymentResult, WithdrawalResult } from '@/lib/payment-service';
import CardInputForm, { CardData } from '@/components/CardInputForm';
import BankLinkForm, { BankData } from '@/components/BankLinkForm';
import WireTransferForm, { WireInstructionsDisplay } from '@/components/WireTransferForm';
import { useEarn } from '@/lib/earn-context';
import { Percent, PiggyBank } from 'lucide-react-native';
import { useAnalytics } from '@/lib/analytics-context';

export default function WalletScreen() {
  const router = useRouter();
  // Safe destructuring with fallbacks — useEarn() returns undefined if the
  // EarnProvider is ever absent (e.g. a hot-reload race or a route rendered
  // above the provider boundary). Without the fallback, destructuring throws
  // "Cannot read property 'totalBalance' of undefined", which is the exact
  // portfolio crash the owner reported.
  const earnCtx = useEarn() ?? null;
  const earnBalance = earnCtx?.totalBalance ?? 0;
  const apyRate = earnCtx?.apyRate ?? 0.10;
  const { trackScreen, trackTransaction: trackAnalyticsTx } = useAnalytics();

  React.useEffect(() => {
    trackScreen('Wallet');
  }, [trackScreen]);

  const {
    available: walletAvailable,
    deposit: walletDeposit,
    withdraw: walletWithdraw,
    depositWithdrawTransactions: walletTxHistory,
    isFromAPI: balanceFromAPI,
  } = useWallet();

  const currentUser = useMemo(() => {
    logger.wallet.log('Balance source:', balanceFromAPI ? 'supabase' : 'local', walletAvailable);
    return { walletBalance: walletAvailable };
  }, [walletAvailable, balanceFromAPI]);

  const transactions = useMemo(() => {
    return walletTxHistory.map(tx => ({
      id: tx.id,
      type: tx.type,
      amount: tx.direction === 'debit' ? -tx.amount : tx.amount,
      status: tx.status,
      description: tx.description,
      createdAt: tx.created_at,
    }));
  }, [walletTxHistory]);

  const [addFundsModalVisible, setAddFundsModalVisible] = useState(false);
  const [fundAmount, setFundAmount] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodType | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [withdrawModalVisible, setWithdrawModalVisible] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [selectedWithdrawMethod, setSelectedWithdrawMethod] = useState<string | null>(null);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<WithdrawalResult | null>(null);
  const [showWithdrawResult, setShowWithdrawResult] = useState(false);
  const [paymentStep, setPaymentStep] = useState<'select' | 'input' | 'confirm'>('select');
  const [cardData, setCardData] = useState<CardData | null>(null);
  const [linkedBank, setLinkedBank] = useState<BankData | null>(null);
  const [wireType, setWireType] = useState<'domestic' | 'international'>('domestic');

  const availablePaymentMethods = useMemo(() => paymentService.getAvailablePaymentMethods(), []);
  const availableWithdrawMethods = useMemo(() => paymentService.getAvailableWithdrawalMethods(), []);

  const getPaymentMethodIcon = useCallback((type: string) => {
    switch (type) {
      case 'fednow': return Zap;
      case 'rtp': return Zap;
      case 'same_day_ach': return Timer;
      case 'usdc': return CircleDollarSign;
      case 'bank_transfer':
      case 'bank_account': return Building;
      case 'card': return CreditCard;
      case 'apple_pay': return Smartphone;
      case 'google_pay': return Smartphone;
      case 'wire': return Banknote;
      case 'paypal': return Globe;
      default: return Wallet;
    }
  }, []);

  const getProviderBadge = useCallback((provider: string) => {
    switch (provider) {
      case 'fednow': return { label: 'FedNow', color: '#00B4D8' };
      case 'rtp_network': return { label: 'RTP', color: '#00B4D8' };
      case 'circle': return { label: 'Circle', color: '#4A90D9' };
      case 'stripe': return { label: 'Stripe', color: '#635BFF' };
      case 'plaid': return { label: 'Plaid', color: '#00D09C' };
      case 'paypal': return { label: 'PayPal', color: '#003087' };
      case 'manual': return { label: 'Manual', color: '#FF9500' };
      default: return { label: provider, color: Colors.textTertiary };
    }
  }, []);

  const isInstantMethod = useCallback((type: string) => {
    return ['fednow', 'rtp', 'usdc'].includes(type);
  }, []);

  const isFreeMethod = useCallback((type: string) => {
    return ['fednow', 'same_day_ach', 'bank_transfer'].includes(type);
  }, []);

  const getMethodFeatures = useCallback((type: PaymentMethodType) => {
    switch (type) {
      case 'fednow': return ['Instant', 'FREE'];
      case 'rtp': return ['Instant', '$0.25'];
      case 'same_day_ach': return ['Same Day', 'FREE'];
      case 'usdc': return ['~30 sec', '$0.01'];
      case 'bank_transfer': return ['FREE', '1-2 Days'];
      case 'card': return ['Instant', '2.9% fee'];
      case 'apple_pay': return ['Instant', '1.5% fee'];
      case 'google_pay': return ['Instant', '1.5% fee'];
      case 'wire': return ['Same Day', '$25 fee'];
      case 'paypal': return ['Instant', '3.49% fee'];
      default: return [];
    }
  }, []);

  const quickAmounts = [100, 500, 1000, 5000];
  const quickWithdrawAmounts = [100, 500, 1000, 2500];

  const handleFundAmountChange = (value: string) => {
    const cleanValue = parseAmountInput(value);
    setFundAmount(cleanValue);
  };

  const handleWithdrawAmountChange = (value: string) => {
    const cleanValue = parseAmountInput(value);
    setWithdrawAmount(cleanValue);
  };

  const displayFundAmount = fundAmount ? formatAmountInput(fundAmount) : '';
  const displayWithdrawAmount = withdrawAmount ? formatAmountInput(withdrawAmount) : '';

  const calculatedFee = useMemo(() => {
    if (!fundAmount || !selectedPaymentMethod) return 0;
    const amount = parseFloat(fundAmount);
    if (isNaN(amount) || amount <= 0) return 0;
    return paymentService.calculateFee(amount, selectedPaymentMethod);
  }, [fundAmount, selectedPaymentMethod]);

  const netAmount = useMemo(() => {
    if (!fundAmount) return 0;
    const amount = parseFloat(fundAmount);
    if (isNaN(amount) || amount <= 0) return 0;
    return amount - calculatedFee;
  }, [fundAmount, calculatedFee]);

  const withdrawFee = useMemo(() => {
    if (!withdrawAmount || !selectedWithdrawMethod) return 0;
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) return 0;
    return paymentService.calculateWithdrawalFee(amount, selectedWithdrawMethod);
  }, [withdrawAmount, selectedWithdrawMethod]);

  const withdrawNetAmount = useMemo(() => {
    if (!withdrawAmount) return 0;
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) return 0;
    return amount - withdrawFee;
  }, [withdrawAmount, withdrawFee]);

  const copyToClipboard = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Copied', 'Reference copied to clipboard');
  }, []);

  const handleAddFunds = async () => {
    const amount = parseFloat(fundAmount);
    if (!amount || amount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount');
      return;
    }
    if (!selectedPaymentMethod) {
      Alert.alert('Select Payment Method', 'Please select a payment method');
      return;
    }
    const validation = paymentService.validateAmount(amount, selectedPaymentMethod);
    if (!validation.valid) {
      Alert.alert('Invalid Amount', validation.error);
      return;
    }
    setIsProcessing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      logger.wallet.log('Processing payment:', { amount, method: selectedPaymentMethod });
      let result;
      if (selectedPaymentMethod === 'wire') {
        result = await paymentService.processWireTransfer(amount, wireType);
      } else {
        result = await paymentService.processPayment(amount, selectedPaymentMethod);
      }
      logger.wallet.log('Payment result:', result);
      setPaymentResult(result);
      setShowResult(true);
      if (result.success) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        void walletDeposit(amount, result.fee, selectedPaymentMethod, result.transactionId);
        trackAnalyticsTx('deposit', amount, 'USD', { method: selectedPaymentMethod, fee: result.fee });
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (error) {
      console.error('[Wallet] Payment error:', error);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Payment Failed', 'An unexpected error occurred. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const resetPaymentModal = () => {
    setAddFundsModalVisible(false);
    setFundAmount('');
    setSelectedPaymentMethod(null);
    setPaymentResult(null);
    setShowResult(false);
    setPaymentStep('select');
    setCardData(null);
    setLinkedBank(null);
    setWireType('domestic');
  };

  const handleSelectPaymentMethod = (method: PaymentMethodType) => {
    setSelectedPaymentMethod(method);
    void Haptics.selectionAsync();
    if (method === 'card') {
      setPaymentStep('input');
    } else if (method === 'bank_transfer' || method === 'same_day_ach') {
      setPaymentStep('input');
    } else {
      setPaymentStep('confirm');
    }
  };

  const canProceedToPayment = useMemo(() => {
    if (!fundAmount || parseFloat(fundAmount) <= 0) return false;
    if (!selectedPaymentMethod) return false;
    switch (selectedPaymentMethod) {
      case 'card':
        return cardData?.isValid || false;
      case 'bank_transfer':
      case 'same_day_ach':
        return linkedBank?.isLinked || false;
      default:
        return true;
    }
  }, [fundAmount, selectedPaymentMethod, cardData, linkedBank]);

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount');
      return;
    }
    if (!selectedWithdrawMethod) {
      Alert.alert('Select Method', 'Please select a withdrawal method');
      return;
    }
    const validation = paymentService.validateWithdrawalAmount(amount, selectedWithdrawMethod, currentUser.walletBalance);
    if (!validation.valid) {
      Alert.alert('Invalid Amount', validation.error);
      return;
    }
    setIsWithdrawing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      logger.wallet.log('Processing withdrawal:', { amount, method: selectedWithdrawMethod });
      const result = await paymentService.processWithdrawal(amount, selectedWithdrawMethod);
      logger.wallet.log('Withdrawal result:', result);
      setWithdrawResult(result);
      setShowWithdrawResult(true);
      if (result.success) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        void walletWithdraw(amount, result.fee, selectedWithdrawMethod, result.withdrawalId);
        trackAnalyticsTx('withdraw', amount, 'USD', { method: selectedWithdrawMethod, fee: result.fee });
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (error) {
      console.error('[Wallet] Withdrawal error:', error);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Withdrawal Failed', 'An unexpected error occurred. Please try again.');
    } finally {
      setIsWithdrawing(false);
    }
  };

  const resetWithdrawModal = () => {
    setWithdrawModalVisible(false);
    setWithdrawAmount('');
    setSelectedWithdrawMethod(null);
    setWithdrawResult(null);
    setShowWithdrawResult(false);
  };

  const recentWalletTx = useMemo(() =>
    transactions.filter(tx => tx.type === 'deposit' || tx.type === 'withdrawal').slice(0, 5),
  [transactions]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'deposit':
        return <ArrowDownLeft size={20} color={Colors.success} />;
      case 'withdrawal':
        return <ArrowUpRight size={20} color={Colors.error} />;
      default:
        return <Clock size={20} color={Colors.textTertiary} />;
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView}>
        <View style={styles.balanceCard}>
          <View style={styles.balanceIconRow}>
            <View style={styles.walletIconCircle}>
              <Wallet size={28} color={Colors.primary} />
            </View>
          </View>
          <Text style={styles.balanceLabel}>Available Balance</Text>
          <Text style={styles.balanceValue}>{formatCurrencyWithDecimals(currentUser.walletBalance)}</Text>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.depositButton}
              onPress={() => setAddFundsModalVisible(true)}
            >
              <ArrowDownLeft size={18} color={Colors.black} />
              <Text style={styles.depositButtonText}>Add Funds</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.withdrawButton}
              onPress={() => setWithdrawModalVisible(true)}
            >
              <ArrowUpRight size={18} color={Colors.text} />
              <Text style={styles.withdrawButtonText}>Withdraw</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>Payment Rails</Text>
            <View style={styles.lightningTag}>
              <Zap size={12} color={Colors.primary} />
              <Text style={styles.lightningTagText}>Instant</Text>
            </View>
          </View>
          {availablePaymentMethods.slice(0, 5).map((method, index) => {
            const IconComponent = getPaymentMethodIcon(method.type);
            const providerBadge = getProviderBadge(method.provider);
            const features = getMethodFeatures(method.type);
            const instant = isInstantMethod(method.type);
            const free = isFreeMethod(method.type);
            return (
              <View key={method.id} style={[
                styles.methodCard,
                index === 0 && styles.methodCardTop,
              ]}>
                <View style={[
                  styles.methodIconContainer,
                  instant && styles.methodIconInstant,
                ]}>
                  <IconComponent size={22} color={instant ? '#00B4D8' : Colors.textSecondary} />
                </View>
                <View style={styles.methodInfo}>
                  <View style={styles.methodNameRow}>
                    <Text style={styles.methodName}>{method.name}</Text>
                    {index === 0 && (
                      <View style={styles.recommendedBadge}>
                        <Star size={8} color={Colors.primary} />
                        <Text style={styles.recommendedBadgeText}>BEST</Text>
                      </View>
                    )}
                    <View style={[styles.providerBadge, { backgroundColor: providerBadge.color + '20' }]}>
                      <Text style={[styles.providerBadgeText, { color: providerBadge.color }]}>
                        {providerBadge.label}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.methodDesc}>{method.description}</Text>
                  <View style={styles.methodFeatures}>
                    {features.map((feature, idx) => (
                      <View key={idx} style={[
                        styles.featureBadge,
                        idx === 0 && instant && styles.featureBadgeInstant,
                        idx === 1 && free && styles.featureBadgeFree,
                      ]}>
                        {idx === 0 && instant && <Zap size={10} color="#00B4D8" />}
                        {idx === 0 && !instant && <Clock size={10} color={Colors.textSecondary} />}
                        {idx === 1 && free && <CheckCircle size={10} color={Colors.success} />}
                        {idx === 1 && !free && <Info size={10} color={Colors.textTertiary} />}
                        <Text style={[
                          styles.featureText,
                          idx === 0 && instant && styles.featureTextInstant,
                          idx === 1 && free && styles.featureTextFree,
                        ]}>{feature}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        {recentWalletTx.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Transactions</Text>
            {recentWalletTx.map(tx => (
              <View key={tx.id} style={styles.txItem}>
                <View style={styles.txIconContainer}>
                  {getTransactionIcon(tx.type)}
                </View>
                <View style={styles.txInfo}>
                  <Text style={styles.txDescription}>{tx.description}</Text>
                  <Text style={styles.txDate}>{formatDate(tx.createdAt)}</Text>
                </View>
                <Text style={[
                  styles.txAmount,
                  { color: tx.amount >= 0 ? Colors.success : Colors.error }
                ]}>
                  {tx.amount >= 0 ? '+' : ''}{formatCurrencyWithDecimals(Math.abs(tx.amount))}
                </Text>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity
          style={styles.earnBanner}
          onPress={() => router.push('/ipx-earn' as any)}
          activeOpacity={0.8}
        >
          <View style={styles.earnBannerLeft}>
            <View style={styles.earnIconWrap}>
              <PiggyBank size={22} color={Colors.primary} />
            </View>
            <View style={styles.earnBannerInfo}>
              <View style={styles.earnBannerTitleRow}>
                <Text style={styles.earnBannerTitle}>IVXHOLDINGS Earn</Text>
                <View style={styles.earnApyTag}>
                  <Percent size={10} color={Colors.black} />
                  <Text style={styles.earnApyTagText}>{`${Math.round(apyRate * 100)}% APY`}</Text>
                </View>
              </View>
              <Text style={styles.earnBannerDesc}>
                {earnBalance > 0
                  ? `Earning on ${formatCurrencyWithDecimals(earnBalance)}` 
                  : `Deposit & earn ${Math.round(apyRate * 100)}% yearly from IVXHOLDINGS profits`}
              </Text>
            </View>
          </View>
          <ChevronRight size={20} color={Colors.primary} />
        </TouchableOpacity>

        <View style={styles.securityCard}>
          <Shield size={20} color={Colors.success} />
          <View style={styles.securityInfo}>
            <Text style={styles.securityTitle}>Bank-Level Security</Text>
            <Text style={styles.securityText}>
              All transactions are protected with 256-bit encryption. Your payment info is never stored on our servers.
            </Text>
          </View>
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>

      <Modal
        visible={addFundsModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={resetPaymentModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity
                onPress={resetPaymentModal}
                style={styles.backIconButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <ArrowLeft size={24} color={Colors.text} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {showResult ? (paymentResult?.success ? 'Success!' : 'Payment Failed') : 'Add Funds'}
              </Text>
              <TouchableOpacity onPress={resetPaymentModal} style={styles.closeButton}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>



            {showResult && paymentResult ? (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.resultContainer}>
                  <View style={[
                    styles.resultIconContainer,
                    { backgroundColor: paymentResult.success ? Colors.success + '20' : Colors.error + '20' }
                  ]}>
                    {paymentResult.success ? (
                      <CheckCircle size={48} color={Colors.success} />
                    ) : (
                      <AlertCircle size={48} color={Colors.error} />
                    )}
                  </View>
                  <Text style={styles.resultAmount}>{formatCurrencyWithDecimals(paymentResult.amount)}</Text>
                  <Text style={[
                    styles.resultStatus,
                    { color: paymentResult.success ? Colors.success : Colors.error }
                  ]}>
                    {paymentResult.status === 'succeeded' ? 'Payment Successful' :
                     paymentResult.status === 'pending' ? 'Payment Pending' :
                     paymentResult.error?.message || 'Payment Failed'}
                  </Text>
                  {paymentResult.success && (
                    <View style={styles.resultDetails}>
                      <View style={styles.resultRow}>
                        <Text style={styles.resultLabel}>Transaction ID</Text>
                        <Text style={styles.resultValue}>{paymentResult.transactionId}</Text>
                      </View>
                      <View style={styles.resultRow}>
                        <Text style={styles.resultLabel}>Processing Time</Text>
                        <Text style={styles.resultValue}>{paymentResult.processingTime}</Text>
                      </View>
                      {paymentResult.fee > 0 && (
                        <View style={styles.resultRow}>
                          <Text style={styles.resultLabel}>Fee</Text>
                          <Text style={styles.resultValue}>{formatCurrencyWithDecimals(paymentResult.fee)}</Text>
                        </View>
                      )}
                      <View style={styles.resultRow}>
                        <Text style={styles.resultLabel}>Net Amount</Text>
                        <Text style={[styles.resultValue, { color: Colors.success, fontWeight: '700' as const }]}>
                          {formatCurrencyWithDecimals(paymentResult.netAmount)}
                        </Text>
                      </View>
                    </View>
                  )}
                  {paymentResult.bankInstructions && paymentResult.paymentMethod === 'wire' && (
                    <View style={styles.wireInstructionsWrapper}>
                      <WireInstructionsDisplay
                        instructions={paymentResult.bankInstructions}
                        amount={paymentResult.amount}
                      />
                    </View>
                  )}
                  {paymentResult.bankInstructions && paymentResult.paymentMethod !== 'wire' && (
                    <View style={styles.bankInstructionsContainer}>
                      <View style={styles.bankInstructionsHeader}>
                        <Info size={18} color={Colors.primary} />
                        <Text style={styles.bankInstructionsTitle}>Bank Transfer Instructions</Text>
                      </View>
                      <View style={styles.bankDetailRow}>
                        <Text style={styles.bankDetailLabel}>Bank Name</Text>
                        <Text style={styles.bankDetailValue}>{paymentResult.bankInstructions.bankName}</Text>
                      </View>
                      <View style={styles.bankDetailRow}>
                        <Text style={styles.bankDetailLabel}>Account Name</Text>
                        <Text style={styles.bankDetailValue}>{paymentResult.bankInstructions.accountName}</Text>
                      </View>
                      <View style={styles.bankDetailRow}>
                        <Text style={styles.bankDetailLabel}>Account #</Text>
                        <Text style={styles.bankDetailValue}>{paymentResult.bankInstructions.accountNumber}</Text>
                      </View>
                      <View style={styles.bankDetailRow}>
                        <Text style={styles.bankDetailLabel}>Routing #</Text>
                        <Text style={styles.bankDetailValue}>{paymentResult.bankInstructions.routingNumber}</Text>
                      </View>
                      {paymentResult.bankInstructions.swiftCode && (
                        <View style={styles.bankDetailRow}>
                          <Text style={styles.bankDetailLabel}>SWIFT</Text>
                          <Text style={styles.bankDetailValue}>{paymentResult.bankInstructions.swiftCode}</Text>
                        </View>
                      )}
                      <TouchableOpacity
                        style={styles.referenceContainer}
                        onPress={() => copyToClipboard(paymentResult.bankInstructions?.reference || '')}
                      >
                        <View>
                          <Text style={styles.bankDetailLabel}>Reference (tap to copy)</Text>
                          <Text style={styles.referenceValue}>{paymentResult.bankInstructions.reference}</Text>
                        </View>
                        <Copy size={18} color={Colors.primary} />
                      </TouchableOpacity>
                    </View>
                  )}
                  <TouchableOpacity style={styles.confirmButton} onPress={resetPaymentModal}>
                    <Text style={styles.confirmButtonText}>Done</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.amountSection}>
                  <Text style={styles.inputSectionLabel}>Enter Amount</Text>
                  <View style={styles.amountInputContainer}>
                    <Text style={styles.currencySymbol}>$</Text>
                    <TextInput
                      style={styles.amountInput}
                      value={displayFundAmount}
                      onChangeText={handleFundAmountChange}
                      placeholder="0.00"
                      placeholderTextColor={Colors.textTertiary}
                      keyboardType="decimal-pad"
                      editable={!isProcessing}
                    />
                  </View>
                  <View style={styles.quickAmountsContainer}>
                    {quickAmounts.map((amount) => (
                      <TouchableOpacity
                        key={amount}
                        style={[
                          styles.quickAmountButton,
                          fundAmount === amount.toString() && styles.quickAmountButtonActive
                        ]}
                        onPress={() => setFundAmount(amount.toString())}
                        disabled={isProcessing}
                      >
                        <Text style={[
                          styles.quickAmountText,
                          fundAmount === amount.toString() && styles.quickAmountTextActive
                        ]}>
                          ${formatNumber(amount)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {paymentStep === 'select' && (
                  <View style={styles.paymentSection}>
                    <View style={styles.speedBanner}>
                      <Zap size={16} color={Colors.primary} />
                      <Text style={styles.speedBannerText}>Lightning-fast rails • Lowest fees in the market</Text>
                    </View>
                    <Text style={styles.inputSectionLabel}>Fastest & Cheapest</Text>
                    {availablePaymentMethods.map((method, index) => {
                      const IconComponent = getPaymentMethodIcon(method.type);
                      const providerBadge = getProviderBadge(method.provider);
                      const features = getMethodFeatures(method.type);
                      const instant = isInstantMethod(method.type);
                      const free = isFreeMethod(method.type);
                      const isTopPick = index === 0;
                      return (
                        <TouchableOpacity
                          key={method.id}
                          style={[
                            styles.paymentMethodItem,
                            isTopPick && styles.paymentMethodItemRecommended,
                          ]}
                          onPress={() => handleSelectPaymentMethod(method.type)}
                          disabled={isProcessing}
                        >
                          <View style={[
                            styles.paymentMethodIcon,
                            instant && styles.paymentMethodIconInstant,
                          ]}>
                            <IconComponent size={22} color={instant ? '#00B4D8' : Colors.textSecondary} />
                          </View>
                          <View style={styles.paymentMethodInfo}>
                            <View style={styles.paymentMethodNameRow}>
                              <Text style={styles.paymentMethodName}>{method.name}</Text>
                              {isTopPick && (
                                <View style={styles.recommendedBadge}>
                                  <Star size={8} color={Colors.primary} />
                                  <Text style={styles.recommendedBadgeText}>BEST</Text>
                                </View>
                              )}
                              <View style={[styles.providerBadge, { backgroundColor: providerBadge.color + '20' }]}>
                                <Text style={[styles.providerBadgeText, { color: providerBadge.color }]}>
                                  {providerBadge.label}
                                </Text>
                              </View>
                            </View>
                            <Text style={styles.paymentMethodDesc}>{method.description}</Text>
                            <View style={styles.methodFeatures}>
                              {features.map((feature, idx) => (
                                <View key={idx} style={[
                                  styles.featureBadge,
                                  idx === 0 && instant && styles.featureBadgeInstant,
                                  idx === 1 && free && styles.featureBadgeFree,
                                ]}>
                                  {idx === 0 && instant && <Zap size={10} color="#00B4D8" />}
                                  {idx === 0 && !instant && <Clock size={10} color={Colors.textSecondary} />}
                                  {idx === 1 && free && <CheckCircle size={10} color={Colors.success} />}
                                  {idx === 1 && !free && <Info size={10} color={Colors.textTertiary} />}
                                  <Text style={[
                                    styles.featureText,
                                    idx === 0 && instant && styles.featureTextInstant,
                                    idx === 1 && free && styles.featureTextFree,
                                  ]}>{feature}</Text>
                                </View>
                              ))}
                            </View>
                          </View>
                          <ChevronRight size={20} color={isTopPick ? Colors.primary : Colors.textTertiary} />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {paymentStep === 'input' && selectedPaymentMethod === 'card' && (
                  <View style={styles.paymentInputSection}>
                    <TouchableOpacity
                      style={styles.backButton}
                      onPress={() => { setPaymentStep('select'); setSelectedPaymentMethod(null); setCardData(null); }}
                    >
                      <Text style={styles.backButtonText}>← Back to methods</Text>
                    </TouchableOpacity>
                    <View style={styles.selectedMethodHeader}>
                      <View style={styles.selectedMethodIcon}>
                        <CreditCard size={24} color={Colors.primary} />
                      </View>
                      <View>
                        <Text style={styles.selectedMethodTitle}>Credit/Debit Card</Text>
                        <Text style={styles.selectedMethodSubtitle}>Powered by Stripe • 2.9% fee</Text>
                      </View>
                    </View>
                    <CardInputForm onCardChange={setCardData} disabled={isProcessing} />
                  </View>
                )}

                {paymentStep === 'input' && (selectedPaymentMethod === 'bank_transfer' || selectedPaymentMethod === 'same_day_ach') && (
                  <View style={styles.paymentInputSection}>
                    <TouchableOpacity
                      style={styles.backButton}
                      onPress={() => { setPaymentStep('select'); setSelectedPaymentMethod(null); setLinkedBank(null); }}
                    >
                      <Text style={styles.backButtonText}>← Back to methods</Text>
                    </TouchableOpacity>
                    <View style={styles.selectedMethodHeader}>
                      <View style={styles.selectedMethodIcon}>
                        {selectedPaymentMethod === 'same_day_ach' ? (
                          <Timer size={24} color={Colors.primary} />
                        ) : (
                          <Building size={24} color={Colors.primary} />
                        )}
                      </View>
                      <View>
                        <Text style={styles.selectedMethodTitle}>
                          {selectedPaymentMethod === 'same_day_ach' ? 'Same-Day ACH' : 'Standard ACH'}
                        </Text>
                        <Text style={styles.selectedMethodSubtitle}>
                          Via Plaid • No fees • {selectedPaymentMethod === 'same_day_ach' ? 'Same day' : '1-2 days'}
                        </Text>
                      </View>
                    </View>
                    <BankLinkForm onBankLinked={setLinkedBank} disabled={isProcessing} />
                  </View>
                )}

                {paymentStep === 'confirm' && selectedPaymentMethod && selectedPaymentMethod !== 'wire' && (
                  <View style={styles.paymentInputSection}>
                    <TouchableOpacity
                      style={styles.backButton}
                      onPress={() => { setPaymentStep('select'); setSelectedPaymentMethod(null); }}
                    >
                      <Text style={styles.backButtonText}>← Back to methods</Text>
                    </TouchableOpacity>
                    <View style={styles.confirmMethodCard}>
                      <View style={[
                        styles.confirmMethodIcon,
                        isInstantMethod(selectedPaymentMethod) && styles.confirmMethodIconInstant,
                      ]}>
                        {React.createElement(getPaymentMethodIcon(selectedPaymentMethod), {
                          size: 32,
                          color: isInstantMethod(selectedPaymentMethod) ? '#00B4D8' : Colors.primary,
                        })}
                      </View>
                      {isInstantMethod(selectedPaymentMethod) && (
                        <View style={styles.instantTransferBadge}>
                          <Zap size={14} color={Colors.primary} />
                          <Text style={styles.instantTransferText}>Lightning Transfer</Text>
                        </View>
                      )}
                      <Text style={styles.confirmMethodName}>
                        {availablePaymentMethods.find(m => m.type === selectedPaymentMethod)?.name}
                      </Text>
                      <Text style={styles.confirmMethodDesc}>
                        {selectedPaymentMethod === 'fednow' && 'Funds transfer instantly via Federal Reserve FedNow network. Zero fees.'}
                        {selectedPaymentMethod === 'rtp' && 'Real-Time Payments network. Funds arrive in seconds. Just $0.25 flat.'}
                        {selectedPaymentMethod === 'usdc' && 'Transfer USDC stablecoin. Near-instant on-chain settlement. $0.01 gas.'}
                        {selectedPaymentMethod === 'apple_pay' && 'You will be redirected to Apple Pay to complete payment'}
                        {selectedPaymentMethod === 'google_pay' && 'You will be redirected to Google Pay to complete payment'}
                        {selectedPaymentMethod === 'paypal' && 'You will be redirected to PayPal to complete payment'}
                      </Text>
                    </View>
                  </View>
                )}

                {paymentStep === 'confirm' && selectedPaymentMethod === 'wire' && (
                  <View style={styles.paymentInputSection}>
                    <TouchableOpacity
                      style={styles.backButton}
                      onPress={() => { setPaymentStep('select'); setSelectedPaymentMethod(null); setWireType('domestic'); }}
                    >
                      <Text style={styles.backButtonText}>← Back to methods</Text>
                    </TouchableOpacity>
                    <View style={styles.selectedMethodHeader}>
                      <View style={styles.selectedMethodIcon}>
                        <Banknote size={24} color={Colors.primary} />
                      </View>
                      <View>
                        <Text style={styles.selectedMethodTitle}>Wire Transfer</Text>
                        <Text style={styles.selectedMethodSubtitle}>$25 fee • {wireType === 'domestic' ? 'Same day' : '2-5 days'}</Text>
                      </View>
                    </View>
                    <WireTransferForm
                      amount={parseFloat(fundAmount) || 0}
                      fee={calculatedFee}
                      wireType={wireType}
                      onWireTypeChange={setWireType}
                      disabled={isProcessing}
                    />
                  </View>
                )}

                {(paymentStep === 'input' || paymentStep === 'confirm') && selectedPaymentMethod && fundAmount && parseFloat(fundAmount) > 0 && (
                  <View style={styles.feeBreakdown}>
                    <View style={styles.feeRow}>
                      <Text style={styles.feeLabel}>Amount</Text>
                      <Text style={styles.feeValue}>{formatCurrencyWithDecimals(parseFloat(fundAmount))}</Text>
                    </View>
                    {calculatedFee > 0 && (
                      <View style={styles.feeRow}>
                        <Text style={styles.feeLabel}>Processing Fee</Text>
                        <Text style={[styles.feeValue, { color: Colors.error }]}>-{formatCurrencyWithDecimals(calculatedFee)}</Text>
                      </View>
                    )}
                    <View style={[styles.feeRow, styles.feeRowTotal]}>
                      <Text style={styles.feeLabelTotal}>You will receive</Text>
                      <Text style={styles.feeValueTotal}>{formatCurrencyWithDecimals(netAmount)}</Text>
                    </View>
                  </View>
                )}

                {(paymentStep === 'input' || paymentStep === 'confirm') && (
                  <TouchableOpacity
                    style={[
                      styles.confirmButton,
                      (!canProceedToPayment || isProcessing) && styles.confirmButtonDisabled
                    ]}
                    onPress={handleAddFunds}
                    disabled={!canProceedToPayment || isProcessing}
                  >
                    {isProcessing ? (
                      <View style={styles.processingContainer}>
                        <ActivityIndicator size="small" color={Colors.black} />
                        <Text style={[styles.confirmButtonText, { marginLeft: 8 }]}>Processing...</Text>
                      </View>
                    ) : (
                      <Text style={styles.confirmButtonText}>
                        {selectedPaymentMethod === 'apple_pay' ? 'Pay with Apple Pay' :
                         selectedPaymentMethod === 'google_pay' ? 'Pay with Google Pay' :
                         selectedPaymentMethod === 'paypal' ? 'Continue to PayPal' :
                         selectedPaymentMethod === 'wire' ? 'Get Wire Instructions' :
                         `Add ${fundAmount ? formatCurrencyWithDecimals(parseFloat(fundAmount)) : '$0.00'}`}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}

                <Text style={styles.securityNote}>
                  Secured by 256-bit encryption. Your payment info is never stored.
                </Text>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={withdrawModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={resetWithdrawModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {showWithdrawResult ? (withdrawResult?.success ? 'Withdrawal Initiated' : 'Withdrawal Failed') : 'Withdraw Funds'}
              </Text>
              <TouchableOpacity onPress={resetWithdrawModal} style={styles.closeButton}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {showWithdrawResult && withdrawResult ? (
              <View style={styles.resultContainer}>
                <View style={[
                  styles.resultIconContainer,
                  { backgroundColor: withdrawResult.success ? Colors.success + '20' : Colors.error + '20' }
                ]}>
                  {withdrawResult.success ? (
                    <CheckCircle size={48} color={Colors.success} />
                  ) : (
                    <AlertCircle size={48} color={Colors.error} />
                  )}
                </View>
                <Text style={styles.resultAmount}>{formatCurrencyWithDecimals(withdrawResult.amount)}</Text>
                <Text style={[
                  styles.resultStatus,
                  { color: withdrawResult.success ? Colors.success : Colors.error }
                ]}>
                  {withdrawResult.success ? withdrawResult.message : withdrawResult.error?.message || 'Withdrawal Failed'}
                </Text>
                {withdrawResult.success && (
                  <View style={styles.resultDetails}>
                    <View style={styles.resultRow}>
                      <Text style={styles.resultLabel}>Withdrawal ID</Text>
                      <Text style={styles.resultValue}>{withdrawResult.withdrawalId}</Text>
                    </View>
                    <View style={styles.resultRow}>
                      <Text style={styles.resultLabel}>Method</Text>
                      <Text style={styles.resultValue}>{withdrawResult.method}</Text>
                    </View>
                    <View style={styles.resultRow}>
                      <Text style={styles.resultLabel}>Processing Time</Text>
                      <Text style={styles.resultValue}>{withdrawResult.processingTime}</Text>
                    </View>
                    {withdrawResult.fee > 0 && (
                      <View style={styles.resultRow}>
                        <Text style={styles.resultLabel}>Fee</Text>
                        <Text style={styles.resultValue}>{formatCurrencyWithDecimals(withdrawResult.fee)}</Text>
                      </View>
                    )}
                    <View style={styles.resultRow}>
                      <Text style={styles.resultLabel}>You will Receive</Text>
                      <Text style={[styles.resultValue, { color: Colors.success, fontWeight: '700' as const }]}>
                        {formatCurrencyWithDecimals(withdrawResult.netAmount)}
                      </Text>
                    </View>
                    {withdrawResult.estimatedArrival && (
                      <View style={styles.resultRow}>
                        <Text style={styles.resultLabel}>Est. Arrival</Text>
                        <Text style={styles.resultValue}>
                          {new Date(withdrawResult.estimatedArrival).toLocaleDateString()}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
                <TouchableOpacity style={styles.confirmButton} onPress={resetWithdrawModal}>
                  <Text style={styles.confirmButtonText}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.balanceInfoRow}>
                  <Text style={styles.balanceInfoLabel}>Available Balance</Text>
                  <Text style={styles.balanceInfoValue}>{formatCurrencyWithDecimals(currentUser.walletBalance)}</Text>
                </View>

                <View style={styles.amountSection}>
                  <Text style={styles.inputSectionLabel}>Enter Amount</Text>
                  <View style={styles.amountInputContainer}>
                    <Text style={styles.currencySymbol}>$</Text>
                    <TextInput
                      style={styles.amountInput}
                      value={displayWithdrawAmount}
                      onChangeText={handleWithdrawAmountChange}
                      placeholder="0.00"
                      placeholderTextColor={Colors.textTertiary}
                      keyboardType="decimal-pad"
                      editable={!isWithdrawing}
                    />
                  </View>
                  <View style={styles.quickAmountsContainer}>
                    {quickWithdrawAmounts.map((amount) => (
                      <TouchableOpacity
                        key={amount}
                        style={[
                          styles.quickAmountButton,
                          withdrawAmount === amount.toString() && styles.quickAmountButtonActive
                        ]}
                        onPress={() => setWithdrawAmount(amount.toString())}
                        disabled={isWithdrawing}
                      >
                        <Text style={[
                          styles.quickAmountText,
                          withdrawAmount === amount.toString() && styles.quickAmountTextActive
                        ]}>
                          ${formatNumber(amount)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.paymentSection}>
                  <Text style={styles.inputSectionLabel}>Withdrawal Method</Text>
                  {availableWithdrawMethods.map((method) => {
                    const IconComponent = getPaymentMethodIcon(method.type);
                    const isSelected = selectedWithdrawMethod === method.type;
                    return (
                      <TouchableOpacity
                        key={method.id}
                        style={[
                          styles.paymentMethodItem,
                          isSelected && styles.paymentMethodItemActive
                        ]}
                        onPress={() => {
                          setSelectedWithdrawMethod(method.type);
                          void Haptics.selectionAsync();
                        }}
                        disabled={isWithdrawing}
                      >
                        <View style={[
                          styles.paymentMethodIcon,
                          isSelected && styles.paymentMethodIconActive
                        ]}>
                          <IconComponent size={20} color={isSelected ? Colors.primary : Colors.textSecondary} />
                        </View>
                        <View style={styles.paymentMethodInfo}>
                          <Text style={[
                            styles.paymentMethodName,
                            isSelected && styles.paymentMethodNameActive
                          ]}>
                            {method.name}
                          </Text>
                          <Text style={styles.paymentMethodDesc}>{method.description}</Text>
                        </View>
                        {isSelected && (
                          <View style={styles.checkIcon}>
                            <Check size={18} color={Colors.primary} />
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {selectedWithdrawMethod && withdrawAmount && parseFloat(withdrawAmount) > 0 && (
                  <View style={styles.feeBreakdown}>
                    <View style={styles.feeRow}>
                      <Text style={styles.feeLabel}>Withdrawal Amount</Text>
                      <Text style={styles.feeValue}>{formatCurrencyWithDecimals(parseFloat(withdrawAmount))}</Text>
                    </View>
                    {withdrawFee > 0 && (
                      <View style={styles.feeRow}>
                        <Text style={styles.feeLabel}>Processing Fee</Text>
                        <Text style={[styles.feeValue, { color: Colors.error }]}>-{formatCurrencyWithDecimals(withdrawFee)}</Text>
                      </View>
                    )}
                    <View style={[styles.feeRow, styles.feeRowTotal]}>
                      <Text style={styles.feeLabelTotal}>You will Receive</Text>
                      <Text style={styles.feeValueTotal}>{formatCurrencyWithDecimals(withdrawNetAmount)}</Text>
                    </View>
                  </View>
                )}

                <TouchableOpacity
                  style={[
                    styles.withdrawConfirmButton,
                    (!withdrawAmount || !selectedWithdrawMethod || isWithdrawing) && styles.confirmButtonDisabled
                  ]}
                  onPress={handleWithdraw}
                  disabled={!withdrawAmount || !selectedWithdrawMethod || isWithdrawing}
                >
                  {isWithdrawing ? (
                    <View style={styles.processingContainer}>
                      <ActivityIndicator size="small" color={Colors.white} />
                      <Text style={[styles.withdrawConfirmText, { marginLeft: 8 }]}>Processing...</Text>
                    </View>
                  ) : (
                    <Text style={styles.withdrawConfirmText}>
                      Withdraw {withdrawAmount ? formatCurrencyWithDecimals(parseFloat(withdrawAmount)) : '$0.00'}
                    </Text>
                  )}
                </TouchableOpacity>

                <Text style={styles.securityNote}>
                  Withdrawals typically process within 2-4 business days
                </Text>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 16,
  },
  balanceCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    marginTop: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
  },
  balanceIconRow: {
    alignItems: 'center',
    marginBottom: 12,
  },
  walletIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceLabel: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: '500' as const,
    marginBottom: 4,
  },
  balanceValue: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: '800' as const,
    marginBottom: 20,

  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
  },
  depositButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Colors.primary,
  },
  depositButtonText: {
    color: Colors.black,
    fontWeight: '700' as const,
    fontSize: 15,
  },
  withdrawButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  withdrawButtonText: {
    color: Colors.text,
    fontWeight: '700' as const,
    fontSize: 15,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700' as const,
  },
  lightningTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary + '15',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  lightningTagText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700' as const,
  },
  methodCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  methodCardTop: {
    borderColor: Colors.primary + '40',
  },
  methodIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodIconInstant: {
    backgroundColor: '#00B4D8' + '15',
  },
  methodInfo: {
    flex: 1,
  },
  methodNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  methodName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  methodDesc: {
    color: Colors.textTertiary,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 6,
  },
  methodFeatures: {
    flexDirection: 'row',
    gap: 6,
  },
  featureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: Colors.surfaceLight,
  },
  featureBadgeInstant: {
    backgroundColor: '#00B4D8' + '12',
  },
  featureBadgeFree: {
    backgroundColor: Colors.success + '12',
  },
  featureText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  featureTextInstant: {
    color: '#00B4D8',
  },
  featureTextFree: {
    color: Colors.success,
  },
  recommendedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.primary + '20',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  recommendedBadgeText: {
    color: Colors.primary,
    fontSize: 10,
    fontWeight: '800' as const,
  },
  providerBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  providerBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
  txItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  txIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txInfo: {
    flex: 1,
  },
  txDescription: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '500' as const,
  },
  txDate: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  txAmount: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  securityCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: Colors.success + '08',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.success + '20',
  },
  earnBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  earnBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  earnIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  earnBannerInfo: {
    flex: 1,
  },
  earnBannerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  earnBannerTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
  },
  earnApyTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.primary,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  earnApyTagText: {
    color: Colors.black,
    fontSize: 10,
    fontWeight: '700' as const,
  },
  earnBannerDesc: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  securityInfo: {
    flex: 1,
  },
  securityTitle: {
    color: Colors.success,
    fontSize: 14,
    fontWeight: '700' as const,
    marginBottom: 4,
  },
  securityText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800' as const,
  },
  closeButton: {
    padding: 8,
  },
  backIconButton: {
    padding: 8,
  },
  testModeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.warning + '15',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
  },
  testModeText: {
    color: Colors.warning,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  amountSection: {
    marginBottom: 20,
  },
  inputSectionLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  currencySymbol: {
    color: Colors.textSecondary,
    fontSize: 24,
    fontWeight: '600' as const,
    marginRight: 4,
  },
  amountInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 24,
    fontWeight: '700' as const,
    paddingVertical: 16,
  },
  quickAmountsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  quickAmountButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  quickAmountButtonActive: {
    backgroundColor: Colors.primary + '15',
    borderColor: Colors.primary,
  },
  quickAmountText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  quickAmountTextActive: {
    color: Colors.primary,
  },
  paymentSection: {
    marginBottom: 16,
  },
  speedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primary + '08',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
  },
  speedBannerText: {
    color: Colors.textSecondary,
    fontSize: 12,
    flex: 1,
  },
  paymentMethodItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginBottom: 6,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  paymentMethodItemRecommended: {
    borderColor: Colors.primary + '40',
  },
  paymentMethodItemActive: {
    backgroundColor: Colors.primary + '10',
    borderColor: Colors.primary,
  },
  paymentMethodIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentMethodIconInstant: {
    backgroundColor: '#00B4D8' + '15',
  },
  paymentMethodIconActive: {
    backgroundColor: Colors.primary + '15',
  },
  paymentMethodInfo: {
    flex: 1,
  },
  paymentMethodNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 3,
  },
  paymentMethodName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  paymentMethodNameActive: {
    color: Colors.primary,
  },
  paymentMethodDesc: {
    color: Colors.textTertiary,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 4,
  },
  checkIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentInputSection: {
    marginBottom: 16,
  },
  backButton: {
    marginBottom: 12,
  },
  backButtonText: {
    color: Colors.primary,
    fontWeight: '600' as const,
    fontSize: 14,
  },
  selectedMethodHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    padding: 14,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  selectedMethodIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  selectedMethodTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
    flexShrink: 1,
  },
  selectedMethodSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
    flexShrink: 1,
  },
  confirmMethodCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 24,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
  },
  confirmMethodIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  confirmMethodIconInstant: {
    backgroundColor: '#00B4D8' + '15',
  },
  instantTransferBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary + '15',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 12,
  },
  instantTransferText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  confirmMethodName: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
    marginBottom: 8,
    textAlign: 'center',
  },
  confirmMethodDesc: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  feeBreakdown: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    gap: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  feeRowTotal: {
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: 10,
    marginTop: 4,
  },
  feeLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    flex: 1,
  },
  feeValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  feeLabelTotal: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  feeValueTotal: {
    color: Colors.success,
    fontSize: 16,
    fontWeight: '800' as const,
  },
  confirmButton: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  confirmButtonDisabled: {
    opacity: 0.4,
  },
  confirmButtonText: {
    color: Colors.black,
    fontWeight: '700' as const,
    fontSize: 16,
  },
  withdrawConfirmButton: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  withdrawConfirmText: {
    color: Colors.black,
    fontWeight: '700' as const,
    fontSize: 16,
  },
  resultContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  resultIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  resultAmount: {
    color: Colors.text,
    fontSize: 32,
    fontWeight: '800' as const,
    marginBottom: 8,
  },
  resultStatus: {
    fontSize: 15,
    fontWeight: '600' as const,
    marginBottom: 20,
    textAlign: 'center',
  },
  resultDetails: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  resultLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    flex: 1,
  },
  resultValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
    flexShrink: 1,
    textAlign: 'right' as const,
  },
  bankInstructionsContainer: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  bankInstructionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  bankInstructionsTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
  },
  bankDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  bankDetailLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    flexShrink: 1,
  },
  bankDetailValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
    flexShrink: 1,
    textAlign: 'right' as const,
  },
  referenceContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.primary + '10',
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
    gap: 8,
  },
  referenceValue: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700' as const,
    marginTop: 2,
  },
  wireInstructionsWrapper: {
    width: '100%',
    marginBottom: 16,
  },
  balanceInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 8,
  },
  balanceInfoLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    flexShrink: 1,
  },
  balanceInfoValue: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800' as const,
  },
  processingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  securityNote: {
    color: Colors.textTertiary,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  scrollView: {
    backgroundColor: Colors.background,
  },
});
