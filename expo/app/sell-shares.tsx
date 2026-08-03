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
  TouchableWithoutFeedback} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ArrowLeft,
  Minus,
  Plus,
  CheckCircle,
  AlertCircle,
  Tag,
  Wallet,
  TrendingUp,
  TrendingDown,
  Clock,
  ShoppingCart,
  Shield,
  Info} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { formatCurrencyWithDecimals, formatNumber } from '@/lib/formatters';
import { useProperty } from '@/lib/data-hooks';
import { sellShares } from '@/lib/investment-service';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { HoldingRow } from '@/types/database';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type SellMode = 'instant' | 'resale';

export default function SellSharesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { propertyId, holdingId: _holdingId } = useLocalSearchParams<{ propertyId: string; holdingId?: string }>();

  const { property } = useProperty(propertyId || '');

  const holdingQuery = useQuery({
    queryKey: ['user-holding', propertyId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !propertyId) return null;
      const { data } = await supabase
        .from('holdings')
        .select('*')
        .eq('user_id', user.id)
        .eq('property_id', propertyId)
        .single();
      return data as unknown as HoldingRow | null;
    },
    enabled: !!propertyId});

  const holding = holdingQuery.data;
  const ownedShares = holding?.shares ?? 0;
  const avgCostBasis = holding?.avg_cost_basis ?? 0;

  const [sellMode, setSellMode] = useState<SellMode>('instant');
  const [sharesInput, setSharesInput] = useState('');
  const [askPriceInput, setAskPriceInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [step, setStep] = useState<'amount' | 'review' | 'success'>('amount');
  const [confirmationNumber, setConfirmationNumber] = useState('');
  const [resultMessage, setResultMessage] = useState('');

  const successAnim = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0)).current;

  const shares = useMemo(() => Math.max(0, parseInt(sharesInput, 10) || 0), [sharesInput]);
  const currentPrice = property?.pricePerShare ?? 0;
  const askPrice = sellMode === 'resale' ? (parseFloat(askPriceInput) || currentPrice) : currentPrice;
  const subtotal = shares * askPrice;
  const platformFee = subtotal * 0.01;
  const netProceeds = subtotal - platformFee;
  const costBasis = shares * avgCostBasis;
  const profitLoss = netProceeds - costBasis;
  const profitLossPercent = costBasis > 0 ? (profitLoss / costBasis) * 100 : 0;
  const canSell = shares >= 1 && shares <= ownedShares;

  const adjustShares = useCallback((delta: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSharesInput(prev => {
      const current = parseInt(prev, 10) || 0;
      return String(Math.max(1, Math.min(ownedShares, current + delta)));
    });
  }, [ownedShares]);

  const handleContinueToReview = useCallback(() => {
    if (!canSell) {
      Alert.alert('Invalid Amount', `You can sell between 1 and ${formatNumber(ownedShares)} shares.`);
      return;
    }
    if (sellMode === 'resale' && askPrice <= 0) {
      Alert.alert('Invalid Price', 'Please enter a valid ask price.');
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStep('review');
  }, [canSell, ownedShares, sellMode, askPrice]);

  const handleConfirmSell = useCallback(async () => {
    if (!property || !holding) return;

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsProcessing(true);

    try {
      console.log('[SellShares] Submitting sell to Supabase...');
      const result = await sellShares({
        holdingId: holding.id,
        propertyId: property.id,
        propertyName: property.name,
        shares,
        pricePerShare: askPrice,
        subtotal,
        platformFee,
        netProceeds,
        sellType: sellMode === 'resale' ? 'resale_listing' : 'instant',
        askPrice: sellMode === 'resale' ? askPrice : undefined});

      if (result.success) {
        console.log('[SellShares] Success:', result.confirmationNumber);
        setConfirmationNumber(result.confirmationNumber);
        setResultMessage(result.message);
        setStep('success');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        void queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
        void queryClient.invalidateQueries({ queryKey: ['holdings'] });
        void queryClient.invalidateQueries({ queryKey: ['portfolio'] });
        void queryClient.invalidateQueries({ queryKey: ['transactions'] });
        void queryClient.invalidateQueries({ queryKey: ['properties'] });
        void queryClient.invalidateQueries({ queryKey: ['resale-listings'] });
        void queryClient.invalidateQueries({ queryKey: ['user-holding'] });
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });

        Animated.sequence([
          Animated.timing(successAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.spring(checkScale, { toValue: 1, friction: 4, tension: 50, useNativeDriver: true }),
        ]).start();
      } else {
        console.error('[SellShares] Failed:', result.error, result.message);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Sale Failed', result.message);
      }
    } catch (error) {
      console.error('[SellShares] Unexpected error:', error);
      const msg = error instanceof Error ? error.message : 'Something went wrong.';
      Alert.alert('Error', msg);
    } finally {
      setIsProcessing(false);
    }
  }, [property, holding, shares, askPrice, subtotal, platformFee, netProceeds, sellMode, successAnim, checkScale, queryClient]);

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

  if (holdingQuery.isLoading) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.errorWrap}>
          <ShimmerIndicator size="large" color={Colors.primary} />
          <Text style={[styles.errorText, { marginTop: 16 }]}>Loading your holdings...</Text>
        </View>
      </View>
    );
  }

  if (!holding || ownedShares === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.errorWrap}>
          <AlertCircle size={48} color={Colors.textTertiary} />
          <Text style={[styles.errorText, { marginTop: 12 }]}>You don't own shares in this property</Text>
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
              <CheckCircle size={64} color={sellMode === 'resale' ? Colors.primary : Colors.success} />
            </View>
          </Animated.View>
          <Animated.View style={{ opacity: successAnim }}>
            <Text style={styles.successTitle}>
              {sellMode === 'resale' ? 'Listed for Resale!' : 'Shares Sold!'}
            </Text>
            <Text style={styles.successSubtitle}>{resultMessage}</Text>

            <View style={styles.successCard}>
              <View style={styles.successRow}>
                <Text style={styles.successLabel}>Shares</Text>
                <Text style={styles.successValue}>{formatNumber(shares)}</Text>
              </View>
              {sellMode === 'instant' ? (
                <>
                  <View style={styles.successRow}>
                    <Text style={styles.successLabel}>Net Proceeds</Text>
                    <Text style={styles.successValueGold}>{formatCurrencyWithDecimals(netProceeds)}</Text>
                  </View>
                  <View style={styles.successRow}>
                    <Text style={styles.successLabel}>P&L</Text>
                    <Text style={[styles.successValue, { color: profitLoss >= 0 ? Colors.success : Colors.error }]}>
                      {profitLoss >= 0 ? '+' : ''}{formatCurrencyWithDecimals(profitLoss)} ({profitLossPercent.toFixed(2)}%)
                    </Text>
                  </View>
                </>
              ) : (
                <View style={styles.successRow}>
                  <Text style={styles.successLabel}>Ask Price</Text>
                  <Text style={styles.successValueGold}>{formatCurrencyWithDecimals(askPrice)}/share</Text>
                </View>
              )}
              <View style={styles.successRow}>
                <Text style={styles.successLabel}>Confirmation</Text>
                <Text style={styles.successValue}>{confirmationNumber}</Text>
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
          {step === 'amount' ? 'Sell Shares' : 'Review Sale'}
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
            <View style={styles.holdingBanner}>
              <View style={styles.holdingBannerInfo}>
                <Text style={styles.holdingBannerName} numberOfLines={1}>{property.name}</Text>
                <Text style={styles.holdingBannerLocation}>{property.city}, {property.country}</Text>
                <View style={styles.holdingStatsRow}>
                  <View style={styles.holdingStat}>
                    <Text style={styles.holdingStatLabel}>Owned</Text>
                    <Text style={styles.holdingStatValue}>{formatNumber(ownedShares)} shares</Text>
                  </View>
                  <View style={styles.holdingStatDivider} />
                  <View style={styles.holdingStat}>
                    <Text style={styles.holdingStatLabel}>Avg Cost</Text>
                    <Text style={styles.holdingStatValue}>{formatCurrencyWithDecimals(avgCostBasis)}</Text>
                  </View>
                  <View style={styles.holdingStatDivider} />
                  <View style={styles.holdingStat}>
                    <Text style={styles.holdingStatLabel}>Current</Text>
                    <Text style={[styles.holdingStatValue, { color: currentPrice >= avgCostBasis ? Colors.success : Colors.error }]}>
                      {formatCurrencyWithDecimals(currentPrice)}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {step === 'amount' && (
              <>
                <View style={styles.modeSection}>
                  <Text style={styles.sectionLabel}>How to Sell</Text>
                  <View style={styles.modeRow}>
                    <TouchableOpacity
                      style={[styles.modeCard, sellMode === 'instant' && styles.modeCardActive]}
                      onPress={() => { setSellMode('instant'); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                    >
                      <Wallet size={22} color={sellMode === 'instant' ? Colors.success : Colors.textTertiary} />
                      <Text style={[styles.modeTitle, sellMode === 'instant' && styles.modeTitleActive]}>Instant Sell</Text>
                      <Text style={styles.modeDesc}>Sell now at market price. Proceeds go to your wallet instantly.</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modeCard, sellMode === 'resale' && styles.modeCardActiveResale]}
                      onPress={() => { setSellMode('resale'); setAskPriceInput(currentPrice.toFixed(2)); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                    >
                      <Tag size={22} color={sellMode === 'resale' ? Colors.primary : Colors.textTertiary} />
                      <Text style={[styles.modeTitle, sellMode === 'resale' && styles.modeTitleActiveResale]}>List for Resale</Text>
                      <Text style={styles.modeDesc}>Set your own ask price. Other investors can buy from you.</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.amountSection}>
                  <Text style={styles.sectionLabel}>Shares to {sellMode === 'resale' ? 'List' : 'Sell'}</Text>
                  <View style={styles.amountRow}>
                    <TouchableOpacity style={styles.amountBtn} onPress={() => adjustShares(-10)}>
                      <Minus size={20} color={Colors.text} />
                    </TouchableOpacity>
                    <View style={styles.amountInputWrap}>
                      <TextInput
                        style={styles.amountInput}
                        value={sharesInput}
                        onChangeText={setSharesInput}
                        keyboardType="numeric"
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                        placeholder="0"
                        placeholderTextColor={Colors.textTertiary}
                      />
                      <Text style={styles.amountInputLabel}>/ {formatNumber(ownedShares)}</Text>
                    </View>
                    <TouchableOpacity style={styles.amountBtn} onPress={() => adjustShares(10)}>
                      <Plus size={20} color={Colors.text} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.quickPickSection}>
                  {[
                    { label: '25%', val: Math.floor(ownedShares * 0.25) },
                    { label: '50%', val: Math.floor(ownedShares * 0.5) },
                    { label: '75%', val: Math.floor(ownedShares * 0.75) },
                    { label: 'All', val: ownedShares },
                  ].map(opt => (
                    <TouchableOpacity
                      key={opt.label}
                      style={[styles.quickPickBtn, shares === opt.val && opt.val > 0 && styles.quickPickBtnActive]}
                      onPress={() => { Keyboard.dismiss(); setSharesInput(String(opt.val)); }}
                    >
                      <Text style={[styles.quickPickText, shares === opt.val && opt.val > 0 && styles.quickPickTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {sellMode === 'resale' && (
                  <View style={styles.askPriceSection}>
                    <Text style={styles.sectionLabel}>Your Ask Price (per share)</Text>
                    <View style={styles.askPriceInputWrap}>
                      <Text style={styles.askPricePrefix}>$</Text>
                      <TextInput
                        style={styles.askPriceInput}
                        value={askPriceInput}
                        onChangeText={setAskPriceInput}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        placeholder={currentPrice.toFixed(2)}
                        placeholderTextColor={Colors.textTertiary}
                      />
                    </View>
                    <View style={styles.askPriceHints}>
                      <View style={styles.askPriceHint}>
                        <Text style={styles.askPriceHintLabel}>Market Price</Text>
                        <Text style={styles.askPriceHintValue}>{formatCurrencyWithDecimals(currentPrice)}</Text>
                      </View>
                      <View style={styles.askPriceHint}>
                        <Text style={styles.askPriceHintLabel}>Your Cost</Text>
                        <Text style={styles.askPriceHintValue}>{formatCurrencyWithDecimals(avgCostBasis)}</Text>
                      </View>
                      {askPrice > 0 && (
                        <View style={styles.askPriceHint}>
                          <Text style={styles.askPriceHintLabel}>vs Market</Text>
                          <Text style={[styles.askPriceHintValue, { color: askPrice >= currentPrice ? Colors.success : Colors.error }]}>
                            {askPrice >= currentPrice ? '+' : ''}{((askPrice - currentPrice) / currentPrice * 100).toFixed(1)}%
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                )}

                <View style={styles.costBreakdown}>
                  <View style={styles.costRow}>
                    <Text style={styles.costLabel}>{formatNumber(shares)} shares x {formatCurrencyWithDecimals(askPrice)}</Text>
                    <Text style={styles.costValue}>{formatCurrencyWithDecimals(subtotal)}</Text>
                  </View>
                  <View style={styles.costRow}>
                    <Text style={styles.costLabel}>Platform fee (1%)</Text>
                    <Text style={[styles.costValue, { color: Colors.error }]}>-{formatCurrencyWithDecimals(platformFee)}</Text>
                  </View>
                  <View style={styles.costDivider} />
                  <View style={styles.costRow}>
                    <Text style={styles.costLabelBold}>
                      {sellMode === 'resale' ? 'You Receive (if sold)' : 'Net Proceeds'}
                    </Text>
                    <Text style={styles.costValueBold}>{formatCurrencyWithDecimals(netProceeds)}</Text>
                  </View>
                </View>

                {shares > 0 && (
                  <View style={[styles.plCard, { borderColor: profitLoss >= 0 ? Colors.success + '30' : Colors.error + '30' }]}>
                    <View style={styles.plIcon}>
                      {profitLoss >= 0 ? (
                        <TrendingUp size={18} color={Colors.success} />
                      ) : (
                        <TrendingDown size={18} color={Colors.error} />
                      )}
                    </View>
                    <View style={styles.plInfo}>
                      <Text style={styles.plTitle}>{profitLoss >= 0 ? 'Estimated Profit' : 'Estimated Loss'}</Text>
                      <Text style={[styles.plValue, { color: profitLoss >= 0 ? Colors.success : Colors.error }]}>
                        {profitLoss >= 0 ? '+' : ''}{formatCurrencyWithDecimals(profitLoss)} ({profitLossPercent.toFixed(2)}%)
                      </Text>
                    </View>
                  </View>
                )}

                {sellMode === 'resale' && (
                  <View style={styles.infoCard}>
                    <View style={styles.infoRow}>
                      <ShoppingCart size={16} color={Colors.primary} />
                      <Text style={styles.infoText}>Your shares will be listed on the IVXHOLDINGS marketplace for other investors to purchase</Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Clock size={16} color={Colors.warning} />
                      <Text style={styles.infoText}>Listings expire after 30 days. You can cancel anytime before a buyer is found</Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Shield size={16} color={Colors.success} />
                      <Text style={styles.infoText}>Your shares remain in your portfolio until sold. No lock-up required</Text>
                    </View>
                  </View>
                )}
              </>
            )}

            {step === 'review' && (
              <>
                <View style={styles.orderSummary}>
                  <Text style={styles.sectionLabel}>
                    {sellMode === 'resale' ? 'Resale Listing Summary' : 'Sale Summary'}
                  </Text>
                  <View style={styles.orderCard}>
                    <View style={styles.orderRow}>
                      <Text style={styles.orderLabel}>Property</Text>
                      <Text style={styles.orderValue} numberOfLines={1}>{property.name}</Text>
                    </View>
                    <View style={styles.orderRow}>
                      <Text style={styles.orderLabel}>Type</Text>
                      <View style={[styles.typeBadge, { backgroundColor: sellMode === 'resale' ? Colors.primary + '20' : Colors.success + '20' }]}>
                        <Text style={[styles.typeBadgeText, { color: sellMode === 'resale' ? Colors.primary : Colors.success }]}>
                          {sellMode === 'resale' ? 'Resale Listing' : 'Instant Sell'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.orderRow}>
                      <Text style={styles.orderLabel}>Shares</Text>
                      <Text style={styles.orderValue}>{formatNumber(shares)}</Text>
                    </View>
                    <View style={styles.orderRow}>
                      <Text style={styles.orderLabel}>Price/Share</Text>
                      <Text style={styles.orderValue}>{formatCurrencyWithDecimals(askPrice)}</Text>
                    </View>
                    <View style={styles.orderRow}>
                      <Text style={styles.orderLabel}>Subtotal</Text>
                      <Text style={styles.orderValue}>{formatCurrencyWithDecimals(subtotal)}</Text>
                    </View>
                    <View style={styles.orderRow}>
                      <Text style={[styles.orderLabel, { color: Colors.error }]}>Platform Fee (1%)</Text>
                      <Text style={[styles.orderValue, { color: Colors.error }]}>-{formatCurrencyWithDecimals(platformFee)}</Text>
                    </View>
                    <View style={styles.orderDivider} />
                    <View style={styles.orderRow}>
                      <Text style={styles.orderLabelBold}>
                        {sellMode === 'resale' ? 'You Receive (if sold)' : 'Net Proceeds'}
                      </Text>
                      <Text style={styles.orderValueBold}>{formatCurrencyWithDecimals(netProceeds)}</Text>
                    </View>
                    {costBasis > 0 && (
                      <View style={styles.orderRow}>
                        <Text style={styles.orderLabel}>P&L</Text>
                        <Text style={[styles.orderValue, { color: profitLoss >= 0 ? Colors.success : Colors.error, fontWeight: '700' as const }]}>
                          {profitLoss >= 0 ? '+' : ''}{formatCurrencyWithDecimals(profitLoss)} ({profitLossPercent.toFixed(2)}%)
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {sellMode === 'resale' && (
                  <View style={styles.resaleNote}>
                    <Info size={14} color={Colors.primary} />
                    <Text style={styles.resaleNoteText}>
                      Your shares will be listed on the marketplace. You'll receive funds when another investor buys them. You can cancel anytime.
                    </Text>
                  </View>
                )}

                <View style={styles.disclaimerSection}>
                  <AlertCircle size={14} color={Colors.warning} />
                  <Text style={styles.disclaimerText}>
                    By confirming, you acknowledge that you are solely responsible for applicable taxes including capital gains. Past performance does not guarantee future results.
                  </Text>
                </View>
              </>
            )}

            <View style={{ height: 140 }} />
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        {step === 'amount' ? (
          <TouchableOpacity
            style={[styles.ctaButton, !canSell && styles.ctaButtonDisabled, sellMode === 'resale' ? styles.ctaButtonResale : styles.ctaButtonSell]}
            onPress={handleContinueToReview}
            disabled={!canSell}
          >
            <Text style={styles.ctaButtonText}>
              {sellMode === 'resale'
                ? `List for Resale \u2014 ${formatCurrencyWithDecimals(subtotal)}`
                : `Sell \u2014 ${formatCurrencyWithDecimals(netProceeds)}`}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[
              styles.ctaButton,
              isProcessing && styles.ctaButtonProcessing,
              sellMode === 'resale' ? styles.ctaButtonResale : styles.ctaButtonSell,
            ]}
            onPress={handleConfirmSell}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <View style={styles.processingRow}>
                <ShimmerIndicator size="small" color={Colors.black} />
                <Text style={styles.ctaButtonText}>Processing...</Text>
              </View>
            ) : (
              <Text style={styles.ctaButtonText}>
                {sellMode === 'resale' ? 'Confirm Listing' : 'Confirm Sale'}
              </Text>
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
  holdingBanner: {
    margin: 16,
    padding: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  holdingBannerInfo: {},
  holdingBannerName: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 2},
  holdingBannerLocation: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 14},
  holdingStatsRow: {
    flexDirection: 'row',
    alignItems: 'center'},
  holdingStat: {
    flex: 1,
    alignItems: 'center'},
  holdingStatLabel: {
    fontSize: 10,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 3},
  holdingStatValue: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text},
  holdingStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.surfaceBorder,
    marginHorizontal: 8},
  modeSection: {
    marginHorizontal: 16,
    marginBottom: 16},
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    marginBottom: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  modeRow: {
    flexDirection: 'row',
    gap: 10},
  modeCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: Colors.surfaceBorder,
    gap: 6},
  modeCardActive: {
    borderColor: Colors.success,
    backgroundColor: Colors.success + '08'},
  modeCardActiveResale: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08'},
  modeTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.textSecondary},
  modeTitleActive: {
    color: Colors.success},
  modeTitleActiveResale: {
    color: Colors.primary},
  modeDesc: {
    fontSize: 11,
    color: Colors.textTertiary,
    lineHeight: 16},
  amountSection: {
    marginHorizontal: 16,
    marginBottom: 10},
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
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 16},
  quickPickBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center'},
  quickPickBtnActive: {
    backgroundColor: Colors.primary + '20',
    borderColor: Colors.primary},
  quickPickText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  quickPickTextActive: {
    color: Colors.primary},
  askPriceSection: {
    marginHorizontal: 16,
    marginBottom: 16},
  askPriceInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    paddingHorizontal: 16,
    height: 56,
    marginBottom: 10},
  askPricePrefix: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.primary,
    marginRight: 6},
  askPriceInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: '800' as const,
    color: Colors.text},
  askPriceHints: {
    flexDirection: 'row',
    gap: 10},
  askPriceHint: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  askPriceHintLabel: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginBottom: 3},
  askPriceHintValue: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text},
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
    fontSize: 15,
    color: Colors.text,
    fontWeight: '800' as const},
  costValueBold: {
    fontSize: 18,
    color: Colors.primary,
    fontWeight: '800' as const},
  plCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12},
  plIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center'},
  plInfo: {
    flex: 1},
  plTitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 2},
  plValue: {
    fontSize: 18,
    fontWeight: '800' as const},
  infoCard: {
    marginHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
    gap: 12},
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10},
  infoText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18},
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
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8},
  typeBadgeText: {
    fontSize: 12,
    fontWeight: '700' as const},
  resaleNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 16,
    marginBottom: 12,
    gap: 8,
    backgroundColor: Colors.primary + '10',
    borderRadius: 12,
    padding: 12},
  resaleNoteText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18},
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
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center'},
  ctaButtonSell: {
    backgroundColor: Colors.error},
  ctaButtonResale: {
    backgroundColor: Colors.primary},
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
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 20},
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
    color: Colors.textSecondary},
  backBtn: {
    marginTop: 16,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10},
  backBtnText: {
    color: Colors.black,
    fontWeight: '700' as const}});
