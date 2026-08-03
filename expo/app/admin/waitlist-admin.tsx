import React, { useState, useCallback, useMemo } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Alert} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Users,
  UserCheck,
  UserX,
  Search,
  Filter,
  Download,
  ChevronDown,
  ChevronUp,
  Mail,
  Phone,
  ShieldCheck,
  ShieldX,
  BarChart3,
  RefreshCw,
  Calendar} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { fetchWaitlistStats, fetchWaitlistEntries, type WaitlistEntry } from '@/lib/waitlist-service';
import { exportCSV } from '@/lib/csv-export';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'verified', label: 'Verified' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'removed', label: 'Removed' },
];

const INVESTOR_TYPE_LABELS: Record<string, string> = {
  individual: 'Individual investor',
  corporate: 'Company / entity investor'};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  drivers_license: 'Driver\'s license',
  passport: 'Passport',
  national_id: 'National ID',
  tax_id: 'Tax ID / residency card'};

interface DetailRowConfig {
  label: string;
  value: string;
  color?: string;
  multiline?: boolean;
}

function formatDisplayValue(value: unknown): string {
  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : '—';
  }

  return '—';
}

function formatBooleanValue(value?: boolean | null): string {
  if (value === true) {
    return 'Yes';
  }

  if (value === false) {
    return 'No';
  }

  return '—';
}

function formatLabelValue(value?: string | null, labels?: Record<string, string>): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return '—';
  }

  return labels?.[trimmed] ?? trimmed.replace(/_/g, ' ');
}

function extractEmbeddedUrl(value?: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/https?:\/\/\S+/);
  if (!match?.[0]) {
    return null;
  }

  return match[0].replace(/[),.;]+$/, '');
}

function extractEmbeddedUploadName(value?: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/Upload:\s*([^\n·]+)/);
  return match?.[1]?.trim() || null;
}

async function openExternalUrl(url?: string | null): Promise<void> {
  if (!url) {
    return;
  }

  try {
    console.log('[WaitlistAdmin] Opening external URL:', url);
    await Linking.openURL(url);
  } catch (error) {
    console.log('[WaitlistAdmin] Failed to open URL:', (error as Error)?.message);
    Alert.alert('Unable to open file', 'The proof-of-funds link could not be opened on this device.');
  }
}

function StatCard({ icon: Icon, iconColor, label, value, subtitle }: {
  icon: React.ComponentType<{ size: number; color: string }>;
  iconColor: string;
  label: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <View style={cardStyles.statCard}>
      <View style={[cardStyles.statIcon, { backgroundColor: iconColor + '15' }]}>
        <Icon size={18} color={iconColor} />
      </View>
      <Text style={cardStyles.statValue}>{value}</Text>
      <Text style={cardStyles.statLabel}>{label}</Text>
      {subtitle ? <Text style={cardStyles.statSub}>{subtitle}</Text> : null}
    </View>
  );
}

function EntryCard({ entry }: { entry: WaitlistEntry }) {
  const [expanded, setExpanded] = useState(false);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'});
    } catch {
      return dateStr;
    }
  };

  const statusColor = entry.status === 'verified' ? '#00C48C'
    : entry.status === 'contacted' ? '#4A90D9'
    : entry.status === 'removed' ? '#FF4D4D'
    : Colors.warning;

  const renderDetailRow = ({ label, value, color, multiline }: DetailRowConfig) => (
    <View key={label} style={[cardStyles.detailRow, multiline && cardStyles.detailRowTop]}>
      <Text style={cardStyles.detailLabel}>{label}</Text>
      <Text style={[
        cardStyles.detailValue,
        multiline && cardStyles.detailValueWrap,
        color ? { color } : null,
      ]}>
        {value}
      </Text>
    </View>
  );

  const renderDocumentRow = (label: string, fileName?: string | null, url?: string | null, testID?: string) => (
    <View key={label} style={[cardStyles.detailRow, cardStyles.detailRowTop]}>
      <Text style={cardStyles.detailLabel}>{label}</Text>
      <View style={cardStyles.detailActionGroup}>
        <Text style={[cardStyles.detailValue, cardStyles.detailValueWrap]}>
          {formatDisplayValue(fileName || url)}
        </Text>
        {url ? (
          <TouchableOpacity
            style={cardStyles.detailLinkButton}
            onPress={() => { void openExternalUrl(url); }}
            activeOpacity={0.8}
            testID={testID}
          >
            <Text style={cardStyles.detailLinkButtonText}>Open file</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  const profileRows: DetailRowConfig[] = [
    { label: 'First Name', value: formatDisplayValue(entry.first_name) },
    { label: 'Last Name', value: formatDisplayValue(entry.last_name) },
    { label: 'Investor Type', value: formatLabelValue(entry.investor_type, INVESTOR_TYPE_LABELS) },
    { label: 'Membership Intent', value: formatLabelValue(entry.membership_interest) },
    { label: 'Accredited', value: formatLabelValue(entry.accredited_status) },
    { label: 'Investment Range', value: formatDisplayValue(entry.investment_range) },
    { label: 'Target Return', value: formatDisplayValue(entry.return_expectation) },
    { label: 'Best Time For Call', value: formatDisplayValue(entry.preferred_call_time || entry.best_time_for_call) },
    { label: 'Timeline', value: formatDisplayValue(entry.investment_timeline), multiline: true },
  ];

  const verificationRows: DetailRowConfig[] = [
    { label: 'Phone Verified', value: formatBooleanValue(entry.phone_verified), color: entry.phone_verified ? '#00C48C' : Colors.error },
    { label: 'Agreement Accepted', value: formatBooleanValue(entry.agreement_accepted), color: entry.agreement_accepted ? '#00C48C' : Colors.error },
    { label: 'Agreement Version', value: formatDisplayValue(entry.agreement_version) },
    { label: 'Typed Signature', value: formatDisplayValue(entry.signature_name) },
    { label: 'Submitted', value: formatDate(entry.submitted_at) },
    { label: 'Verified At', value: formatDate(entry.verified_at) },
  ];

  const complianceRows: DetailRowConfig[] = [
    { label: 'Primary ID', value: formatLabelValue(entry.primary_id_type, DOCUMENT_TYPE_LABELS) },
    { label: 'Primary ID Ref', value: formatDisplayValue(entry.primary_id_reference), multiline: true },
    { label: 'Secondary ID', value: formatLabelValue(entry.secondary_id_type, DOCUMENT_TYPE_LABELS) },
    { label: 'Secondary ID Ref', value: formatDisplayValue(entry.secondary_id_reference), multiline: true },
    { label: 'Issuing Country', value: formatDisplayValue(entry.document_issuing_country) },
    { label: 'Tax Residency', value: formatDisplayValue(entry.tax_residency_country) },
    { label: 'Tax ID Ref', value: formatDisplayValue(entry.tax_id_reference), multiline: true },
    { label: 'Tax Reporting Ack', value: formatBooleanValue(entry.legal_ack_tax_reporting), color: entry.legal_ack_tax_reporting ? '#00C48C' : Colors.error },
    { label: 'Identity Review Ack', value: formatBooleanValue(entry.legal_ack_identity_review), color: entry.legal_ack_identity_review ? '#00C48C' : Colors.error },
    { label: 'Entity Authority Ack', value: formatBooleanValue(entry.legal_ack_entity_authority), color: entry.legal_ack_entity_authority ? '#00C48C' : Colors.error },
  ];

  const corporateRows: DetailRowConfig[] = entry.investor_type === 'corporate'
    ? [
      { label: 'Company Name', value: formatDisplayValue(entry.company_name), multiline: true },
      { label: 'Signer Role', value: formatDisplayValue(entry.company_role) },
      { label: 'EIN', value: formatDisplayValue(entry.company_ein) },
      { label: 'Company Tax ID', value: formatDisplayValue(entry.company_tax_id), multiline: true },
      { label: 'Registration Country', value: formatDisplayValue(entry.company_registration_country) },
      { label: 'Beneficial Owner', value: formatDisplayValue(entry.beneficial_owner_name), multiline: true },
    ]
    : [];

  const attributionRows: DetailRowConfig[] = [
    { label: 'Source', value: formatDisplayValue(entry.source) },
    { label: 'Page Path', value: formatDisplayValue(entry.page_path), multiline: true },
    { label: 'Referrer', value: formatDisplayValue(entry.referrer), multiline: true },
    { label: 'UTM Source', value: formatDisplayValue(entry.utm_source) },
    { label: 'UTM Medium', value: formatDisplayValue(entry.utm_medium) },
    { label: 'UTM Campaign', value: formatDisplayValue(entry.utm_campaign) },
    { label: 'UTM Content', value: formatDisplayValue(entry.utm_content), multiline: true },
    { label: 'UTM Term', value: formatDisplayValue(entry.utm_term), multiline: true },
  ];

  const primaryIdUploadUrl = entry.primary_id_upload_url || extractEmbeddedUrl(entry.primary_id_reference);
  const primaryIdUploadName = entry.primary_id_upload_name || extractEmbeddedUploadName(entry.primary_id_reference);
  const secondaryIdUploadUrl = entry.secondary_id_upload_url || extractEmbeddedUrl(entry.secondary_id_reference);
  const secondaryIdUploadName = entry.secondary_id_upload_name || extractEmbeddedUploadName(entry.secondary_id_reference);
  const taxDocumentUploadUrl = entry.tax_document_upload_url || extractEmbeddedUrl(entry.tax_id_reference);
  const taxDocumentUploadName = entry.tax_document_upload_name || extractEmbeddedUploadName(entry.tax_id_reference);

  const badges: { label: string; accent: string }[] = [];
  const investorType = formatLabelValue(entry.investor_type, INVESTOR_TYPE_LABELS);
  const membershipIntent = formatLabelValue(entry.membership_interest);
  const investmentRange = formatDisplayValue(entry.investment_range);
  const returnExpectation = formatDisplayValue(entry.return_expectation);

  if (investorType !== '—') {
    badges.push({ label: investorType, accent: '#4A90D9' });
  }
  if (membershipIntent !== '—') {
    badges.push({ label: membershipIntent, accent: Colors.primary });
  }
  if (investmentRange !== '—') {
    badges.push({ label: investmentRange, accent: '#8B5CF6' });
  }
  if (returnExpectation !== '—') {
    badges.push({ label: returnExpectation, accent: '#00C48C' });
  }
  if (entry.agreement_accepted) {
    badges.push({ label: `Agreement ${formatDisplayValue(entry.agreement_version)}`, accent: '#F59E0B' });
  }

  return (
    <TouchableOpacity
      style={cardStyles.entryCard}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.7}
      testID={`waitlist-entry-${entry.id}`}
    >
      <View style={cardStyles.entryTop}>
        <View style={cardStyles.entryLeft}>
          <Text style={cardStyles.entryName}>{entry.full_name || '—'}</Text>
          <View style={cardStyles.entryMeta}>
            <Mail size={11} color={Colors.textTertiary} />
            <Text style={cardStyles.entryMetaText}>{entry.email || '—'}</Text>
          </View>
          <View style={cardStyles.entryMeta}>
            <Phone size={11} color={Colors.textTertiary} />
            <Text style={cardStyles.entryMetaText}>{entry.phone_e164 || entry.phone || '—'}</Text>
          </View>
        </View>
        <View style={cardStyles.entryRight}>
          <View style={[cardStyles.statusBadge, { backgroundColor: statusColor + '18' }]}>
            <Text style={[cardStyles.statusText, { color: statusColor }]}>{entry.status}</Text>
          </View>
          {entry.phone_verified ? (
            <ShieldCheck size={14} color="#00C48C" />
          ) : (
            <ShieldX size={14} color={Colors.textTertiary} />
          )}
          <Text style={cardStyles.entryDate}>{formatDate(entry.created_at)}</Text>
        </View>
      </View>

      {expanded && (
        <View style={cardStyles.entryExpanded}>
          {badges.length > 0 ? (
            <View style={cardStyles.badgeRow}>
              {badges.map((badge) => (
                <View key={badge.label} style={[cardStyles.detailBadge, { backgroundColor: `${badge.accent}18`, borderColor: `${badge.accent}38` }]}>
                  <Text style={[cardStyles.detailBadgeText, { color: badge.accent }]}>{badge.label}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={cardStyles.detailSection}>
            <Text style={cardStyles.detailSectionTitle}>Investor profile</Text>
            {profileRows.map(renderDetailRow)}
          </View>

          <View style={cardStyles.detailSection}>
            <Text style={cardStyles.detailSectionTitle}>Verification + agreement</Text>
            {verificationRows.map(renderDetailRow)}
            <View style={[cardStyles.detailRow, cardStyles.detailRowTop]}>
              <Text style={cardStyles.detailLabel}>Proof of Funds</Text>
              <View style={cardStyles.detailActionGroup}>
                <Text style={[cardStyles.detailValue, cardStyles.detailValueWrap]}>
                  {formatDisplayValue(entry.proof_of_funds_name || entry.proof_of_funds_url)}
                </Text>
                {entry.proof_of_funds_url ? (
                  <TouchableOpacity
                    style={cardStyles.detailLinkButton}
                    onPress={() => { void openExternalUrl(entry.proof_of_funds_url); }}
                    activeOpacity={0.8}
                    testID={`waitlist-proof-link-${entry.id}`}
                  >
                    <Text style={cardStyles.detailLinkButtonText}>Open file</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>

          <View style={cardStyles.detailSection}>
            <Text style={cardStyles.detailSectionTitle}>Compliance review</Text>
            {complianceRows.map(renderDetailRow)}
          </View>

          <View style={cardStyles.detailSection}>
            <Text style={cardStyles.detailSectionTitle}>Uploaded documents</Text>
            {renderDocumentRow('Primary ID File', primaryIdUploadName, primaryIdUploadUrl, `waitlist-primary-id-link-${entry.id}`)}
            {renderDocumentRow('Secondary ID File', secondaryIdUploadName, secondaryIdUploadUrl, `waitlist-secondary-id-link-${entry.id}`)}
            {renderDocumentRow(entry.investor_type === 'corporate' ? 'Company Tax File' : 'SSN / Tax File', taxDocumentUploadName, taxDocumentUploadUrl, `waitlist-tax-doc-link-${entry.id}`)}
          </View>

          {corporateRows.length > 0 ? (
            <View style={cardStyles.detailSection}>
              <Text style={cardStyles.detailSectionTitle}>Corporate details</Text>
              {corporateRows.map(renderDetailRow)}
            </View>
          ) : null}

          <View style={cardStyles.detailSection}>
            <Text style={cardStyles.detailSectionTitle}>Attribution</Text>
            {attributionRows.map(renderDetailRow)}
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function WaitlistAdminScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  const statsQuery = useQuery({
    queryKey: ['waitlist-admin-stats'],
    queryFn: fetchWaitlistStats,
    staleTime: 15000});

  const entriesQuery = useQuery({
    queryKey: ['waitlist-admin-entries', searchText, statusFilter],
    queryFn: () => fetchWaitlistEntries({ search: searchText, status: statusFilter, limit: 100 }),
    staleTime: 10000});

  const stats = statsQuery.data ?? { total: 0, today: 0, verified: 0, unverified: 0, topCampaigns: [] };
  const entries = entriesQuery.data?.entries ?? [];
  const totalEntries = entriesQuery.data?.total ?? 0;

  const handleRefresh = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void queryClient.invalidateQueries({ queryKey: ['waitlist-admin-stats'] });
    void queryClient.invalidateQueries({ queryKey: ['waitlist-admin-entries'] });
  }, [queryClient]);

  const handleExportCSV = useCallback(async () => {
    const currentEntries = entriesQuery.data?.entries ?? [];
    if (currentEntries.length === 0) {
      Alert.alert('No Data', 'No waitlist entries to export.');
      return;
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const headers = [
      'Created At', 'Submitted At', 'Verified At', 'Status', 'Full Name', 'First Name', 'Last Name',
      'Email', 'Phone', 'Phone Verified', 'Investor Type', 'Membership Intent', 'Accredited Status',
      'Investment Range', 'Target Return', 'Best Time For Call', 'Investment Timeline',
      'Agreement Accepted', 'Agreement Version', 'Typed Signature', 'Proof Of Funds Name', 'Proof Of Funds URL',
      'Primary ID Type', 'Primary ID Reference', 'Primary ID Upload Name', 'Primary ID Upload URL',
      'Secondary ID Type', 'Secondary ID Reference', 'Secondary ID Upload Name', 'Secondary ID Upload URL',
      'Document Issuing Country', 'Tax Residency Country', 'Tax ID Reference', 'Tax Document Upload Name', 'Tax Document Upload URL',
      'Tax Reporting Ack', 'Identity Review Ack', 'Entity Authority Ack',
      'Company Name', 'Signer Role', 'Company EIN', 'Company Tax ID', 'Company Registration Country', 'Beneficial Owner Name',
      'Source', 'Page Path', 'Referrer', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term',
    ];
    const rows = currentEntries.map(e => [
      e.created_at,
      e.submitted_at,
      e.verified_at || '',
      e.status,
      e.full_name,
      e.first_name || '',
      e.last_name || '',
      e.email,
      e.phone_e164 || e.phone,
      formatBooleanValue(e.phone_verified),
      formatLabelValue(e.investor_type, INVESTOR_TYPE_LABELS),
      formatLabelValue(e.membership_interest),
      formatLabelValue(e.accredited_status),
      e.investment_range || '',
      e.return_expectation || '',
      e.preferred_call_time || e.best_time_for_call || '',
      e.investment_timeline || '',
      formatBooleanValue(e.agreement_accepted),
      e.agreement_version || '',
      e.signature_name || '',
      e.proof_of_funds_name || '',
      e.proof_of_funds_url || '',
      formatLabelValue(e.primary_id_type, DOCUMENT_TYPE_LABELS),
      e.primary_id_reference || '',
      e.primary_id_upload_name || extractEmbeddedUploadName(e.primary_id_reference) || '',
      e.primary_id_upload_url || extractEmbeddedUrl(e.primary_id_reference) || '',
      formatLabelValue(e.secondary_id_type, DOCUMENT_TYPE_LABELS),
      e.secondary_id_reference || '',
      e.secondary_id_upload_name || extractEmbeddedUploadName(e.secondary_id_reference) || '',
      e.secondary_id_upload_url || extractEmbeddedUrl(e.secondary_id_reference) || '',
      e.document_issuing_country || '',
      e.tax_residency_country || '',
      e.tax_id_reference || '',
      e.tax_document_upload_name || extractEmbeddedUploadName(e.tax_id_reference) || '',
      e.tax_document_upload_url || extractEmbeddedUrl(e.tax_id_reference) || '',
      formatBooleanValue(e.legal_ack_tax_reporting),
      formatBooleanValue(e.legal_ack_identity_review),
      formatBooleanValue(e.legal_ack_entity_authority),
      e.company_name || '',
      e.company_role || '',
      e.company_ein || '',
      e.company_tax_id || '',
      e.company_registration_country || '',
      e.beneficial_owner_name || '',
      e.source,
      e.page_path || '',
      e.referrer || '',
      e.utm_source || '',
      e.utm_medium || '',
      e.utm_campaign || '',
      e.utm_content || '',
      e.utm_term || '',
    ]);

    const count = rows.length;
    const success = await exportCSV(headers, rows, `waitlist_export_${Date.now()}`);
    if (success) {
      Alert.alert('Export Complete', `Exported ${count} entries.`);
    }
  }, [entriesQuery.data?.entries]);

  const debouncedSearch = useMemo(() => {
    let timeout: ReturnType<typeof setTimeout>;
    return (text: string) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => setSearchText(text), 400);
    };
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Users size={20} color={Colors.primary} />
          <Text style={styles.headerTitle}>Waitlist Admin</Text>
        </View>
        <TouchableOpacity onPress={handleRefresh} style={styles.refreshBtn}>
          <RefreshCw size={18} color={statsQuery.isFetching ? Colors.textTertiary : Colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={statsQuery.isFetching && entriesQuery.isFetching}
            onRefresh={handleRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={styles.statsGrid}>
          <StatCard icon={Users} iconColor={Colors.primary} label="Total" value={stats.total} />
          <StatCard icon={Calendar} iconColor="#00C48C" label="Today" value={stats.today} />
          <StatCard icon={UserCheck} iconColor="#4A90D9" label="Verified" value={stats.verified} />
          <StatCard icon={UserX} iconColor={Colors.error} label="Unverified" value={stats.unverified} />
        </View>

        {stats.topCampaigns.length > 0 && (
          <View style={styles.campaignsCard}>
            <View style={styles.campaignsHeader}>
              <BarChart3 size={16} color={Colors.primary} />
              <Text style={styles.campaignsTitle}>Top Campaigns</Text>
            </View>
            {stats.topCampaigns.map((c, i) => (
              <View key={c.campaign} style={styles.campaignRow}>
                <Text style={styles.campaignRank}>#{i + 1}</Text>
                <View style={styles.campaignInfo}>
                  <Text style={styles.campaignName}>{c.campaign}</Text>
                  <View style={styles.campaignBar}>
                    <View style={[styles.campaignBarFill, {
                      width: `${Math.min(100, (c.count / Math.max(stats.topCampaigns[0]?.count ?? 1, 1)) * 100)}%`}]} />
                  </View>
                </View>
                <Text style={styles.campaignCount}>{c.count}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.searchSection}>
          <View style={styles.searchBar}>
            <Search size={16} color={Colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search name, email, or phone..."
              placeholderTextColor={Colors.inputPlaceholder}
              onChangeText={debouncedSearch}
              autoCapitalize="none"
              autoCorrect={false}
              testID="waitlist-admin-search"
            />
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.filterBtn}
              onPress={() => setShowFilters(!showFilters)}
              activeOpacity={0.7}
            >
              <Filter size={14} color={Colors.primary} />
              <Text style={styles.filterBtnText}>
                {statusFilter === 'all' ? 'Filter' : statusFilter}
              </Text>
              {showFilters ? <ChevronUp size={14} color={Colors.textSecondary} /> : <ChevronDown size={14} color={Colors.textSecondary} />}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.exportBtn}
              onPress={handleExportCSV}
              activeOpacity={0.7}
            >
              <Download size={14} color="#00C48C" />
              <Text style={styles.exportBtnText}>Export CSV</Text>
            </TouchableOpacity>
          </View>

          {showFilters && (
            <View style={styles.filterRow}>
              {STATUS_FILTERS.map((f) => (
                <TouchableOpacity
                  key={f.value}
                  style={[styles.filterChip, statusFilter === f.value && styles.filterChipActive]}
                  onPress={() => { setStatusFilter(f.value); setShowFilters(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.filterChipText, statusFilter === f.value && styles.filterChipTextActive]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <View style={styles.entriesHeader}>
          <Text style={styles.entriesTitle}>Entries</Text>
          <Text style={styles.entriesCount}>{totalEntries} total</Text>
        </View>

        {entriesQuery.isLoading ? (
          <View style={styles.loadingWrap}>
            <ShimmerIndicator size="small" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading entries...</Text>
          </View>
        ) : entries.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Users size={40} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>No Entries Found</Text>
            <Text style={styles.emptyText}>
              {searchText || statusFilter !== 'all'
                ? 'Try adjusting your search or filters.'
                : 'Waitlist submissions will appear here.'}
            </Text>
          </View>
        ) : (
          entries.map((entry) => (
            <EntryCard key={entry.id || entry.email} entry={entry} />
          ))
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const cardStyles = StyleSheet.create({
  statCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    minWidth: 80},
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8},
  statValue: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text,
    marginBottom: 2},
  statLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  statSub: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 2},
  entryCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border},
  entryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between'},
  entryLeft: {
    flex: 1,
    gap: 4},
  entryRight: {
    alignItems: 'flex-end',
    gap: 6},
  entryName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text},
  entryMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5},
  entryMetaText: {
    fontSize: 12,
    color: Colors.textSecondary},
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6},
  statusText: {
    fontSize: 10,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  entryDate: {
    fontSize: 10,
    color: Colors.textTertiary},
  entryExpanded: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 10},
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8},
  detailBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1},
  detailBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'capitalize' as const},
  detailSection: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 12,
    gap: 8},
  detailSectionTitle: {
    fontSize: 12,
    fontWeight: '800' as const,
    color: Colors.text,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    marginBottom: 2},
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12},
  detailRowTop: {
    alignItems: 'flex-start'},
  detailLabel: {
    flex: 0.95,
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '500' as const},
  detailValue: {
    flex: 1.2,
    fontSize: 12,
    color: Colors.text,
    fontWeight: '600' as const,
    textAlign: 'right' as const},
  detailValueWrap: {
    flexShrink: 1,
    lineHeight: 18},
  detailActionGroup: {
    flex: 1.2,
    alignItems: 'flex-end',
    gap: 8},
  detailLinkButton: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: Colors.primary + '18',
    borderWidth: 1,
    borderColor: Colors.primary + '35'},
  detailLinkButtonText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.primary}});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12},
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.card,
    justifyContent: 'center',
    alignItems: 'center'},
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text},
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border},
  content: {
    flex: 1},
  statsGrid: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12},
  campaignsCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border},
  campaignsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12},
  campaignsTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text},
  campaignRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8},
  campaignRank: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.textTertiary,
    width: 24},
  campaignInfo: {
    flex: 1,
    gap: 4},
  campaignName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text},
  campaignBar: {
    height: 4,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 2},
  campaignBarFill: {
    height: 4,
    backgroundColor: Colors.primary,
    borderRadius: 2},
  campaignCount: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.primary,
    width: 30,
    textAlign: 'right' as const},
  searchSection: {
    paddingHorizontal: 16,
    marginBottom: 12},
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: 14,
    height: 44,
    gap: 10,
    marginBottom: 8},
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    fontWeight: '500' as const,
    height: 44},
  actionRow: {
    flexDirection: 'row',
    gap: 8},
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border},
  filterBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
    textTransform: 'capitalize' as const},
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#00C48C12',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#00C48C30'},
  exportBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#00C48C'},
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8},
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border},
  filterChipActive: {
    backgroundColor: Colors.primary + '20',
    borderColor: Colors.primary},
  filterChipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  filterChipTextActive: {
    color: Colors.primary},
  entriesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 10},
  entriesTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text},
  entriesCount: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '500' as const},
  loadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 40},
  loadingText: {
    fontSize: 13,
    color: Colors.textSecondary},
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 50,
    gap: 8},
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text},
  emptyText: {
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: 'center' as const,
    paddingHorizontal: 40,
    lineHeight: 19}});
