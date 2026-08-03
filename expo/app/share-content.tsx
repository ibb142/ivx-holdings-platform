import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import logger from '@/lib/logger';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Dimensions,
  Platform,
  Alert,
  Linking,
  TextInput,
  Share} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Share2,
  MessageCircle,
  Copy,
  Mail,
  Send,
  Users,
  Link2,
  CheckCircle,
  X,
  Video,
  Image as ImageIcon,
  FileText,
  Sparkles,
  ChevronRight,
  Phone,
  Globe,
  Briefcase,
  Code,
  Building2,
  Clock,
  Zap} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import Colors from '@/constants/colors';

const { width: SW } = Dimensions.get('window');

interface TeamMember {
  id: string;
  name: string;
  role: 'developer' | 'investor' | 'advisor' | 'designer' | 'manager';
  phone: string;
  email: string;
  avatar: string;
}

interface ShareableContent {
  id: string;
  type: 'video' | 'image' | 'document' | 'link';
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  shareUrl: string;
  shareText: string;
}

const TEAM_MEMBERS: TeamMember[] = [
  { id: '1', name: 'Alex Rivera', role: 'developer', phone: '+1234567890', email: 'alex@ivxholding.com', avatar: 'AR' },
  { id: '2', name: 'Sarah Chen', role: 'investor', phone: '+1987654321', email: 'sarah@investors.com', avatar: 'SC' },
  { id: '3', name: 'Marcus Johnson', role: 'developer', phone: '+1122334455', email: 'marcus@ivxholding.com', avatar: 'MJ' },
  { id: '4', name: 'Elena Voronova', role: 'investor', phone: '+1555666777', email: 'elena@capital.io', avatar: 'EV' },
  { id: '5', name: 'David Park', role: 'advisor', phone: '+1444555666', email: 'david@advisory.com', avatar: 'DP' },
  { id: '6', name: 'Priya Sharma', role: 'designer', phone: '+1333444555', email: 'priya@ivxholding.com', avatar: 'PS' },
  { id: '7', name: 'James Wilson', role: 'manager', phone: '+1222333444', email: 'james@ivxholding.com', avatar: 'JW' },
  { id: '8', name: 'Fatima Al-Rashid', role: 'investor', phone: '+1666777888', email: 'fatima@ventures.ae', avatar: 'FA' },
];

const ROLE_COLORS: Record<string, string> = {
  developer: '#4A90D9',
  investor: '#FFD700',
  advisor: '#00C48C',
  designer: '#E91E63',
  manager: '#9B59B6'};

const ROLE_ICONS: Record<string, React.ReactNode> = {
  developer: <Code size={12} color="#4A90D9" />,
  investor: <Briefcase size={12} color="#FFD700" />,
  advisor: <Globe size={12} color="#00C48C" />,
  designer: <Sparkles size={12} color="#E91E63" />,
  manager: <Building2 size={12} color="#9B59B6" />};

const APP_SHARE_URL = 'https://ivxholding.com';

const SHAREABLE_CONTENT: ShareableContent[] = [
  {
    id: 'presentation',
    type: 'video',
    title: 'IVXHOLDINGS Video Presentation',
    description: 'Full animated pitch deck with all features',
    icon: <Video size={20} color="#FF6B35" />,
    color: '#FF6B35',
    shareUrl: `${APP_SHARE_URL}/presentation`,
    shareText: '🎬 Check out the IVX HOLDINGS video presentation! The future of real estate investing is here. AI-powered, fractional ownership starting at $10.'},
  {
    id: 'gallery',
    type: 'image',
    title: 'AI Property Gallery',
    description: 'AI-generated property visuals & mockups',
    icon: <ImageIcon size={20} color="#4A90D9" />,
    color: '#4A90D9',
    shareUrl: `${APP_SHARE_URL}/gallery`,
    shareText: '🏠 See our AI-generated property gallery! IVX HOLDINGS uses cutting-edge AI to showcase investment properties.'},
  {
    id: 'prospectus',
    type: 'document',
    title: 'Investor Prospectus',
    description: 'Complete investment overview & projections',
    icon: <FileText size={20} color="#00C48C" />,
    color: '#00C48C',
    shareUrl: `${APP_SHARE_URL}/prospectus`,
    shareText: '📊 IVX HOLDINGS Investor Prospectus — $326T global real estate market. Fractional investing from $10. AI-managed portfolio. 9.8% avg annual returns.'},
  {
    id: 'app-demo',
    type: 'link',
    title: 'Live App Demo',
    description: 'Interactive walkthrough of the platform',
    icon: <Zap size={20} color="#FFD700" />,
    color: '#FFD700',
    shareUrl: `${APP_SHARE_URL}/demo`,
    shareText: '🚀 Try the IVX HOLDINGS live demo! Experience the future of real estate investing — AI-powered, instant KYC, invest from just $10.'},
  {
    id: 'app-report',
    type: 'document',
    title: 'App Development Report',
    description: 'Technical progress & architecture overview',
    icon: <FileText size={20} color="#9B59B6" />,
    color: '#9B59B6',
    shareUrl: `${APP_SHARE_URL}/report`,
    shareText: '📋 IVX HOLDINGS Development Report — Full-stack AI platform with 100+ features. React Native + Expo + Supabase architecture.'},
];

export default function ShareContentScreen() {
  const router = useRouter();
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<string | null>(null);
  const [customMessage, setCustomMessage] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [queueIndex, setQueueIndex] = useState<number>(-1);
  const [queueContent, setQueueContent] = useState<ShareableContent | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const successAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const filteredMembers = useMemo(() => {
    if (!filterRole) return TEAM_MEMBERS;
    return TEAM_MEMBERS.filter(m => m.role === filterRole);
  }, [filterRole]);

  const selectedMemberObjects = useMemo(
    () => TEAM_MEMBERS.filter(m => selectedMembers.includes(m.id)),
    [selectedMembers]
  );

  const toggleMember = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedMembers(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    );
  }, []);

  const selectAllMembers = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const allIds = filteredMembers.map(m => m.id);
    const allSelected = allIds.every(id => selectedMembers.includes(id));
    if (allSelected) {
      setSelectedMembers(prev => prev.filter(id => !allIds.includes(id)));
    } else {
      setSelectedMembers(prev => [...new Set([...prev, ...allIds])]);
    }
  }, [filteredMembers, selectedMembers]);

  const openWhatsApp = useCallback(async (phone: string, message: string): Promise<boolean> => {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const encoded = encodeURIComponent(message);
    const waUrl = `https://wa.me/${cleanPhone}?text=${encoded}`;

    try {
      const canOpen = await Linking.canOpenURL(waUrl);
      if (canOpen) {
        await Linking.openURL(waUrl);
        logger.shareContent.log('Opened WhatsApp for:', cleanPhone);
        return true;
      } else {
        if (Platform.OS !== 'web') {
          await Share.share({ message });
        } else {
          Alert.alert('WhatsApp Not Available', 'Could not open WhatsApp. Make sure it is installed.');
        }
        return false;
      }
    } catch (error) {
      logger.shareContent.error('WhatsApp error:', error);
      Alert.alert('Unable to Open', 'Could not open WhatsApp. Make sure it is installed.');
      return false;
    }
  }, []);

  const buildMessage = useCallback((content: ShareableContent, memberFirstName?: string): string => {
    const greeting = memberFirstName ? `Hi ${memberFirstName}! ` : '';
    const note = customMessage ? `${greeting}${customMessage}\n\n` : greeting ? `${greeting}` : '';
    return `${note}${content.shareText}\n\n${content.shareUrl}`;
  }, [customMessage]);

  const shareViaWhatsAppToSelected = useCallback(async (content: ShareableContent) => {
    if (selectedMemberObjects.length === 0) {
      Alert.alert('No Team Selected', 'Please select at least one team member to share with.');
      return;
    }

    if (selectedMemberObjects.length === 1) {
      const member = selectedMemberObjects[0];
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await openWhatsApp(member.phone, buildMessage(content, member.name.split(' ')[0]));
      triggerSuccess();
      logger.shareContent.log('Shared to 1 member:', member.name);
      return;
    }

    Alert.alert(
      `Share to ${selectedMemberObjects.length} Members`,
      `This will open WhatsApp for each member one by one.\n\nStart with ${selectedMemberObjects[0].name.split(' ')[0]}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start Sharing',
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setQueueContent(content);
            setQueueIndex(0);
            const member = selectedMemberObjects[0];
            await openWhatsApp(member.phone, buildMessage(content, member.name.split(' ')[0]));
            logger.shareContent.log('Queue started, member 1:', member.name);
          }},
      ]
    );
  }, [selectedMemberObjects, openWhatsApp, buildMessage]);

  useEffect(() => {
    if (queueIndex < 0 || !queueContent) return;
    const nextIndex = queueIndex + 1;
    if (nextIndex >= selectedMemberObjects.length) {
      triggerSuccess();
      setQueueIndex(-1);
      setQueueContent(null);
      logger.shareContent.log('Queue complete, shared to', selectedMemberObjects.length, 'members');
      return;
    }

    const nextMember = selectedMemberObjects[nextIndex];
    Alert.alert(
      `Next: ${nextMember.name.split(' ')[0]}`,
      `Share with ${nextMember.name}?`,
      [
        {
          text: 'Skip',
          style: 'cancel',
          onPress: () => setQueueIndex(nextIndex)},
        {
          text: 'Open WhatsApp',
          onPress: async () => {
            await openWhatsApp(nextMember.phone, buildMessage(queueContent, nextMember.name.split(' ')[0]));
            setQueueIndex(nextIndex);
          }},
      ]
    );
  }, [queueIndex]);

  const shareToWhatsAppDirect = useCallback(async (member: TeamMember, content: ShareableContent) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const message = buildMessage(content, member.name.split(' ')[0]);
    await openWhatsApp(member.phone, message);
    logger.shareContent.log('Direct WhatsApp to:', member.name, 'content:', content.title);
  }, [buildMessage, openWhatsApp]);

  const copyShareLink = useCallback(async (content: ShareableContent) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const text = `${content.shareText}\n\n${content.shareUrl}`;
    await Clipboard.setStringAsync(text);
    setCopiedId(content.id);
    setTimeout(() => setCopiedId(null), 2000);
    logger.shareContent.log('Copied link for:', content.title);
  }, []);

  const shareViaEmail = useCallback(async (content: ShareableContent) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const recipients = selectedMemberObjects.map(m => m.email);
    const subject = encodeURIComponent(`IVX HOLDINGS: ${content.title}`);
    const bodyText = customMessage
      ? `${customMessage}\n\n${content.shareText}\n\n${content.shareUrl}`
      : `${content.shareText}\n\n${content.shareUrl}`;
    const body = encodeURIComponent(bodyText);
    const to = recipients.join(',');
    const url = `mailto:${to}?subject=${subject}&body=${body}`;

    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        logger.shareContent.log('Email opened for:', content.title, 'recipients:', recipients.length);
      } else {
        Alert.alert('Unable to Open', 'Could not open email client. Please check your email app.');
      }
    } catch (e) {
      Alert.alert('Unable to Open', 'Could not open email client.');
      logger.shareContent.error('Email error:', e);
    }
  }, [selectedMemberObjects, customMessage]);

  const shareViaSMS = useCallback(async (content: ShareableContent) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const messageText = customMessage
      ? `${customMessage}\n\n${content.shareText}\n\n${content.shareUrl}`
      : `${content.shareText}\n\n${content.shareUrl}`;
    const message = encodeURIComponent(messageText);
    const separator = Platform.OS === 'ios' ? '&' : '?';
    const phones = selectedMemberObjects.map(m => m.phone).join(';');
    const url = `sms:${phones}${separator}body=${message}`;

    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        logger.shareContent.log('SMS opened for:', content.title, 'recipients:', selectedMemberObjects.length);
      } else {
        Alert.alert('Unable to Open', 'Could not open messages app.');
      }
    } catch (e) {
      Alert.alert('Unable to Open', 'Could not open messages app.');
      logger.shareContent.error('SMS error:', e);
    }
  }, [selectedMemberObjects, customMessage]);

  const triggerSuccess = useCallback(() => {
    setShowSuccess(true);
    Animated.sequence([
      Animated.timing(successAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(1500),
      Animated.timing(successAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setShowSuccess(false));
  }, [successAnim]);

  const handleBulkShareWhatsApp = useCallback(async () => {
    if (selectedMemberObjects.length === 0) {
      Alert.alert('No Team Selected', 'Please select team members first.');
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const allText = SHAREABLE_CONTENT.map(c => `📌 ${c.title}\n${c.shareText}\n${c.shareUrl}`).join('\n\n---\n\n');
    const msg = customMessage ? `${customMessage}\n\n${allText}` : allText;

    if (selectedMemberObjects.length === 1) {
      const member = selectedMemberObjects[0];
      await openWhatsApp(member.phone, `Hi ${member.name.split(' ')[0]}!\n\n${msg}`);
      triggerSuccess();
      return;
    }

    Alert.alert(
      `Send All to ${selectedMemberObjects.length} Members`,
      `This will open WhatsApp for each member one by one starting with ${selectedMemberObjects[0].name.split(' ')[0]}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start',
          onPress: async () => {
            const first = selectedMemberObjects[0];
            await openWhatsApp(first.phone, `Hi ${first.name.split(' ')[0]}!\n\n${msg}`);
            const syntheticContent: ShareableContent = {
              id: 'bulk',
              type: 'document',
              title: 'All Content',
              description: '',
              icon: null,
              color: '#FFD700',
              shareUrl: APP_SHARE_URL,
              shareText: allText};
            setQueueContent(syntheticContent);
            setQueueIndex(0);
          }},
      ]
    );
  }, [selectedMemberObjects, customMessage, openWhatsApp, triggerSuccess]);

  const handleCopyAll = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const allText = SHAREABLE_CONTENT.map(c => `📌 ${c.title}\n${c.shareText}\n${c.shareUrl}`).join('\n\n');
    const msg = customMessage ? `${customMessage}\n\n${allText}` : allText;
    await Clipboard.setStringAsync(msg);
    setCopiedId('all');
    setTimeout(() => setCopiedId(null), 2000);
    triggerSuccess();
    logger.shareContent.log('Copied all content to clipboard');
  }, [customMessage, triggerSuccess]);

  const roles = useMemo(() => ['developer', 'investor', 'advisor', 'designer', 'manager'], []);

  const renderContentCard = useCallback((content: ShareableContent) => (
    <View key={content.id} style={styles.contentCard}>
      <View style={styles.contentCardHeader}>
        <View style={[styles.contentIconWrap, { backgroundColor: `${content.color}15` }]}>
          {content.icon}
        </View>
        <View style={styles.contentInfo}>
          <Text style={styles.contentTitle}>{content.title}</Text>
          <Text style={styles.contentDesc}>{content.description}</Text>
        </View>
      </View>

      <View style={styles.shareActions}>
        <TouchableOpacity
          style={[styles.shareBtn, styles.whatsappBtn]}
          onPress={() => shareViaWhatsAppToSelected(content)}
          testID={`share-wa-${content.id}`}
        >
          <MessageCircle size={16} color="#fff" />
          <Text style={styles.shareBtnText}>WhatsApp</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.shareBtn, styles.emailBtn]}
          onPress={() => shareViaEmail(content)}
          testID={`share-email-${content.id}`}
        >
          <Mail size={16} color="#fff" />
          <Text style={styles.shareBtnText}>Email</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.shareBtn, styles.smsBtn]}
          onPress={() => shareViaSMS(content)}
          testID={`share-sms-${content.id}`}
        >
          <Phone size={16} color="#fff" />
          <Text style={styles.shareBtnText}>SMS</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.shareBtn, styles.copyBtn]}
          onPress={() => copyShareLink(content)}
          testID={`share-copy-${content.id}`}
        >
          {copiedId === content.id ? (
            <CheckCircle size={16} color="#00C48C" />
          ) : (
            <Copy size={16} color={Colors.text} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  ), [copiedId, shareViaWhatsAppToSelected, shareViaEmail, shareViaSMS, copyShareLink]);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Animated.View style={[styles.inner, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="share-back">
              <ArrowLeft size={22} color={Colors.text} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>Share Hub</Text>
              <Text style={styles.headerSub}>Send to team in seconds</Text>
            </View>
            <View style={styles.headerRight}>
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <Share2 size={20} color="#FFD700" />
              </Animated.View>
            </View>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Users size={16} color="#FFD700" />
                <Text style={styles.sectionTitle}>Team Members</Text>
                <TouchableOpacity onPress={selectAllMembers} style={styles.selectAllBtn} testID="select-all-btn">
                  <Text style={styles.selectAllText}>
                    {filteredMembers.every(m => selectedMembers.includes(m.id)) ? 'Deselect All' : 'Select All'}
                  </Text>
                </TouchableOpacity>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.roleFilter}>
                <TouchableOpacity
                  style={[styles.roleChip, !filterRole && styles.roleChipActive]}
                  onPress={() => { setFilterRole(null); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  testID="filter-all"
                >
                  <Text style={[styles.roleChipText, !filterRole && styles.roleChipTextActive]}>All</Text>
                </TouchableOpacity>
                {roles.map(role => (
                  <TouchableOpacity
                    key={role}
                    style={[
                      styles.roleChip,
                      filterRole === role && { backgroundColor: `${ROLE_COLORS[role]}20`, borderColor: ROLE_COLORS[role] },
                    ]}
                    onPress={() => { setFilterRole(filterRole === role ? null : role); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                    testID={`filter-${role}`}
                  >
                    {ROLE_ICONS[role]}
                    <Text style={[styles.roleChipText, filterRole === role && { color: ROLE_COLORS[role] }]}>
                      {role.charAt(0).toUpperCase() + role.slice(1)}s
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={styles.membersGrid}>
                {filteredMembers.map(member => {
                  const isSelected = selectedMembers.includes(member.id);
                  const roleColor = ROLE_COLORS[member.role];
                  return (
                    <TouchableOpacity
                      key={member.id}
                      style={[styles.memberCard, isSelected && { borderColor: roleColor, backgroundColor: `${roleColor}08` }]}
                      onPress={() => toggleMember(member.id)}
                      onLongPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                        Alert.alert(
                          `Quick Share to ${member.name.split(' ')[0]}`,
                          'Which content do you want to share?',
                          [
                            ...SHAREABLE_CONTENT.map(c => ({
                              text: c.title,
                              onPress: () => shareToWhatsAppDirect(member, c)})),
                            { text: 'Cancel', style: 'cancel' as const },
                          ]
                        );
                      }}
                      testID={`member-${member.id}`}
                    >
                      <View style={[styles.memberAvatar, { backgroundColor: `${roleColor}25` }]}>
                        <Text style={[styles.memberAvatarText, { color: roleColor }]}>{member.avatar}</Text>
                        {isSelected && (
                          <View style={[styles.checkMark, { backgroundColor: roleColor }]}>
                            <CheckCircle size={10} color="#fff" />
                          </View>
                        )}
                      </View>
                      <Text style={styles.memberName} numberOfLines={1}>{member.name.split(' ')[0]}</Text>
                      <View style={[styles.roleBadge, { backgroundColor: `${roleColor}15` }]}>
                        <Text style={[styles.roleBadgeText, { color: roleColor }]}>
                          {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {selectedMembers.length > 0 && (
                <View style={styles.selectedBar}>
                  <Text style={styles.selectedBarText}>
                    {selectedMembers.length} {selectedMembers.length === 1 ? 'member' : 'members'} selected
                  </Text>
                  <TouchableOpacity onPress={() => setSelectedMembers([])} style={styles.clearBtn} testID="clear-selection">
                    <X size={14} color={Colors.textSecondary} />
                    <Text style={styles.clearBtnText}>Clear</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Send size={16} color="#4A90D9" />
                <Text style={styles.sectionTitle}>Custom Message</Text>
              </View>
              <TextInput
                style={styles.messageInput}
                placeholder="Add a personal note (optional)..."
                placeholderTextColor={Colors.textTertiary}
                value={customMessage}
                onChangeText={setCustomMessage}
                multiline
                numberOfLines={2}
                testID="custom-message-input"
              />
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Sparkles size={16} color="#FFD700" />
                <Text style={styles.sectionTitle}>Share Content</Text>
              </View>
              {SHAREABLE_CONTENT.map(renderContentCard)}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Zap size={16} color="#FF6B35" />
                <Text style={styles.sectionTitle}>Quick Share All</Text>
              </View>
              <TouchableOpacity
                style={styles.bulkShareBtn}
                onPress={handleBulkShareWhatsApp}
                testID="bulk-share-btn"
              >
                <View style={styles.bulkShareInner}>
                  <MessageCircle size={22} color="#fff" />
                  <View>
                    <Text style={styles.bulkShareTitle}>Send All via WhatsApp</Text>
                    <Text style={styles.bulkShareSub}>
                      Share everything with {selectedMembers.length > 0 ? `${selectedMembers.length} ${selectedMembers.length === 1 ? 'member' : 'members'}` : 'selected team'}
                    </Text>
                  </View>
                </View>
                <ChevronRight size={18} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.copyAllBtn}
                onPress={handleCopyAll}
                testID="copy-all-btn"
              >
                <View style={styles.bulkShareInner}>
                  {copiedId === 'all' ? (
                    <CheckCircle size={22} color="#00C48C" />
                  ) : (
                    <Link2 size={22} color={Colors.text} />
                  )}
                  <View>
                    <Text style={[styles.bulkShareTitle, { color: Colors.text }]}>Copy All Content</Text>
                    <Text style={styles.bulkShareSub}>Copy all links & descriptions to clipboard</Text>
                  </View>
                </View>
                <ChevronRight size={18} color={Colors.textTertiary} />
              </TouchableOpacity>
            </View>

            <View style={styles.tipBox}>
              <Clock size={14} color="#FFD700" />
              <Text style={styles.tipText}>
                Long-press a team member to instantly share a specific content piece via WhatsApp
              </Text>
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        </Animated.View>

        {showSuccess && (
          <Animated.View style={[styles.successToast, {
            opacity: successAnim,
            transform: [{ scale: successAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }]}]}>
            <CheckCircle size={20} color="#00C48C" />
            <Text style={styles.successText}>Shared successfully!</Text>
          </Animated.View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060608'},
  safeArea: {
    flex: 1},
  inner: {
    flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12},
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center'},
  headerCenter: {
    flex: 1},
  headerTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.3},
  headerSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1},
  headerRight: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,215,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center'},
  scroll: {
    flex: 1,
    backgroundColor: Colors.background},
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 80},
  section: {
    marginBottom: 24},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12},
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    flex: 1},
  selectAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255,215,0,0.1)'},
  selectAllText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#FFD700'},
  roleFilter: {
    marginBottom: 12},
  roleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginRight: 8},
  roleChipActive: {
    backgroundColor: 'rgba(255,215,0,0.12)',
    borderColor: '#FFD700'},
  roleChipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  roleChipTextActive: {
    color: '#FFD700'},
  membersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10},
  memberCard: {
    width: (SW - 32 - 30) / 4,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1.5,
    borderColor: 'transparent'},
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6},
  memberAvatarText: {
    fontSize: 14,
    fontWeight: '800' as const},
  checkMark: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#060608'},
  memberName: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.text,
    textAlign: 'center'},
  roleBadge: {
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6},
  roleBadgeText: {
    fontSize: 8,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.3},
  selectedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,215,0,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.15)'},
  selectedBarText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#FFD700'},
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4},
  clearBtnText: {
    fontSize: 12,
    color: Colors.textSecondary},
  messageInput: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Colors.text,
    fontSize: 14,
    minHeight: 52,
    textAlignVertical: 'top'},
  contentCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'},
  contentCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12},
  contentIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'},
  contentInfo: {
    flex: 1},
  contentTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text},
  contentDesc: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2},
  shareActions: {
    flexDirection: 'row',
    gap: 8},
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center'},
  whatsappBtn: {
    backgroundColor: '#25D366'},
  emailBtn: {
    backgroundColor: '#4A90D9'},
  smsBtn: {
    backgroundColor: '#FF6B35'},
  copyBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    flex: 0,
    paddingHorizontal: 10},
  shareBtnText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#fff'},
  bulkShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#25D366',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10},
  bulkShareInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1},
  bulkShareTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#fff'},
  bulkShareSub: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 1},
  copyAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)'},
  tipBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,215,0,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.1)'},
  tipText: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 16},
  successToast: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,196,140,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(0,196,140,0.3)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24},
  successText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#00C48C'}});
