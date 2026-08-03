import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
  Image} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import {
  ArrowLeft,
  Star,
  Trash2,
  Archive,
  Reply,
  Forward,
  Paperclip,
  Flag,
  Mail,
  Download,
  FileText,
  CircleAlert,
  ChevronDown,
  ChevronUp,
  ImageIcon,
  Video,
  File} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useEmail } from '@/lib/email-context';
import { EmailAttachment } from '@/types/email';

function formatFullDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'});
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getAttachmentIcon(att: EmailAttachment) {
  const mime = att.mimeType ?? '';
  if (mime.startsWith('image/') || att.type === 'image') return ImageIcon;
  if (mime.startsWith('video/') || att.type === 'video') return Video;
  if (mime === 'application/pdf' || att.type === 'document') return FileText;
  return File;
}

function getAttachmentColor(att: EmailAttachment) {
  const mime = att.mimeType ?? '';
  if (mime.startsWith('image/') || att.type === 'image') return '#4A90D9';
  if (mime.startsWith('video/') || att.type === 'video') return '#E74C3C';
  if (mime === 'application/pdf' || att.type === 'document') return '#E67E22';
  return Colors.textSecondary;
}

function isImageAttachment(att: EmailAttachment): boolean {
  return (att.mimeType?.startsWith('image/') || att.type === 'image') && !!att.uri;
}

function isVideoAttachment(att: EmailAttachment): boolean {
  return att.mimeType?.startsWith('video/') || att.type === 'video';
}

export default function EmailDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    getEmailById,
    markAsRead,
    toggleStar,
    toggleFlag,
    deleteEmail,
    moveToFolder,
    activeAccount} = useEmail();

  const email = useMemo(() => getEmailById(id ?? ''), [getEmailById, id]);
  const [showDetails, setShowDetails] = React.useState(false);

  React.useEffect(() => {
    if (email && !email.isRead) {
      markAsRead(email.id);
    }
  }, [email, markAsRead]);

  const handleReply = useCallback(() => {
    if (!email) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/email-compose?replyTo=${email.id}` as any);
  }, [email, router]);

  const handleForward = useCallback(() => {
    if (!email) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/email-compose?forwardFrom=${email.id}` as any);
  }, [email, router]);

  const handleDelete = useCallback(() => {
    if (!email) return;
    Alert.alert(
      'Delete Email',
      email.folder === 'trash'
        ? 'Permanently delete this email?'
        : 'Move this email to trash?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteEmail(email.id);
            router.back();
          }},
      ]
    );
  }, [email, deleteEmail, router]);

  const handleArchive = useCallback(() => {
    if (!email) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    moveToFolder(email.id, 'archive');
    router.back();
  }, [email, moveToFolder, router]);

  const handleToggleStar = useCallback(() => {
    if (!email) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleStar(email.id);
  }, [email, toggleStar]);

  const handleToggleFlag = useCallback(() => {
    if (!email) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleFlag(email.id);
  }, [email, toggleFlag]);

  const handleDownloadAttachment = useCallback((att: EmailAttachment) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Download', `"${att.name}" would be saved to your device.`);
  }, []);

  if (!email) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerButton} onPress={() => router.back()}>
              <ArrowLeft size={22} color={Colors.text} strokeWidth={1.8} />
            </TouchableOpacity>
          </View>
          <View style={styles.notFoundState}>
            <Mail size={48} color={Colors.textTertiary} strokeWidth={1.2} />
            <Text style={styles.notFoundText}>Email not found</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const isPriority = email.priority === 'high';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} onPress={() => router.back()} testID="email-detail-back">
            <ArrowLeft size={22} color={Colors.text} strokeWidth={1.8} />
          </TouchableOpacity>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.headerButton} onPress={handleArchive}>
              <Archive size={20} color={Colors.text} strokeWidth={1.8} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerButton} onPress={handleDelete}>
              <Trash2 size={20} color={Colors.text} strokeWidth={1.8} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerButton} onPress={handleToggleFlag}>
              <Flag
                size={20}
                color={email.isFlagged ? Colors.warning : Colors.text}
                fill={email.isFlagged ? Colors.warning : 'none'}
                strokeWidth={1.8}
              />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerButton} onPress={handleToggleStar}>
              <Star
                size={20}
                color={email.isStarred ? Colors.primary : Colors.text}
                fill={email.isStarred ? Colors.primary : 'none'}
                strokeWidth={1.8}
              />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView style={styles.body} showsVerticalScrollIndicator={false} contentContainerStyle={styles.bodyContent}>
          <View style={styles.subjectRow}>
            {isPriority && (
              <View style={styles.priorityBadge}>
                <CircleAlert size={12} color={Colors.error} strokeWidth={2.5} />
                <Text style={styles.priorityText}>High Priority</Text>
              </View>
            )}
            <Text style={styles.subject}>{email.subject}</Text>
            {email.labels && email.labels.length > 0 && (
              <View style={styles.labelRow}>
                {email.labels.map(label => (
                  <View
                    key={label}
                    style={[
                      styles.labelBadge,
                      label === 'urgent' && { backgroundColor: 'rgba(255,77,77,0.15)' },
                      label === 'important' && { backgroundColor: 'rgba(255,184,0,0.15)' },
                      label === 'follow-up' && { backgroundColor: 'rgba(74,144,217,0.15)' },
                      label === 'internal' && { backgroundColor: 'rgba(0,196,140,0.15)' },
                      label === 'external' && { backgroundColor: 'rgba(155,89,182,0.15)' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.labelText,
                        label === 'urgent' && { color: Colors.error },
                        label === 'important' && { color: Colors.warning },
                        label === 'follow-up' && { color: Colors.info },
                        label === 'internal' && { color: Colors.success },
                        label === 'external' && { color: '#9B59B6' },
                      ]}
                    >
                      {label}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.senderSection}>
            <View style={styles.senderAvatar}>
              <Text style={styles.senderAvatarText}>{email.from.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.senderInfo}>
              <View style={styles.senderNameRow}>
                <Text style={styles.senderName}>{email.from.name}</Text>
                <Text style={styles.emailTime}>{formatFullDate(email.date)}</Text>
              </View>
              <Text style={styles.senderEmail}>{email.from.email}</Text>
              <TouchableOpacity
                style={styles.recipientToggle}
                onPress={() => setShowDetails(!showDetails)}
              >
                <Text style={styles.recipientLabel}>
                  to {email.to.map(t => t.name || t.email).join(', ')}
                </Text>
                {showDetails
                  ? <ChevronUp size={14} color={Colors.textTertiary} strokeWidth={2} />
                  : <ChevronDown size={14} color={Colors.textTertiary} strokeWidth={2} />
                }
              </TouchableOpacity>
            </View>
          </View>

          {showDetails && (
            <View style={styles.detailsSection}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>From:</Text>
                <Text style={styles.detailValue}>{email.from.name} {'<'}{email.from.email}{'>'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>To:</Text>
                <Text style={styles.detailValue}>
                  {email.to.map(t => `${t.name} <${t.email}>`).join(', ')}
                </Text>
              </View>
              {email.cc && email.cc.length > 0 && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>CC:</Text>
                  <Text style={styles.detailValue}>
                    {email.cc.map(t => `${t.name} <${t.email}>`).join(', ')}
                  </Text>
                </View>
              )}
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Date:</Text>
                <Text style={styles.detailValue}>{formatFullDate(email.date)}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Account:</Text>
                <Text style={styles.detailValue}>{activeAccount.email}</Text>
              </View>
            </View>
          )}

          <View style={styles.emailBody}>
            <Text style={styles.bodyText}>{email.body}</Text>
          </View>

          {email.hasAttachments && email.attachments && email.attachments.length > 0 && (
            <View style={styles.attachmentsSection}>
              <View style={styles.attachmentsHeader}>
                <Paperclip size={16} color={Colors.textSecondary} strokeWidth={2} />
                <Text style={styles.attachmentsTitle}>
                  {email.attachments.length} Attachment{email.attachments.length > 1 ? 's' : ''}
                </Text>
                <Text style={styles.attachmentsTotalSize}>
                  {formatFileSize(email.attachments.reduce((s, a) => s + a.size, 0))}
                </Text>
              </View>

              {email.attachments.some(a => isImageAttachment(a)) && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.imageAttachmentsScroll}
                >
                  {email.attachments.filter(isImageAttachment).map(att => (
                    <TouchableOpacity
                      key={att.id}
                      style={styles.imagePreviewCard}
                      activeOpacity={0.85}
                      onPress={() => handleDownloadAttachment(att)}
                    >
                      <Image source={{ uri: att.uri }} style={styles.imagePreview} />
                      <View style={styles.imagePreviewOverlay}>
                        <Text style={styles.imagePreviewName} numberOfLines={1}>{att.name}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              {email.attachments.filter(a => !isImageAttachment(a)).map(att => {
                const IconComp = getAttachmentIcon(att);
                const iconColor = getAttachmentColor(att);
                const isVid = isVideoAttachment(att);

                return (
                  <TouchableOpacity
                    key={att.id}
                    style={styles.attachmentRow}
                    activeOpacity={0.7}
                    onPress={() => handleDownloadAttachment(att)}
                  >
                    <View style={[styles.attachmentIcon, { backgroundColor: `${iconColor}15` }]}>
                      <IconComp size={20} color={iconColor} strokeWidth={1.8} />
                    </View>
                    <View style={styles.attachmentInfo}>
                      <Text style={styles.attachmentName} numberOfLines={1}>{att.name}</Text>
                      <View style={styles.attachmentMeta}>
                        <Text style={styles.attachmentSize}>{formatFileSize(att.size)}</Text>
                        {isVid && <Text style={styles.attachmentType}>Video</Text>}
                        {att.mimeType === 'application/pdf' && <Text style={styles.attachmentType}>PDF</Text>}
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.attachmentDownload}
                      onPress={() => handleDownloadAttachment(att)}
                    >
                      <Download size={18} color={Colors.textSecondary} strokeWidth={1.8} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </ScrollView>

        <View style={styles.actionBar}>
          <TouchableOpacity style={styles.actionButton} onPress={handleReply} testID="email-reply">
            <Reply size={20} color={Colors.primary} strokeWidth={1.8} />
            <Text style={styles.actionButtonText}>Reply</Text>
          </TouchableOpacity>
          <View style={styles.actionDivider} />
          <TouchableOpacity style={styles.actionButton} onPress={handleForward} testID="email-forward">
            <Forward size={20} color={Colors.primary} strokeWidth={1.8} />
            <Text style={styles.actionButtonText}>Forward</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
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
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center'},
  headerActions: {
    flexDirection: 'row',
    gap: 2},
  body: {
    flex: 1},
  bodyContent: {
    paddingBottom: 20},
  subjectRow: {
    padding: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border},
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8},
  priorityText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.error,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  subject: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text,
    lineHeight: 28},
  labelRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
    flexWrap: 'wrap'},
  labelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4},
  labelText: {
    fontSize: 11,
    fontWeight: '600' as const,
    textTransform: 'capitalize' as const},
  senderSection: {
    flexDirection: 'row',
    padding: 20,
    paddingBottom: 16,
    gap: 12},
  senderAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,215,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center'},
  senderAvatarText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.primary},
  senderInfo: {
    flex: 1,
    gap: 2},
  senderNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start'},
  senderName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    flex: 1},
  emailTime: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginLeft: 8},
  senderEmail: {
    fontSize: 13,
    color: Colors.textSecondary},
  recipientToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2},
  recipientLabel: {
    fontSize: 12,
    color: Colors.textTertiary},
  detailsSection: {
    marginHorizontal: 20,
    padding: 14,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    gap: 8,
    marginBottom: 4},
  detailRow: {
    flexDirection: 'row',
    gap: 8},
  detailLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    width: 60},
  detailValue: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1},
  emailBody: {
    padding: 20},
  bodyText: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 24},
  attachmentsSection: {
    marginHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 16},
  attachmentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12},
  attachmentsTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    flex: 1},
  attachmentsTotalSize: {
    fontSize: 12,
    color: Colors.textTertiary},
  imageAttachmentsScroll: {
    gap: 10,
    marginBottom: 12},
  imagePreviewCard: {
    width: 160,
    height: 120,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Colors.surface},
  imagePreview: {
    width: 160,
    height: 120,
    borderRadius: 12},
  imagePreviewOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12},
  imagePreviewName: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: '#fff'},
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 12},
  attachmentIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'},
  attachmentInfo: {
    flex: 1,
    gap: 2},
  attachmentName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text},
  attachmentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  attachmentSize: {
    fontSize: 11,
    color: Colors.textTertiary},
  attachmentType: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    backgroundColor: Colors.backgroundTertiary,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden'},
  attachmentDownload: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.backgroundTertiary,
    alignItems: 'center',
    justifyContent: 'center'},
  actionBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
    paddingVertical: 8,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 4 : 8},
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 8},
  actionButtonText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.primary},
  actionDivider: {
    width: 1,
    backgroundColor: Colors.border,
    marginVertical: 4},
  notFoundState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12},
  notFoundText: {
    fontSize: 16,
    color: Colors.textTertiary}});
