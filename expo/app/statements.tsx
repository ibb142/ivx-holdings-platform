import React, { useState, useMemo } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import logger from '@/lib/logger';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert} from 'react-native';
import {
  FileText,
  Download,
  TrendingUp,
  Building2,
  Landmark,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Percent,
  ArrowDownLeft,
  ArrowUpRight} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Stack } from 'expo-router';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { RefreshControl } from 'react-native';

type UserRole = 'investor' | 'private_lender' | 'property_owner';
type StatementType = 'monthly' | 'quarterly' | 'annual';
type StatementStatus = 'available' | 'pending';

interface BaseStatement {
  id: string;
  period: string;
  type: StatementType;
  date: string;
  status: StatementStatus;
}

interface InvestorStatement extends BaseStatement {
  role: 'investor';
  portfolioValue: number;
  returns: number;
  dividends: number;
  properties: number;
}

interface LenderStatement extends BaseStatement {
  role: 'private_lender';
  loanBalance: number;
  interestEarned: number;
  repaymentReceived: number;
  activeLoans: number;
}

interface OwnerStatement extends BaseStatement {
  role: 'property_owner';
  rentalIncome: number;
  managementFee: number;
  netIncome: number;
  occupancyRate: number;
}

type Statement = InvestorStatement | LenderStatement | OwnerStatement;

const INVESTOR_STATEMENTS: InvestorStatement[] = [
  { id: 'inv-1', period: 'January 2025', type: 'monthly', date: '2025-02-01', status: 'available', role: 'investor', portfolioValue: 52400, returns: 1250, dividends: 420, properties: 4 },
  { id: 'inv-2', period: 'December 2024', type: 'monthly', date: '2025-01-01', status: 'available', role: 'investor', portfolioValue: 51150, returns: 980, dividends: 390, properties: 4 },
  { id: 'inv-3', period: 'Q4 2024', type: 'quarterly', date: '2025-01-15', status: 'available', role: 'investor', portfolioValue: 51150, returns: 3200, dividends: 1100, properties: 4 },
  { id: 'inv-4', period: 'November 2024', type: 'monthly', date: '2024-12-01', status: 'available', role: 'investor', portfolioValue: 50170, returns: 890, dividends: 310, properties: 3 },
  { id: 'inv-5', period: 'Q3 2024', type: 'quarterly', date: '2024-10-15', status: 'available', role: 'investor', portfolioValue: 48180, returns: 2800, dividends: 950, properties: 3 },
  { id: 'inv-6', period: 'Annual 2024', type: 'annual', date: '2025-01-31', status: 'available', role: 'investor', portfolioValue: 51150, returns: 12500, dividends: 4200, properties: 4 },
];

const LENDER_STATEMENTS: LenderStatement[] = [
  { id: 'lnd-1', period: 'January 2025', type: 'monthly', date: '2025-02-01', status: 'available', role: 'private_lender', loanBalance: 120000, interestEarned: 950, repaymentReceived: 2100, activeLoans: 3 },
  { id: 'lnd-2', period: 'December 2024', type: 'monthly', date: '2025-01-01', status: 'available', role: 'private_lender', loanBalance: 122100, interestEarned: 870, repaymentReceived: 2100, activeLoans: 3 },
  { id: 'lnd-3', period: 'Q4 2024', type: 'quarterly', date: '2025-01-15', status: 'available', role: 'private_lender', loanBalance: 122100, interestEarned: 2780, repaymentReceived: 6300, activeLoans: 3 },
  { id: 'lnd-4', period: 'November 2024', type: 'monthly', date: '2024-12-01', status: 'available', role: 'private_lender', loanBalance: 124200, interestEarned: 910, repaymentReceived: 2100, activeLoans: 4 },
  { id: 'lnd-5', period: 'Annual 2024', type: 'annual', date: '2025-01-31', status: 'available', role: 'private_lender', loanBalance: 122100, interestEarned: 10850, repaymentReceived: 25200, activeLoans: 3 },
];

const OWNER_STATEMENTS: OwnerStatement[] = [
  { id: 'own-1', period: 'January 2025', type: 'monthly', date: '2025-02-01', status: 'available', role: 'property_owner', rentalIncome: 8400, managementFee: 840, netIncome: 7560, occupancyRate: 96 },
  { id: 'own-2', period: 'December 2024', type: 'monthly', date: '2025-01-01', status: 'available', role: 'property_owner', rentalIncome: 8200, managementFee: 820, netIncome: 7380, occupancyRate: 94 },
  { id: 'own-3', period: 'Q4 2024', type: 'quarterly', date: '2025-01-15', status: 'available', role: 'property_owner', rentalIncome: 24800, managementFee: 2480, netIncome: 22320, occupancyRate: 95 },
  { id: 'own-4', period: 'November 2024', type: 'monthly', date: '2024-12-01', status: 'available', role: 'property_owner', rentalIncome: 8100, managementFee: 810, netIncome: 7290, occupancyRate: 93 },
  { id: 'own-5', period: 'Annual 2024', type: 'annual', date: '2025-01-31', status: 'available', role: 'property_owner', rentalIncome: 97600, managementFee: 9760, netIncome: 87840, occupancyRate: 94 },
];

const ROLE_CONFIG = {
  investor: {
    label: 'Investor',
    icon: TrendingUp,
    color: Colors.primary,
    description: 'Portfolio & Returns'},
  private_lender: {
    label: 'Private Lender',
    icon: Landmark,
    color: Colors.info,
    description: 'Lending & Interest'},
  property_owner: {
    label: 'Property Owner',
    icon: Building2,
    color: Colors.success,
    description: 'Rental Income'}};

import { formatCurrencyWithDecimals } from '@/lib/formatters';

function fmt(n: number) {
  return formatCurrencyWithDecimals(n);
}

function StatementCard({ statement, onDownload }: { statement: Statement; onDownload: (s: Statement) => void }) {
  const [expanded, setExpanded] = useState(false);

  const typeColor =
    statement.type === 'monthly' ? Colors.info :
    statement.type === 'quarterly' ? Colors.primary :
    Colors.success;

  const typeLabel =
    statement.type === 'monthly' ? 'Monthly' :
    statement.type === 'quarterly' ? 'Quarterly' : 'Annual';

  const renderDetails = () => {
    if (statement.role === 'investor') {
      return (
        <View style={styles.detailsGrid}>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Portfolio Value</Text>
            <Text style={styles.detailValue}>{fmt(statement.portfolioValue)}</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Total Returns</Text>
            <Text style={[styles.detailValue, { color: Colors.success }]}>+{fmt(statement.returns)}</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Dividends</Text>
            <Text style={[styles.detailValue, { color: Colors.success }]}>+{fmt(statement.dividends)}</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Properties</Text>
            <Text style={styles.detailValue}>{statement.properties}</Text>
          </View>
        </View>
      );
    }
    if (statement.role === 'private_lender') {
      return (
        <View style={styles.detailsGrid}>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Loan Balance</Text>
            <Text style={styles.detailValue}>{fmt(statement.loanBalance)}</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Interest Earned</Text>
            <Text style={[styles.detailValue, { color: Colors.success }]}>+{fmt(statement.interestEarned)}</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Repayments</Text>
            <Text style={[styles.detailValue, { color: Colors.info }]}>{fmt(statement.repaymentReceived)}</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Active Loans</Text>
            <Text style={styles.detailValue}>{statement.activeLoans}</Text>
          </View>
        </View>
      );
    }
    if (statement.role === 'property_owner') {
      return (
        <View style={styles.detailsGrid}>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Rental Income</Text>
            <Text style={[styles.detailValue, { color: Colors.success }]}>+{fmt(statement.rentalIncome)}</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Mgmt Fee</Text>
            <Text style={[styles.detailValue, { color: Colors.error }]}>-{fmt(statement.managementFee)}</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Net Income</Text>
            <Text style={[styles.detailValue, { color: Colors.success }]}>+{fmt(statement.netIncome)}</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Occupancy</Text>
            <Text style={styles.detailValue}>{statement.occupancyRate}%</Text>
          </View>
        </View>
      );
    }
    return null;
  };

  const primaryMetric = () => {
    if (statement.role === 'investor') return { label: 'Returns', value: `+${fmt(statement.returns)}`, color: Colors.success };
    if (statement.role === 'private_lender') return { label: 'Interest', value: `+${fmt(statement.interestEarned)}`, color: Colors.success };
    if (statement.role === 'property_owner') return { label: 'Net Income', value: `+${fmt(statement.netIncome)}`, color: Colors.success };
    return { label: '', value: '', color: Colors.text };
  };

  const metric = primaryMetric();

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setExpanded(e => !e); }}
        activeOpacity={0.8}
      >
        <View style={[styles.cardIconBox, { backgroundColor: typeColor + '18' }]}>
          <FileText size={18} color={typeColor} />
        </View>
        <View style={styles.cardMain}>
          <Text style={styles.cardPeriod}>{statement.period}</Text>
          <View style={styles.cardSubRow}>
            <View style={[styles.typePill, { backgroundColor: typeColor + '18' }]}>
              <Text style={[styles.typePillText, { color: typeColor }]}>{typeLabel}</Text>
            </View>
            <Text style={styles.cardDate}>
              {new Date(statement.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
          </View>
        </View>
        <View style={styles.cardRight}>
          <Text style={[styles.metricValue, { color: metric.color }]}>{metric.value}</Text>
          <Text style={styles.metricLabel}>{metric.label}</Text>
        </View>
        {expanded ? <ChevronUp size={14} color={Colors.textTertiary} style={{ marginLeft: 6 }} /> : <ChevronDown size={14} color={Colors.textTertiary} style={{ marginLeft: 6 }} />}
      </TouchableOpacity>

      {expanded && (
        <View style={styles.expandedSection}>
          <View style={styles.expandDivider} />
          {renderDetails()}
          <TouchableOpacity
            style={styles.downloadBtn}
            onPress={() => onDownload(statement)}
            activeOpacity={0.8}
          >
            <Download size={14} color={Colors.primary} />
            <Text style={styles.downloadBtnText}>Download PDF</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function StatementsScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const [activeRole, setActiveRole] = useState<UserRole>('investor');
  const [filterType, setFilterType] = useState<'all' | StatementType>('all');

  const statements = useMemo<Statement[]>(() => {
    const map: Record<UserRole, Statement[]> = {
      investor: INVESTOR_STATEMENTS,
      private_lender: LENDER_STATEMENTS,
      property_owner: OWNER_STATEMENTS};
    const all = map[activeRole];
    return filterType === 'all' ? all : all.filter(s => s.type === filterType);
  }, [activeRole, filterType]);

  const summaryStats = useMemo(() => {
    if (activeRole === 'investor') {
      const latest = INVESTOR_STATEMENTS[0];
      return [
        { label: 'Portfolio', value: fmt(latest.portfolioValue), icon: DollarSign, color: Colors.primary },
        { label: 'Returns YTD', value: `+${fmt(latest.returns)}`, icon: ArrowUpRight, color: Colors.success },
        { label: 'Dividends', value: `+${fmt(latest.dividends)}`, icon: Percent, color: Colors.info },
      ];
    }
    if (activeRole === 'private_lender') {
      const latest = LENDER_STATEMENTS[0];
      return [
        { label: 'Loan Book', value: fmt(latest.loanBalance), icon: DollarSign, color: Colors.info },
        { label: 'Interest Earned', value: `+${fmt(latest.interestEarned)}`, icon: ArrowUpRight, color: Colors.success },
        { label: 'Active Loans', value: String(latest.activeLoans), icon: Landmark, color: Colors.primary },
      ];
    }
    const latest = OWNER_STATEMENTS[0];
    return [
      { label: 'Rental Income', value: `+${fmt(latest.rentalIncome)}`, icon: ArrowDownLeft, color: Colors.success },
      { label: 'Net Income', value: `+${fmt(latest.netIncome)}`, icon: ArrowUpRight, color: Colors.success },
      { label: 'Occupancy', value: `${latest.occupancyRate}%`, icon: Building2, color: Colors.primary },
    ];
  }, [activeRole]);

  const handleDownload = (statement: Statement) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Download Statement',
      `${statement.period} statement will be sent to your registered email.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => {
          logger.statements.log('Download requested:', statement.id);
          Alert.alert('Success', 'Your statement is being prepared. Check your email shortly.');
        }},
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Statements' }} />

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView} contentContainerStyle={styles.scrollContent}>

        {/* Role Selector */}
        <View style={styles.roleRow}>
          {(Object.keys(ROLE_CONFIG) as UserRole[]).map(role => {
            const cfg = ROLE_CONFIG[role];
            const Icon = cfg.icon;
            const active = role === activeRole;
            return (
              <TouchableOpacity
                key={role}
                style={[styles.roleTab, active && { borderColor: cfg.color, backgroundColor: cfg.color + '14' }]}
                onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveRole(role); setFilterType('all'); }}
                activeOpacity={0.8}
              >
                <Icon size={16} color={active ? cfg.color : Colors.textTertiary} />
                <Text style={[styles.roleTabText, active && { color: cfg.color }]}>{cfg.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Summary Banner */}
        <View style={styles.summaryBanner}>
          {summaryStats.map((stat, i) => (
            <React.Fragment key={stat.label}>
              {i > 0 && <View style={styles.summaryDivider} />}
              <View style={styles.summaryItem}>
                <View style={[styles.summaryIconBox, { backgroundColor: stat.color + '18' }]}>
                  <stat.icon size={14} color={stat.color} />
                </View>
                <Text style={[styles.summaryValue, { color: stat.color }]}>{stat.value}</Text>
                <Text style={styles.summaryLabel}>{stat.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* Type Filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
          {(['all', 'monthly', 'quarterly', 'annual'] as const).map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.filterPill, filterType === f && styles.filterPillActive]}
              onPress={() => setFilterType(f)}
            >
              <Text style={[styles.filterPillText, filterType === f && styles.filterPillTextActive]}>
                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Count */}
        <View style={styles.countRow}>
          <Text style={styles.countText}>{statements.length} statement{statements.length !== 1 ? 's' : ''}</Text>
          <Text style={styles.roleDescription}>{ROLE_CONFIG[activeRole].description}</Text>
        </View>

        {/* Statements List */}
        <View style={styles.list}>
          {statements.map(s => (
            <StatementCard key={s.id} statement={s} onDownload={handleDownload} />
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 140 },

  roleRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  roleTab: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface},
  roleTabText: { color: Colors.textTertiary, fontSize: 11, fontWeight: '600' as const, textAlign: 'center' },

  summaryBanner: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 14,
    alignItems: 'center'},
  summaryItem: { flex: 1, alignItems: 'center', gap: 4 },
  summaryDivider: { width: 1, height: 36, backgroundColor: Colors.surfaceBorder },
  summaryIconBox: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  summaryValue: { fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  summaryLabel: { fontSize: 10, color: Colors.textTertiary, textAlign: 'center' },

  filterScroll: { marginBottom: 12 },
  filterContent: { gap: 8, paddingRight: 4 },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  filterPillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterPillText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500' as const },
  filterPillTextActive: { color: '#000', fontWeight: '600' as const },

  countRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  countText: { color: Colors.textSecondary, fontSize: 13 },
  roleDescription: { color: Colors.textTertiary, fontSize: 12 },

  list: { gap: 10 },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden'},
  cardHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  cardIconBox: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  cardMain: { flex: 1 },
  cardPeriod: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginBottom: 4 },
  cardSubRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  typePillText: { fontSize: 10, fontWeight: '700' as const },
  cardDate: { color: Colors.textTertiary, fontSize: 11 },
  cardRight: { alignItems: 'flex-end' },
  metricValue: { fontSize: 13, fontWeight: '700' as const },
  metricLabel: { fontSize: 10, color: Colors.textTertiary, marginTop: 2 },

  expandedSection: { paddingHorizontal: 14, paddingBottom: 14 },
  expandDivider: { height: 1, backgroundColor: Colors.surfaceBorder, marginBottom: 12 },
  detailsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  detailItem: {
    width: '47%',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10,
    padding: 10},
  detailLabel: { color: Colors.textTertiary, fontSize: 11, marginBottom: 4 },
  detailValue: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },

  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.primary + '50',
    borderRadius: 10,
    paddingVertical: 9,
    backgroundColor: Colors.primary + '10'},
  downloadBtnText: { color: Colors.primary, fontSize: 13, fontWeight: '600' as const },
  scrollView: { backgroundColor: Colors.background }});
