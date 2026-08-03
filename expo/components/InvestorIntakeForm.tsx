import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Animated,
  Alert,
  Platform} from "react-native";
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import {
  User,
  Mail,
  Phone,
  ShieldCheck,
  AlertCircle,
  ArrowRight,
  CheckCircle,
  CheckCircle2,
  FileText,
  Wallet,
  BarChart3,
  Clock,
  DollarSign,
  TrendingUp,
  Building2,
  ChevronDown,
  Camera,
  Upload,
  Trash2} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import type {
  IntakeProofOfFundsFile,
  InvestorDocumentType,
  InvestorEntityType} from '@/lib/investor-intake';
import {
  ACCREDITED_STATUS_OPTIONS,
  CALL_TIME_OPTIONS,
  getIdentificationTypeLabel,
  IDENTIFICATION_TYPE_OPTIONS,
  INVESTMENT_RANGE_OPTIONS,
  INVESTOR_ENTITY_OPTIONS,
  INVESTOR_MEMBER_AGREEMENT_SECTIONS,
  INVESTOR_MEMBER_AGREEMENT_VERSION,
  INVESTOR_TIMELINE_STEPS,
  RETURN_EXPECTATION_OPTIONS} from '@/lib/investor-intake';
import {
  getErrorMessage,
  isFormValid,
  sendOtp,
  submitWaitlistEntry,
  uploadInvestorIntakeFile,
  uploadProofOfFundsFile,
  validateEmail,
  validatePhone,
  verifyOtp} from '@/lib/waitlist-service';

interface InvestorIntakeFormProps {
  variant: 'landing' | 'screen';
  source: string;
  pagePath: string;
  testIdPrefix: string;
}

interface InvestorFormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  investmentRange: string;
  returnExpectation: string;
  bestTimeForCall: string;
  accreditedStatus: 'accredited' | 'non_accredited' | 'unsure' | null;
  entityType: InvestorEntityType;
  primaryIdType: InvestorDocumentType;
  primaryIdReference: string;
  secondaryIdType: InvestorDocumentType;
  secondaryIdReference: string;
  documentIssuingCountry: string;
  taxResidencyCountry: string;
  taxIdReference: string;
  companyName: string;
  companyRole: string;
  companyEin: string;
  companyTaxId: string;
  companyRegistrationCountry: string;
  beneficialOwnerName: string;
  signatureName: string;
}

type InvestorTextField =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'investmentRange'
  | 'returnExpectation'
  | 'bestTimeForCall'
  | 'primaryIdReference'
  | 'secondaryIdReference'
  | 'documentIssuingCountry'
  | 'taxResidencyCountry'
  | 'taxIdReference'
  | 'companyName'
  | 'companyRole'
  | 'companyEin'
  | 'companyTaxId'
  | 'companyRegistrationCountry'
  | 'beneficialOwnerName'
  | 'signatureName';

type DropdownField = 'investmentRange' | 'returnExpectation' | 'bestTimeForCall' | 'accreditedStatus' | 'primaryIdType' | 'secondaryIdType';

const MEMBER_ACCESS_ITEMS = [
  {
    id: 'member',
    title: 'Member sign up',
    description: 'Create a real investor profile with verified contact information before activation.',
    icon: Building2,
    accent: Colors.primary},
  {
    id: 'wallet',
    title: 'Wallet readiness',
    description: 'Funding methods and wallet access are prepared before live allocations begin.',
    icon: Wallet,
    accent: Colors.info},
  {
    id: 'records',
    title: 'Transaction records',
    description: 'Statements, transaction records, and timelines are kept visible for each member account.',
    icon: BarChart3,
    accent: Colors.success},
] as const;

export default function InvestorIntakeForm({ variant, source, pagePath, testIdPrefix }: InvestorIntakeFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<InvestorFormState>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    investmentRange: '',
    returnExpectation: '',
    bestTimeForCall: '',
    accreditedStatus: 'unsure',
    entityType: 'individual',
    primaryIdType: 'drivers_license',
    primaryIdReference: '',
    secondaryIdType: 'passport',
    secondaryIdReference: '',
    documentIssuingCountry: '',
    taxResidencyCountry: '',
    taxIdReference: '',
    companyName: '',
    companyRole: '',
    companyEin: '',
    companyTaxId: '',
    companyRegistrationCountry: '',
    beneficialOwnerName: '',
    signatureName: ''});
  const [activeDropdown, setActiveDropdown] = useState<DropdownField | null>(null);
  const [contactConsent, setContactConsent] = useState<boolean>(true);
  const [taxResponsibilityAccepted, setTaxResponsibilityAccepted] = useState<boolean>(false);
  const [identityReviewAccepted, setIdentityReviewAccepted] = useState<boolean>(false);
  const [entityAuthorityAccepted, setEntityAuthorityAccepted] = useState<boolean>(false);
  const [agreementAccepted, setAgreementAccepted] = useState<boolean>(false);
  const [proofOfFunds, setProofOfFunds] = useState<IntakeProofOfFundsFile | null>(null);
  const [primaryIdUpload, setPrimaryIdUpload] = useState<IntakeProofOfFundsFile | null>(null);
  const [secondaryIdUpload, setSecondaryIdUpload] = useState<IntakeProofOfFundsFile | null>(null);
  const [taxDocumentUpload, setTaxDocumentUpload] = useState<IntakeProofOfFundsFile | null>(null);
  const [proofUploadPending, setProofUploadPending] = useState<boolean>(false);
  const [identityUploadPending, setIdentityUploadPending] = useState<boolean>(false);
  const [otpSent, setOtpSent] = useState<boolean>(false);
  const [otpCode, setOtpCode] = useState<string>('');
  const [phoneVerified, setPhoneVerified] = useState<boolean>(false);
  const [otpCooldown, setOtpCooldown] = useState<number>(0);
  const [otpSendCount, setOtpSendCount] = useState<number>(0);
  const [otpVerifyCount, setOtpVerifyCount] = useState<number>(0);
  const [otpError, setOtpError] = useState<string>('');
  const [formError, setFormError] = useState<string>('');
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [otpSending, setOtpSending] = useState<boolean>(false);
  const [otpVerifying, setOtpVerifying] = useState<boolean>(false);
  const successScale = useRef(new Animated.Value(0.92)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fullName = useMemo(() => {
    return [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(' ').trim();
  }, [form.firstName, form.lastName]);

  const attribution = useMemo(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return {
        pagePath: `${window.location.pathname || pagePath}${window.location.search || ''}`,
        referrer: document.referrer || '',
        utm_source: params.get('utm_source') || '',
        utm_medium: params.get('utm_medium') || '',
        utm_campaign: params.get('utm_campaign') || '',
        utm_content: params.get('utm_content') || '',
        utm_term: params.get('utm_term') || ''};
    }

    return {
      pagePath,
      referrer: '',
      utm_source: '',
      utm_medium: '',
      utm_campaign: '',
      utm_content: '',
      utm_term: ''};
  }, [pagePath]);

  useEffect(() => {
    return () => {
      if (cooldownRef.current) {
        clearInterval(cooldownRef.current);
      }
    };
  }, []);

  const updateField = useCallback((field: InvestorTextField, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleEntityTypeChange = useCallback((nextType: InvestorEntityType) => {
    setForm((prev) => ({ ...prev, entityType: nextType }));
    if (nextType !== 'corporate') {
      setEntityAuthorityAccepted(false);
    }
  }, []);

  const toggleDropdown = useCallback((field: DropdownField) => {
    setActiveDropdown((prev) => prev === field ? null : field);
  }, []);

  const selectDropdownValue = useCallback((field: DropdownField, value: string) => {
    if (field === 'accreditedStatus') {
      setForm((prev) => ({
        ...prev,
        accreditedStatus: value as InvestorFormState['accreditedStatus']}));
    } else if (field === 'primaryIdType') {
      setForm((prev) => ({
        ...prev,
        primaryIdType: value as InvestorDocumentType}));
    } else if (field === 'secondaryIdType') {
      setForm((prev) => ({
        ...prev,
        secondaryIdType: value as InvestorDocumentType}));
    } else {
      setForm((prev) => ({ ...prev, [field]: value }));
    }
    setActiveDropdown(null);
  }, []);

  const startCooldown = useCallback(() => {
    setOtpCooldown(30);
    if (cooldownRef.current) {
      clearInterval(cooldownRef.current);
    }
    cooldownRef.current = setInterval(() => {
      setOtpCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) {
            clearInterval(cooldownRef.current);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const handleSendOtp = useCallback(async () => {
    setOtpError('');
    if (!validatePhone(form.phone)) {
      setOtpError(getErrorMessage('invalid_phone'));
      return;
    }
    if (otpSendCount >= 5) {
      setOtpError(getErrorMessage('rate_limited'));
      return;
    }

    setOtpSending(true);
    try {
      const result = await sendOtp(form.phone);
      if (result.success) {
        setOtpSendCount((prev) => prev + 1);
        setOtpSent(true);
        startCooldown();
        console.log('[InvestorIntake] OTP sent');
      } else {
        setOtpError(getErrorMessage(result.error ?? 'otp_send_failed'));
      }
    } catch (err) {
      console.log('[InvestorIntake] OTP send exception:', (err as Error)?.message);
      setOtpError(getErrorMessage('otp_send_failed'));
    } finally {
      setOtpSending(false);
    }
  }, [form.phone, otpSendCount, startCooldown]);

  const handleVerifyOtp = useCallback(async () => {
    setOtpError('');
    if (otpVerifyCount >= 5) {
      setOtpError(getErrorMessage('rate_limited'));
      return;
    }

    setOtpVerifying(true);
    setOtpVerifyCount((prev) => prev + 1);
    try {
      const result = await verifyOtp(form.phone, otpCode);
      if (result.success) {
        setPhoneVerified(true);
        setOtpError('');
        console.log('[InvestorIntake] OTP verified');
      } else {
        setOtpError(getErrorMessage(result.error ?? 'otp_invalid'));
      }
    } catch (err) {
      console.log('[InvestorIntake] OTP verify exception:', (err as Error)?.message);
      setOtpError(getErrorMessage('otp_invalid'));
    } finally {
      setOtpVerifying(false);
    }
  }, [form.phone, otpCode, otpVerifyCount]);

  const handlePickProofOfFunds = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        multiple: false,
        copyToCacheDirectory: true});

      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      if (!asset) {
        return;
      }

      const nextFile: IntakeProofOfFundsFile = {
        uri: asset.uri,
        name: asset.name || 'proof-of-funds',
        mimeType: asset.mimeType ?? null,
        size: asset.size ?? null,
        source: 'document_picker'};

      setProofOfFunds(nextFile);
      console.log('[InvestorIntake] Proof of funds selected:', nextFile.name);
    } catch (err) {
      console.log('[InvestorIntake] Proof of funds picker exception:', (err as Error)?.message);
      Alert.alert('Upload Error', 'We could not open your document picker. Please try again.');
    }
  }, []);

  const isCorporate = form.entityType === 'corporate';

  const createImageUploadFile = useCallback((asset: ImagePicker.ImagePickerAsset, sourceType: 'camera' | 'gallery', fallbackPrefix: string): IntakeProofOfFundsFile => {
    const extension = asset.mimeType?.split('/')[1]?.split(';')[0] ?? 'jpg';
    const fallbackName = `${fallbackPrefix}_${sourceType}_${Date.now()}.${extension}`;

    return {
      uri: asset.uri,
      name: asset.fileName ?? fallbackName,
      mimeType: asset.mimeType ?? 'image/jpeg',
      size: asset.fileSize ?? null,
      source: sourceType};
  }, []);

  const pickComplianceImage = useCallback(async (
    sourceType: 'camera' | 'gallery',
    targetLabel: string,
    fallbackPrefix: string,
    onSelect: (file: IntakeProofOfFundsFile) => void,
  ) => {
    try {
      if (Platform.OS !== 'web') {
        if (sourceType === 'camera') {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permission Required', 'Please allow camera access to take a document photo.');
            return;
          }
        } else {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permission Required', 'Please allow photo access to upload a document from your gallery.');
            return;
          }
        }
      }

      const pickerOptions: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.85};

      const result = sourceType === 'camera'
        ? await ImagePicker.launchCameraAsync(pickerOptions)
        : await ImagePicker.launchImageLibraryAsync(pickerOptions);

      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      if (!asset?.uri) {
        Alert.alert('Upload Error', 'We could not read that image. Please try again.');
        return;
      }

      const nextFile = createImageUploadFile(asset, sourceType, fallbackPrefix);
      onSelect(nextFile);
      console.log('[InvestorIntake] Compliance image selected:', targetLabel, nextFile.name, sourceType);
    } catch (err) {
      console.log('[InvestorIntake] Compliance image picker exception:', (err as Error)?.message);
      Alert.alert('Upload Error', 'We could not open your camera or gallery. Please try again.');
    }
  }, [createImageUploadFile]);

  const openPrimaryIdPicker = useCallback((sourceType: 'camera' | 'gallery') => {
    void pickComplianceImage(sourceType, getIdentificationTypeLabel(form.primaryIdType), 'primary-id', (file) => {
      setPrimaryIdUpload(file);
    });
  }, [form.primaryIdType, pickComplianceImage]);

  const openSecondaryIdPicker = useCallback((sourceType: 'camera' | 'gallery') => {
    void pickComplianceImage(sourceType, getIdentificationTypeLabel(form.secondaryIdType), 'secondary-id', (file) => {
      setSecondaryIdUpload(file);
    });
  }, [form.secondaryIdType, pickComplianceImage]);

  const openTaxDocumentPicker = useCallback((sourceType: 'camera' | 'gallery') => {
    void pickComplianceImage(sourceType, isCorporate ? 'Company tax or registration document' : 'SSN or tax document', isCorporate ? 'company-tax-document' : 'tax-document', (file) => {
      setTaxDocumentUpload(file);
    });
  }, [isCorporate, pickComplianceImage]);

  const signatureMatches = useMemo(() => {
    const normalizedSignature = form.signatureName.trim().toLowerCase();
    const normalizedFullName = fullName.trim().toLowerCase();
    if (!normalizedSignature || !normalizedFullName) {
      return false;
    }
    return normalizedSignature === normalizedFullName;
  }, [form.signatureName, fullName]);

  const hasDistinctDocumentTypes = form.primaryIdType !== form.secondaryIdType;

  const documentRequirementsMet = useMemo(() => {
    const baseDocumentFieldsReady = form.primaryIdReference.trim().length > 0
      && form.secondaryIdReference.trim().length > 0
      && form.documentIssuingCountry.trim().length > 0
      && form.taxResidencyCountry.trim().length > 0
      && hasDistinctDocumentTypes;

    if (!baseDocumentFieldsReady) {
      return false;
    }

    if (isCorporate) {
      return form.companyName.trim().length > 0
        && form.companyRole.trim().length > 0
        && form.companyEin.trim().length > 0
        && form.companyTaxId.trim().length > 0
        && form.companyRegistrationCountry.trim().length > 0
        && form.beneficialOwnerName.trim().length > 0;
    }

    return form.taxIdReference.trim().length > 0;
  }, [form.beneficialOwnerName, form.companyEin, form.companyName, form.companyRegistrationCountry, form.companyRole, form.companyTaxId, form.documentIssuingCountry, form.primaryIdReference, form.secondaryIdReference, form.taxIdReference, form.taxResidencyCountry, hasDistinctDocumentTypes, isCorporate]);

  const requiredAcknowledgementsAccepted = useMemo(() => {
    if (isCorporate) {
      return contactConsent && taxResponsibilityAccepted && identityReviewAccepted && entityAuthorityAccepted && agreementAccepted;
    }

    return contactConsent && taxResponsibilityAccepted && identityReviewAccepted && agreementAccepted;
  }, [agreementAccepted, contactConsent, entityAuthorityAccepted, identityReviewAccepted, isCorporate, taxResponsibilityAccepted]);

  const canSubmit = useMemo(() => {
    return isFormValid(fullName, form.email, form.phone, phoneVerified, contactConsent)
      && requiredAcknowledgementsAccepted
      && signatureMatches
      && form.investmentRange.length > 0
      && form.returnExpectation.length > 0
      && documentRequirementsMet;
  }, [contactConsent, documentRequirementsMet, form.email, form.investmentRange, form.phone, form.returnExpectation, fullName, phoneVerified, requiredAcknowledgementsAccepted, signatureMatches]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      console.log('[InvestorIntake] Submitting lead');

      let uploadedProof = proofOfFunds;
      let uploadedPrimaryId = primaryIdUpload;
      let uploadedSecondaryId = secondaryIdUpload;
      let uploadedTaxDocument = taxDocumentUpload;

      try {
        if (primaryIdUpload?.uri && !primaryIdUpload.publicUrl && !primaryIdUpload.storagePath) {
          setIdentityUploadPending(true);
          uploadedPrimaryId = await uploadInvestorIntakeFile(primaryIdUpload, 'identity-primary');
          setPrimaryIdUpload(uploadedPrimaryId);
        }

        if (secondaryIdUpload?.uri && !secondaryIdUpload.publicUrl && !secondaryIdUpload.storagePath) {
          setIdentityUploadPending(true);
          uploadedSecondaryId = await uploadInvestorIntakeFile(secondaryIdUpload, 'identity-secondary');
          setSecondaryIdUpload(uploadedSecondaryId);
        }

        if (taxDocumentUpload?.uri && !taxDocumentUpload.publicUrl && !taxDocumentUpload.storagePath) {
          setIdentityUploadPending(true);
          uploadedTaxDocument = await uploadInvestorIntakeFile(taxDocumentUpload, isCorporate ? 'entity-tax-document' : 'tax-document');
          setTaxDocumentUpload(uploadedTaxDocument);
        }

        if (proofOfFunds?.uri && !proofOfFunds.publicUrl && !proofOfFunds.storagePath) {
          setProofUploadPending(true);
          uploadedProof = await uploadProofOfFundsFile(proofOfFunds);
          setProofOfFunds(uploadedProof);
        }

        const result = await submitWaitlistEntry({
          full_name: fullName,
          first_name: form.firstName,
          last_name: form.lastName,
          email: form.email,
          phone: form.phone,
          accredited_status: form.accreditedStatus,
          consent: contactConsent,
          agreement_accepted: agreementAccepted,
          agreement_version: INVESTOR_MEMBER_AGREEMENT_VERSION,
          signature_name: form.signatureName,
          investment_range: form.investmentRange,
          return_expectation: form.returnExpectation,
          preferred_call_time: form.bestTimeForCall,
          best_time_for_call: form.bestTimeForCall,
          investment_timeline: INVESTOR_TIMELINE_STEPS.map((step) => step.label).join(' > '),
          membership_interest: 'waitlist',
          proof_of_funds_url: uploadedProof?.publicUrl ?? null,
          proof_of_funds_name: uploadedProof?.name ?? null,
          proof_of_funds_storage_path: uploadedProof?.storagePath ?? null,
          primary_id_upload_url: uploadedPrimaryId?.publicUrl ?? null,
          primary_id_upload_name: uploadedPrimaryId?.name ?? null,
          primary_id_upload_storage_path: uploadedPrimaryId?.storagePath ?? null,
          secondary_id_upload_url: uploadedSecondaryId?.publicUrl ?? null,
          secondary_id_upload_name: uploadedSecondaryId?.name ?? null,
          secondary_id_upload_storage_path: uploadedSecondaryId?.storagePath ?? null,
          tax_document_upload_url: uploadedTaxDocument?.publicUrl ?? null,
          tax_document_upload_name: uploadedTaxDocument?.name ?? null,
          tax_document_upload_storage_path: uploadedTaxDocument?.storagePath ?? null,
          investor_type: form.entityType,
          primary_id_type: form.primaryIdType,
          primary_id_reference: form.primaryIdReference,
          secondary_id_type: form.secondaryIdType,
          secondary_id_reference: form.secondaryIdReference,
          document_issuing_country: form.documentIssuingCountry,
          tax_residency_country: form.taxResidencyCountry,
          tax_id_reference: form.taxIdReference,
          company_name: form.companyName,
          company_role: form.companyRole,
          company_ein: form.companyEin,
          company_tax_id: form.companyTaxId,
          company_registration_country: form.companyRegistrationCountry,
          beneficial_owner_name: form.beneficialOwnerName,
          legal_ack_tax_reporting: taxResponsibilityAccepted,
          legal_ack_identity_review: identityReviewAccepted,
          legal_ack_entity_authority: isCorporate ? entityAuthorityAccepted : false,
          phone_verified: phoneVerified,
          source,
          page_path: attribution.pagePath,
          utm_source: attribution.utm_source,
          utm_medium: attribution.utm_medium,
          utm_campaign: attribution.utm_campaign,
          utm_content: attribution.utm_content,
          utm_term: attribution.utm_term,
          referrer: attribution.referrer});

        if (!result.success || !result.confirmedWrite || !result.persistedId) {
          console.log('[InvestorIntake] Submission was not confirmed by persistence layer:', result);
          throw new Error(result.error ?? 'submission_failed');
        }

        return result;
      } finally {
        setProofUploadPending(false);
        setIdentityUploadPending(false);
      }
    },
    onSuccess: (result) => {
      console.log('[InvestorIntake] Submission confirmed:', result.persistedTable, result.persistedId);
      setSubmitted(true);
      Animated.parallel([
        Animated.spring(successScale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
        Animated.timing(successOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    },
    onError: (err: Error) => {
      setProofUploadPending(false);
      setIdentityUploadPending(false);
      setFormError(getErrorMessage(err.message as any));
    }});

  const handleSubmit = useCallback(() => {
    setFormError('');
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setFormError('Please enter your first and last name.');
      return;
    }
    if (!validateEmail(form.email)) {
      setFormError(getErrorMessage('invalid_email'));
      return;
    }
    if (!validatePhone(form.phone)) {
      setFormError(getErrorMessage('invalid_phone'));
      return;
    }
    if (!phoneVerified) {
      setFormError('Please verify your cell number with OTP first.');
      return;
    }
    if (!form.investmentRange) {
      setFormError('Please select how much you want to invest.');
      return;
    }
    if (!form.returnExpectation) {
      setFormError('Please select your return target.');
      return;
    }
    if (!form.primaryIdReference.trim() || !form.secondaryIdReference.trim()) {
      setFormError('Please enter both identification references.');
      return;
    }
    if (!hasDistinctDocumentTypes) {
      setFormError('Please choose two different identification types.');
      return;
    }
    if (!form.documentIssuingCountry.trim() || !form.taxResidencyCountry.trim()) {
      setFormError('Please provide issuing country and tax residency details.');
      return;
    }
    if (isCorporate) {
      if (!form.companyName.trim() || !form.companyRole.trim() || !form.companyEin.trim() || !form.companyTaxId.trim() || !form.companyRegistrationCountry.trim() || !form.beneficialOwnerName.trim()) {
        setFormError('Please complete the company identity, signer, EIN, tax ID, and beneficial-owner fields.');
        return;
      }
    } else if (!form.taxIdReference.trim()) {
      setFormError('Please enter your SSN / tax ID reference.');
      return;
    }
    if (!contactConsent) {
      setFormError('Please allow IVX to contact you about investor onboarding.');
      return;
    }
    if (!identityReviewAccepted) {
      setFormError('Please authorize identity and compliance review.');
      return;
    }
    if (!taxResponsibilityAccepted) {
      setFormError('Please confirm your tax reporting responsibility.');
      return;
    }
    if (isCorporate && !entityAuthorityAccepted) {
      setFormError('Please confirm you are authorized to act for the entity.');
      return;
    }
    if (!agreementAccepted) {
      setFormError('Please accept the investor member terms and acknowledgements.');
      return;
    }
    if (!signatureMatches) {
      setFormError('Your typed signature must match your first and last name.');
      return;
    }
    submitMutation.mutate();
  }, [agreementAccepted, contactConsent, entityAuthorityAccepted, form.beneficialOwnerName, form.companyEin, form.companyName, form.companyRegistrationCountry, form.companyRole, form.companyTaxId, form.documentIssuingCountry, form.email, form.firstName, form.investmentRange, form.lastName, form.phone, form.primaryIdReference, form.returnExpectation, form.secondaryIdReference, form.taxIdReference, form.taxResidencyCountry, hasDistinctDocumentTypes, identityReviewAccepted, isCorporate, phoneVerified, signatureMatches, submitMutation, taxResponsibilityAccepted]);

  if (submitted) {
    return (
      <Animated.View style={[styles.successWrap, { opacity: successOpacity, transform: [{ scale: successScale }] }]}> 
        <View style={styles.successIconWrap}>
          <CheckCircle size={56} color={Colors.success} />
        </View>
        <Text style={styles.successTitle}>Investor profile captured</Text>
        <Text style={styles.successSubtitle}>
          We saved your verified contact details, identity references, tax acknowledgements, and member agreement acceptance. Our team can now move you into secure KYC and member onboarding when the next opening is available.
        </Text>
        <View style={styles.successCard}>
          <Text style={styles.successCardLabel}>Call window</Text>
          <Text style={styles.successCardValue}>{form.bestTimeForCall || 'We will contact you by email first'}</Text>
        </View>
        <View style={styles.successCard}>
          <Text style={styles.successCardLabel}>Target allocation</Text>
          <Text style={styles.successCardValue}>{form.investmentRange}</Text>
        </View>
        <TouchableOpacity
          style={styles.primarySubmitButton}
          onPress={() => router.push('/signup' as any)}
          activeOpacity={0.85}
          testID={`${testIdPrefix}-create-member-account`}
        >
          <Text style={styles.primarySubmitText}>Create Member Account</Text>
          <ArrowRight size={16} color="#000" />
        </TouchableOpacity>
      </Animated.View>
    );
  }

  const surfaceStyle = variant === 'landing' ? styles.surfaceLanding : styles.surfaceScreen;

  return (
    <View style={[styles.container, surfaceStyle]}>
      <View style={styles.row}>
        <View style={styles.halfField}>
          <View style={styles.inputWrap}>
            <User size={18} color={Colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="First name"
              placeholderTextColor={Colors.inputPlaceholder}
              value={form.firstName}
              onChangeText={(value) => updateField('firstName', value)}
              autoCapitalize="words"
              testID={`${testIdPrefix}-first-name`}
            />
          </View>
        </View>
        <View style={styles.halfField}>
          <View style={styles.inputWrap}>
            <User size={18} color={Colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="Last name"
              placeholderTextColor={Colors.inputPlaceholder}
              value={form.lastName}
              onChangeText={(value) => updateField('lastName', value)}
              autoCapitalize="words"
              testID={`${testIdPrefix}-last-name`}
            />
          </View>
        </View>
      </View>

      <View style={styles.inputWrap}>
        <Mail size={18} color={Colors.textTertiary} />
        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor={Colors.inputPlaceholder}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={form.email}
          onChangeText={(value) => updateField('email', value)}
          testID={`${testIdPrefix}-email`}
        />
      </View>

      <View style={styles.otpRow}>
        <View style={[styles.inputWrap, styles.otpPhoneWrap]}>
          <Phone size={18} color={Colors.textTertiary} />
          <TextInput
            style={styles.input}
            placeholder="Cell phone"
            placeholderTextColor={Colors.inputPlaceholder}
            keyboardType="phone-pad"
            value={form.phone}
            editable={!phoneVerified}
            onChangeText={(value) => {
              updateField('phone', value);
              if (phoneVerified) {
                setPhoneVerified(false);
                setOtpSent(false);
                setOtpCode('');
              }
            }}
            testID={`${testIdPrefix}-phone`}
          />
          {phoneVerified ? <ShieldCheck size={18} color={Colors.success} /> : null}
        </View>
        {!phoneVerified ? (
          <TouchableOpacity
            style={[styles.otpActionButton, (otpCooldown > 0 || otpSending || !validatePhone(form.phone)) && styles.buttonDisabled]}
            onPress={handleSendOtp}
            disabled={otpCooldown > 0 || otpSending || !validatePhone(form.phone)}
            activeOpacity={0.75}
            testID={`${testIdPrefix}-send-otp`}
          >
            {otpSending ? <ShimmerIndicator size="small" color="#000" /> : <Text style={styles.otpActionText}>{otpCooldown > 0 ? `${otpCooldown}s` : otpSent ? 'Resend' : 'Send OTP'}</Text>}
          </TouchableOpacity>
        ) : null}
      </View>

      {otpSent && !phoneVerified ? (
        <View style={styles.otpVerifyWrap}>
          <View style={[styles.inputWrap, styles.otpInputWrap]}>
            <TextInput
              style={styles.input}
              placeholder="6-digit code"
              placeholderTextColor={Colors.inputPlaceholder}
              keyboardType="number-pad"
              maxLength={6}
              value={otpCode}
              onChangeText={setOtpCode}
              testID={`${testIdPrefix}-otp-code`}
            />
          </View>
          <TouchableOpacity
            style={[styles.verifyButton, (otpCode.length < 6 || otpVerifying) && styles.buttonDisabled]}
            onPress={handleVerifyOtp}
            disabled={otpCode.length < 6 || otpVerifying}
            activeOpacity={0.75}
            testID={`${testIdPrefix}-verify-otp`}
          >
            {otpVerifying ? <ShimmerIndicator size="small" color="#000" /> : <Text style={styles.verifyButtonText}>Verify</Text>}
          </TouchableOpacity>
        </View>
      ) : null}

      {otpError ? (
        <View style={styles.messageRow}>
          <AlertCircle size={14} color={Colors.error} />
          <Text style={styles.messageErrorText}>{otpError}</Text>
        </View>
      ) : null}

      {phoneVerified ? (
        <View style={styles.verifiedBanner}>
          <ShieldCheck size={14} color={Colors.success} />
          <Text style={styles.verifiedBannerText}>Cell phone verified with OTP</Text>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>Investor profile</Text>

      <DropdownRow
        icon={DollarSign}
        label={form.investmentRange || 'How much do you want to invest?'}
        isPlaceholder={!form.investmentRange}
        isOpen={activeDropdown === 'investmentRange'}
        onPress={() => toggleDropdown('investmentRange')}
        testID={`${testIdPrefix}-investment-range`}
      />
      {activeDropdown === 'investmentRange' ? (
        <DropdownList
          options={Array.from(INVESTMENT_RANGE_OPTIONS)}
          selectedValue={form.investmentRange}
          onSelect={(value) => selectDropdownValue('investmentRange', value)}
        />
      ) : null}

      <DropdownRow
        icon={TrendingUp}
        label={form.returnExpectation || 'What return profile are you targeting?'}
        isPlaceholder={!form.returnExpectation}
        isOpen={activeDropdown === 'returnExpectation'}
        onPress={() => toggleDropdown('returnExpectation')}
        testID={`${testIdPrefix}-return-expectation`}
      />
      {activeDropdown === 'returnExpectation' ? (
        <DropdownList
          options={Array.from(RETURN_EXPECTATION_OPTIONS)}
          selectedValue={form.returnExpectation}
          onSelect={(value) => selectDropdownValue('returnExpectation', value)}
        />
      ) : null}

      <DropdownRow
        icon={Clock}
        label={form.bestTimeForCall || 'Best time for a call'}
        isPlaceholder={!form.bestTimeForCall}
        isOpen={activeDropdown === 'bestTimeForCall'}
        onPress={() => toggleDropdown('bestTimeForCall')}
        testID={`${testIdPrefix}-best-time-call`}
      />
      {activeDropdown === 'bestTimeForCall' ? (
        <DropdownList
          options={Array.from(CALL_TIME_OPTIONS)}
          selectedValue={form.bestTimeForCall}
          onSelect={(value) => selectDropdownValue('bestTimeForCall', value)}
        />
      ) : null}

      <DropdownRow
        icon={Building2}
        label={ACCREDITED_STATUS_OPTIONS.find((option) => option.id === form.accreditedStatus)?.label || 'Investor status'}
        isPlaceholder={false}
        isOpen={activeDropdown === 'accreditedStatus'}
        onPress={() => toggleDropdown('accreditedStatus')}
        testID={`${testIdPrefix}-accredited-status`}
      />
      {activeDropdown === 'accreditedStatus' ? (
        <DropdownList
          options={ACCREDITED_STATUS_OPTIONS.map((option) => option.label)}
          selectedValue={ACCREDITED_STATUS_OPTIONS.find((option) => option.id === form.accreditedStatus)?.label || ''}
          onSelect={(label) => {
            const next = ACCREDITED_STATUS_OPTIONS.find((option) => option.label === label);
            selectDropdownValue('accreditedStatus', next?.id || 'unsure');
          }}
        />
      ) : null}

      <Text style={styles.sectionLabel}>Identity + compliance</Text>
      <View style={styles.complianceIntroCard}>
        <Text style={styles.complianceIntroTitle}>Two IDs, tax responsibility, and entity readiness</Text>
        <Text style={styles.complianceIntroText}>
          Enter document references now and add clear photos from your gallery or camera for passport, ID, SSN, or company tax review.
        </Text>
      </View>

      <View style={styles.entitySwitchRow}>
        {INVESTOR_ENTITY_OPTIONS.map((option) => {
          const isActive = form.entityType === option.id;
          return (
            <TouchableOpacity
              key={option.id}
              style={[styles.entitySwitchButton, isActive && styles.entitySwitchButtonActive]}
              onPress={() => handleEntityTypeChange(option.id)}
              activeOpacity={0.85}
              testID={`${testIdPrefix}-entity-${option.id}`}
            >
              <Text style={[styles.entitySwitchText, isActive && styles.entitySwitchTextActive]}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <DropdownRow
        icon={FileText}
        label={getIdentificationTypeLabel(form.primaryIdType)}
        isPlaceholder={false}
        isOpen={activeDropdown === 'primaryIdType'}
        onPress={() => toggleDropdown('primaryIdType')}
        testID={`${testIdPrefix}-primary-id-type`}
      />
      {activeDropdown === 'primaryIdType' ? (
        <DropdownList
          options={IDENTIFICATION_TYPE_OPTIONS.map((option) => option.label)}
          selectedValue={getIdentificationTypeLabel(form.primaryIdType)}
          onSelect={(label) => {
            const next = IDENTIFICATION_TYPE_OPTIONS.find((option) => option.label === label);
            if (next) {
              selectDropdownValue('primaryIdType', next.id);
            }
          }}
        />
      ) : null}

      <View style={styles.inputWrap}>
        <FileText size={18} color={Colors.textTertiary} />
        <TextInput
          style={styles.input}
          placeholder="Primary ID reference / last 4"
          placeholderTextColor={Colors.inputPlaceholder}
          value={form.primaryIdReference}
          onChangeText={(value) => updateField('primaryIdReference', value.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          testID={`${testIdPrefix}-primary-id-reference`}
        />
      </View>

      <DropdownRow
        icon={FileText}
        label={getIdentificationTypeLabel(form.secondaryIdType)}
        isPlaceholder={false}
        isOpen={activeDropdown === 'secondaryIdType'}
        onPress={() => toggleDropdown('secondaryIdType')}
        testID={`${testIdPrefix}-secondary-id-type`}
      />
      {activeDropdown === 'secondaryIdType' ? (
        <DropdownList
          options={IDENTIFICATION_TYPE_OPTIONS.map((option) => option.label)}
          selectedValue={getIdentificationTypeLabel(form.secondaryIdType)}
          onSelect={(label) => {
            const next = IDENTIFICATION_TYPE_OPTIONS.find((option) => option.label === label);
            if (next) {
              selectDropdownValue('secondaryIdType', next.id);
            }
          }}
        />
      ) : null}

      <View style={styles.inputWrap}>
        <FileText size={18} color={Colors.textTertiary} />
        <TextInput
          style={styles.input}
          placeholder="Secondary ID reference / last 4"
          placeholderTextColor={Colors.inputPlaceholder}
          value={form.secondaryIdReference}
          onChangeText={(value) => updateField('secondaryIdReference', value.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          testID={`${testIdPrefix}-secondary-id-reference`}
        />
      </View>

      <View style={styles.row}>
        <View style={styles.halfField}>
          <View style={styles.inputWrap}>
            <Building2 size={18} color={Colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="ID issuing country"
              placeholderTextColor={Colors.inputPlaceholder}
              value={form.documentIssuingCountry}
              onChangeText={(value) => updateField('documentIssuingCountry', value)}
              autoCapitalize="words"
              testID={`${testIdPrefix}-document-country`}
            />
          </View>
        </View>
        <View style={styles.halfField}>
          <View style={styles.inputWrap}>
            <ShieldCheck size={18} color={Colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="Tax residency"
              placeholderTextColor={Colors.inputPlaceholder}
              value={form.taxResidencyCountry}
              onChangeText={(value) => updateField('taxResidencyCountry', value)}
              autoCapitalize="words"
              testID={`${testIdPrefix}-tax-residency`}
            />
          </View>
        </View>
      </View>

      {isCorporate ? (
        <>
          <Text style={styles.subsectionHint}>Entity applicants must provide signer authority, beneficial-owner, EIN, company tax details, and supporting document photos.</Text>
          <View style={styles.inputWrap}>
            <Building2 size={18} color={Colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="Legal company name"
              placeholderTextColor={Colors.inputPlaceholder}
              value={form.companyName}
              onChangeText={(value) => updateField('companyName', value)}
              autoCapitalize="words"
              testID={`${testIdPrefix}-company-name`}
            />
          </View>
          <View style={styles.row}>
            <View style={styles.halfField}>
              <View style={styles.inputWrap}>
                <User size={18} color={Colors.textTertiary} />
                <TextInput
                  style={styles.input}
                  placeholder="Your role / title"
                  placeholderTextColor={Colors.inputPlaceholder}
                  value={form.companyRole}
                  onChangeText={(value) => updateField('companyRole', value)}
                  autoCapitalize="words"
                  testID={`${testIdPrefix}-company-role`}
                />
              </View>
            </View>
            <View style={styles.halfField}>
              <View style={styles.inputWrap}>
                <User size={18} color={Colors.textTertiary} />
                <TextInput
                  style={styles.input}
                  placeholder="Beneficial owner"
                  placeholderTextColor={Colors.inputPlaceholder}
                  value={form.beneficialOwnerName}
                  onChangeText={(value) => updateField('beneficialOwnerName', value)}
                  autoCapitalize="words"
                  testID={`${testIdPrefix}-beneficial-owner`}
                />
              </View>
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.halfField}>
              <View style={styles.inputWrap}>
                <ShieldCheck size={18} color={Colors.textTertiary} />
                <TextInput
                  style={styles.input}
                  placeholder="Company EIN"
                  placeholderTextColor={Colors.inputPlaceholder}
                  value={form.companyEin}
                  onChangeText={(value) => updateField('companyEin', value.toUpperCase())}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  testID={`${testIdPrefix}-company-ein`}
                />
              </View>
            </View>
            <View style={styles.halfField}>
              <View style={styles.inputWrap}>
                <FileText size={18} color={Colors.textTertiary} />
                <TextInput
                  style={styles.input}
                  placeholder="Company tax ID"
                  placeholderTextColor={Colors.inputPlaceholder}
                  value={form.companyTaxId}
                  onChangeText={(value) => updateField('companyTaxId', value.toUpperCase())}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  testID={`${testIdPrefix}-company-tax-id`}
                />
              </View>
            </View>
          </View>
          <View style={styles.inputWrap}>
            <Building2 size={18} color={Colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="Company registration country / jurisdiction"
              placeholderTextColor={Colors.inputPlaceholder}
              value={form.companyRegistrationCountry}
              onChangeText={(value) => updateField('companyRegistrationCountry', value)}
              autoCapitalize="words"
              testID={`${testIdPrefix}-company-registration-country`}
            />
          </View>
        </>
      ) : (
        <View style={styles.inputWrap}>
          <ShieldCheck size={18} color={Colors.textTertiary} />
          <TextInput
            style={styles.input}
            placeholder="SSN / tax ID reference (last 4 or member tax ref)"
            placeholderTextColor={Colors.inputPlaceholder}
            value={form.taxIdReference}
            onChangeText={(value) => updateField('taxIdReference', value.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            testID={`${testIdPrefix}-tax-id-reference`}
          />
        </View>
      )}

      <Text style={styles.sectionLabel}>Secure document photos</Text>
      <View style={styles.documentUploadsWrap}>
        <DocumentUploadCard
          title={`Upload ${getIdentificationTypeLabel(form.primaryIdType)}`}
          description="Take a clear photo of the front of your primary ID or passport."
          selectedFile={primaryIdUpload}
          onCameraPress={() => openPrimaryIdPicker('camera')}
          onGalleryPress={() => openPrimaryIdPicker('gallery')}
          onClearPress={() => setPrimaryIdUpload(null)}
          pending={identityUploadPending && !!primaryIdUpload?.uri && !primaryIdUpload.publicUrl && !primaryIdUpload.storagePath}
          testIDPrefix={`${testIdPrefix}-primary-id-upload`}
        />
        <DocumentUploadCard
          title={`Upload ${getIdentificationTypeLabel(form.secondaryIdType)}`}
          description="Add the second identification image from gallery or capture it with the camera."
          selectedFile={secondaryIdUpload}
          onCameraPress={() => openSecondaryIdPicker('camera')}
          onGalleryPress={() => openSecondaryIdPicker('gallery')}
          onClearPress={() => setSecondaryIdUpload(null)}
          pending={identityUploadPending && !!secondaryIdUpload?.uri && !secondaryIdUpload.publicUrl && !secondaryIdUpload.storagePath}
          testIDPrefix={`${testIdPrefix}-secondary-id-upload`}
        />
        <DocumentUploadCard
          title={isCorporate ? 'Upload company tax / registration document' : 'Upload SSN / tax document'}
          description={isCorporate
            ? 'Upload EIN, company tax ID, or registration proof for faster review.'
            : 'Upload your SSN or tax reference image if you want IVX to review it now.'}
          selectedFile={taxDocumentUpload}
          onCameraPress={() => openTaxDocumentPicker('camera')}
          onGalleryPress={() => openTaxDocumentPicker('gallery')}
          onClearPress={() => setTaxDocumentUpload(null)}
          pending={identityUploadPending && !!taxDocumentUpload?.uri && !taxDocumentUpload.publicUrl && !taxDocumentUpload.storagePath}
          testIDPrefix={`${testIdPrefix}-tax-document-upload`}
        />
      </View>

      <View style={styles.proofCard}>
        <View style={styles.proofHeader}>
          <View style={styles.proofTitleRow}>
            <FileText size={16} color={Colors.primary} />
            <Text style={styles.proofTitle}>Proof of funds</Text>
          </View>
          <Text style={styles.proofOptional}>Optional</Text>
        </View>
        <Text style={styles.proofDescription}>Upload a PDF or image if you want the team to review source-of-funds evidence before the first call.</Text>
        <TouchableOpacity
          style={styles.proofButton}
          onPress={handlePickProofOfFunds}
          activeOpacity={0.8}
          testID={`${testIdPrefix}-proof-of-funds`}
        >
          <Text style={styles.proofButtonText}>{proofOfFunds?.name || 'Select document'}</Text>
          <ArrowRight size={14} color={Colors.primary} />
        </TouchableOpacity>
        {proofUploadPending ? <ShimmerIndicator size="small" color={Colors.primary} style={styles.proofSpinner} /> : null}
      </View>

      <Text style={styles.sectionLabel}>Member access once approved</Text>
      <View style={styles.readinessGrid}>
        {MEMBER_ACCESS_ITEMS.map((item) => (
          <View key={item.id} style={styles.readinessCard}>
            <View style={[styles.readinessIconWrap, { backgroundColor: item.accent + '18' }]}> 
              <item.icon size={18} color={item.accent} />
            </View>
            <Text style={styles.readinessTitle}>{item.title}</Text>
            <Text style={styles.readinessDescription}>{item.description}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Investor timeline</Text>
      <View style={styles.timelineCard}>
        {INVESTOR_TIMELINE_STEPS.map((step, index) => (
          <View key={step.id} style={[styles.timelineRow, index < INVESTOR_TIMELINE_STEPS.length - 1 && styles.timelineRowBorder]}>
            <View style={styles.timelineDot} />
            <View style={styles.timelineCopy}>
              <Text style={styles.timelineLabel}>{step.label}</Text>
              <Text style={styles.timelineDescription}>{step.detail}</Text>
            </View>
          </View>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Investor member terms</Text>
      <View style={styles.agreementCard}>
        {INVESTOR_MEMBER_AGREEMENT_SECTIONS.map((section) => (
          <View key={section.id} style={styles.agreementRow}>
            <Text style={styles.agreementTitle}>{section.title}</Text>
            <Text style={styles.agreementText}>{section.text}</Text>
          </View>
        ))}
      </View>

      <View style={styles.inputWrap}>
        <CheckCircle2 size={18} color={Colors.textTertiary} />
        <TextInput
          style={styles.input}
          placeholder="Type your full legal name as signature"
          placeholderTextColor={Colors.inputPlaceholder}
          value={form.signatureName}
          onChangeText={(value) => updateField('signatureName', value)}
          autoCapitalize="words"
          testID={`${testIdPrefix}-signature-name`}
        />
      </View>

      <TouchableOpacity style={styles.checkboxRow} onPress={() => setContactConsent((prev) => !prev)} activeOpacity={0.75} testID={`${testIdPrefix}-contact-consent`}>
        <View style={[styles.checkbox, contactConsent && styles.checkboxChecked]}>{contactConsent ? <CheckCircle2 size={14} color="#000" /> : null}</View>
        <Text style={styles.checkboxText}>I allow IVX to contact me by email and SMS about waitlist review, member onboarding, wallet setup, secure KYC, and live opportunities.</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.checkboxRow} onPress={() => setIdentityReviewAccepted((prev) => !prev)} activeOpacity={0.75} testID={`${testIdPrefix}-identity-review-consent`}>
        <View style={[styles.checkbox, identityReviewAccepted && styles.checkboxChecked]}>{identityReviewAccepted ? <CheckCircle2 size={14} color="#000" /> : null}</View>
        <Text style={styles.checkboxText}>I authorize IVX to request identity, passport, tax, sanctions, AML, source-of-funds, and beneficial-owner documentation before account activation.</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.checkboxRow} onPress={() => setTaxResponsibilityAccepted((prev) => !prev)} activeOpacity={0.75} testID={`${testIdPrefix}-tax-responsibility-consent`}>
        <View style={[styles.checkbox, taxResponsibilityAccepted && styles.checkboxChecked]}>{taxResponsibilityAccepted ? <CheckCircle2 size={14} color="#000" /> : null}</View>
        <Text style={styles.checkboxText}>I understand I am responsible for my own tax reporting, withholding, filings, and payments with the IRS and any other relevant government authority.</Text>
      </TouchableOpacity>

      {isCorporate ? (
        <TouchableOpacity style={styles.checkboxRow} onPress={() => setEntityAuthorityAccepted((prev) => !prev)} activeOpacity={0.75} testID={`${testIdPrefix}-entity-authority-consent`}>
          <View style={[styles.checkbox, entityAuthorityAccepted && styles.checkboxChecked]}>{entityAuthorityAccepted ? <CheckCircle2 size={14} color="#000" /> : null}</View>
          <Text style={styles.checkboxText}>I confirm I am authorized to act for this entity and will provide valid EIN, company tax ID, and beneficial-owner information.</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity style={styles.checkboxRow} onPress={() => setAgreementAccepted((prev) => !prev)} activeOpacity={0.75} testID={`${testIdPrefix}-agreement-consent`}>
        <View style={[styles.checkbox, agreementAccepted && styles.checkboxChecked]}>{agreementAccepted ? <CheckCircle2 size={14} color="#000" /> : null}</View>
        <Text style={styles.checkboxText}>I have reviewed the IVX investor member terms, including identity review and tax-responsibility disclosures, and I adopt the typed signature above as my electronic acknowledgement. Version {INVESTOR_MEMBER_AGREEMENT_VERSION}.</Text>
      </TouchableOpacity>

      {formError ? (
        <View style={styles.messageRow}>
          <AlertCircle size={14} color={Colors.error} />
          <Text style={styles.messageErrorText}>{formError}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.primarySubmitButton, (!canSubmit || submitMutation.isPending || proofUploadPending || identityUploadPending) && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={!canSubmit || submitMutation.isPending || proofUploadPending || identityUploadPending}
        activeOpacity={0.85}
        testID={`${testIdPrefix}-submit`}
      >
        {submitMutation.isPending || proofUploadPending || identityUploadPending ? (
          <ShimmerIndicator size="small" color="#000" />
        ) : (
          <>
            <Text style={styles.primarySubmitText}>Save Investor Waitlist Profile</Text>
            <ArrowRight size={16} color="#000" />
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryLinkButton} onPress={() => router.push('/signup' as any)} activeOpacity={0.75} testID={`${testIdPrefix}-member-signup-link`}>
        <Text style={styles.secondaryLinkText}>Already approved or invited? Create your member account</Text>
      </TouchableOpacity>
    </View>
  );
}

function DropdownRow({
  icon: Icon,
  label,
  isPlaceholder,
  isOpen,
  onPress,
  testID}: {
  icon: typeof DollarSign;
  label: string;
  isPlaceholder: boolean;
  isOpen: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <TouchableOpacity style={styles.dropdownTrigger} onPress={onPress} activeOpacity={0.75} testID={testID}>
      <Icon size={18} color={Colors.textTertiary} />
      <Text style={[styles.dropdownText, isPlaceholder && styles.dropdownPlaceholder]}>{label}</Text>
      <ChevronDown size={18} color={isOpen ? Colors.primary : Colors.textTertiary} />
    </TouchableOpacity>
  );
}

function DropdownList({
  options,
  selectedValue,
  onSelect}: {
  options: string[];
  selectedValue: string;
  onSelect: (value: string) => void;
}) {
  return (
    <View style={styles.dropdownList}>
      {options.map((option) => {
        const isActive = option === selectedValue;
        return (
          <TouchableOpacity key={option} style={[styles.dropdownOption, isActive && styles.dropdownOptionActive]} onPress={() => onSelect(option)} activeOpacity={0.75}>
            <Text style={[styles.dropdownOptionText, isActive && styles.dropdownOptionTextActive]}>{option}</Text>
            {isActive ? <CheckCircle size={16} color={Colors.primary} /> : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function DocumentUploadCard({
  title,
  description,
  selectedFile,
  onCameraPress,
  onGalleryPress,
  onClearPress,
  pending,
  testIDPrefix}: {
  title: string;
  description: string;
  selectedFile: IntakeProofOfFundsFile | null;
  onCameraPress: () => void;
  onGalleryPress: () => void;
  onClearPress: () => void;
  pending: boolean;
  testIDPrefix: string;
}) {
  const sourceLabel = selectedFile?.source === 'camera'
    ? 'Captured with camera'
    : selectedFile?.source === 'gallery'
      ? 'Selected from gallery'
      : selectedFile?.source === 'document_picker'
        ? 'Selected from files'
        : '';

  return (
    <View style={styles.documentUploadCard}>
      <View style={styles.documentUploadHeader}>
        <View style={styles.documentUploadTitleWrap}>
          <FileText size={16} color={Colors.primary} />
          <Text style={styles.documentUploadTitle}>{title}</Text>
        </View>
        {pending ? <ShimmerIndicator size="small" color={Colors.primary} /> : null}
      </View>
      <Text style={styles.documentUploadDescription}>{description}</Text>
      <View style={styles.documentUploadButtonsRow}>
        <TouchableOpacity style={styles.documentUploadButton} onPress={onGalleryPress} activeOpacity={0.8} testID={`${testIDPrefix}-gallery`}>
          <Upload size={14} color={Colors.primary} />
          <Text style={styles.documentUploadButtonText}>Gallery</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.documentUploadButton} onPress={onCameraPress} activeOpacity={0.8} testID={`${testIDPrefix}-camera`}>
          <Camera size={14} color={Colors.primary} />
          <Text style={styles.documentUploadButtonText}>Camera</Text>
        </TouchableOpacity>
      </View>
      {selectedFile ? (
        <View style={styles.documentUploadMetaCard}>
          <View style={styles.documentUploadMetaCopy}>
            <Text style={styles.documentUploadFileName}>{selectedFile.name}</Text>
            <Text style={styles.documentUploadMetaText}>{sourceLabel || 'Ready to upload securely'}</Text>
          </View>
          <TouchableOpacity style={styles.documentUploadClearButton} onPress={onClearPress} activeOpacity={0.8} testID={`${testIDPrefix}-clear`}>
            <Trash2 size={14} color={Colors.error} />
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%'},
  surfaceLanding: {
    backgroundColor: 'transparent'},
  surfaceScreen: {
    backgroundColor: 'transparent'},
  row: {
    flexDirection: 'row',
    gap: 10},
  halfField: {
    flex: 1},
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: 14,
    height: 52,
    gap: 10,
    marginBottom: 10},
  input: {
    flex: 1,
    height: 52,
    color: Colors.text,
    fontSize: 15,
    fontWeight: '500' as const},
  otpRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start'},
  otpPhoneWrap: {
    flex: 1},
  otpActionButton: {
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary},
  otpActionText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '700' as const},
  otpVerifyWrap: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginBottom: 6},
  otpInputWrap: {
    flex: 1,
    marginBottom: 0},
  verifyButton: {
    height: 52,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.success},
  verifyButtonText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '700' as const},
  buttonDisabled: {
    opacity: 0.45},
  verifiedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.success + '15',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.success + '25',
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 14},
  verifiedBannerText: {
    color: Colors.success,
    fontSize: 13,
    fontWeight: '600' as const},
  sectionLabel: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 1.4,
    marginTop: 12,
    marginBottom: 10,
    textTransform: 'uppercase'},
  complianceIntroCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 16,
    marginBottom: 10},
  complianceIntroTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const,
    marginBottom: 6},
  complianceIntroText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20},
  entitySwitchRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10},
  entitySwitchButton: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    backgroundColor: Colors.inputBackground,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center'},
  entitySwitchButtonActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  entitySwitchText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '700' as const,
    textAlign: 'center'},
  entitySwitchTextActive: {
    color: '#000'},
  subsectionHint: {
    color: Colors.textTertiary,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10},
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: 14,
    height: 52,
    gap: 10,
    marginBottom: 10},
  dropdownText: {
    flex: 1,
    color: Colors.text,
    fontSize: 15,
    fontWeight: '500' as const},
  dropdownPlaceholder: {
    color: Colors.inputPlaceholder},
  dropdownList: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 10,
    marginTop: -4},
  dropdownOption: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  dropdownOptionActive: {
    backgroundColor: Colors.primary + '12'},
  dropdownOptionText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '500' as const},
  dropdownOptionTextActive: {
    color: Colors.primary,
    fontWeight: '700' as const},
  documentUploadsWrap: {
    gap: 10,
    marginBottom: 4},
  documentUploadCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 16},
  documentUploadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8},
  documentUploadTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1},
  documentUploadTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
    flexShrink: 1},
  documentUploadDescription: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20},
  documentUploadButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12},
  documentUploadButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    backgroundColor: Colors.primary + '08',
    paddingVertical: 12,
    paddingHorizontal: 12},
  documentUploadButtonText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '700' as const},
  documentUploadMetaCard: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.success + '30',
    backgroundColor: Colors.success + '10',
    paddingHorizontal: 14,
    paddingVertical: 12},
  documentUploadMetaCopy: {
    flex: 1,
    gap: 4},
  documentUploadFileName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const},
  documentUploadMetaText: {
    color: Colors.success,
    fontSize: 12,
    fontWeight: '600' as const},
  documentUploadClearButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.error + '10',
    borderWidth: 1,
    borderColor: Colors.error + '20'},
  proofCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 16,
    marginTop: 4},
  proofHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8},
  proofTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  proofTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const},
  proofOptional: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '600' as const},
  proofDescription: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20},
  proofButton: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    backgroundColor: Colors.primary + '08',
    paddingHorizontal: 14,
    paddingVertical: 12},
  proofButtonText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '700' as const,
    flex: 1,
    marginRight: 8},
  proofSpinner: {
    marginTop: 10},
  readinessGrid: {
    gap: 10},
  readinessCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 16},
  readinessIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10},
  readinessTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
    marginBottom: 6},
  readinessDescription: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20},
  timelineCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden'},
  timelineRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14},
  timelineRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
    backgroundColor: Colors.primary},
  timelineCopy: {
    flex: 1},
  timelineLabel: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
    marginBottom: 4},
  timelineDescription: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19},
  agreementCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 16,
    gap: 12},
  agreementRow: {
    gap: 6},
  agreementTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const},
  agreementText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20},
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 12},
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.inputBorder,
    backgroundColor: Colors.inputBackground,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1},
  checkboxChecked: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  checkboxText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: 2},
  messageErrorText: {
    flex: 1,
    color: Colors.error,
    fontSize: 12,
    fontWeight: '500' as const},
  primarySubmitButton: {
    height: 56,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16},
  primarySubmitText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '800' as const},
  secondaryLinkButton: {
    alignSelf: 'center',
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 8},
  secondaryLinkText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600' as const,
    textAlign: 'center'},
  successWrap: {
    alignItems: 'center',
    paddingVertical: 24},
  successIconWrap: {
    marginBottom: 18},
  successTitle: {
    color: Colors.text,
    fontSize: 25,
    fontWeight: '900' as const,
    textAlign: 'center',
    marginBottom: 10},
  successSubtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 20},
  successCard: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10},
  successCardLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const,
    marginBottom: 4},
  successCardValue: {
    color: Colors.primary,
    fontSize: 15,
    fontWeight: '700' as const}});
