/**
 * IVX Intent Engine — Public SEO Landing Page
 * Dynamic route: /invest/[slug] — serves auto-generated SEO pages
 * with ROI calculator, investment calculator, FAQ, AI chat, registration.
 */
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Alert,
  useWindowDimensions} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, Stack, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  TrendingUp,
  Calculator,
  MessageCircle,
  Send,
  Shield,
  Clock,
  ChevronDown,
  ChevronUp,
  Calendar,
  CheckCircle2,
  DollarSign,
  Bot,
  User,
  Sparkles,
  MapPin} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { EmptyState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import { DIRECT_API_BASE_URL } from '@/lib/public-api';

interface LandingPageData {
  id: string;
  slug: string;
  title: string;
  meta_description: string | null;
  h1: string | null;
  country: string;
  language: string;
  has_roi_calculator: boolean;
  has_investment_calculator: boolean;
  has_faq: boolean;
  has_ai_chat: boolean;
  has_registration: boolean;
  has_kyc: boolean;
  has_schedule_meeting: boolean;
  has_live_opportunities: boolean;
  organic_visitors: number;
  registrations: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
}

const FAQ_ITEMS = [
  { q: 'What is the minimum investment?', a: 'IVX investments start from $10K for tokenized properties and $100K+ for direct ownership. Accredited investor deals typically start at $250K.' },
  { q: 'What returns can I expect?', a: 'Historical IVX investments deliver 8–14% IRR with 6–9% cash-on-cash returns. Projected returns vary by deal — each listing includes detailed financial projections.' },
  { q: 'How long is the investment timeline?', a: 'Timelines vary: fix-and-flip 6–12 months, rental income ongoing, development 18–36 months, tokenized flexible exit. Each deal shows its projected timeline.' },
  { q: 'What documents do I need?', a: 'You will need: subscription agreement, operating agreement (for syndications), KYC documents (government ID + proof of address), and proof of funds.' },
  { q: 'Is my investment secured?', a: 'Yes. IVX uses title insurance, property insurance, and conservative leverage. All investments are documented with legal agreements and recorded ownership interests.' },
  { q: 'Can I sell my investment early?', a: 'Exit options depend on the investment structure. Tokenized properties offer flexible exit, while syndications typically have a defined hold period with possible secondary market options.' },
];

const API_BASE = DIRECT_API_BASE_URL || 'https://api.ivxholding.com';

export default function InvestLandingPage() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { width } = useWindowDimensions();

  const [pageData, setPageData] = useState<LandingPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ROI Calculator state
  const [investmentAmount, setInvestmentAmount] = useState('500000');
  const [expectedReturn, setExpectedReturn] = useState('12');
  const [years, setYears] = useState('5');
  const [showRoiResult, setShowRoiResult] = useState(false);

  // AI Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'Hi! I\'m the IVX AI investment assistant. Ask me about ROI, risks, timelines, or how to get started investing.', ts: new Date().toISOString() },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // Registration state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regSubmitted, setRegSubmitted] = useState(false);

  // FAQ state
  const [expandedFaq, setExpandedFaq] = useState<number | null>(0);

  // Visitor tracking
  const [visitorId] = useState(() => `visitor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    loadPageData();
    trackVisitor();
  }, [slug]);

  const loadPageData = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ivx/intent-engine/page/${encodeURIComponent(slug)}`);
      const json = await res.json() as Record<string, unknown>;
      if (json.ok && json.result) {
        setPageData(json.result as LandingPageData);
      } else {
        setError((json.error as string) ?? 'Page not found');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load page');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  const trackVisitor = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/ivx/intent-engine/visitor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitor_id: visitorId,
          landing_page_slug: slug,
          pages_viewed: [slug],
          registration_status: 'anonymous'})});
    } catch {
      // Silent fail — tracking is non-critical
    }
  }, [slug, visitorId]);

  // ROI calculation
  const roiResult = useMemo(() => {
    const principal = parseFloat(investmentAmount) || 0;
    const rate = (parseFloat(expectedReturn) || 0) / 100;
    const yearsNum = parseFloat(years) || 0;
    if (principal <= 0 || rate <= 0 || yearsNum <= 0) return null;
    const futureValue = principal * Math.pow(1 + rate, yearsNum);
    const profit = futureValue - principal;
    const annualCashFlow = principal * rate;
    return {
      futureValue: Math.round(futureValue),
      profit: Math.round(profit),
      annualCashFlow: Math.round(annualCashFlow),
      monthlyCashFlow: Math.round(annualCashFlow / 12)};
  }, [investmentAmount, expectedReturn, years]);

  const formatCurrency = (value: number): string => {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  };

  const sendChatMessage = useCallback(async () => {
    if (!chatInput.trim()) return;
    const message = chatInput.trim();
    setChatInput('');
    setChatMessages((prev) => [...prev, { role: 'user', content: message, ts: new Date().toISOString() }]);
    setChatLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const res = await fetch(`${API_BASE}/api/ivx/intent-engine/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitor_id: visitorId, landing_page_slug: slug, message })});
      const json = await res.json() as Record<string, unknown>;
      const result = json.result as { reply: string; intent_detected: string } | undefined;
      const reply = result?.reply ?? 'I apologize — I could not process your request. Please try again or contact IVX directly.';
      setChatMessages((prev) => [...prev, { role: 'assistant', content: reply, ts: new Date().toISOString() }]);
    } catch {
      setChatMessages((prev) => [...prev, {
        role: 'assistant',
        content: 'I\'m having trouble connecting right now. Please try again or contact IVX directly.',
        ts: new Date().toISOString()}]);
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, visitorId, slug]);

  const submitRegistration = useCallback(async () => {
    if (!regName.trim() || !regEmail.trim()) {
      Alert.alert('Required', 'Please enter your name and email to register.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await fetch(`${API_BASE}/api/ivx/intent-engine/visitor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitor_id: visitorId,
          registration_status: 'registered',
          pages_viewed: [slug]})});
      setRegSubmitted(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Error', 'Registration failed. Please try again.');
    }
  }, [regName, regEmail, visitorId, slug]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.loadingContainer}>
          <Animated.View style={styles.loadingSpinner}>
            <TrendingUp size={32} color={Colors.primary} />
          </Animated.View>
          <Text style={styles.loadingText}>Loading investment opportunities…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const pageTitle = pageData?.h1 ?? pageData?.title ?? 'IVX Real Estate Investment';
  const metaDesc = pageData?.meta_description ?? 'High-yield real estate investment opportunities with IVX Holding.';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Hero section */}
        <LinearGradient
          colors={['#0A0A0A', '#1A1500', '#0A0A0A']}
          style={styles.heroSection}
        >
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <ArrowLeft size={20} color={Colors.white} />
          </TouchableOpacity>
          <View style={styles.heroContent}>
            <View style={styles.heroBadge}>
              <Sparkles size={12} color={Colors.primary} />
              <Text style={styles.heroBadgeText}>IVX Investment Opportunity</Text>
            </View>
            <Text style={styles.heroTitle}>{pageTitle}</Text>
            <Text style={styles.heroDesc}>{metaDesc}</Text>
            <View style={styles.heroStats}>
              <View style={styles.heroStat}>
                <TrendingUp size={16} color={Colors.success} />
                <Text style={styles.heroStatValue}>8-14%</Text>
                <Text style={styles.heroStatLabel}>Target IRR</Text>
              </View>
              <View style={styles.heroStat}>
                <DollarSign size={16} color={Colors.primary} />
                <Text style={styles.heroStatValue}>$10K+</Text>
                <Text style={styles.heroStatLabel}>Min Investment</Text>
              </View>
              <View style={styles.heroStat}>
                <Shield size={16} color={Colors.blue} />
                <Text style={styles.heroStatValue}>Secured</Text>
                <Text style={styles.heroStatLabel}>Title Insured</Text>
              </View>
            </View>
          </View>
        </LinearGradient>

        {/* ROI Calculator */}
        {pageData?.has_roi_calculator !== false && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Calculator size={20} color={Colors.primary} />
              <Text style={styles.sectionTitle}>ROI Calculator</Text>
            </View>
            <View style={styles.calcCard}>
              <View style={styles.calcInputRow}>
                <Text style={styles.calcLabel}>Investment Amount</Text>
                <View style={styles.calcInputWrap}>
                  <DollarSign size={16} color={Colors.textTertiary} />
                  <TextInput
                    style={styles.calcInput}
                    value={investmentAmount}
                    onChangeText={setInvestmentAmount}
                    keyboardType="numeric"
                    placeholder="500000"
                    placeholderTextColor={Colors.textTertiary}
                  />
                </View>
              </View>
              <View style={styles.calcInputRow}>
                <Text style={styles.calcLabel}>Expected Annual Return (%)</Text>
                <View style={styles.calcInputWrap}>
                  <TextInput
                    style={styles.calcInput}
                    value={expectedReturn}
                    onChangeText={setExpectedReturn}
                    keyboardType="numeric"
                    placeholder="12"
                    placeholderTextColor={Colors.textTertiary}
                  />
                  <Text style={styles.calcSuffix}>%</Text>
                </View>
              </View>
              <View style={styles.calcInputRow}>
                <Text style={styles.calcLabel}>Investment Period (Years)</Text>
                <View style={styles.calcInputWrap}>
                  <TextInput
                    style={styles.calcInput}
                    value={years}
                    onChangeText={setYears}
                    keyboardType="numeric"
                    placeholder="5"
                    placeholderTextColor={Colors.textTertiary}
                  />
                  <Text style={styles.calcSuffix}>yrs</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.calcButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setShowRoiResult(true);
                }}
              >
                <Calculator size={16} color={Colors.black} />
                <Text style={styles.calcButtonText}>Calculate Returns</Text>
              </TouchableOpacity>
              {showRoiResult && roiResult && (
                <Animated.View style={styles.roiResultCard}>
                  <View style={styles.roiResultRow}>
                    <Text style={styles.roiResultLabel}>Future Value</Text>
                    <Text style={styles.roiResultValue}>{formatCurrency(roiResult.futureValue)}</Text>
                  </View>
                  <View style={styles.roiResultRow}>
                    <Text style={styles.roiResultLabel}>Total Profit</Text>
                    <Text style={[styles.roiResultValue, { color: Colors.success }]}>{formatCurrency(roiResult.profit)}</Text>
                  </View>
                  <View style={styles.roiResultRow}>
                    <Text style={styles.roiResultLabel}>Annual Cash Flow</Text>
                    <Text style={styles.roiResultValue}>{formatCurrency(roiResult.annualCashFlow)}</Text>
                  </View>
                  <View style={styles.roiResultRow}>
                    <Text style={styles.roiResultLabel}>Monthly Cash Flow</Text>
                    <Text style={styles.roiResultValue}>{formatCurrency(roiResult.monthlyCashFlow)}</Text>
                  </View>
                </Animated.View>
              )}
            </View>
          </View>
        )}

        {/* AI Chat */}
        {pageData?.has_ai_chat !== false && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Bot size={20} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Ask IVX AI</Text>
            </View>
            <View style={styles.chatCard}>
              <View style={styles.chatMessages}>
                {chatMessages.map((msg, i) => (
                  <View key={i} style={[styles.chatMsg, msg.role === 'user' ? styles.chatMsgUser : styles.chatMsgBot]}>
                    {msg.role === 'assistant' && <Bot size={14} color={Colors.primary} />}
                    {msg.role === 'user' && <User size={14} color={Colors.textSecondary} />}
                    <Text style={[styles.chatMsgText, msg.role === 'user' && styles.chatMsgTextUser]}>
                      {msg.content}
                    </Text>
                  </View>
                ))}
                {chatLoading && (
                  <View style={[styles.chatMsg, styles.chatMsgBot]}>
                    <Bot size={14} color={Colors.primary} />
                    <Text style={styles.chatMsgText}>Typing…</Text>
                  </View>
                )}
              </View>
              <View style={styles.chatInputRow}>
                <TextInput
                  style={styles.chatInput}
                  value={chatInput}
                  onChangeText={setChatInput}
                  placeholder="Ask about ROI, risks, timeline…"
                  placeholderTextColor={Colors.textTertiary}
                  onSubmitEditing={sendChatMessage}
                />
                <TouchableOpacity style={styles.chatSendBtn} onPress={sendChatMessage} disabled={chatLoading}>
                  <Send size={16} color={Colors.black} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* FAQ */}
        {pageData?.has_faq !== false && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <MessageCircle size={20} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
            </View>
            {FAQ_ITEMS.map((faq, i) => (
              <TouchableOpacity
                key={i}
                style={styles.faqItem}
                onPress={() => {
                  Haptics.selectionAsync();
                  setExpandedFaq(expandedFaq === i ? null : i);
                }}
              >
                <View style={styles.faqHeader}>
                  <Text style={styles.faqQuestion}>{faq.q}</Text>
                  {expandedFaq === i ? (
                    <ChevronUp size={16} color={Colors.primary} />
                  ) : (
                    <ChevronDown size={16} color={Colors.textTertiary} />
                  )}
                </View>
                {expandedFaq === i && (
                  <Text style={styles.faqAnswer}>{faq.a}</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Registration */}
        {pageData?.has_registration !== false && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <User size={20} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Get Investor Access</Text>
            </View>
            {regSubmitted ? (
              <View style={styles.regSuccess}>
                <CheckCircle2 size={40} color={Colors.success} />
                <Text style={styles.regSuccessTitle}>Registration Received!</Text>
                <Text style={styles.regSuccessText}>
                  Check your email for next steps. You will receive access to live investment opportunities within 24 hours.
                </Text>
              </View>
            ) : (
              <View style={styles.regCard}>
                <Text style={styles.regSubtitle}>
                  Register to access private deals, ROI projections, and schedule a consultation with an IVX advisor.
                </Text>
                <TextInput
                  style={styles.regInput}
                  value={regName}
                  onChangeText={setRegName}
                  placeholder="Full Name"
                  placeholderTextColor={Colors.textTertiary}
                />
                <TextInput
                  style={styles.regInput}
                  value={regEmail}
                  onChangeText={setRegEmail}
                  placeholder="Email Address"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <TextInput
                  style={styles.regInput}
                  value={regPhone}
                  onChangeText={setRegPhone}
                  placeholder="Phone (Optional)"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="phone-pad"
                />
                <TouchableOpacity style={styles.regButton} onPress={submitRegistration}>
                  <Text style={styles.regButtonText}>Get Investor Access</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Schedule Meeting */}
        {pageData?.has_schedule_meeting !== false && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.meetingCard}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                router.push('/become-investor');
              }}
            >
              <View style={styles.meetingLeft}>
                <Calendar size={24} color={Colors.primary} />
                <View>
                  <Text style={styles.meetingTitle}>Schedule a Consultation</Text>
                  <Text style={styles.meetingDesc}>Talk to an IVX investment advisor</Text>
                </View>
              </View>
              <ArrowLeft size={20} color={Colors.primary} style={{ transform: [{ rotate: '180deg' }] }} />
            </TouchableOpacity>
          </View>
        )}

        {/* Trust indicators */}
        <View style={styles.trustSection}>
          <View style={styles.trustRow}>
            <Shield size={14} color={Colors.textSecondary} />
            <Text style={styles.trustText}>Title Insured</Text>
          </View>
          <View style={styles.trustRow}>
            <CheckCircle2 size={14} color={Colors.textSecondary} />
            <Text style={styles.trustText}>KYC Verified</Text>
          </View>
          <View style={styles.trustRow}>
            <Clock size={14} color={Colors.textSecondary} />
            <Text style={styles.trustText}>24-48h Onboarding</Text>
          </View>
          <View style={styles.trustRow}>
            <MapPin size={14} color={Colors.textSecondary} />
            <Text style={styles.trustText}>Florida · Dubai · Global</Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingSpinner: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Colors.primary + '20', justifyContent: 'center', alignItems: 'center'},
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  scrollView: { flex: 1 },
  backBtn: { padding: 12, marginLeft: 4 },
  heroSection: { paddingTop: 8, paddingBottom: 32, paddingHorizontal: 16 },
  heroContent: { gap: 14 },
  heroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary + '15', paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 20, alignSelf: 'flex-start'},
  heroBadgeText: { color: Colors.primary, fontSize: 11, fontWeight: '700' },
  heroTitle: { color: Colors.white, fontSize: 26, fontWeight: '800', lineHeight: 34 },
  heroDesc: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
  heroStats: { flexDirection: 'row', gap: 16, marginTop: 8 },
  heroStat: { alignItems: 'center', gap: 2 },
  heroStatValue: { color: Colors.white, fontSize: 16, fontWeight: '700' },
  heroStatLabel: { color: Colors.textTertiary, fontSize: 10 },
  section: { paddingHorizontal: 16, paddingTop: 28 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { color: Colors.white, fontSize: 18, fontWeight: '700' },
  calcCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, gap: 14 },
  calcInputRow: { gap: 6 },
  calcLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  calcInputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.backgroundSecondary, borderRadius: 10, paddingHorizontal: 12},
  calcInput: { flex: 1, color: Colors.white, fontSize: 16, paddingVertical: 12 },
  calcSuffix: { color: Colors.textTertiary, fontSize: 14 },
  calcButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14},
  calcButtonText: { color: Colors.black, fontSize: 15, fontWeight: '700' },
  roiResultCard: { backgroundColor: Colors.backgroundSecondary, borderRadius: 12, padding: 14, gap: 8, marginTop: 4 },
  roiResultRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  roiResultLabel: { color: Colors.textSecondary, fontSize: 13 },
  roiResultValue: { color: Colors.white, fontSize: 15, fontWeight: '700' },
  chatCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 14, gap: 12 },
  chatMessages: { gap: 8, maxHeight: 300 },
  chatMsg: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, maxWidth: '90%' },
  chatMsgBot: { backgroundColor: Colors.backgroundSecondary, alignSelf: 'flex-start' },
  chatMsgUser: { backgroundColor: Colors.primary + '15', alignSelf: 'flex-end' },
  chatMsgText: { color: Colors.white, fontSize: 13, lineHeight: 18, flex: 1 },
  chatMsgTextUser: { color: Colors.white },
  chatInputRow: { flexDirection: 'row', gap: 8 },
  chatInput: {
    flex: 1, backgroundColor: Colors.backgroundSecondary, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, color: Colors.white, fontSize: 14},
  chatSendBtn: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center'},
  faqItem: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, marginBottom: 8 },
  faqHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  faqQuestion: { color: Colors.white, fontSize: 14, fontWeight: '600', flex: 1 },
  faqAnswer: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 8 },
  regCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, gap: 12 },
  regSubtitle: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  regInput: {
    backgroundColor: Colors.backgroundSecondary, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, color: Colors.white, fontSize: 15},
  regButton: {
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginTop: 4},
  regButtonText: { color: Colors.black, fontSize: 15, fontWeight: '700' },
  regSuccess: { backgroundColor: Colors.surface, borderRadius: 16, padding: 28, alignItems: 'center', gap: 10 },
  regSuccessTitle: { color: Colors.success, fontSize: 18, fontWeight: '700' },
  regSuccessText: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  meetingCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16},
  meetingLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  meetingTitle: { color: Colors.white, fontSize: 15, fontWeight: '700' },
  meetingDesc: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  trustSection: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 16, justifyContent: 'center',
    paddingHorizontal: 16, paddingTop: 32, paddingBottom: 8},
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trustText: { color: Colors.textSecondary, fontSize: 12 }});
