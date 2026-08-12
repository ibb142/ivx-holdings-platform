import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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
import { renderSafeViewChildren } from '@/components/SafeViewChildren';
import {
  ArrowLeft,
  Eye,
  Users,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Globe,
  Monitor,
  Smartphone,
  Target,
  BarChart3,
  Activity,
  Zap,
  LogIn,
  RefreshCw,
  MapPin,
  Brain,
  Timer,
  Percent,
  Flame,
  Crosshair,
  Tablet,
  Radio,
  PieChart,
  Layers,
  Sparkles,
  AlertTriangle,
  TrendingDown,
  Lightbulb,
  Wifi,
  WifiOff,
  Home,
  DollarSign,
  Handshake,
  Landmark,
  UserCheck,
  ShieldCheck} from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { usePresenceTracker } from '@/lib/realtime-presence';
import { awsAnalyticsBackup } from '@/lib/aws-analytics-backup';
import { fetchRawEvents as fetchAnalyticsRawEvents, computeAnalytics as computeAnalyticsData, fetchExtraCounts as fetchAnalyticsExtraCounts } from '@/lib/analytics-compute';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

type EventSource = 'landing' | 'app' | 'unknown';

interface RawEvent {
  id?: string;
  event: string;
  session_id: string;
  properties?: Record<string, unknown>;
  geo?: { city?: string; region?: string; country?: string; countryCode?: string; lat?: number; lng?: number; timezone?: string };
  created_at: string;
  _source?: EventSource;
}

interface ComputedAnalytics {
  period: string;
  totalLeads: number;
  registeredUsers: number;
  waitlistLeads: number;
  totalEvents: number;
  pageViews: number;
  uniqueSessions: number;
  topScreens: Array<{ screen: string; views: number; uniqueSessions: number; avgTimeSpent: number; totalTimeSpent: number; pct: number; lastViewed: string }>;
  topActions: Array<{ action: string; count: number; uniqueSessions: number; avgTimeSpent: number; pct: number; lastTriggered: string }>;
  timeSpent: { totalTrackedSeconds: number; avgSessionSeconds: number; avgScreenSeconds: number; maxSessionSeconds: number; engagedSessions: number };
  funnel: { pageViews: number; scroll25: number; scroll50: number; scroll75: number; scroll100: number; formFocuses: number; formSubmits: number };
  cta: { getStarted: number; signIn: number; jvInquire: number; websiteClick: number };
  conversionRate: number;
  scrollEngagement: number;
  byEvent: Array<{ event: string; count: number }>;
  byPlatform: Array<{ platform: string; count: number }>;
  byReferrer: Array<{ referrer: string; count: number }>;
  dailyViews: Array<{ date: string; views: number; sessions: number }>;
  hourlyActivity: Array<{ hour: number; count: number }>;
  geoZones: {
    byCountry: Array<{ country: string; count: number; pct: number }>;
    byCity: Array<{ city: string; count: number; country: string; lat?: number; lng?: number; pct: number }>;
    byRegion: Array<{ region: string; count: number; pct: number }>;
    byTimezone: Array<{ timezone: string; count: number }>;
    totalWithGeo: number;
  };
  smartInsights: {
    avgTimeOnPage: number;
    bounceRate: number;
    engagementScore: number;
    topInterests: Array<{ interest: string; count: number; pct: number }>;
    sectionEngagement: Array<{ section: string; count: number; pct: number }>;
    deviceBreakdown: Array<{ device: string; count: number; pct: number }>;
    peakHour: number;
    contentInteraction: { scrolledPast50Pct: number; scrolledPast75Pct: number; interactedWithForm: number; submittedForm: number; clickedAnyCta: number };
    visitorIntent: { highIntent: number; mediumIntent: number; lowIntent: number; highIntentPct: number; mediumIntentPct: number; lowIntentPct: number };
  } | null;
  liveData: {
    active: number;
    recent: number;
    sessions: Array<{ sessionId: string; ip: string; device: string; os: string; browser: string; geo?: { city?: string; country?: string; region?: string }; currentStep: number; sessionDuration: number; activeTime: number; lastSeen: string; startedAt: string; isActive: boolean }>;
    breakdown: { byCountry: Array<{ country: string; count: number }>; byDevice: Array<{ device: string; count: number }>; byStep: Array<{ step: string; count: number }> };
    timestamp: string;
  } | null;
  trends?: {
    pageViews: { value: number; pct: number; direction: 'up' | 'down' | 'flat' };
    sessions: { value: number; pct: number; direction: 'up' | 'down' | 'flat' };
    leads: { value: number; pct: number; direction: 'up' | 'down' | 'flat' };
    conversionRate: { value: number; pct: number; direction: 'up' | 'down' | 'flat' };
    bounceRate: { value: number; pct: number; direction: 'up' | 'down' | 'flat' };
    avgDuration: { value: number; pct: number; direction: 'up' | 'down' | 'flat' };
  };
  acquisition?: Array<{ channel: string; sessions: number; leads: number; conversionRate: number; pct: number; color: string }>;
  sessionQuality?: { avgPagesPerSession: number; avgSessionDuration: number; engagedSessionsPct: number; newVsReturning: { new: number; returning: number; newPct: number; returningPct: number } };
  linkClicks?: Array<{ label: string; destination: string; count: number; location: string; lastClicked: string }>;
  sectionViews?: Array<{ section: string; count: number; pct: number }>;
}

function getPeriodCutoff(period: string): Date {
  const now = new Date();
  switch (period) {
    case '1h': return new Date(now.getTime() - 60 * 60 * 1000);
    case '24h': return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case '7d': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '90d': return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    default: return new Date(0);
  }
}

function buildFallbackAnalytics(events: RawEvent[], period: string): ComputedAnalytics {
  const sessionMap = new Map<string, RawEvent[]>();
  events.forEach(e => {
    const sid = e.session_id || 'unknown';
    if (!sessionMap.has(sid)) sessionMap.set(sid, []);
    sessionMap.get(sid)!.push(e);
  });
  const uniqueSessions = sessionMap.size;
  const totalEvents = events.length;
  const eventCounts = new Map<string, number>();
  events.forEach(e => { eventCounts.set(e.event, (eventCounts.get(e.event) || 0) + 1); });
  const pageViews = (eventCounts.get('page_view') || 0) + (eventCounts.get('pageview') || 0) + (eventCounts.get('landing_page_view') || 0) + (eventCounts.get('landing_view') || 0) + (eventCounts.get('screen_view') || 0) || uniqueSessions;
  const formSubmits = (eventCounts.get('form_submit') || 0) + (eventCounts.get('form_submitted') || 0) + (eventCounts.get('waitlist_join') || 0) + (eventCounts.get('waitlist_success') || 0);
  const byEvent = Array.from(eventCounts.entries()).map(([event, count]) => ({ event, count })).sort((a, b) => b.count - a.count);
  const dailyMap = new Map<string, { views: number; sessions: Set<string> }>();
  events.forEach(e => {
    const date = e.created_at?.split('T')[0] || 'unknown';
    if (!dailyMap.has(date)) dailyMap.set(date, { views: 0, sessions: new Set() });
    const d = dailyMap.get(date)!;
    d.views++;
    d.sessions.add(e.session_id || 'unknown');
  });
  const dailyViews = Array.from(dailyMap.entries()).map(([date, d]) => ({ date, views: d.views, sessions: d.sessions.size })).sort((a, b) => a.date.localeCompare(b.date));
  const hourlyMap = new Map<number, number>();
  for (let h = 0; h < 24; h++) hourlyMap.set(h, 0);
  events.forEach(e => { const hour = new Date(e.created_at).getHours(); hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + 1); });
  const hourlyActivity = Array.from(hourlyMap.entries()).map(([hour, count]) => ({ hour, count })).sort((a, b) => a.hour - b.hour);
  const countryMap = new Map<string, number>();
  let totalWithGeo = 0;
  events.forEach(e => {
    if (e.geo?.country) { totalWithGeo++; countryMap.set(e.geo.country, (countryMap.get(e.geo.country) || 0) + 1); }
  });
  const byCountry = Array.from(countryMap.entries()).map(([country, count]) => ({ country, count, pct: totalWithGeo > 0 ? Math.round((count / totalWithGeo) * 100) : 0 })).sort((a, b) => b.count - a.count);
  return {
    period, totalLeads: formSubmits, registeredUsers: 0, waitlistLeads: 0, totalEvents, pageViews, uniqueSessions,
    topScreens: [], topActions: [], timeSpent: { totalTrackedSeconds: 0, avgSessionSeconds: 0, avgScreenSeconds: 0, maxSessionSeconds: 0, engagedSessions: 0 },
    funnel: { pageViews, scroll25: 0, scroll50: 0, scroll75: 0, scroll100: 0, formFocuses: 0, formSubmits },
    cta: { getStarted: 0, signIn: 0, jvInquire: 0, websiteClick: 0 },
    conversionRate: pageViews > 0 ? parseFloat(((formSubmits / pageViews) * 100).toFixed(1)) : 0,
    scrollEngagement: 0, byEvent, byPlatform: [], byReferrer: [], dailyViews, hourlyActivity,
    geoZones: { byCountry, byCity: [], byRegion: [], byTimezone: [], totalWithGeo },
    smartInsights: null, liveData: null};
}

async function directSupabaseFetch(period: string): Promise<{ events: RawEvent[]; landingCount: number; appCount: number }> {
  const cutoff = getPeriodCutoff(period);
  let landingEvents: RawEvent[] = [];
  let appEvents: RawEvent[] = [];

  try {
    let landingQuery = supabase.from('landing_analytics').select('id,event,session_id,properties,geo,created_at').order('created_at', { ascending: false }).limit(10000);
    if (period !== 'all') landingQuery = landingQuery.gte('created_at', cutoff.toISOString());
    const { data: landingData, error: landingErr } = await landingQuery;
    if (!landingErr && landingData) {
      landingEvents = landingData.map((row: Record<string, unknown>) => {
        let props: Record<string, unknown> = {};
        if (typeof row.properties === 'string') { try { props = JSON.parse(row.properties); } catch {} }
        else if (row.properties && typeof row.properties === 'object') props = row.properties as Record<string, unknown>;
        let geo: RawEvent['geo'] = undefined;
        if (typeof row.geo === 'string') { try { geo = JSON.parse(row.geo); } catch {} }
        else if (row.geo && typeof row.geo === 'object') geo = row.geo as RawEvent['geo'];
        const rowId = typeof row.id === 'string' ? row.id : typeof row.id === 'number' ? String(row.id) : '';
        const rowEvent = typeof row.event === 'string' ? row.event : 'unknown';
        const rowSessionId = typeof row.session_id === 'string' ? row.session_id : 'unknown';
        const rowCreatedAt = typeof row.created_at === 'string' ? row.created_at : new Date().toISOString();
        return { id: rowId, event: rowEvent, session_id: rowSessionId, properties: { ...props, platform: props.platform || 'web', source: 'landing' }, geo, created_at: rowCreatedAt, _source: 'landing' as EventSource };
      });
    } else if (landingErr) {
      console.log('[Analytics Fallback] landing_analytics error:', landingErr.message);
    }
  } catch (err) {
    console.log('[Analytics Fallback] landing_analytics exception:', (err as Error)?.message);
  }

  try {
    let appQuery = supabase.from('analytics_events').select('id,event,session_id,properties,created_at').order('created_at', { ascending: false }).limit(10000);
    if (period !== 'all') appQuery = appQuery.gte('created_at', cutoff.toISOString());
    const { data: appData, error: appErr } = await appQuery;
    if (!appErr && appData) {
      appEvents = appData.map((row: Record<string, unknown>) => {
        let props: Record<string, unknown> = {};
        if (typeof row.properties === 'string') { try { props = JSON.parse(row.properties); } catch {} }
        else if (row.properties && typeof row.properties === 'object') props = row.properties as Record<string, unknown>;
        const rowId = typeof row.id === 'string' ? row.id : typeof row.id === 'number' ? String(row.id) : '';
        const rowEvent = typeof row.event === 'string' ? row.event : 'unknown';
        const rowSessionId = typeof row.session_id === 'string' ? row.session_id : 'unknown';
        const rowCreatedAt = typeof row.created_at === 'string' ? row.created_at : new Date().toISOString();
        return { id: rowId, event: rowEvent, session_id: rowSessionId, properties: { ...props, source: 'app' }, created_at: rowCreatedAt, _source: 'app' as EventSource };
      });
    } else if (appErr) {
      console.log('[Analytics Fallback] analytics_events error:', appErr.message);
    }
  } catch (err) {
    console.log('[Analytics Fallback] analytics_events exception:', (err as Error)?.message);
  }

  const all = [...landingEvents, ...appEvents].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (all.length === 0) {
    console.log('[Analytics] Supabase returned 0 events — checking AWS local backup...');
    try {
      const awsEvents = await awsAnalyticsBackup.getLocalEvents(period);
      if (awsEvents.length > 0) {
        console.log('[Analytics] AWS FAILOVER READ: found', awsEvents.length, 'events in local backup');
        const awsConverted: RawEvent[] = awsEvents.map(ae => ({
          id: ae.id,
          event: ae.event,
          session_id: ae.session_id,
          properties: { ...(ae.properties || {}), source: ae.source, platform: ae.platform, ip_address: ae.ip_address },
          geo: ae.geo as RawEvent['geo'],
          created_at: ae.created_at,
          _source: (ae.source === 'landing' ? 'landing' : 'app') as EventSource}));
        const awsLanding = awsConverted.filter(e => e._source === 'landing').length;
        const awsApp = awsConverted.filter(e => e._source === 'app').length;
        return { events: awsConverted, landingCount: awsLanding, appCount: awsApp };
      }
    } catch (awsErr) {
      console.log('[Analytics] AWS local backup read error:', (awsErr as Error)?.message);
    }
  }

  return { events: all, landingCount: landingEvents.length, appCount: appEvents.length };
}

async function fetchExtraCountsDirect(): Promise<{ waitlistCount: number; registeredUserCount: number }> {
  let waitlistCount = 0;
  let registeredUserCount = 0;
  try {
    const { count: wc, error: we } = await supabase.from('waitlist').select('*', { count: 'exact', head: true });
    if (!we && wc !== null) waitlistCount = wc;
  } catch {}
  try {
    const { count: rc, error: re } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
    if (!re && rc !== null) registeredUserCount = rc;
  } catch {}
  return { waitlistCount, registeredUserCount };
}

type PeriodType = '1h' | '24h' | '7d' | '30d' | '90d' | 'all';
type TabType = 'overview' | 'funnel' | 'geo' | 'insights' | 'live' | 'brain';

interface AIBrainAnomaly { id: string; title: string; description: string; impact: string; confidence: number }
interface AIBrainPrediction { id: string; title: string; description: string; confidence: number }
interface AIBrainRecommendation { id: string; title: string; description: string; impact: string; confidence: number }
interface AIBrainLearning { id: string; title: string; type: string; confidence: number; dataPoints: number }
interface AIBrainBaseline { avg: number; min: number; max: number; samples: number }
interface AIBrainData {
  status: string;
  memory: { learningCycles: number; totalDataPointsProcessed: number };
  stats: { activeLearnings: number; avgConfidence: number; byType: Record<string, number> };
  activeAnomalies?: AIBrainAnomaly[];
  activePredictions?: AIBrainPrediction[];
  topRecommendations?: AIBrainRecommendation[];
  recentLearnings?: AIBrainLearning[];
  baselines?: Record<string, AIBrainBaseline>;
  newLearnings?: number;
}



const { width: SCREEN_W } = Dimensions.get('window');

const PERIODS: { label: string; value: PeriodType }[] = [
  { label: '1H', value: '1h' },
  { label: '24H', value: '24h' },
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
  { label: 'All', value: 'all' },
];

const TABS: { label: string; value: TabType; icon: React.ReactNode }[] = [
  { label: 'Overview', value: 'overview', icon: <BarChart3 size={14} color="#97A0AF" /> },
  { label: 'Funnel', value: 'funnel', icon: <Layers size={14} color="#97A0AF" /> },
  { label: 'Geo', value: 'geo', icon: <MapPin size={14} color="#97A0AF" /> },
  { label: 'Intel', value: 'insights', icon: <Brain size={14} color="#97A0AF" /> },
  { label: 'Live', value: 'live', icon: <Radio size={14} color="#E53935" /> },
  { label: 'AI Brain', value: 'brain', icon: <Sparkles size={14} color="#FFB800" /> },
];

const IMPACT_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: '#FF4D4D18', text: '#FF4D4D', label: 'CRITICAL' },
  high: { bg: '#FFB80018', text: '#FFB800', label: 'HIGH' },
  medium: { bg: '#4A90D918', text: '#4A90D9', label: 'MEDIUM' },
  low: { bg: '#00C48C18', text: '#00C48C', label: 'LOW' }};

const TYPE_ICONS: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  pattern: { icon: <Activity size={14} color="#7B68EE" />, color: '#7B68EE', label: 'Pattern' },
  anomaly: { icon: <AlertTriangle size={14} color="#FF4D4D" />, color: '#FF4D4D', label: 'Anomaly' },
  prediction: { icon: <TrendingUp size={14} color="#00C48C" />, color: '#00C48C', label: 'Prediction' },
  recommendation: { icon: <Lightbulb size={14} color="#FFB800" />, color: '#FFB800', label: 'Recommendation' },
  trend: { icon: <TrendingDown size={14} color="#4A90D9" />, color: '#4A90D9', label: 'Trend' }};

const COUNTRY_FLAGS: Record<string, string> = {
  'United States': '🇺🇸', 'United Kingdom': '🇬🇧', 'Canada': '🇨🇦', 'Germany': '🇩🇪',
  'France': '🇫🇷', 'Australia': '🇦🇺', 'India': '🇮🇳', 'Brazil': '🇧🇷',
  'Japan': '🇯🇵', 'Mexico': '🇲🇽', 'Spain': '🇪🇸', 'Italy': '🇮🇹',
  'Netherlands': '🇳🇱', 'Switzerland': '🇨🇭', 'Sweden': '🇸🇪', 'Singapore': '🇸🇬',
  'UAE': '🇦🇪', 'United Arab Emirates': '🇦🇪', 'Saudi Arabia': '🇸🇦', 'China': '🇨🇳',
  'South Korea': '🇰🇷', 'Nigeria': '🇳🇬', 'South Africa': '🇿🇦', 'Colombia': '🇨🇴',
  'Argentina': '🇦🇷', 'Portugal': '🇵🇹', 'Ireland': '🇮🇪', 'Poland': '🇵🇱',
  'Turkey': '🇹🇷', 'Philippines': '🇵🇭', 'Indonesia': '🇮🇩', 'Thailand': '🇹🇭'};


const SS_BLUE = '#0073EA';
const SS_GREEN = '#00854D';
const SS_TEAL = '#0097A7';
const SS_RED = '#E53935';
const SS_ORANGE = '#F57C00';
const SS_PURPLE = '#7B61FF';
const SS_YELLOW = '#F9A825';
const SS_NAVY = '#1B365D';
const SS_PINK = '#E91E63';
const SS_LIME = '#7CB342';

const CHART_COLORS = [SS_BLUE, SS_GREEN, SS_ORANGE, SS_PURPLE, SS_TEAL, SS_RED, SS_YELLOW, SS_PINK, SS_LIME, SS_NAVY];

function formatSeconds(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

type IntentRole = 'investor' | 'buyer' | 'seller' | 'broker' | 'lender' | 'unknown';

interface InvestorIntel {
  intent: { role: IntentRole; label: string; count: number; pct: number; color: string }[];
  signals: { key: string; label: string; value: number; color: string }[];
  interests: { key: string; label: string; count: number; pct: number; color: string }[];
  leadQuality: { tier: 'hot' | 'warm' | 'cold' | 'unknown'; label: string; desc: string; count: number; pct: number; color: string }[];
  summary: { traffic: string; behavior: string; opportunity: string; action: string };
  recommendations: { title: string; detail: string; color: string }[];
  totalSignalWeight: number;
}

const TARGET_MARKETS = ['United States', 'United Kingdom', 'Canada', 'United Arab Emirates', 'UAE', 'Saudi Arabia', 'Singapore', 'Australia', 'Germany', 'Switzerland'];

/**
 * Derives privacy-safe investor intelligence from aggregate behaviour analytics only.
 * Uses anonymous event/screen/interest counts, registered/waitlist totals and country
 * distribution — never emails, phone numbers, or private profiles.
 */
function computeInvestorIntelligence(d: ComputedAnalytics): InvestorIntel {
  const unique = d.uniqueSessions || 0;
  const views = d.pageViews || 0;
  const insights = d.smartInsights;

  const corpus: { text: string; count: number }[] = [];
  (d.byEvent ?? []).forEach((e) => corpus.push({ text: e.event.toLowerCase(), count: e.count }));
  (d.topActions ?? []).forEach((a) => corpus.push({ text: a.action.toLowerCase(), count: a.count }));
  (d.topScreens ?? []).forEach((sx) => corpus.push({ text: sx.screen.toLowerCase(), count: sx.views }));
  (insights?.topInterests ?? []).forEach((i) => corpus.push({ text: i.interest.toLowerCase(), count: i.count }));

  const matchCount = (re: RegExp): number => corpus.filter((c) => re.test(c.text)).reduce((t, c) => t + c.count, 0);

  const roleMatchers: { role: IntentRole; re: RegExp; color: string; label: string }[] = [
    { role: 'broker', re: /broker|agent|referr|influencer|commission/, color: '#E879F9', label: 'Likely Broker' },
    { role: 'lender', re: /financ|loan|lend|mortgage|credit|capital/, color: '#FFB800', label: 'Likely Lender' },
    { role: 'seller', re: /sell|listing|inquire|\bjv\b|partner/, color: '#FF6B6B', label: 'Likely Seller' },
    { role: 'investor', re: /invest|portfolio|portal|roi|return|dividend|deal|wealth|fund/, color: '#00C48C', label: 'Likely Investor' },
    { role: 'buyer', re: /buy|purchase|price|own|share|property|home|unit|acquis/, color: '#4A90D9', label: 'Likely Buyer' },
  ];
  const weights: Record<IntentRole, number> = { investor: 0, buyer: 0, seller: 0, broker: 0, lender: 0, unknown: 0 };
  corpus.forEach((item) => {
    for (const m of roleMatchers) {
      if (m.re.test(item.text)) { weights[m.role] += item.count; break; }
    }
  });
  const totalWeight = roleMatchers.reduce((t, m) => t + weights[m.role], 0);
  const known: InvestorIntel['intent'] = roleMatchers.map((m) => {
    const est = totalWeight > 0 ? Math.round((weights[m.role] / totalWeight) * unique) : 0;
    return { role: m.role, label: m.label, count: est, pct: unique > 0 ? Math.round((est / unique) * 100) : 0, color: m.color };
  }).sort((a, b) => b.count - a.count);
  const assigned = known.reduce((t, r) => t + r.count, 0);
  const unknownCount = Math.max(0, unique - assigned);
  const intent: InvestorIntel['intent'] = [...known, { role: 'unknown', label: 'Unknown', count: unknownCount, pct: unique > 0 ? Math.round((unknownCount / unique) * 100) : 0, color: '#97A0AF' }];

  const returning = d.sessionQuality?.newVsReturning.returning ?? 0;
  const engaged = (insights ? insights.visitorIntent.highIntent + insights.visitorIntent.mediumIntent : 0) || (d.timeSpent?.engagedSessions ?? 0);
  const dealViewers = Math.min(unique, matchCount(/deal|property|portfolio|invest|portal/));
  const docViewers = Math.min(unique, matchCount(/document|pdf|tax|legal|report|prospectus|statement/));
  const targetMarketVisitors = (d.geoZones?.byCountry ?? []).filter((c) => TARGET_MARKETS.includes(c.country)).reduce((t, c) => t + c.count, 0);
  const signals: InvestorIntel['signals'] = [
    { key: 'repeat', label: 'Repeat Visitors', value: returning, color: '#7B61FF' },
    { key: 'engaged', label: 'High-Engagement', value: engaged, color: '#00C48C' },
    { key: 'deal', label: 'Deal Viewers', value: dealViewers, color: '#4A90D9' },
    { key: 'doc', label: 'Document Viewers', value: docViewers, color: '#F57C00' },
    { key: 'returned', label: 'Returned Visitors', value: returning, color: '#0097A7' },
    { key: 'target', label: 'Target-Market Visitors', value: targetMarketVisitors, color: '#E91E63' },
  ];

  const interestDefs: { key: string; label: string; re: RegExp; color: string }[] = [
    { key: 'deals', label: 'Real Estate Deals', re: /deal|real ?estate|property/, color: '#00854D' },
    { key: 'multifamily', label: 'Multifamily', re: /multifamily|apartment|duplex|unit/, color: '#0073EA' },
    { key: 'land', label: 'Land', re: /\bland\b|lot|acre|parcel/, color: '#7CB342' },
    { key: 'financing', label: 'Financing', re: /financ|loan|lend|mortgage/, color: '#F9A825' },
    { key: 'acquisitions', label: 'Acquisitions', re: /acquis|buy|purchase/, color: '#F57C00' },
    { key: 'portal', label: 'Investor Portal', re: /portal|portfolio|dashboard|invest/, color: '#7B61FF' },
    { key: 'documents', label: 'Documents', re: /document|pdf|tax|legal|report/, color: '#0097A7' },
  ];
  const interestsRaw = interestDefs.map((def) => ({ ...def, count: matchCount(def.re) }));
  const interestTotal = interestsRaw.reduce((t, i) => t + i.count, 0);
  const interests: InvestorIntel['interests'] = interestsRaw
    .map((i) => ({ key: i.key, label: i.label, color: i.color, count: i.count, pct: interestTotal > 0 ? Math.round((i.count / interestTotal) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);

  const hot = insights?.visitorIntent.highIntent ?? (d.funnel?.formSubmits ?? 0);
  const warm = insights?.visitorIntent.mediumIntent ?? 0;
  const cold = insights?.visitorIntent.lowIntent ?? 0;
  const knownLeads = hot + warm + cold;
  const lqUnknown = Math.max(0, unique - knownLeads);
  const leadQuality: InvestorIntel['leadQuality'] = ([
    { tier: 'hot' as const, label: 'Hot', desc: 'Submitted a form / strong intent', count: hot, color: '#00C48C' },
    { tier: 'warm' as const, label: 'Warm', desc: 'Clicked a CTA / engaged', count: warm, color: '#FFB800' },
    { tier: 'cold' as const, label: 'Cold', desc: 'Browsed only', count: cold, color: '#4A90D9' },
    { tier: 'unknown' as const, label: 'Unknown', desc: 'Not enough signal yet', count: lqUnknown, color: '#97A0AF' },
  ]).map((x) => ({ ...x, pct: unique > 0 ? Math.round((x.count / unique) * 100) : 0 }));

  const cvr = d.conversionRate || 0;
  const signups = d.funnel?.formSubmits ?? 0;
  const returningPct = d.sessionQuality?.newVsReturning.returningPct ?? 0;
  const bounce = insights?.bounceRate ?? 0;
  const topInterest = interests.find((i) => i.count > 0)?.label ?? 'general browsing';
  const topScreen = (d.topScreens ?? [])[0]?.screen;
  const fmt = (n: number): string => new Intl.NumberFormat('en-US').format(n);

  const traffic = `${fmt(views)} views from ${fmt(unique)} unique visitors. ${returningPct}% returned at least once${bounce ? `, and ${bounce}% bounced after a single screen` : ''}.`;
  const behavior = knownLeads > 0
    ? `${hot} hot, ${warm} warm and ${cold} cold visitors by behaviour. Strongest interest signal so far: ${topInterest}.`
    : `Visitors are browsing${topScreen ? ` (most viewed: ${topScreen})` : ''} but leaving few intent signals. Strongest interest so far: ${topInterest}.`;
  const opportunity = signups === 0
    ? `${fmt(unique)} visitors arrived but 0 converted — that is an untapped pipeline. Even a 2% capture rate would be ~${fmt(Math.max(1, Math.round(unique * 0.02)))} leads.`
    : `${hot + warm} warm/hot visitors are not yet customers — a focused follow-up could convert them.`;
  const action = signups === 0
    ? `Conversion is ${cvr}%. The page is attracting attention but capturing nobody. Add ONE clear above-the-fold call-to-action and a short (name + email) capture form on ${topScreen ?? 'the landing page'}, then re-check in 48h.`
    : `Double down on ${topInterest}: surface it earlier and add a follow-up form to capture warm visitors.`;

  const fSteps = [
    { label: 'Page Views', count: d.funnel?.pageViews ?? 0 },
    { label: 'Scroll 50%', count: d.funnel?.scroll50 ?? 0 },
    { label: 'Scroll 75%', count: d.funnel?.scroll75 ?? 0 },
    { label: 'Form Focus', count: d.funnel?.formFocuses ?? 0 },
    { label: 'Sign-up', count: d.funnel?.formSubmits ?? 0 },
  ];
  let dropFrom = 'Page Views';
  let dropTo = 'Sign-up';
  let dropPct = 0;
  for (let i = 1; i < fSteps.length; i++) {
    const prev = fSteps[i - 1].count;
    const cur = fSteps[i].count;
    const dp = prev > 0 ? Math.round(((prev - cur) / prev) * 100) : 0;
    if (dp >= dropPct) { dropPct = dp; dropFrom = fSteps[i - 1].label; dropTo = fSteps[i].label; }
  }

  const recommendations: InvestorIntel['recommendations'] = [
    { title: 'Strengthen the primary CTA', detail: topScreen ? `"${topScreen}" gets the most views but little action — make its call-to-action bigger, higher-contrast and above the fold.` : 'Add a single, high-contrast call-to-action above the fold.', color: '#00854D' },
    { title: 'Plug the biggest drop-off', detail: dropPct > 0 ? `Most visitors fall off between ${dropFrom} and ${dropTo} (-${dropPct}%). Reduce the friction at that step.` : 'Add scroll-depth and form tracking so the exact drop-off point becomes visible.', color: '#E53935' },
    { title: 'Lead with what they want', detail: `Visitors signal the most interest in ${topInterest}. Put that message in the hero headline.`, color: '#0073EA' },
    { title: 'Add a short follow-up form', detail: 'Capture name + email only (2 fields). Long or buried forms are the #1 reason conversion stays at 0%.', color: '#7B61FF' },
    { title: 'Feature the deal getting attention', detail: topInterest !== 'general browsing' ? `${topInterest} is attracting the most interest — feature a live deal for it to give visitors a reason to sign up.` : 'Feature one flagship deal so visitors have a concrete reason to sign up.', color: '#F57C00' },
  ];

  return { intent, signals, interests, leadQuality, summary: { traffic, behavior, opportunity, action }, recommendations, totalSignalWeight: totalWeight };
}

function AnimatedRing({ percent, size, strokeWidth, color, children }: {
  percent: number; size: number; strokeWidth: number; color: string; children?: React.ReactNode;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: percent, duration: 1200, useNativeDriver: false }).start();
  }, [percent, anim]);

  const segments = 36;
  const radius = (size - strokeWidth) / 2;
  const segmentAngle = 360 / segments;
  const filled = Math.round((percent / 100) * segments);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: segments }).map((_, i) => {
        const angle = (i * segmentAngle - 90) * (Math.PI / 180);
        const x = Math.cos(angle) * radius + size / 2 - 2;
        const y = Math.sin(angle) * radius + size / 2 - 2;
        const isFilled = i < filled;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor: isFilled ? color : '#1E1E22'}}
          />
        );
      })}
      <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
        {renderSafeViewChildren(children)}
      </View>
    </View>
  );
}

function MiniSparkBar({ data, color, height = 48 }: { data: number[]; color: string; height?: number }) {
  const max = Math.max(...data, 1);
  const barWidth = Math.max(Math.floor((SCREEN_W - 80) / data.length) - 2, 3);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height, gap: 2 }}>
      {data.map((val, i) => {
        const h = Math.max((val / max) * height, 2);
        const isLast = i === data.length - 1;
        return (
          <View
            key={i}
            style={{
              width: barWidth,
              height: h,
              borderRadius: 2,
              backgroundColor: isLast ? color : color + '60'}}
          />
        );
      })}
    </View>
  );
}

function AnimatedCounter({ value, suffix = '', prefix = '' }: { value: number; suffix?: string; prefix?: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState<number>(0);

  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, { toValue: value, duration: 800, useNativeDriver: false }).start();
    const listener = anim.addListener(({ value: v }) => setDisplay(Math.round(v as number)));
    return () => anim.removeListener(listener);
  }, [value, anim]);

  return <Text style={s.counterText}>{prefix}{new Intl.NumberFormat('en-US').format(display)}{suffix}</Text>;
}

function TrendBadge({ value, inverted = false }: { value: number; inverted?: boolean }) {
  const isPositive = inverted ? value < 0 : value > 0;
  const absVal = Math.abs(value);
  return (
    <View style={[s.trendBadge, { backgroundColor: isPositive ? '#00C48C15' : '#FF6B6B15' }]}>
      {isPositive ? (
        <ArrowUpRight size={10} color="#00C48C" />
      ) : (
        <ArrowDownRight size={10} color="#FF6B6B" />
      )}
      <Text style={[s.trendText, { color: isPositive ? '#00C48C' : '#FF6B6B' }]}>
        {absVal}%
      </Text>
    </View>
  );
}

function PulseIndicator({ active }: { active: boolean }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (active) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.6, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
    }
  }, [active, pulse]);

  return (
    <View style={s.pulseWrap}>
      {active && (
        <Animated.View style={[s.pulseRing, { transform: [{ scale: pulse }], borderColor: '#00C48C40' }]} />
      )}
      <View style={[s.pulseDot, { backgroundColor: active ? '#00C48C' : '#555' }]} />
    </View>
  );
}

export default function LandingAnalyticsScreen() {
  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const { isAuthenticated, isAdmin, isLoading: authLoading, refreshSession, isOwnerIPAccess, userId: authUserId } = useAuth();
  const [period, setPeriod] = useState<PeriodType>('all');
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [directData, setDirectData] = useState<ComputedAnalytics | null>(null);
  const [, setIsConnected] = useState<boolean>(false);
  const [, setFetchCount] = useState<number>(0);
  const [diagnostics, setDiagnostics] = useState<{
    supabaseUrl: string;
    authState: string;
    userId: string | null;
    landingCount: number;
    appCount: number;
    error: string | null;
    lastFetch: string;
  } | null>(null);
  const [rpcDeploying, setRpcDeploying] = useState<boolean>(false);
  const [rpcDeployResult, setRpcDeployResult] = useState<string | null>(null);

  const presenceState = usePresenceTracker();

  const headerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(headerAnim, { toValue: 1, tension: 40, friction: 10, useNativeDriver: true }).start();
  }, [headerAnim]);

  useEffect(() => {
    if (!authLoading && isAuthenticated && !isAdmin && !isOwnerIPAccess) {
      void refreshSession();
    }
  }, [authLoading, isAuthenticated, isAdmin, isOwnerIPAccess, refreshSession]);

  const analyticsQuery = useQuery<ComputedAnalytics>({
    queryKey: ['admin.analytics.report', { period }],
    queryFn: async () => {
      const sbUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
      let authState = 'unknown';
      let userId: string | null = null;

      if (!isSupabaseConfigured()) {
        console.error('[Admin Analytics] Supabase not configured');
        setDiagnostics({ supabaseUrl: 'NOT SET', authState: 'none', userId: null, landingCount: 0, appCount: 0, error: 'Supabase not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.', lastFetch: new Date().toISOString() });
        return buildFallbackAnalytics([], period);
      }

      if (isOwnerIPAccess && isAuthenticated) {
        authState = 'owner-ip';
        userId = authUserId ?? 'owner-ip';
        console.log('[Admin Analytics] Owner IP access detected — skipping Supabase session check');
      } else {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          authState = session ? 'authenticated' : 'anonymous';
          userId = session?.user?.id ?? null;
          if (!session) {
            console.log('[Admin Analytics] No session — attempting refresh (RLS SELECT requires authenticated)...');
            const { data: refreshed } = await supabase.auth.refreshSession();
            if (refreshed?.session) {
              authState = 'authenticated (refreshed)';
              userId = refreshed.session.user?.id ?? null;
              console.log('[Admin Analytics] Session refreshed successfully');
            } else {
              console.warn('[Admin Analytics] WARNING: No auth session. Analytics data will not load — RLS requires authenticated user for SELECT.');
              authState = 'anonymous (RLS will block reads)';
            }
          }
          console.log('[Admin Analytics] Auth:', authState, '| User:', userId?.substring(0, 8) ?? 'none');
        } catch (authErr) {
          authState = 'error';
          console.error('[Admin Analytics] Auth check failed:', (authErr as Error)?.message);
        }
      }

      let computed: ComputedAnalytics | null = null;
      let landingCount = 0;
      let appCount = 0;
      let fetchError: string | null = null;

      try {
        console.log('[Admin Analytics] Using analytics-compute module for period:', period);
        const rawEvents = await fetchAnalyticsRawEvents(period);
        landingCount = rawEvents.filter(e => e._source === 'landing').length;
        appCount = rawEvents.filter(e => e._source === 'app').length;
        console.log('[Admin Analytics] Raw events:', rawEvents.length, '(landing:', landingCount, ', app:', appCount, ')');

        computed = computeAnalyticsData(rawEvents, period) as unknown as ComputedAnalytics;

        const extras = await fetchAnalyticsExtraCounts();
        if (extras.registeredUserCount > 0) computed.registeredUsers = extras.registeredUserCount;
        if (extras.waitlistCount > 0) computed.waitlistLeads = extras.waitlistCount;
        computed.totalLeads = computed.registeredUsers + computed.waitlistLeads;
      } catch (err) {
        fetchError = (err as Error)?.message ?? 'Unknown error';
        console.log('[Admin Analytics] Compute module note (falling back to direct fetch):', fetchError);
        computed = null;
      }

      if (!computed) {
        try {
          console.log('[Admin Analytics] Direct Supabase fallback for period:', period);
          const result = await directSupabaseFetch(period);
          landingCount = result.landingCount;
          appCount = result.appCount;
          console.log('[Admin Analytics] Direct fetch:', result.events.length, 'events (landing:', landingCount, ', app:', appCount, ')');

          computed = buildFallbackAnalytics(result.events, period);

          const extras = await fetchExtraCountsDirect();
          if (extras.registeredUserCount > 0) computed.registeredUsers = extras.registeredUserCount;
          if (extras.waitlistCount > 0) computed.waitlistLeads = extras.waitlistCount;
          computed.totalLeads = computed.registeredUsers + computed.waitlistLeads;
          fetchError = null;
        } catch (directErr) {
          fetchError = (directErr as Error)?.message ?? 'Direct fetch failed';
          console.log('[Admin Analytics] Direct fallback also failed:', fetchError);
          computed = buildFallbackAnalytics([], period);
        }
      }

      const totalEvents = landingCount + appCount;
      const isRealError = fetchError && totalEvents === 0 && !fetchError.includes('landing_analytics');
      setDiagnostics({
        supabaseUrl: sbUrl?.substring(0, 50) || 'NOT SET',
        authState,
        userId,
        landingCount,
        appCount,
        error: isRealError ? fetchError : null,
        lastFetch: new Date().toISOString()});

      console.log('[Admin Analytics] Final:', computed.pageViews, 'views,', computed.uniqueSessions, 'sessions, leads:', computed.totalLeads);
      setDirectData(computed);
      setIsConnected(totalEvents > 0);
      setFetchCount(prev => prev + 1);
      return computed;
    },
    staleTime: 30000,
    refetchInterval: activeTab === 'live' ? 15000 : 120000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt), 10000),
    gcTime: 60000,
    refetchOnMount: true,
    throwOnError: false});

  const [manualRefreshing, setManualRefreshing] = useState<boolean>(false);
  const queryClient = useQueryClient();
  const onRefresh = useCallback(async () => {
    setManualRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['admin.analytics.report'] });
    setManualRefreshing(false);
  }, [queryClient]);

  const rawData = useMemo(() => {
    if (directData && (directData.pageViews > 0 || directData.totalLeads > 0)) {
      return directData;
    }
    if (analyticsQuery.data) return analyticsQuery.data;
    if (directData) return directData;
    return undefined;
  }, [directData, analyticsQuery.data]);

  const data = useMemo(() => {
    if (!rawData) return undefined;
    const defaultFunnel = { pageViews: 0, scroll25: 0, scroll50: 0, scroll75: 0, formFocuses: 0, formSubmits: 0 };
    const defaultCta = { getStarted: 0, signIn: 0, jvInquire: 0, websiteClick: 0 };
    return {
      ...rawData,
      pageViews: rawData.pageViews ?? 0,
      uniqueSessions: rawData.uniqueSessions ?? 0,
      conversionRate: rawData.conversionRate ?? 0,
      totalLeads: rawData.totalLeads ?? 0,
      topScreens: rawData.topScreens ?? [],
      topActions: rawData.topActions ?? [],
      timeSpent: rawData.timeSpent ?? { totalTrackedSeconds: 0, avgSessionSeconds: 0, avgScreenSeconds: 0, maxSessionSeconds: 0, engagedSessions: 0 },
      funnel: rawData.funnel ? { ...defaultFunnel, ...rawData.funnel } : defaultFunnel,
      cta: rawData.cta ? { ...defaultCta, ...rawData.cta } : defaultCta,
      hourlyActivity: rawData.hourlyActivity ?? [],
      dailyViews: rawData.dailyViews ?? [],
      byPlatform: rawData.byPlatform ?? [],
      byReferrer: rawData.byReferrer ?? [],
      byEvent: rawData.byEvent ?? [],
      geoZones: rawData.geoZones ? {
        ...rawData.geoZones,
        byCountry: rawData.geoZones.byCountry ?? [],
        byCity: rawData.geoZones.byCity ?? [],
        byTimezone: rawData.geoZones.byTimezone ?? [],
        totalWithGeo: rawData.geoZones.totalWithGeo ?? 0} : { byCountry: [] as ComputedAnalytics['geoZones']['byCountry'], byCity: [] as ComputedAnalytics['geoZones']['byCity'], byTimezone: [] as ComputedAnalytics['geoZones']['byTimezone'], totalWithGeo: 0, byRegion: [] as ComputedAnalytics['geoZones']['byRegion'] },
      smartInsights: rawData.smartInsights ? {
        ...rawData.smartInsights,
        engagementScore: rawData.smartInsights.engagementScore ?? 0,
        avgTimeOnPage: rawData.smartInsights.avgTimeOnPage ?? 0,
        bounceRate: rawData.smartInsights.bounceRate ?? 0,
        peakHour: rawData.smartInsights.peakHour ?? 0,
        visitorIntent: rawData.smartInsights.visitorIntent ?? {
          highIntent: 0, highIntentPct: 0, mediumIntent: 0, mediumIntentPct: 0, lowIntent: 0, lowIntentPct: 0},
        deviceBreakdown: rawData.smartInsights.deviceBreakdown ?? [],
        topInterests: rawData.smartInsights.topInterests ?? []} : null,
      liveData: rawData.liveData ?? null};
  }, [rawData]);

  const investorIntel = useMemo<InvestorIntel | null>(() => {
    if (!data) return null;
    return computeInvestorIntelligence(data as ComputedAnalytics);
  }, [data]);

  const liveData = useMemo(() => {
    if (data?.liveData) return data.liveData;
    return null;
  }, [data]);
  const liveLoading = analyticsQuery.isLoading && !data;
  const liveError: string | null = analyticsQuery.isError ? (analyticsQuery.error?.message || 'Unable to fetch data') : null;

  const funnelSteps = useMemo(() => {
    if (!data) return [];
    return [
      { label: 'Page Views', count: data.funnel.pageViews, color: '#4A90D9', pct: 100 },
      { label: 'Scroll 25%', count: data.funnel.scroll25, color: '#7B68EE', pct: data.funnel.pageViews > 0 ? Math.round((data.funnel.scroll25 / data.funnel.pageViews) * 100) : 0 },
      { label: 'Scroll 50%', count: data.funnel.scroll50, color: '#9B59B6', pct: data.funnel.pageViews > 0 ? Math.round((data.funnel.scroll50 / data.funnel.pageViews) * 100) : 0 },
      { label: 'Scroll 75%', count: data.funnel.scroll75, color: SS_ORANGE, pct: data.funnel.pageViews > 0 ? Math.round((data.funnel.scroll75 / data.funnel.pageViews) * 100) : 0 },
      { label: 'Form Focus', count: data.funnel.formFocuses, color: '#00C48C', pct: data.funnel.pageViews > 0 ? Math.round((data.funnel.formFocuses / data.funnel.pageViews) * 100) : 0 },
      { label: 'Submitted', count: data.funnel.formSubmits, color: '#27AE60', pct: data.funnel.pageViews > 0 ? Math.round((data.funnel.formSubmits / data.funnel.pageViews) * 100) : 0 },
    ];
  }, [data]);

  const hourlyData = useMemo(() => {
    if (!data) return [];
    return data.hourlyActivity.map((h: { hour: number; count: number }) => h.count);
  }, [data]);

  const dailyData = useMemo(() => {
    if (!data) return [];
    return data.dailyViews.slice(-14).map((d: { date: string; views: number; sessions: number }) => d.views);
  }, [data]);

  const deployRpcFunctions = useCallback(async () => {
    setRpcDeploying(true);
    setRpcDeployResult(null);
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const rpcSql = `
-- Core data access RPCs (bypass RLS for admin analytics reads)
CREATE OR REPLACE FUNCTION public.get_landing_analytics(
  p_cutoff timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50000
) RETURNS SETOF landing_analytics
LANGUAGE sql SECURITY DEFINER STABLE
AS $
  SELECT * FROM landing_analytics
  WHERE (p_cutoff IS NULL OR created_at >= p_cutoff)
  ORDER BY created_at DESC
  LIMIT p_limit;
$;

CREATE OR REPLACE FUNCTION public.get_analytics_events(
  p_cutoff timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50000
) RETURNS SETOF analytics_events
LANGUAGE sql SECURITY DEFINER STABLE
AS $
  SELECT * FROM analytics_events
  WHERE (p_cutoff IS NULL OR created_at >= p_cutoff)
  ORDER BY created_at DESC
  LIMIT p_limit;
$;

GRANT EXECUTE ON FUNCTION public.get_landing_analytics TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_analytics_events TO anon, authenticated;

-- Server-side aggregation RPCs
CREATE OR REPLACE FUNCTION public.analytics_overview(p_period text)
RETURNS json AS $
DECLARE
  cutoff timestamptz;
  result json;
BEGIN
  cutoff := CASE p_period
    WHEN '1h' THEN now() - interval '1 hour'
    WHEN '24h' THEN now() - interval '24 hours'
    WHEN '7d' THEN now() - interval '7 days'
    WHEN '30d' THEN now() - interval '30 days'
    WHEN '90d' THEN now() - interval '90 days'
    ELSE '1970-01-01'::timestamptz
  END;
  SELECT json_build_object(
    'total_events', COUNT(*),
    'unique_sessions', COUNT(DISTINCT session_id),
    'page_views', COUNT(*) FILTER (WHERE event IN ('page_view','pageview','landing_page_view','screen_view')),
    'form_submits', COUNT(*) FILTER (WHERE event IN ('form_submit','form_submitted','waitlist_join','waitlist_success')),
    'conversion_rate', CASE
      WHEN COUNT(*) FILTER (WHERE event IN ('page_view','pageview','landing_page_view','screen_view')) > 0
      THEN ROUND(
        (COUNT(*) FILTER (WHERE event IN ('form_submit','form_submitted','waitlist_join','waitlist_success'))::numeric /
         COUNT(*) FILTER (WHERE event IN ('page_view','pageview','landing_page_view','screen_view'))::numeric) * 100, 1
      ) ELSE 0 END,
    'bounce_rate', CASE WHEN COUNT(DISTINCT session_id) > 0 THEN ROUND(
      (COUNT(DISTINCT session_id) FILTER (WHERE session_id IN (
        SELECT si FROM (SELECT session_id si, COUNT(*) c FROM landing_analytics WHERE created_at >= cutoff GROUP BY session_id) sub WHERE c = 1
      ))::numeric / COUNT(DISTINCT session_id)::numeric) * 100, 1
    ) ELSE 0 END,
    'avg_session_duration', 0
  ) INTO result
  FROM landing_analytics WHERE created_at >= cutoff;
  RETURN result;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.analytics_geo_breakdown(p_period text)
RETURNS json AS $
DECLARE
  cutoff timestamptz;
  result json;
BEGIN
  cutoff := CASE p_period
    WHEN '1h' THEN now() - interval '1 hour'
    WHEN '24h' THEN now() - interval '24 hours'
    WHEN '7d' THEN now() - interval '7 days'
    WHEN '30d' THEN now() - interval '30 days'
    WHEN '90d' THEN now() - interval '90 days'
    ELSE '1970-01-01'::timestamptz
  END;
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO result
  FROM (
    SELECT geo->>'country' as country, COUNT(*) as count,
      ROUND((COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER(), 0)) * 100, 1) as pct
    FROM landing_analytics
    WHERE created_at >= cutoff AND geo->>'country' IS NOT NULL
    GROUP BY geo->>'country' ORDER BY count DESC LIMIT 50
  ) t;
  RETURN result;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.analytics_source_breakdown(p_period text)
RETURNS json AS $
DECLARE
  cutoff timestamptz;
  result json;
BEGIN
  cutoff := CASE p_period
    WHEN '1h' THEN now() - interval '1 hour'
    WHEN '24h' THEN now() - interval '24 hours'
    WHEN '7d' THEN now() - interval '7 days'
    WHEN '30d' THEN now() - interval '30 days'
    WHEN '90d' THEN now() - interval '90 days'
    ELSE '1970-01-01'::timestamptz
  END;
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO result
  FROM (
    SELECT COALESCE(properties->>'referrer', 'direct') as source,
      COUNT(DISTINCT session_id) as sessions,
      COUNT(*) FILTER (WHERE event IN ('form_submit','form_submitted','waitlist_join','waitlist_success')) as leads,
      CASE WHEN COUNT(DISTINCT session_id) > 0 THEN ROUND(
        (COUNT(*) FILTER (WHERE event IN ('form_submit','form_submitted','waitlist_join','waitlist_success'))::numeric /
         COUNT(DISTINCT session_id)::numeric) * 100, 1
      ) ELSE 0 END as conversion_rate
    FROM landing_analytics
    WHERE created_at >= cutoff
    GROUP BY properties->>'referrer' ORDER BY sessions DESC LIMIT 20
  ) t;
  RETURN result;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.analytics_lead_summary(p_period text)
RETURNS json AS $
DECLARE
  cutoff timestamptz;
  result json;
BEGIN
  cutoff := CASE p_period
    WHEN '1h' THEN now() - interval '1 hour'
    WHEN '24h' THEN now() - interval '24 hours'
    WHEN '7d' THEN now() - interval '7 days'
    WHEN '30d' THEN now() - interval '30 days'
    WHEN '90d' THEN now() - interval '90 days'
    ELSE '1970-01-01'::timestamptz
  END;
  SELECT json_build_object(
    'total_leads', COALESCE((SELECT COUNT(*) FROM waitlist), 0) + COALESCE((SELECT COUNT(*) FROM profiles), 0),
    'waitlist_count', COALESCE((SELECT COUNT(*) FROM waitlist), 0),
    'registered_count', COALESCE((SELECT COUNT(*) FROM profiles), 0),
    'hot_leads', COUNT(DISTINCT session_id) FILTER (WHERE event IN ('form_submit','form_submitted','waitlist_join','waitlist_success')),
    'warm_leads', COUNT(DISTINCT session_id) FILTER (WHERE event LIKE 'cta_%' AND event NOT IN ('form_submit','form_submitted'))
  ) INTO result
  FROM landing_analytics WHERE created_at >= cutoff;
  RETURN result;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.analytics_live_count()
RETURNS json AS $
DECLARE result json;
BEGIN
  SELECT json_build_object(
    'active', COUNT(DISTINCT session_id)
  ) INTO result
  FROM landing_analytics
  WHERE created_at >= now() - interval '5 minutes';
  RETURN result;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.analytics_overview TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_geo_breakdown TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_source_breakdown TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_lead_summary TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_live_count TO anon, authenticated;
      `.trim();

      const apiBase = (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim();
      if (apiBase) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (token) {
            console.log('[Analytics] Trying auto-deploy of RPC functions via API...');
            const resp = await fetch(`${apiBase}/execute-sql`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`},
              body: JSON.stringify({ sql: rpcSql })});
            if (resp.ok) {
              console.log('[Analytics] RPC functions deployed successfully via API');
              setRpcDeployResult('success');
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              await queryClient.invalidateQueries({ queryKey: ['admin.analytics.report'] });
              setRpcDeploying(false);
              return;
            }
            console.log('[Analytics] API deploy failed:', resp.status, '- falling back to clipboard');
          }
        } catch (apiErr) {
          console.log('[Analytics] API deploy error:', (apiErr as Error)?.message);
        }
      }

      await Clipboard.setStringAsync(rpcSql);
      setRpcDeployResult('copied');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      console.log('[Analytics] RPC SQL copied to clipboard for manual deploy');
    } catch (err) {
      console.error('[Analytics] Deploy RPC error:', (err as Error)?.message);
      setRpcDeployResult('error');
    } finally {
      setRpcDeploying(false);
    }
  }, [queryClient]);

  const renderDiagnostics = () => {
    if (!diagnostics) return null;
    const hasIssue = diagnostics.error || (diagnostics.landingCount === 0 && diagnostics.appCount === 0);
    if (!hasIssue) return null;

    const isRlsBlocking = diagnostics.error?.includes('RLS') || diagnostics.error?.includes('No events found') || (diagnostics.landingCount === 0 && diagnostics.appCount === 0);
    const borderColor = diagnostics.error ? '#FF6B6B' : '#FFB800';

    return (
      <View style={[s.card, { borderLeftWidth: 3, borderLeftColor: borderColor }]}>
        <View style={s.cardHeader}>
          <AlertTriangle size={16} color={borderColor} />
          <Text style={s.cardTitle}>Analytics Status</Text>
        </View>
        <View style={{ gap: 6, paddingHorizontal: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: '#97A0AF', fontSize: 11 }}>Auth: {diagnostics.authState}</Text>
            <Text style={{ color: '#97A0AF', fontSize: 11 }}>Events: {diagnostics.landingCount + diagnostics.appCount}</Text>
          </View>
          {diagnostics.error && (
            <View style={{ backgroundColor: '#FF6B6B12', borderRadius: 8, padding: 10, marginTop: 4 }}>
              <Text style={{ color: '#FF6B6B', fontSize: 11, fontWeight: '600' as const, lineHeight: 16 }}>
                {diagnostics.error.length > 200 ? diagnostics.error.substring(0, 200) + '...' : diagnostics.error}
              </Text>
            </View>
          )}
          {isRlsBlocking && (
            <View style={{ backgroundColor: '#FFB80012', borderRadius: 8, padding: 10, marginTop: 4 }}>
              <Text style={{ color: '#FFB800', fontSize: 11, fontWeight: '700' as const }}>RLS is blocking analytics reads</Text>
              <Text style={{ color: '#FFB800', fontSize: 10, marginTop: 4, lineHeight: 15 }}>Your data exists in Supabase but RLS policies prevent reading it. Deploy the analytics RPC functions to fix this.</Text>
              <TouchableOpacity
                onPress={deployRpcFunctions}
                disabled={rpcDeploying}
                style={{
                  backgroundColor: rpcDeployResult === 'success' ? '#00C48C' : '#FFB800',
                  borderRadius: 8,
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  marginTop: 8,
                  alignItems: 'center',
                  opacity: rpcDeploying ? 0.6 : 1}}
              >
                <Text style={{ color: '#000', fontSize: 12, fontWeight: '800' as const }}>
                  {rpcDeploying ? 'Deploying...' : rpcDeployResult === 'success' ? 'Deployed! Refreshing...' : rpcDeployResult === 'copied' ? 'SQL Copied! Paste in Supabase SQL Editor' : 'Deploy Analytics Fix'}
                </Text>
              </TouchableOpacity>
              {rpcDeployResult === 'copied' && (
                <Text style={{ color: '#97A0AF', fontSize: 9, marginTop: 4, lineHeight: 14 }}>Go to Supabase Dashboard {'>'} SQL Editor {'>'} Paste {'>'} Run. Then pull down to refresh.</Text>
              )}
            </View>
          )}
          <Text style={{ color: '#C0C7D3', fontSize: 9, marginTop: 2 }}>Updated: {new Date(diagnostics.lastFetch).toLocaleTimeString()}</Text>
        </View>
      </View>
    );
  };

  const renderOverviewTab = () => {
    if (!data) return null;

    const convPct = parseFloat(String(data.conversionRate)) || 0;
    const totalViews = data.pageViews;
    const totalUnique = data.uniqueSessions;
    const totalRegistrations = data.funnel.formSubmits;

    return (
      <>
        {renderDiagnostics()}
        <View style={s.heroMetrics}>
          <View style={s.heroMetricMain}>
            <View style={s.heroMetricHeader}>
              <Eye size={18} color="#4A90D9" />
              <Text style={s.heroMetricLabel}>Total Views</Text>
            </View>
            <AnimatedCounter value={totalViews} />
            {totalViews > 0 && data.trends?.pageViews ? <TrendBadge value={data.trends.pageViews.direction === 'down' ? -data.trends.pageViews.pct : data.trends.pageViews.pct} /> : null}
          </View>

          <View style={s.heroMetricDivider} />

          <View style={s.heroMetricMain}>
            <View style={s.heroMetricHeader}>
              <Users size={18} color="#7B68EE" />
              <Text style={s.heroMetricLabel}>Unique Visitors</Text>
            </View>
            <AnimatedCounter value={totalUnique} />
            {totalUnique > 0 && data.trends?.sessions ? <TrendBadge value={data.trends.sessions.direction === 'down' ? -data.trends.sessions.pct : data.trends.sessions.pct} /> : null}
          </View>
        </View>

        <View style={s.ringRow}>
          <View style={s.ringCard}>
            <AnimatedRing percent={convPct} size={90} strokeWidth={8} color="#00C48C">
              <Text style={s.ringValue}>{convPct}%</Text>
              <Text style={s.ringLabel}>CVR</Text>
            </AnimatedRing>
            <Text style={s.ringCardLabel}>Conversion Rate</Text>
          </View>

          <View style={s.ringCard}>
            <AnimatedRing
              percent={data.funnel.pageViews > 0 ? Math.min(Math.round((data.funnel.scroll75 / data.funnel.pageViews) * 100), 100) : 0}
              size={90}
              strokeWidth={8}
              color="#7B68EE"
            >
              <Text style={s.ringValue}>
                {data.funnel.pageViews > 0 ? Math.round((data.funnel.scroll75 / data.funnel.pageViews) * 100) : 0}%
              </Text>
              <Text style={s.ringLabel}>Depth</Text>
            </AnimatedRing>
            <Text style={s.ringCardLabel}>Scroll Depth</Text>
          </View>

          <View style={s.ringCard}>
            <AnimatedRing
              percent={Math.min(totalRegistrations * 5, 100)}
              size={90}
              strokeWidth={8}
              color="#FFD700"
            >
              <Text style={s.ringValue}>{totalRegistrations}</Text>
              <Text style={s.ringLabel}>Signups</Text>
            </AnimatedRing>
            <Text style={s.ringCardLabel}>Registrations</Text>
          </View>
        </View>

        {dailyData.length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <TrendingUp size={16} color="#00C48C" />
              <Text style={s.cardTitle}>Daily Traffic</Text>
              <View style={s.cardBadge}>
                <Text style={s.cardBadgeText}>{data.dailyViews.length}d</Text>
              </View>
            </View>
            <MiniSparkBar data={dailyData} color="#4A90D9" height={56} />
            <View style={s.sparkLabelRow}>
              <Text style={s.sparkLabel}>{data.dailyViews.slice(-14)[0]?.date?.slice(5) || ''}</Text>
              <Text style={s.sparkLabel}>Today</Text>
            </View>
          </View>
        )}

        {hourlyData.length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Clock size={16} color="#7B68EE" />
              <Text style={s.cardTitle}>Hourly Heatmap</Text>
            </View>
            <View style={s.heatmapGrid}>
              {hourlyData.map((count: number, i: number) => {
                const max = Math.max(...hourlyData, 1);
                const intensity = count / max;
                const bgColor = count === 0 ? '#111' : `rgba(74, 144, 217, ${0.15 + intensity * 0.85})`;
                return (
                  <View key={i} style={[s.heatmapCell, { backgroundColor: bgColor }]}>
                    <Text style={[s.heatmapHour, count > 0 && { color: '#fff' }]}>{i}</Text>
                    {count > 0 && <Text style={s.heatmapCount}>{count}</Text>}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Clock size={16} color={SS_ORANGE} />
            <Text style={s.cardTitle}>Screen & Click Breakdown</Text>
            <View style={s.cardBadge}>
              <Text style={s.cardBadgeText}>{data.timeSpent?.totalTrackedSeconds ?? 0}s tracked</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
            <View style={{ flex: 1, backgroundColor: '#4A90D912', borderRadius: 12, padding: 14, alignItems: 'center' }}>
              <Text style={{ fontSize: 11, fontWeight: '700' as const, color: '#4A90D9' }}>Avg Session</Text>
              <Text style={{ fontSize: 22, fontWeight: '900' as const, color: '#1B2A3D', marginTop: 6 }}>{data.timeSpent?.avgSessionSeconds ?? 0}s</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: '#00C48C12', borderRadius: 12, padding: 14, alignItems: 'center' }}>
              <Text style={{ fontSize: 11, fontWeight: '700' as const, color: '#00C48C' }}>Engaged Sessions</Text>
              <Text style={{ fontSize: 22, fontWeight: '900' as const, color: '#1B2A3D', marginTop: 6 }}>{data.timeSpent?.engagedSessions ?? 0}</Text>
            </View>
          </View>
          <View style={{ gap: 10 }}>
            <Text style={{ fontSize: 12, fontWeight: '800' as const, color: '#5E6C84', textTransform: 'uppercase' as const }}>Most viewed screens</Text>
            {(data.topScreens ?? []).slice(0, 5).map((screen, index) => (
              <View key={`${screen.screen}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E9EEF5' }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#4A90D918', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#4A90D9', fontSize: 11, fontWeight: '800' as const }}>{index + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#1B2A3D', fontSize: 13, fontWeight: '700' as const }} numberOfLines={1}>{screen.screen}</Text>
                  <Text style={{ color: '#5E6C84', fontSize: 11, marginTop: 2 }}>{screen.views} views · {screen.avgTimeSpent}s avg · {screen.uniqueSessions} sessions</Text>
                </View>
                <Text style={{ color: '#4A90D9', fontSize: 12, fontWeight: '800' as const }}>{screen.pct}%</Text>
              </View>
            ))}
            {(data.topScreens ?? []).length === 0 && <Text style={s.noDataText}>No screen view breakdown yet.</Text>}
          </View>
          <View style={{ gap: 10, marginTop: 14 }}>
            <Text style={{ fontSize: 12, fontWeight: '800' as const, color: '#5E6C84', textTransform: 'uppercase' as const }}>Most clicked functionality</Text>
            {(data.topActions ?? []).slice(0, 5).map((action, index) => (
              <View key={`${action.action}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E9EEF5' }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#00C48C18', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#00C48C', fontSize: 11, fontWeight: '800' as const }}>{index + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#1B2A3D', fontSize: 13, fontWeight: '700' as const }} numberOfLines={1}>{action.action}</Text>
                  <Text style={{ color: '#5E6C84', fontSize: 11, marginTop: 2 }}>{action.count} clicks · {action.uniqueSessions} sessions · {action.avgTimeSpent}s avg</Text>
                </View>
                <Text style={{ color: '#00C48C', fontSize: 12, fontWeight: '800' as const }}>{action.pct}%</Text>
              </View>
            ))}
            {(data.topActions ?? []).length === 0 && <Text style={s.noDataText}>No click breakdown yet.</Text>}
          </View>
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Zap size={16} color={SS_ORANGE} />
            <Text style={s.cardTitle}>CTA Performance</Text>
          </View>
          <View style={s.ctaGrid}>
            {[
              { label: 'Get Started', count: data.cta.getStarted, icon: <ArrowUpRight size={16} color={SS_GREEN} />, color: SS_GREEN },
              { label: 'Sign In', count: data.cta.signIn, icon: <LogIn size={16} color={SS_BLUE} />, color: SS_BLUE },
              { label: 'JV Inquire', count: data.cta.jvInquire, icon: <TrendingUp size={16} color={SS_ORANGE} />, color: SS_ORANGE },
              { label: 'Website', count: data.cta.websiteClick, icon: <Globe size={16} color={SS_PURPLE} />, color: SS_PURPLE },
            ].map((cta, i) => (
              <View key={i} style={s.ctaCard}>
                <View style={[s.ctaIconBg, { backgroundColor: cta.color + '12' }]}>
                  {cta.icon}
                </View>
                <Text style={s.ctaValue}>{cta.count}</Text>
                <Text style={s.ctaLabel}>{cta.label}</Text>
                <View style={[s.ctaBar, { backgroundColor: cta.color + '15' }]}>
                  <View style={[s.ctaBarFill, {
                    width: `${Math.max(Math.min((cta.count / Math.max(data.cta.getStarted, 1)) * 100, 100), 5)}%` as any,
                    backgroundColor: cta.color}]} />
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={s.splitRow}>
          <View style={s.splitCard}>
            <View style={s.cardHeader}>
              <Monitor size={14} color={SS_BLUE} />
              <Text style={[s.cardTitle, { fontSize: 13 }]}>Platform</Text>
            </View>
            {data.byPlatform.length === 0 ? (
              <Text style={s.noDataText}>No data</Text>
            ) : (
              data.byPlatform.map((p: { platform: string; count: number }, i: number) => (
                <View key={i} style={s.miniListRow}>
                  <View style={[s.miniDot, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
                  <Text style={s.miniLabel} numberOfLines={1}>{p.platform}</Text>
                  <Text style={s.miniValue}>{p.count}</Text>
                </View>
              ))
            )}
          </View>

          <View style={s.splitCard}>
            <View style={s.cardHeader}>
              <Globe size={14} color={SS_TEAL} />
              <Text style={[s.cardTitle, { fontSize: 13 }]}>Referrer</Text>
            </View>
            {data.byReferrer.length === 0 ? (
              <Text style={s.noDataText}>No data</Text>
            ) : (
              data.byReferrer.slice(0, 5).map((r: { referrer: string; count: number }, i: number) => (
                <View key={i} style={s.miniListRow}>
                  <View style={[s.miniDot, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
                  <Text style={s.miniLabel} numberOfLines={1}>{r.referrer}</Text>
                  <Text style={s.miniValue}>{r.count}</Text>
                </View>
              ))
            )}
          </View>
        </View>

        {data.sessionQuality && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <RefreshCw size={16} color={SS_PURPLE} />
              <Text style={s.cardTitle}>New vs Returning</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
              <View style={{ flex: 1, backgroundColor: '#4A90D912', borderRadius: 12, padding: 14, alignItems: 'center' }}>
                <Text style={{ fontSize: 24, fontWeight: '900' as const, color: '#4A90D9' }}>{data.sessionQuality.newVsReturning.new}</Text>
                <Text style={{ fontSize: 11, fontWeight: '600' as const, color: '#5E6C84', marginTop: 2 }}>New Visitors</Text>
                <Text style={{ fontSize: 10, fontWeight: '700' as const, color: '#4A90D9', marginTop: 2 }}>{data.sessionQuality.newVsReturning.newPct}%</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: '#7B61FF12', borderRadius: 12, padding: 14, alignItems: 'center' }}>
                <Text style={{ fontSize: 24, fontWeight: '900' as const, color: SS_PURPLE }}>{data.sessionQuality.newVsReturning.returning}</Text>
                <Text style={{ fontSize: 11, fontWeight: '600' as const, color: '#5E6C84', marginTop: 2 }}>Returning</Text>
                <Text style={{ fontSize: 10, fontWeight: '700' as const, color: SS_PURPLE, marginTop: 2 }}>{data.sessionQuality.newVsReturning.returningPct}%</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: '#5E6C84', marginBottom: 4 }}>Avg Pages/Session</Text>
                <Text style={{ fontSize: 15, fontWeight: '800' as const, color: '#1B2A3D' }}>{data.sessionQuality.avgPagesPerSession}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: '#5E6C84', marginBottom: 4 }}>Avg Duration</Text>
                <Text style={{ fontSize: 15, fontWeight: '800' as const, color: '#1B2A3D' }}>{formatSeconds(data.sessionQuality.avgSessionDuration)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: '#5E6C84', marginBottom: 4 }}>Engaged</Text>
                <Text style={{ fontSize: 15, fontWeight: '800' as const, color: SS_GREEN }}>{data.sessionQuality.engagedSessionsPct}%</Text>
              </View>
            </View>
          </View>
        )}

        {(data.linkClicks ?? []).length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Crosshair size={16} color={SS_PINK} />
              <Text style={s.cardTitle}>Link Clicks</Text>
              <View style={s.cardBadge}>
                <Text style={s.cardBadgeText}>{(data.linkClicks ?? []).reduce((t, l) => t + l.count, 0)} total</Text>
              </View>
            </View>
            {(data.linkClicks ?? []).slice(0, 15).map((link, i) => {
              const maxClick = (data.linkClicks ?? [])[0]?.count || 1;
              const barPct = Math.round((link.count / maxClick) * 100);
              const locationColors: Record<string, string> = {
                header: SS_BLUE,
                hero_cta: SS_GREEN,
                hero_secondary: '#7B68EE',
                features_section: SS_ORANGE,
                investment_types: SS_TEAL,
                how_it_works: SS_PURPLE,
                trust_section: '#00C48C',
                waitlist_form: SS_PINK,
                unknown: '#97A0AF'};
              const locColor = locationColors[link.location] || CHART_COLORS[i % CHART_COLORS.length];
              const timeAgo = (() => {
                const diff = Math.round((Date.now() - new Date(link.lastClicked).getTime()) / 1000);
                if (diff < 60) return `${diff}s ago`;
                if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
                return `${Math.floor(diff / 86400)}d ago`;
              })();
              return (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: i < (data.linkClicks ?? []).length - 1 ? 1 : 0, borderBottomColor: '#F0F3F8', gap: 10 }}>
                  <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: locColor + '15', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 11, fontWeight: '800' as const, color: locColor }}>{link.count}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700' as const, color: '#1B2A3D' }} numberOfLines={1}>{link.label}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                      <View style={{ backgroundColor: locColor + '18', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 9, fontWeight: '700' as const, color: locColor, textTransform: 'uppercase' as const }}>{link.location.replace(/_/g, ' ')}</Text>
                      </View>
                      <Text style={{ fontSize: 10, color: '#97A0AF' }}>{timeAgo}</Text>
                    </View>
                    <View style={{ height: 3, backgroundColor: '#F0F3F8', borderRadius: 2, marginTop: 4 }}>
                      <View style={{ height: 3, borderRadius: 2, backgroundColor: locColor, width: `${Math.max(barPct, 5)}%` as any }} />
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {(data.sectionViews ?? []).length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Layers size={16} color={SS_TEAL} />
              <Text style={s.cardTitle}>Section Views</Text>
              <View style={s.cardBadge}>
                <Text style={s.cardBadgeText}>{(data.sectionViews ?? []).length} sections</Text>
              </View>
            </View>
            {(data.sectionViews ?? []).map((sec, i) => {
              const maxSec = (data.sectionViews ?? [])[0]?.count || 1;
              const barPct = Math.round((sec.count / maxSec) * 100);
              const sectionLabels: Record<string, string> = {
                hero: 'Hero Banner',
                features: 'Features Grid',
                investment_types: 'Investment Types',
                how_it_works: 'How It Works',
                trust_security: 'Trust & Security',
                waitlist_form: 'Waitlist Form',
                footer: 'Footer'};
              return (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: i < (data.sectionViews ?? []).length - 1 ? 1 : 0, borderBottomColor: '#F0F3F8', gap: 10 }}>
                  <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '15', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 11, fontWeight: '800' as const, color: CHART_COLORS[i % CHART_COLORS.length] }}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontSize: 13, fontWeight: '700' as const, color: '#1B2A3D' }}>{sectionLabels[sec.section] || sec.section}</Text>
                      <Text style={{ fontSize: 12, fontWeight: '800' as const, color: CHART_COLORS[i % CHART_COLORS.length] }}>{sec.count}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <View style={{ flex: 1, height: 4, backgroundColor: '#F0F3F8', borderRadius: 2 }}>
                        <View style={{ height: 4, borderRadius: 2, backgroundColor: CHART_COLORS[i % CHART_COLORS.length], width: `${Math.max(barPct, 5)}%` as any }} />
                      </View>
                      <Text style={{ fontSize: 10, fontWeight: '700' as const, color: '#97A0AF' }}>{sec.pct}%</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Activity size={16} color={SS_BLUE} />
            <Text style={s.cardTitle}>Event Stream</Text>
            <Text style={s.cardSubtitle}>{data.byEvent.length} events</Text>
          </View>
          {data.byEvent.slice(0, 10).map((evt: { event: string; count: number }, i: number) => {
            const maxEvt = data.byEvent[0]?.count || 1;
            const barPct = Math.round((evt.count / maxEvt) * 100);
            return (
              <View key={i} style={s.eventRow}>
                <View style={[s.eventRank, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '18' }]}>
                  <Text style={[s.eventRankText, { color: CHART_COLORS[i % CHART_COLORS.length] }]}>{i + 1}</Text>
                </View>
                <View style={s.eventInfo}>
                  <Text style={s.eventName} numberOfLines={1}>{evt.event.replace(/_/g, ' ')}</Text>
                  <View style={s.eventBarBg}>
                    <View style={[s.eventBar, { width: `${Math.max(barPct, 4)}%` as any, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
                  </View>
                </View>
                <Text style={s.eventCount}>{evt.count}</Text>
              </View>
            );
          })}
          {data.byEvent.length === 0 && (
            <Text style={s.noDataText}>No events tracked yet.</Text>
          )}
        </View>
      </>
    );
  };

  const renderFunnelTab = () => {
    if (!data) return null;
      return (
      <>
        <View style={s.funnelHero}>
          <Text style={s.funnelHeroTitle}>Conversion Funnel</Text>
          <Text style={s.funnelHeroSub}>
            {data.funnel.pageViews} visitors → {data.funnel.formSubmits} signups
          </Text>
        </View>

        <View style={s.funnelVisual}>
          {funnelSteps.map((step, i) => {
            const widthPct = Math.max(step.pct, 12);
            const isLast = i === funnelSteps.length - 1;
            const prevStep = i > 0 ? funnelSteps[i - 1] : undefined;
            const dropoff = i > 0 && prevStep ? prevStep.pct - step.pct : 0;
            return (
              <View key={i} style={s.funnelStepWrap}>
                <View style={s.funnelStepRow}>
                  <View style={[s.funnelBar, { width: `${widthPct}%` as any, backgroundColor: step.color }]}>
                    <Text style={s.funnelBarText}>{new Intl.NumberFormat('en-US').format(step.count)}</Text>
                  </View>
                  <Text style={s.funnelPct}>{step.pct}%</Text>
                </View>
                <View style={s.funnelLabelRow}>
                  <Text style={s.funnelLabel}>{step.label}</Text>
                  {i > 0 && dropoff > 0 && (
                    <View style={s.funnelDropoff}>
                      <ArrowDownRight size={9} color="#FF6B6B" />
                      <Text style={s.funnelDropoffText}>-{dropoff}%</Text>
                    </View>
                  )}
                </View>
                {!isLast && <View style={s.funnelConnector} />}
              </View>
            );
          })}
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <PieChart size={16} color="#E879F9" />
            <Text style={s.cardTitle}>Drop-off Analysis</Text>
          </View>
          {funnelSteps.slice(1).map((step, i) => {
            const prev = funnelSteps[i];
            if (!prev) return null;
            const dropCount = prev.count - step.count;
            const dropPct = prev.count > 0 ? Math.round((dropCount / prev.count) * 100) : 0;
            return (
              <View key={i} style={s.dropoffRow}>
                <View style={[s.dropoffIcon, { backgroundColor: step.color + '18' }]}>
                  <ArrowDownRight size={12} color={step.color} />
                </View>
                <View style={s.dropoffInfo}>
                  <Text style={s.dropoffLabel}>{prev?.label} → {step.label}</Text>
                  <View style={s.dropoffBarBg}>
                    <View style={[s.dropoffBarFill, { width: `${Math.max(dropPct, 3)}%` as any, backgroundColor: '#FF6B6B60' }]} />
                  </View>
                </View>
                <View style={s.dropoffStats}>
                  <Text style={s.dropoffValue}>-{dropCount}</Text>
                  <Text style={s.dropoffPctText}>{dropPct}%</Text>
                </View>
              </View>
            );
          })}
        </View>
      </>
    );
  };

  const renderGeoTab = () => {
    if (!data) return null;
    const geo = data.geoZones;

    const hasGeoData = geo && (geo.byCountry.length > 0 || geo.byCity.length > 0);
    const hasFetchError = diagnostics?.error != null;
    const hasEventsButNoGeo = !hasGeoData && ((diagnostics?.landingCount ?? 0) + (diagnostics?.appCount ?? 0)) > 0;
    const isRpcFailure = hasFetchError && (diagnostics?.error?.includes('RPC') || diagnostics?.error?.includes('RLS') || diagnostics?.error?.includes('does not exist'));

    if (!hasGeoData) {
      if (isRpcFailure || hasFetchError) {
        return (
          <View style={s.emptyWrap}>
            <AlertTriangle size={48} color="#FF6B6B" />
            <Text style={s.emptyTitle}>Geo Data Unavailable</Text>
            <Text style={s.emptySubtitle}>
              {isRpcFailure
                ? 'Analytics RPC functions are not deployed. Geo breakdown requires server-side aggregation.'
                : `Failed to load geo data: ${diagnostics?.error?.substring(0, 120) ?? 'Unknown error'}`}
            </Text>
            <TouchableOpacity
              onPress={deployRpcFunctions}
              disabled={rpcDeploying}
              style={{
                backgroundColor: rpcDeployResult === 'success' ? '#00C48C' : '#FF6B6B',
                borderRadius: 10,
                paddingVertical: 12,
                paddingHorizontal: 20,
                marginTop: 16,
                opacity: rpcDeploying ? 0.6 : 1}}
            >
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' as const }}>
                {rpcDeploying ? 'Deploying...' : rpcDeployResult === 'success' ? 'Deployed! Pull to refresh' : rpcDeployResult === 'copied' ? 'SQL Copied — Paste in Supabase' : 'Deploy Analytics Functions'}
              </Text>
            </TouchableOpacity>
            {rpcDeployResult === 'copied' && (
              <Text style={{ color: '#97A0AF', fontSize: 10, marginTop: 8, textAlign: 'center' as const, lineHeight: 15 }}>
                Supabase Dashboard {'>'} SQL Editor {'>'} Paste {'>'} Run{' '}n then pull down to refresh.
              </Text>
            )}
          </View>
        );
      }

      if (hasEventsButNoGeo) {
        return (
          <View style={s.emptyWrap}>
            <Globe size={48} color="#FFB800" />
            <Text style={s.emptyTitle}>Events Found, No Geo Data</Text>
            <Text style={s.emptySubtitle}>
              {(diagnostics?.landingCount ?? 0) + (diagnostics?.appCount ?? 0)} events were loaded but none contain location data.
              Geo is collected via IP lookup when visitors first arrive.
            </Text>
          </View>
        );
      }

      return (
        <View style={s.emptyWrap}>
          <MapPin size={48} color="#97A0AF" />
          <Text style={s.emptyTitle}>No Geo Data Yet</Text>
          <Text style={s.emptySubtitle}>Location data will appear as visitors arrive from different locations.</Text>
        </View>
      );
    }

    return (
      <>
        <View style={s.geoKpiRow}>
          {[
            { icon: <Globe size={18} color="#4A90D9" />, value: geo.byCountry.length, label: 'Countries', color: '#4A90D9' },
            { icon: <MapPin size={18} color="#00C48C" />, value: geo.byCity.length, label: 'Cities', color: '#00C48C' },
            { icon: <Crosshair size={18} color="#7B68EE" />, value: geo.totalWithGeo, label: 'Tracked', color: '#7B68EE' },
          ].map((kpi, i) => (
            <View key={i} style={[s.geoKpiCard, { borderTopColor: kpi.color }]}>
              {kpi.icon}
              <Text style={s.geoKpiValue}>{kpi.value}</Text>
              <Text style={s.geoKpiLabel}>{kpi.label}</Text>
            </View>
          ))}
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Globe size={16} color="#4A90D9" />
            <Text style={s.cardTitle}>Top Countries</Text>
          </View>
          {geo.byCountry.map((c: { country: string; count: number; pct: number }, i: number) => {
            const maxC = geo.byCountry[0]?.count || 1;
            const barW = Math.max(Math.round((c.count / maxC) * 100), 4);
            const flag = COUNTRY_FLAGS[c.country] || '🌍';
            return (
              <View key={i} style={s.geoRow}>
                <Text style={s.geoFlag}>{flag}</Text>
                <View style={s.geoInfo}>
                  <View style={s.geoTopRow}>
                    <Text style={s.geoName} numberOfLines={1}>{c.country}</Text>
                    <Text style={s.geoPct}>{c.pct}%</Text>
                  </View>
                  <View style={s.geoBarBg}>
                    <View style={[s.geoBarFill, { width: `${barW}%` as any, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
                  </View>
                </View>
                <Text style={s.geoCount}>{c.count}</Text>
              </View>
            );
          })}
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <MapPin size={16} color="#00C48C" />
            <Text style={s.cardTitle}>Top Cities</Text>
          </View>
          {geo.byCity.slice(0, 10).map((c: { city: string; count: number; country: string }, i: number) => (
            <View key={i} style={s.cityRow}>
              <View style={[s.cityRank, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '18' }]}>
                <Text style={[s.cityRankText, { color: CHART_COLORS[i % CHART_COLORS.length] }]}>{i + 1}</Text>
              </View>
              <View style={s.cityInfo}>
                <Text style={s.cityName} numberOfLines={1}>{c.city}</Text>
                <Text style={s.cityCountry}>{c.country}</Text>
              </View>
              <Text style={s.cityCount}>{c.count}</Text>
            </View>
          ))}
        </View>

        {geo.byTimezone.length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Clock size={16} color="#FFD700" />
              <Text style={s.cardTitle}>Timezone Distribution</Text>
            </View>
            {geo.byTimezone.slice(0, 8).map((tz: { timezone: string; count: number }, i: number) => (
              <View key={i} style={s.miniListRow}>
                <View style={[s.miniDot, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
                <Text style={s.miniLabel} numberOfLines={1}>{tz.timezone.replace(/_/g, ' ')}</Text>
                <Text style={s.miniValue}>{tz.count}</Text>
              </View>
            ))}
          </View>
        )}
      </>
    );
  };

  const renderInsightsTab = () => {
    if (!data) return null;
    const insights = data.smartInsights;

    if (!insights) {
      return (
        <View style={s.emptyWrap}>
          <Brain size={48} color="#97A0AF" />
          <Text style={s.emptyTitle}>Loading Insights</Text>
          <Text style={s.emptySubtitle}>Intelligent analysis will be generated as more data is collected.</Text>
        </View>
      );
    }

    const engColor = insights.engagementScore >= 60 ? '#00C48C' : insights.engagementScore >= 30 ? '#FFD700' : '#FF6B6B';

    return (
      <>
        <View style={s.scoreHero}>
          <AnimatedRing percent={insights.engagementScore} size={130} strokeWidth={10} color={engColor}>
            <Text style={[s.scoreBig, { color: engColor }]}>{insights.engagementScore}</Text>
            <Text style={s.scoreUnit}>/100</Text>
          </AnimatedRing>
          <Text style={s.scoreTitle}>Engagement Score</Text>
          <Text style={s.scoreDesc}>Based on scroll depth, CTA clicks, and form submissions</Text>
        </View>

        <View style={s.insightKpiRow}>
          {[
            { icon: <Timer size={16} color="#4A90D9" />, value: formatSeconds(insights.avgTimeOnPage), label: 'Avg Time', color: '#4A90D9' },
            { icon: <Percent size={16} color="#FF6B6B" />, value: `${insights.bounceRate}%`, label: 'Bounce', color: '#FF6B6B' },
            { icon: <Clock size={16} color="#FFD700" />, value: `${insights.peakHour}:00`, label: 'Peak', color: '#FFD700' },
          ].map((kpi, i) => (
            <View key={i} style={[s.insightKpi, { borderTopColor: kpi.color }]}>
              {kpi.icon}
              <Text style={s.insightKpiValue}>{kpi.value}</Text>
              <Text style={s.insightKpiLabel}>{kpi.label}</Text>
            </View>
          ))}
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Flame size={16} color="#FF6B6B" />
            <Text style={s.cardTitle}>Visitor Intent</Text>
          </View>
          {[
            { label: 'High Intent', desc: 'Submitted form', count: insights.visitorIntent.highIntent, pct: insights.visitorIntent.highIntentPct, color: '#00C48C' },
            { label: 'Medium', desc: 'Clicked CTA', count: insights.visitorIntent.mediumIntent, pct: insights.visitorIntent.mediumIntentPct, color: '#FFD700' },
            { label: 'Low', desc: 'Browsed only', count: insights.visitorIntent.lowIntent, pct: insights.visitorIntent.lowIntentPct, color: '#FF6B6B' },
          ].map((intent, i) => (
            <View key={i} style={s.intentRow}>
              <View style={[s.intentDot, { backgroundColor: intent.color }]} />
              <View style={s.intentInfo}>
                <View style={s.intentTopRow}>
                  <Text style={s.intentLabel}>{intent.label}</Text>
                  <Text style={s.intentPctText}>{intent.pct}%</Text>
                </View>
                <View style={s.intentBarBg}>
                  <View style={[s.intentBarFill, { width: `${Math.max(intent.pct, 3)}%` as any, backgroundColor: intent.color }]} />
                </View>
              </View>
              <Text style={s.intentCount}>{intent.count}</Text>
            </View>
          ))}
        </View>

        {insights.deviceBreakdown.length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Smartphone size={16} color="#E879F9" />
              <Text style={s.cardTitle}>Devices</Text>
            </View>
            <View style={s.deviceGrid}>
              {insights.deviceBreakdown.map((d: { device: string; count: number; pct: number }, i: number) => (
                <View key={i} style={[s.deviceCard, { borderTopColor: CHART_COLORS[i % CHART_COLORS.length] }]}>
                  {d.device === 'Mobile' ? <Smartphone size={22} color={CHART_COLORS[i % CHART_COLORS.length]} /> :
                    d.device === 'Tablet' ? <Tablet size={22} color={CHART_COLORS[i % CHART_COLORS.length]} /> :
                    <Monitor size={22} color={CHART_COLORS[i % CHART_COLORS.length]} />}
                  <Text style={s.deviceCount}>{d.count}</Text>
                  <Text style={s.deviceLabel}>{d.device}</Text>
                  <Text style={[s.devicePct, { color: CHART_COLORS[i % CHART_COLORS.length] }]}>{d.pct}%</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {insights.topInterests.length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Target size={16} color="#00C48C" />
              <Text style={s.cardTitle}>Investment Interest</Text>
            </View>
            {insights.topInterests.map((interest: { interest: string; count: number; pct: number }, i: number) => (
              <View key={i} style={s.miniListRow}>
                <View style={[s.miniRank, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '18' }]}>
                  <Text style={[s.miniRankText, { color: CHART_COLORS[i % CHART_COLORS.length] }]}>{i + 1}</Text>
                </View>
                <Text style={s.miniLabel} numberOfLines={1}>{interest.interest.replace(/_/g, ' ')}</Text>
                <Text style={[s.miniPct, { color: CHART_COLORS[i % CHART_COLORS.length] }]}>{interest.pct}%</Text>
                <Text style={s.miniValue}>{interest.count}</Text>
              </View>
            ))}
          </View>
        )}
      </>
    );
  };

  const brainQuery = useQuery<AIBrainData>({
    queryKey: ['aiLearning.getAIBrainStatus'],
    queryFn: async () => {
      console.log('[Supabase] Fetching AI brain status');
      const defaultBrain = {
        status: 'active',
        memory: { learningCycles: 1, totalDataPointsProcessed: 0 },
        stats: { activeLearnings: 0, avgConfidence: 0, byType: {} }};
      try {
        const { data, error } = await supabase.from('ai_brain_status').select('*').limit(50);
        if (error) { console.log('[Supabase] ai_brain_status error:', error.message); return defaultBrain; }
        return data && data.length > 0 ? data[0] : defaultBrain;
      } catch (e) {
        console.log('[Supabase] ai_brain_status catch:', e);
        return defaultBrain;
      }
    },
    enabled: activeTab === 'brain',
    staleTime: 30000,
    refetchInterval: activeTab === 'brain' ? 30000 : false});

  const learnMutation = useMutation({
    mutationFn: async (input: { period: string }) => {
      console.log('[Supabase] Running learning cycle');
      const { data, error } = await supabase.from('ai_brain_status').insert({ period: input.period, status: 'learning', created_at: new Date().toISOString() }).select().single();
      if (error) throw new Error(error.message);
      return { success: true, ...data };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['aiLearning.getAIBrainStatus'] });
    }});

  const renderInvestorIntelligence = () => {
    if (!data || !investorIntel) return null;
    const intel = investorIntel;
    const roleIcon = (role: IntentRole) => {
      switch (role) {
        case 'investor': return <TrendingUp size={14} color="#00C48C" />;
        case 'buyer': return <Home size={14} color="#4A90D9" />;
        case 'seller': return <DollarSign size={14} color="#FF6B6B" />;
        case 'broker': return <Handshake size={14} color="#E879F9" />;
        case 'lender': return <Landmark size={14} color="#FFB800" />;
        default: return <Users size={14} color="#97A0AF" />;
      }
    };
    const tierIcon = (tier: string) =>
      tier === 'hot' ? <Flame size={14} color="#00C48C" /> :
      tier === 'warm' ? <Zap size={14} color="#FFB800" /> :
      tier === 'cold' ? <Activity size={14} color="#4A90D9" /> :
      <Users size={14} color="#97A0AF" />;
    return (
      <>
        <View style={[s.card, { borderLeftWidth: 3, borderLeftColor: SS_PURPLE }]}>
          <View style={s.cardHeader}>
            <Brain size={16} color={SS_PURPLE} />
            <Text style={s.cardTitle}>AI Brain Summary</Text>
          </View>
          {[
            { icon: <Eye size={13} color="#4A90D9" />, label: 'What the traffic means', text: intel.summary.traffic },
            { icon: <Activity size={13} color="#00C48C" />, label: 'What visitors are doing', text: intel.summary.behavior },
            { icon: <Target size={13} color={SS_ORANGE} />, label: 'The opportunity', text: intel.summary.opportunity },
            { icon: <Lightbulb size={13} color="#FFB800" />, label: 'Recommended next action', text: intel.summary.action },
          ].map((row, i) => (
            <View key={i} style={{ marginTop: i === 0 ? 2 : 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                {row.icon}
                <Text style={{ fontSize: 11, fontWeight: '800' as const, color: '#5E6C84', textTransform: 'uppercase' as const }}>{row.label}</Text>
              </View>
              <Text style={{ fontSize: 13, lineHeight: 19, color: '#1B2A3D' }}>{row.text}</Text>
            </View>
          ))}
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <UserCheck size={16} color="#00C48C" />
            <Text style={s.cardTitle}>Visitor Intent</Text>
            <View style={s.cardBadge}><Text style={s.cardBadgeText}>estimated</Text></View>
          </View>
          {intel.intent.map((it) => (
            <View key={it.role} style={s.intentRow}>
              <View style={[s.intentDot, { backgroundColor: it.color }]} />
              <View style={s.intentInfo}>
                <View style={s.intentTopRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {roleIcon(it.role)}
                    <Text style={s.intentLabel}>{it.label}</Text>
                  </View>
                  <Text style={s.intentPctText}>{it.pct}%</Text>
                </View>
                <View style={s.intentBarBg}>
                  <View style={[s.intentBarFill, { width: `${Math.max(it.pct, 2)}%` as any, backgroundColor: it.color }]} />
                </View>
              </View>
              <Text style={s.intentCount}>{it.count}</Text>
            </View>
          ))}
          {intel.totalSignalWeight === 0 && (
            <Text style={s.noDataText}>Not enough behaviour signals yet to classify roles — most visitors are still unknown.</Text>
          )}
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Flame size={16} color="#FF6B6B" />
            <Text style={s.cardTitle}>Top Visitor Signals</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {intel.signals.map((sig) => (
              <View key={sig.key} style={{ width: '47%' as any, backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E9EEF5', borderTopWidth: 2, borderTopColor: sig.color }}>
                <Text style={{ fontSize: 22, fontWeight: '900' as const, color: '#1B2A3D' }}>{sig.value}</Text>
                <Text style={{ fontSize: 11, fontWeight: '600' as const, color: '#5E6C84', marginTop: 2 }}>{sig.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Target size={16} color="#00C48C" />
            <Text style={s.cardTitle}>Investment Interest</Text>
          </View>
          {intel.interests.map((it, i) => (
            <View key={it.key} style={s.miniListRow}>
              <View style={[s.miniRank, { backgroundColor: it.color + '18' }]}>
                <Text style={[s.miniRankText, { color: it.color }]}>{i + 1}</Text>
              </View>
              <Text style={s.miniLabel} numberOfLines={1}>{it.label}</Text>
              <Text style={[s.miniPct, { color: it.color }]}>{it.pct}%</Text>
              <Text style={s.miniValue}>{it.count}</Text>
            </View>
          ))}
          {intel.interests.every((i) => i.count === 0) && (
            <Text style={s.noDataText}>No specific interest signals captured yet.</Text>
          )}
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <ShieldCheck size={16} color={SS_PURPLE} />
            <Text style={s.cardTitle}>Lead Quality Score</Text>
          </View>
          {intel.leadQuality.map((lq) => (
            <View key={lq.tier} style={s.intentRow}>
              <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: lq.color + '18', alignItems: 'center', justifyContent: 'center' }}>
                {tierIcon(lq.tier)}
              </View>
              <View style={[s.intentInfo, { marginLeft: 10 }]}>
                <View style={s.intentTopRow}>
                  <Text style={s.intentLabel}>{lq.label}</Text>
                  <Text style={s.intentPctText}>{lq.pct}%</Text>
                </View>
                <Text style={{ fontSize: 10, color: '#97A0AF', marginBottom: 4 }}>{lq.desc}</Text>
                <View style={s.intentBarBg}>
                  <View style={[s.intentBarFill, { width: `${Math.max(lq.pct, 2)}%` as any, backgroundColor: lq.color }]} />
                </View>
              </View>
              <Text style={s.intentCount}>{lq.count}</Text>
            </View>
          ))}
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Lightbulb size={16} color="#FFB800" />
            <Text style={s.cardTitle}>Conversion Recommendations</Text>
          </View>
          {intel.recommendations.map((rec, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 10, paddingVertical: 10, borderBottomWidth: i < intel.recommendations.length - 1 ? 1 : 0, borderBottomColor: '#F0F3F8' }}>
              <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: rec.color + '18', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 11, fontWeight: '800' as const, color: rec.color }}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '700' as const, color: '#1B2A3D' }}>{rec.title}</Text>
                <Text style={{ fontSize: 12, lineHeight: 17, color: '#5E6C84', marginTop: 2 }}>{rec.detail}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, marginBottom: 6 }}>
          <ShieldCheck size={12} color="#97A0AF" />
          <Text style={{ fontSize: 10, color: '#97A0AF', flex: 1, lineHeight: 14 }}>
            Privacy-safe: derived only from anonymous behaviour analytics, registered users, and submitted forms. No hidden emails, phone numbers, or private profiles are accessed.
          </Text>
        </View>
      </>
    );
  };

  const renderBrainTab = () => {
    const brain = brainQuery.data;
    const intelBlock = renderInvestorIntelligence();

    if (brainQuery.isLoading && !brain) {
      return (
        <>
          {intelBlock}
          <View style={s.emptyWrap}>
            <Sparkles size={48} color="#FFB800" />
            <Text style={s.emptyTitle}>Loading AI Brain...</Text>
            <Text style={s.emptySubtitle}>Connecting to the self-learning engine.</Text>
          </View>
        </>
      );
    }

    if (!brain) {
      return (
        <>
          {intelBlock}
          <View style={s.emptyWrap}>
            <Sparkles size={48} color="#97A0AF" />
            <Text style={s.emptyTitle}>AI Brain Offline</Text>
            <Text style={s.emptySubtitle}>Run a learning cycle to activate the AI engine.</Text>
            <TouchableOpacity
              style={[s.retryBtn, { backgroundColor: '#FFB800' }]}
              onPress={() => learnMutation.mutate({ period })}
            >
              <Sparkles size={14} color="#000" />
              <Text style={s.retryBtnText}>Train AI</Text>
            </TouchableOpacity>
          </View>
        </>
      );
    }

    const mem = brain.memory;
    const stats = brain.stats;

    return (
      <>
        {intelBlock}
        <View style={s.brainHero}>
          <View style={s.brainPulseOuter}>
            <View style={[s.brainPulseInner, { backgroundColor: brain.status === 'active' ? '#00C48C' : '#FFB800' }]} />
          </View>
          <Text style={s.brainStatus}>
            {brain.status === 'active' ? 'AI Brain Active' : 'Learning Mode'}
          </Text>
          <Text style={s.brainCycles}>
            {mem.learningCycles} learning cycles completed
          </Text>
        </View>

        <View style={s.brainKpiRow}>
          {[
            { value: stats.activeLearnings, label: 'Active', color: '#00C48C' },
            { value: mem.totalDataPointsProcessed, label: 'Data Points', color: '#4A90D9' },
            { value: stats.avgConfidence, label: 'Confidence', color: '#FFB800', suffix: '%' },
          ].map((kpi, i) => (
            <View key={i} style={[s.brainKpiCard, { borderTopColor: kpi.color }]}>
              <Text style={[s.brainKpiValue, { color: kpi.color }]}>
                {new Intl.NumberFormat('en-US').format(kpi.value)}{kpi.suffix || ''}
              </Text>
              <Text style={s.brainKpiLabel}>{kpi.label}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={s.trainBtn}
          onPress={() => learnMutation.mutate({ period })}
          disabled={learnMutation.isPending}
          activeOpacity={0.7}
        >
          <Sparkles size={16} color="#000" />
          <Text style={s.trainBtnText}>
            {learnMutation.isPending ? 'Training...' : 'Run Learning Cycle'}
          </Text>
          {learnMutation.data && (
            <View style={s.trainBadge}>
              <Text style={s.trainBadgeText}>+{learnMutation.data.newLearnings}</Text>
            </View>
          )}
        </TouchableOpacity>

        {stats.byType && Object.keys(stats.byType).length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Activity size={16} color="#7B68EE" />
              <Text style={s.cardTitle}>Learning Types</Text>
            </View>
            {Object.entries(stats.byType).map(([type, count], _i) => {
              const typeInfo = TYPE_ICONS[type] || { icon: <Activity size={14} color="#97A0AF" />, color: '#97A0AF', label: type };
              const maxCount = Math.max(...Object.values(stats.byType as Record<string, number>), 1);
              return (
                <View key={type} style={s.brainTypeRow}>
                  <View style={[s.brainTypeIcon, { backgroundColor: typeInfo.color + '15' }]}>
                    {typeInfo.icon}
                  </View>
                  <View style={s.brainTypeInfo}>
                    <Text style={s.brainTypeLabel}>{typeInfo.label}</Text>
                    <View style={s.brainTypeBarBg}>
                      <View style={[s.brainTypeBarFill, {
                        width: `${Math.max(((count as number) / maxCount) * 100, 5)}%` as any,
                        backgroundColor: typeInfo.color}]} />
                    </View>
                  </View>
                  <Text style={[s.brainTypeCount, { color: typeInfo.color }]}>{count as number}</Text>
                </View>
              );
            })}
          </View>
        )}

        {(brain.activeAnomalies ?? []).length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <AlertTriangle size={16} color="#FF4D4D" />
              <Text style={s.cardTitle}>Active Anomalies</Text>
            </View>
            {(brain.activeAnomalies ?? []).map((anomaly) => (
              <View key={anomaly.id} style={s.brainInsightRow}>
                <View style={[s.brainInsightDot, { backgroundColor: '#FF4D4D' }]} />
                <View style={s.brainInsightInfo}>
                  <Text style={s.brainInsightTitle} numberOfLines={2}>{anomaly.title}</Text>
                  <Text style={s.brainInsightDesc} numberOfLines={3}>{anomaly.description}</Text>
                  <View style={s.brainInsightMeta}>
                    <View style={[s.brainConfBadge, { backgroundColor: IMPACT_STYLES[anomaly.impact]?.bg || '#eee' }]}>
                      <Text style={[s.brainConfText, { color: IMPACT_STYLES[anomaly.impact]?.text || '#999' }]}>
                        {IMPACT_STYLES[anomaly.impact]?.label || anomaly.impact}
                      </Text>
                    </View>
                    <Text style={s.brainConfPct}>{anomaly.confidence}% conf.</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {(brain.activePredictions ?? []).length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <TrendingUp size={16} color="#00C48C" />
              <Text style={s.cardTitle}>Predictions</Text>
            </View>
            {(brain.activePredictions ?? []).map((pred) => (
              <View key={pred.id} style={s.brainInsightRow}>
                <View style={[s.brainInsightDot, { backgroundColor: '#00C48C' }]} />
                <View style={s.brainInsightInfo}>
                  <Text style={s.brainInsightTitle} numberOfLines={2}>{pred.title}</Text>
                  <Text style={s.brainInsightDesc} numberOfLines={3}>{pred.description}</Text>
                  <Text style={s.brainConfPct}>{pred.confidence}% confidence</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {(brain.topRecommendations ?? []).length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Lightbulb size={16} color="#FFB800" />
              <Text style={s.cardTitle}>Smart Recommendations</Text>
            </View>
            {(brain.topRecommendations ?? []).map((rec, i) => (
              <View key={rec.id} style={s.brainRecRow}>
                <View style={[s.brainRecNum, { backgroundColor: IMPACT_STYLES[rec.impact]?.bg || '#eee' }]}>
                  <Text style={[s.brainRecNumText, { color: IMPACT_STYLES[rec.impact]?.text || '#999' }]}>
                    {i + 1}
                  </Text>
                </View>
                <View style={s.brainRecInfo}>
                  <Text style={s.brainRecTitle} numberOfLines={2}>{rec.title}</Text>
                  <Text style={s.brainRecDesc} numberOfLines={3}>{rec.description}</Text>
                  <View style={s.brainInsightMeta}>
                    <View style={[s.brainConfBadge, { backgroundColor: IMPACT_STYLES[rec.impact]?.bg || '#eee' }]}>
                      <Text style={[s.brainConfText, { color: IMPACT_STYLES[rec.impact]?.text || '#999' }]}>
                        {IMPACT_STYLES[rec.impact]?.label || rec.impact}
                      </Text>
                    </View>
                    <Text style={s.brainConfPct}>{rec.confidence}% conf.</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {(brain.recentLearnings ?? []).length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Brain size={16} color="#7B68EE" />
              <Text style={s.cardTitle}>Recent Learnings</Text>
              <Text style={s.cardSubtitle}>{(brain.recentLearnings ?? []).length} active</Text>
            </View>
            {(brain.recentLearnings ?? []).slice(0, 15).map((learning) => {
              const typeInfo = TYPE_ICONS[learning.type] || { icon: <Activity size={14} color="#97A0AF" />, color: '#97A0AF', label: learning.type };
              return (
                <View key={learning.id} style={s.brainLearningRow}>
                  <View style={[s.brainLearningIcon, { backgroundColor: typeInfo.color + '15' }]}>
                    {typeInfo.icon}
                  </View>
                  <View style={s.brainLearningInfo}>
                    <Text style={s.brainLearningTitle} numberOfLines={1}>{learning.title}</Text>
                    <View style={s.brainLearningMetaRow}>
                      <Text style={[s.brainLearningType, { color: typeInfo.color }]}>{typeInfo.label}</Text>
                      <Text style={s.brainLearningConf}>{learning.confidence}%</Text>
                      <Text style={s.brainLearningPts}>{learning.dataPoints} pts</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {(brain.baselines != null) && Object.keys(brain.baselines).length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <BarChart3 size={16} color="#4A90D9" />
              <Text style={s.cardTitle}>Behavior Baselines</Text>
            </View>
            {Object.entries(brain.baselines).map(([key, baseline]) => (
              <View key={key} style={s.brainBaselineRow}>
                <Text style={s.brainBaselineLabel}>{key.replace(/_/g, ' ')}</Text>
                <View style={s.brainBaselineValues}>
                  <Text style={s.brainBaselineAvg}>avg: {Math.round(baseline.avg)}</Text>
                  <Text style={s.brainBaselineRange}>
                    {Math.round(baseline.min)}-{Math.round(baseline.max)}
                  </Text>
                  <Text style={s.brainBaselineSamples}>{baseline.samples} samples</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </>
    );
  };

  const renderLiveTab = () => {
    const hasPresence = presenceState.isConnected;
    const presenceOnline = presenceState.totalOnline;
    const presenceLanding = presenceState.landingOnline;
    const presenceApp = presenceState.appOnline;
    const presenceUsers = presenceState.users;
    const presenceByCountry = presenceState.byCountry;
    const presenceByPage = presenceState.byPage;

    if (liveLoading && !liveData && !hasPresence) {
      return (
        <View style={s.emptyWrap}>
          <Radio size={48} color={SS_BLUE} />
          <Text style={s.emptyTitle}>Connecting...</Text>
          <Text style={s.emptySubtitle}>Fetching real-time session data.</Text>
        </View>
      );
    }

    const eventActive = liveData?.active ?? 0;
    const eventRecent = liveData?.recent ?? 0;
    const eventSessions = liveData?.sessions ?? [];
    const eventBreakdown = liveData?.breakdown;
    const displayOnline = hasPresence ? Math.max(presenceOnline, eventActive) : eventActive;
    const isLive = hasPresence || (liveData !== null);

    if (!isLive && displayOnline === 0) {
      if (analyticsQuery.isError) {
        return (
          <View style={s.emptyWrap}>
            <View style={s.errorIcon}>
              <Radio size={48} color="#FF6B6B" />
            </View>
            <Text style={s.emptyTitle}>Connection Issue</Text>
            <Text style={s.emptySubtitle}>{liveError || 'Unable to fetch live data'}</Text>
            <TouchableOpacity style={s.retryBtn} onPress={onRefresh}>
              <RefreshCw size={14} color="#000" />
              <Text style={s.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        );
      }
      return (
        <View style={s.emptyWrap}>
          <PulseIndicator active={false} />
          <Text style={s.emptyTitle}>No Active Sessions</Text>
          <Text style={s.emptySubtitle}>Live sessions will appear as visitors browse your landing page. Data refreshes every 3 seconds.</Text>
        </View>
      );
    }

    const sessions = hasPresence ? presenceUsers.map(u => ({
      sessionId: u.sessionId,
      ip: '',
      device: u.device,
      os: u.os,
      browser: u.browser,
      geo: u.geo,
      currentStep: u.currentStep ?? 0,
      sessionDuration: Math.round((Date.now() - new Date(u.startedAt).getTime()) / 1000),
      activeTime: 0,
      lastSeen: u.lastSeen,
      startedAt: u.startedAt,
      isActive: true,
      source: u.source})) : eventSessions;
    const breakdown = hasPresence ? eventBreakdown : eventBreakdown;

    const getStepLabel = (step: number) => {
      switch (step) {
        case 0: return 'Hero';
        case 1: return 'Goals';
        case 2: return 'Form';
        case 3: return 'Success';
        default: return `Step ${step}`;
      }
    };

    const getStepColor = (step: number) => {
      switch (step) {
        case 0: return '#4A90D9';
        case 1: return '#FFD700';
        case 2: return '#00C48C';
        case 3: return '#27AE60';
        default: return '#5E6C84';
      }
    };

    const formatDuration = (sec: number) => {
      if (sec < 60) return `${sec}s`;
      return `${Math.floor(sec / 60)}m ${sec % 60}s`;
    };

    const formatTimeAgo = (isoStr: string) => {
      const diff = Math.round((Date.now() - new Date(isoStr).getTime()) / 1000);
      if (diff < 10) return 'just now';
      if (diff < 60) return `${diff}s ago`;
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      return `${Math.floor(diff / 3600)}h ago`;
    };

    const countryData = hasPresence ? presenceByCountry : (breakdown?.byCountry ?? []);

    return (
      <>
        <View style={s.liveHero}>
          <PulseIndicator active={displayOnline > 0} />
          <Text style={s.liveCount}>{displayOnline}</Text>
          <Text style={s.liveLabel}>Active Right Now</Text>
          <View style={s.liveSubRow}>
            {hasPresence ? (
              <>
                <View style={s.liveSub}>
                  <Globe size={12} color={SS_TEAL} />
                  <Text style={s.liveSubText}>{presenceLanding} landing</Text>
                </View>
                <View style={s.liveSub}>
                  <Smartphone size={12} color={SS_PURPLE} />
                  <Text style={s.liveSubText}>{presenceApp} app</Text>
                </View>
              </>
            ) : (
              <>
                <View style={s.liveSub}>
                  <Clock size={12} color="#7B68EE" />
                  <Text style={s.liveSubText}>{eventRecent} in last 5m</Text>
                </View>
                <View style={s.liveSub}>
                  <Users size={12} color="#4A90D9" />
                  <Text style={s.liveSubText}>{sessions?.length || 0} sessions</Text>
                </View>
              </>
            )}
          </View>
          {hasPresence ? (
            <View style={[s.presenceStatusBadge, { backgroundColor: SS_GREEN + '15' }]}>
              <Wifi size={10} color={SS_GREEN} />
              <Text style={[s.presenceStatusText, { color: SS_GREEN }]}>Realtime Presence Active</Text>
            </View>
          ) : (
            <View style={[s.presenceStatusBadge, { backgroundColor: SS_ORANGE + '15' }]}>
              <WifiOff size={10} color={SS_ORANGE} />
              <Text style={[s.presenceStatusText, { color: SS_ORANGE }]}>Event-based tracking (polling)</Text>
            </View>
          )}
          {presenceState.lastSync ? (
            <Text style={s.presenceSyncText}>Last sync: {formatTimeAgo(presenceState.lastSync)}</Text>
          ) : null}
        </View>

        {hasPresence && presenceByPage.length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Layers size={16} color={SS_BLUE} />
              <Text style={s.cardTitle}>Active by Page</Text>
            </View>
            <View style={s.liveStepGrid}>
              {presenceByPage.slice(0, 4).map((pg: { page: string; count: number }, i: number) => (
                <View key={i} style={[s.liveStepCard, { borderTopColor: CHART_COLORS[i % CHART_COLORS.length] ?? SS_BLUE }]}>
                  <Text style={[s.liveStepCount, { color: CHART_COLORS[i % CHART_COLORS.length] ?? SS_BLUE }]}>{pg.count}</Text>
                  <Text style={s.liveStepLabel} numberOfLines={1}>{pg.page}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {!hasPresence && (breakdown?.byStep?.length ?? 0) > 0 && breakdown?.byStep && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Target size={16} color={SS_BLUE} />
              <Text style={s.cardTitle}>Active by Step</Text>
            </View>
            <View style={s.liveStepGrid}>
              {breakdown.byStep.map((st: { step: string; count: number }, i: number) => {
                const stepNum = parseInt(st.step.replace('Step ', ''), 10) || 0;
                return (
                  <View key={i} style={[s.liveStepCard, { borderTopColor: getStepColor(stepNum) }]}>
                    <Text style={[s.liveStepCount, { color: getStepColor(stepNum) }]}>{st.count}</Text>
                    <Text style={s.liveStepLabel}>{getStepLabel(stepNum)}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {countryData.length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Globe size={16} color="#00C48C" />
              <Text style={s.cardTitle}>Live by Country</Text>
            </View>
            {countryData.slice(0, 8).map((c: { country: string; count: number }, i: number) => (
              <View key={i} style={s.miniListRow}>
                <Text style={{ fontSize: 16, width: 24, textAlign: 'center' as const }}>
                  {COUNTRY_FLAGS[c.country] || '🌍'}
                </Text>
                <Text style={s.miniLabel} numberOfLines={1}>{c.country}</Text>
                <Text style={s.miniValue}>{c.count}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Radio size={16} color="#FF4D4D" />
            <Text style={s.cardTitle}>
              {hasPresence ? `Online Users (${sessions?.length || 0})` : `Sessions (${sessions?.length || 0})`}
            </Text>
          </View>
          {(!sessions || sessions.length === 0) ? (
            <Text style={s.noDataText}>No active sessions right now.</Text>
          ) : (
            sessions.slice(0, 20).map((sess, i) => {
              const sessSource = 'source' in sess ? (sess as Record<string, unknown>).source as string | undefined : undefined;
              return (
              <View key={sess.sessionId || i} style={s.sessionRow}>
                <PulseIndicator active={sess.isActive ?? true} />
                <View style={s.sessionInfo}>
                  <View style={s.sessionTopRow}>
                    {hasPresence && sessSource && (
                      <View style={[s.sessionBadge, { backgroundColor: (sessSource === 'landing' ? SS_TEAL : SS_PURPLE) + '18', borderColor: (sessSource === 'landing' ? SS_TEAL : SS_PURPLE) + '40' }]}>
                        <Text style={[s.sessionBadgeText, { color: sessSource === 'landing' ? SS_TEAL : SS_PURPLE }]}>
                          {sessSource === 'landing' ? 'LANDING' : 'APP'}
                        </Text>
                      </View>
                    )}
                    {!hasPresence && (
                      <Text style={s.sessionIP} numberOfLines={1}>{sess.ip}</Text>
                    )}
                    <View style={[s.sessionBadge, { backgroundColor: getStepColor(sess.currentStep) + '20', borderColor: getStepColor(sess.currentStep) + '40' }]}>
                      <Text style={[s.sessionBadgeText, { color: getStepColor(sess.currentStep) }]}>
                        {getStepLabel(sess.currentStep)}
                      </Text>
                    </View>
                  </View>
                  <Text style={s.sessionDetail} numberOfLines={1}>
                    {sess.device} · {sess.os} · {sess.browser}
                  </Text>
                  <View style={s.sessionMetaRow}>
                    {sess.geo?.country && (
                      <Text style={s.sessionMeta}>
                        {COUNTRY_FLAGS[sess.geo.country] || ''} {sess.geo.city || sess.geo.country}
                      </Text>
                    )}
                    <Text style={s.sessionMeta}>
                      {hasPresence ? formatTimeAgo(sess.lastSeen) : formatDuration(sess.sessionDuration)}
                    </Text>
                  </View>
                </View>
              </View>
            );
            })
          )}
        </View>
      </>
    );
  };

  return (
    <View style={s.root}>
      <SafeAreaView edges={['top']} style={s.safe}>
        <Animated.View style={[s.header, { opacity: headerAnim, transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="back-btn">
            <ArrowLeft size={20} color="#1B2A3D" />
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Text style={s.headerTitle}>Analytics</Text>
            <View style={s.liveBadge}>
              <View style={s.liveBadgeDot} />
              <Text style={s.liveBadgeText}>LIVE</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onRefresh} style={s.refreshBtn}>
            <RefreshCw size={17} color="#5E6C84" />
          </TouchableOpacity>
        </Animated.View>

        <View style={s.tabBar}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.value;
            return (
              <TouchableOpacity
                key={tab.value}
                style={[s.tab, isActive && s.tabActive]}
                onPress={() => setActiveTab(tab.value)}
                activeOpacity={0.7}
              >
                {tab.icon}
                <Text style={[s.tabText, isActive && s.tabTextActive]}>{tab.label}</Text>
                {isActive && <View style={s.tabIndicator} />}
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={manualRefreshing} onRefresh={onRefresh} tintColor={SS_BLUE} />}
          contentContainerStyle={s.scrollContent}
        >
          <View style={s.periodRow}>
            {PERIODS.map((p) => (
              <TouchableOpacity
                key={p.value}
                style={[s.periodChip, period === p.value && s.periodChipActive]}
                onPress={() => setPeriod(p.value)}
                activeOpacity={0.7}
              >
                <Text style={[s.periodText, period === p.value && s.periodTextActive]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {activeTab === 'live' ? (
            renderLiveTab()
          ) : activeTab === 'brain' ? (
            renderBrainTab()
          ) : data ? (
            <>
              {activeTab === 'overview' && renderOverviewTab()}
              {activeTab === 'funnel' && renderFunnelTab()}
              {activeTab === 'geo' && renderGeoTab()}
              {activeTab === 'insights' && renderInsightsTab()}
            </>
          ) : analyticsQuery.isError ? (
            <View style={s.emptyWrap}>
              <View style={s.errorIcon}>
                <Activity size={40} color="#FF6B6B" />
              </View>
              <Text style={s.emptyTitle}>Failed to Load</Text>
              <Text style={s.emptySubtitle}>{analyticsQuery.error?.message || 'Pull down to retry.'}</Text>
              <TouchableOpacity style={s.retryBtn} onPress={onRefresh}>
                <RefreshCw size={14} color="#000" />
                <Text style={s.retryBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.emptyWrap}>
              <Activity size={40} color="#97A0AF" />
              <Text style={s.emptyTitle}>No Data Yet</Text>
              <Text style={s.emptySubtitle}>Check back after visitors start arriving.</Text>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F9FC' },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E5EC',
    backgroundColor: '#FFFFFF'},
  backBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0F3F8' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 12 },
  headerTitle: { fontSize: 20, fontWeight: '800' as const, color: '#1B2A3D', letterSpacing: -0.3 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#E8F5E9', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  liveBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: SS_GREEN },
  liveBadgeText: { fontSize: 9, fontWeight: '800' as const, color: SS_GREEN, letterSpacing: 1 },
  refreshBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0F3F8' },

  tabBar: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 2, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#EDF0F5' },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, position: 'relative' as const },
  tabActive: {},
  tabText: { fontSize: 12, fontWeight: '600' as const, color: '#97A0AF' },
  tabTextActive: { color: SS_BLUE, fontWeight: '700' as const },
  tabIndicator: { position: 'absolute', bottom: 0, left: '20%' as any, right: '20%' as any, height: 2, backgroundColor: SS_BLUE, borderRadius: 1 },

  scrollContent: { paddingHorizontal: 16, paddingTop: 12 },
  periodRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  periodChip: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: '#FFFFFF', alignItems: 'center', borderWidth: 1, borderColor: '#E0E5EC' },
  periodChipActive: { backgroundColor: '#E3F2FD', borderWidth: 1, borderColor: SS_BLUE + '50' },
  periodText: { fontSize: 12, fontWeight: '700' as const, color: '#97A0AF' },
  periodTextActive: { color: SS_BLUE },

  heroMetrics: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: '#E0E5EC', marginBottom: 16, overflow: 'hidden' },
  heroMetricMain: { flex: 1, padding: 20, alignItems: 'center', gap: 6 },
  heroMetricDivider: { width: 1, backgroundColor: '#E0E5EC', marginVertical: 12 },
  heroMetricHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroMetricLabel: { fontSize: 12, fontWeight: '600' as const, color: '#5E6C84' },
  counterText: { fontSize: 32, fontWeight: '900' as const, color: '#1B2A3D', letterSpacing: -1 },

  trendBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  trendText: { fontSize: 11, fontWeight: '700' as const },

  ringRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  ringCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E0E5EC', padding: 14, alignItems: 'center', gap: 8 },
  ringValue: { fontSize: 18, fontWeight: '900' as const, color: '#1B2A3D' },
  ringLabel: { fontSize: 9, fontWeight: '600' as const, color: '#97A0AF', letterSpacing: 0.5 },
  ringCardLabel: { fontSize: 11, fontWeight: '600' as const, color: '#5E6C84' },

  card: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18, borderWidth: 1, borderColor: '#E0E5EC', marginBottom: 14 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '700' as const, color: '#1B2A3D' },
  cardSubtitle: { fontSize: 11, fontWeight: '600' as const, color: '#97A0AF' },
  cardBadge: { backgroundColor: SS_BLUE + '14', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  cardBadgeText: { fontSize: 10, fontWeight: '700' as const, color: SS_BLUE },

  sparkLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  sparkLabel: { fontSize: 10, fontWeight: '600' as const, color: '#97A0AF' },

  heatmapGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  heatmapCell: { width: (SCREEN_W - 80) / 12 - 4, aspectRatio: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  heatmapHour: { fontSize: 8, fontWeight: '700' as const, color: '#97A0AF' },
  heatmapCount: { fontSize: 7, fontWeight: '800' as const, color: '#FFFFFF' },

  ctaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  ctaCard: { flex: 1, minWidth: '43%' as any, backgroundColor: '#F7F9FC', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#E0E5EC', gap: 8 },
  ctaIconBg: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  ctaValue: { fontSize: 24, fontWeight: '900' as const, color: '#1B2A3D' },
  ctaLabel: { fontSize: 11, fontWeight: '600' as const, color: '#5E6C84' },
  ctaBar: { height: 4, borderRadius: 2, overflow: 'hidden' },
  ctaBarFill: { height: 4, borderRadius: 2 },

  splitRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  splitCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#E0E5EC' },

  miniListRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  miniDot: { width: 8, height: 8, borderRadius: 4 },
  miniLabel: { flex: 1, fontSize: 12, fontWeight: '600' as const, color: '#1B2A3D' },
  miniValue: { fontSize: 13, fontWeight: '800' as const, color: '#1B2A3D' },
  miniPct: { fontSize: 11, fontWeight: '700' as const, width: 36, textAlign: 'right' as const },
  miniRank: { width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  miniRankText: { fontSize: 10, fontWeight: '800' as const },

  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  eventRank: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  eventRankText: { fontSize: 10, fontWeight: '800' as const },
  eventInfo: { flex: 1, gap: 4 },
  eventName: { fontSize: 12, fontWeight: '600' as const, color: '#5E6C84', textTransform: 'capitalize' as const },
  eventBarBg: { height: 4, backgroundColor: '#EDF0F5', borderRadius: 2, overflow: 'hidden' },
  eventBar: { height: 4, borderRadius: 2 },
  eventCount: { width: 40, fontSize: 13, fontWeight: '800' as const, color: '#1B2A3D', textAlign: 'right' as const },

  funnelHero: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 24, borderWidth: 1, borderColor: '#E0E5EC', marginBottom: 16, alignItems: 'center', gap: 6 },
  funnelHeroTitle: { fontSize: 22, fontWeight: '900' as const, color: '#1B2A3D', letterSpacing: -0.3 },
  funnelHeroSub: { fontSize: 13, fontWeight: '600' as const, color: '#5E6C84' },

  funnelVisual: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18, borderWidth: 1, borderColor: '#E0E5EC', marginBottom: 14, gap: 2 },
  funnelStepWrap: { gap: 4, marginBottom: 6 },
  funnelStepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  funnelBar: { height: 36, borderRadius: 10, justifyContent: 'center', paddingHorizontal: 12, minWidth: 50 },
  funnelBarText: { fontSize: 12, fontWeight: '800' as const, color: '#FFFFFF' },
  funnelPct: { fontSize: 13, fontWeight: '800' as const, color: '#1B2A3D', width: 40, textAlign: 'right' as const },
  funnelLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 4 },
  funnelLabel: { fontSize: 11, fontWeight: '600' as const, color: '#5E6C84' },
  funnelDropoff: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#FFEBEE', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  funnelDropoffText: { fontSize: 9, fontWeight: '700' as const, color: SS_RED },
  funnelConnector: { width: 1, height: 8, backgroundColor: '#E0E5EC', marginLeft: 20 },

  dropoffRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  dropoffIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dropoffInfo: { flex: 1, gap: 4 },
  dropoffLabel: { fontSize: 11, fontWeight: '600' as const, color: '#5E6C84' },
  dropoffBarBg: { height: 4, backgroundColor: '#EDF0F5', borderRadius: 2, overflow: 'hidden' },
  dropoffBarFill: { height: 4, borderRadius: 2 },
  dropoffStats: { alignItems: 'flex-end', width: 44 },
  dropoffValue: { fontSize: 13, fontWeight: '800' as const, color: SS_RED },
  dropoffPctText: { fontSize: 9, fontWeight: '600' as const, color: '#97A0AF' },

  geoKpiRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  geoKpiCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#E0E5EC', borderTopWidth: 3, alignItems: 'center', gap: 6 },
  geoKpiValue: { fontSize: 24, fontWeight: '900' as const, color: '#1B2A3D' },
  geoKpiLabel: { fontSize: 10, fontWeight: '700' as const, color: '#5E6C84', textTransform: 'uppercase' as const, letterSpacing: 0.5 },

  geoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  geoFlag: { fontSize: 20, width: 28, textAlign: 'center' as const },
  geoInfo: { flex: 1, gap: 4 },
  geoTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  geoName: { fontSize: 13, fontWeight: '700' as const, color: '#1B2A3D' },
  geoPct: { fontSize: 11, fontWeight: '600' as const, color: '#97A0AF' },
  geoBarBg: { height: 5, backgroundColor: '#EDF0F5', borderRadius: 3, overflow: 'hidden' },
  geoBarFill: { height: 5, borderRadius: 3 },
  geoCount: { width: 36, fontSize: 14, fontWeight: '800' as const, color: '#1B2A3D', textAlign: 'right' as const },

  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EDF0F5' },
  cityRank: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cityRankText: { fontSize: 11, fontWeight: '800' as const },
  cityInfo: { flex: 1, gap: 1 },
  cityName: { fontSize: 13, fontWeight: '700' as const, color: '#1B2A3D' },
  cityCountry: { fontSize: 10, fontWeight: '500' as const, color: '#97A0AF' },
  cityCount: { fontSize: 14, fontWeight: '800' as const, color: '#1B2A3D' },

  scoreHero: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 28, borderWidth: 1, borderColor: '#E0E5EC', marginBottom: 16, alignItems: 'center', gap: 10 },
  scoreBig: { fontSize: 36, fontWeight: '900' as const, lineHeight: 40 },
  scoreUnit: { fontSize: 12, fontWeight: '600' as const, color: '#97A0AF' },
  scoreTitle: { fontSize: 18, fontWeight: '800' as const, color: '#1B2A3D', marginTop: 4 },
  scoreDesc: { fontSize: 12, fontWeight: '500' as const, color: '#5E6C84', textAlign: 'center' as const },

  insightKpiRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  insightKpi: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#E0E5EC', borderTopWidth: 3, alignItems: 'center', gap: 6 },
  insightKpiValue: { fontSize: 18, fontWeight: '900' as const, color: '#1B2A3D' },
  insightKpiLabel: { fontSize: 10, fontWeight: '600' as const, color: '#5E6C84' },

  intentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  intentDot: { width: 10, height: 10, borderRadius: 5 },
  intentInfo: { flex: 1, gap: 4 },
  intentTopRow: { flexDirection: 'row', justifyContent: 'space-between' },
  intentLabel: { fontSize: 13, fontWeight: '700' as const, color: '#1B2A3D' },
  intentPctText: { fontSize: 12, fontWeight: '700' as const, color: '#5E6C84' },
  intentBarBg: { height: 6, backgroundColor: '#EDF0F5', borderRadius: 3, overflow: 'hidden' },
  intentBarFill: { height: 6, borderRadius: 3 },
  intentCount: { width: 36, fontSize: 14, fontWeight: '800' as const, color: '#1B2A3D', textAlign: 'right' as const },

  deviceGrid: { flexDirection: 'row', gap: 10 },
  deviceCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#E0E5EC', borderTopWidth: 3, alignItems: 'center', gap: 6 },
  deviceCount: { fontSize: 22, fontWeight: '900' as const, color: '#1B2A3D' },
  deviceLabel: { fontSize: 11, fontWeight: '600' as const, color: '#5E6C84' },
  devicePct: { fontSize: 13, fontWeight: '800' as const },

  liveHero: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 28, borderWidth: 1, borderColor: '#E0E5EC', marginBottom: 16, alignItems: 'center', gap: 8 },
  liveCount: { fontSize: 56, fontWeight: '900' as const, color: '#1B2A3D', letterSpacing: -2 },
  liveLabel: { fontSize: 14, fontWeight: '700' as const, color: '#5E6C84' },
  liveSubRow: { flexDirection: 'row', gap: 16, marginTop: 4 },
  liveSub: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveSubText: { fontSize: 12, fontWeight: '600' as const, color: '#97A0AF' },

  pulseWrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', width: 24, height: 24, borderRadius: 12, borderWidth: 2 },
  pulseDot: { width: 10, height: 10, borderRadius: 5 },

  liveStepGrid: { flexDirection: 'row', gap: 8 },
  liveStepCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E0E5EC', borderTopWidth: 3, alignItems: 'center', gap: 4 },
  liveStepCount: { fontSize: 22, fontWeight: '900' as const },
  liveStepLabel: { fontSize: 10, fontWeight: '600' as const, color: '#5E6C84' },

  sessionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EDF0F5' },
  sessionInfo: { flex: 1, gap: 3 },
  sessionTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sessionIP: { fontSize: 13, fontWeight: '800' as const, color: '#1B2A3D' },
  sessionBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1 },
  sessionBadgeText: { fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.3 },
  sessionDetail: { fontSize: 11, fontWeight: '600' as const, color: '#5E6C84' },
  sessionMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const },
  sessionMeta: { fontSize: 10, fontWeight: '500' as const, color: '#97A0AF' },

  noDataText: { fontSize: 12, color: '#97A0AF', textAlign: 'center' as const, paddingVertical: 16, lineHeight: 18 },

  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '800' as const, color: '#1B2A3D' },
  emptySubtitle: { fontSize: 13, color: '#5E6C84', textAlign: 'center' as const, lineHeight: 20, paddingHorizontal: 24 },
  errorIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#FFEBEE', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: SS_BLUE, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, marginTop: 8 },
  retryBtnText: { fontSize: 13, fontWeight: '700' as const, color: '#FFFFFF' },

  brainHero: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 28, borderWidth: 1, borderColor: '#E0E5EC', marginBottom: 16, alignItems: 'center', gap: 10 },
  brainPulseOuter: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#00C48C18', alignItems: 'center', justifyContent: 'center' },
  brainPulseInner: { width: 20, height: 20, borderRadius: 10 },
  brainStatus: { fontSize: 22, fontWeight: '900' as const, color: '#1B2A3D', letterSpacing: -0.3 },
  brainCycles: { fontSize: 12, fontWeight: '600' as const, color: '#97A0AF' },

  brainKpiRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  brainKpiCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#E0E5EC', borderTopWidth: 3, alignItems: 'center', gap: 4 },
  brainKpiValue: { fontSize: 20, fontWeight: '900' as const },
  brainKpiLabel: { fontSize: 10, fontWeight: '600' as const, color: '#5E6C84', textTransform: 'uppercase' as const, letterSpacing: 0.5 },

  trainBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FFB800', borderRadius: 14, paddingVertical: 14, marginBottom: 16 },
  trainBtnText: { fontSize: 14, fontWeight: '800' as const, color: '#000' },
  trainBadge: { backgroundColor: '#00000020', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  trainBadgeText: { fontSize: 11, fontWeight: '800' as const, color: '#000' },

  brainTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  brainTypeIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  brainTypeInfo: { flex: 1, gap: 4 },
  brainTypeLabel: { fontSize: 12, fontWeight: '700' as const, color: '#1B2A3D', textTransform: 'capitalize' as const },
  brainTypeBarBg: { height: 4, backgroundColor: '#EDF0F5', borderRadius: 2, overflow: 'hidden' },
  brainTypeBarFill: { height: 4, borderRadius: 2 },
  brainTypeCount: { fontSize: 14, fontWeight: '900' as const, width: 30, textAlign: 'right' as const },

  brainInsightRow: { flexDirection: 'row', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EDF0F5' },
  brainInsightDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  brainInsightInfo: { flex: 1, gap: 4 },
  brainInsightTitle: { fontSize: 13, fontWeight: '700' as const, color: '#1B2A3D', lineHeight: 18 },
  brainInsightDesc: { fontSize: 11, fontWeight: '500' as const, color: '#5E6C84', lineHeight: 16 },
  brainInsightMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  brainConfBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  brainConfText: { fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.3 },
  brainConfPct: { fontSize: 10, fontWeight: '600' as const, color: '#97A0AF' },

  brainRecRow: { flexDirection: 'row', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EDF0F5' },
  brainRecNum: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  brainRecNumText: { fontSize: 12, fontWeight: '900' as const },
  brainRecInfo: { flex: 1, gap: 4 },
  brainRecTitle: { fontSize: 13, fontWeight: '700' as const, color: '#1B2A3D', lineHeight: 18 },
  brainRecDesc: { fontSize: 11, fontWeight: '500' as const, color: '#5E6C84', lineHeight: 16 },

  brainLearningRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EDF0F5' },
  brainLearningIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  brainLearningInfo: { flex: 1, gap: 2 },
  brainLearningTitle: { fontSize: 12, fontWeight: '600' as const, color: '#1B2A3D' },
  brainLearningMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brainLearningType: { fontSize: 10, fontWeight: '700' as const },
  brainLearningConf: { fontSize: 10, fontWeight: '600' as const, color: '#97A0AF' },
  brainLearningPts: { fontSize: 10, fontWeight: '500' as const, color: '#C0C7D3' },

  brainBaselineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EDF0F5' },
  brainBaselineLabel: { fontSize: 12, fontWeight: '700' as const, color: '#1B2A3D', textTransform: 'capitalize' as const, flex: 1 },
  brainBaselineValues: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brainBaselineAvg: { fontSize: 11, fontWeight: '700' as const, color: '#4A90D9' },
  brainBaselineRange: { fontSize: 10, fontWeight: '500' as const, color: '#97A0AF' },
  brainBaselineSamples: { fontSize: 10, fontWeight: '500' as const, color: '#C0C7D3' },

  presenceStatusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, marginTop: 6 },
  presenceStatusText: { fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.3 },
  presenceSyncText: { fontSize: 10, fontWeight: '500' as const, color: '#97A0AF', marginTop: 4 }});
