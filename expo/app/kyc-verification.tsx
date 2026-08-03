import React, { useState, useMemo, useRef, useEffect } from 'react';
import logger from '@/lib/logger';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Image,
  Platform,
  Modal,
  FlatList,
  Animated,
  KeyboardAvoidingView} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import {
  ArrowLeft,
  Camera,
  CheckCircle,
  AlertTriangle,
  Shield,
  FileText,
  User,
  MapPin,
  Calendar,
  IdCard,
  Upload,
  RefreshCw,
  ChevronRight,
  Info,
  X,
  ChevronDown,
  Search,
  CreditCard,
  Eye,
  Smile,
  RotateCcw,
  Database,
  Globe,
  ShieldCheck,
  Fingerprint,
  ScanFace,
  CheckCircle2,
  XCircle,
  Clock,
  Building,
  Hash,
  ImageIcon} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { COUNTRIES, Country, getCountryByName } from '@/constants/countries';
import {
  performFullVerification,
  performLivenessDetection,
  VerificationResult,
  VerificationCheck,
  LivenessChallenge,
  getRiskColor,
  getStatusColor} from '@/lib/verification-service';
import { supabase } from '@/lib/supabase';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type KYCStep = 'personal' | 'documents' | 'selfie' | 'liveness' | 'verification' | 'review';
type DocumentStatus = 'pending' | 'uploading' | 'uploaded' | 'verified' | 'rejected';

interface DocumentState {
  uri: string | null;
  status: DocumentStatus;
}

export default function KYCVerificationScreen() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<KYCStep>('personal');
  const [isLoading, setIsLoading] = useState(false);

  const [personalInfo, setPersonalInfo] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    nationality: 'United States',
    nationalityCode: 'US',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'United States',
    countryCode: 'US',
    passportNumber: '',
    taxId: '',
    ssn: '',
    investingAsCompany: false,
    companyName: '',
    companyEin: '',
    companyTaxId: ''});

  const [showNationalityPicker, setShowNationalityPicker] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');

  const filteredCountries = useMemo(() => 
    COUNTRIES.filter(country =>
      country.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
      country.code.toLowerCase().includes(countrySearch.toLowerCase())
    ), [countrySearch]
  );

  const selectedCountryInfo = useMemo(() => 
    getCountryByName(personalInfo.country) || COUNTRIES.find(c => c.code === 'US')!,
    [personalInfo.country]
  );

  const [documents, setDocuments] = useState<{
    governmentId: DocumentState;
    proofOfAddress: DocumentState;
    selfie: DocumentState;
  }>({
    governmentId: { uri: null, status: 'pending' },
    proofOfAddress: { uri: null, status: 'pending' },
    selfie: { uri: null, status: 'pending' }});

  const [selectedIdType, setSelectedIdType] = useState<'drivers_license' | 'passport' | 'national_id'>('drivers_license');

  const [livenessState, setLivenessState] = useState<{
    isRunning: boolean;
    currentChallenge: number;
    challenges: LivenessChallenge[];
    completed: boolean;
    confidence: number;
  }>({
    isRunning: false,
    currentChallenge: 0,
    challenges: [
      { type: 'blink', completed: false },
      { type: 'smile', completed: false },
      { type: 'turn_left', completed: false },
    ],
    completed: false,
    confidence: 0});

  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [verificationProgress, setVerificationProgress] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const updatePersonalInfo = (key: keyof typeof personalInfo, value: string) => {
    setPersonalInfo(prev => ({ ...prev, [key]: value }));
  };

  const isUSResident = personalInfo.countryCode === 'US' || personalInfo.nationalityCode === 'US';

  const validatePersonalInfo = (): boolean => {
    if (!personalInfo.firstName || !personalInfo.lastName) {
      Alert.alert('Missing Information', 'Please enter your full name.');
      return false;
    }
    if (!personalInfo.dateOfBirth) {
      Alert.alert('Missing Information', 'Please enter your date of birth.');
      return false;
    }
    if (!personalInfo.address || !personalInfo.city || !personalInfo.state || !personalInfo.zipCode) {
      Alert.alert('Missing Information', 'Please enter your complete address.');
      return false;
    }
    if (!personalInfo.passportNumber) {
      Alert.alert('Missing Information', 'Please enter your ID or passport number.');
      return false;
    }
    if (isUSResident && !personalInfo.ssn) {
      Alert.alert('Missing Information', 'Please enter your Social Security Number (SSN).');
      return false;
    }
    if (!isUSResident && !personalInfo.taxId) {
      Alert.alert('Missing Information', `Please enter your ${selectedCountryInfo.taxIdLabel}.`);
      return false;
    }
    if (personalInfo.investingAsCompany) {
      if (!personalInfo.companyName) {
        Alert.alert('Missing Information', 'Please enter your company name.');
        return false;
      }
      if (!personalInfo.companyEin) {
        Alert.alert('Missing Information', 'Please enter your company EIN number.');
        return false;
      }
      if (!personalInfo.companyTaxId) {
        Alert.alert('Missing Information', 'Please enter your company Tax ID.');
        return false;
      }
    }
    return true;
  };

  const submitPersonalInfoToBackend = async () => {
    try {
      logger.kyc.log('Submitting personal info to backend...');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      await supabase.from('kyc_verifications').upsert({
        user_id: user.id,
        first_name: personalInfo.firstName,
        last_name: personalInfo.lastName,
        date_of_birth: personalInfo.dateOfBirth,
        nationality: personalInfo.nationality,
        nationality_code: personalInfo.nationalityCode,
        tax_id: personalInfo.taxId,
        street: personalInfo.address,
        city: personalInfo.city,
        state: personalInfo.state,
        postal_code: personalInfo.zipCode,
        country: personalInfo.country,
        country_code: personalInfo.countryCode,
        updated_at: new Date().toISOString()});
      logger.kyc.log('Personal info + address submitted to backend');
    } catch (error) {
      console.error('[KYC] Backend submit error (non-blocking):', error);
    }
  };

  const uploadToSupabaseStorage = async (uri: string, userId: string, docType: string): Promise<string> => {
    const KYC_BUCKET = 'kyc-documents';
    const timestamp = Date.now();
    const rand = Math.random().toString(36).substring(2, 8);
    const ext = uri.toLowerCase().includes('.png') ? 'png' : 'jpg';
    const filePath = `${userId}/${docType}_${timestamp}_${rand}.${ext}`;

    try {
      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
        const { error: uploadError } = await supabase.storage
          .from(KYC_BUCKET)
          .upload(filePath, blob, { contentType: `image/${ext}`, upsert: true });

        if (uploadError) {
          if (uploadError.message?.includes('Bucket not found') || uploadError.message?.includes('not found')) {
            logger.kyc.log('KYC bucket not found, creating...');
            await supabase.storage.createBucket(KYC_BUCKET, {
              public: false,
              fileSizeLimit: 10 * 1024 * 1024,
              allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']});
            const { error: retryError } = await supabase.storage
              .from(KYC_BUCKET)
              .upload(filePath, blob, { contentType: `image/${ext}`, upsert: true });
            if (retryError) throw retryError;
          } else {
            throw uploadError;
          }
        }
      } else {
        const localFile = new File(uri);
        const base64 = await localFile.base64();
        const raw = atob(base64);
        const arr = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
          arr[i] = raw.charCodeAt(i);
        }
        const blob = new Blob([arr], { type: `image/${ext}` });

        const { error: uploadError } = await supabase.storage
          .from(KYC_BUCKET)
          .upload(filePath, blob, { contentType: `image/${ext}`, upsert: true });

        if (uploadError) {
          if (uploadError.message?.includes('Bucket not found') || uploadError.message?.includes('not found')) {
            logger.kyc.log('KYC bucket not found, creating...');
            await supabase.storage.createBucket(KYC_BUCKET, {
              public: false,
              fileSizeLimit: 10 * 1024 * 1024,
              allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']});
            const { error: retryError } = await supabase.storage
              .from(KYC_BUCKET)
              .upload(filePath, blob, { contentType: `image/${ext}`, upsert: true });
            if (retryError) throw retryError;
          } else {
            throw uploadError;
          }
        }
      }

      const { data: urlData } = supabase.storage.from(KYC_BUCKET).getPublicUrl(filePath);
      logger.kyc.log(`KYC doc uploaded to storage: ${filePath}`);
      return urlData?.publicUrl || filePath;
    } catch (err) {
      logger.kyc.log(`KYC storage upload failed (${docType}): ${(err as Error)?.message} — falling back to URI`);
      return uri;
    }
  };

  const uploadDocumentToBackend = async (type: string, uri: string) => {
    try {
      logger.kyc.log(`Uploading ${type} to backend...`);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const storageUrl = await uploadToSupabaseStorage(uri, user.id, type);

      await supabase.from('kyc_documents').insert({
        user_id: user.id,
        document_type: type,
        document_url: storageUrl,
        issuing_country: personalInfo.countryCode,
        created_at: new Date().toISOString()});
      logger.kyc.log(`${type} uploaded to backend (storage URL: ${storageUrl.substring(0, 60)}...)`);
    } catch (error) {
      console.error(`[KYC] Document upload error (non-blocking):`, error);
    }
  };

  const submitSelfieToBackend = async (uri: string) => {
    try {
      logger.kyc.log('Submitting selfie to backend...');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const storageUrl = await uploadToSupabaseStorage(uri, user.id, 'selfie');

      await supabase.from('kyc_documents').insert({
        user_id: user.id,
        document_type: 'selfie',
        document_url: storageUrl,
        created_at: new Date().toISOString()});
      logger.kyc.log(`Selfie submitted to backend (storage URL: ${storageUrl.substring(0, 60)}...)`);
    } catch (error) {
      console.error('[KYC] Selfie submit error (non-blocking):', error);
    }
  };

  const selectNationality = (country: Country) => {
    setPersonalInfo(prev => ({
      ...prev,
      nationality: country.name,
      nationalityCode: country.code}));
    setShowNationalityPicker(false);
    setCountrySearch('');
  };

  const selectCountry = (country: Country) => {
    setPersonalInfo(prev => ({
      ...prev,
      country: country.name,
      countryCode: country.code}));
    setShowCountryPicker(false);
    setCountrySearch('');
  };

  const renderCountryItem = ({ item }: { item: Country }) => (
    <TouchableOpacity
      style={styles.countryItem}
      onPress={() => {
        if (showNationalityPicker) {
          selectNationality(item);
        } else {
          selectCountry(item);
        }
      }}
    >
      <Text style={styles.countryItemName}>{item.name}</Text>
      <Text style={styles.countryItemCode}>{item.code}</Text>
    </TouchableOpacity>
  );

  const [showUploadPicker, setShowUploadPicker] = useState(false);
  const [pendingUploadType, setPendingUploadType] = useState<'governmentId' | 'proofOfAddress' | 'selfie' | null>(null);

  const showDocumentPickerOptions = (type: 'governmentId' | 'proofOfAddress' | 'selfie') => {
    if (Platform.OS === 'web') {
      void launchDocumentPicker(type, 'gallery');
      return;
    }
    setPendingUploadType(type);
    setShowUploadPicker(true);
  };

  const launchDocumentPicker = async (type: 'governmentId' | 'proofOfAddress' | 'selfie', source: 'camera' | 'gallery') => {
    setShowUploadPicker(false);
    setPendingUploadType(null);

    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant camera permissions to take a photo.');
        return;
      }
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant photo library permissions to upload documents.');
        return;
      }
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: type === 'selfie' ? [1, 1] : [4, 3],
      quality: 0.8};

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

    if (!result.canceled && result.assets[0]) {
      const assetUri = result.assets[0].uri;
      setDocuments(prev => ({
        ...prev,
        [type]: { uri: assetUri, status: 'uploading' }}));

      const docTypeMap: Record<string, string> = {
        governmentId: selectedIdType,
        proofOfAddress: 'proof_of_address',
        selfie: 'selfie'};

      if (type === 'selfie') {
        void submitSelfieToBackend(assetUri);
      } else {
        void uploadDocumentToBackend(docTypeMap[type] || type, assetUri);
      }

      setTimeout(() => {
        setDocuments(prev => ({
          ...prev,
          [type]: { uri: assetUri, status: 'uploaded' }}));
      }, 1500);
    }
  };

  const pickDocument = async (type: 'governmentId' | 'proofOfAddress' | 'selfie') => {
    showDocumentPickerOptions(type);
  };

  const removeDocument = (type: 'governmentId' | 'proofOfAddress' | 'selfie') => {
    setDocuments(prev => ({
      ...prev,
      [type]: { uri: null, status: 'pending' }}));
  };

  const handleNextStep = async () => {
    switch (currentStep) {
      case 'personal':
        if (validatePersonalInfo()) {
          setIsLoading(true);
          await submitPersonalInfoToBackend();
          setIsLoading(false);
          setCurrentStep('documents');
        }
        break;
      case 'documents':
        if (!documents.governmentId.uri) {
          Alert.alert('Missing Document', 'Please upload your government-issued ID.');
          return;
        }
        if (!documents.proofOfAddress.uri) {
          Alert.alert('Missing Document', 'Please upload your proof of address.');
          return;
        }
        setCurrentStep('selfie');
        break;
      case 'selfie':
        if (!documents.selfie.uri) {
          Alert.alert('Missing Selfie', 'Please take a selfie for identity verification.');
          return;
        }
        setCurrentStep('liveness');
        break;
      case 'liveness':
        if (!livenessState.completed) {
          Alert.alert('Liveness Required', 'Please complete the liveness verification.');
          return;
        }
        setCurrentStep('verification');
        void startFullVerification();
        break;
      case 'verification':
        setCurrentStep('review');
        break;
      case 'review':
        void submitKYC();
        break;
    }
  };

  const submitKYC = async () => {
    setIsLoading(true);
    logger.kyc.log('Submitting final KYC:', { personalInfo, documents: Object.keys(documents), verificationResult: !!verificationResult });

    const isApproved = verificationResult?.success;
    const newKycStatus = isApproved ? 'approved' : 'in_review';

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('kyc_verifications').update({
          status: 'submitted',
          verification_score: verificationResult?.score ?? null,
          risk_level: verificationResult?.riskLevel ?? null,
          verification_passed: isApproved ?? false,
          submitted_at: new Date().toISOString()}).eq('user_id', user.id);

        await supabase.from('profiles').update({
          kyc_status: newKycStatus}).eq('id', user.id);

        logger.kyc.log('KYC submitted + profile kyc_status synced to:', newKycStatus);
      }
    } catch (error) {
      console.error('[KYC] Submit for review error:', error);
    }

    setIsLoading(false);
    Alert.alert(
      isApproved ? 'KYC Approved' : 'KYC Submitted for Review',
      isApproved 
        ? 'Your identity has been verified successfully. You can now access all features.'
        : 'Your verification requires manual review. Our team will review within 1-3 business days.',
      [
        {
          text: 'Done',
          onPress: () => router.replace('/(tabs)/profile' as any)},
      ]
    );
  };

  const getStepNumber = (step: KYCStep): number => {
    const steps: KYCStep[] = ['personal', 'documents', 'selfie', 'liveness', 'verification', 'review'];
    return steps.indexOf(step) + 1;
  };

  const getTotalSteps = () => 6;

  useEffect(() => {
    if (livenessState.isRunning) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 800,
            useNativeDriver: true}),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true}),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [livenessState.isRunning, pulseAnim]);

  const startLivenessCheck = async () => {
    logger.kyc.log('Starting liveness check...');
    setLivenessState(prev => ({ ...prev, isRunning: true }));

    for (let i = 0; i < livenessState.challenges.length; i++) {
      setLivenessState(prev => ({ ...prev, currentChallenge: i }));
      await new Promise(resolve => setTimeout(resolve, 2000));
      setLivenessState(prev => ({
        ...prev,
        challenges: prev.challenges.map((c, idx) =>
          idx === i ? { ...c, completed: true } : c
        )}));
    }

    const result = await performLivenessDetection();
    setLivenessState(prev => ({
      ...prev,
      isRunning: false,
      completed: result.isLive,
      confidence: result.confidence}));

    if (result.isLive) {
      logger.kyc.log('Liveness check passed');
    } else {
      Alert.alert('Verification Failed', 'Could not verify liveness. Please try again.');
    }
  };

  const startFullVerification = async () => {
    logger.kyc.log('Starting full verification process...');
    setIsLoading(true);
    setVerificationProgress(0);

    Animated.timing(progressAnim, {
      toValue: 100,
      duration: 10000,
      useNativeDriver: false}).start();

    const progressInterval = setInterval(() => {
      setVerificationProgress(prev => Math.min(prev + 5, 95));
    }, 500);

    try {
      const result = await performFullVerification({
        selfieUri: documents.selfie.uri || '',
        documentUri: documents.governmentId.uri || '',
        firstName: personalInfo.firstName,
        lastName: personalInfo.lastName,
        dateOfBirth: personalInfo.dateOfBirth,
        nationality: personalInfo.nationality,
        passportNumber: personalInfo.passportNumber,
        taxId: personalInfo.taxId});

      clearInterval(progressInterval);
      setVerificationProgress(100);
      setVerificationResult(result);
      setCurrentStep('review');
    } catch (error) {
      console.error('[KYC] Verification error:', error);
      Alert.alert('Verification Error', 'An error occurred during verification. Please try again.');
    } finally {
      clearInterval(progressInterval);
      setIsLoading(false);
    }
  };

  const getChallengeIcon = (type: string) => {
    switch (type) {
      case 'blink': return <Eye size={24} color={Colors.primary} />;
      case 'smile': return <Smile size={24} color={Colors.primary} />;
      case 'turn_left': return <RotateCcw size={24} color={Colors.primary} />;
      case 'turn_right': return <RotateCcw size={24} color={Colors.primary} style={{ transform: [{ scaleX: -1 }] }} />;
      default: return <ScanFace size={24} color={Colors.primary} />;
    }
  };

  const getChallengeText = (type: string) => {
    switch (type) {
      case 'blink': return 'Blink your eyes';
      case 'smile': return 'Smile naturally';
      case 'turn_left': return 'Turn head left slowly';
      case 'turn_right': return 'Turn head right slowly';
      case 'nod': return 'Nod your head';
      default: return 'Follow instructions';
    }
  };

  const renderPersonalInfoStep = () => (
    <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.stepHeader}>
        <View style={styles.stepIcon}>
          <User size={24} color={Colors.primary} />
        </View>
        <Text style={styles.stepTitle}>Personal Information</Text>
        <Text style={styles.stepSubtitle}>Provide your legal name and address as it appears on your ID</Text>
      </View>

      <View style={styles.formSection}>
        <View style={styles.inputRow}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>First Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Legal first name"
              placeholderTextColor={Colors.textTertiary}
              value={personalInfo.firstName}
              onChangeText={(text) => updatePersonalInfo('firstName', text)}
              autoCapitalize="words"
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1, marginLeft: 12 }]}>
            <Text style={styles.inputLabel}>Last Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Legal last name"
              placeholderTextColor={Colors.textTertiary}
              value={personalInfo.lastName}
              onChangeText={(text) => updatePersonalInfo('lastName', text)}
              autoCapitalize="words"
            />
          </View>
        </View>

        <View style={styles.inputRow}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Date of Birth *</Text>
            <View style={styles.inputWithIcon}>
              <Calendar size={18} color={Colors.textTertiary} />
              <TextInput
                style={styles.inputIconText}
                placeholder="MM/DD/YYYY"
                placeholderTextColor={Colors.textTertiary}
                value={personalInfo.dateOfBirth}
                onChangeText={(text) => updatePersonalInfo('dateOfBirth', text)}
                keyboardType="numbers-and-punctuation"
              />
            </View>
          </View>
          <View style={[styles.inputGroup, { flex: 1, marginLeft: 12 }]}>
            <Text style={styles.inputLabel}>Nationality *</Text>
            <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => setShowNationalityPicker(true)}
            >
              <Text style={styles.pickerButtonText}>{personalInfo.nationality}</Text>
              <ChevronDown size={18} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Street Address *</Text>
          <View style={styles.inputWithIcon}>
            <MapPin size={18} color={Colors.textTertiary} />
            <TextInput
              style={styles.inputIconText}
              placeholder="123 Main Street, Apt 4B"
              placeholderTextColor={Colors.textTertiary}
              value={personalInfo.address}
              onChangeText={(text) => updatePersonalInfo('address', text)}
            />
          </View>
        </View>

        <View style={styles.inputRow}>
          <View style={[styles.inputGroup, { flex: 2 }]}>
            <Text style={styles.inputLabel}>City *</Text>
            <TextInput
              style={styles.input}
              placeholder="Miami"
              placeholderTextColor={Colors.textTertiary}
              value={personalInfo.city}
              onChangeText={(text) => updatePersonalInfo('city', text)}
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1, marginLeft: 12 }]}>
            <Text style={styles.inputLabel}>State *</Text>
            <TextInput
              style={styles.input}
              placeholder="FL"
              placeholderTextColor={Colors.textTertiary}
              value={personalInfo.state}
              onChangeText={(text) => updatePersonalInfo('state', text)}
            />
          </View>
        </View>

        <View style={styles.inputRow}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Zip/Postal Code *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter code"
              placeholderTextColor={Colors.textTertiary}
              value={personalInfo.zipCode}
              onChangeText={(text) => updatePersonalInfo('zipCode', text)}
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1, marginLeft: 12 }]}>
            <Text style={styles.inputLabel}>Country *</Text>
            <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => setShowCountryPicker(true)}
            >
              <Text style={styles.pickerButtonText} numberOfLines={1}>{personalInfo.country}</Text>
              <ChevronDown size={18} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.sectionDivider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>Identity Documents</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>ID / Passport Number *</Text>
          <View style={styles.inputWithIcon}>
            <CreditCard size={18} color={Colors.textTertiary} />
            <TextInput
              style={styles.inputIconText}
              placeholder="Enter your ID or passport number"
              placeholderTextColor={Colors.textTertiary}
              value={personalInfo.passportNumber}
              onChangeText={(text) => updatePersonalInfo('passportNumber', text.toUpperCase())}
              autoCapitalize="characters"
            />
          </View>
          <Text style={styles.inputHint}>Enter your government ID or passport number exactly as shown</Text>
        </View>

        {isUSResident ? (
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Social Security Number (SSN) *</Text>
            <View style={styles.inputWithIcon}>
              <IdCard size={18} color={Colors.textTertiary} />
              <TextInput
                style={styles.inputIconText}
                placeholder="XXX-XX-XXXX"
                placeholderTextColor={Colors.textTertiary}
                value={personalInfo.ssn}
                onChangeText={(text) => {
                  const cleaned = text.replace(/[^0-9]/g, '');
                  let formatted = cleaned;
                  if (cleaned.length > 3 && cleaned.length <= 5) {
                    formatted = `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
                  } else if (cleaned.length > 5) {
                    formatted = `${cleaned.slice(0, 3)}-${cleaned.slice(3, 5)}-${cleaned.slice(5, 9)}`;
                  }
                  updatePersonalInfo('ssn', formatted);
                }}
                keyboardType="number-pad"
                maxLength={11}
                secureTextEntry
              />
            </View>
            <Text style={styles.inputHint}>Required for US residents. Your SSN is encrypted and secure.</Text>
          </View>
        ) : (
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{selectedCountryInfo.taxIdLabel} *</Text>
            <View style={styles.inputWithIcon}>
              <IdCard size={18} color={Colors.textTertiary} />
              <TextInput
                style={styles.inputIconText}
                placeholder={selectedCountryInfo.taxIdPlaceholder}
                placeholderTextColor={Colors.textTertiary}
                value={personalInfo.taxId}
                onChangeText={(text) => updatePersonalInfo('taxId', text)}
              />
            </View>
            <Text style={styles.inputHint}>Your tax identification number for {personalInfo.country}</Text>
          </View>
        )}

        <View style={styles.sectionDivider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>Company Investment (Optional)</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={styles.companyToggle}
          onPress={() => setPersonalInfo(prev => ({ ...prev, investingAsCompany: !prev.investingAsCompany }))}
        >
          <View style={styles.companyToggleLeft}>
            <View style={[styles.companyToggleIcon, personalInfo.investingAsCompany && styles.companyToggleIconActive]}>
              <Building size={20} color={personalInfo.investingAsCompany ? Colors.primary : Colors.textTertiary} />
            </View>
            <View>
              <Text style={styles.companyToggleTitle}>Investing as a Company</Text>
              <Text style={styles.companyToggleHint}>Enable if you plan to invest through a company entity</Text>
            </View>
          </View>
          <View style={[styles.toggleSwitch, personalInfo.investingAsCompany && styles.toggleSwitchActive]}>
            <View style={[styles.toggleKnob, personalInfo.investingAsCompany && styles.toggleKnobActive]} />
          </View>
        </TouchableOpacity>

        {personalInfo.investingAsCompany && (
          <View style={styles.companyFields}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Company Name *</Text>
              <View style={styles.inputWithIcon}>
                <Building size={18} color={Colors.textTertiary} />
                <TextInput
                  style={styles.inputIconText}
                  placeholder="Enter company legal name"
                  placeholderTextColor={Colors.textTertiary}
                  value={personalInfo.companyName}
                  onChangeText={(text) => updatePersonalInfo('companyName', text)}
                  autoCapitalize="words"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Company EIN Number *</Text>
              <View style={styles.inputWithIcon}>
                <Hash size={18} color={Colors.textTertiary} />
                <TextInput
                  style={styles.inputIconText}
                  placeholder="XX-XXXXXXX"
                  placeholderTextColor={Colors.textTertiary}
                  value={personalInfo.companyEin}
                  onChangeText={(text) => {
                    const cleaned = text.replace(/[^0-9]/g, '');
                    let formatted = cleaned;
                    if (cleaned.length > 2) {
                      formatted = `${cleaned.slice(0, 2)}-${cleaned.slice(2, 9)}`;
                    }
                    updatePersonalInfo('companyEin', formatted);
                  }}
                  keyboardType="number-pad"
                  maxLength={10}
                />
              </View>
              <Text style={styles.inputHint}>Employer Identification Number issued by IRS</Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Company Tax ID *</Text>
              <View style={styles.inputWithIcon}>
                <IdCard size={18} color={Colors.textTertiary} />
                <TextInput
                  style={styles.inputIconText}
                  placeholder="Enter company tax ID"
                  placeholderTextColor={Colors.textTertiary}
                  value={personalInfo.companyTaxId}
                  onChangeText={(text) => updatePersonalInfo('companyTaxId', text)}
                />
              </View>
            </View>
          </View>
        )}
      </View>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  const renderDocumentCard = (
    type: 'governmentId' | 'proofOfAddress',
    title: string,
    description: string,
    icon: React.ReactNode
  ) => {
    const doc = documents[type];
    const isUploading = doc.status === 'uploading';

    return (
      <View style={styles.documentCard}>
        <View style={styles.documentHeader}>
          <View style={styles.documentIconContainer}>{icon}</View>
          <View style={styles.documentInfo}>
            <Text style={styles.documentTitle}>{title}</Text>
            <Text style={styles.documentDescription}>{description}</Text>
          </View>
          {doc.uri && (
            <View style={[
              styles.documentStatusBadge,
              { backgroundColor: doc.status === 'uploaded' ? Colors.success + '20' : Colors.primary + '20' }
            ]}>
              {isUploading ? (
                <ShimmerIndicator size="small" color={Colors.primary} />
              ) : (
                <CheckCircle size={16} color={Colors.success} />
              )}
            </View>
          )}
        </View>

        {doc.uri ? (
          <View style={styles.documentPreviewContainer}>
            <Image source={{ uri: doc.uri }} style={styles.documentPreview} />
            {isUploading && (
              <View style={styles.uploadingOverlay}>
                <ShimmerIndicator size="large" color={Colors.white} />
                <Text style={styles.uploadingText}>Uploading...</Text>
              </View>
            )}
            {!isUploading && (
              <TouchableOpacity
                style={styles.removeDocumentButton}
                onPress={() => removeDocument(type)}
              >
                <X size={16} color={Colors.white} />
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <TouchableOpacity
            style={styles.uploadButton}
            onPress={() => pickDocument(type)}
          >
            <Upload size={24} color={Colors.primary} />
            <Text style={styles.uploadButtonText}>Upload Document</Text>
            <Text style={styles.uploadButtonHint}>JPG, PNG up to 10MB</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderDocumentsStep = () => (
    <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.stepHeader}>
        <View style={styles.stepIcon}>
          <FileText size={24} color={Colors.primary} />
        </View>
        <Text style={styles.stepTitle}>Upload Documents</Text>
        <Text style={styles.stepSubtitle}>Upload clear photos of your identification documents</Text>
      </View>

      <View style={styles.idTypeSelector}>
        <Text style={styles.inputLabel}>Select ID Type</Text>
        <View style={styles.idTypeOptions}>
          {[
            { value: 'drivers_license' as const, label: 'Driver\'s License' },
            { value: 'passport' as const, label: 'Passport' },
            { value: 'national_id' as const, label: 'National ID' },
          ].map((type) => (
            <TouchableOpacity
              key={type.value}
              style={[
                styles.idTypeOption,
                selectedIdType === type.value && styles.idTypeOptionActive,
              ]}
              onPress={() => setSelectedIdType(type.value)}
            >
              <Text
                style={[
                  styles.idTypeOptionText,
                  selectedIdType === type.value && styles.idTypeOptionTextActive,
                ]}
              >
                {type.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {renderDocumentCard(
        'governmentId',
        selectedIdType === 'drivers_license' ? 'Driver\'s License' : selectedIdType === 'passport' ? 'Passport' : 'National ID',
        'Front side of your government-issued ID',
        <IdCard size={24} color={Colors.primary} />
      )}

      {renderDocumentCard(
        'proofOfAddress',
        'Proof of Address',
        'Utility bill, bank statement, or lease (within 3 months)',
        <FileText size={24} color={Colors.primary} />
      )}

      <View style={styles.uploadMethodInfo}>
        <View style={styles.uploadMethodRow}>
          <View style={styles.uploadMethodIcon}>
            <Camera size={18} color={Colors.primary} />
          </View>
          <Text style={styles.uploadMethodText}>Take a photo with your camera</Text>
        </View>
        <View style={styles.uploadMethodRow}>
          <View style={styles.uploadMethodIcon}>
            <ImageIcon size={18} color={Colors.primary} />
          </View>
          <Text style={styles.uploadMethodText}>Upload from your photo gallery</Text>
        </View>
      </View>

      <View style={styles.infoCard}>
        <Info size={18} color={Colors.info} />
        <Text style={styles.infoCardText}>
          Make sure all text is clearly readable and the entire document is visible in the photo.
        </Text>
      </View>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  const renderSelfieStep = () => (
    <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.stepHeader}>
        <View style={styles.stepIcon}>
          <Camera size={24} color={Colors.primary} />
        </View>
        <Text style={styles.stepTitle}>Take a Selfie</Text>
        <Text style={styles.stepSubtitle}>We need a photo of you to verify your identity</Text>
      </View>

      <View style={styles.selfieInstructions}>
        <View style={styles.instructionRow}>
          <CheckCircle size={18} color={Colors.success} />
          <Text style={styles.instructionText}>Face the camera directly</Text>
        </View>
        <View style={styles.instructionRow}>
          <CheckCircle size={18} color={Colors.success} />
          <Text style={styles.instructionText}>Ensure good lighting</Text>
        </View>
        <View style={styles.instructionRow}>
          <CheckCircle size={18} color={Colors.success} />
          <Text style={styles.instructionText}>Remove glasses and hats</Text>
        </View>
        <View style={styles.instructionRow}>
          <CheckCircle size={18} color={Colors.success} />
          <Text style={styles.instructionText}>Keep a neutral expression</Text>
        </View>
      </View>

      {documents.selfie.uri ? (
        <View style={styles.selfiePreviewContainer}>
          <Image source={{ uri: documents.selfie.uri }} style={styles.selfiePreview} />
          <TouchableOpacity
            style={styles.retakeButton}
            onPress={() => removeDocument('selfie')}
          >
            <RefreshCw size={18} color={Colors.primary} />
            <Text style={styles.retakeButtonText}>Retake Photo</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.selfieOptionsContainer}>
          <TouchableOpacity
            style={styles.selfieButton}
            onPress={() => launchDocumentPicker('selfie', 'camera')}
          >
            <View style={styles.selfieIconContainer}>
              <Camera size={48} color={Colors.primary} />
            </View>
            <Text style={styles.selfieButtonText}>Take Selfie</Text>
            <Text style={styles.selfieButtonHint}>Tap to open camera</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.galleryFallbackButton}
            onPress={() => launchDocumentPicker('selfie', 'gallery')}
          >
            <ImageIcon size={18} color={Colors.primary} />
            <Text style={styles.galleryFallbackText}>Or upload from gallery</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  const renderLivenessStep = () => (
    <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.stepHeader}>
        <View style={styles.stepIcon}>
          <ScanFace size={24} color={Colors.primary} />
        </View>
        <Text style={styles.stepTitle}>Liveness Detection</Text>
        <Text style={styles.stepSubtitle}>Verify you are a real person, not a photo</Text>
      </View>

      <View style={styles.livenessContainer}>
        {documents.selfie.uri && (
          <Animated.View style={[
            styles.livenessPreview,
            { transform: [{ scale: livenessState.isRunning ? pulseAnim : 1 }] }
          ]}>
            <Image source={{ uri: documents.selfie.uri }} style={styles.livenessImage} />
            {livenessState.isRunning && (
              <View style={styles.livenessOverlay}>
                <View style={styles.livenessScanner} />
              </View>
            )}
          </Animated.View>
        )}

        <View style={styles.challengesList}>
          {livenessState.challenges.map((challenge, index) => (
            <View
              key={challenge.type}
              style={[
                styles.challengeItem,
                livenessState.currentChallenge === index && livenessState.isRunning && styles.challengeItemActive,
                challenge.completed && styles.challengeItemCompleted,
              ]}
            >
              <View style={styles.challengeIconContainer}>
                {challenge.completed ? (
                  <CheckCircle2 size={24} color={Colors.success} />
                ) : (
                  getChallengeIcon(challenge.type)
                )}
              </View>
              <Text style={[
                styles.challengeText,
                challenge.completed && styles.challengeTextCompleted,
              ]}>
                {getChallengeText(challenge.type)}
              </Text>
              {livenessState.currentChallenge === index && livenessState.isRunning && (
                <ShimmerIndicator size="small" color={Colors.primary} />
              )}
            </View>
          ))}
        </View>

        {livenessState.completed ? (
          <View style={styles.livenessSuccessCard}>
            <ShieldCheck size={32} color={Colors.success} />
            <Text style={styles.livenessSuccessTitle}>Liveness Verified</Text>
            <Text style={styles.livenessSuccessText}>
              Confidence: {(livenessState.confidence * 100).toFixed(1)}%
            </Text>
          </View>
        ) : !livenessState.isRunning ? (
          <TouchableOpacity style={styles.startLivenessButton} onPress={startLivenessCheck}>
            <Fingerprint size={24} color={Colors.white} />
            <Text style={styles.startLivenessText}>Start Liveness Check</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.livenessInProgress}>
            <ShimmerIndicator size="large" color={Colors.primary} />
            <Text style={styles.livenessProgressText}>Verifying liveness...</Text>
          </View>
        )}
      </View>

      <View style={styles.infoCard}>
        <Info size={18} color={Colors.info} />
        <Text style={styles.infoCardText}>
          This check ensures you are a real person and prevents identity fraud. Follow the on-screen instructions.
        </Text>
      </View>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  const renderVerificationStep = () => (
    <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.stepHeader}>
        <View style={styles.stepIcon}>
          <Database size={24} color={Colors.primary} />
        </View>
        <Text style={styles.stepTitle}>Identity Verification</Text>
        <Text style={styles.stepSubtitle}>Running comprehensive security checks</Text>
      </View>

      <View style={styles.verificationContainer}>
        <View style={styles.progressCircleContainer}>
          <View style={styles.progressCircle}>
            <Text style={styles.progressText}>{verificationProgress}%</Text>
          </View>
        </View>

        <View style={styles.verificationChecks}>
          <View style={styles.verificationCheckItem}>
            <View style={[styles.checkStatusDot, verificationProgress >= 20 && styles.checkStatusDotActive]} />
            <ScanFace size={20} color={verificationProgress >= 20 ? Colors.primary : Colors.textTertiary} />
            <Text style={[styles.verificationCheckText, verificationProgress >= 20 && styles.verificationCheckTextActive]}>
              Face matching with document
            </Text>
          </View>
          <View style={styles.verificationCheckItem}>
            <View style={[styles.checkStatusDot, verificationProgress >= 40 && styles.checkStatusDotActive]} />
            <FileText size={20} color={verificationProgress >= 40 ? Colors.primary : Colors.textTertiary} />
            <Text style={[styles.verificationCheckText, verificationProgress >= 40 && styles.verificationCheckTextActive]}>
              Document authenticity
            </Text>
          </View>
          <View style={styles.verificationCheckItem}>
            <View style={[styles.checkStatusDot, verificationProgress >= 60 && styles.checkStatusDotActive]} />
            <Globe size={20} color={verificationProgress >= 60 ? Colors.primary : Colors.textTertiary} />
            <Text style={[styles.verificationCheckText, verificationProgress >= 60 && styles.verificationCheckTextActive]}>
              Global sanctions check
            </Text>
          </View>
          <View style={styles.verificationCheckItem}>
            <View style={[styles.checkStatusDot, verificationProgress >= 80 && styles.checkStatusDotActive]} />
            <Shield size={20} color={verificationProgress >= 80 ? Colors.primary : Colors.textTertiary} />
            <Text style={[styles.verificationCheckText, verificationProgress >= 80 && styles.verificationCheckTextActive]}>
              PEP & watchlist screening
            </Text>
          </View>
          <View style={styles.verificationCheckItem}>
            <View style={[styles.checkStatusDot, verificationProgress >= 95 && styles.checkStatusDotActive]} />
            <CheckCircle size={20} color={verificationProgress >= 95 ? Colors.primary : Colors.textTertiary} />
            <Text style={[styles.verificationCheckText, verificationProgress >= 95 && styles.verificationCheckTextActive]}>
              Identity cross-reference
            </Text>
          </View>
        </View>

        <View style={styles.databasesCard}>
          <Text style={styles.databasesTitle}>Checking against databases:</Text>
          <View style={styles.databasesList}>
            {['OFAC SDN', 'UN Sanctions', 'EU Sanctions', 'UK HMT', 'PEP Lists', 'Interpol', 'Global Watchlist'].map((db, idx) => (
              <View key={db} style={styles.databaseItem}>
                <View style={[styles.databaseDot, verificationProgress > (idx + 1) * 12 && styles.databaseDotActive]} />
                <Text style={styles.databaseName}>{db}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  const renderVerificationCheckStatus = (check: VerificationCheck) => {
    const statusColor = getStatusColor(check.status);
    return (
      <View style={styles.verificationResultItem} key={check.name}>
        <View style={[styles.resultStatusIcon, { backgroundColor: statusColor + '20' }]}>
          {check.status === 'passed' ? (
            <CheckCircle2 size={20} color={statusColor} />
          ) : check.status === 'failed' ? (
            <XCircle size={20} color={statusColor} />
          ) : (
            <Clock size={20} color={statusColor} />
          )}
        </View>
        <View style={styles.resultContent}>
          <Text style={styles.resultName}>{check.name}</Text>
          <Text style={styles.resultDetails}>{check.details}</Text>
        </View>
        <Text style={[styles.resultScore, { color: statusColor }]}>
          {(check.score * 100).toFixed(0)}%
        </Text>
      </View>
    );
  };

  const renderReviewStep = () => (
    <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.stepHeader}>
        <View style={[styles.stepIcon, { backgroundColor: (verificationResult?.success ? Colors.success : Colors.warning) + '20' }]}>
          {verificationResult?.success ? (
            <ShieldCheck size={24} color={Colors.success} />
          ) : (
            <AlertTriangle size={24} color={Colors.warning} />
          )}
        </View>
        <Text style={styles.stepTitle}>
          {verificationResult?.success ? 'Verification Successful' : 'Review Required'}
        </Text>
        <Text style={styles.stepSubtitle}>{verificationResult?.message}</Text>
      </View>

      {verificationResult && (
        <View style={styles.riskScoreCard}>
          <View style={styles.riskScoreHeader}>
            <Text style={styles.riskScoreLabel}>Risk Assessment</Text>
            <View style={[
              styles.riskBadge,
              { backgroundColor: getRiskColor(verificationResult.riskLevel) + '20' }
            ]}>
              <Text style={[
                styles.riskBadgeText,
                { color: getRiskColor(verificationResult.riskLevel) }
              ]}>
                {verificationResult.riskLevel.toUpperCase()} RISK
              </Text>
            </View>
          </View>
          <View style={styles.overallScoreBar}>
            <View
              style={[
                styles.overallScoreFill,
                {
                  width: `${verificationResult.score * 100}%`,
                  backgroundColor: getRiskColor(verificationResult.riskLevel)},
              ]}
            />
          </View>
          <Text style={styles.overallScoreText}>
            Overall Score: {(verificationResult.score * 100).toFixed(1)}%
          </Text>
        </View>
      )}

      <View style={styles.reviewSection}>
        <Text style={styles.reviewSectionTitle}>Verification Results</Text>
        <View style={styles.verificationResultsCard}>
          {verificationResult?.checks.map(renderVerificationCheckStatus)}
        </View>
      </View>

      <View style={styles.reviewSection}>
        <Text style={styles.reviewSectionTitle}>Personal Information</Text>
        <View style={styles.reviewCard}>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Full Name</Text>
            <Text style={styles.reviewValue}>{personalInfo.firstName} {personalInfo.lastName}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Date of Birth</Text>
            <Text style={styles.reviewValue}>{personalInfo.dateOfBirth}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Nationality</Text>
            <Text style={styles.reviewValue}>{personalInfo.nationality}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Passport Number</Text>
            <Text style={styles.reviewValue}>{personalInfo.passportNumber}</Text>
          </View>
          {isUSResident ? (
            <View style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>SSN</Text>
              <Text style={styles.reviewValue}>***-**-{personalInfo.ssn.slice(-4)}</Text>
            </View>
          ) : (
            <View style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>{selectedCountryInfo.taxIdLabel}</Text>
              <Text style={styles.reviewValue}>{personalInfo.taxId}</Text>
            </View>
          )}
          {personalInfo.investingAsCompany && (
            <>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Company</Text>
                <Text style={styles.reviewValue}>{personalInfo.companyName}</Text>
              </View>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>EIN</Text>
                <Text style={styles.reviewValue}>{personalInfo.companyEin}</Text>
              </View>
              <View style={[styles.reviewRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.reviewLabel}>Company Tax ID</Text>
                <Text style={styles.reviewValue}>{personalInfo.companyTaxId}</Text>
              </View>
            </>
          )}
          {!personalInfo.investingAsCompany && (
            <View style={[styles.reviewRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.reviewLabel}>Investment Type</Text>
              <Text style={styles.reviewValue}>Individual</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.reviewSection}>
        <Text style={styles.reviewSectionTitle}>Documents & Biometrics</Text>
        <View style={styles.reviewCard}>
          <View style={styles.reviewDocRow}>
            <IdCard size={20} color={Colors.primary} />
            <Text style={styles.reviewDocText}>Government ID</Text>
            <CheckCircle size={18} color={Colors.success} />
          </View>
          <View style={styles.reviewDocRow}>
            <FileText size={20} color={Colors.primary} />
            <Text style={styles.reviewDocText}>Proof of Address</Text>
            <CheckCircle size={18} color={Colors.success} />
          </View>
          <View style={styles.reviewDocRow}>
            <Camera size={20} color={Colors.primary} />
            <Text style={styles.reviewDocText}>Selfie</Text>
            <CheckCircle size={18} color={Colors.success} />
          </View>
          <View style={styles.reviewDocRow}>
            <ScanFace size={20} color={Colors.primary} />
            <Text style={styles.reviewDocText}>Liveness Check</Text>
            <CheckCircle size={18} color={Colors.success} />
          </View>
          <View style={[styles.reviewDocRow, { borderBottomWidth: 0 }]}>
            <Database size={20} color={Colors.primary} />
            <Text style={styles.reviewDocText}>Sanctions Screening</Text>
            <CheckCircle size={18} color={Colors.success} />
          </View>
        </View>
      </View>

      <View style={styles.warningCard}>
        <AlertTriangle size={20} color={Colors.warning} />
        <Text style={styles.warningText}>
          By submitting, you confirm that all information provided is accurate and that you are the person depicted in the documents.
        </Text>
      </View>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      <Modal
        visible={showUploadPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowUploadPicker(false)}
      >
        <TouchableOpacity
          style={styles.uploadPickerOverlay}
          activeOpacity={1}
          onPress={() => setShowUploadPicker(false)}
        >
          <View style={styles.uploadPickerSheet}>
            <Text style={styles.uploadPickerTitle}>Upload Document</Text>
            <Text style={styles.uploadPickerSubtitle}>Choose how to add your document</Text>
            <TouchableOpacity
              style={styles.uploadPickerOption}
              onPress={() => pendingUploadType && launchDocumentPicker(pendingUploadType, 'camera')}
            >
              <View style={styles.uploadPickerOptionIcon}>
                <Camera size={24} color={Colors.primary} />
              </View>
              <View style={styles.uploadPickerOptionContent}>
                <Text style={styles.uploadPickerOptionTitle}>Take a Photo</Text>
                <Text style={styles.uploadPickerOptionHint}>Use your camera to capture the document</Text>
              </View>
              <ChevronRight size={20} color={Colors.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.uploadPickerOption}
              onPress={() => pendingUploadType && launchDocumentPicker(pendingUploadType, 'gallery')}
            >
              <View style={styles.uploadPickerOptionIcon}>
                <ImageIcon size={24} color={Colors.primary} />
              </View>
              <View style={styles.uploadPickerOptionContent}>
                <Text style={styles.uploadPickerOptionTitle}>Upload from Gallery</Text>
                <Text style={styles.uploadPickerOptionHint}>Select an existing photo from your device</Text>
              </View>
              <ChevronRight size={20} color={Colors.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.uploadPickerCancel}
              onPress={() => setShowUploadPicker(false)}
            >
              <Text style={styles.uploadPickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showNationalityPicker || showCountryPicker}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {showNationalityPicker ? 'Select Nationality' : 'Select Country'}
            </Text>
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => {
                setShowNationalityPicker(false);
                setShowCountryPicker(false);
                setCountrySearch('');
              }}
            >
              <X size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.searchContainer}>
            <Search size={20} color={Colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search countries..."
              placeholderTextColor={Colors.textTertiary}
              value={countrySearch}
              onChangeText={setCountrySearch}
              autoCapitalize="none"
            />
          </View>
          <FlatList
            data={filteredCountries}
            keyExtractor={(item) => item.code}
            renderItem={renderCountryItem}
            showsVerticalScrollIndicator={false}
            style={styles.countryList}
          />
        </SafeAreaView>
      </Modal>

      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                if (currentStep === 'personal') {
                  router.back();
                } else if (currentStep === 'documents') {
                  setCurrentStep('personal');
                } else if (currentStep === 'selfie') {
                  setCurrentStep('documents');
                } else if (currentStep === 'liveness') {
                  setCurrentStep('selfie');
                } else if (currentStep === 'verification') {
                  setCurrentStep('liveness');
                } else {
                  setCurrentStep('verification');
                }
              }}
            >
              <ArrowLeft size={24} color={Colors.text} />
            </TouchableOpacity>

            <Text style={styles.headerTitle}>KYC Verification</Text>

            <Text style={styles.stepIndicator}>
              Step {getStepNumber(currentStep)}/{getTotalSteps()}
            </Text>
          </View>

          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${(getStepNumber(currentStep) / getTotalSteps()) * 100}%` }]} />
          </View>

          {currentStep === 'personal' && renderPersonalInfoStep()}
          {currentStep === 'documents' && renderDocumentsStep()}
          {currentStep === 'selfie' && renderSelfieStep()}
          {currentStep === 'liveness' && renderLivenessStep()}
          {currentStep === 'verification' && renderVerificationStep()}
          {currentStep === 'review' && renderReviewStep()}

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.nextButton, isLoading && styles.buttonDisabled]}
              onPress={handleNextStep}
              disabled={isLoading}
            >
              {isLoading ? (
                <ShimmerIndicator color={Colors.background} />
              ) : (
                <>
                  <Text style={styles.nextButtonText}>
                    {currentStep === 'review' ? 'Submit KYC' : currentStep === 'liveness' ? 'Run Verification' : 'Continue'}
                  </Text>
                  <ChevronRight size={20} color={Colors.background} />
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backButton: { padding: 8 },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  stepIndicator: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
  progressBar: { height: 4, backgroundColor: Colors.surfaceBorder, marginHorizontal: 16 },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: Colors.primary },
  scrollView: { flex: 1, paddingHorizontal: 20 },
  stepHeader: { alignItems: 'center', paddingTop: 24, paddingBottom: 16, gap: 8 },
  stepIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  stepTitle: { color: Colors.text, fontSize: 22, fontWeight: '800' as const, textAlign: 'center' as const },
  stepSubtitle: { color: Colors.textSecondary, fontSize: 14, fontWeight: '400' as const, textAlign: 'center' as const, lineHeight: 20 },
  formSection: { marginBottom: 16 },
  inputGroup: { gap: 4, marginBottom: 14 },
  inputRow: { flexDirection: 'row', gap: 12 },
  inputLabel: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  input: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  inputWithIcon: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: Colors.surfaceBorder, gap: 10 },
  inputIconText: { flex: 1, color: Colors.text, fontSize: 16 },
  inputHint: { color: Colors.textTertiary, fontSize: 11, marginTop: 4 },
  idTypeSelector: { marginBottom: 16 },
  idTypeOptions: { flexDirection: 'row', gap: 8 },
  idTypeOption: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 10, borderWidth: 1, borderColor: Colors.surfaceBorder, alignItems: 'center' as const },
  idTypeOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '12' },
  idTypeOptionText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' as const, textAlign: 'center' as const },
  idTypeOptionTextActive: { color: Colors.primary },
  documentCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: Colors.surfaceBorder },
  documentHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  documentIconContainer: { width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  documentInfo: { flex: 1 },
  documentTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  documentDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 2 },
  documentStatusBadge: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  uploadButton: { backgroundColor: Colors.primary + '10', borderWidth: 1, borderColor: Colors.primary + '30', borderStyle: 'dashed' as const, borderRadius: 14, paddingVertical: 28, alignItems: 'center', gap: 8 },
  uploadButtonText: { color: Colors.primary, fontWeight: '700' as const, fontSize: 15 },
  uploadButtonHint: { color: Colors.textTertiary, fontSize: 11, textAlign: 'center' as const },
  documentPreviewContainer: { borderRadius: 12, overflow: 'hidden' as const, position: 'relative' as const },
  documentPreview: { width: '100%', height: 180, borderRadius: 12 },
  uploadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  uploadingText: { color: Colors.white, fontSize: 13, marginTop: 8 },
  removeDocumentButton: { position: 'absolute' as const, top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  infoCard: { flexDirection: 'row', backgroundColor: Colors.info + '10', borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: Colors.info + '20', marginTop: 8 },
  infoCardText: { flex: 1, color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  selfieInstructions: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, gap: 12, marginBottom: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  instructionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  instructionText: { color: Colors.textSecondary, fontSize: 14 },
  selfieButton: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: 20, paddingVertical: 40, alignItems: 'center', gap: 12 },
  selfieIconContainer: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  selfieButtonText: { color: Colors.text, fontWeight: '700' as const, fontSize: 17 },
  selfieButtonHint: { color: Colors.textTertiary, fontSize: 12 },
  selfiePreviewContainer: { alignItems: 'center', gap: 16 },
  selfiePreview: { width: 200, height: 200, borderRadius: 100, borderWidth: 3, borderColor: Colors.primary },
  retakeButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  retakeButtonText: { color: Colors.primary, fontWeight: '600' as const, fontSize: 15 },
  reviewSection: { marginBottom: 20 },
  reviewSectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 10 },
  reviewCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  reviewLabel: { color: Colors.textSecondary, fontSize: 13 },
  reviewValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, textAlign: 'right' as const, flex: 1, marginLeft: 12 },
  reviewDocRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  reviewDocText: { flex: 1, color: Colors.text, fontSize: 14 },
  warningCard: { backgroundColor: Colors.warning + '10', borderRadius: 12, padding: 14, flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: Colors.warning + '20', marginTop: 8 },
  warningText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18, flex: 1 },
  bottomPadding: { height: 40 },
  footer: { paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, backgroundColor: Colors.background },
  nextButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonDisabled: { opacity: 0.4 },
  nextButtonText: { color: Colors.black, fontWeight: '800' as const, fontSize: 16 },
  pickerButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder },
  pickerButtonText: { color: Colors.text, fontSize: 15, flex: 1 },
  sectionDivider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.surfaceBorder },
  dividerText: { color: Colors.textTertiary, fontSize: 12, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  modalTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  modalCloseButton: { padding: 8 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 14, marginHorizontal: 20, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder, gap: 10 },
  searchInput: { flex: 1, color: Colors.text, fontSize: 15, paddingVertical: 12 },
  countryList: { paddingHorizontal: 20 },
  countryItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  countryItemName: { color: Colors.text, fontSize: 15, fontWeight: '500' as const },
  countryItemCode: { color: Colors.textTertiary, fontSize: 13 },
  livenessContainer: { alignItems: 'center', gap: 20 },
  livenessPreview: { width: 200, height: 200, borderRadius: 100, overflow: 'hidden' as const, borderWidth: 3, borderColor: Colors.primary },
  livenessImage: { width: '100%', height: '100%' },
  livenessOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,215,0,0.15)', alignItems: 'center', justifyContent: 'center' },
  livenessScanner: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: Colors.primary },
  challengesList: { width: '100%', gap: 6 },
  challengeItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  challengeItemActive: { backgroundColor: Colors.primary + '10', borderColor: Colors.primary + '40' },
  challengeItemCompleted: { backgroundColor: Colors.success + '08', borderColor: Colors.success + '30' },
  challengeIconContainer: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.surfaceLight, alignItems: 'center', justifyContent: 'center' },
  challengeText: { flex: 1, color: Colors.textSecondary, fontSize: 14, fontWeight: '500' as const },
  challengeTextCompleted: { color: Colors.success, textDecorationLine: 'line-through' as const },
  livenessSuccessCard: { width: '100%', backgroundColor: Colors.success + '10', borderRadius: 16, padding: 20, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: Colors.success + '30' },
  livenessSuccessTitle: { color: Colors.success, fontSize: 18, fontWeight: '700' as const },
  livenessSuccessText: { color: Colors.textSecondary, fontSize: 14 },
  startLivenessButton: { flexDirection: 'row', width: '100%', backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', gap: 10 },
  startLivenessText: { color: Colors.black, fontWeight: '700' as const, fontSize: 16 },
  livenessInProgress: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  livenessProgressText: { color: Colors.textSecondary, fontSize: 14 },
  verificationContainer: { alignItems: 'center', gap: 20, paddingVertical: 10 },
  progressCircleContainer: { alignItems: 'center', marginBottom: 8 },
  progressCircle: { width: 100, height: 100, borderRadius: 50, borderWidth: 5, borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary + '08' },
  progressText: { color: Colors.primary, fontSize: 22, fontWeight: '800' as const },
  verificationChecks: { width: '100%', gap: 6 },
  verificationCheckItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  checkStatusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.textTertiary },
  checkStatusDotActive: { backgroundColor: Colors.success },
  verificationCheckText: { flex: 1, color: Colors.textSecondary, fontSize: 14 },
  verificationCheckTextActive: { color: Colors.text },
  databasesCard: { width: '100%', backgroundColor: Colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  databasesTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const, marginBottom: 10 },
  databasesList: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6 },
  databaseItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 10, backgroundColor: Colors.surfaceLight, borderRadius: 8 },
  databaseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.textTertiary },
  databaseDotActive: { backgroundColor: Colors.success },
  databaseName: { color: Colors.textSecondary, fontSize: 12, fontWeight: '500' as const },
  riskScoreCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  riskScoreHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  riskScoreLabel: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  riskBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  riskBadgeText: { fontSize: 11, fontWeight: '800' as const, letterSpacing: 0.5 },
  companyToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.surfaceBorder, marginBottom: 14 },
  companyToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  companyToggleIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.surfaceLight, alignItems: 'center', justifyContent: 'center' },
  companyToggleIconActive: { backgroundColor: Colors.primary + '20' },
  companyToggleTitle: { color: Colors.text, fontSize: 15, fontWeight: '600' as const },
  companyToggleHint: { color: Colors.textTertiary, fontSize: 12, marginTop: 2 },
  toggleSwitch: { width: 48, height: 28, borderRadius: 14, backgroundColor: Colors.surfaceLight, padding: 2, justifyContent: 'center' },
  toggleSwitchActive: { backgroundColor: Colors.primary },
  toggleKnob: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.textTertiary },
  toggleKnobActive: { backgroundColor: Colors.black, alignSelf: 'flex-end' as const },
  companyFields: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.primary + '30', marginBottom: 14, gap: 4 },
  uploadPickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  uploadPickerSheet: { backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  uploadPickerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const, textAlign: 'center' as const, marginBottom: 4 },
  uploadPickerSubtitle: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' as const, marginBottom: 20 },
  uploadPickerOption: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.surfaceLight, borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: Colors.surfaceBorder },
  uploadPickerOptionIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  uploadPickerOptionContent: { flex: 1 },
  uploadPickerOptionTitle: { color: Colors.text, fontSize: 16, fontWeight: '600' as const },
  uploadPickerOptionHint: { color: Colors.textTertiary, fontSize: 12, marginTop: 2 },
  uploadPickerCancel: { marginTop: 6, paddingVertical: 14, borderRadius: 14, backgroundColor: Colors.surfaceBorder, alignItems: 'center' },
  uploadPickerCancelText: { color: Colors.text, fontSize: 16, fontWeight: '600' as const },
  uploadMethodInfo: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, gap: 10, marginBottom: 10, borderWidth: 1, borderColor: Colors.surfaceBorder },
  uploadMethodRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  uploadMethodIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.primary + '12', alignItems: 'center', justifyContent: 'center' },
  uploadMethodText: { color: Colors.textSecondary, fontSize: 13 },
  selfieOptionsContainer: { gap: 12 },
  galleryFallbackButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  galleryFallbackText: { color: Colors.primary, fontWeight: '600' as const, fontSize: 14 },
  overallScoreBar: { height: 8, backgroundColor: Colors.surfaceBorder, borderRadius: 4, overflow: 'hidden' as const, marginBottom: 8 },
  overallScoreFill: { height: 8, borderRadius: 4 },
  overallScoreText: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center' as const },
  verificationResultsCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  verificationResultItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  resultStatusIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  resultContent: { flex: 1 },
  resultName: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginBottom: 2 },
  resultDetails: { color: Colors.textSecondary, fontSize: 12, lineHeight: 16 },
  resultScore: { fontSize: 14, fontWeight: '700' as const }});
