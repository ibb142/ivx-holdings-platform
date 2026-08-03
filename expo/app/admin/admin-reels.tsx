/**
 * Admin Reels Management — migrated from ios-ivx/Ivx/Views/AdminReelsView.swift
 *
 * Owner admin panel for managing project reels: add unlimited videos by URL,
 * toggle visibility, set type (reel/deal), feature, reorder, and delete.
 * No developer required: the owner opens this screen, pastes a video URL,
 * taps Add, and the reel goes live across iOS, Android, and web instantly.
 */
import React, { useState, useMemo, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  TextInput,
  Modal,
  Switch,
  FlatList} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router';
import {
  ArrowLeft,
  Plus,
  Eye,
  EyeOff,
  Star,
  Trash2,
  Clapperboard,
  TrendingUp,
  CheckCircle,
  XCircle,
  RefreshCw} from 'lucide-react-native';
import { Image } from 'expo-image';
import Colors from '@/constants/colors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  fetchAllVideos,
  addVideo,
  deleteVideo,
  toggleVideoVisibility,
  toggleVideoFeatured,
  type AdminVideo} from '@/lib/admin-reels';

export default function AdminReelsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');

  // Add reel form state
  const [newVideoUrl, setNewVideoUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<'reel' | 'deal'>('reel');
  const [newPosterUrl, setNewPosterUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addResult, setAddResult] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const videosQuery = useQuery({
    queryKey: ['admin-reels', filterType],
    queryFn: () => fetchAllVideos(filterType !== 'all' ? filterType : undefined),
    staleTime: 30_000});

  const videos = useMemo(() => videosQuery.data ?? [], [videosQuery.data]);

  const stats = useMemo(() => {
    const all = videos;
    return {
      total: all.length,
      reels: all.filter(v => v.video_type === 'reel').length,
      deals: all.filter(v => v.video_type === 'deal').length,
      hidden: all.filter(v => v.is_hidden).length,
      featured: all.filter(v => v.is_featured).length};
  }, [videos]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await videosQuery.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [videosQuery]);

  const handleAdd = useCallback(async () => {
    if (!newVideoUrl.trim() || !newTitle.trim()) {
      setAddError('Video URL and title are required');
      return;
    }
    setIsAdding(true);
    setAddError(null);
    setAddResult(null);
    try {
      const result = await addVideo({
        videoUrl: newVideoUrl.trim(),
        title: newTitle.trim(),
        videoType: newType,
        posterUrl: newPosterUrl.trim() || undefined});
      if (result.ok) {
        setAddResult(`Added: ${result.title || newTitle}`);
        setNewVideoUrl('');
        setNewTitle('');
        setNewPosterUrl('');
        setNewType('reel');
        queryClient.invalidateQueries({ queryKey: ['admin-reels'] });
        setTimeout(() => {
          setShowAddSheet(false);
          setAddResult(null);
        }, 1500);
      } else {
        setAddError(result.error || 'Failed to add video');
      }
    } catch (err) {
      setAddError((err as Error).message || 'Failed to add video');
    } finally {
      setIsAdding(false);
    }
  }, [newVideoUrl, newTitle, newType, newPosterUrl, queryClient]);

  const handleDelete = useCallback((video: AdminVideo) => {
    Alert.alert(
      'Delete Video',
      `Delete "${video.title || 'Untitled'}"? This removes it from all platforms.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteVideo(video.id);
              queryClient.invalidateQueries({ queryKey: ['admin-reels'] });
            } catch (err) {
              Alert.alert('Error', (err as Error).message);
            }
          }},
      ],
    );
  }, [queryClient]);

  const handleToggleVisibility = useCallback(async (video: AdminVideo) => {
    try {
      await toggleVideoVisibility(video.id, video.is_hidden);
      queryClient.invalidateQueries({ queryKey: ['admin-reels'] });
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    }
  }, [queryClient]);

  const handleToggleFeatured = useCallback(async (video: AdminVideo) => {
    try {
      await toggleVideoFeatured(video.id, video.is_featured);
      queryClient.invalidateQueries({ queryKey: ['admin-reels'] });
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    }
  }, [queryClient]);

  const renderVideo = useCallback(({ item: video }: { item: AdminVideo }) => (
    <View style={styles.videoCard}>
      <View style={styles.videoThumb}>
        {video.poster_url || video.thumbnail_url ? (
          <Image
            source={{ uri: video.poster_url || video.thumbnail_url || '' }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <Clapperboard size={24} color={Colors.textTertiary} />
          </View>
        )}
        <View style={[styles.typeBadge, video.video_type === 'reel' ? styles.reelBadge : styles.dealBadge]}>
          <Text style={styles.typeBadgeText}>{video.video_type === 'reel' ? 'REEL' : 'DEAL'}</Text>
        </View>
        {video.is_featured && (
          <View style={styles.featuredBadge}>
            <Star size={10} color={Colors.gold} fill={Colors.gold} />
          </View>
        )}
      </View>

      <View style={styles.videoInfo}>
        <Text style={styles.videoTitle} numberOfLines={2}>{video.title || 'Untitled'}</Text>
        <Text style={styles.videoMeta}>
          {video.is_hidden ? 'Hidden' : 'Visible'} · {video.is_featured ? 'Featured' : 'Standard'}
        </Text>
        <Text style={styles.videoDate}>
          {new Date(video.created_at).toLocaleDateString()}
        </Text>

        <View style={styles.videoActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleToggleVisibility(video)}
            testID={`toggle-vis-${video.id}`}
          >
            {video.is_hidden ? (
              <><EyeOff size={16} color={Colors.textTertiary} /><Text style={styles.actionBtnText}>Show</Text></>
            ) : (
              <><Eye size={16} color={Colors.success} /><Text style={styles.actionBtnText}>Hide</Text></>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleToggleFeatured(video)}
            testID={`toggle-feat-${video.id}`}
          >
            <Star
              size={16}
              color={video.is_featured ? Colors.gold : Colors.textTertiary}
              fill={video.is_featured ? Colors.gold : 'transparent'}
            />
            <Text style={styles.actionBtnText}>{video.is_featured ? 'Unfeature' : 'Feature'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.deleteBtn]}
            onPress={() => handleDelete(video)}
            testID={`delete-${video.id}`}
          >
            <Trash2 size={16} color={Colors.error} />
            <Text style={[styles.actionBtnText, { color: Colors.error }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  ), [handleDelete, handleToggleVisibility, handleToggleFeatured]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            testID="admin-reels-back"
          >
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Manage Reels</Text>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => setShowAddSheet(true)}
            testID="admin-reels-add"
          >
            <Plus size={24} color={Colors.gold} />
          </TouchableOpacity>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
            />
          }
        >
          {/* Sync Status — admin changes sync to app + landing page */}
          <View style={styles.syncBanner}>
            <RefreshCw size={14} color={Colors.success} />
            <Text style={styles.syncBannerText}>Changes sync instantly to app & landing page</Text>
          </View>

          {/* Stats Header */}
          <View style={styles.statsHeader}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.total}</Text>
              <Text style={styles.statLabel}>Total</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: Colors.gold }]}>{stats.reels}</Text>
              <Text style={styles.statLabel}>Reels</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: Colors.primary }]}>{stats.deals}</Text>
              <Text style={styles.statLabel}>Deals</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: stats.hidden > 0 ? Colors.error : Colors.text }]}>{stats.hidden}</Text>
              <Text style={styles.statLabel}>Hidden</Text>
            </View>
          </View>

          {/* Filter Bar */}
          <View style={styles.filterBar}>
            {['all', 'reel', 'deal'].map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.filterChip, filterType === type && styles.filterChipActive]}
                onPress={() => setFilterType(type)}
                testID={`filter-${type}`}
              >
                <Text style={[styles.filterChipText, filterType === type && styles.filterChipTextActive]}>
                  {type === 'all' ? 'All' : type === 'reel' ? 'Reels' : 'Deals'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Video List */}
          {videosQuery.isLoading ? (
            <View style={styles.centerState}>
              <ShimmerIndicator size="large" color={Colors.primary} />
              <Text style={styles.centerStateText}>Loading videos…</Text>
            </View>
          ) : videosQuery.isError ? (
            <View style={styles.centerState}>
              <XCircle size={32} color={Colors.error} />
              <Text style={styles.centerStateText}>Could not load videos</Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => videosQuery.refetch()}
                testID="admin-reels-retry"
              >
                <Text style={styles.retryBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : videos.length === 0 ? (
            <View style={styles.centerState}>
              <Clapperboard size={32} color={Colors.textTertiary} />
              <Text style={styles.centerStateTitle}>No videos yet</Text>
              <Text style={styles.centerStateText}>Tap + to add your first reel or deal video.</Text>
            </View>
          ) : (
            <FlatList
              data={videos}
              keyExtractor={(v) => v.id}
              renderItem={renderVideo}
              scrollEnabled={false}
              contentContainerStyle={styles.videoList}
            />
          )}

          <View style={{ height: 60 }} />
        </ScrollView>
      </SafeAreaView>

      {/* Add Reel Sheet */}
      <Modal
        visible={showAddSheet}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAddSheet(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New Video</Text>
              <TouchableOpacity onPress={() => setShowAddSheet(false)}>
                <XCircle size={24} color={Colors.textTertiary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalBody}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Video URL *</Text>
                  <TextInput
                    style={styles.textInput}
                    value={newVideoUrl}
                    onChangeText={setNewVideoUrl}
                    placeholder="https://..."
                    placeholderTextColor={Colors.textTertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="add-video-url"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Title *</Text>
                  <TextInput
                    style={styles.textInput}
                    value={newTitle}
                    onChangeText={setNewTitle}
                    placeholder="Property tour — Casa Rosario"
                    placeholderTextColor={Colors.textTertiary}
                    testID="add-video-title"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Type</Text>
                  <View style={styles.typeSelector}>
                    <TouchableOpacity
                      style={[styles.typeOption, newType === 'reel' && styles.typeOptionActive]}
                      onPress={() => setNewType('reel')}
                    >
                      <Clapperboard size={18} color={newType === 'reel' ? Colors.gold : Colors.textTertiary} />
                      <Text style={[styles.typeOptionText, newType === 'reel' && styles.typeOptionTextActive]}>Reel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.typeOption, newType === 'deal' && styles.typeOptionActive]}
                      onPress={() => setNewType('deal')}
                    >
                      <TrendingUp size={18} color={newType === 'deal' ? Colors.primary : Colors.textTertiary} />
                      <Text style={[styles.typeOptionText, newType === 'deal' && styles.typeOptionTextActive]}>Deal</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Poster URL (optional)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={newPosterUrl}
                    onChangeText={setNewPosterUrl}
                    placeholder="https://...jpg"
                    placeholderTextColor={Colors.textTertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="add-video-poster"
                  />
                </View>

                {addError && (
                  <View style={styles.resultBox}>
                    <XCircle size={18} color={Colors.error} />
                    <Text style={[styles.resultText, { color: Colors.error }]}>{addError}</Text>
                  </View>
                )}

                {addResult && (
                  <View style={styles.resultBox}>
                    <CheckCircle size={18} color={Colors.success} />
                    <Text style={[styles.resultText, { color: Colors.success }]}>{addResult}</Text>
                  </View>
                )}

                <TouchableOpacity
                  style={[styles.submitBtn, isAdding && styles.submitBtnDisabled]}
                  onPress={handleAdd}
                  disabled={isAdding}
                  testID="add-video-submit"
                >
                  {isAdding ? (
                    <ShimmerIndicator size="small" color="#000" />
                  ) : (
                    <Text style={styles.submitBtnText}>Add Video</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
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
    paddingVertical: 12},
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center'},
  headerTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const},
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center'},
  statsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    paddingVertical: 16,
    marginBottom: 8},
  statItem: {
    alignItems: 'center'},
  statValue: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: '900' as const},
  statLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '600' as const,
    marginTop: 2},
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 8,
    marginBottom: 4},
  syncBannerText: {
    color: Colors.success,
    fontSize: 12,
    fontWeight: '700' as const},
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 16,
    gap: 8},
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  filterChipText: {
    color: Colors.textTertiary,
    fontSize: 13,
    fontWeight: '600' as const},
  filterChipTextActive: {
    color: '#000',
    fontWeight: '800' as const},
  videoList: {
    paddingHorizontal: 20},
  videoCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 12,
    marginBottom: 10,
    gap: 12},
  // Instagram-style 9:16 vertical thumbnail (40.5 × 72)
  videoThumb: {
    width: 54,
    height: 96,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden'},
  thumbPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'},
  typeBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4},
  reelBadge: {
    backgroundColor: 'rgba(255,215,0,0.25)'},
  dealBadge: {
    backgroundColor: 'rgba(0,150,255,0.25)'},
  typeBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '900' as const,
    letterSpacing: 0.5},
  featuredBadge: {
    position: 'absolute',
    top: 4,
    right: 4},
  videoInfo: {
    flex: 1},
  videoTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
    marginBottom: 4},
  videoMeta: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '600' as const},
  videoDate: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 2},
  videoActions: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 12},
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4},
  actionBtnText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600' as const},
  deleteBtn: {
    marginLeft: 'auto'},
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12},
  centerStateTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800' as const},
  centerStateText: {
    color: Colors.textTertiary,
    fontSize: 14,
    textAlign: 'center'},
  retryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 10},
  retryBtnText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '800' as const},
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end'},
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%'},
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  modalTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const},
  modalBody: {
    padding: 20},
  inputGroup: {
    marginBottom: 16},
  inputLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600' as const,
    marginBottom: 6},
  textInput: {
    backgroundColor: Colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Colors.text,
    fontSize: 15},
  typeSelector: {
    flexDirection: 'row',
    gap: 10},
  typeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  typeOptionActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '15'},
  typeOptionText: {
    color: Colors.textTertiary,
    fontSize: 14,
    fontWeight: '600' as const},
  typeOptionTextActive: {
    color: Colors.text,
    fontWeight: '800' as const},
  resultBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16},
  resultText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600' as const},
  submitBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center'},
  submitBtnDisabled: {
    opacity: 0.6},
  submitBtnText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '800' as const}});
