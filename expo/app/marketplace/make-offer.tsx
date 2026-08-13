import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  DollarSign,
  Calendar,
  FileText,
  Check,
  Shield,
  TrendingUp,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { formatCurrencyWithDecimals } from '@/lib/formatters';

interface ListingSummary {
  id: string;
  title: string;
  asking_price: number;
  currency_code: string;
  city: string;
  country_iso: string;
  images: string[];
  listing_status: string;
}

const FINANCING_TYPES = [
  { key: 'cash', label: 'Cash', description: 'No financing contingency' },
  { key: 'conventional', label: 'Conventional Loan', description: '20% down, bank financing' },
  { key: 'fha', label: 'FHA Loan', description: '3.5% down, government-backed' },
  { key: 'va', label: 'VA Loan', description: '0% down, veterans only' },
  { key: 'hard_money', label: 'Hard Money', description: 'Short-term, asset-based' },
  { key: 'seller_financing', label: 'Seller Financing', description: 'Owner carries the note' },
];

export default function MakeOfferScreen() {
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const { listingId } = useLocalSearchParams<{ listingId: string }>();

  const queryClient = useQueryClient();

  const [offerAmount, setOfferAmount] = useState('');
  const [financingType, setFinancingType] = useState('cash');
  const [earnestMoney, setEarnestMoney] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [terms, setTerms] = useState('');
  const [inspectionContingency, setInspectionContingency] = useState(true);
  const [appraisalContingency, setAppraisalContingency] = useState(true);
  const [proofOfFundsUrl, setProofOfFundsUrl] = useState('');

  const { data: listing } = useQuery<ListingSummary>({
    queryKey: ['re-listing-summary', listingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ivx_re_property_listings')
        .select('id, title, asking_price, currency_code, city, country_iso, images, listing_status')
        .eq('id', listingId)
        .single();
      if (error) throw error;
      return data as unknown as ListingSummary;
    },
    enabled: !!listingId,
  });

  const submitOfferMutation = useMutation({
    mutationFn: async () => {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('Authentication required to submit an offer');

      const { data, error } = await supabase.from('ivx_re_offers').insert({
        listing_id: listingId,
        buyer_id: user.id,
        buyer_name: user.email || 'Investor',
        buyer_email: user.email || '',
        offer_amount: parseFloat(offerAmount),
        currency_code: listing?.currency_code || 'USD',
        financing_type: financingType,
        earnest_money: earnestMoney ? parseFloat(earnestMoney) : null,
        proposed_close_date: closeDate || null,
        terms: terms || null,
        inspection_contingency: inspectionContingency,
        appraisal_contingency: appraisalContingency,
        offer_status: 'pending',
        offer_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        proof_of_funds_url: proofOfFundsUrl || null,
      }).select('*').single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['re-marketplace'] });
      queryClient.invalidateQueries({ queryKey: ['re-property', listingId] });
      Alert.alert(
        'Offer Submitted',
        'Your offer has been submitted successfully. The seller will review it and respond within 48 hours. You can track the status in your portfolio.',
        [{ text: 'View Portfolio', onPress: () => router.replace('/(tabs)/portfolio') }]
      );
    },
    onError: (error: Error) => {
      Alert.alert('Offer Failed', error.message || 'Failed to submit offer. Please try again.');
    },
  });

  const askingPrice = listing?.asking_price || 0;
  const offerAmountNum = parseFloat(offerAmount) || 0;
  const offerDifference = useMemo(() => offerAmountNum - askingPrice, [offerAmountNum, askingPrice]);
  const offerPercent = useMemo(() => {
    if (!askingPrice) return 0;
    return (offerAmountNum / askingPrice) * 100;
  }, [offerAmountNum, askingPrice]);

  const handleSubmit = () => {
    if (!offerAmount || offerAmountNum <= 0) {
      Alert.alert('Invalid Offer', 'Please enter a valid offer amount.');
      return;
    }
    submitOfferMutation.mutate();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Make an Offer</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Property Summary */}
        {listing && (
          <View style={styles.propertySummary}>
            {listing.images?.[0] && (
              <View style={styles.summaryImageContainer}>
                <View style={styles.summaryImagePlaceholder}>
                  <DollarSign size={24} color={Colors.gold} />
                </View>
              </View>
            )}
            <View style={styles.summaryInfo}>
              <Text style={styles.summaryTitle} numberOfLines={1}>{listing.title}</Text>
              <Text style={styles.summaryLocation}>{listing.city}, {listing.country_iso}</Text>
              <Text style={styles.summaryAsking}>
                Asking: {formatCurrencyWithDecimals(askingPrice)}
              </Text>
            </View>
          </View>
        )}

        {/* Offer Amount */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Your Offer Amount *</Text>
          <View style={styles.amountInputContainer}>
            <DollarSign size={18} color={Colors.gold} />
            <TextInput
              style={styles.amountInput}
              placeholder="0.00"
              placeholderTextColor={Colors.textSecondary}
              value={offerAmount}
              onChangeText={setOfferAmount}
              keyboardType="decimal-pad"
              autoCapitalize="none"
            />
          </View>
          {askingPrice > 0 && offerAmountNum > 0 && (
            <View style={styles.offerAnalysis}>
              <View style={[
                styles.offerBadge,
                offerDifference >= 0 ? styles.offerBadgePositive : styles.offerBadgeNegative,
              ]}>
                <Text style={[
                  styles.offerBadgeText,
                  offerDifference >= 0 ? styles.offerBadgeTextPositive : styles.offerBadgeTextNegative,
                ]}>
                  {offerDifference >= 0 ? '+' : ''}{formatCurrencyWithDecimals(offerDifference)}
                </Text>
              </View>
              <Text style={styles.offerPercent}>
                {offerPercent.toFixed(1)}% of asking price
              </Text>
            </View>
          )}
        </View>

        {/* Financing Type */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Financing Type</Text>
          <View style={styles.financingGrid}>
            {FINANCING_TYPES.map((ft) => (
              <TouchableOpacity
                key={ft.key}
                style={[
                  styles.financingChip,
                  financingType === ft.key && styles.financingChipActive,
                ]}
                onPress={() => setFinancingType(ft.key)}
              >
                <Text style={[
                  styles.financingChipText,
                  financingType === ft.key && styles.financingChipTextActive,
                ]}>
                  {ft.label}
                </Text>
                <Text style={[
                  styles.financingChipDesc,
                  financingType === ft.key && styles.financingChipDescActive,
                ]}>
                  {ft.description}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Earnest Money */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Earnest Money Deposit</Text>
          <View style={styles.amountInputContainer}>
            <DollarSign size={18} color={Colors.gold} />
            <TextInput
              style={styles.amountInput}
              placeholder="0.00"
              placeholderTextColor={Colors.textSecondary}
              value={earnestMoney}
              onChangeText={setEarnestMoney}
              keyboardType="decimal-pad"
            />
          </View>
          <Text style={styles.fieldHint}>
            Typically 1-3% of purchase price. Held in escrow until closing.
          </Text>
        </View>

        {/* Close Date */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Proposed Close Date</Text>
          <View style={styles.amountInputContainer}>
            <Calendar size={18} color={Colors.gold} />
            <TextInput
              style={styles.amountInput}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textSecondary}
              value={closeDate}
              onChangeText={setCloseDate}
              autoCapitalize="none"
            />
          </View>
        </View>

        {/* Contingencies */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Contingencies</Text>
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setInspectionContingency(!inspectionContingency)}
          >
            <View style={[styles.checkbox, inspectionContingency && styles.checkboxActive]}>
              {inspectionContingency && <Check size={14} color="#000" />}
            </View>
            <Text style={styles.checkboxLabel}>Inspection Contingency</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setAppraisalContingency(!appraisalContingency)}
          >
            <View style={[styles.checkbox, appraisalContingency && styles.checkboxActive]}>
              {appraisalContingency && <Check size={14} color="#000" />}
            </View>
            <Text style={styles.checkboxLabel}>Appraisal Contingency</Text>
          </TouchableOpacity>
        </View>

        {/* Terms */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Additional Terms</Text>
          <View style={styles.termsContainer}>
            <FileText size={18} color={Colors.gold} style={styles.termsIcon} />
            <TextInput
              style={styles.termsInput}
              placeholder="Any special conditions, requests, or terms..."
              placeholderTextColor={Colors.textSecondary}
              value={terms}
              onChangeText={setTerms}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>
        </View>

        {/* Proof of Funds */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Proof of Funds URL (Optional)</Text>
          <View style={styles.amountInputContainer}>
            <Shield size={18} color={Colors.gold} />
            <TextInput
              style={styles.amountInput}
              placeholder="https://..."
              placeholderTextColor={Colors.textSecondary}
              value={proofOfFundsUrl}
              onChangeText={setProofOfFundsUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <Text style={styles.fieldHint}>
            Bank statement or verification letter URL for cash offers.
          </Text>
        </View>

        {/* Risk Disclaimer */}
        <View style={styles.disclaimerCard}>
          <Shield size={14} color={Colors.textSecondary} />
          <Text style={styles.disclaimerText}>
            By submitting this offer, you agree to proceed in good faith. This offer is not a binding contract.
            A fully executed purchase agreement and KYC verification are required before the transaction is completed.
            All offers are subject to seller review and acceptance.
          </Text>
        </View>
      </ScrollView>

      {/* Submit Button */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.submitButton, submitOfferMutation.isPending && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={submitOfferMutation.isPending}
        >
          {submitOfferMutation.isPending ? (
            <ActivityIndicator color="#000" size="small" />
          ) : (
            <>
              <TrendingUp size={18} color="#000" />
              <Text style={styles.submitButtonText}>Submit Offer</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  propertySummary: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  summaryImageContainer: {
    width: 60,
    height: 60,
  },
  summaryImagePlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 10,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryInfo: {
    flex: 1,
  },
  summaryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  summaryLocation: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  summaryAsking: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.gold,
    marginTop: 4,
  },
  fieldGroup: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 8,
  },
  fieldHint: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 48,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  amountInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
  offerAnalysis: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  offerBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  offerBadgePositive: {
    backgroundColor: 'rgba(34,197,94,0.15)',
  },
  offerBadgeNegative: {
    backgroundColor: 'rgba(239,68,68,0.15)',
  },
  offerBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  offerBadgeTextPositive: {
    color: '#22c55e',
  },
  offerBadgeTextNegative: {
    color: '#ef4444',
  },
  offerPercent: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  financingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  financingChip: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    minWidth: 140,
  },
  financingChipActive: {
    borderColor: Colors.gold,
    backgroundColor: 'rgba(255,215,0,0.08)',
  },
  financingChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
  },
  financingChipTextActive: {
    color: Colors.gold,
  },
  financingChipDesc: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  financingChipDescActive: {
    color: Colors.gold,
    opacity: 0.7,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    backgroundColor: Colors.gold,
    borderColor: Colors.gold,
  },
  checkboxLabel: {
    fontSize: 14,
    color: Colors.text,
  },
  termsContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 100,
    gap: 8,
  },
  termsIcon: {
    marginTop: 2,
  },
  termsInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  disclaimerCard: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  disclaimerText: {
    fontSize: 11,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 16,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.background,
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.gold,
    borderRadius: 12,
    paddingVertical: 14,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
});
