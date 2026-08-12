import React, { useState, useMemo, useCallback } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  Platform,
  Share,
  KeyboardAvoidingView,
  Keyboard,
  TouchableWithoutFeedback} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import {
  ArrowLeft,
  Share2,
  Heart,
  MapPin,
  Building2,
  TrendingUp,
  Shield,
  FileText,
  Calendar,
  DollarSign,
  Users,
  X,
  Minus,
  Plus,
  Info,
  Home,
  CheckCircle,
  BarChart3,
  Clock,
  Award,
  Download,
  Eye,
  RefreshCw,
  Scale,
  Landmark,
  ChevronRight,
  Copy,
  ExternalLink} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { PropertyDocument, TimeRange } from '@/types';
import Colors from '@/constants/colors';
import { EmptyState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import { formatCurrencyWithDecimals, formatCurrencyCompact, formatDollar, formatNumber, formatAmountInput, parseAmountInput } from '@/lib/formatters';
import { useProperty, useMarketData, useWalletBalance, useCurrentUser } from '@/lib/data-hooks';
import ImageSlider from '@/components/ImageSlider';
import PriceChart from '@/components/PriceChart';
import { usePropertyImages } from '@/lib/use-property-images';
import { showImagePickerOptions } from '@/lib/image-picker-utils';
import { Camera } from 'lucide-react-native';
import { getDealExitProjection, INVESTOR_TIMELINE_STEPS } from '@/lib/investor-intake';

export default function PropertyDetailScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [isFavorite, setIsFavorite] = useState(false);
  const [showInvestModal, setShowInvestModal] = useState(false);
  const [investAmount, setInvestAmount] = useState<string>('100');
  const [timeRange, setTimeRange] = useState<TimeRange>('1M');
  const [showAddFundsModal, setShowAddFundsModal] = useState(false);
  const [addFundsAmount, setAddFundsAmount] = useState<string>('500');
  const { user: currentUser } = useCurrentUser();
  const { balance } = useWalletBalance();
  const [walletBalance, setWalletBalance] = useState(0);
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<PropertyDocument | null>(null);
  const [showAppraisalModal, setShowAppraisalModal] = useState(false);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRequestingAppraisal, setIsRequestingAppraisal] = useState(false);

  const insets = useSafeAreaInsets();
  const { property } = useProperty(id || '');
  const { marketData: allMarketData } = useMarketData();
  const marketData = useMemo(() => allMarketData[id || ''] || null, [allMarketData, id]);

  React.useEffect(() => {
    setWalletBalance(balance?.available ?? 0);
  }, [balance?.available]);

  const { images: propertyImages } = usePropertyImages(
    id || '',
    property?.images ?? []
  );

  const handleUploadImages = useCallback(() => {
    if (!property) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    showImagePickerOptions(
      {
        entityType: 'property',
        entityId: property.id,
        uploadedBy: currentUser?.id || '',
        allowsMultiple: true,
        quality: 0.9},
      (storedImages) => {
        console.log('[PropertyDetail] Uploaded', storedImages.length, 'images for property', property.id);
        Alert.alert(
          'Images Saved',
          `${storedImages.length} image(s) have been permanently saved to this property. They will never be replaced.`,
          [{ text: 'OK' }]
        );
      }
    );
  }, [property, currentUser]);

  const appraisalData = useMemo(() => {
    if (!property) return null;
    const baseValue = property.pricePerShare * property.totalShares;
    return {
      currentValue: baseValue,
      lastAppraisalDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      nextAppraisalDate: new Date(Date.now() + 305 * 24 * 60 * 60 * 1000).toISOString(),
      landValue: baseValue * 0.35,
      buildingValue: baseValue * 0.55,
      improvementsValue: baseValue * 0.10,
      marketComparison: {
        areaAverage: baseValue * 0.92,
        premium: 8.7},
      valuationHistory: [
        { date: '2024-01', value: baseValue * 0.88 },
        { date: '2024-06', value: baseValue * 0.94 },
        { date: '2024-12', value: baseValue },
      ],
      appraiser: 'IVXHOLDINGS Certified Valuations LLC',
      appraisalMethod: 'Income Capitalization + Sales Comparison',
      confidence: 94};
  }, [property]);

  const titleData = useMemo(() => {
    if (!property) return null;
    return {
      titleNumber: `TL-${property.id.padStart(6, '0')}-${property.city.substring(0, 3).toUpperCase()}`,
      registrationDate: new Date(property.createdAt).toISOString(),
      titleStatus: 'Clear',
      encumbrances: 'None',
      legalDescription: `Lot ${parseInt(property.id) * 7 % 999 + 1}, Block ${parseInt(property.id) * 3 % 99 + 1}, ${property.city} Subdivision`,
      parcelId: `P-${property.id.padStart(8, '0')}`,
      zoning: property.propertyType === 'commercial' ? 'C-2 Commercial' : property.propertyType === 'residential' ? 'R-3 Residential' : 'MU-1 Mixed Use',
      ownershipHistory: [
        { date: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(), owner: 'Previous Holdings LLC', type: 'Sale' },
        { date: new Date(property.createdAt).toISOString(), owner: 'IVXHOLDINGS Property Trust', type: 'Tokenization' },
      ],
      verification: {
        status: 'verified',
        verifiedBy: 'First American Title Insurance',
        verifiedDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()}};
  }, [property]);

  const fundedPercent = useMemo(() => {
    if (!property) return 0;
    return Math.round((property.currentRaise / property.targetRaise) * 100);
  }, [property]);
  
  const shares = useMemo(() => {
    if (!property) return 0;
    return Math.floor((Number(parseAmountInput(investAmount)) || 0) / property.pricePerShare);
  }, [investAmount, property]);
  
  const totalCost = useMemo(() => {
    if (!property) return 0;
    return shares * property.pricePerShare;
  }, [shares, property]);
  
  const fees = useMemo(() => totalCost * 0.01, [totalCost]);

  const investmentProjection = useMemo(() => {
    if (!property) return null;
    return getDealExitProjection({
      propertyValue: property.pricePerShare * property.totalShares,
      expectedROI: property.irr || property.yield,
      minInvestment: property.minInvestment,
      totalInvestment: property.targetRaise || property.pricePerShare * property.totalShares});
  }, [property]);

  const timelineMilestones = useMemo(() => {
    if (!property) return [] as { id: string; title: string; detail: string }[];

    const modeledReturn = property.irr || property.yield;
    return [
      {
        id: 'funding',
        title: 'Funding window',
        detail: fundedPercent >= 100 ? 'Funding target reached' : `${fundedPercent}% of the target raise is currently funded.`},
      {
        id: 'wallet',
        title: INVESTOR_TIMELINE_STEPS[2]?.label ?? 'Wallet + funding',
        detail: 'Wallet balance, transaction records, and payment source review are completed before final allocation.'},
      {
        id: 'hold',
        title: 'Projected hold period',
        detail: `Current timeline modeling uses ${modeledReturn.toFixed(1)}% as the expected exit return basis for this property.`},
      {
        id: 'exit',
        title: INVESTOR_TIMELINE_STEPS[4]?.label ?? 'Distributions + exit',
        detail: 'Final investor proceeds depend on real performance, fees, distributions, and the actual sale or refinance outcome.'},
    ];
  }, [fundedPercent, property]);

  const getRiskColor = useCallback(() => {
    if (!property) return Colors.textTertiary;
    switch (property.riskLevel) {
      case 'low':
        return Colors.success;
      case 'medium':
        return Colors.warning;
      case 'high':
        return Colors.error;
      default:
        return Colors.textTertiary;
    }
  }, [property]);

  const closeInvestModal = useCallback(() => setShowInvestModal(false), []);
  const closeAddFundsModal = useCallback(() => setShowAddFundsModal(false), []);
  const closeDocumentModal = useCallback(() => setShowDocumentModal(false), []);
  const closeAppraisalModal = useCallback(() => setShowAppraisalModal(false), []);
  const closeTitleModal = useCallback(() => setShowTitleModal(false), []);
  const openAppraisalModal = useCallback(() => setShowAppraisalModal(true), []);

  const handleInvest = useCallback(() => {
    if (!property) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({ pathname: '/buy-shares', params: { propertyId: property.id } } as any);
  }, [property, router]);

  const handleConfirmInvest = useCallback(() => {
    if (!property) return;
    if (totalCost + fees > walletBalance) {
      Alert.alert(
        'Insufficient Funds',
        'Please add funds to your wallet to complete this investment.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add Funds', onPress: () => setShowAddFundsModal(true) }
        ]
      );
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowInvestModal(false);
    Alert.alert(
      'Investment Successful!',
      `You have successfully invested ${formatCurrencyWithDecimals(totalCost)} in ${property.name} (${shares} shares).`,
      [{ text: 'View Portfolio', onPress: () => router.push('/portfolio' as any) }]
    );
  }, [totalCost, fees, walletBalance, property, shares, router]);

  const adjustAmount = useCallback((delta: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInvestAmount((prev) => {
      const current = Number(parseAmountInput(prev)) || 0;
      const newAmount = Math.max(1, current + delta);
      return formatAmountInput(String(newAmount));
    });
  }, []);

  const handleAddFunds = useCallback(() => {
    const amount = Number(parseAmountInput(addFundsAmount)) || 0;
    if (amount < 10) {
      Alert.alert('Minimum Amount', 'Minimum deposit amount is $10');
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setWalletBalance(prev => prev + amount);
    setShowAddFundsModal(false);
    Alert.alert(
      'Funds Added!',
      `${formatCurrencyWithDecimals(amount)} has been added to your wallet.`
    );
  }, [addFundsAmount]);

  const handleToggleFavorite = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsFavorite(prev => !prev);
  }, []);

  const handleDocumentPress = useCallback((doc: PropertyDocument) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDocument(doc);
    setShowDocumentModal(true);
  }, []);

  const handleDownloadDocument = useCallback(async (docName: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsDownloading(true);
    setTimeout(() => {
      setIsDownloading(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Download Complete', `${docName} has been downloaded to your device.`);
    }, 800);
  }, []);

  const handleCopyTitleNumber = useCallback(async () => {
    if (titleData?.titleNumber) {
      await Clipboard.setStringAsync(titleData.titleNumber);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Copied', 'Title number copied to clipboard');
    }
  }, [titleData?.titleNumber]);

  const handleRequestAppraisal = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsRequestingAppraisal(true);
    setTimeout(() => {
      setIsRequestingAppraisal(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Request Submitted',
        'Your request for a new appraisal has been submitted. You will be notified when the updated report is available.',
        [{ text: 'OK' }]
      );
    }, 800);
  }, []);

  const handleViewTitleDetails = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowTitleModal(true);
  }, []);

  const handleShare = useCallback(async () => {
    if (!property) return;
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      
      const webLink = `https://ipx.app/property/${property.id}`;
      
      const shareMessage = `🏢 ${property.name}\n📍 ${property.location}, ${property.city}\n\n💰 Share Price: ${formatCurrencyWithDecimals(property.pricePerShare)}\n📈 Est. Yield: ${property.yield}%\n💵 Min. Investment: ${formatDollar(property.minInvestment)}\n\n🔗 Download IVXHOLDINGS and start investing in premium real estate!\n\n${webLink}`;
      
      const result = await Share.share(
        Platform.OS === 'ios'
          ? {
              message: shareMessage,
              url: webLink}
          : {
              message: shareMessage}
      );
      
      if (result.action === Share.sharedAction) {
        console.log('Property shared successfully:', property.id);
      }
    } catch (error) {
      console.log('Error sharing:', error);
      Alert.alert('Share Failed', 'Unable to share this property. Please try again.');
    }
  }, [property]);

  if (!property) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Property not found</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const getDocumentDetails = (doc: PropertyDocument) => {
    if (!property) return null;
    
    switch (doc.type) {
      case 'title':
        return {
          icon: Home,
          title: 'Property Title Deed',
          subtitle: 'Legal ownership documentation',
          details: [
            { label: 'Property Name', value: property.name },
            { label: 'Address', value: `${property.location}, ${property.city}` },
            { label: 'Country', value: property.country },
            { label: 'Title Number', value: titleData?.titleNumber || 'N/A' },
            { label: 'Registration Date', value: new Date(property.createdAt).toLocaleDateString() },
            { label: 'Title Status', value: 'Clear - No Encumbrances' },
            { label: 'Ownership Type', value: 'Fractional (Developed by LLC)' },
            { label: 'Total Shares', value: formatNumber(property.totalShares) },
          ],
          status: 'verified'};
      case 'appraisal':
        return {
          icon: BarChart3,
          title: 'Appraisal Report',
          subtitle: 'Independent property valuation',
          details: [
            { label: 'Appraised Value', value: formatCurrencyCompact(property.pricePerShare * property.totalShares) },
            { label: 'Price Per Share', value: formatCurrencyWithDecimals(property.pricePerShare) },
            { label: 'Appraisal Date', value: appraisalData ? new Date(appraisalData.lastAppraisalDate).toLocaleDateString() : 'N/A' },
            { label: 'Next Review', value: appraisalData ? new Date(appraisalData.nextAppraisalDate).toLocaleDateString() : 'N/A' },
            { label: 'Valuation Method', value: appraisalData?.appraisalMethod || 'N/A' },
            { label: 'Appraiser', value: appraisalData?.appraiser || 'N/A' },
            { label: 'Cap Rate', value: `${property.capRate}%` },
            { label: 'Confidence Score', value: `${appraisalData?.confidence || 0}%` },
          ],
          status: 'verified'};
      case 'insurance':
        return {
          icon: Shield,
          title: 'Insurance Certificate',
          subtitle: 'Property coverage details',
          details: [
            { label: 'Policy Number', value: `INS-${property.id.padStart(8, '0')}` },
            { label: 'Coverage Type', value: 'Comprehensive Property' },
            { label: 'Coverage Amount', value: formatCurrencyCompact(property.pricePerShare * property.totalShares * 1.2) },
            { label: 'Insurer', value: 'Lloyd\'s of London' },
            { label: 'Policy Start', value: new Date(property.createdAt).toLocaleDateString() },
            { label: 'Policy End', value: new Date(property.closingDate).toLocaleDateString() },
            { label: 'Deductible', value: '$25,000' },
            { label: 'Status', value: 'Active' },
          ],
          status: 'active'};
      default:
        return {
          icon: FileText,
          title: doc.name,
          subtitle: 'Property document',
          details: [
            { label: 'Document Type', value: doc.type },
            { label: 'Status', value: 'Available' },
          ],
          status: 'available'};
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      
      <ScrollView showsVerticalScrollIndicator={false} bounces={false} style={styles.mainScrollView}>
        <View style={styles.imageSection}>
          <ImageSlider images={propertyImages} height={320} />
          
          <View style={[styles.imageOverlayBar, { top: Math.max(insets.top, 54) + 8 }]}>
            <TouchableOpacity
              style={styles.overlayIconBtn}
              onPress={() => router.back()}
              activeOpacity={0.7}
            >
              <ArrowLeft size={20} color="#fff" />
            </TouchableOpacity>

            <View style={styles.overlayRightIcons}>
              <TouchableOpacity style={styles.overlayIconBtn} onPress={handleUploadImages} activeOpacity={0.7}>
                <Camera size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.overlayIconBtn} onPress={handleToggleFavorite} activeOpacity={0.7}>
                <Heart size={20} color={isFavorite ? Colors.error : '#fff'} fill={isFavorite ? Colors.error : 'transparent'} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.overlayIconBtn} onPress={handleShare} activeOpacity={0.7}>
                <Share2 size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.statusOverlay}>
            <View style={[styles.statusBadge, { backgroundColor: property.status === 'live' ? Colors.success : Colors.warning }]}>
              <Text style={styles.statusText}>{property.status.toUpperCase().replace('_', ' ')}</Text>
            </View>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.titleSectionContainer}>
            <Text style={styles.propertyName}>{property.name}</Text>
            <View style={styles.locationRow}>
              <MapPin size={16} color={Colors.textSecondary} />
              <Text style={styles.locationText}>{property.location}, {property.city}, {property.country}</Text>
            </View>
          </View>

          <View style={styles.priceSection}>
            <View style={styles.priceMain}>
              <Text style={styles.priceLabel}>Share Price</Text>
              <Text style={styles.priceValue}>{formatCurrencyWithDecimals(property.pricePerShare)}</Text>
              {marketData && (
                <View style={[styles.changeBadge, { backgroundColor: marketData.changePercent24h >= 0 ? Colors.success + '20' : Colors.error + '20' }]}>
                  <Text style={[styles.changeText, { color: marketData.changePercent24h >= 0 ? Colors.success : Colors.error }]}>
                    {marketData.changePercent24h >= 0 ? '+' : ''}{marketData.changePercent24h.toFixed(2)}%
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.minInvest}>
              <Text style={styles.minInvestLabel}>Min. Investment</Text>
              <Text style={styles.minInvestValue}>{formatDollar(property.minInvestment)}</Text>
            </View>
          </View>

          <View style={styles.kpiGrid}>
            <View style={styles.kpiCard}>
              <TrendingUp size={20} color={Colors.success} />
              <Text style={styles.kpiValue}>{property.yield}%</Text>
              <Text style={styles.kpiLabel}>Est. Yield</Text>
            </View>
            <View style={styles.kpiCard}>
              <Building2 size={20} color={Colors.primary} />
              <Text style={styles.kpiValue}>{property.capRate}%</Text>
              <Text style={styles.kpiLabel}>Cap Rate</Text>
            </View>
            <View style={styles.kpiCard}>
              <DollarSign size={20} color={Colors.info} />
              <Text style={styles.kpiValue}>{property.irr}%</Text>
              <Text style={styles.kpiLabel}>Target IRR</Text>
            </View>
            <View style={styles.kpiCard}>
              <Users size={20} color={Colors.warning} />
              <Text style={styles.kpiValue}>{property.occupancy}%</Text>
              <Text style={styles.kpiLabel}>Occupancy</Text>
            </View>
          </View>

          <View style={styles.progressSection}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressTitle}>Funding Progress</Text>
              <Text style={styles.progressPercent}>{fundedPercent}% Funded</Text>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${Math.min(fundedPercent, 100)}%` }]} />
            </View>
            <View style={styles.progressStats}>
              <View>
                <Text style={styles.progressStatValue}>{formatCurrencyCompact(property.currentRaise)}</Text>
                <Text style={styles.progressStatLabel}>Raised</Text>
              </View>
              <View style={styles.progressStatRight}>
                <Text style={styles.progressStatValue}>{formatCurrencyCompact(property.targetRaise)}</Text>
                <Text style={styles.progressStatLabel}>Target</Text>
              </View>
            </View>
          </View>

          <PriceChart
            data={property.priceHistory}
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
          />

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About This Property</Text>
            <Text style={styles.description}>{property.description}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Investment Highlights</Text>
            {property.highlights.map((highlight, index) => (
              <View key={index} style={styles.highlightItem}>
                <View style={styles.highlightDot} />
                <Text style={styles.highlightText}>{highlight}</Text>
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Risk Assessment</Text>
              <View style={[styles.riskBadge, { backgroundColor: getRiskColor() + '20' }]}>
                <Shield size={14} color={getRiskColor()} />
                <Text style={[styles.riskText, { color: getRiskColor() }]}>
                  {property.riskLevel.toUpperCase()} RISK
                </Text>
              </View>
            </View>
          </View>

          {property.documents.length > 0 && (
            <>
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Appraisal & Valuation</Text>
                <TouchableOpacity 
                  style={styles.viewAllButton}
                  onPress={openAppraisalModal}
                >
                  <Text style={styles.viewAllText}>View Details</Text>
                </TouchableOpacity>
              </View>
              {appraisalData && (
                <View style={styles.appraisalCard}>
                  <View style={styles.appraisalHeader}>
                    <View style={styles.appraisalIconContainer}>
                      <BarChart3 size={24} color={Colors.primary} />
                    </View>
                    <View style={styles.appraisalHeaderText}>
                      <Text style={styles.appraisalValue}>
                        {formatCurrencyCompact(appraisalData.currentValue)}
                      </Text>
                      <Text style={styles.appraisalLabel}>Current Valuation</Text>
                    </View>
                    <View style={styles.confidenceBadge}>
                      <Text style={styles.confidenceText}>{appraisalData.confidence}%</Text>
                      <Text style={styles.confidenceLabel}>Confidence</Text>
                    </View>
                  </View>
                  
                  <View style={styles.appraisalBreakdown}>
                    <View style={styles.breakdownItem}>
                      <Text style={styles.breakdownLabel}>Land Value</Text>
                      <Text style={styles.breakdownValue}>
                        {formatCurrencyCompact(appraisalData.landValue)}
                      </Text>
                    </View>
                    <View style={styles.breakdownDivider} />
                    <View style={styles.breakdownItem}>
                      <Text style={styles.breakdownLabel}>Building</Text>
                      <Text style={styles.breakdownValue}>
                        {formatCurrencyCompact(appraisalData.buildingValue)}
                      </Text>
                    </View>
                    <View style={styles.breakdownDivider} />
                    <View style={styles.breakdownItem}>
                      <Text style={styles.breakdownLabel}>Improvements</Text>
                      <Text style={styles.breakdownValue}>
                        {formatCurrencyCompact(appraisalData.improvementsValue)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.appraisalMeta}>
                    <View style={styles.metaItem}>
                      <Clock size={14} color={Colors.textTertiary} />
                      <Text style={styles.metaText}>
                        Last: {new Date(appraisalData.lastAppraisalDate).toLocaleDateString()}
                      </Text>
                    </View>
                    <View style={styles.marketComparison}>
                      <TrendingUp size={14} color={Colors.success} />
                      <Text style={styles.premiumText}>+{appraisalData.marketComparison.premium}% vs area avg</Text>
                    </View>
                  </View>
                </View>
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Property Title</Text>
                <TouchableOpacity 
                  style={styles.viewAllButton}
                  onPress={handleViewTitleDetails}
                >
                  <Text style={styles.viewAllText}>View Full</Text>
                </TouchableOpacity>
              </View>
              {titleData && (
                <View style={styles.titleCard}>
                  <View style={styles.titleHeader}>
                    <View style={styles.titleIconContainer}>
                      <Landmark size={24} color={Colors.primary} />
                    </View>
                    <View style={styles.titleHeaderText}>
                      <Text style={styles.titleNumber}>{titleData.titleNumber}</Text>
                      <Text style={styles.titleSubtext}>Legal Title Number</Text>
                    </View>
                    <TouchableOpacity 
                      style={styles.copyButton}
                      onPress={handleCopyTitleNumber}
                    >
                      <Copy size={16} color={Colors.primary} />
                    </TouchableOpacity>
                  </View>
                  
                  <View style={styles.titleDetails}>
                    <View style={styles.titleDetailRow}>
                      <Text style={styles.titleDetailLabel}>Status</Text>
                      <View style={styles.titleStatusBadge}>
                        <CheckCircle size={12} color={Colors.success} />
                        <Text style={styles.titleStatusText}>{titleData.titleStatus}</Text>
                      </View>
                    </View>
                    <View style={styles.titleDetailRow}>
                      <Text style={styles.titleDetailLabel}>Encumbrances</Text>
                      <Text style={styles.titleDetailValue}>{titleData.encumbrances}</Text>
                    </View>
                    <View style={styles.titleDetailRow}>
                      <Text style={styles.titleDetailLabel}>Zoning</Text>
                      <Text style={styles.titleDetailValue}>{titleData.zoning}</Text>
                    </View>
                  </View>

                  <View style={styles.verificationInfo}>
                    <Shield size={14} color={Colors.info} />
                    <Text style={styles.verificationText}>
                      Verified by {titleData.verification.verifiedBy}
                    </Text>
                  </View>
                </View>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Documents</Text>
              {property.documents.map(doc => (
                <TouchableOpacity 
                  key={doc.id} 
                  style={styles.documentItem}
                  onPress={() => handleDocumentPress(doc)}
                >
                  <View style={styles.documentIconContainer}>
                    {doc.type === 'title' && <Home size={18} color={Colors.primary} />}
                    {doc.type === 'appraisal' && <BarChart3 size={18} color={Colors.info} />}
                    {doc.type === 'insurance' && <Shield size={18} color={Colors.success} />}
                    {!['title', 'appraisal', 'insurance'].includes(doc.type) && <FileText size={18} color={Colors.primary} />}
                  </View>
                  <View style={styles.documentInfo}>
                    <Text style={styles.documentName}>{doc.name}</Text>
                    <Text style={styles.documentType}>{doc.type.charAt(0).toUpperCase() + doc.type.slice(1)}</Text>
                  </View>
                  <View style={styles.documentActions}>
                    <View style={styles.documentStatusIcon}>
                      <CheckCircle size={16} color={Colors.success} />
                    </View>
                    <ChevronRight size={18} color={Colors.textTertiary} />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
            </>
          )}

          {investmentProjection ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Investment Timeline & Exit Math</Text>
              <View style={styles.projectionCard}>
                <View style={styles.projectionGrid}>
                  <View style={styles.projectionItem}>
                    <Text style={styles.projectionLabel}>Est. sale price</Text>
                    <Text style={styles.projectionValue}>{formatCurrencyCompact(investmentProjection.estimatedSalePrice)}</Text>
                  </View>
                  <View style={styles.projectionItem}>
                    <Text style={styles.projectionLabel}>Min. ownership</Text>
                    <Text style={styles.projectionValue}>{investmentProjection.minimumOwnershipPercent.toFixed(3)}%</Text>
                  </View>
                  <View style={styles.projectionItem}>
                    <Text style={styles.projectionLabel}>Your current ownership</Text>
                    <Text style={styles.projectionValue}>{investmentProjection.baseAssetValue > 0 ? `${((totalCost / investmentProjection.baseAssetValue) * 100).toFixed(3)}%` : '0.000%'}</Text>
                  </View>
                  <View style={styles.projectionItem}>
                    <Text style={styles.projectionLabel}>Est. payout at current amount</Text>
                    <Text style={[styles.projectionValue, { color: Colors.success }]}>{formatCurrencyCompact(totalCost + (totalCost * ((property.irr || property.yield) / 100)))}</Text>
                  </View>
                </View>
                <View style={styles.projectionDivider} />
                {timelineMilestones.map((item, index) => (
                  <View key={item.id} style={[styles.timelineMilestoneRow, index < timelineMilestones.length - 1 && styles.timelineMilestoneBorder]}>
                    <View style={styles.timelineMilestoneDot} />
                    <View style={styles.timelineMilestoneCopy}>
                      <Text style={styles.timelineMilestoneTitle}>{item.title}</Text>
                      <Text style={styles.timelineMilestoneText}>{item.detail}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {property.distributions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recent Distributions</Text>
              {property.distributions.slice(0, 3).map(dist => (
                <View key={dist.id} style={styles.distributionItem}>
                  <View style={styles.distributionLeft}>
                    <Calendar size={16} color={Colors.textSecondary} />
                    <Text style={styles.distributionDate}>
                      {new Date(dist.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </Text>
                  </View>
                  <Text style={styles.distributionAmount}>{formatCurrencyWithDecimals(dist.amount)}/share</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.bottomPadding} />
        </View>
      </ScrollView>

      <View style={[styles.investBar, { paddingBottom: Math.max(insets.bottom, 20) + 8 }]}>
        <View style={styles.investBarContent}>
          <View>
            <Text style={styles.investBarLabel}>Share Price</Text>
            <Text style={styles.investBarPrice}>{formatCurrencyWithDecimals(property.pricePerShare)}</Text>
          </View>
          <TouchableOpacity
            style={styles.investButton}
            onPress={handleInvest}
          >
            <Text style={styles.investButtonText}>Buy Shares</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={showInvestModal} animationType="slide" transparent>
        <KeyboardAvoidingView 
          style={styles.modalOverlay} 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Invest in {property.name}</Text>
                  <TouchableOpacity onPress={closeInvestModal}>
                    <X size={24} color={Colors.text} />
                  </TouchableOpacity>
                </View>

                <ScrollView 
                  showsVerticalScrollIndicator={false} 
                  keyboardShouldPersistTaps="handled"
                  bounces={false}
                >
                  <View style={styles.amountSection}>
                    <Text style={styles.amountLabel}>Investment Amount (USD)</Text>
                    <View style={styles.amountInputRow}>
                      <TouchableOpacity style={styles.amountButton} onPress={() => adjustAmount(-100)}>
                        <Minus size={20} color={Colors.text} />
                      </TouchableOpacity>
                      <View style={styles.amountInputWrapper}>
                        <View style={styles.amountDisplayContainer}>
                          <Text style={styles.currencySymbol}>$</Text>
                          <TextInput
                            style={styles.amountTextInput}
                            value={investAmount}
                            onChangeText={(value) => setInvestAmount(formatAmountInput(parseAmountInput(value)))}
                            keyboardType="numeric"
                            placeholder="0"
                            placeholderTextColor={Colors.textTertiary}
                            returnKeyType="done"
                            onSubmitEditing={Keyboard.dismiss}
                          />
                        </View>
                      </View>
                      <TouchableOpacity style={styles.amountButton} onPress={() => adjustAmount(100)}>
                        <Plus size={20} color={Colors.text} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.quickAmounts}>
                    {[100, 500, 1000, 5000].map(amount => (
                      <TouchableOpacity
                        key={amount}
                        style={[styles.quickAmountButton, Number(parseAmountInput(investAmount)) === amount && styles.quickAmountButtonActive]}
                        onPress={() => { Keyboard.dismiss(); setInvestAmount(formatAmountInput(String(amount))); }}
                      >
                        <Text style={[styles.quickAmountText, Number(parseAmountInput(investAmount)) === amount && styles.quickAmountTextActive]}>
                          {formatDollar(amount)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={styles.summarySection}>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Shares</Text>
                      <Text style={styles.summaryValue}>{shares}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Price per share</Text>
                      <Text style={styles.summaryValue}>{formatCurrencyWithDecimals(property.pricePerShare)}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Platform fee (1%)</Text>
                      <Text style={styles.summaryValue}>{formatCurrencyWithDecimals(fees)}</Text>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabelBold}>Total</Text>
                      <Text style={styles.summaryValueBold}>{formatCurrencyWithDecimals(totalCost + fees)}</Text>
                    </View>
                  </View>

                  <View style={styles.walletInfoRow}>
                    <View style={styles.walletInfoLeft}>
                      <Info size={16} color={Colors.info} />
                      <Text style={styles.walletInfoText}>
                        Wallet balance: {formatDollar(walletBalance)}
                      </Text>
                    </View>
                    <TouchableOpacity 
                      style={styles.addFundsButton}
                      onPress={() => setShowAddFundsModal(true)}
                    >
                      <Plus size={14} color={Colors.black} />
                      <Text style={styles.addFundsButtonText}>Add Funds</Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity style={styles.confirmButton} onPress={handleConfirmInvest}>
                    <Text style={styles.confirmButtonText}>Confirm Investment</Text>
                  </TouchableOpacity>
                  <View style={{ height: 16 }} />
                </ScrollView>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showAddFundsModal} animationType="slide" transparent>
        <KeyboardAvoidingView 
          style={styles.modalOverlay} 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Add Funds</Text>
                  <TouchableOpacity onPress={closeAddFundsModal}>
                    <X size={24} color={Colors.text} />
                  </TouchableOpacity>
                </View>

                <ScrollView 
                  showsVerticalScrollIndicator={false} 
                  keyboardShouldPersistTaps="handled"
                  bounces={false}
                >
                  <View style={styles.currentBalanceSection}>
                    <Text style={styles.currentBalanceLabel}>Current Balance</Text>
                    <Text style={styles.currentBalanceValue}>{formatDollar(walletBalance)}</Text>
                  </View>

                  <View style={styles.amountSection}>
                    <Text style={styles.amountLabel}>Amount to Add (USD)</Text>
                    <View style={styles.amountInputRow}>
                      <TouchableOpacity 
                        style={styles.amountButton} 
                        onPress={() => {
                          const current = Number(parseAmountInput(addFundsAmount)) || 0;
                          setAddFundsAmount(formatAmountInput(String(Math.max(10, current - 100))));
                        }}
                      >
                        <Minus size={20} color={Colors.text} />
                      </TouchableOpacity>
                      <View style={styles.amountInputWrapper}>
                        <View style={styles.amountDisplayContainer}>
                          <Text style={styles.currencySymbol}>$</Text>
                          <TextInput
                            style={styles.amountTextInput}
                            value={addFundsAmount}
                            onChangeText={(value) => setAddFundsAmount(formatAmountInput(parseAmountInput(value)))}
                            keyboardType="numeric"
                            placeholder="0"
                            placeholderTextColor={Colors.textTertiary}
                            returnKeyType="done"
                            onSubmitEditing={Keyboard.dismiss}
                          />
                        </View>
                      </View>
                      <TouchableOpacity 
                        style={styles.amountButton} 
                        onPress={() => {
                          const current = Number(parseAmountInput(addFundsAmount)) || 0;
                          setAddFundsAmount(formatAmountInput(String(current + 100)));
                        }}
                      >
                        <Plus size={20} color={Colors.text} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.quickAmounts}>
                    {[100, 500, 1000, 5000].map(amount => (
                      <TouchableOpacity
                        key={amount}
                        style={[styles.quickAmountButton, Number(parseAmountInput(addFundsAmount)) === amount && styles.quickAmountButtonActive]}
                        onPress={() => { Keyboard.dismiss(); setAddFundsAmount(formatAmountInput(String(amount))); }}
                      >
                        <Text style={[styles.quickAmountText, Number(parseAmountInput(addFundsAmount)) === amount && styles.quickAmountTextActive]}>
                          {formatDollar(amount)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={styles.paymentMethodsSection}>
                    <Text style={styles.paymentMethodsTitle}>Payment Method</Text>
                    <TouchableOpacity style={styles.paymentMethodItem}>
                      <View style={styles.paymentMethodIcon}>
                        <DollarSign size={18} color={Colors.primary} />
                      </View>
                      <View style={styles.paymentMethodInfo}>
                        <Text style={styles.paymentMethodName}>Bank Transfer</Text>
                        <Text style={styles.paymentMethodDesc}>ACH • 1-3 business days</Text>
                      </View>
                      <View style={styles.paymentMethodSelected} />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.paymentMethodItem, styles.paymentMethodItemDisabled]}>
                      <View style={[styles.paymentMethodIcon, { backgroundColor: Colors.backgroundTertiary }]}>
                        <Building2 size={18} color={Colors.textTertiary} />
                      </View>
                      <View style={styles.paymentMethodInfo}>
                        <Text style={[styles.paymentMethodName, { color: Colors.textTertiary }]}>Wire Transfer</Text>
                        <Text style={styles.paymentMethodDesc}>Same day • Min $10,000</Text>
                      </View>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.addFundsSummary}>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Amount</Text>
                      <Text style={styles.summaryValue}>{formatDollar(Number(parseAmountInput(addFundsAmount)) || 0)}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Fee</Text>
                      <Text style={[styles.summaryValue, { color: Colors.success }]}>$0.00</Text>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabelBold}>New Balance</Text>
                      <Text style={styles.summaryValueBold}>
                        {formatDollar(walletBalance + (Number(parseAmountInput(addFundsAmount)) || 0))}
                      </Text>
                    </View>
                  </View>

                  <TouchableOpacity style={styles.confirmButton} onPress={handleAddFunds}>
                    <Text style={styles.confirmButtonText}>Add {formatDollar(Number(parseAmountInput(addFundsAmount)) || 0)}</Text>
                  </TouchableOpacity>
                  <View style={{ height: 16 }} />
                </ScrollView>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showDocumentModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.documentModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedDocument ? getDocumentDetails(selectedDocument)?.title : 'Document'}
              </Text>
              <TouchableOpacity onPress={closeDocumentModal}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {selectedDocument && getDocumentDetails(selectedDocument) && (
              <>
                <View style={styles.documentModalHeader}>
                  <View style={styles.documentModalIconContainer}>
                    {React.createElement(getDocumentDetails(selectedDocument)!.icon, {
                      size: 32,
                      color: Colors.primary})}
                  </View>
                  <View style={styles.documentModalHeaderText}>
                    <Text style={styles.documentModalSubtitle}>
                      {getDocumentDetails(selectedDocument)!.subtitle}
                    </Text>
                    <View style={styles.verifiedBadge}>
                      <CheckCircle size={14} color={Colors.success} />
                      <Text style={styles.verifiedText}>Verified</Text>
                    </View>
                  </View>
                </View>

                <ScrollView style={styles.documentDetailsScroll} showsVerticalScrollIndicator={false}>
                  {getDocumentDetails(selectedDocument)!.details.map((detail, index) => (
                    <View key={index} style={styles.documentDetailRow}>
                      <Text style={styles.documentDetailLabel}>{detail.label}</Text>
                      <Text style={styles.documentDetailValue}>{detail.value}</Text>
                    </View>
                  ))}
                </ScrollView>

                <View style={styles.documentActionsContainer}>
                  <TouchableOpacity 
                    style={styles.documentActionButton}
                    onPress={() => handleDownloadDocument(selectedDocument?.name || 'Document')}
                    disabled={isDownloading}
                  >
                    {isDownloading ? (
                      <RefreshCw size={18} color={Colors.black} />
                    ) : (
                      <Download size={18} color={Colors.black} />
                    )}
                    <Text style={styles.documentActionText}>
                      {isDownloading ? 'Downloading...' : 'Download PDF'}
                    </Text>
                  </TouchableOpacity>
                  <View style={styles.documentSecondaryActions}>
                    <TouchableOpacity 
                      style={styles.documentSecondaryButton}
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        Alert.alert('Preview', 'Document preview will open in a new window.');
                      }}
                    >
                      <Eye size={16} color={Colors.primary} />
                      <Text style={styles.documentSecondaryText}>Preview</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.documentSecondaryButton}
                      onPress={async () => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        try {
                          await Share.share({
                            message: `${selectedDocument?.name} - ${property?.name}\n\nView on IVXHOLDINGS: https://ipx.app/property/${property?.id}`});
                        } catch (error) {
                          console.log('Error sharing document:', error);
                        }
                      }}
                    >
                      <Share2 size={16} color={Colors.primary} />
                      <Text style={styles.documentSecondaryText}>Share</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={showAppraisalModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.appraisalModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Property Appraisal</Text>
              <TouchableOpacity onPress={closeAppraisalModal}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {appraisalData && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.appraisalModalHeader}>
                  <View style={styles.appraisalModalValue}>
                    <Text style={styles.appraisalModalValueLabel}>Total Appraised Value</Text>
                    <Text style={styles.appraisalModalValueAmount}>
                      {formatCurrencyCompact(appraisalData.currentValue)}
                    </Text>
                  </View>
                  <View style={styles.appraisalConfidenceCircle}>
                    <Text style={styles.appraisalConfidenceValue}>{appraisalData.confidence}%</Text>
                    <Text style={styles.appraisalConfidenceLabel}>Confidence</Text>
                  </View>
                </View>

                <View style={styles.appraisalSection}>
                  <Text style={styles.appraisalSectionTitle}>Value Breakdown</Text>
                  <View style={styles.valueBreakdownCard}>
                    <View style={styles.valueBreakdownItem}>
                      <View style={styles.valueBreakdownHeader}>
                        <View style={[styles.valueBreakdownDot, { backgroundColor: Colors.primary }]} />
                        <Text style={styles.valueBreakdownLabel}>Land Value</Text>
                      </View>
                      <Text style={styles.valueBreakdownAmount}>
                        {formatCurrencyCompact(appraisalData.landValue)}
                      </Text>
                      <Text style={styles.valueBreakdownPercent}>35%</Text>
                    </View>
                    <View style={styles.valueBreakdownItem}>
                      <View style={styles.valueBreakdownHeader}>
                        <View style={[styles.valueBreakdownDot, { backgroundColor: Colors.info }]} />
                        <Text style={styles.valueBreakdownLabel}>Building Value</Text>
                      </View>
                      <Text style={styles.valueBreakdownAmount}>
                        {formatCurrencyCompact(appraisalData.buildingValue)}
                      </Text>
                      <Text style={styles.valueBreakdownPercent}>55%</Text>
                    </View>
                    <View style={styles.valueBreakdownItem}>
                      <View style={styles.valueBreakdownHeader}>
                        <View style={[styles.valueBreakdownDot, { backgroundColor: Colors.success }]} />
                        <Text style={styles.valueBreakdownLabel}>Improvements</Text>
                      </View>
                      <Text style={styles.valueBreakdownAmount}>
                        {formatCurrencyCompact(appraisalData.improvementsValue)}
                      </Text>
                      <Text style={styles.valueBreakdownPercent}>10%</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.appraisalSection}>
                  <Text style={styles.appraisalSectionTitle}>Market Comparison</Text>
                  <View style={styles.marketComparisonCard}>
                    <View style={styles.marketComparisonRow}>
                      <Text style={styles.marketComparisonLabel}>Area Average</Text>
                      <Text style={styles.marketComparisonValue}>
                        {formatCurrencyCompact(appraisalData.marketComparison.areaAverage)}
                      </Text>
                    </View>
                    <View style={styles.marketComparisonRow}>
                      <Text style={styles.marketComparisonLabel}>Property Premium</Text>
                      <View style={styles.premiumBadge}>
                        <TrendingUp size={14} color={Colors.success} />
                        <Text style={styles.premiumBadgeText}>+{appraisalData.marketComparison.premium}%</Text>
                      </View>
                    </View>
                  </View>
                </View>

                <View style={styles.appraisalSection}>
                  <Text style={styles.appraisalSectionTitle}>Valuation History</Text>
                  <View style={styles.historyCard}>
                    {appraisalData.valuationHistory.map((item, index) => (
                      <View key={index} style={styles.historyItem}>
                        <Text style={styles.historyDate}>{item.date}</Text>
                        <View style={styles.historyBar}>
                          <View 
                            style={[
                              styles.historyBarFill, 
                              { width: `${(item.value / appraisalData.currentValue) * 100}%` }
                            ]} 
                          />
                        </View>
                        <Text style={styles.historyValue}>{formatCurrencyCompact(item.value)}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                <View style={styles.appraisalSection}>
                  <Text style={styles.appraisalSectionTitle}>Appraisal Details</Text>
                  <View style={styles.appraisalDetailsCard}>
                    <View style={styles.appraisalDetailRow}>
                      <Text style={styles.appraisalDetailLabel}>Appraiser</Text>
                      <Text style={styles.appraisalDetailValue}>{appraisalData.appraiser}</Text>
                    </View>
                    <View style={styles.appraisalDetailRow}>
                      <Text style={styles.appraisalDetailLabel}>Valuation Method</Text>
                      <Text style={styles.appraisalDetailValue}>{appraisalData.appraisalMethod}</Text>
                    </View>
                    <View style={styles.appraisalDetailRow}>
                      <Text style={styles.appraisalDetailLabel}>Last Appraisal</Text>
                      <Text style={styles.appraisalDetailValue}>
                        {new Date(appraisalData.lastAppraisalDate).toLocaleDateString()}
                      </Text>
                    </View>
                    <View style={styles.appraisalDetailRow}>
                      <Text style={styles.appraisalDetailLabel}>Next Review</Text>
                      <Text style={styles.appraisalDetailValue}>
                        {new Date(appraisalData.nextAppraisalDate).toLocaleDateString()}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.appraisalSection}>
                  <Text style={styles.appraisalSectionTitle}>Comparable Properties</Text>
                  <View style={styles.comparablesCard}>
                    {[
                      { name: 'Marina Tower', distance: '0.3 mi', value: appraisalData.currentValue * 0.95, sqft: '$485/sqft' },
                      { name: 'Harbour Plaza', distance: '0.5 mi', value: appraisalData.currentValue * 1.02, sqft: '$510/sqft' },
                      { name: 'Waterfront One', distance: '0.8 mi', value: appraisalData.currentValue * 0.88, sqft: '$465/sqft' },
                    ].map((comp, index) => (
                      <View key={index} style={styles.comparableItem}>
                        <View style={styles.comparableInfo}>
                          <Text style={styles.comparableName}>{comp.name}</Text>
                          <Text style={styles.comparableDistance}>{comp.distance} away</Text>
                        </View>
                        <View style={styles.comparableValues}>
                          <Text style={styles.comparableValue}>{formatCurrencyCompact(comp.value)}</Text>
                          <Text style={styles.comparableSqft}>{comp.sqft}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>

                <View style={styles.appraisalDisclaimer}>
                  <Award size={16} color={Colors.warning} />
                  <Text style={styles.appraisalDisclaimerText}>
                    This appraisal is conducted by licensed professionals and updated annually.
                  </Text>
                </View>

                <View style={styles.appraisalActionsContainer}>
                  <TouchableOpacity 
                    style={styles.appraisalDownloadButton}
                    onPress={() => handleDownloadDocument('Appraisal Report')}
                    disabled={isDownloading}
                  >
                    <Download size={18} color={Colors.black} />
                    <Text style={styles.appraisalDownloadText}>
                      {isDownloading ? 'Downloading...' : 'Download Full Report'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.requestAppraisalButton}
                    onPress={handleRequestAppraisal}
                    disabled={isRequestingAppraisal}
                  >
                    <RefreshCw size={18} color={Colors.primary} />
                    <Text style={styles.requestAppraisalText}>
                      {isRequestingAppraisal ? 'Submitting...' : 'Request New Appraisal'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={showTitleModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.titleModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Property Title</Text>
              <TouchableOpacity onPress={closeTitleModal}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {titleData && property && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.titleModalHeader}>
                  <View style={styles.titleModalIconContainer}>
                    <Landmark size={32} color={Colors.primary} />
                  </View>
                  <View style={styles.titleModalHeaderText}>
                    <Text style={styles.titleModalNumber}>{titleData.titleNumber}</Text>
                    <View style={styles.titleModalStatusBadge}>
                      <CheckCircle size={14} color={Colors.success} />
                      <Text style={styles.titleModalStatusText}>Title Verified</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.titleSectionContainer}>
                  <Text style={styles.titleSectionTitle}>Property Information</Text>
                  <View style={styles.titleInfoCard}>
                    <View style={styles.titleInfoRow}>
                      <Text style={styles.titleInfoLabel}>Property Name</Text>
                      <Text style={styles.titleInfoValue}>{property.name}</Text>
                    </View>
                    <View style={styles.titleInfoRow}>
                      <Text style={styles.titleInfoLabel}>Address</Text>
                      <Text style={styles.titleInfoValue}>{property.location}, {property.city}</Text>
                    </View>
                    <View style={styles.titleInfoRow}>
                      <Text style={styles.titleInfoLabel}>Country</Text>
                      <Text style={styles.titleInfoValue}>{property.country}</Text>
                    </View>
                    <View style={styles.titleInfoRow}>
                      <Text style={styles.titleInfoLabel}>Parcel ID</Text>
                      <Text style={styles.titleInfoValue}>{titleData.parcelId}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.titleSectionContainer}>
                  <Text style={styles.titleSectionTitle}>Legal Description</Text>
                  <View style={styles.legalDescriptionCard}>
                    <Scale size={18} color={Colors.info} />
                    <Text style={styles.legalDescriptionText}>{titleData.legalDescription}</Text>
                  </View>
                </View>

                <View style={styles.titleSectionContainer}>
                  <Text style={styles.titleSectionTitle}>Title Status</Text>
                  <View style={styles.titleStatusCard}>
                    <View style={styles.titleStatusRow}>
                      <Text style={styles.titleStatusLabel}>Status</Text>
                      <View style={styles.titleClearBadge}>
                        <CheckCircle size={12} color={Colors.success} />
                        <Text style={styles.titleClearText}>{titleData.titleStatus}</Text>
                      </View>
                    </View>
                    <View style={styles.titleStatusRow}>
                      <Text style={styles.titleStatusLabel}>Encumbrances</Text>
                      <Text style={styles.titleStatusValue}>{titleData.encumbrances}</Text>
                    </View>
                    <View style={styles.titleStatusRow}>
                      <Text style={styles.titleStatusLabel}>Zoning</Text>
                      <Text style={styles.titleStatusValue}>{titleData.zoning}</Text>
                    </View>
                    <View style={styles.titleStatusRow}>
                      <Text style={styles.titleStatusLabel}>Registration Date</Text>
                      <Text style={styles.titleStatusValue}>
                        {new Date(titleData.registrationDate).toLocaleDateString()}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.titleSectionContainer}>
                  <Text style={styles.titleSectionTitle}>Ownership History</Text>
                  <View style={styles.ownershipHistoryCard}>
                    {titleData.ownershipHistory.map((item, index) => (
                      <View key={index} style={styles.ownershipHistoryItem}>
                        <View style={styles.ownershipTimeline}>
                          <View style={styles.ownershipTimelineDot} />
                          {index < titleData.ownershipHistory.length - 1 && (
                            <View style={styles.ownershipTimelineLine} />
                          )}
                        </View>
                        <View style={styles.ownershipContent}>
                          <Text style={styles.ownershipDate}>
                            {new Date(item.date).toLocaleDateString()}
                          </Text>
                          <Text style={styles.ownershipOwner}>{item.owner}</Text>
                          <View style={styles.ownershipTypeBadge}>
                            <Text style={styles.ownershipTypeText}>{item.type}</Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>

                <View style={styles.titleSectionContainer}>
                  <Text style={styles.titleSectionTitle}>Verification</Text>
                  <View style={styles.verificationCard}>
                    <View style={styles.verificationHeader}>
                      <Shield size={20} color={Colors.success} />
                      <Text style={styles.verificationTitle}>Title Insurance Verified</Text>
                    </View>
                    <View style={styles.verificationDetails}>
                      <View style={styles.verificationRow}>
                        <Text style={styles.verificationLabel}>Verified By</Text>
                        <Text style={styles.verificationValue}>{titleData.verification.verifiedBy}</Text>
                      </View>
                      <View style={styles.verificationRow}>
                        <Text style={styles.verificationLabel}>Verification Date</Text>
                        <Text style={styles.verificationValue}>
                          {new Date(titleData.verification.verifiedDate).toLocaleDateString()}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>

                <View style={styles.titleActionsContainer}>
                  <TouchableOpacity 
                    style={styles.titleDownloadButton}
                    onPress={() => handleDownloadDocument('Property Title Deed')}
                    disabled={isDownloading}
                  >
                    <Download size={18} color={Colors.black} />
                    <Text style={styles.titleDownloadText}>
                      {isDownloading ? 'Downloading...' : 'Download Title Deed'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.titleShareButton}
                    onPress={async () => {
                      try {
                        await Share.share({
                          message: `Property Title: ${titleData.titleNumber}\n${property.name}\n${property.location}, ${property.city}\n\nView on IVXHOLDINGS: https://ipx.app/property/${property.id}`});
                      } catch (error) {
                        console.log('Error sharing:', error);
                      }
                    }}
                  >
                    <ExternalLink size={18} color={Colors.primary} />
                    <Text style={styles.titleShareText}>Share Title Info</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  mainScrollView: { backgroundColor: Colors.background },
  errorContainer: { gap: 8 },
  errorText: { color: Colors.textSecondary, fontSize: 13 },
  backButton: { padding: 8 },
  backButtonText: { color: Colors.text, fontWeight: '600' as const, fontSize: 15 },
  imageSection: { marginBottom: 16, position: 'relative' as const },
  imageOverlayBar: { position: 'absolute' as const, left: 16, right: 16, zIndex: 20, flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  overlayIconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center' as const, justifyContent: 'center' as const },
  overlayRightIcons: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  statusOverlay: { position: 'absolute', bottom: 56, left: 16 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  statusText: { color: Colors.white, fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.5 },
  content: { flex: 1, paddingHorizontal: 20 },
  titleSection: { marginBottom: 16 },
  propertyName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locationText: { color: Colors.textSecondary, fontSize: 13 },
  priceSection: { marginBottom: 16 },
  priceMain: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  priceLabel: { color: Colors.textSecondary, fontSize: 13 },
  priceValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  changeBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  changeText: { color: Colors.textSecondary, fontSize: 13 },
  minInvest: { gap: 2 },
  minInvestLabel: { color: Colors.textSecondary, fontSize: 13 },
  minInvestValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpiCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  kpiValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  kpiLabel: { color: Colors.textSecondary, fontSize: 13 },
  progressSection: { marginBottom: 16 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  progressTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  progressPercent: { color: Colors.primary, fontSize: 14, fontWeight: '700' as const },
  progressBar: { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceBorder },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  progressStats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  progressStatRight: { alignItems: 'flex-end' },
  progressStatValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  progressStatLabel: { color: Colors.textSecondary, fontSize: 13 },
  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  description: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  highlightItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  highlightDot: { width: 8, height: 8, borderRadius: 4 },
  highlightText: { color: Colors.textSecondary, fontSize: 13 },
  riskBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  riskText: { color: Colors.textSecondary, fontSize: 13 },
  documentItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  documentName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  projectionCard: { backgroundColor: Colors.surface, borderRadius: 18, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: 16 },
  projectionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  projectionItem: { width: '47%', backgroundColor: Colors.backgroundSecondary, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12 },
  projectionLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700' as const, textTransform: 'uppercase' as const, marginBottom: 6 },
  projectionValue: { color: Colors.text, fontSize: 14, fontWeight: '700' as const, lineHeight: 18 },
  projectionDivider: { height: 1, backgroundColor: Colors.surfaceBorder, marginBottom: 8 },
  timelineMilestoneRow: { flexDirection: 'row', gap: 12, paddingVertical: 12 },
  timelineMilestoneBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  timelineMilestoneDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary, marginTop: 5 },
  timelineMilestoneCopy: { flex: 1 },
  timelineMilestoneTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const, marginBottom: 4 },
  timelineMilestoneText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  distributionItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  distributionLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  distributionDate: { color: Colors.textTertiary, fontSize: 12 },
  distributionAmount: { color: Colors.success, fontSize: 14, fontWeight: '600' as const },
  bottomPadding: { height: 180 },
  investBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#1A1A1A', borderTopWidth: 1, borderTopColor: '#2A2A2A', paddingHorizontal: 20, paddingTop: 12 },
  investBarContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  investBarLabel: { color: Colors.textSecondary, fontSize: 12 },
  investBarPrice: { color: Colors.text, fontSize: 18, fontWeight: '700' as const },
  investButton: { paddingVertical: 14, paddingHorizontal: 32, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary },
  investButtonDisabled: { opacity: 0.4 },
  investButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modalContent: { backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  amountSection: { marginBottom: 16 },
  amountLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginBottom: 8 },
  amountInput: { flex: 1, color: Colors.text, fontSize: 24, fontWeight: '700' as const, paddingVertical: 14 },
  amountInputRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  amountButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center' },
  amountInputWrapper: { flex: 1, color: Colors.text, fontSize: 24, fontWeight: '700' as const, paddingVertical: 14 },
  amountDisplayContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: 14 },
  currencySymbol: { color: Colors.textSecondary, fontSize: 20, fontWeight: '600' as const, marginRight: 4 },
  amountTextInput: { flex: 1, color: Colors.text, fontSize: 24, fontWeight: '700' as const, paddingVertical: 14 },
  quickAmounts: { flexDirection: 'row', gap: 8, marginTop: 8 },
  quickAmountButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center' },
  quickAmountButtonActive: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center' },
  quickAmountText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
  quickAmountTextActive: { color: Colors.black },
  summarySection: { marginBottom: 16 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryLabel: { color: Colors.textSecondary, fontSize: 13 },
  summaryValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  summaryDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder },
  summaryLabelBold: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  summaryValueBold: { color: Colors.text, fontSize: 16, fontWeight: '800' as const },
  walletInfoRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 16 },
  walletInfo: { flex: 1 },
  walletInfoLeft: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, flex: 1 },
  addFundsButton: { flexDirection: 'row' as const, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' as const, backgroundColor: Colors.primary, gap: 4 },
  addFundsButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 13 },
  walletInfoText: { color: Colors.textSecondary, fontSize: 13 },
  confirmButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center' as const, marginTop: 8 },
  confirmButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  currentBalanceSection: { marginBottom: 16 },
  currentBalanceLabel: { color: Colors.textSecondary, fontSize: 13 },
  currentBalanceValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  paymentMethodsSection: { marginBottom: 16 },
  paymentMethodsTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  paymentMethodItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  paymentMethodItemDisabled: { opacity: 0.4 },
  paymentMethodIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  paymentMethodInfo: { flex: 1 },
  paymentMethodName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  paymentMethodDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  paymentMethodSelected: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  addFundsSummary: { marginTop: 12, gap: 8 },
  viewAllButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  viewAllText: { color: Colors.textSecondary, fontSize: 13 },
  appraisalCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  appraisalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  appraisalIconContainer: { gap: 8 },
  appraisalHeaderText: { flex: 1, gap: 2 },
  appraisalValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  appraisalLabel: { color: Colors.textSecondary, fontSize: 13 },
  confidenceBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  confidenceText: { color: Colors.textSecondary, fontSize: 13 },
  confidenceLabel: { color: Colors.textSecondary, fontSize: 13 },
  appraisalBreakdown: { gap: 8, marginTop: 8 },
  breakdownItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  breakdownLabel: { color: Colors.textSecondary, fontSize: 13 },
  breakdownValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  breakdownDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder },
  appraisalMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaItem: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  metaText: { color: Colors.textSecondary, fontSize: 13 },
  marketComparison: { gap: 8, marginTop: 8 },
  premiumText: { color: Colors.textSecondary, fontSize: 13 },
  documentIconContainer: { gap: 8 },
  documentInfo: { flex: 1 },
  documentType: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  documentStatus: { color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  documentModalContent: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, maxHeight: '80%' },
  documentModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  documentModalIconContainer: { width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  documentModalHeaderText: { flex: 1, gap: 4 },
  documentModalSubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  verifiedBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  verifiedText: { color: Colors.textSecondary, fontSize: 13 },
  documentDetailsScroll: { gap: 8 },
  documentDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  documentDetailLabel: { color: Colors.textSecondary, fontSize: 13 },
  documentDetailValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  documentActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  documentStatusIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  documentActionsContainer: { gap: 8 },
  documentActionButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  documentActionText: { color: '#000000', fontSize: 13, fontWeight: '600' as const },
  documentSecondaryActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  documentSecondaryButton: { backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  documentSecondaryText: { color: Colors.textSecondary, fontSize: 13 },
  appraisalModalContent: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, maxHeight: '85%' },
  appraisalModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  appraisalModalValue: { flex: 1, gap: 4 },
  appraisalModalValueLabel: { color: Colors.textSecondary, fontSize: 13 },
  appraisalModalValueAmount: { color: Colors.text, fontSize: 28, fontWeight: '800' as const, marginTop: 4 },
  appraisalConfidenceCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  appraisalConfidenceValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  appraisalConfidenceLabel: { color: Colors.textSecondary, fontSize: 13 },
  appraisalSection: { marginBottom: 16 },
  appraisalSectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  valueBreakdownCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  valueBreakdownItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  valueBreakdownHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  valueBreakdownDot: { width: 8, height: 8, borderRadius: 4 },
  valueBreakdownLabel: { color: Colors.textSecondary, fontSize: 13 },
  valueBreakdownAmount: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  valueBreakdownPercent: { color: Colors.primary, fontSize: 14, fontWeight: '700' as const },
  marketComparisonCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  marketComparisonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  marketComparisonLabel: { color: Colors.textSecondary, fontSize: 13 },
  marketComparisonValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  premiumBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  premiumBadgeText: { fontSize: 11, fontWeight: '700' as const },
  historyCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  historyItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  historyDate: { color: Colors.textTertiary, fontSize: 12 },
  historyBar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: Colors.surfaceBorder, marginHorizontal: 10, overflow: 'hidden' as const },
  historyBarFill: { height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  historyValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  appraisalDetailsCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  appraisalDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  appraisalDetailLabel: { color: Colors.textSecondary, fontSize: 13 },
  appraisalDetailValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  appraisalDisclaimer: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: Colors.warning + '10', borderRadius: 10, marginBottom: 16 },
  appraisalDisclaimerText: { color: Colors.textSecondary, fontSize: 13 },
  comparablesCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  comparableItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  comparableInfo: { flex: 1 },
  comparableName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  comparableDistance: { color: Colors.textTertiary, fontSize: 12, marginTop: 2 },
  comparableValues: { alignItems: 'flex-end', gap: 2 },
  comparableValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  comparableSqft: { color: Colors.textTertiary, fontSize: 11 },
  appraisalActionsContainer: { gap: 8 },
  appraisalDownloadButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  appraisalDownloadText: { color: Colors.textSecondary, fontSize: 13 },
  requestAppraisalButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  requestAppraisalText: { color: Colors.textSecondary, fontSize: 13 },
  titleCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  titleHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  titleIconContainer: { gap: 8 },
  titleHeaderText: { flex: 1, gap: 2 },
  titleNumber: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  titleSubtext: { color: Colors.textSecondary, fontSize: 13 },
  copyButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  titleDetails: { gap: 8, marginTop: 8 },
  titleDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleDetailLabel: { color: Colors.textSecondary, fontSize: 13 },
  titleDetailValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  titleStatusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  titleStatusText: { color: Colors.textSecondary, fontSize: 13 },
  verificationInfo: { flex: 1 },
  verificationText: { color: Colors.textSecondary, fontSize: 13 },
  titleModalContent: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, maxHeight: '85%' },
  titleModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  titleModalIconContainer: { width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  titleModalHeaderText: { flex: 1, gap: 4 },
  titleModalNumber: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  titleModalStatusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  titleModalStatusText: { color: Colors.textSecondary, fontSize: 13 },
  titleSectionContainer: { gap: 8 },
  titleSectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  titleInfoCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  titleInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleInfoLabel: { color: Colors.textSecondary, fontSize: 13 },
  titleInfoValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  legalDescriptionCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  legalDescriptionText: { color: Colors.textSecondary, fontSize: 13 },
  titleStatusCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  titleStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleStatusLabel: { color: Colors.textSecondary, fontSize: 13 },
  titleStatusValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  titleClearBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  titleClearText: { color: Colors.textSecondary, fontSize: 13 },
  ownershipHistoryCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  ownershipHistoryItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  ownershipTimeline: { alignItems: 'center', width: 20 },
  ownershipTimelineDot: { width: 8, height: 8, borderRadius: 4 },
  ownershipTimelineLine: { width: 2, flex: 1, backgroundColor: Colors.surfaceBorder },
  ownershipContent: { flex: 1, gap: 4 },
  ownershipDate: { color: Colors.textTertiary, fontSize: 12 },
  ownershipOwner: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  ownershipTypeBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  ownershipTypeText: { color: Colors.textSecondary, fontSize: 13 },
  verificationCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  verificationHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  verificationTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  verificationDetails: { gap: 8 },
  verificationRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verificationLabel: { color: Colors.textSecondary, fontSize: 13 },
  verificationValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  titleActionsContainer: { gap: 8 },
  titleDownloadButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  titleDownloadText: { color: Colors.textSecondary, fontSize: 13 },
  titleShareButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  titleShareText: { color: Colors.textSecondary, fontSize: 13 }});
