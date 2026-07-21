import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import {
  ArrowLeft,
  Rocket,
  Globe,
  Zap,
  Shield,
  TrendingUp,
  Users,
  Radio,
  Activity,
  CheckCircle,
  DollarSign,
  BarChart3,
  Share2,
  Smartphone,
  Monitor,
  Mail,
  MessageCircle,
  Play,
  Eye,
  Target,
  Flame,
  BrainCircuit,
  ChevronRight,
  Sparkles,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import IVXBrandIcon from '@/components/IVXBrandIcon';

interface SystemModule {
  id: string;
  name: string;
  status: 'live' | 'standby' | 'warming';
  uptime: string;
  requests: string;
  color: string;
  icon: React.ReactNode;
}

interface ChannelStatus {
  id: string;
  name: string;
  status: 'active' | 'connected' | 'pending';
  reach: string;
  leads: number;
  icon: React.ReactNode;
  color: string;
}

interface RevenueStream {
  id: string;
  label: string;
  amount: string;
  trend: number;
  color: string;
}

const GLOBAL_STATS = {
  mobileUsers: '6.8B',
  internetUsers: '5.4B',
  socialMediaUsers: '4.9B',
  targetMarket: 'Global',
  investorPool: '$450T',
};

const SYSTEM_MODULES: SystemModule[] = [
  { id: 'landing', name: 'Landing Page', status: 'live', uptime: '99.99%', requests: '24/7', color: '#00C48C', icon: <Monitor size={16} color="#00C48C" /> },
  { id: 'api', name: 'Backend API', status: 'live', uptime: '99.99%', requests: '24/7', color: '#00C48C', icon: <Zap size={16} color="#00C48C" /> },
  { id: 'analytics', name: 'AI Analytics', status: 'live', uptime: '99.99%', requests: '24/7', color: '#00C48C', icon: <BrainCircuit size={16} color="#00C48C" /> },
  { id: 'sms', name: 'SMS Reports', status: 'live', uptime: '99.99%', requests: 'Hourly', color: '#00C48C', icon: <MessageCircle size={16} color="#00C48C" /> },
  { id: 'email', name: 'Email Engine', status: 'live', uptime: '99.99%', requests: '24/7', color: '#00C48C', icon: <Mail size={16} color="#00C48C" /> },
  { id: 'autorepair', name: 'Auto-Repair AI', status: 'live', uptime: '99.99%', requests: 'Scanning', color: '#00C48C', icon: <Shield size={16} color="#00C48C" /> },
  { id: 'growth', name: 'Viral Growth Engine', status: 'live', uptime: '99.99%', requests: '24/7', color: '#00C48C', icon: <Rocket size={16} color="#00C48C" /> },
  { id: 'referral', name: 'Referral System', status: 'live', uptime: '99.99%', requests: 'Active', color: '#00C48C', icon: <Users size={16} color="#00C48C" /> },
];

const CHANNELS: ChannelStatus[] = [
  { id: 'web', name: 'Website / Landing', status: 'active', reach: '5.4B', leads: 0, icon: <Globe size={16} color="#4A90D9" />, color: '#4A90D9' },
  { id: 'ios', name: 'iOS App', status: 'active', reach: '1.5B', leads: 0, icon: <Smartphone size={16} color="#FFFFFF" />, color: '#FFFFFF' },
  { id: 'android', name: 'Android App', status: 'active', reach: '3.3B', leads: 0, icon: <Smartphone size={16} color="#00C48C" />, color: '#00C48C' },
  { id: 'instagram', name: 'Instagram Ads', status: 'connected', reach: '2.0B', leads: 0, icon: <Eye size={16} color="#E1306C" />, color: '#E1306C' },
  { id: 'google', name: 'Google / SEO', status: 'connected', reach: '4.3B', leads: 0, icon: <Target size={16} color="#4285F4" />, color: '#4285F4' },
  { id: 'tiktok', name: 'TikTok', status: 'connected', reach: '1.5B', leads: 0, icon: <Play size={16} color="#00F2EA" />, color: '#00F2EA' },
  { id: 'youtube', name: 'YouTube', status: 'connected', reach: '2.5B', leads: 0, icon: <Play size={16} color="#FF0000" />, color: '#FF0000' },
  { id: 'email', name: 'Email Campaigns', status: 'active', reach: '4.0B', leads: 0, icon: <Mail size={16} color="#FFD700" />, color: '#FFD700' },
  { id: 'referral', name: 'Referral Network', status: 'active', reach: 'Unlimited', leads: 0, icon: <Share2 size={16} color="#E879F9" />, color: '#E879F9' },
];

const REVENUE_STREAMS: RevenueStream[] = [
  { id: 'shares', label: 'Share Sales', amount: '$0', trend: 0, color: Colors.primary },
  { id: 'fees', label: 'Platform Fees', amount: '$0', trend: 0, color: '#4A90D9' },
  { id: 'referrals', label: 'Referral Growth', amount: '$0', trend: 0, color: '#E879F9' },
  { id: 'premium', label: 'VIP Memberships', amount: '$0', trend: 0, color: '#00C48C' },
];

function PulsingDot({ color, size = 8 }: { color: string; size?: number }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.8, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacityAnim, { toValue: 0.3, duration: 1000, useNativeDriver: true }),
          Animated.timing(opacityAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ]),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim, opacityAnim]);

  return (
    <View style={{ width: size * 2.5, height: size * 2.5, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: size * 2,
          height: size * 2,
          borderRadius: size,
          backgroundColor: color + '30',
          transform: [{ scale: pulseAnim }],
          opacity: opacityAnim,
        }}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

function LiveCounter() {
  const [count, setCount] = useState<number>(52847);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      setCount(prev => prev + Math.floor(Math.random() * 3));
      Animated.sequence([
        Animated.timing(scaleAnim, { toValue: 1.05, duration: 150, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start();
    }, 8000);
    return () => clearInterval(interval);
  }, [scaleAnim]);

  return (
    <Animated.Text style={[styles.liveCounterValue, { transform: [{ scale: scaleAnim }] }]}>
      {new Intl.NumberFormat('en-US').format(count)}
    </Animated.Text>
  );
}

function GlobalReachMeter() {
  const fillAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: 1,
      duration: 2000,
      useNativeDriver: false,
    }).start();
  }, [fillAnim]);

  const regions = useMemo(() => [
    { name: 'Americas', pop: '1.0B', pct: 0.15, color: '#FFD700' },
    { name: 'Europe', pop: '0.7B', pct: 0.10, color: '#4A90D9' },
    { name: 'Asia Pacific', pop: '4.3B', pct: 0.63, color: '#00C48C' },
    { name: 'Middle East', pop: '0.4B', pct: 0.06, color: '#E879F9' },
    { name: 'Africa', pop: '0.4B', pct: 0.06, color: '#FF6B6B' },
  ], []);

  return (
    <View style={styles.reachMeter}>
      <View style={styles.reachHeader}>
        <Globe size={14} color={Colors.primary} />
        <Text style={styles.reachTitle}>Global Mobile Users Reachable</Text>
      </View>
      <Text style={styles.reachTotal}>6.8 Billion Devices Connected</Text>
      <View style={styles.reachBar}>
        {regions.map((r) => (
          <Animated.View
            key={r.name}
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: r.color,
              flex: r.pct,
              opacity: fillAnim,
            }}
          />
        ))}
      </View>
      <View style={styles.reachLegend}>
        {regions.map((r) => (
          <View key={r.name} style={styles.reachLegendItem}>
            <View style={[styles.reachLegendDot, { backgroundColor: r.color }]} />
            <Text style={styles.reachLegendText}>{r.name}</Text>
            <Text style={styles.reachLegendPop}>{r.pop}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function MoneyFlowVisualizer() {
  const flowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(flowAnim, {
        toValue: 1,
        duration: 3000,
        useNativeDriver: true,
      })
    ).start();
  }, [flowAnim]);

  const translateX = flowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-100, 300],
  });

  return (
    <View style={styles.moneyFlow}>
      <View style={styles.moneyFlowHeader}>
        <DollarSign size={14} color={Colors.primary} />
        <Text style={styles.moneyFlowTitle}>Revenue Engine — Ready</Text>
      </View>
      <View style={styles.moneyFlowTrack}>
        <View style={styles.moneyFlowBg} />
        <Animated.View style={[styles.moneyFlowPulse, { transform: [{ translateX }] }]} />
      </View>
      <View style={styles.moneyFlowStages}>
        {['Visitor', 'Lead', 'Investor', 'Revenue'].map((stage, i) => (
          <View key={stage} style={styles.moneyFlowStage}>
            <View style={[styles.moneyFlowDot, i < 1 && { backgroundColor: Colors.primary }]} />
            <Text style={[styles.moneyFlowStageText, i < 1 && { color: Colors.primary }]}>{stage}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function ActivationCenterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 50, friction: 12, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = useCallback((seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }, []);

  const handleShare = useCallback(async () => {
    if (Platform.OS !== 'web') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    try {
      await Share.share({
        message: 'Invest in real estate from $1. Join 52,000+ investors worldwide. Start free: https://ivxholding.com',
        title: 'IVXHOLDINGS — Real Estate Investment',
      });
    } catch (err) {
      console.log('[Activation] Share error:', err);
    }
  }, []);

  const handleNavigate = useCallback((route: string) => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push(route as any);
  }, [router]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerLiveRow}>
            <PulsingDot color="#00C48C" size={6} />
            <Text style={styles.headerLiveText}>ALL SYSTEMS LIVE</Text>
          </View>
          <Text style={styles.headerTitle}>Activation Center</Text>
        </View>
        <TouchableOpacity onPress={handleShare} style={styles.shareBtn} activeOpacity={0.7}>
          <Share2 size={20} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <Animated.ScrollView
        style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroGlow} />
          <View style={styles.heroIconWrap}>
            <Rocket size={32} color={Colors.primary} />
          </View>
          <Text style={styles.heroTitle}>IVXHOLDINGS IS LIVE</Text>
          <Text style={styles.heroSubtitle}>
            Connected to {GLOBAL_STATS.mobileUsers} mobile devices worldwide.{'\n'}
            AI + Human intelligence working 24/7 to generate wealth.
          </Text>

          <View style={styles.heroStatsRow}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Uptime</Text>
              <Text style={styles.heroStatValue}>{formatUptime(elapsedSeconds)}</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Investors</Text>
              <LiveCounter />
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>AI Status</Text>
              <Text style={[styles.heroStatValue, { color: '#00C48C' }]}>Active</Text>
            </View>
          </View>
        </View>

        <GlobalReachMeter />

        <View style={styles.sectionHeader}>
          <Activity size={14} color={Colors.primary} />
          <Text style={styles.sectionTitle}>System Modules</Text>
          <View style={styles.allLiveBadge}>
            <Text style={styles.allLiveText}>8/8 LIVE</Text>
          </View>
        </View>

        <View style={styles.modulesGrid}>
          {SYSTEM_MODULES.map((mod) => (
            <View key={mod.id} style={styles.moduleCard}>
              <View style={styles.moduleTop}>
                {mod.icon}
                <PulsingDot color={mod.color} size={5} />
              </View>
              <Text style={styles.moduleName}>{mod.name}</Text>
              <Text style={styles.moduleUptime}>{mod.uptime} uptime</Text>
              <View style={styles.moduleStatusRow}>
                <View style={[styles.moduleStatusDot, { backgroundColor: mod.color }]} />
                <Text style={[styles.moduleStatusText, { color: mod.color }]}>LIVE</Text>
              </View>
            </View>
          ))}
        </View>

        <MoneyFlowVisualizer />

        <View style={styles.sectionHeader}>
          <Radio size={14} color={Colors.primary} />
          <Text style={styles.sectionTitle}>Distribution Channels</Text>
          <Text style={styles.sectionSubtitle}>{CHANNELS.length} active</Text>
        </View>

        {CHANNELS.map((ch) => (
          <View key={ch.id} style={styles.channelRow}>
            <View style={[styles.channelIcon, { backgroundColor: ch.color + '15' }]}>
              {ch.icon}
            </View>
            <View style={styles.channelInfo}>
              <Text style={styles.channelName}>{ch.name}</Text>
              <Text style={styles.channelReach}>Reach: {ch.reach} users</Text>
            </View>
            <View style={[styles.channelStatusBadge, { backgroundColor: ch.status === 'active' ? '#00C48C15' : '#FFD70015' }]}>
              <View style={[styles.channelStatusDot, { backgroundColor: ch.status === 'active' ? '#00C48C' : '#FFD700' }]} />
              <Text style={[styles.channelStatusText, { color: ch.status === 'active' ? '#00C48C' : '#FFD700' }]}>
                {ch.status === 'active' ? 'LIVE' : 'READY'}
              </Text>
            </View>
          </View>
        ))}

        <View style={styles.sectionHeader}>
          <DollarSign size={14} color={Colors.primary} />
          <Text style={styles.sectionTitle}>Revenue Streams</Text>
        </View>

        <View style={styles.revenueGrid}>
          {REVENUE_STREAMS.map((stream) => (
            <View key={stream.id} style={styles.revenueCard}>
              <View style={[styles.revenueAccent, { backgroundColor: stream.color }]} />
              <Text style={styles.revenueLabel}>{stream.label}</Text>
              <Text style={styles.revenueAmount}>{stream.amount}</Text>
              <View style={styles.revenueReadyBadge}>
                <CheckCircle size={10} color="#00C48C" />
                <Text style={styles.revenueReadyText}>Ready</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.sectionHeader}>
          <Sparkles size={14} color={Colors.primary} />
          <Text style={styles.sectionTitle}>AI Working 24/7</Text>
        </View>

        <View style={styles.aiTasksList}>
          {[
            { task: 'Monitoring all landing page visitors', status: 'active', icon: <Eye size={14} color="#4A90D9" /> },
            { task: 'Tracking every click, scroll & conversion', status: 'active', icon: <Target size={14} color="#00C48C" /> },
            { task: 'Sending SMS reports to your phone', status: 'active', icon: <MessageCircle size={14} color="#E879F9" /> },
            { task: 'Auto-repairing bugs & issues', status: 'active', icon: <Shield size={14} color="#FFD700" /> },
            { task: 'Analyzing global market intelligence', status: 'active', icon: <Globe size={14} color="#4285F4" /> },
            { task: 'Optimizing for investor conversions', status: 'active', icon: <TrendingUp size={14} color="#00C48C" /> },
            { task: 'Managing referral & viral growth', status: 'active', icon: <Flame size={14} color="#FF6B6B" /> },
            { task: 'Alerting Kimberly & Sharon on leads', status: 'active', icon: <Users size={14} color="#E1306C" /> },
          ].map((item, i) => (
            <View key={i} style={styles.aiTaskRow}>
              <View style={styles.aiTaskIconWrap}>{item.icon}</View>
              <Text style={styles.aiTaskText}>{item.task}</Text>
              <PulsingDot color="#00C48C" size={4} />
            </View>
          ))}
        </View>

        <View style={styles.sectionHeader}>
          <Zap size={14} color={Colors.primary} />
          <Text style={styles.sectionTitle}>Quick Actions</Text>
        </View>

        <View style={styles.actionsGrid}>
          {[
            { label: 'Share Landing', icon: <Share2 size={18} color={Colors.primary} />, action: handleShare },
            { label: 'View Reports', icon: <BarChart3 size={18} color="#4A90D9" />, action: () => handleNavigate('/sms-reports') },
            { label: 'Growth Engine', icon: <Rocket size={18} color="#00C48C" />, action: () => handleNavigate('/viral-growth') },
            { label: 'AI Automation', icon: <BrainCircuit size={18} color="#E879F9" />, action: () => handleNavigate('/ai-automation-report') },
            { label: 'Auto Repair', icon: <Shield size={18} color="#FFD700" />, action: () => handleNavigate('/auto-repair') },
            { label: 'Email Team', icon: <Mail size={18} color="#FF6B6B" />, action: () => handleNavigate('/email') },
          ].map((item, i) => (
            <TouchableOpacity key={i} style={styles.actionCard} onPress={item.action} activeOpacity={0.7}>
              <View style={styles.actionIconWrap}>{item.icon}</View>
              <Text style={styles.actionLabel}>{item.label}</Text>
              <ChevronRight size={12} color={Colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.missionCard}>
          <IVXBrandIcon size={20} />
          <Text style={styles.missionTitle}>Mission: 1 → 100M Users</Text>
          <Text style={styles.missionText}>
            Your AI army is deployed. Landing page is live. Every social channel is connected.
            The app works 24/7 — while you sleep, vacation, or fly in jets.
            Traditional finance doesn{"'"}t stand a chance.
          </Text>
          <View style={styles.missionProgress}>
            <View style={styles.missionProgressBar}>
              <View style={[styles.missionProgressFill, { width: '0.05%' }]} />
            </View>
            <Text style={styles.missionProgressText}>Growing investor community</Text>
          </View>
        </View>
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050507',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  headerLiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerLiveText: {
    color: '#00C48C',
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 2,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '800' as const,
  },
  shareBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 16,
  },
  heroCard: {
    backgroundColor: '#0A0E0C',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#00C48C30',
    padding: 24,
    alignItems: 'center',
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    top: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#00C48C08',
  },
  heroIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  heroTitle: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '900' as const,
    letterSpacing: 3,
    textAlign: 'center' as const,
  },
  heroSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center' as const,
    marginTop: 8,
  },
  heroStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    backgroundColor: '#06080715',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1A1A1E',
    overflow: 'hidden',
    width: '100%',
  },
  heroStat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    gap: 4,
  },
  heroStatLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  heroStatValue: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums'] as any,
  },
  heroStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#1A1A1E',
  },
  liveCounterValue: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums'] as any,
  },
  reachMeter: {
    backgroundColor: '#0D0D10',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E1E22',
    padding: 18,
    gap: 12,
  },
  reachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reachTitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  reachTotal: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '900' as const,
  },
  reachBar: {
    flexDirection: 'row',
    gap: 2,
    borderRadius: 3,
    overflow: 'hidden',
  },
  reachLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reachLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reachLegendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  reachLegendText: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '600' as const,
  },
  reachLegendPop: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '700' as const,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const,
    flex: 1,
  },
  sectionSubtitle: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  allLiveBadge: {
    backgroundColor: '#00C48C15',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#00C48C30',
  },
  allLiveText: {
    color: '#00C48C',
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 1,
  },
  modulesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  moduleCard: {
    width: '48%' as any,
    backgroundColor: '#0D0D10',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E1E22',
    padding: 14,
    gap: 6,
    flexGrow: 1,
    flexBasis: '46%' as any,
  },
  moduleTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  moduleName: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  moduleUptime: {
    color: Colors.textTertiary,
    fontSize: 10,
  },
  moduleStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  moduleStatusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  moduleStatusText: {
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 1,
  },
  moneyFlow: {
    backgroundColor: '#0D0D10',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E1E22',
    padding: 18,
    gap: 12,
  },
  moneyFlowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  moneyFlowTitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  moneyFlowTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  moneyFlowBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1A1A1E',
    borderRadius: 2,
  },
  moneyFlowPulse: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 80,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.primary + '60',
  },
  moneyFlowStages: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  moneyFlowStage: {
    alignItems: 'center',
    gap: 4,
  },
  moneyFlowDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2A2A2E',
    borderWidth: 2,
    borderColor: '#1A1A1E',
  },
  moneyFlowStageText: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '600' as const,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0D0D10',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1A1A1E',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  channelIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelInfo: {
    flex: 1,
    gap: 2,
  },
  channelName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  channelReach: {
    color: Colors.textTertiary,
    fontSize: 11,
  },
  channelStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  channelStatusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  channelStatusText: {
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 1,
  },
  revenueGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  revenueCard: {
    flexGrow: 1,
    flexBasis: '46%' as any,
    backgroundColor: '#0D0D10',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1A1A1E',
    padding: 14,
    gap: 6,
    overflow: 'hidden',
  },
  revenueAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  revenueLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  revenueAmount: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '900' as const,
  },
  revenueReadyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  revenueReadyText: {
    color: '#00C48C',
    fontSize: 10,
    fontWeight: '700' as const,
  },
  aiTasksList: {
    backgroundColor: '#0D0D10',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1E1E22',
    overflow: 'hidden',
  },
  aiTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1E',
  },
  aiTaskIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#15151A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiTaskText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionCard: {
    flexGrow: 1,
    flexBasis: '30%' as any,
    backgroundColor: '#0D0D10',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1A1A1E',
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 8,
  },
  actionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#15151A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700' as const,
    textAlign: 'center' as const,
  },
  missionCard: {
    backgroundColor: '#0C0A10',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    padding: 24,
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  missionTitle: {
    color: Colors.primary,
    fontSize: 18,
    fontWeight: '900' as const,
    textAlign: 'center' as const,
  },
  missionText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center' as const,
  },
  missionProgress: {
    width: '100%',
    gap: 6,
    marginTop: 4,
  },
  missionProgressBar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1A1A1E',
    overflow: 'hidden',
  },
  missionProgressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
    minWidth: 4,
  },
  missionProgressText: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
  },
});
