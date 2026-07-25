import React, { useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useScreenFocusState } from '@/hooks/useScreenFocusState';
import {
  Users,
  ArrowLeftRight,
  Building2,
  TrendingUp,
  DollarSign,
  Clock,
  Shield,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  X,
  Crown,
  UserPlus,
  Percent,
  Handshake,
  BarChart3,
  FileText,
  Database,
  Mail,
  KeyRound,
  ShieldCheck,
  Zap,
  Network,
  Megaphone,
  Activity,
  Video,
  ClipboardList,
  Image,
  Radio,
  Code,
  Inbox,
  Settings,
  Target,
  UserCheck,
  Globe,
  Brain,
  MessageSquare,
  Landmark,
  SearchCheck,
  RefreshCw,
  Share2,
  Eye,
  Rocket,
  Trash2,
  ArchiveRestore,
  Clapperboard,
  LayoutDashboard,
  Monitor,
  FileBarChart,
  Bot,
  Server,
  PieChart,
  MapPin,
  Send,
  Sliders,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { formatCurrency as _fmtCurr } from '@/lib/formatters';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { getAdminMemberRegistrySnapshot, type AdminMemberRegistrySnapshot } from '@/lib/member-registry';
import { getDeployAccessDiagnostic } from '@/lib/landing-deploy';
import { getAutoDeployStatus } from '@/lib/auto-deploy';

const ADMIN_OVERVIEW_REFRESH_MS = 120_000;
const ADMIN_AUDIT_REFRESH_MS = 180_000;

const adminTeamMembers = [
  {
    id: 'mgr-kimberly',
    name: 'Kimberly Perez',
    role: 'Advertising Manager',
    email: 'kimberly@ivxholding.com',
    status: 'active' as const,
    avatarInitials: 'KP',
    avatarColor: '#FF6B9D',
  },
  {
    id: 'mgr-sharon',
    name: 'Sharon',
    role: 'Advertising Partner',
    email: 'sharon@ivxholding.com',
    status: 'active' as const,
    avatarInitials: 'SH',
    avatarColor: '#4ECDC4',
  },
];

const ADMIN_MODULES = [
  { id: 'system-map', name: 'System Blueprint', icon: Network, route: '/admin/system-map', category: 'Core', keywords: 'blueprint system map architecture live health network diagram' },
  { id: 'owner-controls', name: 'Owner Controls', icon: Crown, route: '/admin/owner-controls', category: 'Core', keywords: 'owner admin controls master settings' },
  { id: 'access-control', name: 'Access Control', icon: Shield, route: '/admin/access-control', category: 'Core', keywords: 'access control roles permissions users screens rbac security manage assign revoke' },
  { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard, route: '/admin/dashboard', category: 'Core', keywords: 'dashboard overview summary' },
  { id: 'business-overview', name: 'Business Overview', icon: BarChart3, route: '/admin/business-overview', category: 'Core', keywords: 'business overview members investors deals capital raised kyc system health' },
  { id: 'system-monitor', name: '24/7 Command Center', icon: Monitor, route: '/admin/system-monitor', category: 'Core', keywords: 'monitor command center health live status' },
  { id: 'admin-chat-room', name: 'Message Room', icon: MessageSquare, route: '/admin/chat-room', category: 'Core', keywords: 'chat room realtime supabase shared support messages inbox' },
  { id: 'supabase-scripts', name: 'Supabase SQL', icon: Database, route: '/admin/supabase-scripts', category: 'Core', keywords: 'supabase sql scripts copy paste database tables setup migration' },
  { id: 'audit-log', name: 'Audit Trail', icon: Shield, route: '/admin/audit-log', category: 'Core', keywords: 'audit trail log history records tracking delete restore' },
  { id: 'data-recovery', name: 'Data Recovery', icon: RefreshCw, route: '/admin/data-recovery', category: 'Core', keywords: 'recovery backup restore deleted data snapshot' },
  { id: 'restore-center', name: 'Restore Center', icon: ArchiveRestore, route: '/admin/restore-center', category: 'Core', keywords: 'restore center backup vault snapshot pitr drill emergency export zero data loss' },
  { id: 'admin-reels', name: 'Manage Reels', icon: Clapperboard, route: '/admin/admin-reels', category: 'Core', keywords: 'reels videos admin manage add delete hide feature project reels deal videos' },
  { id: 'image-backup', name: 'Image Backup', icon: Shield, route: '/admin/image-backup', category: 'Core', keywords: 'image backup protection photos recovery health scan storage' },
  { id: 'trash-bin', name: 'Trash Bin', icon: Trash2, route: '/admin/trash-bin', category: 'Core', keywords: 'trash bin deleted items recycle restore' },
  { id: 'staff-activity', name: 'Staff Activity', icon: Activity, route: '/admin/staff-activity', category: 'Core', keywords: 'staff activity log team actions history' },
  { id: 'timezone-settings', name: 'Time Zone Settings', icon: Clock, route: '/admin/timezone-settings', category: 'Core', keywords: 'timezone time zone UTC offset DST settings display mode world clock' },
  { id: 'backend-audit', name: 'Backend Audit', icon: Server, route: '/backend-audit', category: 'Core', keywords: 'backend server audit health api status' },
  { id: 'system-health', name: 'System Health', icon: Activity, route: '/system-health', category: 'Core', keywords: 'system health uptime performance monitor' },

  { id: 'members', name: 'Members', icon: Users, route: '/admin/members', category: 'Users', keywords: 'members investors users profiles' },
  { id: 'team', name: 'Team Management', icon: UserPlus, route: '/admin/team', category: 'Users', keywords: 'team staff management roles' },
  { id: 'applications', name: 'Applications', icon: ClipboardList, route: '/admin/applications', category: 'Users', keywords: 'applications apply broker agent influencer' },

  { id: 'transactions', name: 'Transactions', icon: ArrowLeftRight, route: '/admin/transactions', category: 'Finance', keywords: 'transactions payments deposits withdrawals' },
  { id: 'investor-profits', name: 'Investor Profits', icon: DollarSign, route: '/admin/investor-profits', category: 'Finance', keywords: 'investor profits dividends returns roi' },
  { id: 'fees', name: 'Fees & Pricing', icon: Percent, route: '/admin/fees', category: 'Finance', keywords: 'fees pricing commissions rates' },

  { id: 'properties', name: 'Properties', icon: Building2, route: '/admin/properties', category: 'Deals & Assets', keywords: 'properties real estate buildings' },
  { id: 'jv-deals', name: 'JV Deals', icon: Handshake, route: '/admin/jv-deals', category: 'Deals & Assets', keywords: 'jv deals joint venture publish' },
  { id: 'land-partners', name: 'Land Partners', icon: MapPin, route: '/admin/land-partners', category: 'Deals & Assets', keywords: 'land partners lots parcels' },
  { id: 'title-companies', name: 'Title Companies', icon: Landmark, route: '/admin/title-companies', category: 'Deals & Assets', keywords: 'title companies escrow closing' },
  { id: 'lender-directory', name: 'Lender Directory', icon: Building2, route: '/admin/lender-directory', category: 'Deals & Assets', keywords: 'lender directory banks financing loans' },
  { id: 'lender-network', name: 'Private Lender Network', icon: Landmark, route: '/admin/lender-network', category: 'Deals & Assets', keywords: 'private lender network hard money bridge construction commercial scan dashboard fit score compliance' },
  { id: 'lender-search', name: 'Lender Search', icon: SearchCheck, route: '/admin/lender-search', category: 'Deals & Assets', keywords: 'lender search find financing match' },
  { id: 'lender-sync', name: 'Lender Sync', icon: RefreshCw, route: '/admin/lender-sync', category: 'Deals & Assets', keywords: 'lender sync update rates' },
  { id: 'developer-handoff', name: 'Developer Handoff', icon: Code, route: '/admin/developer-handoff', category: 'Deals & Assets', keywords: 'developer handoff technical specs architecture' },

  { id: 'growth', name: 'Growth Analytics', icon: BarChart3, route: '/admin/growth', category: 'Analytics', keywords: 'growth analytics metrics kpi' },
  { id: 'analytics-report', name: 'Analytics Report', icon: PieChart, route: '/analytics-report', category: 'Analytics', keywords: 'analytics report google real time dashboard live visitors' },
  { id: 'landing-analytics', name: 'Landing Analytics', icon: Globe, route: '/admin/landing-analytics', category: 'Analytics', keywords: 'landing page analytics visitors traffic website' },
  { id: 'landing-control', name: 'Landing Control', icon: Sliders, route: '/admin/landing-control', category: 'Core', keywords: 'landing page control sections modules visibility public live deploy content admin toggle screens' },
  { id: 'deploy-waitlist', name: 'Deploy Waitlist', icon: Rocket, route: '/admin/deploy-waitlist', category: 'Core', keywords: 'deploy waitlist table supabase investor landing page form submissions database create' },
  { id: 'feature-control', name: 'Feature Control', icon: Zap, route: '/admin/feature-control', category: 'Core', keywords: 'feature control toggle on off live modules functionality enable disable admin master switch real time' },
  { id: 'outreach-analytics', name: 'Outreach Analytics', icon: FileBarChart, route: '/admin/outreach-analytics', category: 'Analytics', keywords: 'outreach analytics campaigns performance' },
  { id: 'engagement', name: 'Engagement', icon: Target, route: '/admin/engagement', category: 'Analytics', keywords: 'engagement retention users active' },
  { id: 'visitor-intelligence', name: 'Visitor Intelligence', icon: Eye, route: '/admin/visitor-intelligence', category: 'Analytics', keywords: 'visitor intelligence tracking behavior heatmap' },
  { id: 'app-report', name: 'App Report', icon: FileBarChart, route: '/app-report', category: 'Analytics', keywords: 'app report performance usage stats' },

  { id: 'marketing', name: 'Marketing', icon: Megaphone, route: '/admin/marketing', category: 'Marketing', keywords: 'marketing campaigns ads promotion' },
  { id: 'broadcast', name: 'Broadcast', icon: Radio, route: '/admin/broadcast', category: 'Marketing', keywords: 'broadcast push notifications mass message' },
  { id: 'banners', name: 'Banners', icon: Image, route: '/admin/banners', category: 'Marketing', keywords: 'banners hero images promotional' },
  { id: 'social-command', name: 'Social Command', icon: Share2, route: '/admin/social-command', category: 'Marketing', keywords: 'social media command center instagram facebook twitter' },
  { id: 'viral-growth', name: 'Viral Growth', icon: Rocket, route: '/admin/viral-growth', category: 'Marketing', keywords: 'viral growth referrals sharing organic' },
  { id: 'influencers', name: 'Influencers', icon: UserCheck, route: '/admin/influencers', category: 'Marketing', keywords: 'influencers ambassadors partners creators' },
  { id: 'retargeting', name: 'Retargeting', icon: Target, route: '/admin/retargeting', category: 'Marketing', keywords: 'retargeting ads remarketing audience' },
  { id: 'traffic-control', name: 'Traffic Control', icon: Globe, route: '/admin/traffic-control', category: 'Marketing', keywords: 'traffic control sources utm campaigns' },
  { id: 'sms-reports', name: 'SMS Reports', icon: MessageSquare, route: '/sms-reports', category: 'Marketing', keywords: 'sms reports text message campaigns delivery' },
  { id: 'share-content', name: 'Share Content', icon: Send, route: '/share-content', category: 'Marketing', keywords: 'share content social media post distribute' },

  { id: 'ai-outreach', name: 'AI Outreach', icon: Bot, route: '/admin/ai-outreach', category: 'AI & Intelligence', keywords: 'ai outreach automated email drip campaigns' },
  { id: 'ai-video', name: 'AI Video', icon: Video, route: '/admin/ai-video', category: 'AI & Intelligence', keywords: 'ai video generation content creation' },
  { id: 'ai-automation-report', name: 'AI Automation Report', icon: Bot, route: '/ai-automation-report', category: 'AI & Intelligence', keywords: 'ai automation report status tasks agents' },
  { id: 'ai-gallery', name: 'AI Gallery', icon: Image, route: '/ai-gallery', category: 'AI & Intelligence', keywords: 'ai gallery generated images assets creative' },
  { id: 'lead-intelligence', name: 'Lead Intelligence', icon: Brain, route: '/admin/lead-intelligence', category: 'AI & Intelligence', keywords: 'lead intelligence scoring qualification prospects' },
  { id: 'intent-engine', name: 'Intent Capture Engine', icon: Search, route: '/admin/intent-engine', category: 'AI & Intelligence', keywords: 'intent capture engine seo keywords landing pages global search acquisition content multilingual visitor conversion optimization' },

  { id: 'global-intelligence', name: 'Global Intelligence', icon: Globe, route: '/global-intelligence', category: 'AI & Intelligence', keywords: 'global intelligence market world data trends' },

  { id: 'email-management', name: 'Email Management', icon: Mail, route: '/admin/email-management', category: 'Email', keywords: 'email management templates campaigns' },
  { id: 'email-engine', name: 'Email Engine', icon: Settings, route: '/admin/email-engine', category: 'Email', keywords: 'email engine smtp delivery configuration' },
  { id: 'email-accounts', name: 'Email Accounts', icon: Inbox, route: '/admin/email-accounts', category: 'Email', keywords: 'email accounts inboxes connected' },
  { id: 'email-inbox', name: 'Email Inbox', icon: Mail, route: '/admin/email-inbox', category: 'Email', keywords: 'email inbox messages received sent' },

  { id: 'api-keys', name: 'API Keys Vault', icon: KeyRound, route: '/admin/api-keys', category: 'Settings', keywords: 'api keys vault secrets tokens' },
  { id: 'registration-audit', name: 'Registration Audit', icon: UserCheck, route: '/admin/registration-audit', category: 'Users', keywords: 'registration audit test signup login ip device analyze module flow' },
  { id: 'authenticator', name: 'Authenticator', icon: ShieldCheck, route: '/authenticator', category: 'Settings', keywords: 'authenticator 2fa totp security codes' },
  { id: 'app-docs', name: 'Docs & Legal', icon: FileText, route: '/admin/app-docs', category: 'Settings', keywords: 'docs legal documents contracts' },
];

type AuditTone = 'good' | 'warn' | 'bad';

interface AdminAuditRow {
  id: string;
  label: string;
  value: string;
  tone: AuditTone;
}

const CATEGORY_COLORS: Record<string, string> = {
  'Core': '#FFD700',
  'Users': '#4ECDC4',
  'Finance': '#00C48C',
  'Deals & Assets': '#4A90D9',
  'Analytics': '#FF6B9D',
  'Marketing': '#FF9F43',
  'AI & Intelligence': '#A78BFA',
  'Email': '#38BDF8',
  'Settings': '#9A9A9A',
};

console.log('[Admin] v6 ADMIN_MODULES loaded:', ADMIN_MODULES.length, 'modules');

export default function AdminDashboard() {
  const router = useRouter();
  const auth = useAuth();
  const isScreenFocused = useScreenFocusState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const queryClient = useQueryClient();

  const dashboardQuery = useQuery<any>({
    queryKey: ['analytics.getDashboard'],
    queryFn: async () => {
      try {
        console.log('[Supabase] Fetching admin dashboard');
        const { data, error } = await supabase.from('analytics_dashboard').select('*').limit(50);
        if (error) { console.log('[Supabase] analytics_dashboard error (suppressed):', error.message); return null; }
        return data;
      } catch (err: any) {
        console.log('[Supabase] analytics_dashboard fetch error (suppressed):', err?.message);
        return null;
      }
    },
    staleTime: ADMIN_OVERVIEW_REFRESH_MS,
    refetchInterval: isScreenFocused ? ADMIN_OVERVIEW_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (prev: any) => prev,
    retry: 0,
    throwOnError: false,
  });

  const transactionsQuery = useQuery<any>({
    queryKey: ['transactions.list', { page: 1, limit: 5 }],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('transactions').select('*').order('created_at', { ascending: false }).limit(5);
        if (error) { console.log('[Supabase] transactions error (suppressed):', error.code); return null; }
        return { transactions: data ?? [] };
      } catch {
        return null;
      }
    },
    staleTime: 1000 * 30,
    placeholderData: (prev: any) => prev,
    retry: 0,
    throwOnError: false,
  });

  const memberAuditQuery = useQuery<AdminMemberRegistrySnapshot>({
    queryKey: ['admin-member-registry-snapshot'],
    queryFn: () => getAdminMemberRegistrySnapshot(),
    staleTime: ADMIN_AUDIT_REFRESH_MS,
    refetchInterval: isScreenFocused ? ADMIN_AUDIT_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const deployAccessQuery = useQuery({
    queryKey: ['admin-deploy-access-diagnostic'],
    queryFn: getDeployAccessDiagnostic,
    staleTime: ADMIN_AUDIT_REFRESH_MS,
    refetchInterval: isScreenFocused ? ADMIN_AUDIT_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const autoDeployStatusQuery = useQuery({
    queryKey: ['admin-auto-deploy-status'],
    queryFn: getAutoDeployStatus,
    staleTime: ADMIN_AUDIT_REFRESH_MS,
    refetchInterval: isScreenFocused ? ADMIN_AUDIT_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const pendingKycQuery = useQuery<any>({
    queryKey: ['members.list', { kycStatus: 'pending', limit: 10 }],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('profiles').select('*').limit(10);
        if (error) { console.log('[Supabase] profiles error (suppressed):', error.code); return null; }
        return { members: data ?? [] };
      } catch {
        return null;
      }
    },
    staleTime: 1000 * 60,
    placeholderData: (prev: any) => prev,
    retry: 0,
    throwOnError: false,
  });

  const inReviewKycQuery = useQuery<any>({
    queryKey: ['members.list', { kycStatus: 'in_review', limit: 10 }],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('profiles').select('*').limit(10);
        if (error) { console.log('[Supabase] profiles error (suppressed):', error.code); return null; }
        return { members: data ?? [] };
      } catch {
        return null;
      }
    },
    staleTime: 1000 * 60,
    placeholderData: (prev: any) => prev,
    retry: 0,
    throwOnError: false,
  });

  const stats = dashboardQuery.data;
  const recentTransactions = transactionsQuery.data?.transactions ?? [];
  const pendingKycMembers = [
    ...(pendingKycQuery.data?.members ?? []),
    ...(inReviewKycQuery.data?.members ?? []),
  ];

  const refreshing = dashboardQuery.isRefetching || transactionsQuery.isRefetching || memberAuditQuery.isRefetching || deployAccessQuery.isRefetching || autoDeployStatusQuery.isRefetching;

  const onRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['analytics.getDashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['transactions.list'] });
    void queryClient.invalidateQueries({ queryKey: ['members.list'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-member-registry-snapshot'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-deploy-access-diagnostic'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-auto-deploy-status'] });
  }, [queryClient]);

  const filteredModules = useMemo(() => {
    if (!searchQuery.trim()) return ADMIN_MODULES;
    const query = searchQuery.toLowerCase();
    return ADMIN_MODULES.filter(
      (m) =>
        m.name.toLowerCase().includes(query) ||
        m.category.toLowerCase().includes(query) ||
        m.id.toLowerCase().includes(query) ||
        m.keywords.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  const groupedModules = useMemo(() => {
    const groups: Record<string, typeof ADMIN_MODULES> = {};
    filteredModules.forEach((m) => {
      if (!groups[m.category]) groups[m.category] = [];
      groups[m.category]!.push(m);
    });
    return groups;
  }, [filteredModules]);

  const allGrouped = useMemo(() => {
    const groups: Record<string, typeof ADMIN_MODULES> = {};
    ADMIN_MODULES.forEach((m) => {
      if (!groups[m.category]) groups[m.category] = [];
      groups[m.category]!.push(m);
    });
    return groups;
  }, []);

  const formatCurrency = useCallback((amount: number) => _fmtCurr(amount), []);

  const getAuditToneColor = useCallback((tone: AuditTone) => {
    switch (tone) {
      case 'good':
        return Colors.positive;
      case 'warn':
        return Colors.warning;
      case 'bad':
      default:
        return Colors.negative;
    }
  }, []);

  const memberAuditRows = useMemo<AdminAuditRow[]>(() => {
    const snapshot = memberAuditQuery.data;
    return [
      {
        id: 'member-merged',
        label: 'Durable member registry',
        value: snapshot ? String(snapshot.mergedCount) : '... ',
        tone: snapshot && snapshot.mergedCount > 0 ? 'good' : 'warn',
      },
      {
        id: 'member-remote',
        label: 'Remote profiles',
        value: snapshot ? String(snapshot.remoteProfileCount) : '... ',
        tone: snapshot && snapshot.remoteProfileCount > 0 ? 'good' : 'warn',
      },
      {
        id: 'member-shadow',
        label: 'Waitlist shadows',
        value: snapshot ? String(snapshot.remoteWaitlistShadowCount) : '... ',
        tone: snapshot && snapshot.remoteWaitlistShadowCount > 0 ? 'good' : 'warn',
      },
      {
        id: 'member-local-only',
        label: 'Local-only recovery',
        value: snapshot ? String(snapshot.staleLocalOnlyCount) : '... ',
        tone: snapshot && snapshot.staleLocalOnlyCount === 0 ? 'good' : 'warn',
      },
    ];
  }, [memberAuditQuery.data]);

  const ownerAuditRows = useMemo<AdminAuditRow[]>(() => {
    const deployAccess = deployAccessQuery.data;
    const trustedOwnerEnabled = auth.isOwnerIPAccess || !!auth.detectedIP;
    return [
      {
        id: 'owner-auth',
        label: 'Authenticated session',
        value: auth.isAuthenticated ? 'Live' : 'Missing',
        tone: auth.isAuthenticated ? 'good' : 'bad',
      },
      {
        id: 'owner-role',
        label: 'Resolved role',
        value: deployAccess?.role ?? auth.userRole ?? 'unknown',
        tone: (deployAccess?.role ?? auth.userRole) && (deployAccess?.role ?? auth.userRole) !== 'investor' ? 'good' : 'warn',
      },
      {
        id: 'owner-trusted',
        label: 'Trusted owner path',
        value: auth.isOwnerIPAccess ? 'Restored on verified network' : trustedOwnerEnabled ? 'Configured, normal session active' : 'Not active',
        tone: auth.isOwnerIPAccess ? 'good' : trustedOwnerEnabled ? 'warn' : 'warn',
      },
      {
        id: 'owner-ip',
        label: 'Detected IP',
        value: auth.detectedIP ?? 'Unavailable',
        tone: auth.detectedIP ? 'good' : 'warn',
      },
    ];
  }, [auth.detectedIP, auth.isAuthenticated, auth.isOwnerIPAccess, auth.userRole, deployAccessQuery.data]);

  const pipelineAuditRows = useMemo<AdminAuditRow[]>(() => {
    const deployAccess = deployAccessQuery.data;
    const autoDeploy = autoDeployStatusQuery.data;
    return [
      {
        id: 'deploy-access',
        label: 'Deploy write access',
        value: deployAccess?.allowed ? 'Verified' : 'Blocked',
        tone: deployAccess?.allowed ? 'good' : 'bad',
      },
      {
        id: 'deploy-token',
        label: 'Fresh auth token',
        value: deployAccess?.tokenAvailable ? 'Ready' : 'Missing',
        tone: deployAccess?.tokenAvailable ? 'good' : 'bad',
      },
      {
        id: 'auto-deploy',
        label: 'Auto-deploy',
        value: autoDeploy?.config.enabled ? 'Enabled' : 'Disabled',
        tone: autoDeploy?.config.enabled ? 'good' : 'warn',
      },
      {
        id: 'publish-trigger',
        label: 'Publish trigger',
        value: autoDeploy?.config.deployOnDealPublish ? 'On' : 'Off',
        tone: autoDeploy?.config.deployOnDealPublish ? 'good' : 'warn',
      },
    ];
  }, [autoDeployStatusQuery.data, deployAccessQuery.data]);

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, []);

  const getTransactionIcon = useCallback((type: string) => {
    switch (type) {
      case 'deposit':
        return <ArrowDownRight size={16} color={Colors.positive} />;
      case 'withdrawal':
        return <ArrowUpRight size={16} color={Colors.negative} />;
      case 'buy':
        return <ArrowDownRight size={16} color={Colors.primary} />;
      case 'sell':
        return <ArrowUpRight size={16} color={Colors.accent} />;
      default:
        return <DollarSign size={16} color={Colors.textSecondary} />;
    }
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerDot} />
          <Text style={styles.title}>Admin HQ</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.searchBtn}
            onPress={() => setShowSearch(true)}
            testID="admin-search-btn"
          >
            <Search size={18} color={Colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.exitBtn}
            onPress={() => router.replace('/')}
          >
            <Text style={styles.exitBtnText}>Exit</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={showSearch}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowSearch(false)}
      >
        <SafeAreaView style={styles.searchModal}>
          <View style={styles.searchHeader}>
            <View style={styles.searchInputWrap}>
              <Search size={18} color={Colors.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search modules..."
                placeholderTextColor={Colors.textTertiary}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <X size={16} color={Colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              style={styles.searchCancel}
              onPress={() => { setShowSearch(false); setSearchQuery(''); }}
            >
              <Text style={styles.searchCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.searchResults} showsVerticalScrollIndicator={false}>
            {Object.entries(groupedModules).map(([category, modules]) => (
              <View key={category} style={styles.searchCategory}>
                <View style={styles.searchCategoryRow}>
                  <View style={[styles.searchCategoryDot, { backgroundColor: CATEGORY_COLORS[category] ?? Colors.primary }]} />
                  <Text style={styles.searchCategoryTitle}>{category}</Text>
                </View>
                {modules.map((mod) => {
                  const Icon = mod.icon;
                  return (
                    <TouchableOpacity
                      key={mod.id}
                      style={styles.searchItem}
                      onPress={() => {
                        setShowSearch(false);
                        setSearchQuery('');
                        router.push(mod.route as any);
                      }}
                    >
                      <View style={[styles.searchItemIcon, { backgroundColor: (CATEGORY_COLORS[mod.category] ?? Colors.primary) + '18' }]}>
                        <Icon size={18} color={CATEGORY_COLORS[mod.category] ?? Colors.primary} />
                      </View>
                      <Text style={styles.searchItemName}>{mod.name}</Text>
                      <ChevronRight size={16} color={Colors.textTertiary} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
            {filteredModules.length === 0 && searchQuery.length > 0 && (
              <View style={styles.noResults}>
                <Search size={40} color={Colors.textTertiary} />
                <Text style={styles.noResultsTitle}>No modules found</Text>
                <Text style={styles.noResultsSub}>Try a different search term</Text>
              </View>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        <TouchableOpacity
          style={styles.systemCard}
          onPress={() => router.push('/admin/system-map' as any)}
          activeOpacity={0.8}
          testID="admin-system-blueprint-btn"
        >
          <View style={styles.systemCardInner}>
            <View style={styles.systemCardIcon}>
              <Network size={24} color="#062218" />
            </View>
            <View style={styles.systemCardText}>
              <View style={styles.systemCardLiveRow}>
                <View style={styles.systemCardLiveDot} />
                <Text style={styles.systemCardLiveLabel}>SYSTEM LIVE</Text>
              </View>
              <Text style={styles.systemCardTitle}>System Blueprint</Text>
              <Text style={styles.systemCardSub}>Live architecture · Data flows · Health</Text>
            </View>
          </View>
          <ChevronRight size={20} color="#00E676" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.activationCard}
          onPress={() => router.push('/activation-center' as any)}
          activeOpacity={0.8}
        >
          <View style={styles.activationCardInner}>
            <View style={styles.activationCardIcon}>
              <Zap size={20} color={Colors.primary} />
            </View>
            <View style={styles.activationCardText}>
              <View style={styles.activationCardLiveRow}>
                <View style={styles.activationCardLiveDot} />
                <Text style={styles.activationCardLiveLabel}>ALL SYSTEMS LIVE</Text>
              </View>
              <Text style={styles.activationCardTitle}>Activation Center</Text>
              <Text style={styles.activationCardSub}>AI working 24/7 · 9 channels active</Text>
            </View>
          </View>
          <ChevronRight size={18} color={Colors.textSecondary} />
        </TouchableOpacity>

        <View style={styles.auditPanel} testID="admin-live-audit-panel">
          <View style={styles.auditPanelHeader}>
            <View>
              <Text style={styles.auditPanelEyebrow}>LIVE ADMIN AUDIT</Text>
              <Text style={styles.auditPanelTitle}>Owner, member, backend, and deploy status</Text>
              <Text style={styles.auditPanelSub}>One panel to verify session trust, durable member retention, and write-path readiness.</Text>
            </View>
            <TouchableOpacity style={styles.auditPanelAction} onPress={() => router.push('/admin/sync-diagnostics' as any)} testID="admin-live-audit-open-sync-btn">
              <Text style={styles.auditPanelActionText}>Open</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.auditGrid}>
            <View style={styles.auditSectionCard}>
              <View style={styles.auditSectionHeaderRow}>
                <Crown size={16} color={Colors.primary} />
                <Text style={styles.auditSectionTitle}>Owner recognition</Text>
              </View>
              {ownerAuditRows.map((item) => (
                <View key={item.id} style={styles.auditRow}>
                  <Text style={styles.auditRowLabel}>{item.label}</Text>
                  <Text style={[styles.auditRowValue, { color: getAuditToneColor(item.tone) }]}>{item.value}</Text>
                </View>
              ))}
            </View>

            <View style={styles.auditSectionCard}>
              <View style={styles.auditSectionHeaderRow}>
                <Users size={16} color={Colors.info} />
                <Text style={styles.auditSectionTitle}>Member durability</Text>
              </View>
              {memberAuditRows.map((item) => (
                <View key={item.id} style={styles.auditRow}>
                  <Text style={styles.auditRowLabel}>{item.label}</Text>
                  <Text style={[styles.auditRowValue, { color: getAuditToneColor(item.tone) }]}>{item.value}</Text>
                </View>
              ))}
            </View>

            <View style={styles.auditSectionCard}>
              <View style={styles.auditSectionHeaderRow}>
                <Server size={16} color={Colors.warning} />
                <Text style={styles.auditSectionTitle}>Backend + deploy</Text>
              </View>
              {pipelineAuditRows.map((item) => (
                <View key={item.id} style={styles.auditRow}>
                  <Text style={styles.auditRowLabel}>{item.label}</Text>
                  <Text style={[styles.auditRowValue, { color: getAuditToneColor(item.tone) }]}>{item.value}</Text>
                </View>
              ))}
              {deployAccessQuery.data?.reason ? (
                <Text style={styles.auditHintText}>{deployAccessQuery.data.reason}</Text>
              ) : null}
            </View>
          </View>

          <View style={styles.auditQuickActions}>
            <TouchableOpacity style={styles.auditQuickBtn} onPress={() => router.push('/owner-access' as any)} testID="admin-live-audit-owner-access-btn">
              <ShieldCheck size={16} color={Colors.text} />
              <Text style={styles.auditQuickBtnText}>Owner Access</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.auditQuickBtn} onPress={() => router.push('/admin/owner-controls' as any)} testID="admin-live-audit-owner-btn">
              <Crown size={16} color={Colors.text} />
              <Text style={styles.auditQuickBtnText}>Owner Controls</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.auditQuickBtn} onPress={() => router.push('/admin/members' as any)} testID="admin-live-audit-members-btn">
              <Users size={16} color={Colors.text} />
              <Text style={styles.auditQuickBtnText}>Members</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.auditQuickBtn} onPress={() => router.push('/admin/registration-audit' as any)} testID="admin-live-audit-registration-btn">
              <UserCheck size={16} color={Colors.text} />
              <Text style={styles.auditQuickBtnText}>Registration Audit</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={styles.regAuditCard}
          onPress={() => router.push('/admin/registration-audit' as any)}
          activeOpacity={0.8}
          testID="admin-registration-audit-btn"
        >
          <View style={styles.regAuditCardInner}>
            <View style={styles.regAuditCardIcon}>
              <UserCheck size={22} color="#000" />
            </View>
            <View style={styles.regAuditCardText}>
              <Text style={styles.regAuditCardLabel}>REGISTRATION MODULE</Text>
              <Text style={styles.regAuditCardTitle}>Registration Audit</Text>
              <Text style={styles.regAuditCardSub}>Test signup · Analyze flow · View users</Text>
            </View>
          </View>
          <ChevronRight size={18} color={Colors.primary} />
        </TouchableOpacity>

        <View style={styles.teamSection}>
          <View style={styles.teamHeader}>
            <Users size={15} color={Colors.primary} />
            <Text style={styles.teamHeaderTitle}>Team</Text>
            <View style={styles.teamOnlineBadge}>
              <View style={styles.teamOnlineDot} />
              <Text style={styles.teamOnlineText}>ONLINE</Text>
            </View>
          </View>
          <View style={styles.teamList}>
            {adminTeamMembers.map((member) => (
              <View key={member.id} style={styles.teamCard}>
                <View style={[styles.teamAvatar, { backgroundColor: member.avatarColor }]}>
                  <Text style={styles.teamAvatarText}>{member.avatarInitials}</Text>
                  <View style={[styles.teamStatusDot, member.status === 'active' ? styles.teamStatusActive : styles.teamStatusAway]} />
                </View>
                <Text style={styles.teamName} numberOfLines={1}>{member.name}</Text>
                <View style={[styles.teamRoleBadge, { backgroundColor: member.avatarColor + '20' }]}>
                  <Text style={[styles.teamRoleText, { color: member.avatarColor }]} numberOfLines={1}>{member.role}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.statsGrid}>
          <TouchableOpacity style={styles.statCard} onPress={() => router.push('/admin/members' as any)}>
            <View style={[styles.statIcon, { backgroundColor: Colors.primary + '20' }]}>
              <Users size={20} color={Colors.primary} />
            </View>
            <Text style={styles.statValue}>{memberAuditQuery.data?.mergedCount ?? stats?.totalMembers ?? 0}</Text>
            <Text style={styles.statLabel}>Members</Text>
            <Text style={styles.statSub}>{memberAuditQuery.data?.remoteCount ?? stats?.activeMembers ?? 0} live registry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.statCard} onPress={() => router.push('/admin/transactions' as any)}>
            <View style={[styles.statIcon, { backgroundColor: Colors.accent + '20' }]}>
              <ArrowLeftRight size={20} color={Colors.accent} />
            </View>
            <Text style={styles.statValue}>{stats?.totalTransactions ?? 0}</Text>
            <Text style={styles.statLabel}>Transactions</Text>
            <Text style={styles.statSub}>{formatCurrency(stats?.totalVolume ?? 0)} vol</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.statCard} onPress={() => router.push('/admin/properties' as any)}>
            <View style={[styles.statIcon, { backgroundColor: Colors.positive + '20' }]}>
              <Building2 size={20} color={Colors.positive} />
            </View>
            <Text style={styles.statValue}>{stats?.totalProperties ?? 0}</Text>
            <Text style={styles.statLabel}>Properties</Text>
            <Text style={styles.statSub}>{stats?.liveProperties ?? 0} live</Text>
          </TouchableOpacity>
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: Colors.warning + '20' }]}>
              <TrendingUp size={20} color={Colors.warning} />
            </View>
            <Text style={styles.statValue}>{formatCurrency(stats?.totalInvested ?? 0)}</Text>
            <Text style={styles.statLabel}>Invested</Text>
            <Text style={styles.statSub}>{stats?.trends?.userGrowthRate ?? 0}% growth</Text>
          </View>
        </View>

        {stats && (
          <View style={styles.metricsRow}>
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{formatCurrency(stats.totalDeposits)}</Text>
              <Text style={styles.metricLabel}>Deposits</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{formatCurrency(stats.totalWithdrawals)}</Text>
              <Text style={styles.metricLabel}>Withdrawals</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{stats.pendingTransactions}</Text>
              <Text style={styles.metricLabel}>Pending</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{stats.openSupportTickets}</Text>
              <Text style={styles.metricLabel}>Tickets</Text>
            </View>
          </View>
        )}

        {pendingKycMembers.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Shield size={16} color={Colors.warning} />
                <Text style={styles.sectionTitle}>Pending KYC ({pendingKycMembers.length})</Text>
              </View>
              <TouchableOpacity onPress={() => router.push('/admin/members' as any)}>
                <Text style={styles.seeAll}>See All</Text>
              </TouchableOpacity>
            </View>
            {pendingKycMembers.map((member: any) => (
              <TouchableOpacity
                key={member.id}
                style={styles.kycCard}
                onPress={() => router.push(`/admin/member/${member.id}` as any)}
              >
                <View style={styles.kycInfo}>
                  <Text style={styles.kycName}>{member.firstName} {member.lastName}</Text>
                  <Text style={styles.kycEmail}>{member.email}</Text>
                </View>
                <View style={styles.kycRight}>
                  <View style={[styles.kycBadge, member.kycStatus === 'in_review' ? styles.kycInReview : styles.kycPending]}>
                    <Text style={styles.kycBadgeText}>
                      {member.kycStatus === 'in_review' ? 'In Review' : 'Pending'}
                    </Text>
                  </View>
                  <ChevronRight size={16} color={Colors.textSecondary} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Clock size={16} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Recent Transactions</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/admin/transactions' as any)}>
              <Text style={styles.seeAll}>See All</Text>
            </TouchableOpacity>
          </View>
          {recentTransactions.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No transactions yet</Text>
            </View>
          )}
          {recentTransactions.map((tx: any) => (
            <View key={tx.id} style={styles.txCard}>
              <View style={styles.txIconWrap}>{getTransactionIcon(tx.type)}</View>
              <View style={styles.txInfo}>
                <Text style={styles.txUser}>{tx.userId}</Text>
                <Text style={styles.txDesc}>{tx.description || tx.type}</Text>
                <Text style={styles.txDate}>{formatDate(tx.createdAt)}</Text>
              </View>
              <View style={styles.txAmountWrap}>
                <Text style={[styles.txAmount, tx.amount > 0 ? styles.positive : styles.negative]}>
                  {tx.amount > 0 ? '+' : ''}{formatCurrency(Math.abs(tx.amount))}
                </Text>
                <View style={[styles.txStatusBadge, tx.status === 'completed' ? styles.txCompleted : tx.status === 'pending' ? styles.txPendingBadge : styles.txFailed]}>
                  <Text style={styles.txStatusText}>{tx.status}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.modulesSection}>
          <Text style={styles.modulesSectionTitle}>All Modules</Text>
          {Object.entries(allGrouped).map(([category, mods]) => {
            const catColor = CATEGORY_COLORS[category] ?? Colors.primary;
            return (
              <View key={category} style={styles.categoryBlock}>
                <View style={styles.categoryLabelRow}>
                  <View style={[styles.categoryDot, { backgroundColor: catColor }]} />
                  <Text style={[styles.categoryLabel, { color: catColor }]}>{category}</Text>
                </View>
                <View style={styles.moduleGrid}>
                  {mods.map((mod) => {
                    const Icon = mod.icon;
                    return (
                      <TouchableOpacity
                        key={mod.id}
                        style={styles.modCard}
                        onPress={() => router.push(mod.route as any)}
                        testID={`admin-module-${mod.id}`}
                      >
                        <View style={[styles.modIconWrap, { backgroundColor: catColor + '15' }]}>
                          <Icon size={20} color={catColor} />
                        </View>
                        <Text style={styles.modName} numberOfLines={2}>{mod.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.positive,
  },
  title: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchBtn: {
    backgroundColor: Colors.primary + '15',
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  exitBtn: {
    backgroundColor: Colors.negative + '18',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  exitBtnText: {
    color: Colors.negative,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  searchModal: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
  },
  searchCancel: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  searchCancelText: {
    fontSize: 15,
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  searchResults: {
    flex: 1,
    paddingHorizontal: 16,
  },
  searchCategory: {
    marginTop: 20,
  },
  searchCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  searchCategoryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  searchCategoryTitle: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  searchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  searchItemName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  noResults: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  noResultsTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 14,
  },
  noResultsSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  content: {
    flex: 1,
  },
  systemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 14,
    marginTop: 14,
    marginBottom: 8,
    backgroundColor: '#062218',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#00E676',
  },
  systemCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  systemCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 13,
    backgroundColor: '#00E676',
    justifyContent: 'center',
    alignItems: 'center',
  },
  systemCardText: {
    flex: 1,
  },
  systemCardLiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  systemCardLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00E676',
  },
  systemCardLiveLabel: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: '#00E676',
    letterSpacing: 0.5,
  },
  systemCardTitle: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: '#FFFFFF',
  },
  systemCardSub: {
    fontSize: 11,
    color: '#8B9CB6',
    marginTop: 2,
  },
  activationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 14,
    marginBottom: 10,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  activationCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  activationCardIcon: {
    width: 42,
    height: 42,
    borderRadius: 11,
    backgroundColor: Colors.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activationCardText: {
    flex: 1,
  },
  activationCardLiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  activationCardLiveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.positive,
  },
  activationCardLiveLabel: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.positive,
    letterSpacing: 0.5,
  },
  activationCardTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  activationCardSub: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  teamSection: {
    marginHorizontal: 14,
    marginBottom: 8,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
  },
  teamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  teamHeaderTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    flex: 1,
  },
  teamOnlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.positive + '15',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  teamOnlineDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.positive,
  },
  teamOnlineText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.positive,
    letterSpacing: 0.3,
  },
  teamList: {
    flexDirection: 'row',
    gap: 10,
  },
  teamCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 12,
  },
  teamAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  teamAvatarText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#000',
  },
  teamStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    position: 'absolute',
    bottom: 0,
    right: 0,
    borderWidth: 2,
    borderColor: Colors.background,
  },
  teamStatusActive: {
    backgroundColor: Colors.positive,
  },
  teamStatusAway: {
    backgroundColor: Colors.warning,
  },
  teamName: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  teamRoleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  teamRoleText: {
    fontSize: 9,
    fontWeight: '600' as const,
    textAlign: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 14,
    paddingVertical: 4,
    gap: 10,
  },
  statCard: {
    width: '47%' as any,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  statValue: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  statSub: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 3,
  },
  metricsRow: {
    flexDirection: 'row',
    marginHorizontal: 14,
    marginTop: 6,
    marginBottom: 8,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  metricValue: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  metricLabel: {
    fontSize: 10,
    color: Colors.textTertiary,
  },
  metricDivider: {
    width: 1,
    backgroundColor: Colors.border,
  },
  section: {
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  seeAll: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  kycCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  kycInfo: {
    flex: 1,
  },
  kycName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  kycEmail: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  kycRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  kycBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  kycPending: {
    backgroundColor: Colors.warning + '20',
  },
  kycInReview: {
    backgroundColor: Colors.primary + '20',
  },
  kycBadgeText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  txCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  txIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  txInfo: {
    flex: 1,
  },
  txUser: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  txDesc: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  txDate: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 3,
  },
  txAmountWrap: {
    alignItems: 'flex-end',
  },
  txAmount: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  positive: {
    color: Colors.positive,
  },
  negative: {
    color: Colors.negative,
  },
  txStatusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 3,
  },
  txCompleted: {
    backgroundColor: Colors.positive + '20',
  },
  txPendingBadge: {
    backgroundColor: Colors.warning + '20',
  },
  txFailed: {
    backgroundColor: Colors.negative + '20',
  },
  txStatusText: {
    fontSize: 9,
    fontWeight: '600' as const,
    color: Colors.text,
    textTransform: 'capitalize',
  },
  emptyState: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: Colors.textTertiary,
  },
  modulesSection: {
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  modulesSectionTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text,
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  categoryBlock: {
    marginBottom: 20,
  },
  categoryLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  categoryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  categoryLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  moduleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modCard: {
    flex: 1,
    minWidth: '29%' as any,
    maxWidth: '32%' as any,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  modIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modName: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.text,
    textAlign: 'center',
    lineHeight: 13,
  },
  bottomPad: {
    height: 120,
  },
  auditPanel: {
    marginHorizontal: 14,
    marginBottom: 10,
    backgroundColor: '#09111F',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.28)',
    gap: 14,
  },
  auditPanelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  auditPanelEyebrow: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: '#7DD3FC',
    letterSpacing: 1,
    marginBottom: 4,
  },
  auditPanelTitle: {
    fontSize: 17,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  auditPanelSub: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    color: '#9FB0C8',
    maxWidth: 260,
  },
  auditPanelAction: {
    backgroundColor: 'rgba(125,211,252,0.14)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.22)',
  },
  auditPanelActionText: {
    color: '#7DD3FC',
    fontSize: 12,
    fontWeight: '700' as const,
  },
  auditGrid: {
    gap: 10,
  },
  auditSectionCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 8,
  },
  auditSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  auditSectionTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  auditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  auditRowLabel: {
    flex: 1,
    fontSize: 12,
    color: '#9FB0C8',
  },
  auditRowValue: {
    maxWidth: '52%' as const,
    fontSize: 12,
    fontWeight: '700' as const,
    textAlign: 'right',
  },
  auditHintText: {
    fontSize: 11,
    lineHeight: 16,
    color: '#F5C16C',
  },
  auditQuickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  auditQuickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  auditQuickBtnText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  regAuditCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 14,
    marginBottom: 10,
    backgroundColor: '#1A1206',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: Colors.primary + '50',
  },
  regAuditCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  regAuditCardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  regAuditCardText: {
    flex: 1,
  },
  regAuditCardLabel: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.primary,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  regAuditCardTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  regAuditCardSub: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 1,
  },
});
