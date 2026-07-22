import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  RefreshControl,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useScreenFocusState } from '@/hooks/useScreenFocusState';
import {
  ArrowLeft,
  Plus,
  Edit3,
  Trash2,
  Eye,
  EyeOff,
  X,
  Check,
  MapPin,
  DollarSign,
  TrendingUp,
  Users,
  Search,
  Globe,
  FileText,
  Shield,
  ArchiveRestore,
  Archive,
  ImagePlus,
  Camera,
  AlertTriangle,
  Upload,
  Image as ImageIcon,
  ChevronUp,
  ChevronDown,
  GripVertical,
  ArrowUpToLine,
  ArrowDownToLine,
} from 'lucide-react-native';
import { Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Colors from '@/constants/colors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJVDeals, fetchJVDealsPaginated, updateJVDeal, archiveJVDeal, restoreJVDeal, permanentlyDeleteJVDeal, recoverPhotosForDeal, adminRestorePhotos, resetSupabaseCheck, updateDealDisplayOrders } from '@/lib/jv-storage';
import { uploadDealPhotosParallel } from '@/lib/photo-upload';
import { fetchPhotosFromStorageBucket } from '@/constants/deal-photos';
import { prefetchImages } from '@/components/CachedImage';
import { invalidateAllJVQueries, useJVRealtime } from '@/lib/jv-realtime';
import { useProgressiveList } from '@/lib/use-progressive-list';
import { EmptyState, ErrorState, ListFooter } from '@/components/ProgressiveStates';
import { fetchDealsPage, invalidateDealsCache } from '@/lib/canonical-query';
import { useDealsRealtime } from '@/lib/canonical-realtime';
import { formatCurrency, formatCurrencySafe, parseAmountInput, formatAmountInput } from '@/lib/formatters';
import { buildOwnershipSnapshot } from '@/lib/ownership-math';
import { extractExplicitDealSalePrice } from '@/lib/parse-deal';
import { syncToLandingPage } from '@/lib/landing-sync';
import { triggerAutoDeploy } from '@/lib/auto-deploy';

type JVDealType = 'equity_split' | 'profit_sharing' | 'hybrid' | 'development' | 'new_construction' | 'existing_complete' | 'rehab_construction';

const ADMIN_JV_DEALS_REFRESH_MS = 120_000;

interface JVPartner {
  id: string;
  name: string;
  role: string;
  contribution: number;
  equityShare: number;
  location: string;
  verified: boolean;
}

interface JVDeal {
  id: string;
  title: string;
  projectName: string;
  type: JVDealType;
  status: string;
  published: boolean;
  publishedAt?: string | null;
  totalInvestment: number;
  propertyValue: number;
  currency: string;
  expectedROI: number;
  propertyAddress?: string;
  description: string;
  partners: JVPartner[];
  profitSplit: Array<{ partnerId: string; percentage: number }>;
  startDate: string;
  endDate: string;
  distributionFrequency: string;
  exitStrategy: string;
  governingLaw: string;
  disputeResolution: string;
  confidentialityPeriod: number;
  nonCompetePeriod: number;
  managementFee: number;
  performanceFee: number;
  minimumHoldPeriod: number;
  photos?: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

interface JVQueryData {
  deals: JVDeal[];
}

interface EditFormState {
  title: string;
  projectName: string;
  type: JVDealType;
  totalInvestment: string;
  propertyValue: string;
  expectedROI: string;
  propertyAddress: string;
  description: string;
  distributionFrequency: string;
  exitStrategy: string;
  governingLaw: string;
  managementFee: string;
  performanceFee: string;
  minimumHoldPeriod: string;
  llcName: string;
  builderName: string;
  minInvestment: string;
  salePrice: string;
  fractionalSharePrice: string;
  timelineMin: string;
  timelineMax: string;
  titleVerified: boolean;
  insuranceCoverage: boolean;
  escrowProtected: boolean;
  permitApproved: boolean;
  yearEstablished: string;
  completedProjects: string;
  startDate: string;
  endDate: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: '#9A9A9A', bg: '#9A9A9A18' },
  pending_review: { label: 'Pending', color: '#FFB800', bg: '#FFB80018' },
  active: { label: 'Active', color: '#00C48C', bg: '#00C48C18' },
  completed: { label: 'Completed', color: '#4A90D9', bg: '#4A90D918' },
  expired: { label: 'Expired', color: '#FF4D4D', bg: '#FF4D4D18' },
  archived: { label: 'Archived', color: '#A855F7', bg: '#A855F718' },
};

const TYPE_LABELS: Record<string, string> = {
  equity_split: 'Equity Split',
  profit_sharing: 'Profit Sharing',
  hybrid: 'Hybrid',
  development: 'Development',
  new_construction: 'New Construction',
  existing_complete: 'Existing (Investor Ready)',
  rehab_construction: 'Rehab Construction',
};

const FILTER_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'published', label: 'Published' },
  { id: 'unpublished', label: 'Unpublished' },
  { id: 'active', label: 'Active' },
  { id: 'draft', label: 'Draft' },
  { id: 'archived', label: 'Archived' },
] as const;

const DEAL_TYPES: JVDealType[] = ['equity_split', 'profit_sharing', 'hybrid', 'development', 'new_construction', 'existing_complete', 'rehab_construction'];

function normalizeDate(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return trimmed;
}

function toPositiveNumberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

const DEFAULT_EDIT_FORM: EditFormState = {
  title: '',
  projectName: '',
  type: 'equity_split',
  totalInvestment: '',
  propertyValue: '',
  expectedROI: '',
  propertyAddress: '',
  description: '',
  distributionFrequency: 'quarterly',
  exitStrategy: 'Sale of Property',
  governingLaw: 'State of New York, USA',
  managementFee: '',
  performanceFee: '',
  minimumHoldPeriod: '',
  llcName: '',
  builderName: '',
  minInvestment: '50',
  salePrice: '',
  fractionalSharePrice: '50',
  timelineMin: '',
  timelineMax: '',
  titleVerified: true,
  insuranceCoverage: true,
  escrowProtected: true,
  permitApproved: true,
  yearEstablished: '',
  completedProjects: '',
  startDate: '',
  endDate: '',
};

export default function AdminJVDealsScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editModalVisible, setEditModalVisible] = useState<boolean>(false);
  const [selectedDeal, setSelectedDeal] = useState<JVDeal | null>(null);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState<boolean>(false);
  const [deleteTarget, setDeleteTarget] = useState<JVDeal | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState<string>('');
  const [photoRestoreTarget, setPhotoRestoreTarget] = useState<JVDeal | null>(null);
  const [photoRestoreModalVisible, setPhotoRestoreModalVisible] = useState<boolean>(false);
  const [photoUrls, setPhotoUrls] = useState<string>('');
  const [editPhotos, setEditPhotos] = useState<string[]>([]);
  const [isUploadingPhotos, setIsUploadingPhotos] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [photoUploadStates, setPhotoUploadStates] = useState<Record<string, 'pending' | 'uploading' | 'done' | 'failed'>>({});
  const [pendingLocalPhotos, setPendingLocalPhotos] = useState<Array<{ id: string; uri: string }>>([]);
  const uploadProgressAnim = useRef(new Animated.Value(0)).current;
  const [editForm, setEditForm] = useState<EditFormState>(DEFAULT_EDIT_FORM);
  const [reorderMode, setReorderMode] = useState<boolean>(false);
  const [reorderDirty, setReorderDirty] = useState<boolean>(false);
  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const [positionInputDealId, setPositionInputDealId] = useState<string | null>(null);
  const [positionInputValue, setPositionInputValue] = useState<string>('');
  const [isTimelineAutosaving, setIsTimelineAutosaving] = useState<boolean>(false);

  const queryClient = useQueryClient();
  const isScreenFocused = useScreenFocusState(true);

  useJVRealtime('admin-jv-deals', true);
  useDealsRealtime(null);

  const jvList = useProgressiveList<JVDeal>({
    queryKey: ['jvAgreements.list'],
    pageSize: 10,
    staleTime: 60_000,
    fetchPage: async (page: number, pageSize: number) => {
      console.log('[Admin JV] Fetching JV deals page', page, 'size', pageSize);
      const result = await fetchDealsPage(page, pageSize);
      const deals = (result.items ?? []) as unknown as JVDeal[];

      // Enrich photos for deals with <=1 photo (non-blocking, best-effort)
      const enrichPromises = deals.map(async (deal) => {
        const photoCount = Array.isArray(deal.photos) ? deal.photos.length : 0;
        if (photoCount <= 1 && deal.id) {
          try {
            const storagePhotos = await fetchPhotosFromStorageBucket(deal.id);
            if (storagePhotos.length > photoCount) {
              deal.photos = storagePhotos;
            }
          } catch {}
        }
        return deal;
      });
      await Promise.all(enrichPromises);

      const allPhotos = deals.flatMap(d => Array.isArray(d.photos) ? d.photos.slice(0, 3) : []);
      if (allPhotos.length > 0) {
        prefetchImages(allPhotos);
      }

      return { items: deals, hasMore: result.hasMore };
      // Note: canonical-query handles dedup, retry, and SWR cache internally
    },
  });

  // Legacy query kept for stats — fetches total count without loading all deals
  const statsQuery = useQuery<{ total: number; published: number; active: number; totalInvestment: number }>({
    queryKey: ['jvAgreements.stats'],
    queryFn: async () => {
      const result = await fetchJVDeals({ limit: 100 });
      const all = (result.deals ?? []) as JVDeal[];
      return {
        total: all.length,
        published: all.filter(d => d.published).length,
        active: all.filter(d => d.status === 'active').length,
        totalInvestment: all.reduce((sum, d) => sum + (d.totalInvestment || 0), 0),
      };
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const publishMutation = useMutation({
    mutationFn: async (input: { id: string }) => {
      console.log('[JV-Storage] Publishing JV deal:', input.id);
      const { data, error } = await updateJVDeal(input.id, { published: true, status: 'active', publishedAt: new Date().toISOString() }, { adminOverride: true });
      if (error) throw error;
      return { success: true, ...data };
    },
    onSuccess: () => {
      console.log('[Admin JV] Published successfully — resetting cache + triggering auto-deploy');
      resetSupabaseCheck();
      invalidateAllJVQueries(queryClient);
      void queryClient.refetchQueries({ queryKey: ['published-jv-deals'] });
      triggerAutoDeploy('deal_publish', true).then(result => {
        if (result) {
          console.log('[Admin JV] Auto-deploy after publish:', result.status, 'deals:', result.syncedDeals);
        } else {
          syncToLandingPage().then(r => {
            console.log('[Admin JV] Landing sync after publish (auto-deploy off):', r.success);
          }).catch(err => {
            console.log('[Admin JV] Landing sync after publish failed:', err);
          });
        }
      }).catch(err => {
        console.log('[Admin JV] Auto-deploy after publish failed:', err);
      });
      Alert.alert('Success', 'Deal published and now visible to investors.');
    },
    onError: (err: Error) => {
      console.error('[Admin JV] Publish error:', err);
      Alert.alert('Error', 'Failed to publish deal: ' + err.message);
    },
  });

  const unpublishMutation = useMutation({
    mutationFn: async (input: { id: string }) => {
      console.log('[JV-Storage] Unpublishing JV deal:', input.id);
      const { data, error } = await updateJVDeal(input.id, { published: false, publishedAt: null }, { adminOverride: true });
      if (error) throw error;
      return { success: true, ...data };
    },
    onSuccess: () => {
      console.log('[Admin JV] Unpublished successfully — resetting cache + triggering auto-deploy');
      resetSupabaseCheck();
      invalidateAllJVQueries(queryClient);
      void queryClient.refetchQueries({ queryKey: ['published-jv-deals'] });
      triggerAutoDeploy('deal_unpublish', true).then(result => {
        if (result) {
          console.log('[Admin JV] Auto-deploy after unpublish:', result.status, 'deals:', result.syncedDeals);
        } else {
          syncToLandingPage().then(r => {
            console.log('[Admin JV] Landing sync after unpublish (auto-deploy off):', r.success);
          }).catch(err => {
            console.log('[Admin JV] Landing sync after unpublish failed:', err);
          });
        }
      }).catch(err => {
        console.log('[Admin JV] Auto-deploy after unpublish failed:', err);
      });
      Alert.alert('Success', 'Deal unpublished.');
    },
    onError: (err: Error) => {
      console.error('[Admin JV] Unpublish error:', err);
      Alert.alert('Error', 'Failed to unpublish deal: ' + err.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (input: { id: string; data: Record<string, unknown> }) => {
      const { __autoSync, ...safeData } = input.data;
      console.log('[Admin JV] Saving deal update:', input.id, '| fields:', Object.keys(safeData).join(','), '| autoSync:', __autoSync === true);
      const { data, error } = await updateJVDeal(input.id, safeData, { adminOverride: true });
      if (error) {
        console.error('[Admin JV] updateJVDeal returned error:', error.message);
        throw error;
      }
      console.log('[Admin JV] updateJVDeal returned success — data id:', data?.id);
      return { success: true, ...data };
    },
    onSuccess: (_result, variables) => {
      const isAutoSync = variables.data.__autoSync === true;
      console.log('[Admin JV] Update saved successfully for deal:', variables.id, '— resetting cache + triggering landing sync | autoSync:', isAutoSync);
      resetSupabaseCheck();
      invalidateAllJVQueries(queryClient);
      void queryClient.refetchQueries({ queryKey: ['published-jv-deals'] });
      void queryClient.refetchQueries({ queryKey: ['jvAgreements.list'] });
      if (isAutoSync) {
        setIsTimelineAutosaving(false);
      } else {
        setEditModalVisible(false);
        setSelectedDeal(null);
      }
      triggerAutoDeploy('content_change', true).then(result => {
        if (result) {
          console.log('[Admin JV] Auto-deploy after update:', result.status, 'deals:', result.syncedDeals, 'files:', result.filesUploaded.length);
          return;
        }
        syncToLandingPage().then(syncResult => {
          console.log('[Admin JV] Landing sync after update (fallback):', syncResult.success, 'synced:', syncResult.syncedDeals);
        }).catch(err => {
          console.log('[Admin JV] Landing sync after update fallback failed (non-critical):', err);
        });
      }).catch(err => {
        console.log('[Admin JV] Auto-deploy after update failed:', err);
        syncToLandingPage().then(syncResult => {
          console.log('[Admin JV] Landing sync after update fallback:', syncResult.success, 'synced:', syncResult.syncedDeals);
        }).catch(syncErr => {
          console.log('[Admin JV] Landing sync after update fallback failed (non-critical):', syncErr);
        });
      });
    },
    onError: (err: Error) => {
      console.error('[Admin JV] Update FAILED:', err.message);
      setIsTimelineAutosaving(false);
      const isAuthError = err.message.toLowerCase().includes('admin') || err.message.toLowerCase().includes('role');
      if (isAuthError) {
        Alert.alert('Access Denied', 'Only admin users can edit deals. Your current role does not have permission.');
      } else {
        Alert.alert('Save Failed', 'Failed to save deal changes: ' + err.message + '\n\nPlease try again.');
      }
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (input: { id: string }) => {
      console.log('[Admin JV] Archiving deal:', input.id);
      const { data, error } = await archiveJVDeal(input.id, { adminOverride: true });
      if (error) throw error;
      return { success: true, ...data };
    },
    onSuccess: () => {
      console.log('[Admin JV] Archived successfully — triggering landing sync');
      resetSupabaseCheck();
      invalidateAllJVQueries(queryClient);
      syncToLandingPage().then(result => {
        console.log('[Admin JV] Landing sync after archive:', result.success, 'synced:', result.syncedDeals);
      }).catch(() => {});
      Alert.alert('Archived', 'Deal has been archived. You can restore it anytime.');
    },
    onError: (err: Error) => {
      console.error('[Admin JV] Archive error:', err);
      Alert.alert('Error', 'Failed to archive deal: ' + err.message);
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (input: { id: string }) => {
      console.log('[Admin JV] Restoring deal:', input.id);
      const { data, error } = await restoreJVDeal(input.id, { adminOverride: true });
      if (error) throw error;
      return { success: true, ...data };
    },
    onSuccess: () => {
      console.log('[Admin JV] Restored successfully — triggering landing sync');
      resetSupabaseCheck();
      invalidateAllJVQueries(queryClient);
      syncToLandingPage().then(result => {
        console.log('[Admin JV] Landing sync after restore:', result.success, 'synced:', result.syncedDeals);
      }).catch(() => {});
      Alert.alert('Restored', 'Deal has been restored and is now active.');
    },
    onError: (err: Error) => {
      console.error('[Admin JV] Restore error:', err);
      Alert.alert('Error', 'Failed to restore deal: ' + err.message);
    },
  });

  const photoRecoverMutation = useMutation({
    mutationFn: async (input: { id: string }) => {
      console.log('[Admin JV] Attempting photo recovery for:', input.id);
      return await recoverPhotosForDeal(input.id);
    },
    onSuccess: (result) => {
      if (result.recovered) {
        Alert.alert('Photos Recovered', `Found and restored ${result.photoCount} photo(s) from ${result.source}.`);
        invalidateAllJVQueries(queryClient);
      } else {
        Alert.alert('No Photos Found', 'No backup photos were found. You can manually add photo URLs using the "Add Photos" option.');
      }
    },
    onError: (err: Error) => {
      Alert.alert('Error', 'Photo recovery failed: ' + err.message);
    },
  });

  const photoRestoreMutation = useMutation({
    mutationFn: async (input: { id: string; photos: string[] }) => {
      console.log('[Admin JV] Manual photo restore for:', input.id, 'photos:', input.photos.length);
      return await adminRestorePhotos(input.id, input.photos);
    },
    onSuccess: (result) => {
      if (result.success) {
        Alert.alert('Photos Restored', 'Photos have been successfully added to the deal.');
        setPhotoRestoreModalVisible(false);
        setPhotoRestoreTarget(null);
        setPhotoUrls('');
        invalidateAllJVQueries(queryClient);
      } else {
        Alert.alert('Error', result.error || 'Failed to restore photos.');
      }
    },
    onError: (err: Error) => {
      Alert.alert('Error', 'Photo restore failed: ' + err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (input: { id: string }) => {
      console.log('[Admin JV] PERMANENT DELETE deal:', input.id);
      const { error } = await permanentlyDeleteJVDeal(input.id, { adminOverride: true });
      if (error) throw error;
      return { success: true };
    },
    onSuccess: async () => {
      console.log('[Admin JV] Permanently deleted — forcing full cache reset + refetch');
      setDeleteConfirmVisible(false);
      setDeleteTarget(null);
      setDeleteConfirmText('');
      resetSupabaseCheck();
      await queryClient.resetQueries({ queryKey: ['jvAgreements.list'] });
      invalidateAllJVQueries(queryClient);
      Alert.alert('Permanently Deleted', 'Deal has been permanently removed. This cannot be undone.');
    },
    onError: (err: Error) => {
      console.error('[Admin JV] Delete error:', err);
      setDeleteConfirmVisible(false);
      setDeleteTarget(null);
      setDeleteConfirmText('');
      Alert.alert('Delete Failed', err.message);
    },
  });

  const deals = useMemo((): JVDeal[] => {
    const raw: JVDeal[] = jvList.data ?? [];
    let filtered = raw;
    if (filterStatus !== 'all') {
      if (filterStatus === 'published') {
        filtered = filtered.filter(d => d.published);
      } else if (filterStatus === 'unpublished') {
        filtered = filtered.filter(d => !d.published);
      } else {
        filtered = filtered.filter(d => d.status === filterStatus);
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(d =>
        d.title.toLowerCase().includes(q) ||
        d.projectName.toLowerCase().includes(q) ||
        (d.propertyAddress || '').toLowerCase().includes(q)
      );
    }
    if (reorderMode && localOrder.length > 0) {
      const orderMap = new Map(localOrder.map((id, idx) => [id, idx]));
      filtered = [...filtered].sort((a, b) => {
        const posA = orderMap.get(a.id) ?? 999;
        const posB = orderMap.get(b.id) ?? 999;
        return posA - posB;
      });
    }
    return filtered;
  }, [jvList.data, filterStatus, searchQuery, reorderMode, localOrder]);

  const stats = useMemo(() => {
    const stats = statsQuery.data;
    if (stats) return stats;
    const all: JVDeal[] = jvList.data ?? [];
    return {
      total: all.length,
      published: all.filter(d => d.published).length,
      active: all.filter(d => d.status === 'active').length,
      totalInvestment: all.reduce((sum, d) => sum + (d.totalInvestment || 0), 0),
    };
  }, [statsQuery.data, jvList.data]);

  const reorderMutation = useMutation({
    mutationFn: async (orders: Array<{ id: string; displayOrder: number }>) => {
      console.log('[Admin JV] Saving display order for', orders.length, 'deals');
      const result = await updateDealDisplayOrders(orders);
      if (!result.success) throw new Error(result.error || 'Failed to update order');
      return result;
    },
    onSuccess: () => {
      console.log('[Admin JV] Display order saved successfully — triggering full landing sync + deploy');
      setReorderDirty(false);
      setReorderMode(false);
      setLocalOrder([]);
      resetSupabaseCheck();
      invalidateAllJVQueries(queryClient);
      void queryClient.refetchQueries({ queryKey: ['published-jv-deals'] });
      syncToLandingPage().then(result => {
        console.log('[Admin JV] Landing sync after reorder:', result.success, 'synced:', result.syncedDeals);
      }).catch(err => {
        console.log('[Admin JV] Landing sync after reorder failed:', err);
      });
      Alert.alert('Order Saved', 'Deal display order updated. Changes are now live on landing.');
    },
    onError: (err: Error) => {
      console.error('[Admin JV] Reorder error:', err);
      Alert.alert('Error', 'Failed to save order: ' + err.message);
    },
  });

  const isAnyMutating = publishMutation.isPending || unpublishMutation.isPending || archiveMutation.isPending || restoreMutation.isPending || reorderMutation.isPending;

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.resolve(jvList.refresh()).finally(() => setRefreshing(false));
  }, [jvList]);

  const openEditModal = useCallback((deal: JVDeal) => {
    setSelectedDeal(deal);
    setEditPhotos(Array.isArray(deal.photos) ? [...deal.photos] : []);
    const dealAny = deal as unknown as Record<string, unknown>;
    const rawTrust = dealAny.trustInfo ?? dealAny.trust_info;
    let trustData: Record<string, unknown> = {};
    if (rawTrust && typeof rawTrust === 'object') {
      trustData = rawTrust as Record<string, unknown>;
    } else if (typeof rawTrust === 'string') {
      try { trustData = JSON.parse(rawTrust); } catch { trustData = {}; }
    }
    const explicitSalePrice = extractExplicitDealSalePrice(
      dealAny,
      Object.keys(trustData).length > 0 ? trustData as any : undefined
    ) ?? 0;
    setEditForm({
      title: deal.title,
      projectName: deal.projectName,
      type: deal.type,
      totalInvestment: deal.totalInvestment ? formatAmountInput(String(deal.totalInvestment)) : '0',
      propertyValue: (deal as any).propertyValue ? formatAmountInput(String((deal as any).propertyValue)) : '',
      expectedROI: String(deal.expectedROI),
      propertyAddress: deal.propertyAddress || '',
      description: deal.description || '',
      distributionFrequency: deal.distributionFrequency || 'quarterly',
      exitStrategy: deal.exitStrategy || 'Sale of Property',
      governingLaw: deal.governingLaw || 'State of New York, USA',
      managementFee: String(deal.managementFee || 2),
      performanceFee: String(deal.performanceFee || 20),
      minimumHoldPeriod: String(deal.minimumHoldPeriod || 12),
      llcName: (trustData.llcName as string) || '',
      builderName: (trustData.builderName as string) || '',
      minInvestment: formatAmountInput(String((trustData.minInvestment as number) ?? 50)),
      salePrice: explicitSalePrice > 0 ? formatAmountInput(String(explicitSalePrice)) : '',
      fractionalSharePrice: formatAmountInput(String((trustData.fractionalSharePrice as number) ?? (trustData.minInvestment as number) ?? 50)),
      timelineMin: String((trustData.timelineMin as number) ?? ''),
      timelineMax: String((trustData.timelineMax as number) ?? ''),
      titleVerified: (trustData.titleVerified as boolean) ?? true,
      insuranceCoverage: (trustData.insuranceCoverage as boolean) ?? true,
      escrowProtected: (trustData.escrowProtected as boolean) ?? true,
      permitApproved: trustData.permitStatus ? (trustData.permitStatus as string) === 'approved' : true,
      yearEstablished: String((trustData.yearEstablished as number) || ''),
      completedProjects: String((trustData.completedProjects as number) || ''),
      startDate: normalizeDate(deal.startDate || ''),
      endDate: normalizeDate(deal.endDate || ''),
    });
    setEditModalVisible(true);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!selectedDeal) return;
    if (!editForm.title.trim() || !editForm.projectName.trim()) {
      Alert.alert('Validation', 'Title and Project Name are required.');
      return;
    }
    const parsedInvestment = Number(parseAmountInput(editForm.totalInvestment)) || 0;
    const parsedPropertyValue = Number(parseAmountInput(editForm.propertyValue)) || 0;
    const parsedMinInvestment = Number(parseAmountInput(editForm.minInvestment)) || 50;
    const parsedSalePriceInput = Number(parseAmountInput(editForm.salePrice)) || 0;
    const hasExplicitSalePrice = parsedSalePriceInput > 0;
    const resolvedPropertyValue = parsedPropertyValue || selectedDeal.propertyValue || 0;
    const ownershipBasisSalePrice = hasExplicitSalePrice ? parsedSalePriceInput : (resolvedPropertyValue || parsedInvestment);
    const parsedFractionalSharePrice = Number(parseAmountInput(editForm.fractionalSharePrice)) || parsedMinInvestment;
    const parsedTimelineMin = editForm.timelineMin.trim() !== '' ? Number(parseAmountInput(editForm.timelineMin)) : undefined;
    const parsedTimelineMax = editForm.timelineMax.trim() !== '' ? Number(parseAmountInput(editForm.timelineMax)) : undefined;
    const safeTimelineMin = parsedTimelineMin !== undefined && !isNaN(parsedTimelineMin) ? parsedTimelineMin : undefined;
    const safeTimelineMax = parsedTimelineMax !== undefined && !isNaN(parsedTimelineMax) ? parsedTimelineMax : undefined;
    const parsedROI = Number(parseAmountInput(editForm.expectedROI)) || 15;
    console.log('[Admin JV] Saving edit for:', selectedDeal.id, 'investment:', parsedInvestment, 'explicit sale price:', hasExplicitSalePrice ? parsedSalePriceInput : 'not_set', 'ownership basis:', ownershipBasisSalePrice, 'timeline:', safeTimelineMin, '-', safeTimelineMax, 'photos:', editPhotos.length);
    const ownershipSnapshot = buildOwnershipSnapshot(parsedMinInvestment, ownershipBasisSalePrice);
    const trustInfo = {
      llcName: editForm.llcName.trim() || editForm.projectName.trim(),
      builderName: editForm.builderName.trim() || 'IVX Development',
      minInvestment: parsedMinInvestment,
      ...(hasExplicitSalePrice ? { salePrice: parsedSalePriceInput } : {}),
      hasExplicitSalePrice,
      fractionalSharePrice: parsedFractionalSharePrice,
      ownershipLabel: ownershipSnapshot.ownershipText,
      priceChange1h: 10,
      priceChange2h: 18,
      ...(safeTimelineMin !== undefined ? { timelineMin: safeTimelineMin } : {}),
      ...(safeTimelineMax !== undefined ? { timelineMax: safeTimelineMax } : {}),
      timelineUnit: 'months',
      legalStructure: 'LLC Joint Venture',
      insuranceCoverage: editForm.insuranceCoverage,
      titleVerified: editForm.titleVerified,
      permitStatus: editForm.permitApproved ? 'approved' : 'pending',
      escrowProtected: editForm.escrowProtected,
      thirdPartyAudit: false,
      yearEstablished: Number(editForm.yearEstablished) || undefined,
      completedProjects: Number(editForm.completedProjects) || undefined,
      investorProtections: [
        editForm.titleVerified ? 'Title insurance verified' : '',
        editForm.insuranceCoverage ? 'Full insurance coverage' : '',
        editForm.escrowProtected ? 'Escrow-protected funds' : '',
        'LLC-backed investment structure',
      ].filter(Boolean),
      riskFactors: [],
      keyMilestones: [],
      documents: [],
    };
    const updatePayload: Record<string, unknown> = {
      title: editForm.title.trim(),
      projectName: editForm.projectName.trim(),
      type: editForm.type,
      totalInvestment: parsedInvestment,
      propertyValue: resolvedPropertyValue,
      salePrice: hasExplicitSalePrice ? parsedSalePriceInput : 0,
      expectedROI: parsedROI,
      description: editForm.description.trim(),
      distributionFrequency: editForm.distributionFrequency,
      exitStrategy: editForm.exitStrategy,
      governingLaw: editForm.governingLaw,
      managementFee: Number(parseAmountInput(editForm.managementFee)) || 2,
      performanceFee: Number(parseAmountInput(editForm.performanceFee)) || 20,
      minimumHoldPeriod: Number(parseAmountInput(editForm.minimumHoldPeriod)) || 12,
      photos: editPhotos,
      trust_info: JSON.stringify(trustInfo),
    };
    if (editForm.propertyAddress.trim()) {
      updatePayload.propertyAddress = editForm.propertyAddress.trim();
    }
    if (editForm.startDate.trim()) {
      updatePayload.startDate = editForm.startDate.trim();
    }
    if (editForm.endDate.trim()) {
      updatePayload.endDate = editForm.endDate.trim();
    }
    console.log('[Admin JV] Update payload keys:', Object.keys(updatePayload).join(','), '| startDate:', updatePayload.startDate, '| endDate:', updatePayload.endDate);
    updateMutation.mutate({
      id: selectedDeal.id,
      data: updatePayload,
    },
    {
      onSuccess: () => {
        const investStr = formatAmountInput(String(parsedInvestment));
        const timelineStr = `${safeTimelineMin ?? 'N/A'}–${safeTimelineMax ?? 'N/A'} mo`;
        Alert.alert(
          'Deal Saved',
          `"${editForm.projectName.trim()}" updated.\n\nInvestment: ${investStr}\nSale Price: ${hasExplicitSalePrice ? formatAmountInput(String(parsedSalePriceInput)) : 'Not set'}\nProperty Value: ${formatAmountInput(String(resolvedPropertyValue || 0))}\nROI: ${parsedROI}%\nTimeline: ${timelineStr}\nMin Investment: ${formatAmountInput(String(parsedMinInvestment))}\nFractional Share: ${formatAmountInput(String(parsedFractionalSharePrice))}\nPhotos: ${editPhotos.length}`
        );
      },
    });
  }, [selectedDeal, editForm, editPhotos, updateMutation]);

  const pickPhotosFromGallery = useCallback(async (targetDealId?: string) => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant access to your photo library to upload photos.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 1.0,
        selectionLimit: 20,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const dealId = targetDealId || selectedDeal?.id;
      if (!dealId) {
        Alert.alert('Error', 'No deal selected for photo upload.');
        return;
      }

      const totalPhotos = result.assets.length;
      console.log('[Admin JV] Picking', totalPhotos, 'photos for deal:', dealId);

      const localPhotos = result.assets.map((asset, idx) => ({
        id: `upload_${Date.now()}_${idx}`,
        uri: asset.uri,
      }));

      setPendingLocalPhotos(prev => [...prev, ...localPhotos]);

      const initialStates: Record<string, 'pending' | 'uploading' | 'done' | 'failed'> = {};
      localPhotos.forEach(p => { initialStates[p.id] = 'pending'; });
      setPhotoUploadStates(prev => ({ ...prev, ...initialStates }));

      setIsUploadingPhotos(true);
      uploadProgressAnim.setValue(0);

      localPhotos.forEach(p => { setPhotoUploadStates(prev => ({ ...prev, [p.id]: 'uploading' })); });

      const { urls: uploadedUrls, errors: failedErrors } = await uploadDealPhotosParallel(
        dealId,
        localPhotos.map(p => p.uri),
        (_idx, result, completedSoFar, total) => {
          const photo = localPhotos[_idx] ?? localPhotos[completedSoFar - 1];
          if (photo) {
            setPhotoUploadStates(prev => ({ ...prev, [photo.id]: result.url ? 'done' : 'failed' }));
          }
          Animated.timing(uploadProgressAnim, {
            toValue: completedSoFar / total,
            duration: 200,
            useNativeDriver: false,
          }).start();
          setUploadProgress(`${completedSoFar}/${total}`);
        },
      );

      setIsUploadingPhotos(false);
      setUploadProgress('');

      setPendingLocalPhotos(prev => prev.filter(p => !localPhotos.some(lp => lp.id === p.id)));
      setPhotoUploadStates(prev => {
        const next = { ...prev };
        localPhotos.forEach(p => { delete next[p.id]; });
        return next;
      });

      if (uploadedUrls.length === 0) {
        const allQueued = failedErrors.every(e => e === 'offline_queued');
        if (allQueued && failedErrors.length > 0) {
          Alert.alert('Photos Queued', `${failedErrors.length} photo(s) saved locally and will upload automatically when internet is available.`);
          return;
        }
        const errorDetail = failedErrors.length > 0 ? '\n\nErrors:\n' + failedErrors.filter(e => e !== 'offline_queued').slice(0, 3).join('\n') : '';
        Alert.alert('Upload Failed', 'No photos could be uploaded. Please check your internet connection and try again.' + errorDetail);
        return;
      }

      if (failedErrors.length > 0) {
        console.log('[Admin JV] Partial upload:', uploadedUrls.length, 'OK,', failedErrors.length, 'failed');
      }

      if (targetDealId && !editModalVisible) {
        const deal = (jvList.data ?? []).find(d => d.id === targetDealId);
        const existingPhotos = Array.isArray(deal?.photos) ? deal.photos : [];
        const allPhotos = [...existingPhotos, ...uploadedUrls];
        console.log('[Admin JV] Saving', allPhotos.length, 'photos directly to deal:', targetDealId);
        photoRestoreMutation.mutate({ id: targetDealId, photos: allPhotos });
      } else {
        setEditPhotos(prev => [...prev, ...uploadedUrls]);
        if (failedErrors.length > 0) {
          Alert.alert('Photos Added', `${uploadedUrls.length} uploaded, ${failedErrors.length} failed. Save to keep them.`);
        }
      }
    } catch (err) {
      setIsUploadingPhotos(false);
      setUploadProgress('');
      setPendingLocalPhotos([]);
      setPhotoUploadStates({});
      console.error('[Admin JV] Gallery pick error:', err);
      Alert.alert('Error', 'Failed to pick photos: ' + ((err as Error)?.message || 'Unknown error'));
    }
  }, [selectedDeal, editModalVisible, jvList.data, photoRestoreMutation, uploadProgressAnim]);

  const removeEditPhoto = useCallback((index: number) => {
    setEditPhotos(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleTogglePublish = useCallback((deal: JVDeal) => {
    if (deal.published) {
      Alert.alert('Unpublish Deal', `Remove "${deal.projectName}" from public view?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unpublish', style: 'destructive', onPress: () => unpublishMutation.mutate({ id: deal.id }) },
      ]);
    } else {
      Alert.alert('Publish Deal', `Make "${deal.projectName}" visible to all investors?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Publish', onPress: () => publishMutation.mutate({ id: deal.id }) },
      ]);
    }
  }, [publishMutation, unpublishMutation]);

  const handleArchive = useCallback((deal: JVDeal) => {
    Alert.alert(
      'Archive Deal',
      `Archive "${deal.projectName}"? It will be hidden but can be restored later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Archive', style: 'destructive', onPress: () => archiveMutation.mutate({ id: deal.id }) },
      ]
    );
  }, [archiveMutation]);

  const handleRestore = useCallback((deal: JVDeal) => {
    Alert.alert(
      'Restore Deal',
      `Restore "${deal.projectName}" from archive?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restore', onPress: () => restoreMutation.mutate({ id: deal.id }) },
      ]
    );
  }, [restoreMutation]);

  const handlePermanentDelete = useCallback((deal: JVDeal) => {
    setDeleteTarget(deal);
    setDeleteConfirmText('');
    setDeleteConfirmVisible(true);
  }, []);

  const confirmPermanentDelete = useCallback(() => {
    if (!deleteTarget) return;
    const requiredText = deleteTarget.projectName.trim().toUpperCase();
    if (deleteConfirmText.trim().toUpperCase() !== requiredText) {
      Alert.alert('Confirmation Failed', `You must type "${deleteTarget.projectName}" exactly to confirm deletion.`);
      return;
    }
    deleteMutation.mutate({ id: deleteTarget.id });
  }, [deleteTarget, deleteConfirmText, deleteMutation]);

  const handlePhotoAction = useCallback((deal: JVDeal) => {
    const photoCount = Array.isArray(deal.photos) ? deal.photos.length : 0;
    if (photoCount === 0) {
      Alert.alert(
        'Photos Missing',
        `"${deal.projectName}" has no photos. What would you like to do?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Gallery Upload', onPress: () => pickPhotosFromGallery(deal.id) },
          { text: 'Auto-Recover', onPress: () => photoRecoverMutation.mutate({ id: deal.id }) },
          { text: 'Add URLs', onPress: () => { setPhotoRestoreTarget(deal); setPhotoUrls(''); setPhotoRestoreModalVisible(true); } },
        ]
      );
    } else {
      Alert.alert('Photos', `"${deal.projectName}" has ${photoCount} photo(s).`, [
        { text: 'OK' },
        { text: 'Gallery Upload', onPress: () => pickPhotosFromGallery(deal.id) },
        { text: 'Add URLs', onPress: () => { setPhotoRestoreTarget(deal); setPhotoUrls(''); setPhotoRestoreModalVisible(true); } },
      ]);
    }
  }, [photoRecoverMutation, pickPhotosFromGallery]);

  const handleSubmitPhotoUrls = useCallback(() => {
    if (!photoRestoreTarget) return;
    const urls = photoUrls
      .split('\n')
      .map(u => u.trim())
      .filter(u => u.startsWith('http') && u.length > 10 && (u.includes('.jpg') || u.includes('.jpeg') || u.includes('.png') || u.includes('.webp') || u.includes('.gif') || u.includes('image') || u.includes('photo')));
    if (urls.length === 0) {
      Alert.alert('Invalid', 'Please enter at least one valid photo URL (http/https, must be an image link).');
      return;
    }
    const existingPhotos = Array.isArray(photoRestoreTarget.photos) ? photoRestoreTarget.photos : [];
    const allPhotos = [...existingPhotos, ...urls];
    photoRestoreMutation.mutate({ id: photoRestoreTarget.id, photos: allPhotos });
  }, [photoRestoreTarget, photoUrls, photoRestoreMutation]);

  const enterReorderMode = useCallback(() => {
    const currentIds = deals.map(d => d.id);
    setLocalOrder(currentIds);
    setReorderMode(true);
    setReorderDirty(false);
    console.log('[Admin JV] Entered reorder mode with', currentIds.length, 'deals');
  }, [deals]);

  const exitReorderMode = useCallback(() => {
    setReorderMode(false);
    setReorderDirty(false);
    setLocalOrder([]);
  }, []);

  const moveDeal = useCallback((dealId: string, direction: 'up' | 'down' | 'top' | 'bottom') => {
    setLocalOrder(prev => {
      const order = [...prev];
      const idx = order.indexOf(dealId);
      if (idx === -1) return prev;
      if (direction === 'up' && idx > 0) {
        const temp = order[idx] as string;
        order[idx] = order[idx - 1] as string;
        order[idx - 1] = temp;
      } else if (direction === 'down' && idx < order.length - 1) {
        const temp = order[idx] as string;
        order[idx] = order[idx + 1] as string;
        order[idx + 1] = temp;
      } else if (direction === 'top') {
        order.splice(idx, 1);
        order.unshift(dealId);
      } else if (direction === 'bottom') {
        order.splice(idx, 1);
        order.push(dealId);
      }
      return order;
    });
    setReorderDirty(true);
  }, []);

  const saveReorder = useCallback(() => {
    if (!reorderDirty || localOrder.length === 0) return;
    const orders = localOrder.map((id, idx) => ({ id, displayOrder: idx + 1 }));
    console.log('[Admin JV] Saving reorder:', orders.map(o => `${o.id}→${o.displayOrder}`).join(', '));
    reorderMutation.mutate(orders);
  }, [reorderDirty, localOrder, reorderMutation]);

  const quickMoveDeal = useCallback((dealId: string, direction: 'up' | 'down') => {
    const currentIds = deals.map(d => d.id);
    const idx = currentIds.indexOf(dealId);
    if (idx === -1) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === currentIds.length - 1) return;
    const newOrder = [...currentIds];
    if (direction === 'up') {
      const temp = newOrder[idx] as string;
      newOrder[idx] = newOrder[idx - 1] as string;
      newOrder[idx - 1] = temp;
    } else {
      const temp = newOrder[idx] as string;
      newOrder[idx] = newOrder[idx + 1] as string;
      newOrder[idx + 1] = temp;
    }
    const orders = newOrder.map((id, i) => ({ id, displayOrder: i + 1 }));
    console.log('[Admin JV] Quick move', dealId, direction, '→ saving immediately');
    reorderMutation.mutate(orders);
  }, [deals, reorderMutation]);

  const moveToPosition = useCallback((dealId: string, targetPos: number) => {
    const currentIds = deals.map(d => d.id);
    const currentIdx = currentIds.indexOf(dealId);
    if (currentIdx === -1) return;
    const clampedPos = Math.max(1, Math.min(targetPos, currentIds.length));
    const targetIdx = clampedPos - 1;
    if (targetIdx === currentIdx) return;
    const newOrder = [...currentIds];
    newOrder.splice(currentIdx, 1);
    newOrder.splice(targetIdx, 0, dealId);
    const orders = newOrder.map((id, i) => ({ id, displayOrder: i + 1 }));
    console.log('[Admin JV] Move', dealId, 'from position', currentIdx + 1, 'to', clampedPos, '→ saving');
    setPositionInputDealId(null);
    setPositionInputValue('');
    reorderMutation.mutate(orders);
  }, [deals, reorderMutation]);

  const openPositionInput = useCallback((dealId: string, currentPos: number) => {
    setPositionInputDealId(dealId);
    setPositionInputValue(String(currentPos));
  }, []);

  const handlePositionSubmit = useCallback((dealId: string) => {
    const num = parseInt(positionInputValue, 10);
    if (isNaN(num) || num < 1) {
      Alert.alert('Invalid', 'Enter a valid position number (1 or higher).');
      return;
    }
    moveToPosition(dealId, num);
  }, [positionInputValue, moveToPosition]);

  const deleteConfirmMatch = deleteConfirmText.trim().toUpperCase() === (deleteTarget?.projectName || '').trim().toUpperCase();

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="jv-deals-back" accessibilityLabel="Go back">
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>JV Deal Management</Text>
          <View style={styles.headerActions}>
            {!reorderMode ? (
              <TouchableOpacity
                style={styles.reorderToggleBtn}
                onPress={enterReorderMode}
                testID="jv-reorder-toggle"
                accessibilityLabel="Reorder deals"
              >
                <GripVertical size={16} color={Colors.text} />
              </TouchableOpacity>
            ) : null}
            {!reorderMode ? (
              <TouchableOpacity
                style={styles.createBtn}
                onPress={() => router.push('/jv-agreement')}
                testID="jv-create-deal"
                accessibilityLabel="Create new deal"
              >
                <Plus size={18} color="#000" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {reorderMode && (
          <View style={styles.reorderBar}>
            <View style={styles.reorderBarLeft}>
              <GripVertical size={16} color={Colors.primary} />
              <Text style={styles.reorderBarText}>Reorder Mode</Text>
            </View>
            <View style={styles.reorderBarActions}>
              <TouchableOpacity
                style={styles.reorderCancelBtn}
                onPress={exitReorderMode}
                testID="jv-reorder-cancel"
              >
                <Text style={styles.reorderCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reorderSaveBtn, !reorderDirty && styles.reorderSaveBtnDisabled]}
                onPress={saveReorder}
                disabled={!reorderDirty || reorderMutation.isPending}
                testID="jv-reorder-save"
              >
                {reorderMutation.isPending ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.reorderSaveText}>Save Order</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
        >
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{stats.total}</Text>
              <Text style={styles.statLabel}>Total</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, styles.statValueGreen]}>{stats.published}</Text>
              <Text style={styles.statLabel}>Published</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, styles.statValuePrimary]}>{stats.active}</Text>
              <Text style={styles.statLabel}>Active</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, styles.statValueYellow]}>{formatCurrencySafe(stats.totalInvestment, true)}</Text>
              <Text style={styles.statLabel}>Total Value</Text>
            </View>
          </View>

          <View style={styles.searchWrap}>
            <Search size={16} color={Colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search deals..."
              placeholderTextColor={Colors.textTertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              testID="jv-search"
            />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersRow}>
            {FILTER_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.id}
                style={[styles.filterChip, filterStatus === opt.id && styles.filterChipActive]}
                onPress={() => setFilterStatus(opt.id)}
              >
                <Text style={[styles.filterChipText, filterStatus === opt.id && styles.filterChipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {jvList.isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.loadingText}>Loading deals...</Text>
            </View>
          ) : jvList.isError ? (
            <View style={styles.errorWrap}>
              <AlertTriangle size={40} color="#FF4D4D" />
              <Text style={styles.errorTitle}>Failed to load deals</Text>
              <Text style={styles.errorSubtitle}>{jvList.error?.message || 'Unknown error occurred'}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={onRefresh} testID="jv-retry">
                <Text style={styles.retryBtnText}>Tap to Retry</Text>
              </TouchableOpacity>
            </View>
          ) : deals.length === 0 ? (
            <View style={styles.emptyWrap}>
              <FileText size={40} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>No JV deals found</Text>
              <Text style={styles.emptySubtitle}>
                {searchQuery ? 'Try a different search term' : 'Create your first JV deal to get started'}
              </Text>
            </View>
          ) : (
            deals.map((deal, dealIndex) => {
              const status = STATUS_CONFIG[deal.status] ?? STATUS_CONFIG['draft'] ?? { label: 'Draft', color: '#9A9A9A', bg: '#9A9A9A18' };
              const photoCount = Array.isArray(deal.photos) ? deal.photos.length : 0;
              const isFirst = dealIndex === 0;
              const isLast = dealIndex === deals.length - 1;
              return (
                <View key={deal.id} style={[styles.dealCard, reorderMode && styles.dealCardReorder]} testID={`admin-jv-${deal.id}`}>
                  {reorderMode && (
                    <View style={styles.reorderControls}>
                      <View style={styles.reorderPositionBadge}>
                        <Text style={styles.reorderPositionText}>#{dealIndex + 1}</Text>
                      </View>
                      <View style={styles.reorderBtns}>
                        <TouchableOpacity
                          style={[styles.reorderMoveBtn, isFirst && styles.reorderMoveBtnDisabled]}
                          onPress={() => moveDeal(deal.id, 'top')}
                          disabled={isFirst}
                          testID={`jv-move-top-${deal.id}`}
                        >
                          <ArrowUpToLine size={14} color={isFirst ? Colors.textTertiary : '#00C48C'} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.reorderMoveBtn, isFirst && styles.reorderMoveBtnDisabled]}
                          onPress={() => moveDeal(deal.id, 'up')}
                          disabled={isFirst}
                          testID={`jv-move-up-${deal.id}`}
                        >
                          <ChevronUp size={16} color={isFirst ? Colors.textTertiary : Colors.primary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.reorderMoveBtn, isLast && styles.reorderMoveBtnDisabled]}
                          onPress={() => moveDeal(deal.id, 'down')}
                          disabled={isLast}
                          testID={`jv-move-down-${deal.id}`}
                        >
                          <ChevronDown size={16} color={isLast ? Colors.textTertiary : Colors.primary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.reorderMoveBtn, isLast && styles.reorderMoveBtnDisabled]}
                          onPress={() => moveDeal(deal.id, 'bottom')}
                          disabled={isLast}
                          testID={`jv-move-bottom-${deal.id}`}
                        >
                          <ArrowDownToLine size={14} color={isLast ? Colors.textTertiary : '#FF6B6B'} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                  <View style={styles.dealHeader}>
                    <View style={styles.dealTitleWrap}>
                      <Text style={styles.dealProjectName} numberOfLines={1}>{deal.projectName}</Text>
                      <Text style={styles.dealTitle} numberOfLines={1}>{deal.title}</Text>
                    </View>
                    <View style={styles.dealBadges}>
                      <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                        <View style={[styles.statusDot, { backgroundColor: status.color }]} />
                        <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                      </View>
                      {deal.published ? (
                        <View style={[styles.pubBadge, styles.pubBadgeLive]}>
                          <Eye size={10} color="#00C48C" />
                          <Text style={[styles.pubBadgeText, styles.pubBadgeTextLive]}>Live</Text>
                        </View>
                      ) : (
                        <View style={[styles.pubBadge, styles.pubBadgeHidden]}>
                          <EyeOff size={10} color="#9A9A9A" />
                          <Text style={[styles.pubBadgeText, styles.pubBadgeTextHidden]}>Hidden</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {deal.propertyAddress ? (
                    <View style={styles.addressRow}>
                      <MapPin size={11} color={Colors.textTertiary} />
                      <Text style={styles.addressText} numberOfLines={1}>{deal.propertyAddress}</Text>
                    </View>
                  ) : null}

                  <View style={styles.dealMetrics}>
                    <View style={styles.dealMetric}>
                      <DollarSign size={12} color={Colors.primary} />
                      <Text style={styles.dealMetricValue}>{formatCurrencySafe(deal.totalInvestment, true)}</Text>
                    </View>
                    <View style={styles.dealMetric}>
                      <TrendingUp size={12} color="#00C48C" />
                      <Text style={styles.dealMetricValue}>{deal.expectedROI != null && Number.isFinite(Number(deal.expectedROI)) ? `${deal.expectedROI}% ROI` : 'Not entered'}</Text>
                    </View>
                    <View style={styles.dealMetric}>
                      <Users size={12} color="#4A90D9" />
                      <Text style={styles.dealMetricValue}>{deal.partners?.length || 0} Partners</Text>
                    </View>
                    <View style={styles.dealMetric}>
                      <Globe size={12} color="#E879F9" />
                      <Text style={styles.dealMetricValue}>{TYPE_LABELS[deal.type] || deal.type}</Text>
                    </View>
                  </View>

                  <View style={styles.inlineReorderRow}>
                    <View style={styles.inlineReorderBtns}>
                      <TouchableOpacity
                        style={[styles.inlineArrowBtn, isFirst && styles.inlineArrowBtnDisabled]}
                        onPress={() => quickMoveDeal(deal.id, 'up')}
                        disabled={isFirst || reorderMutation.isPending}
                        testID={`jv-quick-up-${deal.id}`}
                        accessibilityLabel={`Move ${deal.projectName} up`}
                      >
                        <ChevronUp size={18} color={isFirst ? Colors.textTertiary : '#00C48C'} />
                      </TouchableOpacity>
                      {positionInputDealId === deal.id ? (
                        <View style={styles.positionInputWrap}>
                          <TextInput
                            style={styles.positionInput}
                            value={positionInputValue}
                            onChangeText={setPositionInputValue}
                            keyboardType="number-pad"
                            autoFocus
                            selectTextOnFocus
                            returnKeyType="done"
                            onSubmitEditing={() => handlePositionSubmit(deal.id)}
                            onBlur={() => { setPositionInputDealId(null); setPositionInputValue(''); }}
                            testID={`jv-position-input-${deal.id}`}
                          />
                          <TouchableOpacity
                            style={styles.positionGoBtn}
                            onPress={() => handlePositionSubmit(deal.id)}
                            testID={`jv-position-go-${deal.id}`}
                          >
                            <Check size={12} color="#fff" />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={styles.positionBadgeTap}
                          onPress={() => openPositionInput(deal.id, dealIndex + 1)}
                          testID={`jv-position-tap-${deal.id}`}
                          accessibilityLabel={`Set position for ${deal.projectName}`}
                        >
                          <Text style={styles.inlinePositionText}>#{dealIndex + 1}</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={[styles.inlineArrowBtn, isLast && styles.inlineArrowBtnDisabled]}
                        onPress={() => quickMoveDeal(deal.id, 'down')}
                        disabled={isLast || reorderMutation.isPending}
                        testID={`jv-quick-down-${deal.id}`}
                        accessibilityLabel={`Move ${deal.projectName} down`}
                      >
                        <ChevronDown size={18} color={isLast ? Colors.textTertiary : '#FF6B6B'} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.dealActions}>
                    {deal.status === 'archived' ? (
                      <>
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.restoreBtn]}
                          onPress={() => handleRestore(deal)}
                          disabled={isAnyMutating}
                          testID={`admin-jv-restore-${deal.id}`}
                          accessibilityLabel={`Restore ${deal.projectName}`}
                        >
                          <ArchiveRestore size={14} color="#00C48C" />
                          <Text style={[styles.actionBtnText, styles.actionBtnTextGreen]}>Restore</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.permDeleteBtn]}
                          onPress={() => handlePermanentDelete(deal)}
                          disabled={isAnyMutating}
                          testID={`admin-jv-permdelete-${deal.id}`}
                          accessibilityLabel={`Permanently delete ${deal.projectName}`}
                        >
                          <Trash2 size={14} color="#FF4D4D" />
                          <Text style={[styles.actionBtnText, styles.actionBtnTextRed]}>Delete Forever</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.editBtn]}
                          onPress={() => openEditModal(deal)}
                          disabled={isAnyMutating}
                          testID={`admin-jv-edit-${deal.id}`}
                          accessibilityLabel={`Edit ${deal.projectName}`}
                        >
                          <Edit3 size={14} color={Colors.primary} />
                          <Text style={[styles.actionBtnText, styles.actionBtnTextPrimary]}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionBtn, deal.published ? styles.unpublishBtn : styles.publishBtn]}
                          onPress={() => handleTogglePublish(deal)}
                          disabled={isAnyMutating}
                          testID={`admin-jv-toggle-${deal.id}`}
                          accessibilityLabel={deal.published ? `Unpublish ${deal.projectName}` : `Publish ${deal.projectName}`}
                        >
                          {deal.published ? <EyeOff size={14} color="#FF6B6B" /> : <Eye size={14} color="#00C48C" />}
                          <Text style={[styles.actionBtnText, deal.published ? styles.actionBtnTextDanger : styles.actionBtnTextGreen]}>
                            {deal.published ? 'Unpublish' : 'Publish'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.photoBtn]}
                          onPress={() => handlePhotoAction(deal)}
                          disabled={isAnyMutating}
                          testID={`admin-jv-photos-${deal.id}`}
                          accessibilityLabel={`Photos for ${deal.projectName}`}
                        >
                          <Camera size={14} color="#4A90D9" />
                          <Text style={[styles.actionBtnText, styles.actionBtnTextBlue]}>{photoCount}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.archiveBtn]}
                          onPress={() => handleArchive(deal)}
                          disabled={isAnyMutating}
                          testID={`admin-jv-archive-${deal.id}`}
                          accessibilityLabel={`Archive ${deal.projectName}`}
                        >
                          <Archive size={14} color="#FFB800" />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </View>
              );
            })
          )}

          {jvList.hasMore || jvList.isFetchingMore ? (
            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
              {jvList.isFetchingMore ? (
                <>
                  <ActivityIndicator size="small" color={Colors.primary} />
                  <Text style={{ color: Colors.textSecondary, marginTop: 8, fontSize: 13 }}>Loading more deals…</Text>
                </>
              ) : (
                <TouchableOpacity onPress={jvList.loadMore} testID="jv-load-more">
                  <Text style={{ color: Colors.primary, fontSize: 14, fontWeight: '600' }}>Load more deals</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}

          <View style={styles.bottomSpacer} />
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
              To permanently delete this deal, type the project name below:
            </Text>
            <Text style={styles.deleteModalDealName}>
              {deleteTarget?.projectName || ''}
            </Text>
            <TextInput
              style={styles.deleteConfirmInput}
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder={`Type "${deleteTarget?.projectName || ''}" to confirm`}
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="sentences"
              testID="delete-confirm-input"
            />
            <View style={styles.deleteModalActions}>
              <TouchableOpacity
                style={styles.deleteModalCancel}
                onPress={() => {
                  setDeleteConfirmVisible(false);
                  setDeleteTarget(null);
                  setDeleteConfirmText('');
                }}
                testID="delete-cancel-btn"
              >
                <Text style={styles.deleteModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.deleteModalConfirm,
                  !deleteConfirmMatch && styles.deleteModalConfirmDisabled,
                ]}
                onPress={confirmPermanentDelete}
                disabled={deleteMutation.isPending || !deleteConfirmMatch}
                testID="delete-confirm-btn"
              >
                {deleteMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.deleteModalConfirmText}>Delete Forever</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={photoRestoreModalVisible} animationType="fade" transparent>
        <View style={styles.deleteOverlay}>
          <View style={styles.deleteModal}>
            <View style={[styles.deleteIconWrap, styles.photoIconWrap]}>
              <ImagePlus size={32} color="#4A90D9" />
            </View>
            <Text style={styles.deleteModalTitle}>Add Photos</Text>
            <Text style={styles.deleteModalSubtitle}>
              Upload from your gallery or paste URLs below for "{photoRestoreTarget?.projectName}".
            </Text>
            <TouchableOpacity
              style={styles.galleryUploadBtnModal}
              onPress={() => {
                setPhotoRestoreModalVisible(false);
                if (photoRestoreTarget) {
                  void pickPhotosFromGallery(photoRestoreTarget.id);
                }
              }}
              disabled={isUploadingPhotos}
              activeOpacity={0.7}
              testID="photo-gallery-btn"
            >
              <Upload size={20} color="#fff" />
              <Text style={styles.galleryUploadBtnText}>Upload from Gallery</Text>
            </TouchableOpacity>
            <View style={styles.photoOrDivider}>
              <View style={styles.photoOrLine} />
              <Text style={styles.photoOrText}>OR</Text>
              <View style={styles.photoOrLine} />
            </View>
            <TextInput
              style={[styles.deleteConfirmInput, styles.photoUrlsInput]}
              value={photoUrls}
              onChangeText={setPhotoUrls}
              placeholder={"https://example.com/photo1.jpg\nhttps://example.com/photo2.jpg"}
              placeholderTextColor={Colors.textTertiary}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              testID="photo-urls-input"
            />
            <View style={styles.deleteModalActions}>
              <TouchableOpacity
                style={styles.deleteModalCancel}
                onPress={() => {
                  setPhotoRestoreModalVisible(false);
                  setPhotoRestoreTarget(null);
                  setPhotoUrls('');
                }}
                testID="photo-cancel-btn"
              >
                <Text style={styles.deleteModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.deleteModalConfirm, styles.photoConfirmBtn]}
                onPress={handleSubmitPhotoUrls}
                disabled={photoRestoreMutation.isPending || !photoUrls.trim()}
                testID="photo-restore-btn"
              >
                {photoRestoreMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.deleteModalConfirmText}>Add URL Photos</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {isUploadingPhotos && (
        <View style={styles.uploadToast}>
          <View style={styles.uploadToastContent}>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.uploadToastText}>Uploading {uploadProgress}</Text>
          </View>
          <View style={styles.uploadToastBarBg}>
            <Animated.View
              style={[
                styles.uploadToastBarFill,
                {
                  width: uploadProgressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                },
              ]}
            />
          </View>
        </View>
      )}

      <Modal visible={editModalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => { setEditModalVisible(false); setSelectedDeal(null); }} testID="edit-close-btn" accessibilityLabel="Close edit modal">
              <X size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Edit Deal</Text>
            <TouchableOpacity
              onPress={handleSaveEdit}
              disabled={updateMutation.isPending}
              style={styles.modalSaveBtn}
              testID="edit-save-btn"
              accessibilityLabel="Save deal changes"
            >
              {updateMutation.isPending ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <>
                  <Check size={16} color="#000" />
                  <Text style={styles.modalSaveBtnText}>Save</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView
            style={styles.keyboardAvoid}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={0}
          >
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>Project Name</Text>
              <TextInput
                style={styles.fieldInput}
                value={editForm.projectName}
                onChangeText={(v) => setEditForm(f => ({ ...f, projectName: v }))}
                placeholder="e.g. Casa Rosario"
                placeholderTextColor={Colors.textTertiary}
                testID="edit-project-name"
              />

              <Text style={styles.fieldLabel}>Title</Text>
              <TextInput
                style={styles.fieldInput}
                value={editForm.title}
                onChangeText={(v) => setEditForm(f => ({ ...f, title: v }))}
                placeholder="e.g. Casa Rosario — Luxury Villa Development"
                placeholderTextColor={Colors.textTertiary}
                testID="edit-title"
              />

              <Text style={styles.fieldLabel}>Deal Type</Text>
              <View style={styles.typeRow}>
                {DEAL_TYPES.map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.typeChip, editForm.type === t && styles.typeChipActive]}
                    onPress={() => setEditForm(f => ({ ...f, type: t }))}
                  >
                    <Text style={[styles.typeChipText, editForm.type === t && styles.typeChipTextActive]}>
                      {TYPE_LABELS[t]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Investment / Raise Amount ($)</Text>
              <TextInput
                style={styles.fieldInput}
                value={editForm.totalInvestment}
                onChangeText={(v) => setEditForm(f => ({ ...f, totalInvestment: formatAmountInput(parseAmountInput(v)) }))}
                keyboardType="numeric"
                placeholder="2500000"
                placeholderTextColor={Colors.textTertiary}
                testID="edit-investment"
              />

              <Text style={styles.fieldLabel}>Property Market Value ($) · separate from sale price</Text>
              <TextInput
                style={styles.fieldInput}
                value={editForm.propertyValue}
                onChangeText={(v) => setEditForm(f => ({ ...f, propertyValue: formatAmountInput(parseAmountInput(v)) }))}
                keyboardType="numeric"
                placeholder="15000000"
                placeholderTextColor={Colors.textTertiary}
                testID="edit-property-value"
              />

              <Text style={styles.fieldLabel}>Expected ROI (%)</Text>
              <TextInput
                style={styles.fieldInput}
                value={editForm.expectedROI}
                onChangeText={(v) => setEditForm(f => ({ ...f, expectedROI: v }))}
                keyboardType="numeric"
                placeholder="22"
                placeholderTextColor={Colors.textTertiary}
                testID="edit-roi"
              />

              <Text style={styles.fieldLabel}>Property Address</Text>
              <TextInput
                style={styles.fieldInput}
                value={editForm.propertyAddress}
                onChangeText={(v) => setEditForm(f => ({ ...f, propertyAddress: v }))}
                placeholder="Punta Cana, Dominican Republic"
                placeholderTextColor={Colors.textTertiary}
                testID="edit-address"
              />

              <Text style={styles.fieldLabel}>Description</Text>
              <TextInput
                style={[styles.fieldInput, styles.fieldTextarea]}
                value={editForm.description}
                onChangeText={(v) => setEditForm(f => ({ ...f, description: v }))}
                placeholder="Deal description..."
                placeholderTextColor={Colors.textTertiary}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                testID="edit-description"
              />

              <View style={styles.fieldRow}>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Start Date</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editForm.startDate}
                    onChangeText={(v) => setEditForm(f => ({ ...f, startDate: v }))}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={Colors.textTertiary}
                    testID="edit-start-date"
                  />
                </View>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>End Date</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editForm.endDate}
                    onChangeText={(v) => setEditForm(f => ({ ...f, endDate: v }))}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={Colors.textTertiary}
                    testID="edit-end-date"
                  />
                </View>
              </View>

              <Text style={styles.fieldLabel}>Exit Strategy</Text>
              <TextInput
                style={styles.fieldInput}
                value={editForm.exitStrategy}
                onChangeText={(v) => setEditForm(f => ({ ...f, exitStrategy: v }))}
                placeholder="Sale of Property"
                placeholderTextColor={Colors.textTertiary}
                testID="edit-exit-strategy"
              />

              <Text style={styles.fieldLabel}>Governing Law</Text>
              <TextInput
                style={styles.fieldInput}
                value={editForm.governingLaw}
                onChangeText={(v) => setEditForm(f => ({ ...f, governingLaw: v }))}
                placeholder="State of New York, USA"
                placeholderTextColor={Colors.textTertiary}
                testID="edit-governing-law"
              />

              <View style={styles.fieldRow}>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Mgmt Fee (%)</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editForm.managementFee}
                    onChangeText={(v) => setEditForm(f => ({ ...f, managementFee: v }))}
                    keyboardType="numeric"
                    placeholder="2"
                    placeholderTextColor={Colors.textTertiary}
                    testID="edit-mgmt-fee"
                  />
                </View>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Perf Fee (%)</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editForm.performanceFee}
                    onChangeText={(v) => setEditForm(f => ({ ...f, performanceFee: v }))}
                    keyboardType="numeric"
                    placeholder="20"
                    placeholderTextColor={Colors.textTertiary}
                    testID="edit-perf-fee"
                  />
                </View>
              </View>

              <Text style={styles.fieldLabel}>Min Hold Period (months)</Text>
              <TextInput
                style={styles.fieldInput}
                value={editForm.minimumHoldPeriod}
                onChangeText={(v) => setEditForm(f => ({ ...f, minimumHoldPeriod: v }))}
                keyboardType="numeric"
                placeholder="12"
                placeholderTextColor={Colors.textTertiary}
                testID="edit-hold-period"
              />

              <View style={styles.trustSectionHeader}>
                <Shield size={16} color="#00C48C" />
                <Text style={styles.trustSectionTitle}>Investor Trust Info</Text>
              </View>

              <Text style={styles.fieldLabel}>LLC Name</Text>
              <TextInput
                style={styles.fieldInput}
                value={editForm.llcName}
                onChangeText={(v) => setEditForm(f => ({ ...f, llcName: v }))}
                placeholder="e.g. ONE STOP DEVELOPMENT TWO LLC"
                placeholderTextColor={Colors.textTertiary}
                testID="edit-llc-name"
              />

              <Text style={styles.fieldLabel}>Builder / Developer Name</Text>
              <TextInput
                style={styles.fieldInput}
                value={editForm.builderName}
                onChangeText={(v) => setEditForm(f => ({ ...f, builderName: v }))}
                placeholder="e.g. One Stop Development"
                placeholderTextColor={Colors.textTertiary}
                testID="edit-builder-name"
              />

              <View style={styles.fieldRow}>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Min Investment ($)</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editForm.minInvestment}
                    onChangeText={(v) => setEditForm(f => ({ ...f, minInvestment: formatAmountInput(parseAmountInput(v)) }))}
                    keyboardType="numeric"
                    placeholder="50"
                    placeholderTextColor={Colors.textTertiary}
                    testID="edit-min-invest"
                  />
                </View>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Completed Projects</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editForm.completedProjects}
                    onChangeText={(v) => setEditForm(f => ({ ...f, completedProjects: v }))}
                    keyboardType="numeric"
                    placeholder="5"
                    placeholderTextColor={Colors.textTertiary}
                    testID="edit-completed-projects"
                  />
                </View>
              </View>

              <View style={styles.fieldRow}>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Sale Price ($)</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editForm.salePrice}
                    onChangeText={(v) => setEditForm(f => ({ ...f, salePrice: formatAmountInput(parseAmountInput(v)) }))}
                    keyboardType="numeric"
                    placeholder="15,000,000"
                    placeholderTextColor={Colors.textTertiary}
                    testID="edit-sale-price"
                  />
                </View>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Fractional Share ($)</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editForm.fractionalSharePrice}
                    onChangeText={(v) => setEditForm(f => ({ ...f, fractionalSharePrice: formatAmountInput(parseAmountInput(v)) }))}
                    keyboardType="numeric"
                    placeholder="1"
                    placeholderTextColor={Colors.textTertiary}
                    testID="edit-fractional-share-price"
                  />
                </View>
              </View>

              <View style={styles.fieldRow}>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Timeline Min (mo)</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editForm.timelineMin}
                    onChangeText={(v) => setEditForm(f => ({ ...f, timelineMin: v }))}
                    keyboardType="numeric"
                    placeholder="14"
                    placeholderTextColor={Colors.textTertiary}
                    testID="edit-timeline-min"
                  />
                </View>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Timeline Max (mo)</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editForm.timelineMax}
                    onChangeText={(v) => setEditForm(f => ({ ...f, timelineMax: v }))}
                    keyboardType="numeric"
                    placeholder="24"
                    placeholderTextColor={Colors.textTertiary}
                    testID="edit-timeline-max"
                  />
                </View>
              </View>

              <Text style={{ color: Colors.textSecondary, fontSize: 12, marginTop: 8, marginBottom: 10 }}>
                {isTimelineAutosaving ? 'Saving…' : 'Timeline and sale price stay exactly as the admin saves them.'}
              </Text>

              <View style={styles.fieldRow}>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Year Established</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editForm.yearEstablished}
                    onChangeText={(v) => setEditForm(f => ({ ...f, yearEstablished: v }))}
                    keyboardType="numeric"
                    placeholder="2020"
                    placeholderTextColor={Colors.textTertiary}
                    testID="edit-year-est"
                  />
                </View>
                <View style={styles.fieldHalf} />
              </View>

              <Text style={[styles.fieldLabel, { marginTop: 8 }]}>Verification Badges</Text>
              <View style={styles.trustToggles}>
                <TouchableOpacity
                  style={[styles.trustToggle, editForm.titleVerified && styles.trustToggleActive]}
                  onPress={() => setEditForm(f => ({ ...f, titleVerified: !f.titleVerified }))}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.trustToggleText, editForm.titleVerified && styles.trustToggleTextActive]}>Title Verified</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.trustToggle, editForm.insuranceCoverage && styles.trustToggleActive]}
                  onPress={() => setEditForm(f => ({ ...f, insuranceCoverage: !f.insuranceCoverage }))}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.trustToggleText, editForm.insuranceCoverage && styles.trustToggleTextActive]}>Insured</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.trustToggle, editForm.escrowProtected && styles.trustToggleActive]}
                  onPress={() => setEditForm(f => ({ ...f, escrowProtected: !f.escrowProtected }))}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.trustToggleText, editForm.escrowProtected && styles.trustToggleTextActive]}>Escrow</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.trustToggle, editForm.permitApproved && styles.trustToggleActive]}
                  onPress={() => setEditForm(f => ({ ...f, permitApproved: !f.permitApproved }))}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.trustToggleText, editForm.permitApproved && styles.trustToggleTextActive]}>Permitted</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.photoSectionHeader}>
                <Text style={styles.fieldLabel}>Photos</Text>
                <Text style={styles.photoCountBadge}>{editPhotos.length + pendingLocalPhotos.length}</Text>
              </View>
              <View style={styles.editPhotosSection}>
                <View style={styles.photoGrid}>
                  {editPhotos.map((uri, idx) => (
                    <View key={`photo-${idx}-${uri.substring(Math.max(0, uri.length - 20))}`} style={styles.photoGridItem}>
                      <Image source={{ uri }} style={styles.photoGridImage} resizeMode="cover" />
                      <TouchableOpacity
                        style={styles.photoGridRemoveBtn}
                        onPress={() => removeEditPhoto(idx)}
                        activeOpacity={0.7}
                      >
                        <X size={10} color="#fff" />
                      </TouchableOpacity>
                      <View style={styles.photoGridIndex}>
                        <Text style={styles.photoGridIndexText}>{idx + 1}</Text>
                      </View>
                    </View>
                  ))}
                  {pendingLocalPhotos.map((photo) => {
                    const state = photoUploadStates[photo.id] ?? 'pending';
                    return (
                      <View key={photo.id} style={styles.photoGridItem}>
                        <Image source={{ uri: photo.uri }} style={[styles.photoGridImage, styles.photoGridImageUploading]} resizeMode="cover" />
                        <View style={styles.photoUploadOverlayInline}>
                          {state === 'uploading' ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : state === 'failed' ? (
                            <AlertTriangle size={16} color="#FF4D4D" />
                          ) : state === 'done' ? (
                            <Check size={16} color="#00C48C" />
                          ) : (
                            <View style={styles.photoPendingDot} />
                          )}
                        </View>
                      </View>
                    );
                  })}
                  <TouchableOpacity
                    style={styles.photoGridAddBtn}
                    onPress={() => pickPhotosFromGallery()}
                    disabled={isUploadingPhotos}
                    activeOpacity={0.7}
                    testID="edit-upload-photos"
                  >
                    <Plus size={24} color="#4A90D9" />
                    <Text style={styles.photoGridAddText}>Gallery</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.photoGridAddBtn}
                    onPress={() => {
                      if (selectedDeal) {
                        setPhotoRestoreTarget(selectedDeal);
                        setPhotoUrls('');
                        setPhotoRestoreModalVisible(true);
                      }
                    }}
                    disabled={isUploadingPhotos}
                    activeOpacity={0.7}
                  >
                    <ImageIcon size={22} color={Colors.primary} />
                    <Text style={styles.photoGridAddText}>URL</Text>
                  </TouchableOpacity>
                </View>
                {editPhotos.length === 0 && pendingLocalPhotos.length === 0 && (
                  <View style={styles.editPhotosEmpty}>
                    <Camera size={24} color={Colors.textTertiary} />
                    <Text style={styles.editPhotosEmptyText}>No photos yet. Tap + to add.</Text>
                  </View>
                )}
              </View>

              <View style={styles.modalBottomSpacer} />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700' as const,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },

  createBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  statValue: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const,
  },
  statValueGreen: {
    color: '#00C48C',
  },
  statValuePrimary: {
    color: Colors.primary,
  },
  statValueYellow: {
    color: '#FFB800',
  },
  statLabel: {
    color: Colors.textTertiary,
    fontSize: 9,
    fontWeight: '600' as const,
    marginTop: 2,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
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
    borderColor: Colors.surfaceBorder,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    paddingVertical: 12,
  },
  filtersRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  filterChipActive: {
    backgroundColor: Colors.primary + '20',
    borderColor: Colors.primary,
  },
  filterChipText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  filterChipTextActive: {
    color: Colors.primary,
  },
  loadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  errorWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  errorTitle: {
    color: '#FF4D4D',
    fontSize: 16,
    fontWeight: '700' as const,
    marginTop: 8,
  },
  errorSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  retryBtn: {
    marginTop: 12,
    backgroundColor: Colors.primary + '20',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  retryBtnText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
    marginTop: 8,
  },
  emptySubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  dealCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  dealHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  dealTitleWrap: {
    flex: 1,
    marginRight: 8,
  },
  dealProjectName: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
  },
  dealTitle: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 2,
  },
  dealBadges: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
  pubBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  pubBadgeLive: {
    backgroundColor: '#00C48C18',
  },
  pubBadgeHidden: {
    backgroundColor: '#9A9A9A18',
  },
  pubBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
  },
  pubBadgeTextLive: {
    color: '#00C48C',
  },
  pubBadgeTextHidden: {
    color: '#9A9A9A',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10,
  },
  addressText: {
    color: Colors.textTertiary,
    fontSize: 11,
    flex: 1,
  },
  dealMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10,
    padding: 10,
  },
  dealMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dealMetricValue: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  dealActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  actionBtnTextPrimary: {
    color: Colors.primary,
  },
  actionBtnTextGreen: {
    color: '#00C48C',
  },
  actionBtnTextRed: {
    color: '#FF4D4D',
  },
  actionBtnTextDanger: {
    color: '#FF6B6B',
  },
  actionBtnTextBlue: {
    color: '#4A90D9',
  },
  editBtn: {
    borderColor: Colors.primary + '40',
    backgroundColor: Colors.primary + '10',
    flex: 1,
    justifyContent: 'center',
  },
  publishBtn: {
    borderColor: '#00C48C40',
    backgroundColor: '#00C48C10',
    flex: 1,
    justifyContent: 'center',
  },
  unpublishBtn: {
    borderColor: '#FF6B6B40',
    backgroundColor: '#FF6B6B10',
    flex: 1,
    justifyContent: 'center',
  },
  archiveBtn: {
    borderColor: '#FFB80040',
    backgroundColor: '#FFB80010',
    paddingHorizontal: 10,
  },
  photoBtn: {
    borderColor: '#4A90D940',
    backgroundColor: '#4A90D910',
    paddingHorizontal: 8,
  },
  restoreBtn: {
    borderColor: '#00C48C40',
    backgroundColor: '#00C48C10',
    flex: 1,
    justifyContent: 'center' as const,
  },
  permDeleteBtn: {
    borderColor: '#FF4D4D40',
    backgroundColor: '#FF4D4D10',
    flex: 1,
    justifyContent: 'center' as const,
  },
  bottomSpacer: {
    height: 100,
  },
  deleteOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 24,
  },
  deleteModal: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    width: '100%' as const,
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#FF4D4D30',
  },
  deleteIconWrap: {
    alignSelf: 'center' as const,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FF4D4D15',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 16,
  },
  photoIconWrap: {
    backgroundColor: '#4A90D915',
  },
  deleteModalTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
    textAlign: 'center' as const,
    marginBottom: 8,
  },
  deleteModalSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center' as const,
    lineHeight: 18,
    marginBottom: 12,
  },
  deleteModalDealName: {
    color: '#FF4D4D',
    fontSize: 16,
    fontWeight: '800' as const,
    textAlign: 'center' as const,
    marginBottom: 16,
    letterSpacing: 0.5,
  },
  deleteConfirmInput: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14,
    color: Colors.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#FF4D4D40',
    textAlign: 'center' as const,
    marginBottom: 20,
  },
  photoUrlsInput: {
    textAlign: 'left' as const,
    minHeight: 120,
    borderColor: '#4A90D940',
  },
  deleteModalActions: {
    flexDirection: 'row' as const,
    gap: 12,
  },
  deleteModalCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.backgroundSecondary,
    alignItems: 'center' as const,
  },
  deleteModalCancelText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  deleteModalConfirm: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#FF4D4D',
    alignItems: 'center' as const,
  },
  deleteModalConfirmDisabled: {
    opacity: 0.4,
  },
  deleteModalConfirmText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700' as const,
  },
  photoConfirmBtn: {
    backgroundColor: '#4A90D9',
  },
  galleryUploadBtnModal: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: '#4A90D9',
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 4,
  },
  galleryUploadBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700' as const,
  },
  photoOrDivider: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    marginVertical: 10,
  },
  photoOrLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.surfaceBorder,
  },
  photoOrText: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  photoSectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginTop: 14,
    marginBottom: 6,
  },
  photoCountBadge: {
    backgroundColor: '#4A90D920',
    color: '#4A90D9',
    fontSize: 12,
    fontWeight: '700' as const,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden' as const,
  },
  editPhotosSection: {
    gap: 10,
  },
  photoGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  photoGridItem: {
    width: (Dimensions.get('window').width - 32 - 18) / 4,
    height: (Dimensions.get('window').width - 32 - 18) / 4,
    borderRadius: 8,
    overflow: 'hidden' as const,
    position: 'relative' as const,
    backgroundColor: Colors.surface,
  },
  photoGridImage: {
    width: '100%' as const,
    height: '100%' as const,
  },
  photoGridImageUploading: {
    opacity: 0.5,
  },
  photoGridRemoveBtn: {
    position: 'absolute' as const,
    top: 3,
    right: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  photoGridIndex: {
    position: 'absolute' as const,
    bottom: 3,
    left: 3,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  photoGridIndexText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700' as const,
  },
  photoUploadOverlayInline: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  photoPendingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  photoGridAddBtn: {
    width: (Dimensions.get('window').width - 32 - 18) / 4,
    height: (Dimensions.get('window').width - 32 - 18) / 4,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#4A90D940',
    borderStyle: 'dashed' as const,
    backgroundColor: '#4A90D908',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 4,
  },
  photoGridAddText: {
    color: '#4A90D9',
    fontSize: 10,
    fontWeight: '600' as const,
  },
  editPhotosEmpty: {
    alignItems: 'center' as const,
    paddingVertical: 20,
    gap: 8,
  },
  editPhotosEmptyText: {
    color: Colors.textTertiary,
    fontSize: 12,
    textAlign: 'center' as const,
  },
  uploadToast: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    backgroundColor: '#1a1a2e',
    paddingTop: Platform.OS === 'ios' ? 50 : 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#4A90D930',
  },
  uploadToastContent: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    marginBottom: 6,
  },
  uploadToastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600' as const,
  },
  uploadToastBarBg: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    overflow: 'hidden' as const,
  },
  uploadToastBarFill: {
    height: 3,
    backgroundColor: '#4A90D9',
    borderRadius: 2,
  },
  modalSafe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  modalTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700' as const,
  },
  modalSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  modalSaveBtnText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '700' as const,
  },
  keyboardAvoid: {
    flex: 1,
  },
  modalBody: {
    flex: 1,
    padding: 16,
  },
  fieldLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const,
    marginBottom: 6,
    marginTop: 14,
  },
  fieldInput: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    color: Colors.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  fieldTextarea: {
    minHeight: 100,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 12,
  },
  fieldHalf: {
    flex: 1,
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  typeChipActive: {
    backgroundColor: Colors.primary + '20',
    borderColor: Colors.primary,
  },
  typeChipText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  typeChipTextActive: {
    color: Colors.primary,
  },
  modalBottomSpacer: {
    height: 60,
  },
  reorderToggleBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  reorderBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.primary + '15',
    borderBottomWidth: 1,
    borderBottomColor: Colors.primary + '30',
  },
  reorderBarLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  reorderBarText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  reorderBarActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  },
  reorderCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  reorderCancelText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  reorderSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.primary,
  },
  reorderSaveBtnDisabled: {
    opacity: 0.4,
  },
  reorderSaveText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '700' as const,
  },
  dealCardReorder: {
    borderColor: Colors.primary + '30',
  },
  reorderControls: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  reorderPositionBadge: {
    backgroundColor: Colors.primary + '20',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
  },
  reorderPositionText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '800' as const,
  },
  reorderBtns: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  reorderMoveBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.backgroundSecondary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  reorderMoveBtnDisabled: {
    opacity: 0.35,
  },
  inlineReorderRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'flex-end' as const,
    marginBottom: 8,
    marginTop: -2,
  },
  inlineReorderBtns: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 2,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  inlineArrowBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  inlineArrowBtnDisabled: {
    opacity: 0.3,
  },
  inlinePositionText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700' as const,
    minWidth: 24,
    textAlign: 'center' as const,
  },
  positionInputWrap: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
  },
  positionInput: {
    width: 36,
    height: 28,
    borderRadius: 6,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700' as const,
    textAlign: 'center' as const,
    paddingVertical: 0,
    paddingHorizontal: 4,
  },
  positionGoBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#00C48C',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  positionBadgeTap: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  trustSectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginTop: 20,
    marginBottom: 12,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
  },
  trustSectionTitle: {
    color: '#00C48C',
    fontSize: 15,
    fontWeight: '700' as const,
  },
  trustToggles: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
    marginBottom: 16,
  },
  trustToggle: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  trustToggleActive: {
    borderColor: '#00C48C',
    backgroundColor: '#00C48C18',
  },
  trustToggleText: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  trustToggleTextActive: {
    color: '#00C48C',
  },
});
