import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  Modal} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Users,
  Search,
  Plus,
  QrCode,
  Copy,
  DollarSign,
  UserCheck,
  Clock,
  X,
  Instagram,
  Twitter,
  Facebook,
  Linkedin,
  Music2,
  Download,
  Eye,
  Edit2,
  BarChart3,
  CheckCircle,
  Pause,
  XCircle,
  Sparkles,
  ArrowLeft} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { formatCurrency as _fmtCurr } from '@/lib/formatters';
import {
  mockInfluencers,
  mockInfluencerReferrals,
  mockInfluencerApplications,
  getInfluencerStats,
  getInfluencerReferrals,
  getTierColor,
  getStatusColor,
  getPlatformColor,
  getApplicationStatusColor,
  getSourceLabel} from '@/mocks/marketing';
import { Influencer, InfluencerApplication, SocialPlatform } from '@/types';

type TabType = 'overview' | 'influencers' | 'applications' | 'referrals' | 'payouts';
type FilterStatus = 'all' | 'active' | 'paused' | 'pending' | 'terminated';
type ApplicationFilterStatus = 'all' | 'pending' | 'approved' | 'rejected';

const getPlatformIcon = (platform: SocialPlatform, size: number, color: string) => {
  switch (platform) {
    case 'instagram':
      return <Instagram size={size} color={color} />;
    case 'twitter':
      return <Twitter size={size} color={color} />;
    case 'facebook':
      return <Facebook size={size} color={color} />;
    case 'linkedin':
      return <Linkedin size={size} color={color} />;
    case 'tiktok':
      return <Music2 size={size} color={color} />;
    default:
      return <Users size={size} color={color} />;
  }
};

const getStatusIcon = (status: Influencer['status']) => {
  switch (status) {
    case 'active':
      return <CheckCircle size={14} color={getStatusColor(status)} />;
    case 'paused':
      return <Pause size={14} color={getStatusColor(status)} />;
    case 'pending':
      return <Clock size={14} color={getStatusColor(status)} />;
    case 'terminated':
      return <XCircle size={14} color={getStatusColor(status)} />;
  }
};

export default function InfluencersScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [selectedInfluencer, setSelectedInfluencer] = useState<Influencer | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [applicationFilter, setApplicationFilter] = useState<ApplicationFilterStatus>('pending');
  const [selectedApplication, setSelectedApplication] = useState<InfluencerApplication | null>(null);
  const [showApplicationModal, setShowApplicationModal] = useState(false);
  const [applications, setApplications] = useState(mockInfluencerApplications);

  const stats = useMemo(() => getInfluencerStats(), []);

  const filteredInfluencers = useMemo(() => {
    let filtered = [...mockInfluencers];
    
    if (filterStatus !== 'all') {
      filtered = filtered.filter(i => i.status === filterStatus);
    }
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(i => 
        i.name.toLowerCase().includes(query) ||
        i.handle.toLowerCase().includes(query) ||
        i.referralCode.toLowerCase().includes(query)
      );
    }
    
    return filtered.sort((a, b) => b.totalEarnings - a.totalEarnings);
  }, [filterStatus, searchQuery]);

  const formatCurrency = (amount: number) => _fmtCurr(amount);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'});
  };

  const copyToClipboard = useCallback((text: string, label: string) => {
    Alert.alert('Copied!', `${label} copied to clipboard`);
  }, []);

  const filteredApplications = useMemo(() => {
    if (applicationFilter === 'all') return applications;
    return applications.filter(a => a.status === applicationFilter);
  }, [applications, applicationFilter]);

  const pendingApplicationsCount = useMemo(() => {
    return applications.filter(a => a.status === 'pending').length;
  }, [applications]);

  const handleApproveApplication = useCallback((application: InfluencerApplication) => {
    Alert.alert(
      'Approve Application',
      `Are you sure you want to approve ${application.name} as an influencer?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: () => {
            setApplications(prev =>
              prev.map(a =>
                a.id === application.id
                  ? { ...a, status: 'approved' as const, reviewedAt: new Date().toISOString(), reviewedBy: 'Admin' }
                  : a
              )
            );
            setShowApplicationModal(false);
            Alert.alert('Success', `${application.name} has been approved as an influencer!`);
          }},
      ]
    );
  }, []);

  const handleRejectApplication = useCallback((application: InfluencerApplication) => {
    Alert.alert(
      'Reject Application',
      `Are you sure you want to reject ${application.name}'s application?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: () => {
            setApplications(prev =>
              prev.map(a =>
                a.id === application.id
                  ? { ...a, status: 'rejected' as const, reviewedAt: new Date().toISOString(), reviewedBy: 'Admin', rejectionReason: 'Does not meet requirements' }
                  : a
              )
            );
            setShowApplicationModal(false);
            Alert.alert('Rejected', `${application.name}'s application has been rejected.`);
          }},
      ]
    );
  }, []);

  const viewInfluencerDetails = useCallback((influencer: Influencer) => {
    setSelectedInfluencer(influencer);
    setShowDetailModal(true);
  }, []);

  const viewQRCode = useCallback((influencer: Influencer) => {
    setSelectedInfluencer(influencer);
    setShowQRModal(true);
  }, []);

  const renderOverview = () => (
    <View style={styles.overviewContainer}>
      <View style={styles.statsGrid}>
        <View style={[styles.statCard, styles.statCardPrimary]}>
          <Users size={24} color="#fff" />
          <Text style={styles.statValueLight}>{stats.totalInfluencers}</Text>
          <Text style={styles.statLabelLight}>Total Influencers</Text>
        </View>
        <View style={styles.statCard}>
          <UserCheck size={22} color={Colors.positive} />
          <Text style={styles.statValue}>{stats.activeInfluencers}</Text>
          <Text style={styles.statLabel}>Active</Text>
        </View>
        <View style={styles.statCard}>
          <DollarSign size={22} color={Colors.primary} />
          <Text style={styles.statValue}>{formatCurrency(stats.totalCommissionsPaid)}</Text>
          <Text style={styles.statLabel}>Paid Out</Text>
        </View>
        <View style={styles.statCard}>
          <Clock size={22} color={Colors.warning} />
          <Text style={styles.statValue}>{formatCurrency(stats.pendingCommissions)}</Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>
      </View>

      <View style={styles.performanceSection}>
        <View style={styles.performanceHeader}>
          <BarChart3 size={20} color={Colors.primary} />
          <Text style={styles.performanceTitle}>Performance Overview</Text>
        </View>
        <View style={styles.performanceGrid}>
          <View style={styles.performanceItem}>
            <Text style={styles.performanceValue}>{stats.totalReferrals}</Text>
            <Text style={styles.performanceLabel}>Total Referrals</Text>
          </View>
          <View style={styles.performanceItem}>
            <Text style={styles.performanceValue}>{stats.totalSignups}</Text>
            <Text style={styles.performanceLabel}>Sign Ups</Text>
          </View>
          <View style={styles.performanceItem}>
            <Text style={styles.performanceValue}>{stats.totalInvestments}</Text>
            <Text style={styles.performanceLabel}>Investments</Text>
          </View>
          <View style={styles.performanceItem}>
            <Text style={[styles.performanceValue, { color: Colors.positive }]}>
              {stats.averageConversionRate.toFixed(1)}%
            </Text>
            <Text style={styles.performanceLabel}>Conversion</Text>
          </View>
        </View>
        <View style={styles.totalInvestment}>
          <Text style={styles.totalInvestmentLabel}>Total Investment Generated</Text>
          <Text style={styles.totalInvestmentValue}>{formatCurrency(stats.totalInvestmentAmount)}</Text>
        </View>
      </View>

      <View style={styles.topPerformersSection}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Top Performers</Text>
          <TouchableOpacity onPress={() => setActiveTab('influencers')}>
            <Text style={styles.seeAll}>View All</Text>
          </TouchableOpacity>
        </View>
        {stats.topPerformers.slice(0, 3).map((influencer, index) => (
          <TouchableOpacity 
            key={influencer.id} 
            style={styles.topPerformerCard}
            onPress={() => viewInfluencerDetails(influencer)}
          >
            <View style={styles.rankBadge}>
              <Text style={styles.rankText}>{index + 1}</Text>
            </View>
            {influencer.avatar ? (
              <Image source={{ uri: influencer.avatar }} style={styles.topPerformerAvatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Users size={20} color={Colors.textSecondary} />
              </View>
            )}
            <View style={styles.topPerformerInfo}>
              <Text style={styles.topPerformerName}>{influencer.name}</Text>
              <View style={styles.topPerformerMeta}>
                {getPlatformIcon(influencer.platform, 12, getPlatformColor(influencer.platform))}
                <Text style={styles.topPerformerHandle}>{influencer.handle}</Text>
              </View>
            </View>
            <View style={styles.topPerformerStats}>
              <Text style={styles.topPerformerEarnings}>{formatCurrency(influencer.totalEarnings)}</Text>
              <Text style={styles.topPerformerReferrals}>
                {getInfluencerReferrals(influencer.id).length} referrals
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderInfluencers = () => (
    <View style={styles.listContainer}>
      <View style={styles.searchFilterRow}>
        <View style={styles.searchBar}>
          <Search size={18} color={Colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search influencers..."
            placeholderTextColor={Colors.textTertiary}
          />
        </View>
        <TouchableOpacity style={styles.addButton} onPress={() => setShowAddModal(true)}>
          <Plus size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterTabs}>
        {(['all', 'active', 'paused', 'pending', 'terminated'] as FilterStatus[]).map((status) => (
          <TouchableOpacity
            key={status}
            style={[styles.filterTab, filterStatus === status && styles.filterTabActive]}
            onPress={() => setFilterStatus(status)}
          >
            <Text style={[styles.filterTabText, filterStatus === status && styles.filterTabTextActive]}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.resultCount}>{filteredInfluencers.length} influencers</Text>

      {filteredInfluencers.map((influencer) => (
        <TouchableOpacity
          key={influencer.id}
          style={styles.influencerCard}
          onPress={() => viewInfluencerDetails(influencer)}
        >
          <View style={styles.influencerHeader}>
            {influencer.avatar ? (
              <Image source={{ uri: influencer.avatar }} style={styles.influencerAvatar} />
            ) : (
              <View style={[styles.avatarPlaceholder, { width: 50, height: 50 }]}>
                <Users size={24} color={Colors.textSecondary} />
              </View>
            )}
            <View style={styles.influencerInfo}>
              <View style={styles.influencerNameRow}>
                <Text style={styles.influencerName}>{influencer.name}</Text>
                <View style={[styles.tierBadge, { backgroundColor: getTierColor(influencer.tier) + '20' }]}>
                  <Text style={[styles.tierText, { color: getTierColor(influencer.tier) }]}>
                    {influencer.tier.toUpperCase()}
                  </Text>
                </View>
              </View>
              <View style={styles.influencerMeta}>
                {getPlatformIcon(influencer.platform, 14, getPlatformColor(influencer.platform))}
                <Text style={styles.influencerHandle}>{influencer.handle}</Text>
                <Text style={styles.followerCount}>• {formatNumber(influencer.followers)} followers</Text>
              </View>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(influencer.status) + '20' }]}>
              {getStatusIcon(influencer.status)}
            </View>
          </View>

          <View style={styles.influencerStats}>
            <View style={styles.influencerStatItem}>
              <Text style={styles.influencerStatValue}>{influencer.commissionRate}%</Text>
              <Text style={styles.influencerStatLabel}>Commission</Text>
            </View>
            <View style={styles.influencerStatItem}>
              <Text style={styles.influencerStatValue}>{formatCurrency(influencer.totalEarnings)}</Text>
              <Text style={styles.influencerStatLabel}>Total Earned</Text>
            </View>
            <View style={styles.influencerStatItem}>
              <Text style={[styles.influencerStatValue, { color: Colors.warning }]}>
                {formatCurrency(influencer.pendingEarnings)}
              </Text>
              <Text style={styles.influencerStatLabel}>Pending</Text>
            </View>
          </View>

          <View style={styles.codeRow}>
            <View style={styles.codeContainer}>
              <Text style={styles.codeLabel}>Referral Code:</Text>
              <Text style={styles.codeValue}>{influencer.referralCode}</Text>
              <TouchableOpacity onPress={() => copyToClipboard(influencer.referralCode, 'Referral code')}>
                <Copy size={14} color={Colors.primary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.qrButton} onPress={() => viewQRCode(influencer)}>
              <QrCode size={16} color={Colors.primary} />
              <Text style={styles.qrButtonText}>QR</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderReferrals = () => (
    <View style={styles.listContainer}>
      <Text style={styles.listTitle}>All Influencer Referrals</Text>
      {mockInfluencerReferrals.map((referral) => (
        <View key={referral.id} style={styles.referralCard}>
          <View style={styles.referralHeader}>
            <View>
              <Text style={styles.referralName}>{referral.referredName || referral.referredEmail}</Text>
              <Text style={styles.referralInfluencer}>via {referral.influencerName}</Text>
            </View>
            <View style={[
              styles.referralStatusBadge,
              { backgroundColor: referral.status === 'invested' ? Colors.positive + '20' : 
                referral.status === 'signed_up' ? Colors.primary + '20' : Colors.warning + '20' }
            ]}>
              <Text style={[
                styles.referralStatusText,
                { color: referral.status === 'invested' ? Colors.positive : 
                  referral.status === 'signed_up' ? Colors.primary : Colors.warning }
              ]}>
                {referral.status.replace('_', ' ')}
              </Text>
            </View>
          </View>
          <View style={styles.referralDetails}>
            <View style={styles.referralDetail}>
              <Text style={styles.referralDetailLabel}>Code</Text>
              <Text style={styles.referralDetailValue}>{referral.referralCode}</Text>
            </View>
            {referral.investmentAmount && (
              <View style={styles.referralDetail}>
                <Text style={styles.referralDetailLabel}>Investment</Text>
                <Text style={styles.referralDetailValue}>{formatCurrency(referral.investmentAmount)}</Text>
              </View>
            )}
            <View style={styles.referralDetail}>
              <Text style={styles.referralDetailLabel}>Commission</Text>
              <Text style={[
                styles.referralDetailValue, 
                { color: referral.commissionPaid ? Colors.positive : Colors.warning }
              ]}>
                {formatCurrency(referral.commission)} {referral.commissionPaid ? '(Paid)' : '(Pending)'}
              </Text>
            </View>
          </View>
          <Text style={styles.referralDate}>{formatDate(referral.createdAt)}</Text>
        </View>
      ))}
    </View>
  );

  const renderApplications = () => (
    <View style={styles.listContainer}>
      <View style={styles.applicationInfoCard}>
        <View style={styles.applicationInfoIcon}>
          <Users size={24} color={Colors.primary} />
        </View>
        <View style={styles.applicationInfoContent}>
          <Text style={styles.applicationInfoTitle}>Self-Registration</Text>
          <Text style={styles.applicationInfoText}>
            Influencers can register themselves through the app or via referral links. Review and approve applications below.
          </Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterTabs}>
        {(['pending', 'approved', 'rejected', 'all'] as ApplicationFilterStatus[]).map((status) => (
          <TouchableOpacity
            key={status}
            style={[styles.filterTab, applicationFilter === status && styles.filterTabActive]}
            onPress={() => setApplicationFilter(status)}
          >
            <Text style={[styles.filterTabText, applicationFilter === status && styles.filterTabTextActive]}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
              {status === 'pending' && pendingApplicationsCount > 0 && ` (${pendingApplicationsCount})`}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.resultCount}>{filteredApplications.length} applications</Text>

      {filteredApplications.map((application) => (
        <TouchableOpacity
          key={application.id}
          style={styles.applicationCard}
          onPress={() => {
            setSelectedApplication(application);
            setShowApplicationModal(true);
          }}
        >
          <View style={styles.applicationHeader}>
            <View style={styles.applicationAvatar}>
              <Users size={24} color={Colors.textSecondary} />
            </View>
            <View style={styles.applicationInfo}>
              <View style={styles.applicationNameRow}>
                <Text style={styles.applicationName}>{application.name}</Text>
                <View style={[styles.applicationStatusBadge, { backgroundColor: getApplicationStatusColor(application.status) + '20' }]}>
                  <Text style={[styles.applicationStatusText, { color: getApplicationStatusColor(application.status) }]}>
                    {application.status}
                  </Text>
                </View>
              </View>
              <View style={styles.applicationMeta}>
                {getPlatformIcon(application.platform, 14, getPlatformColor(application.platform))}
                <Text style={styles.applicationHandle}>{application.handle}</Text>
                <Text style={styles.applicationFollowers}>• {formatNumber(application.followers)} followers</Text>
              </View>
            </View>
          </View>

          <View style={styles.applicationDetails}>
            <View style={styles.applicationDetailItem}>
              <Text style={styles.applicationDetailLabel}>Source</Text>
              <Text style={styles.applicationDetailValue}>{getSourceLabel(application.source)}</Text>
            </View>
            {application.referredBy && (
              <View style={styles.applicationDetailItem}>
                <Text style={styles.applicationDetailLabel}>Referred By</Text>
                <Text style={styles.applicationDetailValue}>{application.referredBy}</Text>
              </View>
            )}
            <View style={styles.applicationDetailItem}>
              <Text style={styles.applicationDetailLabel}>Applied</Text>
              <Text style={styles.applicationDetailValue}>{formatDate(application.createdAt)}</Text>
            </View>
          </View>

          {application.status === 'pending' && (
            <View style={styles.applicationActions}>
              <TouchableOpacity
                style={styles.approveButton}
                onPress={() => handleApproveApplication(application)}
              >
                <CheckCircle size={14} color="#fff" />
                <Text style={styles.approveButtonText}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.rejectButton}
                onPress={() => handleRejectApplication(application)}
              >
                <XCircle size={14} color={Colors.negative} />
                <Text style={styles.rejectButtonText}>Reject</Text>
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderPayouts = () => {
    const pendingPayouts = mockInfluencers.filter(i => i.pendingEarnings > 0);
    const totalPending = pendingPayouts.reduce((sum, i) => sum + i.pendingEarnings, 0);

    return (
      <View style={styles.listContainer}>
        <View style={styles.payoutSummary}>
          <View style={styles.payoutSummaryItem}>
            <Text style={styles.payoutSummaryLabel}>Total Pending</Text>
            <Text style={styles.payoutSummaryValue}>{formatCurrency(totalPending)}</Text>
          </View>
          <TouchableOpacity style={styles.payAllButton}>
            <DollarSign size={16} color="#fff" />
            <Text style={styles.payAllText}>Pay All</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.listTitle}>Pending Payouts ({pendingPayouts.length})</Text>
        {pendingPayouts.map((influencer) => (
          <View key={influencer.id} style={styles.payoutCard}>
            <View style={styles.payoutHeader}>
              {influencer.avatar ? (
                <Image source={{ uri: influencer.avatar }} style={styles.payoutAvatar} />
              ) : (
                <View style={[styles.avatarPlaceholder, { width: 40, height: 40 }]}>
                  <Users size={18} color={Colors.textSecondary} />
                </View>
              )}
              <View style={styles.payoutInfo}>
                <Text style={styles.payoutName}>{influencer.name}</Text>
                <Text style={styles.payoutEmail}>{influencer.email}</Text>
              </View>
              <Text style={styles.payoutAmount}>{formatCurrency(influencer.pendingEarnings)}</Text>
            </View>
            <View style={styles.payoutActions}>
              <TouchableOpacity style={styles.payButton}>
                <CheckCircle size={14} color="#fff" />
                <Text style={styles.payButtonText}>Mark Paid</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.viewDetailsButton}>
                <Eye size={14} color={Colors.primary} />
                <Text style={styles.viewDetailsText}>Details</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Influencers</Text>
          <Text style={styles.subtitle}>Track & manage influencer referrals</Text>
        </View>
        <TouchableOpacity style={styles.exportButton}>
          <Download size={18} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabContainer}>
        {[
          { key: 'overview', label: 'Overview' },
          { key: 'influencers', label: 'Influencers' },
          { key: 'applications', label: `Applications${pendingApplicationsCount > 0 ? ` (${pendingApplicationsCount})` : ''}` },
          { key: 'referrals', label: 'Referrals' },
          { key: 'payouts', label: 'Payouts' },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key as TabType)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'influencers' && renderInfluencers()}
        {activeTab === 'applications' && renderApplications()}
        {activeTab === 'referrals' && renderReferrals()}
        {activeTab === 'payouts' && renderPayouts()}
        <View style={styles.bottomPadding} />
      </ScrollView>

      <Modal
        visible={showDetailModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowDetailModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowDetailModal(false)}>
              <X size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Influencer Details</Text>
            <TouchableOpacity>
              <Edit2 size={20} color={Colors.primary} />
            </TouchableOpacity>
          </View>

          {selectedInfluencer && (
            <ScrollView style={styles.modalContent}>
              <View style={styles.detailHeader}>
                {selectedInfluencer.avatar ? (
                  <Image source={{ uri: selectedInfluencer.avatar }} style={styles.detailAvatar} />
                ) : (
                  <View style={[styles.avatarPlaceholder, { width: 80, height: 80, borderRadius: 40 }]}>
                    <Users size={36} color={Colors.textSecondary} />
                  </View>
                )}
                <Text style={styles.detailName}>{selectedInfluencer.name}</Text>
                <View style={styles.detailMeta}>
                  {getPlatformIcon(selectedInfluencer.platform, 16, getPlatformColor(selectedInfluencer.platform))}
                  <Text style={styles.detailHandle}>{selectedInfluencer.handle}</Text>
                </View>
                <View style={styles.detailBadges}>
                  <View style={[styles.tierBadge, { backgroundColor: getTierColor(selectedInfluencer.tier) + '20' }]}>
                    <Text style={[styles.tierText, { color: getTierColor(selectedInfluencer.tier) }]}>
                      {selectedInfluencer.tier.toUpperCase()}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(selectedInfluencer.status) + '20' }]}>
                    {getStatusIcon(selectedInfluencer.status)}
                    <Text style={[styles.statusText, { color: getStatusColor(selectedInfluencer.status) }]}>
                      {selectedInfluencer.status}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.detailStats}>
                <View style={styles.detailStatItem}>
                  <Text style={styles.detailStatValue}>{formatNumber(selectedInfluencer.followers)}</Text>
                  <Text style={styles.detailStatLabel}>Followers</Text>
                </View>
                <View style={styles.detailStatItem}>
                  <Text style={styles.detailStatValue}>{selectedInfluencer.commissionRate}%</Text>
                  <Text style={styles.detailStatLabel}>Commission</Text>
                </View>
                <View style={styles.detailStatItem}>
                  <Text style={styles.detailStatValue}>
                    {getInfluencerReferrals(selectedInfluencer.id).length}
                  </Text>
                  <Text style={styles.detailStatLabel}>Referrals</Text>
                </View>
              </View>

              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>Earnings</Text>
                <View style={styles.earningsCard}>
                  <View style={styles.earningsRow}>
                    <Text style={styles.earningsLabel}>Total Earned</Text>
                    <Text style={styles.earningsValue}>{formatCurrency(selectedInfluencer.totalEarnings)}</Text>
                  </View>
                  <View style={styles.earningsRow}>
                    <Text style={styles.earningsLabel}>Paid Out</Text>
                    <Text style={[styles.earningsValue, { color: Colors.positive }]}>
                      {formatCurrency(selectedInfluencer.paidEarnings)}
                    </Text>
                  </View>
                  <View style={styles.earningsRow}>
                    <Text style={styles.earningsLabel}>Pending</Text>
                    <Text style={[styles.earningsValue, { color: Colors.warning }]}>
                      {formatCurrency(selectedInfluencer.pendingEarnings)}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>Referral Code & QR</Text>
                <View style={styles.codeCard}>
                  <View style={styles.codeCardRow}>
                    <Text style={styles.codeCardLabel}>Code</Text>
                    <View style={styles.codeCardValue}>
                      <Text style={styles.codeCardCode}>{selectedInfluencer.referralCode}</Text>
                      <TouchableOpacity onPress={() => copyToClipboard(selectedInfluencer.referralCode, 'Code')}>
                        <Copy size={16} color={Colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  <TouchableOpacity 
                    style={styles.showQRButton}
                    onPress={() => {
                      setShowDetailModal(false);
                      setTimeout(() => viewQRCode(selectedInfluencer), 300);
                    }}
                  >
                    <QrCode size={18} color="#fff" />
                    <Text style={styles.showQRText}>Show QR Code</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>Contract Details</Text>
                <View style={styles.contractCard}>
                  <View style={styles.contractRow}>
                    <Text style={styles.contractLabel}>Start Date</Text>
                    <Text style={styles.contractValue}>{formatDate(selectedInfluencer.contractStartDate)}</Text>
                  </View>
                  {selectedInfluencer.contractEndDate && (
                    <View style={styles.contractRow}>
                      <Text style={styles.contractLabel}>End Date</Text>
                      <Text style={styles.contractValue}>{formatDate(selectedInfluencer.contractEndDate)}</Text>
                    </View>
                  )}
                  <View style={styles.contractRow}>
                    <Text style={styles.contractLabel}>Email</Text>
                    <Text style={styles.contractValue}>{selectedInfluencer.email}</Text>
                  </View>
                  {selectedInfluencer.phone && (
                    <View style={styles.contractRow}>
                      <Text style={styles.contractLabel}>Phone</Text>
                      <Text style={styles.contractValue}>{selectedInfluencer.phone}</Text>
                    </View>
                  )}
                </View>
              </View>

              {selectedInfluencer.notes && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>Notes</Text>
                  <Text style={styles.notesText}>{selectedInfluencer.notes}</Text>
                </View>
              )}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      <Modal
        visible={showQRModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowQRModal(false)}
      >
        <View style={styles.qrModalOverlay}>
          <View style={styles.qrModalContent}>
            <TouchableOpacity style={styles.qrCloseButton} onPress={() => setShowQRModal(false)}>
              <X size={24} color={Colors.text} />
            </TouchableOpacity>
            {selectedInfluencer && (
              <>
                <Text style={styles.qrTitle}>{selectedInfluencer.name}</Text>
                <Text style={styles.qrCode}>{selectedInfluencer.referralCode}</Text>
                <View style={styles.qrImageContainer}>
                  <Image
                    source={{ uri: selectedInfluencer.qrCodeUrl }}
                    style={styles.qrImage}
                    resizeMode="contain"
                  />
                </View>
                <Text style={styles.qrLink}>ipxholding.com/join?ref={selectedInfluencer.referralCode}</Text>
                <View style={styles.qrActions}>
                  <TouchableOpacity 
                    style={styles.qrActionButton}
                    onPress={() => copyToClipboard(`https://ipxholding.com/join?ref=${selectedInfluencer.referralCode}`, 'Link')}
                  >
                    <Copy size={16} color="#fff" />
                    <Text style={styles.qrActionText}>Copy Link</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.qrActionButton, styles.qrDownloadButton]}>
                    <Download size={16} color={Colors.primary} />
                    <Text style={[styles.qrActionText, { color: Colors.primary }]}>Download QR</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAddModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <X size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Influencer Registration</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView style={styles.addModalContent}>
            <View style={styles.addIconContainer}>
              <Sparkles size={48} color={Colors.primary} />
            </View>
            <Text style={styles.addTitle}>Self-Registration System</Text>
            <Text style={styles.addDescription}>
              Influencers register themselves through the app or via referrals. You review and approve applications.
            </Text>

            <View style={styles.howItWorksSection}>
              <Text style={styles.howItWorksTitle}>How It Works</Text>
              
              <View style={styles.howItWorksStep}>
                <View style={styles.stepNumber}><Text style={styles.stepNumberText}>1</Text></View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepTitle}>Discovery</Text>
                  <Text style={styles.stepDescription}>Influencers find IVXHOLDINGS through app stores, social media, or existing influencer referrals.</Text>
                </View>
              </View>

              <View style={styles.howItWorksStep}>
                <View style={styles.stepNumber}><Text style={styles.stepNumberText}>2</Text></View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepTitle}>Application</Text>
                  <Text style={styles.stepDescription}>They submit an application with their social profile, follower count, and why they want to join.</Text>
                </View>
              </View>

              <View style={styles.howItWorksStep}>
                <View style={styles.stepNumber}><Text style={styles.stepNumberText}>3</Text></View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepTitle}>Admin Review</Text>
                  <Text style={styles.stepDescription}>You review the application and approve or reject based on quality and fit.</Text>
                </View>
              </View>

              <View style={styles.howItWorksStep}>
                <View style={styles.stepNumber}><Text style={styles.stepNumberText}>4</Text></View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepTitle}>Activation</Text>
                  <Text style={styles.stepDescription}>Approved influencers receive their unique referral code and QR code to start promoting.</Text>
                </View>
              </View>
            </View>

            <TouchableOpacity 
              style={styles.viewApplicationsButton}
              onPress={() => {
                setShowAddModal(false);
                setActiveTab('applications');
              }}
            >
              <Users size={18} color="#fff" />
              <Text style={styles.viewApplicationsText}>View Applications ({pendingApplicationsCount} pending)</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={showApplicationModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowApplicationModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowApplicationModal(false)}>
              <X size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Application Details</Text>
            <View style={{ width: 24 }} />
          </View>

          {selectedApplication && (
            <ScrollView style={styles.modalContent}>
              <View style={styles.detailHeader}>
                <View style={[styles.avatarPlaceholder, { width: 80, height: 80, borderRadius: 40 }]}>
                  <Users size={36} color={Colors.textSecondary} />
                </View>
                <Text style={styles.detailName}>{selectedApplication.name}</Text>
                <View style={styles.detailMeta}>
                  {getPlatformIcon(selectedApplication.platform, 16, getPlatformColor(selectedApplication.platform))}
                  <Text style={styles.detailHandle}>{selectedApplication.handle}</Text>
                </View>
                <View style={[styles.applicationStatusBadge, { backgroundColor: getApplicationStatusColor(selectedApplication.status) + '20', marginTop: 8 }]}>
                  <Text style={[styles.applicationStatusText, { color: getApplicationStatusColor(selectedApplication.status) }]}>
                    {selectedApplication.status.toUpperCase()}
                  </Text>
                </View>
              </View>

              <View style={styles.detailStats}>
                <View style={styles.detailStatItem}>
                  <Text style={styles.detailStatValue}>{formatNumber(selectedApplication.followers)}</Text>
                  <Text style={styles.detailStatLabel}>Followers</Text>
                </View>
                <View style={styles.detailStatItem}>
                  <Text style={styles.detailStatValue}>{getSourceLabel(selectedApplication.source)}</Text>
                  <Text style={styles.detailStatLabel}>Source</Text>
                </View>
                <View style={styles.detailStatItem}>
                  <Text style={styles.detailStatValue}>{selectedApplication.platform}</Text>
                  <Text style={styles.detailStatLabel}>Platform</Text>
                </View>
              </View>

              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>Contact Info</Text>
                <View style={styles.contractCard}>
                  <View style={styles.contractRow}>
                    <Text style={styles.contractLabel}>Email</Text>
                    <Text style={styles.contractValue}>{selectedApplication.email}</Text>
                  </View>
                  {selectedApplication.phone && (
                    <View style={styles.contractRow}>
                      <Text style={styles.contractLabel}>Phone</Text>
                      <Text style={styles.contractValue}>{selectedApplication.phone}</Text>
                    </View>
                  )}
                  <View style={styles.contractRow}>
                    <Text style={styles.contractLabel}>Profile URL</Text>
                    <Text style={[styles.contractValue, { color: Colors.primary }]} numberOfLines={1}>
                      {selectedApplication.profileUrl}
                    </Text>
                  </View>
                </View>
              </View>

              {selectedApplication.referredBy && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>Referral Info</Text>
                  <View style={styles.contractCard}>
                    <View style={styles.contractRow}>
                      <Text style={styles.contractLabel}>Referred By</Text>
                      <Text style={styles.contractValue}>{selectedApplication.referredBy}</Text>
                    </View>
                    {selectedApplication.referralCode && (
                      <View style={styles.contractRow}>
                        <Text style={styles.contractLabel}>Referral Code</Text>
                        <Text style={[styles.contractValue, { color: Colors.primary }]}>{selectedApplication.referralCode}</Text>
                      </View>
                    )}
                  </View>
                </View>
              )}

              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>Bio</Text>
                <Text style={styles.notesText}>{selectedApplication.bio}</Text>
              </View>

              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>Why They Want to Join</Text>
                <Text style={styles.notesText}>{selectedApplication.whyJoin}</Text>
              </View>

              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>Application Date</Text>
                <Text style={styles.contractValue}>{formatDate(selectedApplication.createdAt)}</Text>
              </View>

              {selectedApplication.status === 'rejected' && selectedApplication.rejectionReason && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>Rejection Reason</Text>
                  <Text style={[styles.notesText, { color: Colors.negative }]}>{selectedApplication.rejectionReason}</Text>
                </View>
              )}

              {selectedApplication.status === 'pending' && (
                <View style={styles.applicationModalActions}>
                  <TouchableOpacity
                    style={styles.approveButtonLarge}
                    onPress={() => handleApproveApplication(selectedApplication)}
                  >
                    <CheckCircle size={20} color="#fff" />
                    <Text style={styles.approveButtonLargeText}>Approve Application</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.rejectButtonLarge}
                    onPress={() => handleRejectApplication(selectedApplication)}
                  >
                    <XCircle size={20} color={Colors.negative} />
                    <Text style={styles.rejectButtonLargeText}>Reject Application</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  title: { color: Colors.text, fontSize: 18, fontWeight: '800' as const, flexShrink: 1 },
  subtitle: { color: Colors.textSecondary, fontSize: 13, marginTop: 4 },
  exportButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  tabContainer: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 12, padding: 4, marginBottom: 16, marginHorizontal: 16 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: 13 },
  tabTextActive: { color: Colors.black },
  content: { flex: 1, paddingHorizontal: 20 },
  overviewContainer: { gap: 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statCardPrimary: { backgroundColor: Colors.primary },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statValueLight: { color: Colors.black },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  statLabelLight: { color: Colors.black, opacity: 0.7 },
  performanceSection: { marginBottom: 16 },
  performanceHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  performanceTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  performanceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  performanceItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  performanceValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  performanceLabel: { color: Colors.textSecondary, fontSize: 13 },
  totalInvestment: { gap: 4 },
  totalInvestmentLabel: { color: Colors.textSecondary, fontSize: 13 },
  totalInvestmentValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  topPerformersSection: { marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  seeAll: { color: Colors.primary, fontSize: 14, fontWeight: '600' as const },
  topPerformerCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  rankBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  rankText: { color: Colors.textSecondary, fontSize: 13 },
  topPerformerAvatar: { gap: 6 },
  avatarPlaceholder: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  topPerformerInfo: { flex: 1 },
  topPerformerName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  topPerformerMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  topPerformerHandle: { gap: 6 },
  topPerformerStats: { gap: 6 },
  topPerformerEarnings: { gap: 6 },
  topPerformerReferrals: { gap: 6 },
  listContainer: { gap: 10 },
  listTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  searchFilterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  searchInput: { flex: 1, color: Colors.text, fontSize: 15, paddingVertical: 12 },
  addButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  filterTabs: { gap: 4 },
  filterTab: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: Colors.surfaceBorder },
  filterTabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterTabText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
  filterTabTextActive: { color: Colors.black },
  resultCount: { gap: 8 },
  influencerCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  influencerHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  influencerAvatar: { width: 50, height: 50, borderRadius: 25 },
  influencerInfo: { flex: 1 },
  influencerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  influencerName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  tierBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  tierText: { color: Colors.textSecondary, fontSize: 13 },
  influencerMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  influencerHandle: { gap: 4 },
  followerCount: { gap: 4 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { color: Colors.textSecondary, fontSize: 13 },
  influencerStats: { gap: 4 },
  influencerStatItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  influencerStatValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  influencerStatLabel: { color: Colors.textSecondary, fontSize: 13 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  codeContainer: { gap: 8 },
  codeLabel: { color: Colors.textSecondary, fontSize: 13 },
  codeValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  qrButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  qrButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  referralCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  referralHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  referralName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  referralInfluencer: { gap: 4 },
  referralStatusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  referralStatusText: { color: Colors.textSecondary, fontSize: 13 },
  referralDetails: { gap: 4 },
  referralDetail: { gap: 4 },
  referralDetailLabel: { color: Colors.textSecondary, fontSize: 13 },
  referralDetailValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  referralDate: { color: Colors.textTertiary, fontSize: 12 },
  payoutSummary: { gap: 4 },
  payoutSummaryItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  payoutSummaryLabel: { color: Colors.textSecondary, fontSize: 13 },
  payoutSummaryValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  payAllButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  payAllText: { color: Colors.textSecondary, fontSize: 13 },
  payoutCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  payoutHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  payoutAvatar: { width: 40, height: 40, borderRadius: 20 },
  payoutInfo: { flex: 1 },
  payoutName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  payoutEmail: { color: Colors.textSecondary, fontSize: 13 },
  payoutAmount: { gap: 4 },
  payoutActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  payButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  payButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  viewDetailsButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  viewDetailsText: { color: Colors.textSecondary, fontSize: 13 },
  bottomPadding: { height: 120 },
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  modalContent: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  detailAvatar: { width: 80, height: 80, borderRadius: 40, alignSelf: 'center' },
  detailName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  detailMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailHandle: { gap: 4 },
  detailBadges: { gap: 4 },
  detailStats: { gap: 4 },
  detailStatItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  detailStatValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  detailStatLabel: { color: Colors.textSecondary, fontSize: 13 },
  detailSection: { marginBottom: 16 },
  detailSectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  earningsCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  earningsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  earningsLabel: { color: Colors.textSecondary, fontSize: 13 },
  earningsValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  codeCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  codeCardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  codeCardLabel: { color: Colors.textSecondary, fontSize: 13 },
  codeCardValue: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  codeCardCode: { gap: 4 },
  showQRButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  showQRText: { color: Colors.textSecondary, fontSize: 13 },
  contractCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  contractRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contractLabel: { color: Colors.textSecondary, fontSize: 13 },
  contractValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  notesText: { color: Colors.textSecondary, fontSize: 13 },
  qrModalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  qrModalContent: { backgroundColor: Colors.card, borderRadius: 24, padding: 24, width: '100%', alignItems: 'center', gap: 12 },
  qrCloseButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  qrTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  qrCode: { gap: 4 },
  qrImageContainer: { gap: 8 },
  qrImage: { width: '100%', height: 180, borderRadius: 12 },
  qrLink: { gap: 4 },
  qrActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  qrActionButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  qrDownloadButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  qrActionText: { color: '#000000', fontSize: 13, fontWeight: '600' as const },
  addModalContent: { gap: 4 },
  addIconContainer: { gap: 8 },
  addTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  addDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  addForm: { gap: 6 },
  addInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  addSubmitButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  addSubmitText: { color: '#000000', fontSize: 13, fontWeight: '600' as const },
  howItWorksSection: { marginBottom: 16 },
  howItWorksTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  howItWorksStep: { gap: 16 },
  stepNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFD700', alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { color: '#000000', fontSize: 13, fontWeight: '700' as const },
  stepContent: { flex: 1, gap: 4 },
  stepTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  stepDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  viewApplicationsButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  viewApplicationsText: { color: Colors.textSecondary, fontSize: 13 },
  applicationInfoCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  applicationInfoIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  applicationInfoContent: { flex: 1, gap: 4 },
  applicationInfoTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  applicationInfoText: { color: Colors.textSecondary, fontSize: 13 },
  applicationCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  applicationHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  applicationAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  applicationInfo: { flex: 1 },
  applicationNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  applicationName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  applicationStatusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  applicationStatusText: { color: Colors.textSecondary, fontSize: 13 },
  applicationMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  applicationHandle: { gap: 4 },
  applicationFollowers: { gap: 4 },
  applicationDetails: { gap: 4 },
  applicationDetailItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  applicationDetailLabel: { color: Colors.textSecondary, fontSize: 13 },
  applicationDetailValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  applicationActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  approveButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  approveButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  rejectButton: { backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  rejectButtonText: { color: Colors.error, fontWeight: '700' as const, fontSize: 15 },
  applicationModalActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  approveButtonLarge: { gap: 4 },
  approveButtonLargeText: { color: Colors.textSecondary, fontSize: 13 },
  rejectButtonLarge: { gap: 4 },
  rejectButtonLargeText: { color: Colors.textSecondary, fontSize: 13 }});
