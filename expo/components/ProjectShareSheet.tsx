/**
 * ProjectShareSheet — Instagram-Style Share Bottom Sheet
 *
 * Share options: copy link, WhatsApp, SMS, email, social, investor referral.
 */
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  useWindowDimensions,
  Alert,
  Share as RNShare,
  Platform} from 'react-native';
import {
  X,
  Link,
  MessageCircle,
  Smartphone,
  Mail,
  Share2,
  Users,
  Copy,
  Check} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';

const GOLD = '#FFD700';
const SURFACE = '#141414';
const SURFACE_ELEVATED = '#1A1A1A';
const BORDER = '#2A2A2A';

interface ShareOption {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
  action: () => void;
}

interface ShareSheetProps {
  projectId: string;
  projectTitle: string;
  projectUrl: string;
  visible: boolean;
  onClose: () => void;
  onShareTrack: (projectId: string, shareType: string) => void;
}

const ProjectShareSheet = memo(function ProjectShareSheet({
  projectId,
  projectTitle,
  projectUrl,
  visible,
  onClose,
  onShareTrack}: ShareSheetProps) {
  const { height: windowHeight } = useWindowDimensions();
  const slideAnim = useRef(new Animated.Value(windowHeight)).current;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : windowHeight,
      tension: 80,
      friction: 12,
      useNativeDriver: true}).start();
  }, [visible, slideAnim, windowHeight]);

  useEffect(() => {
    if (!visible) setCopied(false);
  }, [visible]);

  const trackAndExecute = useCallback(
    (shareType: string, action: () => void) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onShareTrack(projectId, shareType);
      action();
    },
    [projectId, onShareTrack],
  );

  const handleCopyLink = useCallback(async () => {
    await Clipboard.setStringAsync(projectUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [projectUrl]);

  const handleNativeShare = useCallback(async () => {
    try {
      await RNShare.share({
        message: `Check out this investment opportunity on IVX: ${projectTitle}\n${projectUrl}`,
        url: projectUrl,
        title: projectTitle}, {
        dialogTitle: `Share ${projectTitle}`});
    } catch {}
  }, [projectTitle, projectUrl]);

  const shareOptions: ShareOption[] = [
    {
      id: 'copy_link',
      label: 'Copy Link',
      icon: copied ? Check : Link,
      color: Colors.blue,
      action: () => trackAndExecute('copy_link', handleCopyLink)},
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      icon: MessageCircle,
      color: '#25D366',
      action: () => trackAndExecute('whatsapp', () => {
        // WhatsApp deep link
        const text = encodeURIComponent(`Check out ${projectTitle} on IVX: ${projectUrl}`);
        const url = `whatsapp://send?text=${text}`;
        // Falls back to native share if WhatsApp not installed
        RNShare.share({ message: `Check out ${projectTitle}: ${projectUrl}`, url: projectUrl }).catch(() => {});
      })},
    {
      id: 'sms',
      label: 'SMS',
      icon: Smartphone,
      color: Colors.green,
      action: () => trackAndExecute('sms', () => {
        const text = encodeURIComponent(`Check out ${projectTitle} on IVX: ${projectUrl}`);
        Platform.OS === 'web'
          ? handleCopyLink()
          : RNShare.share({ message: `Check out ${projectTitle}: ${projectUrl}`, url: projectUrl }).catch(() => {});
      })},
    {
      id: 'email',
      label: 'Email',
      icon: Mail,
      color: '#EA4335',
      action: () => trackAndExecute('email', () => {
        const subject = encodeURIComponent(`Investment Opportunity: ${projectTitle}`);
        const body = encodeURIComponent(`I found this investment opportunity on IVX:\n\n${projectTitle}\n${projectUrl}\n\nCheck it out!`);
        Platform.OS === 'web'
          ? window.open(`mailto:?subject=${subject}&body=${body}`, '_blank')
          : RNShare.share({ message: `Check out ${projectTitle}: ${projectUrl}`, url: projectUrl }).catch(() => {});
      })},
    {
      id: 'social',
      label: 'Share',
      icon: Share2,
      color: '#E1306C',
      action: () => trackAndExecute('social', handleNativeShare)},
    {
      id: 'referral',
      label: 'Referral Link',
      icon: Users,
      color: GOLD,
      action: () => trackAndExecute('referral', handleCopyLink)},
  ];

  if (!visible) return null;

  return (
    <Animated.View style={[styles.overlay, { transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.sheet}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Share</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} testID="close-share">
            <X size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Project Info */}
        <View style={styles.projectInfo}>
          <Text style={styles.projectTitle} numberOfLines={2}>
            {projectTitle}
          </Text>
          <Text style={styles.projectUrl} numberOfLines={1}>
            {projectUrl}
          </Text>
        </View>

        {/* Share Options Grid */}
        <View style={styles.optionsGrid}>
          {shareOptions.map((option) => (
            <TouchableOpacity
              key={option.id}
              style={styles.optionItem}
              onPress={option.action}
              activeOpacity={0.7}
              testID={`share-${option.id}`}
            >
              <View style={[styles.optionIconWrap, { backgroundColor: option.color + '15', borderColor: option.color + '30' }]}>
                <option.icon size={24} color={option.color} />
              </View>
              <Text style={styles.optionLabel}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Cancel */}
        <TouchableOpacity style={styles.cancelBtn} onPress={onClose} testID="share-cancel">
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
});

export default ProjectShareSheet;

const styles = StyleSheet.create({
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
    paddingBottom: 40,
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
  projectInfo: {
    paddingHorizontal: 20,
    paddingVertical: 14},
  projectTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
    marginBottom: 4},
  projectUrl: {
    color: Colors.textSecondary,
    fontSize: 12},
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    gap: 4},
  optionItem: {
    width: '33%',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 8},
  optionIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1},
  optionLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const,
    textAlign: 'center'},
  cancelBtn: {
    marginHorizontal: 20,
    marginTop: 12,
    paddingVertical: 14,
    backgroundColor: SURFACE_ELEVATED,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER},
  cancelText: {
    color: Colors.textSecondary,
    fontSize: 15,
    fontWeight: '600' as const}});
