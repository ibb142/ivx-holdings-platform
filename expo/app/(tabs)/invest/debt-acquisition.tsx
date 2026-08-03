import React, { useState, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  Modal,
  TextInput,
  Alert} from "react-native";
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Shield,
  TrendingUp,
  DollarSign,
  Percent,
  ChevronRight,
  X,
  AlertTriangle,
  CheckCircle,
  Lock,
  Info,
  Clock} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { DebtAcquisitionProperty } from '@/types';

const debtAcquisitionProperties: DebtAcquisitionProperty[] = [];

const debtAcquisitionStats = {
  totalPropertiesListed: 0, totalDebtAcquired: 0, totalTokenized: 0,
  firstLiensSecured: 0, totalInvestorReturns: 0, averageYield: 0, averageLTV: 0};

function calculateTokenization(property: DebtAcquisitionProperty, tokens: number) {
  const pricePerToken = property.pricePerToken || 100;
  const subtotal = tokens * pricePerToken;
  const ipxFeePercent = 0.025;
  const ipxFee = Math.round(subtotal * ipxFeePercent * 100) / 100;
  const netInvestment = subtotal - ipxFee;
  const ownershipPercent = property.totalTokens > 0 ? (tokens / property.totalTokens) * 100 : 0;
  const projectedAnnualReturn = netInvestment * ((property.projectedYield || 7.5) / 100);
  return {
    tokens, subtotal, ipxFee, netInvestment, ownershipPercent,
    projectedAnnualReturn, lienPosition: property.ipxLienPosition || 'first',
    financingAmount: property.tokenizationAmount || 0,
    pricePerToken, totalTokens: property.totalTokens || 0,
    availableTokens: property.availableTokens || 0};
}
import { formatDollar, formatCurrencyWithDecimals } from '@/lib/formatters';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type FilterType = 'all' | 'available' | 'tokenizing' | 'first_lien_secured';

export default function DebtAcquisitionScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [selectedProperty, setSelectedProperty] = useState<DebtAcquisitionProperty | null>(null);
  const [showInvestModal, setShowInvestModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [tokenAmount, setTokenAmount] = useState('');
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [acceptedDisclosure, setAcceptedDisclosure] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1500);
  }, []);

  const filteredProperties = debtAcquisitionProperties.filter((p: DebtAcquisitionProperty) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'available') return p.status === 'available';
    if (activeFilter === 'tokenizing') return p.status === 'tokenizing' || p.status === 'funded';
    if (activeFilter === 'first_lien_secured') return p.ipxFirstLienSecured;
    return true;
  });

  const handleInvest = (property: DebtAcquisitionProperty) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedProperty(property);
    setTokenAmount('');
    setAcceptedDisclosure(false);
    setShowInvestModal(true);
  };

  const confirmPurchase = async () => {
    if (!selectedProperty || !acceptedDisclosure) return;

    const tokens = parseInt(tokenAmount, 10);
    if (!tokens || tokens < selectedProperty.minTokenPurchase) {
      Alert.alert('Invalid Amount', `Minimum ${selectedProperty.minTokenPurchase} tokens required`);
      return;
    }
    if (tokens > selectedProperty.availableTokens) {
      Alert.alert('Insufficient Tokens', 'Not enough tokens available');
      return;
    }

    const calc = calculateTokenization(selectedProperty, tokens);

    Alert.alert(
      'Confirm Investment',
      `Invest in ${tokens} mortgage-backed tokens for ${formatDollar(calc.subtotal)}\n\nIVXHOLDINGS Fee (2.5%): ${formatDollar(calc.ipxFee)}\nNet Investment: ${formatDollar(calc.netInvestment)}\n\nLien Position: ${calc.lienPosition.toUpperCase()}\nProjected Annual Return: ${formatCurrencyWithDecimals(calc.projectedAnnualReturn)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setIsPurchasing(true);
            await new Promise(resolve => setTimeout(resolve, 2000));
            setIsPurchasing(false);
            setShowInvestModal(false);
            Alert.alert(
              'Investment Successful!',
              `You now own ${tokens} mortgage-backed tokens in ${selectedProperty.name}.\n\nLien Position: FIRST\nExpected Yield: ${selectedProperty.projectedYield}%\n\nYour investment is secured by the first lien mortgage. View holdings in Portfolio.`,
              [{ text: 'OK' }]
            );
          }},
      ]
    );
  };

  const formatCurrency = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${new Intl.NumberFormat('en-US').format(Math.round(value))}`;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
  };

  const getStatusColor = (status: DebtAcquisitionProperty['status']) => {
    switch (status) {
      case 'available': return Colors.info;
      case 'tokenizing': return Colors.warning;
      case 'funded': return Colors.primary;
      case 'first_lien_secured': return Colors.success;
      default: return Colors.textSecondary;
    }
  };

  const getStatusLabel = (status: DebtAcquisitionProperty['status']) => {
    switch (status) {
      case 'available': return 'Open to Invest';
      case 'tokenizing': return 'Tokenizing';
      case 'funded': return 'Fully Funded';
      case 'first_lien_secured': return '1st Lien Secured';
      default: return status;
    }
  };

  const tokenCalc = selectedProperty && tokenAmount
    ? calculateTokenization(selectedProperty, parseInt(tokenAmount, 10) || 0)
    : null;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Tokenized Mortgage',
          headerRight: () => (
            <TouchableOpacity onPress={() => setShowInfoModal(true)} style={styles.headerButton}>
              <Info size={22} color={Colors.primary} />
            </TouchableOpacity>
          )}}
      />

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        <View style={styles.heroCard}>
          <View style={styles.heroIconContainer}>
            <Shield size={32} color={Colors.primary} />
          </View>
          <Text style={styles.heroTitle}>Tokenized First Lien Mortgage</Text>
          <Text style={styles.heroSubtitle}>
            Property owners bring clean debt-free properties. IVXHOLDINGS provides 85% LTV financing, records first lien, and tokenizes the mortgage for 24/7 investor access.
          </Text>

          <View style={styles.strategyRow}>
            <View style={styles.strategyItem}>
              <Text style={styles.strategyValue}>85%</Text>
              <Text style={styles.strategyLabel}>LTV Financing</Text>
            </View>
            <View style={styles.strategyDivider} />
            <View style={styles.strategyItem}>
              <Text style={styles.strategyValue}>1st</Text>
              <Text style={styles.strategyLabel}>Lien Position</Text>
            </View>
            <View style={styles.strategyDivider} />
            <View style={styles.strategyItem}>
              <Text style={styles.strategyValue}>24/7</Text>
              <Text style={styles.strategyLabel}>Invest Anytime</Text>
            </View>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <DollarSign size={20} color={Colors.success} />
            <Text style={styles.statValue}>{formatCurrency(debtAcquisitionStats.totalTokenized)}</Text>
            <Text style={styles.statLabel}>Tokenized</Text>
          </View>
          <View style={styles.statCard}>
            <Lock size={20} color={Colors.primary} />
            <Text style={styles.statValue}>{debtAcquisitionStats.firstLiensSecured}</Text>
            <Text style={styles.statLabel}>First Liens</Text>
          </View>
          <View style={styles.statCard}>
            <Percent size={20} color={Colors.info} />
            <Text style={styles.statValue}>{debtAcquisitionStats.averageYield}%</Text>
            <Text style={styles.statLabel}>Avg Yield</Text>
          </View>
          <View style={styles.statCard}>
            <TrendingUp size={20} color={Colors.warning} />
            <Text style={styles.statValue}>{debtAcquisitionStats.averageLTV}%</Text>
            <Text style={styles.statLabel}>LTV</Text>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterContainer}
        >
          {(['all', 'available', 'tokenizing', 'first_lien_secured'] as FilterType[]).map((filter) => (
            <TouchableOpacity
              key={filter}
              style={[styles.filterChip, activeFilter === filter && styles.filterChipActive]}
              onPress={() => setActiveFilter(filter)}
            >
              <Text style={[styles.filterChipText, activeFilter === filter && styles.filterChipTextActive]}>
                {filter === 'first_lien_secured' ? 'First Lien' : filter === 'tokenizing' ? 'In Progress' : filter.charAt(0).toUpperCase() + filter.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Clean Properties</Text>
          <Text style={styles.sectionSubtitle}>{filteredProperties.length} debt-free properties with tokenized mortgage</Text>
        </View>

        {filteredProperties.map((property) => (
          <TouchableOpacity
            key={property.id}
            style={styles.propertyCard}
            onPress={() => handleInvest(property)}
            activeOpacity={0.9}
          >
            {property.images && property.images[0] ? (
              <Image source={{ uri: property.images[0] }} style={styles.propertyImage} />
            ) : (
              <View style={[styles.propertyImage, styles.propertyImagePlaceholder]}>
                <Text style={styles.propertyImagePlaceholderText}>{property.name?.charAt(0) ?? 'P'}</Text>
              </View>
            )}

            <View style={styles.propertyBadges}>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(property.status) }]}>
                {property.ipxFirstLienSecured && <Lock size={10} color={Colors.white} />}
                <Text style={styles.statusBadgeText}>{getStatusLabel(property.status)}</Text>
              </View>
              <View style={styles.yieldBadge}>
                <Text style={styles.yieldBadgeText}>{property.projectedYield}% Yield</Text>
              </View>
            </View>

            <View style={styles.propertyContent}>
              <Text style={styles.propertyName}>{property.name}</Text>
              <Text style={styles.propertyLocation}>{property.city}, {property.state}</Text>

              <View style={styles.debtStructure}>
                <View style={styles.debtRow}>
                  <Text style={styles.debtLabel}>Appraised Value</Text>
                  <Text style={styles.debtValue}>{formatCurrency(property.appraisedValue)}</Text>
                </View>
                <View style={styles.debtRow}>
                  <Text style={styles.debtLabel}>IVXHOLDINGS Financing ({property.ltvPercent}% LTV)</Text>
                  <Text style={styles.debtValuePrimary}>{formatCurrency(property.financingAmount)}</Text>
                </View>
                <View style={styles.debtRow}>
                  <Text style={styles.debtLabel}>Closing Cost + IVXHOLDINGS Fee</Text>
                  <Text style={styles.debtValueHighlight}>{formatCurrency(property.closingCostAmount + property.ipxFeeAmount)}</Text>
                </View>
                <View style={[styles.debtRow, styles.debtRowTotal]}>
                  <Text style={styles.debtLabelBold}>Owner Receives</Text>
                  <Text style={styles.debtValueSuccess}>{formatCurrency(property.ownerNetProceeds)}</Text>
                </View>
              </View>

              <View style={styles.progressSection}>
                <View style={styles.progressRow}>
                  <Text style={styles.progressLabel}>Tokenization Progress</Text>
                  <Text style={styles.progressPercent}>{property.tokenizationProgress}%</Text>
                </View>
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${property.tokenizationProgress}%` }]} />
                </View>
              </View>

              <View style={styles.metricsRow}>
                <View style={styles.metricItem}>
                  <Text style={styles.metricValue}>{property.projectedIRR}%</Text>
                  <Text style={styles.metricLabel}>IRR</Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={styles.metricValue}>{property.loanToValue}%</Text>
                  <Text style={styles.metricLabel}>LTV</Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={styles.metricValue}>{property.debtServiceCoverageRatio}x</Text>
                  <Text style={styles.metricLabel}>DSCR</Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={styles.metricValue}>{formatDollar(property.pricePerToken)}</Text>
                  <Text style={styles.metricLabel}>Per Token</Text>
                </View>
              </View>

              <TouchableOpacity style={styles.investButton} onPress={() => handleInvest(property)}>
                <Text style={styles.investButtonText}>Invest Now - 24/7</Text>
                <ChevronRight size={18} color={Colors.black} />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        ))}

        <View style={styles.bottomPadding} />
      </ScrollView>

      <Modal visible={showInvestModal} transparent animationType="slide" onRequestClose={() => setShowInvestModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invest in Mortgage</Text>
              <TouchableOpacity onPress={() => setShowInvestModal(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {selectedProperty && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.modalPropertyName}>{selectedProperty.name}</Text>
                <View style={styles.modalLienBadge}>
                  <Shield size={14} color={Colors.success} />
                  <Text style={styles.modalLienText}>First Lien Mortgage</Text>
                </View>

                <View style={styles.calculatorSection}>
                  <Text style={styles.calculatorTitle}>Mortgage Breakdown</Text>

                  <View style={styles.mortgageBreakdown}>
                    <View style={styles.breakdownRow}>
                      <View style={[styles.breakdownDot, { backgroundColor: Colors.text }]} />
                      <Text style={styles.breakdownLabel}>Appraised Value</Text>
                      <Text style={styles.breakdownValue}>{formatCurrency(selectedProperty.appraisedValue)}</Text>
                    </View>
                    <View style={styles.breakdownRow}>
                      <View style={[styles.breakdownDot, { backgroundColor: Colors.primary }]} />
                      <Text style={styles.breakdownLabel}>85% LTV Financing</Text>
                      <Text style={styles.breakdownValuePrimary}>{formatCurrency(selectedProperty.financingAmount)}</Text>
                    </View>
                    <View style={styles.breakdownRow}>
                      <View style={[styles.breakdownDot, { backgroundColor: Colors.warning }]} />
                      <Text style={styles.breakdownLabel}>Closing Costs ({selectedProperty.closingCostPercent}%)</Text>
                      <Text style={styles.breakdownValueWarning}>{formatCurrency(selectedProperty.closingCostAmount)}</Text>
                    </View>
                    <View style={styles.breakdownRow}>
                      <View style={[styles.breakdownDot, { backgroundColor: Colors.info }]} />
                      <Text style={styles.breakdownLabel}>IVXHOLDINGS Fee ({selectedProperty.ipxFeePercent}%)</Text>
                      <Text style={styles.breakdownValueWarning}>{formatCurrency(selectedProperty.ipxFeeAmount)}</Text>
                    </View>
                    <View style={[styles.breakdownRow, styles.breakdownRowTotal]}>
                      <View style={[styles.breakdownDot, { backgroundColor: Colors.success }]} />
                      <Text style={styles.breakdownLabelBold}>Owner Receives</Text>
                      <Text style={styles.breakdownValueSuccess}>{formatCurrency(selectedProperty.ownerNetProceeds)}</Text>
                    </View>
                  </View>

                  <View style={styles.inputSection}>
                    <Text style={styles.inputLabel}>Number of Tokens</Text>
                    <TextInput
                      style={styles.tokenInput}
                      placeholder={`Min. ${selectedProperty.minTokenPurchase} tokens`}
                      placeholderTextColor={Colors.textTertiary}
                      keyboardType="number-pad"
                      value={tokenAmount}
                      onChangeText={setTokenAmount}
                    />
                    <Text style={styles.availableText}>
                      {new Intl.NumberFormat('en-US').format(selectedProperty.availableTokens)} tokens available @ {formatDollar(selectedProperty.pricePerToken)} each
                    </Text>
                  </View>

                  {tokenCalc && tokenCalc.tokens > 0 && (
                    <View style={styles.summarySection}>
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Subtotal</Text>
                        <Text style={styles.summaryValue}>{formatDollar(tokenCalc.subtotal)}</Text>
                      </View>
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>IVXHOLDINGS Fee (2.5%)</Text>
                        <Text style={styles.summaryFee}>{formatDollar(tokenCalc.ipxFee)}</Text>
                      </View>
                      <View style={[styles.summaryRow, styles.summaryTotal]}>
                        <Text style={styles.summaryTotalLabel}>Net Investment</Text>
                        <Text style={styles.summaryTotalValue}>{formatDollar(tokenCalc.netInvestment)}</Text>
                      </View>
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Ownership</Text>
                        <Text style={styles.summaryValue}>{tokenCalc.ownershipPercent.toFixed(4)}%</Text>
                      </View>
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Projected Annual Return</Text>
                        <Text style={styles.summaryValueGreen}>{formatCurrencyWithDecimals(tokenCalc.projectedAnnualReturn)}</Text>
                      </View>
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Lien Position</Text>
                        <View style={styles.lienPositionBadge}>
                          <Lock size={12} color={Colors.success} />
                          <Text style={styles.lienPositionText}>FIRST</Text>
                        </View>
                      </View>
                    </View>
                  )}
                </View>

                <View style={styles.disclosureSection}>
                  <View style={styles.disclosureHeader}>
                    <AlertTriangle size={18} color={Colors.warning} />
                    <Text style={styles.disclosureTitle}>Legal Disclosure</Text>
                  </View>
                  <Text style={styles.disclosureText}>{selectedProperty.legalDisclosure ?? ''}</Text>

                  <Text style={styles.riskTitle}>Risk Factors:</Text>
                  {(selectedProperty.riskFactors ?? []).map((risk, index) => (
                    <View key={index} style={styles.riskItem}>
                      <View style={styles.riskBullet} />
                      <Text style={styles.riskText}>{risk}</Text>
                    </View>
                  ))}

                  <TouchableOpacity
                    style={[styles.acceptRow, acceptedDisclosure && styles.acceptRowChecked]}
                    onPress={() => setAcceptedDisclosure(!acceptedDisclosure)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, acceptedDisclosure && styles.checkboxChecked]}>
                      {acceptedDisclosure && <CheckCircle size={20} color={Colors.white} />}
                    </View>
                    <Text style={[styles.acceptText, acceptedDisclosure && styles.acceptTextChecked]}>
                      I understand this is a tokenized mortgage (not a traditional bank loan) and accept the risks involved
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[styles.confirmButton, (!acceptedDisclosure || isPurchasing) && styles.confirmButtonDisabled]}
                  onPress={confirmPurchase}
                  disabled={!acceptedDisclosure || isPurchasing}
                >
                  {isPurchasing ? (
                    <ShimmerIndicator color={Colors.black} />
                  ) : (
                    <Text style={styles.confirmButtonText}>Confirm Investment</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={showInfoModal} transparent animationType="fade" onRequestClose={() => setShowInfoModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowInfoModal(false)}>
          <View style={styles.infoModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>How It Works</Text>
              <TouchableOpacity onPress={() => setShowInfoModal(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.infoStep}>
                <View style={styles.infoStepNumber}>
                  <Text style={styles.infoStepNumberText}>1</Text>
                </View>
                <View style={styles.infoStepContent}>
                  <Text style={styles.infoStepTitle}>Owner Brings Clean Property</Text>
                  <Text style={styles.infoStepDesc}>
                    Property owner submits a debt-free (clean title) property to the platform for IVXHOLDINGS financing
                  </Text>
                </View>
              </View>

              <View style={styles.infoStep}>
                <View style={styles.infoStepNumber}>
                  <Text style={styles.infoStepNumberText}>2</Text>
                </View>
                <View style={styles.infoStepContent}>
                  <Text style={styles.infoStepTitle}>85% LTV Financing</Text>
                  <Text style={styles.infoStepDesc}>
                    IVXHOLDINGS appraises the property and provides 85% of the value as financing, minus closing costs and IVXHOLDINGS origination fee
                  </Text>
                </View>
              </View>

              <View style={styles.infoStep}>
                <View style={styles.infoStepNumber}>
                  <Text style={styles.infoStepNumberText}>3</Text>
                </View>
                <View style={styles.infoStepContent}>
                  <Text style={styles.infoStepTitle}>First Lien Recorded</Text>
                  <Text style={styles.infoStepDesc}>
                    IVXHOLDINGS-LUXURY-HOLDINGS LLC records a first lien mortgage on the property — like a bank, but not a traditional loan
                  </Text>
                </View>
              </View>

              <View style={styles.infoStep}>
                <View style={styles.infoStepNumber}>
                  <Text style={styles.infoStepNumberText}>4</Text>
                </View>
                <View style={styles.infoStepContent}>
                  <Text style={styles.infoStepTitle}>Mortgage Tokenized</Text>
                  <Text style={styles.infoStepDesc}>
                    The entire mortgage is tokenized into fractional shares, making it easy to purchase and invest
                  </Text>
                </View>
              </View>

              <View style={styles.infoStep}>
                <View style={[styles.infoStepNumber, { backgroundColor: Colors.success }]}>
                  <Clock size={16} color={Colors.white} />
                </View>
                <View style={styles.infoStepContent}>
                  <Text style={styles.infoStepTitle}>Invest 24/7</Text>
                  <Text style={styles.infoStepDesc}>
                    Investors can buy tokenized mortgage shares anytime — 24 hours a day, 7 days a week. No bank hours, no traditional barriers
                  </Text>
                </View>
              </View>

              <View style={styles.benefitsSection}>
                <Text style={styles.benefitsTitle}>Why This Breaks Traditional Real Estate</Text>
                <View style={styles.benefitItem}>
                  <CheckCircle size={16} color={Colors.success} />
                  <Text style={styles.benefitText}>First lien = priority claim in any default/foreclosure</Text>
                </View>
                <View style={styles.benefitItem}>
                  <CheckCircle size={16} color={Colors.success} />
                  <Text style={styles.benefitText}>Not a traditional bank loan — tokenized & accessible</Text>
                </View>
                <View style={styles.benefitItem}>
                  <CheckCircle size={16} color={Colors.success} />
                  <Text style={styles.benefitText}>Invest any amount, anytime — 24 hrs, 7 days a week</Text>
                </View>
                <View style={styles.benefitItem}>
                  <CheckCircle size={16} color={Colors.success} />
                  <Text style={styles.benefitText}>IVXHOLDINGS acts like the bank but with tokenized efficiency</Text>
                </View>
                <View style={styles.benefitItem}>
                  <CheckCircle size={16} color={Colors.success} />
                  <Text style={styles.benefitText}>Clean properties only — no existing debt complications</Text>
                </View>
              </View>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  headerButton: {
    padding: 8},
  scrollView: {
    flex: 1,
    backgroundColor: Colors.background},
  heroCard: {
    margin: 20,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  heroIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14},
  heroTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800' as const,
    textAlign: 'center',
    marginBottom: 8},
  heroSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 18},
  strategyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%'},
  strategyItem: {
    flex: 1,
    alignItems: 'center'},
  strategyValue: {
    color: Colors.primary,
    fontSize: 22,
    fontWeight: '800' as const},
  strategyLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 2},
  strategyDivider: {
    width: 1,
    height: 32,
    backgroundColor: Colors.surfaceBorder},
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 16},
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  statValue: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const},
  statLabel: {
    color: Colors.textTertiary,
    fontSize: 11},
  filterScroll: {
    marginBottom: 16},
  filterContainer: {
    paddingHorizontal: 20,
    gap: 8},
  filterChip: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  filterChipText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600' as const},
  filterChipTextActive: {
    color: Colors.black},
  sectionHeader: {
    paddingHorizontal: 20,
    marginBottom: 14},
  sectionTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const},
  sectionSubtitle: {
    color: Colors.textTertiary,
    fontSize: 13,
    marginTop: 4},
  propertyCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  propertyImage: {
    width: '100%',
    height: 180},
  propertyBadges: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    gap: 8},
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5},
  statusBadgeText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: '700' as const},
  yieldBadge: {
    backgroundColor: Colors.success + '20',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5},
  yieldBadgeText: {
    color: Colors.success,
    fontSize: 11,
    fontWeight: '700' as const},
  propertyContent: {
    padding: 16},
  propertyName: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700' as const,
    marginBottom: 4},
  propertyLocation: {
    color: Colors.textTertiary,
    fontSize: 13,
    marginBottom: 14},
  debtStructure: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    marginBottom: 14},
  debtRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'},
  debtRowTotal: {
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: 8,
    marginTop: 4},
  debtLabel: {
    color: Colors.textSecondary,
    fontSize: 13},
  debtLabelBold: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const},
  debtValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const},
  debtValueHighlight: {
    color: Colors.warning,
    fontSize: 14,
    fontWeight: '600' as const},
  debtValuePrimary: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700' as const},
  debtValueSuccess: {
    color: Colors.success,
    fontSize: 16,
    fontWeight: '800' as const},
  progressSection: {
    marginBottom: 14},
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6},
  progressLabel: {
    color: Colors.textSecondary,
    fontSize: 12},
  progressPercent: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '700' as const},
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.surfaceBorder},
  progressBarFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary},
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14},
  metricItem: {
    alignItems: 'center'},
  metricValue: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const},
  metricLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 2},
  investButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14},
  investButtonText: {
    color: Colors.black,
    fontWeight: '700' as const,
    fontSize: 15},
  bottomPadding: {
    height: 120},
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end'},
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '90%'},
  infoModalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    margin: 20,
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
  modalPropertyName: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
    marginBottom: 8},
  modalLienBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.success + '15',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    marginBottom: 16},
  modalLienText: {
    color: Colors.success,
    fontSize: 13,
    fontWeight: '700' as const},
  calculatorSection: {
    marginBottom: 16},
  calculatorTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
    marginBottom: 12},
  mortgageBreakdown: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    marginBottom: 16},
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  breakdownRowTotal: {
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: 10,
    marginTop: 4},
  breakdownDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  breakdownLabel: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 13},
  breakdownLabelBold: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const},
  breakdownValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const},
  breakdownValuePrimary: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700' as const},
  breakdownValueWarning: {
    color: Colors.warning,
    fontSize: 14,
    fontWeight: '600' as const},
  breakdownValueSuccess: {
    color: Colors.success,
    fontSize: 16,
    fontWeight: '800' as const},
  inputSection: {
    marginBottom: 16},
  inputLabel: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
    marginBottom: 8},
  tokenInput: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14,
    color: Colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  availableText: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 6},
  summarySection: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    marginBottom: 16},
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'},
  summaryLabel: {
    color: Colors.textSecondary,
    fontSize: 13},
  summaryValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const},
  summaryValueGreen: {
    color: Colors.success,
    fontSize: 14,
    fontWeight: '700' as const},
  summaryFee: {
    color: Colors.warning,
    fontSize: 14,
    fontWeight: '600' as const},
  summaryTotal: {
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: 10,
    marginTop: 4},
  summaryTotalLabel: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const},
  summaryTotalValue: {
    color: Colors.primary,
    fontSize: 18,
    fontWeight: '800' as const},
  lienPositionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.success + '15',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3},
  lienPositionText: {
    color: Colors.success,
    fontSize: 12,
    fontWeight: '700' as const},
  disclosureSection: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20},
  disclosureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10},
  disclosureTitle: {
    color: Colors.warning,
    fontSize: 15,
    fontWeight: '700' as const},
  disclosureText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12},
  riskTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
    marginBottom: 8},
  riskItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6},
  riskBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.warning,
    marginTop: 5},
  riskText: {
    color: Colors.textSecondary,
    fontSize: 13,
    flex: 1,
    lineHeight: 18},
  acceptRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 16,
    padding: 12,
    borderRadius: 10,
    backgroundColor: Colors.surface},
  acceptRowChecked: {
    backgroundColor: Colors.success + '10'},
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center'},
  checkboxChecked: {
    backgroundColor: Colors.success,
    borderColor: Colors.success},
  acceptText: {
    color: Colors.textSecondary,
    fontSize: 13,
    flex: 1,
    lineHeight: 18},
  acceptTextChecked: {
    color: Colors.text},
  confirmButton: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 20},
  confirmButtonDisabled: {
    opacity: 0.4},
  confirmButtonText: {
    color: Colors.black,
    fontSize: 16,
    fontWeight: '700' as const},
  infoStep: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 20},
  infoStepNumber: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center'},
  infoStepNumberText: {
    color: Colors.black,
    fontSize: 16,
    fontWeight: '800' as const},
  infoStepContent: {
    flex: 1},
  infoStepTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
    marginBottom: 4},
  infoStepDesc: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18},
  benefitsSection: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 14,
    padding: 16,
    marginTop: 8},
  benefitsTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
    marginBottom: 12},
  benefitItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10},
  benefitText: {
    color: Colors.textSecondary,
    fontSize: 13,
    flex: 1,
    lineHeight: 18},
  propertyImagePlaceholder: {
    backgroundColor: Colors.backgroundTertiary,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  propertyImagePlaceholderText: {
    color: Colors.textTertiary,
    fontSize: 18,
    fontWeight: '700' as const}});
