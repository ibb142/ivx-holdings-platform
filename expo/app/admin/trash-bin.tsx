import React, { useState, useMemo, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  TextInput,
  Modal} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Trash2,
  ArchiveRestore,
  Shield,
  Search,
  MapPin,
  DollarSign,
  Clock,
  AlertTriangle,
  Inbox} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTrashDeals, restoreFromTrash, permanentlyDeleteJVDeal } from '@/lib/jv-storage';
import { formatCurrency } from '@/lib/formatters';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

interface TrashedDeal {
  id: string;
  title: string;
  projectName: string;
  type: string;
  status: string;
  totalInvestment: number;
  expectedROI: number;
  propertyAddress?: string;
  description?: string;
  trashedAt?: string;
  updatedAt?: string;
  createdAt?: string;
  photos?: string[];
}

export default function TrashBinScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TrashedDeal | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const trashQuery = useQuery<{ deals: TrashedDeal[]; total: number }>({
    queryKey: ['jv-trash-bin'],
    queryFn: async () => {
      console.log('[Trash Bin] Fetching trashed deals');
      const result = await fetchTrashDeals();
      console.log('[Trash Bin] Found', result.deals.length, 'trashed deals');
      return { deals: result.deals as TrashedDeal[], total: result.total };
    },
    staleTime: 1000 * 10});

  const restoreMutation = useMutation({
    mutationFn: async (input: { id: string }) => {
      console.log('[Trash Bin] Restoring deal:', input.id);
      const { data, error } = await restoreFromTrash(input.id, { adminOverride: true });
      if (error) throw error;
      return { success: true, ...data };
    },
    onSuccess: () => {
      console.log('[Trash Bin] Restore successful');
      invalidateAll();
      Alert.alert('Restored', 'Deal has been restored and is now active again.');
    },
    onError: (err: Error) => {
      console.error('[Trash Bin] Restore error:', err);
      Alert.alert('Error', 'Failed to restore deal: ' + err.message);
    }});

  const permanentDeleteMutation = useMutation({
    mutationFn: async (input: { id: string }) => {
      console.log('[Trash Bin] PERMANENT DELETE:', input.id);
      const { error } = await permanentlyDeleteJVDeal(input.id, { adminOverride: true });
      if (error) throw error;
      return { success: true };
    },
    onSuccess: () => {
      console.log('[Trash Bin] Permanently deleted');
      setDeleteConfirmVisible(false);
      setDeleteTarget(null);
      setDeleteConfirmText('');
      invalidateAll();
      Alert.alert('Permanently Deleted', 'Deal has been permanently removed. This cannot be undone.');
    },
    onError: (err: Error) => {
      console.error('[Trash Bin] Permanent delete error:', err);
      Alert.alert('Error', 'Failed to delete deal: ' + err.message);
    }});

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['jv-trash-bin'] });
    void queryClient.invalidateQueries({ queryKey: ['jvAgreements.list'] });
    void queryClient.invalidateQueries({ queryKey: ['jv-agreements'] });
    void queryClient.invalidateQueries({ queryKey: ['published-jv-deals'] });
    void queryClient.invalidateQueries({ queryKey: ['jv-deals'] });
  }, [queryClient]);

  const filteredDeals = useMemo(() => {
    const all = trashQuery.data?.deals ?? [];
    if (!searchQuery.trim()) return all;
    const q = searchQuery.toLowerCase();
    return all.filter(d =>
      (d.projectName || '').toLowerCase().includes(q) ||
      (d.title || '').toLowerCase().includes(q) ||
      (d.propertyAddress || '').toLowerCase().includes(q)
    );
  }, [trashQuery.data, searchQuery]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void trashQuery.refetch().finally(() => setRefreshing(false));
  }, [trashQuery]);

  const handleRestore = useCallback((deal: TrashedDeal) => {
    Alert.alert(
      'Restore Deal',
      `Restore "${deal.projectName || deal.title}" back to active deals?\n\nIt will appear in your JV deals list again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          onPress: () => restoreMutation.mutate({ id: deal.id })},
      ]
    );
  }, [restoreMutation]);

  const handlePermanentDelete = useCallback((deal: TrashedDeal) => {
    setDeleteTarget(deal);
    setDeleteConfirmText('');
    setDeleteConfirmVisible(true);
  }, []);

  const confirmPermanentDelete = useCallback(() => {
    if (!deleteTarget) return;
    const required = (deleteTarget.projectName || deleteTarget.title || '').trim().toUpperCase();
    if (deleteConfirmText.trim().toUpperCase() !== required) {
      Alert.alert('Confirmation Failed', `You must type "${deleteTarget.projectName || deleteTarget.title}" exactly to confirm.`);
      return;
    }
    permanentDeleteMutation.mutate({ id: deleteTarget.id });
  }, [deleteTarget, deleteConfirmText, permanentDeleteMutation]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Unknown';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="trash-bin-back">
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Trash2 size={18} color="#FF4D4D" />
            <Text style={styles.headerTitle}>Trash Bin</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerCount}>{filteredDeals.length}</Text>
          </View>
        </View>

        <View style={styles.warningBanner}>
          <AlertTriangle size={14} color="#FFB800" />
          <Text style={styles.warningText}>
            Deleted deals are stored here. Restore them or permanently delete with admin authorization.
          </Text>
        </View>

        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
        >
          <View style={styles.searchWrap}>
            <Search size={16} color={Colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search trashed deals..."
              placeholderTextColor={Colors.textTertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              testID="trash-search"
            />
          </View>

          {trashQuery.isLoading ? (
            <View style={styles.centerWrap}>
              <ShimmerIndicator size="large" color={Colors.primary} />
              <Text style={styles.centerText}>Loading trash...</Text>
            </View>
          ) : filteredDeals.length === 0 ? (
            <View style={styles.centerWrap}>
              <View style={styles.emptyIcon}>
                <Inbox size={48} color={Colors.textTertiary} />
              </View>
              <Text style={styles.emptyTitle}>Trash is Empty</Text>
              <Text style={styles.emptySubtitle}>
                {searchQuery ? 'No deals match your search' : 'No deleted deals. All your projects are safe.'}
              </Text>
            </View>
          ) : (
            filteredDeals.map(deal => (
              <View key={deal.id} style={styles.dealCard} testID={`trash-deal-${deal.id}`}>
                <View style={styles.dealHeader}>
                  <View style={styles.dealTitleWrap}>
                    <Text style={styles.dealProjectName} numberOfLines={1}>
                      {deal.projectName || deal.title}
                    </Text>
                    {deal.title !== deal.projectName && (
                      <Text style={styles.dealTitle} numberOfLines={1}>{deal.title}</Text>
                    )}
                  </View>
                  <View style={styles.trashedBadge}>
                    <Trash2 size={10} color="#FF4D4D" />
                    <Text style={styles.trashedBadgeText}>Trashed</Text>
                  </View>
                </View>

                {deal.propertyAddress ? (
                  <View style={styles.infoRow}>
                    <MapPin size={11} color={Colors.textTertiary} />
                    <Text style={styles.infoText} numberOfLines={1}>{deal.propertyAddress}</Text>
                  </View>
                ) : null}

                <View style={styles.metricsRow}>
                  {deal.totalInvestment > 0 && (
                    <View style={styles.metric}>
                      <DollarSign size={11} color={Colors.primary} />
                      <Text style={styles.metricValue}>{formatCurrency(deal.totalInvestment)}</Text>
                    </View>
                  )}
                  <View style={styles.metric}>
                    <Clock size={11} color={Colors.textTertiary} />
                    <Text style={styles.metricValue}>{formatDate(deal.trashedAt || deal.updatedAt)}</Text>
                  </View>
                </View>

                <View style={styles.dealActions}>
                  <TouchableOpacity
                    style={styles.restoreBtn}
                    onPress={() => handleRestore(deal)}
                    disabled={restoreMutation.isPending}
                    testID={`trash-restore-${deal.id}`}
                  >
                    <ArchiveRestore size={15} color="#00C48C" />
                    <Text style={styles.restoreBtnText}>Restore Deal</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.permDeleteBtn}
                    onPress={() => handlePermanentDelete(deal)}
                    testID={`trash-permdelete-${deal.id}`}
                  >
                    <Trash2 size={15} color="#FF4D4D" />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}

          <View style={{ height: 100 }} />
        </ScrollView>
      </SafeAreaView>

      <Modal visible={deleteConfirmVisible} animationType="fade" transparent>
        <View style={styles.deleteOverlay}>
          <View style={styles.deleteModal}>
            <View style={styles.deleteIconWrap}>
              <Shield size={32} color="#FF4D4D" />
            </View>
            <Text style={styles.deleteModalTitle}>Admin Authorization Required</Text>
            <Text style={styles.deleteModalSubtitle}>
              This will PERMANENTLY delete this deal. It cannot be recovered after this.
            </Text>
            <Text style={styles.deleteModalSubtitle}>
              Type the project name below to confirm:
            </Text>
            <Text style={styles.deleteModalDealName}>
              {deleteTarget?.projectName || deleteTarget?.title || ''}
            </Text>
            <TextInput
              style={styles.deleteConfirmInput}
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder={`Type "${deleteTarget?.projectName || deleteTarget?.title || ''}" to confirm`}
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="none"
              testID="trash-delete-confirm-input"
            />
            <View style={styles.deleteModalActions}>
              <TouchableOpacity
                style={styles.deleteModalCancel}
                onPress={() => {
                  setDeleteConfirmVisible(false);
                  setDeleteTarget(null);
                  setDeleteConfirmText('');
                }}
              >
                <Text style={styles.deleteModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.deleteModalConfirm,
                  deleteConfirmText.trim().toUpperCase() !== (deleteTarget?.projectName || deleteTarget?.title || '').trim().toUpperCase() && styles.deleteModalConfirmDisabled,
                ]}
                onPress={confirmPermanentDelete}
                disabled={permanentDeleteMutation.isPending || deleteConfirmText.trim().toUpperCase() !== (deleteTarget?.projectName || deleteTarget?.title || '').trim().toUpperCase()}
              >
                {permanentDeleteMutation.isPending ? (
                  <ShimmerIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.deleteModalConfirmText}>Delete Forever</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  safeArea: {
    flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  headerTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700' as const},
  headerRight: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FF4D4D15',
    alignItems: 'center',
    justifyContent: 'center'},
  headerCount: {
    color: '#FF4D4D',
    fontSize: 15,
    fontWeight: '800' as const},
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    backgroundColor: '#FFB80010',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFB80025'},
  warningText: {
    flex: 1,
    color: '#FFB800',
    fontSize: 12,
    fontWeight: '500' as const,
    lineHeight: 17},
  scrollView: {
    flex: 1},
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 14,
    paddingHorizontal: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    paddingVertical: 12},
  centerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12},
  centerText: {
    color: Colors.textSecondary,
    fontSize: 14},
  emptyIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8},
  emptyTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const},
  emptySubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 40},
  dealCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FF4D4D20',
    borderLeftWidth: 3,
    borderLeftColor: '#FF4D4D40'},
  dealHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8},
  dealTitleWrap: {
    flex: 1,
    marginRight: 8},
  dealProjectName: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const},
  dealTitle: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 2},
  trashedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: '#FF4D4D18'},
  trashedBadgeText: {
    color: '#FF4D4D',
    fontSize: 10,
    fontWeight: '700' as const},
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8},
  infoText: {
    color: Colors.textTertiary,
    fontSize: 11,
    flex: 1},
  metricsRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10,
    padding: 10},
  metric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4},
  metricValue: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '600' as const},
  dealActions: {
    flexDirection: 'row',
    gap: 8},
  restoreBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#00C48C15',
    borderWidth: 1,
    borderColor: '#00C48C30'},
  restoreBtnText: {
    color: '#00C48C',
    fontSize: 13,
    fontWeight: '700' as const},
  permDeleteBtn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#FF4D4D10',
    borderWidth: 1,
    borderColor: '#FF4D4D25'},
  deleteOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24},
  deleteModal: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#FF4D4D30'},
  deleteIconWrap: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FF4D4D15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16},
  deleteModalTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
    textAlign: 'center',
    marginBottom: 8},
  deleteModalSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 8},
  deleteModalDealName: {
    color: '#FF4D4D',
    fontSize: 16,
    fontWeight: '800' as const,
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: 0.5},
  deleteConfirmInput: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14,
    color: Colors.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#FF4D4D40',
    textAlign: 'center',
    marginBottom: 20},
  deleteModalActions: {
    flexDirection: 'row',
    gap: 12},
  deleteModalCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.backgroundSecondary,
    alignItems: 'center'},
  deleteModalCancelText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const},
  deleteModalConfirm: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#FF4D4D',
    alignItems: 'center'},
  deleteModalConfirmDisabled: {
    opacity: 0.4},
  deleteModalConfirmText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700' as const}});
