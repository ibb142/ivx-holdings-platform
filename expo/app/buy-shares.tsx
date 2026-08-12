import React, { useState, useMemo, useCallback, useRef } from 'react';
import {View,
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
  Image} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ArrowLeft,
  Minus,
  Plus,
  Shield,
  TrendingUp,
  Info,
  CheckCircle,
  CreditCard,
  Wallet,
  Lock,
  Clock,
  AlertCircle,
  Building,
  Copy,
  CheckCheck,
  ShieldCheck,
  CircleDollarSign} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { formatCurrencyWithDecimals, formatNumber, formatAmountInput, parseAmountInput } from '@/lib/formatters';
import { useInvestmentGuard } from '@/hooks/useInvestmentGuard';
import InvestorDisclosure from '@/components/InvestorDisclosure';

import { useWalletBalance } from '@/lib/data-hooks';
import { useProperty } from '@/lib/data-hooks';
import { purchaseShares } from '@/lib/investment-service';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { supabase } from '@/lib/supabase';
import * as Clipboard from 'expo-clipboard';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { IVXImage } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import { EmptyState } from '@/components/ivx';

type PaymentMethod = 'wire' | 'wallet' | 'card';

const WIRE_TRANSFER_DETAILS = {
  bankName: '[PENDING CONFIGURATION - Contact admin@ivxholdings.com]',
  routingNumber: '[Pending configuration]',
  accountNumber: '[Wire details pending - Real bank account will be configured before launch]',
  accountName: 'IVXHOLDINGS LLC — Escrow',
  swiftCode: '[Pending]',
  bankAddress: '[Bank address pending configuration]',
  reference: 'IVX-SHARES'};

export default function BuySharesScreen() {
  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { propertyId } = useLocalSearchParams<{ propertyId: string }>();
  const { canInvest, checkAndProceed } = useInvestmentGuard();

  const { property: supabaseProperty } = useProperty(propertyId || '1');
  const property = supabaseProperty;

  const { balance } = useWalletBalance();
  const walletBalance = balance?.available ?? 0;

  const adminCardEnabled = useQuery({
    queryKey: ['admin-card-enabled'],
    queryFn: async () => {
      try {
        const { data } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'card_payment_enabled')
          .single();
        if (data) {
          return (data as any).value === 'true' || (data as any).value === true;
        }
        return false;
      } catch {
        console.log('[BuyShares] Card setting not found, defaulting to disabled');
        return false;
      }
    },
    staleTime: 30000});

  const isCardEnabled = adminCardEnabled.data === true;

  const [sharesInput, setSharesInput] = useState('10');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('wire');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [confirmationNumber, setConfirmationNumber] = useState('');
  const [step, setStep] = useState<'amount' | 'review' | 'success'>('amount');

  const successAnim = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0)).current;

  const shares = useMemo(() => Math.max(0, parseInt(parseAmountInput(sharesInput), 10) || 0), [sharesInput]);
  const pricePerShare = property?.pricePerShare ?? 0;
  const subtotal = shares * pricePerShare;
  const platformFee = subtotal * 0.01;
  const cardFee = paymentMethod === 'card' ? subtotal * 0.025 : 0;
  const wireFee = 0;
  const totalCost = subtotal + platformFee + cardFee + wireFee;
  const estimatedYield = property ? (subtotal * property.yield) / 100 : 0;
  const canAfford = paymentMethod === 'wallet' ? walletBalance >= totalCost : true;

  const copyToClipboard = useCallback(async (text: string, field: string) => {
    try {
      if (Platform.OS !== 'web') {
        await Clipboard.setStringAsync(text);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopiedField(field);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.log('[BuyShares] Copy failed:', err);
    }
  }, []);

  const adjustShares = useCallback((delta: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSharesInput(prev => {
      const current = parseInt(parseAmountInput(prev), 10) || 0;
      return formatAmountInput(String(Math.max(1, current + delta)));
    });
  }, []);

  const handleContinueToReview = useCallback(() => {
    if (shares < 1) {
      Alert.alert('Invalid Amount', 'Please enter at least 1 share.');
      return;
    }
    if (!property || property.status !== 'live') {
      Alert.alert('Not Available', 'This property is not currently open for investment.');
      return;
    }
    checkAndProceed(() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setStep('review');
    });
  }, [shares, property, checkAndProceed]);

  const handleConfirmPurchase = useCallback(async () => {
    if (!canInvest) {
      checkAndProceed(() => {});
      return;
    }
    if (!canAfford && paymentMethod === 'wallet') {
      Alert.alert('Insufficient Funds', 'Your wallet balance is not enough. Try bank transfer or card.');
      return;
    }
    if (!property) return;


    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsProcessing(true);
    setPurchaseError(null);

    try {
      console.log('[BuyShares] Submitting real purchase to Supabase...');
      const result = await purchaseShares({
        propertyId: property.id,
        propertyName: property.name,
        shares,
        pricePerShare,
        subtotal,
        platformFee,
        paymentFee: cardFee,
        totalCost,
        paymentMethod,
        investmentType: 'property_shares'});

      if (result.success) {
        console.log('[BuyShares] Purchase successful:', result.confirmationNumber);
        setConfirmationNumber(result.confirmationNumber);
        setStep('success');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        void queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
        void queryClient.invalidateQueries({ queryKey: ['holdings'] });
        void queryClient.invalidateQueries({ queryKey: ['transactions'] });
        void queryClient.invalidateQueries({ queryKey: ['properties'] });
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });

        Animated.sequence([
          Animated.timing(successAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.spring(checkScale, { toValue: 1, friction: 4, tension: 50, useNativeDriver: true }),
        ]).start();
      } else {
        console.error('[BuyShares] Purchase failed:', result.error, result.message);
        setPurchaseError(result.message);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Purchase Failed', result.message);
      }
    } catch (error) {
      console.error('[BuyShares] Unexpected error:', error);
      const msg = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
      setPurchaseError(msg);
      Alert.alert('Error', msg);
    } finally {
      setIsProcessing(false);
    }
  }, [canInvest, checkAndProceed, canAfford, paymentMethod, property, shares, pricePerShare, subtotal, platformFee, cardFee, totalCost, successAnim, checkScale, queryClient]);

  if (!property) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>Property not found</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (step === 'success') {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.successContainer, { paddingTop: insets.top + 40 }]}>
          <Animated.View style={[styles.successCheckWrap, { opacity: successAnim, transform: [{ scale: checkScale }] }]}>
            <View style={styles.successCheckCircle}>
              <CheckCircle size={64} color={Colors.success} />
            </View>
          </Animated.View>
          <Animated.View style={{ opacity: successAnim }}>
            <Text style={styles.successTitle}>Investment Successful!</Text>
            <Text style={styles.successSubtitle}>
              You purchased {formatNumber(shares)} shares of {property.name}
            </Text>

            <View style={styles.successCard}>
              <View style={styles.successRow}>
                <Text style={styles.successLabel}>Shares Purchased</Text>
                <Text style={styles.successValue}>{formatNumber(shares)}</Text>
              </View>
              <View style={styles.successRow}>
                <Text style={styles.successLabel}>Total Invested</Text>
                <Text style={styles.successValueGold}>{formatCurrencyWithDecimals(totalCost)}</Text>
              </View>
              <View style={styles.successRow}>
                <Text style={styles.successLabel}>Est. Annual Yield</Text>
                <Text style={[styles.successValue, { color: Colors.success }]}>{formatCurrencyWithDecimals(estimatedYield)}</Text>
              </View>
              <View style={styles.successRow}>
                <Text style={styles.successLabel}>Confirmation #</Text>
                <Text style={styles.successValue}>{confirmationNumber || `TXN-${Date.now().toString(36).toUpperCase()}`}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.successPrimaryBtn}
              onPress={() => router.push('/(tabs)/portfolio' as any)}
            >
              <Text style={styles.successPrimaryBtnText}>View Portfolio</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.successSecondaryBtn}
              onPress={() => router.back()}
            >
              <Text style={styles.successSecondaryBtnText}>Back to Property</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.headerBackBtn}
          onPress={() => step === 'review' ? setStep('amount') : router.back()}
        >
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {step === 'amount' ? 'Buy Shares' : 'Review Order'}
        </Text>
        <View style={styles.headerRight} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            style={styles.scrollView}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            <View style={styles.propertyBanner}>
              <Image source={{ uri: property.images[0] }} style={styles.propertyThumb} />
              <View style={styles.propertyBannerInfo}>
                <Text style={styles.propertyBannerName} numberOfLines={1}>{property.name}</Text>
                <Text style={styles.propertyBannerLocation}>{property.city}, {property.country}</Text>
                <View style={styles.propertyBannerStats}>
                  <Text style={styles.propertyBannerPrice}>{formatCurrencyWithDecimals(property.pricePerShare)}/share</Text>
                  <View style={styles.yieldBadge}>
                    <TrendingUp size={10} color={Colors.success} />
                    <Text style={styles.yieldBadgeText}>{property.yield}% yield</Text>
                  </View>
                </View>
              </View>
            </View>

            {step === 'amount' && (
              <>
                <View style={styles.amountSection}>
                  <Text style={styles.sectionLabel}>Number of Shares</Text>
                  <View style={styles.amountRow}>
                    <TouchableOpacity style={styles.amountBtn} onPress={() => adjustShares(-10)}>
                      <Minus size={20} color={Colors.text} />
                    </TouchableOpacity>
                    <View style={styles.amountInputWrap}>
                      <TextInput
                        style={styles.amountInput}
                        value={sharesInput}
                        onChangeText={(value) => setSharesInput(formatAmountInput(parseAmountInput(value)))}
                        keyboardType="numeric"
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                        placeholderTextColor={Colors.textTertiary}
                      />
                      <Text style={styles.amountInputLabel}>shares</Text>
                    </View>
                    <TouchableOpacity style={styles.amountBtn} onPress={() => adjustShares(10)}>
                      <Plus size={20} color={Colors.text} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.quickPickSection}>
                  {[1, 10, 50, 100, 500, 1000].map(qty => (
                    <TouchableOpacity
                      key={qty}
                      style={[styles.quickPickBtn, shares === qty && styles.quickPickBtnActive]}
                      onPress={() => { Keyboard.dismiss(); setSharesInput(formatAmountInput(String(qty))); }}
                    >
                      <Text style={[styles.quickPickText, shares === qty && styles.quickPickTextActive]}>
                        {qty >= 1000 ? `${qty / 1000}K` : qty}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.costBreakdown}>
                  <View style={styles.costRow}>
                    <Text style={styles.costLabel}>{formatNumber(shares)} shares × {formatCurrencyWithDecimals(pricePerShare)}</Text>
                    <Text style={styles.costValue}>{formatCurrencyWithDecimals(subtotal)}</Text>
                  </View>
                  <View style={styles.costRow}>
                    <Text style={styles.costLabel}>Platform fee (1%)</Text>
                    <Text style={styles.costValue}>{formatCurrencyWithDecimals(platformFee)}</Text>
                  </View>
                  <View style={styles.costDivider} />
                  <View style={styles.costRow}>
                    <Text style={styles.costLabelBold}>Total</Text>
                    <Text style={styles.costValueBold}>{formatCurrencyWithDecimals(subtotal + platformFee)}</Text>
                  </View>
                </View>

                <View style={styles.estimateCard}>
                  <View style={styles.estimateIcon}>
                    <TrendingUp size={18} color={Colors.success} />
                  </View>
                  <View style={styles.estimateInfo}>
                    <Text style={styles.estimateTitle}>Estimated Annual Return</Text>
                    <Text style={styles.estimateValue}>{formatCurrencyWithDecimals(estimatedYield)}/year</Text>
                  </View>
                </View>

                <View style={styles.infoCard}>
                  <View style={styles.infoRow}>
                    <Shield size={16} color={Colors.info} />
                    <Text style={styles.infoText}>Your investment is protected by escrow-secured funds</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Lock size={16} color={Colors.primary} />
                    <Text style={styles.infoText}>Shares tradeable anytime on IVXHOLDINGS marketplace</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Clock size={16} color={Colors.success} />
                    <Text style={styles.infoText}>Dividends paid {property.distributions.length > 0 ? 'quarterly' : 'as scheduled'}</Text>
                  </View>
                </View>
              </>
            )}

            {step === 'review' && (
              <>
                <View style={styles.paymentSection}>
                  <Text style={styles.sectionLabel}>Payment Method</Text>

                  <TouchableOpacity
                    style={[styles.paymentOption, paymentMethod === 'wire' && styles.paymentOptionActive, styles.paymentOptionPrimary]}
                    onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPaymentMethod('wire'); }}
                  >
                    <View style={[styles.paymentIconWrap, paymentMethod === 'wire' && styles.paymentIconWrapActive]}>
                      <Building size={20} color={paymentMethod === 'wire' ? Colors.primary : Colors.textSecondary} />
                    </View>
                    <View style={styles.paymentInfo}>
                      <View style={styles.paymentLabelRow}>
                        <Text style={[styles.paymentLabel, paymentMethod === 'wire' && styles.paymentLabelActive]}>Wire Transfer / ACH</Text>
                        <View style={styles.recommendedBadge}>
                          <ShieldCheck size={10} color={Colors.success} />
                          <Text style={styles.recommendedBadgeText}>Most Secure</Text>
                        </View>
                      </View>
                      <Text style={styles.paymentDesc}>No processing fee • 1-2 business days</Text>
                    </View>
                    <View style={[styles.paymentRadio, paymentMethod === 'wire' && styles.paymentRadioActive]}>
                      {paymentMethod === 'wire' && <View style={styles.paymentRadioDot} />}
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.paymentOption, paymentMethod === 'wallet' && styles.paymentOptionActive]}
                    onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPaymentMethod('wallet'); }}
                  >
                    <View style={[styles.paymentIconWrap, paymentMethod === 'wallet' && styles.paymentIconWrapActive]}>
                      <Wallet size={20} color={paymentMethod === 'wallet' ? Colors.primary : Colors.textSecondary} />
                    </View>
                    <View style={styles.paymentInfo}>
                      <Text style={[styles.paymentLabel, paymentMethod === 'wallet' && styles.paymentLabelActive]}>Wallet Balance</Text>
                      <Text style={styles.paymentDesc}>Balance: {formatCurrencyWithDecimals(walletBalance)} • Instant</Text>
                    </View>
                    <View style={[styles.paymentRadio, paymentMethod === 'wallet' && styles.paymentRadioActive]}>
                      {paymentMethod === 'wallet' && <View style={styles.paymentRadioDot} />}
                    </View>
                  </TouchableOpacity>

                  {isCardEnabled && (
                    <TouchableOpacity
                      style={[styles.paymentOption, paymentMethod === 'card' && styles.paymentOptionActive, styles.paymentOptionCard]}
                      onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPaymentMethod('card'); }}
                    >
                      <View style={[styles.paymentIconWrap, paymentMethod === 'card' && styles.paymentIconWrapActive]}>
                        <CreditCard size={20} color={paymentMethod === 'card' ? Colors.primary : Colors.textSecondary} />
                      </View>
                      <View style={styles.paymentInfo}>
                        <Text style={[styles.paymentLabel, paymentMethod === 'card' && styles.paymentLabelActive]}>Debit/Credit Card</Text>
                        <Text style={styles.paymentDesc}>2.5% processing fee • Instant</Text>
                      </View>
                      <View style={[styles.paymentRadio, paymentMethod === 'card' && styles.paymentRadioActive]}>
                        {paymentMethod === 'card' && <View style={styles.paymentRadioDot} />}
                      </View>
                    </TouchableOpacity>
                  )}
                </View>

                {paymentMethod === 'wire' && (
                  <View style={styles.wireDetailsSection}>
                    <View style={styles.wireHeader}>
                      <CircleDollarSign size={18} color={Colors.primary} />
                      <Text style={styles.wireHeaderTitle}>Wire / ACH Transfer Details</Text>
                    </View>
                    <Text style={styles.wireInstructions}>
                      Send the exact amount below to complete your purchase. Include the reference number in the memo field.
                    </Text>

                    <View style={styles.wireAmountHighlight}>
                      <Text style={styles.wireAmountLabel}>Amount to Send</Text>
                      <Text style={styles.wireAmountValue}>{formatCurrencyWithDecimals(totalCost)}</Text>
                    </View>

                    {[
                      { label: 'Bank Name', value: WIRE_TRANSFER_DETAILS.bankName, key: 'bankName' },
                      { label: 'Routing Number (ACH)', value: WIRE_TRANSFER_DETAILS.routingNumber, key: 'routing' },
                      { label: 'Account Number', value: WIRE_TRANSFER_DETAILS.accountNumber, key: 'account' },
                      { label: 'Account Name', value: WIRE_TRANSFER_DETAILS.accountName, key: 'accountName' },
                      { label: 'SWIFT Code', value: WIRE_TRANSFER_DETAILS.swiftCode, key: 'swift' },
                      { label: 'Bank Address', value: WIRE_TRANSFER_DETAILS.bankAddress, key: 'address' },
                    ].map(item => (
                      <View key={item.key} style={styles.wireRow}>
                        <View style={styles.wireRowInfo}>
                          <Text style={styles.wireRowLabel}>{item.label}</Text>
                          <Text style={styles.wireRowValue}>{item.value}</Text>
                        </View>
                        <TouchableOpacity
                          style={styles.wireCopyBtn}
                          onPress={() => copyToClipboard(item.value, item.key)}
                        >
                          {copiedField === item.key ? (
                            <CheckCheck size={16} color={Colors.success} />
                          ) : (
                            <Copy size={16} color={Colors.textTertiary} />
                          )}
                        </TouchableOpacity>
                      </View>
                    ))}

                    <View style={styles.wireRefRow}>
                      <Text style={styles.wireRefLabel}>Reference / Memo</Text>
                      <TouchableOpacity
                        style={styles.wireRefValueWrap}
                        onPress={() => copyToClipboard(`${WIRE_TRANSFER_DETAILS.reference}-${propertyId?.slice(0, 8) || 'SHARES'}`, 'reference')}
                      >
                        <Text style={styles.wireRefValue}>
                          {WIRE_TRANSFER_DETAILS.reference}-{propertyId?.slice(0, 8) || 'SHARES'}
                        </Text>
                        {copiedField === 'reference' ? (
                          <CheckCheck size={14} color={Colors.success} />
                        ) : (
                          <Copy size={14} color={Colors.primary} />
                        )}
                      </TouchableOpacity>
                    </View>

                    <View style={styles.wireSecurityNote}>
                      <Shield size={14} color={Colors.success} />
                      <Text style={styles.wireSecurityText}>
                        ACH/Wire transfers are FDIC-insured and processed through our secure escrow account. Your funds are protected.
                      </Text>
                    </View>
                  </View>
                )}

                <View style={styles.orderSummary}>
                  <Text style={styles.sectionLabel}>Order Summary</Text>
                  <View style={styles.orderCard}>
                    <View style={styles.orderRow}>
                      <Text style={styles.orderLabel}>Property</Text>
                      <Text style={styles.orderValue} numberOfLines={1}>{property.name}</Text>
                    </View>
                    <View style={styles.orderRow}>
                      <Text style={styles.orderLabel}>Shares</Text>
                      <Text style={styles.orderValue}>{formatNumber(shares)}</Text>
                    </View>
                    <View style={styles.orderRow}>
                      <Text style={styles.orderLabel}>Price/Share</Text>
                      <Text style={styles.orderValue}>{formatCurrencyWithDecimals(pricePerShare)}</Text>
                    </View>
                    <View style={styles.orderRow}>
                      <Text style={styles.orderLabel}>Subtotal</Text>
                      <Text style={styles.orderValue}>{formatCurrencyWithDecimals(subtotal)}</Text>
                    </View>
                    <View style={styles.orderRow}>
                      <Text style={styles.orderLabel}>Platform Fee (1%)</Text>
                      <Text style={styles.orderValue}>{formatCurrencyWithDecimals(platformFee)}</Text>
                    </View>
                    {cardFee > 0 && (
                      <View style={styles.orderRow}>
                        <Text style={styles.orderLabel}>Card Fee (2.5%)</Text>
                        <Text style={styles.orderValue}>{formatCurrencyWithDecimals(cardFee)}</Text>
                      </View>
                    )}
                    {paymentMethod === 'wire' && (
                      <View style={styles.orderRow}>
                        <Text style={[styles.orderLabel, { color: Colors.success }]}>Wire/ACH Fee</Text>
                        <Text style={[styles.orderValue, { color: Colors.success }]}>FREE</Text>
                      </View>
                    )}
                    <View style={styles.orderDivider} />
                    <View style={styles.orderRow}>
                      <Text style={styles.orderLabelBold}>Total Due</Text>
                      <Text style={styles.orderValueBold}>{formatCurrencyWithDecimals(totalCost)}</Text>
                    </View>
                  </View>
                </View>

                {purchaseError && (
                  <View style={styles.errorBanner}>
                    <AlertCircle size={16} color="#FF4444" />
                    <Text style={styles.errorBannerText}>{purchaseError}</Text>
                  </View>
                )}

                <View style={styles.disclaimerSection}>
                  <Info size={14} color={Colors.textTertiary} />
                  <Text style={styles.disclaimerText}>
                    By confirming this purchase, you agree to the IVXHOLDINGS Investment Agreement and acknowledge the risks associated with real estate investments.
                  </Text>
                </View>
              </>
            )}

            <InvestorDisclosure compact />

            <View style={{ height: 140 }} />
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        {step === 'amount' ? (
          <TouchableOpacity
            style={[styles.ctaButton, shares < 1 && styles.ctaButtonDisabled]}
            onPress={handleContinueToReview}
            disabled={shares < 1}
          >
            <Text style={styles.ctaButtonText}>
              Continue — {formatCurrencyWithDecimals(subtotal + platformFee)}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.ctaButton, isProcessing && styles.ctaButtonProcessing]}
            onPress={handleConfirmPurchase}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <View style={styles.processingRow}>
                <ShimmerIndicator size="small" color={Colors.black} />
                <Text style={styles.ctaButtonText}>Processing...</Text>
              </View>
            ) : (
              <View style={styles.processingRow}>
                <Lock size={16} color={Colors.black} />
                <Text style={styles.ctaButtonText}>Confirm Purchase — {formatCurrencyWithDecimals(totalCost)}</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.background},
  headerBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text},
  headerRight: {
    width: 40},
  scrollView: {
    flex: 1},
  propertyBanner: {
    flexDirection: 'row',
    margin: 16,
    padding: 14,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 14},
  propertyThumb: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: Colors.backgroundSecondary},
  propertyBannerInfo: {
    flex: 1,
    justifyContent: 'center'},
  propertyBannerName: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 2},
  propertyBannerLocation: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 6},
  propertyBannerStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  propertyBannerPrice: {
    fontSize: 14,
    fontWeight: '800' as const,
    color: Colors.primary},
  yieldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.success + '15',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2},
  yieldBadgeText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.success},
  amountSection: {
    marginHorizontal: 16,
    marginBottom: 12},
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    marginBottom: 12,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12},
  amountBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  amountInputWrap: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 16,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6},
  amountInput: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: Colors.text,
    textAlign: 'center',
    minWidth: 60},
  amountInputLabel: {
    fontSize: 14,
    color: Colors.textTertiary,
    fontWeight: '500' as const},
  quickPickSection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 20},
  quickPickBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  quickPickBtnActive: {
    backgroundColor: Colors.primary + '20',
    borderColor: Colors.primary},
  quickPickText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  quickPickTextActive: {
    color: Colors.primary},
  costBreakdown: {
    marginHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 12},
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8},
  costLabel: {
    fontSize: 14,
    color: Colors.textSecondary},
  costValue: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '500' as const},
  costDivider: {
    height: 1,
    backgroundColor: Colors.surfaceBorder,
    marginVertical: 4},
  costLabelBold: {
    fontSize: 16,
    color: Colors.text,
    fontWeight: '800' as const},
  costValueBold: {
    fontSize: 18,
    color: Colors.primary,
    fontWeight: '800' as const},
  estimateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    backgroundColor: '#0D2818',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.success + '30',
    gap: 12},
  estimateIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.success + '20',
    alignItems: 'center',
    justifyContent: 'center'},
  estimateInfo: {
    flex: 1},
  estimateTitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 2},
  estimateValue: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.success},
  infoCard: {
    marginHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 12},
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  infoText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18},
  paymentSection: {
    marginHorizontal: 16,
    marginBottom: 16},
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.surfaceBorder,
    marginBottom: 8,
    gap: 12},
  paymentOptionActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08'},
  paymentIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center'},
  paymentIconWrapActive: {
    backgroundColor: Colors.primary + '20'},
  paymentInfo: {
    flex: 1},
  paymentLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text},
  paymentLabelActive: {
    color: Colors.primary},
  paymentDesc: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2},
  paymentRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.textTertiary,
    alignItems: 'center',
    justifyContent: 'center'},
  paymentRadioActive: {
    borderColor: Colors.primary},
  paymentRadioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.primary},
  orderSummary: {
    marginHorizontal: 16,
    marginBottom: 16},
  orderCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  orderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8},
  orderLabel: {
    fontSize: 14,
    color: Colors.textSecondary},
  orderValue: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '500' as const,
    maxWidth: '55%' as any,
    textAlign: 'right' as const},
  orderDivider: {
    height: 1,
    backgroundColor: Colors.surfaceBorder,
    marginVertical: 6},
  orderLabelBold: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.text},
  orderValueBold: {
    fontSize: 20,
    fontWeight: '900' as const,
    color: Colors.primary},
  disclaimerSection: {
    flexDirection: 'row',
    marginHorizontal: 16,
    gap: 8,
    alignItems: 'flex-start'},
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    color: Colors.textTertiary,
    lineHeight: 17},
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder},
  ctaButton: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center'},
  ctaButtonDisabled: {
    opacity: 0.4},
  ctaButtonProcessing: {
    opacity: 0.8},
  ctaButtonText: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.black},
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  successContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24},
  successCheckWrap: {
    marginBottom: 24},
  successCheckCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.success + '15',
    alignItems: 'center',
    justifyContent: 'center'},
  successTitle: {
    fontSize: 26,
    fontWeight: '900' as const,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 8},
  successSubtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 22},
  successCard: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 28},
  successRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10},
  successLabel: {
    fontSize: 14,
    color: Colors.textSecondary},
  successValue: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text},
  successValueGold: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.primary},
  successPrimaryBtn: {
    width: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12},
  successPrimaryBtnText: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.black},
  successSecondaryBtn: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  successSecondaryBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  errorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'},
  errorText: {
    fontSize: 16,
    color: Colors.textSecondary,
    marginBottom: 16},
  backBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10},
  backBtnText: {
    color: Colors.black,
    fontWeight: '700' as const},
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    backgroundColor: '#3D1515',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FF444430',
    gap: 10},
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#FF6B6B',
    lineHeight: 18},
  paymentOptionPrimary: {
    borderWidth: 1.5,
    borderColor: Colors.success + '40',
    backgroundColor: Colors.success + '08'},
  paymentOptionCard: {
    opacity: 0.85},
  paymentLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  recommendedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.success + '20',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2},
  recommendedBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.success,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3},
  wireDetailsSection: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.primary + '25'},
  wireHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10},
  wireHeaderTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text},
  wireInstructions: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginBottom: 16},
  wireAmountHighlight: {
    backgroundColor: Colors.primary + '15',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '30'},
  wireAmountLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  wireAmountValue: {
    fontSize: 28,
    fontWeight: '900' as const,
    color: Colors.primary},
  wireRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  wireRowInfo: {
    flex: 1},
  wireRowLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginBottom: 2,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4},
  wireRowValue: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text},
  wireCopyBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center'},
  wireRefRow: {
    marginTop: 14,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14},
  wireRefLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginBottom: 6,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4},
  wireRefValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'},
  wireRefValue: {
    fontSize: 17,
    fontWeight: '800' as const,
    color: Colors.primary,
    letterSpacing: 1},
  wireSecurityNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 16,
    backgroundColor: Colors.success + '10',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.success + '20'},
  wireSecurityText: {
    flex: 1,
    fontSize: 12,
    color: Colors.success,
    lineHeight: 17}});
