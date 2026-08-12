import React, { useState, useCallback, useMemo } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform} from "react-native";
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { generateObject } from '@/lib/ai-service';
import { z } from 'zod';
import {
  Handshake,
  Building2,
  DollarSign,
  FileText,
  ChevronRight,
  ChevronLeft,
  Check,
  AlertCircle,
  Info,
  Camera,
  X,
  Shield,
  Clock,
  TrendingUp,

  Briefcase,
  Scale,
  MapPin,
  Phone,
  Mail,
  User,
  FileCheck,
  CreditCard,
  Navigation,
  Calendar,
  BarChart3,
  Sparkles} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { formatCurrency as _fmtCurr } from '@/lib/formatters';
import { LandPartnerFormData, DocumentScan, LandPartnerCalculation, CompSearchResult } from '@/types';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { IVXImage } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import { EmptyState } from '@/components/ivx';

const DEAL_TERMS = {
  cashPaymentPercent: 60,
  collateralPercent: 40,
  partnerProfitShare: 30,
  developerProfitShare: 70,
  termMonths: 30};

const STEPS = [
  { id: 'type', title: 'Partner Type', icon: Handshake },
  { id: 'personal', title: 'Your Info', icon: User },
  { id: 'property', title: 'Property', icon: Building2 },
  { id: 'documents', title: 'Documents', icon: FileText },
  { id: 'deal', title: 'Deal Preview', icon: DollarSign },
  { id: 'disclosure', title: 'Agreement', icon: Shield },
];

const initialFormData: LandPartnerFormData = {
  partnerType: 'jv',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  propertyAddress: '',
  city: '',
  state: '',
  zipCode: '',
  country: 'United States',
  lotSize: '',
  lotSizeUnit: 'sqft',
  zoning: '',
  propertyType: 'land',
  estimatedValue: '',
  description: '',
  controlDisclosureAccepted: false,
  paymentStructure: 'immediate'};

export default function LandPartnerScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<LandPartnerFormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [infoModalContent, setInfoModalContent] = useState({ title: '', content: '' });
  const [showCompModal, setShowCompModal] = useState(false);
  const [compSearching, setCompSearching] = useState(false);
  const [compResults, setCompResults] = useState<CompSearchResult | null>(null);

  const updateFormData = useCallback((key: keyof LandPartnerFormData, value: unknown) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  }, []);

  const calculation: LandPartnerCalculation = useMemo(() => {
    const appraisedLandValue = parseFloat(formData.estimatedValue) || 0;
    const cashPayment = appraisedLandValue * (DEAL_TERMS.cashPaymentPercent / 100);
    const collateralValue = appraisedLandValue * (DEAL_TERMS.collateralPercent / 100);
    const estimatedProjectCost = appraisedLandValue * 1.5;
    const estimatedSaleValue = appraisedLandValue * 2.5;
    const estimatedNetProfit = estimatedSaleValue - estimatedProjectCost - cashPayment;
    const partnerProfit = estimatedNetProfit * (DEAL_TERMS.partnerProfitShare / 100);
    const developerProfit = estimatedNetProfit * (DEAL_TERMS.developerProfitShare / 100);
    const totalPartnerReturn = cashPayment + partnerProfit;

    return {
      appraisedLandValue,
      cashPayment,
      collateralValue,
      estimatedProjectCost,
      estimatedSaleValue,
      estimatedNetProfit,
      partnerProfit,
      developerProfit,
      totalPartnerReturn};
  }, [formData.estimatedValue]);

  const formatCurrency = (value: number) => _fmtCurr(value);

  const pickDocument = async (type: 'deed' | 'id') => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8});

      if (!result.canceled && result.assets[0]) {
        const docScan: DocumentScan = {
          uri: result.assets[0].uri,
          uploadedAt: new Date().toISOString(),
          status: 'scanning'};

        if (type === 'deed') {
          updateFormData('deedDocument', docScan);
        } else {
          updateFormData('idDocument', docScan);
        }

        setTimeout(() => {
          const verifiedDoc: DocumentScan = {
            ...docScan,
            status: 'verified',
            verificationResult: {
              isAuthentic: true,
              confidence: 95,
              documentType: type === 'deed' ? 'Property Deed' : 'Government ID',
              extractedData: {},
              issues: [],
              recommendations: []}};
          if (type === 'deed') {
            updateFormData('deedDocument', verifiedDoc);
          } else {
            updateFormData('idDocument', verifiedDoc);
          }
        }, 2000);
      }
    } catch (error) {
      console.log('Error picking document:', error);
      Alert.alert('Error', 'Failed to select document');
    }
  };

  const showInfo = (title: string, content: string) => {
    setInfoModalContent({ title, content });
    setShowInfoModal(true);
  };

  const compSearchSchema = z.object({
    comparables: z.array(z.object({
      address: z.string(),
      city: z.string(),
      state: z.string(),
      distance: z.number(),
      lotSize: z.number(),
      lotSizeUnit: z.enum(['sqft', 'acres']),
      salePrice: z.number(),
      pricePerSqft: z.number(),
      saleDate: z.string(),
      propertyType: z.string(),
      zoning: z.string(),
      daysOnMarket: z.number(),
      source: z.string()})),
    marketAnalysis: z.object({
      averagePrice: z.number(),
      medianPrice: z.number(),
      priceRange: z.object({ low: z.number(), high: z.number() }),
      averagePricePerSqft: z.number(),
      marketTrend: z.enum(['rising', 'stable', 'declining']),
      confidenceScore: z.number(),
      recommendedValue: z.number()}),
    insights: z.array(z.string())});

  const searchComps = async () => {
    if (!formData.propertyAddress || !formData.city || !formData.state || !formData.lotSize) {
      Alert.alert('Missing Information', 'Please fill in the property address, city, state, and lot size to search for comps.');
      return;
    }

    setCompSearching(true);
    setShowCompModal(true);

    try {
      const lotSizeNum = parseFloat(formData.lotSize.replace(/,/g, '')) || 0;
      const estimatedVal = parseFloat(formData.estimatedValue) || 0;

      const result = await generateObject({
        messages: [
          {
            role: 'user',
            content: `You are a real estate market analyst AI. Generate realistic comparable property sales data for a land parcel.

Subject Property:
- Address: ${formData.propertyAddress}, ${formData.city}, ${formData.state} ${formData.zipCode}
- Lot Size: ${formData.lotSize} ${formData.lotSizeUnit}
- Zoning: ${formData.zoning || 'Residential'}
- Property Type: ${formData.propertyType}
- Owner's Estimated Value: ${estimatedVal > 0 ? formatCurrency(estimatedVal) : 'Not provided'}

Generate 5-6 comparable properties within 3 miles that have sold in the last 12 months. Include:
1. Realistic addresses in ${formData.city}, ${formData.state}
2. Similar lot sizes (within 30% of subject)
3. Recent sale dates (last 12 months)
4. Market-appropriate pricing for ${formData.state}
5. Varied distances from 0.3 to 3 miles

Provide market analysis with:
- Average and median sale prices
- Price per sqft analysis
- Market trend assessment
- Confidence score (70-95%)
- Recommended fair market value based on comps

Also provide 3-4 actionable insights about the local market.`},
        ],
        schema: compSearchSchema});

      const compResult: CompSearchResult = {
        subjectProperty: {
          address: formData.propertyAddress,
          city: formData.city,
          state: formData.state,
          lotSize: lotSizeNum,
          lotSizeUnit: formData.lotSizeUnit},
        comparables: result.comparables,
        marketAnalysis: result.marketAnalysis,
        insights: result.insights,
        generatedAt: new Date().toISOString()};

      setCompResults(compResult);
      console.log('Comp search completed:', compResult);
    } catch (error) {
      console.error('Error searching comps:', error);
      Alert.alert('Search Error', 'Failed to search for comparable properties. Please try again.');
      setShowCompModal(false);
    } finally {
      setCompSearching(false);
    }
  };

  const applyRecommendedValue = () => {
    if (compResults?.marketAnalysis.recommendedValue) {
      updateFormData('estimatedValue', compResults.marketAnalysis.recommendedValue.toString());
      setShowCompModal(false);
      Alert.alert('Value Applied', `Estimated value updated to ${formatCurrency(compResults.marketAnalysis.recommendedValue)} based on AI comp analysis.`);
    }
  };

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 0:
        return true;
      case 1:

        return !!(formData.firstName && formData.lastName && formData.email && formData.phone);
      case 2:
        return !!(formData.propertyAddress && formData.city && formData.state && formData.lotSize && formData.estimatedValue);
      case 3:
        return !!(formData.deedDocument && formData.idDocument);
      case 4:
        return true;
      case 5:
        return formData.controlDisclosureAccepted;
      default:
        return false;
    }
  };

  const nextStep = () => {
    if (!validateStep(currentStep)) {
      Alert.alert('Missing Information', 'Please complete all required fields before continuing.');
      return;
    }
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleSubmit = async () => {
    if (!formData.controlDisclosureAccepted) {
      Alert.alert('Agreement Required', 'Please accept the control disclosure agreement to proceed.');
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      Alert.alert(
        'Submission Successful',
        `Your ${formData.partnerType.toUpperCase()} partnership application has been submitted. Our team will review your property and contact you within 2-3 business days.`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
    }, 2000);
  };

  const renderStepIndicator = () => (
    <View style={styles.stepIndicatorContainer}>
      {STEPS.map((step, index) => {
        const Icon = step.icon;
        const isActive = index === currentStep;
        const isCompleted = index < currentStep;
        
        return (
          <View key={step.id} style={styles.stepIndicatorItem}>
            <View
              style={[
                styles.stepDot,
                isActive && styles.stepDotActive,
                isCompleted && styles.stepDotCompleted,
              ]}
            >
              {isCompleted ? (
                <Check size={12} color={Colors.background} />
              ) : (
                <Icon size={12} color={isActive ? Colors.background : Colors.textTertiary} />
              )}
            </View>
            {index < STEPS.length - 1 && (
              <View style={[styles.stepLine, isCompleted && styles.stepLineCompleted]} />
            )}
          </View>
        );
      })}
    </View>
  );

  const renderPartnerTypeStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Choose Your Partnership Type</Text>
      <Text style={styles.stepSubtitle}>
        Select how you'd like to partner with us on your land development
      </Text>

      <TouchableOpacity
        style={[
          styles.partnerCard,
          formData.partnerType === 'jv' && styles.partnerCardSelected,
        ]}
        onPress={() => updateFormData('partnerType', 'jv')}
        activeOpacity={0.8}
      >
        <View style={styles.partnerCardHeader}>
          <View style={[styles.partnerIcon, { backgroundColor: Colors.primary + '20' }]}>
            <Handshake size={24} color={Colors.primary} />
          </View>
          <View style={styles.partnerCardInfo}>
            <Text style={styles.partnerCardTitle}>Joint Venture (JV)</Text>
            <Text style={styles.partnerCardSubtitle}>Non-Managing Member</Text>
          </View>
          {formData.partnerType === 'jv' && (
            <View style={styles.selectedBadge}>
              <Check size={16} color={Colors.background} />
            </View>
          )}
        </View>
        <Text style={styles.partnerCardDesc}>
          Partner with us as a non-managing member. You receive liquidity now (60% of land value) plus 30% of project profits at completion.
        </Text>
        <View style={styles.partnerCardFeatures}>
          <View style={styles.featureItem}>
            <DollarSign size={14} color={Colors.success} />
            <Text style={styles.featureText}>60% cash at closing</Text>
          </View>
          <View style={styles.featureItem}>
            <TrendingUp size={14} color={Colors.primary} />
            <Text style={styles.featureText}>30% profit share</Text>
          </View>
          <View style={styles.featureItem}>
            <Clock size={14} color={Colors.info} />
            <Text style={styles.featureText}>30-month term</Text>
          </View>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.partnerCard,
          formData.partnerType === 'lp' && styles.partnerCardSelected,
        ]}
        onPress={() => updateFormData('partnerType', 'lp')}
        activeOpacity={0.8}
      >
        <View style={styles.partnerCardHeader}>
          <View style={[styles.partnerIcon, { backgroundColor: Colors.info + '20' }]}>
            <Briefcase size={24} color={Colors.info} />
          </View>
          <View style={styles.partnerCardInfo}>
            <Text style={styles.partnerCardTitle}>Limited Partner (LP)</Text>
            <Text style={styles.partnerCardSubtitle}>Passive Investor</Text>
          </View>
          {formData.partnerType === 'lp' && (
            <View style={styles.selectedBadge}>
              <Check size={16} color={Colors.background} />
            </View>
          )}
        </View>
        <Text style={styles.partnerCardDesc}>
          Participate as a passive investor with the same economics. Ideal for those seeking hands-off investment with regulatory compliance.
        </Text>
        <View style={styles.partnerCardFeatures}>
          <View style={styles.featureItem}>
            <DollarSign size={14} color={Colors.success} />
            <Text style={styles.featureText}>Same 60% cash payment</Text>
          </View>
          <View style={styles.featureItem}>
            <Scale size={14} color={Colors.warning} />
            <Text style={styles.featureText}>Securities compliant</Text>
          </View>
          <View style={styles.featureItem}>
            <Shield size={14} color={Colors.info} />
            <Text style={styles.featureText}>Open to all investors</Text>
          </View>
        </View>
      </TouchableOpacity>

      <View style={styles.paymentStructureSection}>
        <Text style={styles.sectionLabel}>Payment Structure Preference</Text>
        <Text style={styles.sectionNote}>How would you like to receive your 60% cash payment?</Text>
        
        <View style={styles.paymentOptions}>
          <TouchableOpacity
            style={[
              styles.paymentOption,
              formData.paymentStructure === 'immediate' && styles.paymentOptionSelected,
            ]}
            onPress={() => updateFormData('paymentStructure', 'immediate')}
          >
            <DollarSign size={18} color={formData.paymentStructure === 'immediate' ? Colors.primary : Colors.textTertiary} />
            <Text style={[
              styles.paymentOptionText,
              formData.paymentStructure === 'immediate' && styles.paymentOptionTextSelected,
            ]}>Immediate</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[
              styles.paymentOption,
              formData.paymentStructure === 'deferred' && styles.paymentOptionSelected,
            ]}
            onPress={() => updateFormData('paymentStructure', 'deferred')}
          >
            <Clock size={18} color={formData.paymentStructure === 'deferred' ? Colors.primary : Colors.textTertiary} />
            <Text style={[
              styles.paymentOptionText,
              formData.paymentStructure === 'deferred' && styles.paymentOptionTextSelected,
            ]}>Deferred (12-36mo)</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[
              styles.paymentOption,
              formData.paymentStructure === 'milestone' && styles.paymentOptionSelected,
            ]}
            onPress={() => updateFormData('paymentStructure', 'milestone')}
          >
            <TrendingUp size={18} color={formData.paymentStructure === 'milestone' ? Colors.primary : Colors.textTertiary} />
            <Text style={[
              styles.paymentOptionText,
              formData.paymentStructure === 'milestone' && styles.paymentOptionTextSelected,
            ]}>Milestone-Based</Text>
          </TouchableOpacity>
        </View>
        
        <View style={styles.paymentInfoBox}>
          <Info size={14} color={Colors.info} />
          <Text style={styles.paymentInfoText}>
            {formData.paymentStructure === 'immediate' && 'Full 60% payment at closing. Most common option.'}
            {formData.paymentStructure === 'deferred' && 'Payment spread over 12-36 months with interest. Higher total return.'}
            {formData.paymentStructure === 'milestone' && 'Payments tied to construction milestones. Aligns incentives.'}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.infoButton}
        onPress={() => showInfo(
          'JV vs LP Partnership',
          'Joint Venture (JV): You become a non-managing member with equity participation. Simpler structure, same economics.\n\nLimited Partner (LP): You\'re treated as a passive investor. Better for those wanting formal securities compliance.\n\nBoth options have identical economic terms and are open to everyone:\n• 60% cash payment at closing\n• 40% used as collateral\n• 30% of net profit at exit\n• 30-month agreement term'
        )}
      >
        <Info size={16} color={Colors.primary} />
        <Text style={styles.infoButtonText}>Learn more about partnership types</Text>
      </TouchableOpacity>
    </View>
  );

  const renderPersonalInfoStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Your Information</Text>
      <Text style={styles.stepSubtitle}>
        Provide your contact details for the partnership agreement
      </Text>

      <View style={styles.formRow}>
        <View style={styles.formHalf}>
          <Text style={styles.inputLabel}>First Name *</Text>
          <View style={styles.inputContainer}>
            <User size={18} color={Colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="John"
              placeholderTextColor={Colors.textTertiary}
              value={formData.firstName}
              onChangeText={(text) => updateFormData('firstName', text)}
            />
          </View>
        </View>
        <View style={styles.formHalf}>
          <Text style={styles.inputLabel}>Last Name *</Text>
          <View style={styles.inputContainer}>
            <User size={18} color={Colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="Smith"
              placeholderTextColor={Colors.textTertiary}
              value={formData.lastName}
              onChangeText={(text) => updateFormData('lastName', text)}
            />
          </View>
        </View>
      </View>

      <Text style={styles.inputLabel}>Email Address *</Text>
      <View style={styles.inputContainer}>
        <Mail size={18} color={Colors.textTertiary} />
        <TextInput
          style={styles.input}
          placeholder="john@example.com"
          placeholderTextColor={Colors.textTertiary}
          keyboardType="email-address"
          autoCapitalize="none"
          value={formData.email}
          onChangeText={(text) => updateFormData('email', text)}
        />
      </View>

      <Text style={styles.inputLabel}>Phone Number *</Text>
      <View style={styles.inputContainer}>
        <Phone size={18} color={Colors.textTertiary} />
        <TextInput
          style={styles.input}
          placeholder="+1 (555) 123-4567"
          placeholderTextColor={Colors.textTertiary}
          keyboardType="phone-pad"
          value={formData.phone}
          onChangeText={(text) => updateFormData('phone', text)}
        />
      </View>
    </View>
  );

  const renderPropertyStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Property Details</Text>
      <Text style={styles.stepSubtitle}>
        Tell us about the land you want to partner on
      </Text>

      <Text style={styles.inputLabel}>Property Address *</Text>
      <View style={styles.inputContainer}>
        <MapPin size={18} color={Colors.textTertiary} />
        <TextInput
          style={styles.input}
          placeholder="123 Main Street"
          placeholderTextColor={Colors.textTertiary}
          value={formData.propertyAddress}
          onChangeText={(text) => updateFormData('propertyAddress', text)}
        />
      </View>

      <View style={styles.formRow}>
        <View style={styles.formHalf}>
          <Text style={styles.inputLabel}>City *</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.inputNoPadding}
              placeholder="Miami"
              placeholderTextColor={Colors.textTertiary}
              value={formData.city}
              onChangeText={(text) => updateFormData('city', text)}
            />
          </View>
        </View>
        <View style={styles.formQuarter}>
          <Text style={styles.inputLabel}>State *</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.inputNoPadding}
              placeholder="FL"
              placeholderTextColor={Colors.textTertiary}
              value={formData.state}
              onChangeText={(text) => updateFormData('state', text)}
              maxLength={2}
              autoCapitalize="characters"
            />
          </View>
        </View>
        <View style={styles.formQuarter}>
          <Text style={styles.inputLabel}>ZIP *</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.inputNoPadding}
              placeholder="33101"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="number-pad"
              value={formData.zipCode}
              onChangeText={(text) => updateFormData('zipCode', text)}
              maxLength={5}
            />
          </View>
        </View>
      </View>

      <View style={styles.formRow}>
        <View style={styles.formHalf}>
          <Text style={styles.inputLabel}>Lot Size *</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.inputNoPadding}
              placeholder="10,000"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="number-pad"
              value={formData.lotSize}
              onChangeText={(text) => updateFormData('lotSize', text)}
            />
          </View>
        </View>
        <View style={styles.formHalf}>
          <Text style={styles.inputLabel}>Unit</Text>
          <View style={styles.unitToggle}>
            <TouchableOpacity
              style={[
                styles.unitButton,
                formData.lotSizeUnit === 'sqft' && styles.unitButtonActive,
              ]}
              onPress={() => updateFormData('lotSizeUnit', 'sqft')}
            >
              <Text style={[
                styles.unitButtonText,
                formData.lotSizeUnit === 'sqft' && styles.unitButtonTextActive,
              ]}>Sq Ft</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.unitButton,
                formData.lotSizeUnit === 'acres' && styles.unitButtonActive,
              ]}
              onPress={() => updateFormData('lotSizeUnit', 'acres')}
            >
              <Text style={[
                styles.unitButtonText,
                formData.lotSizeUnit === 'acres' && styles.unitButtonTextActive,
              ]}>Acres</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <Text style={styles.inputLabel}>Zoning</Text>
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.inputNoPadding}
          placeholder="e.g., R-1, C-2, Mixed Use"
          placeholderTextColor={Colors.textTertiary}
          value={formData.zoning}
          onChangeText={(text) => updateFormData('zoning', text)}
        />
      </View>

      <Text style={styles.inputLabel}>Estimated Land Value *</Text>
      <View style={styles.inputContainer}>
        <DollarSign size={18} color={Colors.textTertiary} />
        <TextInput
          style={styles.input}
          placeholder="1,000,000"
          placeholderTextColor={Colors.textTertiary}
          keyboardType="number-pad"
          value={formData.estimatedValue}
          onChangeText={(text) => updateFormData('estimatedValue', text.replace(/[^0-9]/g, ''))}
        />
      </View>

      <TouchableOpacity
        style={styles.aiCompButton}
        onPress={searchComps}
        activeOpacity={0.8}
      >
        <View style={styles.aiCompButtonContent}>
          <View style={styles.aiCompIconContainer}>
            <Sparkles size={20} color={Colors.background} />
          </View>
          <View style={styles.aiCompTextContainer}>
            <Text style={styles.aiCompButtonTitle}>AI Comp Search</Text>
            <Text style={styles.aiCompButtonSubtitle}>Find comparable sales within 3 miles</Text>
          </View>
        </View>
        <ChevronRight size={20} color={Colors.primary} />
      </TouchableOpacity>

      <Text style={styles.inputLabel}>Property Description</Text>
      <View style={[styles.inputContainer, styles.textAreaContainer]}>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Describe the property, features, and any relevant details..."
          placeholderTextColor={Colors.textTertiary}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          value={formData.description}
          onChangeText={(text) => updateFormData('description', text)}
        />
      </View>
    </View>
  );

  const renderDocumentsStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Document Verification</Text>
      <Text style={styles.stepSubtitle}>
        Upload your property deed and government ID for AI verification
      </Text>

      <View style={styles.documentCard}>
        <View style={styles.documentHeader}>
          <View style={styles.documentIconContainer}>
            <FileText size={24} color={Colors.primary} />
          </View>
          <View style={styles.documentInfo}>
            <Text style={styles.documentTitle}>Property Deed *</Text>
            <Text style={styles.documentSubtitle}>
              Official deed document showing ownership
            </Text>
          </View>
        </View>
        
        {formData.deedDocument ? (
          <View style={styles.documentUploaded}>
            <View style={styles.documentStatus}>
              {formData.deedDocument.status === 'scanning' ? (
                <>
                  <ShimmerIndicator size="small" color={Colors.primary} />
                  <Text style={styles.documentStatusText}>Scanning document...</Text>
                </>
              ) : formData.deedDocument.status === 'verified' ? (
                <>
                  <Check size={18} color={Colors.success} />
                  <Text style={[styles.documentStatusText, { color: Colors.success }]}>
                    Verified ({formData.deedDocument.verificationResult?.confidence}% confidence)
                  </Text>
                </>
              ) : (
                <>
                  <AlertCircle size={18} color={Colors.error} />
                  <Text style={[styles.documentStatusText, { color: Colors.error }]}>
                    Verification failed
                  </Text>
                </>
              )}
            </View>
            <TouchableOpacity
              style={styles.removeDocButton}
              onPress={() => updateFormData('deedDocument', undefined)}
            >
              <X size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.uploadButton}
            onPress={() => pickDocument('deed')}
          >
            <Camera size={20} color={Colors.primary} />
            <Text style={styles.uploadButtonText}>Upload Deed</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.documentCard}>
        <View style={styles.documentHeader}>
          <View style={styles.documentIconContainer}>
            <CreditCard size={24} color={Colors.info} />
          </View>
          <View style={styles.documentInfo}>
            <Text style={styles.documentTitle}>Government ID *</Text>
            <Text style={styles.documentSubtitle}>
              Driver's license, passport, or national ID
            </Text>
          </View>
        </View>
        
        {formData.idDocument ? (
          <View style={styles.documentUploaded}>
            <View style={styles.documentStatus}>
              {formData.idDocument.status === 'scanning' ? (
                <>
                  <ShimmerIndicator size="small" color={Colors.primary} />
                  <Text style={styles.documentStatusText}>Scanning document...</Text>
                </>
              ) : formData.idDocument.status === 'verified' ? (
                <>
                  <Check size={18} color={Colors.success} />
                  <Text style={[styles.documentStatusText, { color: Colors.success }]}>
                    Verified ({formData.idDocument.verificationResult?.confidence}% confidence)
                  </Text>
                </>
              ) : (
                <>
                  <AlertCircle size={18} color={Colors.error} />
                  <Text style={[styles.documentStatusText, { color: Colors.error }]}>
                    Verification failed
                  </Text>
                </>
              )}
            </View>
            <TouchableOpacity
              style={styles.removeDocButton}
              onPress={() => updateFormData('idDocument', undefined)}
            >
              <X size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.uploadButton}
            onPress={() => pickDocument('id')}
          >
            <Camera size={20} color={Colors.primary} />
            <Text style={styles.uploadButtonText}>Upload ID</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.verificationNote}>
        <Shield size={16} color={Colors.textSecondary} />
        <Text style={styles.verificationNoteText}>
          Documents are analyzed using AI to verify authenticity and extract information. Your data is encrypted and secure.
        </Text>
      </View>
    </View>
  );

  const renderDealPreviewStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Deal Preview</Text>
      <Text style={styles.stepSubtitle}>
        Review the estimated economics of your partnership
      </Text>

      <View style={styles.dealCard}>
        <View style={styles.dealHeader}>
          <Text style={styles.dealHeaderTitle}>Fixed Deal Terms</Text>
          <View style={styles.termBadge}>
            <Clock size={12} color={Colors.primary} />
            <Text style={styles.termBadgeText}>{DEAL_TERMS.termMonths} Months</Text>
          </View>
        </View>

        <View style={styles.dealTermsGrid}>
          <View style={styles.dealTermItem}>
            <Text style={styles.dealTermValue}>{DEAL_TERMS.cashPaymentPercent}%</Text>
            <Text style={styles.dealTermLabel}>Cash Payment</Text>
          </View>
          <View style={styles.dealTermItem}>
            <Text style={styles.dealTermValue}>{DEAL_TERMS.collateralPercent}%</Text>
            <Text style={styles.dealTermLabel}>Collateral</Text>
          </View>
          <View style={styles.dealTermItem}>
            <Text style={styles.dealTermValue}>{DEAL_TERMS.partnerProfitShare}%</Text>
            <Text style={styles.dealTermLabel}>Your Profit Share</Text>
          </View>
          <View style={styles.dealTermItem}>
            <Text style={styles.dealTermValue}>{DEAL_TERMS.developerProfitShare}%</Text>
            <Text style={styles.dealTermLabel}>Developer Share</Text>
          </View>
        </View>
      </View>

      <View style={styles.calculationCard}>
        <Text style={styles.calculationTitle}>Estimated Returns</Text>
        <Text style={styles.calculationNote}>Based on your estimated land value</Text>

        <View style={styles.calculationRow}>
          <Text style={styles.calculationLabel}>Appraised Land Value</Text>
          <Text style={styles.calculationValue}>{formatCurrency(calculation.appraisedLandValue)}</Text>
        </View>
        <View style={styles.divider} />
        
        <View style={styles.calculationRow}>
          <Text style={styles.calculationLabel}>Cash at Closing (60%)</Text>
          <Text style={[styles.calculationValue, styles.highlightValue]}>{formatCurrency(calculation.cashPayment)}</Text>
        </View>
        <View style={styles.calculationRow}>
          <Text style={styles.calculationLabel}>Collateral Value (40%)</Text>
          <Text style={styles.calculationValue}>{formatCurrency(calculation.collateralValue)}</Text>
        </View>
        <View style={styles.divider} />

        <View style={styles.calculationRow}>
          <Text style={styles.calculationLabel}>Est. Project Cost</Text>
          <Text style={styles.calculationValueSmall}>{formatCurrency(calculation.estimatedProjectCost)}</Text>
        </View>
        <View style={styles.calculationRow}>
          <Text style={styles.calculationLabel}>Est. Sale Value</Text>
          <Text style={styles.calculationValueSmall}>{formatCurrency(calculation.estimatedSaleValue)}</Text>
        </View>
        <View style={styles.calculationRow}>
          <Text style={styles.calculationLabel}>Est. Net Profit</Text>
          <Text style={styles.calculationValueSmall}>{formatCurrency(calculation.estimatedNetProfit)}</Text>
        </View>
        <View style={styles.divider} />

        <View style={styles.calculationRow}>
          <Text style={styles.calculationLabel}>Your Profit Share (30%)</Text>
          <Text style={[styles.calculationValue, styles.highlightValue]}>{formatCurrency(calculation.partnerProfit)}</Text>
        </View>

        <View style={styles.totalReturnCard}>
          <Text style={styles.totalReturnLabel}>Total Estimated Return</Text>
          <Text style={styles.totalReturnValue}>{formatCurrency(calculation.totalPartnerReturn)}</Text>
          <Text style={styles.totalReturnNote}>Cash + Profit Share</Text>
        </View>
      </View>

      <View style={styles.disclaimerCard}>
        <AlertCircle size={16} color={Colors.warning} />
        <Text style={styles.disclaimerText}>
          These are estimates only. Actual returns depend on final appraisal, development costs, and sale price. An independent appraisal will determine the final land value.
        </Text>
      </View>
    </View>
  );

  const renderDisclosureStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Control & Authority Agreement</Text>
      <Text style={styles.stepSubtitle}>
        Please read and accept the developer control disclosure
      </Text>

      <View style={styles.disclosureCard}>
        <View style={styles.disclosureHeader}>
          <Shield size={24} color={Colors.primary} />
          <Text style={styles.disclosureTitle}>Developer Control Disclosure</Text>
        </View>

        <ScrollView style={styles.disclosureContent} nestedScrollEnabled>
          <Text style={styles.disclosureText}>
            <Text style={styles.disclosureBold}>IMPORTANT: </Text>
            By proceeding with this {formData.partnerType.toUpperCase()} Partnership, you acknowledge and agree to the following terms:
          </Text>

          <Text style={styles.disclosureSection}>1. Exclusive Authority</Text>
          <Text style={styles.disclosureText}>
            The Developer (IVX HOLDINGS LLC) shall have exclusive and absolute authority over all aspects of the Project during the {DEAL_TERMS.termMonths}-month term, including but not limited to:
          </Text>
          <View style={styles.disclosureList}>
            <Text style={styles.disclosureListItem}>• Architectural design and specifications</Text>
            <Text style={styles.disclosureListItem}>• Permitting and entitlements</Text>
            <Text style={styles.disclosureListItem}>• Construction management and contractor selection</Text>
            <Text style={styles.disclosureListItem}>• Project budget and cost allocations</Text>
            <Text style={styles.disclosureListItem}>• Financing and collateral utilization</Text>
            <Text style={styles.disclosureListItem}>• Marketing, pricing, and real estate sales</Text>
            <Text style={styles.disclosureListItem}>• Timing of sale, refinance, or exit</Text>
          </View>

          <Text style={styles.disclosureSection}>2. No Management Rights</Text>
          <Text style={styles.disclosureText}>
            As a {formData.partnerType === 'jv' ? 'Non-Managing Member' : 'Limited Partner'}, you shall have NO management rights, approval rights, or veto power over any operational decisions. You participate economically only.
          </Text>

          <Text style={styles.disclosureSection}>3. Economic Terms</Text>
          <Text style={styles.disclosureText}>
            • Cash Payment: {DEAL_TERMS.cashPaymentPercent}% of appraised land value at closing{'\n'}
            • Collateral: {DEAL_TERMS.collateralPercent}% of land value used by Developer{'\n'}
            • Profit Share: {DEAL_TERMS.partnerProfitShare}% of net profit at exit{'\n'}
            • Term: {DEAL_TERMS.termMonths} months from closing date
          </Text>

          <Text style={styles.disclosureSection}>4. Exit Rights</Text>
          <Text style={styles.disclosureText}>
            At the end of the {DEAL_TERMS.termMonths}-month term, the Developer may execute a sale, refinance, or buyout at its sole discretion. The Partner cannot block any exit decision.
          </Text>

          <Text style={styles.disclosureSection}>5. Risk Acknowledgment</Text>
          <Text style={styles.disclosureText}>
            You understand that real estate development involves market, construction, and timing risks. Profit projections are estimates only and are not guaranteed.
          </Text>
        </ScrollView>
      </View>

      <TouchableOpacity
        style={styles.checkboxContainer}
        onPress={() => updateFormData('controlDisclosureAccepted', !formData.controlDisclosureAccepted)}
        activeOpacity={0.7}
      >
        <View style={[
          styles.checkbox,
          formData.controlDisclosureAccepted && styles.checkboxChecked,
        ]}>
          {formData.controlDisclosureAccepted && <Check size={14} color={Colors.background} />}
        </View>
        <Text style={styles.checkboxLabel}>
          I have read, understand, and agree to the Developer Control Disclosure and all terms stated above.
        </Text>
      </TouchableOpacity>

      <View style={styles.signatureNote}>
        <FileCheck size={16} color={Colors.textSecondary} />
        <Text style={styles.signatureNoteText}>
          A formal agreement will be sent for e-signature after approval
        </Text>
      </View>
    </View>
  );

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0:
        return renderPartnerTypeStep();
      case 1:
        return renderPersonalInfoStep();
      case 2:
        return renderPropertyStep();
      case 3:
        return renderDocumentsStep();
      case 4:
        return renderDealPreviewStep();
      case 5:
        return renderDisclosureStep();
      default:
        return null;
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{STEPS[currentStep].title}</Text>
        <Text style={styles.headerStep}>Step {currentStep + 1} of {STEPS.length}</Text>
      </View>

      {renderStepIndicator()}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {renderCurrentStep()}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.footerButton, styles.footerButtonSecondary]}
          onPress={currentStep === 0 ? () => router.back() : prevStep}
        >
          <ChevronLeft size={20} color={Colors.text} />
          <Text style={styles.footerButtonSecondaryText}>
            {currentStep === 0 ? 'Cancel' : 'Back'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.footerButton,
            styles.footerButtonPrimary,
            currentStep === STEPS.length - 1 && !formData.controlDisclosureAccepted && styles.footerButtonDisabled,
          ]}
          onPress={currentStep === STEPS.length - 1 ? handleSubmit : nextStep}
          disabled={isSubmitting || (currentStep === STEPS.length - 1 && !formData.controlDisclosureAccepted)}
        >
          {isSubmitting ? (
            <ShimmerIndicator size="small" color={Colors.background} />
          ) : (
            <>
              <Text style={styles.footerButtonPrimaryText}>
                {currentStep === STEPS.length - 1 ? 'Submit Application' : 'Continue'}
              </Text>
              <ChevronRight size={20} color={Colors.background} />
            </>
          )}
        </TouchableOpacity>
      </View>

      <Modal
        visible={showInfoModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInfoModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowInfoModal(false)}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{infoModalContent.title}</Text>
              <TouchableOpacity onPress={() => setShowInfoModal(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              <Text style={styles.modalText}>{infoModalContent.content}</Text>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showCompModal}
        transparent
        animationType="slide"
        onRequestClose={() => !compSearching && setShowCompModal(false)}
      >
        <View style={styles.compModalOverlay}>
          <View style={[styles.compModalContent, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.compModalHeader}>
              <View style={styles.compModalTitleRow}>
                <Sparkles size={24} color={Colors.primary} />
                <Text style={styles.compModalTitle}>AI Comp Analysis</Text>
              </View>
              {!compSearching && (
                <TouchableOpacity onPress={() => setShowCompModal(false)}>
                  <X size={24} color={Colors.text} />
                </TouchableOpacity>
              )}
            </View>

            {compSearching ? (
              <View style={styles.compLoadingContainer}>
                <ShimmerIndicator size="large" color={Colors.primary} />
                <Text style={styles.compLoadingText}>Searching public records...</Text>
                <Text style={styles.compLoadingSubtext}>Analyzing comparable sales within 3 miles</Text>
              </View>
            ) : compResults ? (
              <ScrollView style={styles.compResultsScroll} showsVerticalScrollIndicator={false}>
                <View style={styles.compSubjectCard}>
                  <Text style={styles.compSubjectLabel}>Subject Property</Text>
                  <Text style={styles.compSubjectAddress}>{compResults.subjectProperty.address}</Text>
                  <Text style={styles.compSubjectDetails}>
                    {compResults.subjectProperty.city}, {compResults.subjectProperty.state} • {new Intl.NumberFormat('en-US').format(compResults.subjectProperty.lotSize)} {compResults.subjectProperty.lotSizeUnit}
                  </Text>
                </View>

                <View style={styles.compMarketCard}>
                  <Text style={styles.compSectionTitle}>Market Analysis</Text>
                  <View style={styles.compMarketGrid}>
                    <View style={styles.compMarketItem}>
                      <Text style={styles.compMarketValue}>{formatCurrency(compResults.marketAnalysis.averagePrice)}</Text>
                      <Text style={styles.compMarketLabel}>Avg Price</Text>
                    </View>
                    <View style={styles.compMarketItem}>
                      <Text style={styles.compMarketValue}>{formatCurrency(compResults.marketAnalysis.medianPrice)}</Text>
                      <Text style={styles.compMarketLabel}>Median</Text>
                    </View>
                    <View style={styles.compMarketItem}>
                      <Text style={styles.compMarketValue}>${compResults.marketAnalysis.averagePricePerSqft.toFixed(0)}/sf</Text>
                      <Text style={styles.compMarketLabel}>Avg $/SqFt</Text>
                    </View>
                    <View style={styles.compMarketItem}>
                      <View style={[
                        styles.compTrendBadge,
                        compResults.marketAnalysis.marketTrend === 'rising' && styles.compTrendRising,
                        compResults.marketAnalysis.marketTrend === 'declining' && styles.compTrendDeclining,
                      ]}>
                        <TrendingUp size={12} color={
                          compResults.marketAnalysis.marketTrend === 'rising' ? Colors.success :
                          compResults.marketAnalysis.marketTrend === 'declining' ? Colors.error : Colors.warning
                        } />
                        <Text style={[
                          styles.compTrendText,
                          compResults.marketAnalysis.marketTrend === 'rising' && { color: Colors.success },
                          compResults.marketAnalysis.marketTrend === 'declining' && { color: Colors.error },
                        ]}>{compResults.marketAnalysis.marketTrend}</Text>
                      </View>
                      <Text style={styles.compMarketLabel}>Trend</Text>
                    </View>
                  </View>

                  <View style={styles.compRecommendedCard}>
                    <View style={styles.compRecommendedHeader}>
                      <BarChart3 size={18} color={Colors.primary} />
                      <Text style={styles.compRecommendedLabel}>AI Recommended Value</Text>
                    </View>
                    <Text style={styles.compRecommendedValue}>{formatCurrency(compResults.marketAnalysis.recommendedValue)}</Text>
                    <View style={styles.compConfidenceRow}>
                      <View style={styles.compConfidenceBar}>
                        <View style={[styles.compConfidenceFill, { width: `${compResults.marketAnalysis.confidenceScore}%` }]} />
                      </View>
                      <Text style={styles.compConfidenceText}>{compResults.marketAnalysis.confidenceScore}% confidence</Text>
                    </View>
                    <TouchableOpacity style={styles.applyValueButton} onPress={applyRecommendedValue}>
                      <Check size={16} color={Colors.background} />
                      <Text style={styles.applyValueText}>Apply This Value</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.compListSection}>
                  <Text style={styles.compSectionTitle}>Comparable Sales ({compResults.comparables.length})</Text>
                  {compResults.comparables.map((comp, index) => (
                    <View key={index} style={styles.compCard}>
                      <View style={styles.compCardHeader}>
                        <View style={styles.compCardIndex}>
                          <Text style={styles.compCardIndexText}>{index + 1}</Text>
                        </View>
                        <View style={styles.compCardInfo}>
                          <Text style={styles.compCardAddress}>{comp.address}</Text>
                          <Text style={styles.compCardLocation}>{comp.city}, {comp.state}</Text>
                        </View>
                        <View style={styles.compCardPrice}>
                          <Text style={styles.compCardPriceValue}>{formatCurrency(comp.salePrice)}</Text>
                        </View>
                      </View>
                      <View style={styles.compCardDetails}>
                        <View style={styles.compCardDetail}>
                          <Navigation size={12} color={Colors.textTertiary} />
                          <Text style={styles.compCardDetailText}>{comp.distance.toFixed(1)} mi</Text>
                        </View>
                        <View style={styles.compCardDetail}>
                          <MapPin size={12} color={Colors.textTertiary} />
                          <Text style={styles.compCardDetailText}>{new Intl.NumberFormat('en-US').format(comp.lotSize)} {comp.lotSizeUnit}</Text>
                        </View>
                        <View style={styles.compCardDetail}>
                          <Calendar size={12} color={Colors.textTertiary} />
                          <Text style={styles.compCardDetailText}>{comp.saleDate}</Text>
                        </View>
                        <View style={styles.compCardDetail}>
                          <DollarSign size={12} color={Colors.textTertiary} />
                          <Text style={styles.compCardDetailText}>${new Intl.NumberFormat('en-US').format(Math.round(comp.pricePerSqft))}/sf</Text>
                        </View>
                      </View>
                      <Text style={styles.compCardSource}>Source: {comp.source}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.compInsightsSection}>
                  <Text style={styles.compSectionTitle}>Market Insights</Text>
                  {compResults.insights.map((insight, index) => (
                    <View key={index} style={styles.compInsightItem}>
                      <Info size={14} color={Colors.info} />
                      <Text style={styles.compInsightText}>{insight}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.compDisclaimer}>
                  <AlertCircle size={14} color={Colors.textTertiary} />
                  <Text style={styles.compDisclaimerText}>
                    AI-generated estimates based on public records and market data. Professional appraisal recommended for final valuation.
                  </Text>
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12},
  headerTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800' as const},
  headerStep: {
    color: Colors.textTertiary,
    fontSize: 13},
  stepIndicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 0},
  stepIndicatorItem: {
    alignItems: 'center'},
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.surfaceBorder},
  stepDotActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  stepDotCompleted: {
    backgroundColor: Colors.success,
    borderColor: Colors.success},
  stepLine: {
    width: 20,
    height: 2,
    backgroundColor: Colors.surfaceBorder},
  stepLineCompleted: {
    backgroundColor: Colors.success},
  scrollView: {
    flex: 1,
    backgroundColor: Colors.background},
  scrollContent: {
    padding: 20,
    paddingBottom: 140},
  stepContent: {
    gap: 16},
  stepTitle: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '800' as const,
    marginBottom: 4},
  stepSubtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    marginBottom: 8},
  partnerCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder},
  partnerCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08'},
  partnerCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10},
  partnerIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center'},
  partnerCardInfo: {
    flex: 1},
  partnerCardTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const},
  partnerCardSubtitle: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2},
  selectedBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3},
  partnerCardDesc: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10},
  partnerCardFeatures: {
    gap: 6},
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  featureText: {
    color: Colors.textSecondary,
    fontSize: 13},
  infoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder},
  infoButtonText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '600' as const},
  formRow: {
    flexDirection: 'row',
    gap: 12},
  formHalf: {
    flex: 1},
  formQuarter: {
    flex: 0.5},
  inputLabel: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
    marginBottom: 6},
  inputContainer: {
    gap: 6},
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    color: Colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  inputNoPadding: {
    paddingVertical: 0},
  textAreaContainer: {
    gap: 6},
  textArea: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    color: Colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    minHeight: 100,
    textAlignVertical: 'top'},
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  unitButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8},
  unitButtonActive: {
    backgroundColor: Colors.primary},
  unitButtonText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600' as const},
  unitButtonTextActive: {
    color: Colors.black},
  documentCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  documentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12},
  documentIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center'},
  documentInfo: {
    flex: 1},
  documentTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const},
  documentSubtitle: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2},
  uploadButton: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center'},
  uploadButtonText: {
    color: Colors.black,
    fontWeight: '700' as const,
    fontSize: 14},
  documentUploaded: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  documentStatus: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4},
  documentStatusText: {
    fontSize: 11,
    fontWeight: '700' as const},
  removeDocButton: {
    padding: 4},
  verificationNote: {
    backgroundColor: Colors.info + '10',
    borderRadius: 8,
    padding: 10,
    marginTop: 8},
  verificationNoteText: {
    color: Colors.info,
    fontSize: 12,
    lineHeight: 16},
  dealCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  dealHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14},
  dealHeaderTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700' as const},
  termBadge: {
    backgroundColor: Colors.primary + '20',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4},
  termBadgeText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '700' as const},
  dealTermsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14},
  dealTermItem: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center'},
  dealTermValue: {
    color: Colors.primary,
    fontSize: 18,
    fontWeight: '800' as const},
  dealTermLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 2},
  calculationCard: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14,
    gap: 8},
  calculationTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
    marginBottom: 4},
  calculationNote: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginBottom: 4},
  calculationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'},
  calculationLabel: {
    color: Colors.textSecondary,
    fontSize: 13},
  calculationValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const},
  calculationValueSmall: {
    color: Colors.textTertiary,
    fontSize: 12},
  highlightValue: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: '800' as const},
  divider: {
    height: 1,
    backgroundColor: Colors.surfaceBorder,
    marginVertical: 4},
  totalReturnCard: {
    backgroundColor: Colors.success + '10',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.success + '20'},
  totalReturnLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginBottom: 4},
  totalReturnValue: {
    color: Colors.success,
    fontSize: 24,
    fontWeight: '800' as const},
  totalReturnNote: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 4},
  disclaimerCard: {
    backgroundColor: Colors.warning + '10',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.warning + '20'},
  disclaimerText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17},
  disclosureCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden'},
  disclosureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  disclosureTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const},
  disclosureContent: {
    padding: 16},
  disclosureText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12},
  disclosureBold: {
    color: Colors.text,
    fontWeight: '700' as const},
  disclosureSection: {
    marginBottom: 12},
  disclosureList: {
    gap: 6,
    marginLeft: 8},
  disclosureListItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8},
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    marginTop: 8},
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center'},
  checkboxChecked: {
    backgroundColor: Colors.success,
    borderColor: Colors.success},
  checkboxLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    flex: 1,
    lineHeight: 18},
  signatureNote: {
    backgroundColor: Colors.info + '10',
    borderRadius: 10,
    padding: 12},
  signatureNoteText: {
    color: Colors.info,
    fontSize: 12,
    lineHeight: 17},
  accreditedSection: {
    gap: 10},
  accreditedHeader: {
    gap: 4},
  accreditedTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const},
  accreditedNote: {
    color: Colors.textTertiary,
    fontSize: 12},
  accreditedOption: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder},
  accreditedOptionSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08'},
  accreditedOptionText: {
    flex: 1},
  accreditedOptionTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const},
  accreditedOptionDesc: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2},
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1},
  radioCircleSelected: {
    borderColor: Colors.primary},
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.primary},
  paymentStructureSection: {
    gap: 10},
  sectionLabel: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const},
  sectionNote: {
    color: Colors.textTertiary,
    fontSize: 12},
  paymentOptions: {
    flexDirection: 'row',
    gap: 10},
  paymentOption: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.surfaceBorder},
  paymentOptionSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08'},
  paymentOptionText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600' as const},
  paymentOptionTextSelected: {
    color: Colors.primary},
  paymentInfoBox: {
    backgroundColor: Colors.info + '10',
    borderRadius: 10,
    padding: 12},
  paymentInfoText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17},
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    backgroundColor: Colors.background},
  footerButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center'},
  footerButtonSecondary: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  footerButtonSecondaryText: {
    color: Colors.text,
    fontWeight: '600' as const,
    fontSize: 15},
  footerButtonPrimary: {
    backgroundColor: Colors.primary},
  footerButtonPrimaryText: {
    color: Colors.black,
    fontWeight: '700' as const,
    fontSize: 15},
  footerButtonDisabled: {
    opacity: 0.4},
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    padding: 20},
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    maxHeight: '80%'},
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16},
  modalTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800' as const},
  modalBody: {
    gap: 12},
  modalText: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 20},
  aiCompButton: {
    borderRadius: 14,
    overflow: 'hidden'},
  aiCompButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.primary + '10',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '20'},
  aiCompIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center'},
  aiCompTextContainer: {
    flex: 1},
  aiCompButtonTitle: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700' as const},
  aiCompButtonSubtitle: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2},
  compModalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end'},
  compModalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '90%'},
  compModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16},
  compModalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  compModalTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800' as const},
  compLoadingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12},
  compLoadingText: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600' as const},
  compLoadingSubtext: {
    color: Colors.textTertiary,
    fontSize: 13},
  compResultsScroll: {
    gap: 12},
  compSubjectCard: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14},
  compSubjectLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: '700' as const,
    marginBottom: 4},
  compSubjectAddress: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600' as const},
  compSubjectDetails: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginTop: 4},
  compMarketCard: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14},
  compSectionTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
    marginBottom: 10},
  compMarketGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8},
  compMarketItem: {
    flex: 1,
    minWidth: '45%',
    alignItems: 'center',
    padding: 8},
  compMarketValue: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const},
  compMarketLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 2},
  compTrendBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'center',
    marginTop: 8},
  compTrendRising: {
    backgroundColor: Colors.success + '15'},
  compTrendDeclining: {
    backgroundColor: Colors.error + '15'},
  compTrendText: {
    fontSize: 12,
    fontWeight: '600' as const},
  compRecommendedCard: {
    backgroundColor: Colors.primary + '10',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.primary + '20'},
  compRecommendedHeader: {
    marginBottom: 8},
  compRecommendedLabel: {
    color: Colors.textSecondary,
    fontSize: 12},
  compRecommendedValue: {
    color: Colors.primary,
    fontSize: 24,
    fontWeight: '800' as const},
  compConfidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    marginBottom: 12},
  compConfidenceBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.surfaceBorder},
  compConfidenceFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary},
  compConfidenceText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const},
  applyValueButton: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 20},
  applyValueText: {
    color: Colors.black,
    fontWeight: '700' as const,
    fontSize: 14},
  compListSection: {
    gap: 8},
  compCard: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14},
  compCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8},
  compCardIndex: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  compCardIndexText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700' as const},
  compCardInfo: {
    flex: 1},
  compCardAddress: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const},
  compCardLocation: {
    color: Colors.textTertiary,
    fontSize: 12},
  compCardPrice: {
    alignItems: 'flex-end'},
  compCardPriceValue: {
    color: Colors.success,
    fontSize: 15,
    fontWeight: '700' as const},
  compCardDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8},
  compCardDetail: {
    backgroundColor: Colors.surface,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4},
  compCardDetailText: {
    color: Colors.textSecondary,
    fontSize: 11},
  compCardSource: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 6},
  compInsightsSection: {
    gap: 6},
  compInsightItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8},
  compInsightText: {
    color: Colors.textSecondary,
    fontSize: 13,
    flex: 1,
    lineHeight: 18},
  compDisclaimer: {
    backgroundColor: Colors.warning + '08',
    borderRadius: 10,
    padding: 12},
  compDisclaimerText: {
    color: Colors.textTertiary,
    fontSize: 11,
    lineHeight: 16}});
