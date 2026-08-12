import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Animated,
  Dimensions} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Activity,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Wrench,
  Clock,
  Zap,
  Globe,
  Target,
  Rocket,
  BarChart3,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Cpu,
  HardDrive,
  Wifi,
  FileText,
  Smartphone,
  Monitor,
  Flame,
  Star,
  ArrowUpRight,
  ArrowDownRight} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import {
  MODULE_HEALTH_DATA,
  GROWTH_CHANNELS,
  GROWTH_MILESTONES,
  DIAGNOSTIC_REPORTS,
  SYSTEM_PULSE_DATA,
  WORLD_STATS,
  type ModuleHealth,
  type GrowthChannel,
  type DiagnosticRecommendation} from '@/mocks/system-monitor';

const { width: _SCREEN_WIDTH } = Dimensions.get('window');

type TabId = 'pulse' | 'modules' | 'growth' | 'reports';

const TABS: { id: TabId; label: string; icon: typeof Activity }[] = [
  { id: 'pulse', label: 'Pulse', icon: Activity },
  { id: 'modules', label: 'Modules', icon: Shield },
  { id: 'growth', label: 'Growth', icon: Rocket },
  { id: 'reports', label: 'Reports', icon: FileText },
];

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

function formatPercent(n: number): string {
  return n.toFixed(1) + '%';
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'operational': return '#00E676';
    case 'degraded': return '#FFB300';
    case 'down': return '#FF1744';
    case 'maintenance': return '#448AFF';
    default: return Colors.textSecondary;
  }
}

function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#FF1744';
    case 'high': return '#FF6D00';
    case 'medium': return '#FFB300';
    case 'low': return '#00E676';
    default: return Colors.textSecondary;
  }
}

function getActionColor(action: string): string {
  switch (action) {
    case 'replace': return '#FF1744';
    case 'fix': return '#FF6D00';
    case 'update': return '#FFB300';
    case 'optimize': return '#00BCD4';
    case 'monitor': return '#00E676';
    default: return Colors.textSecondary;
  }
}

function LiveDot() {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  return (
    <Animated.View style={[styles.liveDot, { opacity: pulseAnim }]} />
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const widthPercent = Math.min((value / max) * 100, 100);
  return (
    <View style={styles.miniBarTrack}>
      <View style={[styles.miniBarFill, { width: `${widthPercent}%` as any, backgroundColor: color }]} />
    </View>
  );
}

function ModuleRow({ module, onPress }: { module: ModuleHealth; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.moduleRow} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.statusDot, { backgroundColor: getStatusColor(module.status) }]} />
      <View style={styles.moduleMainInfo}>
        <Text style={styles.moduleRowName} numberOfLines={1}>{module.name}</Text>
        <View style={styles.moduleRowMeta}>
          <Text style={styles.moduleRowMetaText}>{formatPercent(module.uptime)} up</Text>
          <Text style={styles.moduleRowDivider}>·</Text>
          <Text style={styles.moduleRowMetaText}>{module.responseTime}ms</Text>
          <Text style={styles.moduleRowDivider}>·</Text>
          <Text style={styles.moduleRowMetaText}>{formatNumber(module.dailyUsers)} users</Text>
        </View>
      </View>
      <View style={styles.moduleRowRight}>
        {module.criticalIssues > 0 && (
          <View style={styles.issueBadgeCritical}>
            <Text style={styles.issueBadgeText}>{module.criticalIssues}</Text>
          </View>
        )}
        {module.warnings > 0 && (
          <View style={styles.issueBadgeWarn}>
            <Text style={styles.issueBadgeText}>{module.warnings}</Text>
          </View>
        )}
        <ChevronRight size={16} color={Colors.textTertiary} />
      </View>
    </TouchableOpacity>
  );
}

function ModuleDetail({ module, onClose }: { module: ModuleHealth; onClose: () => void }) {
  return (
    <View style={styles.moduleDetailOverlay}>
      <View style={styles.moduleDetailCard}>
        <View style={styles.moduleDetailHeader}>
          <View style={[styles.statusDotLarge, { backgroundColor: getStatusColor(module.status) }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.moduleDetailName}>{module.name}</Text>
            <Text style={styles.moduleDetailStatus}>{module.status.toUpperCase()}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.moduleDetailClose}>
            <XCircle size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={styles.moduleDetailGrid}>
          <View style={styles.moduleDetailStat}>
            <Text style={styles.moduleDetailStatValue}>{formatPercent(module.uptime)}</Text>
            <Text style={styles.moduleDetailStatLabel}>Uptime</Text>
          </View>
          <View style={styles.moduleDetailStat}>
            <Text style={styles.moduleDetailStatValue}>{module.responseTime}ms</Text>
            <Text style={styles.moduleDetailStatLabel}>Resp. Time</Text>
          </View>
          <View style={styles.moduleDetailStat}>
            <Text style={styles.moduleDetailStatValue}>{formatPercent(module.errorRate)}</Text>
            <Text style={styles.moduleDetailStatLabel}>Error Rate</Text>
          </View>
          <View style={styles.moduleDetailStat}>
            <Text style={styles.moduleDetailStatValue}>{formatNumber(module.dailyUsers)}</Text>
            <Text style={styles.moduleDetailStatLabel}>Daily Users</Text>
          </View>
        </View>

        <View style={styles.platformRow}>
          <Text style={styles.platformLabel}>Platforms:</Text>
          {module.platform.map((p) => (
            <View key={p} style={styles.platformBadge}>
              {p === 'ios' && <Smartphone size={12} color="#FFF" />}
              {p === 'android' && <Smartphone size={12} color="#FFF" />}
              {p === 'web' && <Monitor size={12} color="#FFF" />}
              <Text style={styles.platformBadgeText}>{p.toUpperCase()}</Text>
            </View>
          ))}
        </View>

        {module.recommendation && (
          <View style={styles.recommendationBox}>
            <AlertTriangle size={16} color="#FFB300" />
            <Text style={styles.recommendationText}>{module.recommendation}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function ChannelRow({ channel }: { channel: GrowthChannel }) {
  return (
    <View style={styles.channelRow}>
      <View style={styles.channelLeft}>
        <Text style={styles.channelName}>{channel.name}</Text>
        <View style={styles.channelMeta}>
          <Text style={styles.channelMetaText}>{formatNumber(channel.currentUsers)} users</Text>
          <Text style={styles.channelDivider}>→</Text>
          <Text style={[styles.channelMetaText, { color: '#00E676' }]}>{formatNumber(channel.projectedUsers)} projected</Text>
        </View>
      </View>
      <View style={styles.channelRight}>
        <View style={styles.channelGrowthBadge}>
          {channel.trend === 'up' ? (
            <ArrowUpRight size={12} color="#00E676" />
          ) : channel.trend === 'down' ? (
            <ArrowDownRight size={12} color="#FF1744" />
          ) : (
            <Activity size={12} color="#FFB300" />
          )}
          <Text style={[styles.channelGrowthText, {
            color: channel.trend === 'up' ? '#00E676' : channel.trend === 'down' ? '#FF1744' : '#FFB300'
          }]}>
            {channel.monthlyGrowthRate}%/mo
          </Text>
        </View>
        <Text style={styles.channelConversion}>{formatPercent(channel.conversionRate)} conv</Text>
        <Text style={styles.channelROI}>ROI: {channel.roi === Infinity ? '∞' : channel.roi + '%'}</Text>
      </View>
    </View>
  );
}

export default function SystemMonitorPage() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>('pulse');
  const [refreshing, setRefreshing] = useState(false);
  const [lastScanTime, setLastScanTime] = useState(new Date());
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  const [selectedModule, setSelectedModule] = useState<ModuleHealth | null>(null);
  const [moduleFilter, setModuleFilter] = useState<'all' | 'issues' | 'operational'>('all');
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const scanAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const scanLoop = Animated.loop(
      Animated.timing(scanAnim, {
        toValue: 1,
        duration: 3000,
        useNativeDriver: false})
    );
    scanLoop.start();
    return () => scanLoop.stop();
  }, [scanAnim]);

  const scanWidth = scanAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['0%', '100%', '0%']});

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setLastScanTime(new Date());
    setTimeout(() => setRefreshing(false), 1500);
  }, []);

  const overallHealth = useMemo(() => {
    const operational = MODULE_HEALTH_DATA.filter(m => m.status === 'operational').length;
    const total = MODULE_HEALTH_DATA.length;
    return Math.round((operational / total) * 100);
  }, []);

  const totalIssues = useMemo(() => {
    return MODULE_HEALTH_DATA.reduce((sum, m) => sum + m.criticalIssues + m.warnings, 0);
  }, []);

  const criticalCount = useMemo(() => {
    return MODULE_HEALTH_DATA.reduce((sum, m) => sum + m.criticalIssues, 0);
  }, []);

  const totalCurrentUsers = useMemo(() => {
    return GROWTH_CHANNELS.reduce((sum, c) => sum + c.currentUsers, 0);
  }, []);

  const filteredModules = useMemo(() => {
    if (moduleFilter === 'issues') return MODULE_HEALTH_DATA.filter(m => m.criticalIssues > 0 || m.warnings > 0 || m.status !== 'operational');
    if (moduleFilter === 'operational') return MODULE_HEALTH_DATA.filter(m => m.status === 'operational');
    return MODULE_HEALTH_DATA;
  }, [moduleFilter]);

  const latestPulse = SYSTEM_PULSE_DATA[SYSTEM_PULSE_DATA.length - 1];

  const renderPulseTab = () => (
    <View>
      <View style={styles.pulseHeader}>
        <View style={styles.pulseScoreContainer}>
          <View style={[styles.pulseScoreRing, {
            borderColor: overallHealth >= 90 ? '#00E676' : overallHealth >= 70 ? '#FFB300' : '#FF1744'
          }]}>
            <Text style={styles.pulseScoreValue}>{overallHealth}</Text>
            <Text style={styles.pulseScoreLabel}>HEALTH</Text>
          </View>
        </View>
        <View style={styles.pulseStatsColumn}>
          <View style={styles.pulseStat}>
            <Shield size={16} color="#00E676" />
            <Text style={styles.pulseStatValue}>{MODULE_HEALTH_DATA.filter(m => m.status === 'operational').length}</Text>
            <Text style={styles.pulseStatLabel}>Operational</Text>
          </View>
          <View style={styles.pulseStat}>
            <AlertTriangle size={16} color="#FFB300" />
            <Text style={styles.pulseStatValue}>{MODULE_HEALTH_DATA.filter(m => m.status === 'degraded').length}</Text>
            <Text style={styles.pulseStatLabel}>Degraded</Text>
          </View>
          <View style={styles.pulseStat}>
            <XCircle size={16} color="#FF1744" />
            <Text style={styles.pulseStatValue}>{MODULE_HEALTH_DATA.filter(m => m.status === 'down').length}</Text>
            <Text style={styles.pulseStatLabel}>Down</Text>
          </View>
          <View style={styles.pulseStat}>
            <Wrench size={16} color="#448AFF" />
            <Text style={styles.pulseStatValue}>{MODULE_HEALTH_DATA.filter(m => m.status === 'maintenance').length}</Text>
            <Text style={styles.pulseStatLabel}>Maint.</Text>
          </View>
        </View>
      </View>

      <View style={styles.liveServerCard}>
        <View style={styles.liveServerHeader}>
          <View style={styles.liveServerTitle}>
            <LiveDot />
            <Text style={styles.liveServerTitleText}>Live Server Metrics</Text>
          </View>
          <Text style={styles.liveServerTime}>{secondsElapsed}s ago</Text>
        </View>
        <View style={styles.serverMetricsGrid}>
          <View style={styles.serverMetric}>
            <Cpu size={18} color="#00BCD4" />
            <Text style={styles.serverMetricValue}>{latestPulse.cpuUsage.toFixed(0)}%</Text>
            <Text style={styles.serverMetricLabel}>CPU</Text>
            <MiniBar value={latestPulse.cpuUsage} max={100} color="#00BCD4" />
          </View>
          <View style={styles.serverMetric}>
            <HardDrive size={18} color="#7C4DFF" />
            <Text style={styles.serverMetricValue}>{latestPulse.memoryUsage.toFixed(0)}%</Text>
            <Text style={styles.serverMetricLabel}>Memory</Text>
            <MiniBar value={latestPulse.memoryUsage} max={100} color="#7C4DFF" />
          </View>
          <View style={styles.serverMetric}>
            <Wifi size={18} color="#00E676" />
            <Text style={styles.serverMetricValue}>{latestPulse.activeConnections}</Text>
            <Text style={styles.serverMetricLabel}>Connections</Text>
            <MiniBar value={latestPulse.activeConnections} max={1000} color="#00E676" />
          </View>
          <View style={styles.serverMetric}>
            <Zap size={18} color={Colors.primary} />
            <Text style={styles.serverMetricValue}>{latestPulse.requestsPerSecond}</Text>
            <Text style={styles.serverMetricLabel}>Req/s</Text>
            <MiniBar value={latestPulse.requestsPerSecond} max={500} color={Colors.primary} />
          </View>
        </View>
      </View>

      <View style={styles.issuesSummaryCard}>
        <Text style={styles.issuesSummaryTitle}>Issue Summary</Text>
        <View style={styles.issuesSummaryRow}>
          <View style={[styles.issueBlock, { backgroundColor: '#FF174415' }]}>
            <Text style={[styles.issueBlockCount, { color: '#FF1744' }]}>{criticalCount}</Text>
            <Text style={styles.issueBlockLabel}>Critical</Text>
          </View>
          <View style={[styles.issueBlock, { backgroundColor: '#FFB30015' }]}>
            <Text style={[styles.issueBlockCount, { color: '#FFB300' }]}>{totalIssues - criticalCount}</Text>
            <Text style={styles.issueBlockLabel}>Warnings</Text>
          </View>
          <View style={[styles.issueBlock, { backgroundColor: '#00E67615' }]}>
            <Text style={[styles.issueBlockCount, { color: '#00E676' }]}>{DIAGNOSTIC_REPORTS[0]?.autoFixed ?? 0}</Text>
            <Text style={styles.issueBlockLabel}>Auto-Fixed</Text>
          </View>
          <View style={[styles.issueBlock, { backgroundColor: '#448AFF15' }]}>
            <Text style={[styles.issueBlockCount, { color: '#448AFF' }]}>{MODULE_HEALTH_DATA.length}</Text>
            <Text style={styles.issueBlockLabel}>Monitored</Text>
          </View>
        </View>
      </View>

      <View style={styles.worldStatsCard}>
        <View style={styles.worldStatsHeader}>
          <Globe size={18} color={Colors.primary} />
          <Text style={styles.worldStatsTitle}>Global Market Opportunity</Text>
        </View>
        <View style={styles.worldStatsGrid}>
          <View style={styles.worldStat}>
            <Text style={styles.worldStatValue}>{formatNumber(WORLD_STATS.totalSmartphones)}</Text>
            <Text style={styles.worldStatLabel}>Smartphones</Text>
          </View>
          <View style={styles.worldStat}>
            <Text style={styles.worldStatValue}>{formatNumber(WORLD_STATS.totalInternetUsers)}</Text>
            <Text style={styles.worldStatLabel}>Internet Users</Text>
          </View>
          <View style={styles.worldStat}>
            <Text style={styles.worldStatValue}>{formatNumber(WORLD_STATS.socialMediaUsers)}</Text>
            <Text style={styles.worldStatLabel}>Social Media</Text>
          </View>
          <View style={styles.worldStat}>
            <Text style={styles.worldStatValue}>{formatNumber(WORLD_STATS.instagramDailyActive)}</Text>
            <Text style={styles.worldStatLabel}>IG Daily</Text>
          </View>
          <View style={styles.worldStat}>
            <Text style={styles.worldStatValue}>{formatNumber(WORLD_STATS.tiktokDailyActive)}</Text>
            <Text style={styles.worldStatLabel}>TikTok Daily</Text>
          </View>
          <View style={styles.worldStat}>
            <Text style={styles.worldStatValue}>{formatNumber(WORLD_STATS.whatsappDailyActive)}</Text>
            <Text style={styles.worldStatLabel}>WhatsApp Daily</Text>
          </View>
        </View>
        <View style={styles.yourShareRow}>
          <Text style={styles.yourShareLabel}>Your Current Share:</Text>
          <Text style={styles.yourShareValue}>{formatNumber(totalCurrentUsers)} / {formatNumber(WORLD_STATS.totalSmartphones)}</Text>
          <Text style={styles.yourSharePercent}>({((totalCurrentUsers / WORLD_STATS.totalSmartphones) * 100).toFixed(6)}%)</Text>
        </View>
      </View>

      <View style={styles.scanningCard}>
        <View style={styles.scanningHeader}>
          <RefreshCw size={16} color={Colors.primary} />
          <Text style={styles.scanningText}>Scanning all {MODULE_HEALTH_DATA.length} modules continuously...</Text>
        </View>
        <View style={styles.scanBarContainer}>
          <Animated.View style={[styles.scanBar, { width: scanWidth as any }]} />
        </View>
        <Text style={styles.scanNote}>Last full scan: {lastScanTime.toLocaleTimeString()}</Text>
      </View>
    </View>
  );

  const renderModulesTab = () => (
    <View>
      <View style={styles.moduleFilterRow}>
        {(['all', 'issues', 'operational'] as const).map((filter) => (
          <TouchableOpacity
            key={filter}
            style={[styles.moduleFilterBtn, moduleFilter === filter && styles.moduleFilterBtnActive]}
            onPress={() => setModuleFilter(filter)}
          >
            <Text style={[styles.moduleFilterText, moduleFilter === filter && styles.moduleFilterTextActive]}>
              {filter === 'all' ? `All (${MODULE_HEALTH_DATA.length})` : filter === 'issues' ? `Issues (${MODULE_HEALTH_DATA.filter(m => m.criticalIssues > 0 || m.warnings > 0 || m.status !== 'operational').length})` : `OK (${MODULE_HEALTH_DATA.filter(m => m.status === 'operational').length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {filteredModules.map((module) => (
        <ModuleRow key={module.id} module={module} onPress={() => setSelectedModule(module)} />
      ))}

      {selectedModule && (
        <ModuleDetail module={selectedModule} onClose={() => setSelectedModule(null)} />
      )}
    </View>
  );

  const renderGrowthTab = () => (
    <View>
      <View style={styles.growthSummary}>
        <View style={styles.growthSummaryLeft}>
          <Text style={styles.growthSummaryLabel}>Current Users</Text>
          <Text style={styles.growthSummaryValue}>{formatNumber(totalCurrentUsers)}</Text>
        </View>
        <View style={styles.growthSummaryArrow}>
          <Rocket size={28} color={Colors.primary} />
        </View>
        <View style={styles.growthSummaryRight}>
          <Text style={styles.growthSummaryLabel}>Target</Text>
          <Text style={[styles.growthSummaryValue, { color: '#00E676' }]}>100M</Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>Growth Milestones</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.milestonesScroll}>
        {GROWTH_MILESTONES.map((milestone, _idx) => {
          const isReached = totalCurrentUsers >= milestone.target;
          return (
            <View key={milestone.label} style={[styles.milestoneCard, isReached && styles.milestoneCardReached]}>
              <View style={styles.milestoneHeader}>
                {isReached ? (
                  <CheckCircle size={20} color="#00E676" />
                ) : (
                  <Target size={20} color={Colors.primary} />
                )}
                <Text style={styles.milestoneTarget}>{milestone.label}</Text>
              </View>
              <Text style={styles.milestoneDate}>{milestone.estimatedDate}</Text>
              <Text style={styles.milestoneStrategy} numberOfLines={2}>{milestone.strategy}</Text>
              <View style={styles.milestoneConfidence}>
                <MiniBar value={milestone.confidence} max={100} color={milestone.confidence > 70 ? '#00E676' : milestone.confidence > 40 ? '#FFB300' : '#FF1744'} />
                <Text style={styles.milestoneConfText}>{milestone.confidence}% confidence</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <Text style={styles.sectionLabel}>Acquisition Channels ({GROWTH_CHANNELS.length})</Text>
      {GROWTH_CHANNELS.sort((a, b) => b.monthlyGrowthRate - a.monthlyGrowthRate).map((channel) => (
        <ChannelRow key={channel.id} channel={channel} />
      ))}

      <View style={styles.channelInsightCard}>
        <Flame size={20} color="#FF6D00" />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.channelInsightTitle}>Top Insight</Text>
          <Text style={styles.channelInsightText}>
            WhatsApp groups showing 88%/mo growth with $0.10 CPA — highest ROI channel at 3,400%. 
            Recommend 5x budget allocation to messaging-based acquisition.
          </Text>
        </View>
      </View>
    </View>
  );

  const renderReportsTab = () => (
    <View>
      <View style={styles.reportSummaryCard}>
        <Text style={styles.reportSummaryTitle}>24/7 Auto-Diagnostics</Text>
        <Text style={styles.reportSummarySubtitle}>
          System runs health checks every hour, generates reports, and auto-fixes when possible.
        </Text>
        <View style={styles.reportCycleRow}>
          <View style={styles.reportCycleItem}>
            <Clock size={16} color="#00BCD4" />
            <Text style={styles.reportCycleText}>Hourly Scans</Text>
          </View>
          <View style={styles.reportCycleItem}>
            <BarChart3 size={16} color="#7C4DFF" />
            <Text style={styles.reportCycleText}>Daily Reports</Text>
          </View>
          <View style={styles.reportCycleItem}>
            <Star size={16} color={Colors.primary} />
            <Text style={styles.reportCycleText}>Weekly Deep Audit</Text>
          </View>
        </View>
      </View>

      {DIAGNOSTIC_REPORTS.map((report) => {
        const isExpanded = expandedReport === report.id;
        return (
          <View key={report.id} style={styles.reportCard}>
            <TouchableOpacity
              style={styles.reportCardHeader}
              onPress={() => setExpandedReport(isExpanded ? null : report.id)}
            >
              <View style={styles.reportCardLeft}>
                <View style={[styles.reportScoreBadge, {
                  backgroundColor: report.overallScore >= 90 ? '#00E67620' : report.overallScore >= 70 ? '#FFB30020' : '#FF174420'}]}>
                  <Text style={[styles.reportScoreText, {
                    color: report.overallScore >= 90 ? '#00E676' : report.overallScore >= 70 ? '#FFB300' : '#FF1744'}]}>{report.overallScore}</Text>
                </View>
                <View>
                  <Text style={styles.reportCardTitle}>{report.type.charAt(0).toUpperCase() + report.type.slice(1)} Scan</Text>
                  <Text style={styles.reportCardTime}>{new Date(report.timestamp).toLocaleString()}</Text>
                </View>
              </View>
              <View style={styles.reportCardRight}>
                <View style={styles.reportBadgeRow}>
                  <View style={styles.reportIssueBadge}>
                    <Text style={styles.reportIssueBadgeText}>{report.issuesFound} issues</Text>
                  </View>
                  {report.autoFixed > 0 && (
                    <View style={[styles.reportIssueBadge, { backgroundColor: '#00E67620' }]}>
                      <Text style={[styles.reportIssueBadgeText, { color: '#00E676' }]}>{report.autoFixed} fixed</Text>
                    </View>
                  )}
                </View>
                {isExpanded ? <ChevronUp size={18} color={Colors.textTertiary} /> : <ChevronDown size={18} color={Colors.textTertiary} />}
              </View>
            </TouchableOpacity>

            {isExpanded && (
              <View style={styles.reportRecommendations}>
                <Text style={styles.reportRecTitle}>Recommendations</Text>
                {report.recommendations.map((rec) => (
                  <RecommendationItem key={rec.id} rec={rec} />
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <LiveDot />
          <Text style={styles.headerTitle}>24/7 Command Center</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={[styles.healthBadge, {
            backgroundColor: overallHealth >= 90 ? '#00E67620' : '#FFB30020'}]}>
            <Text style={[styles.healthBadgeText, {
              color: overallHealth >= 90 ? '#00E676' : '#FFB300'}]}>{overallHealth}%</Text>
          </View>
        </View>
      </View>

      <View style={styles.tabRow}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const TabIcon = tab.icon;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tabBtn, isActive && styles.tabBtnActive]}
              onPress={() => setActiveTab(tab.id)}
            >
              <TabIcon size={16} color={isActive ? Colors.primary : Colors.textTertiary} />
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {activeTab === 'pulse' && renderPulseTab()}
        {activeTab === 'modules' && renderModulesTab()}
        {activeTab === 'growth' && renderGrowthTab()}
        {activeTab === 'reports' && renderReportsTab()}
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function RecommendationItem({ rec }: { rec: DiagnosticRecommendation }) {
  return (
    <View style={styles.recItem}>
      <View style={styles.recHeader}>
        <View style={[styles.recSeverityDot, { backgroundColor: getSeverityColor(rec.severity) }]} />
        <Text style={styles.recModule}>{rec.module}</Text>
        <View style={[styles.recActionBadge, { backgroundColor: getActionColor(rec.action) + '25' }]}>
          <Text style={[styles.recActionText, { color: getActionColor(rec.action) }]}>{rec.action.toUpperCase()}</Text>
        </View>
        {rec.autoFixable && (
          <View style={styles.autoFixBadge}>
            <Zap size={10} color="#00E676" />
            <Text style={styles.autoFixText}>AUTO</Text>
          </View>
        )}
      </View>
      <Text style={styles.recTitle}>{rec.title}</Text>
      <Text style={styles.recDesc}>{rec.description}</Text>
      <Text style={styles.recImpact}>Impact: {rec.estimatedImpact}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050508'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1F'},
  backBtn: {
    padding: 6},
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8},
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: 0.3},
  headerRight: {
    alignItems: 'flex-end'},
  healthBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8},
  healthBadgeText: {
    fontSize: 13,
    fontWeight: '700'},
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00E676'},
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1F'},
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    gap: 5,
    backgroundColor: '#0D0D12'},
  tabBtnActive: {
    backgroundColor: Colors.primary + '18',
    borderWidth: 1,
    borderColor: Colors.primary + '30'},
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textTertiary},
  tabTextActive: {
    color: Colors.primary},
  scrollContent: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 14},

  pulseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D0D14',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1A1A22',
    marginBottom: 12},
  pulseScoreContainer: {
    marginRight: 20},
  pulseScoreRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0A0A10'},
  pulseScoreValue: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.text},
  pulseScoreLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 1.2},
  pulseStatsColumn: {
    flex: 1,
    gap: 8},
  pulseStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  pulseStatValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    minWidth: 24},
  pulseStatLabel: {
    fontSize: 12,
    color: Colors.textSecondary},

  liveServerCard: {
    backgroundColor: '#0D0D14',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1A1A22',
    marginBottom: 12},
  liveServerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14},
  liveServerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  liveServerTitleText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text},
  liveServerTime: {
    fontSize: 11,
    color: Colors.textTertiary},
  serverMetricsGrid: {
    flexDirection: 'row',
    gap: 10},
  serverMetric: {
    flex: 1,
    alignItems: 'center',
    gap: 4},
  serverMetricValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text},
  serverMetricLabel: {
    fontSize: 10,
    color: Colors.textTertiary},

  miniBarTrack: {
    width: '100%',
    height: 4,
    backgroundColor: '#1A1A22',
    borderRadius: 2,
    overflow: 'hidden'},
  miniBarFill: {
    height: '100%',
    borderRadius: 2},

  issuesSummaryCard: {
    backgroundColor: '#0D0D14',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1A1A22',
    marginBottom: 12},
  issuesSummaryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 12},
  issuesSummaryRow: {
    flexDirection: 'row',
    gap: 8},
  issueBlock: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center'},
  issueBlockCount: {
    fontSize: 22,
    fontWeight: '800'},
  issueBlockLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginTop: 4,
    fontWeight: '600'},

  worldStatsCard: {
    backgroundColor: '#0D0D14',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1A1A22',
    marginBottom: 12},
  worldStatsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14},
  worldStatsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text},
  worldStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8},
  worldStat: {
    width: '31%' as any,
    backgroundColor: '#12121A',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center'},
  worldStatValue: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primary},
  worldStatLabel: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 2},
  yourShareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    gap: 6,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1A1A22'},
  yourShareLabel: {
    fontSize: 12,
    color: Colors.textSecondary},
  yourShareValue: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text},
  yourSharePercent: {
    fontSize: 11,
    color: Colors.textTertiary},

  scanningCard: {
    backgroundColor: '#0D0D14',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
    marginBottom: 12},
  scanningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10},
  scanningText: {
    fontSize: 12,
    color: Colors.textSecondary},
  scanBarContainer: {
    height: 3,
    backgroundColor: '#1A1A22',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8},
  scanBar: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 2},
  scanNote: {
    fontSize: 10,
    color: Colors.textTertiary},

  moduleFilterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12},
  moduleFilterBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#0D0D12',
    borderWidth: 1,
    borderColor: '#1A1A22'},
  moduleFilterBtnActive: {
    backgroundColor: Colors.primary + '15',
    borderColor: Colors.primary + '40'},
  moduleFilterText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textTertiary},
  moduleFilterTextActive: {
    color: Colors.primary},

  moduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D0D14',
    borderRadius: 12,
    padding: 14,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#1A1A22'},
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12},
  moduleMainInfo: {
    flex: 1},
  moduleRowName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text},
  moduleRowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    gap: 4},
  moduleRowMetaText: {
    fontSize: 11,
    color: Colors.textTertiary},
  moduleRowDivider: {
    fontSize: 11,
    color: Colors.textTertiary},
  moduleRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  issueBadgeCritical: {
    backgroundColor: '#FF174430',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6},
  issueBadgeWarn: {
    backgroundColor: '#FFB30030',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6},
  issueBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.text},

  moduleDetailOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    paddingHorizontal: 14,
    zIndex: 100},
  moduleDetailCard: {
    backgroundColor: '#12121A',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2A2A35'},
  moduleDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18},
  statusDotLarge: {
    width: 14,
    height: 14,
    borderRadius: 7},
  moduleDetailName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text},
  moduleDetailStatus: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 1,
    marginTop: 2},
  moduleDetailClose: {
    padding: 4},
  moduleDetailGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16},
  moduleDetailStat: {
    flex: 1,
    backgroundColor: '#0A0A10',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center'},
  moduleDetailStatValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text},
  moduleDetailStatLabel: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 4},
  platformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16},
  platformLabel: {
    fontSize: 12,
    color: Colors.textSecondary},
  platformBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1A1A25',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6},
  platformBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.text},
  recommendationBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#FFB30010',
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#FFB300'},
  recommendationText: {
    flex: 1,
    fontSize: 13,
    color: '#FFB300',
    lineHeight: 18},

  growthSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D0D14',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1A1A22',
    marginBottom: 16},
  growthSummaryLeft: {
    flex: 1,
    alignItems: 'center'},
  growthSummaryRight: {
    flex: 1,
    alignItems: 'center'},
  growthSummaryArrow: {
    paddingHorizontal: 16},
  growthSummaryLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginBottom: 4},
  growthSummaryValue: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.text},

  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginBottom: 10,
    letterSpacing: 0.5},

  milestonesScroll: {
    marginBottom: 18},
  milestoneCard: {
    width: 180,
    backgroundColor: '#0D0D14',
    borderRadius: 14,
    padding: 14,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#1A1A22'},
  milestoneCardReached: {
    borderColor: '#00E67640',
    backgroundColor: '#00E67608'},
  milestoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8},
  milestoneTarget: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text},
  milestoneDate: {
    fontSize: 11,
    color: Colors.primary,
    marginBottom: 6,
    fontWeight: '600'},
  milestoneStrategy: {
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 15,
    marginBottom: 8},
  milestoneConfidence: {
    gap: 4},
  milestoneConfText: {
    fontSize: 10,
    color: Colors.textTertiary},

  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D0D14',
    borderRadius: 12,
    padding: 14,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#1A1A22'},
  channelLeft: {
    flex: 1},
  channelName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text},
  channelMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3},
  channelMetaText: {
    fontSize: 11,
    color: Colors.textTertiary},
  channelDivider: {
    fontSize: 11,
    color: Colors.textTertiary},
  channelRight: {
    alignItems: 'flex-end',
    gap: 2},
  channelGrowthBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3},
  channelGrowthText: {
    fontSize: 12,
    fontWeight: '700'},
  channelConversion: {
    fontSize: 10,
    color: Colors.textTertiary},
  channelROI: {
    fontSize: 10,
    color: Colors.primary,
    fontWeight: '600'},
  channelInsightCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FF6D0010',
    borderRadius: 14,
    padding: 16,
    marginTop: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#FF6D00'},
  channelInsightTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FF6D00',
    marginBottom: 4},
  channelInsightText: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17},

  reportSummaryCard: {
    backgroundColor: '#0D0D14',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1A1A22',
    marginBottom: 14},
  reportSummaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4},
  reportSummarySubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginBottom: 14},
  reportCycleRow: {
    flexDirection: 'row',
    gap: 10},
  reportCycleItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#12121A',
    borderRadius: 10,
    padding: 10},
  reportCycleText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600'},

  reportCard: {
    backgroundColor: '#0D0D14',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1A1A22',
    marginBottom: 8,
    overflow: 'hidden'},
  reportCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14},
  reportCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12},
  reportScoreBadge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center'},
  reportScoreText: {
    fontSize: 16,
    fontWeight: '800'},
  reportCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text},
  reportCardTime: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2},
  reportCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  reportBadgeRow: {
    flexDirection: 'row',
    gap: 4},
  reportIssueBadge: {
    backgroundColor: '#FF174420',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6},
  reportIssueBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FF1744'},

  reportRecommendations: {
    padding: 14,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: '#1A1A22'},
  reportRecTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 12,
    marginBottom: 10},

  recItem: {
    backgroundColor: '#0A0A10',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1A1A22'},
  recHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap'},
  recSeverityDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  recModule: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary},
  recActionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 5},
  recActionText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5},
  autoFixBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#00E67620',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5},
  autoFixText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#00E676'},
  recTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4},
  recDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginBottom: 6},
  recImpact: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '600'}});
