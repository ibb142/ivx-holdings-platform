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
  RefreshControl} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Mail,
  Users,
  Shield,
  X,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  Send,
  Settings,
  Trash2,
  UserPlus,
  Lock,
  Unlock,
  Search,
  Activity,
  Inbox,
  AlertTriangle} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { EMAIL_ACCOUNTS } from '@/mocks/emails';
import { teamMembers as mockTeamMembers } from '@/mocks/admin';
import { EmailAccount } from '@/types/email';

type AccessLevel = 'read' | 'send' | 'manage';

interface StaffEmailAccess {
  staffId: string;
  staffName: string;
  staffEmail: string;
  accessLevel: AccessLevel;
  assignedAt: string;
  lastAccessed: string | null;
}

interface EmailAccountWithAccess extends EmailAccount {
  staffAccess: StaffEmailAccess[];
  isActive: boolean;
  forwardTo: string | null;
  autoReply: boolean;
  storageUsed: number;
  storageLimit: number;
}

const ACCESS_LEVEL_CONFIG: Record<AccessLevel, { label: string; color: string; icon: typeof Eye }> = {
  read: { label: 'Read Only', color: '#4A90D9', icon: Eye },
  send: { label: 'Read & Send', color: '#00C48C', icon: Send },
  manage: { label: 'Full Access', color: '#FFD700', icon: Settings }};

const generateInitialAccess = (): EmailAccountWithAccess[] => {
  return EMAIL_ACCOUNTS.map((account) => {
    const staffAccess: StaffEmailAccess[] = [];

    if (account.id === 'admin') {
      staffAccess.push(
        { staffId: 'admin-1', staffName: 'IVXHOLDINGS CEO', staffEmail: 'ceo@ipxholding.com', accessLevel: 'manage', assignedAt: '2024-01-01T00:00:00Z', lastAccessed: '2026-03-05T09:00:00Z' },
        { staffId: 'admin-2', staffName: 'Sarah Martinez', staffEmail: 'operations@ipxholding.com', accessLevel: 'send', assignedAt: '2024-03-15T10:00:00Z', lastAccessed: '2026-03-04T16:30:00Z' },
      );
    } else if (account.id === 'ceo') {
      staffAccess.push(
        { staffId: 'admin-1', staffName: 'IVXHOLDINGS CEO', staffEmail: 'ceo@ipxholding.com', accessLevel: 'manage', assignedAt: '2024-01-01T00:00:00Z', lastAccessed: '2026-03-05T08:45:00Z' },
      );
    } else if (account.id === 'support') {
      staffAccess.push(
        { staffId: 'admin-4', staffName: 'Emily Johnson', staffEmail: 'support@ipxholding.com', accessLevel: 'manage', assignedAt: '2024-08-20T14:00:00Z', lastAccessed: '2026-03-05T08:45:00Z' },
        { staffId: 'admin-2', staffName: 'Sarah Martinez', staffEmail: 'operations@ipxholding.com', accessLevel: 'send', assignedAt: '2024-06-01T09:00:00Z', lastAccessed: '2026-03-03T14:20:00Z' },
        { staffId: 'admin-1', staffName: 'IVXHOLDINGS CEO', staffEmail: 'ceo@ipxholding.com', accessLevel: 'manage', assignedAt: '2024-01-01T00:00:00Z', lastAccessed: null },
      );
    } else if (account.id === 'kyc') {
      staffAccess.push(
        { staffId: 'admin-2', staffName: 'Sarah Martinez', staffEmail: 'operations@ipxholding.com', accessLevel: 'manage', assignedAt: '2024-03-15T10:00:00Z', lastAccessed: '2026-03-05T07:30:00Z' },
        { staffId: 'admin-4', staffName: 'Emily Johnson', staffEmail: 'support@ipxholding.com', accessLevel: 'read', assignedAt: '2024-09-01T09:00:00Z', lastAccessed: '2026-03-04T11:00:00Z' },
      );
    } else if (account.id === 'investors') {
      staffAccess.push(
        { staffId: 'admin-1', staffName: 'IVXHOLDINGS CEO', staffEmail: 'ceo@ipxholding.com', accessLevel: 'manage', assignedAt: '2024-01-01T00:00:00Z', lastAccessed: '2026-03-04T18:00:00Z' },
        { staffId: 'admin-3', staffName: 'Michael Chen', staffEmail: 'analyst@ipxholding.com', accessLevel: 'read', assignedAt: '2024-06-01T09:00:00Z', lastAccessed: '2026-03-03T10:15:00Z' },
      );
    } else if (account.id === 'legal') {
      staffAccess.push(
        { staffId: 'admin-1', staffName: 'IVXHOLDINGS CEO', staffEmail: 'ceo@ipxholding.com', accessLevel: 'manage', assignedAt: '2024-01-01T00:00:00Z', lastAccessed: '2026-03-04T15:00:00Z' },
      );
    } else if (account.id === 'finance') {
      staffAccess.push(
        { staffId: 'admin-1', staffName: 'IVXHOLDINGS CEO', staffEmail: 'ceo@ipxholding.com', accessLevel: 'manage', assignedAt: '2024-01-01T00:00:00Z', lastAccessed: '2026-03-05T07:00:00Z' },
        { staffId: 'admin-3', staffName: 'Michael Chen', staffEmail: 'analyst@ipxholding.com', accessLevel: 'send', assignedAt: '2024-06-01T09:00:00Z', lastAccessed: '2026-03-04T09:30:00Z' },
      );
    } else if (account.id === 'security') {
      staffAccess.push(
        { staffId: 'admin-1', staffName: 'IVXHOLDINGS CEO', staffEmail: 'ceo@ipxholding.com', accessLevel: 'manage', assignedAt: '2024-01-01T00:00:00Z', lastAccessed: '2026-03-04T22:00:00Z' },
      );
    } else if (account.id === 'noreply') {
      staffAccess.push(
        { staffId: 'admin-1', staffName: 'IVXHOLDINGS CEO', staffEmail: 'ceo@ipxholding.com', accessLevel: 'manage', assignedAt: '2024-01-01T00:00:00Z', lastAccessed: null },
      );
    }

    const storageMap: Record<string, number> = {
      admin: 2.4, ceo: 1.8, noreply: 0.1, support: 5.2, kyc: 3.7, investors: 2.1, legal: 4.3, finance: 3.9, security: 1.1};

    return {
      ...account,
      staffAccess,
      isActive: true,
      forwardTo: null,
      autoReply: account.id === 'noreply',
      storageUsed: (storageMap[account.id] ?? 0.5) * 1024,
      storageLimit: 15 * 1024};
  });
};

export default function EmailAccountsScreen() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<EmailAccountWithAccess[]>(generateInitialAccess);
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assigningAccount, setAssigningAccount] = useState<string | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [selectedAccessLevel, setSelectedAccessLevel] = useState<AccessLevel>('read');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const availableStaff = useMemo(() => {
    if (!assigningAccount) return [];
    const account = accounts.find(a => a.id === assigningAccount);
    const assignedIds = account?.staffAccess.map(s => s.staffId) ?? [];
    return mockTeamMembers.filter(m => !assignedIds.includes(m.id) && m.status !== 'invited');
  }, [assigningAccount, accounts]);

  const totalUnread = useMemo(() => accounts.reduce((sum, a) => sum + a.unreadCount, 0), [accounts]);
  const totalStaffAssigned = useMemo(() => {
    const uniqueStaff = new Set<string>();
    accounts.forEach(a => a.staffAccess.forEach(s => uniqueStaff.add(s.staffId)));
    return uniqueStaff.size;
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    if (!searchQuery.trim()) return accounts;
    const q = searchQuery.toLowerCase();
    return accounts.filter(a =>
      a.email.toLowerCase().includes(q) ||
      a.displayName.toLowerCase().includes(q) ||
      a.role.toLowerCase().includes(q)
    );
  }, [accounts, searchQuery]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const openAssignModal = useCallback((accountId: string) => {
    setAssigningAccount(accountId);
    setSelectedStaffId(null);
    setSelectedAccessLevel('read');
    setShowAssignModal(true);
  }, []);

  const handleAssignStaff = useCallback(() => {
    if (!selectedStaffId || !assigningAccount) return;
    const staff = mockTeamMembers.find(m => m.id === selectedStaffId);
    if (!staff) return;

    const newAccess: StaffEmailAccess = {
      staffId: staff.id,
      staffName: `${staff.firstName} ${staff.lastName}`,
      staffEmail: staff.email,
      accessLevel: selectedAccessLevel,
      assignedAt: new Date().toISOString(),
      lastAccessed: null};

    setAccounts(prev => prev.map(a =>
      a.id === assigningAccount
        ? { ...a, staffAccess: [...a.staffAccess, newAccess] }
        : a
    ));
    setShowAssignModal(false);
    Alert.alert('Access Granted', `${staff.firstName} ${staff.lastName} now has ${ACCESS_LEVEL_CONFIG[selectedAccessLevel].label} access to this mailbox.`);
  }, [selectedStaffId, assigningAccount, selectedAccessLevel]);

  const handleRemoveAccess = useCallback((accountId: string, staffId: string) => {
    const account = accounts.find(a => a.id === accountId);
    const staffAccess = account?.staffAccess.find(s => s.staffId === staffId);
    if (!staffAccess) return;

    Alert.alert(
      'Remove Access',
      `Remove ${staffAccess.staffName}'s access to ${account?.email}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setAccounts(prev => prev.map(a =>
              a.id === accountId
                ? { ...a, staffAccess: a.staffAccess.filter(s => s.staffId !== staffId) }
                : a
            ));
          }},
      ]
    );
  }, [accounts]);

  const handleChangeAccessLevel = useCallback((accountId: string, staffId: string) => {
    const account = accounts.find(a => a.id === accountId);
    const staffAccess = account?.staffAccess.find(s => s.staffId === staffId);
    if (!staffAccess) return;

    const levels: AccessLevel[] = ['read', 'send', 'manage'];
    const currentIndex = levels.indexOf(staffAccess.accessLevel);
    const nextLevel = levels[(currentIndex + 1) % levels.length];

    setAccounts(prev => prev.map(a =>
      a.id === accountId
        ? {
          ...a,
          staffAccess: a.staffAccess.map(s =>
            s.staffId === staffId ? { ...s, accessLevel: nextLevel } : s
          )}
        : a
    ));
  }, [accounts]);

  const toggleAccountActive = useCallback((accountId: string) => {
    if (accountId === 'admin' || accountId === 'ceo') {
      Alert.alert('Protected', 'This email account cannot be deactivated.');
      return;
    }
    setAccounts(prev => prev.map(a =>
      a.id === accountId ? { ...a, isActive: !a.isActive } : a
    ));
  }, []);

  const formatTime = useCallback((dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }, []);

  const formatStorage = useCallback((mb: number) => {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${mb.toFixed(0)} MB`;
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="back-btn">
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Email Accounts</Text>
          <Text style={styles.headerSubtitle}>Staff access & permissions</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statPill}>
          <Mail size={14} color={Colors.primary} />
          <Text style={styles.statValue}>{accounts.length}</Text>
          <Text style={styles.statLabel}>Mailboxes</Text>
        </View>
        <View style={styles.statPill}>
          <Users size={14} color={Colors.accent} />
          <Text style={styles.statValue}>{totalStaffAssigned}</Text>
          <Text style={styles.statLabel}>Staff</Text>
        </View>
        <View style={styles.statPill}>
          <Inbox size={14} color={Colors.warning} />
          <Text style={styles.statValue}>{totalUnread}</Text>
          <Text style={styles.statLabel}>Unread</Text>
        </View>
        <View style={styles.statPill}>
          <Activity size={14} color={Colors.success} />
          <Text style={styles.statValue}>{accounts.filter(a => a.isActive).length}</Text>
          <Text style={styles.statLabel}>Active</Text>
        </View>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Search size={16} color={Colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search email accounts..."
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

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {filteredAccounts.map((account) => {
          const isExpanded = expandedAccount === account.id;
          const storagePercent = Math.round((account.storageUsed / account.storageLimit) * 100);

          return (
            <View key={account.id} style={styles.accountCard}>
              <TouchableOpacity
                style={styles.accountHeader}
                onPress={() => setExpandedAccount(isExpanded ? null : account.id)}
                activeOpacity={0.7}
                testID={`account-${account.id}`}
              >
                <View style={[styles.accountAvatar, { backgroundColor: account.color + '22' }]}>
                  <Text style={[styles.accountAvatarText, { color: account.color }]}>
                    {account.avatar}
                  </Text>
                </View>
                <View style={styles.accountInfo}>
                  <View style={styles.accountNameRow}>
                    <Text style={styles.accountName}>{account.displayName}</Text>
                    {!account.isActive && (
                      <View style={styles.inactiveBadge}>
                        <Text style={styles.inactiveBadgeText}>Inactive</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.accountEmail}>{account.email}</Text>
                  <View style={styles.accountMeta}>
                    <View style={styles.accessCountBadge}>
                      <Users size={10} color={Colors.textSecondary} />
                      <Text style={styles.accessCountText}>{account.staffAccess.length} staff</Text>
                    </View>
                    {account.unreadCount > 0 && (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadText}>{account.unreadCount} unread</Text>
                      </View>
                    )}
                  </View>
                </View>
                {isExpanded ? (
                  <ChevronUp size={20} color={Colors.textTertiary} />
                ) : (
                  <ChevronDown size={20} color={Colors.textTertiary} />
                )}
              </TouchableOpacity>

              {isExpanded && (
                <View style={styles.accountExpanded}>
                  <View style={styles.accountDetailsRow}>
                    <View style={styles.accountDetail}>
                      <Text style={styles.accountDetailLabel}>Role</Text>
                      <Text style={styles.accountDetailValue}>{account.role}</Text>
                    </View>
                    <View style={styles.accountDetail}>
                      <Text style={styles.accountDetailLabel}>Auto-Reply</Text>
                      <Text style={[styles.accountDetailValue, { color: account.autoReply ? Colors.success : Colors.textTertiary }]}>
                        {account.autoReply ? 'On' : 'Off'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.storageRow}>
                    <Text style={styles.storageLabel}>Storage</Text>
                    <View style={styles.storageBarOuter}>
                      <View style={[styles.storageBarInner, {
                        width: `${Math.min(100, storagePercent)}%`,
                        backgroundColor: storagePercent > 80 ? Colors.error : storagePercent > 60 ? Colors.warning : Colors.accent}]} />
                    </View>
                    <Text style={styles.storageText}>
                      {formatStorage(account.storageUsed)} / {formatStorage(account.storageLimit)}
                    </Text>
                  </View>

                  <View style={styles.accountActions}>
                    <TouchableOpacity
                      style={[styles.accountActionBtn, { borderColor: account.isActive ? Colors.warning + '40' : Colors.success + '40' }]}
                      onPress={() => toggleAccountActive(account.id)}
                    >
                      {account.isActive ? <Lock size={14} color={Colors.warning} /> : <Unlock size={14} color={Colors.success} />}
                      <Text style={[styles.accountActionText, { color: account.isActive ? Colors.warning : Colors.success }]}>
                        {account.isActive ? 'Deactivate' : 'Activate'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.accountActionBtn, { borderColor: Colors.primary + '40' }]}
                      onPress={() => router.push('/email' as any)}
                    >
                      <Inbox size={14} color={Colors.primary} />
                      <Text style={[styles.accountActionText, { color: Colors.primary }]}>Open Inbox</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.staffSection}>
                    <View style={styles.staffSectionHeader}>
                      <Text style={styles.staffSectionTitle}>Staff Access</Text>
                      <TouchableOpacity
                        style={styles.addStaffBtn}
                        onPress={() => openAssignModal(account.id)}
                      >
                        <UserPlus size={14} color={Colors.background} />
                        <Text style={styles.addStaffBtnText}>Add</Text>
                      </TouchableOpacity>
                    </View>

                    {account.staffAccess.length === 0 && (
                      <View style={styles.noStaff}>
                        <AlertTriangle size={18} color={Colors.warning} />
                        <Text style={styles.noStaffText}>No staff assigned</Text>
                      </View>
                    )}

                    {account.staffAccess.map((access) => {
                      const levelConfig = ACCESS_LEVEL_CONFIG[access.accessLevel];
                      const LevelIcon = levelConfig.icon;

                      return (
                        <View key={access.staffId} style={styles.staffCard}>
                          <View style={styles.staffCardLeft}>
                            <View style={[styles.staffAvatar, { backgroundColor: levelConfig.color + '18' }]}>
                              <Text style={[styles.staffAvatarText, { color: levelConfig.color }]}>
                                {access.staffName.charAt(0)}
                              </Text>
                            </View>
                            <View style={styles.staffInfo}>
                              <Text style={styles.staffName}>{access.staffName}</Text>
                              <Text style={styles.staffEmail}>{access.staffEmail}</Text>
                              <Text style={styles.staffLastAccess}>
                                Last: {formatTime(access.lastAccessed)}
                              </Text>
                            </View>
                          </View>
                          <View style={styles.staffCardRight}>
                            <TouchableOpacity
                              style={[styles.accessLevelBadge, { backgroundColor: levelConfig.color + '18' }]}
                              onPress={() => handleChangeAccessLevel(account.id, access.staffId)}
                            >
                              <LevelIcon size={11} color={levelConfig.color} />
                              <Text style={[styles.accessLevelText, { color: levelConfig.color }]}>
                                {levelConfig.label}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.removeAccessBtn}
                              onPress={() => handleRemoveAccess(account.id, access.staffId)}
                            >
                              <Trash2 size={14} color={Colors.error} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          );
        })}

        {filteredAccounts.length === 0 && (
          <View style={styles.emptyState}>
            <Mail size={44} color={Colors.textTertiary} />
            <Text style={styles.emptyText}>No email accounts found</Text>
          </View>
        )}

        <View style={styles.legendSection}>
          <Text style={styles.legendTitle}>Access Levels</Text>
          {(Object.entries(ACCESS_LEVEL_CONFIG) as [AccessLevel, typeof ACCESS_LEVEL_CONFIG['read']][]).map(([key, config]) => {
            const LegendIcon = config.icon;
            return (
              <View key={key} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: config.color }]} />
                <LegendIcon size={14} color={config.color} />
                <Text style={styles.legendLabel}>{config.label}</Text>
                <Text style={styles.legendDesc}>
                  {key === 'read' ? 'View emails only' : key === 'send' ? 'View & compose emails' : 'Full control, settings, delete'}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      <Modal
        visible={showAssignModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAssignModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Assign Staff Access</Text>
              <TouchableOpacity onPress={() => setShowAssignModal(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              Mailbox: {accounts.find(a => a.id === assigningAccount)?.email}
            </Text>

            <Text style={styles.modalSectionLabel}>Select Staff Member</Text>
            <ScrollView style={styles.staffList} showsVerticalScrollIndicator={false}>
              {availableStaff.length === 0 ? (
                <View style={styles.noStaffAvail}>
                  <Text style={styles.noStaffAvailText}>All active staff members already have access.</Text>
                </View>
              ) : (
                availableStaff.map((staff) => (
                  <TouchableOpacity
                    key={staff.id}
                    style={[styles.staffSelectItem, selectedStaffId === staff.id && styles.staffSelectItemActive]}
                    onPress={() => setSelectedStaffId(staff.id)}
                  >
                    <View style={styles.staffSelectLeft}>
                      <View style={[styles.staffSelectAvatar, selectedStaffId === staff.id && styles.staffSelectAvatarActive]}>
                        <Text style={[styles.staffSelectAvatarText, selectedStaffId === staff.id && styles.staffSelectAvatarTextActive]}>
                          {staff.firstName[0]}{staff.lastName[0]}
                        </Text>
                      </View>
                      <View>
                        <Text style={styles.staffSelectName}>{staff.firstName} {staff.lastName}</Text>
                        <Text style={styles.staffSelectEmail}>{staff.email}</Text>
                        <Text style={styles.staffSelectRole}>{staff.role.name}</Text>
                      </View>
                    </View>
                    {selectedStaffId === staff.id && (
                      <Check size={20} color={Colors.primary} />
                    )}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            {selectedStaffId && (
              <>
                <Text style={styles.modalSectionLabel}>Access Level</Text>
                <View style={styles.accessLevelSelector}>
                  {(Object.entries(ACCESS_LEVEL_CONFIG) as [AccessLevel, typeof ACCESS_LEVEL_CONFIG['read']][]).map(([level, config]) => {
                    const LvlIcon = config.icon;
                    return (
                      <TouchableOpacity
                        key={level}
                        style={[
                          styles.accessLevelOption,
                          selectedAccessLevel === level && { borderColor: config.color, backgroundColor: config.color + '12' },
                        ]}
                        onPress={() => setSelectedAccessLevel(level as AccessLevel)}
                      >
                        <LvlIcon size={16} color={selectedAccessLevel === level ? config.color : Colors.textSecondary} />
                        <Text style={[
                          styles.accessLevelOptionText,
                          selectedAccessLevel === level && { color: config.color },
                        ]}>
                          {config.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            <TouchableOpacity
              style={[styles.assignBtn, !selectedStaffId && styles.assignBtnDisabled]}
              onPress={handleAssignStaff}
              disabled={!selectedStaffId}
            >
              <Shield size={16} color={Colors.background} />
              <Text style={styles.assignBtnText}>Grant Access</Text>
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
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8},
  statPill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border},
  statValue: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.text},
  statLabel: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontWeight: '600' as const},
  searchRow: {
    paddingHorizontal: 14,
    paddingBottom: 10},
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
  content: {
    flex: 1,
    paddingHorizontal: 14},
  accountCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden'},
  accountHeader: {
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
  accountInfo: {
    flex: 1,
    gap: 3},
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
  accountMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2},
  accessCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4},
  accessCountText: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '600' as const},
  unreadBadge: {
    backgroundColor: Colors.warning + '20',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2},
  unreadText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.warning},
  accountExpanded: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border},
  accountDetailsRow: {
    flexDirection: 'row',
    gap: 16,
    paddingVertical: 12},
  accountDetail: {
    flex: 1},
  accountDetailLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '600' as const,
    marginBottom: 4},
  accountDetailValue: {
    fontSize: 13,
    color: Colors.text,
    fontWeight: '600' as const},
  storageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 12},
  storageLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '600' as const,
    width: 50},
  storageBarOuter: {
    flex: 1,
    height: 6,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 3,
    overflow: 'hidden'},
  storageBarInner: {
    height: '100%',
    borderRadius: 3},
  storageText: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontWeight: '600' as const,
    minWidth: 90,
    textAlign: 'right' as const},
  accountActions: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 14},
  accountActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1},
  accountActionText: {
    fontSize: 12,
    fontWeight: '600' as const},
  staffSection: {
    gap: 8},
  staffSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4},
  staffSectionTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text},
  addStaffBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 10},
  addStaffBtnText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.background},
  noStaff: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    justifyContent: 'center'},
  noStaffText: {
    fontSize: 13,
    color: Colors.warning,
    fontWeight: '600' as const},
  staffCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 10},
  staffCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1},
  staffAvatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center'},
  staffAvatarText: {
    fontSize: 14,
    fontWeight: '700' as const},
  staffInfo: {
    flex: 1,
    gap: 1},
  staffName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text},
  staffEmail: {
    fontSize: 11,
    color: Colors.textSecondary},
  staffLastAccess: {
    fontSize: 10,
    color: Colors.textTertiary},
  staffCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  accessLevelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6},
  accessLevelText: {
    fontSize: 10,
    fontWeight: '700' as const},
  removeAccessBtn: {
    padding: 4},
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 12},
  emptyText: {
    fontSize: 16,
    color: Colors.textTertiary},
  legendSection: {
    marginTop: 16,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10},
  legendTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4},
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3},
  legendLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.text,
    minWidth: 80},
  legendDesc: {
    fontSize: 11,
    color: Colors.textTertiary,
    flex: 1},
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end'},
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '85%'},
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8},
  modalTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text},
  modalSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 16},
  modalSectionLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 10,
    marginTop: 4},
  staffList: {
    maxHeight: 220,
    marginBottom: 12},
  noStaffAvail: {
    alignItems: 'center',
    paddingVertical: 20},
  noStaffAvailText: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center'},
  staffSelectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.border},
  staffSelectItemActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '10'},
  staffSelectLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1},
  staffSelectAvatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border},
  staffSelectAvatarActive: {
    backgroundColor: Colors.primary + '20',
    borderColor: Colors.primary},
  staffSelectAvatarText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.textSecondary},
  staffSelectAvatarTextActive: {
    color: Colors.primary},
  staffSelectName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text},
  staffSelectEmail: {
    fontSize: 11,
    color: Colors.textSecondary},
  staffSelectRole: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 1},
  accessLevelSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16},
  accessLevelOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.backgroundSecondary},
  accessLevelOptionText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  assignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14},
  assignBtnDisabled: {
    opacity: 0.4},
  assignBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.background}});
