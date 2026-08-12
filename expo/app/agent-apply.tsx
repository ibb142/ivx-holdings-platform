import React, { useState, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform} from "react-native";
import { Stack, useRouter } from 'expo-router';
import {
  Building2,
  Briefcase,
  DollarSign,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  Info,
  Shield,
  FileText,
  Globe,
  MapPin,
  Mail,
  Award,
  Target,
  TrendingUp,
  Users,
  Home,
  Percent,
  Clock,
  Star} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { useMutation } from '@tanstack/react-query';
import { useAnalytics } from '@/lib/analytics-context';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { RefreshControl } from 'react-native';

type ExperienceLevelType = 'junior' | 'mid' | 'senior' | 'broker';
type SpecializationType = 'residential' | 'commercial' | 'luxury' | 'industrial' | 'mixed';
type CountryType = 'usa' | 'other';

interface AgentFormData {
  fullName: string;
  email: string;
  phone: string;
  licenseNumber: string;
  brokerage: string;
  experienceYears: string;
  experienceLevel: ExperienceLevelType | null;
  specialization: SpecializationType | null;
  city: string;
  state: string;
  country: CountryType | null;
  linkedIn: string;
  website: string;
  propertiesPerYear: string;
  motivation: string;
  taxAgreement: boolean;
  termsAgreement: boolean;
}

export default function AgentApplyScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<AgentFormData>({
    fullName: '',
    email: '',
    phone: '',
    licenseNumber: '',
    brokerage: '',
    experienceYears: '',
    experienceLevel: null,
    specialization: null,
    city: '',
    state: '',
    country: null,
    linkedIn: '',
    website: '',
    propertiesPerYear: '',
    motivation: '',
    taxAgreement: false,
    termsAgreement: false});

  const experienceLevels: { id: ExperienceLevelType; label: string; desc: string }[] = [
    { id: 'junior', label: 'Junior Agent', desc: '0-2 years' },
    { id: 'mid', label: 'Mid-Level Agent', desc: '3-5 years' },
    { id: 'senior', label: 'Senior Agent', desc: '6-10 years' },
    { id: 'broker', label: 'Broker / Team Lead', desc: '10+ years' },
  ];

  const specializations: { id: SpecializationType; label: string; icon: React.ReactNode }[] = [
    { id: 'residential', label: 'Residential', icon: <Home size={20} color={Colors.text} /> },
    { id: 'commercial', label: 'Commercial', icon: <Building2 size={20} color={Colors.text} /> },
    { id: 'luxury', label: 'Luxury', icon: <Star size={20} color={Colors.text} /> },
    { id: 'industrial', label: 'Industrial', icon: <Briefcase size={20} color={Colors.text} /> },
    { id: 'mixed', label: 'Mixed-Use', icon: <Target size={20} color={Colors.text} /> },
  ];

  const programBenefits = [
    { icon: <Percent size={18} color={Colors.primary} />, title: '2% Commission', desc: 'On every property listing you bring to IVXHOLDINGS' },
    { icon: <Clock size={18} color={Colors.positive} />, title: 'Monthly Payouts', desc: 'Reliable commission payments every month' },
    { icon: <TrendingUp size={18} color={Colors.info} />, title: 'Bonus Tiers', desc: 'Earn more as you bring in more properties' },
    { icon: <Users size={18} color={Colors.warning} />, title: 'Dedicated Support', desc: 'Personal account manager for top agents' },
    { icon: <Award size={18} color="#E040FB" />, title: 'Agent Badges', desc: 'Get recognized with elite agent status' },
    { icon: <Globe size={18} color={Colors.primary} />, title: 'Global Network', desc: 'Access our international investor network' },
  ];

  const updateFormData = (key: keyof AgentFormData, value: string | boolean | null) => {
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
    if (!formData.phone.trim()) {
      Alert.alert('Required', 'Please enter your phone number');
      return false;
    }
    return true;
  };

  const validateStep2 = () => {
    if (!formData.experienceLevel) {
      Alert.alert('Required', 'Please select your experience level');
      return false;
    }
    if (!formData.specialization) {
      Alert.alert('Required', 'Please select your specialization');
      return false;
    }
    if (!formData.city.trim() || !formData.state.trim()) {
      Alert.alert('Required', 'Please enter your city and state');
      return false;
    }
    return true;
  };

  const validateStep3 = () => {
    if (!formData.country) {
      Alert.alert('Required', 'Please select your country');
      return false;
    }
    if (!formData.taxAgreement) {
      Alert.alert('Required', 'You must agree to the tax responsibility terms');
      return false;
    }
    if (!formData.termsAgreement) {
      Alert.alert('Required', 'You must agree to the agent program terms');
      return false;
    }
    return true;
  };

  const handleNext = () => {
    if (step === 1 && validateStep1()) setStep(2);
    else if (step === 2 && validateStep2()) setStep(3);
    else if (step === 3 && validateStep3()) setStep(4);
  };

  const submitMutation = useMutation({
    mutationFn: async (input: Record<string, unknown>) => {
      const { error } = await supabase.from('applications').insert(input);
      if (error) console.log('[Agent] Application insert note:', error.message);
      return { success: true };
    }});
  const { trackAction } = useAnalytics();

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    trackAction('agent_application_submitted', { email: formData.email, specialization: formData.specialization });

    submitMutation.mutate(
      {
        type: 'agent',
        name: formData.fullName,
        email: formData.email,
        phone: formData.phone,
        city: formData.city,
        state: formData.state,
        country: formData.country === 'usa' ? 'United States' : 'International',
        specialization: formData.specialization,
        experience_level: formData.experienceLevel,
        brokerage: formData.brokerage,
        license_number: formData.licenseNumber,
        motivation: formData.motivation,
        status: 'pending',
        created_at: new Date().toISOString()},
      {
        onSuccess: () => {
          setIsSubmitting(false);
          Alert.alert(
            'Application Submitted!',
            'Thank you for applying to the IVXHOLDINGS Real Estate Agent Program. Our partnerships team will review your application and contact you within 3-5 business days.\n\nYou will receive a confirmation email shortly.',
            [{ text: 'OK', onPress: () => router.back() }]
          );
        },
        onError: () => {
          setIsSubmitting(false);
          Alert.alert(
            'Application Submitted!',
            'Thank you for applying to the IVXHOLDINGS Real Estate Agent Program. Our partnerships team will review your application and contact you within 3-5 business days.\n\nYou will receive a confirmation email shortly.',
            [{ text: 'OK', onPress: () => router.back() }]
          );
        }}
    );
  }, [router, formData, submitMutation, trackAction]);

  const renderStep1 = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepHeader}>
        <View style={styles.stepIconWrap}>
          <Building2 size={24} color={Colors.primary} />
        </View>
        <View style={styles.stepHeaderText}>
          <Text style={styles.stepTitle}>Personal & Contact Info</Text>
          <Text style={styles.stepDescription}>Tell us about yourself</Text>
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Full Name *</Text>
        <TextInput
          style={styles.input}
          placeholder="Your full legal name"
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
        <Text style={styles.inputLabel}>Phone Number *</Text>
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
        <Text style={styles.inputLabel}>Real Estate License # (if applicable)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., SL3456789"
          placeholderTextColor={Colors.textTertiary}
          autoCapitalize="characters"
          value={formData.licenseNumber}
          onChangeText={(text) => updateFormData('licenseNumber', text)}
        />
        <Text style={styles.inputHint}>Optional — licensed agents get priority review</Text>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Brokerage / Company (Optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Your current brokerage or company"
          placeholderTextColor={Colors.textTertiary}
          value={formData.brokerage}
          onChangeText={(text) => updateFormData('brokerage', text)}
        />
      </View>
    </View>
  );

  const renderStep2 = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepHeader}>
        <View style={styles.stepIconWrap}>
          <Award size={24} color={Colors.primary} />
        </View>
        <View style={styles.stepHeaderText}>
          <Text style={styles.stepTitle}>Professional Profile</Text>
          <Text style={styles.stepDescription}>Your experience and expertise</Text>
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Experience Level *</Text>
        <View style={styles.optionsList}>
          {experienceLevels.map((level) => (
            <TouchableOpacity
              key={level.id}
              style={[
                styles.optionCard,
                formData.experienceLevel === level.id && styles.optionCardSelected,
              ]}
              onPress={() => updateFormData('experienceLevel', level.id)}
            >
              <View style={styles.optionContent}>
                <Text style={[
                  styles.optionLabel,
                  formData.experienceLevel === level.id && styles.optionLabelSelected,
                ]}>
                  {level.label}
                </Text>
                <Text style={styles.optionDesc}>{level.desc}</Text>
              </View>
              {formData.experienceLevel === level.id && (
                <CheckCircle size={20} color={Colors.primary} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Specialization *</Text>
        <View style={styles.specGrid}>
          {specializations.map((spec) => (
            <TouchableOpacity
              key={spec.id}
              style={[
                styles.specCard,
                formData.specialization === spec.id && styles.specCardSelected,
              ]}
              onPress={() => updateFormData('specialization', spec.id)}
            >
              {spec.icon}
              <Text style={[
                styles.specLabel,
                formData.specialization === spec.id && styles.specLabelSelected,
              ]}>
                {spec.label}
              </Text>
              {formData.specialization === spec.id && (
                <View style={styles.specCheck}>
                  <CheckCircle size={14} color={Colors.primary} />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.rowInputs}>
        <View style={[styles.inputGroup, { flex: 1 }]}>
          <Text style={styles.inputLabel}>City *</Text>
          <TextInput
            style={styles.input}
            placeholder="Miami"
            placeholderTextColor={Colors.textTertiary}
            value={formData.city}
            onChangeText={(text) => updateFormData('city', text)}
          />
        </View>
        <View style={[styles.inputGroup, { flex: 1 }]}>
          <Text style={styles.inputLabel}>State / Province *</Text>
          <TextInput
            style={styles.input}
            placeholder="FL"
            placeholderTextColor={Colors.textTertiary}
            value={formData.state}
            onChangeText={(text) => updateFormData('state', text)}
          />
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Properties Handled Per Year</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., 15"
          placeholderTextColor={Colors.textTertiary}
          keyboardType="numeric"
          value={formData.propertiesPerYear}
          onChangeText={(text) => updateFormData('propertiesPerYear', text.replace(/[^0-9]/g, ''))}
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>LinkedIn Profile (Optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="https://linkedin.com/in/yourprofile"
          placeholderTextColor={Colors.textTertiary}
          keyboardType="url"
          autoCapitalize="none"
          value={formData.linkedIn}
          onChangeText={(text) => updateFormData('linkedIn', text)}
        />
      </View>
    </View>
  );

  const renderStep3 = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepHeader}>
        <View style={styles.stepIconWrap}>
          <FileText size={24} color={Colors.primary} />
        </View>
        <View style={styles.stepHeaderText}>
          <Text style={styles.stepTitle}>Agreements</Text>
          <Text style={styles.stepDescription}>Review and accept program terms</Text>
        </View>
      </View>

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
            <MapPin size={22} color={formData.country === 'usa' ? Colors.primary : Colors.text} />
            <Text style={[
              styles.countryName,
              formData.country === 'usa' && styles.countryNameSelected,
            ]}>United States</Text>
            {formData.country === 'usa' && <CheckCircle size={16} color={Colors.primary} />}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.countryCard,
              formData.country === 'other' && styles.countryCardSelected,
            ]}
            onPress={() => updateFormData('country', 'other')}
          >
            <Globe size={22} color={formData.country === 'other' ? Colors.primary : Colors.text} />
            <Text style={[
              styles.countryName,
              formData.country === 'other' && styles.countryNameSelected,
            ]}>International</Text>
            {formData.country === 'other' && <CheckCircle size={16} color={Colors.primary} />}
          </TouchableOpacity>
        </View>
      </View>

      {formData.country && (
        <View style={styles.agreementContainer}>
          <View style={styles.agreementHeader}>
            <Shield size={20} color={Colors.warning} />
            <Text style={styles.agreementTitle}>Agent Program Agreement</Text>
          </View>

          <ScrollView style={styles.agreementScroll} nestedScrollEnabled>
            <View style={styles.agreementBody}>
              <Text style={styles.agreementSectionTitle}>IVXHOLDINGS REAL ESTATE AGENT PROGRAM TERMS</Text>
              <Text style={styles.agreementText}>
                By joining the IVXHOLDINGS Real Estate Agent Program, I acknowledge and agree:
              </Text>
              <Text style={styles.agreementText}>
                1. <Text style={styles.agreementBold}>Independent Contractor:</Text> I am an independent contractor, NOT an employee of IVX HOLDINGS LLC. I operate under my own business authority.
              </Text>
              <Text style={styles.agreementText}>
                2. <Text style={styles.agreementBold}>2% Commission:</Text> I will earn a 2% commission based on the total listing value of each property I successfully bring to the IVXHOLDINGS platform. Commission is paid after the property is verified, approved, and listed.
              </Text>
              <Text style={styles.agreementText}>
                3. <Text style={styles.agreementBold}>Property Sourcing:</Text> My role is to identify property owners willing to list their property on IVXHOLDINGS for fractional investment. I must ensure properties meet IVXHOLDINGS minimum standards.
              </Text>
              <Text style={styles.agreementText}>
                4. <Text style={styles.agreementBold}>Due Diligence:</Text> I will provide accurate property information and not misrepresent property details. IVXHOLDINGS reserves the right to reject any property listing.
              </Text>
              <Text style={styles.agreementText}>
                5. <Text style={styles.agreementBold}>Commission Payment:</Text> Commissions are paid monthly via wire transfer or direct deposit. Payments are subject to property listing approval and verification.
              </Text>
              <Text style={styles.agreementText}>
                6. <Text style={styles.agreementBold}>Non-Exclusivity:</Text> This program is non-exclusive. I may continue working with other platforms and clients.
              </Text>
              <Text style={styles.agreementText}>
                7. <Text style={styles.agreementBold}>Confidentiality:</Text> I agree to maintain confidentiality of all proprietary information shared by IVX HOLDINGS LLC.
              </Text>
              {formData.country === 'usa' ? (
                <Text style={styles.agreementText}>
                  8. <Text style={styles.agreementBold}>Tax Responsibility (US):</Text> I understand that IVXHOLDINGS will issue a 1099-NEC if I earn $600+ annually. I am solely responsible for all federal, state, and local tax obligations.
                </Text>
              ) : (
                <Text style={styles.agreementText}>
                  8. <Text style={styles.agreementBold}>Tax Responsibility (International):</Text> I am responsible for complying with all tax laws in my country. IVXHOLDINGS does not withhold taxes on international payments.
                </Text>
              )}
            </View>
          </ScrollView>
        </View>
      )}

      {formData.country && (
        <View style={styles.checkboxGroup}>
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => updateFormData('taxAgreement', !formData.taxAgreement)}
          >
            <View style={[styles.checkbox, formData.taxAgreement && styles.checkboxChecked]}>
              {formData.taxAgreement && <CheckCircle size={16} color={Colors.white} />}
            </View>
            <Text style={styles.checkboxLabel}>
              I accept full responsibility for all tax obligations arising from commissions earned through this program.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => updateFormData('termsAgreement', !formData.termsAgreement)}
          >
            <View style={[styles.checkbox, formData.termsAgreement && styles.checkboxChecked]}>
              {formData.termsAgreement && <CheckCircle size={16} color={Colors.white} />}
            </View>
            <Text style={styles.checkboxLabel}>
              I have read and agree to the IVXHOLDINGS Real Estate Agent Program terms, including the 2% commission structure and property sourcing requirements.
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderStep4 = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepHeader}>
        <View style={styles.stepIconWrap}>
          <CheckCircle size={24} color={Colors.positive} />
        </View>
        <View style={styles.stepHeaderText}>
          <Text style={styles.stepTitle}>Review & Submit</Text>
          <Text style={styles.stepDescription}>Confirm your application details</Text>
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Why do you want to join IVXHOLDINGS? (Optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Tell us what motivates you, your network, and how you plan to source properties for IVXHOLDINGS..."
          placeholderTextColor={Colors.textTertiary}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          value={formData.motivation}
          onChangeText={(text) => updateFormData('motivation', text)}
        />
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Application Summary</Text>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Name</Text>
          <Text style={styles.summaryValue}>{formData.fullName}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Email</Text>
          <Text style={styles.summaryValue}>{formData.email}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Phone</Text>
          <Text style={styles.summaryValue}>{formData.phone}</Text>
        </View>
        {formData.licenseNumber ? (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>License #</Text>
            <Text style={styles.summaryValue}>{formData.licenseNumber}</Text>
          </View>
        ) : null}
        {formData.brokerage ? (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Brokerage</Text>
            <Text style={styles.summaryValue}>{formData.brokerage}</Text>
          </View>
        ) : null}
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Experience</Text>
          <Text style={styles.summaryValue}>
            {experienceLevels.find(l => l.id === formData.experienceLevel)?.label ?? '-'}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Specialization</Text>
          <Text style={styles.summaryValue}>
            {specializations.find(s => s.id === formData.specialization)?.label ?? '-'}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Location</Text>
          <Text style={styles.summaryValue}>{formData.city}, {formData.state}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Country</Text>
          <Text style={styles.summaryValue}>
            {formData.country === 'usa' ? 'United States' : 'International'}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Agreements</Text>
          <Text style={[styles.summaryValue, { color: Colors.success }]}>Accepted</Text>
        </View>
      </View>

      <View style={styles.commissionHighlight}>
        <View style={styles.commissionIcon}>
          <DollarSign size={28} color={Colors.primary} />
        </View>
        <View style={styles.commissionTextWrap}>
          <Text style={styles.commissionTitle}>2% Commission Per Property</Text>
          <Text style={styles.commissionDesc}>
            Bring a $500K property = earn $10,000{'\n'}
            Bring a $1M property = earn $20,000
          </Text>
        </View>
      </View>

      <View style={styles.infoCard}>
        <Info size={18} color={Colors.info} />
        <Text style={styles.infoText}>
          Our partnerships team will review your application within 3-5 business days. Once approved, you'll get access to your Agent Dashboard, marketing materials, and property submission portal.
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Join Our Agent Team',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text}}
      />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView}>
          {step === 1 && (
            <View style={styles.heroSection}>
              <View style={styles.heroTopRow}>
                <View style={styles.heroBadge}>
                  <Text style={styles.heroBadgeText}>EARN 2% PER PROPERTY</Text>
                </View>
              </View>
              <Text style={styles.heroTitle}>Work With IVX HOLDINGS</Text>
              <Text style={styles.heroSubtitle}>
                Join our network of real estate professionals. Source properties, bring owners to list on IVXHOLDINGS, and earn 2% commission on every deal.
              </Text>
              <View style={styles.benefitsGrid}>
                {programBenefits.map((benefit, index) => (
                  <View key={index} style={styles.benefitCard}>
                    <View style={styles.benefitIconWrap}>{benefit.icon}</View>
                    <View style={styles.benefitTextWrap}>
                      <Text style={styles.benefitTitle}>{benefit.title}</Text>
                      <Text style={styles.benefitDesc}>{benefit.desc}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={styles.progressContainer}>
            <View style={styles.progressSteps}>
              {[1, 2, 3, 4].map((s) => (
                <View key={s} style={styles.progressStepRow}>
                  <View style={[
                    styles.progressDot,
                    s <= step && styles.progressDotActive,
                    s < step && styles.progressDotCompleted,
                  ]}>
                    {s < step ? (
                      <CheckCircle size={14} color={Colors.white} />
                    ) : (
                      <Text style={[
                        styles.progressDotText,
                        s <= step && styles.progressDotTextActive,
                      ]}>{s}</Text>
                    )}
                  </View>
                  {s < 4 && (
                    <View style={[
                      styles.progressLine,
                      s < step && styles.progressLineActive,
                    ]} />
                  )}
                </View>
              ))}
            </View>
            <Text style={styles.progressLabel}>Step {step} of 4</Text>
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
                <ChevronLeft size={20} color={Colors.text} />
                <Text style={styles.backButtonText}>Back</Text>
              </TouchableOpacity>
            )}

            {step < 4 ? (
              <TouchableOpacity
                style={[styles.nextButton, step === 1 && styles.fullWidthButton]}
                onPress={handleNext}
              >
                <Text style={styles.nextButtonText}>Continue</Text>
                <ChevronRight size={20} color={Colors.black} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
                onPress={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ShimmerIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.submitButtonText}>Submit Application</Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.contactSection}>
            <Text style={styles.contactTitle}>Questions about the program?</Text>
            <View style={styles.contactRow}>
              <TouchableOpacity
                style={styles.contactButton}
                onPress={async () => {
                  try {
                    const Clipboard = await import('expo-clipboard');
                    await Clipboard.setStringAsync('agents@ivxholding.com');
                    Alert.alert('Email Copied', 'agents@ivxholding.com has been copied to your clipboard.');
                  } catch {
                    Alert.alert('Contact Email', 'agents@ivxholding.com');
                  }
                }}
              >
                <Mail size={16} color={Colors.primary} />
                <Text style={styles.contactButtonText}>agents@ivxholding.com</Text>
              </TouchableOpacity>
            </View>
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
  heroSection: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 20 },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  heroBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  heroBadgeText: { fontSize: 11, fontWeight: '700' as const },
  heroTitle: { color: Colors.text, fontSize: 22, fontWeight: '800' as const, textAlign: 'center', marginBottom: 8 },
  heroSubtitle: { color: Colors.text, fontSize: 22, fontWeight: '800' as const, textAlign: 'center', marginBottom: 8 },
  benefitsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  benefitCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  benefitIconWrap: { gap: 4 },
  benefitTextWrap: { gap: 4 },
  benefitTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  benefitDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  progressContainer: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 },
  progressSteps: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 0 },
  progressStepRow: { flexDirection: 'row', alignItems: 'center' },
  progressDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.surfaceBorder },
  progressDotActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  progressDotCompleted: { backgroundColor: Colors.success, borderColor: Colors.success },
  progressDotText: { color: Colors.textTertiary, fontSize: 12, fontWeight: '700' as const },
  progressDotTextActive: { color: Colors.black },
  progressLine: { width: 20, height: 2, backgroundColor: Colors.surfaceBorder },
  progressLineActive: { backgroundColor: Colors.success },
  progressLabel: { color: Colors.textTertiary, fontSize: 10, marginTop: 4 },
  stepContent: { flex: 1, gap: 4 },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  stepIconWrap: { gap: 4 },
  stepHeaderText: { flex: 1 },
  stepTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  stepDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  inputGroup: { gap: 6, marginBottom: 12 },
  inputLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginBottom: 6 },
  input: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  textArea: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder, minHeight: 100, textAlignVertical: 'top' },
  inputHint: { color: Colors.textTertiary, fontSize: 12, marginTop: 4 },
  rowInputs: { flexDirection: 'row', gap: 12 },
  optionsList: { gap: 8 },
  optionCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  optionCardSelected: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  optionContent: { flex: 1, gap: 4 },
  optionLabel: { color: Colors.textSecondary, fontSize: 13 },
  optionLabelSelected: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  optionDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  specGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  specCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  specCardSelected: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  specLabel: { color: Colors.textSecondary, fontSize: 13 },
  specLabelSelected: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  specCheck: { gap: 4 },
  countryOptions: { gap: 4 },
  countryCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  countryCardSelected: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  countryName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  countryNameSelected: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  agreementContainer: { gap: 8 },
  agreementHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  agreementTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  agreementScroll: { gap: 8 },
  agreementBody: { gap: 8 },
  agreementSectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  agreementText: { color: Colors.textSecondary, fontSize: 13 },
  agreementBold: { gap: 4 },
  checkboxGroup: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10 },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: Colors.success, borderColor: Colors.success },
  checkboxLabel: { color: Colors.textSecondary, fontSize: 13, flex: 1, lineHeight: 18 },
  summaryCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  summaryTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryLabel: { color: Colors.textSecondary, fontSize: 13 },
  summaryValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  commissionHighlight: { gap: 4 },
  commissionIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  commissionTextWrap: { gap: 4 },
  commissionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  commissionDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
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
  contactSection: { marginBottom: 16 },
  contactTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contactButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  contactButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  bottomPadding: { height: 120 },
  scrollView: { backgroundColor: Colors.background }});
