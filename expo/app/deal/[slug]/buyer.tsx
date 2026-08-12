/**
 * IVX Buyer Offer Page
 *
 * Route: /deal/[slug]/buyer
 *
 * Buyer offer flow:
 * OFFER → OWNER REVIEW → COUNTER/ACCEPT/REJECT → AGREEMENT →
 * EARNEST MONEY REQUEST → CARD OR ACH DEPOSIT → PAYMENT CONFIRMATION → UNDER CONTRACT
 *
 * Does NOT charge full property sale price through card flow.
 * Supports: application fee, earnest money deposit, reservation deposit.
 */

import React, { useState, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ArrowLeft,
  DollarSign,
  Home,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Calendar,
  Shield,
  Building2,
  User} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { submitBuyerOffer } from '@/lib/payment-api-client';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { DIRECT_API_BASE_URL } from '@/lib/public-api';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { RefreshControl } from 'react-native';

interface DealData {
  id: string;
  title: string;
  buyer_enabled: boolean;
  buyer_status: string;
  buyer_asking_price: number;
  buyer_minimum_offer: number;
  allow_below_asking: boolean;
  allow_above_asking: boolean;
  earnest_money_required: boolean;
  proof_of_funds_required: boolean;
  financing_allowed: boolean;
  cash_only: boolean;
  inspection_period_days: number;
  closing_target_days: number;
  offer_expiration_days: number;
  city: string;
  state: string;
}

type BuyerStep = 'form' | 'submitting' | 'submitted' | 'failed';

export default function BuyerOfferPage() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [offerAmount, setOfferAmount] = useState<string>('');
  const [financingType, setFinancingType] = useState<'cash' | 'financing'>('cash');
  const [downPayment, setDownPayment] = useState<string>('');
  const [proofOfFundsUrl, setProofOfFundsUrl] = useState<string>('');
  const [preapprovalUrl, setPreapprovalUrl] = useState<string>('');
  const [earnestMoney, setEarnestMoney] = useState<string>('');
  const [inspectionDays, setInspectionDays] = useState<string>('15');
  const [closingDate, setClosingDate] = useState<string>('');
  const [contingencies, setContingencies] = useState<string>('');
  const [brokerName, setBrokerName] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [step, setStep] = useState<BuyerStep>('form');
  const [error, setError] = useState<string | null>(null);

  const { data: dealData, isLoading } = useQuery<DealData>({
    queryKey: ['deal-buyer', slug],
    queryFn: async () => {
      const url = DIRECT_API_BASE_URL || 'https://api.ivxholding.com';
      const res = await fetch(`${url}/api/ivx/deals/${slug}/pathways`);
      const data = await res.json();
      return data.deal as DealData;
    },
    enabled: !!slug});

  const askingPrice = dealData?.buyer_asking_price || 0;
  const minOffer = dealData?.buyer_minimum_offer || 0;
  const offerNum = parseFloat(offerAmount.replace(/[^0-9.]/g, '')) || 0;
  const offerCents = Math.round(offerNum * 100);
  const earnestNum = parseFloat(earnestMoney.replace(/[^0-9.]/g, '')) || 0;
  const downPaymentNum = parseFloat(downPayment.replace(/[^0-9.]/g, '')) || 0;

  let offerType = 'FULL_PRICE_OFFER';
  if (askingPrice > 0) {
    if (offerNum < askingPrice) offerType = 'BELOW_ASKING_OFFER';
    else if (offerNum > askingPrice) offerType = 'ABOVE_ASKING_OFFER';
  }

  const canSubmit = dealData?.buyer_enabled
    && dealData?.buyer_status === 'BUYER_OPEN'
    && offerNum > 0
    && (offerNum >= minOffer || minOffer === 0)
    && (dealData.allow_below_asking || offerNum >= askingPrice)
    && acceptedTerms
    && (!dealData.proof_of_funds_required || !!proofOfFundsUrl.trim())
    && (financingType === 'cash' || !dealData.cash_only)
    && step === 'form';

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !user || !dealData) return;
    setStep('submitting');
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const result = await submitBuyerOffer({
        dealId: dealData.id,
        offerAmountCents: offerCents,
        financingType,
        downPaymentCents: Math.round(downPaymentNum * 100),
        proofOfFundsUrl: proofOfFundsUrl.trim(),
        preapprovalUrl: preapprovalUrl.trim(),
        earnestMoneyCents: Math.round(earnestNum * 100),
        inspectionPeriodDays: parseInt(inspectionDays) || 15,
        closingDate: closingDate.trim(),
        contingencies: contingencies.trim(),
        brokerName: brokerName.trim(),
        offerExpirationDays: dealData.offer_expiration_days || 7,
        message: message.trim(),
        acceptedTerms: true});

      if (result.ok) {
        setStep('submitted');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setStep('failed');
        setError(result.error || result.code || 'Submission failed');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (err: any) {
      setStep('failed');
      setError(err.message || 'Network error');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [canSubmit, user, dealData, offerCents, financingType, downPaymentNum, proofOfFundsUrl, preapprovalUrl, earnestNum, inspectionDays, closingDate, contingencies, brokerName, message]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ShimmerIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading deal...</Text>
      </View>
    );
  }

  if (!dealData?.buyer_enabled || dealData?.buyer_status !== 'BUYER_OPEN') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft color={Colors.text} size={24} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Buyer Offer</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.unavailableContainer}>
          <AlertCircle color={Colors.warning} size={48} />
          <Text style={styles.unavailableTitle}>Buyer Offers Not Available</Text>
          <Text style={styles.unavailableText}>
            Buyer offers are {(dealData?.buyer_status || 'not available').toLowerCase().replace('buyer_', '')} for this property.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'submitted') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScrollView contentContainerStyle={styles.successContainer}>
          <View style={styles.successIconWrap}>
            <CheckCircle2 color={Colors.success} size={64} />
          </View>
          <Text style={styles.successTitle}>Offer Submitted!</Text>
          <Text style={styles.successSubtitle}>
            Your offer of ${offerNum.toLocaleString()} for {dealData.title} has been submitted for owner review.
          </Text>
          <View style={styles.successCard}>
            <View style={styles.successRow}>
              <Text style={styles.successLabel}>Property</Text>
              <Text style={styles.successValue}>{dealData.title}</Text>
            </View>
            <View style={styles.successRow}>
              <Text style={styles.successLabel}>Offer Amount</Text>
              <Text style={styles.successValue}>${offerNum.toLocaleString()}</Text>
            </View>
            <View style={styles.successRow}>
              <Text style={styles.successLabel}>Offer Type</Text>
              <Text style={styles.successValue}>{offerType.replace(/_/g, ' ')}</Text>
            </View>
            <View style={styles.successRow}>
              <Text style={styles.successLabel}>Financing</Text>
              <Text style={styles.successValue}>{financingType === 'cash' ? 'Cash' : 'Financing'}</Text>
            </View>
            <View style={styles.successDivider} />
            <View style={styles.successRow}>
              <Text style={styles.successStatus}>Status: OFFER — Pending Owner Review</Text>
            </View>
          </View>
          <View style={styles.processFlow}>
            <Text style={styles.processTitle}>What happens next?</Text>
            <Text style={styles.processStep}>1. Owner reviews your offer</Text>
            <Text style={styles.processStep}>2. Owner accepts, counters, or rejects</Text>
            <Text style={styles.processStep}>3. If accepted: agreement + earnest money deposit</Text>
            <Text style={styles.processStep}>4. Inspection period begins</Text>
            <Text style={styles.processStep}>5. Closing process</Text>
          </View>
          <TouchableOpacity style={styles.successButton} onPress={() => router.back()}>
            <Text style={styles.successButtonText}>Back to Property</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (step === 'submitting') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.processingContainer}>
          <Loader2 color={Colors.primary} size={56} />
          <Text style={styles.processingTitle}>Submitting Offer...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'failed') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.failedContainer}>
          <AlertCircle color={Colors.error} size={56} />
          <Text style={styles.failedTitle}>Submission Failed</Text>
          <Text style={styles.failedSubtitle}>{error || 'Please try again.'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => { setStep('form'); setError(null); }}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft color={Colors.text} size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Make an Offer</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Property info */}
          <View style={styles.dealCard}>
            <Text style={styles.dealTitle}>{dealData.title}</Text>
            <Text style={styles.dealLocation}>{[dealData.city, dealData.state].filter(Boolean).join(', ')}</Text>
            <View style={styles.askingPriceBox}>
              <Text style={styles.askingPriceLabel}>Asking Price</Text>
              <Text style={styles.askingPriceValue}>${askingPrice.toLocaleString()}</Text>
            </View>
            {minOffer > 0 && (
              <Text style={styles.minOfferText}>Minimum offer: ${minOffer.toLocaleString()}</Text>
            )}
          </View>

          {/* Offer amount */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Your Offer</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Offer Amount (USD) *</Text>
              <View style={styles.amountInputWrap}>
                <DollarSign color={Colors.textSecondary} size={20} />
                <TextInput
                  style={styles.amountInput}
                  value={offerAmount}
                  onChangeText={setOfferAmount}
                  placeholder={askingPrice > 0 ? askingPrice.toString() : '0'}
                  placeholderTextColor="#555"
                  keyboardType="numeric"
                />
              </View>
              {offerNum > 0 && askingPrice > 0 && (
                <Text style={[styles.offerTypeBadge, offerType === 'BELOW_ASKING_OFFER' && !dealData.allow_below_asking && styles.offerTypeRejected]}>
                  {offerType === 'BELOW_ASKING_OFFER' ? '↓ Below Asking' : offerType === 'ABOVE_ASKING_OFFER' ? '↑ Above Asking' : '= Full Price'}
                  {offerType === 'BELOW_ASKING_OFFER' && !dealData.allow_below_asking && ' — NOT ACCEPTED'}
                </Text>
              )}
            </View>

            {/* Financing type */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Financing Type</Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, financingType === 'cash' && styles.chipActive]}
                  onPress={() => { setFinancingType('cash'); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                >
                  <Text style={[styles.chipText, financingType === 'cash' && styles.chipTextActive]}>Cash</Text>
                </TouchableOpacity>
                {!dealData.cash_only && (
                  <TouchableOpacity
                    style={[styles.chip, financingType === 'financing' && styles.chipActive]}
                    onPress={() => { setFinancingType('financing'); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  >
                    <Text style={[styles.chipText, financingType === 'financing' && styles.chipTextActive]}>Financing</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Down payment (if financing) */}
            {financingType === 'financing' && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Down Payment (USD)</Text>
                <View style={styles.amountInputWrap}>
                  <DollarSign color={Colors.textSecondary} size={20} />
                  <TextInput
                    style={styles.amountInput}
                    value={downPayment}
                    onChangeText={setDownPayment}
                    placeholder="0"
                    placeholderTextColor="#555"
                    keyboardType="numeric"
                  />
                </View>
              </View>
            )}
          </View>

          {/* Documentation */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Documentation</Text>

            {dealData.proof_of_funds_required && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Proof of Funds URL *</Text>
                <TextInput
                  style={styles.textInput}
                  value={proofOfFundsUrl}
                  onChangeText={setProofOfFundsUrl}
                  placeholder="https://... (bank statement or POF letter)"
                  placeholderTextColor="#555"
                  keyboardType="url"
                  autoCapitalize="none"
                />
              </View>
            )}

            {financingType === 'financing' && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Pre-Approval Letter URL</Text>
                <TextInput
                  style={styles.textInput}
                  value={preapprovalUrl}
                  onChangeText={setPreapprovalUrl}
                  placeholder="https://... (lender pre-approval)"
                  placeholderTextColor="#555"
                  keyboardType="url"
                  autoCapitalize="none"
                />
              </View>
            )}

            {dealData.earnest_money_required && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Earnest Money Deposit (USD)</Text>
                <View style={styles.amountInputWrap}>
                  <DollarSign color={Colors.textSecondary} size={20} />
                  <TextInput
                    style={styles.amountInput}
                    value={earnestMoney}
                    onChangeText={setEarnestMoney}
                    placeholder="e.g. 5000"
                    placeholderTextColor="#555"
                    keyboardType="numeric"
                  />
                </View>
                <Text style={styles.inputHint}>Deposit due after offer acceptance</Text>
              </View>
            )}
          </View>

          {/* Terms */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Offer Terms</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Inspection Period (days)</Text>
              <TextInput
                style={styles.textInput}
                value={inspectionDays}
                onChangeText={setInspectionDays}
                placeholder={String(dealData.inspection_period_days || 15)}
                placeholderTextColor="#555"
                keyboardType="numeric"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Target Closing Date</Text>
              <TextInput
                style={styles.textInput}
                value={closingDate}
                onChangeText={setClosingDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#555"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Contingencies</Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                value={contingencies}
                onChangeText={setContingencies}
                placeholder="Describe any contingencies..."
                placeholderTextColor="#555"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Broker Name (if any)</Text>
              <TextInput
                style={styles.textInput}
                value={brokerName}
                onChangeText={setBrokerName}
                placeholder="Your real estate broker"
                placeholderTextColor="#555"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Message to Seller</Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                value={message}
                onChangeText={setMessage}
                placeholder="Add a personal message..."
                placeholderTextColor="#555"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>
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
              I certify this is a good-faith offer. I understand the owner will review
              my offer and may accept, counter, or reject. Earnest money deposit is
              required only after offer acceptance. The full property price is NOT
              charged through this form.
            </Text>
          </TouchableOpacity>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            <Home color={canSubmit ? '#000' : '#666'} size={20} />
            <Text style={[styles.submitButtonText, !canSubmit && styles.submitButtonTextDisabled]}>
              Submit Offer ${offerNum > 0 ? offerNum.toLocaleString() : ''}
            </Text>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            This is an offer submission, not a payment. The full property purchase price
            is handled through escrow/wire/title company after offer acceptance.
            Earnest money deposit may be paid via card or ACH after acceptance.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  loadingContainer: { flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#909090', marginTop: 12, fontSize: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#2A2A2A' },
  backButton: { padding: 4 },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  dealCard: { backgroundColor: '#141414', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#2A2A2A' },
  dealTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  dealLocation: { color: '#909090', fontSize: 14, marginBottom: 16 },
  askingPriceBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1A1A1A', borderRadius: 10, padding: 14 },
  askingPriceLabel: { color: '#909090', fontSize: 14 },
  askingPriceValue: { color: '#E6C200', fontSize: 22, fontWeight: '700' },
  minOfferText: { color: '#666', fontSize: 12, marginTop: 8 },
  sectionCard: { backgroundColor: '#141414', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#2A2A2A' },
  sectionTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginBottom: 16 },
  inputGroup: { marginBottom: 16 },
  inputLabel: { color: '#909090', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  inputHint: { color: '#666', fontSize: 11, marginTop: 4 },
  textInput: { backgroundColor: '#1A1A1A', borderRadius: 10, padding: 14, color: '#FFFFFF', fontSize: 15, borderWidth: 1, borderColor: '#2A2A2A' },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  amountInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', borderRadius: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: '#2A2A2A' },
  amountInput: { flex: 1, paddingVertical: 14, color: '#FFFFFF', fontSize: 15, marginLeft: 8 },
  offerTypeBadge: { color: '#E6C200', fontSize: 12, fontWeight: '600', marginTop: 6 },
  offerTypeRejected: { color: '#FF4D4D' },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A' },
  chipActive: { borderColor: '#E6C200', backgroundColor: 'rgba(230,194,0,0.1)' },
  chipText: { color: '#909090', fontSize: 14, fontWeight: '600' },
  chipTextActive: { color: '#E6C200' },
  termsContainer: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, marginBottom: 8 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#2A2A2A', marginRight: 12, marginTop: 2, justifyContent: 'center', alignItems: 'center' },
  checkboxActive: { backgroundColor: '#E6C200', borderColor: '#E6C200' },
  termsText: { color: '#909090', fontSize: 13, flex: 1, lineHeight: 18 },
  submitButton: { flexDirection: 'row', backgroundColor: '#E6C200', borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 },
  submitButtonDisabled: { backgroundColor: '#1A1A1A' },
  submitButtonText: { color: '#000000', fontSize: 16, fontWeight: '700' },
  submitButtonTextDisabled: { color: '#666' },
  disclaimer: { color: '#555', fontSize: 12, textAlign: 'center', lineHeight: 16 },
  unavailableContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  unavailableTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  unavailableText: { color: '#909090', fontSize: 14, textAlign: 'center' },
  processingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  processingTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', marginTop: 16 },
  successContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  successIconWrap: { marginBottom: 24 },
  successTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '700', marginBottom: 8 },
  successSubtitle: { color: '#909090', fontSize: 14, textAlign: 'center', marginBottom: 24 },
  successCard: { backgroundColor: '#141414', borderRadius: 16, padding: 20, width: '100%', borderWidth: 1, borderColor: '#2A2A2A' },
  successRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  successLabel: { color: '#909090', fontSize: 14 },
  successValue: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  successDivider: { height: 1, backgroundColor: '#2A2A2A', marginVertical: 12 },
  successStatus: { color: '#E6C200', fontSize: 14, fontWeight: '700' },
  processFlow: { backgroundColor: '#0A0A0A', borderRadius: 12, padding: 16, width: '100%', marginTop: 16, marginBottom: 16 },
  processTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', marginBottom: 10 },
  processStep: { color: '#909090', fontSize: 13, lineHeight: 22 },
  successButton: { backgroundColor: '#E6C200', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  successButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  failedContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  failedTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  failedSubtitle: { color: '#909090', fontSize: 14, textAlign: 'center', marginBottom: 24 },
  retryButton: { backgroundColor: '#E6C200', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  retryButtonText: { color: '#000', fontSize: 16, fontWeight: '700' }});
