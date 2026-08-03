/**
 * ProjectCommentsSheet — Instagram-Style Comments Bottom Sheet
 *
 * Shows comments with owner replies, input field, moderation controls.
 */
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Animated,
  useWindowDimensions} from "react-native";
import { X, Send, ShieldCheck, Trash2, Flag, MessageCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import type { ProjectComment } from '@/lib/project-engagement';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const GOLD = '#FFD700';
const SURFACE = '#141414';
const SURFACE_ELEVATED = '#1A1A1A';
const BORDER = '#2A2A2A';

interface CommentsSheetProps {
  projectId: string;
  visible: boolean;
  onClose: () => void;
  comments: ProjectComment[];
  isLoading: boolean;
  onAddComment: (projectId: string, body: string, parentId?: string) => void;
  onDeleteComment?: (commentId: string) => void;
  onReportComment?: (commentId: string) => void;
  totalComments: number;
}

function CommentItem({
  comment,
  onReply,
  onDelete,
  onReport,
  isOwner = false}: {
  comment: ProjectComment;
  onReply: (commentId: string) => void;
  onDelete?: (commentId: string) => void;
  onReport?: (commentId: string) => void;
  isOwner?: boolean;
}) {
  const timeAgo = getTimeAgo(comment.created_at);

  return (
    <View style={commentStyles.commentItem}>
      <View style={commentStyles.commentHeader}>
        <View style={commentStyles.commentAuthorRow}>
          <View style={[
            commentStyles.avatarPlaceholder,
            comment.is_owner_reply && commentStyles.avatarOwner,
          ]}>
            <Text style={commentStyles.avatarText}>
              {(comment.user_name || 'I').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={commentStyles.commentMeta}>
            <View style={commentStyles.nameRow}>
              <Text style={commentStyles.commentAuthor}>
                {comment.user_name || 'Investor'}
              </Text>
              {comment.is_owner_reply && (
                <View style={commentStyles.ownerBadge}>
                  <ShieldCheck size={10} color={GOLD} />
                  <Text style={commentStyles.ownerBadgeText}>IVX</Text>
                </View>
              )}
            </View>
            <Text style={commentStyles.commentTime}>{timeAgo}</Text>
          </View>
        </View>
        {(onDelete || onReport) && (
          <View style={commentStyles.commentActions}>
            {onDelete && (
              <TouchableOpacity
                onPress={() => onDelete(comment.id)}
                hitSlop={8}
                testID={`delete-comment-${comment.id}`}
              >
                <Trash2 size={13} color={Colors.textTertiary} />
              </TouchableOpacity>
            )}
            {onReport && (
              <TouchableOpacity
                onPress={() => onReport(comment.id)}
                hitSlop={8}
                testID={`report-comment-${comment.id}`}
              >
                <Flag size={13} color={Colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      <Text style={commentStyles.commentBody}>{comment.body}</Text>

      <TouchableOpacity
        onPress={() => onReply(comment.id)}
        style={commentStyles.replyBtn}
        testID={`reply-comment-${comment.id}`}
      >
        <Text style={commentStyles.replyBtnText}>Reply</Text>
      </TouchableOpacity>

      {comment.replies && comment.replies.length > 0 && (
        <View style={commentStyles.repliesContainer}>
          {comment.replies.map((reply) => (
            <View key={reply.id} style={commentStyles.replyItem}>
              <View style={commentStyles.replyHeader}>
                <Text style={commentStyles.replyAuthor}>
                  {reply.is_owner_reply ? 'IVX Team' : reply.user_name || 'Investor'}
                </Text>
                {reply.is_owner_reply && (
                  <View style={commentStyles.ownerBadge}>
                    <ShieldCheck size={9} color={GOLD} />
                    <Text style={[commentStyles.ownerBadgeText, { fontSize: 9 }]}>IVX</Text>
                  </View>
                )}
              </View>
              <Text style={commentStyles.replyBody}>{reply.body}</Text>
              <Text style={commentStyles.commentTime}>{getTimeAgo(reply.created_at)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function getTimeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = Math.floor((now - date) / 1000);

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 604800)}w`;
}

const ProjectCommentsSheet = memo(function ProjectCommentsSheet({
  projectId,
  visible,
  onClose,
  comments,
  isLoading,
  onAddComment,
  onDeleteComment,
  onReportComment,
  totalComments}: CommentsSheetProps) {
  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const { height: windowHeight } = useWindowDimensions();
  const slideAnim = useRef(new Animated.Value(windowHeight)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : windowHeight,
      tension: 80,
      friction: 12,
      useNativeDriver: true}).start();
  }, [visible, slideAnim, windowHeight]);

  const handleSubmit = useCallback(async () => {
    const body = draft.trim();
    if (!body || isSubmitting) return;

    setIsSubmitting(true);
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onAddComment(projectId, body, replyingTo || undefined);
      setDraft('');
      setReplyingTo(null);
    } finally {
      setIsSubmitting(false);
    }
  }, [draft, projectId, replyingTo, onAddComment, isSubmitting]);

  const handleReply = useCallback((commentId: string) => {
    setReplyingTo(commentId);
    inputRef.current?.focus();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  if (!visible) return null;

  return (
    <Animated.View style={[sheetStyles.overlay, { transform: [{ translateY: slideAnim }] }]}>
      <View style={sheetStyles.sheet}>
        {/* Header */}
        <View style={sheetStyles.header}>
          <Text style={sheetStyles.headerTitle}>
            Comments {totalComments > 0 ? `(${totalComments})` : ''}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} testID="close-comments">
            <X size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Comment List */}
        <FlatList
          data={comments}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <CommentItem
              comment={item}
              onReply={handleReply}
              onDelete={onDeleteComment}
              onReport={onReportComment}
            />
          )}
          ListEmptyComponent={
            isLoading ? (
              <ShimmerIndicator size="small" color={GOLD} style={{ marginTop: 40 }} />
            ) : (
              <View style={sheetStyles.emptyState}>
                <MessageCircle size={32} color={Colors.textTertiary} />
                <Text style={sheetStyles.emptyTitle}>No comments yet</Text>
                <Text style={sheetStyles.emptyText}>Be the first to share your thoughts</Text>
              </View>
            )
          }
          contentContainerStyle={sheetStyles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />

        {/* Input */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
          <View style={sheetStyles.inputContainer}>
            {replyingTo && (
              <View style={sheetStyles.replyingToBar}>
                <Text style={sheetStyles.replyingToText}>
                  Replying to comment
                </Text>
                <TouchableOpacity onPress={() => setReplyingTo(null)}>
                  <X size={14} color={Colors.textTertiary} />
                </TouchableOpacity>
              </View>
            )}
            <View style={sheetStyles.inputRow}>
              <TextInput
                ref={inputRef}
                style={sheetStyles.input}
                placeholder="Add a comment..."
                placeholderTextColor={Colors.textTertiary}
                value={draft}
                onChangeText={setDraft}
                maxLength={2000}
                multiline
                returnKeyType="send"
                onSubmitEditing={handleSubmit}
                testID="comment-input"
              />
              <TouchableOpacity
                style={[sheetStyles.sendBtn, !draft.trim() && sheetStyles.sendBtnDisabled]}
                onPress={handleSubmit}
                disabled={!draft.trim() || isSubmitting}
                testID="send-comment"
              >
                {isSubmitting ? (
                  <ShimmerIndicator size="small" color="#000" />
                ) : (
                  <Send size={18} color={draft.trim() ? '#000' : Colors.textTertiary} />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Animated.View>
  );
});

// Need this for the empty state
export default ProjectCommentsSheet;

const sheetStyles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    zIndex: 100},
  sheet: {
    backgroundColor: SURFACE,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    minHeight: 400,
    borderTopWidth: 1,
    borderColor: BORDER},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER},
  headerTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800' as const},
  listContent: {
    flexGrow: 1,
    paddingBottom: 12},
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8},
  emptyTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const},
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 13},
  inputContainer: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: SURFACE_ELEVATED,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24},
  replyingToBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 6},
  replyingToText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: '600' as const},
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8},
  input: {
    flex: 1,
    backgroundColor: '#242424',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 14,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: BORDER},
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center'},
  sendBtnDisabled: {
    backgroundColor: '#333'}});

const commentStyles = StyleSheet.create({
  commentItem: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)'},
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 6},
  commentAuthorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    flex: 1},
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center'},
  avatarOwner: {
    backgroundColor: GOLD + '20',
    borderWidth: 1,
    borderColor: GOLD + '40'},
  avatarText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const},
  commentMeta: {
    flex: 1},
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  commentAuthor: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const},
  ownerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: GOLD + '15',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: GOLD + '30'},
  ownerBadgeText: {
    color: GOLD,
    fontSize: 10,
    fontWeight: '700' as const},
  commentTime: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 2},
  commentBody: {
    color: Colors.text,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 6,
    marginLeft: 40},
  commentActions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 4},
  replyBtn: {
    marginLeft: 40,
    marginBottom: 2},
  replyBtnText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const},
  repliesContainer: {
    marginLeft: 40,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: BORDER,
    marginTop: 8,
    gap: 8},
  replyItem: {
    paddingBottom: 4},
  replyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2},
  replyAuthor: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700' as const},
  replyBody: {
    color: Colors.text,
    fontSize: 13,
    lineHeight: 19}});
