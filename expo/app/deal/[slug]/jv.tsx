/**
 * IVX JV Application Page
 *
 * Route: /deal/[slug]/jv
 *
 * JV partnership application flow:
 * APPLICATION → QUALIFICATION → DOCUMENT REVIEW → OWNER REVIEW →
 * DUE DILIGENCE → TERMS → AGREEMENT → PAYMENT ENABLED → PAYMENT → CONFIRMATION
 *
 * Payment is NOT enabled on submit. Owner reviews and approves first.
 */

import React, { useState, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ArrowLeft,
  FileText,
  DollarSign,
  Briefcase,
  Award,
  Shield,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Handshake,
  Building2,
  Percent} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { submitJVApplication, formatCents } from '@/lib/payment-api-client';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { DIRECT_API_BASE_URL } from '@/lib/public-api';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { RefreshControl } from 'react-native';

interface DealData {
  id: string;
  title: string;
  jv_enabled: boolean;
  jv_status: string;
  jv_minimum_contribution: number;
  jv_maximum_contribution: number;
  jv_capital_target: number;
  jv_capital_raised: number;
  jv_structure: string | null;
  city: string;
  state: string;
}

type JVStep = 'form' | 'submitting' | 'submitted' | 'failed';

export default function JVApplicationPage() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [amount, setAmount] = useState<string>('');
  const [contributionType, setContributionType] = useState<string>('capital');
  const [company, setCompany] = useState<string>('');
  const [experience, setExperience] = useState<string>('');
  const [proposedTerms, setProposedTerms] = useState<string>('');
  const [requestedOwnership, setRequestedOwnership] = useState<string>('');
  const [projectRole, setProjectRole] = useState<string>('');
  const [proofOfFundsUrl, setProofOfFundsUrl] = useState<string>('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [step, setStep] = useState<JVStep>('form');
  const [error, setError] = useState<string | null>(null);
  const [applicationId, setApplicationId] = useState<string | null>(null);

  const { data: dealData, isLoading } = useQuery<DealData>({
    queryKey: ['deal-jv', slug],
    queryFn: async () => {
      const url = DIRECT_API_BASE_URL || 'https://api.ivxholding.com';
      const res = await fetch(`${url}/api/ivx/deals/${slug}/pathways`);
      const data = await res.json();
      return data.deal as DealData;
    },
    enabled: !!slug});

  const minContribution = dealData?.jv_minimum_contribution || 20000;
  const amountNum = parseFloat(amount.replace(/[^0-9.]/g, '')) || 0;
  const amountCents = Math.round(amountNum * 100);
  const capitalRemaining = (dealData?.jv_capital_target || 0) - (dealData?.jv_capital_raised || 0);

  const canSubmit = dealData?.jv_enabled
    && dealData?.jv_status === 'JV_OPEN'
    && amountNum >= minContribution
    && acceptedTerms
    && !!(company.trim())
    && !!(experience.trim())
    && step === 'form';

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !user || !dealData) return;
    setStep('submitting');
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const result = await submitJVApplication({
        dealId: dealData.id,
        amountCents,
        contributionType,
        company: company.trim(),
        experience: experience.trim(),
        proposedTerms: proposedTerms.trim(),
        requestedOwnership: parseFloat(requestedOwnership) || 0,
        projectRole: projectRole.trim(),
        proofOfFundsUrl: proofOfFundsUrl.trim(),
        acceptedTerms: true});

      if (result.ok) {
        setApplicationId(result.application?.id || null);
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
  }, [canSubmit, user, dealData, amountCents, contributionType, company, experience, proposedTerms, requestedOwnership, projectRole, proofOfFundsUrl]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ShimmerIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading deal...</Text>
      </View>
    );
  }

  if (!dealData?.jv_enabled || dealData?.jv_status !== 'JV_OPEN') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft color={Colors.text} size={24} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>JV Partnership</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.unavailableContainer}>
          <AlertCircle color={Colors.warning} size={48} />
          <Text style={styles.unavailableTitle}>JV Not Available</Text>
          <Text style={styles.unavailableText}>
            JV partnership is {(dealData?.jv_status || 'not available').toLowerCase().replace('jv_', '')} for this project.
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
          <Text style={styles.successTitle}>Application Submitted!</Text>
          <Text style={styles.successSubtitle}>
            Your JV partnership application for {dealData.title} has been submitted for owner review.
          </Text>
          <View style={styles.successCard}>
            <View style={styles.successRow}>
              <Text style={styles.successLabel}>Deal</Text>
              <Text style={styles.successValue}>{dealData.title}</Text>
            </View>
            <View style={styles.successRow}>
              <Text style={styles.successLabel}>Contribution</Text>
              <Text style={styles.successValue}>${amountNum.toLocaleString()}</Text>
            </View>
            <View style={styles.successRow}>
              <Text style={styles.successLabel}>Company</Text>
              <Text style={styles.successValue}>{company}</Text>
            </View>
            <View style={styles.successDivider} />
            <View style={styles.successRow}>
              <Text style={styles.successStatus}>Status: APPLICATION</Text>
            </View>
          </View>
          <View style={styles.processFlow}>
            <Text style={styles.processTitle}>What happens next?</Text>
            <Text style={styles.processStep}>1. Owner reviews your application</Text>
            <Text style={styles.processStep}>2. Due diligence & document review</Text>
            <Text style={styles.processStep}>3. Terms negotiation (if needed)</Text>
            <Text style={styles.processStep}>4. Agreement signing</Text>
            <Text style={styles.processStep}>5. Payment enabled after approval</Text>
          </View>
          <TouchableOpacity
            style={styles.successButton}
            onPress={() => router.back()}
          >
            <Text style={styles.successButtonText}>Back to Deal</Text>
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
          <Text style={styles.processingTitle}>Submitting Application...</Text>
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
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => { setStep('form'); setError(null); }}
          >
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
        <Text style={styles.headerTitle}>JV Partnership</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Deal info */}
          <View style={styles.dealCard}>
            <Text style={styles.dealTitle}>{dealData.title}</Text>
            <Text style={styles.dealLocation}>
              {[dealData.city, dealData.state].filter(Boolean).join(', ')}
            </Text>
            <View style={styles.dealMetrics}>
              <View style={styles.metricBox}>
                <Text style={styles.metricValue}>${minContribution.toLocaleString()}</Text>
                <Text style={styles.metricLabel}>Min Contribution</Text>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metricBox}>
                <Text style={styles.metricValue}>${capitalRemaining.toLocaleString()}</Text>
                <Text style={styles.metricLabel}>Remaining</Text>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metricBox}>
                <Text style={styles.metricValue}>{dealData.jv_structure || 'JV'}</Text>
                <Text style={styles.metricLabel}>Structure</Text>
              </View>
            </View>
          </View>

          {/* Application form */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Partnership Details</Text>

            {/* Amount */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Contribution Amount (USD) *</Text>
              <View style={styles.amountInputWrap}>
                <DollarSign color={Colors.textSecondary} size={20} />
                <TextInput
                  style={styles.amountInput}
                  value={amount}
                  onChangeText={setAmount}
                  placeholder={minContribution.toString()}
                  placeholderTextColor="#555"
                  keyboardType="numeric"
                />
              </View>
              {amountNum > 0 && amountNum < minContribution && (
                <Text style={styles.inputError}>Minimum contribution is ${minContribution.toLocaleString()}</Text>
              )}
            </View>

            {/* Contribution type */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Contribution Type</Text>
              <View style={styles.chipRow}>
                {['capital', 'property', 'sweat_equity'].map(type => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.chip, contributionType === type && styles.chipActive]}
                    onPress={() => { setContributionType(type); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  >
                    <Text style={[styles.chipText, contributionType === type && styles.chipTextActive]}>
                      {type === 'sweat_equity' ? 'Sweat Equity' : type.charAt(0).toUpperCase() + type.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Company */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Company / Entity *</Text>
              <TextInput
                style={styles.textInput}
                value={company}
                onChangeText={setCompany}
                placeholder="Your company or LLC name"
                placeholderTextColor="#555"
              />
            </View>

            {/* Experience */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Real Estate Experience *</Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                value={experience}
                onChangeText={setExperience}
                placeholder="Describe your real estate investment experience..."
                placeholderTextColor="#555"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            {/* Proposed terms */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Proposed Terms</Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                value={proposedTerms}
                onChangeText={setProposedTerms}
                placeholder="Describe your proposed partnership terms..."
                placeholderTextColor="#555"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            {/* Requested ownership */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Requested Ownership %</Text>
              <View style={styles.amountInputWrap}>
                <Percent color={Colors.textSecondary} size={20} />
                <TextInput
                  style={styles.amountInput}
                  value={requestedOwnership}
                  onChangeText={setRequestedOwnership}
                  placeholder="e.g. 25"
                  placeholderTextColor="#555"
                  keyboardType="numeric"
                />
              </View>
            </View>

            {/* Project role */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Proposed Project Role</Text>
              <TextInput
                style={styles.textInput}
                value={projectRole}
                onChangeText={setProjectRole}
                placeholder="e.g. Capital Partner, Operating Partner"
                placeholderTextColor="#555"
              />
            </View>

            {/* Proof of funds */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Proof of Funds URL</Text>
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
              I certify that the information provided is accurate. I understand that
              submitting this application does not constitute a binding commitment.
              The owner will review my application before payment is enabled.
            </Text>
          </TouchableOpacity>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            <Handshake color={canSubmit ? '#000' : '#666'} size={20} />
            <Text style={[styles.submitButtonText, !canSubmit && styles.submitButtonTextDisabled]}>
              Submit JV Application
            </Text>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            Payment is only enabled after owner review and approval. You will be
            notified when your application is reviewed.
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
  metricValue: { color: '#E6C200', fontSize: 16, fontWeight: '700' },
  metricLabel: { color: '#909090', fontSize: 11, marginTop: 2, textAlign: 'center' },
  metricDivider: { width: 1, height: 32, backgroundColor: '#2A2A2A' },
  sectionCard: {
    backgroundColor: '#141414', borderRadius: 16, padding: 20, marginBottom: 16,
    borderWidth: 1, borderColor: '#2A2A2A'},
  sectionTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginBottom: 16 },
  inputGroup: { marginBottom: 16 },
  inputLabel: { color: '#909090', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  inputError: { color: '#FF4D4D', fontSize: 12, marginTop: 4 },
  textInput: {
    backgroundColor: '#1A1A1A', borderRadius: 10, padding: 14, color: '#FFFFFF',
    fontSize: 15, borderWidth: 1, borderColor: '#2A2A2A'},
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  amountInputWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A',
    borderRadius: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: '#2A2A2A'},
  amountInput: { flex: 1, paddingVertical: 14, color: '#FFFFFF', fontSize: 15, marginLeft: 8 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A'},
  chipActive: { borderColor: '#E6C200', backgroundColor: 'rgba(230,194,0,0.1)' },
  chipText: { color: '#909090', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#E6C200' },
  termsContainer: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, marginBottom: 8 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#2A2A2A',
    marginRight: 12, marginTop: 2, justifyContent: 'center', alignItems: 'center'},
  checkboxActive: { backgroundColor: '#E6C200', borderColor: '#E6C200' },
  termsText: { color: '#909090', fontSize: 13, flex: 1, lineHeight: 18 },
  submitButton: {
    flexDirection: 'row', backgroundColor: '#E6C200', borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12},
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
