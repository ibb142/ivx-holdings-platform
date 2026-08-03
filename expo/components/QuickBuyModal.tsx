import React, { useState, useCallback, useRef, useEffect } from 'react';
import {View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Image,
  Alert,
  TextInput,
  Keyboard,
  TouchableWithoutFeedback,
  ScrollView,
  KeyboardAvoidingView,
  Platform} from "react-native";
import {
  X,
  TrendingUp,
  Shield,
  Zap,
  ChevronRight,
  MapPin,
  Landmark,
  Layers,
  CheckCircle,
  Lock,
  AlertCircle,
  Mail,
  User,
  Eye,
  EyeOff,
  ArrowLeft,
  Globe,
  Phone} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { formatCurrencyWithDecimals, formatCurrencyCompact, formatNumber } from '@/lib/formatters';
import { buildOwnershipSnapshot } from '@/lib/ownership-math';
import { formatTrustTimelineLabel, resolveTrustMarket } from '@/lib/trust-market';
import { purchaseJVInvestment } from '@/lib/investment-service';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type InvestType = 'jv' | 'fractional';
type ModalStep = 'select' | 'confirm' | 'processing' | 'success' | 'auth' | 'auth_login';

interface QuickBuyDeal {
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
}

function formatOwnershipPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0%';
  }
  if (value >= 1) {
    return `${value.toFixed(2)}%`;
  }
  return `${value.toFixed(4)}%`;
}

interface QuickBuyModalProps {
  visible: boolean;
  onClose: () => void;
  deal: QuickBuyDeal | null;
  onNavigateToFullInvest: (dealId: string) => void;
}

const JV_AMOUNTS = [25000, 50000, 75000, 100000, 150000, 250000];
const FRACTIONAL_AMOUNTS = [100, 500, 1000, 5000, 10000, 25000];

export default function QuickBuyModal({ visible, onClose, deal, onNavigateToFullInvest }: QuickBuyModalProps) {
  const { isAuthenticated, register, login, registerLoading, loginLoading } = useAuth();
  const [selectedAmount, setSelectedAmount] = useState<number>(25000);
  const [customAmount, setCustomAmount] = useState('');
  const [investType, setInvestType] = useState<InvestType>('jv');
  const [step, setStep] = useState<ModalStep>('select');
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [_confirmationNumber, setConfirmationNumber] = useState('');
  const slideAnim = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const queryClient = useQueryClient();

  const [authFirstName, setAuthFirstName] = useState('');
  const [authLastName, setAuthLastName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authCountry, setAuthCountry] = useState('US');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState('');
  const [pendingInvest, setPendingInvest] = useState(false);
  const [tosAccepted, setTosAccepted] = useState(false);

  const activeAmounts = investType === 'jv' ? JV_AMOUNTS : FRACTIONAL_AMOUNTS;
  const minAmount = investType === 'jv' ? 25000 : Math.max(Number(deal?.minInvestment ?? 100), 1);

  const handleSwitchType = useCallback((type: InvestType) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInvestType(type);
    setCustomAmount('');
    if (type === 'jv') {
      setSelectedAmount(25000);
    } else {
      setSelectedAmount(100);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setStep('select');
      setInvestType('jv');
      setSelectedAmount(25000);
      setCustomAmount('');
      setPurchaseError(null);
      setConfirmationNumber('');
      setAuthError('');
      setPendingInvest(false);
      successScale.setValue(0);
      Animated.spring(slideAnim, {
        toValue: 1,
        friction: 8,
        tension: 65,
        useNativeDriver: true}).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true}).start();
    }
  }, [visible, slideAnim, successScale]);

  useEffect(() => {
    if (isAuthenticated && pendingInvest && step === 'auth') {
      console.log('[QuickBuy] Auth completed, proceeding to confirm');
      setPendingInvest(false);
      setStep('confirm');
    }
    if (isAuthenticated && pendingInvest && step === 'auth_login') {
      console.log('[QuickBuy] Login completed, proceeding to confirm');
      setPendingInvest(false);
      setStep('confirm');
    }
  }, [isAuthenticated, pendingInvest, step]);

  const handleSelectAmount = useCallback((amount: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedAmount(amount);
    setCustomAmount('');
  }, []);

  const handleCustomAmountChange = useCallback((text: string) => {
    const clean = text.replace(/[^0-9]/g, '');
    const formatted = clean.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    setCustomAmount(formatted);
    if (clean) {
      setSelectedAmount(parseInt(clean, 10));
    }
  }, []);

  const resolvedTrustMarket = resolveTrustMarket({
    salePrice: deal?.salePrice,
    propertyValue: deal?.propertyMarketValue,
    totalInvestment: deal?.totalInvestment,
    minInvestment: deal?.minInvestment,
    fractionalSharePrice: deal?.fractionalSharePrice,
    timelineMin: deal?.timelineMin,
    timelineMax: deal?.timelineMax,
    timelineUnit: 'months',
    priceChange1h: deal?.priceChange1h,
    priceChange2h: deal?.priceChange2h});
  const liveSalePrice = resolvedTrustMarket.salePrice;
  const ownershipSnapshot = buildOwnershipSnapshot(selectedAmount, liveSalePrice);
  const equityPercent = ownershipSnapshot.ownershipPercent;
  const ownershipLabel = liveSalePrice > 0 ? 'Live Ownership' : deal?.propertyMarketValue && deal.propertyMarketValue > 0 ? 'Property Ownership' : 'Pool Ownership';
  const estimatedReturn = deal ? selectedAmount * (deal.expectedROI / 100) : 0;
  const liveFractionalPrice = resolvedTrustMarket.fractionalSharePrice;
  const oneHourPrice = Number((liveFractionalPrice * (1 + (resolvedTrustMarket.priceChange1h / 100))).toFixed(2));
  const twoHourPrice = Number((liveFractionalPrice * (1 + (resolvedTrustMarket.priceChange2h / 100))).toFixed(2));
  const timelineLabel = formatTrustTimelineLabel(resolvedTrustMarket);

  const handleContinue = useCallback(() => {
    if (!deal) return;
    if (selectedAmount < minAmount) {
      Alert.alert('Minimum Investment', investType === 'jv' ? 'JV Direct minimum investment is $25,000' : 'Fractional minimum investment is $100');
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (!isAuthenticated) {
      console.log('[QuickBuy] User not authenticated, showing signup');
      setPendingInvest(true);
      setStep('auth');
      return;
    }

    setTosAccepted(false);
    setStep('confirm');
  }, [deal, selectedAmount, minAmount, isAuthenticated, investType]);

  const handleSignup = useCallback(async () => {
    setAuthError('');
    if (!authFirstName.trim()) { setAuthError('First name is required'); return; }
    if (!authEmail.trim() || !authEmail.includes('@')) { setAuthError('Valid email is required'); return; }
    if (!authPassword.trim() || authPassword.length < 6) { setAuthError('Password must be at least 6 characters'); return; }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    console.log('[QuickBuy] Registering user inline:', authEmail);

    const result = await register({
      email: authEmail.trim().toLowerCase(),
      password: authPassword,
      firstName: authFirstName.trim(),
      lastName: authLastName.trim() || authFirstName.trim(),
      phone: authPhone.trim(),
      country: authCountry});

    if (result.success) {
      console.log('[QuickBuy] Registration successful, will proceed to invest');
      setPendingInvest(true);
    } else {
      setAuthError(result.message || 'Registration failed. Try again.');
    }
  }, [authFirstName, authLastName, authEmail, authPassword, authPhone, authCountry, register]);

  const handleLogin = useCallback(async () => {
    setAuthError('');
    if (!authEmail.trim() || !authEmail.includes('@')) { setAuthError('Valid email is required'); return; }
    if (!authPassword.trim()) { setAuthError('Password is required'); return; }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    console.log('[QuickBuy] Logging in user inline:', authEmail);

    const result = await login(authEmail.trim().toLowerCase(), authPassword);
    if (result.success) {
      console.log('[QuickBuy] Login successful, will proceed to invest');
      setPendingInvest(true);
    } else {
      setAuthError(result.message || 'Login failed. Check your credentials.');
    }
  }, [authEmail, authPassword, login]);

  const handleConfirmPurchase = useCallback(async () => {
    if (!deal) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setStep('processing');
    setPurchaseError(null);

    try {
      console.log('[QuickBuy] Submitting real purchase to Supabase...', {
        dealId: deal.id,
        amount: selectedAmount,
        type: investType});

      const eqPct = ownershipSnapshot.ownershipPercent;

      const result = await purchaseJVInvestment({
        jvDealId: deal.id,
        jvTitle: deal.title,
        jvProjectName: deal.projectName,
        investmentPool: investType === 'jv' ? 'jv_direct' : 'token_shares',
        amount: selectedAmount,
        equityPercent: eqPct,
        expectedROI: deal.expectedROI,
        paymentMethod: 'bank'});

      if (result.success) {
        console.log('[QuickBuy] Purchase successful:', result.confirmationNumber);
        setConfirmationNumber(result.confirmationNumber);
        setStep('success');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        void queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
        void queryClient.invalidateQueries({ queryKey: ['holdings'] });
        void queryClient.invalidateQueries({ queryKey: ['transactions'] });
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });

        Animated.spring(successScale, {
          toValue: 1,
          friction: 4,
          tension: 50,
          useNativeDriver: true}).start();
      } else {
        console.error('[QuickBuy] Purchase failed:', result.error, result.message);
        setPurchaseError(result.message);
        setStep('confirm');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Purchase Failed', result.message);
      }
    } catch (error) {
      console.error('[QuickBuy] Unexpected error:', error);
      const msg = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
      setPurchaseError(msg);
      setStep('confirm');
      Alert.alert('Error', msg);
    }
  }, [deal, selectedAmount, investType, successScale, queryClient, ownershipSnapshot.ownershipPercent]);

  const handleGoToFullInvest = useCallback(() => {
    if (!deal) return;
    onClose();
    setTimeout(() => onNavigateToFullInvest(deal.id), 300);
  }, [deal, onClose, onNavigateToFullInvest]);

  const goBackFromAuth = useCallback(() => {
    setPendingInvest(false);
    setAuthError('');
    setStep('select');
  }, []);

  if (!deal) return null;

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [600, 0]});

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={ms.overlay}>
          <TouchableOpacity style={ms.backdropTouch} activeOpacity={1} onPress={onClose} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={ms.kavWrap}
          >
            <Animated.View style={[ms.sheet, { transform: [{ translateY }] }]}>
              <View style={ms.handle} />

              <View style={ms.headerRow}>
                <View style={ms.headerLeft}>
                  {(step === 'auth' || step === 'auth_login') && (
                    <TouchableOpacity style={ms.headerBackBtn} onPress={goBackFromAuth}>
                      <ArrowLeft size={18} color={Colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                  <Text style={ms.headerTitle}>
                    {step === 'select' ? 'Quick Invest' : step === 'confirm' ? 'Confirm' : step === 'success' ? 'Done!' : step === 'auth' ? 'Create Account' : step === 'auth_login' ? 'Sign In' : 'Processing'}
                  </Text>
                </View>
                <TouchableOpacity style={ms.closeBtn} onPress={onClose}>
                  <X size={20} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                bounces={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={ms.scrollContent}
              >
                <View style={ms.dealRow}>
                  {deal.photo ? (
                    <Image source={{ uri: deal.photo }} style={ms.dealThumb} />
                  ) : (
                    <View style={[ms.dealThumb, ms.dealThumbPlaceholder]}>
                      <Landmark size={20} color={Colors.primary} />
                    </View>
                  )}
                  <View style={ms.dealInfo}>
                    <Text style={ms.dealName} numberOfLines={1}>{deal.projectName}</Text>
                    {deal.propertyAddress ? (
                      <View style={ms.dealAddressRow}>
                        <MapPin size={10} color={Colors.textTertiary} />
                        <Text style={ms.dealAddress} numberOfLines={1}>{deal.propertyAddress}</Text>
                      </View>
                    ) : null}
                    <View style={ms.dealMetaRow}>
                      <Text style={ms.dealInvestment}>{formatCurrencyCompact(deal.totalInvestment)}</Text>
                      <View style={ms.dealRoiBadge}>
                        <TrendingUp size={10} color="#00C48C" />
                        <Text style={ms.dealRoi}>{deal.expectedROI}% ROI</Text>
                      </View>
                    </View>
                  </View>
                </View>

                {step === 'select' && (
                  <>
                    <View style={ms.typeRow}>
                      <TouchableOpacity
                        style={[ms.typeBtn, investType === 'jv' && ms.typeBtnActive]}
                        onPress={() => handleSwitchType('jv')}
                        activeOpacity={0.7}
                      >
                        <Landmark size={16} color={investType === 'jv' ? '#00C48C' : Colors.textTertiary} />
                        <Text style={[ms.typeBtnText, investType === 'jv' && ms.typeBtnTextActive]}>JV Direct</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[ms.typeBtn, investType === 'fractional' && ms.typeBtnActiveFractional]}
                        onPress={() => handleSwitchType('fractional')}
                        activeOpacity={0.7}
                      >
                        <Layers size={16} color={investType === 'fractional' ? '#FFD700' : Colors.textTertiary} />
                        <Text style={[ms.typeBtnText, investType === 'fractional' && ms.typeBtnTextActive]}>Fractional</Text>
                      </TouchableOpacity>
                    </View>

                    {liveSalePrice > 0 ? (
                      <View style={ms.marketValueNote}>
                        <Text style={ms.marketValueNoteText}>Sale Price: {formatCurrencyCompact(liveSalePrice)} • Timeline: {timelineLabel} • Ownership: {formatOwnershipPercent(equityPercent)}</Text>
                      </View>
                    ) : null}

                    <View style={ms.previewMarketStrip}>
                      <View style={ms.previewMarketPill}>
                        <Text style={ms.previewMarketLabel}>Entry</Text>
                        <Text style={ms.previewMarketValue}>{formatCurrencyWithDecimals(liveFractionalPrice)}</Text>
                      </View>
                      <View style={ms.previewMarketPill}>
                        <Text style={ms.previewMarketLabel}>1H</Text>
                        <Text style={[ms.previewMarketValue, ms.previewMarketValueUp]}>{formatCurrencyWithDecimals(oneHourPrice)}</Text>
                      </View>
                      <View style={ms.previewMarketPill}>
                        <Text style={ms.previewMarketLabel}>2H</Text>
                        <Text style={[ms.previewMarketValue, ms.previewMarketValueUp]}>{formatCurrencyWithDecimals(twoHourPrice)}</Text>
                      </View>
                    </View>

                    <Text style={ms.amountLabel}>
                      {investType === 'jv' ? 'Select Amount (Min $25K)' : 'Select Amount (Min $100)'}
                    </Text>
                    <View style={ms.amountsGrid}>
                      {activeAmounts.map(amt => (
                        <TouchableOpacity
                          key={amt}
                          style={[ms.amountChip, selectedAmount === amt && !customAmount && ms.amountChipActive]}
                          onPress={() => handleSelectAmount(amt)}
                        >
                          <Text style={[ms.amountChipText, selectedAmount === amt && !customAmount && ms.amountChipTextActive]}>
                            {amt >= 1000000 ? `${(amt / 1000000)}M` : amt >= 1000 ? `${formatNumber(amt / 1000)}K` : `${formatNumber(amt)}`}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <View style={ms.customInputRow}>
                      <Text style={ms.customPrefix}>$</Text>
                      <TextInput
                        style={ms.customInput}
                        value={customAmount}
                        onChangeText={handleCustomAmountChange}
                        placeholder="Custom amount"
                        placeholderTextColor={Colors.textTertiary}
                        keyboardType="numeric"
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                      />
                    </View>

                    <View style={ms.previewRow}>
                      <View style={ms.previewItem}>
                        <Text style={ms.previewLabel}>You Invest</Text>
                        <Text style={ms.previewValue}>{formatCurrencyWithDecimals(selectedAmount)}</Text>
                      </View>
                      <View style={ms.previewDivider} />
                      <View style={ms.previewItem}>
                        <Text style={ms.previewLabel}>{ownershipLabel}</Text>
                        <Text style={[ms.previewValue, { color: Colors.primary }]}>{formatOwnershipPercent(equityPercent)}</Text>
                      </View>
                      <View style={ms.previewDivider} />
                      <View style={ms.previewItem}>
                        <Text style={ms.previewLabel}>Est. Return</Text>
                        <Text style={[ms.previewValue, { color: '#00C48C' }]}>{formatCurrencyCompact(estimatedReturn)}</Text>
                      </View>
                    </View>

                    <Text style={ms.ownershipHint}>{ownershipSnapshot.ownershipText}</Text>

                    <TouchableOpacity
                      style={[ms.ctaBtn, selectedAmount < minAmount && ms.ctaBtnDisabled]}
                      onPress={handleContinue}
                      disabled={selectedAmount < minAmount}
                      testID="quick-buy-continue"
                    >
                      <Zap size={18} color="#000" />
                      <Text style={ms.ctaBtnText}>
                        {isAuthenticated ? `Continue — ${formatCurrencyWithDecimals(selectedAmount)}` : `Invest — ${formatCurrencyWithDecimals(selectedAmount)}`}
                      </Text>
                    </TouchableOpacity>

                    {!isAuthenticated && (
                      <View style={ms.authNoteBanner}>
                        <Lock size={13} color="#FFD700" />
                        <Text style={ms.authNoteText}>Quick signup required to invest — takes 30 seconds</Text>
                      </View>
                    )}

                    <TouchableOpacity style={ms.fullFlowBtn} onPress={handleGoToFullInvest}>
                      <Text style={ms.fullFlowText}>View Full Details</Text>
                      <ChevronRight size={14} color={Colors.primary} />
                    </TouchableOpacity>
                  </>
                )}

                {step === 'auth' && (
                  <>
                    <View style={ms.authHeader}>
                      <View style={ms.authBadge}>
                        <Zap size={12} color="#FFD700" />
                        <Text style={ms.authBadgeText}>QUICK SIGNUP TO INVEST</Text>
                      </View>
                      <Text style={ms.authSubtitle}>
                        Create your free account to invest {formatCurrencyWithDecimals(selectedAmount)} in {deal.projectName}
                      </Text>
                    </View>

                    <View style={ms.authForm}>
                      <View style={ms.authInputRow}>
                        <View style={[ms.authInput, { flex: 1 }]}>
                          <User size={15} color={Colors.textTertiary} />
                          <TextInput
                            style={ms.authInputText}
                            placeholder="First name"
                            placeholderTextColor={Colors.textTertiary}
                            value={authFirstName}
                            onChangeText={setAuthFirstName}
                            autoCapitalize="words"
                            testID="qb-first-name"
                          />
                        </View>
                        <View style={[ms.authInput, { flex: 1 }]}>
                          <User size={15} color={Colors.textTertiary} />
                          <TextInput
                            style={ms.authInputText}
                            placeholder="Last name"
                            placeholderTextColor={Colors.textTertiary}
                            value={authLastName}
                            onChangeText={setAuthLastName}
                            autoCapitalize="words"
                            testID="qb-last-name"
                          />
                        </View>
                      </View>

                      <View style={ms.authInput}>
                        <Mail size={15} color={Colors.textTertiary} />
                        <TextInput
                          style={ms.authInputText}
                          placeholder="Email address"
                          placeholderTextColor={Colors.textTertiary}
                          value={authEmail}
                          onChangeText={setAuthEmail}
                          keyboardType="email-address"
                          autoCapitalize="none"
                          autoCorrect={false}
                          testID="qb-email"
                        />
                      </View>

                      <View style={ms.authInput}>
                        <Phone size={15} color={Colors.textTertiary} />
                        <TextInput
                          style={ms.authInputText}
                          placeholder="Phone (optional)"
                          placeholderTextColor={Colors.textTertiary}
                          value={authPhone}
                          onChangeText={setAuthPhone}
                          keyboardType="phone-pad"
                          testID="qb-phone"
                        />
                      </View>

                      <View style={ms.authInput}>
                        <Lock size={15} color={Colors.textTertiary} />
                        <TextInput
                          style={ms.authInputText}
                          placeholder="Create password"
                          placeholderTextColor={Colors.textTertiary}
                          value={authPassword}
                          onChangeText={setAuthPassword}
                          secureTextEntry={!showPassword}
                          testID="qb-password"
                        />
                        <TouchableOpacity onPress={() => setShowPassword(p => !p)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                          {showPassword ? <EyeOff size={16} color={Colors.textTertiary} /> : <Eye size={16} color={Colors.textTertiary} />}
                        </TouchableOpacity>
                      </View>

                      <View style={ms.authInput}>
                        <Globe size={15} color={Colors.textTertiary} />
                        <TextInput
                          style={ms.authInputText}
                          placeholder="Country (e.g. US)"
                          placeholderTextColor={Colors.textTertiary}
                          value={authCountry}
                          onChangeText={setAuthCountry}
                          autoCapitalize="characters"
                          testID="qb-country"
                        />
                      </View>

                      {authError ? (
                        <View style={ms.authErrorRow}>
                          <AlertCircle size={13} color="#FF4444" />
                          <Text style={ms.authErrorText}>{authError}</Text>
                        </View>
                      ) : null}

                      <TouchableOpacity
                        style={[ms.ctaBtn, registerLoading && ms.ctaBtnDisabled]}
                        onPress={handleSignup}
                        disabled={registerLoading}
                        testID="qb-signup-btn"
                      >
                        {registerLoading ? (
                          <ShimmerIndicator size="small" color="#000" />
                        ) : (
                          <Shield size={16} color="#000" />
                        )}
                        <Text style={ms.ctaBtnText}>
                          {registerLoading ? 'Creating Account...' : 'Create Account & Invest'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={ms.switchAuthBtn}
                        onPress={() => { setAuthError(''); setStep('auth_login'); }}
                      >
                        <Text style={ms.switchAuthText}>
                          Already have an account? <Text style={ms.switchAuthLink}>Sign In</Text>
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <View style={ms.authTrustRow}>
                      <View style={ms.authTrustItem}>
                        <Shield size={12} color="#00C48C" />
                        <Text style={ms.authTrustText}>Bank-grade encryption</Text>
                      </View>
                      <View style={ms.authTrustItem}>
                        <Lock size={12} color="#4A90D9" />
                        <Text style={ms.authTrustText}>Escrow protected</Text>
                      </View>
                    </View>
                  </>
                )}

                {step === 'auth_login' && (
                  <>
                    <View style={ms.authHeader}>
                      <View style={ms.authBadge}>
                        <Lock size={12} color="#4A90D9" />
                        <Text style={[ms.authBadgeText, { color: '#4A90D9' }]}>SIGN IN TO INVEST</Text>
                      </View>
                      <Text style={ms.authSubtitle}>
                        Log in to invest {formatCurrencyWithDecimals(selectedAmount)} in {deal.projectName}
                      </Text>
                    </View>

                    <View style={ms.authForm}>
                      <View style={ms.authInput}>
                        <Mail size={15} color={Colors.textTertiary} />
                        <TextInput
                          style={ms.authInputText}
                          placeholder="Email address"
                          placeholderTextColor={Colors.textTertiary}
                          value={authEmail}
                          onChangeText={setAuthEmail}
                          keyboardType="email-address"
                          autoCapitalize="none"
                          autoCorrect={false}
                          testID="qb-login-email"
                        />
                      </View>

                      <View style={ms.authInput}>
                        <Lock size={15} color={Colors.textTertiary} />
                        <TextInput
                          style={ms.authInputText}
                          placeholder="Password"
                          placeholderTextColor={Colors.textTertiary}
                          value={authPassword}
                          onChangeText={setAuthPassword}
                          secureTextEntry={!showPassword}
                          testID="qb-login-password"
                        />
                        <TouchableOpacity onPress={() => setShowPassword(p => !p)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                          {showPassword ? <EyeOff size={16} color={Colors.textTertiary} /> : <Eye size={16} color={Colors.textTertiary} />}
                        </TouchableOpacity>
                      </View>

                      {authError ? (
                        <View style={ms.authErrorRow}>
                          <AlertCircle size={13} color="#FF4444" />
                          <Text style={ms.authErrorText}>{authError}</Text>
                        </View>
                      ) : null}

                      <TouchableOpacity
                        style={[ms.ctaBtn, loginLoading && ms.ctaBtnDisabled]}
                        onPress={handleLogin}
                        disabled={loginLoading}
                        testID="qb-login-btn"
                      >
                        {loginLoading ? (
                          <ShimmerIndicator size="small" color="#000" />
                        ) : (
                          <Lock size={16} color="#000" />
                        )}
                        <Text style={ms.ctaBtnText}>
                          {loginLoading ? 'Signing In...' : 'Sign In & Invest'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={ms.switchAuthBtn}
                        onPress={() => { setAuthError(''); setStep('auth'); }}
                      >
                        <Text style={ms.switchAuthText}>
                          New investor? <Text style={ms.switchAuthLink}>Create Account</Text>
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}

                {step === 'confirm' && (
                  <>
                    <View style={ms.confirmCard}>
                      <View style={ms.confirmRow}>
                        <Text style={ms.confirmLabel}>Investment Type</Text>
                        <Text style={ms.confirmValue}>{investType === 'jv' ? 'JV Direct' : 'Fractional'}</Text>
                      </View>
                      <View style={ms.confirmRow}>
                        <Text style={ms.confirmLabel}>Amount</Text>
                        <Text style={ms.confirmValueBold}>{formatCurrencyWithDecimals(selectedAmount)}</Text>
                      </View>
                      <View style={ms.confirmRow}>
                        <Text style={ms.confirmLabel}>Ownership</Text>
                        <Text style={ms.confirmValue}>{equityPercent.toFixed(2)}%</Text>
                      </View>
                      <View style={ms.confirmRow}>
                        <Text style={ms.confirmLabel}>Sale Price</Text>
                        <Text style={ms.confirmValue}>{formatCurrencyCompact(liveSalePrice)}</Text>
                      </View>
                      <View style={ms.confirmRow}>
                        <Text style={ms.confirmLabel}>Timeline</Text>
                        <Text style={ms.confirmValue}>{timelineLabel}</Text>
                      </View>
                      <View style={ms.confirmRow}>
                        <Text style={ms.confirmLabel}>Fractional Entry</Text>
                        <Text style={ms.confirmValue}>{formatCurrencyWithDecimals(liveFractionalPrice)}</Text>
                      </View>
                      <View style={ms.confirmRow}>
                        <Text style={ms.confirmLabel}>Expected ROI</Text>
                        <Text style={[ms.confirmValue, { color: '#00C48C' }]}>{deal.expectedROI}%</Text>
                      </View>
                      <View style={ms.confirmRow}>
                        <Text style={ms.confirmLabel}>Estimated Profit</Text>
                        <Text style={[ms.confirmValue, { color: '#00C48C' }]}>{formatCurrencyWithDecimals(estimatedReturn)}</Text>
                      </View>
                      <View style={ms.confirmRow}>
                        <Text style={ms.confirmLabel}>Estimated Total Payout</Text>
                        <Text style={[ms.confirmValue, { color: Colors.primary }]}>{formatCurrencyWithDecimals(selectedAmount + estimatedReturn)}</Text>
                      </View>
                      <View style={ms.confirmRow}>
                        <Text style={ms.confirmLabel}>Payment</Text>
                        <Text style={ms.confirmValue}>Bank Transfer (ACH)</Text>
                      </View>
                      <View style={ms.confirmDivider} />
                      <View style={ms.confirmRow}>
                        <Text style={ms.confirmLabelBold}>Total Due</Text>
                        <Text style={ms.confirmValueTotal}>{formatCurrencyWithDecimals(selectedAmount)}</Text>
                      </View>
                    </View>

                    {purchaseError && (
                      <View style={ms.errorBanner}>
                        <AlertCircle size={14} color="#FF4444" />
                        <Text style={ms.errorBannerText}>{purchaseError}</Text>
                      </View>
                    )}

                    <View style={ms.riskDisclaimer}>
                      <AlertCircle size={14} color="#FFB800" />
                      <Text style={ms.riskDisclaimerText}>All investments involve risk, including potential loss of principal. Projected returns are estimates and not guaranteed. This is not a solicitation or offer to sell securities.</Text>
                    </View>

                    <TouchableOpacity
                      style={ms.tosRow}
                      onPress={() => { setTosAccepted(prev => !prev); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                      activeOpacity={0.7}
                    >
                      <View style={[ms.tosCheckbox, tosAccepted && ms.tosCheckboxActive]}>
                        {tosAccepted && <CheckCircle size={16} color="#00C48C" />}
                      </View>
                      <Text style={ms.tosText}>I acknowledge the investment risks and agree to the terms of this offering.</Text>
                    </TouchableOpacity>

                    <View style={ms.securityRow}>
                      <Shield size={14} color={Colors.info} />
                      <Text style={ms.securityText}>Protected by escrow-secured funds</Text>
                    </View>

                    <TouchableOpacity
                      style={[ms.ctaBtn, !tosAccepted && ms.ctaBtnDisabled]}
                      onPress={handleConfirmPurchase}
                      disabled={!tosAccepted}
                      testID="quick-buy-confirm"
                    >
                      <Lock size={16} color="#000" />
                      <Text style={ms.ctaBtnText}>Confirm Purchase</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={ms.backBtn} onPress={() => setStep('select')}>
                      <Text style={ms.backBtnText}>Go Back</Text>
                    </TouchableOpacity>
                  </>
                )}

                {step === 'processing' && (
                  <View style={ms.processingWrap}>
                    <ShimmerIndicator size="large" color={Colors.primary} />
                    <Text style={ms.processingText}>Processing your investment...</Text>
                    <Text style={ms.processingSubtext}>Securing your position in {deal.projectName}</Text>
                  </View>
                )}

                {step === 'success' && (
                  <Animated.View style={[ms.successWrap, { transform: [{ scale: successScale }] }]}>
                    <View style={ms.successCircle}>
                      <CheckCircle size={48} color="#00C48C" />
                    </View>
                    <Text style={ms.successTitle}>Interest Recorded</Text>
                    <Text style={ms.successSubtext}>
                      Your interest in {deal.projectName} for {formatCurrencyWithDecimals(selectedAmount)} has been recorded. Full transactions are launching soon.
                    </Text>

                    <View style={ms.successNextSteps}>
                      <Text style={ms.successNextTitle}>WHAT HAPPENS NEXT</Text>
                      <View style={ms.successNextItem}>
                        <CheckCircle size={14} color="#00C48C" />
                        <Text style={ms.successNextText}>Our team will review your interest</Text>
                      </View>
                      <View style={ms.successNextItem}>
                        <Shield size={14} color="#4A90D9" />
                        <Text style={ms.successNextText}>You'll be contacted to discuss this opportunity</Text>
                      </View>
                      <View style={ms.successNextItem}>
                        <TrendingUp size={14} color="#FFD700" />
                        <Text style={ms.successNextText}>Full payment processing launching soon</Text>
                      </View>
                    </View>

                    <TouchableOpacity style={ms.ctaBtn} onPress={onClose}>
                      <Text style={ms.ctaBtnText}>Done</Text>
                    </TouchableOpacity>
                  </Animated.View>
                )}
              </ScrollView>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const ms = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end'},
  backdropTouch: {
    flex: 1},
  kavWrap: {
    justifyContent: 'flex-end'},
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 34,
    maxHeight: '92%'},
  scrollContent: {
    paddingBottom: 20},
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceBorder,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 14},
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16},
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1},
  headerBackBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  headerTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text},
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  dealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 16},
  dealThumb: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: Colors.backgroundSecondary},
  dealThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center'},
  dealInfo: {
    flex: 1},
  dealName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 3},
  dealAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginBottom: 4},
  dealAddress: {
    fontSize: 11,
    color: Colors.textTertiary,
    flex: 1},
  dealMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  dealInvestment: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text},
  dealRoiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#00C48C15',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6},
  dealRoi: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#00C48C'},
  typeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18},
  typeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.surfaceBorder},
  typeBtnActive: {
    borderColor: '#00C48C',
    backgroundColor: '#00C48C' + '0A'},
  typeBtnActiveFractional: {
    borderColor: '#FFD700',
    backgroundColor: '#FFD700' + '0A'},
  typeBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.textSecondary},
  typeBtnTextActive: {
    color: Colors.text},
  amountLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 10},
  amountsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12},
  amountChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    minWidth: '30%' as any,
    alignItems: 'center'},
  amountChipActive: {
    backgroundColor: Colors.primary + '18',
    borderColor: Colors.primary},
  amountChipText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.textSecondary},
  amountChipTextActive: {
    color: Colors.primary},
  customInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 14,
    height: 48,
    marginBottom: 16,
    gap: 4},
  customPrefix: {
    fontSize: 20,
    fontWeight: '300' as const,
    color: Colors.textTertiary},
  customInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text},
  marketValueNote: {
    marginBottom: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 14,
    paddingVertical: 12},
  marketValueNoteText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const},
  previewMarketStrip: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14},
  previewMarketPill: {
    flex: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  previewMarketLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginBottom: 6,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6},
  previewMarketValue: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: Colors.text},
  previewMarketValueUp: {
    color: '#00C48C'},
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 18},
  previewItem: {
    flex: 1,
    alignItems: 'center'},
  previewLabel: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontWeight: '600' as const,
    marginBottom: 4},
  previewValue: {
    fontSize: 14,
    fontWeight: '800' as const,
    color: Colors.text},
  previewDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.surfaceBorder},
  ownershipHint: {
    marginTop: -4,
    marginBottom: 18,
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center' as const},
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginBottom: 8},
  ctaBtnDisabled: {
    opacity: 0.4},
  ctaBtnText: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: '#000'},
  authNoteBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,215,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.2)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8},
  authNoteText: {
    fontSize: 12,
    color: '#C4A84D',
    fontWeight: '600' as const,
    flex: 1},
  fullFlowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10},
  fullFlowText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary},

  authHeader: {
    gap: 8,
    marginBottom: 16},
  authBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,215,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.25)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start' as const},
  authBadgeText: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: '#FFD700',
    letterSpacing: 1},
  authSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20},
  authForm: {
    gap: 12,
    marginBottom: 16},
  authInputRow: {
    flexDirection: 'row',
    gap: 10},
  authInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.surfaceBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50},
  authInputText: {
    flex: 1,
    color: Colors.text,
    fontSize: 15,
    height: 50},
  authErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2},
  authErrorText: {
    fontSize: 12,
    color: '#FF6B6B',
    fontWeight: '600' as const,
    flex: 1},
  switchAuthBtn: {
    alignItems: 'center',
    paddingVertical: 8},
  switchAuthText: {
    fontSize: 14,
    color: Colors.textSecondary},
  switchAuthLink: {
    color: Colors.primary,
    fontWeight: '700' as const},
  authTrustRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16},
  authTrustItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5},
  authTrustText: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '600' as const},

  confirmCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 14},
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8},
  confirmLabel: {
    fontSize: 14,
    color: Colors.textSecondary},
  confirmValue: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text},
  confirmValueBold: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.primary},
  confirmDivider: {
    height: 1,
    backgroundColor: Colors.surfaceBorder,
    marginVertical: 4},
  confirmLabelBold: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.text},
  confirmValueTotal: {
    fontSize: 20,
    fontWeight: '900' as const,
    color: Colors.primary},
  securityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    paddingHorizontal: 4},
  securityText: {
    fontSize: 13,
    color: Colors.textSecondary},
  riskDisclaimer: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
    backgroundColor: 'rgba(255,184,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,184,0,0.2)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12},
  riskDisclaimerText: {
    flex: 1,
    fontSize: 11,
    color: '#C4A84D',
    lineHeight: 16},
  tosRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginBottom: 12},
  tosCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 1},
  tosCheckboxActive: {
    borderColor: '#00C48C',
    backgroundColor: '#00C48C15'},
  tosText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19},
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#3D1515',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FF444430'},
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#FF6B6B',
    lineHeight: 18},
  backBtn: {
    alignItems: 'center',
    paddingVertical: 10},
  backBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  processingWrap: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 14},
  processingText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text},
  processingSubtext: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center' as const},
  successWrap: {
    alignItems: 'center',
    paddingVertical: 16},
  successCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#00C48C15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16},
  successTitle: {
    fontSize: 22,
    fontWeight: '900' as const,
    color: Colors.text,
    marginBottom: 6},
  successSubtext: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    marginBottom: 20,
    lineHeight: 20},
  successStats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 16,
    width: '100%'},
  successStatItem: {
    flex: 1,
    alignItems: 'center'},
  successStatValue: {
    fontSize: 14,
    fontWeight: '800' as const,
    color: Colors.text,
    marginBottom: 3},
  successStatLabel: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontWeight: '600' as const},
  successStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.surfaceBorder},
  successNextSteps: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 20,
    gap: 10},
  successNextTitle: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: Colors.textTertiary,
    letterSpacing: 1.2,
    marginBottom: 4},
  successNextItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  successNextText: {
    fontSize: 13,
    color: Colors.textSecondary,
    flex: 1}});
