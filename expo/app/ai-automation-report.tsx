import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Linking,
  Alert,
  Switch,
  TextInput,
  Platform,
  Share} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import {
  ArrowLeft,
  Brain,
  Zap,
  Image as ImageIcon,
  RefreshCw,
  Users,
  Share2,
  FileText,
  Film,
  MessageCircle,
  TrendingUp,
  Bell,
  Megaphone,
  CheckCircle,
  Phone,
  ChevronDown,
  ChevronUp,
  Activity,
  Sparkles,
  Target,
  BarChart3,
  Copy,
  Send,
  Smartphone} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { RefreshControl } from 'react-native';

interface AIModule {
  id: string;
  number: number;
  title: string;
  category: 'ai' | 'automation' | 'advertising' | 'analytics';
  status: 'active' | 'coming_soon';
  icon: React.ComponentType<{ size: number; color: string }>;
  color: string;
  description: string;
  functionalities: string[];
  route?: string;
}

const WHATSAPP_NUMBER = '';
const OWNER_DISPLAY = 'No phone configured';

const AI_MODULES: AIModule[] = [
  {
    id: 'ai-gallery',
    number: 1,
    title: 'AI Marketing Image Generator',
    category: 'advertising',
    status: 'active',
    icon: ImageIcon,
    color: '#E91E63',
    description: 'Generate stunning AI property images for ads, listings, and campaigns',
    functionalities: [
      'Generate luxury property images (luxury towers, villas, penthouses)',
      'Real estate marketing photo creation',
      'AI-powered construction progress visuals',
      'Beachfront & mountain resort renders',
      'Interior design & office space generation',
      'App feature & finance visual creation',
      '5 free daily generations (unlimited for VIP)',
      'Save, share & download generated images',
      'Copy to clipboard for instant ad use',
      'Category filtering (Properties, Finance, People)',
    ],
    route: '/ai-gallery'},
  {
    id: 'smart-investing',
    number: 2,
    title: 'Smart AI Portfolio Optimizer',
    category: 'ai',
    status: 'active',
    icon: Brain,
    color: '#A855F7',
    description: 'Machine learning engine that manages and optimizes your investment portfolio',
    functionalities: [
      'AI Portfolio Optimizer — avg +3.2% better returns',
      'Smart Auto-Invest: auto-buys when criteria match',
      'Predictive Market Alerts (48hr early warning)',
      'Risk Intelligence Score across 87 risk factors',
      'Dividend Reinvestment (DRIP) automation',
      'Tax-Loss Harvesting (coming soon)',
      'Social Trading — mirror top investors',
      'Goal-Based Investing with AI custom strategy',
      'Global market signal monitoring (200+ signals)',
      'Toggle each feature on/off individually',
    ],
    route: '/smart-investing'},
  {
    id: 'auto-reinvest',
    number: 3,
    title: 'Auto Reinvest (DRIP Engine)',
    category: 'automation',
    status: 'active',
    icon: RefreshCw,
    color: '#00C48C',
    description: 'Automatically reinvests dividends into more property shares for compound growth',
    functionalities: [
      'Global DRIP on/off toggle for all holdings',
      'Per-property individual DRIP configuration',
      'Auto-calculates estimated reinvestment amounts',
      'Next dividend date tracking per property',
      'Shows shares owned & estimated new shares',
      'Compound growth projection (+2.8%)',
      'Real-time portfolio reinvestment summary',
      'Animated live status indicators',
    ],
    route: '/auto-reinvest'},
  {
    id: 'copy-investing',
    number: 4,
    title: 'Copy Investing (Social AI)',
    category: 'automation',
    status: 'active',
    icon: Users,
    color: '#4A90D9',
    description: 'Automatically mirror top-performing investor portfolios with one tap',
    functionalities: [
      'Browse top investors by return, followers, holdings',
      'Filter by risk level (conservative/moderate/aggressive)',
      'View investor portfolios and allocation breakdown',
      'One-tap copy of any investor strategy',
      'Follow count, ROI, and fire score tracking',
      'Expand investor card for full details',
      'Sort by 1Y return, followers, or holdings count',
    ],
    route: '/copy-investing'},
  {
    id: 'share-content',
    number: 5,
    title: 'Marketing Content Engine',
    category: 'advertising',
    status: 'active',
    icon: Share2,
    color: '#FF6B35',
    description: 'Shareable marketing content and team collaboration tools',
    functionalities: [
      'Share video presentations to WhatsApp, email, social',
      'Share AI-generated property images',
      'Share investment documents and reports',
      'Share referral links with tracking',
      'Team member directory with direct contact',
      'Platform links for web, iOS, Android sharing',
      'Copy links to clipboard instantly',
      'Native share sheet integration',
    ],
    route: '/share-content'},
  {
    id: 'ai-chat',
    number: 6,
    title: 'AI Investment Assistant (Chat)',
    category: 'ai',
    status: 'active',
    icon: MessageCircle,
    color: '#A855F7',
    description: '24/7 AI-powered chat assistant for investment guidance and support',
    functionalities: [
      'Natural language investment Q&A',
      'Portfolio analysis & recommendations',
      'Property research assistance',
      'Automated FAQ responses',
      'Human support escalation routing',
      'Market trend explanations',
      'Investment strategy guidance',
      'Multilingual support (30 languages)',
    ],
    route: '/(tabs)/chat'},
  {
    id: 'contract-gen',
    number: 7,
    title: 'AI Contract Generator',
    category: 'ai',
    status: 'active',
    icon: FileText,
    color: '#1a3a5c',
    description: 'AI generates legal investment contracts automatically from form data',
    functionalities: [
      'AI auto-fills contract terms from entered data',
      'Bilingual contracts (English/Spanish)',
      'Investor & property details auto-population',
      'Government ID attachment support',
      'PDF generation and printing',
      'WhatsApp & email sharing of contracts',
      'Secure signing and document storage',
      'Legal template compliance verification',
    ],
    route: '/contract-generator'},
  {
    id: 'video-presentation',
    number: 8,
    title: 'AI Video Presentation Maker',
    category: 'advertising',
    status: 'active',
    icon: Film,
    color: '#FF4D4D',
    description: 'Auto-generates video slide decks and property presentations for marketing',
    functionalities: [
      'Animated slide-by-slide video presentation',
      'Custom property highlight reels',
      'Upload custom background images',
      'Auto-advance with configurable speed',
      'Export & share to WhatsApp/social media',
      'AI image generation for each slide',
      'Save/load presentation history',
      'Free 5 daily views (unlimited VIP)',
    ],
    route: '/video-presentation'},
  {
    id: 'investor-prospectus',
    number: 9,
    title: 'Automated Investor Prospectus',
    category: 'analytics',
    status: 'active',
    icon: TrendingUp,
    color: '#00C48C',
    description: 'Auto-calculates profit projections for any investment amount',
    functionalities: [
      'Real-time ROI projections (hourly to 10-year)',
      'Dividend + capital appreciation breakdown',
      'Multiple investment amount scenarios',
      'Share prospectus via WhatsApp/email',
      'Annual yield: 7.5% | Appreciation: 8.2%',
      'Expandable/collapsible projection rows',
      'One-tap contact investor relations',
    ],
    route: '/investor-prospectus'},
  {
    id: 'notifications',
    number: 10,
    title: 'Automated Notification Engine',
    category: 'automation',
    status: 'active',
    icon: Bell,
    color: '#FF4D4D',
    description: 'Multi-channel automated alerts for investments, dividends, and marketing',
    functionalities: [
      'Push notifications for investment updates',
      'Email automation for dividends & returns',
      'SMS alerts for security events',
      'Market movement alerts (configurable)',
      'Promotional campaign notifications',
      'Per-category toggle (Push / Email / SMS)',
      'Master on/off switch per channel',
      'WhatsApp report delivery (configurable)',
    ],
    route: '/notification-settings'},
  {
    id: 'influencer',
    number: 11,
    title: 'Influencer Marketing Program',
    category: 'advertising',
    status: 'active',
    icon: Megaphone,
    color: '#FFD700',
    description: 'Automated influencer onboarding and campaign tracking system',
    functionalities: [
      'Influencer application & approval flow',
      'Commission tracking dashboard',
      'Unique referral code generation per influencer',
      'Campaign performance analytics',
      'Automated payout calculation',
      'Multi-tier commission structure',
      'Content sharing gateway for influencers',
    ],
    route: '/influencer-apply'},
  {
    id: 'referrals',
    number: 12,
    title: 'Automated Referral Engine',
    category: 'advertising',
    status: 'active',
    icon: Sparkles,
    color: '#06B6D4',
    description: 'Viral growth engine that auto-tracks referrals and pays rewards',
    functionalities: [
      'Auto-generated unique referral codes',
      'Real-time referral conversion tracking',
      'Automated reward calculation & payout',
      'Leaderboard with top referrers',
      'Share referral link to any platform',
      'Multi-level commission structure',
      'Agent & broker referral programs',
    ],
    route: '/referrals'},
  {
    id: 'analytics',
    number: 13,
    title: 'AI Analytics & Reporting',
    category: 'analytics',
    status: 'active',
    icon: BarChart3,
    color: '#8B5CF6',
    description: 'Automated analytics reports across all platform activities',
    functionalities: [
      'Admin engagement analytics dashboard',
      'User acquisition & retention metrics',
      'Investment volume tracking',
      'Marketing campaign performance reports',
      'Revenue and fee analytics',
      'Property performance benchmarking',
      'Export reports as PDF/CSV/WhatsApp',
      'Real-time data refresh',
    ],
    route: '/app-report'},
];

const CATEGORY_COLORS: Record<string, string> = {
  ai: '#A855F7',
  automation: '#00C48C',
  advertising: '#FF6B35',
  analytics: '#4A90D9'};

const CATEGORY_LABELS: Record<string, string> = {
  ai: 'AI',
  automation: 'Automation',
  advertising: 'Advertising',
  analytics: 'Analytics'};

export default function AIAutomationReportScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [customPhone, setCustomPhone] = useState(OWNER_DISPLAY);
  const [editingPhone, setEditingPhone] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const headerAnim = useRef(new Animated.Value(0)).current;
  const cardAnims = useRef(AI_MODULES.map(() => new Animated.Value(0))).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    AI_MODULES.forEach((_, i) => {
      Animated.timing(cardAnims[i], {
        toValue: 1,
        duration: 400,
        delay: 100 + i * 60,
        useNativeDriver: true}).start();
    });
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const toggleExpand = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedId(prev => (prev === id ? null : id));
  }, []);

  const filtered = activeFilter === 'all'
    ? AI_MODULES
    : AI_MODULES.filter(m => m.category === activeFilter);

  const handleSendWhatsApp = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const date = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    const totalFunctions = AI_MODULES.reduce((sum, m) => sum + m.functionalities.length, 0);
    const msg = encodeURIComponent(
      `📊 *IVXHOLDINGS AI & AUTOMATION REPORT*\n` +
      `Generated: ${date}\n\n` +
      `🤖 *${AI_MODULES.length} AI & Automation Modules Active*\n` +
      `⚡ *${totalFunctions} Total Automated Functions*\n\n` +
      `*MODULES SUMMARY:*\n` +
      AI_MODULES.map(m =>
        `${m.number}. ${m.title} (${m.functionalities.length} functions) — ${m.status === 'active' ? '✅ ACTIVE' : '🔜 COMING SOON'}`
      ).join('\n') +
      `\n\n` +
      `*CATEGORIES:*\n` +
      `🤖 AI: ${AI_MODULES.filter(m => m.category === 'ai').length} modules\n` +
      `⚡ Automation: ${AI_MODULES.filter(m => m.category === 'automation').length} modules\n` +
      `📣 Advertising: ${AI_MODULES.filter(m => m.category === 'advertising').length} modules\n` +
      `📈 Analytics: ${AI_MODULES.filter(m => m.category === 'analytics').length} modules\n\n` +
      `🏢 IVX HOLDINGS LLC — Real Estate Investment Platform\n` +
      `support@ipxholding.com`
    );
    if (!WHATSAPP_NUMBER) {
      Alert.alert('No Phone Configured', 'Owner WhatsApp phone has been removed. Configure a new delivery number before sending reports.');
      return;
    }
    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`;
    Linking.openURL(url).then(() => {
      setReportSent(true);
      setTimeout(() => setReportSent(false), 4000);
    }).catch(() => {
      Alert.alert('WhatsApp Not Found', 'Please install WhatsApp to send reports, or use SMS/Copy below.');
    });
  }, []);

  const handleSendSMS = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const totalFunctions = AI_MODULES.reduce((sum, m) => sum + m.functionalities.length, 0);
    const msg = `IVXHOLDINGS AI REPORT: ${AI_MODULES.length} modules, ${totalFunctions} automated functions active. AI, Automation, Advertising & Analytics all running. - IVX HOLDINGS LLC`;
    if (!WHATSAPP_NUMBER) {
      Alert.alert('No Phone Configured', 'Owner SMS phone has been removed. Configure a new delivery number before sending reports.');
      return;
    }
    const url = Platform.OS === 'ios'
      ? `sms:${WHATSAPP_NUMBER}&body=${encodeURIComponent(msg)}`
      : `sms:${WHATSAPP_NUMBER}?body=${encodeURIComponent(msg)}`;
    Linking.openURL(url).catch(() => Alert.alert('SMS Error', 'Could not open SMS app.'));
  }, []);

  const handleCopyReport = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const totalFunctions = AI_MODULES.reduce((sum, m) => sum + m.functionalities.length, 0);
    const report =
      `IVXHOLDINGS AI & AUTOMATION FULL REPORT\n` +
      `Generated: ${new Date().toLocaleString()}\n\n` +
      `TOTAL: ${AI_MODULES.length} Modules | ${totalFunctions} Functions\n\n` +
      AI_MODULES.map(m =>
        `${m.number}. ${m.title.toUpperCase()}\n` +
        `   Category: ${CATEGORY_LABELS[m.category]}\n` +
        `   Status: ${m.status === 'active' ? 'ACTIVE' : 'COMING SOON'}\n` +
        `   Functions (${m.functionalities.length}):\n` +
        m.functionalities.map(f => `   - ${f}`).join('\n')
      ).join('\n\n');
    await Clipboard.setStringAsync(report);
    Alert.alert('Copied!', 'Full report copied to clipboard.');
  }, []);

  const handleShare = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const totalFunctions = AI_MODULES.reduce((sum, m) => sum + m.functionalities.length, 0);
    try {
      await Share.share({
        message: `IVXHOLDINGS AI & Automation: ${AI_MODULES.length} modules, ${totalFunctions} automated functions. Categories: AI, Automation, Advertising, Analytics. — IVX HOLDINGS LLC`,
        title: 'IVXHOLDINGS AI & Automation Report'});
    } catch (e) {
      console.log('[AIReport] Share error:', e);
    }
  }, []);

  const totalFunctions = AI_MODULES.reduce((sum, m) => sum + m.functionalities.length, 0);
  const filters = ['all', 'ai', 'automation', 'advertising', 'analytics'];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={styles.safe}>
        <Animated.View style={[styles.header, { opacity: headerAnim, transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>AI & Automation</Text>
            <Text style={styles.headerSub}>Full Module Report</Text>
          </View>
          <TouchableOpacity style={styles.shareHeaderBtn} onPress={handleShare}>
            <Share2 size={20} color={Colors.primary} />
          </TouchableOpacity>
        </Animated.View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

          <Animated.View style={[styles.heroCard, { opacity: headerAnim }]}>
            <View style={styles.heroRow}>
              <Animated.View style={[styles.heroBrain, { transform: [{ scale: pulseAnim }] }]}>
                <Brain size={32} color={Colors.primary} />
              </Animated.View>
              <View style={styles.heroStats}>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatNum}>{AI_MODULES.length}</Text>
                  <Text style={styles.heroStatLabel}>Modules</Text>
                </View>
                <View style={styles.heroStatDivider} />
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatNum}>{totalFunctions}</Text>
                  <Text style={styles.heroStatLabel}>Functions</Text>
                </View>
                <View style={styles.heroStatDivider} />
                <View style={styles.heroStat}>
                  <Text style={[styles.heroStatNum, { color: Colors.success }]}>ALL</Text>
                  <Text style={styles.heroStatLabel}>Active</Text>
                </View>
              </View>
            </View>
            <View style={styles.categoryPills}>
              {(['ai', 'automation', 'advertising', 'analytics'] as const).map(cat => (
                <View key={cat} style={[styles.heroCatPill, { borderColor: CATEGORY_COLORS[cat] + '60', backgroundColor: CATEGORY_COLORS[cat] + '18' }]}>
                  <View style={[styles.heroCatDot, { backgroundColor: CATEGORY_COLORS[cat] }]} />
                  <Text style={[styles.heroCatText, { color: CATEGORY_COLORS[cat] }]}>
                    {AI_MODULES.filter(m => m.category === cat).length} {CATEGORY_LABELS[cat]}
                  </Text>
                </View>
              ))}
            </View>
          </Animated.View>

          <View style={styles.whatsappCard}>
            <View style={styles.whatsappHeader}>
              <View style={styles.whatsappLeft}>
                <View style={styles.waIconWrap}>
                  <Phone size={18} color='#25D366' />
                </View>
                <View>
                  <Text style={styles.waTitle}>WhatsApp Report Alerts</Text>
                  <Text style={styles.waSub}>Receive updates after every ad campaign</Text>
                </View>
              </View>
              <Switch
                value={whatsappEnabled}
                onValueChange={(v) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWhatsappEnabled(v); }}
                trackColor={{ false: Colors.backgroundTertiary, true: '#25D36650' }}
                thumbColor={whatsappEnabled ? '#25D366' : Colors.textTertiary}
              />
            </View>

            {whatsappEnabled && (
              <View style={styles.waBody}>
                <View style={styles.waPhoneRow}>
                  <Smartphone size={16} color={Colors.textSecondary} />
                  <Text style={styles.waPhoneLabel}>Delivery Number:</Text>
                  <Text style={styles.waPhoneNum}>{OWNER_DISPLAY}</Text>
                  <View style={styles.waVerifiedBadge}>
                    <CheckCircle size={12} color={Colors.success} />
                    <Text style={styles.waVerifiedText}>Set</Text>
                  </View>
                </View>

                <View style={styles.waAlertTypes}>
                  <Text style={styles.waAlertTitle}>Alert Triggers:</Text>
                  {[
                    'New property published → instant alert',
                    'AI image campaign generated',
                    'Video presentation shared',
                    'New investor referral converted',
                    'Influencer campaign milestone',
                    'Daily analytics summary',
                  ].map((item, i) => (
                    <View key={i} style={styles.waAlertRow}>
                      <CheckCircle size={13} color='#25D366' />
                      <Text style={styles.waAlertText}>{item}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.waActionRow}>
                  <TouchableOpacity
                    style={[styles.waBtn, { backgroundColor: '#25D366' }]}
                    onPress={handleSendWhatsApp}
                    testID="send-whatsapp-report"
                  >
                    {reportSent ? (
                      <CheckCircle size={16} color={Colors.white} />
                    ) : (
                      <Send size={16} color={Colors.white} />
                    )}
                    <Text style={styles.waBtnText}>{reportSent ? 'Sent!' : 'Send Full Report'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.waBtn, { backgroundColor: Colors.surfaceLight, flex: 0.45 }]} onPress={handleSendSMS}>
                    <Smartphone size={16} color={Colors.text} />
                    <Text style={[styles.waBtnText, { color: Colors.text }]}>SMS</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.waCopyBtn} onPress={handleCopyReport}>
                  <Copy size={14} color={Colors.textSecondary} />
                  <Text style={styles.waCopyText}>Copy full report to clipboard</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View style={styles.filterRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
              {filters.map(f => (
                <TouchableOpacity
                  key={f}
                  style={[
                    styles.filterChip,
                    activeFilter === f && {
                      backgroundColor: f === 'all' ? Colors.primary : CATEGORY_COLORS[f],
                      borderColor: f === 'all' ? Colors.primary : CATEGORY_COLORS[f]},
                  ]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveFilter(f); }}
                >
                  <Text style={[styles.filterChipText, activeFilter === f && { color: f === 'all' ? Colors.black : Colors.white, fontWeight: '700' as const }]}>
                    {f === 'all' ? 'All Modules' : CATEGORY_LABELS[f]}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <Text style={styles.sectionLabel}>
            {filtered.length} {activeFilter === 'all' ? 'Total' : CATEGORY_LABELS[activeFilter]} Module{filtered.length !== 1 ? 's' : ''}
          </Text>

          {filtered.map((mod, i) => {
            const Icon = mod.icon;
            const isExpanded = expandedId === mod.id;
            const anim = cardAnims[AI_MODULES.indexOf(mod)];

            return (
              <Animated.View
                key={mod.id}
                style={[styles.moduleCard, {
                  opacity: anim,
                  transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
                  borderLeftColor: mod.color}]}
              >
                <TouchableOpacity
                  style={styles.moduleHeader}
                  onPress={() => toggleExpand(mod.id)}
                  activeOpacity={0.8}
                  testID={`module-${mod.id}`}
                >
                  <View style={[styles.moduleNumBadge, { backgroundColor: mod.color + '20', borderColor: mod.color + '40' }]}>
                    <Text style={[styles.moduleNum, { color: mod.color }]}>{mod.number}</Text>
                  </View>
                  <View style={[styles.moduleIconWrap, { backgroundColor: mod.color + '18' }]}>
                    <Icon size={20} color={mod.color} />
                  </View>
                  <View style={styles.moduleMeta}>
                    <View style={styles.moduleTitleRow}>
                      <Text style={styles.moduleTitle} numberOfLines={2}>{mod.title}</Text>
                    </View>
                    <View style={styles.moduleBadgeRow}>
                      <View style={[styles.catBadge, { backgroundColor: CATEGORY_COLORS[mod.category] + '20' }]}>
                        <Text style={[styles.catBadgeText, { color: CATEGORY_COLORS[mod.category] }]}>{CATEGORY_LABELS[mod.category]}</Text>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: mod.status === 'active' ? Colors.success + '20' : Colors.warning + '20' }]}>
                        <View style={[styles.statusDot, { backgroundColor: mod.status === 'active' ? Colors.success : Colors.warning }]} />
                        <Text style={[styles.statusText, { color: mod.status === 'active' ? Colors.success : Colors.warning }]}>
                          {mod.status === 'active' ? 'Active' : 'Soon'}
                        </Text>
                      </View>
                      <Text style={styles.funcCount}>{mod.functionalities.length} functions</Text>
                    </View>
                  </View>
                  <View style={styles.expandIcon}>
                    {isExpanded
                      ? <ChevronUp size={18} color={Colors.textTertiary} />
                      : <ChevronDown size={18} color={Colors.textTertiary} />}
                  </View>
                </TouchableOpacity>

                {isExpanded && (
                  <View style={styles.moduleBody}>
                    <Text style={styles.moduleDesc}>{mod.description}</Text>
                    <View style={styles.funcDivider} />
                    <Text style={styles.funcListTitle}>All Functionalities:</Text>
                    {mod.functionalities.map((func, fi) => (
                      <View key={fi} style={styles.funcRow}>
                        <View style={[styles.funcBullet, { backgroundColor: mod.color }]} />
                        <Text style={styles.funcText}>{func}</Text>
                      </View>
                    ))}
                    {mod.route && (
                      <TouchableOpacity
                        style={[styles.openModuleBtn, { borderColor: mod.color + '50', backgroundColor: mod.color + '10' }]}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(mod.route as any); }}
                      >
                        <Icon size={15} color={mod.color} />
                        <Text style={[styles.openModuleBtnText, { color: mod.color }]}>Open Module</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </Animated.View>
            );
          })}

          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Total Automation Summary</Text>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryNum, { color: '#A855F7' }]}>{AI_MODULES.filter(m => m.category === 'ai').length}</Text>
                <Text style={styles.summaryLabel}>AI Modules</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryNum, { color: '#00C48C' }]}>{AI_MODULES.filter(m => m.category === 'automation').length}</Text>
                <Text style={styles.summaryLabel}>Automation</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryNum, { color: '#FF6B35' }]}>{AI_MODULES.filter(m => m.category === 'advertising').length}</Text>
                <Text style={styles.summaryLabel}>Advertising</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryNum, { color: '#4A90D9' }]}>{AI_MODULES.filter(m => m.category === 'analytics').length}</Text>
                <Text style={styles.summaryLabel}>Analytics</Text>
              </View>
            </View>
            <View style={styles.summaryTotal}>
              <Activity size={16} color={Colors.primary} />
              <Text style={styles.summaryTotalText}>{totalFunctions} Total Automated Functions Running 24/7</Text>
            </View>
          </View>

          <View style={styles.bottomPad} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safe: { flex: 1 },
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
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  headerCenter: { flex: 1 },
  headerTitle: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  headerSub: { color: Colors.textTertiary, fontSize: 12, marginTop: 1 },
  shareHeaderBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center'},
  scroll: { paddingHorizontal: 16, paddingTop: 4 },

  heroCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '30'},
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 14 },
  heroBrain: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: Colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.primary + '40'},
  heroStats: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  heroStat: { alignItems: 'center', gap: 2 },
  heroStatNum: { color: Colors.primary, fontSize: 26, fontWeight: '800' as const },
  heroStatLabel: { color: Colors.textSecondary, fontSize: 11 },
  heroStatDivider: { width: 1, height: 36, backgroundColor: Colors.surfaceBorder },
  categoryPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  heroCatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1},
  heroCatDot: { width: 7, height: 7, borderRadius: 4 },
  heroCatText: { fontSize: 12, fontWeight: '600' as const },

  whatsappCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#25D36630'},
  whatsappHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  whatsappLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  waIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#25D36620',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#25D36640'},
  waTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  waSub: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
  waBody: { marginTop: 14 },
  waPhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14},
  waPhoneLabel: { color: Colors.textSecondary, fontSize: 12 },
  waPhoneNum: { color: Colors.text, fontSize: 13, fontWeight: '700' as const, flex: 1 },
  waVerifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.success + '20',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8},
  waVerifiedText: { color: Colors.success, fontSize: 11, fontWeight: '600' as const },
  waAlertTypes: { marginBottom: 14 },
  waAlertTitle: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' as const, marginBottom: 8 },
  waAlertRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  waAlertText: { color: Colors.text, fontSize: 13 },
  waActionRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  waBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12},
  waBtnText: { color: Colors.white, fontSize: 14, fontWeight: '700' as const },
  waCopyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8},
  waCopyText: { color: Colors.textSecondary, fontSize: 12 },

  filterRow: { marginBottom: 12 },
  filterScroll: { gap: 8, paddingRight: 8 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface},
  filterChipText: { color: Colors.textSecondary, fontSize: 13 },

  sectionLabel: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10},

  moduleCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderLeftWidth: 3,
    overflow: 'hidden'},
  moduleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10},
  moduleNumBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    flexShrink: 0},
  moduleNum: { fontSize: 12, fontWeight: '800' as const },
  moduleIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0},
  moduleMeta: { flex: 1, gap: 6, minWidth: 0 },
  moduleTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  moduleTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const, flexShrink: 1 },
  moduleBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  catBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  catBadgeText: { fontSize: 10, fontWeight: '700' as const },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6},
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: '600' as const },
  funcCount: { color: Colors.textTertiary, fontSize: 10 },
  expandIcon: { flexShrink: 0 },

  moduleBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: 12},
  moduleDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 10 },
  funcDivider: { height: 1, backgroundColor: Colors.surfaceBorder, marginBottom: 10 },
  funcListTitle: { color: Colors.textTertiary, fontSize: 11, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  funcRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 7 },
  funcBullet: { width: 5, height: 5, borderRadius: 3, marginTop: 6, flexShrink: 0 },
  funcText: { color: Colors.text, fontSize: 13, lineHeight: 19, flex: 1 },
  openModuleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1},
  openModuleBtnText: { fontSize: 13, fontWeight: '700' as const },

  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 18,
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  summaryTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const, marginBottom: 14 },
  summaryGrid: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 14 },
  summaryItem: { alignItems: 'center', gap: 4 },
  summaryNum: { fontSize: 28, fontWeight: '800' as const },
  summaryLabel: { color: Colors.textSecondary, fontSize: 11 },
  summaryTotal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primary + '12',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.primary + '25'},
  summaryTotalText: { color: Colors.primary, fontSize: 13, fontWeight: '600' as const, flex: 1 },
  bottomPad: { height: 50 }});
