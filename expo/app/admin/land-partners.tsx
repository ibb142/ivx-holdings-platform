import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Alert,
  TextInput} from 'react-native';
import { Stack } from 'expo-router';
import {
  Handshake,
  Users,
  Clock,
  CheckCircle,
  ChevronRight,
  Search,
  X,
  MapPin,
  Phone,
  Mail,
  FileText,
  Building2,
  Briefcase,
  Play} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { landPartnerDeals, landPartnerStats } from '@/mocks/ipx-invest';
import { LandPartnerDeal, LandPartnerStatus } from '@/types';
import { formatCurrencyCompact } from '@/lib/formatters';

type FilterType = 'all' | 'active' | 'pending' | 'completed' | 'jv' | 'lp';

const STATUS_CONFIG: Record<LandPartnerStatus, { label: string; color: string; bgColor: string }> = {
  draft: { label: 'Draft', color: Colors.textSecondary, bgColor: Colors.surface },
  submitted: { label: 'Submitted', color: Colors.info, bgColor: Colors.info + '20' },
  valuation: { label: 'Valuation', color: Colors.warning, bgColor: Colors.warning + '20' },
  review: { label: 'In Review', color: Colors.primary, bgColor: Colors.primary + '20' },
  approved: { label: 'Approved', color: Colors.success, bgColor: Colors.success + '20' },
  active: { label: 'Active', color: Colors.success, bgColor: Colors.success + '20' },
  completed: { label: 'Completed', color: Colors.primary, bgColor: Colors.primary + '20' },
  rejected: { label: 'Rejected', color: Colors.error, bgColor: Colors.error + '20' }};

export default function LandPartnersScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDeal, setSelectedDeal] = useState<LandPartnerDeal | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1500);
  }, []);

  const formatCurrency = (value: number) => formatCurrencyCompact(value);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'});
  };

  const getFilteredDeals = () => {
    let filtered = [...landPartnerDeals];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (deal) =>
          deal.partnerName.toLowerCase().includes(query) ||
          deal.propertyAddress.toLowerCase().includes(query) ||
          deal.city.toLowerCase().includes(query)
      );
    }

    switch (activeFilter) {
      case 'active':
        return filtered.filter((d) => d.status === 'active');
      case 'pending':
        return filtered.filter((d) =>
          ['submitted', 'valuation', 'review', 'approved'].includes(d.status)
        );
      case 'completed':
        return filtered.filter((d) => d.status === 'completed');
      case 'jv':
        return filtered.filter((d) => d.partnerType === 'jv');
      case 'lp':
        return filtered.filter((d) => d.partnerType === 'lp');
      default:
        return filtered;
    }
  };

  const handleViewDeal = (deal: LandPartnerDeal) => {
    setSelectedDeal(deal);
    setShowDetailModal(true);
  };

  const handleStatusChange = (dealId: string, newStatus: LandPartnerStatus) => {
    Alert.alert(
      'Update Status',
      `Change deal status to "${STATUS_CONFIG[newStatus].label}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => {
            console.log(`Updating deal ${dealId} to status: ${newStatus}`);
            Alert.alert('Success', 'Deal status updated successfully');
            setShowDetailModal(false);
          }},
      ]
    );
  };

  const filteredDeals = getFilteredDeals();

  const renderStatCard = (
    title: string,
    value: string | number,
    icon: React.ReactNode,
    color: string
  ) => (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: color + '20' }]}>{icon}</View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{title}</Text>
    </View>
  );

  const renderDealCard = (deal: LandPartnerDeal) => {
    const statusConfig = STATUS_CONFIG[deal.status];
    const landValue = deal.appraisedValue || deal.estimatedValue;

    return (
      <TouchableOpacity
        key={deal.id}
        style={styles.dealCard}
        onPress={() => handleViewDeal(deal)}
        activeOpacity={0.8}
      >
        <View style={styles.dealHeader}>
          <View style={styles.dealPartnerInfo}>
            <View
              style={[
                styles.partnerTypeIcon,
                { backgroundColor: deal.partnerType === 'jv' ? Colors.primary + '20' : Colors.info + '20' },
              ]}
            >
              {deal.partnerType === 'jv' ? (
                <Handshake size={18} color={Colors.primary} />
              ) : (
                <Briefcase size={18} color={Colors.info} />
              )}
            </View>
            <View style={styles.partnerDetails}>
              <Text style={styles.partnerName}>{deal.partnerName}</Text>
              <Text style={styles.partnerType}>
                {deal.partnerType === 'jv' ? 'Joint Venture' : 'Limited Partner'}
              </Text>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.bgColor }]}>
            <Text style={[styles.statusText, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>
        </View>

        <View style={styles.dealProperty}>
          <MapPin size={14} color={Colors.textSecondary} />
          <Text style={styles.propertyAddress} numberOfLines={1}>
            {deal.propertyAddress}, {deal.city}, {deal.state}
          </Text>
        </View>

        <View style={styles.dealMetrics}>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Land Value</Text>
            <Text style={styles.metricValue}>{formatCurrency(landValue)}</Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Cash (60%)</Text>
            <Text style={[styles.metricValue, { color: Colors.success }]}>
              {formatCurrency(deal.cashPaymentAmount)}
            </Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Collateral</Text>
            <Text style={styles.metricValue}>{formatCurrency(deal.collateralAmount)}</Text>
          </View>
        </View>

        <View style={styles.dealFooter}>
          <Text style={styles.dealDate}>Submitted: {formatDate(deal.submittedAt)}</Text>
          <ChevronRight size={18} color={Colors.textTertiary} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Land Partners',
          headerShown: true,
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text}}
      />

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        <View style={styles.statsGrid}>
          {renderStatCard(
            'Total Deals',
            landPartnerStats.totalDeals,
            <Handshake size={18} color={Colors.primary} />,
            Colors.primary
          )}
          {renderStatCard(
            'Active',
            landPartnerStats.activeDeals,
            <Play size={18} color={Colors.success} />,
            Colors.success
          )}
          {renderStatCard(
            'Pending',
            landPartnerStats.pendingDeals,
            <Clock size={18} color={Colors.warning} />,
            Colors.warning
          )}
          {renderStatCard(
            'Completed',
            landPartnerStats.completedDeals,
            <CheckCircle size={18} color={Colors.info} />,
            Colors.info
          )}
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Portfolio Summary</Text>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total Land Value</Text>
              <Text style={styles.summaryValue}>{formatCurrency(landPartnerStats.totalLandValue)}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Cash Paid Out</Text>
              <Text style={[styles.summaryValue, { color: Colors.success }]}>
                {formatCurrency(landPartnerStats.totalCashPaid)}
              </Text>
            </View>
          </View>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total Collateral</Text>
              <Text style={styles.summaryValue}>{formatCurrency(landPartnerStats.totalCollateral)}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>JV / LP Split</Text>
              <Text style={styles.summaryValue}>
                {landPartnerStats.jvDeals} / {landPartnerStats.lpDeals}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.searchSection}>
          <View style={styles.searchBar}>
            <Search size={18} color={Colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search partners or properties..."
              placeholderTextColor={Colors.textTertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterContainer}
        >
          {(['all', 'active', 'pending', 'completed', 'jv', 'lp'] as FilterType[]).map((filter) => (
            <TouchableOpacity
              key={filter}
              style={[styles.filterChip, activeFilter === filter && styles.filterChipActive]}
              onPress={() => setActiveFilter(filter)}
            >
              <Text
                style={[styles.filterChipText, activeFilter === filter && styles.filterChipTextActive]}
              >
                {filter === 'jv' ? 'JV Only' : filter === 'lp' ? 'LP Only' : filter.charAt(0).toUpperCase() + filter.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.dealsSection}>
          <Text style={styles.sectionTitle}>
            {filteredDeals.length} Deal{filteredDeals.length !== 1 ? 's' : ''}
          </Text>
          {filteredDeals.map(renderDealCard)}
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>

      <Modal
        visible={showDetailModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDetailModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Deal Details</Text>
              <TouchableOpacity onPress={() => setShowDetailModal(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {selectedDeal && (
              <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>Partner Information</Text>
                  <View style={styles.detailRow}>
                    <Users size={16} color={Colors.textSecondary} />
                    <Text style={styles.detailLabel}>Name:</Text>
                    <Text style={styles.detailValue}>{selectedDeal.partnerName}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Mail size={16} color={Colors.textSecondary} />
                    <Text style={styles.detailLabel}>Email:</Text>
                    <Text style={styles.detailValue}>{selectedDeal.partnerEmail}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Phone size={16} color={Colors.textSecondary} />
                    <Text style={styles.detailLabel}>Phone:</Text>
                    <Text style={styles.detailValue}>{selectedDeal.partnerPhone}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Handshake size={16} color={Colors.textSecondary} />
                    <Text style={styles.detailLabel}>Type:</Text>
                    <Text style={styles.detailValue}>
                      {selectedDeal.partnerType === 'jv' ? 'Joint Venture' : 'Limited Partner'}
                    </Text>
                  </View>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>Property Details</Text>
                  <View style={styles.detailRow}>
                    <MapPin size={16} color={Colors.textSecondary} />
                    <Text style={styles.detailLabel}>Address:</Text>
                    <Text style={styles.detailValue} numberOfLines={2}>
                      {selectedDeal.propertyAddress}, {selectedDeal.city}, {selectedDeal.state} {selectedDeal.zipCode}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Building2 size={16} color={Colors.textSecondary} />
                    <Text style={styles.detailLabel}>Lot Size:</Text>
                    <Text style={styles.detailValue}>
                      {new Intl.NumberFormat('en-US').format(selectedDeal.lotSize)} {selectedDeal.lotSizeUnit === 'sqft' ? 'sq ft' : 'acres'}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <FileText size={16} color={Colors.textSecondary} />
                    <Text style={styles.detailLabel}>Zoning:</Text>
                    <Text style={styles.detailValue}>{selectedDeal.zoning || 'N/A'}</Text>
                  </View>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>Deal Economics</Text>
                  <View style={styles.economicsGrid}>
                    <View style={styles.economicsItem}>
                      <Text style={styles.economicsLabel}>Estimated Value</Text>
                      <Text style={styles.economicsValue}>
                        {formatCurrency(selectedDeal.estimatedValue)}
                      </Text>
                    </View>
                    <View style={styles.economicsItem}>
                      <Text style={styles.economicsLabel}>Appraised Value</Text>
                      <Text style={styles.economicsValue}>
                        {selectedDeal.appraisedValue ? formatCurrency(selectedDeal.appraisedValue) : 'Pending'}
                      </Text>
                    </View>
                    <View style={styles.economicsItem}>
                      <Text style={styles.economicsLabel}>Cash Payment (60%)</Text>
                      <Text style={[styles.economicsValue, { color: Colors.success }]}>
                        {formatCurrency(selectedDeal.cashPaymentAmount)}
                      </Text>
                    </View>
                    <View style={styles.economicsItem}>
                      <Text style={styles.economicsLabel}>Collateral (40%)</Text>
                      <Text style={styles.economicsValue}>
                        {formatCurrency(selectedDeal.collateralAmount)}
                      </Text>
                    </View>
                    <View style={styles.economicsItem}>
                      <Text style={styles.economicsLabel}>Partner Profit Share</Text>
                      <Text style={styles.economicsValue}>{selectedDeal.partnerProfitShare}%</Text>
                    </View>
                    <View style={styles.economicsItem}>
                      <Text style={styles.economicsLabel}>Term</Text>
                      <Text style={styles.economicsValue}>{selectedDeal.termMonths} months</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>Status Timeline</Text>
                  <View style={styles.timeline}>
                    <View style={styles.timelineItem}>
                      <CheckCircle size={16} color={Colors.success} />
                      <Text style={styles.timelineText}>Submitted: {formatDate(selectedDeal.submittedAt)}</Text>
                    </View>
                    {selectedDeal.valuationCompletedAt && (
                      <View style={styles.timelineItem}>
                        <CheckCircle size={16} color={Colors.success} />
                        <Text style={styles.timelineText}>
                          Valuation: {formatDate(selectedDeal.valuationCompletedAt)}
                        </Text>
                      </View>
                    )}
                    {selectedDeal.approvedAt && (
                      <View style={styles.timelineItem}>
                        <CheckCircle size={16} color={Colors.success} />
                        <Text style={styles.timelineText}>Approved: {formatDate(selectedDeal.approvedAt)}</Text>
                      </View>
                    )}
                    {selectedDeal.activatedAt && (
                      <View style={styles.timelineItem}>
                        <CheckCircle size={16} color={Colors.success} />
                        <Text style={styles.timelineText}>Activated: {formatDate(selectedDeal.activatedAt)}</Text>
                      </View>
                    )}
                    {selectedDeal.completedAt && (
                      <View style={styles.timelineItem}>
                        <CheckCircle size={16} color={Colors.primary} />
                        <Text style={styles.timelineText}>Completed: {formatDate(selectedDeal.completedAt)}</Text>
                      </View>
                    )}
                    {selectedDeal.expiresAt && (
                      <View style={styles.timelineItem}>
                        <Clock size={16} color={Colors.warning} />
                        <Text style={styles.timelineText}>Expires: {formatDate(selectedDeal.expiresAt)}</Text>
                      </View>
                    )}
                  </View>
                </View>

                {selectedDeal.status !== 'completed' && selectedDeal.status !== 'rejected' && (
                  <View style={styles.actionSection}>
                    <Text style={styles.detailSectionTitle}>Actions</Text>
                    <View style={styles.actionButtons}>
                      {selectedDeal.status === 'submitted' && (
                        <TouchableOpacity
                          style={[styles.actionButton, { backgroundColor: Colors.warning }]}
                          onPress={() => handleStatusChange(selectedDeal.id, 'valuation')}
                        >
                          <Text style={styles.actionButtonText}>Start Valuation</Text>
                        </TouchableOpacity>
                      )}
                      {selectedDeal.status === 'valuation' && (
                        <TouchableOpacity
                          style={[styles.actionButton, { backgroundColor: Colors.primary }]}
                          onPress={() => handleStatusChange(selectedDeal.id, 'review')}
                        >
                          <Text style={styles.actionButtonText}>Move to Review</Text>
                        </TouchableOpacity>
                      )}
                      {selectedDeal.status === 'review' && (
                        <>
                          <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: Colors.success }]}
                            onPress={() => handleStatusChange(selectedDeal.id, 'approved')}
                          >
                            <Text style={styles.actionButtonText}>Approve</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: Colors.error }]}
                            onPress={() => handleStatusChange(selectedDeal.id, 'rejected')}
                          >
                            <Text style={styles.actionButtonText}>Reject</Text>
                          </TouchableOpacity>
                        </>
                      )}
                      {selectedDeal.status === 'approved' && (
                        <TouchableOpacity
                          style={[styles.actionButton, { backgroundColor: Colors.success }]}
                          onPress={() => handleStatusChange(selectedDeal.id, 'active')}
                        >
                          <Text style={styles.actionButtonText}>Activate Deal</Text>
                        </TouchableOpacity>
                      )}
                      {selectedDeal.status === 'active' && (
                        <TouchableOpacity
                          style={[styles.actionButton, { backgroundColor: Colors.primary }]}
                          onPress={() => handleStatusChange(selectedDeal.id, 'completed')}
                        >
                          <Text style={styles.actionButtonText}>Mark Completed</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                )}
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
  scrollView: { flex: 1, backgroundColor: Colors.background },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  summaryCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  summaryTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  summaryLabel: { color: Colors.textSecondary, fontSize: 13 },
  summaryValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  searchSection: { marginBottom: 16 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  searchInput: { flex: 1, color: Colors.text, fontSize: 15, paddingVertical: 12 },
  filterScroll: { marginBottom: 12 },
  filterContainer: { marginBottom: 12 },
  filterChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: Colors.surfaceBorder },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
  filterChipTextActive: { color: Colors.black },
  dealsSection: { marginBottom: 16 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  dealCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  dealHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  dealPartnerInfo: { flex: 1 },
  partnerTypeIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  partnerDetails: { flex: 1 },
  partnerName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  partnerType: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { color: Colors.textSecondary, fontSize: 13 },
  dealProperty: { gap: 2, marginTop: 8 },
  propertyAddress: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dealMetrics: { flexDirection: 'row', gap: 8, marginTop: 10 },
  metricItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  metricLabel: { color: Colors.textSecondary, fontSize: 13 },
  metricValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  metricDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder },
  dealFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  dealDate: { color: Colors.textTertiary, fontSize: 12 },
  bottomPadding: { height: 120 },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  modalBody: { gap: 12 },
  detailSection: { marginBottom: 16 },
  detailSectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailLabel: { color: Colors.textSecondary, fontSize: 13 },
  detailValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  economicsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  economicsItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  economicsLabel: { color: Colors.textSecondary, fontSize: 13 },
  economicsValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  timeline: { gap: 8 },
  timelineItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timelineText: { color: Colors.textSecondary, fontSize: 13 },
  actionSection: { marginBottom: 16 },
  actionButtons: { gap: 10 },
  actionButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  actionButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 }});
