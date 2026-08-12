import React, { useState, useCallback, useMemo } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Animated,
  RefreshControl,
  Platform} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useScreenFocusState } from '@/hooks/useScreenFocusState';
import {
  ArrowLeft,
  Search,
  MapPin,
  Globe,
  DollarSign,
  Users,
  Clock,
  Zap,
  Eye,
  Mail,
  Phone,
  ChevronDown,
  Wallet,
  Shield,
  RefreshCw,
  List,
  LayoutGrid,
  Target,
  Briefcase,
  Copy,
  Check} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { supabase } from '@/lib/supabase';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type FilterType = 'all' | 'user' | 'waitlist';
type SortType = 'date' | 'name' | 'country';
type ViewMode = 'cards' | 'table';

interface SignupRecord {
  id: string;
  type: 'user' | 'waitlist';
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  source: string;
  investmentInterest: string;
  status: string;
  kycStatus: string;
  totalInvested: number;
  walletBalance: number;
  createdAt: string;
}

const INTEREST_LABELS: Record<string, string> = {
  'under_1k': 'Under $1K',
  '1k_10k': '$1K – $10K',
  '10k_50k': '$10K – $50K',
  '50k_plus': '$50K+',
  'active_investor': 'Active Investor',
  'registered': 'Just Registered'};

const INTEREST_COLORS: Record<string, string> = {
  'under_1k': '#7CB342',
  '1k_10k': '#0097A7',
  '10k_50k': '#F57C00',
  '50k_plus': '#E91E63',
  'active_investor': '#00C48C',
  'registered': '#9E9E9E'};

const LEAD_INTELLIGENCE_REFRESH_MS = 1000 * 60;

function formatInterest(raw: string): string {
  return INTEREST_LABELS[raw] || raw.replace(/_/g, ' ');
}

function getInterestColor(raw: string): string {
  return INTEREST_COLORS[raw] || Colors.accent;
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatCurrency(val: number): string {
  if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
  if (val >= 1000) return `${new Intl.NumberFormat('en-US').format(Math.round(val))}`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getTypeBadge(type: string): { label: string; color: string; bg: string } {
  if (type === 'user') return { label: 'Registered', color: '#00C48C', bg: '#00C48C18' };
  return { label: 'Waitlist', color: '#F57C00', bg: '#F57C0018' };
}

function getStatusColor(status: string): string {
  if (status === 'active') return '#00C48C';
  if (status === 'waitlist') return '#F57C00';
  if (status === 'suspended') return '#E53935';
  return Colors.textTertiary;
}

function getKycBadge(kyc: string): { label: string; color: string } {
  if (kyc === 'approved') return { label: 'Verified', color: '#00C48C' };
  if (kyc === 'in_review') return { label: 'In Review', color: '#F9A825' };
  if (kyc === 'pending') return { label: 'Pending', color: Colors.textTertiary };
  if (kyc === 'rejected') return { label: 'Rejected', color: '#E53935' };
  return { label: '', color: Colors.textTertiary };
}

export default function LeadIntelligence() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const isScreenFocused = useScreenFocusState(true);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortType>('date');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pulseAnim] = useState(new Animated.Value(1));

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  const signupsQuery = useQuery<{ signups: SignupRecord[]; total: number; stats: { totalSignups: number; totalUsers: number; totalWaitlist: number; byCountry: Array<{ country: string; count: number }> } | null } | null>({
    queryKey: ['analytics.getAllSignups', { page: 1, limit: 200, type: activeFilter, search: searchQuery || undefined, sortBy, sortOrder: 'desc' }],
    queryFn: async () => {
      console.log('[Supabase] Fetching all signups');
      const { data, error } = await supabase.from('signups').select('*').limit(200);
      if (error) { console.log('[Supabase] signups error:', error.message); return null; }
      const signups = (data ?? []) as SignupRecord[];
      const countryCounts: Record<string, number> = {};
      signups.forEach((s) => { const c = s.country || 'Unknown'; countryCounts[c] = (countryCounts[c] || 0) + 1; });
      const byCountry = Object.entries(countryCounts).map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count);
      return {
        signups,
        total: signups.length,
        stats: {
          totalSignups: signups.length,
          totalUsers: signups.filter((s) => s.type === 'user').length,
          totalWaitlist: signups.filter((s) => s.type === 'waitlist').length,
          byCountry}};
    },
    staleTime: LEAD_INTELLIGENCE_REFRESH_MS,
    refetchInterval: isScreenFocused ? LEAD_INTELLIGENCE_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1000});

  React.useEffect(() => {
    if (signupsQuery.error) {
      console.log('[LeadIntelligence] Query error:', JSON.stringify(signupsQuery.error, null, 2));
    }
    if (signupsQuery.data) {
      console.log('[LeadIntelligence] Query success:', signupsQuery.data.total, 'leads,', signupsQuery.data.signups?.length, 'in page');
    }
    console.log('[LeadIntelligence] Query status:', signupsQuery.status, 'fetchStatus:', signupsQuery.fetchStatus);
  }, [signupsQuery.error, signupsQuery.data, signupsQuery.status, signupsQuery.fetchStatus]);

  const signups: SignupRecord[] = (signupsQuery.data?.signups as SignupRecord[]) || [];
  const stats = signupsQuery.data?.stats;
  const total = signupsQuery.data?.total ?? 0;

  const toggleExpand = useCallback((id: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  const onRefresh = useCallback(() => {
    void signupsQuery.refetch();
  }, [signupsQuery]);

  const copyToClipboard = useCallback(async (text: string, id: string) => {
    try {
      if (Platform.OS === 'web') {
        await navigator.clipboard.writeText(text);
      }
      setCopiedId(id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      console.log('[Lead] Copy failed:', e);
    }
  }, []);

  const FILTERS: { key: FilterType; label: string; count?: number }[] = useMemo(() => [
    { key: 'all', label: 'All Leads', count: stats?.totalSignups },
    { key: 'user', label: 'Registered', count: stats?.totalUsers },
    { key: 'waitlist', label: 'Waitlist', count: stats?.totalWaitlist },
  ], [stats]);

  const SORTS: { key: SortType; label: string }[] = [
    { key: 'date', label: 'Date' },
    { key: 'name', label: 'Name' },
    { key: 'country', label: 'Country' },
  ];

  const signupsRef = signupsQuery.data?.signups;
  const usersWithInvestments = useMemo(() => (signupsRef ?? []).filter((s: SignupRecord) => s.totalInvested > 0).length, [signupsRef]);
  const totalInvestedSum = useMemo(() => (signupsRef ?? []).reduce((acc: number, s: SignupRecord) => acc + s.totalInvested, 0), [signupsRef]);

  const interestBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    (signupsRef ?? []).forEach((s: SignupRecord) => {
      const key = s.investmentInterest || 'unknown';
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([interest, count]) => ({ interest, count }));
  }, [signupsRef]);

  const leadsWithPhone = useMemo(() => (signupsRef ?? []).filter((s: SignupRecord) => s.phone && s.phone.length > 0).length, [signupsRef]);
  const leadsWithEmail = useMemo(() => (signupsRef ?? []).filter((s: SignupRecord) => s.email && s.email.length > 0).length, [signupsRef]);

  const renderTableRow = useCallback((signup: SignupRecord, index: number) => {
    const typeBadge = getTypeBadge(signup.type);
    return (
      <View key={signup.id} style={[styles.tableRow, index % 2 === 0 && styles.tableRowAlt]}>
        <View style={styles.tableCell1}>
          <Text style={styles.tableRowNum}>{index + 1}</Text>
        </View>
        <View style={styles.tableCell2}>
          <Text style={styles.tableName} numberOfLines={1}>{signup.firstName} {signup.lastName}</Text>
          <View style={[styles.tableTypePill, { backgroundColor: typeBadge.bg }]}>
            <Text style={[styles.tableTypeText, { color: typeBadge.color }]}>{typeBadge.label}</Text>
          </View>
        </View>
        <View style={styles.tableCell3}>
          <TouchableOpacity
            style={styles.tableCopyRow}
            onPress={() => copyToClipboard(signup.email, `email-${signup.id}`)}
          >
            <Mail size={10} color="#4A90D9" />
            <Text style={styles.tableEmail} numberOfLines={1}>{signup.email}</Text>
            {copiedId === `email-${signup.id}` ? (
              <Check size={10} color="#00C48C" />
            ) : (
              <Copy size={10} color={Colors.textTertiary} />
            )}
          </TouchableOpacity>
          {signup.phone ? (
            <TouchableOpacity
              style={styles.tableCopyRow}
              onPress={() => copyToClipboard(signup.phone, `phone-${signup.id}`)}
            >
              <Phone size={10} color="#00C48C" />
              <Text style={styles.tablePhone} numberOfLines={1}>{signup.phone}</Text>
              {copiedId === `phone-${signup.id}` ? (
                <Check size={10} color="#00C48C" />
              ) : (
                <Copy size={10} color={Colors.textTertiary} />
              )}
            </TouchableOpacity>
          ) : (
            <Text style={styles.tableNoPhone}>No phone</Text>
          )}
        </View>
        <View style={styles.tableCell4}>
          {signup.country ? (
            <Text style={styles.tableCountry} numberOfLines={1}>{signup.country}</Text>
          ) : (
            <Text style={styles.tableNoData}>—</Text>
          )}
          <Text style={styles.tableInterest} numberOfLines={1}>
            {formatInterest(signup.investmentInterest)}
          </Text>
        </View>
        <View style={styles.tableCell5}>
          <Text style={styles.tableDate}>{formatDate(signup.createdAt)}</Text>
        </View>
      </View>
    );
  }, [copiedId, copyToClipboard]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Lead Intelligence</Text>
          <View style={styles.liveTag}>
            <Animated.View style={[styles.liveDot, { transform: [{ scale: pulseAnim }] }]} />
            <Text style={styles.liveTagText}>LIVE</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.viewToggle}
          onPress={() => {
            setViewMode(prev => prev === 'cards' ? 'table' : 'cards');
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
        >
          {viewMode === 'cards' ? (
            <List size={18} color={Colors.text} />
          ) : (
            <LayoutGrid size={18} color={Colors.text} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={signupsQuery.isRefetching}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={styles.heroCard}>
          <View style={styles.heroIconWrap}>
            <Users size={24} color="#fff" />
          </View>
          <View style={styles.heroContent}>
            <Text style={styles.heroLabel}>TOTAL LEADS</Text>
            <Text style={styles.heroValue}>{stats?.totalSignups ?? '—'}</Text>
          </View>
          <View style={styles.heroBreakdownCol}>
            <View style={styles.heroBreakdownItem}>
              <View style={[styles.heroBreakdownDot, { backgroundColor: '#00C48C' }]} />
              <Text style={styles.heroBreakdownText}>{stats?.totalUsers ?? 0} Registered</Text>
            </View>
            <View style={styles.heroBreakdownItem}>
              <View style={[styles.heroBreakdownDot, { backgroundColor: '#F57C00' }]} />
              <Text style={styles.heroBreakdownText}>{stats?.totalWaitlist ?? 0} Waitlist</Text>
            </View>
          </View>
        </View>

        <View style={styles.kpiRow}>
          <View style={[styles.kpiCard, { borderLeftColor: '#4A90D9' }]}>
            <Mail size={14} color="#4A90D9" />
            <Text style={styles.kpiValue}>{leadsWithEmail}</Text>
            <Text style={styles.kpiLabel}>With Email</Text>
          </View>
          <View style={[styles.kpiCard, { borderLeftColor: '#00C48C' }]}>
            <Phone size={14} color="#00C48C" />
            <Text style={styles.kpiValue}>{leadsWithPhone}</Text>
            <Text style={styles.kpiLabel}>With Phone</Text>
          </View>
          <View style={[styles.kpiCard, { borderLeftColor: '#F57C00' }]}>
            <DollarSign size={14} color="#F57C00" />
            <Text style={styles.kpiValue}>{usersWithInvestments}</Text>
            <Text style={styles.kpiLabel}>Investors</Text>
          </View>
          <View style={[styles.kpiCard, { borderLeftColor: '#E91E63' }]}>
            <Wallet size={14} color="#E91E63" />
            <Text style={styles.kpiValue}>{totalInvestedSum > 0 ? formatCurrency(totalInvestedSum) : '$0'}</Text>
            <Text style={styles.kpiLabel}>Invested</Text>
          </View>
        </View>

        {interestBreakdown.length > 0 && (
          <View style={styles.interestCard}>
            <View style={styles.interestHeader}>
              <Target size={14} color="#7B61FF" />
              <Text style={styles.interestTitle}>What They Want to Do</Text>
            </View>
            <View style={styles.interestList}>
              {interestBreakdown.map((item) => {
                const maxCount = interestBreakdown[0]?.count || 1;
                const pct = Math.round((item.count / maxCount) * 100);
                const color = getInterestColor(item.interest);
                return (
                  <View key={item.interest} style={styles.interestRow}>
                    <View style={[styles.interestIcon, { backgroundColor: color + '18' }]}>
                      <Briefcase size={12} color={color} />
                    </View>
                    <View style={styles.interestInfo}>
                      <View style={styles.interestTopRow}>
                        <Text style={styles.interestLabel}>{formatInterest(item.interest)}</Text>
                        <Text style={[styles.interestCount, { color }]}>{item.count}</Text>
                      </View>
                      <View style={styles.interestBarBg}>
                        <View style={[styles.interestBarFill, { width: `${Math.max(pct, 5)}%` as any, backgroundColor: color }]} />
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {stats && stats.byCountry.length > 0 && (
          <View style={styles.breakdownCard}>
            <View style={styles.breakdownHeader}>
              <Globe size={14} color="#0097A7" />
              <Text style={styles.breakdownTitle}>Top Countries</Text>
            </View>
            <View style={styles.breakdownList}>
              {stats.byCountry.slice(0, 5).map((c, i) => (
                <View key={c.country} style={styles.breakdownItem}>
                  <Text style={styles.breakdownRank}>#{i + 1}</Text>
                  <Text style={styles.breakdownName}>{c.country}</Text>
                  <View style={styles.breakdownBarBg}>
                    <View
                      style={[
                        styles.breakdownBarFill,
                        {
                          width: `${Math.round((c.count / (stats.totalSignups || 1)) * 100)}%` as any,
                          backgroundColor: i === 0 ? '#4A90D9' : i === 1 ? '#0097A7' : '#00C48C'},
                      ]}
                    />
                  </View>
                  <Text style={styles.breakdownCount}>{c.count}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.searchBar}>
          <Search size={15} color={Colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search name, email, phone, country..."
            placeholderTextColor={Colors.textTertiary}
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterRowContent}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterChip, activeFilter === f.key && styles.filterChipActive]}
              onPress={() => {
                setActiveFilter(f.key);
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            >
              <Text style={[styles.filterChipText, activeFilter === f.key && styles.filterChipTextActive]}>
                {f.label}{f.count !== undefined ? ` (${f.count})` : ''}
              </Text>
            </TouchableOpacity>
          ))}
          <View style={styles.sortDivider} />
          {SORTS.map(s => (
            <TouchableOpacity
              key={s.key}
              style={[styles.sortChip, sortBy === s.key && styles.sortChipActive]}
              onPress={() => {
                setSortBy(s.key);
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            >
              <Text style={[styles.sortChipText, sortBy === s.key && styles.sortChipTextActive]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.leadsHeader}>
          <Text style={styles.leadsHeaderText}>{total} leads found</Text>
          <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn}>
            <RefreshCw size={14} color={Colors.textTertiary} />
          </TouchableOpacity>
        </View>

        {signupsQuery.isLoading && (
          <View style={styles.loadingContainer}>
            <ShimmerIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading leads from database...</Text>
          </View>
        )}

        {signupsQuery.isError && (
          <View style={styles.errorContainer}>
            <View style={styles.errorIconWrap}>
              <Shield size={28} color="#E53935" />
            </View>
            <Text style={styles.errorTitle}>Failed to load leads</Text>
            <Text style={styles.errorText}>
              {(signupsQuery.error as any)?.message || 'Connection error — check your network and try again'}
            </Text>
            <TouchableOpacity style={styles.retryBtn} onPress={onRefresh}>
              <RefreshCw size={14} color="#fff" />
              <Text style={styles.retryBtnText}>Retry Now</Text>
            </TouchableOpacity>
          </View>
        )}

        {!signupsQuery.isLoading && !signupsQuery.isError && signups.length === 0 && (
          <View style={styles.emptyContainer}>
            <Users size={40} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>No leads found</Text>
            <Text style={styles.emptyText}>
              {searchQuery ? 'Try a different search term' : 'Leads will appear here in real-time'}
            </Text>
          </View>
        )}

        {viewMode === 'table' && signups.length > 0 && (
          <View style={styles.tableContainer}>
            <View style={styles.tableHeader}>
              <View style={styles.tableCell1}><Text style={styles.tableHeaderText}>#</Text></View>
              <View style={styles.tableCell2}><Text style={styles.tableHeaderText}>Name</Text></View>
              <View style={styles.tableCell3}><Text style={styles.tableHeaderText}>Contact</Text></View>
              <View style={styles.tableCell4}><Text style={styles.tableHeaderText}>Info</Text></View>
              <View style={styles.tableCell5}><Text style={styles.tableHeaderText}>Date</Text></View>
            </View>
            {signups.map((signup, index) => renderTableRow(signup, index))}
          </View>
        )}

        {viewMode === 'cards' && signups.map(signup => {
          const isExpanded = expandedId === signup.id;
          const typeBadge = getTypeBadge(signup.type);
          const kycBadge = getKycBadge(signup.kycStatus);
          const interestColor = getInterestColor(signup.investmentInterest);

          return (
            <TouchableOpacity
              key={signup.id}
              style={[styles.leadCard, isExpanded && styles.leadCardExpanded]}
              onPress={() => toggleExpand(signup.id)}
              activeOpacity={0.85}
            >
              <View style={styles.leadCardTop}>
                <View style={[styles.avatarCircle, { backgroundColor: typeBadge.bg }]}>
                  <Text style={[styles.avatarText, { color: typeBadge.color }]}>
                    {signup.firstName.charAt(0)}{signup.lastName.charAt(0)}
                  </Text>
                </View>
                <View style={styles.leadInfo}>
                  <View style={styles.leadNameRow}>
                    <Text style={styles.leadName}>{signup.firstName} {signup.lastName}</Text>
                    <View style={[styles.typeBadge, { backgroundColor: typeBadge.bg }]}>
                      <Text style={[styles.typeBadgeText, { color: typeBadge.color }]}>{typeBadge.label}</Text>
                    </View>
                  </View>
                  <View style={styles.contactPreview}>
                    <Mail size={10} color="#4A90D9" />
                    <Text style={styles.contactPreviewText} numberOfLines={1}>{signup.email}</Text>
                  </View>
                  {signup.phone ? (
                    <View style={styles.contactPreview}>
                      <Phone size={10} color="#00C48C" />
                      <Text style={styles.contactPreviewText}>{signup.phone}</Text>
                    </View>
                  ) : null}
                  <View style={styles.leadMeta}>
                    {signup.country ? (
                      <View style={styles.leadMetaItem}>
                        <MapPin size={10} color={Colors.textTertiary} />
                        <Text style={styles.leadMetaText}>{signup.country}</Text>
                      </View>
                    ) : null}
                    {signup.investmentInterest ? (
                      <View style={[styles.miniInterestPill, { backgroundColor: interestColor + '15' }]}>
                        <Text style={[styles.miniInterestText, { color: interestColor }]}>
                          {formatInterest(signup.investmentInterest)}
                        </Text>
                      </View>
                    ) : null}
                    <Text style={styles.leadMetaTime}>{formatTimeAgo(signup.createdAt)}</Text>
                  </View>
                </View>
                <View style={styles.leadRight}>
                  <View style={[styles.statusDot, { backgroundColor: getStatusColor(signup.status) }]} />
                  <ChevronDown
                    size={16}
                    color={Colors.textTertiary}
                    style={isExpanded ? { transform: [{ rotate: '180deg' }] } : undefined}
                  />
                </View>
              </View>

              {isExpanded && (
                <View style={styles.leadDetails}>
                  <View style={styles.detailDivider} />

                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>Full Contact Info</Text>
                    <View style={styles.contactGrid}>
                      <View style={styles.contactFullRow}>
                        <View style={[styles.contactIconWrap, { backgroundColor: '#4A90D918' }]}>
                          <Mail size={13} color="#4A90D9" />
                        </View>
                        <View style={styles.contactFullInfo}>
                          <Text style={styles.contactFullLabel}>Email</Text>
                          <Text style={[styles.contactFullVal, { color: '#4A90D9' }]}>{signup.email}</Text>
                        </View>
                        <TouchableOpacity
                          style={styles.copyBtn}
                          onPress={() => copyToClipboard(signup.email, `detail-email-${signup.id}`)}
                        >
                          {copiedId === `detail-email-${signup.id}` ? (
                            <Check size={12} color="#00C48C" />
                          ) : (
                            <Copy size={12} color={Colors.textTertiary} />
                          )}
                        </TouchableOpacity>
                      </View>
                      {signup.phone ? (
                        <View style={styles.contactFullRow}>
                          <View style={[styles.contactIconWrap, { backgroundColor: '#00C48C18' }]}>
                            <Phone size={13} color="#00C48C" />
                          </View>
                          <View style={styles.contactFullInfo}>
                            <Text style={styles.contactFullLabel}>Phone / Cell</Text>
                            <Text style={styles.contactFullVal}>{signup.phone}</Text>
                          </View>
                          <TouchableOpacity
                            style={styles.copyBtn}
                            onPress={() => copyToClipboard(signup.phone, `detail-phone-${signup.id}`)}
                          >
                            {copiedId === `detail-phone-${signup.id}` ? (
                              <Check size={12} color="#00C48C" />
                            ) : (
                              <Copy size={12} color={Colors.textTertiary} />
                            )}
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View style={styles.contactFullRow}>
                          <View style={[styles.contactIconWrap, { backgroundColor: '#9E9E9E18' }]}>
                            <Phone size={13} color="#9E9E9E" />
                          </View>
                          <View style={styles.contactFullInfo}>
                            <Text style={styles.contactFullLabel}>Phone / Cell</Text>
                            <Text style={[styles.contactFullVal, { color: Colors.textTertiary }]}>Not provided</Text>
                          </View>
                        </View>
                      )}
                      <View style={styles.contactFullRow}>
                        <View style={[styles.contactIconWrap, { backgroundColor: '#0097A718' }]}>
                          <Globe size={13} color="#0097A7" />
                        </View>
                        <View style={styles.contactFullInfo}>
                          <Text style={styles.contactFullLabel}>Country</Text>
                          <Text style={styles.contactFullVal}>{signup.country || 'Unknown'}</Text>
                        </View>
                      </View>
                      <View style={styles.contactFullRow}>
                        <View style={[styles.contactIconWrap, { backgroundColor: '#7B61FF18' }]}>
                          <Clock size={13} color="#7B61FF" />
                        </View>
                        <View style={styles.contactFullInfo}>
                          <Text style={styles.contactFullLabel}>Signed Up</Text>
                          <Text style={styles.contactFullVal}>{formatDate(signup.createdAt)}</Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>What They Want</Text>
                    <View style={[styles.intentCard, { borderLeftColor: interestColor }]}>
                      <Briefcase size={16} color={interestColor} />
                      <View style={styles.intentContent}>
                        <Text style={[styles.intentValue, { color: interestColor }]}>
                          {formatInterest(signup.investmentInterest)}
                        </Text>
                        <Text style={styles.intentDesc}>
                          {signup.type === 'user'
                            ? signup.totalInvested > 0
                              ? `Currently invested ${formatCurrency(signup.totalInvested)}`
                              : 'Registered but not yet invested'
                            : 'Interested via landing page waitlist'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>Account Details</Text>
                    <View style={styles.detailGrid}>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailKey}>Source</Text>
                        <View style={styles.sourceInlineTag}>
                          <Text style={styles.sourceInlineText}>{signup.source}</Text>
                        </View>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailKey}>Status</Text>
                        <Text style={[styles.detailVal, { color: getStatusColor(signup.status) }]}>
                          {signup.status.charAt(0).toUpperCase() + signup.status.slice(1)}
                        </Text>
                      </View>
                      {signup.type === 'user' && (
                        <>
                          <View style={styles.detailItem}>
                            <View style={styles.detailIconRow}>
                              <Shield size={11} color={kycBadge.color} />
                              <Text style={styles.detailKey}>KYC</Text>
                            </View>
                            <Text style={[styles.detailVal, { color: kycBadge.color }]}>{kycBadge.label}</Text>
                          </View>
                          <View style={styles.detailItem}>
                            <View style={styles.detailIconRow}>
                              <DollarSign size={11} color={Colors.primary} />
                              <Text style={styles.detailKey}>Invested</Text>
                            </View>
                            <Text style={[styles.detailVal, { color: Colors.primary }]}>
                              {formatCurrency(signup.totalInvested)}
                            </Text>
                          </View>
                          <View style={styles.detailItem}>
                            <View style={styles.detailIconRow}>
                              <Wallet size={11} color="#F57C00" />
                              <Text style={styles.detailKey}>Wallet</Text>
                            </View>
                            <Text style={[styles.detailVal, { color: '#F57C00' }]}>
                              {formatCurrency(signup.walletBalance)}
                            </Text>
                          </View>
                        </>
                      )}
                    </View>
                  </View>

                  <View style={styles.leadActions}>
                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#4A90D915', borderColor: '#4A90D930' }]}>
                      <Zap size={13} color="#4A90D9" />
                      <Text style={[styles.actionBtnText, { color: '#4A90D9' }]}>Send Email</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: '#0097A715', borderColor: '#0097A730' }]}
                      onPress={() => {
                        if (signup.type === 'user') {
                          router.push(`/admin/member/${signup.id}` as any);
                        }
                      }}
                    >
                      <Eye size={13} color="#0097A7" />
                      <Text style={[styles.actionBtnText, { color: '#0097A7' }]}>
                        {signup.type === 'user' ? 'View Profile' : 'Details'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12},
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#E5393520',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6},
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#E53935' },
  liveTagText: { fontSize: 10, fontWeight: '700' as const, color: '#E53935' },
  viewToggle: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},

  content: { padding: 16 },

  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1B365D',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    gap: 14},
  heroIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center'},
  heroContent: { flex: 1 },
  heroLabel: { fontSize: 10, fontWeight: '700' as const, color: 'rgba(255,255,255,0.6)', letterSpacing: 1 },
  heroValue: { fontSize: 36, fontWeight: '900' as const, color: '#fff', marginTop: 2 },
  heroBreakdownCol: { gap: 6 },
  heroBreakdownItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroBreakdownDot: { width: 8, height: 8, borderRadius: 4 },
  heroBreakdownText: { fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: '600' as const },

  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  kpiCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    borderLeftWidth: 3,
    gap: 4},
  kpiValue: { fontSize: 16, fontWeight: '800' as const, color: Colors.text },
  kpiLabel: { fontSize: 9, color: Colors.textSecondary, textAlign: 'center' as const },

  interestCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12},
  interestHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  interestTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  interestList: { gap: 10 },
  interestRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  interestIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'},
  interestInfo: { flex: 1 },
  interestTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  interestLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  interestCount: { fontSize: 14, fontWeight: '800' as const },
  interestBarBg: { height: 5, backgroundColor: Colors.surfaceBorder, borderRadius: 3, overflow: 'hidden' },
  interestBarFill: { height: 5, borderRadius: 3 },

  breakdownCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12},
  breakdownHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  breakdownTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  breakdownList: { gap: 8 },
  breakdownItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  breakdownRank: { fontSize: 11, color: Colors.textTertiary, width: 22 },
  breakdownName: { fontSize: 12, color: Colors.text, width: 80, fontWeight: '600' as const },
  breakdownBarBg: { flex: 1, height: 6, backgroundColor: Colors.surfaceBorder, borderRadius: 3, overflow: 'hidden' },
  breakdownBarFill: { height: 6, borderRadius: 3 },
  breakdownCount: { fontSize: 12, fontWeight: '700' as const, color: Colors.textSecondary, width: 30, textAlign: 'right' as const },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10},
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },

  filterRow: { marginBottom: 12 },
  filterRowContent: { gap: 8, paddingRight: 4, alignItems: 'center' },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  filterChipActive: { backgroundColor: '#1B365D', borderColor: '#1B365D' },
  filterChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  filterChipTextActive: { color: '#fff' },
  sortDivider: { width: 1, height: 20, backgroundColor: Colors.border, marginHorizontal: 4 },
  sortChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: Colors.surfaceBorder},
  sortChipActive: { backgroundColor: '#0097A730' },
  sortChipText: { fontSize: 11, fontWeight: '600' as const, color: Colors.textTertiary },
  sortChipTextActive: { color: '#0097A7' },

  leadsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10},
  leadsHeaderText: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  refreshBtn: { padding: 6 },

  loadingContainer: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  loadingText: { fontSize: 13, color: Colors.textSecondary },

  emptyContainer: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  emptyText: { fontSize: 13, color: Colors.textSecondary },

  tableContainer: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: 12},
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#1B365D',
    paddingVertical: 10,
    paddingHorizontal: 10},
  tableHeaderText: { fontSize: 10, fontWeight: '700' as const, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    alignItems: 'center'},
  tableRowAlt: { backgroundColor: Colors.background },
  tableCell1: { width: 28 },
  tableCell2: { width: 90, gap: 3 },
  tableCell3: { flex: 1, gap: 3, paddingHorizontal: 4 },
  tableCell4: { width: 80, gap: 2, paddingHorizontal: 2 },
  tableCell5: { width: 70 },
  tableRowNum: { fontSize: 10, fontWeight: '700' as const, color: Colors.textTertiary },
  tableName: { fontSize: 12, fontWeight: '700' as const, color: Colors.text },
  tableTypePill: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, alignSelf: 'flex-start' as const },
  tableTypeText: { fontSize: 8, fontWeight: '700' as const },
  tableCopyRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tableEmail: { fontSize: 10, color: '#4A90D9', flex: 1 },
  tablePhone: { fontSize: 10, color: '#00C48C', flex: 1 },
  tableNoPhone: { fontSize: 10, color: Colors.textTertiary, fontStyle: 'italic' as const },
  tableCountry: { fontSize: 10, fontWeight: '600' as const, color: Colors.text },
  tableInterest: { fontSize: 9, color: Colors.textSecondary },
  tableNoData: { fontSize: 10, color: Colors.textTertiary },
  tableDate: { fontSize: 10, color: Colors.textSecondary },

  leadCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10},
  leadCardExpanded: { borderColor: '#1B365D50' },
  leadCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2},
  avatarText: { fontSize: 15, fontWeight: '800' as const },
  leadInfo: { flex: 1 },
  leadNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  leadName: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5},
  typeBadgeText: { fontSize: 9, fontWeight: '700' as const },
  contactPreview: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  contactPreviewText: { fontSize: 11, color: Colors.textSecondary },
  leadMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  leadMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  leadMetaText: { fontSize: 11, color: Colors.textTertiary },
  miniInterestPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6},
  miniInterestText: { fontSize: 9, fontWeight: '700' as const },
  leadMetaTime: { fontSize: 11, color: Colors.textTertiary },
  leadRight: { alignItems: 'center', gap: 8, paddingTop: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },

  leadDetails: { marginTop: 4 },
  detailDivider: { height: 1, backgroundColor: Colors.border, marginVertical: 12 },
  detailSection: { marginBottom: 14 },
  detailSectionTitle: { fontSize: 12, fontWeight: '700' as const, color: Colors.textSecondary, marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: 0.5 },

  contactGrid: { gap: 10 },
  contactFullRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 10},
  contactIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center'},
  contactFullInfo: { flex: 1 },
  contactFullLabel: { fontSize: 10, color: Colors.textTertiary, marginBottom: 1 },
  contactFullVal: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  copyBtn: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center'},

  intentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3},
  intentContent: { flex: 1 },
  intentValue: { fontSize: 15, fontWeight: '700' as const, marginBottom: 2 },
  intentDesc: { fontSize: 11, color: Colors.textSecondary },

  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  detailItem: { width: '47%' as any, marginBottom: 4 },
  detailIconRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  detailKey: { fontSize: 10, color: Colors.textTertiary, marginBottom: 2 },
  detailVal: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  sourceInlineTag: {
    backgroundColor: Colors.surfaceBorder,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start' as const},
  sourceInlineText: { fontSize: 11, fontWeight: '600' as const, color: Colors.text },

  leadActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10},
  actionBtnText: { fontSize: 12, fontWeight: '600' as const },

  bottomPad: { height: 40 },

  errorContainer: { alignItems: 'center', paddingVertical: 40, gap: 12, backgroundColor: '#E5393508', borderRadius: 16, padding: 24, borderWidth: 1, borderColor: '#E5393520' },
  errorIconWrap: { width: 52, height: 52, borderRadius: 14, backgroundColor: '#E5393515', alignItems: 'center', justifyContent: 'center' },
  errorTitle: { fontSize: 16, fontWeight: '700' as const, color: '#E53935' },
  errorText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 18, paddingHorizontal: 20 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1B365D', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginTop: 4 },
  retryBtnText: { fontSize: 13, fontWeight: '700' as const, color: '#fff' }});
