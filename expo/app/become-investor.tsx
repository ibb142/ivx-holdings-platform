import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
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
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import {
  MapPin,
  Calendar,
  Building2,
  Globe,
  Check,
  ChevronLeft,
  ChevronRight,
  Shield,
  Sparkles,
  BadgeCheck,
  Clock,
  FileCheck2} from 'lucide-react-native';
import Colors from '@/constants/colors';
import * as MemberService from '@/lib/member-service';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { RefreshControl } from 'react-native';

const STEP_TITLES = ['Personal', 'Investment', 'Interests', 'Locations', 'Goals', 'Verification'] as const;

const RANGE_OPTIONS: { id: MemberService.InvestmentRange; label: string }[] = [
  { id: '10k', label: '$10K' },
  { id: '25k', label: '$25K' },
  { id: '50k', label: '$50K' },
  { id: '100k', label: '$100K' },
  { id: '250k', label: '$250K' },
  { id: '500k', label: '$500K' },
  { id: '1m', label: '$1M' },
  { id: '5m', label: '$5M' },
  { id: '10m_plus', label: '$10M+' },
];

const INTEREST_OPTIONS: { id: MemberService.PropertyInterest; label: string }[] = [
  { id: 'multifamily', label: 'Multifamily' },
  { id: 'luxury', label: 'Luxury' },
  { id: 'land', label: 'Land' },
  { id: 'commercial', label: 'Commercial' },
  { id: 'hotels', label: 'Hotels' },
  { id: 'industrial', label: 'Industrial' },
  { id: 'development', label: 'Development' },
];

const GOAL_OPTIONS: { id: MemberService.InvestmentGoal; label: string }[] = [
  { id: 'cash_flow', label: 'Cash Flow' },
  { id: 'appreciation', label: 'Appreciation' },
  { id: 'development', label: 'Development' },
  { id: 'tokenized_assets', label: 'Tokenized Assets' },
  { id: 'jv_deals', label: 'JV Deals' },
];

const NET_WORTH_OPTIONS = ['Under $250K', '$250K – $1M', '$1M – $5M', '$5M – $25M', '$25M+'] as const;

export default function BecomeInvestorScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const params = useLocalSearchParams<{ userId?: string }>();
  const userId = typeof params.userId === 'string' ? params.userId : '';

  const [stepIndex, setStepIndex] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isLoadingExisting, setIsLoadingExisting] = useState<boolean>(true);
  const [application, setApplication] = useState<MemberService.InvestorApplication | null>(null);

  // Personal
  const [address, setAddress] = useState<string>('');
  const [dateOfBirth, setDateOfBirth] = useState<string>('');
  const [entityName, setEntityName] = useState<string>('');
  const [taxCountry, setTaxCountry] = useState<string>('United States');
  // Investment
  const [netWorthRange, setNetWorthRange] = useState<string>('');
  const [accredited, setAccredited] = useState<boolean>(false);
  const [investmentRange, setInvestmentRange] = useState<MemberService.InvestmentRange | ''>('');
  // Interests
  const [interests, setInterests] = useState<MemberService.PropertyInterest[]>([]);
  // Locations
  const [countriesText, setCountriesText] = useState<string>('United States');
  const [statesText, setStatesText] = useState<string>('');
  const [citiesText, setCitiesText] = useState<string>('');
  const [zipText, setZipText] = useState<string>('');
  const [radiusMiles, setRadiusMiles] = useState<number>(25);
  // Goals
  const [goals, setGoals] = useState<MemberService.InvestmentGoal[]>([]);
  // Verification
  const [govIdProvided, setGovIdProvided] = useState<boolean>(false);
  const [kycConsent, setKycConsent] = useState<boolean>(false);
  const [amlConsent, setAmlConsent] = useState<boolean>(false);
  const [entityDocs, setEntityDocs] = useState<boolean>(false);

  const loadExisting = useCallback(async () => {
    if (!userId) {
      setIsLoadingExisting(false);
      return;
    }
    try {
      const result = await MemberService.getInvestorApplication(userId);
      if (result.success && result.application) {
        setApplication(result.application);
      }
    } catch (err) {
      console.log('[BecomeInvestor] load existing failed', err);
    } finally {
      setIsLoadingExisting(false);
    }
  }, [userId]);

  useEffect(() => {
    loadExisting();
  }, [loadExisting]);

  const toggleIn = <T,>(list: T[], item: T, setter: (next: T[]) => void) => {
    setter(list.includes(item) ? list.filter((i) => i !== item) : [...list, item]);
  };

  const parseList = (text: string): string[] =>
    text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

  const canContinue = useMemo(() => {
    switch (stepIndex) {
      case 0: return address.trim().length > 4 && dateOfBirth.trim().length >= 8 && taxCountry.trim().length > 1;
      case 1: return netWorthRange !== '' && investmentRange !== '';
      case 2: return interests.length > 0;
      case 3: return true;
      case 4: return goals.length > 0;
      case 5: return kycConsent && amlConsent;
      default: return false;
    }
  }, [stepIndex, address, dateOfBirth, taxCountry, netWorthRange, investmentRange, interests, goals, kycConsent, amlConsent]);

  const handleSubmit = async () => {
    if (!userId) {
      Alert.alert('Sign In Required', 'Create a free member account first, then activate investor status.');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await MemberService.submitInvestorApplication({
        userId,
        address: address.trim(),
        dateOfBirth: dateOfBirth.trim(),
        entityName: entityName.trim(),
        taxCountry: taxCountry.trim(),
        netWorthRange,
        accreditedInvestor: accredited,
        investmentRange: investmentRange as MemberService.InvestmentRange,
        interests,
        countries: parseList(countriesText),
        states: parseList(statesText),
        cities: parseList(citiesText),
        zipCodes: parseList(zipText),
        radiusMiles,
        goals,
        governmentIdProvided: govIdProvided,
        kycConsent,
        amlConsent,
        entityDocsProvided: entityDocs});
      if (result.success && result.application) {
        setApplication(result.application);
      } else {
        Alert.alert('Submission Failed', result.message || 'Could not submit your application. Please try again.');
      }
    } catch (err) {
      console.log('[BecomeInvestor] submit failed', err);
      Alert.alert('Error', 'Could not submit your application. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderChip = (label: string, active: boolean, onPress: () => void, testID?: string) => (
    <TouchableOpacity
      key={label}
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      testID={testID}
    >
      <View style={[styles.checkbox, active && styles.checkboxChecked]}>
        {active && <Check size={12} color="#000000" />}
      </View>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  const renderToggleRow = (label: string, sub: string, value: boolean, onToggle: () => void) => (
    <TouchableOpacity style={styles.toggleRow} onPress={onToggle}>
      <View style={[styles.checkbox, value && styles.checkboxChecked]}>
        {value && <Check size={12} color="#000000" />}
      </View>
      <View style={styles.toggleTextBox}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleSub}>{sub}</Text>
      </View>
    </TouchableOpacity>
  );

  const renderStatus = () => {
    if (!application) return null;
    const status = application.status;
    const isVerified = status === 'investor_verified';
    const review = application.aiReview;

    return (
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.statusCard}>
          {isVerified ? (
            <BadgeCheck size={48} color={Colors.success} />
          ) : (
            <Clock size={48} color={Colors.gold} />
          )}
          <Text style={styles.statusTitle}>
            {isVerified ? 'INVESTOR VERIFIED' : status === 'manual_review' ? 'UNDER REVIEW' : 'INVESTOR PENDING'}
          </Text>
          <Text style={styles.statusSub}>
            {isVerified
              ? 'Your investor status is active. IVX AI is now matching you with opportunities.'
              : 'Your application is in the pipeline: INVESTOR PENDING → AI Review → INVESTOR VERIFIED.'}
          </Text>
          {review && (
            <View style={styles.reviewBox}>
              <View style={styles.reviewHeader}>
                <Sparkles size={16} color={Colors.gold} />
                <Text style={styles.reviewTitle}>AI Review — Score {review.score}/100</Text>
              </View>
              {review.reasons.map((reason, idx) => (
                <Text key={`${idx}-${reason.slice(0, 12)}`} style={styles.reviewReason}>• {reason}</Text>
              ))}
            </View>
          )}
        </View>

        {isVerified && application.matches.length > 0 && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>AI Matches ({application.matches.length})</Text>
            {application.matches.slice(0, 10).map((m) => (
              <View key={m.matchId} style={styles.matchRow}>
                <View style={styles.matchScoreBadge}>
                  <Text style={styles.matchScoreText}>{m.score}</Text>
                </View>
                <View style={styles.matchInfo}>
                  <Text style={styles.matchName}>{m.matchedName}</Text>
                  <Text style={styles.matchMeta}>{m.matchedPartyType} • {m.matchType.replace(/_/g, ' ')}</Text>
                  {m.evidence.slice(0, 2).map((e, i) => (
                    <Text key={`${m.matchId}-${i}`} style={styles.matchEvidence}>{e}</Text>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}

        {isVerified && application.alerts.length > 0 && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Active Alerts ({application.alerts.length})</Text>
            <View style={styles.chipWrap}>
              {application.alerts.map((a) => (
                <View key={a.alertId} style={styles.alertChip}>
                  <Text style={styles.alertChipText}>
                    {a.kind.replace(/_/g, ' ')} · {a.target.replace(/_/g, ' ')}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {!isVerified && (
          <TouchableOpacity
            style={styles.outlineButton}
            onPress={() => setApplication(null)}
            testID="edit-application"
          >
            <Text style={styles.outlineButtonText}>Update Application</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.submitButton} onPress={() => router.back()}>
          <Text style={styles.submitButtonText}>Done</Text>
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    );
  };

  const renderStep = () => {
    switch (stepIndex) {
      case 0:
        return (
          <View>
            <Text style={styles.stepHeading}>Personal Details</Text>
            <Text style={styles.label}>Residential Address</Text>
            <View style={styles.inputContainer}>
              <MapPin size={18} color={Colors.muted} style={styles.inputIcon} />
              <TextInput style={styles.input} placeholder="Street, City, State" placeholderTextColor={Colors.muted} value={address} onChangeText={setAddress} />
            </View>
            <Text style={styles.label}>Date of Birth</Text>
            <View style={styles.inputContainer}>
              <Calendar size={18} color={Colors.muted} style={styles.inputIcon} />
              <TextInput style={styles.input} placeholder="MM/DD/YYYY" placeholderTextColor={Colors.muted} value={dateOfBirth} onChangeText={setDateOfBirth} keyboardType="numbers-and-punctuation" />
            </View>
            <Text style={styles.label}>Entity / Company (optional)</Text>
            <View style={styles.inputContainer}>
              <Building2 size={18} color={Colors.muted} style={styles.inputIcon} />
              <TextInput style={styles.input} placeholder="LLC, Trust, Fund…" placeholderTextColor={Colors.muted} value={entityName} onChangeText={setEntityName} />
            </View>
            <Text style={styles.label}>Tax Country</Text>
            <View style={styles.inputContainer}>
              <Globe size={18} color={Colors.muted} style={styles.inputIcon} />
              <TextInput style={styles.input} placeholder="United States" placeholderTextColor={Colors.muted} value={taxCountry} onChangeText={setTaxCountry} />
            </View>
          </View>
        );
      case 1:
        return (
          <View>
            <Text style={styles.stepHeading}>Investment Profile</Text>
            <Text style={styles.label}>Net Worth</Text>
            <View style={styles.chipWrap}>
              {NET_WORTH_OPTIONS.map((option) =>
                renderChip(option, netWorthRange === option, () => setNetWorthRange(option))
              )}
            </View>
            <Text style={styles.label}>Accredited Investor</Text>
            {renderToggleRow(
              'I am an accredited investor',
              'Income $200K+ (or $300K joint) or $1M+ net worth excluding primary residence.',
              accredited,
              () => setAccredited(!accredited)
            )}
            <Text style={styles.label}>Investment Range</Text>
            <View style={styles.chipWrap}>
              {RANGE_OPTIONS.map((option) =>
                renderChip(option.label, investmentRange === option.id, () => setInvestmentRange(option.id), `range-${option.id}`)
              )}
            </View>
          </View>
        );
      case 2:
        return (
          <View>
            <Text style={styles.stepHeading}>Property Interests</Text>
            <Text style={styles.stepSub}>Select all asset classes you want deal flow for.</Text>
            <View style={styles.chipWrap}>
              {INTEREST_OPTIONS.map((option) =>
                renderChip(option.label, interests.includes(option.id), () => toggleIn(interests, option.id, setInterests), `interest-${option.id}`)
              )}
            </View>
          </View>
        );
      case 3:
        return (
          <View>
            <Text style={styles.stepHeading}>Target Locations</Text>
            <Text style={styles.stepSub}>Comma-separated. Example ZIP codes: 33332, 33131, 90210</Text>
            <Text style={styles.label}>Countries</Text>
            <View style={styles.inputContainer}>
              <TextInput style={styles.input} placeholder="United States, …" placeholderTextColor={Colors.muted} value={countriesText} onChangeText={setCountriesText} />
            </View>
            <Text style={styles.label}>States</Text>
            <View style={styles.inputContainer}>
              <TextInput style={styles.input} placeholder="Florida, Texas, …" placeholderTextColor={Colors.muted} value={statesText} onChangeText={setStatesText} />
            </View>
            <Text style={styles.label}>Cities</Text>
            <View style={styles.inputContainer}>
              <TextInput style={styles.input} placeholder="Miami, Fort Lauderdale, …" placeholderTextColor={Colors.muted} value={citiesText} onChangeText={setCitiesText} />
            </View>
            <Text style={styles.label}>ZIP Codes</Text>
            <View style={styles.inputContainer}>
              <TextInput style={styles.input} placeholder="33332, 33131, 90210" placeholderTextColor={Colors.muted} value={zipText} onChangeText={setZipText} keyboardType="numbers-and-punctuation" />
            </View>
            <Text style={styles.label}>Search Radius: {radiusMiles} miles</Text>
            <View style={styles.chipWrap}>
              {[10, 25, 50, 100, 250].map((miles) =>
                renderChip(`${miles} mi`, radiusMiles === miles, () => setRadiusMiles(miles))
              )}
            </View>
          </View>
        );
      case 4:
        return (
          <View>
            <Text style={styles.stepHeading}>Investment Goals</Text>
            <View style={styles.chipWrap}>
              {GOAL_OPTIONS.map((option) =>
                renderChip(option.label, goals.includes(option.id), () => toggleIn(goals, option.id, setGoals), `goal-${option.id}`)
              )}
            </View>
          </View>
        );
      case 5:
        return (
          <View>
            <Text style={styles.stepHeading}>Verification</Text>
            <Text style={styles.stepSub}>
              Required to comply with financial regulations. Status flow: INVESTOR PENDING → AI Review → INVESTOR VERIFIED.
            </Text>
            {renderToggleRow('Government ID ready', 'Passport or driver license — verified during KYC.', govIdProvided, () => setGovIdProvided(!govIdProvided))}
            {renderToggleRow('KYC consent', 'I consent to identity verification (Know Your Customer).', kycConsent, () => setKycConsent(!kycConsent))}
            {renderToggleRow('AML consent', 'I consent to anti-money-laundering screening.', amlConsent, () => setAmlConsent(!amlConsent))}
            {renderToggleRow('Entity documents (optional)', 'Operating agreement / formation docs for entity investing.', entityDocs, () => setEntityDocs(!entityDocs))}
          </View>
        );
      default:
        return null;
    }
  };

  if (isLoadingExisting) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: 'Become an Investor', headerShown: true }} />
        <View style={styles.loadingBox}>
          <ShimmerIndicator color={Colors.gold} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Become an Investor', headerShown: true }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        {application ? (
          renderStatus()
        ) : (
          <>
            <View style={styles.progressRow}>
              {STEP_TITLES.map((title, idx) => (
                <View key={title} style={[styles.progressSegment, idx <= stepIndex && styles.progressSegmentActive]} />
              ))}
            </View>
            <Text style={styles.progressLabel}>
              Step {stepIndex + 1} of {STEP_TITLES.length} — {STEP_TITLES[stepIndex]}
            </Text>
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {renderStep()}
              <View style={{ height: 24 }} />
              <View style={styles.navRow}>
                {stepIndex > 0 && (
                  <TouchableOpacity style={styles.backButton} onPress={() => setStepIndex(stepIndex - 1)}>
                    <ChevronLeft size={18} color={Colors.text} />
                    <Text style={styles.backButtonText}>Back</Text>
                  </TouchableOpacity>
                )}
                {stepIndex < STEP_TITLES.length - 1 ? (
                  <TouchableOpacity
                    style={[styles.nextButton, !canContinue && styles.nextButtonDisabled]}
                    onPress={() => canContinue && setStepIndex(stepIndex + 1)}
                    disabled={!canContinue}
                    testID="next-step"
                  >
                    <Text style={styles.nextButtonText}>Continue</Text>
                    <ChevronRight size={18} color="#000000" />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.nextButton, (!canContinue || isSubmitting) && styles.nextButtonDisabled]}
                    onPress={handleSubmit}
                    disabled={!canContinue || isSubmitting}
                    testID="submit-application"
                  >
                    {isSubmitting ? (
                      <ShimmerIndicator color="#000000" size="small" />
                    ) : (
                      <>
                        <Shield size={18} color="#000000" />
                        <Text style={styles.nextButtonText}>Submit for AI Review</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.trustRow}>
                <FileCheck2 size={14} color={Colors.muted} />
                <Text style={styles.trustText}>
                  Encrypted • KYC / AML compliant • Your data is never sold
                </Text>
              </View>
              <View style={{ height: 40 }} />
            </ScrollView>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { flex: 1, paddingHorizontal: 20 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  progressRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 20, paddingTop: 16 },
  progressSegment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceBorder },
  progressSegmentActive: { backgroundColor: Colors.gold },
  progressLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6},

  stepHeading: { fontSize: 24, fontWeight: '800' as const, color: Colors.text, marginTop: 12, marginBottom: 4 },
  stepSub: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 16, marginBottom: 8 },

  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 14,
    height: 50},
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, color: Colors.text },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.backgroundSecondary},
  chipActive: { borderColor: Colors.gold },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' as const },
  chipTextActive: { color: Colors.gold },

  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center'},
  checkboxChecked: { backgroundColor: Colors.gold, borderColor: Colors.gold },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 14,
    marginBottom: 10},
  toggleTextBox: { flex: 1 },
  toggleLabel: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  toggleSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 },

  navRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 4},
  backButtonText: { color: Colors.text, fontSize: 15, fontWeight: '600' as const },
  nextButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 12,
    backgroundColor: Colors.gold,
    gap: 8},
  nextButtonDisabled: { opacity: 0.4 },
  nextButtonText: { color: '#000000', fontSize: 15, fontWeight: '800' as const },

  trustRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16 },
  trustText: { fontSize: 11, color: Colors.muted },

  statusCard: {
    alignItems: 'center',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 24,
    marginTop: 20},
  statusTitle: { fontSize: 20, fontWeight: '800' as const, color: Colors.text, marginTop: 12, letterSpacing: 1 },
  statusSub: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 19 },

  reviewBox: {
    alignSelf: 'stretch',
    backgroundColor: Colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 14,
    marginTop: 16},
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  reviewTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.gold },
  reviewReason: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },

  sectionCard: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 16,
    marginTop: 16},
  sectionTitle: { fontSize: 16, fontWeight: '800' as const, color: Colors.text, marginBottom: 12 },

  matchRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  matchScoreBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center'},
  matchScoreText: { color: Colors.gold, fontSize: 13, fontWeight: '800' as const },
  matchInfo: { flex: 1 },
  matchName: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  matchMeta: { fontSize: 12, color: Colors.gold, marginTop: 1, textTransform: 'capitalize' as const },
  matchEvidence: { fontSize: 11, color: Colors.textSecondary, marginTop: 2, lineHeight: 15 },

  alertChip: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 10,
    paddingVertical: 6},
  alertChipText: { fontSize: 11, color: Colors.textSecondary, textTransform: 'capitalize' as const },

  submitButton: {
    backgroundColor: Colors.gold,
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20},
  submitButtonText: { color: '#000000', fontSize: 16, fontWeight: '800' as const },
  outlineButton: {
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.gold,
    marginTop: 20},
  outlineButtonText: { color: Colors.gold, fontSize: 15, fontWeight: '700' as const }});
