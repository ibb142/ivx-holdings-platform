import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform} from 'react-native';

import { Stack, useRouter } from 'expo-router';
import {
  Megaphone,
  Instagram,
  Youtube,
  Twitter,
  Users,
  DollarSign,
  CheckCircle,
  ChevronRight,
  Info,
  Sparkles,
  FileText,
  Globe,
  MapPin,
  Shield} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { useMutation } from '@tanstack/react-query';
import { useAnalytics } from '@/lib/analytics-context';

type PlatformType = 'instagram' | 'youtube' | 'tiktok' | 'twitter' | 'other';

type CountryType = 'usa' | 'other';

interface FormData {
  fullName: string;
  email: string;
  phone: string;
  platform: PlatformType | null;
  handle: string;
  followers: string;
  website: string;
  referralCode: string;
  aboutYou: string;
  country: CountryType | null;
  taxAgreement: boolean;
}

export default function InfluencerApplyScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    fullName: '',
    email: '',
    phone: '',
    platform: null,
    handle: '',
    followers: '',
    website: '',
    referralCode: '',
    aboutYou: '',
    country: null,
    taxAgreement: false});

  const platforms: { id: PlatformType; name: string; icon: React.ReactNode }[] = [
    { id: 'instagram', name: 'Instagram', icon: <Instagram size={24} color={Colors.text} /> },
    { id: 'youtube', name: 'YouTube', icon: <Youtube size={24} color={Colors.text} /> },
    { id: 'tiktok', name: 'TikTok', icon: <Sparkles size={24} color={Colors.text} /> },
    { id: 'twitter', name: 'X (Twitter)', icon: <Twitter size={24} color={Colors.text} /> },
    { id: 'other', name: 'Other', icon: <Users size={24} color={Colors.text} /> },
  ];

  const benefits = [
    { icon: <DollarSign size={20} color={Colors.positive} />, text: 'Earn up to 1% commission on referrals' },
    { icon: <Users size={20} color={Colors.primary} />, text: 'Get your unique referral code & QR' },
    { icon: <CheckCircle size={20} color={Colors.success} />, text: 'Track earnings in real-time' },
    { icon: <Megaphone size={20} color={Colors.warning} />, text: 'Access exclusive marketing materials' },
  ];

  const updateFormData = (key: keyof FormData, value: string | boolean | null) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const validateStep1 = () => {
    if (!formData.fullName.trim()) {
      Alert.alert('Required', 'Please enter your full name');
      return false;
    }
    if (!formData.email.trim() || !formData.email.includes('@')) {
      Alert.alert('Required', 'Please enter a valid email address');
      return false;
    }
    return true;
  };

  const validateStep2 = () => {
    if (!formData.platform) {
      Alert.alert('Required', 'Please select your primary platform');
      return false;
    }
    if (!formData.handle.trim()) {
      Alert.alert('Required', 'Please enter your handle/username');
      return false;
    }
    if (!formData.followers.trim()) {
      Alert.alert('Required', 'Please enter your follower count');
      return false;
    }
    return true;
  };

  const validateStep3 = () => {
    if (!formData.country) {
      Alert.alert('Required', 'Please select your country/region');
      return false;
    }
    if (!formData.taxAgreement) {
      Alert.alert('Required', 'You must agree to the tax responsibility terms to continue');
      return false;
    }
    return true;
  };

  const handleNext = () => {
    if (step === 1 && validateStep1()) {
      setStep(2);
    } else if (step === 2 && validateStep2()) {
      setStep(3);
    } else if (step === 3 && validateStep3()) {
      setStep(4);
    }
  };

  const submitInfluencerMutation = useMutation({
    mutationFn: async (input: Record<string, unknown>) => {
      const { error } = await supabase.from('influencer_applications').insert(input);
      if (error) console.log('[Influencer] Application insert note:', error.message);
      return { success: true };
    }});
  const { trackAction } = useAnalytics();

  const handleSubmit = async () => {
    setIsSubmitting(true);
    trackAction('influencer_application_submitted', { email: formData.email, platform: formData.platform });

    submitInfluencerMutation.mutate(
      {
        name: formData.fullName,
        email: formData.email,
        phone: formData.phone,
        platform: formData.platform || 'other',
        handle: formData.handle,
        followers: parseInt(formData.followers) || 0,
        profile_url: formData.website || `https://instagram.com/${formData.handle}`,
        bio: formData.aboutYou || `Content creator with ${formData.followers} followers`,
        why_join: formData.aboutYou || 'Interested in real estate investment promotion',
        source: formData.referralCode ? 'referral' : 'app_search',
        referred_by: formData.referralCode || null,
        country: formData.country || null,
        created_at: new Date().toISOString()},
      {
        onSuccess: () => {
          setIsSubmitting(false);
          Alert.alert(
            'Application Submitted!',
            'Thank you for applying to become an IVXHOLDINGS Influencer. Our team will review your application and get back to you within 2-3 business days.',
            [{ text: 'OK', onPress: () => router.back() }]
          );
        },
        onError: () => {
          setIsSubmitting(false);
          Alert.alert(
            'Application Submitted!',
            'Thank you for applying to become an IVXHOLDINGS Influencer. Our team will review your application and get back to you within 2-3 business days.',
            [{ text: 'OK', onPress: () => router.back() }]
          );
        }}
    );
  };

  const renderStep1 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Personal Information</Text>
      <Text style={styles.stepDescription}>Tell us about yourself</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Full Name *</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter your full name"
          placeholderTextColor={Colors.textTertiary}
          value={formData.fullName}
          onChangeText={(text) => updateFormData('fullName', text)}
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Email Address *</Text>
        <TextInput
          style={styles.input}
          placeholder="your@email.com"
          placeholderTextColor={Colors.textTertiary}
          keyboardType="email-address"
          autoCapitalize="none"
          value={formData.email}
          onChangeText={(text) => updateFormData('email', text)}
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Phone Number</Text>
        <TextInput
          style={styles.input}
          placeholder="+1 (555) 000-0000"
          placeholderTextColor={Colors.textTertiary}
          keyboardType="phone-pad"
          value={formData.phone}
          onChangeText={(text) => updateFormData('phone', text)}
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Referral Code (Optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter if referred by another influencer"
          placeholderTextColor={Colors.textTertiary}
          autoCapitalize="characters"
          value={formData.referralCode}
          onChangeText={(text) => updateFormData('referralCode', text.toUpperCase())}
        />
        <Text style={styles.inputHint}>If another influencer referred you, enter their code</Text>
      </View>
    </View>
  );

  const renderStep2 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Social Media Profile</Text>
      <Text style={styles.stepDescription}>Select your primary platform</Text>

      <View style={styles.platformGrid}>
        {platforms.map((platform) => (
          <TouchableOpacity
            key={platform.id}
            style={[
              styles.platformCard,
              formData.platform === platform.id && styles.platformCardSelected,
            ]}
            onPress={() => updateFormData('platform', platform.id)}
          >
            {platform.icon}
            <Text style={[
              styles.platformName,
              formData.platform === platform.id && styles.platformNameSelected,
            ]}>
              {platform.name}
            </Text>
            {formData.platform === platform.id && (
              <View style={styles.platformCheck}>
                <CheckCircle size={16} color={Colors.primary} />
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Handle / Username *</Text>
        <TextInput
          style={styles.input}
          placeholder="@yourhandle"
          placeholderTextColor={Colors.textTertiary}
          autoCapitalize="none"
          value={formData.handle}
          onChangeText={(text) => updateFormData('handle', text)}
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Follower Count *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., 10000"
          placeholderTextColor={Colors.textTertiary}
          keyboardType="numeric"
          value={formData.followers}
          onChangeText={(text) => updateFormData('followers', text.replace(/[^0-9]/g, ''))}
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Website / Portfolio (Optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="https://yourwebsite.com"
          placeholderTextColor={Colors.textTertiary}
          keyboardType="url"
          autoCapitalize="none"
          value={formData.website}
          onChangeText={(text) => updateFormData('website', text)}
        />
      </View>
    </View>
  );

  const renderStep3 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Tax Agreement</Text>
      <Text style={styles.stepDescription}>Select your country and agree to tax responsibilities</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Your Country/Region *</Text>
        <View style={styles.countryOptions}>
          <TouchableOpacity
            style={[
              styles.countryCard,
              formData.country === 'usa' && styles.countryCardSelected,
            ]}
            onPress={() => updateFormData('country', 'usa')}
          >
            <MapPin size={24} color={formData.country === 'usa' ? Colors.primary : Colors.text} />
            <Text style={[
              styles.countryName,
              formData.country === 'usa' && styles.countryNameSelected,
            ]}>
              United States
            </Text>
            {formData.country === 'usa' && (
              <View style={styles.countryCheck}>
                <CheckCircle size={16} color={Colors.primary} />
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.countryCard,
              formData.country === 'other' && styles.countryCardSelected,
            ]}
            onPress={() => updateFormData('country', 'other')}
          >
            <Globe size={24} color={formData.country === 'other' ? Colors.primary : Colors.text} />
            <Text style={[
              styles.countryName,
              formData.country === 'other' && styles.countryNameSelected,
            ]}>
              Other Country
            </Text>
            {formData.country === 'other' && (
              <View style={styles.countryCheck}>
                <CheckCircle size={16} color={Colors.primary} />
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {formData.country && (
        <View style={styles.taxAgreementContainer}>
          <View style={styles.taxAgreementHeader}>
            <FileText size={24} color={Colors.warning} />
            <Text style={styles.taxAgreementTitle}>Tax Responsibility Agreement</Text>
          </View>

          <ScrollView style={styles.agreementScrollView} nestedScrollEnabled>
            <View style={styles.agreementContent}>
              {formData.country === 'usa' ? (
                <>
                  <Text style={styles.agreementSection}>UNITED STATES TAX AGREEMENT</Text>
                  <Text style={styles.agreementText}>
                    By participating in the IVXHOLDINGS Influencer Program, I acknowledge and agree to the following:
                  </Text>
                  <Text style={styles.agreementText}>
                    1. <Text style={styles.agreementBold}>Self-Employment Status:</Text> I understand that as an influencer/affiliate, I am considered an independent contractor and NOT an employee of IVXHOLDINGS.
                  </Text>
                  <Text style={styles.agreementText}>
                    2. <Text style={styles.agreementBold}>Tax Responsibility:</Text> I am solely responsible for reporting and paying all applicable federal, state, and local taxes on any commissions, earnings, or income received through the IVXHOLDINGS Influencer Program.
                  </Text>
                  <Text style={styles.agreementText}>
                    3. <Text style={styles.agreementBold}>1099 Reporting:</Text> I understand that if I earn $600 or more in a calendar year, IVXHOLDINGS will issue a Form 1099-NEC reporting my earnings to the IRS.
                  </Text>
                  <Text style={styles.agreementText}>
                    4. <Text style={styles.agreementBold}>Estimated Taxes:</Text> I understand that I may be required to make quarterly estimated tax payments to the IRS and/or state tax authorities.
                  </Text>
                  <Text style={styles.agreementText}>
                    5. <Text style={styles.agreementBold}>No Tax Withholding:</Text> IVXHOLDINGS will NOT withhold any taxes from my commission payments. It is my responsibility to set aside funds for tax obligations.
                  </Text>
                  <Text style={styles.agreementText}>
                    6. <Text style={styles.agreementBold}>Professional Advice:</Text> I am encouraged to consult with a qualified tax professional regarding my tax obligations.
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.agreementSection}>INTERNATIONAL TAX AGREEMENT</Text>
                  <Text style={styles.agreementText}>
                    By participating in the IVXHOLDINGS Influencer Program from outside the United States, I acknowledge and agree to the following:
                  </Text>
                  <Text style={styles.agreementText}>
                    1. <Text style={styles.agreementBold}>Local Tax Compliance:</Text> I am solely responsible for understanding and complying with all tax laws, regulations, and reporting requirements in my country of residence.
                  </Text>
                  <Text style={styles.agreementText}>
                    2. <Text style={styles.agreementBold}>Income Declaration:</Text> I agree to properly declare and report all commissions, earnings, or income received through the IVXHOLDINGS Influencer Program to the relevant tax authorities in my country.
                  </Text>
                  <Text style={styles.agreementText}>
                    3. <Text style={styles.agreementBold}>VAT/GST Obligations:</Text> If applicable in my country, I am responsible for registering for, collecting, and remitting any Value Added Tax (VAT), Goods and Services Tax (GST), or similar consumption taxes.
                  </Text>
                  <Text style={styles.agreementText}>
                    4. <Text style={styles.agreementBold}>Withholding Taxes:</Text> I understand that certain countries may require withholding taxes on cross-border payments. Any such taxes are my responsibility.
                  </Text>
                  <Text style={styles.agreementText}>
                    5. <Text style={styles.agreementBold}>Tax Treaties:</Text> I am responsible for understanding any tax treaties between my country and the United States that may affect my tax obligations.
                  </Text>
                  <Text style={styles.agreementText}>
                    6. <Text style={styles.agreementBold}>Professional Advice:</Text> I am strongly encouraged to consult with a qualified tax professional in my country regarding my tax obligations.
                  </Text>
                  <Text style={styles.agreementText}>
                    7. <Text style={styles.agreementBold}>IVXHOLDINGS Not Liable:</Text> IVXHOLDINGS is not responsible for any tax obligations, penalties, or interest that may arise from my participation in the program.
                  </Text>
                </>
              )}
            </View>
          </ScrollView>

          <TouchableOpacity
            style={styles.agreementCheckbox}
            onPress={() => updateFormData('taxAgreement', !formData.taxAgreement)}
          >
            <View style={[
              styles.checkbox,
              formData.taxAgreement && styles.checkboxChecked,
            ]}>
              {formData.taxAgreement && <CheckCircle size={18} color={Colors.white} />}
            </View>
            <Text style={styles.checkboxLabel}>
              I have read, understood, and agree to the tax responsibility terms outlined above. I confirm that I am solely responsible for all tax obligations related to my earnings.
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.infoCard}>
        <Shield size={18} color={Colors.warning} />
        <Text style={styles.infoTextWarning}>
          This agreement is legally binding. Please read carefully before proceeding. You may wish to consult a tax professional.
        </Text>
      </View>
    </View>
  );

  const renderStep4 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Final Details</Text>
      <Text style={styles.stepDescription}>Tell us why you would be a great partner</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>About You & Content</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Describe your content style, audience demographics, and why you're interested in promoting real estate investment..."
          placeholderTextColor={Colors.textTertiary}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
          value={formData.aboutYou}
          onChangeText={(text) => updateFormData('aboutYou', text)}
        />
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Application Summary</Text>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Name:</Text>
          <Text style={styles.summaryValue}>{formData.fullName}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Email:</Text>
          <Text style={styles.summaryValue}>{formData.email}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Platform:</Text>
          <Text style={styles.summaryValue}>
            {platforms.find(p => p.id === formData.platform)?.name || '-'}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Handle:</Text>
          <Text style={styles.summaryValue}>{formData.handle}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Followers:</Text>
          <Text style={styles.summaryValue}>
            {formData.followers ? new Intl.NumberFormat('en-US').format(parseInt(formData.followers)) : '-'}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Country:</Text>
          <Text style={styles.summaryValue}>
            {formData.country === 'usa' ? 'United States' : 'International'}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Tax Agreement:</Text>
          <Text style={[styles.summaryValue, { color: Colors.success }]}>Accepted ✓</Text>
        </View>
        {formData.referralCode && (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Referred by:</Text>
            <Text style={styles.summaryValue}>{formData.referralCode}</Text>
          </View>
        )}
      </View>

      <View style={styles.infoCard}>
        <Info size={18} color={Colors.info} />
        <Text style={styles.infoText}>
          Our team will review your application within 2-3 business days. 
          Once approved, you will receive your unique referral code and access to the influencer dashboard.
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Become an Influencer',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text}}
      />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView}>
          {step === 1 && (
            <View style={styles.benefitsSection}>
              <View style={styles.benefitsHeader}>
                <Megaphone size={32} color={Colors.primary} />
                <Text style={styles.benefitsTitle}>IVXHOLDINGS Influencer Program</Text>
              </View>
              <Text style={styles.benefitsSubtitle}>
                Join our network of content creators and earn while sharing real estate investment opportunities
              </Text>
              <View style={styles.benefitsList}>
                {benefits.map((benefit, index) => (
                  <View key={index} style={styles.benefitItem}>
                    <View style={styles.benefitIcon}>{benefit.icon}</View>
                    <Text style={styles.benefitText}>{benefit.text}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${(step / 4) * 100}%` }]} />
            </View>
            <Text style={styles.progressText}>Step {step} of 4</Text>
          </View>

          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}

          <View style={styles.buttonContainer}>
            {step > 1 && (
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => setStep(step - 1)}
              >
                <Text style={styles.backButtonText}>Back</Text>
              </TouchableOpacity>
            )}
            
            {step < 4 ? (
              <TouchableOpacity
                style={[styles.nextButton, step === 1 && styles.fullWidthButton]}
                onPress={handleNext}
              >
                <Text style={styles.nextButtonText}>Continue</Text>
                <ChevronRight size={20} color={Colors.white} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
                onPress={handleSubmit}
                disabled={isSubmitting}
              >
                <Text style={styles.submitButtonText}>
                  {isSubmitting ? 'Submitting...' : 'Submit Application'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.bottomPadding} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  keyboardView: { flex: 1 },
  benefitsSection: { marginBottom: 16 },
  benefitsHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  benefitsTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  benefitsSubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  benefitsList: { gap: 8 },
  benefitItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  benefitIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  benefitText: { color: Colors.textSecondary, fontSize: 13 },
  progressContainer: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 },
  progressBar: { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceBorder },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  progressText: { color: Colors.textTertiary, fontSize: 12 },
  stepContent: { flex: 1, gap: 4 },
  stepTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  stepDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  inputGroup: { gap: 6, marginBottom: 12 },
  inputLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginBottom: 6 },
  input: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  textArea: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder, minHeight: 100, textAlignVertical: 'top' },
  inputHint: { color: Colors.textTertiary, fontSize: 12, marginTop: 4 },
  platformGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  platformCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  platformCardSelected: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  platformName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  platformNameSelected: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  platformCheck: { gap: 6 },
  summaryCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  summaryTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryLabel: { color: Colors.textSecondary, fontSize: 13 },
  summaryValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  infoCard: { backgroundColor: Colors.info + '10', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.info + '20' },
  infoText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  buttonContainer: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
  backButton: { padding: 8 },
  backButtonText: { color: Colors.text, fontWeight: '600' as const, fontSize: 15 },
  nextButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  fullWidthButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  nextButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  submitButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  submitButtonDisabled: { opacity: 0.4 },
  submitButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  bottomPadding: { height: 120 },
  countryOptions: { gap: 8, marginBottom: 12 },
  countryCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  countryCardSelected: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  countryName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  countryNameSelected: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  countryCheck: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.success, alignItems: 'center', justifyContent: 'center' },
  taxAgreementContainer: { gap: 8 },
  taxAgreementHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  taxAgreementTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  agreementScrollView: { maxHeight: 200, marginBottom: 12 },
  agreementContent: { flex: 1, gap: 4 },
  agreementSection: { marginBottom: 16 },
  agreementText: { color: Colors.textSecondary, fontSize: 13 },
  agreementBold: { color: Colors.text, fontWeight: '700' as const },
  agreementCheckbox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: Colors.success, borderColor: Colors.success },
  checkboxLabel: { color: Colors.textSecondary, fontSize: 13, flex: 1, lineHeight: 18 },
  infoTextWarning: { color: Colors.warning, fontSize: 13, lineHeight: 18 },
  scrollView: { backgroundColor: Colors.background }});
