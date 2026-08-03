import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  RefreshControl,
  ListRenderItem,
  Share,
  Platform} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  Search,
  ChevronRight,
  Shield,
  Ban,
  CheckCircle,
  Clock,
  AlertCircle,
  User,
  ArrowLeft,
  Users,
  Download,
  Smartphone,
  Copy,
  ArrowUpDown,
  FileSpreadsheet} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { Image } from 'expo-image';
import { formatCurrency as _fmtCurr } from '@/lib/formatters';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  fetchAdminMemberRegistry,
  syncMemberRegistryFromSupabase,
  upsertStoredMemberRegistryRecord,
  getLastRegistryFetchStatus,
  RegistryFetchStatus} from '@/lib/member-registry';

type FilterType = 'all' | 'active' | 'pending_kyc' | 'suspended';
type TypeFilter = 'all' | 'member' | 'investor' | 'buyer' | 'realtor' | 'influencer' | 'jv_partner';
type VerifiedFilter = 'all' | 'sms_verified' | 'unverified';
type SortOrder = 'newest' | 'oldest' | 'name';

interface MemberItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  country: string;
  kycStatus: string;
  status: string;
  walletBalance: number;
  totalInvested: number;
  holdings: number;
  totalTransactions: number;
  lastActivity: string;
  createdAt: string;
  memberType: string;
  smsVerified: boolean;
  emailVerified: boolean;
  verificationStatus: string;
  registrySource: string;
  registrationSource: string;
  avatarUrl?: string;
}

export default function MembersScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [registryStatus, setRegistryStatus] = useState<RegistryFetchStatus | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [verifiedFilter, setVerifiedFilter] = useState<VerifiedFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');

  // Progressive loading: render first 20, then load more on scroll
  const [displayCount, setDisplayCount] = useState<number>(20);
  const PAGE_SIZE = 20;

  // Debounce search by 350ms to avoid refetching on every keystroke
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 350);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  // Reset display count when debounced search changes
  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [debouncedSearch]);

  // Single query — fetches all members once, filters client-side.
  // staleTime 30s prevents aggressive refetching; keepPreviousData
  // ensures cached rows stay visible during background refresh.
  const membersQuery = useQuery({
    queryKey: ['members.list', { search: debouncedSearch || undefined }],
    queryFn: async () => {
      console.log('[Members] Fetching canonical members registry');
      const members = await fetchAdminMemberRegistry(debouncedSearch);
      setRegistryStatus(getLastRegistryFetchStatus());
      return { members, total: members.length };
    },
    staleTime: 30_000,
    refetchInterval: 60_000});

  // Derive stats from the same query — eliminates the duplicate
  // fetchAdminMemberRegistry() call that statsQuery used to make.
  const stats = useMemo(() => {
    const all = membersQuery.data?.members ?? [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 86400000).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    return {
      totalMembers: all.length,
      activeMembers: all.filter((m: any) => (m.status || 'active') === 'active').length,
      pendingKyc: all.filter((m: any) => {
        const kyc = m.kycStatus || m.kyc_status || 'pending';
        return kyc === 'pending' || kyc === 'in_review';
      }).length,
      newMembersToday: all.filter((m: any) => (m.createdAt || m.created_at || '') >= todayStart).length,
      newMembersThisWeek: all.filter((m: any) => (m.createdAt || m.created_at || '') >= weekStart).length,
      newMembersThisMonth: all.filter((m: any) => (m.createdAt || m.created_at || '') >= monthStart).length};
  }, [membersQuery.data?.members]);



  const kycMutation = useMutation({
    mutationFn: async (input: { id: string; status: string }) => {
      console.log('[Supabase] Updating KYC status:', input.id, input.status);
      const { data, error } = await supabase.from('profiles').update({ kyc_status: input.status }).eq('id', input.id).select().single();
      if (error) return { success: false, message: error.message };
      return { success: true, ...data };
    },
    onSuccess: (data) => {
      if (data && typeof data === 'object') {
        void upsertStoredMemberRegistryRecord({ ...(data as Record<string, unknown>), source: 'admin_update' });
      }
      void syncMemberRegistryFromSupabase();
      void membersQuery.refetch();
    }});

  const suspendMutation = useMutation({
    mutationFn: async (input: { id: string; reason: string }) => {
      console.log('[Supabase] Suspending member:', input.id);
      const { data, error } = await supabase.from('profiles').update({ status: 'suspended' }).eq('id', input.id).select().single();
      if (error) return { success: false, message: error.message };
      return { success: true, ...data };
    },
    onSuccess: (data) => {
      if (data && typeof data === 'object') {
        void upsertStoredMemberRegistryRecord({ ...(data as Record<string, unknown>), source: 'admin_update' });
      }
      void syncMemberRegistryFromSupabase();
      void membersQuery.refetch();
    }});

  const updateMutation = useMutation({
    mutationFn: async (input: { id: string; data: Record<string, unknown> }) => {
      console.log('[Supabase] Updating member:', input.id);
      const { data, error } = await supabase.from('profiles').update(input.data).eq('id', input.id).select().single();
      if (error) return { success: false, message: error.message };
      return { success: true, ...data };
    },
    onSuccess: (data) => {
      if (data && typeof data === 'object') {
        void upsertStoredMemberRegistryRecord({ ...(data as Record<string, unknown>), source: 'admin_update' });
      }
      void syncMemberRegistryFromSupabase();
      void membersQuery.refetch();
    }});

  const members = useMemo(() => {
    const rawItems = membersQuery.data?.members ?? [];
    const items: MemberItem[] = rawItems.map((m: any) => ({
      id: m.id || '',
      email: m.email || '',
      firstName: m.first_name || m.firstName || '',
      lastName: m.last_name || m.lastName || '',
      phone: m.phone || '',
      country: m.country || '',
      kycStatus: m.kyc_status || m.kycStatus || 'pending',
      status: m.status || 'active',
      walletBalance: Number(m.wallet_balance || m.walletBalance || 0),
      totalInvested: Number(m.total_invested || m.totalInvested || 0),
      holdings: Number(m.holdings || 0),
      totalTransactions: Number(m.total_transactions || m.totalTransactions || 0),
      lastActivity: m.last_activity || m.lastActivity || m.updated_at || '',
      createdAt: m.created_at || m.createdAt || '',
      memberType: (m.memberType || m.member_type || m.role || 'member') as string,
      smsVerified: m.smsVerified === true || m.sms_verified === true,
      emailVerified: m.emailVerified === true || m.email_verified === true,
      verificationStatus: (m.verificationStatus || m.verification_status || 'unverified') as string,
      registrySource: (m.source || '') as string,
      registrationSource: (m.registrationSource || m.source_detail || '') as string,
      avatarUrl: (m.pictureUrl || m.picture_url || '') as string}));
    let result = items;

    if (filter === 'active') {
      result = result.filter((m) => m.status === 'active' && m.kycStatus === 'approved');
    } else if (filter === 'pending_kyc') {
      result = result.filter(
        (m) => m.kycStatus === 'pending' || m.kycStatus === 'in_review'
      );
    } else if (filter === 'suspended') {
      result = result.filter((m) => m.status === 'suspended');
    }

    if (typeFilter !== 'all') {
      result = result.filter((m) => {
        const type = (m.memberType || '').toLowerCase();
        if (typeFilter === 'realtor') return type === 'realtor' || type === 'broker';
        if (typeFilter === 'jv_partner') return type === 'jv_partner' || type === 'jv';
        return type === typeFilter;
      });
    }

    if (verifiedFilter === 'sms_verified') {
      result = result.filter((m) => m.smsVerified);
    } else if (verifiedFilter === 'unverified') {
      result = result.filter((m) => !m.smsVerified && !m.emailVerified);
    }

    const sorted = [...result];
    if (sortOrder === 'newest') {
      sorted.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    } else if (sortOrder === 'oldest') {
      sorted.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    } else {
      sorted.sort((a, b) => `${a.firstName} ${a.lastName}`.trim().toLowerCase().localeCompare(`${b.firstName} ${b.lastName}`.trim().toLowerCase()));
    }

    return sorted;
  }, [membersQuery.data?.members, filter, typeFilter, verifiedFilter, sortOrder]);



  const getKycStatusIcon = useCallback((status: string) => {
    switch (status) {
      case 'approved':
        return <CheckCircle size={14} color={Colors.positive} />;
      case 'in_review':
        return <Clock size={14} color={Colors.primary} />;
      case 'pending':
        return <AlertCircle size={14} color={Colors.warning} />;
      case 'rejected':
        return <Ban size={14} color={Colors.negative} />;
      default:
        return <Clock size={14} color={Colors.textSecondary} />;
    }
  }, []);

  const getKycStatusColor = useCallback((status: string) => {
    switch (status) {
      case 'approved': return Colors.positive;
      case 'in_review': return Colors.primary;
      case 'pending': return Colors.warning;
      case 'rejected': return Colors.negative;
      default: return Colors.textSecondary;
    }
  }, []);

  const handleMemberAction = useCallback((member: MemberItem, action: 'approve' | 'suspend' | 'activate') => {
    const actionText = action === 'approve' ? 'approve KYC for' : action === 'suspend' ? 'suspend' : 'activate';
    Alert.alert(
      `Confirm ${action.charAt(0).toUpperCase() + action.slice(1)}`,
      `Are you sure you want to ${actionText} ${member.firstName} ${member.lastName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => {
            if (action === 'approve') {
              kycMutation.mutate({ id: member.id, status: 'approved' });
            } else if (action === 'suspend') {
              suspendMutation.mutate({ id: member.id, reason: 'Admin action' });
            } else if (action === 'activate') {
              updateMutation.mutate({ id: member.id, data: { status: 'active' } });
            }
          }},
      ]
    );
  }, [kycMutation, suspendMutation, updateMutation]);

  const formatCurrency = useCallback((amount: number) => _fmtCurr(amount), []);

  const handleCopyMemberId = useCallback(async (member: MemberItem) => {
    try {
      await Clipboard.setStringAsync(member.id);
      Alert.alert('Copied', `Member ID copied:\n${member.id}`);
    } catch (error) {
      console.log('[Members] Copy member ID failed:', (error as Error)?.message);
    }
  }, []);

  const formatDate = useCallback((dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'});
  }, []);

  const keyExtractor = useCallback((item: MemberItem) => item.id, []);

  const renderMember: ListRenderItem<MemberItem> = useCallback(({ item: member }) => (
    <TouchableOpacity
      style={styles.memberCard}
      onPress={() => router.push(`/admin/member/${member.id}` as any)}
    >
      <View style={styles.memberHeader}>
        {member.avatarUrl ? (
          <Image
            source={{ uri: member.avatarUrl }}
            style={styles.avatarPlaceholder}
            contentFit="cover"
            transition={200}
            placeholder={null}
          />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <User size={24} color={Colors.textSecondary} />
          </View>
        )}
        <View style={styles.memberInfo}>
          <Text style={styles.memberName}>
            {member.firstName} {member.lastName}
          </Text>
          <Text style={styles.memberEmail}>{member.email}</Text>
          <Text style={styles.memberCountry}>
            {[member.memberType, member.registrationSource || member.registrySource, member.country]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <View style={styles.badgeRow}>
            <View style={[styles.miniBadge, member.smsVerified ? styles.miniBadgeOn : styles.miniBadgeOff]}>
              <Smartphone size={10} color={member.smsVerified ? Colors.positive : Colors.textTertiary} />
              <Text style={[styles.miniBadgeText, { color: member.smsVerified ? Colors.positive : Colors.textTertiary }]}>
                {member.smsVerified ? 'SMS verified' : 'SMS unverified'}
              </Text>
            </View>
            {member.emailVerified ? (
              <View style={[styles.miniBadge, styles.miniBadgeOn]}>
                <CheckCircle size={10} color={Colors.positive} />
                <Text style={[styles.miniBadgeText, { color: Colors.positive }]}>Email</Text>
              </View>
            ) : null}
          </View>
        </View>
        <ChevronRight size={20} color={Colors.textSecondary} />
      </View>

      <View style={styles.memberStats}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Invested</Text>
          <Text style={styles.statValue}>
            {formatCurrency(member.totalInvested)}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Balance</Text>
          <Text style={styles.statValue}>
            {formatCurrency(member.walletBalance)}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Holdings</Text>
          <Text style={styles.statValue}>{member.holdings}</Text>
        </View>
      </View>

      <View style={styles.memberFooter}>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.kycBadge,
              { backgroundColor: getKycStatusColor(member.kycStatus) + '20' },
            ]}
          >
            {getKycStatusIcon(member.kycStatus)}
            <Text
              style={[
                styles.kycText,
                { color: getKycStatusColor(member.kycStatus) },
              ]}
            >
              KYC: {(member.kycStatus || 'pending').replace('_', ' ')}
            </Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              member.status === 'active'
                ? styles.statusActive
                : member.status === 'suspended'
                ? styles.statusSuspended
                : styles.statusInactive,
            ]}
          >
            <Text style={styles.statusText}>{member.status}</Text>
          </View>
        </View>
        <View style={styles.joinDateRow}>
          <Text style={styles.joinDate}>Joined {formatDate(member.createdAt)}</Text>
          <TouchableOpacity
            style={styles.copyIdBtn}
            onPress={() => handleCopyMemberId(member)}
            testID={`copy-id-${member.id}`}
          >
            <Copy size={11} color={Colors.textSecondary} />
            <Text style={styles.copyIdText}>ID</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.actions}>
        {(member.kycStatus === 'pending' || member.kycStatus === 'in_review') && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.approveBtn]}
            onPress={() => handleMemberAction(member, 'approve')}
          >
            <Shield size={14} color={Colors.positive} />
            <Text style={[styles.actionBtnText, { color: Colors.positive }]}>
              Approve KYC
            </Text>
          </TouchableOpacity>
        )}
        {member.status === 'active' ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.suspendBtn]}
            onPress={() => handleMemberAction(member, 'suspend')}
          >
            <Ban size={14} color={Colors.negative} />
            <Text style={[styles.actionBtnText, { color: Colors.negative }]}>
              Suspend
            </Text>
          </TouchableOpacity>
        ) : member.status === 'suspended' ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.activateBtn]}
            onPress={() => handleMemberAction(member, 'activate')}
          >
            <CheckCircle size={14} color={Colors.positive} />
            <Text style={[styles.actionBtnText, { color: Colors.positive }]}>
              Activate
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </TouchableOpacity>
  ), [formatCurrency, formatDate, getKycStatusColor, getKycStatusIcon, handleMemberAction, handleCopyMemberId, router]);

  const handleExportCsv = useCallback(async () => {
    const rows = members;
    if (rows.length === 0) {
      Alert.alert('Export CSV', 'No members to export for the current filters.');
      return;
    }
    const esc = (value: string | number | boolean) => {
      const s = String(value ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = 'member_id,full_name,email,phone,type,source,verification_status,sms_verified,email_verified,created_at';
    const lines = rows.map((m) => [
      m.id,
      `${m.firstName} ${m.lastName}`.trim(),
      m.email,
      m.phone ?? '',
      m.memberType,
      m.registrationSource || m.registrySource,
      m.verificationStatus,
      m.smsVerified,
      m.emailVerified,
      m.createdAt,
    ].map(esc).join(','));
    const csv = [header, ...lines].join('\n');
    try {
      if (Platform.OS === 'web') {
        const nav = (globalThis as unknown as { navigator?: { clipboard?: { writeText: (t: string) => Promise<void> } } }).navigator;
        await nav?.clipboard?.writeText(csv);
        Alert.alert('Export CSV', `${rows.length} members copied to clipboard as CSV.`);
      } else {
        await Share.share({ message: csv, title: 'ivx-members.csv' });
      }
    } catch (error) {
      console.log('[Members] CSV export failed:', (error as Error)?.message);
    }
  }, [members]);

  const buildExportRows = useCallback(() => {
    return members.map((m) => [
      m.id,
      `${m.firstName} ${m.lastName}`.trim(),
      m.email,
      m.phone ?? '',
      m.memberType,
      m.registrationSource || m.registrySource,
      m.verificationStatus,
      String(m.smsVerified),
      String(m.emailVerified),
      m.createdAt,
    ]);
  }, [members]);

  const handleExportExcel = useCallback(async () => {
    const rows = buildExportRows();
    if (rows.length === 0) {
      Alert.alert('Export Excel', 'No members to export for the current filters.');
      return;
    }
    const header = ['member_id', 'full_name', 'email', 'phone', 'type', 'source', 'verification_status', 'sms_verified', 'email_verified', 'created_at'];
    const tsv = [header, ...rows].map((r) => r.map((v) => String(v ?? '').replace(/\t/g, ' ')).join('\t')).join('\n');
    try {
      if (Platform.OS === 'web') {
        const nav = (globalThis as unknown as { navigator?: { clipboard?: { writeText: (t: string) => Promise<void> } } }).navigator;
        await nav?.clipboard?.writeText(tsv);
        Alert.alert('Export Excel', `${rows.length} members copied as tab-separated values — paste directly into Excel.`);
      } else {
        await Share.share({ message: tsv, title: 'ivx-members.xls' });
      }
    } catch (error) {
      console.log('[Members] Excel export failed:', (error as Error)?.message);
    }
  }, [buildExportRows]);

  const handleRefresh = useCallback(() => {
    void syncMemberRegistryFromSupabase().finally(() => {
      void membersQuery.refetch();
    });
  }, [membersQuery]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Members</Text>
          <Text style={styles.subtitle}>
            {stats
              ? `${stats.totalMembers} total · ${stats.activeMembers} active · ${stats.pendingKyc} pending KYC`
              : `${membersQuery.data?.total ?? 0} total members`}
          </Text>
        </View>
      </View>

      {registryStatus && (
        <View style={[styles.registryBanner, registryStatus.ok ? styles.registryBannerOk : styles.registryBannerError]}>
          <View style={[styles.registryDot, { backgroundColor: registryStatus.ok ? Colors.positive : Colors.negative }]} />
          <Text style={styles.registryBannerText} numberOfLines={2}>
            {registryStatus.ok
              ? `Live registry · HTTP ${registryStatus.httpStatus} · ${registryStatus.count} records · ${new Date(registryStatus.fetchedAt).toLocaleTimeString()}`
              : `Registry API unreachable — showing cached data · ${registryStatus.error ?? 'unknown error'} · ${registryStatus.url.replace('https://', '')}`}
          </Text>
        </View>
      )}

      {stats && (
        <View style={styles.quickStats}>
          <View style={styles.quickStatItem}>
            <Text style={styles.quickStatNum}>{stats.newMembersToday}</Text>
            <Text style={styles.quickStatLabel}>Today</Text>
          </View>
          <View style={styles.quickStatDivider} />
          <View style={styles.quickStatItem}>
            <Text style={styles.quickStatNum}>{stats.newMembersThisWeek}</Text>
            <Text style={styles.quickStatLabel}>This Week</Text>
          </View>
          <View style={styles.quickStatDivider} />
          <View style={styles.quickStatItem}>
            <Text style={styles.quickStatNum}>{stats.newMembersThisMonth}</Text>
            <Text style={styles.quickStatLabel}>This Month</Text>
          </View>
          <View style={styles.quickStatDivider} />
          <View style={styles.quickStatItem}>
            <Text style={[styles.quickStatNum, { color: Colors.warning }]}>{stats.pendingKyc}</Text>
            <Text style={styles.quickStatLabel}>Pending KYC</Text>
          </View>
        </View>
      )}

      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <Search size={20} color={Colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search members..."
            placeholderTextColor={Colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterContainer}
        contentContainerStyle={styles.filterContent}
      >
        {[
          { key: 'all', label: 'All' },
          { key: 'active', label: 'Active' },
          { key: 'pending_kyc', label: 'Pending KYC' },
          { key: 'suspended', label: 'Suspended' },
        ].map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key as FilterType)}
          >
            <Text
              style={[
                styles.filterChipText,
                filter === f.key && styles.filterChipTextActive,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterContainer}
        contentContainerStyle={styles.filterContent}
      >
        {([
          { key: 'all', label: 'All Types' },
          { key: 'member', label: 'Members' },
          { key: 'investor', label: 'Investors' },
          { key: 'buyer', label: 'Buyers' },
          { key: 'realtor', label: 'Realtors' },
          { key: 'influencer', label: 'Influencers' },
          { key: 'jv_partner', label: 'JV Partners' },
        ] as { key: TypeFilter; label: string }[]).map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, typeFilter === f.key && styles.filterChipActive]}
            onPress={() => setTypeFilter(f.key)}
            testID={`type-filter-${f.key}`}
          >
            <Text style={[styles.filterChipText, typeFilter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
        {([
          { key: 'all', label: 'Any Verification' },
          { key: 'sms_verified', label: 'SMS Verified' },
          { key: 'unverified', label: 'Unverified' },
        ] as { key: VerifiedFilter; label: string }[]).map((f) => (
          <TouchableOpacity
            key={`v-${f.key}`}
            style={[styles.filterChip, verifiedFilter === f.key && styles.filterChipActive]}
            onPress={() => setVerifiedFilter(f.key)}
            testID={`verified-filter-${f.key}`}
          >
            <Text style={[styles.filterChipText, verifiedFilter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
        {([
          { key: 'newest', label: 'Newest' },
          { key: 'oldest', label: 'Oldest' },
          { key: 'name', label: 'Name A–Z' },
        ] as { key: SortOrder; label: string }[]).map((f) => (
          <TouchableOpacity
            key={`s-${f.key}`}
            style={[styles.filterChip, styles.sortChip, sortOrder === f.key && styles.filterChipActive]}
            onPress={() => setSortOrder(f.key)}
            testID={`sort-${f.key}`}
          >
            <ArrowUpDown size={11} color={sortOrder === f.key ? Colors.black : Colors.textSecondary} />
            <Text style={[styles.filterChipText, sortOrder === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[styles.filterChip, styles.exportChip]}
          onPress={handleExportCsv}
          testID="export-csv"
        >
          <Download size={13} color={Colors.primary} />
          <Text style={[styles.filterChipText, { color: Colors.primary }]}>Export CSV</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, styles.exportChip]}
          onPress={handleExportExcel}
          testID="export-excel"
        >
          <FileSpreadsheet size={13} color={Colors.primary} />
          <Text style={[styles.filterChipText, { color: Colors.primary }]}>Export Excel</Text>
        </TouchableOpacity>
      </ScrollView>

      {membersQuery.isLoading && !membersQuery.data ? (
        <View style={styles.loadingContainer}>
          <ShimmerIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading members...</Text>
        </View>
      ) : members.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconWrap}>
            <Users size={48} color={Colors.textTertiary} />
          </View>
          <Text style={styles.emptyTitle}>
            {debouncedSearch ? 'No members found' : 'No registered members yet'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {debouncedSearch
              ? 'Try a different search term'
              : 'New member registrations will appear here automatically'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={members.slice(0, displayCount)}
          keyExtractor={keyExtractor}
          renderItem={renderMember}
          style={styles.list}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          onEndReached={() => {
            if (displayCount < members.length) {
              setDisplayCount(prev => Math.min(prev + PAGE_SIZE, members.length));
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            displayCount < members.length ? (
              <View style={styles.loadingFooter}>
                <ShimmerIndicator size="small" color={Colors.primary} />
                <Text style={styles.loadingFooterText}>Loading more...</Text>
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={membersQuery.isRefetching}
              onRefresh={handleRefresh}
              tintColor={Colors.primary}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 10},
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.card,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.border},
  title: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text,
    flexShrink: 1},
  subtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2},
  registryBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1},
  registryBannerOk: {
    backgroundColor: 'rgba(0,196,140,0.08)',
    borderColor: 'rgba(0,196,140,0.35)'},
  registryBannerError: {
    backgroundColor: 'rgba(255,90,90,0.10)',
    borderColor: 'rgba(255,90,90,0.40)'},
  registryDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  registryBannerText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  quickStats: {
    flexDirection: 'row' as const,
    marginHorizontal: 20,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center' as const},
  quickStatItem: {
    flex: 1,
    alignItems: 'center' as const},
  quickStatNum: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text},
  quickStatLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginTop: 2,
    fontWeight: '600' as const},
  quickStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.border},
  searchContainer: {
    paddingHorizontal: 20,
    marginBottom: 12},
  searchBox: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.border},
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    fontSize: 15,
    color: Colors.text},
  filterContainer: {
    maxHeight: 44,
    marginBottom: 12},
  filterContent: {
    paddingHorizontal: 20,
    gap: 10},
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border},
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  filterChipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  filterChipTextActive: {
    color: Colors.black},
  exportChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    borderColor: Colors.primary},
  sortChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5},
  joinDateRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  copyIdBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background},
  copyIdText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  list: {
    flex: 1,
    paddingHorizontal: 20},
  memberCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border},
  memberHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const},
  avatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: Colors.background,
    justifyContent: 'center' as const,
    alignItems: 'center' as const},
  memberInfo: {
    flex: 1,
    marginLeft: 12},
  memberName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text},
  memberEmail: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2},
  memberCountry: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2},
  badgeRow: {
    flexDirection: 'row' as const,
    gap: 6,
    marginTop: 6},
  miniBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1},
  miniBadgeOn: {
    backgroundColor: 'rgba(0,196,140,0.10)',
    borderColor: 'rgba(0,196,140,0.35)'},
  miniBadgeOff: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: Colors.border},
  miniBadgeText: {
    fontSize: 10,
    fontWeight: '600' as const},
  memberStats: {
    flexDirection: 'row' as const,
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border},
  stat: {
    flex: 1},
  statLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginBottom: 4},
  statValue: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text},
  memberFooter: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border},
  statusRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  kycBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4},
  kycText: {
    fontSize: 11,
    fontWeight: '600' as const,
    textTransform: 'capitalize' as const},
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6},
  statusActive: {
    backgroundColor: Colors.positive + '20'},
  statusSuspended: {
    backgroundColor: Colors.negative + '20'},
  statusInactive: {
    backgroundColor: Colors.textTertiary + '20'},
  statusText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.text,
    textTransform: 'capitalize' as const},
  joinDate: {
    fontSize: 11,
    color: Colors.textTertiary},
  actions: {
    flexDirection: 'row' as const,
    gap: 10,
    marginTop: 14},
  actionBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6},
  approveBtn: {
    backgroundColor: Colors.positive + '15'},
  suspendBtn: {
    backgroundColor: Colors.negative + '15'},
  activateBtn: {
    backgroundColor: Colors.positive + '15'},
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600' as const},
  listContent: {
    paddingBottom: 100},
  loadingContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: 12},
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary},
  loadingFooter: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 16},
  loadingFooterText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '600' as const},
  emptyContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 40},
  emptyIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.card,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border},
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 8,
    textAlign: 'center' as const},
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20}});
