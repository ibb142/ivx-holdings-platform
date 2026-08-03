/**
 * AdminMediaUpload — Owner Controls for Project Media
 *
 * Allows admin/owner to:
 * - Upload photos and videos for projects
 * - Replace video cover image
 * - Pin/unpin best video
 * - Approve/remove comments
 * - View per-project analytics
 */
import React, { memo, useCallback, useEffect, useState } from 'react';
import {View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Image,
  FlatList} from "react-native";
import {
  Upload,
  Image as ImageIcon,
  Video,
  Pin,
  Trash2,
  CheckCircle2,
  XCircle,
  BarChart3,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
  RefreshCw,
  ShieldCheck} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  uploadProjectMedia,
  deleteProjectMedia,
  pinProjectVideo,
  fetchProjectMedia,
  approveProjectComment,
  fetchProjectComments,
  deleteProjectComment,
  getProjectAnalytics,
  type ProjectMedia,
  type ProjectVideo,
  type ProjectComment,
  type ProjectAnalytics} from '@/lib/project-engagement';

const GOLD = '#FFD700';
const SURFACE_ELEVATED = '#181818';
const ACCENT_GREEN = '#00E676';
const ACCENT_RED = '#FF4D4D';

interface AdminMediaUploadProps {
  projectId: string;
  projectTitle: string;
}

const AdminMediaUpload = memo(function AdminMediaUpload({
  projectId,
  projectTitle}: AdminMediaUploadProps) {
  const [media, setMedia] = useState<ProjectMedia[]>([]);
  const [videos, setVideos] = useState<ProjectVideo[]>([]);
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [analytics, setAnalytics] = useState<ProjectAnalytics[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(true);
  const [loadingComments, setLoadingComments] = useState(true);
  const [selectedTab, setSelectedTab] = useState<'media' | 'comments' | 'analytics'>('media');

  const loadData = useCallback(async () => {
    setLoadingMedia(true);
    try {
      const result = await fetchProjectMedia(projectId);
      setMedia(result.images);
      setVideos(result.videos);
    } catch {} finally {
      setLoadingMedia(false);
    }

    setLoadingComments(true);
    try {
      const { comments: cmts } = await fetchProjectComments(projectId, 50, 0);
      setComments(cmts);
    } catch {} finally {
      setLoadingComments(false);
    }

    try {
      const anal = await getProjectAnalytics(projectId, 30);
      setAnalytics(anal);
    } catch {}
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handlePickMedia = useCallback(async (mediaType: 'image' | 'video') => {
    try {
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: mediaType === 'video' ? ImagePicker.MediaTypeOptions.Videos : ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        allowsEditing: false,
        videoMaxDuration: 120};

      const result = mediaType === 'video'
        ? await ImagePicker.launchImageLibraryAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

      if (result.canceled || !result.assets?.[0]) return;

      setIsUploading(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const asset = result.assets[0];
      const uploadResult = await uploadProjectMedia(projectId, asset.uri, mediaType, projectTitle);

      if (uploadResult.success) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await loadData();
      } else {
        Alert.alert('Upload Failed', uploadResult.error || 'Unknown error');
      }
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    } finally {
      setIsUploading(false);
    }
  }, [projectId, projectTitle, loadData]);

  const handleDeleteMedia = useCallback(async (mediaId: string) => {
    Alert.alert('Delete Media', 'Are you sure you want to delete this?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteProjectMedia(mediaId);
          await loadData();
        }},
    ]);
  }, [loadData]);

  const handlePinVideo = useCallback(async (videoId: string) => {
    await pinProjectVideo(videoId, projectId);
    await loadData();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [projectId, loadData]);

  const handleApproveComment = useCallback(async (commentId: string, approved: boolean) => {
    await approveProjectComment(commentId, approved);
    await loadData();
  }, [loadData]);

  const handleDeleteComment = useCallback(async (commentId: string) => {
    await deleteProjectComment(commentId);
    await loadData();
  }, [loadData]);

  const totalAggregate = analytics.reduce((acc, a) => ({
    likes: acc.likes + a.like_count,
    comments: acc.comments + a.comment_count,
    shares: acc.shares + a.share_count,
    saves: acc.saves + a.save_count,
    views: acc.views + a.video_views,
    invests: acc.invests + a.invest_clicks}), { likes: 0, comments: 0, shares: 0, saves: 0, views: 0, invests: 0 });

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Media Manager</Text>
        <TouchableOpacity onPress={loadData} testID="refresh-media">
          <RefreshCw size={18} color={GOLD} />
        </TouchableOpacity>
      </View>

      {/* Upload Buttons */}
      <View style={styles.uploadRow}>
        <TouchableOpacity
          style={styles.uploadBtn}
          onPress={() => handlePickMedia('image')}
          disabled={isUploading}
          testID="upload-photo"
        >
          {isUploading ? (
            <ShimmerIndicator size="small" color={GOLD} />
          ) : (
            <ImageIcon size={20} color={GOLD} />
          )}
          <Text style={styles.uploadBtnText}>Photo</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.uploadBtn}
          onPress={() => handlePickMedia('video')}
          disabled={isUploading}
          testID="upload-video"
        >
          <Video size={20} color={GOLD} />
          <Text style={styles.uploadBtnText}>Video</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['media', 'comments', 'analytics'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, selectedTab === tab && styles.tabActive]}
            onPress={() => setSelectedTab(tab)}
          >
            <Text style={[styles.tabText, selectedTab === tab && styles.tabTextActive]}>
              {tab === 'media' ? 'Media' : tab === 'comments' ? 'Comments' : 'Analytics'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Media Tab ───────────────────────────────────────────────── */}
      {selectedTab === 'media' && (
        <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
          {loadingMedia ? (
            <ShimmerIndicator size="small" color={GOLD} style={{ marginTop: 20 }} />
          ) : (
            <>
              {/* Videos */}
              {videos.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Videos ({videos.length})</Text>
                  {videos.map((vid) => (
                    <View key={vid.id} style={styles.mediaItem}>
                      <View style={styles.mediaPreview}>
                        {vid.thumbnail_url ? (
                          <Image source={{ uri: vid.thumbnail_url }} style={styles.thumb} />
                        ) : (
                          <View style={styles.thumbPlaceholder}>
                            <Video size={24} color={Colors.textTertiary} />
                          </View>
                        )}
                      </View>
                      <View style={styles.mediaInfo}>
                        <Text style={styles.mediaTitle} numberOfLines={1}>
                          {vid.title || 'Untitled Video'}
                        </Text>
                        <Text style={styles.mediaMeta}>
                          {vid.duration_sec > 0 ? `${Math.floor(vid.duration_sec)}s` : 'N/A'} · {vid.orientation}
                        </Text>
                        <View style={styles.mediaActions}>
                          <TouchableOpacity
                            onPress={() => handlePinVideo(vid.id)}
                            style={[styles.mediaActionBtn, vid.is_pinned && styles.mediaActionBtnActive]}
                          >
                            <Pin size={14} color={vid.is_pinned ? GOLD : Colors.textSecondary} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleDeleteMedia(vid.media_id || vid.id)}
                            style={styles.mediaActionBtn}
                          >
                            <Trash2 size={14} color={ACCENT_RED} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Photos */}
              {media.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Photos ({media.length})</Text>
                  <View style={styles.photoGrid}>
                    {media.map((item) => (
                      <View key={item.id} style={styles.photoItem}>
                        <Image source={{ uri: item.url }} style={styles.photoThumb} />
                        <TouchableOpacity
                          style={styles.photoDeleteBtn}
                          onPress={() => handleDeleteMedia(item.id)}
                        >
                          <Trash2 size={12} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {videos.length === 0 && media.length === 0 && (
                <View style={styles.emptyState}>
                  <Upload size={32} color={Colors.textTertiary} />
                  <Text style={styles.emptyText}>No media uploaded yet</Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* ── Comments Tab ─────────────────────────────────────────────── */}
      {selectedTab === 'comments' && (
        <FlatList
          data={comments}
          keyExtractor={(item) => item.id}
          style={styles.tabContent}
          renderItem={({ item }) => (
            <View style={styles.commentItem}>
              <View style={styles.commentHeader}>
                <Text style={styles.commentAuthor}>{item.user_name || 'Investor'}</Text>
                <Text style={styles.commentTime}>{item.created_at.slice(0, 10)}</Text>
              </View>
              <Text style={styles.commentBody}>{item.body}</Text>
              <View style={styles.commentModRow}>
                <TouchableOpacity
                  onPress={() => handleApproveComment(item.id, !item.is_approved)}
                  style={styles.modBtn}
                >
                  {item.is_approved ? (
                    <XCircle size={14} color={ACCENT_RED} />
                  ) : (
                    <CheckCircle2 size={14} color={ACCENT_GREEN} />
                  )}
                  <Text style={[styles.modBtnText, { color: item.is_approved ? ACCENT_RED : ACCENT_GREEN }]}>
                    {item.is_approved ? 'Unapprove' : 'Approve'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDeleteComment(item.id)} style={styles.modBtn}>
                  <Trash2 size={14} color={ACCENT_RED} />
                  <Text style={[styles.modBtnText, { color: ACCENT_RED }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <MessageCircle size={32} color={Colors.textTertiary} />
              <Text style={styles.emptyText}>No comments yet</Text>
            </View>
          }
        />
      )}

      {/* ── Analytics Tab ────────────────────────────────────────────── */}
      {selectedTab === 'analytics' && (
        <ScrollView style={styles.tabContent}>
          {/* Aggregate Stats */}
          <View style={styles.analyticsGrid}>
            <View style={styles.analyticsCard}>
              <Eye size={18} color={ACCENT_GREEN} />
              <Text style={styles.analyticsValue}>{totalAggregate.views}</Text>
              <Text style={styles.analyticsLabel}>Video Views</Text>
            </View>
            <View style={styles.analyticsCard}>
              <Heart size={18} color="#FF4D4D" />
              <Text style={styles.analyticsValue}>{totalAggregate.likes}</Text>
              <Text style={styles.analyticsLabel}>Likes</Text>
            </View>
            <View style={styles.analyticsCard}>
              <MessageCircle size={18} color="#448AFF" />
              <Text style={styles.analyticsValue}>{totalAggregate.comments}</Text>
              <Text style={styles.analyticsLabel}>Comments</Text>
            </View>
            <View style={styles.analyticsCard}>
              <Share2 size={18} color="#E1306C" />
              <Text style={styles.analyticsValue}>{totalAggregate.shares}</Text>
              <Text style={styles.analyticsLabel}>Shares</Text>
            </View>
            <View style={styles.analyticsCard}>
              <Bookmark size={18} color={GOLD} />
              <Text style={styles.analyticsValue}>{totalAggregate.saves}</Text>
              <Text style={styles.analyticsLabel}>Saves</Text>
            </View>
            <View style={styles.analyticsCard}>
              <BarChart3 size={18} color={ACCENT_GREEN} />
              <Text style={styles.analyticsValue}>{totalAggregate.invests}</Text>
              <Text style={styles.analyticsLabel}>Invest Clicks</Text>
            </View>
          </View>

          {/* Daily Breakdown */}
          {analytics.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Daily Breakdown</Text>
              {analytics.slice(0, 14).map((day) => (
                <View key={day.date} style={styles.dayRow}>
                  <Text style={styles.dayDate}>{day.date.slice(5)}</Text>
                  <View style={styles.dayStats}>
                    <Text style={styles.dayStat}>👁 {day.video_views}</Text>
                    <Text style={styles.dayStat}>❤️ {day.like_count}</Text>
                    <Text style={styles.dayStat}>💬 {day.comment_count}</Text>
                    <Text style={styles.dayStat}>📤 {day.share_count}</Text>
                    <Text style={styles.dayStat}>💰 {day.invest_clicks}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
});

export default AdminMediaUpload;

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0D0D0D',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#222',
    overflow: 'hidden'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#222'},
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800' as const},
  uploadRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 12},
  uploadBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    backgroundColor: SURFACE_ELEVATED,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333'},
  uploadBtnText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const},
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#222'},
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center'},
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: GOLD},
  tabText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600' as const},
  tabTextActive: {
    color: GOLD},
  tabContent: {
    maxHeight: 400},
  section: {
    padding: 12},
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10},
  mediaItem: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: SURFACE_ELEVATED,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#222'},
  mediaPreview: {
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#000'},
  thumb: {
    width: 60,
    height: 60},
  thumbPlaceholder: {
    width: 60,
    height: 60,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center'},
  mediaInfo: {
    flex: 1,
    justifyContent: 'center'},
  mediaTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600' as const},
  mediaMeta: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 2},
  mediaActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6},
  mediaActionBtn: {
    padding: 4,
    borderRadius: 6},
  mediaActionBtnActive: {
    backgroundColor: GOLD + '15'},
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8},
  photoItem: {
    width: '30%',
    aspectRatio: 1,
    borderRadius: 8,
    overflow: 'hidden'},
  photoThumb: {
    width: '100%',
    height: '100%'},
  photoDeleteBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center'},
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8},
  emptyText: {
    color: Colors.textTertiary,
    fontSize: 13},
  // Comments
  commentItem: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A'},
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4},
  commentAuthor: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700' as const},
  commentTime: {
    color: Colors.textTertiary,
    fontSize: 11},
  commentBody: {
    color: Colors.text,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8},
  commentModRow: {
    flexDirection: 'row',
    gap: 12},
  modBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4},
  modBtnText: {
    fontSize: 12,
    fontWeight: '600' as const},
  // Analytics
  analyticsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
    gap: 8},
  analyticsCard: {
    width: '31%',
    backgroundColor: SURFACE_ELEVATED,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#222'},
  analyticsValue: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800' as const},
  analyticsLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '600' as const},
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A'},
  dayDate: {
    color: Colors.textSecondary,
    fontSize: 11,
    width: 50},
  dayStats: {
    flexDirection: 'row',
    gap: 8},
  dayStat: {
    color: Colors.textTertiary,
    fontSize: 11}});
