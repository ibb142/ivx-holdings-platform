import React, { useState } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image} from "react-native";
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useRouter } from 'expo-router';
import {
  Building2,
  MapPin,
  FileText,
  DollarSign,
  Camera,
  CheckCircle,
  AlertTriangle,
  Info,
  ImagePlus,
  X,
  ScanLine,
  ShieldCheck,
  ShieldAlert,
  IdCard,
  FileCheck,
  RefreshCw,
  Loader} from 'lucide-react-native';
import Colors from '@/constants/colors';
const IPX_HOLDING_NAME = 'IVX HOLDINGS LLC';
const ipxFeeConfigs = [
  { id: 'fee-1', name: 'Transaction Fee', feeType: 'transaction', percentage: 2.5, isActive: true },
  { id: 'fee-2', name: 'Listing Fee', feeType: 'listing', percentage: 3.0, isActive: true },
  { id: 'fee-3', name: 'Management Fee', feeType: 'management', percentage: 1.5, isActive: true },
  { id: 'fee-4', name: 'Verification Fee', feeType: 'verification', percentage: 0.5, isActive: true },
];
function calculateIPXFee(amount: number, feeTypeOrPercent: string | number): number {
  if (typeof feeTypeOrPercent === 'string') {
    const config = ipxFeeConfigs.find(f => f.feeType === feeTypeOrPercent);
    if (!config) return 0;
    return Math.round((amount * config.percentage / 100) * 100) / 100;
  }
  return Math.round((amount * feeTypeOrPercent / 100) * 100) / 100;
}
import { generateObject } from '@/lib/ai-service';
import { z } from 'zod';
import { DocumentVerificationStatus } from '@/types';
import { formatDollar } from '@/lib/formatters';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type PropertyType = 'residential' | 'commercial' | 'mixed' | 'industrial' | 'land';
type IDType = 'drivers_license' | 'passport' | 'national_id';

interface DocumentScanState {
  uri: string | null;
  status: DocumentVerificationStatus;
  verificationResult: {
    isAuthentic: boolean;
    confidence: number;
    extractedData: Record<string, string>;
    issues: string[];
  } | null;
}

interface FormData {
  propertyAddress: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  propertyType: PropertyType;
  estimatedValue: string;
  deedNumber: string;
  description: string;
  images: string[];
}

const deedVerificationSchema = z.object({
  isAuthentic: z.boolean().describe('Whether the deed appears to be a legitimate legal document'),
  confidence: z.number().min(0).max(100).describe('Confidence percentage (0-100) of the verification'),
  documentType: z.string().describe('Type of document detected (e.g., "Property Deed", "Title Deed", "Warranty Deed")'),
  extractedData: z.object({
    deedNumber: z.string().optional().describe('Deed number if visible'),
    propertyAddress: z.string().optional().describe('Property address mentioned in deed'),
    ownerName: z.string().optional().describe('Property owner name if visible'),
    issuingAuthority: z.string().optional().describe('County or authority that issued the deed'),
    issueDate: z.string().optional().describe('Date the deed was issued'),
    recordingDate: z.string().optional().describe('Date deed was recorded')}).describe('Extracted information from the deed'),
  issues: z.array(z.string()).describe('List of potential issues or concerns with the document'),
  recommendations: z.array(z.string()).describe('Recommendations for verification')});

const idVerificationSchema = z.object({
  isAuthentic: z.boolean().describe('Whether the ID appears to be a legitimate government-issued document'),
  confidence: z.number().min(0).max(100).describe('Confidence percentage (0-100) of the verification'),
  documentType: z.string().describe('Type of ID detected (e.g., "Driver License", "Passport", "National ID")'),
  extractedData: z.object({
    fullName: z.string().optional().describe('Full name on the ID'),
    documentNumber: z.string().optional().describe('ID/License number (partially masked for security)'),
    issuingState: z.string().optional().describe('State or country that issued the ID'),
    expirationDate: z.string().optional().describe('Expiration date if visible'),
    dateOfBirth: z.string().optional().describe('Date of birth (partially masked)')}).describe('Extracted information from the ID'),
  isExpired: z.boolean().describe('Whether the ID appears to be expired'),
  issues: z.array(z.string()).describe('List of potential issues or concerns with the ID')});

export default function SubmitPropertyScreen() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<FormData>({
    propertyAddress: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'USA',
    propertyType: 'residential',
    estimatedValue: '',
    deedNumber: '',
    description: '',
    images: []});

  const [deedScan, setDeedScan] = useState<DocumentScanState>({
    uri: null,
    status: 'not_uploaded',
    verificationResult: null});

  const [idScan, setIdScan] = useState<DocumentScanState>({
    uri: null,
    status: 'not_uploaded',
    verificationResult: null});

  const [selectedIdType, setSelectedIdType] = useState<IDType>('drivers_license');

  const propertyTypes: { value: PropertyType; label: string }[] = [
    { value: 'residential', label: 'Residential' },
    { value: 'commercial', label: 'Commercial' },
    { value: 'mixed', label: 'Mixed-Use' },
    { value: 'industrial', label: 'Industrial' },
    { value: 'land', label: 'Land' },
  ];

  const idTypes: { value: IDType; label: string }[] = [
    { value: 'drivers_license', label: "Driver's License" },
    { value: 'passport', label: 'Passport' },
    { value: 'national_id', label: 'National ID' },
  ];

  const updateForm = (key: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const MAX_IMAGES = 8;

  const pickImage = async () => {
    if (formData.images.length >= MAX_IMAGES) {
      Alert.alert('Maximum Images', `You can upload up to ${MAX_IMAGES} images.`);
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please grant camera roll permissions to upload images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.9});

    if (!result.canceled && result.assets[0]) {
      const pickedUri = result.assets[0].uri;
      setFormData((prev) => ({
        ...prev,
        images: [...prev.images, pickedUri]}));
    }
  };

  const removeImage = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index)}));
  };

  const scanDocument = async (type: 'deed' | 'id') => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      const { status: libraryStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (libraryStatus !== 'granted') {
        Alert.alert('Permission Required', 'Please grant camera or photo library permissions to scan documents.');
        return;
      }
    }

    Alert.alert(
      'Scan Document',
      'Choose how to capture your document',
      [
        {
          text: 'Take Photo',
          onPress: async () => {
            const result = await ImagePicker.launchCameraAsync({
              mediaTypes: ['images'],
              allowsEditing: true,
              aspect: [4, 3],
              quality: 0.9});
            if (!result.canceled && result.assets[0]) {
              void handleDocumentCapture(type, result.assets[0].uri);
            }
          }},
        {
          text: 'Choose from Library',
          onPress: async () => {
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              allowsEditing: true,
              aspect: [4, 3],
              quality: 0.9});
            if (!result.canceled && result.assets[0]) {
              void handleDocumentCapture(type, result.assets[0].uri);
            }
          }},
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleDocumentCapture = async (type: 'deed' | 'id', uri: string) => {
    const setState = type === 'deed' ? setDeedScan : setIdScan;
    
    setState({
      uri,
      status: 'scanning',
      verificationResult: null});

    try {
      setState(prev => ({ ...prev, status: 'verifying' }));
      
      let base64Image = '';
      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
        base64Image = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } else {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: 'base64'});
        base64Image = `data:image/jpeg;base64,${base64}`;
      }

      if (type === 'deed') {
        const result = await generateObject({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: `Analyze this property deed document image. Verify if it appears to be an authentic legal property deed document. Extract key information such as deed number, property address, owner name, issuing authority, and dates. Check for any signs of tampering, inconsistencies, or issues that might indicate the document is not genuine. Property address being submitted: ${formData.propertyAddress}, ${formData.city}, ${formData.state} ${formData.zipCode}` },
                { type: 'image', image: base64Image },
              ]},
          ],
          schema: deedVerificationSchema});

        setState({
          uri,
          status: result.isAuthentic && result.confidence >= 70 ? 'verified' : result.confidence >= 50 ? 'suspicious' : 'failed',
          verificationResult: {
            isAuthentic: result.isAuthentic,
            confidence: result.confidence,
            extractedData: result.extractedData as Record<string, string>,
            issues: result.issues}});

        if (result.extractedData.deedNumber && !formData.deedNumber) {
          updateForm('deedNumber', result.extractedData.deedNumber);
        }
      } else {
        const result = await generateObject({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: `Analyze this ${selectedIdType.replace('_', ' ')} ID document image. Verify if it appears to be an authentic government-issued identification document. Extract key information (partially mask sensitive data like full ID numbers and birth dates for security). Check for any signs of tampering, expiration, or issues that might indicate the document is not genuine.` },
                { type: 'image', image: base64Image },
              ]},
          ],
          schema: idVerificationSchema});

        setState({
          uri,
          status: result.isAuthentic && result.confidence >= 70 && !result.isExpired ? 'verified' : result.confidence >= 50 ? 'suspicious' : 'failed',
          verificationResult: {
            isAuthentic: result.isAuthentic,
            confidence: result.confidence,
            extractedData: { ...result.extractedData as Record<string, string>, isExpired: String(result.isExpired) },
            issues: result.issues}});
      }
    } catch (error) {
      console.log('Document verification error:', error);
      setState({
        uri,
        status: 'failed',
        verificationResult: {
          isAuthentic: false,
          confidence: 0,
          extractedData: {},
          issues: ['Failed to verify document. Please try again with a clearer image.']}});
    }
  };

  const resetDocumentScan = (type: 'deed' | 'id') => {
    const setState = type === 'deed' ? setDeedScan : setIdScan;
    setState({
      uri: null,
      status: 'not_uploaded',
      verificationResult: null});
  };

  const getStatusColor = (status: DocumentVerificationStatus) => {
    switch (status) {
      case 'verified': return Colors.success;
      case 'suspicious': return Colors.warning;
      case 'failed': return Colors.error;
      case 'scanning':
      case 'verifying': return Colors.primary;
      default: return Colors.textTertiary;
    }
  };

  const getStatusIcon = (status: DocumentVerificationStatus) => {
    switch (status) {
      case 'verified': return <ShieldCheck size={20} color={Colors.success} />;
      case 'suspicious': return <AlertTriangle size={20} color={Colors.warning} />;
      case 'failed': return <ShieldAlert size={20} color={Colors.error} />;
      case 'scanning':
      case 'verifying': return <Loader size={20} color={Colors.primary} />;
      default: return <ScanLine size={20} color={Colors.textTertiary} />;
    }
  };

  const getStatusText = (status: DocumentVerificationStatus) => {
    switch (status) {
      case 'verified': return 'Verified';
      case 'suspicious': return 'Needs Review';
      case 'failed': return 'Verification Failed';
      case 'scanning': return 'Scanning...';
      case 'verifying': return 'AI Verifying...';
      default: return 'Not Uploaded';
    }
  };

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 1:
        return !!(formData.propertyAddress && formData.city && formData.state && formData.zipCode);
      case 2:
        return deedScan.status === 'verified' && idScan.status === 'verified';
      case 3:
        return !!(formData.estimatedValue && formData.deedNumber);
      case 4:
        return !!formData.description;
      default:
        return false;
    }
  };

  const nextStep = () => {
    if (!validateStep(currentStep)) {
      if (currentStep === 2) {
        if (deedScan.status !== 'verified' && idScan.status !== 'verified') {
          Alert.alert('Documents Required', 'Please scan and verify both your Property Deed and ID to continue.');
        } else if (deedScan.status !== 'verified') {
          Alert.alert('Deed Required', 'Please scan and verify your Property Deed to continue.');
        } else {
          Alert.alert('ID Required', 'Please scan and verify your ID to continue.');
        }
      } else {
        Alert.alert('Missing Information', 'Please fill in all required fields');
      }
      return;
    }
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    } else {
      submitProperty();
    }
  };

  const submitProperty = () => {
    const estimatedValue = parseFloat(formData.estimatedValue) || 0;
    const verificationFee = calculateIPXFee(estimatedValue, 'verification');
    const listingFee = calculateIPXFee(estimatedValue * 0.85, 'listing');

    Alert.alert(
      'Confirm Submission',
      `Property: ${formData.propertyAddress}\nEstimated Value: ${formatDollar(estimatedValue)}\n\n${IPX_HOLDING_NAME} Fees:\n• Verification Fee: ${formatDollar(verificationFee)}\n• Listing Fee (on approval): ${formatDollar(listingFee)}\n\nDocuments Verified:\n✓ Property Deed\n✓ Owner ID\n\nProceed with submission?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: () => {
            Alert.alert(
              'Property Submitted',
              'Your property has been submitted for verification. We will review the deed, check for liens, and assess any outstanding debts.\n\nYou will be notified once the review is complete.',
              [{ text: 'OK', onPress: () => router.back() }]
            );
          }},
      ]
    );
  };

  const verificationFee = ipxFeeConfigs.find((f) => f.feeType === 'verification');
  const listingFee = ipxFeeConfigs.find((f) => f.feeType === 'listing');

  const renderStep1 = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepHeader}>
        <View style={styles.stepIcon}>
          <MapPin size={24} color={Colors.primary} />
        </View>
        <Text style={styles.stepTitle}>Property Location</Text>
        <Text style={styles.stepSubtitle}>Enter the property address details</Text>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Street Address *</Text>
        <TextInput
          style={styles.input}
          placeholder="123 Main Street"
          placeholderTextColor={Colors.textTertiary}
          value={formData.propertyAddress}
          onChangeText={(text) => updateForm('propertyAddress', text)}
        />
      </View>

      <View style={styles.inputRow}>
        <View style={[styles.inputGroup, { flex: 1 }]}>
          <Text style={styles.inputLabel}>City *</Text>
          <TextInput
            style={styles.input}
            placeholder="Miami"
            placeholderTextColor={Colors.textTertiary}
            value={formData.city}
            onChangeText={(text) => updateForm('city', text)}
          />
        </View>
        <View style={[styles.inputGroup, { flex: 1, marginLeft: 12 }]}>
          <Text style={styles.inputLabel}>State *</Text>
          <TextInput
            style={styles.input}
            placeholder="FL"
            placeholderTextColor={Colors.textTertiary}
            value={formData.state}
            onChangeText={(text) => updateForm('state', text)}
          />
        </View>
      </View>

      <View style={styles.inputRow}>
        <View style={[styles.inputGroup, { flex: 1 }]}>
          <Text style={styles.inputLabel}>Zip Code *</Text>
          <TextInput
            style={styles.input}
            placeholder="33139"
            placeholderTextColor={Colors.textTertiary}
            value={formData.zipCode}
            onChangeText={(text) => updateForm('zipCode', text)}
            keyboardType="number-pad"
            maxLength={10}
          />
        </View>
        <View style={[styles.inputGroup, { flex: 1, marginLeft: 12 }]}>
          <Text style={styles.inputLabel}>Country</Text>
          <TextInput
            style={styles.input}
            placeholder="USA"
            placeholderTextColor={Colors.textTertiary}
            value={formData.country}
            onChangeText={(text) => updateForm('country', text)}
          />
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Property Type *</Text>
        <View style={styles.typeSelector}>
          {propertyTypes.map((type) => (
            <TouchableOpacity
              key={type.value}
              style={[
                styles.typeOption,
                formData.propertyType === type.value && styles.typeOptionActive,
              ]}
              onPress={() => updateForm('propertyType', type.value)}
            >
              <Text
                style={[
                  styles.typeOptionText,
                  formData.propertyType === type.value && styles.typeOptionTextActive,
                ]}
              >
                {type.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );

  const renderDocumentScanCard = (
    type: 'deed' | 'id',
    title: string,
    subtitle: string,
    icon: React.ReactNode,
    scanState: DocumentScanState
  ) => {
    const isProcessing = scanState.status === 'scanning' || scanState.status === 'verifying';
    
    return (
      <View style={styles.documentCard}>
        <View style={styles.documentHeader}>
          <View style={styles.documentIconContainer}>
            {icon}
          </View>
          <View style={styles.documentTitleContainer}>
            <Text style={styles.documentTitle}>{title}</Text>
            <Text style={styles.documentSubtitle}>{subtitle}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(scanState.status) + '20' }]}>
            {getStatusIcon(scanState.status)}
            <Text style={[styles.statusText, { color: getStatusColor(scanState.status) }]}>
              {getStatusText(scanState.status)}
            </Text>
          </View>
        </View>

        {scanState.uri ? (
          <View style={styles.documentPreviewContainer}>
            <Image source={{ uri: scanState.uri }} style={styles.documentPreview} />
            {isProcessing && (
              <View style={styles.processingOverlay}>
                <ShimmerIndicator size="large" color={Colors.white} />
                <Text style={styles.processingText}>
                  {scanState.status === 'scanning' ? 'Scanning document...' : 'AI analyzing document...'}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <TouchableOpacity
            style={styles.scanButton}
            onPress={() => scanDocument(type)}
          >
            <ScanLine size={32} color={Colors.primary} />
            <Text style={styles.scanButtonText}>Tap to Scan {title}</Text>
            <Text style={styles.scanButtonHint}>Take a photo or choose from library</Text>
          </TouchableOpacity>
        )}

        {scanState.verificationResult && (
          <View style={styles.verificationResultContainer}>
            <View style={styles.confidenceRow}>
              <Text style={styles.confidenceLabel}>AI Confidence:</Text>
              <View style={styles.confidenceBarContainer}>
                <View 
                  style={[
                    styles.confidenceBar, 
                    { 
                      width: `${scanState.verificationResult.confidence}%`,
                      backgroundColor: getStatusColor(scanState.status)}
                  ]} 
                />
              </View>
              <Text style={[styles.confidenceValue, { color: getStatusColor(scanState.status) }]}>
                {scanState.verificationResult.confidence}%
              </Text>
            </View>

            {Object.entries(scanState.verificationResult.extractedData).length > 0 && (
              <View style={styles.extractedDataContainer}>
                <Text style={styles.extractedDataTitle}>Extracted Information:</Text>
                {Object.entries(scanState.verificationResult.extractedData)
                  .filter(([key, value]) => value && key !== 'isExpired')
                  .map(([key, value]) => (
                    <View key={key} style={styles.extractedDataRow}>
                      <Text style={styles.extractedDataKey}>
                        {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}:
                      </Text>
                      <Text style={styles.extractedDataValue}>{value}</Text>
                    </View>
                  ))}
              </View>
            )}

            {scanState.verificationResult.issues.length > 0 && (
              <View style={styles.issuesContainer}>
                <Text style={styles.issuesTitle}>
                  {scanState.status === 'verified' ? 'Notes:' : 'Issues Found:'}
                </Text>
                {scanState.verificationResult.issues.map((issue, index) => (
                  <View key={index} style={styles.issueRow}>
                    <AlertTriangle size={14} color={scanState.status === 'verified' ? Colors.info : Colors.warning} />
                    <Text style={styles.issueText}>{issue}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {scanState.uri && !isProcessing && (
          <View style={styles.documentActions}>
            <TouchableOpacity
              style={styles.rescanButton}
              onPress={() => resetDocumentScan(type)}
            >
              <RefreshCw size={16} color={Colors.primary} />
              <Text style={styles.rescanButtonText}>Rescan</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderStep2 = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepHeader}>
        <View style={styles.stepIcon}>
          <ScanLine size={24} color={Colors.primary} />
        </View>
        <Text style={styles.stepTitle}>Document Verification</Text>
        <Text style={styles.stepSubtitle}>Scan your deed and ID for AI verification</Text>
      </View>

      <View style={styles.aiVerificationBanner}>
        <ShieldCheck size={24} color={Colors.success} />
        <View style={styles.aiVerificationContent}>
          <Text style={styles.aiVerificationTitle}>AI-Powered Document Verification</Text>
          <Text style={styles.aiVerificationText}>
            Our AI system analyzes your documents in real-time to verify authenticity, extract key information, and detect potential issues.
          </Text>
        </View>
      </View>

      {renderDocumentScanCard(
        'deed',
        'Property Deed',
        'Official deed document showing ownership',
        <FileCheck size={24} color={Colors.primary} />,
        deedScan
      )}

      <View style={styles.idTypeSelector}>
        <Text style={styles.inputLabel}>Select ID Type</Text>
        <View style={styles.idTypeOptions}>
          {idTypes.map((type) => (
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

      {renderDocumentScanCard(
        'id',
        selectedIdType === 'drivers_license' ? "Driver's License" : selectedIdType === 'passport' ? 'Passport' : 'National ID',
        'Government-issued photo identification',
        <IdCard size={24} color={Colors.primary} />,
        idScan
      )}

      <View style={styles.securityNote}>
        <Info size={18} color={Colors.info} />
        <Text style={styles.securityNoteText}>
          Your documents are securely processed and never stored permanently. All verification is done through encrypted channels.
        </Text>
      </View>
    </View>
  );

  const renderStep3 = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepHeader}>
        <View style={styles.stepIcon}>
          <FileText size={24} color={Colors.primary} />
        </View>
        <Text style={styles.stepTitle}>Property Details</Text>
        <Text style={styles.stepSubtitle}>Provide valuation and deed information</Text>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Estimated Property Value *</Text>
        <View style={styles.currencyInput}>
          <Text style={styles.currencySymbol}>$</Text>
          <TextInput
            style={styles.currencyInputField}
            placeholder="5,000,000"
            placeholderTextColor={Colors.textTertiary}
            keyboardType="number-pad"
            value={formData.estimatedValue}
            onChangeText={(text) => updateForm('estimatedValue', text.replace(/[^0-9]/g, ''))}
          />
        </View>
        <Text style={styles.inputHint}>
          We will verify this value through independent appraisal
        </Text>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Deed Number *</Text>
        <TextInput
          style={styles.input}
          placeholder="XX-XXXX-XXXXXX"
          placeholderTextColor={Colors.textTertiary}
          value={formData.deedNumber}
          onChangeText={(text) => updateForm('deedNumber', text)}
          autoCapitalize="characters"
        />
        <Text style={styles.inputHint}>
          {deedScan.verificationResult?.extractedData?.deedNumber 
            ? 'Auto-filled from your scanned deed' 
            : 'Found on your property deed document'}
        </Text>
      </View>

      <View style={styles.infoCard}>
        <Info size={20} color={Colors.info} />
        <View style={styles.infoCardContent}>
          <Text style={styles.infoCardTitle}>Verification Process</Text>
          <Text style={styles.infoCardText}>
            We will verify your deed ownership, search for any liens (tax, mortgage, judgments), and review outstanding debts. This typically takes 5-7 business days.
          </Text>
        </View>
      </View>
    </View>
  );

  const renderStep4 = () => {
    const estimatedValue = parseFloat(formData.estimatedValue) || 0;
    const listingValue = estimatedValue * 0.85;
    const verificationFeeAmount = calculateIPXFee(estimatedValue, 'verification');
    const listingFeeAmount = calculateIPXFee(listingValue, 'listing');

    return (
      <View style={styles.stepContent}>
        <View style={styles.stepHeader}>
          <View style={styles.stepIcon}>
            <DollarSign size={24} color={Colors.primary} />
          </View>
          <Text style={styles.stepTitle}>Review & Submit</Text>
          <Text style={styles.stepSubtitle}>Review your submission and fees</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Property Description *</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe your property, including key features, condition, and any recent improvements..."
            placeholderTextColor={Colors.textTertiary}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            value={formData.description}
            onChangeText={(text) => updateForm('description', text)}
          />
        </View>

        <View style={styles.verifiedDocsCard}>
          <Text style={styles.verifiedDocsTitle}>Verified Documents</Text>
          <View style={styles.verifiedDocRow}>
            <ShieldCheck size={18} color={Colors.success} />
            <Text style={styles.verifiedDocText}>Property Deed - Verified ({deedScan.verificationResult?.confidence}% confidence)</Text>
          </View>
          <View style={styles.verifiedDocRow}>
            <ShieldCheck size={18} color={Colors.success} />
            <Text style={styles.verifiedDocText}>Owner ID - Verified ({idScan.verificationResult?.confidence}% confidence)</Text>
          </View>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Submission Summary</Text>

          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Property Address</Text>
            <Text style={styles.summaryValue}>
              {formData.propertyAddress}, {formData.city}, {formData.state} {formData.zipCode}
            </Text>
          </View>

          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Property Type</Text>
            <Text style={styles.summaryValue}>
              {propertyTypes.find((t) => t.value === formData.propertyType)?.label}
            </Text>
          </View>

          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Estimated Value</Text>
            <Text style={styles.summaryValue}>{formatDollar(estimatedValue)}</Text>
          </View>

          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Listing Value (85%)</Text>
            <Text style={styles.summaryValue}>{formatDollar(listingValue)}</Text>
          </View>

          <View style={styles.summaryDivider} />

          <View style={styles.feeSection}>
            <Text style={styles.feeSectionTitle}>{IPX_HOLDING_NAME} Fees</Text>

            <View style={styles.feeRow}>
              <View>
                <Text style={styles.feeLabel}>Verification Fee ({verificationFee?.percentage}%)</Text>
                <Text style={styles.feeHint}>Due upon submission</Text>
              </View>
              <Text style={styles.feeAmount}>{formatDollar(verificationFeeAmount)}</Text>
            </View>

            <View style={styles.feeRow}>
              <View>
                <Text style={styles.feeLabel}>Listing Fee ({listingFee?.percentage}%)</Text>
                <Text style={styles.feeHint}>Due upon approval & listing</Text>
              </View>
              <Text style={styles.feeAmount}>{formatDollar(listingFeeAmount)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.imageUploadSection}>
          <View style={styles.imageUploadHeader}>
            <View style={styles.imageUploadTitleRow}>
              <Camera size={20} color={Colors.primary} />
              <Text style={styles.imageUploadTitle}>Property Images for Market</Text>
              <View style={styles.imageCountBadge}>
                <Text style={styles.imageCountText}>{formData.images.length}/{MAX_IMAGES}</Text>
              </View>
            </View>
            <Text style={styles.imageUploadSubtitle}>
              Upload up to 8 high-quality images to showcase to investors
            </Text>
          </View>

          <View style={styles.marketImageNotice}>
            <Building2 size={18} color={Colors.success} />
            <Text style={styles.marketImageNoticeText}>
              These images will be displayed on the stock selling market for potential investors to evaluate your property.
            </Text>
          </View>

          <View style={styles.imageGrid}>
            {Array.from({ length: MAX_IMAGES }).map((_, index) => {
              const imageUri = formData.images[index];
              return (
                <View key={index} style={styles.imageSlot}>
                  {imageUri ? (
                    <View style={styles.imageContainer}>
                      <Image source={{ uri: imageUri }} style={styles.uploadedImage} />
                      <TouchableOpacity
                        style={styles.removeImageButton}
                        onPress={() => removeImage(index)}
                      >
                        <X size={14} color={Colors.white} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.emptyImageSlot}
                      onPress={pickImage}
                    >
                      <ImagePlus size={24} color={Colors.textTertiary} />
                      <Text style={styles.emptyImageText}>{index + 1}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>

          <View style={styles.imageInfoCard}>
            <Info size={16} color={Colors.info} />
            <Text style={styles.imageInfoText}>
              Required: Exterior (front/back), interior rooms, kitchen, bathrooms, and any notable features. High-quality images increase investor interest.
            </Text>
          </View>
        </View>

        <View style={styles.warningCard}>
          <AlertTriangle size={20} color={Colors.warning} />
          <Text style={styles.warningText}>
            By submitting, you confirm that you are the legal owner of this property and authorize IVX HOLDINGS LLC to conduct verification checks.
          </Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.progressContainer}>
        {[1, 2, 3, 4].map((step) => (
          <View key={step} style={styles.progressStep}>
            <View
              style={[
                styles.progressDot,
                currentStep >= step && styles.progressDotActive,
                currentStep > step && styles.progressDotCompleted,
              ]}
            >
              {currentStep > step ? (
                <CheckCircle size={16} color={Colors.white} />
              ) : (
                <Text
                  style={[
                    styles.progressDotText,
                    currentStep >= step && styles.progressDotTextActive,
                  ]}
                >
                  {step}
                </Text>
              )}
            </View>
            {step < 4 && (
              <View
                style={[
                  styles.progressLine,
                  currentStep > step && styles.progressLineActive,
                ]}
              />
            )}
          </View>
        ))}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}
        {currentStep === 3 && renderStep3()}
        {currentStep === 4 && renderStep4()}
      </ScrollView>

      <View style={styles.footer}>
        {currentStep > 1 && (
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setCurrentStep(currentStep - 1)}
          >
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.nextButton, currentStep === 1 && styles.nextButtonFull]}
          onPress={nextStep}
        >
          <Text style={styles.nextButtonText}>
            {currentStep === 4 ? 'Submit Property' : 'Continue'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 0},
  progressStep: {
    alignItems: 'center'},
  progressDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.surfaceBorder},
  progressDotActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  progressDotCompleted: {
    backgroundColor: Colors.success,
    borderColor: Colors.success},
  progressDotText: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '700' as const},
  progressDotTextActive: {
    color: Colors.black},
  progressLine: {
    width: 24,
    height: 2,
    backgroundColor: Colors.surfaceBorder},
  progressLineActive: {
    backgroundColor: Colors.success},
  scrollView: {
    flex: 1,
    backgroundColor: Colors.background},
  scrollContent: {
    padding: 20,
    paddingBottom: 140},
  stepContent: {
    gap: 16},
  stepHeader: {
    alignItems: 'center',
    marginBottom: 8},
  stepIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12},
  stepTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800' as const,
    textAlign: 'center'},
  stepSubtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 4},
  inputGroup: {
    gap: 6},
  inputLabel: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const},
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    color: Colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
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
  inputRow: {
    flexDirection: 'row',
    gap: 12},
  inputHint: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 4},
  currencyInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingLeft: 14},
  currencySymbol: {
    color: Colors.textSecondary,
    fontSize: 18,
    fontWeight: '600' as const},
  currencyInputField: {
    flex: 1,
    padding: 14,
    color: Colors.text,
    fontSize: 18,
    fontWeight: '600' as const},
  typeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8},
  typeOption: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  typeOptionActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  typeOptionText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: '600' as const},
  typeOptionTextActive: {
    color: Colors.black},
  infoCard: {
    backgroundColor: Colors.info + '10',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.info + '20'},
  infoCardContent: {
    flexDirection: 'row',
    gap: 10},
  infoCardTitle: {
    color: Colors.info,
    fontSize: 14,
    fontWeight: '700' as const,
    marginBottom: 4},
  infoCardText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    flex: 1},
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  summaryTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
    marginBottom: 14},
  summaryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8},
  summaryLabel: {
    color: Colors.textSecondary,
    fontSize: 14},
  summaryValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const},
  summaryDivider: {
    height: 1,
    backgroundColor: Colors.surfaceBorder,
    marginVertical: 4},
  feeSection: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  feeSectionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
    marginBottom: 12},
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8},
  feeLabel: {
    color: Colors.textSecondary,
    fontSize: 14},
  feeHint: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 2},
  feeAmount: {
    color: Colors.primary,
    fontSize: 15,
    fontWeight: '700' as const},
  warningCard: {
    backgroundColor: Colors.warning + '10',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.warning + '20'},
  warningText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    flex: 1},
  imageUploadSection: {
    gap: 12},
  imageUploadHeader: {
    gap: 4},
  imageUploadTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  imageUploadTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const},
  imageCountBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2},
  imageCountText: {
    color: Colors.black,
    fontSize: 11,
    fontWeight: '700' as const},
  imageUploadSubtitle: {
    color: Colors.textTertiary,
    fontSize: 13},
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10},
  imageSlot: {
    width: '31%' as any,
    aspectRatio: 1},
  imageContainer: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden'},
  uploadedImage: {
    width: '100%',
    height: '100%'},
  removeImageButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.error,
    alignItems: 'center',
    justifyContent: 'center'},
  emptyImageSlot: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4},
  emptyImageText: {
    color: Colors.textTertiary,
    fontSize: 11},
  imageInfoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 10},
  imageInfoText: {
    color: Colors.textTertiary,
    fontSize: 12,
    lineHeight: 16},
  marketImageNotice: {
    backgroundColor: Colors.info + '10',
    borderRadius: 10,
    padding: 10},
  marketImageNoticeText: {
    color: Colors.info,
    fontSize: 12,
    lineHeight: 16},
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    backgroundColor: Colors.background},
  backButton: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  backButtonText: {
    color: Colors.text,
    fontWeight: '600' as const,
    fontSize: 15},
  nextButton: {
    flex: 2,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center'},
  nextButtonFull: {
    flex: 1},
  nextButtonText: {
    color: Colors.black,
    fontWeight: '700' as const,
    fontSize: 15},
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
  documentTitleContainer: {
    flex: 1},
  documentTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const},
  documentSubtitle: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2},
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4},
  statusText: {
    fontSize: 11,
    fontWeight: '700' as const},
  scanButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 4},
  scanButtonText: {
    color: Colors.black,
    fontWeight: '700' as const,
    fontSize: 14},
  scanButtonHint: {
    color: Colors.black,
    fontSize: 11,
    opacity: 0.7},
  documentPreviewContainer: {
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 12},
  documentPreview: {
    width: '100%',
    height: 160,
    borderRadius: 10},
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10},
  processingText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
    marginTop: 8},
  verificationResultContainer: {
    gap: 12},
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  confidenceLabel: {
    color: Colors.textSecondary,
    fontSize: 13},
  confidenceBarContainer: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.surfaceBorder},
  confidenceBar: {
    height: 6,
    borderRadius: 3},
  confidenceValue: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
    minWidth: 36,
    textAlign: 'right'},
  extractedDataContainer: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10,
    padding: 12,
    gap: 8},
  extractedDataTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
    marginBottom: 4},
  extractedDataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between'},
  extractedDataKey: {
    color: Colors.textTertiary,
    fontSize: 12},
  extractedDataValue: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600' as const},
  issuesContainer: {
    gap: 6},
  issuesTitle: {
    color: Colors.warning,
    fontSize: 13,
    fontWeight: '700' as const},
  issueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6},
  issueText: {
    color: Colors.textSecondary,
    fontSize: 12,
    flex: 1},
  documentActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4},
  rescanButton: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  rescanButtonText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600' as const},
  aiVerificationBanner: {
    backgroundColor: Colors.primary + '10',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.primary + '20'},
  aiVerificationContent: {
    flex: 1},
  aiVerificationTitle: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700' as const,
    marginBottom: 4},
  aiVerificationText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17},
  idTypeSelector: {
    gap: 8},
  idTypeOptions: {
    flexDirection: 'row',
    gap: 8},
  idTypeOption: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  idTypeOptionActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  idTypeOptionText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const},
  idTypeOptionTextActive: {
    color: Colors.black},
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.success + '10',
    borderRadius: 10,
    padding: 10},
  securityNoteText: {
    color: Colors.success,
    fontSize: 12,
    flex: 1},
  verifiedDocsCard: {
    backgroundColor: Colors.success + '10',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.success + '20'},
  verifiedDocsTitle: {
    color: Colors.success,
    fontSize: 14,
    fontWeight: '700' as const,
    marginBottom: 10},
  verifiedDocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6},
  verifiedDocText: {
    color: Colors.textSecondary,
    fontSize: 13}});
