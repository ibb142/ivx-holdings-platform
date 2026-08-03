import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  RefreshControl,
  Switch} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Mail,
  Users,
  Shield,
  Settings,
  Inbox,
  Send,
  Eye,
  Trash2,
  UserPlus,
  Lock,
  Unlock,
  Search,
  X,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Activity,
  Pen,
  Forward,
  Reply,
  Server,
  BarChart3,
  Clock,
  Zap,
  Globe} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { EMAIL_ACCOUNTS } from '@/mocks/emails';
import { teamMembers as mockTeamMembers } from '@/mocks/admin';
import { useEmail } from '@/lib/email-context';


type TabKey = 'overview' | 'accounts' | 'staff' | 'activity' | 'settings';
type AccessLevel = 'read' | 'send' | 'manage';

interface StaffEmailAccess {
  staffId: string;
  staffName: string;
  staffEmail: string;
  staffRole: string;
  accessLevel: AccessLevel;
  assignedAt: string;
  lastAccessed: string | null;
  emailAccounts: string[];
}

interface EmailAccountConfig {
  id: string;
  isActive: boolean;
  forwardTo: string;
  autoReplyEnabled: boolean;
  autoReplyMessage: string;
  signature: string;
  dailySendLimit: number;
  sentToday: number;
  storageUsedMB: number;
  storageLimitMB: number;
}

interface ActivityLogEntry {
  id: string;
  type: 'sent' | 'received' | 'login' | 'access_changed' | 'forwarded' | 'auto_reply';
  accountId: string;
  staffName: string;
  description: string;
  timestamp: string;
}

const ACCESS_LEVEL_CONFIG: Record<AccessLevel, { label: string; color: string; desc: string }> = {
  read: { label: 'Read Only', color: '#4A90D9', desc: 'View emails only' },
  send: { label: 'Read & Send', color: '#00C48C', desc: 'View & compose emails' },
  manage: { label: 'Full Access', color: '#FFD700', desc: 'Full control, settings, delete' }};

const TABS: { key: TabKey; label: string; icon: typeof Mail }[] = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'accounts', label: 'Accounts', icon: Mail },
  { key: 'staff', label: 'Staff', icon: Users },
  { key: 'activity', label: 'Activity', icon: Activity },
  { key: 'settings', label: 'Settings', icon: Settings },
];

const generateStaffAccess = (): StaffEmailAccess[] => [
  {
    staffId: 'admin-1',
    staffName: 'IVXHOLDINGS CEO',
    staffEmail: 'ceo@ivxholding.com',
    staffRole: 'Chief Executive Officer',
    accessLevel: 'manage',
    assignedAt: '2024-01-01T00:00:00Z',
    lastAccessed: '2026-03-05T09:00:00Z',
    emailAccounts: ['admin', 'ceo', 'support', 'investors', 'legal', 'finance', 'security', 'noreply', 'kyc']},
  {
    staffId: 'admin-2',
    staffName: 'Sarah Martinez',
    staffEmail: 'operations@ivxholding.com',
    staffRole: 'Operations Manager',
    accessLevel: 'send',
    assignedAt: '2024-03-15T10:00:00Z',
    lastAccessed: '2026-03-04T16:30:00Z',
    emailAccounts: ['admin', 'support', 'kyc']},
  {
    staffId: 'admin-3',
    staffName: 'Michael Chen',
    staffEmail: 'analyst@ivxholding.com',
    staffRole: 'Investment Analyst',
    accessLevel: 'read',
    assignedAt: '2024-06-01T09:00:00Z',
    lastAccessed: '2026-03-03T10:15:00Z',
    emailAccounts: ['investors', 'finance']},
  {
    staffId: 'admin-4',
    staffName: 'Emily Johnson',
    staffEmail: 'support-lead@ivxholding.com',
    staffRole: 'Support Lead',
    accessLevel: 'manage',
    assignedAt: '2024-08-20T14:00:00Z',
    lastAccessed: '2026-03-05T08:45:00Z',
    emailAccounts: ['support', 'kyc']},
  {
    staffId: 'admin-5',
    staffName: 'David Park',
    staffEmail: 'legal-counsel@ivxholding.com',
    staffRole: 'Legal Counsel',
    accessLevel: 'manage',
    assignedAt: '2024-10-01T09:00:00Z',
    lastAccessed: '2026-03-04T17:00:00Z',
    emailAccounts: ['legal']},
  {
    staffId: 'admin-6',
    staffName: 'Rachel Kim',
    staffEmail: 'finance-mgr@ivxholding.com',
    staffRole: 'Finance Manager',
    accessLevel: 'send',
    assignedAt: '2025-01-15T09:00:00Z',
    lastAccessed: '2026-03-05T07:30:00Z',
    emailAccounts: ['finance']},
  {
    staffId: 'admin-7',
    staffName: 'James Wilson',
    staffEmail: 'security-ops@ivxholding.com',
    staffRole: 'Security Engineer',
    accessLevel: 'manage',
    assignedAt: '2025-02-01T09:00:00Z',
    lastAccessed: '2026-03-05T06:00:00Z',
    emailAccounts: ['security']},
];

const generateAccountConfigs = (): EmailAccountConfig[] =>
  EMAIL_ACCOUNTS.map((a) => {
    const storageMap: Record<string, number> = {
      admin: 2457, ceo: 1843, noreply: 102, support: 5324, kyc: 3712, investors: 2156, legal: 4398, finance: 3921, security: 1134};
    const sentMap: Record<string, number> = {
      admin: 23, ceo: 8, noreply: 156, support: 47, kyc: 12, investors: 18, legal: 5, finance: 9, security: 3};
    return {
      id: a.id,
      isActive: true,
      forwardTo: '',
      autoReplyEnabled: a.id === 'noreply',
      autoReplyMessage: a.id === 'noreply' ? 'This is an automated email. Please do not reply to this address.' : '',
      signature: `Best regards,\n${a.displayName}\nIVX Holdings LLC\n${a.email}`,
      dailySendLimit: a.id === 'noreply' ? 10000 : 500,
      sentToday: sentMap[a.id] ?? 0,
      storageUsedMB: storageMap[a.id] ?? 500,
      storageLimitMB: 15360};
  });

const generateActivityLog = (): ActivityLogEntry[] => [
  { id: 'act-1', type: 'sent', accountId: 'support', staffName: 'Emily Johnson', description: 'Replied to Maria Garcia re: dashboard access', timestamp: '2026-03-05T09:15:00Z' },
  { id: 'act-2', type: 'received', accountId: 'investors', staffName: 'System', description: 'New email from Goldman Sachs AM — Due Diligence Request', timestamp: '2026-03-05T09:00:00Z' },
  { id: 'act-3', type: 'login', accountId: 'admin', staffName: 'IVXHOLDINGS CEO', description: 'Logged into admin@ivxholding.com', timestamp: '2026-03-05T08:45:00Z' },
  { id: 'act-4', type: 'auto_reply', accountId: 'noreply', staffName: 'System', description: 'Auto-reply sent to 12 incoming emails', timestamp: '2026-03-05T08:30:00Z' },
  { id: 'act-5', type: 'sent', accountId: 'kyc', staffName: 'Sarah Martinez', description: 'Sent KYC approval to Ahmed Al-Rashid', timestamp: '2026-03-05T08:20:00Z' },
  { id: 'act-6', type: 'forwarded', accountId: 'investors', staffName: 'IVXHOLDINGS CEO', description: 'Forwarded BlackRock proposal to legal@ivxholding.com', timestamp: '2026-03-05T08:10:00Z' },
  { id: 'act-7', type: 'access_changed', accountId: 'finance', staffName: 'IVXHOLDINGS CEO', description: 'Granted Rachel Kim send access to finance@', timestamp: '2026-03-05T07:50:00Z' },
  { id: 'act-8', type: 'received', accountId: 'security', staffName: 'System', description: 'New email from CrowdStrike — Threat Intelligence Report', timestamp: '2026-03-05T06:00:00Z' },
  { id: 'act-9', type: 'sent', accountId: 'admin', staffName: 'IVXHOLDINGS CEO', description: 'Sent platform access credentials to InvestorCorp', timestamp: '2026-03-04T18:00:00Z' },
  { id: 'act-10', type: 'login', accountId: 'legal', staffName: 'David Park', description: 'Logged into legal@ivxholding.com', timestamp: '2026-03-04T17:00:00Z' },
  { id: 'act-11', type: 'sent', accountId: 'finance', staffName: 'Rachel Kim', description: 'Sent Q4 report to Deloitte Audit team', timestamp: '2026-03-04T16:00:00Z' },
  { id: 'act-12', type: 'received', accountId: 'legal', staffName: 'System', description: 'New email from Norton Rose Fulbright — Investment Agreement', timestamp: '2026-03-04T11:20:00Z' },
  { id: 'act-13', type: 'access_changed', accountId: 'support', staffName: 'IVXHOLDINGS CEO', description: 'Upgraded Emily Johnson to Full Access on support@', timestamp: '2026-03-04T10:00:00Z' },
  { id: 'act-14', type: 'sent', accountId: 'ceo', staffName: 'IVXHOLDINGS CEO', description: 'Sent expansion proposal to Dubai partners', timestamp: '2026-03-04T09:30:00Z' },
  { id: 'act-15', type: 'forwarded', accountId: 'support', staffName: 'Emily Johnson', description: 'Forwarded withdrawal issue to finance@ivxholding.com', timestamp: '2026-03-04T09:00:00Z' },
];

const ACTIVITY_TYPE_CONFIG: Record<string, { color: string; icon: typeof Send }> = {
  sent: { color: Colors.accent, icon: Send },
  received: { color: Colors.success, icon: Inbox },
  login: { color: Colors.primary, icon: Eye },
  access_changed: { color: Colors.warning, icon: Shield },
  forwarded: { color: '#E879F9', icon: Forward },
  auto_reply: { color: Colors.textSecondary, icon: Reply }};

export default function EmailManagementScreen() {
  const router = useRouter();
  const { allEmails, totalUnread } = useEmail();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [staffAccess, setStaffAccess] = useState<StaffEmailAccess[]>(generateStaffAccess);
  const [accountConfigs, setAccountConfigs] = useState<EmailAccountConfig[]>(generateAccountConfigs);
  const [activityLog] = useState<ActivityLogEntry[]>(generateActivityLog);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [expandedStaff, setExpandedStaff] = useState<string | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showEditSettingsModal, setShowEditSettingsModal] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [newStaffId, setNewStaffId] = useState<string | null>(null);
  const [newAccessLevel, setNewAccessLevel] = useState<AccessLevel>('read');
  const [newEmailAccounts, setNewEmailAccounts] = useState<string[]>([]);
  const [editForwardTo, setEditForwardTo] = useState('');
  const [editAutoReply, setEditAutoReply] = useState(false);
  const [editAutoReplyMsg, setEditAutoReplyMsg] = useState('');
  const [editSignature, setEditSignature] = useState('');
  const [editDailyLimit, setEditDailyLimit] = useState('');
  const [activityFilter, setActivityFilter] = useState<string>('all');

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const totalSentToday = useMemo(() => accountConfigs.reduce((s, a) => s + a.sentToday, 0), [accountConfigs]);
  const activeAccounts = useMemo(() => accountConfigs.filter(a => a.isActive).length, [accountConfigs]);
  const totalStaff = staffAccess.length;

  const formatTime = useCallback((dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }, []);

  const formatStorage = useCallback((mb: number) => {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${mb} MB`;
  }, []);

  const getAccountById = useCallback((id: string) => EMAIL_ACCOUNTS.find(a => a.id === id), []);

  const filteredActivity = useMemo(() => {
    if (activityFilter === 'all') return activityLog;
    return activityLog.filter(a => a.type === activityFilter);
  }, [activityLog, activityFilter]);

  const availableStaffForAssign = useMemo(() => {
    const existingIds = staffAccess.map(s => s.staffId);
    return mockTeamMembers.filter(m => !existingIds.includes(m.id) && m.status !== 'invited');
  }, [staffAccess]);

  const toggleAccountActive = useCallback((accountId: string) => {
    if (accountId === 'admin' || accountId === 'ceo') {
      Alert.alert('Protected', 'This email account cannot be deactivated.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAccountConfigs(prev => prev.map(a =>
      a.id === accountId ? { ...a, isActive: !a.isActive } : a
    ));
  }, []);

  const openAssignModal = useCallback(() => {
    setNewStaffId(null);
    setNewAccessLevel('read');
    setNewEmailAccounts([]);
    setShowAssignModal(true);
  }, []);

  const handleAssignStaff = useCallback(() => {
    if (!newStaffId || newEmailAccounts.length === 0) {
      Alert.alert('Error', 'Select a staff member and at least one email account.');
      return;
    }
    const staff = mockTeamMembers.find(m => m.id === newStaffId);
    if (!staff) return;

    const newAccess: StaffEmailAccess = {
      staffId: staff.id,
      staffName: `${staff.firstName} ${staff.lastName}`,
      staffEmail: staff.email,
      staffRole: staff.role.name,
      accessLevel: newAccessLevel,
      assignedAt: new Date().toISOString(),
      lastAccessed: null,
      emailAccounts: newEmailAccounts};

    setStaffAccess(prev => [...prev, newAccess]);
    setShowAssignModal(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Access Granted', `${staff.firstName} ${staff.lastName} now has ${ACCESS_LEVEL_CONFIG[newAccessLevel].label} access to ${newEmailAccounts.length} mailbox(es).`);
  }, [newStaffId, newAccessLevel, newEmailAccounts]);

  const removeStaffAccess = useCallback((staffId: string) => {
    const staff = staffAccess.find(s => s.staffId === staffId);
    if (!staff) return;
    Alert.alert('Remove Access', `Remove all email access for ${staff.staffName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          setStaffAccess(prev => prev.filter(s => s.staffId !== staffId));
        }},
    ]);
  }, [staffAccess]);

  const cycleAccessLevel = useCallback((staffId: string) => {
    const levels: AccessLevel[] = ['read', 'send', 'manage'];
    setStaffAccess(prev => prev.map(s => {
      if (s.staffId !== staffId) return s;
      const idx = levels.indexOf(s.accessLevel);
      return { ...s, accessLevel: levels[(idx + 1) % levels.length] };
    }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const toggleStaffEmailAccount = useCallback((staffId: string, accountId: string) => {
    setStaffAccess(prev => prev.map(s => {
      if (s.staffId !== staffId) return s;
      const has = s.emailAccounts.includes(accountId);
      return {
        ...s,
        emailAccounts: has ? s.emailAccounts.filter(a => a !== accountId) : [...s.emailAccounts, accountId]};
    }));
  }, []);

  const openEditSettings = useCallback((accountId: string) => {
    const config = accountConfigs.find(a => a.id === accountId);
    if (!config) return;
    setEditingAccountId(accountId);
    setEditForwardTo(config.forwardTo);
    setEditAutoReply(config.autoReplyEnabled);
    setEditAutoReplyMsg(config.autoReplyMessage);
    setEditSignature(config.signature);
    setEditDailyLimit(config.dailySendLimit.toString());
    setShowEditSettingsModal(true);
  }, [accountConfigs]);

  const saveAccountSettings = useCallback(() => {
    if (!editingAccountId) return;
    setAccountConfigs(prev => prev.map(a =>
      a.id === editingAccountId ? {
        ...a,
        forwardTo: editForwardTo,
        autoReplyEnabled: editAutoReply,
        autoReplyMessage: editAutoReplyMsg,
        signature: editSignature,
        dailySendLimit: parseInt(editDailyLimit) || 500} : a
    ));
    setShowEditSettingsModal(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Saved', 'Account settings updated.');
  }, [editingAccountId, editForwardTo, editAutoReply, editAutoReplyMsg, editSignature, editDailyLimit]);

  const renderOverview = () => {
    const accountList = EMAIL_ACCOUNTS.map(acc => {
      const config = accountConfigs.find(c => c.id === acc.id);
      const staffCount = staffAccess.filter(s => s.emailAccounts.includes(acc.id)).length;
      const accountEmails = allEmails.filter(e => e.accountId === acc.id);
      const unread = accountEmails.filter(e => e.folder === 'inbox' && !e.isRead).length;
      return { ...acc, config, staffCount, unread, totalEmails: accountEmails.length };
    });

    return (
      <View>
        <View style={styles.statsGrid}>
          <View style={styles.statCardLg}>
            <View style={[styles.statIconBg, { backgroundColor: Colors.primary + '20' }]}>
              <Mail size={20} color={Colors.primary} />
            </View>
            <Text style={styles.statCardValue}>{EMAIL_ACCOUNTS.length}</Text>
            <Text style={styles.statCardLabel}>Mailboxes</Text>
          </View>
          <View style={styles.statCardLg}>
            <View style={[styles.statIconBg, { backgroundColor: Colors.accent + '20' }]}>
              <Users size={20} color={Colors.accent} />
            </View>
            <Text style={styles.statCardValue}>{totalStaff}</Text>
            <Text style={styles.statCardLabel}>Staff Members</Text>
          </View>
          <View style={styles.statCardLg}>
            <View style={[styles.statIconBg, { backgroundColor: Colors.warning + '20' }]}>
              <Inbox size={20} color={Colors.warning} />
            </View>
            <Text style={styles.statCardValue}>{totalUnread}</Text>
            <Text style={styles.statCardLabel}>Unread</Text>
          </View>
          <View style={styles.statCardLg}>
            <View style={[styles.statIconBg, { backgroundColor: Colors.success + '20' }]}>
              <Send size={20} color={Colors.success} />
            </View>
            <Text style={styles.statCardValue}>{totalSentToday}</Text>
            <Text style={styles.statCardLabel}>Sent Today</Text>
          </View>
        </View>

        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.quickActionBtn} onPress={() => router.push('/email' as any)}>
            <Inbox size={18} color={Colors.accent} />
            <Text style={styles.quickActionText}>Open Inbox</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionBtn} onPress={() => router.push('/email-compose' as any)}>
            <Pen size={18} color={Colors.success} />
            <Text style={styles.quickActionText}>Compose</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionBtn} onPress={() => router.push('/admin/email-engine' as any)}>
            <Server size={18} color={Colors.primary} />
            <Text style={styles.quickActionText}>Engine</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionBtn} onPress={() => router.push('/admin/email-inbox' as any)}>
            <Zap size={18} color={Colors.warning} />
            <Text style={styles.quickActionText}>AI Inbox</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>All Email Accounts</Text>
            <Text style={styles.sectionCount}>{activeAccounts} active</Text>
          </View>

          {accountList.map((acc) => {
            const storagePercent = acc.config ? Math.round((acc.config.storageUsedMB / acc.config.storageLimitMB) * 100) : 0;
            return (
              <TouchableOpacity
                key={acc.id}
                style={styles.accountRow}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setActiveTab('accounts');
                  setExpandedAccount(acc.id);
                }}
                activeOpacity={0.7}
                testID={`overview-account-${acc.id}`}
              >
                <View style={[styles.accountDot, { backgroundColor: acc.color }]} />
                <View style={styles.accountRowInfo}>
                  <Text style={styles.accountRowName}>{acc.displayName}</Text>
                  <Text style={styles.accountRowEmail}>{acc.email}</Text>
                </View>
                <View style={styles.accountRowRight}>
                  <View style={styles.accountRowMeta}>
                    {acc.unread > 0 && (
                      <View style={styles.unreadPill}>
                        <Text style={styles.unreadPillText}>{acc.unread}</Text>
                      </View>
                    )}
                    <View style={styles.staffCountPill}>
                      <Users size={9} color={Colors.textTertiary} />
                      <Text style={styles.staffCountText}>{acc.staffCount}</Text>
                    </View>
                  </View>
                  <View style={styles.miniStorageBar}>
                    <View style={[styles.miniStorageFill, {
                      width: `${Math.min(100, storagePercent)}%`,
                      backgroundColor: storagePercent > 80 ? Colors.error : storagePercent > 60 ? Colors.warning : Colors.accent}]} />
                  </View>
                </View>
                <ChevronRight size={16} color={Colors.textTertiary} />
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            <TouchableOpacity onPress={() => setActiveTab('activity')}>
              <Text style={styles.seeAllText}>See All</Text>
            </TouchableOpacity>
          </View>
          {activityLog.slice(0, 5).map((entry) => {
            const typeConfig = ACTIVITY_TYPE_CONFIG[entry.type];
            const IconComp = typeConfig?.icon || Activity;
            const account = getAccountById(entry.accountId);
            return (
              <View key={entry.id} style={styles.activityRow}>
                <View style={[styles.activityIconBg, { backgroundColor: (typeConfig?.color || Colors.textTertiary) + '18' }]}>
                  <IconComp size={14} color={typeConfig?.color || Colors.textTertiary} />
                </View>
                <View style={styles.activityInfo}>
                  <Text style={styles.activityDesc} numberOfLines={1}>{entry.description}</Text>
                  <View style={styles.activityMeta}>
                    <View style={[styles.activityAccountPill, { backgroundColor: (account?.color || Colors.textTertiary) + '18' }]}>
                      <Text style={[styles.activityAccountText, { color: account?.color || Colors.textTertiary }]}>{account?.displayName || entry.accountId}</Text>
                    </View>
                    <Text style={styles.activityTime}>{formatTime(entry.timestamp)}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  const renderAccounts = () => {
    const filteredAccounts = searchQuery.trim()
      ? EMAIL_ACCOUNTS.filter(a =>
          a.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.displayName.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : EMAIL_ACCOUNTS;

    return (
      <View>
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Search size={16} color={Colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search accounts..."
              placeholderTextColor={Colors.textTertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <X size={15} color={Colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {filteredAccounts.map((account) => {
          const config = accountConfigs.find(c => c.id === account.id);
          const isExpanded = expandedAccount === account.id;
          const staffForAccount = staffAccess.filter(s => s.emailAccounts.includes(account.id));
          const storagePercent = config ? Math.round((config.storageUsedMB / config.storageLimitMB) * 100) : 0;
          const sendPercent = config ? Math.round((config.sentToday / config.dailySendLimit) * 100) : 0;

          return (
            <View key={account.id} style={styles.accountCard}>
              <TouchableOpacity
                style={styles.accountCardHeader}
                onPress={() => setExpandedAccount(isExpanded ? null : account.id)}
                activeOpacity={0.7}
              >
                <View style={[styles.accountAvatar, { backgroundColor: account.color + '22' }]}>
                  <Text style={[styles.accountAvatarText, { color: account.color }]}>{account.avatar}</Text>
                </View>
                <View style={styles.accountCardInfo}>
                  <View style={styles.accountNameRow}>
                    <Text style={styles.accountName}>{account.displayName}</Text>
                    {config && !config.isActive && (
                      <View style={styles.inactiveBadge}><Text style={styles.inactiveBadgeText}>Inactive</Text></View>
                    )}
                  </View>
                  <Text style={styles.accountEmail}>{account.email}</Text>
                  <Text style={styles.accountRole}>{account.role}</Text>
                </View>
                {isExpanded ? <ChevronUp size={18} color={Colors.textTertiary} /> : <ChevronDown size={18} color={Colors.textTertiary} />}
              </TouchableOpacity>

              {isExpanded && config && (
                <View style={styles.accountExpanded}>
                  <View style={styles.accountMetricsRow}>
                    <View style={styles.accountMetric}>
                      <Text style={styles.accountMetricLabel}>Storage</Text>
                      <View style={styles.progressBarOuter}>
                        <View style={[styles.progressBarInner, {
                          width: `${Math.min(100, storagePercent)}%`,
                          backgroundColor: storagePercent > 80 ? Colors.error : storagePercent > 60 ? Colors.warning : Colors.accent}]} />
                      </View>
                      <Text style={styles.accountMetricValue}>{formatStorage(config.storageUsedMB)} / {formatStorage(config.storageLimitMB)}</Text>
                    </View>
                    <View style={styles.accountMetric}>
                      <Text style={styles.accountMetricLabel}>Sent Today</Text>
                      <View style={styles.progressBarOuter}>
                        <View style={[styles.progressBarInner, {
                          width: `${Math.min(100, sendPercent)}%`,
                          backgroundColor: sendPercent > 80 ? Colors.error : Colors.accent}]} />
                      </View>
                      <Text style={styles.accountMetricValue}>{config.sentToday} / {config.dailySendLimit}</Text>
                    </View>
                  </View>

                  <View style={styles.accountConfigRow}>
                    <View style={styles.configItem}>
                      <Forward size={12} color={Colors.textSecondary} />
                      <Text style={styles.configLabel}>Forward:</Text>
                      <Text style={styles.configValue}>{config.forwardTo || 'None'}</Text>
                    </View>
                    <View style={styles.configItem}>
                      <Reply size={12} color={Colors.textSecondary} />
                      <Text style={styles.configLabel}>Auto-Reply:</Text>
                      <Text style={[styles.configValue, { color: config.autoReplyEnabled ? Colors.success : Colors.textTertiary }]}>
                        {config.autoReplyEnabled ? 'On' : 'Off'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.accountStaffList}>
                    <Text style={styles.accountStaffTitle}>Staff with Access ({staffForAccount.length})</Text>
                    {staffForAccount.map(s => (
                      <View key={s.staffId} style={styles.staffMiniRow}>
                        <View style={[styles.staffMiniAvatar, { backgroundColor: ACCESS_LEVEL_CONFIG[s.accessLevel].color + '18' }]}>
                          <Text style={[styles.staffMiniAvatarText, { color: ACCESS_LEVEL_CONFIG[s.accessLevel].color }]}>{s.staffName.charAt(0)}</Text>
                        </View>
                        <Text style={styles.staffMiniName} numberOfLines={1}>{s.staffName}</Text>
                        <View style={[styles.accessBadge, { backgroundColor: ACCESS_LEVEL_CONFIG[s.accessLevel].color + '18' }]}>
                          <Text style={[styles.accessBadgeText, { color: ACCESS_LEVEL_CONFIG[s.accessLevel].color }]}>{ACCESS_LEVEL_CONFIG[s.accessLevel].label}</Text>
                        </View>
                      </View>
                    ))}
                  </View>

                  <View style={styles.accountActions}>
                    <TouchableOpacity
                      style={[styles.accountActionBtn, { borderColor: Colors.primary + '40' }]}
                      onPress={() => router.push('/email' as any)}
                    >
                      <Inbox size={14} color={Colors.primary} />
                      <Text style={[styles.accountActionText, { color: Colors.primary }]}>Inbox</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.accountActionBtn, { borderColor: Colors.accent + '40' }]}
                      onPress={() => openEditSettings(account.id)}
                    >
                      <Settings size={14} color={Colors.accent} />
                      <Text style={[styles.accountActionText, { color: Colors.accent }]}>Settings</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.accountActionBtn, { borderColor: config.isActive ? Colors.warning + '40' : Colors.success + '40' }]}
                      onPress={() => toggleAccountActive(account.id)}
                    >
                      {config.isActive ? <Lock size={14} color={Colors.warning} /> : <Unlock size={14} color={Colors.success} />}
                      <Text style={[styles.accountActionText, { color: config.isActive ? Colors.warning : Colors.success }]}>
                        {config.isActive ? 'Disable' : 'Enable'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </View>
    );
  };

  const renderStaff = () => (
    <View>
      <View style={styles.staffHeader}>
        <Text style={styles.staffHeaderTitle}>Staff Access Management</Text>
        <TouchableOpacity style={styles.addStaffBtn} onPress={openAssignModal}>
          <UserPlus size={14} color={Colors.background} />
          <Text style={styles.addStaffBtnText}>Add Staff</Text>
        </TouchableOpacity>
      </View>

      {staffAccess.map((staff) => {
        const isExpanded = expandedStaff === staff.staffId;
        const levelConfig = ACCESS_LEVEL_CONFIG[staff.accessLevel];

        return (
          <View key={staff.staffId} style={styles.staffCard}>
            <TouchableOpacity
              style={styles.staffCardHeader}
              onPress={() => setExpandedStaff(isExpanded ? null : staff.staffId)}
              activeOpacity={0.7}
            >
              <View style={[styles.staffAvatarLg, { backgroundColor: levelConfig.color + '18' }]}>
                <Text style={[styles.staffAvatarLgText, { color: levelConfig.color }]}>{staff.staffName.charAt(0)}</Text>
              </View>
              <View style={styles.staffCardInfo}>
                <Text style={styles.staffCardName}>{staff.staffName}</Text>
                <Text style={styles.staffCardEmail}>{staff.staffEmail}</Text>
                <Text style={styles.staffCardRole}>{staff.staffRole}</Text>
              </View>
              <View style={styles.staffCardRight}>
                <TouchableOpacity
                  style={[styles.levelBadge, { backgroundColor: levelConfig.color + '18' }]}
                  onPress={() => cycleAccessLevel(staff.staffId)}
                >
                  <Text style={[styles.levelBadgeText, { color: levelConfig.color }]}>{levelConfig.label}</Text>
                </TouchableOpacity>
                {isExpanded ? <ChevronUp size={16} color={Colors.textTertiary} /> : <ChevronDown size={16} color={Colors.textTertiary} />}
              </View>
            </TouchableOpacity>

            {isExpanded && (
              <View style={styles.staffExpanded}>
                <View style={styles.staffDetailRow}>
                  <Clock size={12} color={Colors.textTertiary} />
                  <Text style={styles.staffDetailLabel}>Last Accessed:</Text>
                  <Text style={styles.staffDetailValue}>{formatTime(staff.lastAccessed)}</Text>
                </View>
                <View style={styles.staffDetailRow}>
                  <Clock size={12} color={Colors.textTertiary} />
                  <Text style={styles.staffDetailLabel}>Assigned:</Text>
                  <Text style={styles.staffDetailValue}>{formatTime(staff.assignedAt)}</Text>
                </View>

                <Text style={styles.staffAccountsTitle}>Mailbox Access ({staff.emailAccounts.length})</Text>
                <View style={styles.staffAccountsGrid}>
                  {EMAIL_ACCOUNTS.map(acc => {
                    const hasAccess = staff.emailAccounts.includes(acc.id);
                    return (
                      <TouchableOpacity
                        key={acc.id}
                        style={[styles.staffAccountChip, hasAccess && { borderColor: acc.color, backgroundColor: acc.color + '12' }]}
                        onPress={() => toggleStaffEmailAccount(staff.staffId, acc.id)}
                      >
                        <View style={[styles.staffAccountDot, { backgroundColor: hasAccess ? acc.color : Colors.textTertiary }]} />
                        <Text style={[styles.staffAccountChipText, hasAccess && { color: Colors.text }]}>{acc.displayName}</Text>
                        {hasAccess && <Check size={10} color={acc.color} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.staffActions}>
                  <TouchableOpacity style={styles.staffRemoveBtn} onPress={() => removeStaffAccess(staff.staffId)}>
                    <Trash2 size={14} color={Colors.error} />
                    <Text style={styles.staffRemoveBtnText}>Revoke All Access</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        );
      })}

      {staffAccess.length === 0 && (
        <View style={styles.emptyState}>
          <Users size={44} color={Colors.textTertiary} />
          <Text style={styles.emptyText}>No staff assigned yet</Text>
          <Text style={styles.emptySubtext}>Tap &quot;Add Staff&quot; to grant email access</Text>
        </View>
      )}
    </View>
  );

  const renderActivity = () => (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {[
          { key: 'all', label: 'All' },
          { key: 'sent', label: 'Sent' },
          { key: 'received', label: 'Received' },
          { key: 'login', label: 'Login' },
          { key: 'access_changed', label: 'Access' },
          { key: 'forwarded', label: 'Forwarded' },
          { key: 'auto_reply', label: 'Auto-Reply' },
        ].map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, activityFilter === f.key && styles.filterChipActive]}
            onPress={() => setActivityFilter(f.key)}
          >
            <Text style={[styles.filterChipText, activityFilter === f.key && styles.filterChipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {filteredActivity.map((entry) => {
        const typeConfig = ACTIVITY_TYPE_CONFIG[entry.type];
        const IconComp = typeConfig?.icon || Activity;
        const account = getAccountById(entry.accountId);
        return (
          <View key={entry.id} style={styles.activityCard}>
            <View style={[styles.activityCardIcon, { backgroundColor: (typeConfig?.color || Colors.textTertiary) + '18' }]}>
              <IconComp size={16} color={typeConfig?.color || Colors.textTertiary} />
            </View>
            <View style={styles.activityCardInfo}>
              <Text style={styles.activityCardDesc}>{entry.description}</Text>
              <View style={styles.activityCardMeta}>
                <Text style={styles.activityCardStaff}>{entry.staffName}</Text>
                <View style={[styles.activityAccountTag, { backgroundColor: (account?.color || Colors.textTertiary) + '18' }]}>
                  <Text style={[styles.activityAccountTagText, { color: account?.color || Colors.textTertiary }]}>{account?.email || entry.accountId}</Text>
                </View>
              </View>
            </View>
            <Text style={styles.activityCardTime}>{formatTime(entry.timestamp)}</Text>
          </View>
        );
      })}

      {filteredActivity.length === 0 && (
        <View style={styles.emptyState}>
          <Activity size={44} color={Colors.textTertiary} />
          <Text style={styles.emptyText}>No activity found</Text>
        </View>
      )}
    </View>
  );

  const renderSettings = () => (
    <View>
      <View style={styles.settingsSection}>
        <View style={styles.settingsSectionHeader}>
          <Globe size={18} color={Colors.primary} />
          <Text style={styles.settingsSectionTitle}>Global Email Settings</Text>
        </View>

        <TouchableOpacity style={styles.settingsItem} onPress={() => router.push('/admin/email-engine' as any)}>
          <Server size={18} color={Colors.accent} />
          <View style={styles.settingsItemInfo}>
            <Text style={styles.settingsItemTitle}>SMTP / Email Engine</Text>
            <Text style={styles.settingsItemDesc}>Manage SMTP servers, campaigns, deliverability</Text>
          </View>
          <ChevronRight size={18} color={Colors.textTertiary} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.settingsItem} onPress={() => router.push('/admin/email-inbox' as any)}>
          <Zap size={18} color={Colors.success} />
          <View style={styles.settingsItemInfo}>
            <Text style={styles.settingsItemTitle}>AI Email Inbox</Text>
            <Text style={styles.settingsItemDesc}>AI-powered email analysis and smart replies</Text>
          </View>
          <ChevronRight size={18} color={Colors.textTertiary} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.settingsItem} onPress={() => router.push('/admin/email-accounts' as any)}>
          <Shield size={18} color={Colors.warning} />
          <View style={styles.settingsItemInfo}>
            <Text style={styles.settingsItemTitle}>Account Permissions (Legacy)</Text>
            <Text style={styles.settingsItemDesc}>Detailed per-account staff permissions</Text>
          </View>
          <ChevronRight size={18} color={Colors.textTertiary} />
        </TouchableOpacity>
      </View>

      <View style={styles.settingsSection}>
        <View style={styles.settingsSectionHeader}>
          <Mail size={18} color={Colors.accent} />
          <Text style={styles.settingsSectionTitle}>Per-Account Configuration</Text>
        </View>

        {EMAIL_ACCOUNTS.map((account) => {
          const config = accountConfigs.find(c => c.id === account.id);
          return (
            <TouchableOpacity
              key={account.id}
              style={styles.settingsAccountRow}
              onPress={() => openEditSettings(account.id)}
              activeOpacity={0.7}
            >
              <View style={[styles.settingsAccountDot, { backgroundColor: account.color }]} />
              <View style={styles.settingsAccountInfo}>
                <Text style={styles.settingsAccountName}>{account.displayName}</Text>
                <Text style={styles.settingsAccountEmail}>{account.email}</Text>
              </View>
              <View style={styles.settingsAccountBadges}>
                {config?.autoReplyEnabled && (
                  <View style={styles.settingsBadge}><Reply size={10} color={Colors.success} /><Text style={styles.settingsBadgeText}>Auto</Text></View>
                )}
                {config?.forwardTo ? (
                  <View style={styles.settingsBadge}><Forward size={10} color={Colors.accent} /><Text style={styles.settingsBadgeText}>Fwd</Text></View>
                ) : null}
              </View>
              <Settings size={16} color={Colors.textTertiary} />
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.settingsSection}>
        <View style={styles.settingsSectionHeader}>
          <Shield size={18} color={Colors.success} />
          <Text style={styles.settingsSectionTitle}>Access Level Guide</Text>
        </View>
        {(Object.entries(ACCESS_LEVEL_CONFIG) as [AccessLevel, typeof ACCESS_LEVEL_CONFIG['read']][]).map(([key, config]) => (
          <View key={key} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: config.color }]} />
            <Text style={styles.legendLabel}>{config.label}</Text>
            <Text style={styles.legendDesc}>{config.desc}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'overview': return renderOverview();
      case 'accounts': return renderAccounts();
      case 'staff': return renderStaff();
      case 'activity': return renderActivity();
      case 'settings': return renderSettings();
      default: return null;
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="back-btn">
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Email Management</Text>
          <Text style={styles.headerSubtitle}>{activeAccounts} accounts · {totalStaff} staff · {totalUnread} unread</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={styles.tabBarContent}>
        {TABS.map((tab) => {
          const TabIcon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setActiveTab(tab.key);
              }}
            >
              <TabIcon size={16} color={isActive ? Colors.background : Colors.textSecondary} />
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {renderContent()}
        <View style={{ height: 120 }} />
      </ScrollView>

      <Modal visible={showAssignModal} animationType="slide" transparent onRequestClose={() => setShowAssignModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Staff Access</Text>
              <TouchableOpacity onPress={() => setShowAssignModal(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSectionLabel}>Select Staff Member</Text>
            <ScrollView style={styles.modalList} showsVerticalScrollIndicator={false}>
              {availableStaffForAssign.length === 0 ? (
                <Text style={styles.modalEmptyText}>All staff members already have access.</Text>
              ) : (
                availableStaffForAssign.map(staff => (
                  <TouchableOpacity
                    key={staff.id}
                    style={[styles.modalStaffItem, newStaffId === staff.id && styles.modalStaffItemActive]}
                    onPress={() => setNewStaffId(staff.id)}
                  >
                    <View style={[styles.modalStaffAvatar, newStaffId === staff.id && styles.modalStaffAvatarActive]}>
                      <Text style={[styles.modalStaffAvatarText, newStaffId === staff.id && styles.modalStaffAvatarTextActive]}>
                        {staff.firstName[0]}{staff.lastName[0]}
                      </Text>
                    </View>
                    <View style={styles.modalStaffInfo}>
                      <Text style={styles.modalStaffName}>{staff.firstName} {staff.lastName}</Text>
                      <Text style={styles.modalStaffEmail}>{staff.email}</Text>
                      <Text style={styles.modalStaffRole}>{staff.role.name}</Text>
                    </View>
                    {newStaffId === staff.id && <Check size={20} color={Colors.primary} />}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            {newStaffId && (
              <>
                <Text style={styles.modalSectionLabel}>Access Level</Text>
                <View style={styles.accessLevelRow}>
                  {(Object.entries(ACCESS_LEVEL_CONFIG) as [AccessLevel, typeof ACCESS_LEVEL_CONFIG['read']][]).map(([level, config]) => (
                    <TouchableOpacity
                      key={level}
                      style={[styles.accessLevelOption, newAccessLevel === level && { borderColor: config.color, backgroundColor: config.color + '12' }]}
                      onPress={() => setNewAccessLevel(level as AccessLevel)}
                    >
                      <Text style={[styles.accessLevelOptionText, newAccessLevel === level && { color: config.color }]}>{config.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.modalSectionLabel}>Email Accounts</Text>
                <View style={styles.emailAccountsGrid}>
                  {EMAIL_ACCOUNTS.map(acc => {
                    const selected = newEmailAccounts.includes(acc.id);
                    return (
                      <TouchableOpacity
                        key={acc.id}
                        style={[styles.emailAccountChip, selected && { borderColor: acc.color, backgroundColor: acc.color + '12' }]}
                        onPress={() => {
                          setNewEmailAccounts(prev =>
                            selected ? prev.filter(a => a !== acc.id) : [...prev, acc.id]
                          );
                        }}
                      >
                        <View style={[styles.emailAccountChipDot, { backgroundColor: selected ? acc.color : Colors.textTertiary }]} />
                        <Text style={[styles.emailAccountChipText, selected && { color: Colors.text }]}>{acc.displayName}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TouchableOpacity
                  style={styles.selectAllBtn}
                  onPress={() => setNewEmailAccounts(
                    newEmailAccounts.length === EMAIL_ACCOUNTS.length ? [] : EMAIL_ACCOUNTS.map(a => a.id)
                  )}
                >
                  <Text style={styles.selectAllText}>
                    {newEmailAccounts.length === EMAIL_ACCOUNTS.length ? 'Deselect All' : 'Select All'}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity
              style={[styles.assignBtn, (!newStaffId || newEmailAccounts.length === 0) && styles.assignBtnDisabled]}
              onPress={handleAssignStaff}
              disabled={!newStaffId || newEmailAccounts.length === 0}
            >
              <Shield size={16} color={Colors.background} />
              <Text style={styles.assignBtnText}>Grant Access</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showEditSettingsModal} animationType="slide" transparent onRequestClose={() => setShowEditSettingsModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {getAccountById(editingAccountId || '')?.displayName || ''} Settings
              </Text>
              <TouchableOpacity onPress={() => setShowEditSettingsModal(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>{getAccountById(editingAccountId || '')?.email}</Text>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.settingsModalScroll}>
              <Text style={styles.modalSectionLabel}>Forward Emails To</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. backup@ivxholding.com"
                placeholderTextColor={Colors.textTertiary}
                value={editForwardTo}
                onChangeText={setEditForwardTo}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <View style={styles.switchRow}>
                <View style={styles.switchInfo}>
                  <Reply size={16} color={Colors.accent} />
                  <Text style={styles.switchLabel}>Auto-Reply</Text>
                </View>
                <Switch
                  value={editAutoReply}
                  onValueChange={setEditAutoReply}
                  trackColor={{ false: Colors.border, true: Colors.primary + '60' }}
                  thumbColor={editAutoReply ? Colors.primary : Colors.textTertiary}
                />
              </View>

              {editAutoReply && (
                <>
                  <Text style={styles.modalSectionLabel}>Auto-Reply Message</Text>
                  <TextInput
                    style={[styles.modalInput, styles.modalTextarea]}
                    placeholder="Enter auto-reply message..."
                    placeholderTextColor={Colors.textTertiary}
                    value={editAutoReplyMsg}
                    onChangeText={setEditAutoReplyMsg}
                    multiline
                    textAlignVertical="top"
                  />
                </>
              )}

              <Text style={styles.modalSectionLabel}>Email Signature</Text>
              <TextInput
                style={[styles.modalInput, styles.modalTextarea]}
                placeholder="Enter email signature..."
                placeholderTextColor={Colors.textTertiary}
                value={editSignature}
                onChangeText={setEditSignature}
                multiline
                textAlignVertical="top"
              />

              <Text style={styles.modalSectionLabel}>Daily Send Limit</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="500"
                placeholderTextColor={Colors.textTertiary}
                value={editDailyLimit}
                onChangeText={setEditDailyLimit}
                keyboardType="number-pad"
              />
            </ScrollView>

            <TouchableOpacity style={styles.saveBtn} onPress={saveAccountSettings}>
              <Check size={16} color={Colors.background} />
              <Text style={styles.saveBtnText}>Save Settings</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12},
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border},
  headerCenter: {
    flex: 1},
  headerTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text},
  headerSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2},
  tabBar: {
    maxHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  tabBarContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8},
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border},
  tabActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  tabText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  tabTextActive: {
    color: Colors.background},
  content: {
    flex: 1},
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
    gap: 10},
  statCardLg: {
    width: '47%' as any,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8},
  statIconBg: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center'},
  statCardValue: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.text},
  statCardLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600' as const},
  quickActions: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8},
  quickActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.border},
  quickActionText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.text},
  sectionBlock: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 16},
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12},
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text},
  sectionCount: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600' as const},
  seeAllText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600' as const},
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10},
  accountDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  accountRowInfo: {
    flex: 1},
  accountRowName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text},
  accountRowEmail: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 1},
  accountRowRight: {
    alignItems: 'flex-end',
    gap: 4},
  accountRowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  unreadPill: {
    backgroundColor: Colors.warning + '25',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center'},
  unreadPillText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.warning},
  staffCountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3},
  staffCountText: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontWeight: '600' as const},
  miniStorageBar: {
    width: 50,
    height: 3,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 2,
    overflow: 'hidden'},
  miniStorageFill: {
    height: '100%',
    borderRadius: 2},
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  activityIconBg: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center'},
  activityInfo: {
    flex: 1,
    gap: 3},
  activityDesc: {
    fontSize: 13,
    color: Colors.text,
    fontWeight: '500' as const},
  activityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  activityAccountPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4},
  activityAccountText: {
    fontSize: 10,
    fontWeight: '600' as const},
  activityTime: {
    fontSize: 10,
    color: Colors.textTertiary},
  searchRow: {
    paddingHorizontal: 14,
    paddingVertical: 10},
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border},
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.text},
  accountCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    marginHorizontal: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden'},
  accountCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12},
  accountAvatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center'},
  accountAvatarText: {
    fontSize: 20,
    fontWeight: '800' as const},
  accountCardInfo: {
    flex: 1,
    gap: 2},
  accountNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  accountName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text},
  inactiveBadge: {
    backgroundColor: Colors.error + '20',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2},
  inactiveBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.error},
  accountEmail: {
    fontSize: 13,
    color: Colors.textSecondary},
  accountRole: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 1},
  accountExpanded: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 12,
    paddingTop: 12},
  accountMetricsRow: {
    flexDirection: 'row',
    gap: 12},
  accountMetric: {
    flex: 1,
    gap: 4},
  accountMetricLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '600' as const},
  progressBarOuter: {
    height: 6,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 3,
    overflow: 'hidden'},
  progressBarInner: {
    height: '100%',
    borderRadius: 3},
  accountMetricValue: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontWeight: '600' as const},
  accountConfigRow: {
    flexDirection: 'row',
    gap: 16},
  configItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1},
  configLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '600' as const},
  configValue: {
    fontSize: 11,
    color: Colors.text,
    fontWeight: '600' as const},
  accountStaffList: {
    gap: 6},
  accountStaffTitle: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    marginBottom: 4},
  staffMiniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4},
  staffMiniAvatar: {
    width: 26,
    height: 26,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center'},
  staffMiniAvatarText: {
    fontSize: 11,
    fontWeight: '700' as const},
  staffMiniName: {
    flex: 1,
    fontSize: 12,
    color: Colors.text,
    fontWeight: '500' as const},
  accessBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5},
  accessBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const},
  accountActions: {
    flexDirection: 'row',
    gap: 8},
  accountActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1},
  accountActionText: {
    fontSize: 11,
    fontWeight: '600' as const},
  staffHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12},
  staffHeaderTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text},
  addStaffBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12},
  addStaffBtnText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.background},
  staffCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    marginHorizontal: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden'},
  staffCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10},
  staffAvatarLg: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center'},
  staffAvatarLgText: {
    fontSize: 18,
    fontWeight: '700' as const},
  staffCardInfo: {
    flex: 1,
    gap: 1},
  staffCardName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text},
  staffCardEmail: {
    fontSize: 12,
    color: Colors.textSecondary},
  staffCardRole: {
    fontSize: 11,
    color: Colors.textTertiary},
  staffCardRight: {
    alignItems: 'flex-end',
    gap: 6},
  levelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6},
  levelBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const},
  staffExpanded: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 10,
    paddingTop: 12},
  staffDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  staffDetailLabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '600' as const},
  staffDetailValue: {
    fontSize: 12,
    color: Colors.text,
    fontWeight: '600' as const},
  staffAccountsTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 4},
  staffAccountsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6},
  staffAccountChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.backgroundSecondary},
  staffAccountDot: {
    width: 6,
    height: 6,
    borderRadius: 3},
  staffAccountChipText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textTertiary},
  staffActions: {
    marginTop: 4},
  staffRemoveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.error + '30'},
  staffRemoveBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.error},
  filterScroll: {
    maxHeight: 44,
    marginBottom: 8},
  filterContent: {
    paddingHorizontal: 14,
    gap: 6,
    paddingVertical: 6},
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border},
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  filterChipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  filterChipTextActive: {
    color: Colors.background},
  activityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  activityCardIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center'},
  activityCardInfo: {
    flex: 1,
    gap: 4},
  activityCardDesc: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.text},
  activityCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  activityCardStaff: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600' as const},
  activityAccountTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4},
  activityAccountTagText: {
    fontSize: 9,
    fontWeight: '600' as const},
  activityCardTime: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '500' as const},
  settingsSection: {
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 8},
  settingsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12},
  settingsSectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text},
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border},
  settingsItemInfo: {
    flex: 1,
    gap: 2},
  settingsItemTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text},
  settingsItemDesc: {
    fontSize: 12,
    color: Colors.textSecondary},
  settingsAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.border},
  settingsAccountDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  settingsAccountInfo: {
    flex: 1},
  settingsAccountName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text},
  settingsAccountEmail: {
    fontSize: 11,
    color: Colors.textSecondary},
  settingsAccountBadges: {
    flexDirection: 'row',
    gap: 4},
  settingsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2},
  settingsBadgeText: {
    fontSize: 9,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6},
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  legendLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
    minWidth: 80},
  legendDesc: {
    fontSize: 12,
    color: Colors.textTertiary,
    flex: 1},
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 10},
  emptyText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textTertiary},
  emptySubtext: {
    fontSize: 13,
    color: Colors.textTertiary},
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end'},
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '90%'},
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4},
  modalTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text},
  modalSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 14},
  modalSectionLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8,
    marginTop: 8},
  modalList: {
    maxHeight: 180,
    marginBottom: 8},
  modalEmptyText: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 20},
  modalStaffItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.border},
  modalStaffItemActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '10'},
  modalStaffAvatar: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    borderWidth: 1,
    borderColor: Colors.border},
  modalStaffAvatarActive: {
    backgroundColor: Colors.primary + '20',
    borderColor: Colors.primary},
  modalStaffAvatarText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.textSecondary},
  modalStaffAvatarTextActive: {
    color: Colors.primary},
  modalStaffInfo: {
    flex: 1,
    gap: 1},
  modalStaffName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text},
  modalStaffEmail: {
    fontSize: 11,
    color: Colors.textSecondary},
  modalStaffRole: {
    fontSize: 10,
    color: Colors.textTertiary},
  accessLevelRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8},
  accessLevelOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.backgroundSecondary},
  accessLevelOptionText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  emailAccountsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6},
  emailAccountChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.backgroundSecondary},
  emailAccountChipDot: {
    width: 6,
    height: 6,
    borderRadius: 3},
  emailAccountChipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textTertiary},
  selectAllBtn: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 4},
  selectAllText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '600' as const},
  assignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 12},
  assignBtnDisabled: {
    opacity: 0.4},
  assignBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.background},
  modalInput: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border},
  modalTextarea: {
    minHeight: 100,
    textAlignVertical: 'top' as const},
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  switchInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  switchLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text},
  settingsModalScroll: {
    maxHeight: 400},
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 16},
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.background}});
