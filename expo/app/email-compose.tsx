import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  Alert,
  KeyboardAvoidingView,
  Image,
  Modal} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import {
  X,
  Send,
  Paperclip,
  ChevronUp,
  Save,
  ImageIcon,
  Video,
  FileText,
  File,
  Camera,
  Sparkles} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import Colors from '@/constants/colors';
import { useEmail } from '@/lib/email-context';
import { EmailAttachment } from '@/types/email';
import { EMAIL_TEMPLATES, EMAIL_TEMPLATE_CATEGORIES, EmailTemplate } from '@/mocks/email-templates';

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return ImageIcon;
  if (mimeType.startsWith('video/')) return Video;
  if (mimeType === 'application/pdf') return FileText;
  return File;
}

function getFileIconColor(mimeType: string) {
  if (mimeType.startsWith('image/')) return '#4A90D9';
  if (mimeType.startsWith('video/')) return '#E74C3C';
  if (mimeType === 'application/pdf') return '#E67E22';
  return Colors.textSecondary;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileName(uri: string, fallback: string): string {
  const parts = uri.split('/');
  const last = parts[parts.length - 1];
  if (last && last.includes('.')) return decodeURIComponent(last);
  return fallback;
}

export default function EmailComposeScreen() {
  const router = useRouter();
  const { replyTo, forwardFrom } = useLocalSearchParams<{ replyTo?: string; forwardFrom?: string }>();
  const { activeAccount, sendEmail, saveDraft, getEmailById } = useEmail();

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [attachments, setAttachments] = useState<EmailAttachment[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateCategory, setTemplateCategory] = useState('All');

  const filteredTemplates = useMemo(() => {
    if (templateCategory === 'All') return EMAIL_TEMPLATES;
    return EMAIL_TEMPLATES.filter(t => t.category === templateCategory);
  }, [templateCategory]);

  const handleSelectTemplate = useCallback((template: EmailTemplate) => {
    setSubject(template.subject);
    setBody(template.body);
    setShowTemplates(false);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  useEffect(() => {
    if (replyTo) {
      const original = getEmailById(replyTo);
      if (original) {
        setTo(original.from.email);
        setSubject(`Re: ${original.subject.replace(/^Re:\s*/i, '')}`);
        setBody(`\n\n--- Original Message ---\nFrom: ${original.from.name} <${original.from.email}>\nDate: ${new Date(original.date).toLocaleString()}\n\n${original.body}`);
      }
    } else if (forwardFrom) {
      const original = getEmailById(forwardFrom);
      if (original) {
        setSubject(`Fwd: ${original.subject.replace(/^Fwd:\s*/i, '')}`);
        setBody(`\n\n--- Forwarded Message ---\nFrom: ${original.from.name} <${original.from.email}>\nTo: ${original.to.map(t => `${t.name} <${t.email}>`).join(', ')}\nDate: ${new Date(original.date).toLocaleString()}\nSubject: ${original.subject}\n\n${original.body}`);
        if (original.attachments && original.attachments.length > 0) {
          setAttachments(original.attachments);
        }
      }
    }
  }, [replyTo, forwardFrom, getEmailById]);

  const toValidation = useMemo(() => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const trimmed = to.trim();
    if (!trimmed) return { valid: false, error: '' };
    const addresses = trimmed.split(',').map(e => e.trim()).filter(Boolean);
    const invalid = addresses.filter(e => !emailRegex.test(e));
    if (invalid.length > 0) return { valid: false, error: `Invalid: ${invalid.join(', ')}` };
    return { valid: true, error: '' };
  }, [to]);

  const canSend = useMemo(() => {
    return to.trim().length > 0 && subject.trim().length > 0 && toValidation.valid;
  }, [to, subject, toValidation.valid]);

  const handlePickPhoto = useCallback(async () => {
    setShowAttachMenu(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.8});
      if (!result.canceled && result.assets.length > 0) {
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const newAttachments: EmailAttachment[] = result.assets.map((asset, idx) => ({
          id: `att-img-${Date.now()}-${idx}`,
          name: getFileName(asset.uri, `photo_${Date.now()}_${idx}.jpg`),
          size: asset.fileSize ?? 0,
          type: 'image',
          uri: asset.uri,
          mimeType: asset.mimeType ?? 'image/jpeg'}));
        setAttachments(prev => [...prev, ...newAttachments]);
        console.log('Added image attachments:', newAttachments.length);
      }
    } catch (e) {
      console.log('Image picker error:', e);
      Alert.alert('Error', 'Failed to pick images. Please try again.');
    }
  }, []);

  const handlePickVideo = useCallback(async () => {
    setShowAttachMenu(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsMultipleSelection: false,
        quality: 0.8});
      if (!result.canceled && result.assets.length > 0) {
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const asset = result.assets[0];
        const newAttachment: EmailAttachment = {
          id: `att-vid-${Date.now()}`,
          name: getFileName(asset.uri, `video_${Date.now()}.mp4`),
          size: asset.fileSize ?? 0,
          type: 'video',
          uri: asset.uri,
          mimeType: asset.mimeType ?? 'video/mp4'};
        setAttachments(prev => [...prev, newAttachment]);
        console.log('Added video attachment:', newAttachment.name);
      }
    } catch (e) {
      console.log('Video picker error:', e);
      Alert.alert('Error', 'Failed to pick video. Please try again.');
    }
  }, []);

  const handlePickDocument = useCallback(async () => {
    setShowAttachMenu(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain'],
        multiple: true,
        copyToCacheDirectory: true});
      if (!result.canceled && result.assets && result.assets.length > 0) {
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const newAttachments: EmailAttachment[] = result.assets.map((asset, idx) => ({
          id: `att-doc-${Date.now()}-${idx}`,
          name: asset.name || `document_${Date.now()}_${idx}`,
          size: asset.size ?? 0,
          type: 'document',
          uri: asset.uri,
          mimeType: asset.mimeType ?? 'application/pdf'}));
        setAttachments(prev => [...prev, ...newAttachments]);
        console.log('Added document attachments:', newAttachments.length);
      }
    } catch (e) {
      console.log('Document picker error:', e);
      Alert.alert('Error', 'Failed to pick document. Please try again.');
    }
  }, []);

  const handleTakePhoto = useCallback(async () => {
    setShowAttachMenu(false);
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      void handlePickPhoto();
      return;
    }
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Required', 'Camera permission is needed to take photos.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8});
      if (!result.canceled && result.assets.length > 0) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const asset = result.assets[0];
        const newAttachment: EmailAttachment = {
          id: `att-cam-${Date.now()}`,
          name: getFileName(asset.uri, `camera_${Date.now()}.jpg`),
          size: asset.fileSize ?? 0,
          type: 'image',
          uri: asset.uri,
          mimeType: asset.mimeType ?? 'image/jpeg'};
        setAttachments(prev => [...prev, newAttachment]);
        console.log('Added camera attachment:', newAttachment.name);
      }
    } catch (e) {
      console.log('Camera error:', e);
      Alert.alert('Error', 'Failed to capture photo. Please try again.');
    }
  }, [handlePickPhoto]);

  const removeAttachment = useCallback((attachmentId: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAttachments(prev => prev.filter(a => a.id !== attachmentId));
  }, []);

  const totalAttachmentSize = useMemo(() => {
    return attachments.reduce((sum, a) => sum + a.size, 0);
  }, [attachments]);

  const handleSend = useCallback(async () => {
    if (!canSend) {
      Alert.alert('Missing Fields', 'Please fill in the recipient and subject.');
      return;
    }

    setIsSending(true);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      const result = await sendEmail({
        to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject,
        body,
        replyToId: replyTo,
        forwardFromId: forwardFrom,
        attachments: attachments.length > 0 ? attachments : undefined});

      setIsSending(false);

      if (result.success && result.deliveryStatus === 'sent') {
        Alert.alert('Email Sent', 'Your email has been delivered successfully via AWS SES.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else if (result.success && result.deliveryStatus === 'queued_locally') {
        const title = result.error ? 'Email Saved' : 'Queued Locally';
        const message = result.error
          ? `${result.error}\n\nYour email has been saved locally and will be delivered once the issue is resolved.`
          : 'Email saved locally. It will be sent when the backend connection is available.';
        Alert.alert(title, message, [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        Alert.alert('Send Issue', result.error || 'Email could not be sent. Please try again.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (err: any) {
      setIsSending(false);
      console.error('[Compose] Send error:', err);
      Alert.alert('Error', err?.message || 'Failed to send email. Please try again.');
    }
  }, [canSend, to, cc, bcc, subject, body, replyTo, forwardFrom, attachments, sendEmail, router]);

  const handleSaveDraft = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    saveDraft({
      to,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject,
      body,
      attachments: attachments.length > 0 ? attachments : undefined});
    Alert.alert('Saved', 'Draft saved.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }, [to, cc, bcc, subject, body, attachments, saveDraft, router]);

  const handleDiscard = useCallback(() => {
    const hasContent = to.trim() || subject.trim() || body.trim() || attachments.length > 0;
    if (hasContent) {
      Alert.alert('Discard Draft?', 'Your draft will be lost.', [
        { text: 'Keep Editing', style: 'cancel' },
        { text: 'Save Draft', onPress: handleSaveDraft },
        { text: 'Discard', style: 'destructive', onPress: () => router.back() },
      ]);
    } else {
      router.back();
    }
  }, [to, subject, body, attachments, handleSaveDraft, router]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} onPress={handleDiscard} testID="compose-close">
            <X size={22} color={Colors.text} strokeWidth={1.8} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {replyTo ? 'Reply' : forwardFrom ? 'Forward' : 'Compose'}
          </Text>
          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.headerButton} onPress={handleSaveDraft}>
              <Save size={20} color={Colors.textSecondary} strokeWidth={1.8} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!canSend || isSending}
              testID="compose-send"
            >
              <Send size={18} color={canSend ? Colors.background : Colors.textTertiary} strokeWidth={2} />
              <Text style={[styles.sendButtonText, !canSend && styles.sendButtonTextDisabled]}>
                {isSending ? 'Sending...' : 'Send'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <KeyboardAvoidingView
          style={styles.bodyContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <ScrollView style={styles.formScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.fromRow}>
              <Text style={styles.fieldLabel}>From</Text>
              <View style={styles.fromValue}>
                <View style={[styles.fromDot, { backgroundColor: activeAccount.color }]} />
                <Text style={styles.fromText}>{activeAccount.email}</Text>
              </View>
            </View>

            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>To</Text>
              <TextInput
                style={[styles.fieldInput, (toValidation.error ? { color: Colors.error } : undefined)]}
                value={to}
                onChangeText={setTo}
                placeholder="recipient@example.com"
                placeholderTextColor={Colors.inputPlaceholder}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                testID="compose-to"
              />
              <TouchableOpacity
                style={styles.ccToggle}
                onPress={() => setShowCcBcc(!showCcBcc)}
              >
                {showCcBcc
                  ? <ChevronUp size={16} color={Colors.textTertiary} strokeWidth={2} />
                  : <Text style={styles.ccToggleText}>Cc/Bcc</Text>
                }
              </TouchableOpacity>
            </View>
            {toValidation.error ? (
              <Text style={styles.validationError}>{toValidation.error}</Text>
            ) : null}

            {showCcBcc && (
              <>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Cc</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={cc}
                    onChangeText={setCc}
                    placeholder="cc@example.com"
                    placeholderTextColor={Colors.inputPlaceholder}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Bcc</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={bcc}
                    onChangeText={setBcc}
                    placeholder="bcc@example.com"
                    placeholderTextColor={Colors.inputPlaceholder}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </>
            )}

            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Subject</Text>
              <TextInput
                style={styles.fieldInput}
                value={subject}
                onChangeText={setSubject}
                placeholder="Email subject"
                placeholderTextColor={Colors.inputPlaceholder}
                testID="compose-subject"
              />
            </View>

            {attachments.length > 0 && (
              <View style={styles.attachmentsSection}>
                <View style={styles.attachmentsHeader}>
                  <Paperclip size={14} color={Colors.textSecondary} strokeWidth={2} />
                  <Text style={styles.attachmentsTitle}>
                    {attachments.length} file{attachments.length > 1 ? 's' : ''} attached
                  </Text>
                  <Text style={styles.attachmentsSize}>
                    {formatFileSize(totalAttachmentSize)}
                  </Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachmentsScroll}>
                  {attachments.map(att => {
                    const isImage = att.mimeType?.startsWith('image/') || att.type === 'image';
                    const isVideo = att.mimeType?.startsWith('video/') || att.type === 'video';
                    const IconComp = getFileIcon(att.mimeType ?? 'application/octet-stream');
                    const iconColor = getFileIconColor(att.mimeType ?? 'application/octet-stream');

                    return (
                      <View key={att.id} style={styles.attachmentCard}>
                        <TouchableOpacity
                          style={styles.attachmentRemove}
                          onPress={() => removeAttachment(att.id)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <X size={12} color={Colors.white} strokeWidth={2.5} />
                        </TouchableOpacity>
                        {isImage && att.uri ? (
                          <Image source={{ uri: att.uri }} style={styles.attachmentThumbnail} />
                        ) : (
                          <View style={[styles.attachmentIconBox, { backgroundColor: `${iconColor}15` }]}>
                            {isVideo && (
                              <View style={styles.videoPlayOverlay}>
                                <Video size={24} color={iconColor} strokeWidth={1.8} />
                              </View>
                            )}
                            {!isVideo && (
                              <IconComp size={24} color={iconColor} strokeWidth={1.8} />
                            )}
                          </View>
                        )}
                        <Text style={styles.attachmentCardName} numberOfLines={1}>{att.name}</Text>
                        <Text style={styles.attachmentCardSize}>{formatFileSize(att.size)}</Text>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            <View style={styles.bodyFieldContainer}>
              <TextInput
                style={styles.bodyInput}
                value={body}
                onChangeText={setBody}
                placeholder="Write your email..."
                placeholderTextColor={Colors.inputPlaceholder}
                multiline
                textAlignVertical="top"
                testID="compose-body"
              />
            </View>
          </ScrollView>

          <View style={styles.toolbar}>
            <TouchableOpacity
              style={styles.toolbarButton}
              onPress={() => setShowAttachMenu(true)}
              testID="compose-attach"
            >
              <Paperclip size={20} color={Colors.textSecondary} strokeWidth={1.8} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toolbarButton, showTemplates && styles.toolbarButtonActive]}
              onPress={() => setShowTemplates(!showTemplates)}
              testID="compose-templates"
            >
              <Sparkles size={20} color={showTemplates ? Colors.primary : Colors.textSecondary} strokeWidth={1.8} />
            </TouchableOpacity>
            {attachments.length > 0 && (
              <View style={styles.attachBadge}>
                <Text style={styles.attachBadgeText}>{attachments.length}</Text>
              </View>
            )}
            <View style={styles.toolbarSpacer} />
            <Text style={styles.toolbarAccount}>{activeAccount.displayName}</Text>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal
        visible={showTemplates}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTemplates(false)}
      >
        <TouchableOpacity
          style={styles.templateOverlay}
          onPress={() => setShowTemplates(false)}
          activeOpacity={1}
        >
          <View style={styles.templateSheet}>
            <View style={styles.templateSheetHandle} />
            <Text style={styles.templateSheetTitle}>Email Templates</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.templateCategoryScroll}
            >
              {EMAIL_TEMPLATE_CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.templateCatChip, templateCategory === cat && styles.templateCatChipActive]}
                  onPress={() => setTemplateCategory(cat)}
                >
                  <Text style={[styles.templateCatText, templateCategory === cat && styles.templateCatTextActive]}>
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <ScrollView
              style={styles.templateListScroll}
              showsVerticalScrollIndicator={false}
            >
              {filteredTemplates.map(template => (
                <TouchableOpacity
                  key={template.id}
                  style={styles.templateListItem}
                  onPress={() => handleSelectTemplate(template)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.templateListIcon, { backgroundColor: template.iconColor + '15' }]}>
                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: template.iconColor + '30', alignItems: 'center' as const, justifyContent: 'center' as const }}>
                      <Text style={{ fontSize: 10, fontWeight: '700' as const, color: template.iconColor }}>{template.name.charAt(0)}</Text>
                    </View>
                  </View>
                  <View style={styles.templateListInfo}>
                    <Text style={styles.templateListName}>{template.name}</Text>
                    <Text style={styles.templateListDesc} numberOfLines={1}>{template.description}</Text>
                  </View>
                  <View style={[styles.templateListBadge, { backgroundColor: template.iconColor + '15' }]}>
                    <Text style={[styles.templateListBadgeText, { color: template.iconColor }]}>{template.category}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showAttachMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAttachMenu(false)}
      >
        <TouchableOpacity
          style={styles.attachOverlay}
          onPress={() => setShowAttachMenu(false)}
          activeOpacity={1}
        >
          <View style={styles.attachSheet}>
            <View style={styles.attachSheetHandle} />
            <Text style={styles.attachSheetTitle}>Attach File</Text>

            <TouchableOpacity style={styles.attachOption} onPress={handlePickPhoto} testID="attach-photo">
              <View style={[styles.attachOptionIcon, { backgroundColor: 'rgba(74,144,217,0.12)' }]}>
                <ImageIcon size={22} color="#4A90D9" strokeWidth={1.8} />
              </View>
              <View style={styles.attachOptionInfo}>
                <Text style={styles.attachOptionLabel}>Photo Library</Text>
                <Text style={styles.attachOptionDesc}>Choose images from your gallery</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.attachOption} onPress={handlePickVideo} testID="attach-video">
              <View style={[styles.attachOptionIcon, { backgroundColor: 'rgba(231,76,60,0.12)' }]}>
                <Video size={22} color="#E74C3C" strokeWidth={1.8} />
              </View>
              <View style={styles.attachOptionInfo}>
                <Text style={styles.attachOptionLabel}>Video</Text>
                <Text style={styles.attachOptionDesc}>Choose a video from your library</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.attachOption} onPress={handlePickDocument} testID="attach-document">
              <View style={[styles.attachOptionIcon, { backgroundColor: 'rgba(230,126,34,0.12)' }]}>
                <FileText size={22} color="#E67E22" strokeWidth={1.8} />
              </View>
              <View style={styles.attachOptionInfo}>
                <Text style={styles.attachOptionLabel}>Document</Text>
                <Text style={styles.attachOptionDesc}>PDF, Word, Excel, or text files</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.attachOption} onPress={handleTakePhoto} testID="attach-camera">
              <View style={[styles.attachOptionIcon, { backgroundColor: 'rgba(0,196,140,0.12)' }]}>
                <Camera size={22} color="#00C48C" strokeWidth={1.8} />
              </View>
              <View style={styles.attachOptionInfo}>
                <Text style={styles.attachOptionLabel}>Take Photo</Text>
                <Text style={styles.attachOptionDesc}>Capture with your camera</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.attachCancel}
              onPress={() => setShowAttachMenu(false)}
            >
              <Text style={styles.attachCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
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
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8},
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center'},
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text},
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4},
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6},
  sendButtonDisabled: {
    backgroundColor: Colors.surface},
  sendButtonText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.background},
  sendButtonTextDisabled: {
    color: Colors.textTertiary},
  bodyContainer: {
    flex: 1},
  formScroll: {
    flex: 1},
  fromRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border},
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.textTertiary,
    width: 52},
  fromValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  fromDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  fromText: {
    fontSize: 14,
    color: Colors.textSecondary},
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border},
  fieldInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    paddingVertical: 2},
  ccToggle: {
    paddingHorizontal: 8,
    paddingVertical: 4},
  ccToggleText: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.textTertiary},
  attachmentsSection: {
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border},
  attachmentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 6,
    marginBottom: 10},
  attachmentsTitle: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    flex: 1},
  attachmentsSize: {
    fontSize: 12,
    color: Colors.textTertiary},
  attachmentsScroll: {
    paddingHorizontal: 16,
    gap: 10,
    paddingBottom: 4},
  attachmentCard: {
    width: 110,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    overflow: 'hidden'},
  attachmentRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center'},
  attachmentThumbnail: {
    width: 110,
    height: 80,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    backgroundColor: Colors.backgroundTertiary},
  attachmentIconBox: {
    width: 110,
    height: 80,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'},
  videoPlayOverlay: {
    alignItems: 'center',
    justifyContent: 'center'},
  attachmentCardName: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.text,
    paddingHorizontal: 8,
    paddingTop: 6},
  attachmentCardSize: {
    fontSize: 10,
    color: Colors.textTertiary,
    paddingHorizontal: 8,
    paddingBottom: 8,
    paddingTop: 2},
  bodyFieldContainer: {
    flex: 1,
    minHeight: 300},
  bodyInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    lineHeight: 24,
    padding: 16,
    minHeight: 300},
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border},
  toolbarButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface},
  attachBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    marginLeft: 6},
  attachBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.background},
  toolbarButtonActive: {
    backgroundColor: Colors.primary + '15'},
  templateOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end' as const},
  templateSheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    paddingTop: 12,
    maxHeight: '75%' as any},
  templateSheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center' as const,
    marginBottom: 16},
  templateSheetTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
    paddingHorizontal: 20,
    marginBottom: 12},
  templateCategoryScroll: {
    paddingHorizontal: 20,
    gap: 6,
    paddingBottom: 12},
  templateCatChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  templateCatChipActive: {
    backgroundColor: Colors.primary + '15',
    borderColor: Colors.primary + '50'},
  templateCatText: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.textSecondary},
  templateCatTextActive: {
    color: Colors.primary,
    fontWeight: '600' as const},
  templateListScroll: {
    paddingHorizontal: 16,
    maxHeight: 400},
  templateListItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border},
  templateListIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  templateListInfo: {
    flex: 1,
    gap: 2},
  templateListName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text},
  templateListDesc: {
    fontSize: 12,
    color: Colors.textTertiary},
  templateListBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6},
  templateListBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  toolbarSpacer: {
    flex: 1},
  toolbarAccount: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '500' as const},
  attachOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end'},
  attachSheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    paddingTop: 12},
  attachSheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 16},
  attachSheetTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
    paddingHorizontal: 20,
    marginBottom: 16},
  attachOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14},
  attachOptionIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center'},
  attachOptionInfo: {
    flex: 1,
    gap: 2},
  attachOptionLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text},
  attachOptionDesc: {
    fontSize: 12,
    color: Colors.textTertiary},
  attachCancel: {
    marginTop: 8,
    marginHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    alignItems: 'center'},
  attachCancelText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  validationError: {
    fontSize: 12,
    color: Colors.error,
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 4}});
