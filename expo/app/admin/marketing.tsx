import React, { useState, useCallback, useMemo } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  Modal,
  Switch,
  Share,
  Platform,
  Linking,
  Clipboard,
  KeyboardAvoidingView,
  Animated} from "react-native";
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { safeSetString } from '@/lib/safe-clipboard';
import {
  Brain,
  Users,
  Send,
  Sparkles,
  Target,
  TrendingUp,
  MessageSquare,
  Mail,
  Bell,
  Star,
  User,
  Activity,
  Clock,
  AlertTriangle,
  X,
  Search,
  RefreshCw,
  Zap,
  Heart,
  DollarSign,
  Share2,
  CheckCircle,
  Copy,
  BarChart3,
  Globe,
  Bot,
  UserCheck,
  Filter,
  Instagram,
  Facebook,
  Twitter,
  Linkedin,
  MessageCircle,
  Link,
  ExternalLink,
  Check,
  ImageIcon,
  Download,
  Video,
  Play,
  Plus,
  Upload,
  ArrowLeft} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { formatCurrency as _fmtCurr } from '@/lib/formatters';
import { generateText } from '@/lib/ai-service';
import {
  getInactiveMembers,
  getEngagementStats,
  getBroadcastStats} from '@/mocks/admin';
import {
  mockInfluencers,
  mockGrowthStats,
  mockReferralStats,
  mockAIInsights,
  getInfluencerStats,
  mockTrackableLinks,
  mockLinkEvents,
  getLinkAnalytics,
  generateTrackableLink} from '@/mocks/marketing';
import { MemberEngagementStats, Influencer, AIMarketingInsight, TrackableLink, LinkEvent, SocialPlatform } from '@/types';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type TabType = 'intelligence' | 'engage' | 'content' | 'influencers' | 'analytics' | 'links';

interface MediaItem {
  id: string;
  uri: string;
  type: 'image' | 'video';
  duration?: number;
}

const MAX_MEDIA_COUNT = 8;

interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  investmentTotal: number;
  riskLevel: 'active' | 'at_risk' | 'inactive' | 'churned';
  daysSinceLastActivity: number;
  preferredChannel: 'email' | 'push' | 'sms';
  interests: string[];
  engagementScore: number;
  aiSummary: string;
  predictedAction: string;
  bestTimeToContact: string;
  personalizedTone: 'formal' | 'friendly' | 'enthusiastic';
}

interface SmartMessage {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  message: string;
  channel: 'email' | 'push' | 'sms';
  personalizationScore: number;
  status: 'draft' | 'scheduled' | 'sent';
  scheduledFor?: string;
}

const formatCurrency = (amount: number) => _fmtCurr(amount);

const formatNumber = (num: number) => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
};

export default function AIMarketingHub() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('intelligence');
  const [searchQuery, setSearchQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [generatedMessage, setGeneratedMessage] = useState('');
  const [smartMessages, setSmartMessages] = useState<SmartMessage[]>([]);
  const [aiEnabled, setAiEnabled] = useState(true);

  const [contentTopic, setContentTopic] = useState('');
  const [generatedContent, setGeneratedContent] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('instagram');
  const [showShareModal, setShowShareModal] = useState(false);
  const [copiedPlatform, setCopiedPlatform] = useState<string | null>(null);

  const [trackableLinks, setTrackableLinks] = useState<TrackableLink[]>(mockTrackableLinks);
  const [linkEvents] = useState<LinkEvent[]>(mockLinkEvents);
  const [showCreateLinkModal, setShowCreateLinkModal] = useState(false);
  const [newLinkName, setNewLinkName] = useState('');
  const [newLinkSource, setNewLinkSource] = useState<TrackableLink['source']>('social');
  const [newLinkPlatform, setNewLinkPlatform] = useState<SocialPlatform | undefined>('instagram');
  const [selectedLink, setSelectedLink] = useState<TrackableLink | null>(null);
  const [showLinkDetailModal, setShowLinkDetailModal] = useState(false);
  const [contentLink, setContentLink] = useState<TrackableLink | null>(null);
  const [isCreatingLink, setIsCreatingLink] = useState(false);

  const [imagePrompt, setImagePrompt] = useState('');
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imageSize, setImageSize] = useState<'1024x1024' | '1024x1792' | '1792x1024'>('1024x1024');

  const [videoPrompt, setVideoPrompt] = useState('');
  const [generatedVideo, setGeneratedVideo] = useState<{ url: string; script: string; videoUrl: string } | null>(null);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [isPlayingVideo, setIsPlayingVideo] = useState(false);
  const [videoDuration, setVideoDuration] = useState<'15' | '30' | '60'>('30');

  const [uploadedMedia, setUploadedMedia] = useState<MediaItem[]>([]);
  const [mediaCaption, setMediaCaption] = useState('');
  const [isSharingMedia, setIsSharingMedia] = useState(false);
  const [showMediaShareModal, setShowMediaShareModal] = useState(false);
  const [selectedMediaPlatforms, setSelectedMediaPlatforms] = useState<Set<string>>(new Set(['instagram', 'facebook', 'tiktok']));

  const [imageProgress, setImageProgress] = useState(0);
  const [videoProgress, setVideoProgress] = useState(0);
  const imageProgressAnim = useState(new Animated.Value(0))[0];
  const videoProgressAnim = useState(new Animated.Value(0))[0];

  const socialPlatforms = [
    { id: 'instagram', name: 'Instagram', icon: Instagram, color: '#E4405F', scheme: 'instagram://' },
    { id: 'facebook', name: 'Facebook', icon: Facebook, color: '#1877F2', scheme: 'fb://' },
    { id: 'twitter', name: 'X (Twitter)', icon: Twitter, color: '#000000', scheme: 'twitter://' },
    { id: 'linkedin', name: 'LinkedIn', icon: Linkedin, color: '#0A66C2', scheme: 'linkedin://' },
    { id: 'tiktok', name: 'TikTok', icon: Globe, color: '#000000', scheme: 'tiktok://' },
    { id: 'whatsapp', name: 'WhatsApp', icon: MessageCircle, color: '#25D366', scheme: 'whatsapp://' },
    { id: 'telegram', name: 'Telegram', icon: Send, color: '#0088CC', scheme: 'tg://' },
    { id: 'email', name: 'Email', icon: Mail, color: '#EA4335', scheme: 'mailto:' },
  ];

  const engagementStats = useMemo(() => getEngagementStats(), []);
  const influencerStats = useMemo(() => getInfluencerStats(), []);
  const broadcastStats = useMemo(() => getBroadcastStats(), []);
  const linkAnalytics = useMemo(() => getLinkAnalytics(), []);

  const userProfiles: UserProfile[] = useMemo(() => {
    const inactive = getInactiveMembers(1);
    return inactive.map((m: MemberEngagementStats) => ({
      id: m.memberId,
      name: m.memberName,
      email: m.memberEmail,
      avatar: m.memberAvatar,
      investmentTotal: m.totalInvested,
      riskLevel: m.riskLevel,
      daysSinceLastActivity: m.daysSinceLastActivity,
      preferredChannel: m.daysSinceLastActivity > 5 ? 'email' : 'push' as const,
      interests: ['Real Estate', 'Passive Income', m.totalInvested > 50000 ? 'High-Value Properties' : 'Starter Properties'],
      engagementScore: m.engagementScore,
      aiSummary: `${m.memberName} is a ${m.riskLevel.replace('_', ' ')} investor with ${formatCurrency(m.totalInvested)} invested. Last active ${m.daysSinceLastActivity} days ago.`,
      predictedAction: m.riskLevel === 'churned' ? 'Likely to leave' : m.riskLevel === 'at_risk' ? 'May become inactive' : 'Potential reinvestment',
      bestTimeToContact: m.daysSinceLastActivity > 3 ? 'Morning (9-11 AM)' : 'Evening (6-8 PM)',
      personalizedTone: m.totalInvested > 50000 ? 'formal' : 'friendly' as const}));
  }, []);

  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return userProfiles;
    const q = searchQuery.toLowerCase();
    return userProfiles.filter(u => 
      u.name.toLowerCase().includes(q) || 
      u.email.toLowerCase().includes(q) ||
      u.riskLevel.includes(q)
    );
  }, [userProfiles, searchQuery]);

  const getRiskColor = (risk: UserProfile['riskLevel']) => {
    switch (risk) {
      case 'active': return Colors.positive;
      case 'at_risk': return Colors.warning;
      case 'inactive': return Colors.accent;
      case 'churned': return Colors.negative;
    }
  };

  const generatePersonalizedMessage = useCallback(async (user: UserProfile) => {
    setIsGenerating(true);
    setSelectedUser(user);
    setShowUserModal(true);
    console.log('[AI Marketing] Starting personalized message generation for:', user.name);

    try {
      const prompt = `Generate a highly personalized re-engagement message for an investor.

USER PROFILE:
- Name: ${user.name}
- Investment: ${formatCurrency(user.investmentTotal)}
- Status: ${user.riskLevel.replace('_', ' ')}
- Days inactive: ${user.daysSinceLastActivity}
- Interests: ${user.interests.join(', ')}
- Preferred tone: ${user.personalizedTone}
- Engagement score: ${user.engagementScore}%

REQUIREMENTS:
- Use a ${user.personalizedTone} tone
- Reference their investment level appropriately
- Be specific to their interests
- Include a compelling call to action
- Keep it concise (2-3 paragraphs)
- From IVX HOLDINGS LLC

Only output the message body, no subject line.`;

      console.log('[AI Marketing] Sending request to generateText API...');
      const response = await generateText({ messages: [{ role: 'user', content: prompt }] });
      console.log('[AI Marketing] Response received, length:', response?.length);
      
      if (response && typeof response === 'string' && response.trim().length > 0) {
        setGeneratedMessage(response);
        console.log('[AI Marketing] AI generated personalized message successfully for:', user.name);
      } else {
        throw new Error('Empty or invalid response from AI');
      }
    } catch (error) {
      console.error('[AI Marketing] Error generating message:', error);
      const fallbackMessage = `Dear ${user.name},\n\nWe noticed it's been a while since you last explored investment opportunities with IVX HOLDINGS. As a valued investor with ${formatCurrency(user.investmentTotal)} in your portfolio, we wanted to personally reach out.\n\nWe have exciting new properties that match your interests in ${user.interests[0]}. Your next great investment could be waiting!\n\nBest regards,\nIVX HOLDINGS Team`;
      setGeneratedMessage(fallbackMessage);
      console.log('[AI Marketing] Using fallback message for:', user.name);
    } finally {
      setIsGenerating(false);
    }
  }, [])

  const generateBulkSmartMessages = useCallback(async () => {
    const atRiskUsers = userProfiles.filter(u => u.riskLevel === 'at_risk' || u.riskLevel === 'inactive');
    
    if (atRiskUsers.length === 0) {
      Alert.alert('No Users', 'No at-risk or inactive users found.');
      return;
    }

    console.log('[AI Marketing] Starting bulk smart message generation for', atRiskUsers.length, 'users');

    Alert.alert(
      'AI Smart Campaign',
      `Generate personalized messages for ${atRiskUsers.length} users? AI will analyze each user profile and create tailored content.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate',
          onPress: async () => {
            setIsGenerating(true);
            const messages: SmartMessage[] = [];

            for (const user of atRiskUsers.slice(0, 5)) {
              try {
                const prompt = `Generate a short personalized message for ${user.name}, inactive for ${user.daysSinceLastActivity} days, with ${formatCurrency(user.investmentTotal)} invested. Tone: ${user.personalizedTone}. Keep under 100 words.`;
                console.log('[AI Marketing] Generating message for:', user.name);
                const response = await generateText({ messages: [{ role: 'user', content: prompt }] });
                
                if (response && typeof response === 'string' && response.trim().length > 0) {
                  messages.push({
                    id: `msg-${Date.now()}-${user.id}`,
                    userId: user.id,
                    userName: user.name,
                    userEmail: user.email,
                    message: response,
                    channel: user.preferredChannel,
                    personalizationScore: Math.floor(Math.random() * 20) + 80,
                    status: 'draft'});
                  console.log('[AI Marketing] Message generated for:', user.name);
                } else {
                  throw new Error('Empty response');
                }
              } catch (err) {
                console.error('[AI Marketing] Error for user', user.name, err);
                messages.push({
                  id: `msg-${Date.now()}-${user.id}`,
                  userId: user.id,
                  userName: user.name,
                  userEmail: user.email,
                  message: `Dear ${user.name}, we miss you at IVX HOLDINGS! Check out new investment opportunities today.`,
                  channel: user.preferredChannel,
                  personalizationScore: 65,
                  status: 'draft'});
              }
            }

            setSmartMessages(messages);
            setIsGenerating(false);
            console.log('[AI Marketing] Bulk generation complete:', messages.length, 'messages');
            Alert.alert('Success', `Generated ${messages.length} personalized messages!`);
          }},
      ]
    );
  }, [userProfiles])

  const generateSocialContent = useCallback(async () => {
    setIsGenerating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    console.log('[AI Content] ========== STARTING CONTENT GENERATION ==========');
    console.log('[AI Content] Platform:', selectedPlatform);
    console.log('[AI Content] Topic:', contentTopic || '(auto-generate)');
    
    try {
      const topicToUse = contentTopic.trim() || 'real estate investment opportunities with fractional ownership';
      
      const prompt = `Create a ${selectedPlatform} post about "${topicToUse}" for IVX HOLDINGS, a real estate investment platform.

Requirements:
- Engaging and shareable
- Platform-optimized for ${selectedPlatform}
- Include emojis
- Add relevant hashtags
- Professional but approachable
- Make it compelling and action-oriented
- Output ONLY the post content, nothing else`;

      console.log('[AI Content] Calling generateText API with messages format...');
      console.log('[AI Content] Prompt length:', prompt.length);
      
      const response = await generateText({ messages: [{ role: 'user', content: prompt }] });
      
      console.log('[AI Content] Response received');
      console.log('[AI Content] Response type:', typeof response);
      console.log('[AI Content] Response length:', response?.length);
      console.log('[AI Content] Response preview:', response?.substring(0, 100));
      
      if (response && typeof response === 'string' && response.trim().length > 0) {
        setGeneratedContent(response.trim());
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        console.log('[AI Content] ✅ Content generated successfully for:', selectedPlatform);
      } else {
        console.error('[AI Content] ❌ Invalid response - empty or wrong type');
        throw new Error('Empty or invalid response from AI');
      }
    } catch (error) {
      console.error('[AI Content] ❌ Generation error:', error);
      console.error('[AI Content] Error details:', error instanceof Error ? error.message : 'Unknown error');
      
      const topicToUse = contentTopic.trim() || 'Real Estate Investment';
      const fallbackContent = `🏠 ${topicToUse}\n\n💰 Invest in premium real estate starting at just $100 with IVX HOLDINGS!\n\n✅ Monthly dividends\n✅ Full transparency\n✅ Diversified portfolio\n✅ No landlord headaches\n\n🔗 Start your investment journey today!\n\n#IPXHolding #RealEstateInvesting #PassiveIncome #FractionalOwnership #WealthBuilding`;
      setGeneratedContent(fallbackContent);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      console.log('[AI Content] Using fallback content');
      Alert.alert('Note', 'Using pre-made content template. AI generation will be available shortly.');
    } finally {
      setIsGenerating(false);
      console.log('[AI Content] ========== GENERATION COMPLETE ==========');
    }
  }, [contentTopic, selectedPlatform])

  const sendMessage = useCallback(async () => {
    if (!selectedUser || !generatedMessage) return;

    Alert.alert(
      'Send Message',
      `Send personalized message to ${selectedUser.name} via ${selectedUser.preferredChannel}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: () => {
            setShowUserModal(false);
            setGeneratedMessage('');
            setSelectedUser(null);
            Alert.alert('Sent!', `Message sent to ${selectedUser.name}`);
          }},
      ]
    );
  }, [selectedUser, generatedMessage]);

  const handleCopyContent = useCallback(async () => {
    if (!generatedContent) return;
    try {
      await safeSetString(generatedContent);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopiedPlatform('clipboard');
      setTimeout(() => setCopiedPlatform(null), 2000);
      console.log('Content copied to clipboard');
    } catch (error) {
      console.error('Copy error:', error);
      Alert.alert('Error', 'Failed to copy content');
    }
  }, [generatedContent]);

  const handleNativeShare = useCallback(async () => {
    if (!generatedContent) return;
    try {
      const result = await Share.share({
        message: generatedContent,
        title: 'Share to Social Media'});
      if (result.action === Share.sharedAction) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        console.log('Content shared successfully');
        setShowShareModal(false);
      }
    } catch (error) {
      console.error('Share error:', error);
    }
  }, [generatedContent]);

  const handlePlatformShare = useCallback(async (platformId: string) => {
    if (!generatedContent) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const encodedText = encodeURIComponent(generatedContent);
    let url = '';

    switch (platformId) {
      case 'whatsapp':
        url = `whatsapp://send?text=${encodedText}`;
        break;
      case 'telegram':
        url = `tg://msg?text=${encodedText}`;
        break;
      case 'twitter':
        url = `twitter://post?message=${encodedText}`;
        if (Platform.OS === 'web') {
          url = `https://twitter.com/intent/tweet?text=${encodedText}`;
        }
        break;
      case 'facebook':
        url = Platform.OS === 'web' 
          ? `https://www.facebook.com/sharer/sharer.php?quote=${encodedText}`
          : `fb://share?quote=${encodedText}`;
        break;
      case 'linkedin':
        url = `https://www.linkedin.com/sharing/share-offsite/?url=https://ipxholding.com&summary=${encodedText}`;
        break;
      case 'email':
        url = `mailto:?subject=IVX HOLDINGS&body=${encodedText}`;
        break;
      case 'instagram':
      case 'tiktok':
        await safeSetString(generatedContent);
        setCopiedPlatform(platformId);
        setTimeout(() => setCopiedPlatform(null), 2000);
        Alert.alert(
          'Content Copied!',
          `Content copied to clipboard. Open ${platformId === 'instagram' ? 'Instagram' : 'TikTok'} and paste it in your post.`,
          [{ text: 'OK' }]
        );
        return;
      default:
        handleNativeShare();
        return;
    }

    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        console.log(`Opened ${platformId} for sharing`);
      } else if (Platform.OS === 'web' && url.startsWith('http')) {
        window.open(url, '_blank');
      } else {
        await safeSetString(generatedContent);
        setCopiedPlatform(platformId);
        setTimeout(() => setCopiedPlatform(null), 2000);
        Alert.alert('App Not Installed', `Content copied. Please open ${platformId} manually and paste.`);
      }
    } catch (error) {
      console.error('Platform share error:', error);
      handleNativeShare();
    }
  }, [generatedContent, handleNativeShare]);

  const openShareModal = useCallback(() => {
    if (!generatedContent) {
      Alert.alert('No Content', 'Please generate content first');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowShareModal(true);
  }, [generatedContent]);

  const handleCreateLink = useCallback(() => {
    if (!newLinkName.trim()) {
      Alert.alert('Error', 'Please enter a link name');
      return;
    }
    const newLink = generateTrackableLink(newLinkName, newLinkSource, newLinkPlatform);
    setTrackableLinks(prev => [newLink, ...prev]);
    setShowCreateLinkModal(false);
    setNewLinkName('');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Success', 'Trackable link created!');
    console.log('Created new trackable link:', newLink.shortCode);
  }, [newLinkName, newLinkSource, newLinkPlatform]);

  const handleCopyLink = useCallback(async (link: TrackableLink) => {
    try {
      await safeSetString(link.fullUrl);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopiedPlatform(link.id);
      setTimeout(() => setCopiedPlatform(null), 2000);
      console.log('Copied link:', link.fullUrl);
    } catch (error) {
      console.error('Copy error:', error);
    }
  }, []);

  const handleViewLinkDetail = useCallback((link: TrackableLink) => {
    setSelectedLink(link);
    setShowLinkDetailModal(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleWrapInLink = useCallback(async () => {
    if (!generatedContent) {
      Alert.alert('No Content', 'Please generate content first');
      return;
    }
    setIsCreatingLink(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    setTimeout(() => {
      const linkName = `${selectedPlatform.charAt(0).toUpperCase() + selectedPlatform.slice(1)} Content - ${new Date().toLocaleDateString()}`;
      const newLink = generateTrackableLink(linkName, 'social', selectedPlatform as SocialPlatform);
      setContentLink(newLink);
      setTrackableLinks(prev => [newLink, ...prev]);
      setIsCreatingLink(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      console.log('Created content trackable link:', newLink.shortCode);
    }, 800);
  }, [generatedContent, selectedPlatform]);

  const handleCopyContentLink = useCallback(async () => {
    if (!contentLink) return;
    try {
      if (Platform.OS === 'web') {
        await navigator.clipboard.writeText(contentLink.fullUrl);
      } else {
        Clipboard.setString(contentLink.fullUrl);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopiedPlatform('contentLink');
      setTimeout(() => setCopiedPlatform(null), 2000);
      console.log('Copied content link:', contentLink.fullUrl);
    } catch (error) {
      console.error('Copy error:', error);
    }
  }, [contentLink]);

  const getWrappedContent = useCallback(() => {
    if (!contentLink || !generatedContent) return '';
    const lines = generatedContent.split('\n');
    let wrappedText = '';
    let insertedLink = false;
    
    for (let i = 0; i < lines.length; i++) {
      wrappedText += lines[i] + '\n';
      if (!insertedLink && lines[i].includes('🔗')) {
        wrappedText += `👉 ${contentLink.fullUrl}\n`;
        insertedLink = true;
      }
    }
    
    if (!insertedLink) {
      wrappedText += `\n🔗 Start your journey: ${contentLink.fullUrl}`;
    }
    
    return wrappedText.trim();
  }, [contentLink, generatedContent]);

  const handleCopyWrappedContent = useCallback(async () => {
    const wrappedText = getWrappedContent();
    if (!wrappedText) return;
    try {
      await safeSetString(wrappedText);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopiedPlatform('wrappedContent');
      setTimeout(() => setCopiedPlatform(null), 2000);
      Alert.alert('Copied!', 'Full message with link copied to clipboard');
      console.log('Copied wrapped content with link');
    } catch (error) {
      console.error('Copy error:', error);
    }
  }, [getWrappedContent]);

  const handleShareContentLink = useCallback(async () => {
    if (!contentLink) return;
    const shareText = getWrappedContent();
    try {
      if (Platform.OS === 'web') {
        await safeSetString(shareText);
        Alert.alert('Copied!', 'Content with link copied to clipboard');
      } else {
        await Share.share({
          message: shareText,
          title: 'IVX HOLDINGS'});
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Share error:', error);
    }
  }, [contentLink, getWrappedContent]);

  const pickMedia = useCallback(async () => {
    if (uploadedMedia.length >= MAX_MEDIA_COUNT) {
      Alert.alert('Limit Reached', `You can only upload up to ${MAX_MEDIA_COUNT} items`);
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please grant access to your photo library to upload media');
      return;
    }

    const remainingSlots = MAX_MEDIA_COUNT - uploadedMedia.length;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      selectionLimit: remainingSlots,
      quality: 0.8,
      videoMaxDuration: 60});

    if (!result.canceled && result.assets) {
      const newMedia: MediaItem[] = result.assets.map((asset, index) => ({
        id: `media-${Date.now()}-${index}`,
        uri: asset.uri,
        type: asset.type === 'video' ? 'video' : 'image',
        duration: asset.duration ?? undefined}));

      setUploadedMedia(prev => [...prev, ...newMedia].slice(0, MAX_MEDIA_COUNT));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      console.log('[Media Upload] Added', newMedia.length, 'media items');
    }
  }, [uploadedMedia.length]);

  const removeMedia = useCallback((id: string) => {
    setUploadedMedia(prev => prev.filter(item => item.id !== id));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const toggleMediaPlatform = useCallback((platformId: string) => {
    setSelectedMediaPlatforms(prev => {
      const newSet = new Set(prev);
      if (newSet.has(platformId)) {
        newSet.delete(platformId);
      } else {
        newSet.add(platformId);
      }
      return newSet;
    });
  }, []);

  const generateMediaCaption = useCallback(async () => {
    if (uploadedMedia.length === 0) {
      Alert.alert('No Media', 'Please add images or videos first to generate a caption');
      return;
    }

    setIsGenerating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const mediaTypes = uploadedMedia.map(m => m.type).join(', ');
      const prompt = `Create an engaging social media caption for a real estate investment platform post. The post contains ${uploadedMedia.length} ${mediaTypes}.

Requirements:
- Engaging and shareable
- Include emojis
- Add relevant hashtags for real estate and investment
- Professional but approachable
- Make it compelling and action-oriented
- Output ONLY the caption, nothing else`;

      const response = await generateText({ messages: [{ role: 'user', content: prompt }] });
      
      if (response && typeof response === 'string' && response.trim().length > 0) {
        setMediaCaption(response.trim());
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        throw new Error('Empty response');
      }
    } catch (error) {
      console.error('[Media Caption] Error:', error);
      const fallbackCaption = `🏠 Discover premium real estate investment opportunities!\n\n💰 Start with as little as $100\n✅ Monthly dividends\n🌍 Global portfolio\n\n🔗 Join IVX HOLDINGS today!\n\n#RealEstate #Investment #PassiveIncome #IPXHolding #FractionalOwnership`;
      setMediaCaption(fallbackCaption);
    } finally {
      setIsGenerating(false);
    }
  }, [uploadedMedia]);

  const shareMediaToSocial = useCallback(async () => {
    if (uploadedMedia.length === 0) {
      Alert.alert('No Media', 'Please add at least one image or video to share');
      return;
    }

    if (selectedMediaPlatforms.size === 0) {
      Alert.alert('No Platforms', 'Please select at least one platform to share to');
      return;
    }

    setIsSharingMedia(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const platformNames = Array.from(selectedMediaPlatforms).map(id => {
        const platform = socialPlatforms.find(p => p.id === id);
        return platform?.name || id;
      }).join(', ');
      
      Alert.alert(
        'Content Shared!',
        `Your ${uploadedMedia.length} ${uploadedMedia.length === 1 ? 'item has' : 'items have'} been scheduled for sharing to:\n\n${platformNames}\n\nThe AI agents will optimize and schedule your posts for maximum engagement.`,
        [
          { 
            text: 'Share More', 
            onPress: () => {
              setUploadedMedia([]);
              setMediaCaption('');
            }
          },
          { text: 'Done', style: 'cancel' }
        ]
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      console.log('[Media Share] Shared to:', platformNames);
    } catch (error) {
      console.error('[Media Share] Error:', error);
      Alert.alert('Error', 'Failed to share content. Please try again.');
    } finally {
      setIsSharingMedia(false);
    }
  }, [uploadedMedia, mediaCaption, selectedMediaPlatforms, socialPlatforms]);

  const openMediaShareModal = useCallback(() => {
    if (uploadedMedia.length === 0) {
      Alert.alert('No Media', 'Please add at least one image or video first');
      return;
    }
    setShowMediaShareModal(true);
  }, [uploadedMedia]);

  const handleQuickShareMedia = useCallback(async (platformId: string) => {
    const shareText = mediaCaption || 'Check out this content from IVX HOLDINGS!';
    const encodedText = encodeURIComponent(shareText);
    
    let url = '';
    switch (platformId) {
      case 'whatsapp':
        url = Platform.OS === 'web' ? `https://wa.me/?text=${encodedText}` : `whatsapp://send?text=${encodedText}`;
        break;
      case 'telegram':
        url = `tg://msg?text=${encodedText}`;
        break;
      default:
        await safeSetString(shareText);
        Alert.alert('Copied!', `Caption copied. Open ${platformId} and paste with your media.`);
        return;
    }

    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        await Share.share({ message: shareText });
      }
    } catch (error) {
      console.error('Quick share error:', error);
      await Share.share({ message: shareText });
    }
  }, [mediaCaption]);

  const generateAIImage = useCallback(async () => {
    if (!imagePrompt.trim()) {
      Alert.alert('Error', 'Please enter an image description');
      return;
    }

    setIsGeneratingImage(true);
    setGeneratedImage(null);
    setImageProgress(0);
    imageProgressAnim.setValue(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    console.log('Starting AI image generation with prompt:', imagePrompt);
    console.log('Image size:', imageSize);

    const progressInterval = setInterval(() => {
      setImageProgress(prev => {
        const newProgress = Math.min(prev + Math.random() * 15, 90);
        Animated.timing(imageProgressAnim, {
          toValue: newProgress,
          duration: 300,
          useNativeDriver: false}).start();
        return newProgress;
      });
    }, 500);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    
    try {
      const requestBody = {
        prompt: `Professional marketing image for IVX HOLDINGS real estate investment platform: ${imagePrompt}. Style: Modern, clean, professional, high quality, suitable for social media marketing.`,
        size: imageSize};
      console.log('Request body:', JSON.stringify(requestBody));

      const { generateImage: aiGenImg } = await import('@/lib/ai-service');
      clearTimeout(timeoutId);
      const imgResult = await aiGenImg(requestBody.prompt, requestBody.size);

      let imageUri = '';

      if (imgResult?.base64Data) {
        imageUri = `data:${imgResult.mimeType};base64,${imgResult.base64Data}`;
        console.log('Image generated via AI service');
      }

      if (!imageUri) {
        console.error('Could not extract image from AI service');
        throw new Error('No image data received. Please try again.');
      }

      console.log('Final imageUri type:', imageUri.startsWith('data:') ? 'base64' : 'url');
      console.log('Setting generated image, URI length:', imageUri.length);
      clearInterval(progressInterval);
      setImageProgress(100);
      Animated.timing(imageProgressAnim, {
        toValue: 100,
        duration: 200,
        useNativeDriver: false}).start();
      setGeneratedImage(imageUri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      console.log('AI generated image successfully');
      Alert.alert('Success', 'Image generated successfully!');
    } catch (error) {
      clearInterval(progressInterval);
      clearTimeout(timeoutId);
      console.error('Image generation error:', error);
      let errorMessage = 'Unknown error occurred';
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = 'Request timed out. Please try again with a simpler prompt.';
        } else if (error.message.includes('fetch') || error.message.includes('network')) {
          errorMessage = 'Network error. Please check your connection and try again.';
        } else {
          errorMessage = error.message;
        }
      }
      Alert.alert('Generation Failed', errorMessage);
    } finally {
      setIsGeneratingImage(false);
      setImageProgress(0);
    }
  }, [imagePrompt, imageSize, imageProgressAnim]);

  const handleShareImage = useCallback(async () => {
    if (!generatedImage) return;
    try {
      if (Platform.OS === 'web') {
        const link = document.createElement('a');
        link.href = generatedImage;
        link.download = 'ipx-marketing-image.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        await Share.share({
          url: generatedImage,
          title: 'IVXHOLDINGS Marketing Image'});
      }
      console.log('Image shared/downloaded');
    } catch (error) {
      console.error('Share image error:', error);
    }
  }, [generatedImage]);

  const generateAIVideo = useCallback(async () => {
    if (!videoPrompt.trim()) {
      Alert.alert('Error', 'Please enter a video description');
      return;
    }

    setIsGeneratingVideo(true);
    setGeneratedVideo(null);
    setVideoProgress(0);
    videoProgressAnim.setValue(0);
    setIsPlayingVideo(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    console.log('Starting AI video generation with prompt:', videoPrompt);
    console.log('Video duration:', videoDuration);

    const progressInterval = setInterval(() => {
      setVideoProgress(prev => {
        const newProgress = Math.min(prev + Math.random() * 12, 90);
        Animated.timing(videoProgressAnim, {
          toValue: newProgress,
          duration: 300,
          useNativeDriver: false}).start();
        return newProgress;
      });
    }, 400);

    try {
      const scriptPrompt = `Create a ${videoDuration}-second video script for IVX HOLDINGS real estate investment marketing.

Topic: ${videoPrompt}

Format:
- Hook (first 3 seconds)
- Main message (middle)
- Call to action (end)

Requirements:
- Engaging and dynamic
- Suitable for ${selectedPlatform}
- Include visual cues in [brackets]
- Professional but exciting tone

Output just the script with timing notes.`;

      console.log('[AI Video] Generating video script...');
      const script = await generateText({ messages: [{ role: 'user', content: scriptPrompt }] });
      console.log('[AI Video] Script generated, length:', script?.length);
      
      const sampleVideos = [
        'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&h=450&fit=crop',
        'https://images.unsplash.com/photo-1582407947304-fd86f028f716?w=800&h=450&fit=crop',
        'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&h=450&fit=crop',
      ];
      const thumbnailUrl = sampleVideos[Math.floor(Math.random() * sampleVideos.length)];

      const sampleVideoUrls = [
        'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
        'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
      ];
      const videoUrl = sampleVideoUrls[Math.floor(Math.random() * sampleVideoUrls.length)];

      clearInterval(progressInterval);
      setVideoProgress(100);
      Animated.timing(videoProgressAnim, {
        toValue: 100,
        duration: 200,
        useNativeDriver: false}).start();

      setGeneratedVideo({
        url: thumbnailUrl,
        script: script,
        videoUrl: videoUrl});

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      console.log('AI video script generated successfully');
      Alert.alert('Video Script Ready!', 'Your AI-generated video script and concept is ready. Use this with your video editor or share the script with your team.');
    } catch (error) {
      console.error('Video generation error:', error);
      clearInterval(progressInterval);
      const fallbackScript = `[0-3s] HOOK: "Want to invest in real estate with just $100?"
[Visual: Stunning property aerial shot]

[4-${parseInt(videoDuration) - 5}s] MAIN: ${videoPrompt}
[Visual: Happy investors, property tours, growth charts]

[${parseInt(videoDuration) - 4}s-${videoDuration}s] CTA: "Start your journey with IVX HOLDINGS today!"
[Visual: App download, QR code]`;
      
      setVideoProgress(100);
      setGeneratedVideo({
        url: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&h=450&fit=crop',
        script: fallbackScript,
        videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'});
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setIsGeneratingVideo(false);
      setVideoProgress(0);
    }
  }, [videoPrompt, videoDuration, selectedPlatform, videoProgressAnim]);

  const handleShareVideoScript = useCallback(async () => {
    if (!generatedVideo?.script) return;
    try {
      if (Platform.OS === 'web') {
        await safeSetString(generatedVideo.script);
        Alert.alert('Copied!', 'Video script copied to clipboard');
      } else {
        await Share.share({
          message: generatedVideo.script,
          title: 'IVXHOLDINGS Video Script'});
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      console.log('Video script shared');
    } catch (error) {
      console.error('Share video script error:', error);
    }
  }, [generatedVideo]);

  const handleOpenGeneratedVideo = useCallback(async () => {
    if (!generatedVideo?.videoUrl) return;

    try {
      const canOpen = await Linking.canOpenURL(generatedVideo.videoUrl);
      if (!canOpen) {
        Alert.alert('Video unavailable', 'This generated video could not be opened on your device.');
        return;
      }

      await Linking.openURL(generatedVideo.videoUrl);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      console.log('Generated video opened');
    } catch (error) {
      console.error('Open generated video error:', error);
      Alert.alert('Video unavailable', 'Could not open this generated video right now.');
    }
  }, [generatedVideo]);

  const getEventIcon = (eventType: LinkEvent['eventType']) => {
    switch (eventType) {
      case 'click': return { icon: Globe, color: Colors.textSecondary };
      case 'download': return { icon: ExternalLink, color: Colors.accent };
      case 'registration': return { icon: UserCheck, color: Colors.positive };
      case 'investment': return { icon: DollarSign, color: Colors.primary };
    }
  };

  const getTimeAgo = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const renderIntelligence = () => (
    <View style={styles.tabContent}>
      <View style={styles.aiStatusCard}>
        <View style={styles.aiStatusHeader}>
          <View style={styles.aiStatusIcon}>
            <Brain size={24} color={aiEnabled ? Colors.positive : Colors.textSecondary} />
          </View>
          <View style={styles.aiStatusInfo}>
            <Text style={styles.aiStatusTitle}>AI Marketing Intelligence</Text>
            <Text style={styles.aiStatusSubtitle}>
              {aiEnabled ? 'Understanding your users in real-time' : 'AI is paused'}
            </Text>
          </View>
          <Switch
            value={aiEnabled}
            onValueChange={setAiEnabled}
            trackColor={{ false: Colors.border, true: Colors.positive + '50' }}
            thumbColor={aiEnabled ? Colors.positive : Colors.textTertiary}
          />
        </View>

        <View style={styles.aiFeatures}>
          <View style={styles.aiFeature}>
            <CheckCircle size={14} color={Colors.positive} />
            <Text style={styles.aiFeatureText}>User behavior analysis</Text>
          </View>
          <View style={styles.aiFeature}>
            <CheckCircle size={14} color={Colors.positive} />
            <Text style={styles.aiFeatureText}>Personalized messaging</Text>
          </View>
          <View style={styles.aiFeature}>
            <CheckCircle size={14} color={Colors.positive} />
            <Text style={styles.aiFeatureText}>Churn prediction</Text>
          </View>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statCard, styles.statCardPrimary]}>
          <Brain size={20} color="#000" />
          <Text style={styles.statValueDark}>{userProfiles.length}</Text>
          <Text style={styles.statLabelDark}>Users Analyzed</Text>
        </View>
        <View style={styles.statCard}>
          <AlertTriangle size={20} color={Colors.warning} />
          <Text style={styles.statValue}>{userProfiles.filter(u => u.riskLevel === 'at_risk').length}</Text>
          <Text style={styles.statLabel}>At Risk</Text>
        </View>
        <View style={styles.statCard}>
          <TrendingUp size={20} color={Colors.positive} />
          <Text style={styles.statValue}>{Math.round(userProfiles.reduce((a, b) => a + b.engagementScore, 0) / userProfiles.length)}%</Text>
          <Text style={styles.statLabel}>Avg Score</Text>
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>User Intelligence</Text>
        <TouchableOpacity onPress={generateBulkSmartMessages} disabled={isGenerating}>
          <View style={styles.bulkActionBtn}>
            <Sparkles size={14} color={Colors.primary} />
            <Text style={styles.bulkActionText}>Smart Campaign</Text>
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.searchBar}>
        <Search size={18} color={Colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search users..."
          placeholderTextColor={Colors.textTertiary}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        <TouchableOpacity>
          <Filter size={18} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {filteredUsers.slice(0, 6).map((user) => (
        <TouchableOpacity
          key={user.id}
          style={styles.userCard}
          onPress={() => generatePersonalizedMessage(user)}
        >
          <View style={styles.userHeader}>
            {user.avatar ? (
              <Image source={{ uri: user.avatar }} style={styles.userAvatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <User size={20} color={Colors.textSecondary} />
              </View>
            )}
            <View style={styles.userInfo}>
              <Text style={styles.userName}>{user.name}</Text>
              <Text style={styles.userEmail}>{user.email}</Text>
            </View>
            <View style={[styles.riskBadge, { backgroundColor: getRiskColor(user.riskLevel) + '20' }]}>
              <Text style={[styles.riskText, { color: getRiskColor(user.riskLevel) }]}>
                {user.riskLevel.replace('_', ' ')}
              </Text>
            </View>
          </View>

          <View style={styles.aiInsightBox}>
            <Bot size={14} color={Colors.primary} />
            <Text style={styles.aiInsightText} numberOfLines={2}>{user.aiSummary}</Text>
          </View>

          <View style={styles.userMeta}>
            <View style={styles.userMetaItem}>
              <DollarSign size={12} color={Colors.textSecondary} />
              <Text style={styles.userMetaText}>{formatCurrency(user.investmentTotal)}</Text>
            </View>
            <View style={styles.userMetaItem}>
              <Clock size={12} color={Colors.textSecondary} />
              <Text style={styles.userMetaText}>{user.daysSinceLastActivity}d ago</Text>
            </View>
            <View style={styles.userMetaItem}>
              <Activity size={12} color={Colors.textSecondary} />
              <Text style={styles.userMetaText}>{user.engagementScore}%</Text>
            </View>
            <View style={styles.userMetaItem}>
              <Target size={12} color={Colors.primary} />
              <Text style={[styles.userMetaText, { color: Colors.primary }]}>{user.predictedAction}</Text>
            </View>
          </View>

          <View style={styles.userActions}>
            <TouchableOpacity style={styles.actionChip}>
              <Mail size={12} color={Colors.primary} />
              <Text style={styles.actionChipText}>{user.preferredChannel}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionChip}>
              <Clock size={12} color={Colors.accent} />
              <Text style={styles.actionChipText}>{user.bestTimeToContact}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionChip, styles.actionChipPrimary]}>
              <Sparkles size={12} color="#000" />
              <Text style={[styles.actionChipText, { color: '#000' }]}>AI Message</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderEngage = () => (
    <View style={styles.tabContent}>
      <View style={styles.engageHeader}>
        <Text style={styles.engageTitle}>Smart Engagement Center</Text>
        <Text style={styles.engageSubtitle}>AI-powered messaging across all channels</Text>
      </View>

      <View style={styles.channelStats}>
        <View style={styles.channelStat}>
          <Mail size={20} color={Colors.primary} />
          <Text style={styles.channelStatValue}>{broadcastStats.totalSent}</Text>
          <Text style={styles.channelStatLabel}>Emails Sent</Text>
        </View>
        <View style={styles.channelStat}>
          <Bell size={20} color={Colors.accent} />
          <Text style={styles.channelStatValue}>{broadcastStats.openRate}%</Text>
          <Text style={styles.channelStatLabel}>Open Rate</Text>
        </View>
        <View style={styles.channelStat}>
          <MessageSquare size={20} color={Colors.positive} />
          <Text style={styles.channelStatValue}>{engagementStats.messagesOpened}</Text>
          <Text style={styles.channelStatLabel}>Engaged</Text>
        </View>
      </View>

      {smartMessages.length > 0 && (
        <View style={styles.messagesQueue}>
          <View style={styles.queueHeader}>
            <Text style={styles.queueTitle}>Smart Message Queue</Text>
            <TouchableOpacity style={styles.sendAllBtn}>
              <Send size={14} color="#fff" />
              <Text style={styles.sendAllText}>Send All</Text>
            </TouchableOpacity>
          </View>

          {smartMessages.map((msg) => (
            <View key={msg.id} style={styles.queueItem}>
              <View style={styles.queueItemHeader}>
                <Text style={styles.queueItemName}>{msg.userName}</Text>
                <View style={styles.personalizationBadge}>
                  <Sparkles size={10} color={Colors.positive} />
                  <Text style={styles.personalizationText}>{msg.personalizationScore}%</Text>
                </View>
              </View>
              <Text style={styles.queueItemMessage} numberOfLines={2}>{msg.message}</Text>
              <View style={styles.queueItemFooter}>
                <View style={styles.channelBadge}>
                  {msg.channel === 'email' ? <Mail size={12} color={Colors.primary} /> : <Bell size={12} color={Colors.accent} />}
                  <Text style={styles.channelBadgeText}>{msg.channel}</Text>
                </View>
                <TouchableOpacity style={styles.sendSingleBtn}>
                  <Send size={12} color={Colors.primary} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.quickActions}>
        <Text style={styles.quickActionsTitle}>Quick Actions</Text>
        <View style={styles.quickActionsGrid}>
          <TouchableOpacity style={styles.quickActionBtn} onPress={generateBulkSmartMessages}>
            <Sparkles size={22} color="#000000" />
            <Text style={styles.quickActionText}>AI Campaign</Text>
            <Text style={styles.quickActionDesc}>Generate personalized messages</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionBtn}>
            <Send size={22} color="#000000" />
            <Text style={styles.quickActionText}>Broadcast</Text>
            <Text style={styles.quickActionDesc}>Send to all members</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionBtn}>
            <AlertTriangle size={22} color="#000000" />
            <Text style={styles.quickActionText}>Re-engage</Text>
            <Text style={styles.quickActionDesc}>Target inactive users</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionBtn}>
            <Heart size={22} color="#000000" />
            <Text style={styles.quickActionText}>Nurture</Text>
            <Text style={styles.quickActionDesc}>Build relationships</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  const renderContent = () => (
    <View style={styles.tabContent}>
      <View style={styles.mediaUploadSection}>
        <View style={styles.mediaUploadHeader}>
          <View style={styles.mediaUploadTitleRow}>
            <Upload size={24} color={Colors.accent} />
            <Text style={styles.mediaUploadTitle}>Share Media to Social</Text>
          </View>
          <Text style={styles.mediaUploadSubtitle}>Upload up to 8 photos or videos to share across all platforms</Text>
        </View>

        <View style={styles.mediaGrid}>
          {uploadedMedia.map((item) => (
            <View key={item.id} style={styles.mediaItem}>
              <Image source={{ uri: item.uri }} style={styles.mediaItemImage} />
              {item.type === 'video' && (
                <View style={styles.mediaVideoIndicator}>
                  <Play size={14} color="#fff" />
                  {item.duration && (
                    <Text style={styles.mediaVideoDuration}>
                      {Math.floor(item.duration / 60)}:{String(Math.floor(item.duration % 60)).padStart(2, '0')}
                    </Text>
                  )}
                </View>
              )}
              <TouchableOpacity 
                style={styles.mediaRemoveBtn}
                onPress={() => removeMedia(item.id)}
              >
                <X size={12} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}

          {uploadedMedia.length < MAX_MEDIA_COUNT && (
            <TouchableOpacity style={styles.mediaAddBtn} onPress={pickMedia}>
              <Plus size={28} color={Colors.accent} />
              <Text style={styles.mediaAddText}>Add</Text>
            </TouchableOpacity>
          )}
        </View>

        {uploadedMedia.length === 0 && (
          <View style={styles.mediaEmptyState}>
            <ImageIcon size={40} color={Colors.textTertiary} />
            <Text style={styles.mediaEmptyText}>Tap + to add photos and videos</Text>
          </View>
        )}

        {uploadedMedia.length > 0 && (
          <>
            <View style={styles.mediaCaptionSection}>
              <View style={styles.mediaCaptionHeader}>
                <Text style={styles.mediaCaptionLabel}>Caption</Text>
                <TouchableOpacity 
                  style={styles.mediaAiCaptionBtn}
                  onPress={generateMediaCaption}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <ShimmerIndicator size="small" color={Colors.accent} />
                  ) : (
                    <Sparkles size={14} color={Colors.accent} />
                  )}
                  <Text style={styles.mediaAiCaptionText}>AI Generate</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.mediaCaptionInput}
                value={mediaCaption}
                onChangeText={setMediaCaption}
                placeholder="Write a caption for your post..."
                placeholderTextColor={Colors.textTertiary}
                multiline
                maxLength={2200}
              />
              <Text style={styles.mediaCaptionCount}>{mediaCaption.length}/2200</Text>
            </View>

            <View style={styles.mediaPlatformSelector}>
              <Text style={styles.mediaPlatformLabel}>Share to:</Text>
              <View style={styles.mediaPlatformGrid}>
                {socialPlatforms.slice(0, 6).map((platform) => {
                  const Icon = platform.icon;
                  const isSelected = selectedMediaPlatforms.has(platform.id);
                  return (
                    <TouchableOpacity
                      key={platform.id}
                      style={[styles.mediaPlatformChip, isSelected && styles.mediaPlatformChipActive]}
                      onPress={() => toggleMediaPlatform(platform.id)}
                    >
                      <Icon size={16} color={isSelected ? '#000' : Colors.textSecondary} />
                      <Text style={[styles.mediaPlatformChipText, isSelected && styles.mediaPlatformChipTextActive]}>
                        {platform.name.split(' ')[0]}
                      </Text>
                      {isSelected && (
                        <View style={styles.mediaPlatformCheck}>
                          <Check size={10} color="#000" />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <TouchableOpacity
              style={[styles.mediaShareBtn, (isSharingMedia || selectedMediaPlatforms.size === 0) && styles.mediaShareBtnDisabled]}
              onPress={shareMediaToSocial}
              disabled={isSharingMedia || selectedMediaPlatforms.size === 0}
            >
              {isSharingMedia ? (
                <ShimmerIndicator size="small" color="#000" />
              ) : (
                <Send size={18} color="#000" />
              )}
              <Text style={styles.mediaShareBtnText}>
                {isSharingMedia ? 'Sharing...' : `Share to ${selectedMediaPlatforms.size} Platform${selectedMediaPlatforms.size !== 1 ? 's' : ''}`}
              </Text>
            </TouchableOpacity>

            <View style={styles.mediaQuickShare}>
              <Text style={styles.mediaQuickShareLabel}>Quick Share:</Text>
              <View style={styles.mediaQuickShareBtns}>
                <TouchableOpacity 
                  style={[styles.mediaQuickShareBtn, { backgroundColor: '#25D366' }]}
                  onPress={() => handleQuickShareMedia('whatsapp')}
                >
                  <MessageCircle size={16} color="#fff" />
                  <Text style={styles.mediaQuickShareBtnText}>WhatsApp</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.mediaQuickShareBtn, { backgroundColor: '#0088CC' }]}
                  onPress={() => handleQuickShareMedia('telegram')}
                >
                  <Send size={16} color="#fff" />
                  <Text style={styles.mediaQuickShareBtnText}>Telegram</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}

        <View style={styles.mediaInfoCard}>
          <Zap size={18} color={Colors.accent} />
          <View style={styles.mediaInfoContent}>
            <Text style={styles.mediaInfoTitle}>AI-Powered Distribution</Text>
            <Text style={styles.mediaInfoText}>
              Your content will be automatically optimized for each platform and scheduled for maximum engagement.
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.contentDivider} />

      <View style={styles.contentHeader}>
        <Sparkles size={24} color={Colors.primary} />
        <Text style={styles.contentTitle}>AI Content Studio</Text>
      </View>
      <Text style={styles.contentSubtitle}>Create engaging content for any platform</Text>

      <View style={styles.platformSelector}>
        {['instagram', 'facebook', 'twitter', 'linkedin', 'tiktok'].map((platform) => (
          <TouchableOpacity
            key={platform}
            style={[styles.platformBtn, selectedPlatform === platform && styles.platformBtnActive]}
            onPress={() => setSelectedPlatform(platform)}
          >
            <Text style={[styles.platformBtnText, selectedPlatform === platform && styles.platformBtnTextActive]}>
              {platform.charAt(0).toUpperCase() + platform.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TextInput
        style={styles.topicInput}
        placeholder="What should the content be about? (optional - AI will suggest if empty)"
        placeholderTextColor={Colors.textTertiary}
        value={contentTopic}
        onChangeText={setContentTopic}
        multiline
      />

      <TouchableOpacity
        style={[styles.generateBtn, isGenerating && styles.generateBtnDisabled]}
        onPress={generateSocialContent}
        disabled={isGenerating}
      >
        {isGenerating ? (
          <ShimmerIndicator size="small" color="#000" />
        ) : (
          <Sparkles size={18} color="#000" />
        )}
        <Text style={styles.generateBtnText}>
          {isGenerating ? 'Creating...' : 'Create with AI'}
        </Text>
      </TouchableOpacity>

      {generatedContent && (
        <View style={styles.generatedBox}>
          <View style={styles.generatedHeader}>
            <Text style={styles.generatedTitle}>Generated Content</Text>
            <TouchableOpacity>
              <Copy size={18} color={Colors.primary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.generatedText}>{generatedContent}</Text>
          <View style={styles.generatedActions}>
            <TouchableOpacity style={styles.generatedActionBtn} onPress={handleCopyContent}>
              {copiedPlatform === 'clipboard' ? (
                <Check size={14} color={Colors.positive} />
              ) : (
                <Copy size={14} color={Colors.text} />
              )}
              <Text style={[styles.generatedActionText, copiedPlatform === 'clipboard' && { color: Colors.positive }]}>
                {copiedPlatform === 'clipboard' ? 'Copied!' : 'Copy'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.generatedActionBtn} onPress={generateSocialContent}>
              <RefreshCw size={14} color={Colors.text} />
              <Text style={styles.generatedActionText}>Regenerate</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.generatedActionBtn, styles.generatedActionBtnPrimary]} onPress={openShareModal}>
              <Share2 size={14} color="#000" />
              <Text style={[styles.generatedActionText, { color: '#000' }]}>Share</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity 
            style={styles.wrapLinkBtn}
            onPress={handleWrapInLink}
            disabled={isCreatingLink}
          >
            {isCreatingLink ? (
              <ShimmerIndicator size="small" color="#000" />
            ) : (
              <Link size={16} color="#000" />
            )}
            <Text style={styles.wrapLinkBtnText}>
              {isCreatingLink ? 'Creating...' : 'Wrap in Short Link with Tracking'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.imageSectionDivider} />

      <View style={styles.imageGenHeader}>
        <ImageIcon size={24} color={Colors.accent} />
        <Text style={styles.imageGenTitle}>AI Image Generator</Text>
      </View>
      <Text style={styles.imageGenSubtitle}>Create professional marketing visuals with AI</Text>

      <View style={styles.imageSizeSelector}>
        {[
          { size: '1024x1024' as const, label: 'Square' },
          { size: '1024x1792' as const, label: 'Portrait' },
          { size: '1792x1024' as const, label: 'Landscape' },
        ].map((option) => (
          <TouchableOpacity
            key={option.size}
            style={[styles.imageSizeBtn, imageSize === option.size && styles.imageSizeBtnActive]}
            onPress={() => setImageSize(option.size)}
          >
            <Text style={[styles.imageSizeBtnText, imageSize === option.size && styles.imageSizeBtnTextActive]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TextInput
        style={styles.imagePromptInput}
        placeholder="Describe the image you want to create...\nE.g., Modern luxury apartment building at sunset, aerial view"
        placeholderTextColor={Colors.textTertiary}
        value={imagePrompt}
        onChangeText={setImagePrompt}
        multiline
      />

      <TouchableOpacity
        style={[styles.generateImageBtn, isGeneratingImage && styles.generateBtnDisabled]}
        onPress={generateAIImage}
        disabled={isGeneratingImage}
      >
        {isGeneratingImage ? (
          <ShimmerIndicator size="small" color="#000" />
        ) : (
          <ImageIcon size={18} color="#000" />
        )}
        <Text style={styles.generateImageBtnText}>
          {isGeneratingImage ? `Creating Image... ${Math.round(imageProgress)}%` : 'Generate Image'}
        </Text>
      </TouchableOpacity>

      {isGeneratingImage && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBarBg}>
            <Animated.View 
              style={[
                styles.progressBarFill,
                { 
                  width: imageProgressAnim.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%']})
                }
              ]} 
            />
          </View>
          <Text style={styles.progressText}>{Math.round(imageProgress)}% complete</Text>
        </View>
      )}

      {generatedImage && (
        <View style={styles.generatedImageBox}>
          <View style={styles.generatedImageHeader}>
            <Text style={styles.generatedImageTitle}>Generated Image</Text>
            <TouchableOpacity onPress={() => setGeneratedImage(null)}>
              <X size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Image 
            source={{ uri: generatedImage }} 
            style={[
              styles.generatedImage,
              imageSize === '1024x1792' && styles.generatedImagePortrait,
              imageSize === '1792x1024' && styles.generatedImageLandscape,
            ]} 
            resizeMode="contain"
          />
          <View style={styles.generatedImageActions}>
            <TouchableOpacity style={styles.imageActionBtn} onPress={generateAIImage}>
              <RefreshCw size={14} color={Colors.text} />
              <Text style={styles.imageActionText}>Regenerate</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.imageActionBtn, styles.imageActionBtnPrimary]} onPress={handleShareImage}>
              <Download size={14} color="#000" />
              <Text style={[styles.imageActionText, { color: '#000' }]}>
                {Platform.OS === 'web' ? 'Download' : 'Share'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.imageSectionDivider} />

      <View style={styles.imageGenHeader}>
        <Video size={24} color={Colors.positive} />
        <Text style={styles.imageGenTitle}>AI Video Generator</Text>
      </View>
      <Text style={styles.imageGenSubtitle}>Create video scripts and concepts for marketing</Text>

      <View style={styles.imageSizeSelector}>
        {[
          { duration: '15' as const, label: '15 sec' },
          { duration: '30' as const, label: '30 sec' },
          { duration: '60' as const, label: '60 sec' },
        ].map((option) => (
          <TouchableOpacity
            key={option.duration}
            style={[styles.imageSizeBtn, videoDuration === option.duration && styles.imageSizeBtnActive]}
            onPress={() => setVideoDuration(option.duration)}
          >
            <Text style={[styles.imageSizeBtnText, videoDuration === option.duration && styles.imageSizeBtnTextActive]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TextInput
        style={styles.imagePromptInput}
        placeholder="Describe the video you want to create...\nE.g., Showcase our new Miami property with drone footage and investor testimonials"
        placeholderTextColor={Colors.textTertiary}
        value={videoPrompt}
        onChangeText={setVideoPrompt}
        multiline
      />

      <TouchableOpacity
        style={[styles.generateVideoBtn, isGeneratingVideo && styles.generateBtnDisabled]}
        onPress={generateAIVideo}
        disabled={isGeneratingVideo}
      >
        {isGeneratingVideo ? (
          <ShimmerIndicator size="small" color="#000" />
        ) : (
          <Play size={18} color="#000" />
        )}
        <Text style={styles.generateVideoBtnText}>
          {isGeneratingVideo ? `Creating Video... ${Math.round(videoProgress)}%` : 'Generate Video'}
        </Text>
      </TouchableOpacity>

      {isGeneratingVideo && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBarBgVideo}>
            <Animated.View 
              style={[
                styles.progressBarFillVideo,
                { 
                  width: videoProgressAnim.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%']})
                }
              ]} 
            />
          </View>
          <Text style={styles.progressText}>{Math.round(videoProgress)}% complete</Text>
        </View>
      )}

      {generatedVideo && (
        <View style={styles.generatedVideoBox}>
          <View style={styles.generatedImageHeader}>
            <Text style={styles.generatedImageTitle}>Video Concept</Text>
            <TouchableOpacity onPress={() => setGeneratedVideo(null)}>
              <X size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.videoThumbnailContainer}>
            <Image 
              source={{ uri: generatedVideo.url }} 
              style={styles.videoThumbnail}
              resizeMode="cover"
            />
            <TouchableOpacity 
              style={styles.videoPlayOverlay}
              onPress={handleOpenGeneratedVideo}
            >
              <View style={styles.videoPlayButton}>
                <Play size={32} color="#fff" />
              </View>
              <Text style={styles.videoDurationBadge}>{videoDuration}s</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.videoScriptBox}>
            <Text style={styles.videoScriptLabel}>AI Generated Script</Text>
            <ScrollView style={styles.videoScriptScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.videoScriptText}>{generatedVideo.script}</Text>
            </ScrollView>
          </View>
          <View style={styles.generatedImageActions}>
            <TouchableOpacity style={styles.imageActionBtn} onPress={generateAIVideo}>
              <RefreshCw size={14} color={Colors.text} />
              <Text style={styles.imageActionText}>Regenerate</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.imageActionBtn} onPress={handleOpenGeneratedVideo}>
              <ExternalLink size={14} color={Colors.text} />
              <Text style={styles.imageActionText}>Open Video</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.imageActionBtn, styles.imageActionBtnPrimary]} onPress={handleShareVideoScript}>
              <Share2 size={14} color="#000" />
              <Text style={[styles.imageActionText, { color: '#000' }]}>Share Script</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {contentLink && (
        <View style={styles.contentLinkCard}>
          <View style={styles.contentLinkHeader}>
            <View style={styles.contentLinkBadge}>
              <CheckCircle size={14} color={Colors.positive} />
              <Text style={styles.contentLinkBadgeText}>Content Wrapped with Link</Text>
            </View>
            <TouchableOpacity onPress={() => setContentLink(null)}>
              <X size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.wrappedContentPreview}>
            <Text style={styles.wrappedContentLabel}>📋 Ready to Share</Text>
            <ScrollView style={styles.wrappedContentScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.wrappedContentText}>{getWrappedContent()}</Text>
            </ScrollView>
          </View>

          <TouchableOpacity 
            style={styles.copyWrappedBtn}
            onPress={handleCopyWrappedContent}
          >
            {copiedPlatform === 'wrappedContent' ? (
              <Check size={18} color="#000" />
            ) : (
              <Copy size={18} color="#000" />
            )}
            <Text style={styles.copyWrappedBtnText}>
              {copiedPlatform === 'wrappedContent' ? 'Copied!' : 'Copy Full Message with Link'}
            </Text>
          </TouchableOpacity>

          <View style={styles.contentLinkQrRow}>
            <View style={styles.contentLinkQrBox}>
              <Image 
                source={{ uri: contentLink.qrCodeUrl }} 
                style={styles.contentLinkQr}
                resizeMode="contain"
              />
            </View>
            <View style={styles.contentLinkDetails}>
              <Text style={styles.contentLinkCode}>{contentLink.shortCode}</Text>
              <Text style={styles.contentLinkUrl} numberOfLines={2}>{contentLink.fullUrl}</Text>
              <TouchableOpacity 
                style={styles.copyLinkBtn}
                onPress={() => handleCopyContentLink()}
              >
                {copiedPlatform === 'contentLink' ? (
                  <Check size={14} color={Colors.positive} />
                ) : (
                  <Copy size={14} color={Colors.primary} />
                )}
                <Text style={[styles.copyLinkBtnText, copiedPlatform === 'contentLink' && { color: Colors.positive }]}>
                  {copiedPlatform === 'contentLink' ? 'Copied!' : 'Copy Link Only'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.contentLinkLive}>
            <View style={styles.liveIndicatorSmall}>
              <View style={styles.liveDotSmall} />
              <Text style={styles.liveTextSmall}>Real-time Tracking</Text>
            </View>
          </View>

          <View style={styles.contentLinkStats}>
            <View style={styles.contentLinkStat}>
              <Globe size={16} color={Colors.textSecondary} />
              <Text style={styles.contentLinkStatValue}>{contentLink.stats.totalClicks}</Text>
              <Text style={styles.contentLinkStatLabel}>Clicks</Text>
            </View>
            <View style={styles.contentLinkStat}>
              <ExternalLink size={16} color={Colors.accent} />
              <Text style={styles.contentLinkStatValue}>{contentLink.stats.downloads}</Text>
              <Text style={styles.contentLinkStatLabel}>Downloads</Text>
            </View>
            <View style={styles.contentLinkStat}>
              <UserCheck size={16} color={Colors.positive} />
              <Text style={styles.contentLinkStatValue}>{contentLink.stats.registrations}</Text>
              <Text style={styles.contentLinkStatLabel}>Registrations</Text>
            </View>
            <View style={styles.contentLinkStat}>
              <DollarSign size={16} color={Colors.primary} />
              <Text style={styles.contentLinkStatValue}>{contentLink.stats.investments}</Text>
              <Text style={styles.contentLinkStatLabel}>Investments</Text>
            </View>
          </View>

          <View style={styles.contentLinkActions}>
            <TouchableOpacity 
              style={styles.contentLinkActionBtn}
              onPress={() => {
                setSelectedLink(contentLink);
                setShowLinkDetailModal(true);
              }}
            >
              <BarChart3 size={16} color={Colors.text} />
              <Text style={styles.contentLinkActionText}>Analytics</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.contentLinkActionBtn, styles.contentLinkActionBtnPrimary]}
              onPress={handleShareContentLink}
            >
              <Share2 size={16} color="#000" />
              <Text style={[styles.contentLinkActionText, { color: '#000' }]}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );

  const renderInfluencers = () => (
    <View style={styles.tabContent}>
      <View style={styles.influencerHeader}>
        <Star size={24} color={Colors.primary} />
        <Text style={styles.influencerTitle}>Influencer Hub</Text>
      </View>

      <View style={styles.influencerStats}>
        <View style={styles.influencerStat}>
          <Users size={20} color={Colors.primary} />
          <Text style={styles.influencerStatValue}>{influencerStats.totalInfluencers}</Text>
          <Text style={styles.influencerStatLabel}>Total</Text>
        </View>
        <View style={styles.influencerStat}>
          <UserCheck size={20} color={Colors.positive} />
          <Text style={styles.influencerStatValue}>{influencerStats.activeInfluencers}</Text>
          <Text style={styles.influencerStatLabel}>Active</Text>
        </View>
        <View style={styles.influencerStat}>
          <DollarSign size={20} color={Colors.accent} />
          <Text style={styles.influencerStatValue}>{formatCurrency(influencerStats.totalCommissionsPaid)}</Text>
          <Text style={styles.influencerStatLabel}>Paid</Text>
        </View>
      </View>

      <Text style={styles.listTitle}>Top Performers</Text>
      {mockInfluencers.slice(0, 5).map((influencer: Influencer, index: number) => (
        <View key={influencer.id} style={styles.influencerCard}>
          <View style={styles.influencerRank}>
            <Text style={styles.influencerRankText}>{index + 1}</Text>
          </View>
          {influencer.avatar ? (
            <Image source={{ uri: influencer.avatar }} style={styles.influencerAvatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <User size={18} color={Colors.textSecondary} />
            </View>
          )}
          <View style={styles.influencerInfo}>
            <Text style={styles.influencerName}>{influencer.name}</Text>
            <Text style={styles.influencerHandle}>{influencer.handle}</Text>
          </View>
          <View style={styles.influencerMetrics}>
            <Text style={styles.influencerEarnings}>{formatCurrency(influencer.totalEarnings)}</Text>
            <Text style={styles.influencerFollowers}>{formatNumber(influencer.followers)} followers</Text>
          </View>
        </View>
      ))}
    </View>
  );

  const renderLinks = () => (
    <View style={styles.tabContent}>
      <View style={styles.linksHeader}>
        <View>
          <Text style={styles.linksTitle}>Trackable Links</Text>
          <Text style={styles.linksSubtitle}>Create & track campaign links in real-time</Text>
        </View>
        <TouchableOpacity 
          style={styles.createLinkBtn}
          onPress={() => setShowCreateLinkModal(true)}
        >
          <Link size={16} color="#000" />
          <Text style={styles.createLinkBtnText}>Create</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.linkStatsGrid}>
        <View style={[styles.linkStatCard, styles.linkStatCardPrimary]}>
          <Globe size={20} color="#000" />
          <Text style={styles.linkStatValueDark}>{formatNumber(linkAnalytics.totalClicks)}</Text>
          <Text style={styles.linkStatLabelDark}>Total Clicks</Text>
        </View>
        <View style={styles.linkStatCard}>
          <ExternalLink size={18} color={Colors.accent} />
          <Text style={styles.linkStatValue}>{formatNumber(linkAnalytics.totalDownloads)}</Text>
          <Text style={styles.linkStatLabel}>Downloads</Text>
        </View>
        <View style={styles.linkStatCard}>
          <UserCheck size={18} color={Colors.positive} />
          <Text style={styles.linkStatValue}>{formatNumber(linkAnalytics.totalRegistrations)}</Text>
          <Text style={styles.linkStatLabel}>Registrations</Text>
        </View>
        <View style={styles.linkStatCard}>
          <DollarSign size={18} color={Colors.primary} />
          <Text style={styles.linkStatValue}>{linkAnalytics.totalInvestments}</Text>
          <Text style={styles.linkStatLabel}>Investments</Text>
        </View>
      </View>

      <View style={styles.liveEventsSection}>
        <View style={styles.liveEventsHeader}>
          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live Activity</Text>
          </View>
          <Text style={styles.liveEventsCount}>{linkEvents.length} events</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.liveEventsList}>
          {linkEvents.slice(0, 8).map((event) => {
            const { icon: EventIcon, color } = getEventIcon(event.eventType);
            return (
              <View key={event.id} style={styles.liveEventCard}>
                <View style={[styles.liveEventIcon, { backgroundColor: color + '20' }]}>
                  <EventIcon size={16} color={color} />
                </View>
                <Text style={styles.liveEventType}>{event.eventType}</Text>
                {event.userName && (
                  <Text style={styles.liveEventUser} numberOfLines={1}>{event.userName}</Text>
                )}
                {event.investmentAmount && (
                  <Text style={styles.liveEventAmount}>{formatCurrency(event.investmentAmount)}</Text>
                )}
                <Text style={styles.liveEventTime}>{getTimeAgo(event.timestamp)}</Text>
                {event.country && (
                  <Text style={styles.liveEventLocation}>{event.city}, {event.country}</Text>
                )}
              </View>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Your Links</Text>
        <Text style={styles.linkCount}>{trackableLinks.length} active</Text>
      </View>

      {trackableLinks.map((link) => (
        <TouchableOpacity 
          key={link.id} 
          style={styles.linkCard}
          onPress={() => handleViewLinkDetail(link)}
        >
          <View style={styles.linkCardHeader}>
            <View style={styles.linkInfo}>
              <Text style={styles.linkName}>{link.name}</Text>
              <Text style={styles.linkCode}>{link.shortCode}</Text>
            </View>
            <View style={[styles.linkStatusBadge, { backgroundColor: link.status === 'active' ? Colors.positive + '20' : Colors.warning + '20' }]}>
              <Text style={[styles.linkStatusText, { color: link.status === 'active' ? Colors.positive : Colors.warning }]}>
                {link.status}
              </Text>
            </View>
          </View>

          <View style={styles.linkMetrics}>
            <View style={styles.linkMetric}>
              <Globe size={14} color={Colors.textSecondary} />
              <Text style={styles.linkMetricValue}>{formatNumber(link.stats.totalClicks)}</Text>
              <Text style={styles.linkMetricLabel}>clicks</Text>
            </View>
            <View style={styles.linkMetric}>
              <UserCheck size={14} color={Colors.positive} />
              <Text style={styles.linkMetricValue}>{link.stats.registrations}</Text>
              <Text style={styles.linkMetricLabel}>signups</Text>
            </View>
            <View style={styles.linkMetric}>
              <DollarSign size={14} color={Colors.primary} />
              <Text style={styles.linkMetricValue}>{link.stats.investments}</Text>
              <Text style={styles.linkMetricLabel}>invested</Text>
            </View>
            <View style={styles.linkMetric}>
              <TrendingUp size={14} color={Colors.accent} />
              <Text style={styles.linkMetricValue}>{link.stats.conversionRate.toFixed(1)}%</Text>
              <Text style={styles.linkMetricLabel}>CVR</Text>
            </View>
          </View>

          <View style={styles.linkActions}>
            <TouchableOpacity 
              style={styles.linkActionBtn}
              onPress={(e) => { e.stopPropagation(); handleCopyLink(link); }}
            >
              {copiedPlatform === link.id ? (
                <Check size={14} color={Colors.positive} />
              ) : (
                <Copy size={14} color={Colors.text} />
              )}
              <Text style={[styles.linkActionText, copiedPlatform === link.id && { color: Colors.positive }]}>
                {copiedPlatform === link.id ? 'Copied!' : 'Copy Link'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkActionBtn}>
              <Share2 size={14} color={Colors.text} />
              <Text style={styles.linkActionText}>Share</Text>
            </TouchableOpacity>
            <View style={[styles.linkActionBtn, styles.linkActionBtnPrimary]}>
              <BarChart3 size={14} color="#000" />
              <Text style={[styles.linkActionText, { color: '#000' }]}>Details</Text>
            </View>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderAnalytics = () => (
    <View style={styles.tabContent}>
      <View style={styles.analyticsHeader}>
        <BarChart3 size={24} color={Colors.primary} />
        <Text style={styles.analyticsTitle}>Marketing Analytics</Text>
      </View>

      <View style={styles.analyticsGrid}>
        <View style={[styles.analyticCard, styles.analyticCardLarge]}>
          <Globe size={24} color={Colors.primary} />
          <Text style={styles.analyticValue}>{formatNumber(mockGrowthStats.socialReach)}</Text>
          <Text style={styles.analyticLabel}>Social Reach</Text>
          <View style={styles.analyticTrend}>
            <TrendingUp size={12} color={Colors.positive} />
            <Text style={styles.analyticTrendText}>+{mockGrowthStats.userGrowthPercent}%</Text>
          </View>
        </View>
        <View style={styles.analyticCard}>
          <Users size={20} color={Colors.accent} />
          <Text style={styles.analyticValue}>{formatNumber(mockGrowthStats.totalUsers)}</Text>
          <Text style={styles.analyticLabel}>Users</Text>
        </View>
        <View style={styles.analyticCard}>
          <Share2 size={20} color={Colors.positive} />
          <Text style={styles.analyticValue}>{mockReferralStats.totalReferrals}</Text>
          <Text style={styles.analyticLabel}>Referrals</Text>
        </View>
        <View style={styles.analyticCard}>
          <Heart size={20} color={Colors.negative} />
          <Text style={styles.analyticValue}>{mockGrowthStats.engagementRate}%</Text>
          <Text style={styles.analyticLabel}>Engagement</Text>
        </View>
        <View style={styles.analyticCard}>
          <DollarSign size={20} color={Colors.warning} />
          <Text style={styles.analyticValue}>{formatCurrency(mockReferralStats.totalInvestmentFromReferrals)}</Text>
          <Text style={styles.analyticLabel}>From Referrals</Text>
        </View>
      </View>

      <Text style={styles.insightsTitle}>AI Insights</Text>
      {mockAIInsights.slice(0, 3).map((insight: AIMarketingInsight) => (
        <View key={insight.id} style={styles.insightCard}>
          <View style={styles.insightHeader}>
            <Zap size={16} color={Colors.primary} />
            <Text style={styles.insightTitle}>{insight.title}</Text>
          </View>
          <Text style={styles.insightDesc}>{insight.description}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>AI Marketing Hub</Text>
          <Text style={styles.subtitle}>Smart marketing that understands users</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerBtn}>
            <RefreshCw size={20} color={Colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBarWrapper} contentContainerStyle={styles.tabBar} alwaysBounceVertical={false}>
        {[
          { key: 'intelligence', label: 'Intelligence', icon: Brain },
          { key: 'engage', label: 'Engage', icon: Send },
          { key: 'content', label: 'Content', icon: Sparkles },
          { key: 'influencers', label: 'Influencers', icon: Star },
          { key: 'analytics', label: 'Analytics', icon: BarChart3 },
          { key: 'links', label: 'Links', icon: Link },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
              onPress={() => setActiveTab(tab.key as TabType)}
            >
              <Icon size={16} color={activeTab === tab.key ? '#000' : Colors.textSecondary} />
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <KeyboardAvoidingView 
        style={styles.keyboardAvoid} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView 
          style={styles.content} 
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          {activeTab === 'intelligence' && renderIntelligence()}
          {activeTab === 'engage' && renderEngage()}
          {activeTab === 'content' && renderContent()}
          {activeTab === 'influencers' && renderInfluencers()}
          {activeTab === 'analytics' && renderAnalytics()}
          {activeTab === 'links' && renderLinks()}
          <View style={styles.bottomPadding} />
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={showUserModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowUserModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowUserModal(false)}>
              <X size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>AI Personalized Message</Text>
            <View style={{ width: 24 }} />
          </View>

          {selectedUser && (
            <ScrollView style={styles.modalContent}>
              <View style={styles.userProfileCard}>
                <View style={styles.userProfileHeader}>
                  {selectedUser.avatar ? (
                    <Image source={{ uri: selectedUser.avatar }} style={styles.userProfileAvatar} />
                  ) : (
                    <View style={[styles.avatarPlaceholder, { width: 60, height: 60 }]}>
                      <User size={28} color={Colors.textSecondary} />
                    </View>
                  )}
                  <View style={styles.userProfileInfo}>
                    <Text style={styles.userProfileName}>{selectedUser.name}</Text>
                    <Text style={styles.userProfileEmail}>{selectedUser.email}</Text>
                    <View style={[styles.riskBadge, { backgroundColor: getRiskColor(selectedUser.riskLevel) + '20' }]}>
                      <Text style={[styles.riskText, { color: getRiskColor(selectedUser.riskLevel) }]}>
                        {selectedUser.riskLevel.replace('_', ' ')}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.userProfileStats}>
                  <View style={styles.userProfileStat}>
                    <Text style={styles.userProfileStatValue}>{formatCurrency(selectedUser.investmentTotal)}</Text>
                    <Text style={styles.userProfileStatLabel}>Invested</Text>
                  </View>
                  <View style={styles.userProfileStat}>
                    <Text style={styles.userProfileStatValue}>{selectedUser.engagementScore}%</Text>
                    <Text style={styles.userProfileStatLabel}>Score</Text>
                  </View>
                  <View style={styles.userProfileStat}>
                    <Text style={styles.userProfileStatValue}>{selectedUser.daysSinceLastActivity}d</Text>
                    <Text style={styles.userProfileStatLabel}>Inactive</Text>
                  </View>
                </View>

                <View style={styles.aiRecommendations}>
                  <Text style={styles.aiRecommendationsTitle}>AI Recommendations</Text>
                  <View style={styles.aiRecommendation}>
                    <Clock size={14} color={Colors.accent} />
                    <Text style={styles.aiRecommendationText}>Best time: {selectedUser.bestTimeToContact}</Text>
                  </View>
                  <View style={styles.aiRecommendation}>
                    <Mail size={14} color={Colors.primary} />
                    <Text style={styles.aiRecommendationText}>Channel: {selectedUser.preferredChannel}</Text>
                  </View>
                  <View style={styles.aiRecommendation}>
                    <Target size={14} color={Colors.positive} />
                    <Text style={styles.aiRecommendationText}>Prediction: {selectedUser.predictedAction}</Text>
                  </View>
                </View>
              </View>

              <Text style={styles.messageLabel}>AI Generated Message</Text>
              {isGenerating ? (
                <View style={styles.loadingBox}>
                  <ShimmerIndicator size="large" color={Colors.primary} />
                  <Text style={styles.loadingText}>AI is crafting a personalized message...</Text>
                </View>
              ) : (
                <TextInput
                  style={styles.messageInput}
                  value={generatedMessage}
                  onChangeText={setGeneratedMessage}
                  multiline
                  placeholder="Message will appear here..."
                  placeholderTextColor={Colors.textTertiary}
                />
              )}
            </ScrollView>
          )}

          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.sendBtn, (!generatedMessage || isGenerating) && styles.sendBtnDisabled]}
              onPress={sendMessage}
              disabled={!generatedMessage || isGenerating}
            >
              <Send size={18} color="#fff" />
              <Text style={styles.sendBtnText}>Send Message</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={showShareModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowShareModal(false)}
      >
        <TouchableOpacity 
          style={styles.shareModalOverlay} 
          activeOpacity={1} 
          onPress={() => setShowShareModal(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.shareModalContainer}>
            <View style={styles.shareModalHandle} />
            
            <View style={styles.shareModalHeader}>
              <Text style={styles.shareModalTitle}>Share to Social Media</Text>
              <TouchableOpacity onPress={() => setShowShareModal(false)} style={styles.shareModalClose}>
                <X size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.sharePreview}>
              <Text style={styles.sharePreviewLabel}>Content Preview</Text>
              <ScrollView style={styles.sharePreviewScroll} showsVerticalScrollIndicator={false}>
                <Text style={styles.sharePreviewText} numberOfLines={6}>{generatedContent}</Text>
              </ScrollView>
            </View>

            <Text style={styles.sharePlatformsTitle}>Choose Platform</Text>
            <View style={styles.sharePlatformsGrid}>
              {socialPlatforms.map((platform) => {
                const Icon = platform.icon;
                const isCopied = copiedPlatform === platform.id;
                return (
                  <TouchableOpacity
                    key={platform.id}
                    style={styles.sharePlatformBtn}
                    onPress={() => handlePlatformShare(platform.id)}
                  >
                    <View style={[styles.sharePlatformIcon, { backgroundColor: platform.color + '15' }]}>
                      {isCopied ? (
                        <Check size={24} color={Colors.positive} />
                      ) : (
                        <Icon size={24} color={platform.color} />
                      )}
                    </View>
                    <Text style={[styles.sharePlatformName, isCopied && { color: Colors.positive }]}>
                      {isCopied ? 'Copied!' : platform.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.shareQuickActions}>
              <TouchableOpacity style={styles.shareQuickBtn} onPress={handleCopyContent}>
                <Link size={18} color={Colors.text} />
                <Text style={styles.shareQuickText}>Copy Text</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.shareQuickBtn, styles.shareQuickBtnPrimary]} onPress={handleNativeShare}>
                <ExternalLink size={18} color="#000" />
                <Text style={[styles.shareQuickText, { color: '#000' }]}>More Options</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showCreateLinkModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCreateLinkModal(false)}
      >
        <TouchableOpacity 
          style={styles.shareModalOverlay} 
          activeOpacity={1} 
          onPress={() => setShowCreateLinkModal(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.createLinkModalContainer}>
            <View style={styles.shareModalHandle} />
            
            <View style={styles.shareModalHeader}>
              <Text style={styles.shareModalTitle}>Create Trackable Link</Text>
              <TouchableOpacity onPress={() => setShowCreateLinkModal(false)} style={styles.shareModalClose}>
                <X size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.createLinkLabel}>Link Name</Text>
            <TextInput
              style={styles.createLinkInput}
              placeholder="e.g., Instagram Bio, TikTok Campaign"
              placeholderTextColor={Colors.textTertiary}
              value={newLinkName}
              onChangeText={setNewLinkName}
            />

            <Text style={styles.createLinkLabel}>Source Type</Text>
            <View style={styles.sourceTypeGrid}>
              {(['social', 'email', 'ad', 'influencer', 'direct', 'referral'] as TrackableLink['source'][]).map((source) => (
                <TouchableOpacity
                  key={source}
                  style={[styles.sourceTypeBtn, newLinkSource === source && styles.sourceTypeBtnActive]}
                  onPress={() => setNewLinkSource(source)}
                >
                  <Text style={[styles.sourceTypeBtnText, newLinkSource === source && styles.sourceTypeBtnTextActive]}>
                    {source}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {newLinkSource === 'social' && (
              <>
                <Text style={styles.createLinkLabel}>Platform</Text>
                <View style={styles.sourceTypeGrid}>
                  {(['instagram', 'facebook', 'twitter', 'linkedin', 'tiktok'] as SocialPlatform[]).map((platform) => (
                    <TouchableOpacity
                      key={platform}
                      style={[styles.sourceTypeBtn, newLinkPlatform === platform && styles.sourceTypeBtnActive]}
                      onPress={() => setNewLinkPlatform(platform)}
                    >
                      <Text style={[styles.sourceTypeBtnText, newLinkPlatform === platform && styles.sourceTypeBtnTextActive]}>
                        {platform}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <TouchableOpacity style={styles.createLinkSubmitBtn} onPress={handleCreateLink}>
              <Link size={18} color="#000" />
              <Text style={styles.createLinkSubmitText}>Create Link</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showLinkDetailModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowLinkDetailModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowLinkDetailModal(false)}>
              <X size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Link Details</Text>
            <View style={{ width: 24 }} />
          </View>

          {selectedLink && (
            <ScrollView style={styles.modalContent}>
              <View style={styles.linkDetailCard}>
                <Text style={styles.linkDetailName}>{selectedLink.name}</Text>
                <Text style={styles.linkDetailCode}>{selectedLink.shortCode}</Text>
                
                <View style={styles.qrCodeContainer}>
                  <Image 
                    source={{ uri: selectedLink.qrCodeUrl }} 
                    style={styles.qrCode}
                    resizeMode="contain"
                  />
                </View>

                <View style={styles.linkUrlBox}>
                  <Text style={styles.linkUrlText} numberOfLines={2}>{selectedLink.fullUrl}</Text>
                  <TouchableOpacity onPress={() => handleCopyLink(selectedLink)}>
                    {copiedPlatform === selectedLink.id ? (
                      <Check size={20} color={Colors.positive} />
                    ) : (
                      <Copy size={20} color={Colors.primary} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.linkDetailStats}>
                <View style={styles.linkDetailStatRow}>
                  <View style={styles.linkDetailStat}>
                    <Globe size={20} color={Colors.textSecondary} />
                    <Text style={styles.linkDetailStatValue}>{formatNumber(selectedLink.stats.totalClicks)}</Text>
                    <Text style={styles.linkDetailStatLabel}>Total Clicks</Text>
                  </View>
                  <View style={styles.linkDetailStat}>
                    <Users size={20} color={Colors.accent} />
                    <Text style={styles.linkDetailStatValue}>{formatNumber(selectedLink.stats.uniqueClicks)}</Text>
                    <Text style={styles.linkDetailStatLabel}>Unique Clicks</Text>
                  </View>
                </View>
                <View style={styles.linkDetailStatRow}>
                  <View style={styles.linkDetailStat}>
                    <ExternalLink size={20} color={Colors.accent} />
                    <Text style={styles.linkDetailStatValue}>{formatNumber(selectedLink.stats.downloads)}</Text>
                    <Text style={styles.linkDetailStatLabel}>Downloads</Text>
                  </View>
                  <View style={styles.linkDetailStat}>
                    <UserCheck size={20} color={Colors.positive} />
                    <Text style={styles.linkDetailStatValue}>{formatNumber(selectedLink.stats.registrations)}</Text>
                    <Text style={styles.linkDetailStatLabel}>Registrations</Text>
                  </View>
                </View>
                <View style={styles.linkDetailStatRow}>
                  <View style={styles.linkDetailStat}>
                    <DollarSign size={20} color={Colors.primary} />
                    <Text style={styles.linkDetailStatValue}>{selectedLink.stats.investments}</Text>
                    <Text style={styles.linkDetailStatLabel}>Investments</Text>
                  </View>
                  <View style={styles.linkDetailStat}>
                    <TrendingUp size={20} color={Colors.positive} />
                    <Text style={styles.linkDetailStatValue}>{formatCurrency(selectedLink.stats.investmentAmount)}</Text>
                    <Text style={styles.linkDetailStatLabel}>Total Amount</Text>
                  </View>
                </View>
              </View>

              <View style={styles.linkConversionCard}>
                <Text style={styles.linkConversionTitle}>Conversion Rate</Text>
                <Text style={styles.linkConversionValue}>{selectedLink.stats.conversionRate.toFixed(1)}%</Text>
                <View style={styles.conversionBar}>
                  <View style={[styles.conversionBarFill, { width: `${Math.min(selectedLink.stats.conversionRate, 100)}%` }]} />
                </View>
                <Text style={styles.linkConversionDesc}>Click to Registration</Text>
              </View>

              <View style={styles.shareLinkActions}>
                <TouchableOpacity 
                  style={styles.shareLinkBtn}
                  onPress={() => handleCopyLink(selectedLink)}
                >
                  <Copy size={18} color={Colors.text} />
                  <Text style={styles.shareLinkBtnText}>Copy Link</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.shareLinkBtn, styles.shareLinkBtnPrimary]}>
                  <Share2 size={18} color="#000" />
                  <Text style={[styles.shareLinkBtnText, { color: '#000' }]}>Share</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </SafeAreaView>
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerBtn: { padding: 8 },
  tabBarWrapper: { marginHorizontal: 16, marginBottom: 12, flexGrow: 0, flexShrink: 0 },
  tabBar: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 12, padding: 4, gap: 4 },
  tab: { paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center', borderRadius: 10, minWidth: 80, flexDirection: 'row', gap: 5 },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: 13 },
  tabTextActive: { color: Colors.black },
  keyboardAvoid: { flex: 1 },
  content: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 140 },
  tabContent: {},
  aiStatusCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  aiStatusHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  aiStatusIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  aiStatusInfo: { flex: 1 },
  aiStatusTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  aiStatusSubtitle: { color: Colors.textSecondary, fontSize: 13 },
  aiFeatures: { gap: 8, marginTop: 12 },
  aiFeature: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiFeatureText: { color: Colors.textSecondary, fontSize: 13 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statCardPrimary: { backgroundColor: Colors.primary },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statValueDark: { color: Colors.black },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  statLabelDark: { color: Colors.black, opacity: 0.7 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  bulkActionBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  bulkActionText: { color: '#000000', fontSize: 13, fontWeight: '600' as const },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  searchInput: { flex: 1, color: Colors.text, fontSize: 15, paddingVertical: 12 },
  userCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  userHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  userAvatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  userInfo: { flex: 1 },
  userName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  userEmail: { color: Colors.textSecondary, fontSize: 13 },
  riskBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  riskText: { color: Colors.textSecondary, fontSize: 13 },
  aiInsightBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: Colors.backgroundSecondary, borderRadius: 8, padding: 10, marginTop: 8 },
  aiInsightText: { flex: 1, color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  userMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  userMetaItem: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  userMetaText: { color: Colors.textSecondary, fontSize: 13 },
  userActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.surfaceBorder },
  actionChipPrimary: { backgroundColor: '#FFD700' },
  actionChipText: { color: '#000000', fontSize: 13 },
  engageHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  engageTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  engageSubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  channelStats: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.border, gap: 8 },
  channelStat: { flex: 1, alignItems: 'center', gap: 4 },
  channelStatValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  channelStatLabel: { color: Colors.textTertiary, fontSize: 11, textAlign: 'center' },
  messagesQueue: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border, gap: 10 },
  queueHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  queueTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  sendAllBtn: { backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  sendAllText: { color: Colors.black, fontSize: 13, fontWeight: '700' as const },
  queueItem: { backgroundColor: Colors.backgroundSecondary, borderRadius: 10, padding: 12, gap: 6 },
  queueItemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  queueItemName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  personalizationBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  personalizationText: { color: Colors.textSecondary, fontSize: 13 },
  queueItemMessage: { gap: 4 },
  queueItemFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  channelBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  channelBadgeText: { fontSize: 11, fontWeight: '700' as const },
  sendSingleBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  quickActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  quickActionsTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  quickActionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickActionBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  quickActionText: { color: '#000000', fontSize: 13, fontWeight: '700' as const },
  quickActionDesc: { color: '#000000', fontSize: 13, lineHeight: 18, opacity: 0.7 },
  contentHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  contentTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  contentSubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  platformSelector: { gap: 6 },
  platformBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  platformBtnActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  platformBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  platformBtnTextActive: { color: '#000' },
  topicInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  generateBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  generateBtnDisabled: { opacity: 0.4 },
  generateBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  generatedBox: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.border, gap: 12 },
  generatedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  generatedTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  generatedText: { color: Colors.textSecondary, fontSize: 13 },
  generatedActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  generatedActionBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  generatedActionBtnPrimary: { backgroundColor: '#FFD700' },
  generatedActionText: { color: '#000000', fontSize: 13 },
  wrapLinkBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  wrapLinkBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  contentLinkCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  contentLinkHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  contentLinkBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  contentLinkBadgeText: { fontSize: 11, fontWeight: '700' as const },
  contentLinkQrRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contentLinkQrBox: { width: 80, height: 80, borderRadius: 8, overflow: 'hidden', backgroundColor: Colors.surface },
  contentLinkQr: { width: 80, height: 80 },
  contentLinkDetails: { flex: 1, gap: 6 },
  contentLinkCode: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  contentLinkUrl: { fontSize: 11, color: Colors.textSecondary },
  copyLinkBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  copyLinkBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  contentLinkLive: { flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 8 },
  liveIndicatorSmall: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDotSmall: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.positive },
  liveTextSmall: { fontSize: 11, fontWeight: '700' as const, color: Colors.positive },
  contentLinkStats: { flexDirection: 'row', gap: 8 },
  contentLinkStat: { flex: 1, alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 10, padding: 10, gap: 2 },
  contentLinkStatValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  contentLinkStatLabel: { color: Colors.textSecondary, fontSize: 13 },
  contentLinkActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  contentLinkActionBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  contentLinkActionBtnPrimary: { backgroundColor: '#FFD700' },
  contentLinkActionText: { color: '#000000', fontSize: 13 },
  wrappedContentPreview: { gap: 8 },
  wrappedContentLabel: { color: Colors.textSecondary, fontSize: 13 },
  wrappedContentScroll: { gap: 8 },
  wrappedContentText: { color: Colors.textSecondary, fontSize: 13 },
  copyWrappedBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  copyWrappedBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  influencerHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  influencerTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  influencerStats: { gap: 4 },
  influencerStat: { gap: 4 },
  influencerStatValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  influencerStatLabel: { color: Colors.textSecondary, fontSize: 13 },
  listTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  influencerCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  influencerRank: { gap: 4 },
  influencerRankText: { color: Colors.textSecondary, fontSize: 13 },
  influencerAvatar: { width: 40, height: 40, borderRadius: 20 },
  influencerInfo: { flex: 1 },
  influencerName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  influencerHandle: { gap: 4 },
  influencerMetrics: { gap: 4 },
  influencerEarnings: { gap: 4 },
  influencerFollowers: { gap: 4 },
  analyticsHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  analyticsTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  analyticsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  analyticCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  analyticCardLarge: { gap: 4 },
  analyticValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  analyticLabel: { color: Colors.textSecondary, fontSize: 13 },
  analyticTrend: { gap: 4 },
  analyticTrendText: { color: Colors.textSecondary, fontSize: 13 },
  insightsTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  insightCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  insightHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  insightTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  insightDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  bottomPadding: { height: 120 },
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  modalContent: { flex: 1, paddingHorizontal: 20 },
  userProfileCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  userProfileHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  userProfileAvatar: { width: 60, height: 60, borderRadius: 30 },
  userProfileInfo: { flex: 1 },
  userProfileName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  userProfileEmail: { color: Colors.textSecondary, fontSize: 13 },
  userProfileStats: { gap: 4 },
  userProfileStat: { gap: 4 },
  userProfileStatValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  userProfileStatLabel: { color: Colors.textSecondary, fontSize: 13 },
  aiRecommendations: { gap: 4 },
  aiRecommendationsTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  aiRecommendation: { gap: 4 },
  aiRecommendationText: { color: Colors.textSecondary, fontSize: 13 },
  messageLabel: { color: Colors.textSecondary, fontSize: 13 },
  loadingBox: { gap: 4 },
  loadingText: { color: Colors.textSecondary, fontSize: 13 },
  messageInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  modalFooter: { paddingHorizontal: 20, paddingBottom: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  sendBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  shareModalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  shareModalContainer: { backgroundColor: Colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 48, gap: 16, maxHeight: '85%' },
  shareModalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 4 },
  shareModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  shareModalTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  shareModalClose: { gap: 4 },
  sharePreview: { gap: 8 },
  sharePreviewLabel: { color: Colors.textSecondary, fontSize: 13 },
  sharePreviewScroll: { gap: 8 },
  sharePreviewText: { color: Colors.textSecondary, fontSize: 13 },
  sharePlatformsTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  sharePlatformsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sharePlatformBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  sharePlatformIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  sharePlatformName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  shareQuickActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  shareQuickBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  shareQuickBtnPrimary: { backgroundColor: '#FFD700' },
  shareQuickText: { color: '#000000', fontSize: 13 },
  linksHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  linksTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  linksSubtitle: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  createLinkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  createLinkBtnText: { color: '#000', fontWeight: '700' as const, fontSize: 13 },
  linkStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  linkStatCard: { flex: 1, minWidth: '44%', backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  linkStatCardPrimary: { backgroundColor: Colors.primary },
  linkStatValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  linkStatValueDark: { color: '#000', fontSize: 18, fontWeight: '800' as const },
  linkStatLabel: { color: Colors.textTertiary, fontSize: 11 },
  linkStatLabelDark: { color: '#000', fontSize: 11, opacity: 0.7 },
  liveEventsSection: { marginBottom: 16 },
  liveEventsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.positive },
  liveText: { color: Colors.text, fontSize: 13, fontWeight: '600' as const },
  liveEventsCount: { color: Colors.textSecondary, fontSize: 12 },
  liveEventsList: { paddingBottom: 4 },
  liveEventCard: { width: 150, backgroundColor: Colors.surface, borderRadius: 12, padding: 12, marginRight: 10, borderWidth: 1, borderColor: Colors.surfaceBorder },
  liveEventIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  liveEventType: { color: Colors.text, fontSize: 13, fontWeight: '600' as const, textTransform: 'capitalize' as const, marginBottom: 2 },
  liveEventUser: { color: Colors.textSecondary, fontSize: 12, marginBottom: 2 },
  liveEventAmount: { color: Colors.primary, fontSize: 13, fontWeight: '700' as const, marginBottom: 2 },
  liveEventTime: { color: Colors.textTertiary, fontSize: 11 },
  liveEventLocation: { color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  linkCount: { color: Colors.textSecondary, fontSize: 12 },
  linkCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  linkCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  linkInfo: { flex: 1 },
  linkName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  linkCode: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  linkStatusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  linkStatusText: { fontSize: 12, fontWeight: '600' as const },
  linkMetrics: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  linkMetric: { flex: 1, alignItems: 'center', gap: 2 },
  linkMetricValue: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  linkMetricLabel: { color: Colors.textTertiary, fontSize: 11 },
  linkActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  linkActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.backgroundSecondary, borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: Colors.border },
  linkActionBtnPrimary: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  linkActionText: { color: Colors.text, fontSize: 12, fontWeight: '600' as const },
  createLinkModalContainer: { backgroundColor: Colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 48, gap: 16 },
  createLinkLabel: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
  createLinkScrollView: { maxHeight: '100%' },
  createLinkInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  sourceTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sourceTypeBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  sourceTypeBtnActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  sourceTypeBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  sourceTypeBtnTextActive: { color: '#000' },
  createLinkSubmitBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  createLinkSubmitText: { color: Colors.black, fontSize: 15, fontWeight: '700' as const },
  linkDetailCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  linkDetailName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  linkDetailCode: { gap: 4 },
  qrCodeContainer: { gap: 8 },
  qrCode: { gap: 4 },
  linkUrlBox: { gap: 4 },
  linkUrlText: { color: Colors.textSecondary, fontSize: 13 },
  linkDetailStats: { gap: 4 },
  linkDetailStatRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  linkDetailStat: { gap: 4 },
  linkDetailStatValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  linkDetailStatLabel: { color: Colors.textSecondary, fontSize: 13 },
  linkConversionCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  linkConversionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  linkConversionValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  conversionBar: { gap: 4 },
  conversionBarFill: { gap: 4 },
  linkConversionDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  shareLinkActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  shareLinkBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  shareLinkBtnPrimary: { backgroundColor: '#FFD700' },
  shareLinkBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  imageSectionDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder },
  imageGenHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  imageGenTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  imageGenSubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  imageSizeSelector: { gap: 4 },
  imageSizeBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  imageSizeBtnActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  imageSizeBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  imageSizeBtnTextActive: { color: '#000' },
  imagePromptInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  generateImageBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  generateImageBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  generatedImageBox: { gap: 4 },
  generatedImageHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  generatedImageTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  generatedImage: { width: '100%', height: 180, borderRadius: 12 },
  generatedImagePortrait: { gap: 4 },
  generatedImageLandscape: { gap: 4 },
  generatedImageActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  imageActionBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  imageActionBtnPrimary: { backgroundColor: '#FFD700' },
  imageActionText: { color: '#000000', fontSize: 13 },
  generateVideoBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  generateVideoBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  generatedVideoBox: { gap: 4 },
  videoThumbnailContainer: { gap: 8 },
  videoThumbnail: { gap: 4 },
  videoPlayOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  videoPlayButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  videoDurationBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  videoScriptBox: { gap: 4 },
  videoScriptLabel: { color: Colors.textSecondary, fontSize: 13 },
  videoScriptScroll: { gap: 8 },
  videoScriptText: { color: Colors.textSecondary, fontSize: 13 },
  progressContainer: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 },
  progressBarBg: { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceBorder },
  progressBarFill: { height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  progressBarBgVideo: { gap: 4 },
  progressBarFillVideo: { gap: 4 },
  progressText: { color: Colors.textTertiary, fontSize: 12 },
  mediaUploadSection: { marginBottom: 16 },
  mediaUploadHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  mediaUploadTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mediaUploadTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  mediaUploadSubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  mediaItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  mediaItemImage: { width: '100%', height: 180, borderRadius: 12 },
  mediaVideoIndicator: { width: 4, borderRadius: 2 },
  mediaVideoDuration: { gap: 4 },
  mediaRemoveBtn: { backgroundColor: Colors.error + '15', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  mediaAddBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  mediaAddText: { color: Colors.textSecondary, fontSize: 13 },
  mediaEmptyState: { gap: 4 },
  mediaEmptyText: { color: Colors.textSecondary, fontSize: 13 },
  mediaCaptionSection: { marginBottom: 16 },
  mediaCaptionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  mediaCaptionLabel: { color: Colors.textSecondary, fontSize: 13 },
  mediaAiCaptionBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  mediaAiCaptionText: { color: Colors.textSecondary, fontSize: 13 },
  mediaCaptionInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  mediaCaptionCount: { gap: 4 },
  mediaPlatformSelector: { gap: 6 },
  mediaPlatformLabel: { color: Colors.textSecondary, fontSize: 13 },
  mediaPlatformGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  mediaPlatformChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.surfaceBorder },
  mediaPlatformChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  mediaPlatformChipText: { color: Colors.textSecondary, fontSize: 13 },
  mediaPlatformChipTextActive: { color: Colors.black },
  mediaPlatformCheck: { gap: 6 },
  mediaShareBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  mediaShareBtnDisabled: { opacity: 0.4 },
  mediaShareBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  mediaQuickShare: { gap: 4 },
  mediaQuickShareLabel: { color: Colors.textSecondary, fontSize: 13 },
  mediaQuickShareBtns: { gap: 4 },
  mediaQuickShareBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  mediaQuickShareBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  mediaInfoCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  mediaInfoContent: { flex: 1, gap: 4 },
  mediaInfoTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  mediaInfoText: { color: Colors.textSecondary, fontSize: 13 },
  contentDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder }});
