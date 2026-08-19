import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
  Platform} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Activity,
  Database,
  Globe,
  Shield,
  Zap,
  Layers,
  GitBranch,
  Server,
  Monitor,
  Smartphone,
  Radio,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  AlertCircle,
  XCircle,
  RefreshCw,
  Code,
  Box,
  FileText,
  Lock,
  Mail,
  Image,
  BarChart3,
  Users,
  DollarSign,
  Building2,
  MessageSquare,
  Send,
  Wifi,
  WifiOff,
  Clock,
  Cpu,
  HardDrive,
  Network,
  ZoomIn,
  ZoomOut,
  Maximize2} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { runFullHealthCheck, type HealthStatus } from '@/lib/system-health-checker';

const LIVE_HEALTH_REFRESH_INTERVAL_MS = 180_000;

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type ModuleStatus = 'live' | 'degraded' | 'offline' | 'stub';
type SeverityLevel = 'healthy' | 'warning' | 'critical';

interface SystemModule {
  severity?: SeverityLevel;
  severityReason?: string;
  id: string;
  name: string;
  file: string;
  category: string;
  status: ModuleStatus;
  description: string;
  dependencies: string[];
  dataFlow: string;
  icon: any;
  linesOfCode: number;
}

interface LayerGroup {
  id: string;
  name: string;
  icon: any;
  color: string;
  modules: SystemModule[];
}

interface DataFlowStep {
  id: string;
  text: string;
  severity: SeverityLevel;
  reason?: string;
}

interface DataFlowDefinition {
  id: string;
  name: string;
  color: string;
  steps: DataFlowStep[];
}

const PRESENTATION_LAYER: SystemModule[] = [
  { id: 'landing', name: 'Landing Page', file: 'app/landing.tsx', category: 'Pages', status: 'live', description: 'Public-facing landing with live JV deals, hero section, social proof', dependencies: ['jv-storage', 'jv-realtime', 'supabase'], dataFlow: 'Supabase → Realtime → Cache → UI', icon: Globe, linesOfCode: 2208 },
  { id: 'home', name: 'Home Dashboard', file: 'app/(tabs)/home/index.tsx', category: 'Pages', status: 'live', description: 'User dashboard with portfolio overview, live deals, market data', dependencies: ['jv-storage', 'data-hooks', 'auth-context'], dataFlow: 'Supabase → React Query → Components', icon: Monitor, linesOfCode: 0 },
  { id: 'portfolio', name: 'Portfolio', file: 'app/(tabs)/portfolio.tsx', category: 'Pages', status: 'live', description: 'User investment portfolio, holdings, performance tracking', dependencies: ['data-hooks', 'investment-service'], dataFlow: 'Supabase → Hooks → Portfolio Cards', icon: BarChart3, linesOfCode: 0 },
  { id: 'market', name: 'Market View', file: 'app/(tabs)/market.tsx', category: 'Pages', status: 'live', description: 'Live market data, property listings, price trends', dependencies: ['global-markets', 'data-hooks'], dataFlow: 'API → Cache → Market Cards', icon: Activity, linesOfCode: 0 },
  { id: 'jv-invest', name: 'JV Investment', file: 'app/jv-invest.tsx', category: 'Pages', status: 'live', description: 'JV deal details, investment flow, pool tiers selection', dependencies: ['jv-storage', 'payment-service'], dataFlow: 'Deal ID → Fetch → Render → Payment', icon: DollarSign, linesOfCode: 1254 },
  { id: 'jv-agreement', name: 'JV Agreement Builder', file: 'app/jv-agreement.tsx', category: 'Pages', status: 'live', description: 'Create/edit JV deals with all fields, photo upload, pool tiers', dependencies: ['jv-storage', 'image-storage', 'contract-template'], dataFlow: 'Form → Validate → Upsert → Supabase', icon: FileText, linesOfCode: 3478 },
  { id: 'profile', name: 'User Profile', file: 'app/(tabs)/profile.tsx', category: 'Pages', status: 'live', description: 'User settings, KYC status, account management', dependencies: ['auth-context', 'auth-store'], dataFlow: 'Auth → Profile → Settings', icon: Users, linesOfCode: 0 },
  { id: 'chat', name: 'Support Chat', file: 'app/(tabs)/chat.tsx', category: 'Pages', status: 'live', description: 'AI-powered support chat, FAQ, ticket system', dependencies: ['auth-context'], dataFlow: 'User Input → AI → Response', icon: MessageSquare, linesOfCode: 0 },
];

const ADMIN_LAYER: SystemModule[] = [
  { id: 'admin-dashboard', name: 'Admin Dashboard', file: 'app/admin/index.tsx', category: 'Admin', status: 'live', description: 'Central admin hub with stats, quick actions, module grid', dependencies: ['supabase', 'data-hooks'], dataFlow: 'Supabase → Stats → Dashboard Cards', icon: Monitor, linesOfCode: 0 },
  { id: 'admin-owner', name: 'Owner Controls', file: 'app/admin/owner-controls.tsx', category: 'Admin', status: 'live', description: 'Platform settings, fee management, property controls, JV deal management', dependencies: ['jv-storage', 'supabase'], dataFlow: 'Settings → Mutation → Supabase → Broadcast', icon: Shield, linesOfCode: 0 },
  { id: 'admin-jv-deals', name: 'JV Deals Manager', file: 'app/admin/jv-deals.tsx', category: 'Admin', status: 'live', description: 'CRUD for JV deals, publish/unpublish, photo management, archive', dependencies: ['jv-storage', 'jv-realtime'], dataFlow: 'Admin Action → Supabase → Realtime → All Pages', icon: Building2, linesOfCode: 0 },
  { id: 'admin-members', name: 'Members', file: 'app/admin/members.tsx', category: 'Admin', status: 'live', description: 'User management, KYC review, member search', dependencies: ['supabase'], dataFlow: 'Supabase profiles → Admin List', icon: Users, linesOfCode: 0 },
  { id: 'admin-transactions', name: 'Transactions', file: 'app/admin/transactions.tsx', category: 'Admin', status: 'live', description: 'Transaction history, filters, audit trail', dependencies: ['supabase'], dataFlow: 'Supabase transactions → Filtered List', icon: DollarSign, linesOfCode: 0 },
  { id: 'admin-email', name: 'Email Engine', file: 'app/admin/email-engine.tsx', category: 'Admin', status: 'live', description: 'Email campaigns, templates, send management', dependencies: ['email-context', 'email-engine'], dataFlow: 'Compose → Queue → Edge Function → Delivery', icon: Mail, linesOfCode: 0 },
  { id: 'admin-system-monitor', name: 'System Monitor', file: 'app/admin/system-monitor.tsx', category: 'Admin', status: 'live', description: '24/7 command center, uptime, error logs, performance', dependencies: ['supabase', 'analytics'], dataFlow: 'System Events → Monitor → Alerts', icon: Cpu, linesOfCode: 0 },
  { id: 'admin-chat-room', name: 'Message Room', file: 'app/admin/chat-room.tsx', category: 'Admin', status: 'live', description: 'Shared Supabase-backed realtime message room with file uploads', dependencies: ['auth-context', 'src/modules/chat', 'supabase-client'], dataFlow: 'Admin Auth → Chat Provider → Supabase Realtime → Message UI', icon: MessageSquare, linesOfCode: 0 },
  { id: 'admin-trash', name: 'Trash Bin', file: 'app/admin/trash-bin.tsx', category: 'Admin', status: 'live', description: 'Soft-deleted deals recovery, permanent delete with confirmation', dependencies: ['jv-storage'], dataFlow: 'Trash → Restore/Permanent Delete', icon: HardDrive, linesOfCode: 0 },
];

const DATA_LAYER: SystemModule[] = [
  { id: 'jv-storage', name: 'JV Storage', file: 'lib/jv-storage.ts', category: 'Data', status: 'live', description: 'Core JV deals CRUD — fetch, create, update, archive, trash. Photo protection layer. Supabase + AsyncStorage fallback', dependencies: ['supabase', 'project-storage'], dataFlow: 'Supabase ↔ AsyncStorage ↔ Cache', icon: Database, linesOfCode: 0 },
  { id: 'jv-realtime', name: 'JV Realtime Sync', file: 'lib/jv-realtime.ts', category: 'Data', status: 'live', description: '4-layer sync: Supabase Realtime → Fallback Polling → RefetchInterval → Visibility Reconnect. BroadcastChannel for cross-tab', dependencies: ['supabase'], dataFlow: 'Supabase Realtime → Invalidate → Refetch', icon: Radio, linesOfCode: 0 },
  { id: 'supabase-client', name: 'Supabase Client', file: 'lib/supabase.ts', category: 'Data', status: 'live', description: 'Supabase client with realtime config, auth, and database access', dependencies: [], dataFlow: 'Config → Client → All Modules', icon: Database, linesOfCode: 0 },
  { id: 'data-hooks', name: 'Data Hooks', file: 'lib/data-hooks.ts', category: 'Data', status: 'live', description: 'React Query hooks for properties, holdings, notifications, wallet', dependencies: ['supabase'], dataFlow: 'Supabase → React Query → Components', icon: Code, linesOfCode: 0 },
  { id: 'auth-context', name: 'Auth Context', file: 'lib/auth-context.tsx', category: 'Auth', status: 'live', description: 'Authentication state, login/logout, session management', dependencies: ['supabase', 'auth-store'], dataFlow: 'Supabase Auth → Context → App', icon: Lock, linesOfCode: 0 },
  { id: 'auth-store', name: 'Auth Store', file: 'lib/auth-store.ts', category: 'Auth', status: 'live', description: 'Persistent auth token storage using SecureStore', dependencies: [], dataFlow: 'SecureStore ↔ Auth Context', icon: Lock, linesOfCode: 0 },
  { id: 'project-storage', name: 'Project Storage', file: 'lib/project-storage.ts', category: 'Data', status: 'live', description: 'Project-scoped AsyncStorage isolation. Prevents cross-project data leaks. Audit + auto-clean foreign keys', dependencies: [], dataFlow: 'Project ID → Scoped Keys → AsyncStorage', icon: Shield, linesOfCode: 0 },
  { id: 'investment-service', name: 'Investment Service', file: 'lib/investment-service.ts', category: 'Data', status: 'live', description: 'Investment processing, share calculations, dividend logic', dependencies: ['supabase'], dataFlow: 'Investment → Calculate → Process → Store', icon: DollarSign, linesOfCode: 0 },
  { id: 'parse-deal', name: 'Deal Parser', file: 'lib/parse-deal.ts', category: 'Data', status: 'live', description: 'Unified deal parsing — photos, partners, poolTiers from any format (string JSON, array, null)', dependencies: [], dataFlow: 'Raw Data → Parse → Clean Object', icon: Code, linesOfCode: 0 },
];

const CONTEXT_LAYER: SystemModule[] = [
  { id: 'email-context', name: 'Email Context', file: 'lib/email-context.tsx', category: 'Context', status: 'live', description: 'Email state management, active accounts, send queue', dependencies: ['email-engine', 'project-storage'], dataFlow: 'Compose → Queue → Send → Track', icon: Mail, linesOfCode: 0 },
  { id: 'ipx-context', name: 'IPX Context', file: 'lib/ipx-context.tsx', category: 'Context', status: 'live', description: 'IPX token holdings, purchases, earn rewards', dependencies: ['project-storage'], dataFlow: 'Purchase → Store → Display', icon: DollarSign, linesOfCode: 0 },
  { id: 'earn-context', name: 'Earn Context', file: 'lib/earn-context.tsx', category: 'Context', status: 'live', description: 'Earn module state, staking, rewards tracking', dependencies: ['project-storage'], dataFlow: 'Stake → Calculate → Reward', icon: Zap, linesOfCode: 0 },
  { id: 'analytics-context', name: 'Analytics Context', file: 'lib/analytics-context.tsx', category: 'Context', status: 'live', description: 'Analytics event tracking, session management', dependencies: ['analytics', 'project-storage'], dataFlow: 'Event → Queue → Batch Send', icon: BarChart3, linesOfCode: 0 },
  { id: 'i18n-context', name: 'i18n Context', file: 'lib/i18n-context.tsx', category: 'Context', status: 'live', description: 'Multi-language support, translation loading, locale switching', dependencies: ['project-storage'], dataFlow: 'Locale → Load Strings → Provide', icon: Globe, linesOfCode: 0 },
  { id: 'lender-context', name: 'Lender Context', file: 'lib/lender-context.tsx', category: 'Context', status: 'live', description: 'Lender directory, imported lenders, outreach tracking', dependencies: ['project-storage'], dataFlow: 'Import → Store → Search → Outreach', icon: Building2, linesOfCode: 0 },
  { id: 'image-context', name: 'Image Context', file: 'lib/image-context.tsx', category: 'Context', status: 'live', description: 'Image management, gallery state, upload tracking', dependencies: ['image-storage'], dataFlow: 'Pick → Upload → Registry → Display', icon: Image, linesOfCode: 0 },
  { id: 'intro-context', name: 'Intro Context', file: 'lib/intro-context.tsx', category: 'Context', status: 'live', description: 'Onboarding flow, step tracking, completion state', dependencies: ['project-storage'], dataFlow: 'Step → Progress → Complete → Flag', icon: Layers, linesOfCode: 0 },
];

const SERVICE_LAYER: SystemModule[] = [
  { id: 'email-engine', name: 'Email Engine', file: 'lib/email-engine.ts', category: 'Service', status: 'live', description: 'Email sending via Supabase Edge Function, queue management, retry logic', dependencies: ['supabase'], dataFlow: 'Template → Render → Edge Function → SMTP', icon: Send, linesOfCode: 0 },
  { id: 'payment-service', name: 'Payment Service', file: 'lib/payment-service.ts', category: 'Service', status: 'live', description: 'Payment processing, transaction creation, receipt generation', dependencies: ['supabase'], dataFlow: 'Payment → Validate → Process → Receipt', icon: DollarSign, linesOfCode: 0 },
  { id: 'analytics', name: 'Analytics', file: 'lib/analytics.ts', category: 'Service', status: 'live', description: 'Event tracking with batch send, table existence check, queue management', dependencies: ['supabase', 'project-storage'], dataFlow: 'Event → Queue → Batch → Supabase', icon: BarChart3, linesOfCode: 0 },
  { id: 'push-notifications', name: 'Push Notifications', file: 'lib/push-notifications.ts', category: 'Service', status: 'live', description: 'Expo push token registration, notification handling', dependencies: ['supabase'], dataFlow: 'Token → Register → Listen → Handle', icon: Radio, linesOfCode: 0 },
  { id: 'image-storage', name: 'Image Storage', file: 'lib/image-storage.ts', category: 'Service', status: 'live', description: 'Image registry, upload tracking, project-scoped storage', dependencies: ['project-storage'], dataFlow: 'Upload → Store → Registry → URL', icon: Image, linesOfCode: 0 },
  { id: 'global-markets', name: 'Global Markets', file: 'lib/global-markets.ts', category: 'Service', status: 'live', description: 'Market data feeds, price tracking, trend analysis', dependencies: [], dataFlow: 'API → Parse → Cache → Display', icon: Activity, linesOfCode: 0 },
  { id: 'verification-service', name: 'Verification Service', file: 'lib/verification-service.ts', category: 'Service', status: 'live', description: 'KYC verification, document checking, identity validation', dependencies: ['supabase'], dataFlow: 'Submit → Verify → Approve/Reject', icon: Shield, linesOfCode: 0 },
  { id: 'contract-template', name: 'Contract Template', file: 'lib/contract-template.ts', category: 'Service', status: 'live', description: 'JV agreement PDF generation, legal templates', dependencies: [], dataFlow: 'Deal Data → Template → Render → PDF', icon: FileText, linesOfCode: 0 },
  { id: 'totp', name: 'TOTP/2FA', file: 'lib/totp.ts', category: 'Service', status: 'stub', description: '2FA TOTP generation and verification — currently stub, deferred to next phase', dependencies: [], dataFlow: 'Secret → Generate → Verify', icon: Lock, linesOfCode: 0 },
  { id: 'sec-edgar', name: 'SEC EDGAR', file: 'lib/sec-edgar-service.ts', category: 'Service', status: 'live', description: 'SEC EDGAR filing search and data retrieval', dependencies: [], dataFlow: 'Query → SEC API → Parse → Display', icon: FileText, linesOfCode: 0 },
];

const INFRA_LAYER: SystemModule[] = [
  { id: 'supabase-db', name: 'Supabase PostgreSQL', file: 'supabase-master-setup.sql', category: 'Infra', status: 'live', description: '13 tables: profiles, properties, transactions, jv_deals, analytics_events, push_tokens, etc. RLS policies enabled', dependencies: [], dataFlow: 'SQL → Tables → RLS → Realtime', icon: Database, linesOfCode: 646 },
  { id: 'supabase-realtime', name: 'Supabase Realtime', file: 'lib/jv-realtime.ts', category: 'Infra', status: 'live', description: 'WebSocket connection for live data sync. jv_deals table published to realtime', dependencies: ['supabase-db'], dataFlow: 'INSERT/UPDATE/DELETE → WebSocket → Client', icon: Wifi, linesOfCode: 0 },
  { id: 'supabase-auth', name: 'Supabase Auth', file: 'lib/auth-context.tsx', category: 'Infra', status: 'live', description: 'User authentication, session management, JWT tokens', dependencies: ['supabase-db'], dataFlow: 'Login → JWT → Session → Refresh', icon: Lock, linesOfCode: 0 },
  { id: 'async-storage', name: 'AsyncStorage (Scoped)', file: 'lib/project-storage.ts', category: 'Infra', status: 'live', description: 'Local storage with project ID scoping. Every key prefixed with project + user ID', dependencies: [], dataFlow: 'Key → Scope → Store/Retrieve', icon: HardDrive, linesOfCode: 0 },
  { id: 'expo-router', name: 'Expo Router', file: 'app/_layout.tsx', category: 'Infra', status: 'live', description: 'File-based routing, tabs + stack navigation, deep linking', dependencies: [], dataFlow: 'URL → Route → Screen → Render', icon: GitBranch, linesOfCode: 285 },
  { id: 'react-query', name: 'React Query', file: 'lib/query-config.ts', category: 'Infra', status: 'live', description: 'Server state management, caching, optimistic updates, stale-while-revalidate', dependencies: [], dataFlow: 'Query → Fetch → Cache → Invalidate', icon: Zap, linesOfCode: 0 },
];

const ALL_LAYERS: LayerGroup[] = [
  { id: 'presentation', name: 'Presentation Layer', icon: Smartphone, color: '#00C48C', modules: PRESENTATION_LAYER },
  { id: 'admin', name: 'Admin Layer', icon: Shield, color: '#FFD700', modules: ADMIN_LAYER },
  { id: 'context', name: 'Context Providers', icon: Layers, color: '#9B59B6', modules: CONTEXT_LAYER },
  { id: 'data', name: 'Data Layer', icon: Database, color: '#4A90D9', modules: DATA_LAYER },
  { id: 'service', name: 'Service Layer', icon: Server, color: '#FF6B6B', modules: SERVICE_LAYER },
  { id: 'infra', name: 'Infrastructure', icon: Cpu, color: '#E67E22', modules: INFRA_LAYER },
];

const DATA_FLOWS: DataFlowDefinition[] = [
  {
    id: 'admin-publish',
    name: 'Admin Publishes Deal',
    color: '#FFD700',
    steps: [
      { id: 'admin-publish-1', text: 'Admin JV Deals → upsertJVDeal()', severity: 'healthy' },
      { id: 'admin-publish-2', text: 'jv-storage.ts → Supabase INSERT/UPDATE', severity: 'healthy' },
      { id: 'admin-publish-3', text: 'Supabase Realtime → WebSocket event', severity: 'warning', reason: 'Watch for delayed broadcasts when realtime reconnects.' },
      { id: 'admin-publish-4', text: 'jv-realtime.ts → invalidateAllJVQueries()', severity: 'healthy' },
      { id: 'admin-publish-5', text: 'BroadcastChannel → cross-tab notification', severity: 'warning', reason: 'Use yellow when browser cross-tab sync looks delayed.' },
      { id: 'admin-publish-6', text: 'Landing + Home → refetch → re-render', severity: 'healthy' },
    ]},
  {
    id: 'user-invest',
    name: 'User Invests in Deal',
    color: '#00C48C',
    steps: [
      { id: 'user-invest-1', text: 'JV Investment Page → Select Pool Tier', severity: 'healthy' },
      { id: 'user-invest-2', text: 'payment-service.ts → Validate + Process', severity: 'critical', reason: 'Turn red immediately if payment validation or processing fails.' },
      { id: 'user-invest-3', text: 'Supabase → INSERT transaction', severity: 'healthy' },
      { id: 'user-invest-4', text: 'investment-service.ts → Update holdings', severity: 'healthy' },
      { id: 'user-invest-5', text: 'Analytics → Track conversion event', severity: 'warning', reason: 'Yellow means money flow worked but analytics visibility needs attention.' },
      { id: 'user-invest-6', text: 'Profile → Updated portfolio', severity: 'healthy' },
    ]},
  {
    id: 'realtime-sync',
    name: 'Realtime Sync (4 Layers)',
    color: '#4A90D9',
    steps: [
      { id: 'realtime-sync-1', text: 'Layer 1: Supabase Realtime subscription', severity: 'warning', reason: 'Yellow when socket reconnects too often.' },
      { id: 'realtime-sync-2', text: 'Layer 2: Fallback polling (3s interval)', severity: 'healthy' },
      { id: 'realtime-sync-3', text: 'Layer 3: refetchInterval (3s)', severity: 'healthy' },
      { id: 'realtime-sync-4', text: 'Layer 4: Visibility reconnect (tab focus)', severity: 'healthy' },
      { id: 'realtime-sync-5', text: 'Any layer triggers → React Query invalidation', severity: 'healthy' },
      { id: 'realtime-sync-6', text: 'All subscribed pages re-render with fresh data', severity: 'healthy' },
    ]},
  {
    id: 'photo-protect',
    name: 'Photo Protection Flow',
    color: '#FF6B6B',
    steps: [
      { id: 'photo-protect-1', text: 'Update request with photos[]', severity: 'warning', reason: 'Yellow if incoming payload is incomplete or inconsistent.' },
      { id: 'photo-protect-2', text: 'protectPhotos() guard checks existing count', severity: 'critical', reason: 'Red because this guard must stop destructive overwrite paths.' },
      { id: 'photo-protect-3', text: 'If incoming < existing → BLOCK (unless admin)', severity: 'healthy' },
      { id: 'photo-protect-4', text: 'If empty → fetch existing from DB → preserve', severity: 'critical', reason: 'Red when preservation fallback fails because photos can be lost.' },
      { id: 'photo-protect-5', text: 'Admin can override with adminOverride: true', severity: 'healthy' },
      { id: 'photo-protect-6', text: 'Audit log records every protection event', severity: 'warning', reason: 'Yellow if audit coverage is partial but no data is lost.' },
    ]},
  {
    id: 'trash-flow',
    name: 'Trash & Recovery Flow',
    color: '#9B59B6',
    steps: [
      { id: 'trash-flow-1', text: 'Delete action → moveToTrash()', severity: 'healthy' },
      { id: 'trash-flow-2', text: 'Deal status → "trashed", published → false', severity: 'healthy' },
      { id: 'trash-flow-3', text: 'Local backup saved to AsyncStorage', severity: 'warning', reason: 'Yellow if backup save is delayed or skipped.' },
      { id: 'trash-flow-4', text: 'Admin Trash Bin shows all trashed items', severity: 'healthy' },
      { id: 'trash-flow-5', text: 'Restore → status back to active', severity: 'healthy' },
      { id: 'trash-flow-6', text: 'Permanent delete requires typing project name', severity: 'healthy' },
    ]},
  {
    id: 'project-isolation',
    name: 'Project Storage Isolation',
    color: '#E67E22',
    steps: [
      { id: 'project-isolation-1', text: 'Every key prefixed: @ivx_p_{PROJECT_ID}::', severity: 'healthy' },
      { id: 'project-isolation-2', text: 'User-scoped: adds _u_{USER_ID}', severity: 'healthy' },
      { id: 'project-isolation-3', text: 'validateKeyOwnership() blocks cross-project', severity: 'critical', reason: 'Red because ownership validation protects all scoped data.' },
      { id: 'project-isolation-4', text: 'Startup: runStorageIntegrityCheck()', severity: 'warning', reason: 'Yellow when integrity audit has not run recently.' },
      { id: 'project-isolation-5', text: 'auditStorageKeys() detects foreign data', severity: 'healthy' },
      { id: 'project-isolation-6', text: 'cleanForeignKeys() auto-removes leaks', severity: 'healthy' },
    ]},
];

function getSeverityPalette(severity: SeverityLevel) {
  switch (severity) {
    case 'critical':
      return {
        color: '#FF4D4D',
        backgroundColor: 'rgba(255,77,77,0.14)',
        borderColor: 'rgba(255,77,77,0.3)',
        label: 'Critical'};
    case 'warning':
      return {
        color: '#FFD700',
        backgroundColor: 'rgba(255,215,0,0.14)',
        borderColor: 'rgba(255,215,0,0.3)',
        label: 'Warning'};
    default:
      return {
        color: '#00C48C',
        backgroundColor: 'rgba(34,197,94,0.14)',
        borderColor: 'rgba(34,197,94,0.3)',
        label: 'Healthy'};
  }
}

function getModuleSeverity(module: SystemModule): SeverityLevel {
  if (module.severity) {
    return module.severity;
  }
  if (module.status === 'offline') {
    return 'critical';
  }
  if (module.status === 'degraded') {
    return 'warning';
  }
  return 'healthy';
}

function StatusBadge({ status }: { status: ModuleStatus }) {
  const config = {
    live: { color: '#00C48C', label: 'LIVE', Icon: CheckCircle },
    degraded: { color: '#FFB800', label: 'DEGRADED', Icon: AlertCircle },
    offline: { color: '#FF4D4D', label: 'OFFLINE', Icon: XCircle },
    stub: { color: '#6A6A6A', label: 'STUB', Icon: Clock }};
  const { color, label, Icon } = config[status];
  return (
    <View style={[styles.statusBadge, { backgroundColor: color + '20' }]}>

      <Icon size={10} color={color} />
      <Text style={[styles.statusText, { color }]}>{label}</Text>
    </View>
  );
}

function PulsingDot({ color, delay = 0 }: { color: string; delay?: number }) {
  const anim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    }, delay);
    return () => clearTimeout(timer);
  }, [anim, delay]);
  return (
    <Animated.View style={[styles.pulsingDot, { backgroundColor: color, opacity: anim }]} />
  );
}

function ModuleCard({ module, index }: { module: SystemModule; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const severity = getModuleSeverity(module);
  const severityPalette = getSeverityPalette(severity);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 1,
      delay: index * 40,
      useNativeDriver: true,
      tension: 80,
      friction: 12}).start();
  }, [slideAnim, index]);

  const Icon = module.icon;

  return (
    <Animated.View style={[styles.moduleCard, {
      opacity: slideAnim,
      transform: [{ translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }]}]}>
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
        style={styles.moduleCardInner}
      >
        <View style={styles.moduleHeader}>
          <View style={styles.moduleIconWrap}>
            <Icon size={16} color={Colors.primary} />
          </View>
          <View style={styles.moduleInfo}>
            <Text style={styles.moduleName} numberOfLines={1}>{module.name}</Text>
            <Text style={styles.moduleFile} numberOfLines={1}>{module.file}</Text>
          </View>
          <View style={styles.moduleHeaderBadges}>
            <StatusBadge status={module.status} />
            <View style={[
              styles.severityBadge,
              {
                backgroundColor: severityPalette.backgroundColor,
                borderColor: severityPalette.borderColor},
            ]}>
              <View style={[styles.severityBadgeDot, { backgroundColor: severityPalette.color }]} />
              <Text style={[styles.severityBadgeText, { color: severityPalette.color }]}>{severityPalette.label}</Text>
            </View>
          </View>
          {expanded ? <ChevronUp size={14} color={Colors.textSecondary} /> : <ChevronDown size={14} color={Colors.textSecondary} />}
        </View>

        {expanded && (
          <View style={styles.moduleDetails}>
            <Text style={styles.moduleDesc}>{module.description}</Text>
            {module.severityReason ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Severity rule</Text>
                <Text style={[styles.detailValue, { color: severityPalette.color }]}>{module.severityReason}</Text>
              </View>
            ) : null}

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Data Flow</Text>
              <Text style={styles.detailValue}>{module.dataFlow}</Text>
            </View>

            {module.dependencies.length > 0 && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Dependencies</Text>
                <View style={styles.depTags}>
                  {module.dependencies.map((dep) => (
                    <View key={dep} style={styles.depTag}>
                      <Text style={styles.depTagText}>{dep}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {module.linesOfCode > 0 && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Lines of Code</Text>
                <Text style={styles.detailValue}>{new Intl.NumberFormat('en-US').format(module.linesOfCode)}</Text>
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

function LayerSection({ layer, index: _index }: { layer: LayerGroup; index: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const Icon = layer.icon;
  const liveCount = layer.modules.filter(m => m.status === 'live').length;
  const totalCount = layer.modules.length;

  return (
    <View style={styles.layerSection}>
      <TouchableOpacity
        style={[styles.layerHeader, { borderLeftColor: layer.color }]}
        onPress={() => setCollapsed(!collapsed)}
        activeOpacity={0.7}
      >
        <View style={styles.layerHeaderLeft}>
          <View style={[styles.layerIconWrap, { backgroundColor: layer.color + '20' }]}>
            <Icon size={18} color={layer.color} />
          </View>
          <View>
            <Text style={styles.layerName}>{layer.name}</Text>
            <Text style={styles.layerCount}>{liveCount}/{totalCount} modules live</Text>
          </View>
        </View>
        <View style={styles.layerHeaderRight}>
          <View style={[styles.layerBar]}>
            <View style={[styles.layerBarFill, { width: `${(liveCount / totalCount) * 100}%`, backgroundColor: layer.color }]} />
          </View>
          {collapsed ? <ChevronDown size={16} color={Colors.textSecondary} /> : <ChevronUp size={16} color={Colors.textSecondary} />}
        </View>
      </TouchableOpacity>

      {!collapsed && (
        <View style={styles.layerModules}>
          {layer.modules.map((mod, i) => (
            <ModuleCard key={mod.id} module={mod} index={i} />
          ))}
        </View>
      )}
    </View>
  );
}

function DataFlowCard({ flow, index }: { flow: DataFlowDefinition; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const warningCount = flow.steps.filter((step) => step.severity === 'warning').length;
  const criticalCount = flow.steps.filter((step) => step.severity === 'critical').length;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 1,
      delay: index * 60,
      useNativeDriver: true,
      tension: 80,
      friction: 12}).start();
  }, [slideAnim, index]);

  return (
    <Animated.View style={[styles.flowCard, {
      opacity: slideAnim,
      transform: [{ translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }]}]}>
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
        style={styles.flowCardInner}
      >
        <View style={styles.flowHeader}>
          <View style={[styles.flowDot, { backgroundColor: flow.color }]} />
          <Text style={styles.flowName}>{flow.name}</Text>
          <View style={styles.flowHeaderMeta}>
            {warningCount > 0 ? (
              <View style={[styles.flowCountBadge, styles.flowCountBadgeWarning]}>
                <Text style={styles.flowCountBadgeText}>{warningCount} warning</Text>
              </View>
            ) : null}
            {criticalCount > 0 ? (
              <View style={[styles.flowCountBadge, styles.flowCountBadgeCritical]}>
                <Text style={styles.flowCountBadgeText}>{criticalCount} critical</Text>
              </View>
            ) : null}
            <Text style={styles.flowStepCount}>{flow.steps.length} steps</Text>
          </View>
          {expanded ? <ChevronUp size={14} color={Colors.textSecondary} /> : <ChevronDown size={14} color={Colors.textSecondary} />}
        </View>

        {expanded && (
          <View style={styles.flowSteps}>
            {flow.steps.map((step, i) => {
              const severityPalette = getSeverityPalette(step.severity);

              return (
                <View key={step.id} style={styles.flowStep}>
                  <View style={styles.flowStepLine}>
                    <View style={[
                      styles.flowStepDot,
                      {
                        backgroundColor: severityPalette.color,
                        shadowColor: severityPalette.color},
                    ]} />
                    {i < flow.steps.length - 1 && (
                      <View style={[
                        styles.flowStepConnector,
                        { backgroundColor: severityPalette.borderColor },
                      ]} />
                    )}
                  </View>
                  <View style={styles.flowStepContent}>
                    <View style={styles.flowStepTopRow}>
                      <Text style={styles.flowStepNumber}>Step {i + 1}</Text>
                      <View style={[
                        styles.flowSeverityPill,
                        {
                          backgroundColor: severityPalette.backgroundColor,
                          borderColor: severityPalette.borderColor},
                      ]}>
                        <Text style={[styles.flowSeverityPillText, { color: severityPalette.color }]}>{severityPalette.label}</Text>
                      </View>
                    </View>
                    <Text style={styles.flowStepText}>{step.text}</Text>
                    {step.reason ? <Text style={styles.flowStepReason}>{step.reason}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

function LiveHealthPanel() {
  const [supabaseStatus, setSupabaseStatus] = useState<'checking' | 'connected' | 'degraded' | 'error'>('checking');
  const [realtimeStatus, setRealtimeStatus] = useState<'checking' | 'connected' | 'degraded' | 'error'>('checking');
  const [lastCheck, setLastCheck] = useState<Date>(new Date());
  const pulseAnim = useRef(new Animated.Value(0)).current;

  const mapHealthStatus = useCallback((status: HealthStatus | undefined): 'connected' | 'degraded' | 'error' => {
    if (status === 'green') {
      return 'connected';
    }
    if (status === 'yellow') {
      return 'degraded';
    }
    return 'error';
  }, []);

  const checkHealth = useCallback(async (force: boolean = false) => {
    setSupabaseStatus('checking');
    setRealtimeStatus('checking');

    try {
      const snapshot = await runFullHealthCheck({ force });
      const databaseCheck = snapshot.checks.find((check) => check.id === 'supabase-db');
      const realtimeCheck = snapshot.checks.find((check) => check.id === 'supabase-realtime');

      setSupabaseStatus(mapHealthStatus(databaseCheck?.status));
      setRealtimeStatus(mapHealthStatus(realtimeCheck?.status));
    } catch (error) {
      console.log('[AdminSystemMap] Live health check failed:', (error as Error)?.message);
      setSupabaseStatus('error');
      setRealtimeStatus('error');
    }

    setLastCheck(new Date());
  }, [mapHealthStatus]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled) {
        return;
      }
      await checkHealth(false);
    };

    void run();
    const interval = setInterval(() => {
      void run();
    }, LIVE_HEALTH_REFRESH_INTERVAL_MS);
    const animationLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ])
    );
    animationLoop.start();
    return () => {
      cancelled = true;
      clearInterval(interval);
      animationLoop.stop();
    };
  }, [checkHealth, pulseAnim]);

  const statusColor = (s: string) => s === 'connected' ? '#00C48C' : s === 'degraded' ? '#FFB800' : s === 'error' ? '#FF4D4D' : '#94A3B8';
  const StatusIcon = (s: string) => s === 'connected' ? Wifi : s === 'degraded' ? Clock : s === 'error' ? WifiOff : Clock;

  const DbIcon = StatusIcon(supabaseStatus);
  const RtIcon = StatusIcon(realtimeStatus);

  return (
    <View style={styles.healthPanel}>
      <View style={styles.healthHeader}>
        <Animated.View style={{ opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }}>
          <Activity size={16} color="#00C48C" />
        </Animated.View>
        <Text style={styles.healthTitle}>Live System Health</Text>
        <TouchableOpacity onPress={() => void checkHealth(true)} style={styles.refreshBtn}>
          <RefreshCw size={14} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.healthGrid}>
        <View style={[styles.healthItem, { borderColor: statusColor(supabaseStatus) + '40' }]}>
          <DbIcon size={18} color={statusColor(supabaseStatus)} />
          <Text style={styles.healthLabel}>Supabase DB</Text>
          <View style={[styles.healthDot, { backgroundColor: statusColor(supabaseStatus) }]} />
        </View>
        <View style={[styles.healthItem, { borderColor: statusColor(realtimeStatus) + '40' }]}>
          <RtIcon size={18} color={statusColor(realtimeStatus)} />
          <Text style={styles.healthLabel}>Realtime WS</Text>
          <View style={[styles.healthDot, { backgroundColor: statusColor(realtimeStatus) }]} />
        </View>
        <View style={[styles.healthItem, { borderColor: '#00C48C40' }]}>
          <Smartphone size={18} color="#00C48C" />
          <Text style={styles.healthLabel}>App Runtime</Text>
          <View style={[styles.healthDot, { backgroundColor: '#00C48C' }]} />
        </View>
        <View style={[styles.healthItem, { borderColor: '#00C48C40' }]}>
          <Zap size={18} color="#00C48C" />
          <Text style={styles.healthLabel}>React Query</Text>
          <View style={[styles.healthDot, { backgroundColor: '#00C48C' }]} />
        </View>
      </View>

      <Text style={styles.healthTimestamp}>Last checked: {lastCheck.toLocaleTimeString()} · cached health snapshot</Text>
    </View>
  );
}

function StatsOverview() {
  const totalModules = ALL_LAYERS.reduce((sum, l) => sum + l.modules.length, 0);
  const liveModules = ALL_LAYERS.reduce((sum, l) => sum + l.modules.filter(m => m.status === 'live').length, 0);
  const stubModules = ALL_LAYERS.reduce((sum, l) => sum + l.modules.filter(m => m.status === 'stub').length, 0);

  return (
    <View style={styles.statsRow}>
      <View style={styles.statCard}>
        <Text style={styles.statNumber}>{totalModules}</Text>
        <Text style={styles.statLabel}>Total Modules</Text>
      </View>
      <View style={styles.statCard}>
        <Text style={[styles.statNumber, { color: '#00C48C' }]}>{liveModules}</Text>
        <Text style={styles.statLabel}>Live</Text>
      </View>
      <View style={styles.statCard}>
        <Text style={[styles.statNumber, { color: '#6A6A6A' }]}>{stubModules}</Text>
        <Text style={styles.statLabel}>Stubs</Text>
      </View>
      <View style={styles.statCard}>
        <Text style={[styles.statNumber, { color: '#4A90D9' }]}>{ALL_LAYERS.length}</Text>
        <Text style={styles.statLabel}>Layers</Text>
      </View>
    </View>
  );
}

interface DiagramNode {
  id: string;
  name: string;
  layerId: string;
  layerColor: string;
  status: ModuleStatus;
  icon: any;
  x: number;
  y: number;
  dependencies: string[];
}

const NODE_W = 120;
const NODE_H = 56;
const LAYER_GAP_Y = 110;
const NODE_GAP_X = 140;
const DIAGRAM_PAD = 40;

function buildDiagramNodes(): DiagramNode[] {
  const nodes: DiagramNode[] = [];
  const layerOrder = ['presentation', 'admin', 'context', 'data', 'service', 'infra'];

  layerOrder.forEach((layerId, layerIdx) => {
    const layer = ALL_LAYERS.find(l => l.id === layerId);
    if (!layer) return;
    const mods = layer.modules;
    const cols = Math.min(mods.length, 4);
    const rows = Math.ceil(mods.length / cols);
    const _layerBaseY = DIAGRAM_PAD + layerIdx * LAYER_GAP_Y * (rows > 1 ? 1.4 : 1);

    let yAccum = 0;
    for (let li = 0; li < layerIdx; li++) {
      const pl = ALL_LAYERS.find(l => l.id === layerOrder[li]);
      if (!pl) continue;
      const pRows = Math.ceil(pl.modules.length / Math.min(pl.modules.length, 4));
      yAccum += pRows * LAYER_GAP_Y;
    }

    mods.forEach((mod, modIdx) => {
      const col = modIdx % cols;
      const row = Math.floor(modIdx / cols);
      const totalRowWidth = cols * NODE_GAP_X;
      const startX = DIAGRAM_PAD + (Math.max(4 * NODE_GAP_X, totalRowWidth) - totalRowWidth) / 2;

      nodes.push({
        id: mod.id,
        name: mod.name,
        layerId: layer.id,
        layerColor: layer.color,
        status: mod.status,
        icon: mod.icon,
        x: startX + col * NODE_GAP_X,
        y: DIAGRAM_PAD + yAccum + row * 80,
        dependencies: mod.dependencies});
    });
  });

  return nodes;
}

function DiagramConnectionLines({ nodes, offsetX, offsetY, scale }: { nodes: DiagramNode[]; offsetX: number; offsetY: number; scale: number }) {
  const nodeMap = useMemo(() => {
    const map = new Map<string, DiagramNode>();
    nodes.forEach(n => map.set(n.id, n));
    return map;
  }, [nodes]);

  const connections = useMemo(() => {
    const lines: { fromX: number; fromY: number; toX: number; toY: number; color: string }[] = [];
    nodes.forEach(node => {
      node.dependencies.forEach(depId => {
        const dep = nodeMap.get(depId);
        if (!dep) return;
        lines.push({
          fromX: node.x + NODE_W / 2,
          fromY: node.y + NODE_H,
          toX: dep.x + NODE_W / 2,
          toY: dep.y,
          color: node.layerColor});
      });
    });
    return lines;
  }, [nodes, nodeMap]);

  return (
    <>
      {connections.map((line, i) => {
        const dx = (line.toX - line.fromX) * scale;
        const dy = (line.toY - line.fromY) * scale;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        const sx = line.fromX * scale + offsetX;
        const sy = line.fromY * scale + offsetY;

        return (
          <View
            key={`conn-${i}`}
            style={{
              position: 'absolute' as const,
              left: sx,
              top: sy,
              width: length,
              height: 2,
              backgroundColor: line.color + '35',
              transform: [{ rotate: `${angle}deg` }],
              transformOrigin: '0 0'}}
          />
        );
      })}
    </>
  );
}

function DiagramNodeView({ node, offsetX, offsetY, scale, onSelect, isSelected }: {
  node: DiagramNode;
  offsetX: number;
  offsetY: number;
  scale: number;
  onSelect: (id: string) => void;
  isSelected: boolean;
}) {
  const Icon = node.icon;
  const severity = getModuleSeverity({
    id: node.id,
    name: node.name,
    file: '',
    category: '',
    status: node.status,
    description: '',
    dependencies: node.dependencies,
    dataFlow: '',
    icon: node.icon,
    linesOfCode: 0});
  const severityPalette = getSeverityPalette(severity);
  const pulseAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (node.status === 'live') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.6, duration: 1200, useNativeDriver: true }),
        ])
      ).start();
    }
  }, [pulseAnim, node.status]);

  const nx = node.x * scale + offsetX;
  const ny = node.y * scale + offsetY;
  const nw = NODE_W * scale;
  const nh = NODE_H * scale;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => onSelect(node.id)}
      style={[
        diagramStyles.node,
        {
          left: nx,
          top: ny,
          width: nw,
          height: nh,
          borderColor: isSelected ? node.layerColor : node.layerColor + '50',
          borderWidth: isSelected ? 2 : 1,
          backgroundColor: isSelected ? node.layerColor + '20' : Colors.surface},
      ]}
    >
      <View style={diagramStyles.nodeInner}>
        <View style={diagramStyles.nodeTop}>
          <Icon size={Math.max(10, 14 * scale)} color={node.layerColor} />
          <Animated.View style={[diagramStyles.nodeStatusDot, { backgroundColor: severityPalette.color, opacity: pulseAnim }]} />
        </View>
        <Text
          style={[diagramStyles.nodeLabel, { fontSize: Math.max(7, 10 * scale) }]}
          numberOfLines={2}
        >
          {node.name}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function SystemDiagramMap() {
  const nodes = useMemo(() => buildDiagramNodes(), []);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [scale, setScale] = useState(0.65);
  const [offset, setOffset] = useState({ x: 10, y: 10 });
  const offsetRef = useRef({ x: 10, y: 10 });
  const lastOffset = useRef({ x: 10, y: 10 });

  const maxX = useMemo(() => Math.max(...nodes.map(n => n.x + NODE_W)) + DIAGRAM_PAD, [nodes]);
  const maxY = useMemo(() => Math.max(...nodes.map(n => n.y + NODE_H)) + DIAGRAM_PAD, [nodes]);

  const panGesture = useMemo(() => Gesture.Pan()
    .minDistance(5)
    .maxPointers(1)
    .onBegin(() => {
      lastOffset.current = { ...offsetRef.current };
    })
    .onUpdate((event) => {
      if (event.numberOfPointers !== 1) {
        return;
      }

      const nextOffset = {
        x: lastOffset.current.x + event.translationX,
        y: lastOffset.current.y + event.translationY};

      offsetRef.current = nextOffset;
      setOffset(nextOffset);
    })
    .runOnJS(true), []);

  const selectedNodeData = useMemo(() => {
    if (!selectedNode) return null;
    for (const layer of ALL_LAYERS) {
      const mod = layer.modules.find(m => m.id === selectedNode);
      if (mod) return { ...mod, layerColor: layer.color, layerName: layer.name };
    }
    return null;
  }, [selectedNode]);

  const highlightedDeps = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const node = nodes.find(n => n.id === selectedNode);
    if (!node) return new Set<string>();
    const deps = new Set<string>(node.dependencies);
    nodes.forEach(n => {
      if (n.dependencies.includes(selectedNode)) deps.add(n.id);
    });
    return deps;
  }, [selectedNode, nodes]);

  const handleZoomIn = useCallback(() => {
    setScale(s => Math.min(s + 0.15, 1.5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale(s => Math.max(s - 0.15, 0.3));
  }, []);

  const handleFitView = useCallback(() => {
    const sw = SCREEN_WIDTH - 32;
    const fitScale = Math.min(sw / maxX, 0.7);
    const resetOffset = { x: 10, y: 10 };
    setScale(fitScale);
    offsetRef.current = resetOffset;
    lastOffset.current = resetOffset;
    setOffset(resetOffset);
  }, [maxX]);

  const layerLabels = useMemo(() => {
    const labels: { name: string; color: string; y: number }[] = [];
    const layerOrder = ['presentation', 'admin', 'context', 'data', 'service', 'infra'];
    layerOrder.forEach(layerId => {
      const layerNodes = nodes.filter(n => n.layerId === layerId);
      if (layerNodes.length === 0) return;
      const minY = Math.min(...layerNodes.map(n => n.y));
      const layer = ALL_LAYERS.find(l => l.id === layerId);
      if (layer) labels.push({ name: layer.name, color: layer.color, y: minY });
    });
    return labels;
  }, [nodes]);

  return (
    <View style={diagramStyles.container}>
      <View style={diagramStyles.toolbar}>
        <TouchableOpacity onPress={handleZoomOut} style={diagramStyles.toolBtn}>
          <ZoomOut size={16} color={Colors.text} />
        </TouchableOpacity>
        <Text style={diagramStyles.zoomLabel}>{Math.round(scale * 100)}%</Text>
        <TouchableOpacity onPress={handleZoomIn} style={diagramStyles.toolBtn}>
          <ZoomIn size={16} color={Colors.text} />
        </TouchableOpacity>
        <View style={diagramStyles.toolDivider} />
        <TouchableOpacity onPress={handleFitView} style={diagramStyles.toolBtn}>
          <Maximize2 size={16} color={Colors.text} />
        </TouchableOpacity>
      </View>

      <View style={diagramStyles.legend}>
        {ALL_LAYERS.map(l => (
          <View key={l.id} style={diagramStyles.legendItem}>
            <View style={[diagramStyles.legendDot, { backgroundColor: l.color }]} />
            <Text style={diagramStyles.legendText}>{l.name.replace(' Layer', '').replace(' Providers', '')}</Text>
          </View>
        ))}
      </View>

      <View style={diagramStyles.severityLegend}>
        {(['healthy', 'warning', 'critical'] as SeverityLevel[]).map((severity) => {
          const palette = getSeverityPalette(severity);
          return (
            <View
              key={severity}
              style={[
                diagramStyles.severityLegendItem,
                {
                  backgroundColor: palette.backgroundColor,
                  borderColor: palette.borderColor},
              ]}
            >
              <View style={[diagramStyles.severityLegendDot, { backgroundColor: palette.color }]} />
              <Text style={[diagramStyles.severityLegendText, { color: palette.color }]}>{palette.label}</Text>
            </View>
          );
        })}
      </View>

      <GestureDetector gesture={panGesture}>
        <View style={diagramStyles.canvasWrap}>
          <View style={[diagramStyles.canvas, { width: maxX * scale + 200, height: maxY * scale + 200 }]}>
          {layerLabels.map((label, i) => (
            <View
              key={`label-${i}`}
              style={[
                diagramStyles.layerLabel,
                {
                  top: label.y * scale + offset.y - 20,
                  left: offset.x},
              ]}
            >
              <View style={[diagramStyles.layerLabelDot, { backgroundColor: label.color }]} />
              <Text style={[diagramStyles.layerLabelText, { color: label.color }]}>{label.name}</Text>
            </View>
          ))}

          <DiagramConnectionLines nodes={nodes} offsetX={offset.x} offsetY={offset.y} scale={scale} />

          {nodes.map(node => (
            <DiagramNodeView
              key={node.id}
              node={node}
              offsetX={offset.x}
              offsetY={offset.y}
              scale={scale}
              onSelect={setSelectedNode}
              isSelected={selectedNode === node.id || highlightedDeps.has(node.id)}
            />
          ))}
          </View>
        </View>
      </GestureDetector>

      {selectedNodeData && (
        <View style={[diagramStyles.infoPanel, { borderLeftColor: selectedNodeData.layerColor }]}>
          <TouchableOpacity onPress={() => setSelectedNode(null)} style={diagramStyles.infoPanelClose}>
            <XCircle size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
          <View style={diagramStyles.infoPanelHeader}>
            <selectedNodeData.icon size={18} color={selectedNodeData.layerColor} />
            <View style={{ flex: 1 }}>
              <Text style={diagramStyles.infoPanelTitle}>{selectedNodeData.name}</Text>
              <Text style={diagramStyles.infoPanelLayer}>{selectedNodeData.layerName}</Text>
            </View>
            <StatusBadge status={selectedNodeData.status} />
          </View>
          <Text style={diagramStyles.infoPanelDesc}>{selectedNodeData.description}</Text>
          <Text style={diagramStyles.infoPanelFile}>{selectedNodeData.file}</Text>
          {selectedNodeData.dependencies.length > 0 && (
            <View style={diagramStyles.infoPanelDeps}>
              <Text style={diagramStyles.infoPanelDepsLabel}>Connects to:</Text>
              <View style={diagramStyles.infoPanelDepTags}>
                {selectedNodeData.dependencies.map(dep => (
                  <TouchableOpacity key={dep} onPress={() => setSelectedNode(dep)} style={diagramStyles.infoPanelDepTag}>
                    <Text style={diagramStyles.infoPanelDepTagText}>{dep}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export default function SystemMapScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [activeView, setActiveView] = useState<'diagram' | 'architecture' | 'dataflows'>('diagram');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <PulsingDot color="#00C48C" />
            <Text style={styles.headerTitle}>System Blueprint</Text>
          </View>
          <Text style={styles.headerSubtitle}>Live Architecture Map</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.viewToggle}>
        <TouchableOpacity
          style={[styles.toggleBtn, activeView === 'diagram' && styles.toggleBtnActive]}
          onPress={() => setActiveView('diagram')}
        >
          <Network size={14} color={activeView === 'diagram' ? Colors.background : Colors.textSecondary} />
          <Text style={[styles.toggleText, activeView === 'diagram' && styles.toggleTextActive]}>Diagram</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, activeView === 'architecture' && styles.toggleBtnActive]}
          onPress={() => setActiveView('architecture')}
        >
          <Layers size={14} color={activeView === 'architecture' ? Colors.background : Colors.textSecondary} />
          <Text style={[styles.toggleText, activeView === 'architecture' && styles.toggleTextActive]}>Architecture</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, activeView === 'dataflows' && styles.toggleBtnActive]}
          onPress={() => setActiveView('dataflows')}
        >
          <GitBranch size={14} color={activeView === 'dataflows' ? Colors.background : Colors.textSecondary} />
          <Text style={[styles.toggleText, activeView === 'dataflows' && styles.toggleTextActive]}>Data Flows</Text>
        </TouchableOpacity>
      </View>

      {activeView === 'diagram' ? (
        <SystemDiagramMap />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <LiveHealthPanel />
          <StatsOverview />

          {activeView === 'architecture' ? (
            <>
              <View style={styles.sectionHeader}>
                <Box size={16} color={Colors.primary} />
                <Text style={styles.sectionTitle}>System Layers</Text>
                <Text style={styles.sectionSubtitle}>Tap any module to inspect</Text>
              </View>
              {ALL_LAYERS.map((layer, i) => (
                <LayerSection key={layer.id} layer={layer} index={i} />
              ))}
            </>
          ) : (
            <>
              <View style={styles.sectionHeader}>
                <GitBranch size={16} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Live Data Flows</Text>
                <Text style={styles.sectionSubtitle}>How data moves through the system</Text>
              </View>
              {DATA_FLOWS.map((flow, i) => (
                <DataFlowCard key={flow.id} flow={flow} index={i} />
              ))}
            </>
          )}

          <View style={styles.footer}>
            <Text style={styles.footerText}>IVX Holding — System Blueprint v1.0</Text>
            <Text style={styles.footerText}>Auto-generated from codebase analysis</Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  headerCenter: {
    flex: 1,
    alignItems: 'center'},
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.3},
  headerSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2},
  viewToggle: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 4},
  toggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6},
  toggleBtnActive: {
    backgroundColor: Colors.primary},
  toggleText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  toggleTextActive: {
    color: Colors.background},
  scroll: {
    flex: 1},
  scrollContent: {
    paddingBottom: 40},
  healthPanel: {
    margin: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border},
  healthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12},
  healthTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    flex: 1},
  refreshBtn: {
    padding: 6},
  healthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8},
  healthItem: {
    flex: 1,
    minWidth: (SCREEN_WIDTH - 64) / 2 - 4,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
    borderWidth: 1},
  healthLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    flex: 1},
  healthDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  healthTimestamp: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 10,
    textAlign: 'center'},
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    gap: 8,
    marginBottom: 8},
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border},
  statNumber: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text},
  statLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginTop: 2},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 12,
    gap: 8},
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text},
  sectionSubtitle: {
    fontSize: 11,
    color: Colors.textTertiary,
    flex: 1,
    textAlign: 'right' as const},
  layerSection: {
    marginHorizontal: 16,
    marginBottom: 16},
  layerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: Colors.border},
  layerHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  layerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'},
  layerName: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text},
  layerCount: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 1},
  layerHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  layerBar: {
    width: 60,
    height: 4,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 2,
    overflow: 'hidden' as const},
  layerBarFill: {
    height: '100%',
    borderRadius: 2},
  layerModules: {
    marginTop: 8,
    gap: 6},
  moduleCard: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden' as const},
  moduleCardInner: {
    padding: 12},
  moduleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  moduleHeaderBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  moduleIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center'},
  moduleInfo: {
    flex: 1},
  moduleName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text},
  moduleFile: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 1},
  moduleDetails: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border},
  moduleDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 10},
  detailRow: {
    marginBottom: 8},
  detailLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 4},
  detailValue: {
    fontSize: 12,
    color: Colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace'},
  depTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4},
  depTag: {
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6},
  depTagText: {
    fontSize: 10,
    color: Colors.primary,
    fontWeight: '600' as const},
  flowCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden' as const},
  flowCardInner: {
    padding: 14},
  flowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  flowDot: {
    width: 12,
    height: 12,
    borderRadius: 6},
  flowName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    flex: 1},
  flowHeaderMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  flowCountBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1},
  flowCountBadgeWarning: {
    backgroundColor: 'rgba(255,215,0,0.12)',
    borderColor: 'rgba(255,215,0,0.28)'},
  flowCountBadgeCritical: {
    backgroundColor: 'rgba(255,77,77,0.12)',
    borderColor: 'rgba(255,77,77,0.28)'},
  flowCountBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.text},
  flowStepCount: {
    fontSize: 11,
    color: Colors.textTertiary},
  flowSteps: {
    marginTop: 14,
    marginLeft: 6},
  flowStep: {
    flexDirection: 'row',
    minHeight: 48},
  flowStepLine: {
    width: 24,
    alignItems: 'center'},
  flowStepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 }},
  flowStepConnector: {
    width: 2,
    flex: 1,
    marginTop: 2,
    marginBottom: -2},
  flowStepContent: {
    flex: 1,
    paddingLeft: 8,
    paddingBottom: 12},
  flowStepTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8},
  flowStepNumber: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  flowStepText: {
    fontSize: 12,
    color: Colors.text,
    marginTop: 2,
    lineHeight: 18},
  flowStepReason: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 6,
    lineHeight: 16},
  flowSeverityPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1},
  flowSeverityPillText: {
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const},
  severityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1},
  severityBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3},
  severityBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3},
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6},
  statusText: {
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 0.3},
  pulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  footer: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 4},
  footerText: {
    fontSize: 11,
    color: Colors.textTertiary}});

const diagramStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  toolBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border},
  zoomLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    minWidth: 40,
    textAlign: 'center' as const},
  toolDivider: {
    width: 1,
    height: 20,
    backgroundColor: Colors.border,
    marginHorizontal: 4},
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 8,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  severityLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  severityLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1},
  severityLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  severityLegendText: {
    fontSize: 10,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4},
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4},
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  legendText: {
    fontSize: 9,
    color: Colors.textSecondary,
    fontWeight: '500' as const},
  canvasWrap: {
    flex: 1,
    overflow: 'hidden' as const},
  canvas: {
    position: 'relative' as const,
    minWidth: '100%',
    minHeight: '100%'},
  layerLabel: {
    position: 'absolute' as const,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    zIndex: 1},
  layerLabelDot: {
    width: 6,
    height: 6,
    borderRadius: 3},
  layerLabelText: {
    fontSize: 9,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8},
  node: {
    position: 'absolute' as const,
    borderRadius: 10,
    padding: 6,
    zIndex: 10},
  nodeInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 3},
  nodeTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4},
  nodeStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3},
  nodeLabel: {
    color: Colors.text,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
    lineHeight: 13},
  infoPanel: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    borderLeftWidth: 4,
    padding: 16,
    paddingBottom: 24,
    zIndex: 100},
  infoPanelClose: {
    position: 'absolute' as const,
    top: 12,
    right: 12,
    zIndex: 10,
    padding: 4},
  infoPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8},
  infoPanelTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text},
  infoPanelLayer: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 1},
  infoPanelDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 6},
  infoPanelFile: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 8},
  infoPanelDeps: {
    marginTop: 4},
  infoPanelDepsLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 6},
  infoPanelDepTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4},
  infoPanelDepTag: {
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6},
  infoPanelDepTagText: {
    fontSize: 10,
    color: Colors.primary,
    fontWeight: '600' as const}});
