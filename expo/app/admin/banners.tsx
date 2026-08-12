import React, { useState, useCallback } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  Modal,
  Switch} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Plus,
  X,
  Edit3,
  Trash2,
  Eye,
  EyeOff,
  Link,
  Calendar,
  ChevronDown,
  Check,
  ExternalLink,
  ArrowLeft} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { IVXImage } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import { EmptyState } from '@/components/ivx';

interface Banner {
  id: string;
  title: string;
  imageUrl: string;
  linkUrl: string;
  linkType: 'internal' | 'external';
  targetScreen?: string;
  isActive: boolean;
  priority: number;
  startDate: string;
  endDate: string;
  impressions: number;
  clicks: number;
  createdAt: string;
}

const INITIAL_BANNERS: Banner[] = [
  {
    id: '1',
    title: 'New Property Launch - Miami',
    imageUrl: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800',
    linkUrl: '/property/miami-001',
    linkType: 'internal',
    targetScreen: 'Property Details',
    isActive: true,
    priority: 1,
    startDate: '2026-01-01',
    endDate: '2026-02-28',
    impressions: 12540,
    clicks: 892,
    createdAt: '2025-12-28'},
  {
    id: '2',
    title: 'Refer & Earn $500',
    imageUrl: 'https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=800',
    linkUrl: '/referrals',
    linkType: 'internal',
    targetScreen: 'Referrals',
    isActive: true,
    priority: 2,
    startDate: '2026-01-15',
    endDate: '2026-03-15',
    impressions: 8320,
    clicks: 654,
    createdAt: '2025-12-30'},
  {
    id: '3',
    title: 'IVXHOLDINGS Token Sale Live',
    imageUrl: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=800',
    linkUrl: 'https://ipxholding.com/token',
    linkType: 'external',
    isActive: false,
    priority: 3,
    startDate: '2026-02-01',
    endDate: '2026-04-01',
    impressions: 0,
    clicks: 0,
    createdAt: '2026-01-20'},
];

const TARGET_SCREENS = [
  'Home',
  'Property Details',
  'Market',
  'Portfolio',
  'Referrals',
  'Profile',
  'KYC Verification',
  'Notifications',
];

export default function BannersScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [banners, setBanners] = useState<Banner[]>(INITIAL_BANNERS);
  const [showModal, setShowModal] = useState(false);
  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);
  const [showTargetPicker, setShowTargetPicker] = useState(false);

  const [formData, setFormData] = useState({
    title: '',
    imageUrl: '',
    linkUrl: '',
    linkType: 'internal' as 'internal' | 'external',
    targetScreen: '',
    startDate: '',
    endDate: ''});

  const resetForm = useCallback(() => {
    setFormData({
      title: '',
      imageUrl: '',
      linkUrl: '',
      linkType: 'internal',
      targetScreen: '',
      startDate: '',
      endDate: ''});
    setEditingBanner(null);
  }, []);

  const openAddModal = useCallback(() => {
    resetForm();
    setShowModal(true);
  }, [resetForm]);

  const openEditModal = useCallback((banner: Banner) => {
    setEditingBanner(banner);
    setFormData({
      title: banner.title,
      imageUrl: banner.imageUrl,
      linkUrl: banner.linkUrl,
      linkType: banner.linkType,
      targetScreen: banner.targetScreen || '',
      startDate: banner.startDate,
      endDate: banner.endDate});
    setShowModal(true);
  }, []);

  const saveBanner = useCallback(() => {
    if (!formData.title.trim() || !formData.imageUrl.trim()) {
      Alert.alert('Error', 'Please fill in title and image URL');
      return;
    }

    if (editingBanner) {
      setBanners(prev =>
        prev.map(b =>
          b.id === editingBanner.id
            ? {
                ...b,
                title: formData.title,
                imageUrl: formData.imageUrl,
                linkUrl: formData.linkUrl,
                linkType: formData.linkType,
                targetScreen: formData.targetScreen,
                startDate: formData.startDate,
                endDate: formData.endDate}
            : b
        )
      );
      Alert.alert('Success', 'Banner updated successfully');
    } else {
      const newBanner: Banner = {
        id: Date.now().toString(),
        title: formData.title,
        imageUrl: formData.imageUrl,
        linkUrl: formData.linkUrl,
        linkType: formData.linkType,
        targetScreen: formData.targetScreen,
        isActive: false,
        priority: banners.length + 1,
        startDate: formData.startDate,
        endDate: formData.endDate,
        impressions: 0,
        clicks: 0,
        createdAt: new Date().toISOString().split('T')[0]};
      setBanners(prev => [newBanner, ...prev]);
      Alert.alert('Success', 'Banner created successfully');
    }

    setShowModal(false);
    resetForm();
  }, [formData, editingBanner, banners.length, resetForm]);

  const toggleBannerActive = useCallback((bannerId: string) => {
    setBanners(prev =>
      prev.map(b =>
        b.id === bannerId ? { ...b, isActive: !b.isActive } : b
      )
    );
  }, []);

  const deleteBanner = useCallback((bannerId: string) => {
    Alert.alert(
      'Delete Banner',
      'Are you sure you want to delete this banner?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setBanners(prev => prev.filter(b => b.id !== bannerId));
          }},
      ]
    );
  }, []);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const getCTR = (clicks: number, impressions: number) => {
    if (impressions === 0) return '0%';
    return `${((clicks / impressions) * 100).toFixed(1)}%`;
  };

  const activeBanners = banners.filter(b => b.isActive).length;
  const totalImpressions = banners.reduce((sum, b) => sum + b.impressions, 0);
  const totalClicks = banners.reduce((sum, b) => sum + b.clicks, 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Banners</Text>
          <Text style={styles.subtitle}>Manage promotional banners</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={openAddModal}>
          <Plus size={20} color="#fff" />
          <Text style={styles.addBtnText}>Add</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{banners.length}</Text>
            <Text style={styles.statLabel}>Total Banners</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: Colors.positive }]}>{activeBanners}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: Colors.primary }]}>{formatNumber(totalImpressions)}</Text>
            <Text style={styles.statLabel}>Impressions</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{getCTR(totalClicks, totalImpressions)}</Text>
            <Text style={styles.statLabel}>Avg CTR</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>All Banners</Text>

        {banners.map((banner) => (
          <View key={banner.id} style={styles.bannerCard}>
            <View style={styles.bannerImageContainer}>
              <Image source={{ uri: banner.imageUrl }} style={styles.bannerImage} />
              <View style={[styles.statusBadge, { backgroundColor: banner.isActive ? Colors.positive + '20' : Colors.textTertiary + '20' }]}>
                {banner.isActive ? (
                  <Eye size={12} color={Colors.positive} />
                ) : (
                  <EyeOff size={12} color={Colors.textTertiary} />
                )}
                <Text style={[styles.statusText, { color: banner.isActive ? Colors.positive : Colors.textTertiary }]}>
                  {banner.isActive ? 'Live' : 'Draft'}
                </Text>
              </View>
            </View>

            <View style={styles.bannerContent}>
              <Text style={styles.bannerTitle}>{banner.title}</Text>
              
              <View style={styles.bannerMeta}>
                <View style={styles.metaItem}>
                  {banner.linkType === 'external' ? (
                    <ExternalLink size={12} color={Colors.textTertiary} />
                  ) : (
                    <Link size={12} color={Colors.textTertiary} />
                  )}
                  <Text style={styles.metaText} numberOfLines={1}>
                    {banner.linkType === 'internal' ? banner.targetScreen || 'No target' : 'External'}
                  </Text>
                </View>
                <View style={styles.metaItem}>
                  <Calendar size={12} color={Colors.textTertiary} />
                  <Text style={styles.metaText}>
                    {banner.startDate ? `${banner.startDate} - ${banner.endDate}` : 'No dates set'}
                  </Text>
                </View>
              </View>

              <View style={styles.bannerStats}>
                <View style={styles.statItem}>
                  <Text style={styles.statItemValue}>{formatNumber(banner.impressions)}</Text>
                  <Text style={styles.statItemLabel}>Views</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statItemValue}>{formatNumber(banner.clicks)}</Text>
                  <Text style={styles.statItemLabel}>Clicks</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statItemValue, { color: Colors.primary }]}>
                    {getCTR(banner.clicks, banner.impressions)}
                  </Text>
                  <Text style={styles.statItemLabel}>CTR</Text>
                </View>
              </View>

              <View style={styles.bannerActions}>
                <Switch
                  value={banner.isActive}
                  onValueChange={() => toggleBannerActive(banner.id)}
                  trackColor={{ false: Colors.border, true: Colors.positive + '40' }}
                  thumbColor={banner.isActive ? Colors.positive : Colors.textTertiary}
                />
                <TouchableOpacity style={styles.actionBtn} onPress={() => openEditModal(banner)}>
                  <Edit3 size={16} color={Colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => deleteBanner(banner.id)}>
                  <Trash2 size={16} color={Colors.negative} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}

        <View style={styles.bottomPadding} />
      </ScrollView>

      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingBanner ? 'Edit Banner' : 'New Banner'}
              </Text>
              <TouchableOpacity onPress={() => { setShowModal(false); resetForm(); }}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              <View style={styles.formGroup}>
                <Text style={styles.label}>Banner Title</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter banner title"
                  placeholderTextColor={Colors.textTertiary}
                  value={formData.title}
                  onChangeText={(text) => setFormData(prev => ({ ...prev, title: text }))}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Image URL</Text>
                <TextInput
                  style={styles.input}
                  placeholder="https://example.com/banner.jpg"
                  placeholderTextColor={Colors.textTertiary}
                  value={formData.imageUrl}
                  onChangeText={(text) => setFormData(prev => ({ ...prev, imageUrl: text }))}
                />
                {formData.imageUrl ? (
                  <Image source={{ uri: formData.imageUrl }} style={styles.previewImage} />
                ) : null}
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Link Type</Text>
                <View style={styles.linkTypeRow}>
                  <TouchableOpacity
                    style={[styles.linkTypeBtn, formData.linkType === 'internal' && styles.linkTypeBtnActive]}
                    onPress={() => setFormData(prev => ({ ...prev, linkType: 'internal' }))}
                  >
                    <Link size={16} color={formData.linkType === 'internal' ? Colors.primary : Colors.textSecondary} />
                    <Text style={[styles.linkTypeText, formData.linkType === 'internal' && styles.linkTypeTextActive]}>
                      Internal
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.linkTypeBtn, formData.linkType === 'external' && styles.linkTypeBtnActive]}
                    onPress={() => setFormData(prev => ({ ...prev, linkType: 'external' }))}
                  >
                    <ExternalLink size={16} color={formData.linkType === 'external' ? Colors.primary : Colors.textSecondary} />
                    <Text style={[styles.linkTypeText, formData.linkType === 'external' && styles.linkTypeTextActive]}>
                      External
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {formData.linkType === 'internal' ? (
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Target Screen</Text>
                  <TouchableOpacity
                    style={styles.pickerBtn}
                    onPress={() => setShowTargetPicker(true)}
                  >
                    <Text style={formData.targetScreen ? styles.pickerValue : styles.pickerPlaceholder}>
                      {formData.targetScreen || 'Select target screen'}
                    </Text>
                    <ChevronDown size={18} color={Colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.formGroup}>
                  <Text style={styles.label}>External URL</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="https://example.com"
                    placeholderTextColor={Colors.textTertiary}
                    value={formData.linkUrl}
                    onChangeText={(text) => setFormData(prev => ({ ...prev, linkUrl: text }))}
                  />
                </View>
              )}

              <View style={styles.dateRow}>
                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.label}>Start Date</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={Colors.textTertiary}
                    value={formData.startDate}
                    onChangeText={(text) => setFormData(prev => ({ ...prev, startDate: text }))}
                  />
                </View>
                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.label}>End Date</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={Colors.textTertiary}
                    value={formData.endDate}
                    onChangeText={(text) => setFormData(prev => ({ ...prev, endDate: text }))}
                  />
                </View>
              </View>

              <TouchableOpacity style={styles.saveBtn} onPress={saveBanner}>
                <Text style={styles.saveBtnText}>
                  {editingBanner ? 'Update Banner' : 'Create Banner'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showTargetPicker} animationType="fade" transparent>
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowTargetPicker(false)}
        >
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>Select Target Screen</Text>
            {TARGET_SCREENS.map((screen) => (
              <TouchableOpacity
                key={screen}
                style={[styles.pickerItem, formData.targetScreen === screen && styles.pickerItemActive]}
                onPress={() => {
                  setFormData(prev => ({ ...prev, targetScreen: screen }));
                  setShowTargetPicker(false);
                }}
              >
                <Text style={[
                  styles.pickerItemText,
                  formData.targetScreen === screen && styles.pickerItemTextActive,
                ]}>
                  {screen}
                </Text>
                {formData.targetScreen === screen && <Check size={18} color={Colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
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
  addBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  addBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  content: { flex: 1, paddingHorizontal: 20 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  bannerCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  bannerImageContainer: { gap: 8 },
  bannerImage: { width: '100%', height: 180, borderRadius: 12 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { color: Colors.textSecondary, fontSize: 13 },
  bannerContent: { flex: 1, gap: 4 },
  bannerTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  bannerMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaItem: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  metaText: { color: Colors.textSecondary, fontSize: 13 },
  bannerStats: { flexDirection: 'row', gap: 8, marginTop: 10 },
  statItem: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statItemValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  statItemLabel: { color: Colors.textSecondary, fontSize: 13 },
  bannerActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  bottomPadding: { height: 120 },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  modalScroll: { maxHeight: 400 },
  formGroup: { gap: 6, marginBottom: 12 },
  label: { color: Colors.textSecondary, fontSize: 13 },
  input: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  previewImage: { width: '100%', height: 180, borderRadius: 12 },
  linkTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  linkTypeBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  linkTypeBtnActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  linkTypeText: { color: Colors.textSecondary, fontSize: 13 },
  linkTypeTextActive: { color: '#000' },
  pickerBtn: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder },
  pickerValue: { color: Colors.text, fontSize: 16 },
  pickerPlaceholder: { color: Colors.textTertiary, fontSize: 16 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  pickerOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  pickerContent: { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '60%' },
  pickerTitle: { color: Colors.text, fontSize: 18, fontWeight: '700' as const, marginBottom: 16, textAlign: 'center' },
  pickerItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  pickerItemActive: { backgroundColor: Colors.primary + '10' },
  pickerItemText: { color: Colors.text, fontSize: 16 },
  pickerItemTextActive: { color: Colors.primary, fontWeight: '600' as const }});
