import React, { useState, useCallback, useRef } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Platform,
  Linking,
  Animated,
  KeyboardAvoidingView,
  Image} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  FileText,
  ChevronLeft,
  Download,
  Share2,
  MessageCircle,
  Eye,
  Globe,
  Shield,
  Scale,
  Gavel,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle,
  DollarSign,
  User,
  Building2,
  Printer,
  Lock,
  ShieldAlert,
  Ban,
  KeyRound,
  FileWarning,
  EyeOff,
  Camera,
  ImageIcon,
  X,
  Paperclip,
  Palette,
  ScanLine,
  CreditCard,
  BookOpen,
  IdCard,
  Sparkles,
  Zap} from 'lucide-react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import { generateObject } from '@/lib/ai-service';
import { z } from 'zod';

import Colors from '@/constants/colors';
import { generateContractHTML, ContractData } from '@/lib/contract-template';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type DocType = 'id' | 'passport' | 'license';

type ContractLanguage = 'en' | 'es';

interface AttachedImage {
  uri: string;
  base64?: string;
  label: string;
}

interface FormSection {
  key: string;
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
}

const generateContractNumber = (): string => {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `IVXHOLDINGS-${y}${m}${d}-${rand}`;
};

const getTodayDate = (): string => {
  const d = new Date();
  return d.toISOString().split('T')[0];
};

export default function ContractGeneratorScreen() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  const [contractLang, setContractLang] = useState<ContractLanguage>('es');
  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    client: true,
    developer: false,
    project: false,
    payment: false,
    attachments: false,
    branding: false,
    terms: false});

  const [clientName, setClientName] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');

  const [developerName, setDeveloperName] = useState('');
  const [developerId, setDeveloperId] = useState('');
  const [developerAddress, setDeveloperAddress] = useState('');
  const [developerEmail, setDeveloperEmail] = useState('');
  const [developerPhone, setDeveloperPhone] = useState('');

  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectObjectives, setProjectObjectives] = useState('');
  const [projectPlatforms, setProjectPlatforms] = useState('');
  const [projectFeatures, setProjectFeatures] = useState('');
  const [projectTechStack, setProjectTechStack] = useState('');
  const [projectDeliverables, setProjectDeliverables] = useState('');
  const [projectMilestones, setProjectMilestones] = useState('');
  const [projectAcceptanceCriteria, setProjectAcceptanceCriteria] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [contractAmount, setContractAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [deliveryDays, setDeliveryDays] = useState('90');
  const [refundPercentage, setRefundPercentage] = useState('100');
  const [jurisdiction, setJurisdiction] = useState('República del Ecuador / Republic of Ecuador');

  const [paymentBankName, setPaymentBankName] = useState('');
  const [paymentAccountNumber, setPaymentAccountNumber] = useState('');
  const [paymentAccountHolder, setPaymentAccountHolder] = useState('');
  const [paymentRoutingNumber, setPaymentRoutingNumber] = useState('');

  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

  const [scanDocType, setScanDocType] = useState<DocType>('id');
  const [scannedImageUri, setScannedImageUri] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const scanPulse = useRef(new Animated.Value(0)).current;

  const [brandingAppName, setBrandingAppName] = useState('Global Real Estate Invest');
  const [brandingCompanyName, setBrandingCompanyName] = useState('IVXHOLDINGS Global Investments');
  const [brandingTagline, setBrandingTagline] = useState('');
  const [brandingWebsite, setBrandingWebsite] = useState('');
  const [brandingLogoUri, setBrandingLogoUri] = useState<string | null>(null);
  const [brandingLogoBase64, setBrandingLogoBase64] = useState<string | null>(null);
  const [brandingPrimaryColor, setBrandingPrimaryColor] = useState('#1a3a5c');
  const [brandingAccentColor, setBrandingAccentColor] = useState('#FFD700');

  const [contractNumber] = useState(generateContractNumber);

  const isES = contractLang === 'es';

  const scanLabels = isES ? {
    scanTitle: 'Escaneo Rápido de Documento',
    scanHint: 'Suba una foto de su documento de identidad para llenar automáticamente los campos',
    docTypeId: 'Cédula / ID',
    docTypePassport: 'Pasaporte',
    docTypeLicense: 'Licencia',
    scanCamera: 'Escanear con Cámara',
    scanGallery: 'Subir desde Galería',
    scanning: 'Analizando documento con IA...',
    scanSuccess: 'Datos extraídos exitosamente',
    scanSuccessMsg: 'Los campos del cliente han sido llenados automáticamente. Por favor verifique la información.',
    scanError: 'No se pudo analizar el documento',
    scanErrorMsg: 'Intente con una foto más clara o ingrese los datos manualmente.',
    scannedDoc: 'Documento escaneado',
    rescan: 'Escanear otro',
    autoFilled: 'Auto-llenado por IA'} : {
    scanTitle: 'Quick Document Scan',
    scanHint: 'Upload a photo of your ID document to auto-fill the fields below',
    docTypeId: 'ID Card',
    docTypePassport: 'Passport',
    docTypeLicense: 'License',
    scanCamera: 'Scan with Camera',
    scanGallery: 'Upload from Gallery',
    scanning: 'Analyzing document with AI...',
    scanSuccess: 'Data extracted successfully',
    scanSuccessMsg: 'Client fields have been auto-filled. Please verify the information.',
    scanError: 'Could not analyze document',
    scanErrorMsg: 'Try a clearer photo or enter data manually.',
    scannedDoc: 'Scanned document',
    rescan: 'Scan another',
    autoFilled: 'Auto-filled by AI'};

  const labels = isES ? {
    title: 'Generador de Contratos',
    subtitle: 'Contrato Internacional con Protección Legal Completa',
    langToggle: 'Idioma del Contrato',
    spanish: 'Español',
    english: 'English',
    clientSection: 'Datos del Cliente',
    developerSection: 'Datos del Desarrollador',
    projectSection: 'Proyecto y Descripción Completa',
    termsSection: 'Términos y Montos',
    fullName: 'Nombre Completo',
    idDoc: 'Documento de Identidad',
    address: 'Dirección',
    email: 'Correo Electrónico',
    phone: 'Teléfono',
    projectNameLabel: 'Nombre del Proyecto',
    descriptionLabel: 'Descripción General del Proyecto',
    objectivesLabel: 'Objetivos del Proyecto',
    objectivesPlaceholder: 'Ej: Crear una plataforma de inversión inmobiliaria digital...',
    platformsLabel: 'Plataformas Objetivo',
    platformsPlaceholder: 'Ej: iOS, Android, Web, Backend API',
    featuresLabel: 'Funcionalidades Principales',
    featuresPlaceholder: 'Ej: Registro de usuarios, KYC, compra/venta de acciones, wallet...',
    techStackLabel: 'Stack Tecnológico',
    techStackPlaceholder: 'Ej: React Native, Node.js, PostgreSQL, AWS...',
    deliverablesLabel: 'Entregables Esperados',
    deliverablesPlaceholder: 'Ej: Código fuente, documentación técnica, app publicada...',
    milestonesLabel: 'Fases / Hitos del Proyecto',
    milestonesPlaceholder: 'Ej: Fase 1: Diseño UI/UX (2 semanas), Fase 2: Backend...',
    acceptanceLabel: 'Criterios de Aceptación',
    acceptancePlaceholder: 'Ej: 100% funcionalidades operativas, 0 bugs críticos...',
    totalAmountLabel: 'Monto Total',
    contractAmountLabel: 'Valor del Contrato',
    currencyLabel: 'Moneda',
    deliveryLabel: 'Días de Entrega',
    refundLabel: '% de Reembolso',
    jurisdictionLabel: 'Jurisdicción Legal',
    paymentSection: 'Información de Pago',
    bankNameLabel: 'Nombre del Banco',
    accountNumberLabel: 'Número de Cuenta',
    accountHolderLabel: 'Titular de la Cuenta',
    routingNumberLabel: 'Ruta / SWIFT',
    previewBtn: 'Vista Previa',
    exportPdf: 'Exportar PDF',
    shareWhatsApp: 'Compartir por WhatsApp',
    shareGeneral: 'Compartir',
    generating: 'Generando...',
    contractNo: 'Contrato N°',
    protectionFeatures: 'Características de Protección',
    feat1: 'Reembolso total si no se completa',
    feat2: 'Honorarios legales pagados por desarrollador',
    feat3: 'Entrega en 24-48 horas',
    feat4: 'Cláusula penal del 150%',
    feat5: 'Validez internacional y Ecuador',
    feat6: 'Arresto policial por incumplimiento',
    ndaBadge: 'NDA COMPLETO INCLUIDO',
    ndaFeat1: 'Protección del código fuente',
    ndaFeat2: 'Cláusula de no competencia (24 meses)',
    ndaFeat3: 'No divulgación a terceros',
    ndaFeat4: 'Penalidad 300% por violación NDA',
    ndaFeat5: 'Supervivencia 5 años post-contrato',
    ndaFeat6: 'Protección de datos personales',
    attachmentsSection: 'Documentos y Fotos Adjuntas',
    attachFromCamera: 'Cámara',
    attachFromGallery: 'Galería',
    attachLabel: 'Adjuntar información vía foto',
    attachPlaceholder: 'Ej: ID del cliente, contrato previo, etc.',
    noAttachments: 'No hay documentos adjuntos',
    removeAttachment: 'Eliminar',
    brandingSection: 'Marca del Desarrollador',
    appNameLabel: 'Nombre de la App',
    companyNameLabel: 'Nombre de la Empresa',
    taglineLabel: 'Eslogan',
    websiteLabel: 'Sitio Web',
    primaryColorLabel: 'Color Principal',
    accentColorLabel: 'Color Acento',
    uploadLogo: 'Subir Logo',
    fillRequired: 'Complete los campos requeridos',
    fillRequiredMsg: 'Por favor complete al menos los nombres de ambas partes y el monto del contrato.',
    success: 'PDF generado exitosamente',
    error: 'Error al generar',
    whatsappMsg: 'Le comparto el contrato de desarrollo de software N° ',
    noWhatsApp: 'WhatsApp no disponible en esta plataforma'} : {
    title: 'Contract Generator',
    subtitle: 'International Contract with Full Legal Protection',
    langToggle: 'Contract Language',
    spanish: 'Español',
    english: 'English',
    clientSection: 'Client Information',
    developerSection: 'Developer Information',
    projectSection: 'Full Project Description',
    termsSection: 'Terms & Amounts',
    fullName: 'Full Name',
    idDoc: 'ID Document',
    address: 'Address',
    email: 'Email',
    phone: 'Phone',
    projectNameLabel: 'Project Name',
    descriptionLabel: 'General Project Description',
    objectivesLabel: 'Project Objectives',
    objectivesPlaceholder: 'E.g: Build a digital real estate investment platform...',
    platformsLabel: 'Target Platforms',
    platformsPlaceholder: 'E.g: iOS, Android, Web, Backend API',
    featuresLabel: 'Key Features & Functionalities',
    featuresPlaceholder: 'E.g: User registration, KYC, share trading, wallet...',
    techStackLabel: 'Technology Stack',
    techStackPlaceholder: 'E.g: React Native, Node.js, PostgreSQL, AWS...',
    deliverablesLabel: 'Expected Deliverables',
    deliverablesPlaceholder: 'E.g: Source code, technical docs, published app...',
    milestonesLabel: 'Project Phases / Milestones',
    milestonesPlaceholder: 'E.g: Phase 1: UI/UX Design (2 weeks), Phase 2: Backend...',
    acceptanceLabel: 'Acceptance Criteria',
    acceptancePlaceholder: 'E.g: 100% functionalities working, 0 critical bugs...',
    totalAmountLabel: 'Total Amount',
    contractAmountLabel: 'Contract Value',
    currencyLabel: 'Currency',
    deliveryLabel: 'Delivery Days',
    refundLabel: 'Refund %',
    jurisdictionLabel: 'Legal Jurisdiction',
    paymentSection: 'Payment Information',
    bankNameLabel: 'Bank Name',
    accountNumberLabel: 'Account Number',
    accountHolderLabel: 'Account Holder',
    routingNumberLabel: 'Routing / SWIFT',
    previewBtn: 'Preview',
    exportPdf: 'Export PDF',
    shareWhatsApp: 'Share via WhatsApp',
    shareGeneral: 'Share',
    generating: 'Generating...',
    contractNo: 'Contract No.',
    protectionFeatures: 'Protection Features',
    feat1: 'Full refund if not completed',
    feat2: 'Legal fees paid by developer',
    feat3: 'Delivery within 24-48 hours',
    feat4: '150% penalty clause',
    feat5: 'International & Ecuador validity',
    feat6: 'Police arrest for non-compliance',
    ndaBadge: 'FULL NDA INCLUDED',
    ndaFeat1: 'Source code protection',
    ndaFeat2: 'Non-compete clause (24 months)',
    ndaFeat3: 'Non-disclosure to third parties',
    ndaFeat4: '300% penalty for NDA violation',
    ndaFeat5: 'Survival 5 years post-contract',
    ndaFeat6: 'Personal data protection',
    attachmentsSection: 'Attached Documents & Photos',
    attachFromCamera: 'Camera',
    attachFromGallery: 'Gallery',
    attachLabel: 'Attach info via photo',
    attachPlaceholder: 'E.g: Client ID, previous contract, etc.',
    noAttachments: 'No documents attached',
    removeAttachment: 'Remove',
    brandingSection: 'Developer Branding',
    appNameLabel: 'App Name',
    companyNameLabel: 'Company Name',
    taglineLabel: 'Tagline',
    websiteLabel: 'Website',
    primaryColorLabel: 'Primary Color',
    accentColorLabel: 'Accent Color',
    uploadLogo: 'Upload Logo',
    fillRequired: 'Fill required fields',
    fillRequiredMsg: 'Please fill at least both party names and the contract amount.',
    success: 'PDF generated successfully',
    error: 'Error generating',
    whatsappMsg: 'Sharing the software development contract No. ',
    noWhatsApp: 'WhatsApp not available on this platform'};

  const toggleSection = useCallback((key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const pickImageFromCamera = useCallback(async (label?: string) => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          isES ? 'Permiso requerido' : 'Permission required',
          isES ? 'Se necesita acceso a la cámara' : 'Camera access is needed'
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        base64: true,
        allowsEditing: true});
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        console.log('[ContractGenerator] Camera image picked:', asset.uri);
        setAttachedImages(prev => [...prev, {
          uri: asset.uri,
          base64: asset.base64 ?? undefined,
          label: label || (isES ? `Foto ${prev.length + 1}` : `Photo ${prev.length + 1}`)}]);
      }
    } catch (error) {
      console.log('[ContractGenerator] Camera error:', error);
    }
  }, [isES]);

  const pickImageFromGallery = useCallback(async (label?: string) => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        base64: true,
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: 5});
      if (!result.canceled && result.assets.length > 0) {
        console.log('[ContractGenerator] Gallery images picked:', result.assets.length);
        const newImages = result.assets.map((asset, idx) => ({
          uri: asset.uri,
          base64: asset.base64 ?? undefined,
          label: label || (isES ? `Imagen ${attachedImages.length + idx + 1}` : `Image ${attachedImages.length + idx + 1}`)}));
        setAttachedImages(prev => [...prev, ...newImages]);
      }
    } catch (error) {
      console.log('[ContractGenerator] Gallery error:', error);
    }
  }, [isES, attachedImages.length]);

  const removeAttachment = useCallback((index: number) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const startScanPulse = useCallback(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanPulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(scanPulse, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [scanPulse]);

  const stopScanPulse = useCallback(() => {
    scanPulse.stopAnimation();
    scanPulse.setValue(0);
  }, [scanPulse]);

  const extractDataFromImage = useCallback(async (base64: string) => {
    const schema = z.object({
      fullName: z.string().describe('Full name of the person on the document'),
      documentNumber: z.string().describe('ID number, passport number, or license number'),
      address: z.string().optional().describe('Address if visible on the document'),
      dateOfBirth: z.string().optional().describe('Date of birth if visible'),
      nationality: z.string().optional().describe('Nationality if visible')});

    const docTypeLabel = scanDocType === 'passport' ? 'passport' : scanDocType === 'license' ? 'driver license' : 'national ID card';

    const result = await generateObject({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              image: `data:image/jpeg;base64,${base64}`},
            {
              type: 'text',
              text: `Extract personal information from this ${docTypeLabel} document image. Return the full name, document number, and address if visible. If a field is not readable, return an empty string for it.`},
          ]},
      ],
      schema});

    return result;
  }, [scanDocType]);

  const handleScanDocument = useCallback(async (source: 'camera' | 'gallery') => {
    try {
      let result: ImagePicker.ImagePickerResult;

      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
            isES ? 'Permiso requerido' : 'Permission required',
            isES ? 'Se necesita acceso a la cámara' : 'Camera access is needed'
          );
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.8,
          base64: true,
          allowsEditing: true});
      } else {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.8,
          base64: true,
          allowsEditing: true});
      }

      if (result.canceled || !result.assets[0]) return;

      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert(scanLabels.scanError, scanLabels.scanErrorMsg);
        return;
      }

      setScannedImageUri(asset.uri);
      setIsScanning(true);
      startScanPulse();
      console.log('[ContractGenerator] Scanning document:', scanDocType, source);

      const extracted = await extractDataFromImage(asset.base64);
      console.log('[ContractGenerator] Extracted data:', extracted);

      stopScanPulse();
      setIsScanning(false);

      if (extracted.fullName) setClientName(extracted.fullName);
      if (extracted.documentNumber) setClientId(extracted.documentNumber);
      if (extracted.address) setClientAddress(extracted.address);

      Alert.alert(scanLabels.scanSuccess, scanLabels.scanSuccessMsg);
    } catch (error) {
      console.log('[ContractGenerator] Scan error:', error);
      stopScanPulse();
      setIsScanning(false);
      Alert.alert(scanLabels.scanError, scanLabels.scanErrorMsg);
    }
  }, [isES, scanDocType, scanLabels, extractDataFromImage, startScanPulse, stopScanPulse]);

  const pickBrandingLogo = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        base64: true,
        allowsEditing: true,
        aspect: [1, 1]});
      if (!result.canceled && result.assets[0]) {
        console.log('[ContractGenerator] Logo picked:', result.assets[0].uri);
        setBrandingLogoUri(result.assets[0].uri);
        setBrandingLogoBase64(result.assets[0].base64 ?? null);
      }
    } catch (error) {
      console.log('[ContractGenerator] Logo pick error:', error);
    }
  }, []);

  const buildContractData = useCallback((): ContractData => ({
    contractNumber,
    date: getTodayDate(),
    clientName: clientName || '_______________',
    clientId: clientId || '_______________',
    clientAddress: clientAddress || '_______________',
    clientEmail: clientEmail || '_______________',
    clientPhone: clientPhone || '_______________',
    developerName: developerName || '_______________',
    developerId: developerId || '_______________',
    developerAddress: developerAddress || '_______________',
    developerEmail: developerEmail || '_______________',
    developerPhone: developerPhone || '_______________',
    projectName: projectName || '_______________',
    projectDescription: projectDescription || '_______________',
    projectObjectives: projectObjectives || '_______________',
    projectPlatforms: projectPlatforms || '_______________',
    projectFeatures: projectFeatures || '_______________',
    projectTechStack: projectTechStack || '_______________',
    projectDeliverables: projectDeliverables || '_______________',
    projectMilestones: projectMilestones || '_______________',
    projectAcceptanceCriteria: projectAcceptanceCriteria || '_______________',
    totalAmount: totalAmount || '0.00',
    contractAmount: contractAmount || totalAmount || '0.00',
    currency,
    deliveryDays: deliveryDays || '90',
    refundPercentage: refundPercentage || '100',
    jurisdiction,
    language: contractLang,
    paymentAccountNumber: paymentAccountNumber || '_______________',
    paymentBankName: paymentBankName || '_______________',
    paymentAccountHolder: paymentAccountHolder || '_______________',
    paymentRoutingNumber: paymentRoutingNumber || '_______________',
    attachedImages: attachedImages.filter(img => img.base64).map(img => ({
      base64: img.base64 || '',
      label: img.label})),
    brandingAppName,
    brandingCompanyName,
    brandingTagline,
    brandingWebsite,
    brandingLogoBase64: brandingLogoBase64 || undefined,
    brandingPrimaryColor,
    brandingAccentColor}), [
    contractNumber, clientName, clientId, clientAddress, clientEmail, clientPhone,
    developerName, developerId, developerAddress, developerEmail, developerPhone,
    projectName, projectDescription, projectObjectives, projectPlatforms, projectFeatures,
    projectTechStack, projectDeliverables, projectMilestones, projectAcceptanceCriteria,
    totalAmount, contractAmount, currency, deliveryDays,
    refundPercentage, jurisdiction, contractLang,
    paymentAccountNumber, paymentBankName, paymentAccountHolder, paymentRoutingNumber,
    attachedImages, brandingAppName, brandingCompanyName, brandingTagline, brandingWebsite,
    brandingLogoBase64, brandingPrimaryColor, brandingAccentColor,
  ]);

  const validateForm = useCallback((): boolean => {
    if (!clientName.trim() || !developerName.trim() || !totalAmount.trim()) {
      Alert.alert(labels.fillRequired, labels.fillRequiredMsg);
      return false;
    }
    return true;
  }, [clientName, developerName, totalAmount, labels]);

  const openContractInWindow = useCallback((html: string) => {
    if (Platform.OS === 'web') {
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(html);
        win.document.close();
      } else {
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Contract-${contractNumber}.html`;
        a.click();
        URL.revokeObjectURL(url);
      }
    }
  }, [contractNumber]);

  const handlePreview = useCallback(async () => {
    const data = buildContractData();
    const html = generateContractHTML(data);
    try {
      if (Platform.OS === 'web') {
        openContractInWindow(html);
      } else {
        await Print.printAsync({ html });
      }
    } catch (error) {
      console.log('[ContractGenerator] Preview error:', error);
    }
  }, [buildContractData, openContractInWindow]);

  const handleExportPDF = useCallback(async () => {
    if (!validateForm()) return;
    setIsGenerating(true);
    try {
      const data = buildContractData();
      const html = generateContractHTML(data);

      if (Platform.OS === 'web') {
        openContractInWindow(html);
        Alert.alert(
          labels.success,
          isES
            ? 'Use "Guardar como PDF" en el diálogo de impresión para descargar el PDF.'
            : 'Use "Save as PDF" in the print dialog to download the PDF.'
        );
      } else {
        const { uri } = await Print.printToFileAsync({
          html,
          base64: false});
        console.log('[ContractGenerator] PDF created at:', uri);

        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, {
            mimeType: 'application/pdf',
            dialogTitle: `Contract ${data.contractNumber}`,
            UTI: 'com.adobe.pdf'});
        } else {
          Alert.alert(labels.success, `PDF: ${uri}`);
        }
      }
    } catch (error) {
      console.log('[ContractGenerator] Export error:', error);
      Alert.alert(labels.error, String(error));
    } finally {
      setIsGenerating(false);
    }
  }, [buildContractData, validateForm, labels, openContractInWindow, isES]);

  const handleShareWhatsApp = useCallback(async () => {
    if (!validateForm()) return;

    const message = `${labels.whatsappMsg}${contractNumber}\n\n` +
      `${isES ? 'Cliente' : 'Client'}: ${clientName}\n` +
      `${isES ? 'Desarrollador' : 'Developer'}: ${developerName}\n` +
      `${isES ? 'Proyecto' : 'Project'}: ${projectName}\n` +
      `${isES ? 'Monto' : 'Amount'}: ${currency} ${totalAmount}\n` +
      `${isES ? 'Fecha' : 'Date'}: ${getTodayDate()}\n\n` +
      `${isES ? 'Este contrato incluye:' : 'This contract includes:'}\n` +
      `- ${labels.feat1}\n` +
      `- ${labels.feat2}\n` +
      `- ${labels.feat3}\n` +
      `- ${labels.feat4}\n` +
      `- ${labels.feat5}\n` +
      `- ${labels.feat6}\n\n` +
      `${isES ? 'Jurisdicción' : 'Jurisdiction'}: ${jurisdiction}`;

    const encoded = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/?text=${encoded}`;

    try {
      const supported = await Linking.canOpenURL(whatsappUrl);
      if (supported) {
        await Linking.openURL(whatsappUrl);
      } else {
        if (Platform.OS === 'web') {
          window.open(whatsappUrl, '_blank');
        } else {
          Alert.alert(labels.noWhatsApp);
        }
      }
    } catch (error) {
      console.log('[ContractGenerator] WhatsApp error:', error);
      if (Platform.OS === 'web') {
        window.open(whatsappUrl, '_blank');
      }
    }
  }, [validateForm, contractNumber, clientName, developerName, projectName, totalAmount, currency, jurisdiction, labels, isES]);

  const handlePrint = useCallback(async () => {
    if (!validateForm()) return;
    try {
      const data = buildContractData();
      const html = generateContractHTML(data);

      if (Platform.OS === 'web') {
        openContractInWindow(html);
      } else {
        await Print.printAsync({ html });
      }
    } catch (error) {
      console.log('[ContractGenerator] Print error:', error);
    }
  }, [buildContractData, validateForm, openContractInWindow]);

  const handleGeneralShare = useCallback(async () => {
    if (!validateForm()) return;
    setIsGenerating(true);
    try {
      const data = buildContractData();
      const html = generateContractHTML(data);

      if (Platform.OS === 'web') {
        openContractInWindow(html);
      } else {
        const { uri } = await Print.printToFileAsync({ html, base64: false });
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Contract ${data.contractNumber}`});
      }
    } catch (error) {
      console.log('[ContractGenerator] Share error:', error);
    } finally {
      setIsGenerating(false);
    }
  }, [buildContractData, validateForm, openContractInWindow]);

  const renderInput = useCallback((
    label: string,
    value: string,
    onChangeText: (text: string) => void,
    options?: { multiline?: boolean; keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric'; placeholder?: string }
  ) => (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        style={[styles.input, options?.multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={Colors.inputPlaceholder}
        placeholder={options?.placeholder || label}
        multiline={options?.multiline}
        keyboardType={options?.keyboardType || 'default'}
        numberOfLines={options?.multiline ? 4 : 1}
        textAlignVertical={options?.multiline ? 'top' : 'center'}
      />
    </View>
  ), []);

  const renderSectionHeader = useCallback((key: string, title: string, icon: React.ReactNode) => (
    <TouchableOpacity
      style={styles.sectionHeader}
      onPress={() => toggleSection(key)}
      activeOpacity={0.7}
    >
      <View style={styles.sectionHeaderLeft}>
        <View style={styles.sectionIcon}>{icon}</View>
        <Text style={styles.sectionHeaderTitle}>{title}</Text>
      </View>
      {expandedSections[key] ? (
        <ChevronUp size={20} color={Colors.textSecondary} />
      ) : (
        <ChevronDown size={20} color={Colors.textSecondary} />
      )}
    </TouchableOpacity>
  ), [expandedSections, toggleSection]);

  const ndaFeatureItems = [
    { icon: <KeyRound size={14} color="#FFD700" />, text: labels.ndaFeat1 },
    { icon: <Ban size={14} color="#FF6B6B" />, text: labels.ndaFeat2 },
    { icon: <EyeOff size={14} color="#9B59B6" />, text: labels.ndaFeat3 },
    { icon: <ShieldAlert size={14} color="#E74C3C" />, text: labels.ndaFeat4 },
    { icon: <FileWarning size={14} color="#3498DB" />, text: labels.ndaFeat5 },
    { icon: <Lock size={14} color="#2ECC71" />, text: labels.ndaFeat6 },
  ];

  const featureItems = [
    { icon: <CheckCircle size={14} color={Colors.success} />, text: labels.feat1 },
    { icon: <Scale size={14} color={Colors.warning} />, text: labels.feat2 },
    { icon: <DollarSign size={14} color={Colors.primary} />, text: labels.feat3 },
    { icon: <AlertTriangle size={14} color={Colors.error} />, text: labels.feat4 },
    { icon: <Globe size={14} color={Colors.info} />, text: labels.feat5 },
    { icon: <Gavel size={14} color={Colors.error} />, text: labels.feat6 },
  ];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{labels.title}</Text>
            <Text style={styles.headerSubtitle}>{labels.contractNo}: {contractNumber}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.scrollView}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.heroCard}>
              <View style={styles.heroIconRow}>
                <Shield size={28} color={Colors.primary} />
                <Scale size={28} color={Colors.warning} />
                <Gavel size={28} color={Colors.error} />
              </View>
              <Text style={styles.heroTitle}>{labels.subtitle}</Text>
              <View style={styles.featuresGrid}>
                {featureItems.map((item, i) => (
                  <View key={i} style={styles.featureItem}>
                    {item.icon}
                    <Text style={styles.featureText}>{item.text}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.ndaCard}>
              <View style={styles.ndaBadgeRow}>
                <Lock size={18} color="#fff" />
                <Text style={styles.ndaBadgeText}>{labels.ndaBadge}</Text>
              </View>
              <View style={styles.ndaGrid}>
                {ndaFeatureItems.map((item, i) => (
                  <View key={i} style={styles.ndaFeatureItem}>
                    {item.icon}
                    <Text style={styles.ndaFeatureText}>{item.text}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.langToggle}>
              <Text style={styles.langLabel}>{labels.langToggle}</Text>
              <View style={styles.langBtns}>
                <TouchableOpacity
                  style={[styles.langBtn, contractLang === 'es' && styles.langBtnActive]}
                  onPress={() => setContractLang('es')}
                >
                  <Text style={[styles.langBtnText, contractLang === 'es' && styles.langBtnTextActive]}>
                    🇪🇨 {labels.spanish}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.langBtn, contractLang === 'en' && styles.langBtnActive]}
                  onPress={() => setContractLang('en')}
                >
                  <Text style={[styles.langBtnText, contractLang === 'en' && styles.langBtnTextActive]}>
                    🌐 {labels.english}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.formCard}>
              {renderSectionHeader('client', labels.clientSection, <User size={18} color={Colors.primary} />)}
              {expandedSections.client && (
                <View style={styles.sectionContent}>
                  <View style={styles.scanDocCard}>
                    <View style={styles.scanDocHeader}>
                      <View style={styles.scanDocIconWrap}>
                        <ScanLine size={18} color="#FFD700" />
                      </View>
                      <View style={styles.scanDocHeaderText}>
                        <Text style={styles.scanDocTitle}>{scanLabels.scanTitle}</Text>
                        <Text style={styles.scanDocHint}>{scanLabels.scanHint}</Text>
                      </View>
                    </View>

                    <View style={styles.docTypeRow}>
                      {[
                        { key: 'id' as DocType, label: scanLabels.docTypeId, icon: <IdCard size={14} color={scanDocType === 'id' ? '#FFD700' : Colors.textTertiary} /> },
                        { key: 'passport' as DocType, label: scanLabels.docTypePassport, icon: <BookOpen size={14} color={scanDocType === 'passport' ? '#FFD700' : Colors.textTertiary} /> },
                        { key: 'license' as DocType, label: scanLabels.docTypeLicense, icon: <CreditCard size={14} color={scanDocType === 'license' ? '#FFD700' : Colors.textTertiary} /> },
                      ].map((dt) => (
                        <TouchableOpacity
                          key={dt.key}
                          style={[styles.docTypeBtn, scanDocType === dt.key && styles.docTypeBtnActive]}
                          onPress={() => setScanDocType(dt.key)}
                          activeOpacity={0.7}
                        >
                          {dt.icon}
                          <Text style={[styles.docTypeBtnText, scanDocType === dt.key && styles.docTypeBtnTextActive]}>
                            {dt.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {isScanning ? (
                      <Animated.View style={[styles.scanningBox, { opacity: Animated.add(0.5, Animated.multiply(scanPulse, 0.5)) }]}> 
                        <ShimmerIndicator size="small" color="#FFD700" />
                        <Text style={styles.scanningText}>{scanLabels.scanning}</Text>
                      </Animated.View>
                    ) : scannedImageUri ? (
                      <View style={styles.scannedPreview}>
                        <Image source={{ uri: scannedImageUri }} style={styles.scannedImage} />
                        <View style={styles.scannedInfo}>
                          <View style={styles.scannedBadge}>
                            <Sparkles size={12} color="#2ECC71" />
                            <Text style={styles.scannedBadgeText}>{scanLabels.autoFilled}</Text>
                          </View>
                          <TouchableOpacity
                            style={styles.rescanBtn}
                            onPress={() => { setScannedImageUri(null); }}
                            activeOpacity={0.7}
                          >
                            <ScanLine size={14} color="#FFD700" />
                            <Text style={styles.rescanBtnText}>{scanLabels.rescan}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.scanBtnRow}>
                        <TouchableOpacity
                          style={styles.scanCameraBtn}
                          onPress={() => handleScanDocument('camera')}
                          activeOpacity={0.7}
                        >
                          <Camera size={18} color="#fff" />
                          <Text style={styles.scanCameraBtnText}>{scanLabels.scanCamera}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.scanGalleryBtn}
                          onPress={() => handleScanDocument('gallery')}
                          activeOpacity={0.7}
                        >
                          <ImageIcon size={18} color="#FFD700" />
                          <Text style={styles.scanGalleryBtnText}>{scanLabels.scanGallery}</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>

                  {renderInput(labels.fullName, clientName, setClientName)}
                  {renderInput(labels.idDoc, clientId, setClientId, { placeholder: 'CI / Passport' })}
                  {renderInput(labels.address, clientAddress, setClientAddress)}
                  {renderInput(labels.email, clientEmail, setClientEmail, { keyboardType: 'email-address' })}
                  {renderInput(labels.phone, clientPhone, setClientPhone, { keyboardType: 'phone-pad' })}
                </View>
              )}
            </View>

            <View style={styles.formCard}>
              {renderSectionHeader('developer', labels.developerSection, <Building2 size={18} color={Colors.info} />)}
              {expandedSections.developer && (
                <View style={styles.sectionContent}>
                  {renderInput(labels.fullName, developerName, setDeveloperName)}
                  {renderInput(labels.idDoc, developerId, setDeveloperId, { placeholder: 'CI / Passport' })}
                  {renderInput(labels.address, developerAddress, setDeveloperAddress)}
                  {renderInput(labels.email, developerEmail, setDeveloperEmail, { keyboardType: 'email-address' })}
                  {renderInput(labels.phone, developerPhone, setDeveloperPhone, { keyboardType: 'phone-pad' })}
                </View>
              )}
            </View>

            <View style={styles.formCard}>
              {renderSectionHeader('project', labels.projectSection, <FileText size={18} color={Colors.success} />)}
              {expandedSections.project && (
                <View style={styles.sectionContent}>
                  {renderInput(labels.projectNameLabel, projectName, setProjectName)}
                  {renderInput(labels.descriptionLabel, projectDescription, setProjectDescription, { multiline: true, placeholder: isES ? 'Descripción general del proyecto...' : 'General project description...' })}
                  {renderInput(labels.objectivesLabel, projectObjectives, setProjectObjectives, { multiline: true, placeholder: labels.objectivesPlaceholder })}
                  {renderInput(labels.platformsLabel, projectPlatforms, setProjectPlatforms, { placeholder: labels.platformsPlaceholder })}
                  {renderInput(labels.featuresLabel, projectFeatures, setProjectFeatures, { multiline: true, placeholder: labels.featuresPlaceholder })}
                  {renderInput(labels.techStackLabel, projectTechStack, setProjectTechStack, { placeholder: labels.techStackPlaceholder })}
                  {renderInput(labels.deliverablesLabel, projectDeliverables, setProjectDeliverables, { multiline: true, placeholder: labels.deliverablesPlaceholder })}
                  {renderInput(labels.milestonesLabel, projectMilestones, setProjectMilestones, { multiline: true, placeholder: labels.milestonesPlaceholder })}
                  {renderInput(labels.acceptanceLabel, projectAcceptanceCriteria, setProjectAcceptanceCriteria, { multiline: true, placeholder: labels.acceptancePlaceholder })}
                </View>
              )}
            </View>

            <View style={styles.formCard}>
              {renderSectionHeader('payment', labels.paymentSection, <DollarSign size={18} color="#2e7d32" />)}
              {expandedSections.payment && (
                <View style={styles.sectionContent}>
                  <View style={styles.paymentHighlight}>
                    <DollarSign size={16} color="#2e7d32" />
                    <Text style={styles.paymentHighlightText}>
                      {isES ? 'Ingrese el valor del contrato y la cuenta bancaria para pagos' : 'Enter the contract value and bank account for payments'}
                    </Text>
                  </View>
                  <View style={styles.rowInputs}>
                    <View style={styles.rowInputHalf}>
                      {renderInput(labels.contractAmountLabel, contractAmount, setContractAmount, { keyboardType: 'numeric', placeholder: isES ? 'Ej: 5000.00' : 'E.g: 5000.00' })}
                    </View>
                    <View style={styles.rowInputSmall}>
                      {renderInput(labels.currencyLabel, currency, setCurrency)}
                    </View>
                  </View>
                  {renderInput(labels.totalAmountLabel, totalAmount, setTotalAmount, { keyboardType: 'numeric', placeholder: isES ? 'Monto total a pagar' : 'Total amount to pay' })}
                  <View style={styles.paymentDivider} />
                  {renderInput(labels.bankNameLabel, paymentBankName, setPaymentBankName, { placeholder: isES ? 'Ej: Banco Pichincha' : 'E.g: Bank of America' })}
                  {renderInput(labels.accountNumberLabel, paymentAccountNumber, setPaymentAccountNumber, { keyboardType: 'numeric', placeholder: isES ? 'Número de cuenta bancaria' : 'Bank account number' })}
                  {renderInput(labels.accountHolderLabel, paymentAccountHolder, setPaymentAccountHolder, { placeholder: isES ? 'Nombre del titular' : 'Account holder name' })}
                  {renderInput(labels.routingNumberLabel, paymentRoutingNumber, setPaymentRoutingNumber, { placeholder: isES ? 'Código SWIFT o ruta' : 'SWIFT or routing code' })}
                </View>
              )}
            </View>

            <View style={styles.formCard}>
              {renderSectionHeader('attachments', labels.attachmentsSection, <Paperclip size={18} color="#E67E22" />)}
              {expandedSections.attachments && (
                <View style={styles.sectionContent}>
                  <View style={styles.attachHintBox}>
                    <Camera size={16} color="#E67E22" />
                    <Text style={styles.attachHintText}>
                      {isES
                        ? 'Adjunte fotos de documentos de identidad, contratos previos, capturas de pantalla u otra información relevante'
                        : 'Attach photos of IDs, previous contracts, screenshots, or other relevant information'}
                    </Text>
                  </View>

                  <View style={styles.attachButtonRow}>
                    <TouchableOpacity
                      style={styles.attachCameraBtn}
                      onPress={() => pickImageFromCamera()}
                      activeOpacity={0.7}
                    >
                      <Camera size={20} color="#fff" />
                      <Text style={styles.attachCameraBtnText}>{labels.attachFromCamera}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.attachGalleryBtn}
                      onPress={() => pickImageFromGallery()}
                      activeOpacity={0.7}
                    >
                      <ImageIcon size={20} color="#fff" />
                      <Text style={styles.attachGalleryBtnText}>{labels.attachFromGallery}</Text>
                    </TouchableOpacity>
                  </View>

                  {attachedImages.length === 0 ? (
                    <View style={styles.noAttachmentsBox}>
                      <Paperclip size={24} color={Colors.textTertiary} />
                      <Text style={styles.noAttachmentsText}>{labels.noAttachments}</Text>
                    </View>
                  ) : (
                    <View style={styles.attachmentGrid}>
                      {attachedImages.map((img, idx) => (
                        <View key={idx} style={styles.attachmentCard}>
                          <Image source={{ uri: img.uri }} style={styles.attachmentThumb} />
                          <View style={styles.attachmentInfo}>
                            <TextInput
                              style={styles.attachmentLabelInput}
                              value={img.label}
                              onChangeText={(text) => {
                                setAttachedImages(prev =>
                                  prev.map((item, i) => i === idx ? { ...item, label: text } : item)
                                );
                              }}
                              placeholderTextColor={Colors.inputPlaceholder}
                              placeholder={labels.attachPlaceholder}
                            />
                          </View>
                          <TouchableOpacity
                            style={styles.attachmentRemoveBtn}
                            onPress={() => removeAttachment(idx)}
                          >
                            <X size={16} color="#FF4D4D" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>

            <View style={styles.formCard}>
              {renderSectionHeader('branding', labels.brandingSection, <Palette size={18} color="#9B59B6" />)}
              {expandedSections.branding && (
                <View style={styles.sectionContent}>
                  <View style={styles.brandingLogoRow}>
                    <TouchableOpacity
                      style={styles.brandingLogoBtn}
                      onPress={pickBrandingLogo}
                      activeOpacity={0.7}
                    >
                      {brandingLogoUri ? (
                        <Image source={{ uri: brandingLogoUri }} style={styles.brandingLogoPreview} />
                      ) : (
                        <View style={styles.brandingLogoPlaceholder}>
                          <ImageIcon size={28} color={Colors.textTertiary} />
                          <Text style={styles.brandingLogoPlaceholderText}>{labels.uploadLogo}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                    <View style={styles.brandingLogoInfo}>
                      <Text style={styles.brandingLogoInfoTitle}>
                        {isES ? 'Logo de la Empresa' : 'Company Logo'}
                      </Text>
                      <Text style={styles.brandingLogoInfoSub}>
                        {isES ? 'Toque para seleccionar' : 'Tap to select'}
                      </Text>
                    </View>
                  </View>
                  {renderInput(labels.appNameLabel, brandingAppName, setBrandingAppName)}
                  {renderInput(labels.companyNameLabel, brandingCompanyName, setBrandingCompanyName)}
                  {renderInput(labels.taglineLabel, brandingTagline, setBrandingTagline, { placeholder: isES ? 'Ej: Inversiones inteligentes para todos' : 'E.g: Smart investments for everyone' })}
                  {renderInput(labels.websiteLabel, brandingWebsite, setBrandingWebsite, { placeholder: 'https://www.example.com', keyboardType: 'default' })}
                  <View style={styles.colorPickerRow}>
                    <View style={styles.colorPickerItem}>
                      <Text style={styles.inputLabel}>{labels.primaryColorLabel}</Text>
                      <View style={styles.colorInputRow}>
                        <View style={[styles.colorSwatch, { backgroundColor: brandingPrimaryColor }]} />
                        <TextInput
                          style={styles.colorInput}
                          value={brandingPrimaryColor}
                          onChangeText={setBrandingPrimaryColor}
                          placeholderTextColor={Colors.inputPlaceholder}
                          placeholder="#1a3a5c"
                        />
                      </View>
                    </View>
                    <View style={styles.colorPickerItem}>
                      <Text style={styles.inputLabel}>{labels.accentColorLabel}</Text>
                      <View style={styles.colorInputRow}>
                        <View style={[styles.colorSwatch, { backgroundColor: brandingAccentColor }]} />
                        <TextInput
                          style={styles.colorInput}
                          value={brandingAccentColor}
                          onChangeText={setBrandingAccentColor}
                          placeholderTextColor={Colors.inputPlaceholder}
                          placeholder="#FFD700"
                        />
                      </View>
                    </View>
                  </View>
                  <View style={styles.brandingPreviewBox}>
                    <View style={[styles.brandingPreviewHeader, { backgroundColor: brandingPrimaryColor }]}>
                      {brandingLogoUri && (
                        <Image source={{ uri: brandingLogoUri }} style={styles.brandingPreviewLogo} />
                      )}
                      <Text style={[styles.brandingPreviewName, { color: brandingAccentColor }]}>
                        {brandingAppName || 'App Name'}
                      </Text>
                    </View>
                    <View style={styles.brandingPreviewBody}>
                      <Text style={styles.brandingPreviewCompany}>
                        {brandingCompanyName || 'Company Name'}
                      </Text>
                      {brandingTagline ? (
                        <Text style={styles.brandingPreviewTagline}>{brandingTagline}</Text>
                      ) : null}
                      {brandingWebsite ? (
                        <Text style={[styles.brandingPreviewWebsite, { color: brandingPrimaryColor }]}>
                          {brandingWebsite}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </View>
              )}
            </View>

            <View style={styles.formCard}>
              {renderSectionHeader('terms', labels.termsSection, <Scale size={18} color={Colors.primary} />)}
              {expandedSections.terms && (
                <View style={styles.sectionContent}>
                  <View style={styles.rowInputs}>
                    <View style={styles.rowInputHalf}>
                      {renderInput(labels.deliveryLabel, deliveryDays, setDeliveryDays, { keyboardType: 'numeric' })}
                    </View>
                    <View style={styles.rowInputSmall}>
                      {renderInput(labels.refundLabel, refundPercentage, setRefundPercentage, { keyboardType: 'numeric' })}
                    </View>
                  </View>
                  {renderInput(labels.jurisdictionLabel, jurisdiction, setJurisdiction)}
                </View>
              )}
            </View>

            <View style={styles.actionsCard}>
              <TouchableOpacity
                style={styles.previewBtn}
                onPress={handlePreview}
                activeOpacity={0.8}
              >
                <Eye size={20} color={Colors.text} />
                <Text style={styles.previewBtnText}>{labels.previewBtn}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.exportBtn, isGenerating && styles.btnDisabled]}
                onPress={handleExportPDF}
                activeOpacity={0.8}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <ShimmerIndicator size="small" color="#fff" />
                ) : (
                  <Download size={20} color="#fff" />
                )}
                <Text style={styles.exportBtnText}>
                  {isGenerating ? labels.generating : labels.exportPdf}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.printBtn}
                onPress={handlePrint}
                activeOpacity={0.8}
              >
                <Printer size={20} color="#fff" />
                <Text style={styles.printBtnText}>
                  {isES ? 'Imprimir Contrato' : 'Print Contract'}
                </Text>
              </TouchableOpacity>

              <View style={styles.shareRow}>
                <TouchableOpacity
                  style={styles.whatsappBtn}
                  onPress={handleShareWhatsApp}
                  activeOpacity={0.8}
                >
                  <MessageCircle size={18} color="#fff" />
                  <Text style={styles.whatsappBtnText}>{labels.shareWhatsApp}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.shareBtn}
                  onPress={handleGeneralShare}
                  activeOpacity={0.8}
                >
                  <Share2 size={18} color={Colors.text} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.legalFooter}>
              <Scale size={16} color={Colors.textTertiary} />
              <Text style={styles.legalFooterText}>
                {isES
                  ? 'Este contrato cumple con las leyes ecuatorianas e internacionales. Se recomienda la notarización para mayor validez legal.'
                  : 'This contract complies with Ecuadorian and international law. Notarization is recommended for greater legal validity.'}
              </Text>
            </View>

            <View style={{ height: 60 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080C14'},
  safeArea: {
    flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)'},
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center'},
  headerCenter: {
    flex: 1,
    alignItems: 'center'},
  headerTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text},
  headerSubtitle: {
    fontSize: 11,
    color: Colors.primary,
    marginTop: 2,
    fontWeight: '600' as const},
  scrollView: {
    flex: 1,
    backgroundColor: Colors.background},
  heroCard: {
    margin: 16,
    padding: 20,
    backgroundColor: 'rgba(26, 58, 92, 0.25)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(26, 58, 92, 0.4)'},
  heroIconRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12},
  heroTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 14},
  featuresGrid: {
    gap: 8},
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  featureText: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1},
  langToggle: {
    marginHorizontal: 16,
    marginBottom: 16},
  langLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 8},
  langBtns: {
    flexDirection: 'row',
    gap: 10},
  langBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center'},
  langBtnActive: {
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
    borderColor: Colors.primary},
  langBtnText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '600' as const},
  langBtnTextActive: {
    color: Colors.primary},
  formCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden'},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14},
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center'},
  sectionHeaderTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text},
  sectionContent: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 10},
  inputGroup: {
    gap: 4},
  inputLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3},
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)'},
  inputMultiline: {
    minHeight: 90,
    textAlignVertical: 'top' as const},
  rowInputs: {
    flexDirection: 'row',
    gap: 10},
  rowInputHalf: {
    flex: 2},
  rowInputSmall: {
    flex: 1},
  actionsCard: {
    margin: 16,
    gap: 10},
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)'},
  previewBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text},
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#1a3a5c'},
  printBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#2980B9'},
  printBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#fff'},
  btnDisabled: {
    opacity: 0.6},
  exportBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#fff'},
  shareRow: {
    flexDirection: 'row',
    gap: 10},
  whatsappBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#25D366'},
  whatsappBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#fff'},
  shareBtn: {
    width: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)'},
  legalFooter: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)'},
  legalFooterText: {
    flex: 1,
    fontSize: 11,
    color: Colors.textTertiary,
    lineHeight: 16},
  paymentHighlight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(46, 125, 50, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(46, 125, 50, 0.25)'},
  paymentHighlightText: {
    flex: 1,
    fontSize: 12,
    color: '#66BB6A',
    fontWeight: '500' as const},
  paymentDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 6},
  attachHintBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(230, 126, 34, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(230, 126, 34, 0.25)'},
  attachHintText: {
    flex: 1,
    fontSize: 12,
    color: '#F0A050',
    fontWeight: '500' as const},
  attachButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4},
  attachCameraBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#E67E22'},
  attachCameraBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#fff'},
  attachGalleryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#2980B9'},
  attachGalleryBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#fff'},
  noAttachmentsBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderStyle: 'dashed',
    borderRadius: 10},
  noAttachmentsText: {
    fontSize: 13,
    color: Colors.textTertiary},
  attachmentGrid: {
    gap: 10},
  attachmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 8},
  attachmentThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)'},
  attachmentInfo: {
    flex: 1},
  attachmentLabelInput: {
    fontSize: 13,
    color: Colors.text,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'},
  attachmentRemoveBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 77, 77, 0.12)',
    alignItems: 'center',
    justifyContent: 'center'},
  brandingLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 6},
  brandingLogoBtn: {
    width: 72,
    height: 72,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(155, 89, 182, 0.3)',
    borderStyle: 'dashed'},
  brandingLogoPreview: {
    width: '100%',
    height: '100%'},
  brandingLogoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(155, 89, 182, 0.08)',
    gap: 2},
  brandingLogoPlaceholderText: {
    fontSize: 9,
    color: Colors.textTertiary,
    fontWeight: '600' as const},
  brandingLogoInfo: {
    flex: 1},
  brandingLogoInfoTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text},
  brandingLogoInfoSub: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2},
  colorPickerRow: {
    flexDirection: 'row',
    gap: 10},
  colorPickerItem: {
    flex: 1,
    gap: 4},
  colorInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  colorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)'},
  colorInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: Colors.text,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)'},
  brandingPreviewBox: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginTop: 4},
  brandingPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12},
  brandingPreviewLogo: {
    width: 28,
    height: 28,
    borderRadius: 6},
  brandingPreviewName: {
    fontSize: 15,
    fontWeight: '800' as const,
    letterSpacing: 0.5},
  brandingPreviewBody: {
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.03)'},
  brandingPreviewCompany: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '600' as const},
  brandingPreviewTagline: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2,
    fontStyle: 'italic'},
  brandingPreviewWebsite: {
    fontSize: 11,
    fontWeight: '600' as const,
    marginTop: 4},
  ndaCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    backgroundColor: 'rgba(139, 0, 0, 0.15)',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(139, 0, 0, 0.4)'},
  ndaBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(139, 0, 0, 0.6)',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 14},
  ndaBadgeText: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: '#fff',
    letterSpacing: 1.2},
  ndaGrid: {
    gap: 10},
  ndaFeatureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  ndaFeatureText: {
    fontSize: 12,
    color: '#ddd',
    flex: 1,
    fontWeight: '500' as const},
  scanDocCard: {
    backgroundColor: 'rgba(255, 215, 0, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.18)',
    padding: 14,
    gap: 12},
  scanDocHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10},
  scanDocIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    alignItems: 'center',
    justifyContent: 'center'},
  scanDocHeaderText: {
    flex: 1,
    gap: 2},
  scanDocTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#FFD700'},
  scanDocHint: {
    fontSize: 11,
    color: Colors.textTertiary,
    lineHeight: 16},
  docTypeRow: {
    flexDirection: 'row',
    gap: 8},
  docTypeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)'},
  docTypeBtnActive: {
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
    borderColor: 'rgba(255, 215, 0, 0.35)'},
  docTypeBtnText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textTertiary},
  docTypeBtnTextActive: {
    color: '#FFD700'},
  scanBtnRow: {
    flexDirection: 'row',
    gap: 8},
  scanCameraBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#C8960C'},
  scanCameraBtnText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#fff'},
  scanGalleryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.25)'},
  scanGalleryBtnText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#FFD700'},
  scanningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 215, 0, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.2)'},
  scanningText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#FFD700'},
  scannedPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(46, 204, 113, 0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(46, 204, 113, 0.2)',
    padding: 10},
  scannedImage: {
    width: 60,
    height: 42,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.06)'},
  scannedInfo: {
    flex: 1,
    gap: 6},
  scannedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(46, 204, 113, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6},
  scannedBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#2ECC71',
    letterSpacing: 0.3},
  rescanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start'},
  rescanBtnText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#FFD700'}});
