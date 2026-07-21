import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Share,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import {
  ArrowLeft,
  Rocket,
  Users,
  TrendingUp,
  Zap,
  Globe,
  Share2,
  Gift,
    Target,
  Flame,
  BarChart3,
  ArrowUpRight,
  Clock,
  Sparkles,
  Trophy,
  Star,
  Copy,
  Mail,
  MessageCircle,
  Search,
  Play,
  Briefcase,
} from 'lucide-react-native';
import IVXBrandIcon from '@/components/IVXBrandIcon';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import {
  growthMilestones,
  viralChannels,
  growthMetrics,
  referralTiers,
  projectionData,
  globalReachStats,
  competitorComparison,
} from '@/mocks/viral-growth';

const REFERRAL_CODE = 'IVXHOLDINGS-INVITE';

function PulsingDot({ color, size = 8 }: { color: string; size?: number }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  return (
    <Animated.View style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: color,
      opacity: pulse,
    }} />
  );
}

function GrowthHeader({ onBack }: { onBack: () => void }) {
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [glowAnim]);

  return (
    <View style={s.headerWrap}>
      <View style={s.headerTop}>
        <TouchableOpacity onPress={onBack} style={s.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Rocket size={18} color={Colors.primary} />
          <Text style={s.headerTitle}>Viral Growth Engine</Text>
        </View>
        <View style={s.headerLive}>
          <PulsingDot color={Colors.success} />
          <Text style={s.headerLiveText}>LIVE</Text>
        </View>
      </View>
      <Animated.View style={[s.headerGlow, { opacity: glowAnim }]} />
      <Text style={s.headerSub}>
        24/7 autonomous growth machine — turning every user into a channel
      </Text>
    </View>
  );
}

function MetricsGrid() {
  return (
    <View style={s.metricsGrid}>
      {growthMetrics.map((m, i) => (
        <View key={i} style={s.metricCard}>
          <Text style={s.metricLabel}>{m.label}</Text>
          <Text style={s.metricValue}>{m.value}</Text>
          <View style={s.metricChangeRow}>
            <ArrowUpRight size={10} color={Colors.success} />
            <Text style={s.metricChange}>+{m.change}%</Text>
            <Text style={s.metricPeriod}>{m.period}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function GrowthProjectionChart() {
  useWindowDimensions();
  const chartH = 140;
  const data = projectionData.total;
  const max = Math.max(...data);

  return (
    <View style={s.chartSection}>
      <View style={s.chartHeader}>
        <View style={s.chartHeaderLeft}>
          <BarChart3 size={16} color={Colors.primary} />
          <Text style={s.chartTitle}>Growth Projection</Text>
        </View>
        <View style={s.chartBadge}>
          <Flame size={10} color="#FF6B6B" />
          <Text style={s.chartBadgeText}>260K by Dec</Text>
        </View>
      </View>

      <View style={[s.chartArea, { height: chartH }]}>
        {data.map((val, i) => {
          const barH = (val / max) * (chartH - 20);
          const isLast = i === data.length - 1;
          return (
            <View key={i} style={s.chartBarWrap}>
              <View style={[
                s.chartBar,
                {
                  height: barH,
                  backgroundColor: isLast ? Colors.primary : Colors.primary + '60',
                  borderTopLeftRadius: 4,
                  borderTopRightRadius: 4,
                },
              ]} />
              <Text style={s.chartBarLabel}>{projectionData.months[i]}</Text>
            </View>
          );
        })}
      </View>

      <View style={s.chartLegend}>
        <View style={s.chartLegendItem}>
          <View style={[s.chartLegendDot, { backgroundColor: Colors.primary }]} />
          <Text style={s.chartLegendText}>Projected Total Users</Text>
        </View>
        <Text style={s.chartLegendNote}>K-factor: 1.47 (viral)</Text>
      </View>
    </View>
  );
}

function MilestoneTracker() {
  const reachedCount = growthMilestones.filter(m => m.reached).length;
  const progress = reachedCount / growthMilestones.length;

  return (
    <View style={s.milestoneSection}>
      <View style={s.milestoneHeader}>
        <Target size={16} color={Colors.primary} />
        <Text style={s.milestoneTitle}>Road to 100M Users</Text>
        <Text style={s.milestoneCount}>{reachedCount}/{growthMilestones.length}</Text>
      </View>

      <View style={s.progressBarBg}>
        <Animated.View style={[s.progressBarFill, { width: `${progress * 100}%` as any }]} />
      </View>

      <View style={s.milestoneList}>
        {growthMilestones.map((m, i) => (
          <View key={i} style={[s.milestoneItem, m.reached && s.milestoneReached]}>
            <View style={[s.milestoneDot, m.reached ? s.milestoneDotReached : s.milestoneDotPending]}>
              {m.reached ? (
                <Star size={10} color={Colors.background} fill={Colors.background} />
              ) : (
                <Text style={s.milestoneDotText}>{i + 1}</Text>
              )}
            </View>
            <View style={s.milestoneInfo}>
              <View style={s.milestoneNameRow}>
                <Text style={[s.milestoneName, m.reached && s.milestoneNameReached]}>
                  {m.users >= 1000000 ? `${m.users / 1000000}M` : m.users >= 1000 ? `${m.users / 1000}K` : m.users} — {m.label}
                </Text>
                {m.reached && <Text style={s.milestoneDate}>{m.reachedDate}</Text>}
              </View>
              <Text style={s.milestoneUnlock}>Unlocks: {m.unlocks}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function ViralChannelsList() {
  const totalUsers = viralChannels.reduce((sum, c) => sum + c.usersAcquired, 0);
  const channelIcons: Record<string, React.ReactNode> = {
    Users: <Users size={14} color="#FFD700" />,
    Instagram: <Sparkles size={14} color="#E1306C" />,
    Search: <Search size={14} color="#4285F4" />,
    Video: <Play size={14} color="#00F2EA" />,
    Play: <Play size={14} color="#FF0000" />,
    Twitter: <MessageCircle size={14} color="#1DA1F2" />,
    Briefcase: <Briefcase size={14} color="#0A66C2" />,
    Mail: <Mail size={14} color="#00C48C" />,
  };

  return (
    <View style={s.channelSection}>
      <View style={s.channelHeader}>
        <Globe size={16} color={Colors.primary} />
        <Text style={s.channelTitle}>Acquisition Channels</Text>
        <Text style={s.channelTotal}>{new Intl.NumberFormat('en-US').format(totalUsers)} users</Text>
      </View>

      {viralChannels.map((ch) => {
        const pct = (ch.usersAcquired / totalUsers) * 100;
        return (
          <View key={ch.id} style={s.channelRow}>
            <View style={[s.channelIcon, { backgroundColor: ch.color + '15' }]}>
              {channelIcons[ch.icon] ?? <Globe size={14} color={ch.color} />}
            </View>
            <View style={s.channelInfo}>
              <View style={s.channelNameRow}>
                <Text style={s.channelName}>{ch.name}</Text>
                <Text style={[s.channelTrend, { color: ch.trend === 'up' ? Colors.success : Colors.warning }]}>
                  {ch.trend === 'up' ? '↑' : '→'} {ch.trendPercent}%
                </Text>
              </View>
              <View style={s.channelBarBg}>
                <View style={[s.channelBarFill, { width: `${pct}%` as any, backgroundColor: ch.color }]} />
              </View>
              <View style={s.channelStats}>
                <Text style={s.channelStat}>{new Intl.NumberFormat('en-US').format(ch.usersAcquired)} users</Text>
                <Text style={s.channelStat}>{ch.conversionRate}% conv.</Text>
                <Text style={s.channelStat}>${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ch.costPerAcquisition)} CPA</Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ReferralRewardEngine({ onShare }: { onShare: () => void }) {
  const [selectedTier, setSelectedTier] = useState(0);
  const tier = referralTiers[selectedTier];

  return (
    <View style={s.referralSection}>
      <View style={s.referralHeader}>
        <Gift size={16} color={Colors.primary} />
        <Text style={s.referralTitle}>$25 Share Reward Program</Text>
      </View>

      <View style={s.referralHero}>
        <Text style={s.referralHeroValue}>$25</Text>
        <Text style={s.referralHeroLabel}>in IPX shares for every friend who joins</Text>
        <Text style={s.referralHeroSub}>Both you AND your friend get $25 — zero cost, zero catch</Text>
      </View>

      <View style={s.tierTabs}>
        {referralTiers.map((t, i) => (
          <TouchableOpacity
            key={i}
            style={[s.tierTab, selectedTier === i && { borderColor: t.color, borderWidth: 2 }]}
            onPress={() => {
              setSelectedTier(i);
              if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
          >
            <IVXBrandIcon size={12} />
            <Text style={[s.tierTabText, selectedTier === i && { color: t.color }]}>{t.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={[s.tierDetail, { borderColor: tier.color + '40' }]}>
        <View style={s.tierDetailHeader}>
          <Text style={[s.tierDetailName, { color: tier.color }]}>{tier.name} Tier</Text>
          <Text style={s.tierDetailReq}>
            {tier.minReferrals === 0 ? 'Start here' : `${tier.minReferrals}+ referrals`}
          </Text>
        </View>
        <View style={s.tierRewards}>
          <View style={s.tierRewardItem}>
            <Text style={s.tierRewardValue}>${tier.shareReward}</Text>
            <Text style={s.tierRewardLabel}>Shares/Referral</Text>
          </View>
          {tier.cashBonus > 0 && (
            <View style={s.tierRewardItem}>
              <Text style={s.tierRewardValue}>${tier.cashBonus}</Text>
              <Text style={s.tierRewardLabel}>Cash Bonus</Text>
            </View>
          )}
        </View>
        {tier.perks.map((perk, i) => (
          <View key={i} style={s.tierPerkRow}>
            <Zap size={10} color={tier.color} />
            <Text style={s.tierPerkText}>{perk}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity style={s.shareBtn} onPress={onShare} activeOpacity={0.8}>
        <Share2 size={18} color={Colors.background} />
        <Text style={s.shareBtnText}>Share & Earn $25</Text>
      </TouchableOpacity>
    </View>
  );
}

function CompetitorRace() {
  const maxUsers = 2000000;

  return (
    <View style={s.raceSection}>
      <View style={s.raceHeader}>
        <Trophy size={16} color={Colors.primary} />
        <Text style={s.raceTitle}>Disruption Tracker</Text>
      </View>
      <Text style={s.raceSub}>
        Growing 340% YoY with $0 in funding — crushing VC-backed competitors
      </Text>

      {competitorComparison.map((c, i) => {
        const pct = Math.min((parseInt(c.users.replace(/[^0-9]/g, '')) * (c.users.includes('M') ? 1000 : 1) / maxUsers) * 100, 100);
        const isUs = i === 0;
        return (
          <View key={i} style={[s.raceRow, isUs && s.raceRowHighlight]}>
            <View style={s.raceInfo}>
              <Text style={[s.raceName, isUs && { color: Colors.primary, fontWeight: '800' as const }]}>
                {isUs ? '🚀 ' : ''}{c.name}
              </Text>
              <Text style={s.raceUsers}>{c.users} users</Text>
            </View>
            <View style={s.raceBarBg}>
              <View style={[s.raceBarFill, { width: `${Math.max(pct, 2)}%` as any, backgroundColor: c.color }]} />
            </View>
            <View style={s.raceStats}>
              <Text style={[s.raceGrowth, { color: isUs ? Colors.success : Colors.textTertiary }]}>{c.growth}</Text>
              <Text style={s.raceFunding}>{c.fundingRaised}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function GlobalReach() {
  const stats = globalReachStats;

  const items = [
    { icon: <Globe size={14} color={Colors.primary} />, label: 'Countries', value: stats.countries.toString() },
    { icon: <MessageCircle size={14} color="#4ECDC4" />, label: 'Languages', value: stats.languages.toString() },
    { icon: <Clock size={14} color="#FF6B6B" />, label: 'Timezones', value: stats.timeZones },
    { icon: <Users size={14} color="#9B59B6" />, label: 'Peak Users', value: stats.peakConcurrentUsers },
    { icon: <Zap size={14} color={Colors.warning} />, label: 'Daily Txns', value: stats.dailyTransactions },
    { icon: <TrendingUp size={14} color={Colors.success} />, label: 'Avg Session', value: stats.avgSessionTime },
  ];

  return (
    <View style={s.globalSection}>
      <View style={s.globalHeader}>
        <Globe size={16} color={Colors.primary} />
        <Text style={s.globalTitle}>24/7 Global Reach</Text>
        <View style={s.globalLiveBadge}>
          <PulsingDot color={Colors.success} size={6} />
          <Text style={s.globalLiveText}>OPERATING</Text>
        </View>
      </View>
      <Text style={s.globalSub}>
        While you sleep, the engine works across {stats.countries} countries
      </Text>
      <View style={s.globalGrid}>
        {items.map((item, i) => (
          <View key={i} style={s.globalItem}>
            {item.icon}
            <Text style={s.globalItemValue}>{item.value}</Text>
            <Text style={s.globalItemLabel}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ReferralCodeCard({ onCopy, onShare }: { onCopy: () => void; onShare: () => void }) {
  return (
    <View style={s.codeCard}>
      <Text style={s.codeLabel}>Your Referral Code</Text>
      <View style={s.codeRow}>
        <Text style={s.codeText}>{REFERRAL_CODE}</Text>
        <TouchableOpacity style={s.codeCopyBtn} onPress={onCopy}>
          <Copy size={16} color={Colors.primary} />
        </TouchableOpacity>
      </View>
      <View style={s.codeActions}>
        <TouchableOpacity style={s.codeActionBtn} onPress={onShare}>
          <Mail size={14} color={Colors.text} />
          <Text style={s.codeActionText}>Email</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.codeActionBtn} onPress={onShare}>
          <MessageCircle size={14} color={Colors.text} />
          <Text style={s.codeActionText}>SMS</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.codeActionBtn} onPress={onShare}>
          <Share2 size={14} color={Colors.text} />
          <Text style={s.codeActionText}>Share</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ViralGrowthScreen() {
  const router = useRouter();

  const handleCopyCode = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(REFERRAL_CODE);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      console.log('[ViralGrowth] Referral code copied');
    } catch (e) {
      console.log('[ViralGrowth] Copy failed:', e);
    }
  }, []);

  const handleShare = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await Share.share({
        title: 'Join IVX Holdings — Get $25 Free',
        message: `I'm investing in tokenized real estate on IVX Holdings and earning 14.5% annually. Join with my code ${REFERRAL_CODE} and get $25 in free shares!\n\nhttps://ivxholding.com/invite/${REFERRAL_CODE}`,
      });
      console.log('[ViralGrowth] Share dialog opened');
    } catch (e) {
      console.log('[ViralGrowth] Share failed:', e);
    }
  }, []);

  return (
    <View style={s.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={s.safe}>
        <GrowthHeader onBack={() => router.back()} />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
          <View style={s.liveBar}>
            <PulsingDot color={Colors.success} />
            <Text style={s.liveBarText}>Engine active — analyzing 47 channels across 94 countries</Text>
          </View>

          <MetricsGrid />
          <ReferralCodeCard onCopy={handleCopyCode} onShare={handleShare} />
          <GrowthProjectionChart />
          <ReferralRewardEngine onShare={handleShare} />
          <MilestoneTracker />
          <ViralChannelsList />
          <CompetitorRace />
          <GlobalReach />

          <View style={s.ctaSection}>
            <TouchableOpacity style={s.ctaPrimary} onPress={handleShare} activeOpacity={0.8}>
              <Rocket size={20} color={Colors.background} />
              <Text style={s.ctaPrimaryText}>Invite Friends & Earn $25</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.ctaSecondary}
              onPress={() => router.push('/referrals' as any)}
              activeOpacity={0.8}
            >
              <Text style={s.ctaSecondaryText}>View My Referrals →</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safe: { flex: 1 },
  scrollContent: { paddingBottom: 40 },

  headerWrap: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    overflow: 'hidden',
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  backBtn: { padding: 4 },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  headerTitle: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  headerLive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.success + '15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  headerLiveText: { color: Colors.success, fontSize: 9, fontWeight: '800' as const, letterSpacing: 1 },
  headerGlow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: Colors.primary,
  },
  headerSub: { color: Colors.textTertiary, fontSize: 11, lineHeight: 16 },

  liveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.success + '30',
  },
  liveBarText: { color: Colors.textSecondary, fontSize: 11, flex: 1 },

  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  metricCard: {
    width: '31%' as any,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  metricLabel: { color: Colors.textTertiary, fontSize: 9, fontWeight: '600' as const, marginBottom: 4 },
  metricValue: { color: Colors.text, fontSize: 16, fontWeight: '800' as const, marginBottom: 2 },
  metricChangeRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  metricChange: { color: Colors.success, fontSize: 9, fontWeight: '700' as const },
  metricPeriod: { color: Colors.textTertiary, fontSize: 8 },

  codeCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: Colors.primary + '10',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  codeLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' as const, marginBottom: 8 },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  codeText: { color: Colors.primary, fontSize: 18, fontWeight: '800' as const, letterSpacing: 2 },
  codeCopyBtn: { padding: 6 },
  codeActions: { flexDirection: 'row', gap: 10 },
  codeActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingVertical: 10,
  },
  codeActionText: { color: Colors.text, fontSize: 12, fontWeight: '600' as const },

  chartSection: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  chartHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chartTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  chartBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FF6B6B15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  chartBadgeText: { color: '#FF6B6B', fontSize: 10, fontWeight: '700' as const },
  chartArea: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  chartBarWrap: { flex: 1, alignItems: 'center' },
  chartBar: { width: '80%' as any, minHeight: 4 },
  chartBarLabel: { color: Colors.textTertiary, fontSize: 8, marginTop: 4 },
  chartLegend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
  },
  chartLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chartLegendDot: { width: 8, height: 8, borderRadius: 4 },
  chartLegendText: { color: Colors.textSecondary, fontSize: 10 },
  chartLegendNote: { color: Colors.success, fontSize: 10, fontWeight: '700' as const },

  referralSection: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  referralHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  referralTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  referralHero: { alignItems: 'center', marginBottom: 16 },
  referralHeroValue: { color: Colors.primary, fontSize: 48, fontWeight: '900' as const },
  referralHeroLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginTop: 2 },
  referralHeroSub: { color: Colors.textTertiary, fontSize: 11, marginTop: 4, textAlign: 'center' as const },

  tierTabs: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  tierTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tierTabText: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700' as const },

  tierDetail: {
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    backgroundColor: Colors.backgroundSecondary,
    marginBottom: 12,
  },
  tierDetailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  tierDetailName: { fontSize: 14, fontWeight: '800' as const },
  tierDetailReq: { color: Colors.textTertiary, fontSize: 10 },
  tierRewards: { flexDirection: 'row', gap: 16, marginBottom: 10 },
  tierRewardItem: { alignItems: 'center' },
  tierRewardValue: { color: Colors.primary, fontSize: 22, fontWeight: '900' as const },
  tierRewardLabel: { color: Colors.textTertiary, fontSize: 9, marginTop: 2 },
  tierPerkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  tierPerkText: { color: Colors.textSecondary, fontSize: 11 },

  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
  },
  shareBtnText: { color: Colors.background, fontSize: 15, fontWeight: '800' as const },

  milestoneSection: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  milestoneHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  milestoneTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const, flex: 1 },
  milestoneCount: { color: Colors.primary, fontSize: 12, fontWeight: '700' as const },

  progressBarBg: {
    height: 6,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 3,
    marginBottom: 14,
    overflow: 'hidden',
  },
  progressBarFill: { height: 6, backgroundColor: Colors.primary, borderRadius: 3 },

  milestoneList: { gap: 6 },
  milestoneItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  milestoneReached: { backgroundColor: Colors.primary + '08' },
  milestoneDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  milestoneDotReached: { backgroundColor: Colors.primary },
  milestoneDotPending: { backgroundColor: Colors.backgroundSecondary, borderWidth: 1, borderColor: Colors.surfaceBorder },
  milestoneDotText: { color: Colors.textTertiary, fontSize: 9, fontWeight: '700' as const },
  milestoneInfo: { flex: 1 },
  milestoneNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  milestoneName: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' as const },
  milestoneNameReached: { color: Colors.text },
  milestoneDate: { color: Colors.textTertiary, fontSize: 9 },
  milestoneUnlock: { color: Colors.textTertiary, fontSize: 10, marginTop: 1 },

  channelSection: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  channelHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  channelTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const, flex: 1 },
  channelTotal: { color: Colors.primary, fontSize: 11, fontWeight: '700' as const },

  channelRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  channelIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelInfo: { flex: 1 },
  channelNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  channelName: { color: Colors.text, fontSize: 12, fontWeight: '600' as const },
  channelTrend: { fontSize: 10, fontWeight: '700' as const },
  channelBarBg: { height: 4, backgroundColor: Colors.backgroundSecondary, borderRadius: 2, marginBottom: 4 },
  channelBarFill: { height: 4, borderRadius: 2 },
  channelStats: { flexDirection: 'row', gap: 12 },
  channelStat: { color: Colors.textTertiary, fontSize: 9 },

  raceSection: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  raceHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  raceTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  raceSub: { color: Colors.textTertiary, fontSize: 11, marginBottom: 12, lineHeight: 16 },

  raceRow: { marginBottom: 10, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8 },
  raceRowHighlight: { backgroundColor: Colors.primary + '08' },
  raceInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  raceName: { color: Colors.text, fontSize: 12, fontWeight: '600' as const },
  raceUsers: { color: Colors.textTertiary, fontSize: 10 },
  raceBarBg: { height: 6, backgroundColor: Colors.backgroundSecondary, borderRadius: 3, marginBottom: 4, overflow: 'hidden' },
  raceBarFill: { height: 6, borderRadius: 3 },
  raceStats: { flexDirection: 'row', justifyContent: 'space-between' },
  raceGrowth: { fontSize: 10, fontWeight: '700' as const },
  raceFunding: { color: Colors.textTertiary, fontSize: 9 },

  globalSection: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  globalHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  globalTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const, flex: 1 },
  globalLiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.success + '15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  globalLiveText: { color: Colors.success, fontSize: 8, fontWeight: '800' as const, letterSpacing: 0.5 },
  globalSub: { color: Colors.textTertiary, fontSize: 11, marginBottom: 12 },
  globalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  globalItem: {
    width: '31%' as any,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    gap: 4,
  },
  globalItemValue: { color: Colors.text, fontSize: 14, fontWeight: '800' as const },
  globalItemLabel: { color: Colors.textTertiary, fontSize: 9 },

  ctaSection: { marginHorizontal: 20, marginTop: 8, gap: 10 },
  ctaPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
  },
  ctaPrimaryText: { color: Colors.background, fontSize: 16, fontWeight: '800' as const },
  ctaSecondary: { alignItems: 'center', paddingVertical: 10 },
  ctaSecondaryText: { color: Colors.primary, fontSize: 13, fontWeight: '700' as const },
});
