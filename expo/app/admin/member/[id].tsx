import React from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Ban,
  CheckCircle,
  Wallet,
  TrendingUp,
  Building2,
  Clock,
  Shield,
  FileText,
  Camera,
  AlertTriangle,
  Globe,
  IdCard} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatCurrencyWithDecimals } from '@/lib/formatters';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  fetchAdminMemberRegistryRecord,
  syncMemberRegistryFromSupabase,
  upsertStoredMemberRegistryRecord} from '@/lib/member-registry';

interface MemberData {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  country: string;
  avatar: string;
  kyc_status: string;
  status: string;
  total_invested: number;
  total_returns: number;
  created_at: string;
  updated_at: string;
  role: string;
}

interface KYCVerification {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  nationality: string;
  nationality_code: string;
  tax_id: string;
  street: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  country_code: string;
  status: string;
  verification_score: number | null;
  risk_level: string | null;
  verification_passed: boolean;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  created_at: string;
  updated_at: string;
}

interface KYCDocument {
  id: string;
  user_id: string;
  document_type: string;
  document_url: string;
  issuing_country: string;
  status: string;
  created_at: string;
}

export default function MemberDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const memberQuery = useQuery({
    queryKey: ['admin-member-detail', id],
    queryFn: async () => {
      console.log('[Member Detail] Fetching durable member profile:', id);
      const data = await fetchAdminMemberRegistryRecord(id);
      if (!data) {
        return null;
      }
      return {
        id: data.id,
        first_name: data.firstName,
        last_name: data.lastName,
        email: data.email,
        phone: data.phone,
        country: data.country,
        avatar: '',
        kyc_status: data.kycStatus,
        status: data.status,
        total_invested: data.totalInvested,
        total_returns: data.totalReturns,
        created_at: data.createdAt,
        updated_at: data.updatedAt,
        role: data.role} as MemberData;
    },
    enabled: !!id});

  const walletQuery = useQuery({
    queryKey: ['admin-member-wallet', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('wallets').select('*').eq('user_id', id).single();
      if (error) return null;
      return data;
    },
    enabled: !!id});

  const holdingsQuery = useQuery({
    queryKey: ['admin-member-holdings', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('holdings').select('*').eq('user_id', id);
      if (error) return [];
      return data ?? [];
    },
    enabled: !!id});

  const txQuery = useQuery({
    queryKey: ['admin-member-transactions', id],
    queryFn: async () => {
      const { data, error, count } = await supabase.from('transactions').select('*', { count: 'exact' }).eq('user_id', id).limit(100);
      if (error) return { data: [], count: 0 };
      return { data: data ?? [], count: count ?? 0 };
    },
    enabled: !!id});

  const kycVerificationQuery = useQuery({
    queryKey: ['admin-member-kyc-verification', id],
    queryFn: async () => {
      console.log('[Member Detail] Fetching KYC verification:', id);
      const { data, error } = await supabase.from('kyc_verifications').select('*').eq('user_id', id).single();
      if (error) { console.log('[Member Detail] KYC verification not found:', error.message); return null; }
      return data as KYCVerification;
    },
    enabled: !!id});

  const kycDocumentsQuery = useQuery({
    queryKey: ['admin-member-kyc-documents', id],
    queryFn: async () => {
      console.log('[Member Detail] Fetching KYC documents:', id);
      const { data, error } = await supabase.from('kyc_documents').select('*').eq('user_id', id).order('created_at', { ascending: false });
      if (error) { console.log('[Member Detail] KYC documents error:', error.message); return []; }
      return (data ?? []) as KYCDocument[];
    },
    enabled: !!id});

  const kycMutation = useMutation({
    mutationFn: async (input: { status: string }) => {
      console.log('[Member Detail] Updating KYC status:', id, input.status);
      const { error: profileError } = await supabase.from('profiles').update({ kyc_status: input.status }).eq('id', id);
      if (profileError) throw profileError;

      const { error: kycError } = await supabase.from('kyc_verifications').update({
        status: input.status === 'approved' ? 'approved' : 'rejected',
        reviewed_at: new Date().toISOString(),
        verification_passed: input.status === 'approved'}).eq('user_id', id);
      if (kycError) console.log('[Member Detail] KYC verification update error (non-blocking):', kycError.message);
    },
    onSuccess: async () => {
      const refreshedMember = await fetchAdminMemberRegistryRecord(id);
      if (refreshedMember) {
        await upsertStoredMemberRegistryRecord({ ...refreshedMember, source: 'admin_update' } as unknown as Record<string, unknown>);
      }
      await syncMemberRegistryFromSupabase();
      void queryClient.invalidateQueries({ queryKey: ['admin-member-detail', id] });
      void queryClient.invalidateQueries({ queryKey: ['admin-member-kyc-verification', id] });
      Alert.alert('Success', 'KYC status updated');
    },
    onError: (err: Error) => Alert.alert('Error', err.message)});

  const statusMutation = useMutation({
    mutationFn: async (input: { status: string }) => {
      const { error } = await supabase.from('profiles').update({ status: input.status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      const refreshedMember = await fetchAdminMemberRegistryRecord(id);
      if (refreshedMember) {
        await upsertStoredMemberRegistryRecord({ ...refreshedMember, source: 'admin_update' } as unknown as Record<string, unknown>);
      }
      await syncMemberRegistryFromSupabase();
      void queryClient.invalidateQueries({ queryKey: ['admin-member-detail', id] });
      Alert.alert('Success', 'Account status updated');
    },
    onError: (err: Error) => Alert.alert('Error', err.message)});

  const member = memberQuery.data;
  const wallet = walletQuery.data;
  const holdings = holdingsQuery.data ?? [];
  const totalTransactions = txQuery.data?.count ?? 0;
  const kycVerification = kycVerificationQuery.data;
  const kycDocuments = kycDocumentsQuery.data ?? [];

  if (memberQuery.isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <ShimmerIndicator size="large" color={Colors.primary} />
          <Text style={[styles.errorText, { marginTop: 12 }]}>Loading member...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!member) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Member not found</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backLink}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const formatCurrency = (amount: number) => formatCurrencyWithDecimals(amount);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'});
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'});
  };

  const kycStatus = member.kyc_status || 'pending';
  const memberStatus = member.status || 'active';

  const handleAction = (action: 'approve' | 'reject' | 'suspend' | 'activate') => {
    const messages: Record<string, string> = {
      approve: 'approve KYC for',
      reject: 'reject KYC for',
      suspend: 'suspend',
      activate: 'activate'};

    Alert.alert(
      `Confirm ${action.charAt(0).toUpperCase() + action.slice(1)}`,
      `Are you sure you want to ${messages[action]} ${member.first_name} ${member.last_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: action === 'reject' || action === 'suspend' ? 'destructive' : 'default',
          onPress: () => {
            if (action === 'approve') kycMutation.mutate({ status: 'approved' });
            else if (action === 'reject') kycMutation.mutate({ status: 'rejected' });
            else if (action === 'suspend') statusMutation.mutate({ status: 'suspended' });
            else if (action === 'activate') statusMutation.mutate({ status: 'active' });
          }},
      ]
    );
  };

  const getKycStatusColor = () => {
    switch (kycStatus) {
      case 'approved': return Colors.positive;
      case 'in_review': return Colors.primary;
      case 'pending': return Colors.warning;
      case 'rejected': return Colors.negative;
      default: return Colors.textSecondary;
    }
  };

  const getRiskColor = (risk: string | null) => {
    switch (risk) {
      case 'low': return Colors.positive;
      case 'medium': return Colors.warning;
      case 'high': return Colors.negative;
      default: return Colors.textSecondary;
    }
  };

  const getDocTypeLabel = (type: string) => {
    switch (type) {
      case 'drivers_license': return "Driver's License";
      case 'passport': return 'Passport';
      case 'national_id': return 'National ID';
      case 'proof_of_address': return 'Proof of Address';
      case 'selfie': return 'Selfie';
      default: return type.replace(/_/g, ' ');
    }
  };

  const getDocIcon = (type: string) => {
    switch (type) {
      case 'selfie': return <Camera size={16} color={Colors.primary} />;
      case 'proof_of_address': return <FileText size={16} color={Colors.info} />;
      default: return <IdCard size={16} color={Colors.accent} />;
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Member Details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.profileSection}>
          {member.avatar ? (
            <Image source={{ uri: member.avatar }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <User size={40} color={Colors.textSecondary} />
            </View>
          )}
          <Text style={styles.memberName}>
            {member.first_name} {member.last_name}
          </Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.kycBadge,
                { backgroundColor: getKycStatusColor() + '20' },
              ]}
            >
              <Text style={[styles.kycTextStyle, { color: getKycStatusColor() }]}>
                KYC: {kycStatus.replace('_', ' ')}
              </Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                memberStatus === 'active'
                  ? styles.statusActive
                  : memberStatus === 'suspended'
                  ? styles.statusSuspended
                  : styles.statusInactive,
              ]}
            >
              <Text style={styles.statusText}>{memberStatus}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact Information</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Mail size={18} color={Colors.textSecondary} />
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Email</Text>
                <Text style={styles.infoValue}>{member.email || 'Not provided'}</Text>
              </View>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Phone size={18} color={Colors.textSecondary} />
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Phone</Text>
                <Text style={styles.infoValue}>{member.phone || 'Not provided'}</Text>
              </View>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <MapPin size={18} color={Colors.textSecondary} />
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Country</Text>
                <Text style={styles.infoValue}>{member.country || 'Not provided'}</Text>
              </View>
            </View>
          </View>
        </View>

        {kycVerification && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Shield size={20} color={Colors.primary} />
              <Text style={styles.sectionTitle}>KYC Verification Data</Text>
            </View>

            {kycVerification.verification_score !== null && (
              <View style={styles.kycScoreCard}>
                <View style={styles.kycScoreRow}>
                  <View style={styles.kycScoreLeft}>
                    <Text style={styles.kycScoreLabel}>Verification Score</Text>
                    <Text style={[styles.kycScoreValue, { color: (kycVerification.verification_score ?? 0) >= 0.7 ? Colors.positive : Colors.negative }]}>
                      {((kycVerification.verification_score ?? 0) * 100).toFixed(1)}%
                    </Text>
                  </View>
                  {kycVerification.risk_level && (
                    <View style={[styles.riskBadge, { backgroundColor: getRiskColor(kycVerification.risk_level) + '20' }]}>
                      <Text style={[styles.riskBadgeText, { color: getRiskColor(kycVerification.risk_level) }]}>
                        {(kycVerification.risk_level || '').toUpperCase()} RISK
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.scoreBar}>
                  <View style={[styles.scoreBarFill, { width: `${(kycVerification.verification_score ?? 0) * 100}%`, backgroundColor: (kycVerification.verification_score ?? 0) >= 0.7 ? Colors.positive : Colors.negative }]} />
                </View>
                <View style={styles.kycMetaRow}>
                  <Text style={styles.kycMetaText}>
                    Status: {(kycVerification.status || 'pending').replace('_', ' ')}
                  </Text>
                  {kycVerification.submitted_at && (
                    <Text style={styles.kycMetaText}>
                      Submitted: {formatDateTime(kycVerification.submitted_at)}
                    </Text>
                  )}
                </View>
                {kycVerification.reviewed_at && (
                  <Text style={styles.kycMetaText}>
                    Reviewed: {formatDateTime(kycVerification.reviewed_at)}
                  </Text>
                )}
              </View>
            )}

            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <User size={16} color={Colors.textSecondary} />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Full Name (KYC)</Text>
                  <Text style={styles.infoValue}>{kycVerification.first_name} {kycVerification.last_name}</Text>
                </View>
              </View>
              <View style={styles.infoDivider} />
              <View style={styles.infoRow}>
                <Calendar size={16} color={Colors.textSecondary} />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Date of Birth</Text>
                  <Text style={styles.infoValue}>{kycVerification.date_of_birth || 'N/A'}</Text>
                </View>
              </View>
              <View style={styles.infoDivider} />
              <View style={styles.infoRow}>
                <Globe size={16} color={Colors.textSecondary} />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Nationality</Text>
                  <Text style={styles.infoValue}>{kycVerification.nationality || 'N/A'} ({kycVerification.nationality_code || ''})</Text>
                </View>
              </View>
              <View style={styles.infoDivider} />
              <View style={styles.infoRow}>
                <IdCard size={16} color={Colors.textSecondary} />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Tax ID</Text>
                  <Text style={styles.infoValue}>{kycVerification.tax_id ? '••••' + kycVerification.tax_id.slice(-4) : 'N/A'}</Text>
                </View>
              </View>
              <View style={styles.infoDivider} />
              <View style={styles.infoRow}>
                <MapPin size={16} color={Colors.textSecondary} />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Address (KYC)</Text>
                  <Text style={styles.infoValue}>
                    {[kycVerification.street, kycVerification.city, kycVerification.state, kycVerification.postal_code, kycVerification.country].filter(Boolean).join(', ') || 'N/A'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {kycDocuments.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <FileText size={20} color={Colors.info} />
              <Text style={styles.sectionTitle}>KYC Documents ({kycDocuments.length})</Text>
            </View>
            <View style={styles.infoCard}>
              {kycDocuments.map((doc, idx) => (
                <React.Fragment key={doc.id}>
                  <View style={styles.docRow}>
                    {getDocIcon(doc.document_type)}
                    <View style={styles.docInfo}>
                      <Text style={styles.docType}>{getDocTypeLabel(doc.document_type)}</Text>
                      <Text style={styles.docMeta}>
                        {doc.issuing_country ? `${doc.issuing_country} · ` : ''}{formatDateTime(doc.created_at)}
                      </Text>
                    </View>
                    <View style={[styles.docStatusBadge, { backgroundColor: doc.status === 'verified' ? Colors.positive + '20' : Colors.warning + '20' }]}>
                      <Text style={[styles.docStatusText, { color: doc.status === 'verified' ? Colors.positive : Colors.warning }]}>
                        {doc.status || 'pending'}
                      </Text>
                    </View>
                  </View>
                  {doc.document_url && (
                    <View style={styles.docPreviewContainer}>
                      <Image source={{ uri: doc.document_url }} style={styles.docPreview} resizeMode="cover" />
                    </View>
                  )}
                  {idx < kycDocuments.length - 1 && <View style={styles.infoDivider} />}
                </React.Fragment>
              ))}
            </View>
          </View>
        )}

        {!kycVerification && kycDocuments.length === 0 && (kycStatus === 'pending') && (
          <View style={styles.section}>
            <View style={styles.noKycCard}>
              <AlertTriangle size={24} color={Colors.warning} />
              <Text style={styles.noKycTitle}>No KYC Submitted</Text>
              <Text style={styles.noKycText}>This member has not started or completed their KYC verification yet.</Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Financial Overview</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Wallet size={20} color={Colors.primary} />
              <Text style={styles.statValue}>{formatCurrency(Number(wallet?.available) || 0)}</Text>
              <Text style={styles.statLabel}>Wallet Balance</Text>
            </View>
            <View style={styles.statCard}>
              <TrendingUp size={20} color={Colors.positive} />
              <Text style={styles.statValue}>{formatCurrency(Number(member.total_invested) || 0)}</Text>
              <Text style={styles.statLabel}>Total Invested</Text>
            </View>
            <View style={styles.statCard}>
              <Building2 size={20} color={Colors.accent} />
              <Text style={styles.statValue}>{holdings.length}</Text>
              <Text style={styles.statLabel}>Holdings</Text>
            </View>
            <View style={styles.statCard}>
              <TrendingUp size={20} color={Colors.positive} />
              <Text style={styles.statValue}>{formatCurrency(Number(member.total_returns) || 0)}</Text>
              <Text style={styles.statLabel}>Total Returns</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Activity</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Calendar size={18} color={Colors.textSecondary} />
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Member Since</Text>
                <Text style={styles.infoValue}>{member.created_at ? formatDate(member.created_at) : 'Unknown'}</Text>
              </View>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Clock size={18} color={Colors.textSecondary} />
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Last Updated</Text>
                <Text style={styles.infoValue}>{member.updated_at ? formatDateTime(member.updated_at) : 'Unknown'}</Text>
              </View>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <TrendingUp size={18} color={Colors.textSecondary} />
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Total Transactions</Text>
                <Text style={styles.infoValue}>{totalTransactions}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Actions</Text>
          <View style={styles.actionsCard}>
            {(kycStatus === 'pending' || kycStatus === 'in_review') && (
              <>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleAction('approve')}
                >
                  <CheckCircle size={20} color={Colors.positive} />
                  <Text style={[styles.actionButtonText, { color: Colors.positive }]}>
                    Approve KYC
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleAction('reject')}
                >
                  <Ban size={20} color={Colors.negative} />
                  <Text style={[styles.actionButtonText, { color: Colors.negative }]}>
                    Reject KYC
                  </Text>
                </TouchableOpacity>
              </>
            )}
            {kycStatus === 'approved' && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleAction('reject')}
              >
                <Ban size={20} color={Colors.negative} />
                <Text style={[styles.actionButtonText, { color: Colors.negative }]}>
                  Revoke KYC Approval
                </Text>
              </TouchableOpacity>
            )}
            {kycStatus === 'rejected' && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleAction('approve')}
              >
                <CheckCircle size={20} color={Colors.positive} />
                <Text style={[styles.actionButtonText, { color: Colors.positive }]}>
                  Re-Approve KYC
                </Text>
              </TouchableOpacity>
            )}
            {memberStatus === 'active' ? (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleAction('suspend')}
              >
                <Ban size={20} color={Colors.negative} />
                <Text style={[styles.actionButtonText, { color: Colors.negative }]}>
                  Suspend Account
                </Text>
              </TouchableOpacity>
            ) : memberStatus === 'suspended' ? (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleAction('activate')}
              >
                <CheckCircle size={20} color={Colors.positive} />
                <Text style={[styles.actionButtonText, { color: Colors.positive }]}>
                  Activate Account
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center'},
  headerTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text},
  content: {
    flex: 1},
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'},
  errorText: {
    fontSize: 16,
    color: Colors.textSecondary,
    marginBottom: 16},
  backLink: {
    fontSize: 16,
    color: Colors.primary,
    fontWeight: '600' as const},
  profileSection: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 16},
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16},
  memberName: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12},
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  kycBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8},
  kycTextStyle: {
    fontSize: 13,
    fontWeight: '600' as const,
    textTransform: 'capitalize' as const},
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8},
  statusActive: {
    backgroundColor: Colors.positive + '20'},
  statusSuspended: {
    backgroundColor: Colors.negative + '20'},
  statusInactive: {
    backgroundColor: Colors.textTertiary + '20'},
  statusText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
    textTransform: 'capitalize' as const},
  section: {
    padding: 20,
    paddingBottom: 0},
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14},
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 14},
  infoCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.border},
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 14},
  infoContent: {
    flex: 1},
  infoLabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginBottom: 2},
  infoValue: {
    fontSize: 15,
    fontWeight: '500' as const,
    color: Colors.text},
  infoDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginLeft: 50},
  kycScoreCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12},
  kycScoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12},
  kycScoreLeft: {
    gap: 2},
  kycScoreLabel: {
    fontSize: 12,
    color: Colors.textTertiary},
  kycScoreValue: {
    fontSize: 28,
    fontWeight: '800' as const},
  riskBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8},
  riskBadgeText: {
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 0.5},
  scoreBar: {
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: 'hidden' as const,
    marginBottom: 10},
  scoreBarFill: {
    height: 6,
    borderRadius: 3},
  kycMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    gap: 4},
  kycMetaText: {
    fontSize: 12,
    color: Colors.textTertiary},
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12},
  docInfo: {
    flex: 1},
  docType: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    textTransform: 'capitalize' as const},
  docMeta: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2},
  docStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6},
  docStatusText: {
    fontSize: 11,
    fontWeight: '600' as const,
    textTransform: 'capitalize' as const},
  docPreviewContainer: {
    paddingHorizontal: 14,
    paddingBottom: 10},
  docPreview: {
    width: '100%',
    height: 140,
    borderRadius: 10,
    backgroundColor: Colors.surfaceLight},
  noKycCard: {
    backgroundColor: Colors.warning + '10',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.warning + '25'},
  noKycTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text},
  noKycText: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 18},
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12},
  statCard: {
    width: '47%',
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border},
  statValue: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 10,
    marginBottom: 4},
  statLabel: {
    fontSize: 12,
    color: Colors.textSecondary},
  actionsCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: Colors.border},
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  actionButtonText: {
    fontSize: 15,
    fontWeight: '600' as const},
  bottomPadding: {
    height: 100}});
