import React, { useState, useCallback } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  Share} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Rocket,
  TrendingUp,
  Users,
  Share2,
  Sparkles,
  Target,
  Globe,
  Copy,
  RefreshCw,
  ChevronRight,
  X,
  Search,
  Zap,
  Award,
  Gift,
  MessageCircle,
  Eye,
  MousePointer,
  Heart,
  DollarSign,
  CheckCircle,
  Clock,
  AlertTriangle,
  Play,
  Pause,
  PenTool,
  Image as ImageIcon,
  Video,
  FileText,
  Hash,
  ArrowLeft} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { formatCurrency as _fmtCurr } from '@/lib/formatters';
import {
  mockSocialContent,
  mockCampaigns,
  mockReferrals,
  mockReferralStats,
  mockTrendingTopics,
  mockAIInsights,
  mockGrowthStats,
  getPlatformIcon,
  getPlatformColor} from '@/mocks/marketing';
import {
  SocialMediaContent,
  SocialPlatform,
  ContentType,
  MarketingCampaign,
  Referral,
  TrendingTopic,
  AIMarketingInsight} from '@/types';
import { generateText } from '@/lib/ai-service';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { RefreshControl } from 'react-native';

type TabType = 'overview' | 'content' | 'campaigns' | 'referrals' | 'insights';

export default function GrowthScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [socialContent, setSocialContent] = useState<SocialMediaContent[]>(mockSocialContent);
  const [campaigns] = useState<MarketingCampaign[]>(mockCampaigns);
  const [referrals] = useState<Referral[]>(mockReferrals);
  const [trendingTopics] = useState<TrendingTopic[]>(mockTrendingTopics);
  const [aiInsights] = useState<AIMarketingInsight[]>(mockAIInsights);
  const [growthStats] = useState(mockGrowthStats);
  const [referralStats] = useState(mockReferralStats);
  
  const [showContentModal, setShowContentModal] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<SocialPlatform>('instagram');
  const [selectedContentType, setSelectedContentType] = useState<ContentType>('post');
  const [contentTopic, setContentTopic] = useState('');
  const [generatedContent, setGeneratedContent] = useState<SocialMediaContent | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSearchingTrends, setIsSearchingTrends] = useState(false);

  const formatCurrency = (amount: number) => _fmtCurr(amount);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'});
  };

  const generateAIContent = useCallback(async () => {
    if (!contentTopic.trim()) {
      Alert.alert('Topic Required', 'Please enter a topic or theme for the content.');
      return;
    }

    setIsGenerating(true);
    try {
      const platformGuide: Record<SocialPlatform, string> = {
        instagram: 'Visual-first, use emojis, engaging captions under 2200 chars, include call to action',
        facebook: 'Longer form, community-focused, can include links, conversational tone',
        twitter: 'Concise (280 chars), punchy, use hashtags sparingly, thread-friendly',
        linkedin: 'Professional tone, industry insights, thought leadership, longer articles ok',
        google: 'SEO-optimized, keyword-rich, clear value proposition for ads',
        tiktok: 'Trendy, casual, script-style for video, use trending sounds references'};

      const contentTypeGuide: Record<ContentType, string> = {
        post: 'Single image/text post with caption',
        story: 'Quick, ephemeral content, polls/questions encouraged',
        ad: 'Clear CTA, value proposition upfront, compelling hook',
        reel: 'Short video script, hook in first 3 seconds, trending format',
        article: 'Long-form, educational, well-structured with headers'};

      const prompt = `Create a ${selectedContentType} for ${selectedPlatform} about "${contentTopic}" for IVX HOLDINGS, a fractional real estate investment platform.

Platform guidelines: ${platformGuide[selectedPlatform]}
Content type: ${contentTypeGuide[selectedContentType]}

The content should:
- Highlight benefits of fractional real estate investing
- Be engaging and shareable
- Include a call to action
- Be authentic and not overly salesy

Respond in this exact JSON format:
{
  "title": "Short title for internal reference",
  "content": "The actual post content with emojis where appropriate",
  "hashtags": ["relevant", "hashtags", "without #"],
  "targetAudience": "Description of ideal audience"
}`;

      const response = await generateText(prompt);
      console.log('AI Content Response:', response);
      
      let parsed;
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found');
        }
      } catch {
        parsed = {
          title: contentTopic,
          content: response,
          hashtags: ['RealEstateInvesting', 'IPXHolding', 'FractionalOwnership'],
          targetAudience: 'Investors interested in real estate'};
      }

      const newContent: SocialMediaContent = {
        id: `content-${Date.now()}`,
        platform: selectedPlatform,
        contentType: selectedContentType,
        title: parsed.title || contentTopic,
        content: parsed.content || response,
        hashtags: parsed.hashtags || [],
        targetAudience: parsed.targetAudience || 'General investors',
        aiGenerated: true,
        status: 'draft',
        createdAt: new Date().toISOString()};

      setGeneratedContent(newContent);
    } catch (error) {
      console.error('Error generating content:', error);
      Alert.alert('Generation Failed', 'Could not generate content. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }, [contentTopic, selectedPlatform, selectedContentType]);

  const saveContent = useCallback(() => {
    if (!generatedContent) return;
    setSocialContent(prev => [generatedContent, ...prev]);
    setShowContentModal(false);
    setGeneratedContent(null);
    setContentTopic('');
    Alert.alert('Content Saved', 'Your AI-generated content has been saved as a draft.');
  }, [generatedContent]);

  const searchTrends = useCallback(async () => {
    setIsSearchingTrends(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      Alert.alert('Trends Updated', 'AI has discovered 5 new trending topics relevant to your business.');
    } finally {
      setIsSearchingTrends(false);
    }
  }, []);

  const shareApp = useCallback(async () => {
    try {
      const shareMessage = '🏠 Start investing in real estate with just $100! IVX HOLDINGS makes property investment accessible to everyone. Join me and earn rewards! Download now: https://ipxholding.com/app';
      const result = await Share.share({
        message: shareMessage,
        title: 'Invest in Real Estate with IVX HOLDINGS'});
      if (result.action === Share.sharedAction) {
        console.log('App shared successfully');
      }
    } catch (error) {
      console.error('Error sharing:', error);
    }
  }, []);

  const copyReferralLink = useCallback((code: string) => {
    const link = `https://ipxholding.com/join?ref=${code}`;
    Alert.alert('Link Copied', `Referral link for ${code} copied to clipboard!`);
    console.log('Copied referral link:', link);
  }, []);

  const getPriorityColor = (priority: AIMarketingInsight['priority']) => {
    switch (priority) {
      case 'high': return Colors.negative;
      case 'medium': return Colors.warning;
      case 'low': return Colors.positive;
    }
  };

  const getInsightIcon = (type: AIMarketingInsight['type']) => {
    switch (type) {
      case 'opportunity': return <Zap size={16} color={Colors.positive} />;
      case 'trend': return <TrendingUp size={16} color={Colors.primary} />;
      case 'recommendation': return <Target size={16} color={Colors.accent} />;
      case 'alert': return <AlertTriangle size={16} color={Colors.warning} />;
    }
  };

  const getStatusColor = (status: Referral['status']) => {
    switch (status) {
      case 'pending': return Colors.warning;
      case 'signed_up': return Colors.primary;
      case 'invested': return Colors.positive;
      case 'rewarded': return Colors.accent;
    }
  };

  const renderOverview = () => (
    <View style={styles.overviewContainer}>
      <View style={styles.heroCard}>
        <View style={styles.heroIcon}>
          <Rocket size={28} color="#000" />
        </View>
        <Text style={styles.heroTitle}>AI Growth Engine</Text>
        <Text style={styles.heroSubtitle}>
          Smart marketing powered by AI to help IVX HOLDINGS reach investors worldwide
        </Text>
        <View style={styles.heroActions}>
          <TouchableOpacity style={styles.heroButton} onPress={() => setShowContentModal(true)}>
            <Sparkles size={16} color="#000" />
            <Text style={styles.heroButtonText}>Generate Content</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.heroButtonSecondary} onPress={searchTrends} disabled={isSearchingTrends}>
            {isSearchingTrends ? (
              <ShimmerIndicator size="small" color={Colors.primary} />
            ) : (
              <>
                <Search size={16} color={Colors.primary} />
                <Text style={styles.heroButtonTextSecondary}>Find Trends</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Users size={20} color={Colors.primary} />
          <Text style={styles.statValue}>{formatNumber(growthStats.totalUsers)}</Text>
          <Text style={styles.statLabel}>Total Users</Text>
          <View style={styles.statBadge}>
            <TrendingUp size={10} color={Colors.positive} />
            <Text style={styles.statBadgeText}>+{growthStats.userGrowthPercent}%</Text>
          </View>
        </View>
        <View style={styles.statCard}>
          <Globe size={20} color={Colors.accent} />
          <Text style={styles.statValue}>{formatNumber(growthStats.socialReach)}</Text>
          <Text style={styles.statLabel}>Social Reach</Text>
        </View>
        <View style={styles.statCard}>
          <Share2 size={20} color={Colors.positive} />
          <Text style={styles.statValue}>{referralStats.totalReferrals}</Text>
          <Text style={styles.statLabel}>Referrals</Text>
        </View>
        <View style={styles.statCard}>
          <Heart size={20} color={Colors.negative} />
          <Text style={styles.statValue}>{growthStats.engagementRate}%</Text>
          <Text style={styles.statLabel}>Engagement</Text>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>AI Insights</Text>
          <TouchableOpacity onPress={() => setActiveTab('insights')}>
            <Text style={styles.seeAll}>See All</Text>
          </TouchableOpacity>
        </View>
        {aiInsights.slice(0, 3).map((insight) => (
          <View key={insight.id} style={styles.insightCard}>
            <View style={styles.insightHeader}>
              {getInsightIcon(insight.type)}
              <Text style={styles.insightTitle}>{insight.title}</Text>
              <View style={[styles.priorityBadge, { backgroundColor: getPriorityColor(insight.priority) + '20' }]}>
                <Text style={[styles.priorityText, { color: getPriorityColor(insight.priority) }]}>
                  {insight.priority}
                </Text>
              </View>
            </View>
            <Text style={styles.insightDescription} numberOfLines={2}>{insight.description}</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Top Referrers</Text>
          <TouchableOpacity onPress={() => setActiveTab('referrals')}>
            <Text style={styles.seeAll}>See All</Text>
          </TouchableOpacity>
        </View>
        {referralStats.topReferrers.slice(0, 3).map((referrer, index) => (
          <View key={referrer.id} style={styles.referrerCard}>
            <View style={styles.referrerRank}>
              <Text style={styles.referrerRankText}>{index + 1}</Text>
            </View>
            <View style={styles.referrerInfo}>
              <Text style={styles.referrerName}>{referrer.name}</Text>
              <Text style={styles.referrerEmail}>{referrer.email}</Text>
            </View>
            <View style={styles.referrerStats}>
              <Text style={styles.referrerCount}>{referrer.referralCount} referrals</Text>
              <Text style={styles.referrerAmount}>{formatCurrency(referrer.investmentGenerated)}</Text>
            </View>
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.shareCard} onPress={shareApp}>
        <View style={styles.shareIcon}>
          <Share2 size={24} color="#fff" />
        </View>
        <View style={styles.shareContent}>
          <Text style={styles.shareTitle}>Share IVX HOLDINGS</Text>
          <Text style={styles.shareSubtitle}>Invite friends and earn rewards for each investment</Text>
        </View>
        <ChevronRight size={20} color={Colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );

  const renderContentGenerator = () => (
    <View style={styles.listContainer}>
      <View style={styles.generatorHeader}>
        <Sparkles size={24} color={Colors.primary} />
        <Text style={styles.generatorTitle}>AI Content Generator</Text>
      </View>
      <Text style={styles.generatorSubtitle}>
        Create engaging social media content for any platform instantly
      </Text>

      <TouchableOpacity style={styles.generateButton} onPress={() => setShowContentModal(true)}>
        <PenTool size={18} color="#fff" />
        <Text style={styles.generateButtonText}>Create New Content</Text>
      </TouchableOpacity>

      <Text style={styles.listTitle}>Generated Content</Text>
      {socialContent.map((content) => (
        <View key={content.id} style={styles.contentCard}>
          <View style={styles.contentHeader}>
            <View style={[styles.platformBadge, { backgroundColor: getPlatformColor(content.platform) + '20' }]}>
              <Text style={styles.platformIcon}>{getPlatformIcon(content.platform)}</Text>
              <Text style={[styles.platformName, { color: getPlatformColor(content.platform) }]}>
                {content.platform}
              </Text>
            </View>
            <View style={[styles.contentStatus, { backgroundColor: content.status === 'posted' ? Colors.positive + '20' : content.status === 'approved' ? Colors.primary + '20' : Colors.warning + '20' }]}>
              <Text style={[styles.contentStatusText, { color: content.status === 'posted' ? Colors.positive : content.status === 'approved' ? Colors.primary : Colors.warning }]}>
                {content.status}
              </Text>
            </View>
          </View>
          <Text style={styles.contentTitle}>{content.title}</Text>
          <Text style={styles.contentText} numberOfLines={3}>{content.content}</Text>
          <View style={styles.contentHashtags}>
            {content.hashtags.slice(0, 3).map((tag, i) => (
              <View key={i} style={styles.hashtag}>
                <Hash size={10} color={Colors.primary} />
                <Text style={styles.hashtagText}>{tag}</Text>
              </View>
            ))}
            {content.hashtags.length > 3 && (
              <Text style={styles.moreHashtags}>+{content.hashtags.length - 3}</Text>
            )}
          </View>
          {content.engagement && (
            <View style={styles.contentEngagement}>
              <View style={styles.engagementItem}>
                <Heart size={12} color={Colors.textSecondary} />
                <Text style={styles.engagementText}>{formatNumber(content.engagement.likes)}</Text>
              </View>
              <View style={styles.engagementItem}>
                <Share2 size={12} color={Colors.textSecondary} />
                <Text style={styles.engagementText}>{formatNumber(content.engagement.shares)}</Text>
              </View>
              <View style={styles.engagementItem}>
                <MessageCircle size={12} color={Colors.textSecondary} />
                <Text style={styles.engagementText}>{formatNumber(content.engagement.comments)}</Text>
              </View>
              <View style={styles.engagementItem}>
                <Eye size={12} color={Colors.textSecondary} />
                <Text style={styles.engagementText}>{formatNumber(content.engagement.impressions)}</Text>
              </View>
            </View>
          )}
          {content.aiGenerated && (
            <View style={styles.aiBadge}>
              <Sparkles size={10} color={Colors.primary} />
              <Text style={styles.aiBadgeText}>AI Generated</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );

  const renderCampaigns = () => (
    <View style={styles.listContainer}>
      <View style={styles.campaignHeader}>
        <Target size={24} color={Colors.primary} />
        <Text style={styles.campaignHeaderTitle}>Marketing Campaigns</Text>
      </View>

      <View style={styles.campaignStats}>
        <View style={styles.campaignStatItem}>
          <Text style={styles.campaignStatValue}>{formatNumber(1570000)}</Text>
          <Text style={styles.campaignStatLabel}>Total Impressions</Text>
        </View>
        <View style={styles.campaignStatItem}>
          <Text style={styles.campaignStatValue}>$32,350</Text>
          <Text style={styles.campaignStatLabel}>Total Spent</Text>
        </View>
        <View style={styles.campaignStatItem}>
          <Text style={[styles.campaignStatValue, { color: Colors.positive }]}>225%</Text>
          <Text style={styles.campaignStatLabel}>Avg ROI</Text>
        </View>
      </View>

      {campaigns.map((campaign) => (
        <View key={campaign.id} style={styles.campaignCard}>
          <View style={styles.campaignCardHeader}>
            <View>
              <Text style={styles.campaignName}>{campaign.name}</Text>
              <Text style={styles.campaignDescription}>{campaign.description}</Text>
            </View>
            <View style={[styles.campaignStatus, { backgroundColor: campaign.status === 'active' ? Colors.positive + '20' : Colors.warning + '20' }]}>
              {campaign.status === 'active' ? <Play size={12} color={Colors.positive} /> : <Pause size={12} color={Colors.warning} />}
              <Text style={[styles.campaignStatusText, { color: campaign.status === 'active' ? Colors.positive : Colors.warning }]}>
                {campaign.status}
              </Text>
            </View>
          </View>

          <View style={styles.campaignPlatforms}>
            {campaign.platforms.map((platform) => (
              <View key={platform} style={[styles.platformChip, { backgroundColor: getPlatformColor(platform) + '20' }]}>
                <Text style={styles.platformChipIcon}>{getPlatformIcon(platform)}</Text>
              </View>
            ))}
          </View>

          <View style={styles.campaignBudget}>
            <Text style={styles.budgetLabel}>Budget</Text>
            <View style={styles.budgetBar}>
              <View style={[styles.budgetFill, { width: `${(campaign.spent / campaign.budget) * 100}%` }]} />
            </View>
            <Text style={styles.budgetText}>{formatCurrency(campaign.spent)} / {formatCurrency(campaign.budget)}</Text>
          </View>

          <View style={styles.campaignMetrics}>
            <View style={styles.metricItem}>
              <Eye size={14} color={Colors.textSecondary} />
              <Text style={styles.metricValue}>{formatNumber(campaign.metrics.impressions)}</Text>
              <Text style={styles.metricLabel}>Impressions</Text>
            </View>
            <View style={styles.metricItem}>
              <MousePointer size={14} color={Colors.textSecondary} />
              <Text style={styles.metricValue}>{formatNumber(campaign.metrics.clicks)}</Text>
              <Text style={styles.metricLabel}>Clicks</Text>
            </View>
            <View style={styles.metricItem}>
              <Users size={14} color={Colors.textSecondary} />
              <Text style={styles.metricValue}>{formatNumber(campaign.metrics.conversions)}</Text>
              <Text style={styles.metricLabel}>Conversions</Text>
            </View>
            <View style={styles.metricItem}>
              <TrendingUp size={14} color={Colors.positive} />
              <Text style={[styles.metricValue, { color: Colors.positive }]}>{campaign.metrics.roi}%</Text>
              <Text style={styles.metricLabel}>ROI</Text>
            </View>
          </View>

          {campaign.aiInsights.length > 0 && (
            <View style={styles.campaignInsights}>
              <Sparkles size={14} color={Colors.primary} />
              <Text style={styles.campaignInsightText}>{campaign.aiInsights[0]}</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );

  const renderReferrals = () => (
    <View style={styles.listContainer}>
      <View style={styles.referralHeader}>
        <Share2 size={24} color={Colors.primary} />
        <Text style={styles.referralHeaderTitle}>Referral Program</Text>
      </View>

      <View style={styles.referralStatsGrid}>
        <View style={styles.referralStatCard}>
          <Gift size={20} color={Colors.primary} />
          <Text style={styles.referralStatValue}>{referralStats.totalReferrals}</Text>
          <Text style={styles.referralStatLabel}>Total Referrals</Text>
        </View>
        <View style={styles.referralStatCard}>
          <CheckCircle size={20} color={Colors.positive} />
          <Text style={styles.referralStatValue}>{referralStats.investedReferrals}</Text>
          <Text style={styles.referralStatLabel}>Invested</Text>
        </View>
        <View style={styles.referralStatCard}>
          <DollarSign size={20} color={Colors.accent} />
          <Text style={styles.referralStatValue}>{formatCurrency(referralStats.totalRewardsPaid)}</Text>
          <Text style={styles.referralStatLabel}>Rewards Paid</Text>
        </View>
        <View style={styles.referralStatCard}>
          <TrendingUp size={20} color={Colors.warning} />
          <Text style={styles.referralStatValue}>{formatCurrency(referralStats.totalInvestmentFromReferrals)}</Text>
          <Text style={styles.referralStatLabel}>Investment</Text>
        </View>
      </View>

      <Text style={styles.listTitle}>Top Referrers</Text>
      {referralStats.topReferrers.map((referrer, index) => (
        <View key={referrer.id} style={styles.topReferrerCard}>
          <View style={[styles.rankBadge, index === 0 && styles.rankBadgeGold, index === 1 && styles.rankBadgeSilver, index === 2 && styles.rankBadgeBronze]}>
            <Award size={16} color="#fff" />
            <Text style={styles.rankText}>#{index + 1}</Text>
          </View>
          <View style={styles.topReferrerInfo}>
            <Text style={styles.topReferrerName}>{referrer.name}</Text>
            <Text style={styles.topReferrerEmail}>{referrer.email}</Text>
          </View>
          <View style={styles.topReferrerMetrics}>
            <Text style={styles.topReferrerCount}>{referrer.referralCount} referrals</Text>
            <Text style={styles.topReferrerAmount}>{formatCurrency(referrer.investmentGenerated)}</Text>
          </View>
          <TouchableOpacity onPress={() => copyReferralLink(referrer.name.split(' ')[0].toUpperCase())}>
            <Copy size={18} color={Colors.primary} />
          </TouchableOpacity>
        </View>
      ))}

      <Text style={[styles.listTitle, { marginTop: 24 }]}>Recent Referrals</Text>
      {referrals.map((referral) => (
        <View key={referral.id} style={styles.referralCard}>
          <View style={styles.referralCardHeader}>
            <View>
              <Text style={styles.referralReferrer}>From: {referral.referrerName}</Text>
              <Text style={styles.referralReferred}>To: {referral.referredName || referral.referredEmail}</Text>
            </View>
            <View style={[styles.referralStatus, { backgroundColor: getStatusColor(referral.status) + '20' }]}>
              <Text style={[styles.referralStatusText, { color: getStatusColor(referral.status) }]}>
                {referral.status.replace('_', ' ')}
              </Text>
            </View>
          </View>
          <View style={styles.referralDetails}>
            <View style={styles.referralDetail}>
              <Text style={styles.referralDetailLabel}>Code</Text>
              <Text style={styles.referralDetailValue}>{referral.referralCode}</Text>
            </View>
            <View style={styles.referralDetail}>
              <Text style={styles.referralDetailLabel}>Reward</Text>
              <Text style={styles.referralDetailValue}>{formatCurrency(referral.reward)}</Text>
            </View>
            {referral.investmentAmount && (
              <View style={styles.referralDetail}>
                <Text style={styles.referralDetailLabel}>Investment</Text>
                <Text style={[styles.referralDetailValue, { color: Colors.positive }]}>{formatCurrency(referral.investmentAmount)}</Text>
              </View>
            )}
          </View>
          <Text style={styles.referralDate}>{formatDate(referral.createdAt)}</Text>
        </View>
      ))}
    </View>
  );

  const renderInsights = () => (
    <View style={styles.listContainer}>
      <View style={styles.insightsHeader}>
        <View style={styles.insightsHeaderLeft}>
          <Sparkles size={24} color={Colors.primary} />
          <Text style={styles.insightsHeaderTitle}>AI Marketing Insights</Text>
        </View>
        <TouchableOpacity style={styles.refreshTrends} onPress={searchTrends} disabled={isSearchingTrends}>
          {isSearchingTrends ? (
            <ShimmerIndicator size="small" color={Colors.primary} />
          ) : (
            <RefreshCw size={18} color={Colors.primary} />
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.subsectionTitle}>Trending Topics</Text>
      {trendingTopics.map((topic) => (
        <View key={topic.id} style={styles.trendCard}>
          <View style={styles.trendHeader}>
            <View style={[styles.trendPlatform, { backgroundColor: getPlatformColor(topic.platform) + '20' }]}>
              <Text style={styles.trendPlatformIcon}>{getPlatformIcon(topic.platform)}</Text>
            </View>
            <View style={styles.trendInfo}>
              <Text style={styles.trendTopic}>{topic.topic}</Text>
              <Text style={styles.trendVolume}>{formatNumber(topic.volume)} mentions</Text>
            </View>
            <View style={styles.trendScore}>
              <Text style={styles.trendScoreValue}>{topic.relevanceScore}%</Text>
              <Text style={styles.trendScoreLabel}>Relevant</Text>
            </View>
          </View>
          <Text style={styles.trendSuggestion}>{topic.suggestedContent}</Text>
          <TouchableOpacity 
            style={styles.trendAction}
            onPress={() => {
              setContentTopic(topic.topic);
              setSelectedPlatform(topic.platform);
              setShowContentModal(true);
            }}
          >
            <Sparkles size={14} color={Colors.primary} />
            <Text style={styles.trendActionText}>Generate Content</Text>
          </TouchableOpacity>
        </View>
      ))}

      <Text style={[styles.subsectionTitle, { marginTop: 24 }]}>AI Recommendations</Text>
      {aiInsights.map((insight) => (
        <View key={insight.id} style={styles.insightCardFull}>
          <View style={styles.insightCardHeader}>
            <View style={styles.insightTypeIcon}>{getInsightIcon(insight.type)}</View>
            <View style={styles.insightCardInfo}>
              <Text style={styles.insightCardTitle}>{insight.title}</Text>
              <View style={[styles.insightPriority, { backgroundColor: getPriorityColor(insight.priority) + '20' }]}>
                <Text style={[styles.insightPriorityText, { color: getPriorityColor(insight.priority) }]}>
                  {insight.priority} priority
                </Text>
              </View>
            </View>
          </View>
          <Text style={styles.insightCardDescription}>{insight.description}</Text>
          <View style={styles.insightActions}>
            <Text style={styles.insightActionsTitle}>Action Items:</Text>
            {insight.actionItems.map((action, i) => (
              <View key={i} style={styles.actionItem}>
                <View style={styles.actionBullet} />
                <Text style={styles.actionText}>{action}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );

  const renderContentModal = () => (
    <Modal
      visible={showContentModal}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowContentModal(false)}
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => {
            setShowContentModal(false);
            setGeneratedContent(null);
            setContentTopic('');
          }}>
            <X size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>AI Content Generator</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView style={styles.modalContent}>
          <Text style={styles.modalSectionTitle}>Select Platform</Text>
          <View style={styles.platformSelector}>
            {(['instagram', 'facebook', 'twitter', 'linkedin', 'tiktok', 'google'] as SocialPlatform[]).map((platform) => (
              <TouchableOpacity
                key={platform}
                style={[styles.platformOption, selectedPlatform === platform && styles.platformOptionSelected]}
                onPress={() => setSelectedPlatform(platform)}
              >
                <Text style={styles.platformOptionIcon}>{getPlatformIcon(platform)}</Text>
                <Text style={[styles.platformOptionText, selectedPlatform === platform && styles.platformOptionTextSelected]}>
                  {platform}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.modalSectionTitle}>Content Type</Text>
          <View style={styles.contentTypeSelector}>
            {([
              { type: 'post' as ContentType, icon: ImageIcon, label: 'Post' },
              { type: 'story' as ContentType, icon: Clock, label: 'Story' },
              { type: 'reel' as ContentType, icon: Video, label: 'Reel' },
              { type: 'ad' as ContentType, icon: Target, label: 'Ad' },
              { type: 'article' as ContentType, icon: FileText, label: 'Article' },
            ]).map(({ type, icon: Icon, label }) => (
              <TouchableOpacity
                key={type}
                style={[styles.contentTypeOption, selectedContentType === type && styles.contentTypeOptionSelected]}
                onPress={() => setSelectedContentType(type)}
              >
                <Icon size={18} color={selectedContentType === type ? '#fff' : Colors.textSecondary} />
                <Text style={[styles.contentTypeText, selectedContentType === type && styles.contentTypeTextSelected]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.modalSectionTitle}>Topic or Theme</Text>
          <TextInput
            style={styles.topicInput}
            value={contentTopic}
            onChangeText={setContentTopic}
            placeholder="e.g., New Miami property listing, Investment tips for beginners..."
            placeholderTextColor={Colors.textTertiary}
            multiline
          />

          <TouchableOpacity
            style={[styles.generateContentButton, (!contentTopic.trim() || isGenerating) && styles.generateContentButtonDisabled]}
            onPress={generateAIContent}
            disabled={!contentTopic.trim() || isGenerating}
          >
            {isGenerating ? (
              <ShimmerIndicator size="small" color="#fff" />
            ) : (
              <>
                <Sparkles size={18} color="#fff" />
                <Text style={styles.generateContentButtonText}>Generate with AI</Text>
              </>
            )}
          </TouchableOpacity>

          {generatedContent && (
            <View style={styles.generatedContentPreview}>
              <Text style={styles.previewTitle}>Generated Content</Text>
              <View style={styles.previewCard}>
                <View style={styles.previewHeader}>
                  <View style={[styles.previewPlatform, { backgroundColor: getPlatformColor(generatedContent.platform) + '20' }]}>
                    <Text>{getPlatformIcon(generatedContent.platform)}</Text>
                    <Text style={[styles.previewPlatformText, { color: getPlatformColor(generatedContent.platform) }]}>
                      {generatedContent.platform}
                    </Text>
                  </View>
                  <Text style={styles.previewType}>{generatedContent.contentType}</Text>
                </View>
                <Text style={styles.previewContent}>{generatedContent.content}</Text>
                <View style={styles.previewHashtags}>
                  {generatedContent.hashtags.map((tag, i) => (
                    <Text key={i} style={styles.previewHashtag}>#{tag}</Text>
                  ))}
                </View>
                <Text style={styles.previewAudience}>Target: {generatedContent.targetAudience}</Text>
              </View>
              <TouchableOpacity style={styles.saveContentButton} onPress={saveContent}>
                <CheckCircle size={18} color="#fff" />
                <Text style={styles.saveContentButtonText}>Save as Draft</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>AI Growth</Text>
          <Text style={styles.subtitle}>Marketing & referrals powered by AI</Text>
        </View>
      </View>

      <View style={styles.tabContainer}>
        {[
          { key: 'overview', label: 'Overview' },
          { key: 'content', label: 'Content' },
          { key: 'campaigns', label: 'Campaigns' },
          { key: 'referrals', label: 'Referrals' },
          { key: 'insights', label: 'Insights' },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key as TabType)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'content' && renderContentGenerator()}
        {activeTab === 'campaigns' && renderCampaigns()}
        {activeTab === 'referrals' && renderReferrals()}
        {activeTab === 'insights' && renderInsights()}
        <View style={styles.bottomPadding} />
      </ScrollView>

      {renderContentModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  title: { color: Colors.text, fontSize: 18, fontWeight: '800' as const, flexShrink: 1 },
  subtitle: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  tabContainer: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 12, padding: 4, marginBottom: 16, marginHorizontal: 16 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: 13 },
  tabTextActive: { color: Colors.black },
  content: { flex: 1, paddingHorizontal: 20 },
  overviewContainer: { gap: 16 },
  heroCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  heroIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  heroTitle: { color: Colors.text, fontSize: 22, fontWeight: '800' as const, textAlign: 'center', marginBottom: 8 },
  heroSubtitle: { color: Colors.text, fontSize: 22, fontWeight: '800' as const, textAlign: 'center', marginBottom: 8 },
  heroActions: { flexDirection: 'row', gap: 12 },
  heroButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  heroButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  heroButtonSecondary: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  heroButtonTextSecondary: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  statBadge: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  statBadgeText: { fontSize: 10, fontWeight: '700' as const },
  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  seeAll: { color: Colors.primary, fontSize: 14, fontWeight: '600' as const },
  insightCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  insightHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  insightTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  priorityBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  priorityText: { color: Colors.textSecondary, fontSize: 13 },
  insightDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  referrerCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  referrerRank: { gap: 4 },
  referrerRankText: { color: Colors.textSecondary, fontSize: 13 },
  referrerInfo: { flex: 1 },
  referrerName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  referrerEmail: { color: Colors.textSecondary, fontSize: 13 },
  referrerStats: { gap: 4 },
  referrerCount: { gap: 4 },
  referrerAmount: { gap: 4 },
  shareCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  shareIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  shareContent: { flex: 1, gap: 4 },
  shareTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  shareSubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  listContainer: { gap: 10 },
  listTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  generatorHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  generatorTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  generatorSubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  generateButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  generateButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  contentCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  contentHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  platformBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  platformIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  platformName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  contentStatus: { gap: 4 },
  contentStatusText: { color: Colors.textSecondary, fontSize: 13 },
  contentTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  contentText: { color: Colors.textSecondary, fontSize: 13 },
  contentHashtags: { gap: 4 },
  hashtag: { backgroundColor: Colors.backgroundSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  hashtagText: { color: Colors.textSecondary, fontSize: 13 },
  moreHashtags: { gap: 4 },
  contentEngagement: { gap: 4 },
  engagementItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  engagementText: { color: Colors.textSecondary, fontSize: 13 },
  aiBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  aiBadgeText: { fontSize: 11, fontWeight: '700' as const },
  campaignHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  campaignHeaderTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  campaignStats: { gap: 4 },
  campaignStatItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  campaignStatValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  campaignStatLabel: { color: Colors.textSecondary, fontSize: 13 },
  campaignCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  campaignCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  campaignName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  campaignDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  campaignStatus: { gap: 4 },
  campaignStatusText: { color: Colors.textSecondary, fontSize: 13 },
  campaignPlatforms: { gap: 6 },
  platformChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.surfaceBorder },
  platformChipIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  campaignBudget: { gap: 4 },
  budgetLabel: { color: Colors.textSecondary, fontSize: 13 },
  budgetBar: { gap: 4 },
  budgetFill: { gap: 4 },
  budgetText: { color: Colors.textSecondary, fontSize: 13 },
  campaignMetrics: { gap: 4 },
  metricItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  metricValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  metricLabel: { color: Colors.textSecondary, fontSize: 13 },
  campaignInsights: { gap: 4 },
  campaignInsightText: { color: Colors.textSecondary, fontSize: 13 },
  referralHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  referralHeaderTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  referralStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  referralStatCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  referralStatValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  referralStatLabel: { color: Colors.textSecondary, fontSize: 13 },
  topReferrerCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  rankBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  rankBadgeGold: { gap: 4 },
  rankBadgeSilver: { gap: 4 },
  rankBadgeBronze: { gap: 4 },
  rankText: { color: Colors.textSecondary, fontSize: 13 },
  topReferrerInfo: { flex: 1 },
  topReferrerName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  topReferrerEmail: { color: Colors.textSecondary, fontSize: 13 },
  topReferrerMetrics: { gap: 4 },
  topReferrerCount: { gap: 4 },
  topReferrerAmount: { gap: 4 },
  referralCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  referralCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  referralReferrer: { gap: 4 },
  referralReferred: { gap: 4 },
  referralStatus: { gap: 4 },
  referralStatusText: { color: Colors.textSecondary, fontSize: 13 },
  referralDetails: { gap: 4 },
  referralDetail: { gap: 4 },
  referralDetailLabel: { color: Colors.textSecondary, fontSize: 13 },
  referralDetailValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  referralDate: { color: Colors.textTertiary, fontSize: 12 },
  insightsHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  insightsHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  insightsHeaderTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  refreshTrends: { gap: 4 },
  subsectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  trendCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  trendHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  trendPlatform: { gap: 6 },
  trendPlatformIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  trendInfo: { flex: 1 },
  trendTopic: { gap: 4 },
  trendVolume: { gap: 4 },
  trendScore: { alignItems: 'center', gap: 4 },
  trendScoreValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  trendScoreLabel: { color: Colors.textSecondary, fontSize: 13 },
  trendSuggestion: { gap: 4 },
  trendAction: { gap: 4 },
  trendActionText: { color: Colors.textSecondary, fontSize: 13 },
  insightCardFull: { flex: 1 },
  insightCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  insightTypeIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  insightCardInfo: { flex: 1 },
  insightCardTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  insightPriority: { gap: 4 },
  insightPriorityText: { color: Colors.textSecondary, fontSize: 13 },
  insightCardDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  insightActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  insightActionsTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  actionItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  actionBullet: { gap: 4 },
  actionText: { color: Colors.textSecondary, fontSize: 13 },
  bottomPadding: { height: 120 },
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  modalContent: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  modalSectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 10 },
  platformSelector: { gap: 6 },
  platformOption: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder },
  platformOptionSelected: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  platformOptionIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  platformOptionText: { color: Colors.textSecondary, fontSize: 13 },
  platformOptionTextSelected: { color: Colors.primary },
  contentTypeSelector: { gap: 4 },
  contentTypeOption: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder },
  contentTypeOptionSelected: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  contentTypeText: { color: Colors.textSecondary, fontSize: 13 },
  contentTypeTextSelected: { color: '#FFD700' },
  topicInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  generateContentButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  generateContentButtonDisabled: { opacity: 0.4 },
  generateContentButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  generatedContentPreview: { gap: 8 },
  previewTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  previewCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  previewHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  previewPlatform: { gap: 6 },
  previewPlatformText: { color: Colors.textSecondary, fontSize: 13 },
  previewType: { gap: 8 },
  previewContent: { flex: 1, gap: 4 },
  previewHashtags: { gap: 8 },
  previewHashtag: { backgroundColor: Colors.backgroundSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  previewAudience: { gap: 8 },
  saveContentButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveContentButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 }});
