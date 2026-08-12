import React, { useState, useRef, useCallback } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  useWindowDimensions} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Home,
  Briefcase,
  TrendingUp,
  Landmark,
  MessageCircle,
  User,
  ChevronDown,
  ChevronRight,
  Shield,
  Wallet,
  CreditCard,
  Search,
  Filter,
  Heart,
  BarChart3,
  PieChart,
  ArrowUpDown,
  Gift,
  Bell,
  FileText,
  LayoutDashboard,
  Users,
  Building2,
  Megaphone,
  Settings,
  Sparkles,
  Target,
  Zap,
  BookOpen,
  CircleDot,
  CheckCircle2,
  Globe,
  Lock,
  Star,
  Clock,
  AlertTriangle,
  Code2,
  Rocket,
  CalendarDays,
  ListChecks,
  Timer,
  Layers,
  Server,
  Key,
  Database,
  Package} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { RefreshControl } from 'react-native';

interface GuideStep {
  icon: React.ReactNode;
  text: string;
}

interface GuideSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  color: string;
  description: string;
  steps: GuideStep[];
  proTip?: string;
}

interface LaunchTask {
  label: string;
  hours: string;
  priority: 'critical' | 'high' | 'medium';
  done: boolean;
}

interface LaunchWeek {
  week: number;
  title: string;
  color: string;
  tasks: LaunchTask[];
}

const LAUNCH_PLAN: LaunchWeek[] = [
  {
    week: 1,
    title: 'APIs, Backend & Integrations',
    color: '#FF6B6B',
    tasks: [
      { label: 'Activate SendGrid — automated property alert emails', hours: '4–8h', priority: 'critical', done: false },
      { label: 'Activate Twilio — WhatsApp/SMS notifications', hours: '4–8h', priority: 'critical', done: false },
      { label: 'Configure Plaid — bank link & ACH deposits', hours: '8–12h', priority: 'critical', done: false },
      { label: 'Configure Stripe — card payments & payouts', hours: '6–10h', priority: 'critical', done: false },
      { label: 'Confirm IVX AI Gateway AI wiring — workspace assistant & content generation', hours: '2–4h', priority: 'high', done: false },
      { label: 'Set up KYC provider (Persona/Jumio) production keys', hours: '8–16h', priority: 'critical', done: false },
      { label: 'Configure push notifications (Expo + APNs + FCM)', hours: '4–6h', priority: 'high', done: false },
    ]},
  {
    week: 2,
    title: 'QA Testing & Content',
    color: '#F59E0B',
    tasks: [
      { label: 'Add real property listings with images & documents', hours: '8–12h', priority: 'high', done: false },
      { label: 'Test full investor onboarding flow (signup → KYC → invest)', hours: '4–6h', priority: 'critical', done: false },
      { label: 'Test wallet: deposit, withdraw, ACH, wire, card', hours: '4–6h', priority: 'critical', done: false },
      { label: 'Test email automation on property publish', hours: '2–4h', priority: 'high', done: false },
      { label: 'Test WhatsApp/SMS reports to the configured alert number', hours: '2–3h', priority: 'high', done: false },
      { label: 'Test AI automation & analytics modules', hours: '3–4h', priority: 'medium', done: false },
      { label: 'Cross-platform testing: iOS + Android + Web', hours: '6–8h', priority: 'critical', done: false },
    ]},
  {
    week: 3,
    title: 'App Store Submission',
    color: '#00C48C',
    tasks: [
      { label: 'Prepare App Store screenshots & preview video', hours: '4–6h', priority: 'high', done: false },
      { label: 'Write App Store description & keywords (ASO)', hours: '2–3h', priority: 'high', done: false },
      { label: 'Build production iOS & Android (EAS Build)', hours: '4–8h', priority: 'critical', done: false },
      { label: 'Submit to Apple App Store (review: 1–3 days)', hours: '2h + wait', priority: 'critical', done: false },
      { label: 'Submit to Google Play Store (review: 1–2 days)', hours: '2h + wait', priority: 'critical', done: false },
      { label: 'Configure production environment variables', hours: '2–3h', priority: 'critical', done: false },
    ]},
];

const PRIORITY_72H: string[] = [
  'Activate SendGrid email API — needed for property alert system',
  'Activate Twilio API — needed for WhatsApp/SMS automation reports',
  'Set Stripe & Plaid production keys — needed for live payments',
  'Set KYC provider production keys — needed for identity verification (open to all investors)',
  'Confirm IVX AI Gateway AI routing — needed for AI chat & content generation',
  'Configure APNs & FCM certificates — needed for push notifications',
];

function DeveloperLaunchPlan() {
  const [expandedWeek, setExpandedWeek] = useState<number | null>(0);

  return (
    <View style={devStyles.container}>
      <View style={devStyles.header}>
        <View style={devStyles.rocketBadge}>
          <Rocket size={18} color="#fff" />
        </View>
        <View style={devStyles.headerText}>
          <Text style={devStyles.headerTitle}>Developer Launch Plan</Text>
          <Text style={devStyles.headerSub}>3-Week Roadmap to App Store</Text>
        </View>
        <View style={devStyles.countdownBadge}>
          <Timer size={12} color={Colors.primary} />
          <Text style={devStyles.countdownText}>3 Weeks</Text>
        </View>
      </View>

      <View style={devStyles.alertBox}>
        <AlertTriangle size={14} color="#F59E0B" />
        <Text style={devStyles.alertText}>
          ⚡ 72-Hour Priority: Activate all APIs before development starts
        </Text>
      </View>

      <View style={devStyles.section72}>
        <View style={devStyles.section72Header}>
          <Clock size={16} color="#FF6B6B" />
          <Text style={devStyles.section72Title}>First 72 Hours — Critical API Setup</Text>
        </View>
        {PRIORITY_72H.map((task, i) => (
          <View key={i} style={devStyles.task72Row}>
            <View style={devStyles.task72Dot} />
            <Text style={devStyles.task72Text}>{task}</Text>
          </View>
        ))}
        <View style={devStyles.timeNote}>
          <Text style={devStyles.timeNoteText}>⏱ Same 72h estimate — APIs still need activation before coding begins</Text>
        </View>
      </View>

      {LAUNCH_PLAN.map((week) => (
        <View key={week.week} style={[devStyles.weekCard, { borderLeftColor: week.color }]}>
          <TouchableOpacity
            style={devStyles.weekHeader}
            onPress={() => setExpandedWeek(expandedWeek === week.week - 1 ? null : week.week - 1)}
            activeOpacity={0.7}
          >
            <View style={[devStyles.weekBadge, { backgroundColor: week.color + '20' }]}>
              <CalendarDays size={14} color={week.color} />
              <Text style={[devStyles.weekLabel, { color: week.color }]}>Week {week.week}</Text>
            </View>
            <Text style={devStyles.weekTitle}>{week.title}</Text>
            <View style={[devStyles.taskCount, { backgroundColor: week.color + '20' }]}>
              <Text style={[devStyles.taskCountText, { color: week.color }]}>{week.tasks.length} tasks</Text>
            </View>
          </TouchableOpacity>
          {expandedWeek === week.week - 1 && (
            <View style={devStyles.taskList}>
              {week.tasks.map((task, i) => (
                <View key={i} style={devStyles.taskRow}>
                  <View style={[
                    devStyles.priorityDot,
                    { backgroundColor: task.priority === 'critical' ? '#FF6B6B' : task.priority === 'high' ? '#F59E0B' : '#00C48C' }
                  ]} />
                  <View style={devStyles.taskInfo}>
                    <Text style={devStyles.taskLabel}>{task.label}</Text>
                    <View style={devStyles.taskMeta}>
                      <Clock size={10} color={Colors.textTertiary} />
                      <Text style={devStyles.taskHours}>{task.hours}</Text>
                      <View style={[
                        devStyles.priorityBadge,
                        { backgroundColor: task.priority === 'critical' ? '#FF6B6B20' : task.priority === 'high' ? '#F59E0B20' : '#00C48C20' }
                      ]}>
                        <Text style={[
                          devStyles.priorityText,
                          { color: task.priority === 'critical' ? '#FF6B6B' : task.priority === 'high' ? '#F59E0B' : '#00C48C' }
                        ]}>{task.priority}</Text>
                      </View>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}

      <View style={devStyles.totalRow}>
        <ListChecks size={16} color={Colors.primary} />
        <Text style={devStyles.totalText}>Total: ~20 tasks · Est. 80–120 dev hours · 3 weeks to launch</Text>
      </View>
    </View>
  );
}

const devStyles = StyleSheet.create({
  container: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: Colors.surfaceBorder },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  rocketBadge: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center' },
  headerText: { flex: 1 },
  headerTitle: { color: Colors.text, fontSize: 16, fontWeight: '800' as const },
  headerSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 1 },
  countdownBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary + '15', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  countdownText: { color: Colors.primary, fontSize: 12, fontWeight: '700' as const },
  alertBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F59E0B15', borderRadius: 10, padding: 10, marginBottom: 14, borderWidth: 1, borderColor: '#F59E0B30' },
  alertText: { color: '#F59E0B', fontSize: 12, fontWeight: '600' as const, flex: 1 },
  section72: { backgroundColor: '#FF6B6B08', borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#FF6B6B25' },
  section72Header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  section72Title: { color: '#FF6B6B', fontSize: 13, fontWeight: '700' as const },
  task72Row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 7 },
  task72Dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF6B6B', marginTop: 5 },
  task72Text: { color: Colors.textSecondary, fontSize: 12, flex: 1, lineHeight: 18 },
  timeNote: { marginTop: 10, backgroundColor: Colors.primary + '10', borderRadius: 8, padding: 8, borderWidth: 1, borderColor: Colors.primary + '25' },
  timeNoteText: { color: Colors.primary, fontSize: 11, fontWeight: '600' as const, textAlign: 'center' as const },
  weekCard: { borderLeftWidth: 3, borderRadius: 10, backgroundColor: Colors.background, marginBottom: 10, borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden' },
  weekHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  weekBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  weekLabel: { fontSize: 11, fontWeight: '700' as const },
  weekTitle: { flex: 1, color: Colors.text, fontSize: 13, fontWeight: '600' as const },
  taskCount: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  taskCountText: { fontSize: 11, fontWeight: '700' as const },
  taskList: { paddingHorizontal: 12, paddingBottom: 12 },
  taskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  priorityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  taskInfo: { flex: 1 },
  taskLabel: { color: Colors.text, fontSize: 13, lineHeight: 18 },
  taskMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  taskHours: { color: Colors.textTertiary, fontSize: 11 },
  priorityBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  priorityText: { fontSize: 10, fontWeight: '700' as const, textTransform: 'uppercase' as const },
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, backgroundColor: Colors.primary + '10', borderRadius: 10, padding: 10 },
  totalText: { color: Colors.primary, fontSize: 12, fontWeight: '600' as const, flex: 1 }});

// ─────────────────────────────────────────────────────────────────────────────
// DEVELOPER CODE ARCHITECTURE GUIDE
// This section documents the full technical structure of the IVX HOLDINGS app.
// Share this with your developer so they understand every module and file.
// ─────────────────────────────────────────────────────────────────────────────

interface ArchItem {
  label: string;
  value?: string;
  badge?: string;
  badgeColor?: string;
  note?: string;
}

interface ArchSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  color: string;
  subtitle: string;
  items: ArchItem[];
}

// All 9 architecture sections — each becomes a collapsible card
const ARCH_SECTIONS: ArchSection[] = [
  {
    // ── TECH STACK ──────────────────────────────────────────────────────────
    id: 'stack',
    title: 'Technology Stack',
    icon: <Code2 size={20} color="#4ECDC4" />,
    color: '#4ECDC4',
    subtitle: 'Core frameworks, language, and tooling',
    items: [
      { label: 'Mobile SDK', value: 'Expo SDK 54 + React Native 0.81.5' },
      { label: 'Language', value: 'TypeScript (strict mode — all files must type-check)' },
      { label: 'Routing', value: 'Expo Router v6 — file-based routing like Next.js Pages' },
      { label: 'Backend', value: 'Supabase (Auth, Database, Edge Functions, Storage)' },
      { label: 'State Mgmt', value: 'React Context + React Query v5 + AsyncStorage' },
      { label: 'Validation', value: 'Zod v4 — validates ALL API input/output schemas' },
      { label: 'Database', value: 'Supabase PostgreSQL — managed database with Row Level Security' },
      { label: 'Package Mgr', value: 'Bun (never use npm or yarn — use bun install/add/remove)' },
      { label: 'Icons', value: 'lucide-react-native — single icon library used throughout app' },
      { label: 'Web Support', value: 'react-native-web — app runs on iOS, Android, and Web browser' },
    ]},
  {
    // ── PROJECT STRUCTURE ───────────────────────────────────────────────────
    id: 'folders',
    title: 'Project File Structure',
    icon: <Layers size={20} color="#A78BFA" />,
    color: '#A78BFA',
    subtitle: 'Folder organization — where every file type lives',
    items: [
      { label: 'app/', value: 'ALL screens & routes (40+ files). Every .tsx = a screen/route.', badge: '40+ files' },
      { label: 'app/(tabs)/', value: '6 main tab screens: (home), portfolio, market, invest, chat, profile' },
      { label: 'app/admin/', value: 'Admin-only panel — 33 screens for property/member/analytics mgmt', badge: '33 files' },
      { label: 'app/property/[id].tsx', value: 'Dynamic property detail page — [id] = property ID from URL' },
      { label: 'app/_layout.tsx', value: 'ROOT layout — wraps app in all 7 Providers + navigation stack' },

      { label: 'components/', value: 'Shared UI components (PropertyCard, TradingModal, HoldingCard...)' },
      { label: 'lib/', value: '7 Context providers + hooks + utilities (supabase, analytics, auth...)' },
      { label: 'constants/', value: 'colors.ts, translations.ts (30 langs), countries.ts' },
      { label: 'mocks/', value: 'Development mock/seed data — 23 files with sample properties, users' },
      { label: 'types/index.ts', value: 'Global TypeScript interfaces shared across app and backend' },
    ]},
  {
    // ── CONTEXT PROVIDERS ────────────────────────────────────────────────────
    // All 7 providers wrap the app in app/_layout.tsx (outer to inner order):
    // ErrorBoundary > QueryClientProvider > I18nProvider >
    // AuthProvider > AnalyticsProvider > IntroProvider > LenderProvider >
    // IPXProvider > EarnProvider > AppContent
    id: 'contexts',
    title: 'Context Providers — Global State (7 Providers)',
    icon: <Database size={20} color={Colors.primary} />,
    color: Colors.primary,
    subtitle: 'Defined in lib/ — all wrap the app in app/_layout.tsx',
    items: [
      {
        label: 'AuthProvider',
        value: 'lib/auth-context.tsx',
        note: 'Login, register, logout, JWT token management, 2FA flow, user roles. Hook: useAuth(). Persists token in expo-secure-store.'},
      {
        label: 'IPXProvider',
        value: 'lib/ipx-context.tsx',
        note: 'Buy/sell fractional property shares. Holdings stored in AsyncStorage (@ipx_holdings) and synced to backend wallet. Hook: useIPX().'},
      {
        label: 'EarnProvider',
        value: 'lib/earn-context.tsx',
        note: 'IVXHOLDINGS Earn savings product. 4 profit tiers (10–15% APY). Daily interest accrual. Stored in AsyncStorage (@ipx_earn_data). Hook: useEarn().'},
      {
        label: 'LenderProvider',
        value: 'lib/lender-context.tsx',
        note: 'Connects to external lender APIs for debt acquisition features. Hook: useLender().'},
      {
        label: 'IntroProvider',
        value: 'lib/intro-context.tsx',
        note: 'Controls the onboarding flow shown to new users. Persists completion status in AsyncStorage. Hook: useIntro(). hasCompletedOnboarding = false → shows OnboardingFlow overlay.'},
      {
        label: 'AnalyticsProvider',
        value: 'lib/analytics-context.tsx',
        note: 'Tracks: screen views, user actions, transactions, errors, conversions. Auto-tracks app_launch on start, app_background on minimize. Hook: useAnalytics().'},
      {
        label: 'I18nProvider',
        value: 'lib/i18n-context.tsx',
        note: '30 languages: EN, ES, FR, ZH, AR, PT, RU, JA, DE, KO + 20 more. Language stored in AsyncStorage (ipx_language). Hook: useTranslation() → { t, language, isRTL }.'},
    ]},
  {
    id: 'api',
    title: 'Backend API — Supabase',
    icon: <Server size={20} color="#FF6B6B" />,
    color: '#FF6B6B',
    subtitle: 'Supabase PostgreSQL + Auth + Edge Functions + Storage',
    items: [
      { label: 'Auth', value: 'Supabase Auth — signup, login, logout, session management, role-based access', badge: 'public + protected' },
      { label: 'profiles', value: 'User profiles with KYC status, role, country, avatar', badge: 'protected' },
      { label: 'properties', value: 'Property listings with status, pricing, location, media', badge: 'public + admin' },
      { label: 'holdings', value: 'User investment holdings per property', badge: 'protected' },
      { label: 'wallets', value: 'User wallet balances — available, pending, invested', badge: 'protected' },
      { label: 'transactions', value: 'All financial transactions with status tracking', badge: 'protected + admin' },
      { label: 'notifications', value: 'Push notification tokens and user notifications', badge: 'protected' },
      { label: 'jv_deals', value: 'Joint venture deal agreements with photos and terms', badge: 'protected + admin' },
      { label: 'analytics_*', value: 'Dashboard, KPI, retention, investment analytics tables', badge: 'admin' },
      { label: 'Edge Functions', value: 'KYC liveness, face match, sanctions check, full verification', badge: 'protected' },
      { label: 'Storage', value: 'Supabase Storage for photos, documents, and file uploads', badge: 'protected' },
      { label: 'Row Level Security', value: 'PostgreSQL RLS policies enforce access control per user/role', badge: 'all' },
    ]},
  {
    // ── AUTHENTICATION SYSTEM ────────────────────────────────────────────────
    id: 'auth',
    title: 'Authentication System',
    icon: <Shield size={20} color={Colors.success} />,
    color: Colors.success,
    subtitle: 'Supabase Auth with role system and optional 2FA — lib/auth-context.tsx',
    items: [
      { label: 'Token Storage', value: 'expo-secure-store on native / localStorage on web', note: 'lib/auth-store.ts: persistAuth(), loadStoredAuth(), clearStoredAuth()' },
      { label: 'Access Token', value: 'Supabase JWT — managed automatically by @supabase/supabase-js', note: 'Auto-refreshed via supabase.auth session management' },
      { label: 'Refresh Token', value: 'Supabase auto-refresh — handled by persistSession: true', note: 'refreshSession() in auth-context.tsx' },
      { label: '2FA Step 1', value: 'login() → returns { requiresTwoFactor: true, twoFactorToken }' },
      { label: '2FA Step 2', value: 'verify2FA(code) → exchanges OTP for full session' },
      { label: 'Role: investor', value: 'Default — can invest, trade, manage wallet, view own data' },
      { label: 'Role: staff', value: 'Admin: customer support, document review, member lookup' },
      { label: 'Role: manager', value: 'Admin: property management, member management' },
      { label: 'Role: analyst', value: 'Admin: analytics, reports, read-only admin data' },
      { label: 'Role: owner', value: 'Full admin: all features including settings, broadcasts' },
      { label: 'Role: ceo', value: 'Highest access: full financial controls' },
      { label: 'RLS Policies', value: 'Supabase Row Level Security — enforces access per user/role at database level' },
      { label: 'Admin FAB', value: 'components/AdminFAB.tsx — floating button shown only when isAdmin = true' },
    ]},
  {
    // ── ALL SCREENS MAP ──────────────────────────────────────────────────────
    id: 'screens',
    title: 'All Screens Map (40+ Screens)',
    icon: <Layers size={20} color="#F59E0B" />,
    color: '#F59E0B',
    subtitle: 'Every file in app/ is a route — registered in app/_layout.tsx',
    items: [
      { label: '/(tabs)/(home)/index', value: 'HOME TAB — property discovery, search, featured listings' },
      { label: '/(tabs)/portfolio', value: 'PORTFOLIO TAB — holdings, P&L chart, wallet, activity history' },
      { label: '/(tabs)/market', value: 'MARKET TAB — live prices, OHLCV charts, buy/sell TradingModal' },
      { label: '/(tabs)/invest', value: 'INVEST TAB — IVXHOLDINGS properties, submit property, land partners' },
      { label: '/(tabs)/chat', value: 'SUPPORT TAB — AI chat powered by OpenAI API' },
      { label: '/(tabs)/profile', value: 'PROFILE TAB — account info, KYC status, all settings' },
      { label: '/property/[id]', value: 'PROPERTY DETAIL — dynamic route, full details, image slider, invest button' },
      { label: '/wallet', value: 'WALLET — full balance, deposit/withdraw, payment methods' },
      { label: '/kyc-verification', value: 'KYC FLOW — upload government ID + selfie, submit for review' },
      { label: '/signup', value: 'REGISTRATION — modal presentation, email/password/country/referral' },
      { label: '/notifications', value: 'NOTIFICATIONS — inbox of all push notifications received' },
      { label: '/referrals', value: 'REFERRALS — unique code, invite friends, $50/referral tracking' },
      { label: '/security-settings', value: 'SECURITY — 2FA setup, password change, login history, sessions' },
      { label: '/ai-automation-report', value: 'AI REPORTS — AI-generated analytics + automation dashboards' },
      { label: '/ai-gallery', value: 'AI GALLERY — generate marketing images via OpenAI (1319 LOC)' },
      { label: '/contract-generator', value: 'CONTRACT GEN — AI generates legal contracts from templates (2031 LOC)' },
      { label: '/smart-investing', value: 'SMART INVESTING — AI portfolio analyzer + recommendations' },
      { label: '/copy-investing', value: 'COPY INVESTING — follow + mirror top investor portfolios' },
      { label: '/auto-reinvest', value: 'AUTO-REINVEST — configure automatic dividend reinvestment rules' },
      { label: '/gift-shares', value: 'GIFT SHARES — send fractional property shares by email' },
      { label: '/vip-tiers', value: 'VIP TIERS — membership tiers, upgrade requirements, benefits (1047 LOC)' },
      { label: '/ipx-earn', value: 'IVXHOLDINGS EARN — savings product: deposit funds, earn 10–15% APY' },
      { label: '/influencer-apply', value: 'INFLUENCER PROGRAM — application form, commission rates' },
      { label: '/agent-apply', value: 'AGENT PROGRAM — real estate agent partnership application' },
      { label: '/broker-apply', value: 'BROKER PROGRAM — investor broker referral program application' },
      { label: '/investor-prospectus', value: 'PROSPECTUS — official investment prospectus document viewer' },
      { label: '/property-documents', value: 'DOC PORTAL — deeds, contracts, surveys, due diligence files' },
      { label: '/title-review', value: 'TITLE REVIEW — property title search and legal review' },
      { label: '/tax-info', value: 'TAX INFO — EIN/SSN collection, tax residency setup' },
      { label: '/tax-documents', value: 'TAX DOCS — download 1099s, annual statements' },
      { label: '/statements', value: 'STATEMENTS — monthly investment account statements' },
      { label: '/legal', value: 'LEGAL — ToS, privacy policy, disclosures, risk warnings' },
      { label: '/trust-center', value: 'TRUST — security certifications, audits, compliance info' },
      { label: '/company-info', value: 'ABOUT — IVX HOLDINGS LLC company information' },
      { label: '/compare-investments', value: 'COMPARE — side-by-side property comparison tool' },
      { label: '/video-presentation', value: 'VIDEO PLAYER — property video presentation (modal, 1815 LOC)' },
      { label: '/share-content', value: 'SOCIAL SHARE — marketing content sharing for social media (927 LOC)' },
      { label: '/language', value: 'LANGUAGE — pick from 30 supported languages' },
      { label: '/app-guide', value: 'THIS SCREEN — user walkthrough + developer architecture guide' },
      { label: '/app-report', value: 'APP REPORT — automated marketing performance report (752 LOC)' },
      { label: '/app-demo', value: 'APP DEMO — interactive demo for prospects (modal, 768 LOC)' },
      { label: '/admin/*', value: '33 ADMIN SCREENS — members, properties, analytics, team, settings...' },
    ]},
  {
    // ── PUSH NOTIFICATIONS ───────────────────────────────────────────────────
    id: 'notifications',
    title: 'Push Notifications System',
    icon: <Bell size={20} color="#F59E0B" />,
    color: '#F59E0B',
    subtitle: 'Expo Notifications + APNs (iOS) + FCM (Android) — lib/push-notifications.ts',
    items: [
      { label: 'Setup File', value: 'lib/push-notifications.ts — all notification logic here' },
      { label: 'Registration Flow', value: '1. Request permission → 2. Get Expo push token → 3. Save token to Supabase push_tokens table', note: 'Triggered on login from PushNotificationHandler in app/_layout.tsx' },
      { label: 'Android: default', value: 'General alerts — MAX importance, vibration pattern [0,250,250,250]' },
      { label: 'Android: investments', value: 'Trade confirms, dividend paid, property updates — HIGH importance' },
      { label: 'Android: security', value: 'Login from new device, suspicious activity — MAX importance' },
      { label: 'Deep Linking', value: 'Notification payload: { data: { screen: "/wallet" } } → taps go to that screen', note: 'Handled in addNotificationResponseListener in app/_layout.tsx' },
      { label: 'Badge Reset', value: 'setBadgeCount(0) called when user taps any notification', note: 'lib/push-notifications.ts setBadgeCount()' },
      { label: 'Web', value: 'Disabled on web (Platform.OS === "web" check in registerForPushNotificationsAsync)', badge: 'web-skip' },
      { label: 'Physical Device', value: 'REQUIRED — push tokens only work on real devices, not simulators', badge: 'important' },
    ]},
  {
    // ── ENVIRONMENT VARIABLES ────────────────────────────────────────────────
    id: 'env',
    title: 'Required Environment Variables',
    icon: <Key size={20} color={Colors.error} />,
    color: Colors.error,
    subtitle: 'All vars checked in backend/lib/env.ts — must be set before production',
    items: [
      { label: 'EXPO_PUBLIC_API_BASE_URL', value: 'Your backend server URL — defaults to https://ivxholding.com', badge: 'CRITICAL' },
      { label: 'JWT_SECRET', value: '32+ char random string — signs all auth tokens', badge: 'CRITICAL' },
      { label: 'SENDGRID_API_KEY', value: 'Email: property alerts, welcome emails, monthly reports', badge: 'CRITICAL' },
      { label: 'TWILIO_ACCOUNT_SID', value: 'WhatsApp + SMS — reports to configured recipients', badge: 'CRITICAL' },
      { label: 'TWILIO_AUTH_TOKEN', value: 'Twilio authentication token', badge: 'CRITICAL' },
      { label: 'TWILIO_PHONE_NUMBER', value: 'Your Twilio sender number (WhatsApp-enabled)', badge: 'CRITICAL' },
      { label: 'STRIPE_SECRET_KEY', value: 'Server-side Stripe key (sk_live_...) for card payments', badge: 'CRITICAL' },
      { label: 'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY', value: 'Client-side Stripe key (pk_live_...)', badge: 'CRITICAL' },
      { label: 'PLAID_CLIENT_ID', value: 'Plaid bank link client ID for ACH deposits', badge: 'CRITICAL' },
      { label: 'PLAID_SECRET', value: 'Plaid secret key', badge: 'CRITICAL' },
      { label: 'EXPO_PUBLIC_IVX_AI_GATEWAY_URL', value: 'AI gateway base URL for workspace assistant, contract generator, AI gallery, and smart investing', badge: 'HIGH' },
      { label: 'EXPO_PUBLIC_API_BASE_URL', value: 'IVX backend API base URL (https://api.ivxholding.com)', badge: 'HIGH' },
      { label: 'KYC_API_KEY', value: 'Persona or Jumio production API key for identity verification', badge: 'CRITICAL' },
      { label: 'SENTRY_DSN', value: 'Error tracking and crash monitoring (Sentry)', badge: 'HIGH' },
      { label: 'ALLOWED_ORIGINS', value: 'CORS: comma-separated production origins, e.g. https://app.ipxholding.com', badge: 'CRITICAL' },
      { label: 'NODE_ENV', value: 'Set to "production" for live deployment (hides error details)', badge: 'CRITICAL' },
      { label: 'Run Check', value: 'Admin: GET /env-check with CEO Bearer token → shows all missing vars' },
    ]},
  {
    // ── DESIGN SYSTEM ────────────────────────────────────────────────────────
    id: 'design',
    title: 'Design System & Color Tokens',
    icon: <Sparkles size={20} color={Colors.primary} />,
    color: Colors.primary,
    subtitle: 'constants/colors.ts — always import Colors, never hardcode hex values',
    items: [
      { label: 'Colors.primary', value: '#FFD700 — Gold. Buttons, highlights, active icons, CTAs' },
      { label: 'Colors.background', value: '#0A0A0A — Near black. Main screen background' },
      { label: 'Colors.backgroundSecondary', value: '#141414 — Section backgrounds' },
      { label: 'Colors.surface', value: '#1A1A1A — Card backgrounds, panels, modals' },
      { label: 'Colors.surfaceBorder', value: '#2A2A2A — Card border color' },
      { label: 'Colors.text', value: '#FFFFFF — Primary text' },
      { label: 'Colors.textSecondary', value: '#9A9A9A — Subtitles, descriptions, labels' },
      { label: 'Colors.textTertiary', value: '#6A6A6A — Placeholder, disabled, metadata' },
      { label: 'Colors.success / .positive', value: '#00C48C — Gains, positive values, success state' },
      { label: 'Colors.error / .negative', value: '#FF4D4D — Losses, errors, negative values, warnings' },
      { label: 'Colors.accent', value: '#4A90D9 — Links, info badges, secondary CTAs' },
      { label: 'Colors.warning', value: '#FFB800 — Caution states, pending status' },
      { label: 'Colors.tabBar', value: '#0F0F0F — Bottom tab bar background' },
      { label: 'Colors.overlay', value: 'rgba(0,0,0,0.7) — Modal backdrop, image overlays' },
      { label: 'Rule', value: "Use StyleSheet.create() for ALL styles — never use inline style objects for static values" },
    ]},
];

// ─────────────────────────────────────────────────────────────────────────────
// Collapsible card for each architecture section
// ─────────────────────────────────────────────────────────────────────────────
function CollapsibleArchCard({ section }: { section: ArchSection }) {
  const [open, setOpen] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  const toggle = useCallback(() => {
    const toValue = open ? 0 : 1;
    Animated.parallel([
      Animated.spring(anim, { toValue, useNativeDriver: false, friction: 14, tension: 70 }),
      Animated.spring(rotateAnim, { toValue, useNativeDriver: true, friction: 14, tension: 70 }),
    ]).start();
    setOpen(!open);
  }, [open, anim, rotateAnim]);

  const maxH = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 2200] });
  const opacity = anim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0, 1] });
  const rotate = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <View style={[archStyles.card, { borderLeftColor: section.color }]}>
      <TouchableOpacity style={archStyles.cardHeader} onPress={toggle} activeOpacity={0.7}>
        <View style={[archStyles.cardIcon, { backgroundColor: section.color + '18' }]}>
          {section.icon}
        </View>
        <View style={archStyles.cardHeaderText}>
          <Text style={archStyles.cardTitle}>{section.title}</Text>
          <Text style={archStyles.cardSubtitle} numberOfLines={open ? undefined : 1}>{section.subtitle}</Text>
        </View>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <ChevronDown size={18} color={Colors.textTertiary} />
        </Animated.View>
      </TouchableOpacity>

      <Animated.View style={{ maxHeight: maxH, opacity, overflow: 'hidden' }}>
        <View style={archStyles.itemList}>
          {section.items.map((item, i) => (
            <View key={i} style={[archStyles.itemRow, i < section.items.length - 1 && archStyles.itemBorder]}>
              <View style={archStyles.itemLeft}>
                <View style={[archStyles.itemDot, { backgroundColor: section.color }]} />
                <View style={archStyles.itemContent}>
                  <Text style={archStyles.itemLabel}>{item.label}</Text>
                  {item.value ? <Text style={archStyles.itemValue}>{item.value}</Text> : null}
                  {item.note ? (
                    <View style={archStyles.noteRow}>
                      <Text style={archStyles.noteText}>{item.note}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              {item.badge ? (
                <View style={[
                  archStyles.badge,
                  { backgroundColor: (item.badgeColor || section.color) + '20' },
                ]}>
                  <Text style={[archStyles.badgeText, { color: item.badgeColor || section.color }]}>
                    {item.badge}
                  </Text>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Developer Code Guide component — rendered in AppGuideScreen
// ─────────────────────────────────────────────────────────────────────────────
function DeveloperCodeGuide() {
  return (
    <View style={archStyles.container}>
      {/* Header */}
      <View style={archStyles.header}>
        <View style={archStyles.headerIconWrap}>
          <Code2 size={20} color="#fff" />
        </View>
        <View style={archStyles.headerText}>
          <Text style={archStyles.headerTitle}>Developer Code Architecture</Text>
          <Text style={archStyles.headerSub}>Full technical reference for developers</Text>
        </View>
        <View style={archStyles.tagRow}>
          <View style={archStyles.tag}>
            <Package size={11} color={Colors.primary} />
            <Text style={archStyles.tagText}>34 APIs</Text>
          </View>
          <View style={archStyles.tag}>
            <Layers size={11} color={Colors.primary} />
            <Text style={archStyles.tagText}>40+ Screens</Text>
          </View>
        </View>
      </View>

      {/* Info banner */}
      <View style={archStyles.banner}>
        <AlertTriangle size={13} color="#4ECDC4" />
        <Text style={archStyles.bannerText}>
          Share this with your developer. All 9 sections below document every module, file, API route, provider, screen, and environment variable in the app.
        </Text>
      </View>

      {/* Stats row */}
      <View style={archStyles.statsBar}>
        {[
          { val: '7', lbl: 'Providers' },
          { val: '34', lbl: 'API Routes' },
          { val: '40+', lbl: 'Screens' },
          { val: '30', lbl: 'Languages' },
        ].map((s, i) => (
          <View key={i} style={archStyles.statBox}>
            <Text style={archStyles.statVal}>{s.val}</Text>
            <Text style={archStyles.statLbl}>{s.lbl}</Text>
          </View>
        ))}
      </View>

      {/* All 9 collapsible section cards */}
      {ARCH_SECTIONS.map(section => (
        <CollapsibleArchCard key={section.id} section={section} />
      ))}

      {/* Footer note */}
      <View style={archStyles.footerNote}>
        <CheckCircle2 size={14} color={Colors.success} />
        <Text style={archStyles.footerNoteText}>
          All code uses TypeScript strict mode. Run <Text style={archStyles.footerCode}>bun install</Text> then <Text style={archStyles.footerCode}>bun start</Text> to launch the dev server.
        </Text>
      </View>
    </View>
  );
}

const archStyles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12},
  headerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#4ECDC4',
    justifyContent: 'center',
    alignItems: 'center'},
  headerText: { flex: 1 },
  headerTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const},
  headerSub: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 1},
  tagRow: { gap: 4 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8},
  tagText: {
    color: Colors.primary,
    fontSize: 10,
    fontWeight: '700' as const},
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#4ECDC415',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#4ECDC430'},
  bannerText: {
    flex: 1,
    color: '#4ECDC4',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500' as const},
  statsBar: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14},
  statBox: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  statVal: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const},
  statLbl: {
    color: Colors.textTertiary,
    fontSize: 10,
    marginTop: 2},
  card: {
    borderLeftWidth: 3,
    borderRadius: 10,
    backgroundColor: Colors.background,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden'},
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12},
  cardIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0},
  cardHeaderText: { flex: 1 },
  cardTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const},
  cardSubtitle: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15},
  itemList: {
    paddingHorizontal: 12,
    paddingBottom: 12},
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 9,
    gap: 8},
  itemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  itemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8},
  itemDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 6,
    flexShrink: 0},
  itemContent: { flex: 1 },
  itemLabel: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600' as const,
    fontFamily: 'monospace' as const,
    lineHeight: 17},
  itemValue: {
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1},
  noteRow: {
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 4,
    marginTop: 4},
  noteText: {
    color: Colors.textTertiary,
    fontSize: 10,
    lineHeight: 14,
    fontStyle: 'italic' as const},
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    flexShrink: 0,
    alignSelf: 'flex-start',
    marginTop: 2},
  badgeText: {
    fontSize: 9,
    fontWeight: '800' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3},
  footerNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.success + '10',
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
    borderWidth: 1,
    borderColor: Colors.success + '25'},
  footerNoteText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 17},
  footerCode: {
    color: Colors.success,
    fontFamily: 'monospace' as const,
    fontWeight: '600' as const}});

// ─────────────────────────────────────────────────────────────────────────────
// END DEVELOPER CODE GUIDE
// ─────────────────────────────────────────────────────────────────────────────

const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: <Zap size={22} color={Colors.primary} />,
    color: Colors.primary,
    description: 'Create your account, verify your identity, and start investing in minutes.',
    steps: [
      { icon: <User size={16} color={Colors.primary} />, text: 'Tap "Sign Up" and enter your email & password to create your account.' },
      { icon: <Shield size={16} color={Colors.success} />, text: 'Go to Profile → Identity Verification to complete KYC (upload ID + selfie).' },
      { icon: <Wallet size={16} color={Colors.accent} />, text: 'Add funds to your wallet via bank transfer, card, or wire transfer.' },
      { icon: <Home size={16} color={Colors.warning} />, text: 'Browse properties on the Discover tab and tap "Invest Now" to start.' },
    ],
    proTip: 'Complete KYC early — it takes 1-2 business days and is required before investing.'},
  {
    id: 'discover',
    title: 'Discover Properties',
    icon: <Home size={22} color="#4ECDC4" />,
    color: '#4ECDC4',
    description: 'Browse premium real estate investment opportunities from around the world.',
    steps: [
      { icon: <Search size={16} color="#4ECDC4" />, text: 'Use the search bar to find properties by name, city, or country.' },
      { icon: <Filter size={16} color="#4ECDC4" />, text: 'Tap filter chips: All, Live, Coming Soon, or Funded to narrow results.' },
      { icon: <Star size={16} color={Colors.primary} />, text: 'Scroll the Featured Properties carousel for top investment picks.' },
      { icon: <Heart size={16} color={Colors.error} />, text: 'Tap any property card to see full details, images, and financials.' },
      { icon: <FileText size={16} color={Colors.accent} />, text: 'Review documents, expected ROI, rental yield, and appreciation potential.' },
      { icon: <Target size={16} color={Colors.success} />, text: 'Tap "Invest Now", enter amount, review summary, and confirm your purchase.' },
    ],
    proTip: 'Use "Compare Investments" from property details to side-by-side compare opportunities.'},
  {
    id: 'portfolio',
    title: 'Portfolio Management',
    icon: <Briefcase size={22} color={Colors.accent} />,
    color: Colors.accent,
    description: 'Track all your investments, performance, and transaction history in one place.',
    steps: [
      { icon: <PieChart size={16} color={Colors.accent} />, text: 'Portfolio tab shows your total value, gains/losses, and 90-day performance chart.' },
      { icon: <BarChart3 size={16} color={Colors.success} />, text: 'Switch between Holdings (property shares), IVXHOLDINGS (token investments), and Activity tabs.' },
      { icon: <CreditCard size={16} color={Colors.primary} />, text: 'Wallet card shows your cash balance with "Add Funds" and "Withdraw" buttons.' },
      { icon: <ArrowUpDown size={16} color={Colors.warning} />, text: 'Activity tab shows all transactions: deposits, trades, withdrawals, and dividends.' },
    ],
    proTip: 'Each holding card shows your cost basis, current value, and unrealized P&L at a glance.'},
  {
    id: 'market',
    title: 'Market & Trading',
    icon: <TrendingUp size={22} color={Colors.success} />,
    color: Colors.success,
    description: 'Real-time market data, price charts, and buy/sell trading interface.',
    steps: [
      { icon: <CircleDot size={16} color={Colors.success} />, text: 'Market tab shows live status, 24h volume, top gainers, and losers.' },
      { icon: <BarChart3 size={16} color={Colors.success} />, text: 'Tap any property row to expand the interactive price chart (1D to ALL timeframes).' },
      { icon: <TrendingUp size={16} color={Colors.positive} />, text: 'To Buy: Tap green "Buy" → enter amount → choose Market or Limit order → confirm.' },
      { icon: <TrendingUp size={16} color={Colors.error} />, text: 'To Sell: Tap red "Sell" → enter shares → choose order type → review & confirm.' },
      { icon: <ArrowUpDown size={16} color={Colors.accent} />, text: 'View the Order Book for current bids (buy) and asks (sell) to understand market depth.' },
    ],
    proTip: 'Markets are open 24/7. Use limit orders to set your desired price and trade automatically.'},
  {
    id: 'invest-ipx',
    title: 'IVXHOLDINGS Investment Platform',
    icon: <Landmark size={22} color={Colors.primary} />,
    color: Colors.primary,
    description: 'Exclusive IVXHOLDINGS properties, property submissions, and land partnerships.',
    steps: [
      { icon: <Building2 size={16} color={Colors.primary} />, text: 'Invest tab shows curated IVXHOLDINGS-exclusive properties with detailed metrics.' },
      { icon: <Target size={16} color={Colors.success} />, text: 'Tap a property → "View Details" → review terms → "Invest" → enter amount → confirm.' },
      { icon: <FileText size={16} color={Colors.accent} />, text: 'Submit Property: Tap "Submit Property" → fill details → upload images & docs → submit.' },
      { icon: <Globe size={16} color={Colors.warning} />, text: 'Land Partnership: Tap "Land Partnership" → review terms → submit application.' },
      { icon: <Sparkles size={16} color={Colors.primary} />, text: 'IVXHOLDINGS tokens can be bought/sold, staked for rewards, and used for governance voting.' },
    ],
    proTip: 'Staking IVXHOLDINGS tokens earns you higher dividend yields and early access to new listings.'},
  {
    id: 'wallet',
    title: 'Wallet & Payments',
    icon: <Wallet size={22} color="#FF6B6B" />,
    color: '#FF6B6B',
    description: 'Manage funds, deposit, withdraw, and track all your financial transactions.',
    steps: [
      { icon: <Wallet size={16} color="#FF6B6B" />, text: 'Go to Profile → Wallet & Payments to see your full balance and history.' },
      { icon: <CreditCard size={16} color={Colors.accent} />, text: 'Add Funds: Choose from Credit/Debit Card (instant), Bank Transfer (1-3 days), or Wire Transfer.' },
      { icon: <ArrowUpDown size={16} color={Colors.success} />, text: 'Withdraw: Select ACH (free, 1-3 days) or Wire ($25 fee, same day).' },
      { icon: <Lock size={16} color={Colors.warning} />, text: 'All transactions are encrypted and protected with bank-level security.' },
    ],
    proTip: 'Bank transfers (ACH) have no fees — best for regular deposits. Cards charge 2.9%.'},
  {
    id: 'support',
    title: 'Support & AI Chat',
    icon: <MessageCircle size={22} color="#A78BFA" />,
    color: '#A78BFA',
    description: 'Get help from AI assistant, live chat, or contact support directly.',
    steps: [
      { icon: <Sparkles size={16} color="#A78BFA" />, text: 'Support tab has an AI-powered chat that answers investment questions 24/7.' },
      { icon: <MessageCircle size={16} color="#A78BFA" />, text: 'Ask about property recommendations, portfolio analysis, or how features work.' },
      { icon: <Users size={16} color={Colors.accent} />, text: 'Request human support escalation for complex account issues.' },
      { icon: <BookOpen size={16} color={Colors.success} />, text: 'Quick reply suggestions help you ask the right questions fast.' },
    ]},
  {
    id: 'profile',
    title: 'Profile & Settings',
    icon: <User size={22} color={Colors.warning} />,
    color: Colors.warning,
    description: 'Manage your account, KYC status, security, notifications, and documents.',
    steps: [
      { icon: <User size={16} color={Colors.warning} />, text: 'Profile tab: View/edit personal info, KYC status, and account stats.' },
      { icon: <Shield size={16} color={Colors.success} />, text: 'Identity Verification: Upload government ID + selfie for KYC approval.' },
      { icon: <FileText size={16} color={Colors.accent} />, text: 'Documents: Access Investor Prospectus, monthly statements, and tax documents (1099s).' },
      { icon: <Bell size={16} color={Colors.primary} />, text: 'Notifications: Configure email, push, and SMS alert preferences.' },
      { icon: <Lock size={16} color={Colors.error} />, text: 'Security: Change password, enable 2FA, and review login history.' },
      { icon: <Gift size={16} color={Colors.positive} />, text: 'Referrals: Get your unique link, invite friends, and earn $50 per referral.' },
    ]},
  {
    id: 'admin',
    title: 'Admin Panel',
    icon: <LayoutDashboard size={22} color={Colors.error} />,
    color: Colors.error,
    description: 'Full management dashboard for administrators — members, properties, transactions, and more.',
    steps: [
      { icon: <LayoutDashboard size={16} color={Colors.error} />, text: 'Access via Profile → Admin Panel. Shows key metrics and activity dashboard.' },
      { icon: <Users size={16} color={Colors.accent} />, text: 'Members: View all users, search/filter, manage KYC approvals, suspend/activate accounts.' },
      { icon: <Building2 size={16} color={Colors.success} />, text: 'Properties: Add/edit listings, upload images & docs, manage pricing and status.' },
      { icon: <ArrowUpDown size={16} color={Colors.primary} />, text: 'Transactions: View all trades, handle refunds, resolve disputes, track payment status.' },
      { icon: <Megaphone size={16} color="#A78BFA" />, text: 'Broadcast: Send push notifications, email campaigns, and SMS to users or segments.' },
      { icon: <BarChart3 size={16} color={Colors.warning} />, text: 'Growth: User acquisition metrics, conversion funnels, cohort analysis, geographic data.' },
      { icon: <Sparkles size={16} color={Colors.primary} />, text: 'AI Studio: Generate property descriptions, marketing copy, social posts, and email templates.' },
      { icon: <Settings size={16} color={Colors.textSecondary} />, text: 'Settings: Configure fees, platform settings, feature flags, and team permissions.' },
      { icon: <Star size={16} color={Colors.warning} />, text: 'Influencers: Review applications, set commission rates, track performance and payouts.' },
      { icon: <Globe size={16} color="#4ECDC4" />, text: 'Land Partners: Onboard partners, review property submissions, manage revenue sharing.' },
    ],
    proTip: 'Use AI Studio to auto-generate professional marketing content for properties and campaigns.'},
];

function ExpandableSection({ section }: { section: GuideSection }) {
  const [expanded, setExpanded] = useState(false);
  const animatedHeight = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  const toggle = useCallback(() => {
    const toValue = expanded ? 0 : 1;
    Animated.parallel([
      Animated.spring(animatedHeight, {
        toValue,
        useNativeDriver: false,
        friction: 12,
        tension: 60}),
      Animated.spring(rotateAnim, {
        toValue,
        useNativeDriver: true,
        friction: 12,
        tension: 60}),
    ]).start();
    setExpanded(!expanded);
  }, [expanded, animatedHeight, rotateAnim]);

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg']});

  const maxHeight = animatedHeight.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 800]});

  const opacity = animatedHeight.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0, 0, 1]});

  return (
    <View style={[sectionStyles.card, { borderLeftColor: section.color }]}>
      <TouchableOpacity
        style={sectionStyles.header}
        onPress={toggle}
        activeOpacity={0.7}
      >
        <View style={sectionStyles.headerLeft}>
          <View style={[sectionStyles.iconWrap, { backgroundColor: section.color + '18' }]}>
            {section.icon}
          </View>
          <View style={sectionStyles.headerText}>
            <Text style={sectionStyles.title}>{section.title}</Text>
            <Text style={sectionStyles.description} numberOfLines={expanded ? undefined : 1}>
              {section.description}
            </Text>
          </View>
        </View>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <ChevronDown size={20} color={Colors.textTertiary} />
        </Animated.View>
      </TouchableOpacity>

      <Animated.View style={{ maxHeight, opacity, overflow: 'hidden' }}>
        <View style={sectionStyles.stepsContainer}>
          {section.steps.map((step, index) => (
            <View key={index} style={sectionStyles.stepRow}>
              <View style={sectionStyles.stepTimeline}>
                <View style={[sectionStyles.stepDot, { backgroundColor: section.color }]}>
                  {step.icon}
                </View>
                {index < section.steps.length - 1 && (
                  <View style={[sectionStyles.stepLine, { backgroundColor: section.color + '30' }]} />
                )}
              </View>
              <View style={sectionStyles.stepContent}>
                <Text style={sectionStyles.stepNumber}>Step {index + 1}</Text>
                <Text style={sectionStyles.stepText}>{step.text}</Text>
              </View>
            </View>
          ))}
          {section.proTip && (
            <View style={[sectionStyles.proTip, { backgroundColor: section.color + '10', borderColor: section.color + '30' }]}>
              <Sparkles size={14} color={section.color} />
              <Text style={[sectionStyles.proTipText, { color: section.color }]}>
                Pro Tip: {section.proTip}
              </Text>
            </View>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

export default function AppGuideScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isSmall = width < 380;

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.headerBar}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>App Guide</Text>
          <View style={styles.backButton} />
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroIconRow}>
            <View style={[styles.heroIcon, { backgroundColor: '#4ECDC4' + '20' }]}>
              <Home size={20} color="#4ECDC4" />
            </View>
            <View style={[styles.heroIcon, { backgroundColor: Colors.accent + '20' }]}>
              <Briefcase size={20} color={Colors.accent} />
            </View>
            <View style={[styles.heroIcon, { backgroundColor: Colors.primary + '20' }]}>
              <BookOpen size={24} color={Colors.primary} />
            </View>
            <View style={[styles.heroIcon, { backgroundColor: Colors.success + '20' }]}>
              <TrendingUp size={20} color={Colors.success} />
            </View>
            <View style={[styles.heroIcon, { backgroundColor: '#A78BFA' + '20' }]}>
              <LayoutDashboard size={20} color="#A78BFA" />
            </View>
          </View>
          <Text style={[styles.heroTitle, { fontSize: isSmall ? 22 : 26 }]}>
            How to Use IVX HOLDINGS
          </Text>
          <Text style={styles.heroSubtitle}>
            Tap any section below to learn step-by-step how each feature works and how to manage the app.
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>6</Text>
              <Text style={styles.statLabel}>Main Tabs</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>340+</Text>
              <Text style={styles.statLabel}>Features</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>24/7</Text>
              <Text style={styles.statLabel}>Support</Text>
            </View>
          </View>
        </View>

        <View style={styles.quickNav}>
          <Text style={styles.quickNavTitle}>Quick Navigation</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickNavScroll}>
            {GUIDE_SECTIONS.map((section) => (
              <View key={section.id} style={[styles.quickNavItem, { borderColor: section.color + '40' }]}>
                <View style={[styles.quickNavIcon, { backgroundColor: section.color + '15' }]}>
                  {section.icon}
                </View>
                <Text style={styles.quickNavLabel} numberOfLines={1}>{section.title}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        <DeveloperLaunchPlan />

        <DeveloperCodeGuide />

        <View style={styles.sectionsContainer}>
          <Text style={styles.sectionHeader}>COMPLETE WALKTHROUGH</Text>
          {GUIDE_SECTIONS.map((section) => (
            <ExpandableSection key={section.id} section={section} />
          ))}
        </View>

        <View style={styles.helpCard}>
          <View style={styles.helpCardInner}>
            <MessageCircle size={28} color="#A78BFA" />
            <Text style={styles.helpCardTitle}>Still Need Help?</Text>
            <Text style={styles.helpCardText}>
              Chat with our AI assistant or contact support directly for personalized guidance.
            </Text>
            <TouchableOpacity
              style={styles.helpButton}
              onPress={() => router.push('/(tabs)/chat' as any)}
            >
              <Text style={styles.helpButtonText}>Open Support Chat</Text>
              <ChevronRight size={16} color={Colors.background} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>IVX HOLDINGS LLC</Text>
          <Text style={styles.footerSubtext}>App Guide v1.0</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderLeftWidth: 3,
    overflow: 'hidden'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16},
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12},
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12},
  headerText: {
    flex: 1},
  title: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 2},
  description: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17},
  stepsContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16},
  stepRow: {
    flexDirection: 'row',
    minHeight: 56},
  stepTimeline: {
    width: 36,
    alignItems: 'center'},
  stepDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center'},
  stepLine: {
    width: 2,
    flex: 1,
    marginVertical: 4},
  stepContent: {
    flex: 1,
    paddingLeft: 10,
    paddingBottom: 12},
  stepNumber: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginBottom: 3},
  stepText: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20},
  proTip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1},
  proTipText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600' as const,
    lineHeight: 18}});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safeTop: { backgroundColor: Colors.background },
  headerBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  backButton: { padding: 8 },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  scrollView: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: 20, paddingBottom: 140 },
  hero: { gap: 4 },
  heroIconRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  heroIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  heroTitle: { color: Colors.text, fontSize: 22, fontWeight: '800' as const, textAlign: 'center', marginBottom: 8 },
  heroSubtitle: { color: Colors.textSecondary, fontSize: 14, fontWeight: '500' as const, textAlign: 'center', marginBottom: 8, lineHeight: 20 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statItem: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  statDivider: { width: 1, height: 28, backgroundColor: Colors.surfaceBorder },
  quickNav: { gap: 4 },
  quickNavTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  quickNavScroll: { gap: 8 },
  quickNavItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  quickNavIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  quickNavLabel: { color: Colors.textSecondary, fontSize: 13, flex: 1 },
  sectionsContainer: { gap: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  helpCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  helpCardInner: { gap: 4 },
  helpCardTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  helpCardText: { color: Colors.textSecondary, fontSize: 13 },
  helpButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  helpButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  footer: { paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, backgroundColor: Colors.background },
  footerText: { color: Colors.textTertiary, fontSize: 12, textAlign: 'center' },
  footerSubtext: { color: Colors.textTertiary, fontSize: 11, textAlign: 'center', marginTop: 4 },
  scrollViewBg: { backgroundColor: Colors.background }});
