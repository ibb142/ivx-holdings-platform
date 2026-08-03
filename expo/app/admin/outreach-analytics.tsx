import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  BarChart3,
  Send,
  Eye,
  MousePointer,
  MessageSquare,
  Flame,
  Snowflake,
  Zap,
  Clock,
  DollarSign,
  Target,
  TrendingUp,
  Users,
  Brain,
  Lightbulb,
  AlertTriangle,
  ArrowUpRight,
  Timer,
  Smartphone,
  Monitor,
  Tablet,
  Star,
  Activity,
  Sparkles} from 'lucide-react-native';
import Colors from '@/constants/colors';
import {
  lenderEngagements,
  campaignAnalytics,
  outreachFunnel,
  smartRecommendations,
  timeSpentData,
  costBreakdown,
  getTopEngagedLenders,
  getHotLeads,
  getFollowUpQueue,
  getOverallStats,
  type EngagementLevel,
  type FollowUpPriority} from '@/mocks/outreach-analytics';
import { formatCurrencyCompact } from '@/lib/formatters';



const formatCurrency = (amount: number): string => formatCurrencyCompact(amount);

const formatTime = (seconds: number): string => {
  if (seconds >= 60) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }
  return `${seconds}s`;
};

const ENGAGEMENT_COLORS: Record<EngagementLevel, string> = {
  hot: '#FF4D4D',
  warm: '#F59E0B',
  cold: '#60A5FA',
  unresponsive: '#6B7280'};



const PRIORITY_COLORS: Record<FollowUpPriority, string> = {
  urgent: '#FF4D4D',
  high: '#F59E0B',
  medium: '#4A90D9',
  low: '#6B7280'};

type TabType = 'overview' | 'engagement' | 'campaigns' | 'smart' | 'costs';

export default function OutreachAnalyticsScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [engagementFilter, setEngagementFilter] = useState<EngagementLevel | 'all'>('all');
  const [expandedRec, setExpandedRec] = useState<string | null>(null);
  const [expandedLender, setExpandedLender] = useState<string | null>(null);

  const stats = useMemo(() => getOverallStats(), []);
  const topLenders = useMemo(() => getTopEngagedLenders(15), []);
  const hotLeads = useMemo(() => getHotLeads(), []);
  const followUpQueue = useMemo(() => getFollowUpQueue(), []);

  const filteredEngagements = useMemo(() => {
    if (engagementFilter === 'all') return topLenders;
    return lenderEngagements.filter(e => e.engagementLevel === engagementFilter);
  }, [engagementFilter, topLenders]);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Overview', icon: <BarChart3 size={14} color={activeTab === 'overview' ? Colors.background : Colors.textSecondary} /> },
    { key: 'smart', label: 'AI Smart', icon: <Brain size={14} color={activeTab === 'smart' ? Colors.background : Colors.textSecondary} /> },
    { key: 'engagement', label: 'Lenders', icon: <Users size={14} color={activeTab === 'engagement' ? Colors.background : Colors.textSecondary} /> },
    { key: 'campaigns', label: 'Campaigns', icon: <Send size={14} color={activeTab === 'campaigns' ? Colors.background : Colors.textSecondary} /> },
    { key: 'costs', label: 'ROI', icon: <DollarSign size={14} color={activeTab === 'costs' ? Colors.background : Colors.textSecondary} /> },
  ];

  const renderOverview = () => (
    <View>
      <View style={styles.statsGrid}>
        <View style={[styles.statCard, { borderLeftColor: '#6366F1' }]}>
          <Send size={16} color="#6366F1" />
          <Text style={styles.statValue}>{stats.totalSent}</Text>
          <Text style={styles.statLabel}>Sent</Text>
        </View>
        <View style={[styles.statCard, { borderLeftColor: Colors.primary }]}>
          <Eye size={16} color={Colors.primary} />
          <Text style={styles.statValue}>{stats.openRate}%</Text>
          <Text style={styles.statLabel}>Open Rate</Text>
        </View>
        <View style={[styles.statCard, { borderLeftColor: '#E879F9' }]}>
          <MousePointer size={16} color="#E879F9" />
          <Text style={styles.statValue}>{stats.clickRate}%</Text>
          <Text style={styles.statLabel}>Click Rate</Text>
        </View>
        <View style={[styles.statCard, { borderLeftColor: Colors.success }]}>
          <MessageSquare size={16} color={Colors.success} />
          <Text style={styles.statValue}>{stats.replyRate}%</Text>
          <Text style={styles.statLabel}>Reply Rate</Text>
        </View>
      </View>

      <View style={styles.pipelineCard}>
        <View style={styles.pipelineHeader}>
          <Target size={18} color={Colors.primary} />
          <Text style={styles.pipelineTitle}>Pipeline Value</Text>
        </View>
        <Text style={styles.pipelineValue}>{formatCurrency(stats.totalPipelineValue)}</Text>
        <Text style={styles.pipelineSubtext}>
          Avg conversion probability: {stats.avgConversionProbability}%
        </Text>
        <View style={styles.pipelineBar}>
          <View style={[styles.pipelineBarFill, { width: `${stats.avgConversionProbability}%` }]} />
        </View>
      </View>

      <View style={styles.engagementBreakdown}>
        <Text style={styles.sectionTitle}>Engagement Breakdown</Text>
        <View style={styles.engagementGrid}>
          <Animated.View style={[styles.engagementItem, { transform: [{ scale: hotLeads.length > 0 ? pulseAnim : 1 }] }]}>
            <View style={[styles.engagementDot, { backgroundColor: ENGAGEMENT_COLORS.hot }]} />
            <Text style={styles.engagementCount}>{stats.hotLeads}</Text>
            <Text style={styles.engagementLabel}>Hot</Text>
          </Animated.View>
          <View style={styles.engagementItem}>
            <View style={[styles.engagementDot, { backgroundColor: ENGAGEMENT_COLORS.warm }]} />
            <Text style={styles.engagementCount}>{stats.warmLeads}</Text>
            <Text style={styles.engagementLabel}>Warm</Text>
          </View>
          <View style={styles.engagementItem}>
            <View style={[styles.engagementDot, { backgroundColor: ENGAGEMENT_COLORS.cold }]} />
            <Text style={styles.engagementCount}>{stats.coldLeads}</Text>
            <Text style={styles.engagementLabel}>Cold</Text>
          </View>
          <View style={styles.engagementItem}>
            <View style={[styles.engagementDot, { backgroundColor: ENGAGEMENT_COLORS.unresponsive }]} />
            <Text style={styles.engagementCount}>{stats.unresponsive}</Text>
            <Text style={styles.engagementLabel}>Silent</Text>
          </View>
        </View>
      </View>

      <View style={styles.funnelSection}>
        <Text style={styles.sectionTitle}>Outreach Funnel</Text>
        {outreachFunnel.map((stage, _index) => (
          <View key={stage.stage} style={styles.funnelRow}>
            <View style={styles.funnelLabelWrap}>
              <Text style={styles.funnelLabel}>{stage.stage}</Text>
              <Text style={styles.funnelCount}>{stage.count}</Text>
            </View>
            <View style={styles.funnelBarOuter}>
              <Animated.View
                style={[
                  styles.funnelBarInner,
                  {
                    width: `${Math.max(8, stage.percentage)}%`,
                    backgroundColor: stage.color},
                ]}
              />
            </View>
            {stage.dropOffRate > 0 && (
              <Text style={styles.funnelDropoff}>-{stage.dropOffRate.toFixed(0)}%</Text>
            )}
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Time Spent Reading Emails</Text>
        <Text style={styles.sectionSubtitle}>Top engaged lenders by reading time</Text>
        {timeSpentData.slice(0, 6).map((item) => (
          <View key={item.emailId} style={styles.timeCard}>
            <View style={styles.timeCardHeader}>
              <View style={styles.timeCardLeft}>
                <Text style={styles.timeCardName} numberOfLines={1}>{item.lenderName}</Text>
                <Text style={styles.timeCardSubject} numberOfLines={1}>{item.subject}</Text>
              </View>
              <View style={styles.timeCardRight}>
                <Timer size={14} color={Colors.primary} />
                <Text style={styles.timeCardValue}>{formatTime(item.timeSpentSeconds)}</Text>
              </View>
            </View>
            <View style={styles.timeCardMeta}>
              <View style={styles.timeCardMetaItem}>
                <Text style={styles.timeCardMetaLabel}>Scroll</Text>
                <View style={styles.scrollBar}>
                  <View style={[styles.scrollBarFill, { width: `${item.scrollDepthPercent}%` }]} />
                </View>
                <Text style={styles.timeCardMetaValue}>{item.scrollDepthPercent}%</Text>
              </View>
              <View style={styles.timeCardMetaItem}>
                {item.deviceType === 'desktop' ? <Monitor size={12} color={Colors.textTertiary} /> :
                  item.deviceType === 'mobile' ? <Smartphone size={12} color={Colors.textTertiary} /> :
                    <Tablet size={12} color={Colors.textTertiary} />}
                <Text style={styles.timeCardMetaValue}>{item.deviceType}</Text>
              </View>
              <View style={styles.timeCardMetaItem}>
                <MousePointer size={12} color={Colors.textTertiary} />
                <Text style={styles.timeCardMetaValue}>{item.linksClicked.length} links</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );

  const renderSmartRecommendations = () => (
    <View>
      <View style={styles.aiHeaderCard}>
        <View style={styles.aiHeaderLeft}>
          <Brain size={24} color={Colors.primary} />
          <View>
            <Text style={styles.aiHeaderTitle}>AI Smart Recommendations</Text>
            <Text style={styles.aiHeaderSubtitle}>
              {smartRecommendations.length} actions to boost your outreach
            </Text>
          </View>
        </View>
      </View>

      {followUpQueue.length > 0 && (
        <View style={styles.urgentBanner}>
          <View style={styles.urgentBannerLeft}>
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <AlertTriangle size={20} color="#FF4D4D" />
            </Animated.View>
            <View>
              <Text style={styles.urgentBannerTitle}>
                {followUpQueue.filter(f => f.followUpPriority === 'urgent').length} Urgent Follow-Ups
              </Text>
              <Text style={styles.urgentBannerText}>
                Hot leads waiting — respond within 24hrs for best results
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.urgentBannerBtn}
            onPress={() => router.push('/admin/ai-outreach' as any)}
          >
            <Text style={styles.urgentBannerBtnText}>Act Now</Text>
          </TouchableOpacity>
        </View>
      )}

      {smartRecommendations.map((rec) => (
        <TouchableOpacity
          key={rec.id}
          style={styles.recCard}
          onPress={() => setExpandedRec(expandedRec === rec.id ? null : rec.id)}
          activeOpacity={0.7}
        >
          <View style={styles.recHeader}>
            <View style={[styles.recPriorityDot, { backgroundColor: PRIORITY_COLORS[rec.priority] }]} />
            <View style={styles.recHeaderInfo}>
              <View style={styles.recTitleRow}>
                <Text style={styles.recTitle} numberOfLines={1}>{rec.title}</Text>
                <View style={[styles.recPriorityBadge, { backgroundColor: `${PRIORITY_COLORS[rec.priority]}20` }]}>
                  <Text style={[styles.recPriorityText, { color: PRIORITY_COLORS[rec.priority] }]}>
                    {rec.priority}
                  </Text>
                </View>
              </View>
              <Text style={styles.recDescription} numberOfLines={expandedRec === rec.id ? 5 : 2}>
                {rec.description}
              </Text>
            </View>
          </View>

          <View style={styles.recMetrics}>
            <View style={styles.recMetric}>
              <Users size={12} color={Colors.accent} />
              <Text style={styles.recMetricText}>{rec.lenderCount} lenders</Text>
            </View>
            <View style={styles.recMetric}>
              <TrendingUp size={12} color={Colors.success} />
              <Text style={styles.recMetricText}>{rec.estimatedImpact}</Text>
            </View>
            <View style={styles.recMetric}>
              <Brain size={12} color={Colors.primary} />
              <Text style={styles.recMetricText}>{rec.aiConfidence}% confidence</Text>
            </View>
          </View>

          {expandedRec === rec.id && (
            <View style={styles.recExpanded}>
              <View style={styles.recRevenueRow}>
                <DollarSign size={16} color={Colors.success} />
                <Text style={styles.recRevenueLabel}>Estimated Pipeline Impact</Text>
                <Text style={styles.recRevenueValue}>{formatCurrency(rec.estimatedRevenue)}</Text>
              </View>
              <TouchableOpacity
                style={styles.recActionBtn}
                onPress={() => router.push('/admin/ai-outreach' as any)}
              >
                <Sparkles size={16} color={Colors.background} />
                <Text style={styles.recActionBtnText}>{rec.actionLabel}</Text>
                <ArrowUpRight size={14} color={Colors.background} />
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
      ))}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Follow-Up Queue</Text>
        <Text style={styles.sectionSubtitle}>Priority-ranked lenders awaiting response</Text>
        {followUpQueue.slice(0, 8).map((lender) => (
          <View key={lender.lenderId} style={styles.followUpCard}>
            <View style={[styles.followUpPriorityBar, { backgroundColor: PRIORITY_COLORS[lender.followUpPriority] }]} />
            <View style={styles.followUpInfo}>
              <Text style={styles.followUpName} numberOfLines={1}>{lender.lenderName}</Text>
              <Text style={styles.followUpContact}>{lender.contactName}</Text>
              <Text style={styles.followUpAction} numberOfLines={1}>{lender.suggestedAction}</Text>
            </View>
            <View style={styles.followUpRight}>
              <View style={styles.followUpScoreBadge}>
                <Text style={styles.followUpScore}>{lender.aiInterestScore}</Text>
              </View>
              <Text style={styles.followUpDays}>{lender.daysSinceLastContact}d ago</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );

  const renderEngagement = () => (
    <View>
      <View style={styles.filterRow}>
        {(['all', 'hot', 'warm', 'cold', 'unresponsive'] as const).map((filter) => (
          <TouchableOpacity
            key={filter}
            style={[
              styles.filterChip,
              engagementFilter === filter && styles.filterChipActive,
              engagementFilter === filter && filter !== 'all' && { backgroundColor: ENGAGEMENT_COLORS[filter as EngagementLevel] },
            ]}
            onPress={() => setEngagementFilter(filter)}
          >
            {filter === 'hot' && <Flame size={12} color={engagementFilter === filter ? Colors.background : '#FF4D4D'} />}
            {filter === 'warm' && <Zap size={12} color={engagementFilter === filter ? Colors.background : '#F59E0B'} />}
            {filter === 'cold' && <Snowflake size={12} color={engagementFilter === filter ? Colors.background : '#60A5FA'} />}
            {filter === 'unresponsive' && <Clock size={12} color={engagementFilter === filter ? Colors.background : '#6B7280'} />}
            <Text style={[
              styles.filterChipText,
              engagementFilter === filter && styles.filterChipTextActive,
            ]}>
              {filter === 'all' ? `All (${lenderEngagements.length})` : `${filter.charAt(0).toUpperCase() + filter.slice(1)} (${lenderEngagements.filter(e => e.engagementLevel === filter).length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {filteredEngagements.map((lender) => (
        <TouchableOpacity
          key={lender.lenderId}
          style={styles.lenderCard}
          onPress={() => setExpandedLender(expandedLender === lender.lenderId ? null : lender.lenderId)}
          activeOpacity={0.7}
        >
          <View style={styles.lenderCardHeader}>
            <View style={[styles.engagementIndicator, { backgroundColor: ENGAGEMENT_COLORS[lender.engagementLevel] }]} />
            <View style={styles.lenderCardInfo}>
              <Text style={styles.lenderCardName} numberOfLines={1}>{lender.lenderName}</Text>
              <Text style={styles.lenderCardContact}>{lender.contactName} · {lender.category.replace('_', ' ')}</Text>
            </View>
            <View style={styles.lenderScoreCircle}>
              <Text style={styles.lenderScoreText}>{lender.aiInterestScore}</Text>
            </View>
          </View>

          <View style={styles.lenderCardMetrics}>
            <View style={styles.lenderMetric}>
              <Send size={11} color={Colors.textTertiary} />
              <Text style={styles.lenderMetricValue}>{lender.totalEmailsSent}</Text>
            </View>
            <View style={styles.lenderMetric}>
              <Eye size={11} color={Colors.primary} />
              <Text style={styles.lenderMetricValue}>{lender.openRate}%</Text>
            </View>
            <View style={styles.lenderMetric}>
              <MousePointer size={11} color="#E879F9" />
              <Text style={styles.lenderMetricValue}>{lender.clickRate}%</Text>
            </View>
            <View style={styles.lenderMetric}>
              <MessageSquare size={11} color={Colors.success} />
              <Text style={styles.lenderMetricValue}>{lender.replyRate}%</Text>
            </View>
            <View style={styles.lenderMetric}>
              <Timer size={11} color={Colors.accent} />
              <Text style={styles.lenderMetricValue}>{formatTime(lender.avgTimeSpentSeconds)}</Text>
            </View>
          </View>

          {expandedLender === lender.lenderId && (
            <View style={styles.lenderExpanded}>
              <View style={styles.lenderExpandedRow}>
                <Text style={styles.lenderExpandedLabel}>AUM</Text>
                <Text style={styles.lenderExpandedValue}>{formatCurrency(lender.aum)}</Text>
              </View>
              <View style={styles.lenderExpandedRow}>
                <Text style={styles.lenderExpandedLabel}>Est. Deal Value</Text>
                <Text style={[styles.lenderExpandedValue, { color: Colors.success }]}>{formatCurrency(lender.estimatedDealValue)}</Text>
              </View>
              <View style={styles.lenderExpandedRow}>
                <Text style={styles.lenderExpandedLabel}>Conversion Probability</Text>
                <Text style={styles.lenderExpandedValue}>{lender.conversionProbability}%</Text>
              </View>
              <View style={styles.lenderExpandedRow}>
                <Text style={styles.lenderExpandedLabel}>Days Since Contact</Text>
                <Text style={styles.lenderExpandedValue}>{lender.daysSinceLastContact}d</Text>
              </View>
              <View style={styles.lenderExpandedRow}>
                <Text style={styles.lenderExpandedLabel}>Suggested Channel</Text>
                <Text style={styles.lenderExpandedValue}>{lender.suggestedChannel}</Text>
              </View>
              <View style={styles.lenderSuggestion}>
                <Lightbulb size={14} color={Colors.primary} />
                <Text style={styles.lenderSuggestionText}>{lender.suggestedAction}</Text>
              </View>
              <TouchableOpacity
                style={styles.lenderActionBtn}
                onPress={() => router.push('/admin/ai-outreach' as any)}
              >
                <Send size={14} color={Colors.background} />
                <Text style={styles.lenderActionBtnText}>Send Follow-Up</Text>
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderCampaigns = () => (
    <View>
      {campaignAnalytics.map((campaign) => (
        <View key={campaign.id} style={styles.campaignCard}>
          <View style={styles.campaignHeader}>
            <View style={styles.campaignHeaderLeft}>
              <Text style={styles.campaignName}>{campaign.name}</Text>
              <Text style={styles.campaignProperty}>{campaign.propertyName}</Text>
              <Text style={styles.campaignDate}>
                {new Date(campaign.sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </Text>
            </View>
            <View style={styles.campaignROI}>
              <Text style={styles.campaignROILabel}>ROI</Text>
              <Text style={styles.campaignROIValue}>{new Intl.NumberFormat('en-US').format(campaign.estimatedROI)}%</Text>
            </View>
          </View>

          <View style={styles.campaignMetricsGrid}>
            <View style={styles.campaignMetricItem}>
              <Text style={styles.campaignMetricValue}>{campaign.totalSent}</Text>
              <Text style={styles.campaignMetricLabel}>Sent</Text>
            </View>
            <View style={styles.campaignMetricItem}>
              <Text style={[styles.campaignMetricValue, { color: Colors.primary }]}>{campaign.openRate}%</Text>
              <Text style={styles.campaignMetricLabel}>Opened</Text>
            </View>
            <View style={styles.campaignMetricItem}>
              <Text style={[styles.campaignMetricValue, { color: '#E879F9' }]}>{campaign.clickRate}%</Text>
              <Text style={styles.campaignMetricLabel}>Clicked</Text>
            </View>
            <View style={styles.campaignMetricItem}>
              <Text style={[styles.campaignMetricValue, { color: Colors.success }]}>{campaign.replyRate}%</Text>
              <Text style={styles.campaignMetricLabel}>Replied</Text>
            </View>
          </View>

          <View style={styles.campaignInsight}>
            <Timer size={13} color={Colors.accent} />
            <Text style={styles.campaignInsightText}>
              Avg reading time: {formatTime(campaign.avgTimeSpentSeconds)} · Peak opens at {campaign.peakOpenHour}:00
            </Text>
          </View>

          <View style={styles.campaignDevices}>
            <View style={styles.campaignDeviceItem}>
              <Monitor size={12} color={Colors.textTertiary} />
              <Text style={styles.campaignDeviceText}>{campaign.deviceBreakdown.desktop}%</Text>
            </View>
            <View style={styles.campaignDeviceItem}>
              <Smartphone size={12} color={Colors.textTertiary} />
              <Text style={styles.campaignDeviceText}>{campaign.deviceBreakdown.mobile}%</Text>
            </View>
            <View style={styles.campaignDeviceItem}>
              <Tablet size={12} color={Colors.textTertiary} />
              <Text style={styles.campaignDeviceText}>{campaign.deviceBreakdown.tablet}%</Text>
            </View>
          </View>

          <View style={styles.campaignSubjectWrap}>
            <Star size={12} color={Colors.primary} />
            <Text style={styles.campaignSubjectLabel}>Best subject: </Text>
            <Text style={styles.campaignSubjectText} numberOfLines={1}>{campaign.bestPerformingSubject}</Text>
          </View>
        </View>
      ))}
    </View>
  );

  const renderCosts = () => (
    <View>
      <View style={styles.costOverview}>
        <Text style={styles.sectionTitle}>Monthly Cost Breakdown</Text>
        <View style={styles.costGrid}>
          <View style={styles.costItem}>
            <Text style={styles.costItemLabel}>Email Platform</Text>
            <Text style={styles.costItemValue}>${costBreakdown.emailPlatform}/mo</Text>
          </View>
          <View style={styles.costItem}>
            <Text style={styles.costItemLabel}>AI Generation</Text>
            <Text style={styles.costItemValue}>${costBreakdown.aiGeneration}/mo</Text>
          </View>
          <View style={styles.costItem}>
            <Text style={styles.costItemLabel}>Data Enrichment</Text>
            <Text style={styles.costItemValue}>${costBreakdown.dataEnrichment}/mo</Text>
          </View>
          <View style={styles.costItem}>
            <Text style={styles.costItemLabel}>Tracking</Text>
            <Text style={[styles.costItemValue, { color: Colors.success }]}>Free</Text>
          </View>
        </View>
      </View>

      <View style={styles.costTotalCard}>
        <View style={styles.costTotalRow}>
          <Text style={styles.costTotalLabel}>Total Monthly Cost</Text>
          <Text style={styles.costTotalValue}>${new Intl.NumberFormat('en-US').format(costBreakdown.total)}/mo</Text>
        </View>
        <View style={styles.costBudgetBar}>
          <View style={[styles.costBudgetBarFill, { width: `${costBreakdown.budgetUsedPercent}%` }]} />
        </View>
        <Text style={styles.costBudgetText}>
          {costBreakdown.budgetUsedPercent}% of ${new Intl.NumberFormat('en-US').format(costBreakdown.monthlyBudget)} budget used
        </Text>
      </View>

      <View style={styles.costEfficiency}>
        <Text style={styles.sectionTitle}>Cost Efficiency</Text>
        <View style={styles.costEffGrid}>
          <View style={styles.costEffItem}>
            <DollarSign size={20} color={Colors.primary} />
            <Text style={styles.costEffValue}>${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(costBreakdown.costPerLead)}</Text>
            <Text style={styles.costEffLabel}>Per Lead</Text>
          </View>
          <View style={styles.costEffDivider} />
          <View style={styles.costEffItem}>
            <MessageSquare size={20} color={Colors.success} />
            <Text style={styles.costEffValue}>${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(costBreakdown.costPerReply)}</Text>
            <Text style={styles.costEffLabel}>Per Reply</Text>
          </View>
          <View style={styles.costEffDivider} />
          <View style={styles.costEffItem}>
            <TrendingUp size={20} color="#E879F9" />
            <Text style={styles.costEffValue}>{formatCurrency(stats.totalPipelineValue)}</Text>
            <Text style={styles.costEffLabel}>Pipeline</Text>
          </View>
        </View>
      </View>

      <View style={styles.costROICard}>
        <View style={styles.costROIHeader}>
          <Activity size={18} color={Colors.success} />
          <Text style={styles.costROITitle}>ROI Analysis</Text>
        </View>
        <View style={styles.costROIGrid}>
          <View style={styles.costROIItem}>
            <Text style={styles.costROILabel}>Total Spent</Text>
            <Text style={styles.costROIValue}>${new Intl.NumberFormat('en-US').format(costBreakdown.total)}</Text>
          </View>
          <View style={styles.costROIItem}>
            <Text style={styles.costROILabel}>Pipeline Generated</Text>
            <Text style={[styles.costROIValue, { color: Colors.success }]}>{formatCurrency(stats.totalPipelineValue)}</Text>
          </View>
          <View style={styles.costROIItem}>
            <Text style={styles.costROILabel}>Cost per $1 Pipeline</Text>
            <Text style={styles.costROIValue}>${(costBreakdown.total / (stats.totalPipelineValue / 1000000)).toFixed(4)}</Text>
          </View>
          <View style={styles.costROIItem}>
            <Text style={styles.costROILabel}>Lenders Engaged</Text>
            <Text style={styles.costROIValue}>{stats.hotLeads + stats.warmLeads}</Text>
          </View>
        </View>
        <View style={styles.costROISaving}>
          <Sparkles size={14} color={Colors.primary} />
          <Text style={styles.costROISavingText}>
            AI outreach saves ~40 hours/month vs manual emails. That's ~$2,000 in time savings.
          </Text>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Outreach Analytics</Text>
          <View style={styles.headerBadge}>
            <Brain size={10} color={Colors.primary} />
            <Text style={styles.headerBadgeText}>AI-Powered CRM</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.headerActionBtn}
          onPress={() => router.push('/admin/ai-outreach' as any)}
        >
          <Send size={18} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabBarContent}
      >
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            {tab.icon}
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {activeTab === 'overview' && renderOverview()}
          {activeTab === 'smart' && renderSmartRecommendations()}
          {activeTab === 'engagement' && renderEngagement()}
          {activeTab === 'campaigns' && renderCampaigns()}
          {activeTab === 'costs' && renderCosts()}
        </View>
        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 8 },
  headerTitleWrap: { flex: 1 },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  headerBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  headerBadgeText: { color: Colors.black, fontSize: 11, fontWeight: '700' as const },
  headerActionBtn: { padding: 8 },
  tabBar: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 12, padding: 4, marginBottom: 16 },
  tabBarContent: { flexDirection: 'row', gap: 4 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: 13 },
  tabTextActive: { color: Colors.black },
  scrollView: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, paddingHorizontal: 20 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  pipelineCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  pipelineHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  pipelineTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  pipelineValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  pipelineSubtext: { color: Colors.textSecondary, fontSize: 13 },
  pipelineBar: { gap: 4 },
  pipelineBarFill: { gap: 4 },
  engagementBreakdown: { gap: 4 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  sectionSubtitle: { color: Colors.textTertiary, fontSize: 13, marginTop: 4 },
  engagementGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  engagementItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  engagementDot: { width: 8, height: 8, borderRadius: 4 },
  engagementCount: { gap: 4 },
  engagementLabel: { color: Colors.textSecondary, fontSize: 13 },
  funnelSection: { marginBottom: 16 },
  funnelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  funnelLabelWrap: { gap: 4 },
  funnelLabel: { color: Colors.textSecondary, fontSize: 13 },
  funnelCount: { gap: 4 },
  funnelBarOuter: { gap: 4 },
  funnelBarInner: { gap: 4 },
  funnelDropoff: { gap: 4 },
  section: { marginBottom: 20 },
  timeCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  timeCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  timeCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  timeCardName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  timeCardSubject: { gap: 4 },
  timeCardRight: { alignItems: 'flex-end' },
  timeCardValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  timeCardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeCardMetaItem: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  timeCardMetaLabel: { color: Colors.textSecondary, fontSize: 13 },
  timeCardMetaValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  scrollBar: { gap: 4 },
  scrollBarFill: { gap: 4 },
  aiHeaderCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  aiHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  aiHeaderTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  aiHeaderSubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  urgentBanner: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  urgentBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  urgentBannerTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  urgentBannerText: { color: Colors.textSecondary, fontSize: 13 },
  urgentBannerBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  urgentBannerBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  recCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  recHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  recPriorityDot: { width: 8, height: 8, borderRadius: 4 },
  recHeaderInfo: { flex: 1 },
  recTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  recPriorityBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  recPriorityText: { color: Colors.textSecondary, fontSize: 13 },
  recDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  recMetrics: { gap: 4 },
  recMetric: { gap: 4 },
  recMetricText: { color: Colors.textSecondary, fontSize: 13 },
  recExpanded: { paddingTop: 12, gap: 8 },
  recRevenueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recRevenueLabel: { color: Colors.textSecondary, fontSize: 13 },
  recRevenueValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  recActionBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  recActionBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  followUpCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  followUpPriorityBar: { gap: 4 },
  followUpInfo: { flex: 1 },
  followUpName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  followUpContact: { gap: 4 },
  followUpAction: { gap: 4 },
  followUpRight: { alignItems: 'flex-end' },
  followUpScoreBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  followUpScore: { alignItems: 'center', gap: 4 },
  followUpDays: { gap: 4 },
  filterRow: { marginBottom: 12 },
  filterChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: Colors.surfaceBorder },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
  filterChipTextActive: { color: Colors.black },
  lenderCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  lenderCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  engagementIndicator: { width: 4, borderRadius: 2 },
  lenderCardInfo: { flex: 1 },
  lenderCardName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  lenderCardContact: { gap: 4 },
  lenderScoreCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFD700' + '15', alignItems: 'center', justifyContent: 'center' },
  lenderScoreText: { color: Colors.textSecondary, fontSize: 13 },
  lenderCardMetrics: { gap: 4 },
  lenderMetric: { gap: 4 },
  lenderMetricValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  lenderExpanded: { paddingTop: 12, gap: 8 },
  lenderExpandedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lenderExpandedLabel: { color: Colors.textSecondary, fontSize: 13 },
  lenderExpandedValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  lenderSuggestion: { gap: 4 },
  lenderSuggestionText: { color: Colors.textSecondary, fontSize: 13 },
  lenderActionBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  lenderActionBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  campaignCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  campaignHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  campaignHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  campaignName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  campaignProperty: { gap: 4 },
  campaignDate: { color: Colors.textTertiary, fontSize: 12 },
  campaignROI: { gap: 4 },
  campaignROILabel: { color: Colors.textSecondary, fontSize: 13 },
  campaignROIValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  campaignMetricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  campaignMetricItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  campaignMetricValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  campaignMetricLabel: { color: Colors.textSecondary, fontSize: 13 },
  campaignInsight: { gap: 4 },
  campaignInsightText: { color: Colors.textSecondary, fontSize: 13 },
  campaignDevices: { gap: 4 },
  campaignDeviceItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  campaignDeviceText: { color: Colors.textSecondary, fontSize: 13 },
  campaignSubjectWrap: { gap: 4 },
  campaignSubjectLabel: { color: Colors.textSecondary, fontSize: 13 },
  campaignSubjectText: { color: Colors.textSecondary, fontSize: 13 },
  costOverview: { gap: 4 },
  costGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  costItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  costItemLabel: { color: Colors.textSecondary, fontSize: 13 },
  costItemValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  costTotalCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  costTotalRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  costTotalLabel: { color: Colors.textSecondary, fontSize: 13 },
  costTotalValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  costBudgetBar: { gap: 4 },
  costBudgetBarFill: { gap: 4 },
  costBudgetText: { color: Colors.textSecondary, fontSize: 13 },
  costEfficiency: { gap: 4 },
  costEffGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  costEffItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  costEffValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  costEffLabel: { color: Colors.textSecondary, fontSize: 13 },
  costEffDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder },
  costROICard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  costROIHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  costROITitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  costROIGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  costROIItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  costROILabel: { color: Colors.textSecondary, fontSize: 13 },
  costROIValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  costROISaving: { gap: 4 },
  costROISavingText: { color: Colors.textSecondary, fontSize: 13 }});
