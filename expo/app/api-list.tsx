import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Share,
  Platform,
  Animated,
  Linking,
  RefreshControl,
  Alert} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Share2,
  MessageCircle,
  Copy,
  CheckCircle2,
  ExternalLink,
  CreditCard,
  Mail,
  Phone,
  ShieldCheck,
  HardDrive,
  BarChart3,
  AlertTriangle,
  Zap,
  RefreshCw,
  Wifi,
  WifiOff,
  Clock,
  Activity,
  Megaphone,
  TrendingUp,
  Clipboard} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as ExpoClipboard from 'expo-clipboard';
import Colors from '@/constants/colors';
import { safeSetString } from '@/lib/safe-clipboard';

type Priority = 'must' | 'important' | 'optional';
type APIStatus = 'checking' | 'online' | 'offline' | 'pending';

interface APIItem {
  id: number;
  name: string;
  description: string;
  url: string;
  priority: Priority;
  checkUrl?: string;
}

interface APICategory {
  id: string;
  title: string;
  emoji: string;
  color: string;
  icon: React.ComponentType<{ size: number; color: string }>;
  apis: APIItem[];
}

interface StatusMap {
  [id: number]: APIStatus;
}

interface PingResult {
  id: number;
  status: APIStatus;
  latency?: number;
}

const AUTO_REFRESH_SECONDS = 30;

const CATEGORIES: APICategory[] = [
  {
    id: 'ads',
    title: 'Advertising Platforms',
    emoji: '📢',
    color: '#4285F4',
    icon: Megaphone,
    apis: [
      { id: 1, name: 'Google Ads API', description: 'Search intent campaigns — target people looking for real estate investment. Need: OAuth 2.0 Client ID/Secret, Developer Token, Customer ID', url: 'https://console.cloud.google.com', checkUrl: 'https://google.com', priority: 'must' },
      { id: 2, name: 'Meta Marketing API', description: 'Facebook & Instagram ads targeting property owners & investors. Need: App ID, App Secret, Access Token, Ad Account ID, Pixel ID', url: 'https://developers.facebook.com', checkUrl: 'https://facebook.com', priority: 'must' },
      { id: 3, name: 'TikTok Marketing API', description: 'Short video awareness campaigns. Need: App ID, Secret, Access Token, Advertiser ID, Pixel ID', url: 'https://business-api.tiktok.com', checkUrl: 'https://tiktok.com', priority: 'important' },
      { id: 4, name: 'LinkedIn Marketing API', description: 'B2B outreach to developers, lenders, brokers. Need: OAuth Client ID/Secret, Access Token, Ad Account ID, Insight Tag', url: 'https://www.linkedin.com/developers', checkUrl: 'https://linkedin.com', priority: 'important' },
      { id: 5, name: 'WhatsApp Business API', description: 'Retargeting & follow-up messaging. Need: Business Account ID, Phone Number ID, Permanent Access Token, Approved Templates', url: 'https://developers.facebook.com/docs/whatsapp/cloud-api', checkUrl: 'https://facebook.com', priority: 'important' },
    ]},
  {
    id: 'tracking',
    title: 'Tracking & Analytics',
    emoji: '📈',
    color: '#FF6D00',
    icon: TrendingUp,
    apis: [
      { id: 6, name: 'Google Analytics 4', description: 'Track app events, conversions, user behavior analytics', url: 'https://analytics.google.com', checkUrl: 'https://analytics.google.com', priority: 'must' },
      { id: 7, name: 'Meta Conversions API', description: 'Server-side conversion tracking for Facebook/Instagram ads', url: 'https://developers.facebook.com/docs/marketing-api/conversions-api', checkUrl: 'https://facebook.com', priority: 'important' },
      { id: 8, name: 'Google Tag Manager', description: 'Manage all tracking pixels and tags in one place', url: 'https://tagmanager.google.com', checkUrl: 'https://tagmanager.google.com', priority: 'important' },
    ]},
  {
    id: 'payments',
    title: 'Payments',
    emoji: '💳',
    color: '#F59E0B',
    icon: CreditCard,
    apis: [
      { id: 9, name: 'Stripe', description: 'Card processing, Apple Pay, Google Pay, webhooks, refunds', url: 'https://dashboard.stripe.com/register', checkUrl: 'https://stripe.com', priority: 'must' },
      { id: 10, name: 'Plaid', description: 'Bank linking, ACH transfers, account verification, balance checks', url: 'https://dashboard.plaid.com/signup', checkUrl: 'https://plaid.com', priority: 'important' },
      { id: 11, name: 'PayPal', description: 'Alternative payment method, PayPal checkout integration', url: 'https://developer.paypal.com/dashboard', checkUrl: 'https://paypal.com', priority: 'optional' },
      { id: 12, name: 'Coinbase Commerce', description: 'Crypto payments, Bitcoin/ETH/USDC acceptance', url: 'https://commerce.coinbase.com/signup', checkUrl: 'https://coinbase.com', priority: 'optional' },
    ]},
  {
    id: 'email',
    title: 'Email',
    emoji: '📧',
    color: '#8B5CF6',
    icon: Mail,
    apis: [
      { id: 13, name: 'SendGrid', description: 'Transactional emails, welcome, KYC, receipts, statements', url: 'https://signup.sendgrid.com', checkUrl: 'https://sendgrid.com', priority: 'must' },
    ]},
  {
    id: 'sms',
    title: 'SMS / Messaging',
    emoji: '📱',
    color: '#25D366',
    icon: Phone,
    apis: [
      { id: 14, name: 'Twilio', description: 'SMS verification, 2FA codes, programmable messaging', url: 'https://www.twilio.com/try-twilio', checkUrl: 'https://twilio.com', priority: 'must' },
    ]},
  {
    id: 'kyc',
    title: 'KYC / Identity Verification',
    emoji: '🪪',
    color: '#06B6D4',
    icon: ShieldCheck,
    apis: [
      { id: 15, name: 'Onfido', description: 'Document verification, face match, biometric checks', url: 'https://onfido.com/signup', checkUrl: 'https://onfido.com', priority: 'important' },
      { id: 16, name: 'Jumio', description: 'AI-powered identity verification, global document coverage', url: 'https://www.jumio.com/contact-us', checkUrl: 'https://jumio.com', priority: 'important' },
    ]},
  {
    id: 'storage',
    title: 'File Storage',
    emoji: '☁️',
    color: '#F97316',
    icon: HardDrive,
    apis: [
      { id: 17, name: 'Cloudflare R2', description: 'S3-compatible object storage, zero egress fees, CDN included', url: 'https://dash.cloudflare.com/sign-up', checkUrl: 'https://cloudflare.com', priority: 'important' },
    ]},
  {
    id: 'market',
    title: 'Market Data',
    emoji: '📊',
    color: '#00C48C',
    icon: BarChart3,
    apis: [
      { id: 18, name: 'Alpha Vantage', description: 'Stock/REIT market data, price history, financial metrics', url: 'https://www.alphavantage.co/support/#api-key', checkUrl: 'https://alphavantage.co', priority: 'optional' },
      { id: 19, name: 'ATTOM Property Data', description: 'Real estate property data, valuations, market analytics', url: 'https://api.attomdata.com/signup', priority: 'optional' },
      { id: 20, name: 'Google Maps', description: 'Property map display, location services, geocoding', url: 'https://console.cloud.google.com', checkUrl: 'https://maps.google.com', priority: 'optional' },
    ]},
  {
    id: 'monitoring',
    title: 'Monitoring',
    emoji: '🐛',
    color: '#EC4899',
    icon: AlertTriangle,
    apis: [
      { id: 21, name: 'Sentry', description: 'Error tracking, performance monitoring, crash reports', url: 'https://sentry.io/signup', checkUrl: 'https://sentry.io', priority: 'important' },
    ]},
];

const PRIORITY_LABEL: Record<string, string> = {
  must: '🔴 Must Have',
  important: '🟠 Important',
  optional: '🟡 Optional'};

const PRIORITY_COLOR: Record<string, string> = {
  must: '#FF4D4D',
  important: '#F97316',
  optional: '#EAB308'};

const ALL_APIS: APIItem[] = CATEGORIES.flatMap(c => c.apis);

async function pingAPI(api: APIItem): Promise<PingResult> {
  if (!api.checkUrl && !api.url) {
    return { id: api.id, status: 'online' };
  }
  const target = api.checkUrl || api.url;
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(target, { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
    clearTimeout(timeout);
    return { id: api.id, status: 'online', latency: Date.now() - start };
  } catch {
    return { id: api.id, status: 'offline' };
  }
}

function generateAPIListText(): string {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const totalApis = CATEGORIES.reduce((sum, c) => sum + c.apis.length, 0);
  let r = '';
  r += '════════════════════════════════════════════\n';
  r += '   IVX HOLDING — API REQUIREMENTS LIST\n';
  r += '════════════════════════════════════════════\n';
  r += `   Generated: ${date}\n`;
  r += `   Total: ${totalApis} APIs across ${CATEGORIES.length} categories\n`;
  r += '   ✅ Completed: JWT, AWS S3, Expo Push\n';
  r += '════════════════════════════════════════════\n\n';
  let num = 1;
  CATEGORIES.forEach((cat) => {
    r += `──────────────────────────────────────────\n`;
    r += `${cat.emoji} ${cat.title.toUpperCase()}\n`;
    r += `──────────────────────────────────────────\n`;
    cat.apis.forEach((api) => {
      r += `\n${num}. ${api.name} [${api.priority.toUpperCase()}]\n`;
      r += `   📋 ${api.description}\n`;
      if (api.url) r += `   🔗 ${api.url}\n`;
      else r += `   ✅ No registration needed\n`;
      num++;
    });
    r += '\n';
  });
  r += '══════════════════════════════════════\nALREADY COMPLETED (REMOVED FROM LIST)\n══════════════════════════════════════\n';
  r += '✅ JWT Secret — Configured\n';
  r += '✅ AWS S3 — Credentials set up\n';
  r += '✅ Expo Push Notifications — Built-in\n';
  r += '✅ Apple Pay / Google Pay — Via Stripe\n';
  r += '✅ Mailgun — Using SendGrid instead\n\n';
  r += '══════════════════════════════════════\nPRIORITY SUMMARY\n══════════════════════════════════════\n';
  r += '🔴 Must Have:   Google Ads, Meta Ads, Stripe, SendGrid, Twilio, GA4\n';
  r += '🟠 Important:   TikTok Ads, LinkedIn Ads, WhatsApp API, Plaid, Onfido/Jumio, R2, Sentry, Meta Conversions, GTM\n';
  r += '🟡 Optional:    PayPal, Coinbase, Alpha Vantage, ATTOM, Google Maps\n\n';
  r += '════════════════════════════════════════════\n   IVX Holding Real Estate Investment Platform\n   Share with your developer team\n════════════════════════════════════════════\n';
  return r;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function APIListScreen() {
  const router = useRouter();
  const [copied, setCopied] = useState<boolean>(false);
  const [pastedFromClipboard, setPastedFromClipboard] = useState<boolean>(false);
  const [clipboardPreview, setClipboardPreview] = useState<string>('');
  const [statusMap, setStatusMap] = useState<StatusMap>({});
  const [latencyMap, setLatencyMap] = useState<Record<number, number>>({});
  const [isChecking, setIsChecking] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SECONDS);
  const [refreshing, setRefreshing] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const countdownRef = useRef(countdown);
  countdownRef.current = countdown;

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const startPulse = useCallback(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.3, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);

  const startSpinner = useCallback(() => {
    spinAnim.setValue(0);
    Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 700, useNativeDriver: true })
    ).start();
  }, [spinAnim]);

  const stopSpinner = useCallback(() => {
    spinAnim.stopAnimation();
  }, [spinAnim]);

  const runChecks = useCallback(async () => {
    console.log('[APIList] Running live status checks...');
    setIsChecking(true);
    startSpinner();

    const initial: StatusMap = {};
    ALL_APIS.forEach(a => { initial[a.id] = 'checking'; });
    setStatusMap(initial);

    const results = await Promise.all(ALL_APIS.map(api => pingAPI(api)));
    const newStatus: StatusMap = {};
    const newLatency: Record<number, number> = {};
    results.forEach(r => {
      newStatus[r.id] = r.status;
      if (r.latency !== undefined) newLatency[r.id] = r.latency;
    });

    setStatusMap(newStatus);
    setLatencyMap(newLatency);
    setLastUpdated(new Date());
    setIsChecking(false);
    setCountdown(AUTO_REFRESH_SECONDS);
    stopSpinner();
    console.log('[APIList] Status check complete:', newStatus);
  }, [startSpinner, stopSpinner]);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    startPulse();
    void runChecks();
  }, [fadeAnim, runChecks, startPulse]);

  const onRefresh = useCallback(async () => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setRefreshing(true);
    await runChecks();
    setRefreshing(false);
  }, [runChecks]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          void runChecks();
          return AUTO_REFRESH_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [runChecks]);

  const handleShare = useCallback(async () => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    try {
      await Share.share({ title: 'IVX Holding API Registration List', message: generateAPIListText() });
    } catch (err) {
      console.log('Share error:', err);
    }
  }, []);

  const handleWhatsApp = useCallback(async () => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    const encoded = encodeURIComponent(generateAPIListText());
    const url = `whatsapp://send?text=${encoded}`;
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        await Share.share({ title: 'IVX Holding API List', message: generateAPIListText() });
      }
    } catch {
      await Share.share({ title: 'IVX Holding API List', message: generateAPIListText() });
    }
  }, []);

  const handleCopy = useCallback(async () => {
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    const text = generateAPIListText();
    console.log('[APIList] Copying API list to clipboard');
    const ok = await safeSetString(text);
    if (!ok) {
      Alert.alert('Copy failed', 'Unable to copy the API list right now.');
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, []);

  const handlePaste = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      console.log('[APIList] Reading clipboard preview');
      const content = await ExpoClipboard.getStringAsync();
      const trimmed = content.trim();
      if (!trimmed) {
        Alert.alert('Clipboard empty', 'Copy the list first, then tap Paste Preview.');
        return;
      }
      setClipboardPreview(trimmed);
      setPastedFromClipboard(true);
      setTimeout(() => setPastedFromClipboard(false), 2500);
    } catch (error) {
      console.log('[APIList] Paste failed:', error);
      Alert.alert('Paste failed', 'Unable to read the clipboard right now.');
    }
  }, []);

  const openURL = useCallback(async (url: string) => {
    if (!url) return;
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    try {
      await Linking.openURL(url);
    } catch (err) {
      console.log('Open URL error:', err);
    }
  }, []);

  const totalAPIs = ALL_APIS.length;
  const mustCount = ALL_APIS.filter(a => a.priority === 'must').length;
  const onlineCount = Object.values(statusMap).filter(s => s === 'online').length;
  const offlineCount = Object.values(statusMap).filter(s => s === 'offline').length;
  const checkingCount = Object.values(statusMap).filter(s => s === 'checking').length;

  const progressPercent = totalAPIs > 0 ? (onlineCount / totalAPIs) * 100 : 0;
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progressPercent,
      duration: 600,
      useNativeDriver: false}).start();
  }, [progressAnim, progressPercent]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%']});

  function getStatusColor(status: APIStatus): string {
    switch (status) {
      case 'online': return '#00C48C';
      case 'offline': return '#FF4D4D';
      case 'checking': return '#FFD700';
      default: return '#6A6A6A';
    }
  }

  function getStatusLabel(status: APIStatus): string {
    switch (status) {
      case 'online': return 'LIVE';
      case 'offline': return 'DOWN';
      case 'checking': return '...';
      default: return 'PENDING';
    }
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Animated.View style={[styles.wrapper, { opacity: fadeAnim }]}>

          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-button">
              <ArrowLeft size={22} color={Colors.text} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <View style={styles.headerTitleRow}>
                <Animated.View style={[styles.liveDot, { transform: [{ scale: pulseAnim }] }]} />
                <Text style={styles.headerTitle}>API Status</Text>
              </View>
              <Text style={styles.headerSub}>Auto-refreshes every {AUTO_REFRESH_SECONDS}s</Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                if (Platform.OS !== 'web') {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                }
                void runChecks();
              }}
              style={styles.refreshBtn}
              testID="refresh-button"
            >
              <Animated.View style={{ transform: [{ rotate: isChecking ? spin : '0deg' }] }}>
                <RefreshCw size={20} color={Colors.primary} />
              </Animated.View>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleShare} style={styles.shareBtn} testID="share-button">
              <Share2 size={20} color={Colors.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.liveBar}>
            <View style={styles.liveBarLeft}>
              <Activity size={13} color={isChecking ? Colors.primary : '#00C48C'} />
              <Text style={[styles.liveBarText, { color: isChecking ? Colors.primary : '#00C48C' }]}>
                {isChecking ? 'Checking all APIs...' : `${onlineCount}/${totalAPIs} APIs reachable`}
              </Text>
            </View>
            <View style={styles.liveBarRight}>
              {!isChecking && (
                <>
                  <Clock size={11} color={Colors.textTertiary} />
                  <Text style={styles.liveBarTime}>
                    {lastUpdated ? `Updated ${formatTime(lastUpdated)}` : ''}
                  </Text>
                  <View style={styles.countdownBadge}>
                    <Text style={styles.countdownText}>{countdown}s</Text>
                  </View>
                </>
              )}
            </View>
          </View>

          <View style={styles.progressContainer}>
            <View style={styles.progressBg}>
              <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
            </View>
            <Text style={styles.progressLabel}>{Math.round(progressPercent)}% reachable</Text>
          </View>

          <View style={styles.heroBanner}>
            <View style={styles.heroStat}>
              <Text style={styles.heroNum}>{totalAPIs}</Text>
              <Text style={styles.heroLabel}>Total APIs</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Text style={[styles.heroNum, { color: '#00C48C' }]}>{onlineCount}</Text>
              <Text style={styles.heroLabel}>Online</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Text style={[styles.heroNum, { color: '#FF4D4D' }]}>{offlineCount}</Text>
              <Text style={styles.heroLabel}>Offline</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Text style={[styles.heroNum, { color: Colors.primary }]}>{checkingCount}</Text>
              <Text style={styles.heroLabel}>Checking</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Text style={[styles.heroNum, { color: '#FF4D4D' }]}>{mustCount}</Text>
              <Text style={styles.heroLabel}>Must</Text>
            </View>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.whatsappBtn} onPress={handleWhatsApp} testID="whatsapp-button">
              <MessageCircle size={16} color="#25D366" />
              <Text style={styles.whatsappText}>Send via WhatsApp</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.copyBtn} onPress={handleCopy} testID="copy-button">
              {copied ? <CheckCircle2 size={16} color={Colors.primary} /> : <Copy size={16} color={Colors.primary} />}
              <Text style={styles.copyText}>{copied ? 'Copied!' : 'Copy List'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.clipboardRow}>
            <TouchableOpacity style={styles.pasteBtn} onPress={handlePaste} testID="paste-button">
              {pastedFromClipboard ? <CheckCircle2 size={16} color={Colors.text} /> : <Clipboard size={16} color={Colors.text} />}
              <Text style={styles.pasteText}>{pastedFromClipboard ? 'Preview Ready' : 'Paste Preview'}</Text>
            </TouchableOpacity>
            <Text style={styles.clipboardHint}>The copy button is under the status cards. Tap Copy List, then Paste Preview to confirm it.</Text>
          </View>

          {clipboardPreview ? (
            <View style={styles.clipboardPreviewCard}>
              <View style={styles.clipboardPreviewHeader}>
                <Text style={styles.clipboardPreviewTitle}>Clipboard preview</Text>
                <Text style={styles.clipboardPreviewMeta}>{clipboardPreview.length} chars</Text>
              </View>
              <Text style={styles.clipboardPreviewText} numberOfLines={5}>{clipboardPreview}</Text>
            </View>
          ) : null}

          <ScrollView
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={Colors.primary}
                colors={[Colors.primary]}
              />
            }
          >

            <View style={styles.priorityLegend}>
              {(['must', 'important', 'optional'] as const).map((p) => (
                <View key={p} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: PRIORITY_COLOR[p] }]} />
                  <Text style={styles.legendText}>{PRIORITY_LABEL[p]}</Text>
                </View>
              ))}
            </View>

            {CATEGORIES.map((cat) => {
              const IconComp = cat.icon;
              const catOnline = cat.apis.filter(a => statusMap[a.id] === 'online').length;
              return (
                <View key={cat.id} style={styles.categoryCard}>
                  <View style={styles.categoryHeader}>
                    <View style={[styles.catIconWrap, { backgroundColor: cat.color + '22' }]}>
                      <IconComp size={18} color={cat.color} />
                    </View>
                    <Text style={styles.categoryTitle}>{cat.emoji} {cat.title}</Text>
                    <View style={styles.catStatusRow}>
                      <View style={[styles.catOnlineBadge, { backgroundColor: catOnline === cat.apis.length ? '#00C48C22' : '#FF4D4D22' }]}>
                        <Text style={[styles.catOnlineText, { color: catOnline === cat.apis.length ? '#00C48C' : '#FF4D4D' }]}>
                          {catOnline}/{cat.apis.length}
                        </Text>
                      </View>
                      <View style={[styles.catCountBadge, { backgroundColor: cat.color + '22' }]}>
                        <Text style={[styles.catCount, { color: cat.color }]}>{cat.apis.length}</Text>
                      </View>
                    </View>
                  </View>

                  {cat.apis.map((api, idx) => {
                    const status: APIStatus = statusMap[api.id] || 'pending';
                    const latency = latencyMap[api.id];
                    const statusColor = getStatusColor(status);
                    const statusLabel = getStatusLabel(status);
                    return (
                      <View key={api.id} style={[styles.apiItem, idx === cat.apis.length - 1 && styles.apiItemLast]}>
                        <View style={styles.apiLeft}>
                          <Text style={styles.apiNumber}>{api.id}</Text>
                          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                        </View>
                        <View style={styles.apiBody}>
                          <View style={styles.apiTitleRow}>
                            <Text style={styles.apiName}>{api.name}</Text>
                            <View style={styles.apiRightBadges}>
                              <View style={[styles.statusBadge, { backgroundColor: statusColor + '20', borderColor: statusColor + '40' }]}>
                                {status === 'online' ? (
                                  <Wifi size={9} color={statusColor} />
                                ) : status === 'offline' ? (
                                  <WifiOff size={9} color={statusColor} />
                                ) : null}
                                <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
                                {latency !== undefined && status === 'online' && (
                                  <Text style={[styles.latencyText, { color: statusColor }]}>{latency}ms</Text>
                                )}
                              </View>
                              <View style={[styles.priorityBadge, { backgroundColor: PRIORITY_COLOR[api.priority] + '20' }]}>
                                <Text style={[styles.priorityText, { color: PRIORITY_COLOR[api.priority] }]}>
                                  {api.priority === 'must' ? '🔴' : api.priority === 'important' ? '🟠' : '🟡'}
                                </Text>
                              </View>
                            </View>
                          </View>
                          <Text style={styles.apiDesc}>{api.description}</Text>
                          {api.url ? (
                            <TouchableOpacity
                              style={styles.urlRow}
                              onPress={() => openURL(api.url)}
                              testID={`api-link-${api.id}`}
                            >
                              <ExternalLink size={11} color={Colors.accent} />
                              <Text style={styles.urlText} numberOfLines={1}>{api.url}</Text>
                            </TouchableOpacity>
                          ) : (
                            <View style={styles.urlRow}>
                              <CheckCircle2 size={11} color={Colors.success} />
                              <Text style={[styles.urlText, { color: Colors.success }]}>No registration needed</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              );
            })}

            <View style={styles.prioritySummaryCard}>
              <View style={styles.summaryTitleRow}>
                <Zap size={14} color={Colors.primary} />
                <Text style={styles.summaryTitle}>PRIORITY SUMMARY</Text>
              </View>
              <View style={styles.completedSection}>
                <Text style={[styles.summaryLabel, { color: '#00C48C' }]}>✅ Already Completed</Text>
                <Text style={styles.summaryItems}>JWT Secret · AWS S3 · Expo Push · Apple/Google Pay (via Stripe) · Mailgun (using SendGrid)</Text>
              </View>
              <View style={styles.summarySection}>
                <Text style={[styles.summaryLabel, { color: '#FF4D4D' }]}>🔴 Must Have (Register First)</Text>
                <Text style={styles.summaryItems}>Google Ads · Meta Marketing · Stripe · SendGrid · Twilio · Google Analytics 4</Text>
              </View>
              <View style={styles.summarySection}>
                <Text style={[styles.summaryLabel, { color: '#F97316' }]}>🟠 Important (Before Launch)</Text>
                <Text style={styles.summaryItems}>TikTok Ads · LinkedIn Ads · WhatsApp API · Plaid · Onfido/Jumio · R2 · Sentry · Meta Conversions · GTM</Text>
              </View>
              <View style={styles.summarySection}>
                <Text style={[styles.summaryLabel, { color: '#EAB308' }]}>🟡 Optional (Post Launch)</Text>
                <Text style={styles.summaryItems}>PayPal · Coinbase · Alpha Vantage · ATTOM · Google Maps</Text>
              </View>
            </View>

            <View style={styles.shareFooter}>
              <TouchableOpacity style={styles.footerWhatsApp} onPress={handleWhatsApp}>
                <MessageCircle size={18} color="#25D366" />
                <Text style={styles.footerWhatsAppText}>Send Full List to Developer via WhatsApp</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.footerShare} onPress={handleShare}>
                <Share2 size={18} color={Colors.primary} />
                <Text style={styles.footerShareText}>Share / Export as Text</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.footer}>
              <Text style={styles.footerNote}>IVX Holding Real Estate Investment Platform</Text>
              <Text style={styles.footerDate}>
                {lastUpdated ? `Last checked: ${formatTime(lastUpdated)}` : new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </Text>
              <Text style={[styles.footerDate, { color: Colors.primary, marginTop: 4 }]}>
                Auto-refresh in {countdown}s
              </Text>
            </View>

          </ScrollView>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  safe: { flex: 1 },
  wrapper: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  backBtn: { padding: 8 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#00C48C' },
  headerTitle: { color: Colors.text, fontSize: 17, fontWeight: '800' as const },
  headerSub: { color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  refreshBtn: { padding: 8 },
  shareBtn: { padding: 8 },

  liveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  liveBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveBarText: { fontSize: 12, fontWeight: '700' as const },
  liveBarRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveBarTime: { color: Colors.textTertiary, fontSize: 11 },
  countdownBadge: {
    backgroundColor: Colors.primary + '20',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.primary + '40'},
  countdownText: { color: Colors.primary, fontSize: 11, fontWeight: '800' as const },

  progressContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  progressBg: {
    flex: 1,
    height: 5,
    backgroundColor: Colors.surfaceBorder,
    borderRadius: 3,
    overflow: 'hidden'},
  progressFill: {
    height: '100%',
    backgroundColor: '#00C48C',
    borderRadius: 3},
  progressLabel: { color: Colors.textTertiary, fontSize: 11, width: 80, textAlign: 'right' as const },

  heroBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginHorizontal: 16,
    marginVertical: 14,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  heroStat: { alignItems: 'center', flex: 1 },
  heroNum: { color: Colors.primary, fontSize: 20, fontWeight: '800' as const },
  heroLabel: { color: Colors.textTertiary, fontSize: 10, marginTop: 2 },
  heroDivider: { width: 1, height: 28, backgroundColor: Colors.surfaceBorder },

  actionRow: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 12 },
  clipboardRow: { marginHorizontal: 16, marginBottom: 12, gap: 8 },
  whatsappBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#25D36618',
    borderRadius: 12,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: '#25D36640'},
  whatsappText: { color: '#25D366', fontSize: 13, fontWeight: '700' as const },
  copyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary + '18',
    borderRadius: 12,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: Colors.primary + '40'},
  copyText: { color: Colors.primary, fontSize: 13, fontWeight: '700' as const },
  pasteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.surfaceLight,
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  pasteText: { color: Colors.text, fontSize: 13, fontWeight: '700' as const },
  clipboardHint: { color: Colors.textTertiary, fontSize: 11, lineHeight: 16 },
  clipboardPreviewCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 8},
  clipboardPreviewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clipboardPreviewTitle: { color: Colors.text, fontSize: 13, fontWeight: '700' as const },
  clipboardPreviewMeta: { color: Colors.textTertiary, fontSize: 11 },
  clipboardPreviewText: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 140 },

  priorityLegend: { flexDirection: 'row', gap: 12, marginBottom: 14, flexWrap: 'wrap' as const },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: Colors.textSecondary, fontSize: 12 },

  categoryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden'},
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  catIconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  categoryTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const, flex: 1 },
  catStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  catOnlineBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  catOnlineText: { fontSize: 11, fontWeight: '800' as const },
  catCountBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  catCount: { fontSize: 13, fontWeight: '800' as const },

  apiItem: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder + '60'},
  apiItemLast: { borderBottomWidth: 0 },
  apiLeft: { marginRight: 12, alignItems: 'center', paddingTop: 3, gap: 6 },
  apiNumber: { color: Colors.textTertiary, fontSize: 12, fontWeight: '700' as const, width: 22, textAlign: 'center' as const },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  apiBody: { flex: 1 },
  apiTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  apiName: { color: Colors.text, fontSize: 14, fontWeight: '700' as const, flex: 1 },
  apiRightBadges: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1},
  statusBadgeText: { fontSize: 9, fontWeight: '800' as const },
  latencyText: { fontSize: 9, fontWeight: '600' as const, opacity: 0.8 },
  priorityBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  priorityText: { fontSize: 12 },
  apiDesc: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 6 },
  urlRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  urlText: { color: Colors.accent, fontSize: 11, flex: 1 },

  prioritySummaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  summaryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  summaryTitle: { color: Colors.text, fontSize: 13, fontWeight: '800' as const, letterSpacing: 1 },
  completedSection: { marginBottom: 12, backgroundColor: '#00C48C12', borderRadius: 10, padding: 10 },
  summarySection: { marginBottom: 12 },
  summaryLabel: { fontSize: 13, fontWeight: '700' as const, marginBottom: 4 },
  summaryItems: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18 },

  shareFooter: { gap: 10, marginBottom: 16 },
  footerWhatsApp: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#25D36615',
    borderRadius: 14,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#25D36635'},
  footerWhatsAppText: { color: '#25D366', fontSize: 15, fontWeight: '700' as const },
  footerShare: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.primary + '15',
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '35'},
  footerShareText: { color: Colors.primary, fontSize: 14, fontWeight: '700' as const },

  footer: { alignItems: 'center', paddingVertical: 12 },
  footerNote: { color: Colors.textTertiary, fontSize: 12 },
  footerDate: { color: Colors.textTertiary, fontSize: 11, marginTop: 3 }});
