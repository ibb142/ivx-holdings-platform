import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Platform,
  Share} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { router } from 'expo-router';
import {
  ArrowLeft,
  TrendingUp,
  Calendar,
  PieChart,
  Building2,
  Share2,
  Mail,
  Phone,
  MessageCircle,
  FileText,
  ChevronDown,
  ChevronUp,
  Wallet,
  BarChart3,
  Award,
  Shield,
  Target} from 'lucide-react-native';

interface ProfitProjection {
  period: string;
  investment: number;
  dividendReturn: number;
  capitalAppreciation: number;
  totalReturn: number;
  percentReturn: number;
}

const INVESTMENT_AMOUNTS = [1000, 5000, 10000, 25000, 50000, 100000];
const ANNUAL_YIELD = 7.5;
const ANNUAL_APPRECIATION = 8.2;

const calculateProjections = (investment: number): ProfitProjection[] => {
  const hourlyDividend = (investment * (ANNUAL_YIELD / 100)) / (365 * 24);
  const hourlyAppreciation = (investment * (ANNUAL_APPRECIATION / 100)) / (365 * 24);
  const dailyDividend = (investment * (ANNUAL_YIELD / 100)) / 365;
  const dailyAppreciation = (investment * (ANNUAL_APPRECIATION / 100)) / 365;
  const weeklyDividend = (investment * (ANNUAL_YIELD / 100)) / 52;
  const weeklyAppreciation = (investment * (ANNUAL_APPRECIATION / 100)) / 52;
  const monthlyDividend = (investment * (ANNUAL_YIELD / 100)) / 12;
  const monthlyAppreciation = (investment * (ANNUAL_APPRECIATION / 100)) / 12;
  const quarterlyDividend = (investment * (ANNUAL_YIELD / 100)) / 4;
  const quarterlyAppreciation = (investment * (ANNUAL_APPRECIATION / 100)) / 4;
  const yearlyDividend = investment * (ANNUAL_YIELD / 100);
  const yearlyAppreciation = investment * (ANNUAL_APPRECIATION / 100);
  const year3Dividend = yearlyDividend * 3;
  const year3Appreciation = investment * Math.pow(1 + ANNUAL_APPRECIATION / 100, 3) - investment;
  const year5Dividend = yearlyDividend * 5;
  const year5Appreciation = investment * Math.pow(1 + ANNUAL_APPRECIATION / 100, 5) - investment;
  const year10Dividend = yearlyDividend * 10;
  const year10Appreciation = investment * Math.pow(1 + ANNUAL_APPRECIATION / 100, 10) - investment;

  return [
    { period: 'Per Hour', investment, dividendReturn: hourlyDividend, capitalAppreciation: hourlyAppreciation, totalReturn: hourlyDividend + hourlyAppreciation, percentReturn: ((hourlyDividend + hourlyAppreciation) / investment) * 100 },
    { period: 'Per Day', investment, dividendReturn: dailyDividend, capitalAppreciation: dailyAppreciation, totalReturn: dailyDividend + dailyAppreciation, percentReturn: ((dailyDividend + dailyAppreciation) / investment) * 100 },
    { period: 'Per Week', investment, dividendReturn: weeklyDividend, capitalAppreciation: weeklyAppreciation, totalReturn: weeklyDividend + weeklyAppreciation, percentReturn: ((weeklyDividend + weeklyAppreciation) / investment) * 100 },
    { period: 'Per Month', investment, dividendReturn: monthlyDividend, capitalAppreciation: monthlyAppreciation, totalReturn: monthlyDividend + monthlyAppreciation, percentReturn: ((monthlyDividend + monthlyAppreciation) / investment) * 100 },
    { period: 'Per Quarter', investment, dividendReturn: quarterlyDividend, capitalAppreciation: quarterlyAppreciation, totalReturn: quarterlyDividend + quarterlyAppreciation, percentReturn: ((quarterlyDividend + quarterlyAppreciation) / investment) * 100 },
    { period: '1 Year', investment, dividendReturn: yearlyDividend, capitalAppreciation: yearlyAppreciation, totalReturn: yearlyDividend + yearlyAppreciation, percentReturn: ((yearlyDividend + yearlyAppreciation) / investment) * 100 },
    { period: '3 Years', investment, dividendReturn: year3Dividend, capitalAppreciation: year3Appreciation, totalReturn: year3Dividend + year3Appreciation, percentReturn: ((year3Dividend + year3Appreciation) / investment) * 100 },
    { period: '5 Years', investment, dividendReturn: year5Dividend, capitalAppreciation: year5Appreciation, totalReturn: year5Dividend + year5Appreciation, percentReturn: ((year5Dividend + year5Appreciation) / investment) * 100 },
    { period: '10 Years', investment, dividendReturn: year10Dividend, capitalAppreciation: year10Appreciation, totalReturn: year10Dividend + year10Appreciation, percentReturn: ((year10Dividend + year10Appreciation) / investment) * 100 },
  ];
};

import { formatCurrencyWithDecimals } from '@/lib/formatters';

const formatCurrency = (amount: number): string => {
  if (amount < 0.01) return `${amount.toFixed(4)}`;
  if (amount < 1) return `${amount.toFixed(3)}`;
  return formatCurrencyWithDecimals(amount);
};

const generateProspectusText = (investment: number): string => {
  const projections = calculateProjections(investment);
  const combined = ANNUAL_YIELD + ANNUAL_APPRECIATION;
  const lines: string[] = [
    'IVXHOLDINGS INVESTOR PROSPECTUS',
    `Investment: ${formatCurrency(investment)} | Yield: ${ANNUAL_YIELD}% | Appreciation: ${ANNUAL_APPRECIATION}% | Combined: ${combined.toFixed(1)}%`,
    '',
    'PROFIT PROJECTIONS:',
  ];
  projections.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.period}: Dividend ${formatCurrency(p.dividendReturn)} + Growth ${formatCurrency(p.capitalAppreciation)} = ${formatCurrency(p.totalReturn)} (${p.percentReturn.toFixed(4)}%)`);
  });
  lines.push('', 'Contact: investors@ipxholding.com | www.ipxholding.com');
  lines.push(`(c) ${new Date().getFullYear()} IVX HOLDINGS LLC. Past performance does not guarantee future results.`);
  return lines.join('\n');
};

export default function InvestorProspectusScreen() {
  const [selectedAmount, setSelectedAmount] = useState<number>(10000);
  const [expandedSection, setExpandedSection] = useState<string | null>('projections');

  const projections = calculateProjections(selectedAmount);

  const handleShare = async (method: 'whatsapp' | 'email' | 'sms' | 'call' | 'general') => {
    const prospectusText = generateProspectusText(selectedAmount);
    const shortMessage = `📊 IVXHOLDINGS Investor Prospectus\n\nInvest ${formatCurrency(selectedAmount)} and earn:\n• ${formatCurrency(projections[5].totalReturn)}/year\n• ${(ANNUAL_YIELD + ANNUAL_APPRECIATION).toFixed(1)}% combined return\n\n24/7 Trading | Fractional Real Estate\n\nContact: investors@ipxholding.com`;

    try {
      switch (method) {
        case 'whatsapp': {
          const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(prospectusText)}`;
          const canOpen = await Linking.canOpenURL(whatsappUrl);
          if (canOpen) {
            await Linking.openURL(whatsappUrl);
          } else {
            await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(shortMessage)}`);
          }
          break;
        }
        case 'email': {
          const subject = 'IVXHOLDINGS Investor Prospectus - Real Estate Investment Opportunity';
          await Linking.openURL(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(prospectusText)}`);
          break;
        }
        case 'sms': {
          const smsUrl = Platform.OS === 'ios'
            ? `sms:&body=${encodeURIComponent(shortMessage)}`
            : `sms:?body=${encodeURIComponent(shortMessage)}`;
          await Linking.openURL(smsUrl);
          break;
        }
        case 'call':
          await Linking.openURL('mailto:investors@ipxholding.com?subject=Investor%20Prospectus%20Call%20Request');
          break;
        case 'general':
          await Share.share({ message: prospectusText, title: 'IVXHOLDINGS Investor Prospectus' });
          break;
      }
    } catch (error) {
      console.log('Share error:', error);
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const renderIncomeStream = (
    icon: React.ReactNode,
    title: string,
    percentage: string,
    description: string,
    color: string
  ) => (
    <View style={[styles.incomeCard, { borderLeftColor: color }]}>
      <View style={[styles.incomeIconWrap, { backgroundColor: `${color}20` }]}>
        {icon}
      </View>
      <View style={styles.incomeContent}>
        <View style={styles.incomeHeader}>
          <Text style={styles.incomeTitle}>{title}</Text>
          <Text style={[styles.incomePercent, { color }]}>{percentage}</Text>
        </View>
        <Text style={styles.incomeDescription}>{description}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>Investor Prospectus</Text>
            <Text style={styles.headerSubtitle}>Profit Analysis & Projections</Text>
          </View>
          <TouchableOpacity style={styles.shareButton} onPress={() => handleShare('general')}>
            <Share2 size={22} color="#00A86B" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroSection}>
          <View style={styles.heroIconContainer}>
            <TrendingUp size={22} color="#00A86B" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>How Investors Earn</Text>
            <Text style={styles.heroSubtitle}>24/7 Trading • Passive Income • Capital Growth</Text>
            <View style={styles.heroStats}>
              <View style={styles.heroStat}>
                <Text style={styles.heroStatValue}>{ANNUAL_YIELD}%</Text>
                <Text style={styles.heroStatLabel}>Yield</Text>
              </View>
              <View style={styles.heroStat}>
                <Text style={styles.heroStatValue}>{ANNUAL_APPRECIATION}%</Text>
                <Text style={styles.heroStatLabel}>Growth</Text>
              </View>
              <View style={styles.heroStat}>
                <Text style={styles.heroStatValue}>{(ANNUAL_YIELD + ANNUAL_APPRECIATION).toFixed(1)}%</Text>
                <Text style={styles.heroStatLabel}>Combined</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>💰 Income Streams</Text>
            <Text style={styles.sectionSubtitle}>Three ways to grow your wealth</Text>
            <View style={styles.sectionDivider} />
            {renderIncomeStream(
              <Wallet size={20} color="#00A86B" />,
              'Dividend Income',
              `${ANNUAL_YIELD}%/yr`,
              'Quarterly cash distributions from rental income. Passive earnings deposited directly to your account.',
              '#00A86B'
            )}
            {renderIncomeStream(
              <TrendingUp size={20} color="#4A90D9" />,
              'Capital Appreciation',
              `${ANNUAL_APPRECIATION}%/yr`,
              'Property values increase over time. Sell shares at higher prices to realize gains.',
              '#4A90D9'
            )}
            {renderIncomeStream(
              <BarChart3 size={20} color="#8B5CF6" />,
              'Trading Profits',
              '24/7',
              'Buy and sell shares anytime. No market hours restrictions. Real-time price movements.',
              '#8B5CF6'
            )}
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>📊 Select Investment Amount</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.amountScroll}>
              <View style={styles.amountContainer}>
                {INVESTMENT_AMOUNTS.map((amount) => (
                  <TouchableOpacity
                    key={amount}
                    style={[styles.amountButton, selectedAmount === amount && styles.amountButtonActive]}
                    onPress={() => setSelectedAmount(amount)}
                  >
                    <Text style={[styles.amountText, selectedAmount === amount && styles.amountTextActive]}>
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>

          <TouchableOpacity
            style={styles.collapsibleSection}
            onPress={() => toggleSection('projections')}
            activeOpacity={0.8}
          >
            <View style={styles.collapsibleHeader}>
              <View style={styles.collapsibleTitleRow}>
                <Calendar size={20} color="#00A86B" />
                <Text style={styles.collapsibleTitleText}>Profit Projections</Text>
              </View>
              {expandedSection === 'projections'
                ? <ChevronUp size={20} color={Colors.textSecondary} />
                : <ChevronDown size={20} color={Colors.textSecondary} />}
            </View>
          </TouchableOpacity>

          {expandedSection === 'projections' && (
            <View style={styles.expandedContainer}>
              {projections.map((projection, index) => (
                <View key={projection.period} style={styles.projectionCard}>
                  <View style={styles.projectionHeader}>
                    <View style={styles.projectionPeriodRow}>
                      <View style={[styles.projectionNumber, { backgroundColor: index < 5 ? '#1e3a5f' : '#0d3320' }]}>
                        <Text style={[styles.projectionNumberText, { color: index < 5 ? '#4A90D9' : '#00A86B' }]}>
                          {index + 1}
                        </Text>
                      </View>
                      <Text style={styles.projectionPeriodText}>{projection.period}</Text>
                    </View>
                    <View style={styles.projectionTotalCol}>
                      <Text style={styles.projectionTotalLabel}>Total Return</Text>
                      <Text style={styles.projectionTotalValue}>{formatCurrency(projection.totalReturn)}</Text>
                    </View>
                  </View>

                  <View style={styles.projectionDetails}>
                    <View style={styles.projectionDetail}>
                      <View style={[styles.projectionDot, { backgroundColor: '#00A86B' }]} />
                      <Text style={styles.projectionDetailLabel}>Dividend</Text>
                      <Text style={styles.projectionDetailValue}>{formatCurrency(projection.dividendReturn)}</Text>
                    </View>
                    <View style={styles.projectionDetail}>
                      <View style={[styles.projectionDot, { backgroundColor: '#4A90D9' }]} />
                      <Text style={styles.projectionDetailLabel}>Appreciation</Text>
                      <Text style={styles.projectionDetailValue}>{formatCurrency(projection.capitalAppreciation)}</Text>
                    </View>
                    <View style={styles.projectionDetail}>
                      <View style={[styles.projectionDot, { backgroundColor: '#8B5CF6' }]} />
                      <Text style={styles.projectionDetailLabel}>Return Rate</Text>
                      <Text style={styles.projectionDetailValue}>{projection.percentReturn.toFixed(4)}%</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={styles.collapsibleSection}
            onPress={() => toggleSection('comparison')}
            activeOpacity={0.8}
          >
            <View style={styles.collapsibleHeader}>
              <View style={styles.collapsibleTitleRow}>
                <PieChart size={20} color="#4A90D9" />
                <Text style={styles.collapsibleTitleText}>Investment Comparison</Text>
              </View>
              {expandedSection === 'comparison'
                ? <ChevronUp size={20} color={Colors.textSecondary} />
                : <ChevronDown size={20} color={Colors.textSecondary} />}
            </View>
          </TouchableOpacity>

          {expandedSection === 'comparison' && (
            <View style={styles.expandedContainer}>
              <View style={[styles.comparisonRow, styles.comparisonHeaderRow]}>
                <Text style={[styles.comparisonCell, styles.comparisonHeaderCell]}>Investment</Text>
                <Text style={[styles.comparisonCell, styles.comparisonHeaderCell]}>Annual %</Text>
                <Text style={[styles.comparisonCell, styles.comparisonHeaderCell]}>Liquidity</Text>
              </View>
              {[
                { name: 'IVXHOLDINGS Real Estate', rate: '15.7%', liquidity: '24/7', highlight: true },
                { name: 'Traditional RE', rate: '8-10%', liquidity: 'Months', highlight: false },
                { name: 'S&P 500 Avg', rate: '10%', liquidity: 'Market Hrs', highlight: false },
                { name: 'Bonds', rate: '4-5%', liquidity: 'Varies', highlight: false },
                { name: 'Savings Account', rate: '0.5%', liquidity: 'Instant', highlight: false },
              ].map((item, index) => (
                <View
                  key={index}
                  style={[styles.comparisonRow, item.highlight && styles.comparisonHighlightRow]}
                >
                  <Text style={[styles.comparisonCell, item.highlight && styles.comparisonCellHighlight]}>{item.name}</Text>
                  <Text style={[styles.comparisonCell, item.highlight && styles.comparisonCellHighlight]}>{item.rate}</Text>
                  <Text style={[styles.comparisonCell, item.highlight && styles.comparisonCellHighlight]}>{item.liquidity}</Text>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={styles.collapsibleSection}
            onPress={() => toggleSection('properties')}
            activeOpacity={0.8}
          >
            <View style={styles.collapsibleHeader}>
              <View style={styles.collapsibleTitleRow}>
                <Building2 size={20} color="#8B5CF6" />
                <Text style={styles.collapsibleTitleText}>Available Properties</Text>
              </View>
              {expandedSection === 'properties'
                ? <ChevronUp size={20} color={Colors.textSecondary} />
                : <ChevronDown size={20} color={Colors.textSecondary} />}
            </View>
          </TouchableOpacity>

          {expandedSection === 'properties' && (
            <View style={styles.expandedContainer}>
              {[
                { name: 'Marina Bay Residences', location: 'Dubai, UAE', price: '$52.40', yield: '8.5%', irr: '14.5%', occupancy: '96%' },
                { name: 'Manhattan Office Tower', location: 'New York, USA', price: '$125.00', yield: '6.8%', irr: '12.2%', occupancy: '92%' },
                { name: 'Paris Retail Complex', location: 'Paris, France', price: '$185.00', yield: '5.8%', irr: '10.8%', occupancy: '98%' },
                { name: 'Tokyo Mixed-Use Tower', location: 'Tokyo, Japan', price: '$68.00', yield: '6.5%', irr: '12.5%', occupancy: '94%' },
              ].map((property, index) => (
                <View key={index} style={styles.propertyCard}>
                  <View style={styles.propertyHeader}>
                    <Text style={styles.propertyName}>{property.name}</Text>
                    <Text style={styles.propertyPrice}>{property.price}/share</Text>
                  </View>
                  <Text style={styles.propertyLocation}>{property.location}</Text>
                  <View style={styles.propertyStats}>
                    <View style={styles.propertyStat}>
                      <Text style={styles.propertyStatLabel}>Yield</Text>
                      <Text style={styles.propertyStatValue}>{property.yield}</Text>
                    </View>
                    <View style={styles.propertyStat}>
                      <Text style={styles.propertyStatLabel}>IRR</Text>
                      <Text style={styles.propertyStatValue}>{property.irr}</Text>
                    </View>
                    <View style={styles.propertyStat}>
                      <Text style={styles.propertyStatLabel}>Occupancy</Text>
                      <Text style={styles.propertyStatValue}>{property.occupancy}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={styles.collapsibleSection}
            onPress={() => toggleSection('security')}
            activeOpacity={0.8}
          >
            <View style={styles.collapsibleHeader}>
              <View style={styles.collapsibleTitleRow}>
                <Shield size={20} color="#EAB308" />
                <Text style={styles.collapsibleTitleText}>Security & Compliance</Text>
              </View>
              {expandedSection === 'security'
                ? <ChevronUp size={20} color={Colors.textSecondary} />
                : <ChevronDown size={20} color={Colors.textSecondary} />}
            </View>
          </TouchableOpacity>

          {expandedSection === 'security' && (
            <View style={styles.expandedContainer}>
              {[
                { icon: <Shield size={18} color="#00A86B" />, text: 'SEC-compliant investment structure' },
                { icon: <Shield size={18} color="#00A86B" />, text: 'Bank-level 256-bit encryption' },
                { icon: <FileText size={18} color="#00A86B" />, text: 'Property deed verification' },
                { icon: <Target size={18} color="#00A86B" />, text: 'Independent property appraisals' },
                { icon: <Award size={18} color="#00A86B" />, text: 'Title insurance on all properties' },
                { icon: <BarChart3 size={18} color="#00A86B" />, text: 'Regular financial audits' },
              ].map((item, index) => (
                <View key={index} style={styles.securityItem}>
                  {item.icon}
                  <Text style={styles.securityText}>{item.text}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.shareSection}>
            <Text style={styles.shareSectionTitle}>📤 Share Prospectus</Text>
            <Text style={styles.shareSectionSubtitle}>Send to potential investors</Text>
            <View style={styles.shareButtons}>
              <TouchableOpacity
                style={[styles.shareMethodButton, { backgroundColor: '#25D366' }]}
                onPress={() => handleShare('whatsapp')}
              >
                <MessageCircle size={22} color="#fff" />
                <Text style={styles.shareMethodText}>WhatsApp</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.shareMethodButton, { backgroundColor: '#EA4335' }]}
                onPress={() => handleShare('email')}
              >
                <Mail size={22} color="#fff" />
                <Text style={styles.shareMethodText}>Email</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.shareMethodButton, { backgroundColor: '#4A90D9' }]}
                onPress={() => handleShare('sms')}
              >
                <MessageCircle size={22} color="#fff" />
                <Text style={styles.shareMethodText}>SMS</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.shareMethodButton, { backgroundColor: '#00A86B' }]}
                onPress={() => handleShare('call')}
              >
                <Phone size={22} color="#fff" />
                <Text style={styles.shareMethodText}>Call</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.disclaimerSection}>
            <Text style={styles.disclaimerTitle}>⚠️ Important Disclaimer</Text>
            <Text style={styles.disclaimerText}>
              Past performance does not guarantee future results. Real estate investments involve risk including potential loss of principal. Projected returns are estimates based on historical data and market conditions. Actual returns may vary. This document is for informational purposes only and does not constitute financial advice.
            </Text>
            <Text style={styles.copyright}>© {new Date().getFullYear()} IVX HOLDINGS LLC. All Rights Reserved.</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  safeTop: {
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12},
  backButton: {
    padding: 8,
    marginRight: 4},
  headerTitleContainer: {
    flex: 1},
  headerTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800' as const},
  headerSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginTop: 2},
  shareButton: {
    padding: 8},
  scrollView: {
    flex: 1,
    backgroundColor: Colors.background},
  scrollContent: {
    paddingBottom: 140},
  heroSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#0f1f17',
    borderBottomWidth: 1,
    borderBottomColor: '#00A86B30',
    marginBottom: 12,
    gap: 14},
  heroIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#00A86B30',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderWidth: 1,
    borderColor: '#00A86B50'},
  heroTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const,
    marginBottom: 2},
  heroSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 6},
  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  heroStat: {
    alignItems: 'center',
    backgroundColor: '#00A86B15',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#00A86B30'},
  heroStatValue: {
    color: '#00A86B',
    fontSize: 13,
    fontWeight: '800' as const},
  heroStatLabel: {
    color: Colors.textTertiary,
    fontSize: 10},
  heroStatDivider: {
    width: 0,
    height: 0},
  content: {
    paddingHorizontal: 16},
  sectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  sectionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
    marginBottom: 4},
  sectionSubtitle: {
    color: Colors.textTertiary,
    fontSize: 13,
    marginBottom: 12},
  sectionDivider: {
    height: 1,
    backgroundColor: Colors.surfaceBorder,
    marginBottom: 12},
  incomeCard: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 3,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12},
  incomeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0},
  incomeContent: {
    flex: 1},
  incomeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6},
  incomeTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const},
  incomePercent: {
    fontSize: 14,
    fontWeight: '700' as const},
  incomeDescription: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18},
  amountScroll: {
    marginTop: 8},
  amountContainer: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 4},
  amountButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  amountButtonActive: {
    backgroundColor: '#00A86B',
    borderColor: '#00A86B'},
  amountText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600' as const},
  amountTextActive: {
    color: '#fff'},
  collapsibleSection: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'},
  collapsibleTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  collapsibleTitleText: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const},
  expandedContainer: {
    marginBottom: 10},
  projectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  projectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12},
  projectionPeriodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  projectionNumber: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'},
  projectionNumberText: {
    fontSize: 13,
    fontWeight: '700' as const},
  projectionPeriodText: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const},
  projectionTotalCol: {
    alignItems: 'flex-end'},
  projectionTotalLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginBottom: 2},
  projectionTotalValue: {
    color: '#00A86B',
    fontSize: 16,
    fontWeight: '800' as const},
  projectionDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder},
  projectionDetail: {
    alignItems: 'center',
    gap: 4},
  projectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  projectionDetailLabel: {
    color: Colors.textTertiary,
    fontSize: 11},
  projectionDetailValue: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600' as const},
  comparisonHeaderRow: {
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 10,
    marginBottom: 4},
  comparisonHeaderCell: {
    color: Colors.textSecondary,
    fontWeight: '700' as const,
    fontSize: 12},
  comparisonRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4},
  comparisonHighlightRow: {
    backgroundColor: '#00A86B15',
    borderWidth: 1,
    borderColor: '#00A86B40'},
  comparisonCell: {
    flex: 1,
    color: Colors.text,
    fontSize: 13},
  comparisonCellHighlight: {
    color: '#00A86B',
    fontWeight: '700' as const},
  propertyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  propertyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4},
  propertyName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
    flex: 1,
    marginRight: 8},
  propertyPrice: {
    color: '#00A86B',
    fontSize: 14,
    fontWeight: '700' as const},
  propertyLocation: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginBottom: 10},
  propertyStats: {
    flexDirection: 'row',
    gap: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder},
  propertyStat: {
    alignItems: 'center',
    gap: 2},
  propertyStatLabel: {
    color: Colors.textTertiary,
    fontSize: 11},
  propertyStatValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const},
  securityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  securityText: {
    color: Colors.textSecondary,
    fontSize: 14,
    flex: 1,
    lineHeight: 20},
  shareSection: {
    marginTop: 8,
    marginBottom: 16},
  shareSectionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
    marginBottom: 4},
  shareSectionSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginBottom: 14},
  shareButtons: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap' as const},
  shareMethodButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 14,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8},
  shareMethodText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600' as const},
  disclaimerSection: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 8},
  disclaimerTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const},
  disclaimerText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20},
  copyright: {
    color: Colors.textTertiary,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4}});
