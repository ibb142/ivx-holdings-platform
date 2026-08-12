import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
  Animated,
  Modal,
  Platform,
  TextInput,
  Alert,
  KeyboardAvoidingView} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Bot,
  TrendingUp,
  TrendingDown,
  Users,
  Eye,
  Heart,
  MessageCircle,
  Calendar,
  CheckCircle,
  Play,
  Pause,
  RefreshCw,
  Zap,
  Target,
  BarChart3,
  PieChart,
  Activity,
  Globe,
  Sparkles,
  Brain,
  Instagram,
  Facebook,
  Linkedin,
  Music,
  ChevronRight,
  Download,
  FileText,
  Mail,
  X,
  Smile,
  Frown,
  Meh,
  Youtube,
  Search,
  ArrowLeft,
  MapPin,
  Clock,
  Award} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { generateText } from '@/lib/ai-service';
import * as Haptics from 'expo-haptics';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { IVXImage } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import {
  socialPlatforms,
  aiAgents,
  contentQueue,
  analyticsHistory,
  commentThreads,
  campaignMetrics,
  weeklyPerformance,
  audienceInsights,
  getActiveAgentsCount,
  getPendingComments,
  getTotalFollowers,
  getAverageEngagement,
  AIAgent,
  ContentPost} from '@/mocks/social-media';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_HEIGHT = 110;
const CARD_WIDTH = (SCREEN_WIDTH - 56) / 2;

type TabType = 'overview' | 'agents' | 'content' | 'analytics' | 'comments';

const GOLD = '#FFD700';
const GOLD_DIM = 'rgba(255,215,0,0.12)';
const GOLD_DIM2 = 'rgba(255,215,0,0.06)';
const GREEN = '#00C48C';
const RED = '#FF4D4D';
const BLUE = '#4A90D9';
const SURFACE = '#141414';
const SURFACE2 = '#1C1C1C';
const BORDER = '#2A2A2A';

export default function SocialCommandScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [selectedAgent, setSelectedAgent] = useState<AIAgent | null>(null);
  const [, setSelectedContent] = useState<ContentPost | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [agentFilter, setAgentFilter] = useState<'all' | 'active' | 'idle'>('all');
  const [showCreateContentModal, setShowCreateContentModal] = useState(false);
  const [contentTopic, setContentTopic] = useState('');
  const [selectedPlatformForContent, setSelectedPlatformForContent] = useState<string>('instagram');
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [generatedContent, setGeneratedContent] = useState('');
  const [generatingCommentId, setGeneratingCommentId] = useState<string | null>(null);
  const [localComments, setLocalComments] = useState(commentThreads);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const barAnims = useRef(analyticsHistory.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.4, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  useEffect(() => {
    if (activeTab === 'overview' || activeTab === 'analytics') {
      barAnims.forEach((anim, i) => {
        anim.setValue(0);
        Animated.timing(anim, {
          toValue: 1,
          duration: 600,
          delay: i * 60,
          useNativeDriver: false}).start();
      });
    }
  }, [activeTab, barAnims]);

  const handleTabChange = (tab: TabType) => {
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    setActiveTab(tab);
  };

  const handleOpenCreateContent = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowCreateContentModal(true);
    setGeneratedContent('');
    setContentTopic('');
  }, []);

  const handleGenerateContent = useCallback(async () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsGeneratingContent(true);
    setGeneratedContent('');
    try {
      const topicToUse = contentTopic.trim() || 'real estate investment opportunities with fractional ownership';
      const prompt = `Create a ${selectedPlatformForContent} post about "${topicToUse}" for IVX HOLDINGS, a real estate investment platform. Requirements: Engaging, platform-optimized, include emojis, add relevant hashtags, professional but approachable. Output ONLY the post content.`;
      const response = await generateText({ messages: [{ role: 'user', content: prompt }] });
      if (response && typeof response === 'string' && response.trim().length > 0) {
        setGeneratedContent(response.trim());
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else throw new Error('Empty response');
    } catch {
      const fallback = `🏠 Real Estate Investment\n\n💰 Invest in premium real estate starting at just $100 with IVX HOLDINGS!\n\n✅ Monthly dividends\n✅ Full transparency\n✅ Diversified portfolio\n\n#IPXHolding #RealEstateInvesting #PassiveIncome`;
      setGeneratedContent(fallback);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } finally {
      setIsGeneratingContent(false);
    }
  }, [contentTopic, selectedPlatformForContent]);

  const handleGenerateCommentResponse = useCallback(async (commentId: string, commentText: string, username: string) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setGeneratingCommentId(commentId);
    try {
      const prompt = `Generate a professional, friendly response to this social media comment from ${username}: "${commentText}". Context: IVX HOLDINGS real estate platform. Be helpful, concise (2-3 sentences). Output ONLY the response.`;
      const response = await generateText({ messages: [{ role: 'user', content: prompt }] });
      if (response && typeof response === 'string' && response.trim().length > 0) {
        setLocalComments(prev => prev.map(c => c.id === commentId ? { ...c, aiResponse: response.trim(), responded: true } : c));
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else throw new Error('Empty response');
    } catch {
      const fallback = `Thank you for reaching out, ${username}! We appreciate your interest in IVX HOLDINGS. Our team will get back to you shortly. 🏠`;
      setLocalComments(prev => prev.map(c => c.id === commentId ? { ...c, aiResponse: fallback, responded: true } : c));
    } finally {
      setGeneratingCommentId(null);
    }
  }, []);

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const getPlatformIcon = (platform: string, size = 16) => {
    switch (platform) {
      case 'instagram': return <Instagram size={size} color="#E4405F" />;
      case 'facebook': return <Facebook size={size} color="#1877F2" />;
      case 'linkedin': return <Linkedin size={size} color="#0A66C2" />;
      case 'tiktok': return <Music size={size} color="#fff" />;
      case 'whatsapp': return <MessageCircle size={size} color="#25D366" />;
      case 'google-ads': return <Search size={size} color="#4285F4" />;
      case 'youtube': return <Youtube size={size} color="#FF0000" />;
      default: return <Globe size={size} color={Colors.textSecondary} />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return GREEN;
      case 'working': return BLUE;
      case 'idle': return '#F59E0B';
      case 'paused': return RED;
      default: return Colors.textSecondary;
    }
  };

  const getSentimentIcon = (sentiment: string) => {
    switch (sentiment) {
      case 'positive': return <Smile size={16} color={GREEN} />;
      case 'negative': return <Frown size={16} color={RED} />;
      default: return <Meh size={16} color="#F59E0B" />;
    }
  };

  const maxImpressions = Math.max(...analyticsHistory.map(d => d.impressions));

  const renderOverviewTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.liveBar}>
        <Animated.View style={[styles.livePulse, { transform: [{ scale: pulseAnim }] }]} />
        <View style={styles.liveDot} />
        <Text style={styles.liveText}>LIVE</Text>
        <Text style={styles.liveSubtext}>{getActiveAgentsCount()} agents active</Text>
      </View>

      <View style={styles.heroRow}>
        <View style={[styles.heroCard, { backgroundColor: GOLD_DIM, borderColor: 'rgba(255,215,0,0.25)' }]}>
          <View style={styles.heroCardTop}>
            <View style={[styles.heroIcon, { backgroundColor: 'rgba(255,215,0,0.15)' }]}>
              <Users size={20} color={GOLD} />
            </View>
            <View style={[styles.trendChip, { backgroundColor: 'rgba(0,196,140,0.15)' }]}>
              <TrendingUp size={11} color={GREEN} />
              <Text style={[styles.trendChipText, { color: GREEN }]}>+2.3%</Text>
            </View>
          </View>
          <Text style={styles.heroValue}>{formatNumber(getTotalFollowers())}</Text>
          <Text style={styles.heroLabel}>Total Followers</Text>
        </View>
        <View style={[styles.heroCard, { backgroundColor: 'rgba(0,196,140,0.08)', borderColor: 'rgba(0,196,140,0.2)' }]}>
          <View style={styles.heroCardTop}>
            <View style={[styles.heroIcon, { backgroundColor: 'rgba(0,196,140,0.15)' }]}>
              <Heart size={20} color={GREEN} />
            </View>
            <View style={[styles.trendChip, { backgroundColor: 'rgba(0,196,140,0.15)' }]}>
              <TrendingUp size={11} color={GREEN} />
              <Text style={[styles.trendChipText, { color: GREEN }]}>+0.5%</Text>
            </View>
          </View>
          <Text style={styles.heroValue}>{getAverageEngagement().toFixed(1)}%</Text>
          <Text style={styles.heroLabel}>Avg Engagement</Text>
        </View>
      </View>

      <View style={styles.miniStatsRow}>
        {[
          { icon: <Eye size={15} color="#8B5CF6" />, value: formatNumber(weeklyPerformance.impressions.current), label: 'Impressions', bg: 'rgba(139,92,246,0.12)' },
          { icon: <Target size={15} color="#EC4899" />, value: formatNumber(weeklyPerformance.reach.current), label: 'Reach', bg: 'rgba(236,72,153,0.12)' },
          { icon: <MessageCircle size={15} color={GREEN} />, value: String(getPendingComments().length), label: 'Pending', bg: 'rgba(0,196,140,0.12)' },
          { icon: <Zap size={15} color={GOLD} />, value: String(contentQueue.filter(c => c.status === 'scheduled' || c.status === 'approved').length), label: 'Queued', bg: GOLD_DIM },
        ].map((item, i) => (
          <View key={i} style={[styles.miniCard, { backgroundColor: item.bg }]}>
            {item.icon}
            <Text style={styles.miniValue}>{item.value}</Text>
            <Text style={styles.miniLabel}>{item.label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Weekly Impressions</Text>
      <View style={styles.chartCard}>
        <View style={styles.chartBarsRow}>
          {analyticsHistory.map((day, index) => {
            const barH = barAnims[index].interpolate({
              inputRange: [0, 1],
              outputRange: [0, (day.impressions / maxImpressions) * CHART_HEIGHT]});
            const isLast = index === analyticsHistory.length - 1;
            return (
              <View key={day.date} style={styles.barWrapper}>
                <View style={styles.barTrack}>
                  <Animated.View
                    style={[
                      styles.barFill,
                      {
                        height: barH,
                        backgroundColor: isLast ? GOLD : 'rgba(255,215,0,0.3)',
                        borderRadius: 4},
                    ]}
                  />
                </View>
                <Text style={[styles.barLabel, isLast && { color: GOLD }]}>{day.date.slice(-2)}</Text>
              </View>
            );
          })}
        </View>
        <View style={styles.chartFooter}>
          <View style={styles.legendDot} />
          <Text style={styles.legendText}>Daily Impressions — This Week</Text>
          <Text style={[styles.legendValue, { color: GOLD }]}>+{weeklyPerformance.impressions.change}%</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Connected Platforms</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
        {socialPlatforms.filter(p => p.connected).map((platform) => (
          <View key={platform.id} style={styles.platformChip}>
            <View style={[styles.platformChipIcon, { backgroundColor: platform.color + '22' }]}>
              {getPlatformIcon(platform.id, 18)}
            </View>
            <Text style={styles.platformChipName}>{platform.name}</Text>
            <Text style={styles.platformChipFollowers}>{formatNumber(platform.followers)}</Text>
            <View style={[styles.engBadge, { backgroundColor: 'rgba(0,196,140,0.12)' }]}>
              <Text style={[styles.engBadgeText, { color: GREEN }]}>{platform.engagement}%</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Top Performing Posts</Text>
      {contentQueue.filter(c => c.status === 'published').slice(0, 2).map((post) => (
        <View key={post.id} style={styles.postCard}>
          {post.mediaUrl && <Image source={{ uri: post.mediaUrl }} style={styles.postImage} />}
          <View style={styles.postBody}>
            <Text style={styles.postText} numberOfLines={2}>{post.content}</Text>
            <View style={styles.postScores}>
              <View style={styles.postScore}>
                <Brain size={12} color="#8B5CF6" />
                <Text style={styles.postScoreVal}>{post.aiScore}%</Text>
              </View>
              <View style={styles.postScore}>
                <Zap size={12} color={GOLD} />
                <Text style={styles.postScoreVal}>{post.viralPotential}%</Text>
              </View>
              <View style={styles.postScore}>
                <Heart size={12} color={RED} />
                <Text style={styles.postScoreVal}>{post.engagementPrediction}%</Text>
              </View>
            </View>
          </View>
          <View style={styles.viralBadge}>
            <Sparkles size={11} color={GOLD} />
            <Text style={styles.viralBadgeText}>{post.viralPotential}%</Text>
          </View>
        </View>
      ))}
    </View>
  );

  const renderAgentsTab = () => {
    const filteredAgents = agentFilter === 'all'
      ? aiAgents
      : aiAgents.filter(a => agentFilter === 'active' ? (a.status === 'active' || a.status === 'working') : a.status === 'idle');

    return (
      <View style={styles.tabContent}>
        <View style={styles.agentSummaryRow}>
          {[
            { label: 'Working', value: aiAgents.filter(a => a.status === 'working').length, color: BLUE },
            { label: 'Active', value: aiAgents.filter(a => a.status === 'active').length, color: GREEN },
            { label: 'Idle', value: aiAgents.filter(a => a.status === 'idle').length, color: '#F59E0B' },
          ].map((s) => (
            <View key={s.label} style={[styles.summaryPill, { borderColor: s.color + '44' }]}>
              <Text style={[styles.summaryPillValue, { color: s.color }]}>{s.value}</Text>
              <Text style={styles.summaryPillLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.filterRow}>
          {(['all', 'active', 'idle'] as const).map((filter) => (
            <TouchableOpacity
              key={filter}
              style={[styles.filterBtn, agentFilter === filter && styles.filterBtnActive]}
              onPress={() => setAgentFilter(filter)}
            >
              <Text style={[styles.filterBtnText, agentFilter === filter && styles.filterBtnTextActive]}>
                {filter.charAt(0).toUpperCase() + filter.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {filteredAgents.map((agent) => (
          <TouchableOpacity key={agent.id} style={styles.agentCard} onPress={() => setSelectedAgent(agent)}>
            <Image source={{ uri: agent.avatar }} style={styles.agentAvatar} />
            <View style={styles.agentInfo}>
              <View style={styles.agentNameRow}>
                <Text style={styles.agentName}>{agent.name}</Text>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(agent.status) + '22' }]}>
                  <View style={[styles.statusDot, { backgroundColor: getStatusColor(agent.status) }]} />
                  <Text style={[styles.statusBadgeText, { color: getStatusColor(agent.status) }]}>{agent.status}</Text>
                </View>
              </View>
              <Text style={styles.agentRole}>{agent.role}</Text>
              <View style={styles.agentPlatformRow}>
                {agent.platform.slice(0, 4).map((p) => (
                  <View key={p} style={styles.platformDot}>
                    {getPlatformIcon(p, 12)}
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.agentRight}>
              <Text style={styles.agentTaskNum}>{formatNumber(agent.tasksCompleted)}</Text>
              <Text style={styles.agentTaskLabel}>tasks</Text>
              <View style={styles.accBarBg}>
                <View style={[styles.accBarFill, { width: `${agent.accuracy}%` as any }]} />
              </View>
              <Text style={styles.accText}>{agent.accuracy}%</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const renderContentTab = () => (
    <View style={styles.tabContent}>
      <TouchableOpacity style={styles.createBtn} onPress={handleOpenCreateContent}>
        <Sparkles size={18} color="#000" />
        <Text style={styles.createBtnText}>Create with AI</Text>
      </TouchableOpacity>

      <View style={styles.statusCapsuleRow}>
        {['draft', 'reviewing', 'approved', 'scheduled', 'published'].map((status) => {
          const count = contentQueue.filter(c => c.status === status).length;
          const colors: Record<string, string> = {
            draft: '#6B7280', reviewing: '#F59E0B', approved: GREEN, scheduled: BLUE, published: GOLD};
          return (
            <View key={status} style={[styles.statusCapsule, { borderColor: (colors[status] ?? '#6B7280') + '55' }]}>
              <Text style={[styles.statusCapsuleCount, { color: colors[status] ?? '#6B7280' }]}>{count}</Text>
              <Text style={styles.statusCapsuleLabel}>{status}</Text>
            </View>
          );
        })}
      </View>

      {contentQueue.map((post) => {
        const statusColors: Record<string, string> = {
          approved: GREEN, reviewing: '#F59E0B', published: BLUE, rejected: RED, draft: '#6B7280', scheduled: GOLD};
        const sc = statusColors[post.status] ?? '#6B7280';
        return (
          <TouchableOpacity key={post.id} style={styles.contentCard} onPress={() => setSelectedContent(post)}>
            <View style={styles.contentCardTop}>
              <View style={styles.contentPlatformIcons}>
                {post.platform.slice(0, 3).map((p) => (
                  <View key={p} style={styles.contentPlatformIcon}>{getPlatformIcon(p, 13)}</View>
                ))}
              </View>
              <View style={[styles.contentStatusPill, { backgroundColor: sc + '22' }]}>
                <View style={[styles.statusDot, { backgroundColor: sc }]} />
                <Text style={[styles.contentStatusText, { color: sc }]}>{post.status}</Text>
              </View>
            </View>
            {post.mediaUrl && <Image source={{ uri: post.mediaUrl }} style={styles.contentMedia} />}
            <Text style={styles.contentText} numberOfLines={2}>{post.content}</Text>
            <View style={styles.scoreRow}>
              {[
                { icon: <Brain size={13} color="#8B5CF6" />, label: 'AI', val: post.aiScore },
                { icon: <Zap size={13} color={GOLD} />, label: 'Viral', val: post.viralPotential },
                { icon: <Heart size={13} color={RED} />, label: 'Eng.', val: post.engagementPrediction },
              ].map((s, i) => (
                <View key={i} style={styles.scoreItem}>
                  {s.icon}
                  <Text style={styles.scoreLabel}>{s.label}</Text>
                  <Text style={styles.scoreVal}>{s.val}%</Text>
                </View>
              ))}
            </View>
            {post.scheduledAt && (
              <View style={styles.scheduledRow}>
                <Calendar size={12} color={Colors.textTertiary} />
                <Text style={styles.scheduledText}>{new Date(post.scheduledAt).toLocaleString()}</Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderAnalyticsTab = () => {
    const maxPeak = Math.max(...audienceInsights.peakHours.map(h => h.activity));
    const maxAge = Math.max(...audienceInsights.ageGroups.map(g => g.percentage));

    return (
      <View style={styles.tabContent}>
        <View style={styles.analyticsTopRow}>
          <View>
            <Text style={styles.analyticsTitle}>Performance</Text>
            <Text style={styles.analyticsSubtitle}>Last 30 days</Text>
          </View>
          <TouchableOpacity style={styles.exportBtn} onPress={() => setShowExportModal(true)}>
            <Download size={15} color={GOLD} />
            <Text style={styles.exportBtnText}>Export</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.metricsGrid}>
          {campaignMetrics.map((metric) => {
            const isUp = metric.trend === 'up';
            const isDown = metric.trend === 'down';
            const trendColor = isUp ? GREEN : isDown ? RED : '#F59E0B';
            return (
              <View key={metric.name} style={styles.metricCard}>
                <Text style={styles.metricName}>{metric.name}</Text>
                <Text style={styles.metricValue}>
                  {metric.name.includes('Rate') ? metric.value.toFixed(1) + '%' :
                   metric.name.includes('Cost') ? '$' + metric.value.toFixed(2) :
                   formatNumber(metric.value)}
                </Text>
                <View style={styles.metricTrendRow}>
                  {isUp ? <TrendingUp size={13} color={trendColor} /> : isDown ? <TrendingDown size={13} color={trendColor} /> : <Activity size={13} color={trendColor} />}
                  <Text style={[styles.metricChange, { color: trendColor }]}>
                    {metric.change > 0 ? '+' : ''}{metric.change.toFixed(1)}%
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.insightBlock}>
          <View style={styles.insightBlockHeader}>
            <MapPin size={16} color={GOLD} />
            <Text style={styles.insightBlockTitle}>Top Countries</Text>
          </View>
          {audienceInsights.topCountries.map((c, i) => {
            const barW = (c.percentage / 35) * (SCREEN_WIDTH - 120);
            const rankColors = ['#FFD700', '#C0C0C0', '#CD7F32', '#9CA3AF', '#9CA3AF'];
            return (
              <View key={c.country} style={styles.countryRow}>
                <View style={[styles.rankBadge, { backgroundColor: (rankColors[i] ?? '#9CA3AF') + '22' }]}>
                  <Text style={[styles.rankText, { color: rankColors[i] ?? '#9CA3AF' }]}>#{i + 1}</Text>
                </View>
                <View style={styles.countryInfo}>
                  <View style={styles.countryNameRow}>
                    <Text style={styles.countryName}>{c.country}</Text>
                    <Text style={[styles.countryPct, { color: i === 0 ? GOLD : Colors.textSecondary }]}>{c.percentage}%</Text>
                  </View>
                  <View style={styles.countryBarBg}>
                    <View style={[styles.countryBarFill, {
                      width: barW,
                      backgroundColor: i === 0 ? GOLD : i === 1 ? '#C0C0C0' : 'rgba(255,255,255,0.2)'}]} />
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.insightBlock}>
          <View style={styles.insightBlockHeader}>
            <Clock size={16} color={GOLD} />
            <Text style={styles.insightBlockTitle}>Peak Activity Hours</Text>
          </View>
          <View style={styles.peakChartRow}>
            {audienceInsights.peakHours.map((h, i) => {
              const barH = (h.activity / maxPeak) * 90;
              const isPeak = h.activity === maxPeak;
              return (
                <View key={h.hour} style={styles.peakBarWrapper}>
                  <Text style={[styles.peakPct, { color: isPeak ? GOLD : Colors.textTertiary }]}>{h.activity}%</Text>
                  <View style={styles.peakTrack}>
                    <View style={[styles.peakBarFill, {
                      height: barH,
                      backgroundColor: isPeak ? GOLD : 'rgba(255,215,0,0.25)',
                      borderRadius: 4}]} />
                  </View>
                  <Text style={[styles.peakHourLabel, { color: isPeak ? GOLD : Colors.textTertiary }]}>{h.hour.replace(' ', '\n')}</Text>
                </View>
              );
            })}
          </View>
          <View style={styles.peakNote}>
            <Zap size={12} color={GOLD} />
            <Text style={styles.peakNoteText}>Best time to post: 6 PM for maximum reach</Text>
          </View>
        </View>

        <View style={styles.insightBlock}>
          <View style={styles.insightBlockHeader}>
            <Users size={16} color={GOLD} />
            <Text style={styles.insightBlockTitle}>Age Distribution</Text>
          </View>
          <View style={styles.ageChartRow}>
            {audienceInsights.ageGroups.map((g, i) => {
              const barH = (g.percentage / maxAge) * 80;
              return (
                <View key={g.range} style={styles.ageBarWrapper}>
                  <Text style={styles.agePct}>{g.percentage}%</Text>
                  <View style={styles.ageTrack}>
                    <View style={[styles.ageBarFill, {
                      height: barH,
                      backgroundColor: i === 1 ? GOLD : 'rgba(255,215,0,0.3)',
                      borderRadius: 4}]} />
                  </View>
                  <Text style={styles.ageRangeLabel}>{g.range}</Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.ageDominant}>Core audience: <Text style={{ color: GOLD }}>25–34 years</Text></Text>
        </View>
      </View>
    );
  };

  const renderCommentsTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.commentSummaryRow}>
        {[
          { label: 'Total', value: localComments.length, color: Colors.text },
          { label: 'Pending', value: localComments.filter(c => !c.responded).length, color: '#F59E0B' },
          { label: 'Replied', value: localComments.filter(c => c.responded).length, color: GREEN },
        ].map((s) => (
          <View key={s.label} style={styles.commentStat}>
            <Text style={[styles.commentStatVal, { color: s.color }]}>{s.value}</Text>
            <Text style={styles.commentStatLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {localComments.map((comment) => (
        <View key={comment.id} style={styles.commentCard}>
          <View style={styles.commentHeader}>
            <Image source={{ uri: comment.avatar }} style={styles.commentAvatar} />
            <View style={{ flex: 1 }}>
              <Text style={styles.commentUsername}>{comment.username}</Text>
              <View style={styles.commentMeta}>
                {getPlatformIcon(comment.platform, 12)}
                <Text style={styles.commentTime}>{new Date(comment.createdAt).toLocaleDateString()}</Text>
              </View>
            </View>
            <View style={styles.sentimentBadge}>{getSentimentIcon(comment.sentiment)}</View>
          </View>
          <Text style={styles.commentText}>{comment.comment}</Text>
          {comment.aiResponse ? (
            <View style={styles.aiRespBox}>
              <View style={styles.aiRespHeader}>
                <Bot size={13} color={BLUE} />
                <Text style={styles.aiRespLabel}>AI Response</Text>
                <CheckCircle size={13} color={GREEN} />
              </View>
              <Text style={styles.aiRespText}>{comment.aiResponse}</Text>
            </View>
          ) : (
            <View style={styles.pendingBox}>
              <TouchableOpacity
                style={styles.generateRespBtn}
                onPress={() => handleGenerateCommentResponse(comment.id, comment.comment, comment.username)}
                disabled={generatingCommentId === comment.id}
              >
                {generatingCommentId === comment.id
                  ? <ShimmerIndicator size="small" color="#000" />
                  : <Sparkles size={14} color="#000" />}
                <Text style={styles.generateRespText}>
                  {generatingCommentId === comment.id ? 'Generating...' : 'Generate AI Response'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.manualRespBtn}>
                <Text style={styles.manualRespText}>Reply Manually</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ))}
    </View>
  );

  const renderExportModal = () => (
    <Modal visible={showExportModal} transparent animationType="fade" onRequestClose={() => setShowExportModal(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalTitleRow}>
            <Text style={styles.modalTitle}>Export Report</Text>
            <TouchableOpacity onPress={() => setShowExportModal(false)} style={styles.modalCloseBtn}>
              <X size={20} color={Colors.text} />
            </TouchableOpacity>
          </View>
          {[
            { icon: <FileText size={22} color="#FF4D4D" />, bg: 'rgba(239,68,68,0.12)', title: 'PDF Report', desc: 'Full analytics with charts' },
            { icon: <BarChart3 size={22} color={GREEN} />, bg: 'rgba(0,196,140,0.12)', title: 'Excel Spreadsheet', desc: 'Raw data for deep analysis' },
            { icon: <MessageCircle size={22} color="#25D366" />, bg: 'rgba(37,211,102,0.12)', title: 'Share via WhatsApp', desc: 'Quick summary share' },
            { icon: <Mail size={22} color={BLUE} />, bg: 'rgba(59,130,246,0.12)', title: 'Send via Email', desc: 'Detailed report to inbox' },
          ].map((opt, i) => (
            <TouchableOpacity key={i} style={styles.exportOption}>
              <View style={[styles.exportIconBox, { backgroundColor: opt.bg }]}>{opt.icon}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.exportOptTitle}>{opt.title}</Text>
                <Text style={styles.exportOptDesc}>{opt.desc}</Text>
              </View>
              <ChevronRight size={18} color={Colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </Modal>
  );

  const renderCreateContentModal = () => (
    <Modal visible={showCreateContentModal} transparent animationType="slide" onRequestClose={() => setShowCreateContentModal(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
        <View style={styles.createModalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalTitleRow}>
            <Text style={styles.modalTitle}>Create with AI</Text>
            <TouchableOpacity onPress={() => setShowCreateContentModal(false)} style={styles.modalCloseBtn}>
              <X size={20} color={Colors.text} />
            </TouchableOpacity>
          </View>
          <Text style={styles.createLabel}>Platform</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 4 }}>
            {['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube'].map((platform) => (
              <TouchableOpacity
                key={platform}
                style={[styles.platformOpt, selectedPlatformForContent === platform && styles.platformOptActive]}
                onPress={() => setSelectedPlatformForContent(platform)}
              >
                {getPlatformIcon(platform, 16)}
                <Text style={[styles.platformOptText, selectedPlatformForContent === platform && { color: GOLD }]}>
                  {platform.charAt(0).toUpperCase() + platform.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={[styles.createLabel, { marginTop: 16 }]}>Topic (Optional)</Text>
          <TextInput
            style={styles.topicInput}
            placeholder="e.g., New property launch, Investment tips..."
            placeholderTextColor={Colors.textTertiary}
            value={contentTopic}
            onChangeText={setContentTopic}
            multiline
          />
          <TouchableOpacity
            style={[styles.generateBtn, isGeneratingContent && { opacity: 0.5 }]}
            onPress={handleGenerateContent}
            disabled={isGeneratingContent}
          >
            {isGeneratingContent ? <ShimmerIndicator size="small" color="#000" /> : <Sparkles size={18} color="#000" />}
            <Text style={styles.generateBtnText}>{isGeneratingContent ? 'Generating...' : 'Generate Content'}</Text>
          </TouchableOpacity>
          {generatedContent ? (
            <View style={styles.generatedBox}>
              <View style={styles.generatedHeader}>
                <Brain size={15} color={GOLD} />
                <Text style={styles.generatedTitle}>Generated Content</Text>
              </View>
              <ScrollView style={{ maxHeight: 140 }}>
                <Text style={styles.generatedText}>{generatedContent}</Text>
              </ScrollView>
              <View style={styles.generatedActions}>
                <TouchableOpacity
                  style={styles.copyBtn}
                  onPress={async () => {
                    try { const { safeSetString } = await import('@/lib/safe-clipboard'); await safeSetString(generatedContent); } catch {}
                    Alert.alert('Copied!', 'Content copied to clipboard');
                    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  }}
                >
                  <Text style={styles.copyBtnText}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.queueBtn}
                  onPress={() => { setShowCreateContentModal(false); Alert.alert('Success', 'Content added to queue!'); }}
                >
                  <Text style={styles.queueBtnText}>Add to Queue</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  const renderAgentModal = () => (
    <Modal visible={!!selectedAgent} transparent animationType="slide" onRequestClose={() => setSelectedAgent(null)}>
      <View style={styles.modalOverlay}>
        <View style={styles.agentModalSheet}>
          <View style={styles.modalHandle} />
          {selectedAgent && (
            <>
              <TouchableOpacity style={styles.agentModalClose} onPress={() => setSelectedAgent(null)}>
                <X size={20} color={Colors.text} />
              </TouchableOpacity>
              <Image source={{ uri: selectedAgent.avatar }} style={styles.agentModalAvatar} />
              <Text style={styles.agentModalName}>{selectedAgent.name}</Text>
              <Text style={styles.agentModalRole}>{selectedAgent.role}</Text>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(selectedAgent.status) + '22', alignSelf: 'center', marginVertical: 8 }]}>
                <View style={[styles.statusDot, { backgroundColor: getStatusColor(selectedAgent.status) }]} />
                <Text style={[styles.statusBadgeText, { color: getStatusColor(selectedAgent.status) }]}>{selectedAgent.status.toUpperCase()}</Text>
              </View>
              <Text style={styles.agentModalDesc}>{selectedAgent.description}</Text>
              <View style={styles.agentModalStats}>
                <View style={styles.agentModalStat}>
                  <Award size={16} color={GOLD} />
                  <Text style={styles.agentModalStatVal}>{selectedAgent.tasksCompleted}</Text>
                  <Text style={styles.agentModalStatLabel}>Tasks</Text>
                </View>
                <View style={[styles.agentModalStat, { borderLeftWidth: 1, borderLeftColor: BORDER }]}>
                  <Target size={16} color={GREEN} />
                  <Text style={styles.agentModalStatVal}>{selectedAgent.accuracy}%</Text>
                  <Text style={styles.agentModalStatLabel}>Accuracy</Text>
                </View>
              </View>
              <Text style={styles.agentModalPlatformTitle}>Platforms</Text>
              <View style={styles.agentModalPlatforms}>
                {selectedAgent.platform.map((p) => (
                  <View key={p} style={styles.agentModalPlatformChip}>
                    {getPlatformIcon(p, 14)}
                    <Text style={styles.agentModalPlatformText}>{p}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.agentModalActions}>
                {selectedAgent.status === 'idle' || selectedAgent.status === 'paused' ? (
                  <TouchableOpacity style={styles.agentActionBtn}>
                    <Play size={16} color="#000" />
                    <Text style={styles.agentActionBtnText}>Activate</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[styles.agentActionBtn, { backgroundColor: '#F59E0B' }]}>
                    <Pause size={16} color="#000" />
                    <Text style={styles.agentActionBtnText}>Pause</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.agentSecBtn}>
                  <RefreshCw size={16} color={GOLD} />
                  <Text style={styles.agentSecBtnText}>Retrain</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );

  const tabs = [
    { id: 'overview' as TabType, label: 'Overview', icon: BarChart3 },
    { id: 'agents' as TabType, label: 'Agents', icon: Bot },
    { id: 'content' as TabType, label: 'Content', icon: Sparkles },
    { id: 'analytics' as TabType, label: 'Analytics', icon: PieChart },
    { id: 'comments' as TabType, label: 'Comments', icon: MessageCircle },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={20} color={Colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.headerTitle}>AI Social Command</Text>
            <Text style={styles.headerSub}>Your 24/7 Marketing Team</Text>
          </View>
          <View style={[styles.botBadge]}>
            <Bot size={18} color={GOLD} />
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.tabChip, active && styles.tabChipActive]}
                onPress={() => handleTabChange(tab.id)}
              >
                <tab.icon size={15} color={active ? '#000' : Colors.textSecondary} />
                <Text style={[styles.tabChipText, active && styles.tabChipTextActive]}>{tab.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {activeTab === 'overview' && renderOverviewTab()}
        {activeTab === 'agents' && renderAgentsTab()}
        {activeTab === 'content' && renderContentTab()}
        {activeTab === 'analytics' && renderAnalyticsTab()}
        {activeTab === 'comments' && renderCommentsTab()}
      </ScrollView>

      {renderExportModal()}
      {renderAgentModal()}
      {renderCreateContentModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 0,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: '#0A0A0A'},
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center'},
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' as const, letterSpacing: -0.3 },
  headerSub: { color: Colors.textTertiary, fontSize: 12, marginTop: 1 },
  botBadge: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: GOLD_DIM, borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)',
    alignItems: 'center', justifyContent: 'center'},
  tabsRow: { flexDirection: 'row', gap: 8, paddingBottom: 12 },
  tabChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 7, paddingHorizontal: 14,
    borderRadius: 20, backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BORDER},
  tabChipActive: { backgroundColor: GOLD, borderColor: GOLD },
  tabChipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
  tabChipTextActive: { color: '#000', fontWeight: '700' as const },
  scrollContent: { flex: 1, paddingHorizontal: 16 },
  tabContent: { paddingTop: 16 },

  liveBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    alignSelf: 'flex-start', marginBottom: 16,
    backgroundColor: 'rgba(0,196,140,0.08)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(0,196,140,0.2)'},
  livePulse: {
    position: 'absolute', left: 10,
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: 'rgba(0,196,140,0.3)'},
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: GREEN },
  liveText: { color: GREEN, fontSize: 11, fontWeight: '800' as const, letterSpacing: 1 },
  liveSubtext: { color: Colors.textSecondary, fontSize: 12 },

  heroRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  heroCard: {
    flex: 1, borderRadius: 18, padding: 16,
    borderWidth: 1},
  heroCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  heroIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  trendChip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  trendChipText: { fontSize: 11, fontWeight: '700' as const },
  heroValue: { color: '#fff', fontSize: 26, fontWeight: '800' as const, letterSpacing: -0.5 },
  heroLabel: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },

  miniStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  miniCard: {
    flex: 1, borderRadius: 14, padding: 12,
    alignItems: 'center', gap: 4},
  miniValue: { color: '#fff', fontSize: 15, fontWeight: '800' as const, marginTop: 4 },
  miniLabel: { color: Colors.textTertiary, fontSize: 10 },

  sectionTitle: { color: '#fff', fontSize: 15, fontWeight: '700' as const, marginBottom: 12 },

  chartCard: {
    backgroundColor: SURFACE, borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: BORDER, marginBottom: 20},
  chartBarsRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    height: CHART_HEIGHT, gap: 6},
  barWrapper: { flex: 1, alignItems: 'center', height: CHART_HEIGHT },
  barTrack: {
    flex: 1, width: '100%', justifyContent: 'flex-end',
    alignItems: 'center'},
  barFill: { width: '100%' },
  barLabel: { color: Colors.textTertiary, fontSize: 11, marginTop: 6 },
  chartFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: BORDER},
  legendDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GOLD },
  legendText: { color: Colors.textSecondary, fontSize: 12, flex: 1 },
  legendValue: { fontSize: 13, fontWeight: '700' as const },

  platformChip: {
    backgroundColor: SURFACE2, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: BORDER, alignItems: 'center', gap: 6, minWidth: 100},
  platformChipIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  platformChipName: { color: '#fff', fontSize: 12, fontWeight: '600' as const },
  platformChipFollowers: { color: Colors.textSecondary, fontSize: 11 },
  engBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  engBadgeText: { fontSize: 11, fontWeight: '700' as const },

  postCard: {
    backgroundColor: SURFACE, borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: BORDER, marginBottom: 12},
  postImage: { width: '100%', height: 150 },
  postBody: { padding: 12 },
  postText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 10 },
  postScores: { flexDirection: 'row', gap: 16 },
  postScore: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  postScoreVal: { color: '#fff', fontSize: 12, fontWeight: '700' as const },
  viralBadge: {
    position: 'absolute', top: 10, right: 10,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.4)'},
  viralBadgeText: { color: GOLD, fontSize: 11, fontWeight: '700' as const },

  agentSummaryRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  summaryPill: {
    flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center',
    backgroundColor: SURFACE2, borderWidth: 1},
  summaryPillValue: { fontSize: 22, fontWeight: '800' as const },
  summaryPillLabel: { color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  filterBtn: {
    paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
    backgroundColor: SURFACE2, borderWidth: 1, borderColor: BORDER},
  filterBtnActive: { backgroundColor: GOLD, borderColor: GOLD },
  filterBtnText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
  filterBtnTextActive: { color: '#000', fontWeight: '700' as const },
  agentCard: {
    backgroundColor: SURFACE, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: BORDER, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', gap: 12},
  agentAvatar: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: BORDER },
  agentInfo: { flex: 1 },
  agentNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  agentName: { color: '#fff', fontSize: 14, fontWeight: '700' as const },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3},
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusBadgeText: { fontSize: 11, fontWeight: '600' as const },
  agentRole: { color: Colors.textTertiary, fontSize: 11, marginBottom: 6 },
  agentPlatformRow: { flexDirection: 'row', gap: 4 },
  platformDot: {
    width: 20, height: 20, borderRadius: 6,
    backgroundColor: SURFACE2, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center'},
  agentRight: { alignItems: 'center', gap: 2 },
  agentTaskNum: { color: '#fff', fontSize: 16, fontWeight: '800' as const },
  agentTaskLabel: { color: Colors.textTertiary, fontSize: 10, marginBottom: 4 },
  accBarBg: { width: 60, height: 4, backgroundColor: BORDER, borderRadius: 2, overflow: 'hidden' },
  accBarFill: { height: 4, backgroundColor: GOLD, borderRadius: 2 },
  accText: { color: Colors.textSecondary, fontSize: 10, marginTop: 2 },

  createBtn: {
    backgroundColor: GOLD, borderRadius: 16, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginBottom: 16},
  createBtnText: { color: '#000', fontSize: 15, fontWeight: '700' as const },
  statusCapsuleRow: { flexDirection: 'row', gap: 6, marginBottom: 16, flexWrap: 'wrap' as const },
  statusCapsule: {
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: SURFACE2, borderWidth: 1, alignItems: 'center'},
  statusCapsuleCount: { fontSize: 16, fontWeight: '800' as const },
  statusCapsuleLabel: { color: Colors.textTertiary, fontSize: 10 },
  contentCard: {
    backgroundColor: SURFACE, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: BORDER, marginBottom: 12},
  contentCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  contentPlatformIcons: { flexDirection: 'row', gap: 6 },
  contentPlatformIcon: {
    width: 26, height: 26, borderRadius: 8, backgroundColor: SURFACE2,
    borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center'},
  contentStatusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3},
  contentStatusText: { fontSize: 11, fontWeight: '600' as const },
  contentMedia: { width: '100%', height: 140, borderRadius: 12, marginBottom: 10 },
  contentText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 10 },
  scoreRow: { flexDirection: 'row', gap: 12, marginBottom: 6 },
  scoreItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  scoreLabel: { color: Colors.textTertiary, fontSize: 11 },
  scoreVal: { color: '#fff', fontSize: 12, fontWeight: '700' as const },
  scheduledRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  scheduledText: { color: Colors.textTertiary, fontSize: 11 },

  analyticsTopRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16},
  analyticsTitle: { color: '#fff', fontSize: 20, fontWeight: '800' as const },
  analyticsSubtitle: { color: Colors.textTertiary, fontSize: 12, marginTop: 2 },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: GOLD_DIM, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)'},
  exportBtnText: { color: GOLD, fontSize: 13, fontWeight: '700' as const },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 10, marginBottom: 20 },
  metricCard: {
    width: CARD_WIDTH, backgroundColor: SURFACE,
    borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: BORDER},
  metricName: { color: Colors.textTertiary, fontSize: 11, marginBottom: 6 },
  metricValue: { color: '#fff', fontSize: 20, fontWeight: '800' as const, letterSpacing: -0.3, marginBottom: 6 },
  metricTrendRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metricChange: { fontSize: 12, fontWeight: '700' as const },

  insightBlock: {
    backgroundColor: SURFACE, borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: BORDER, marginBottom: 14},
  insightBlockHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  insightBlockTitle: { color: '#fff', fontSize: 15, fontWeight: '700' as const },

  countryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  rankBadge: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: 12, fontWeight: '800' as const },
  countryInfo: { flex: 1 },
  countryNameRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  countryName: { color: '#fff', fontSize: 14, fontWeight: '600' as const },
  countryPct: { fontSize: 13, fontWeight: '700' as const },
  countryBarBg: { height: 5, backgroundColor: BORDER, borderRadius: 3, overflow: 'hidden' },
  countryBarFill: { height: 5, borderRadius: 3 },

  peakChartRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    height: 130, gap: 10, marginBottom: 12},
  peakBarWrapper: { flex: 1, alignItems: 'center', gap: 4 },
  peakPct: { fontSize: 10, fontWeight: '700' as const, marginBottom: 4 },
  peakTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  peakBarFill: { width: '80%' },
  peakHourLabel: { fontSize: 10, textAlign: 'center' as const, lineHeight: 14, marginTop: 4 },
  peakNote: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: GOLD_DIM2, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.12)'},
  peakNoteText: { color: Colors.textSecondary, fontSize: 12 },

  ageChartRow: { flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 8, marginBottom: 10 },
  ageBarWrapper: { flex: 1, alignItems: 'center' },
  agePct: { color: Colors.textTertiary, fontSize: 10, marginBottom: 4 },
  ageTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  ageBarFill: { width: '80%' },
  ageRangeLabel: { color: Colors.textTertiary, fontSize: 10, marginTop: 4, textAlign: 'center' as const },
  ageDominant: { color: Colors.textSecondary, fontSize: 12 },

  commentSummaryRow: {
    flexDirection: 'row', gap: 12, marginBottom: 16,
    backgroundColor: SURFACE, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: BORDER},
  commentStat: { flex: 1, alignItems: 'center' },
  commentStatVal: { fontSize: 22, fontWeight: '800' as const },
  commentStatLabel: { color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  commentCard: {
    backgroundColor: SURFACE, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: BORDER, marginBottom: 12},
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  commentAvatar: { width: 38, height: 38, borderRadius: 19 },
  commentUsername: { color: '#fff', fontSize: 14, fontWeight: '700' as const },
  commentMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  commentTime: { color: Colors.textTertiary, fontSize: 11 },
  sentimentBadge: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: SURFACE2, alignItems: 'center', justifyContent: 'center'},
  commentText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 12 },
  aiRespBox: {
    backgroundColor: 'rgba(59,130,246,0.08)', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: 'rgba(59,130,246,0.2)'},
  aiRespHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  aiRespLabel: { color: BLUE, fontSize: 12, fontWeight: '600' as const, flex: 1 },
  aiRespText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  pendingBox: { gap: 8 },
  generateRespBtn: {
    backgroundColor: GOLD, borderRadius: 12, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6},
  generateRespText: { color: '#000', fontSize: 13, fontWeight: '700' as const },
  manualRespBtn: { paddingVertical: 8, alignItems: 'center' },
  manualRespText: { color: Colors.textTertiary, fontSize: 13 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#111', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, paddingBottom: 36},
  createModalSheet: {
    backgroundColor: '#111', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, paddingBottom: 36, maxHeight: '92%'},
  agentModalSheet: {
    backgroundColor: '#111', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, paddingBottom: 36, maxHeight: '90%'},
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: BORDER,
    alignSelf: 'center', marginBottom: 16},
  modalTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '800' as const },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: SURFACE2,
    alignItems: 'center', justifyContent: 'center'},
  exportOption: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: SURFACE2, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: BORDER, marginBottom: 10},
  exportIconBox: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  exportOptTitle: { color: '#fff', fontSize: 15, fontWeight: '600' as const },
  exportOptDesc: { color: Colors.textTertiary, fontSize: 12, marginTop: 2 },

  createLabel: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const, marginBottom: 10 },
  platformOpt: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: SURFACE2, borderRadius: 12, padding: 10,
    borderWidth: 1, borderColor: BORDER},
  platformOptActive: { borderColor: GOLD, backgroundColor: GOLD_DIM },
  platformOptText: { color: Colors.textSecondary, fontSize: 12 },
  topicInput: {
    backgroundColor: SURFACE2, borderRadius: 14, padding: 14,
    color: '#fff', fontSize: 14, borderWidth: 1, borderColor: BORDER,
    minHeight: 70, textAlignVertical: 'top' as const, marginBottom: 14},
  generateBtn: {
    backgroundColor: GOLD, borderRadius: 14, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 14},
  generateBtnText: { color: '#000', fontSize: 15, fontWeight: '700' as const },
  generatedBox: {
    backgroundColor: SURFACE2, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: BORDER},
  generatedHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  generatedTitle: { color: GOLD, fontSize: 13, fontWeight: '700' as const },
  generatedText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 20 },
  generatedActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  copyBtn: {
    flex: 1, borderRadius: 12, paddingVertical: 10,
    alignItems: 'center', backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BORDER},
  copyBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' as const },
  queueBtn: { flex: 2, borderRadius: 12, paddingVertical: 10, alignItems: 'center', backgroundColor: GOLD },
  queueBtnText: { color: '#000', fontSize: 13, fontWeight: '700' as const },

  agentModalClose: {
    alignSelf: 'flex-end', width: 32, height: 32, borderRadius: 10,
    backgroundColor: SURFACE2, alignItems: 'center', justifyContent: 'center'},
  agentModalAvatar: {
    width: 80, height: 80, borderRadius: 40, alignSelf: 'center',
    marginVertical: 12, borderWidth: 3, borderColor: GOLD_DIM},
  agentModalName: { color: '#fff', fontSize: 20, fontWeight: '800' as const, textAlign: 'center' as const },
  agentModalRole: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center' as const, marginTop: 3 },
  agentModalDesc: {
    color: Colors.textTertiary, fontSize: 13, lineHeight: 20,
    textAlign: 'center' as const, marginVertical: 12},
  agentModalStats: {
    flexDirection: 'row', backgroundColor: SURFACE2, borderRadius: 16,
    borderWidth: 1, borderColor: BORDER, overflow: 'hidden', marginBottom: 16},
  agentModalStat: { flex: 1, alignItems: 'center', gap: 4, padding: 16 },
  agentModalStatVal: { color: '#fff', fontSize: 20, fontWeight: '800' as const },
  agentModalStatLabel: { color: Colors.textTertiary, fontSize: 11 },
  agentModalPlatformTitle: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' as const, marginBottom: 8 },
  agentModalPlatforms: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 8, marginBottom: 20 },
  agentModalPlatformChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: SURFACE2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: BORDER},
  agentModalPlatformText: { color: Colors.textSecondary, fontSize: 12 },
  agentModalActions: { flexDirection: 'row', gap: 10 },
  agentActionBtn: {
    flex: 1, backgroundColor: GOLD, borderRadius: 14, paddingVertical: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6},
  agentActionBtnText: { color: '#000', fontSize: 14, fontWeight: '700' as const },
  agentSecBtn: {
    flex: 1, backgroundColor: SURFACE2, borderRadius: 14, paddingVertical: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: BORDER},
  agentSecBtnText: { color: GOLD, fontSize: 14, fontWeight: '700' as const }});
