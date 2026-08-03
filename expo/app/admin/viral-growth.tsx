import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
  Alert,
  Animated,
  Platform} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Zap,
  Share2,
  TrendingUp,
  Users,
  Copy,
  CheckCircle,
  Plus,
  Trash2,
  BarChart3,
  Target,
  Gift,
  Clock,
  Flame,
  Star,
  MessageSquare,
  Instagram,
  Twitter,
  Music2,
  Youtube,
  Link,
  Sparkles,
  ChevronRight,
  Eye,
  DollarSign,
  Award,
  Megaphone,
  RefreshCw,
  Play,
  FileText} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';

type TabType = 'viral' | 'campaigns' | 'fomo' | 'content' | 'loops';

interface ShareCard {
  id: string;
  title: string;
  template: string;
  uses: number;
  shares: number;
  conversions: number;
  active: boolean;
}

interface Campaign {
  id: string;
  name: string;
  platform: 'instagram' | 'tiktok' | 'twitter' | 'youtube' | 'email';
  influencer: string;
  status: 'live' | 'paused' | 'ended';
  impressions: number;
  clicks: number;
  signups: number;
  investments: number;
  roi: number;
  budget: number;
  spent: number;
  code: string;
  startDate: string;
}

interface FOMOTrigger {
  id: string;
  type: 'countdown' | 'slots' | 'social_proof' | 'trending';
  label: string;
  message: string;
  active: boolean;
  screen: string;
  impressions: number;
  conversions: number;
}

interface ContentItem {
  id: string;
  type: 'caption' | 'script' | 'hashtags' | 'story';
  platform: string;
  title: string;
  content: string;
  copiedId?: string;
}

interface ViralLoop {
  id: string;
  name: string;
  trigger: string;
  action: string;
  reward: string;
  active: boolean;
  activations: number;
  conversions: number;
}

const SHARE_CARDS: ShareCard[] = [
  { id: '1', title: 'Property Ownership Card', template: 'I own {share}% of {property} 🏢\nEarning ${monthly}/month in passive income via @IPXHolding', uses: 1240, shares: 892, conversions: 67, active: true },
  { id: '2', title: 'Portfolio Milestone', template: 'Just crossed ${amount} in real estate investments 📈\nAll from my phone with @IPXHolding', uses: 876, shares: 634, conversions: 54, active: true },
  { id: '3', title: 'First Investment', template: 'I just bought my first piece of real estate for just ${amount} 🎉\nFractional investing is wild. Try @IPXHolding', uses: 2140, shares: 1820, conversions: 143, active: true },
  { id: '4', title: 'Monthly Dividend', template: 'Received ${amount} in real estate dividends this month 💰\nPassive income hits different. Link: ipxholding.com/join', uses: 543, shares: 421, conversions: 38, active: false },
  { id: '5', title: 'ROI Showcase', template: 'My IVXHOLDINGS portfolio is up {roi}% since I started 🚀\nReal estate investing without the headache.', uses: 312, shares: 248, conversions: 29, active: true },
];

const CAMPAIGNS: Campaign[] = [
  { id: '1', name: 'RE Investors Q1', platform: 'instagram', influencer: '@wealthwithmike', status: 'live', impressions: 284000, clicks: 14200, signups: 892, investments: 143, roi: 340, budget: 2500, spent: 1840, code: 'MIKE25', startDate: '2026-01-15' },
  { id: '2', name: 'Fractional RE TikTok', platform: 'tiktok', influencer: '@financetok_sara', status: 'live', impressions: 520000, clicks: 31200, signups: 1240, investments: 198, roi: 520, budget: 3000, spent: 2100, code: 'SARA30', startDate: '2026-01-20' },
  { id: '3', name: 'Passive Income Series', platform: 'youtube', influencer: '@passiveincomelab', status: 'live', impressions: 145000, clicks: 8700, signups: 412, investments: 87, roi: 290, budget: 5000, spent: 3200, code: 'PILAB20', startDate: '2026-02-01' },
  { id: '4', name: 'Twitter Finance Thread', platform: 'twitter', influencer: '@investwithdan', status: 'paused', impressions: 92000, clicks: 4100, signups: 187, investments: 34, roi: 140, budget: 1500, spent: 1500, code: 'DAN15', startDate: '2026-01-10' },
  { id: '5', name: 'New Year Portfolio', platform: 'instagram', influencer: '@luxuryliving_k', status: 'ended', impressions: 310000, clicks: 18600, signups: 743, investments: 121, roi: 380, budget: 2000, spent: 2000, code: 'KENDRA20', startDate: '2026-01-01' },
];

const FOMO_TRIGGERS: FOMOTrigger[] = [
  { id: '1', type: 'slots', label: 'Limited Slots', message: 'Only {n} investor spots left on this property', active: true, screen: 'Property Detail', impressions: 18420, conversions: 2140 },
  { id: '2', type: 'countdown', label: 'Deal Countdown', message: 'Offer closes in {hours}h {mins}m', active: true, screen: 'Property Detail', impressions: 14310, conversions: 1820 },
  { id: '3', type: 'social_proof', label: 'Live Investor Count', message: '{n} people invested in the last 24 hours', active: true, screen: 'Home Feed', impressions: 32100, conversions: 3240 },
  { id: '4', type: 'trending', label: 'Trending Badge', message: '🔥 Trending — {n} views this week', active: true, screen: 'Property Card', impressions: 41200, conversions: 4810 },
  { id: '5', type: 'social_proof', label: 'Waitlist Counter', message: '{n} people waiting for next batch', active: false, screen: 'Waitlist', impressions: 6200, conversions: 540 },
  { id: '6', type: 'countdown', label: 'Early Bird Timer', message: 'Early bird rate ends in {hours}h', active: true, screen: 'Signup', impressions: 9840, conversions: 1120 },
];

const CONTENT_ITEMS: ContentItem[] = [
  { id: '1', type: 'caption', platform: 'Instagram', title: 'First Investment Hook', content: "POV: You just bought a piece of a Miami penthouse for $100 🏙️\n\nFractional real estate is changing who gets to build wealth.\n\nIVXHOLDINGS lets you own real property, earn monthly dividends, and sell anytime.\n\nLink in bio 👆\n\n#RealEstateInvesting #PassiveIncome #FractionalRealEstate #WealthBuilding #InvestingForBeginners" },
  { id: '2', type: 'script', platform: 'TikTok', title: '30-Second Hook Script', content: "Hook (0-3s): \"I make money while I sleep from real estate — and I've never owned a house.\"\n\nBody (3-20s): Show the app. Open portfolio. Show property. Show dividend payment hitting.\n\nCTA (20-30s): \"I started with $100. Link in bio to try IVXHOLDINGS — use my code {CODE} for a bonus.\"\n\nMusic: trending finance/luxury sound" },
  { id: '3', type: 'hashtags', platform: 'All', title: 'Niche RE Investor Hashtags', content: "#RealEstateInvesting #FractionalRealEstate #PassiveIncome #WealthBuilding #REITs #PropertyInvestment #FinancialFreedom #InvestingTips #MoneyMindset #DividendInvesting #PortfolioGrowth #RealEstateCrowdfunding #InvestSmart #IPXHolding #BuildWealth" },
  { id: '4', type: 'story', platform: 'Instagram', title: 'Story Sequence (5 slides)', content: "Slide 1: \"Did you know you can own real estate from your phone? 👇\"\nSlide 2: Show app screenshot — property card with address + price\nSlide 3: \"I own 0.3% of THIS building\" + share card graphic\nSlide 4: Monthly dividend screenshot + \"$47 this month 💸\"\nSlide 5: \"Swipe up → Use code {CODE} for bonus shares\"" },
  { id: '5', type: 'caption', platform: 'Twitter/X', title: 'Thread Starter', content: "I invested $500 into real estate from my phone last month.\n\nHere's what happened (thread) 🧵👇" },
  { id: '6', type: 'script', platform: 'YouTube', title: 'Full Video Script Outline', content: "INTRO (0-30s): Hook — show portfolio value, reveal it's all real estate from phone\n\nPROBLEM (30s-2m): Traditional RE is expensive, hard, requires credit\n\nSOLUTION (2m-5m): Walkthrough IVXHOLDINGS app — sign up, browse properties, invest $100\n\nSOCIAL PROOF (5m-7m): Show portfolio, dividends, community size\n\nCTA (7m-8m): Link in description, use code {CODE}\n\nOUTRO: Like + subscribe for monthly portfolio updates" },
];

const VIRAL_LOOPS: ViralLoop[] = [
  { id: '1', name: 'Investment Share Moment', trigger: 'User completes first investment', action: 'Show shareable property card + prompt to post', reward: '$10 bonus shares for sharing', active: true, activations: 4820, conversions: 1240 },
  { id: '2', name: 'Dividend Received Share', trigger: 'Monthly dividend paid out', action: 'Auto-generate earnings card + share prompt', reward: 'Badge + leaderboard boost', active: true, activations: 3140, conversions: 892 },
  { id: '3', name: 'Portfolio Milestone', trigger: 'Portfolio crosses $500 / $1K / $5K', action: 'Celebrate with shareable milestone card', reward: 'Exclusive VIP tier unlock', active: true, activations: 1820, conversions: 543 },
  { id: '4', name: 'Referral Chain Reward', trigger: 'Referred user makes first investment', action: 'Notify referrer + show chain growing', reward: '2% commission on referral investment', active: true, activations: 2410, conversions: 1180 },
  { id: '5', name: 'Waitlist FOMO Loop', trigger: 'Property sells out', action: 'Join waitlist + auto-share "I\'m on the waitlist" card', reward: 'Early access to next property', active: false, activations: 840, conversions: 210 },
];

const formatNumber = (n: number) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
};

const getPlatformIcon = (platform: Campaign['platform'], size: number, color: string) => {
  switch (platform) {
    case 'instagram': return <Instagram size={size} color={color} />;
    case 'tiktok': return <Music2 size={size} color={color} />;
    case 'twitter': return <Twitter size={size} color={color} />;
    case 'youtube': return <Youtube size={size} color={color} />;
    default: return <Megaphone size={size} color={color} />;
  }
};

const getPlatformColor = (platform: Campaign['platform']) => {
  switch (platform) {
    case 'instagram': return '#E1306C';
    case 'tiktok': return '#FF0050';
    case 'twitter': return '#1DA1F2';
    case 'youtube': return '#FF0000';
    default: return Colors.accent;
  }
};

const getStatusColor = (status: Campaign['status']) => {
  if (status === 'live') return Colors.positive;
  if (status === 'paused') return Colors.warning;
  return Colors.textTertiary;
};

export default function ViralGrowthHub() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('viral');
  const [cards, setCards] = useState<ShareCard[]>(SHARE_CARDS);
  const [fomoTriggers, setFomoTriggers] = useState<FOMOTrigger[]>(FOMO_TRIGGERS);
  const [loops, setLoops] = useState<ViralLoop[]>(VIRAL_LOOPS);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pulseAnim] = useState(new Animated.Value(1));

  React.useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const totalImpressions = useMemo(() => CAMPAIGNS.filter(c => c.status !== 'ended').reduce((a, c) => a + c.impressions, 0), []);
  const totalSignups = useMemo(() => CAMPAIGNS.reduce((a, c) => a + c.signups, 0), []);
  const totalROI = useMemo(() => {
    const live = CAMPAIGNS.filter(c => c.status === 'live');
    return live.reduce((a, c) => a + c.roi, 0) / live.length;
  }, []);
  const totalShares = useMemo(() => cards.filter(c => c.active).reduce((a, c) => a + c.shares, 0), [cards]);

  const copyContent = useCallback(async (id: string, text: string) => {
    try {
      const { safeSetString: safeCopy } = await import('@/lib/safe-clipboard');
      await safeCopy(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Content', text.substring(0, 100) + '...');
    }
  }, []);

  const toggleCard = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCards(prev => prev.map(c => c.id === id ? { ...c, active: !c.active } : c));
  }, []);

  const toggleFomo = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFomoTriggers(prev => prev.map(f => f.id === id ? { ...f, active: !f.active } : f));
  }, []);

  const toggleLoop = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoops(prev => prev.map(l => l.id === id ? { ...l, active: !l.active } : l));
  }, []);

  const getFomoTypeColor = (type: FOMOTrigger['type']) => {
    switch (type) {
      case 'countdown': return Colors.negative;
      case 'slots': return Colors.warning;
      case 'social_proof': return Colors.positive;
      case 'trending': return '#FF6B35';
    }
  };

  const getFomoTypeEmoji = (type: FOMOTrigger['type']) => {
    switch (type) {
      case 'countdown': return '⏰';
      case 'slots': return '🎯';
      case 'social_proof': return '👥';
      case 'trending': return '🔥';
    }
  };

  const getContentTypeIcon = (type: ContentItem['type']) => {
    switch (type) {
      case 'caption': return <MessageSquare size={14} color={Colors.accent} />;
      case 'script': return <Play size={14} color={Colors.negative} />;
      case 'hashtags': return <Target size={14} color={Colors.positive} />;
      case 'story': return <FileText size={14} color={Colors.warning} />;
    }
  };

  const getContentTypeColor = (type: ContentItem['type']) => {
    switch (type) {
      case 'caption': return Colors.accent;
      case 'script': return Colors.negative;
      case 'hashtags': return Colors.positive;
      case 'story': return Colors.warning;
    }
  };

  const TABS = [
    { key: 'viral' as TabType, label: 'Share Cards', icon: Share2 },
    { key: 'campaigns' as TabType, label: 'Campaigns', icon: BarChart3 },
    { key: 'fomo' as TabType, label: 'FOMO', icon: Flame },
    { key: 'content' as TabType, label: 'Content Kit', icon: Sparkles },
    { key: 'loops' as TabType, label: 'Viral Loops', icon: RefreshCw },
  ];

  const renderViralCards = () => (
    <View style={styles.tabContent}>
      <View style={styles.heroRow}>
        <View style={[styles.heroMetric, { borderColor: Colors.primary + '40' }]}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <Share2 size={16} color={Colors.primary} />
          </Animated.View>
          <Text style={styles.heroMetricVal}>{formatNumber(totalShares)}</Text>
          <Text style={styles.heroMetricLabel}>Total Shares</Text>
        </View>
        <View style={[styles.heroMetric, { borderColor: Colors.positive + '40' }]}>
          <Users size={16} color={Colors.positive} />
          <Text style={styles.heroMetricVal}>{formatNumber(totalSignups)}</Text>
          <Text style={styles.heroMetricLabel}>Signups</Text>
        </View>
        <View style={[styles.heroMetric, { borderColor: Colors.accent + '40' }]}>
          <TrendingUp size={16} color={Colors.accent} />
          <Text style={styles.heroMetricVal}>{formatNumber(totalImpressions)}</Text>
          <Text style={styles.heroMetricLabel}>Impressions</Text>
        </View>
      </View>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Viral Share Cards</Text>
        <TouchableOpacity
          style={styles.smallAddBtn}
          onPress={() => Alert.alert('New Card', 'Create a new viral share card template for investors to post on social media after key moments.')}
        >
          <Plus size={14} color={Colors.black} />
          <Text style={styles.smallAddBtnText}>New Card</Text>
        </TouchableOpacity>
      </View>

      {cards.map(card => (
        <View key={card.id} style={[styles.shareCard, !card.active && styles.cardOff]}>
          <View style={styles.shareCardHeader}>
            <View style={styles.shareCardLeft}>
              <View style={[styles.shareCardIcon, { backgroundColor: Colors.primary + '15' }]}>
                <Star size={16} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.shareCardTitle, !card.active && styles.dimText]}>{card.title}</Text>
                <View style={styles.shareCardMetrics}>
                  <Eye size={10} color={Colors.textTertiary} />
                  <Text style={styles.shareCardMetricText}>{formatNumber(card.uses)} uses</Text>
                  <Share2 size={10} color={Colors.accent} />
                  <Text style={[styles.shareCardMetricText, { color: Colors.accent }]}>{formatNumber(card.shares)} shares</Text>
                  <Target size={10} color={Colors.positive} />
                  <Text style={[styles.shareCardMetricText, { color: Colors.positive }]}>{card.conversions} conv</Text>
                </View>
              </View>
            </View>
            <Switch
              value={card.active}
              onValueChange={() => toggleCard(card.id)}
              trackColor={{ false: Colors.surfaceBorder, true: Colors.primary + '60' }}
              thumbColor={card.active ? Colors.primary : Colors.textTertiary}
            />
          </View>
          <View style={styles.shareCardTemplate}>
            <Text style={styles.shareCardTemplateText} numberOfLines={2}>{card.template}</Text>
          </View>
          <View style={styles.shareCardFooter}>
            <View style={[styles.convBadge, { backgroundColor: card.conversions > 50 ? Colors.positive + '15' : Colors.surfaceBorder }]}>
              <Text style={[styles.convBadgeText, { color: card.conversions > 50 ? Colors.positive : Colors.textTertiary }]}>
                {((card.conversions / card.shares) * 100).toFixed(1)}% CVR
              </Text>
            </View>
            <TouchableOpacity
              style={styles.previewBtn}
              onPress={() => Alert.alert(card.title, card.template)}
            >
              <Eye size={12} color={Colors.textSecondary} />
              <Text style={styles.previewBtnText}>Preview</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      <View style={styles.viralTip}>
        <Zap size={14} color={Colors.primary} />
        <Text style={styles.viralTipText}>
          Best performing cards are shown automatically after key moments: first investment, dividend received, portfolio milestones.
        </Text>
      </View>
    </View>
  );

  const renderCampaigns = () => (
    <View style={styles.tabContent}>
      <View style={styles.heroRow}>
        <View style={[styles.heroMetric, { borderColor: Colors.positive + '40' }]}>
          <TrendingUp size={16} color={Colors.positive} />
          <Text style={styles.heroMetricVal}>{totalROI.toFixed(0)}%</Text>
          <Text style={styles.heroMetricLabel}>Avg ROI</Text>
        </View>
        <View style={[styles.heroMetric, { borderColor: Colors.primary + '40' }]}>
          <Play size={16} color={Colors.primary} />
          <Text style={styles.heroMetricVal}>{CAMPAIGNS.filter(c => c.status === 'live').length}</Text>
          <Text style={styles.heroMetricLabel}>Live Now</Text>
        </View>
        <View style={[styles.heroMetric, { borderColor: Colors.accent + '40' }]}>
          <DollarSign size={16} color={Colors.accent} />
          <Text style={styles.heroMetricVal}>${(CAMPAIGNS.reduce((a, c) => a + c.spent, 0) / 1000).toFixed(1)}K</Text>
          <Text style={styles.heroMetricLabel}>Total Spent</Text>
        </View>
      </View>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Influencer Campaigns</Text>
        <TouchableOpacity
          style={styles.smallAddBtn}
          onPress={() => Alert.alert('New Campaign', 'Create a new influencer campaign. Set budget, platform, tracking code, and expected deliverables.')}
        >
          <Plus size={14} color={Colors.black} />
          <Text style={styles.smallAddBtnText}>New</Text>
        </TouchableOpacity>
      </View>

      {CAMPAIGNS.map(campaign => (
        <View key={campaign.id} style={[styles.campaignCard, campaign.status === 'ended' && styles.cardOff]}>
          <View style={styles.campaignHeader}>
            <View style={[styles.platformIcon, { backgroundColor: getPlatformColor(campaign.platform) + '20' }]}>
              {getPlatformIcon(campaign.platform, 16, getPlatformColor(campaign.platform))}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.campaignName}>{campaign.name}</Text>
              <Text style={styles.campaignInfluencer}>{campaign.influencer}</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: getStatusColor(campaign.status) + '20' }]}>
              {campaign.status === 'live' && (
                <Animated.View style={[styles.liveIndicator, { transform: [{ scale: pulseAnim }] }]}>
                  <View style={[styles.liveDot, { backgroundColor: getStatusColor(campaign.status) }]} />
                </Animated.View>
              )}
              <Text style={[styles.statusPillText, { color: getStatusColor(campaign.status) }]}>
                {campaign.status.toUpperCase()}
              </Text>
            </View>
          </View>

          <View style={styles.campaignMetrics}>
            <View style={styles.campaignMetric}>
              <Text style={styles.campaignMetricVal}>{formatNumber(campaign.impressions)}</Text>
              <Text style={styles.campaignMetricLabel}>Reach</Text>
            </View>
            <View style={styles.campaignMetric}>
              <Text style={styles.campaignMetricVal}>{formatNumber(campaign.clicks)}</Text>
              <Text style={styles.campaignMetricLabel}>Clicks</Text>
            </View>
            <View style={styles.campaignMetric}>
              <Text style={styles.campaignMetricVal}>{campaign.signups}</Text>
              <Text style={styles.campaignMetricLabel}>Signups</Text>
            </View>
            <View style={styles.campaignMetric}>
              <Text style={[styles.campaignMetricVal, { color: Colors.positive }]}>{campaign.roi}%</Text>
              <Text style={styles.campaignMetricLabel}>ROI</Text>
            </View>
          </View>

          <View style={styles.campaignBudgetRow}>
            <View style={styles.campaignBudgetBar}>
              <View style={[styles.campaignBudgetFill, { width: `${Math.min((campaign.spent / campaign.budget) * 100, 100)}%` as any, backgroundColor: campaign.spent >= campaign.budget ? Colors.negative : Colors.primary }]} />
            </View>
            <Text style={styles.campaignBudgetText}>${new Intl.NumberFormat('en-US').format(campaign.spent)}/${new Intl.NumberFormat('en-US').format(campaign.budget)}</Text>
          </View>

          <View style={styles.campaignCodeRow}>
            <View style={styles.codeChip}>
              <Link size={11} color={Colors.textTertiary} />
              <Text style={styles.codeChipText}>{campaign.code}</Text>
            </View>
            <Text style={styles.campaignDate}>Started {campaign.startDate}</Text>
          </View>
        </View>
      ))}
    </View>
  );

  const renderFOMO = () => (
    <View style={styles.tabContent}>
      <View style={styles.fomoHero}>
        <Flame size={22} color='#FF6B35' />
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Text style={styles.fomoHeroTitle}>FOMO Engine</Text>
          <Text style={styles.fomoHeroSub}>Psychological triggers that drive urgency & action</Text>
        </View>
        <View style={[styles.fomoHeroBadge, { backgroundColor: '#FF6B35' + '20' }]}>
          <Text style={[styles.fomoHeroBadgeText, { color: '#FF6B35' }]}>
            {fomoTriggers.filter(f => f.active).length} Active
          </Text>
        </View>
      </View>

      <View style={styles.fomoStats}>
        <View style={styles.fomoStat}>
          <Text style={[styles.fomoStatVal, { color: '#FF6B35' }]}>
            {formatNumber(fomoTriggers.filter(f => f.active).reduce((a, f) => a + f.impressions, 0))}
          </Text>
          <Text style={styles.fomoStatLabel}>Impressions</Text>
        </View>
        <View style={styles.fomoStatDivider} />
        <View style={styles.fomoStat}>
          <Text style={[styles.fomoStatVal, { color: Colors.positive }]}>
            {formatNumber(fomoTriggers.filter(f => f.active).reduce((a, f) => a + f.conversions, 0))}
          </Text>
          <Text style={styles.fomoStatLabel}>Conversions</Text>
        </View>
        <View style={styles.fomoStatDivider} />
        <View style={styles.fomoStat}>
          <Text style={[styles.fomoStatVal, { color: Colors.primary }]}>
            {(fomoTriggers.filter(f => f.active).reduce((a, f) => a + f.conversions, 0) / fomoTriggers.filter(f => f.active).reduce((a, f) => a + f.impressions, 0) * 100).toFixed(1)}%
          </Text>
          <Text style={styles.fomoStatLabel}>FOMO CVR</Text>
        </View>
      </View>

      {fomoTriggers.map(trigger => (
        <View key={trigger.id} style={[styles.fomoCard, !trigger.active && styles.cardOff]}>
          <View style={styles.fomoCardHeader}>
            <Text style={styles.fomoEmoji}>{getFomoTypeEmoji(trigger.type)}</Text>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <View style={styles.fomoCardTitleRow}>
                <Text style={[styles.fomoCardTitle, !trigger.active && styles.dimText]}>{trigger.label}</Text>
                <View style={[styles.fomoTypeBadge, { backgroundColor: getFomoTypeColor(trigger.type) + '20' }]}>
                  <Text style={[styles.fomoTypeBadgeText, { color: getFomoTypeColor(trigger.type) }]}>{trigger.type.replace('_', ' ')}</Text>
                </View>
              </View>
              <Text style={styles.fomoScreen}>📱 {trigger.screen}</Text>
            </View>
            <Switch
              value={trigger.active}
              onValueChange={() => toggleFomo(trigger.id)}
              trackColor={{ false: Colors.surfaceBorder, true: '#FF6B35' + '60' }}
              thumbColor={trigger.active ? '#FF6B35' : Colors.textTertiary}
            />
          </View>
          <View style={styles.fomoMessage}>
            <Text style={styles.fomoMessageText}>"{trigger.message}"</Text>
          </View>
          <View style={styles.fomoMetrics}>
            <View style={styles.fomoMetric}>
              <Eye size={11} color={Colors.textTertiary} />
              <Text style={styles.fomoMetricText}>{formatNumber(trigger.impressions)} shown</Text>
            </View>
            <View style={styles.fomoMetric}>
              <Target size={11} color={Colors.positive} />
              <Text style={[styles.fomoMetricText, { color: Colors.positive }]}>{formatNumber(trigger.conversions)} converted</Text>
            </View>
          </View>
        </View>
      ))}
    </View>
  );

  const renderContent = () => (
    <View style={styles.tabContent}>
      <View style={styles.contentHero}>
        <Sparkles size={20} color={Colors.primary} />
        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text style={styles.contentHeroTitle}>Influencer Content Kit</Text>
          <Text style={styles.contentHeroSub}>Ready-to-use captions, scripts & hashtags</Text>
        </View>
      </View>

      <View style={styles.contentLegend}>
        {[
          { type: 'caption', label: 'Caption' },
          { type: 'script', label: 'Script' },
          { type: 'hashtags', label: 'Hashtags' },
          { type: 'story', label: 'Story' },
        ].map(item => (
          <View key={item.type} style={styles.legendItem}>
            {getContentTypeIcon(item.type as ContentItem['type'])}
            <Text style={styles.legendText}>{item.label}</Text>
          </View>
        ))}
      </View>

      {CONTENT_ITEMS.map(item => (
        <View key={item.id} style={styles.contentCard}>
          <View style={styles.contentCardHeader}>
            <View style={[styles.contentTypeChip, { backgroundColor: getContentTypeColor(item.type) + '15' }]}>
              {getContentTypeIcon(item.type)}
              <Text style={[styles.contentTypeText, { color: getContentTypeColor(item.type) }]}>{item.type}</Text>
            </View>
            <View style={styles.platformChip}>
              <Text style={styles.platformChipText}>{item.platform}</Text>
            </View>
          </View>
          <Text style={styles.contentCardTitle}>{item.title}</Text>
          <Text style={styles.contentCardPreview} numberOfLines={3}>{item.content}</Text>
          <TouchableOpacity
            style={[styles.copyContentBtn, copiedId === item.id && styles.copyContentBtnDone]}
            onPress={() => copyContent(item.id, item.content)}
          >
            {copiedId === item.id ? (
              <CheckCircle size={14} color={Colors.positive} />
            ) : (
              <Copy size={14} color={Colors.textSecondary} />
            )}
            <Text style={[styles.copyContentBtnText, copiedId === item.id && { color: Colors.positive }]}>
              {copiedId === item.id ? 'Copied!' : 'Copy Content'}
            </Text>
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity
        style={styles.addContentBtn}
        onPress={() => Alert.alert('Add Content', 'Create new content templates for your influencers — captions, scripts, story sequences, or hashtag sets.')}
      >
        <Plus size={16} color={Colors.primary} />
        <Text style={styles.addContentBtnText}>Add Content Template</Text>
      </TouchableOpacity>
    </View>
  );

  const renderLoops = () => (
    <View style={styles.tabContent}>
      <View style={styles.loopsHero}>
        <RefreshCw size={20} color={Colors.accent} />
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Text style={styles.loopsHeroTitle}>Viral Loop Engine</Text>
          <Text style={styles.loopsHeroSub}>Automated triggers that turn investors into marketers</Text>
        </View>
      </View>

      <View style={styles.loopsStats}>
        <View style={styles.loopsStat}>
          <Text style={[styles.loopsStatVal, { color: Colors.accent }]}>
            {formatNumber(loops.filter(l => l.active).reduce((a, l) => a + l.activations, 0))}
          </Text>
          <Text style={styles.loopsStatLabel}>Activations</Text>
        </View>
        <View style={styles.loopsStatDivider} />
        <View style={styles.loopsStat}>
          <Text style={[styles.loopsStatVal, { color: Colors.positive }]}>
            {formatNumber(loops.filter(l => l.active).reduce((a, l) => a + l.conversions, 0))}
          </Text>
          <Text style={styles.loopsStatLabel}>New Users</Text>
        </View>
        <View style={styles.loopsStatDivider} />
        <View style={styles.loopsStat}>
          <Text style={[styles.loopsStatVal, { color: Colors.primary }]}>
            {loops.filter(l => l.active).length}
          </Text>
          <Text style={styles.loopsStatLabel}>Active Loops</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>How It Works</Text>
      <View style={styles.howItWorks}>
        {['User does something great', 'App detects the trigger', 'Share card / prompt appears', 'User posts on social', 'New user sees it → signs up', 'Loop repeats 🔁'].map((step, i) => (
          <View key={i} style={styles.howItWorksStep}>
            <View style={[styles.stepNum, i === 5 && { backgroundColor: Colors.primary }]}>
              <Text style={styles.stepNumText}>{i + 1}</Text>
            </View>
            <Text style={[styles.stepText, i === 5 && { color: Colors.primary, fontWeight: '700' as const }]}>{step}</Text>
            {i < 5 && <View style={styles.stepArrow}><ChevronRight size={14} color={Colors.textTertiary} /></View>}
          </View>
        ))}
      </View>

      <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Active Loops</Text>
      {loops.map(loop => (
        <View key={loop.id} style={[styles.loopCard, !loop.active && styles.cardOff]}>
          <View style={styles.loopCardHeader}>
            <View style={[styles.loopIcon, { backgroundColor: Colors.accent + '15' }]}>
              <RefreshCw size={16} color={Colors.accent} />
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[styles.loopName, !loop.active && styles.dimText]}>{loop.name}</Text>
              <View style={styles.loopMetrics}>
                <Zap size={10} color={Colors.textTertiary} />
                <Text style={styles.loopMetricText}>{formatNumber(loop.activations)} activations</Text>
                <Users size={10} color={Colors.positive} />
                <Text style={[styles.loopMetricText, { color: Colors.positive }]}>{formatNumber(loop.conversions)} new users</Text>
              </View>
            </View>
            <Switch
              value={loop.active}
              onValueChange={() => toggleLoop(loop.id)}
              trackColor={{ false: Colors.surfaceBorder, true: Colors.accent + '60' }}
              thumbColor={loop.active ? Colors.accent : Colors.textTertiary}
            />
          </View>

          <View style={styles.loopDetails}>
            <View style={styles.loopDetail}>
              <Text style={styles.loopDetailLabel}>🎯 Trigger</Text>
              <Text style={styles.loopDetailValue}>{loop.trigger}</Text>
            </View>
            <View style={styles.loopDetail}>
              <Text style={styles.loopDetailLabel}>⚡ Action</Text>
              <Text style={styles.loopDetailValue}>{loop.action}</Text>
            </View>
            <View style={styles.loopDetail}>
              <Text style={styles.loopDetailLabel}>🎁 Reward</Text>
              <Text style={[styles.loopDetailValue, { color: Colors.primary }]}>{loop.reward}</Text>
            </View>
          </View>
        </View>
      ))}

      <TouchableOpacity
        style={[styles.addContentBtn, { borderColor: Colors.accent + '40' }]}
        onPress={() => Alert.alert('New Viral Loop', 'Define a new viral loop: choose a trigger event (investment, dividend, referral), set the share action, and define the reward.')}
      >
        <Plus size={16} color={Colors.accent} />
        <Text style={[styles.addContentBtnText, { color: Colors.accent }]}>Add Viral Loop</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Zap size={18} color={Colors.primary} />
          <Text style={styles.headerTitle}>Viral Growth Hub</Text>
        </View>
        <View style={[styles.roiTag, { backgroundColor: Colors.positive + '20' }]}>
          <TrendingUp size={12} color={Colors.positive} />
          <Text style={[styles.roiTagText, { color: Colors.positive }]}>{totalROI.toFixed(0)}% ROI</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={styles.tabBarContent}>
        {TABS.map(tab => {
          const IconComp = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => {
                setActiveTab(tab.key);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            >
              <IconComp size={14} color={isActive ? Colors.black : Colors.textSecondary} />
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={styles.contentPadding}>
        {activeTab === 'viral' && renderViralCards()}
        {activeTab === 'campaigns' && renderCampaigns()}
        {activeTab === 'fomo' && renderFOMO()}
        {activeTab === 'content' && renderContent()}
        {activeTab === 'loops' && renderLoops()}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10},
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  roiTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8},
  roiTagText: { fontSize: 12, fontWeight: '700' as const },

  tabBar: { maxHeight: 52, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabBarContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface},
  tabActive: { backgroundColor: Colors.primary },
  tabText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  tabTextActive: { color: Colors.black },

  content: { flex: 1 },
  contentPadding: { padding: 16 },
  tabContent: { gap: 12 },

  heroRow: { flexDirection: 'row', gap: 8 },
  heroMetric: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1},
  heroMetricVal: { fontSize: 16, fontWeight: '800' as const, color: Colors.text },
  heroMetricLabel: { fontSize: 10, color: Colors.textSecondary, textAlign: 'center' },

  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  smallAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8},
  smallAddBtnText: { fontSize: 12, fontWeight: '700' as const, color: Colors.black },

  shareCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10},
  cardOff: { opacity: 0.5 },
  shareCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shareCardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10, marginRight: 8 },
  shareCardIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  shareCardTitle: { fontSize: 13, fontWeight: '600' as const, color: Colors.text, marginBottom: 3 },
  shareCardMetrics: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shareCardMetricText: { fontSize: 11, color: Colors.textTertiary },
  shareCardTemplate: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 8,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary},
  shareCardTemplateText: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17, fontStyle: 'italic' },
  shareCardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  convBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  convBadgeText: { fontSize: 11, fontWeight: '700' as const },
  previewBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  previewBtnText: { fontSize: 12, color: Colors.textSecondary },

  viralTip: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: Colors.primary + '10',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
    alignItems: 'flex-start'},
  viralTipText: { flex: 1, fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  dimText: { color: Colors.textTertiary },

  campaignCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10},
  campaignHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  platformIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  campaignName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  campaignInfluencer: { fontSize: 12, color: Colors.textSecondary },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8},
  liveIndicator: { width: 8, height: 8, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 10, fontWeight: '700' as const },
  campaignMetrics: { flexDirection: 'row', gap: 8 },
  campaignMetric: { flex: 1, alignItems: 'center' },
  campaignMetricVal: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  campaignMetricLabel: { fontSize: 10, color: Colors.textTertiary, marginTop: 1 },
  campaignBudgetRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  campaignBudgetBar: { flex: 1, height: 6, backgroundColor: Colors.surfaceBorder, borderRadius: 3, overflow: 'hidden' },
  campaignBudgetFill: { height: 6, borderRadius: 3 },
  campaignBudgetText: { fontSize: 11, color: Colors.textTertiary, width: 80, textAlign: 'right' },
  campaignCodeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  codeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.surfaceBorder, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  codeChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.text },
  campaignDate: { fontSize: 11, color: Colors.textTertiary },

  fomoHero: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF6B35' + '10',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FF6B35' + '30'},
  fomoHeroTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  fomoHeroSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  fomoHeroBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  fomoHeroBadgeText: { fontSize: 12, fontWeight: '700' as const },
  fomoStats: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border},
  fomoStat: { flex: 1, alignItems: 'center' },
  fomoStatVal: { fontSize: 18, fontWeight: '800' as const },
  fomoStatLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  fomoStatDivider: { width: 1, backgroundColor: Colors.border },
  fomoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10},
  fomoCardHeader: { flexDirection: 'row', alignItems: 'center' },
  fomoEmoji: { fontSize: 22 },
  fomoCardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  fomoCardTitle: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  fomoScreen: { fontSize: 11, color: Colors.textTertiary },
  fomoTypeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  fomoTypeBadgeText: { fontSize: 10, fontWeight: '600' as const },
  fomoMessage: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 8,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#FF6B35'},
  fomoMessageText: { fontSize: 13, color: Colors.text, fontStyle: 'italic' },
  fomoMetrics: { flexDirection: 'row', gap: 14 },
  fomoMetric: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fomoMetricText: { fontSize: 12, color: Colors.textTertiary },

  contentHero: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border},
  contentHeroTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  contentHeroSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  contentLegend: { flexDirection: 'row', gap: 14, paddingHorizontal: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendText: { fontSize: 11, color: Colors.textSecondary },
  contentCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8},
  contentCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contentTypeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  contentTypeText: { fontSize: 11, fontWeight: '600' as const },
  platformChip: { backgroundColor: Colors.surfaceBorder, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  platformChipText: { fontSize: 11, color: Colors.textTertiary },
  contentCardTitle: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  contentCardPreview: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  copyContentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceBorder,
    paddingVertical: 10,
    borderRadius: 10},
  copyContentBtnDone: { backgroundColor: Colors.positive + '20' },
  copyContentBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  addContentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    borderRadius: 12,
    paddingVertical: 14,
    borderStyle: 'dashed'},
  addContentBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.primary },

  loopsHero: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.accent + '10',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.accent + '30'},
  loopsHeroTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  loopsHeroSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  loopsStats: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border},
  loopsStat: { flex: 1, alignItems: 'center' },
  loopsStatVal: { fontSize: 18, fontWeight: '800' as const },
  loopsStatLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  loopsStatDivider: { width: 1, backgroundColor: Colors.border },
  howItWorks: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8},
  howItWorksStep: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center'},
  stepNumText: { fontSize: 11, fontWeight: '700' as const, color: Colors.textSecondary },
  stepText: { flex: 1, fontSize: 12, color: Colors.textSecondary },
  stepArrow: {},
  loopCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12},
  loopCardHeader: { flexDirection: 'row', alignItems: 'center' },
  loopIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  loopName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text, marginBottom: 3 },
  loopMetrics: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loopMetricText: { fontSize: 11, color: Colors.textTertiary },
  loopDetails: { gap: 6 },
  loopDetail: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  loopDetailLabel: { fontSize: 12, color: Colors.textTertiary, width: 72 },
  loopDetailValue: { flex: 1, fontSize: 12, color: Colors.textSecondary }});
