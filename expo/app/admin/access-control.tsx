import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  Switch,
  RefreshControl,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield,
  ChevronRight,
  Search,
  X,
    UserCog,
  Lock,
  Unlock,
  LogOut,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Plus,
  Trash2,
  FileText,
  Users,
  Clock,
  KeyRound,
  Smartphone,
  Zap,
} from 'lucide-react-native';
import IVXBrandIcon from '@/components/IVXBrandIcon';
import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import {
  fetchRolesAndAssignments,
  assignRoleToUser,
  revokeRoleFromUser,
  setAssignmentStatus,
  forceLogoutUser,
  clearForceLogout,
  updateUserScreens,
  setMfaRequirement,
  createAccessTemplate,
  deleteAccessTemplate,
  type IVXRoleName,
  type IVXScreenPermission,
  type IVXAccessScope,
  type IVXRoleAssignment,
  type IVXRoleDefinition,
  ALL_IVX_ROLES,
  ALL_IVX_SCREENS,
  IVX_ACCESS_SCOPES,
} from '@/lib/access-control-service';

type Tab = 'users' | 'roles' | 'templates' | 'groups';

export default function AccessControlScreen() {
  const router = useRouter();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const rolesQuery = useQuery({
    queryKey: ['ivx-access-control'],
    queryFn: fetchRolesAndAssignments,
  });

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['ivx-access-control'] });
  }, [queryClient]);

  const assignMutation = useMutation({
    mutationFn: assignRoleToUser,
    onSuccess: () => { invalidateAll(); setShowAssignModal(false); },
    onError: (e: Error) => Alert.alert('Assignment Failed', e.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (userId: string) => revokeRoleFromUser(userId),
    onSuccess: () => invalidateAll(),
    onError: (e: Error) => Alert.alert('Revoke Failed', e.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: 'active' | 'suspended' }) =>
      setAssignmentStatus(userId, status),
    onSuccess: () => invalidateAll(),
    onError: (e: Error) => Alert.alert('Status Change Failed', e.message),
  });

  const forceLogoutMutation = useMutation({
    mutationFn: (userId: string) => forceLogoutUser(userId),
    onSuccess: () => invalidateAll(),
    onError: (e: Error) => Alert.alert('Force Logout Failed', e.message),
  });

  const clearForceLogoutMutation = useMutation({
    mutationFn: (userId: string) => clearForceLogout(userId),
    onSuccess: () => invalidateAll(),
    onError: (e: Error) => Alert.alert('Clear Force Logout Failed', e.message),
  });

  const updateScreensMutation = useMutation({
    mutationFn: ({ userId, screens }: { userId: string; screens: IVXScreenPermission[] }) =>
      updateUserScreens(userId, screens),
    onSuccess: () => invalidateAll(),
    onError: (e: Error) => Alert.alert('Screen Update Failed', e.message),
  });

  const mfaMutation = useMutation({
    mutationFn: ({ userId, requireMfa }: { userId: string; requireMfa: boolean }) =>
      setMfaRequirement(userId, requireMfa),
    onSuccess: () => invalidateAll(),
    onError: (e: Error) => Alert.alert('MFA Update Failed', e.message),
  });

  const createTemplateMutation = useMutation({
    mutationFn: createAccessTemplate,
    onSuccess: () => { invalidateAll(); setShowTemplateModal(false); },
    onError: (e: Error) => Alert.alert('Template Creation Failed', e.message),
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: (id: string) => deleteAccessTemplate(id),
    onSuccess: () => invalidateAll(),
    onError: (e: Error) => Alert.alert('Template Deletion Failed', e.message),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['ivx-access-control'] });
    setRefreshing(false);
  }, [queryClient]);

  const assignments = rolesQuery.data?.assignments ?? [];
  const definitions = rolesQuery.data?.definitions ?? [];
  const templates = rolesQuery.data?.templates ?? [];
  const groups = rolesQuery.data?.groups ?? [];

  const filteredAssignments = useMemo(() => {
    if (!searchQuery.trim()) return assignments;
    const q = searchQuery.toLowerCase();
    return assignments.filter(
      (a) =>
        a.userEmail.toLowerCase().includes(q) ||
        a.userId.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q),
    );
  }, [assignments, searchQuery]);

  const selectedAssignment = useMemo(
    () => assignments.find((a) => a.userId === selectedUserId) ?? null,
    [assignments, selectedUserId],
  );

  const getRoleDisplayName = useCallback(
    (role: string): string => {
      const def = definitions.find((d) => d.name === role);
      return def?.displayName ?? ALL_IVX_ROLES.find((r) => r.value === role)?.label ?? role;
    },
    [definitions],
  );

  const getRoleScreens = useCallback(
    (role: string): IVXScreenPermission[] => {
      const def = definitions.find((d) => d.name === role);
      return (def?.screens ?? []) as IVXScreenPermission[];
    },
    [definitions],
  );

  const handleRevoke = useCallback((userId: string, email: string) => {
    Alert.alert(
      'Revoke Access',
      `Remove all access for ${email}? This immediately revokes their role and screens.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => revokeMutation.mutate(userId),
        },
      ],
    );
  }, [revokeMutation]);

  const handleForceLogout = useCallback((userId: string, email: string) => {
    Alert.alert(
      'Force Logout',
      `Force logout ${email}? Their session will be revoked immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Force Logout',
          style: 'destructive',
          onPress: () => forceLogoutMutation.mutate(userId),
        },
      ],
    );
  }, [forceLogoutMutation]);

  if (rolesQuery.isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading access control...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.push('/admin')}>
          <ChevronRight size={22} color={Colors.text} style={{ transform: [{ rotate: '180deg' }] }} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Access Control</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setShowAssignModal(true)}
        >
          <Plus size={22} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabBar}>
        {([
          { id: 'users' as const, label: 'Users', icon: UserCog },
          { id: 'roles' as const, label: 'Roles', icon: Shield },
          { id: 'templates' as const, label: 'Templates', icon: FileText },
          { id: 'groups' as const, label: 'Groups', icon: Users },
        ]).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Icon size={16} color={active ? Colors.primary : Colors.muted} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {activeTab === 'users' && (
        <>
          <View style={styles.searchBar}>
            <Search size={18} color={Colors.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by email, user ID, or role..."
              placeholderTextColor={Colors.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <X size={18} color={Colors.muted} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView
            style={styles.content}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
            }
          >
            {filteredAssignments.length === 0 && (
              <View style={styles.emptyState}>
                <Shield size={48} color={Colors.muted} />
                <Text style={styles.emptyText}>No assignments found</Text>
                <Text style={styles.emptySubtext}>
                  {searchQuery ? 'Try a different search' : 'Assign a role to get started'}
                </Text>
              </View>
            )}

            {filteredAssignments.map((assignment) => (
              <AssignmentCard
                key={assignment.id}
                assignment={assignment}
                roleDisplayName={getRoleDisplayName(assignment.role)}
                onSelect={() => setSelectedUserId(assignment.userId)}
                onRevoke={() => handleRevoke(assignment.userId, assignment.userEmail)}
                onForceLogout={() => handleForceLogout(assignment.userId, assignment.userEmail)}
                onClearForceLogout={() => clearForceLogoutMutation.mutate(assignment.userId)}
                onToggleStatus={() =>
                  statusMutation.mutate({
                    userId: assignment.userId,
                    status: assignment.status === 'active' ? 'suspended' : 'active',
                  })
                }
                onToggleMfa={() =>
                  mfaMutation.mutate({
                    userId: assignment.userId,
                    requireMfa: !assignment.requireMfa,
                  })
                }
                selected={selectedUserId === assignment.userId}
              />
            ))}
          </ScrollView>
        </>
      )}

      {activeTab === 'roles' && (
        <ScrollView style={styles.content}>
          {definitions.map((def) => (
            <RoleDefinitionCard
              key={def.name}
              definition={def}
              assignmentCount={assignments.filter((a) => a.role === def.name).length}
            />
          ))}
        </ScrollView>
      )}

      {activeTab === 'templates' && (
        <ScrollView style={styles.content}>
          <TouchableOpacity
            style={styles.addCard}
            onPress={() => setShowTemplateModal(true)}
          >
            <Plus size={20} color={Colors.primary} />
            <Text style={styles.addCardText}>Create Access Template</Text>
          </TouchableOpacity>

          {templates.length === 0 && (
            <View style={styles.emptyState}>
              <FileText size={48} color={Colors.muted} />
              <Text style={styles.emptyText}>No templates yet</Text>
              <Text style={styles.emptySubtext}>Create reusable access templates</Text>
            </View>
          )}

          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              roleDisplayName={getRoleDisplayName(template.role)}
              onDelete={() => deleteTemplateMutation.mutate(template.id)}
            />
          ))}
        </ScrollView>
      )}

      {activeTab === 'groups' && (
        <ScrollView style={styles.content}>
          <View style={styles.emptyState}>
            <Users size={48} color={Colors.muted} />
            <Text style={styles.emptyText}>No groups yet</Text>
            <Text style={styles.emptySubtext}>Access groups coming soon</Text>
          </View>
          {groups.map((group) => (
            <View key={group.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{group.name}</Text>
                <Text style={styles.cardBadge}>{group.memberIds.length} members</Text>
              </View>
              {group.description ? <Text style={styles.cardDesc}>{group.description}</Text> : null}
            </View>
          ))}
        </ScrollView>
      )}

      {showAssignModal && (
        <AssignRoleModal
          visible={showAssignModal}
          onClose={() => setShowAssignModal(false)}
          onAssign={(input) => assignMutation.mutate(input)}
          loading={assignMutation.isPending}
          definitions={definitions}
          getRoleScreens={getRoleScreens}
        />
      )}

      {showTemplateModal && (
        <CreateTemplateModal
          visible={showTemplateModal}
          onClose={() => setShowTemplateModal(false)}
          onCreate={(input) => createTemplateMutation.mutate(input)}
          loading={createTemplateMutation.isPending}
        />
      )}

      {selectedAssignment && (
        <UserDetailModal
          assignment={selectedAssignment}
          roleDisplayName={getRoleDisplayName(selectedAssignment.role)}
          getRoleScreens={getRoleScreens}
          visible={!!selectedUserId}
          onClose={() => setSelectedUserId(null)}
          onUpdateScreens={(screens) =>
            updateScreensMutation.mutate({ userId: selectedAssignment.userId, screens })
          }
          onForceLogout={() => handleForceLogout(selectedAssignment.userId, selectedAssignment.userEmail)}
          onClearForceLogout={() => clearForceLogoutMutation.mutate(selectedAssignment.userId)}
          onToggleStatus={() =>
            statusMutation.mutate({
              userId: selectedAssignment.userId,
              status: selectedAssignment.status === 'active' ? 'suspended' : 'active',
            })
          }
          onToggleMfa={() =>
            mfaMutation.mutate({
              userId: selectedAssignment.userId,
              requireMfa: !selectedAssignment.requireMfa,
            })
          }
          onRevoke={() => handleRevoke(selectedAssignment.userId, selectedAssignment.userEmail)}
        />
      )}
    </SafeAreaView>
  );
}

function AssignmentCard({
  assignment,
  roleDisplayName,
  onSelect,
  onRevoke,
  onForceLogout,
  onClearForceLogout,
  onToggleStatus,
  onToggleMfa,
  selected,
}: {
  assignment: IVXRoleAssignment;
  roleDisplayName: string;
  onSelect: () => void;
  onRevoke: () => void;
  onForceLogout: () => void;
  onClearForceLogout: () => void;
  onToggleStatus: () => void;
  onToggleMfa: () => void;
  selected: boolean;
}) {
  const isExpired = assignment.expirationDate
    ? new Date(assignment.expirationDate).getTime() < Date.now()
    : false;

  return (
    <TouchableOpacity
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onSelect}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardLeftSection}>
          <View style={[styles.roleBadge, assignment.status === 'suspended' && styles.roleBadgeSuspended]}>
            <IVXBrandIcon size={12} />
            <Text
              style={[
                styles.roleBadgeText,
                assignment.status === 'suspended' && styles.roleBadgeTextSuspended,
              ]}
            >
              {roleDisplayName}
            </Text>
          </View>
          <Text style={styles.cardEmail}>{assignment.userEmail || assignment.userId}</Text>
        </View>
        <View style={styles.statusRow}>
          {assignment.forceLogout && (
            <View style={styles.statusPillDanger}>
              <LogOut size={10} color="#FF4444" />
              <Text style={styles.statusPillTextDanger}>Force Logout</Text>
            </View>
          )}
          {assignment.status === 'suspended' && (
            <View style={styles.statusPillWarn}>
              <AlertTriangle size={10} color="#FFA500" />
              <Text style={styles.statusPillTextWarn}>Suspended</Text>
            </View>
          )}
          {isExpired && (
            <View style={styles.statusPillDanger}>
              <Clock size={10} color="#FF4444" />
              <Text style={styles.statusPillTextDanger}>Expired</Text>
            </View>
          )}
          {assignment.requireMfa && (
            <View style={styles.statusPillInfo}>
              <KeyRound size={10} color={Colors.primary} />
              <Text style={styles.statusPillTextInfo}>MFA</Text>
            </View>
          )}
          {assignment.status === 'active' && !assignment.forceLogout && !isExpired && (
            <View style={styles.statusPillGood}>
              <CheckCircle2 size={10} color="#00C853" />
              <Text style={styles.statusPillTextGood}>Active</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.cardMetaRow}>
        <Text style={styles.cardMetaText}>
          Scope: {assignment.dataScope} · Screens: {assignment.screens.length || 'role default'}
        </Text>
      </View>

      {assignment.startDate && (
        <Text style={styles.cardMetaSubtext}>Start: {assignment.startDate.split('T')[0]}</Text>
      )}
      {assignment.expirationDate && (
        <Text style={styles.cardMetaSubtext}>Expires: {assignment.expirationDate.split('T')[0]}</Text>
      )}

      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.cardAction} onPress={onToggleStatus}>
          {assignment.status === 'active' ? (
            <>
              <Lock size={14} color={Colors.muted} />
              <Text style={styles.cardActionText}>Suspend</Text>
            </>
          ) : (
            <>
              <Unlock size={14} color={Colors.primary} />
              <Text style={[styles.cardActionText, { color: Colors.primary }]}>Activate</Text>
            </>
          )}
        </TouchableOpacity>

        {assignment.forceLogout ? (
          <TouchableOpacity style={styles.cardAction} onPress={onClearForceLogout}>
            <Unlock size={14} color={Colors.primary} />
            <Text style={[styles.cardActionText, { color: Colors.primary }]}>Clear Lock</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.cardAction} onPress={onForceLogout}>
            <LogOut size={14} color="#FF4444" />
            <Text style={[styles.cardActionText, { color: '#FF4444' }]}>Force Logout</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.cardAction} onPress={onToggleMfa}>
          <KeyRound size={14} color={assignment.requireMfa ? Colors.primary : Colors.muted} />
          <Text style={[styles.cardActionText, { color: assignment.requireMfa ? Colors.primary : Colors.muted }]}>
            {assignment.requireMfa ? 'MFA On' : 'MFA Off'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.cardAction, { marginLeft: 'auto' }]} onPress={onRevoke}>
          <Trash2 size={14} color="#FF4444" />
          <Text style={[styles.cardActionText, { color: '#FF4444' }]}>Revoke</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

function RoleDefinitionCard({
  definition,
  assignmentCount,
}: {
  definition: IVXRoleDefinition;
  assignmentCount: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => setExpanded((v) => !v)}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardLeftSection}>
          <View style={styles.roleBadge}>
            <Shield size={12} color={Colors.primary} />
            <Text style={styles.roleBadgeText}>{definition.displayName}</Text>
          </View>
          <Text style={styles.cardEmail}>{definition.name}</Text>
        </View>
        <View style={styles.statusRow}>
          <View style={styles.statusPillInfo}>
            <Users size={10} color={Colors.primary} />
            <Text style={styles.statusPillTextInfo}>{assignmentCount} assigned</Text>
          </View>
          {definition.isSystem && (
            <View style={styles.statusPillGood}>
              <CheckCircle2 size={10} color="#00C853" />
              <Text style={styles.statusPillTextGood}>System</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.cardMetaRow}>
        <Text style={styles.cardMetaText}>
          {definition.permissions.length} permissions · {definition.screens.length} screens
        </Text>
      </View>

      {expanded && (
        <View style={styles.expandedSection}>
          <Text style={styles.expandedSectionTitle}>Screens</Text>
          <View style={styles.chipRow}>
            {definition.screens.map((screen) => {
              const screenMeta = ALL_IVX_SCREENS.find((s) => s.value === screen);
              return (
                <View key={screen} style={styles.chip}>
                  <Text style={styles.chipText}>{screenMeta?.label ?? screen}</Text>
                </View>
              );
            })}
          </View>

          <Text style={[styles.expandedSectionTitle, { marginTop: 12 }]}>Permissions</Text>
          <View style={styles.chipRow}>
            {definition.permissions.map((perm) => (
              <View key={perm} style={styles.chipPerm}>
                <Text style={styles.chipText}>{perm}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

function TemplateCard({
  template,
  roleDisplayName,
  onDelete,
}: {
  template: { id: string; name: string; description: string; role: string; screens: string[]; dataScope: string; permissions: string[]; createdAt: string };
  roleDisplayName: string;
  onDelete: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardLeftSection}>
          <View style={styles.roleBadge}>
            <FileText size={12} color={Colors.primary} />
            <Text style={styles.roleBadgeText}>{template.name}</Text>
          </View>
          <Text style={styles.cardEmail}>{roleDisplayName}</Text>
        </View>
        <TouchableOpacity onPress={onDelete}>
          <Trash2 size={16} color="#FF4444" />
        </TouchableOpacity>
      </View>

      {template.description ? <Text style={styles.cardDesc}>{template.description}</Text> : null}

      <View style={styles.cardMetaRow}>
        <Text style={styles.cardMetaText}>
          Scope: {template.dataScope} · {template.screens.length} screens · {template.permissions.length} permissions
        </Text>
      </View>

      {template.screens.length > 0 && (
        <View style={styles.chipRow}>
          {template.screens.slice(0, 5).map((screen) => {
            const screenMeta = ALL_IVX_SCREENS.find((s) => s.value === screen);
            return (
              <View key={screen} style={styles.chip}>
                <Text style={styles.chipText}>{screenMeta?.label ?? screen}</Text>
              </View>
            );
          })}
          {template.screens.length > 5 && (
            <View style={styles.chip}>
              <Text style={styles.chipText}>+{template.screens.length - 5} more</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function AssignRoleModal({
  visible,
  onClose,
  onAssign,
  loading,
  definitions,
  getRoleScreens,
}: {
  visible: boolean;
  onClose: () => void;
  onAssign: (input: {
    userId: string;
    userEmail: string;
    role: IVXRoleName;
    screens: IVXScreenPermission[];
    dataScope: IVXAccessScope;
    startDate: string | null;
    expirationDate: string | null;
    requireMfa: boolean;
  }) => void;
  loading: boolean;
  definitions: IVXRoleDefinition[];
  getRoleScreens: (role: string) => IVXScreenPermission[];
}) {
  const [userId, setUserId] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [role, setRole] = useState<IVXRoleName>('investor');
  const [dataScope, setDataScope] = useState<IVXAccessScope>('assigned');
  const [requireMfa, setRequireMfa] = useState(false);
  const [selectedScreens, setSelectedScreens] = useState<IVXScreenPermission[]>([]);

  const handleRoleChange = (newRole: IVXRoleName) => {
    setRole(newRole);
    setSelectedScreens(getRoleScreens(newRole));
  };

  const toggleScreen = (screen: IVXScreenPermission) => {
    setSelectedScreens((prev) =>
      prev.includes(screen) ? prev.filter((s) => s !== screen) : [...prev, screen],
    );
  };

  const handleAssign = () => {
    if (!userId.trim()) {
      Alert.alert('Missing User ID', 'Enter the user ID to assign a role.');
      return;
    }
    onAssign({
      userId: userId.trim(),
      userEmail: userEmail.trim(),
      role,
      screens: selectedScreens,
      dataScope,
      startDate: null,
      expirationDate: null,
      requireMfa,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Assign Role</Text>
          <TouchableOpacity onPress={onClose}>
            <X size={24} color={Colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent}>
          <Text style={styles.inputLabel}>User ID</Text>
          <TextInput
            style={styles.textInput}
            placeholder="Supabase user UUID"
            placeholderTextColor={Colors.muted}
            value={userId}
            onChangeText={setUserId}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.inputLabel}>User Email (optional)</Text>
          <TextInput
            style={styles.textInput}
            placeholder="user@example.com"
            placeholderTextColor={Colors.muted}
            value={userEmail}
            onChangeText={setUserEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />

          <Text style={styles.inputLabel}>Role</Text>
          <View style={styles.pickerRow}>
            {ALL_IVX_ROLES.map((r) => (
              <TouchableOpacity
                key={r.value}
                style={[styles.pickerChip, role === r.value && styles.pickerChipActive]}
                onPress={() => handleRoleChange(r.value)}
              >
                <Text style={[styles.pickerChipText, role === r.value && styles.pickerChipTextActive]}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.inputLabel}>Data Scope</Text>
          <View style={styles.pickerRow}>
            {IVX_ACCESS_SCOPES.map((s) => (
              <TouchableOpacity
                key={s.value}
                style={[styles.pickerChip, dataScope === s.value && styles.pickerChipActive]}
                onPress={() => setDataScope(s.value)}
              >
                <Text style={[styles.pickerChipText, dataScope === s.value && styles.pickerChipTextActive]}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.inputLabel}>Screens ({selectedScreens.length} selected)</Text>
          <View style={styles.screensGrid}>
            {ALL_IVX_SCREENS.map((screen) => {
              const selected = selectedScreens.includes(screen.value);
              return (
                <TouchableOpacity
                  key={screen.value}
                  style={[styles.screenChip, selected && styles.screenChipActive]}
                  onPress={() => toggleScreen(screen.value)}
                >
                  {selected ? (
                    <Eye size={12} color={Colors.primary} />
                  ) : (
                    <EyeOff size={12} color={Colors.muted} />
                  )}
                  <Text style={[styles.screenChipText, selected && styles.screenChipTextActive]}>
                    {screen.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <KeyRound size={16} color={Colors.text} />
              <Text style={styles.switchText}>Require MFA</Text>
            </View>
            <Switch
              value={requireMfa}
              onValueChange={setRequireMfa}
              trackColor={{ false: Colors.border, true: Colors.primary }}
            />
          </View>

          <TouchableOpacity style={styles.submitBtn} onPress={handleAssign} disabled={loading}>
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitBtnText}>Publish Assignment</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function CreateTemplateModal({
  visible,
  onClose,
  onCreate,
  loading,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (input: {
    name: string;
    description: string;
    role: IVXRoleName;
    screens: IVXScreenPermission[];
    dataScope: IVXAccessScope;
    permissions: string[];
  }) => void;
  loading: boolean;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [role, setRole] = useState<IVXRoleName>('admin');
  const [dataScope, setDataScope] = useState<IVXAccessScope>('assigned');
  const [selectedScreens, setSelectedScreens] = useState<IVXScreenPermission[]>([]);

  const toggleScreen = (screen: IVXScreenPermission) => {
    setSelectedScreens((prev) =>
      prev.includes(screen) ? prev.filter((s) => s !== screen) : [...prev, screen],
    );
  };

  const handleCreate = () => {
    if (!name.trim()) {
      Alert.alert('Missing Name', 'Enter a template name.');
      return;
    }
    onCreate({
      name: name.trim(),
      description: description.trim(),
      role,
      screens: selectedScreens,
      dataScope,
      permissions: [],
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Create Template</Text>
          <TouchableOpacity onPress={onClose}>
            <X size={24} color={Colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent}>
          <Text style={styles.inputLabel}>Template Name</Text>
          <TextInput
            style={styles.textInput}
            placeholder="e.g. Regional Manager Access"
            placeholderTextColor={Colors.muted}
            value={name}
            onChangeText={setName}
          />

          <Text style={styles.inputLabel}>Description (optional)</Text>
          <TextInput
            style={styles.textInput}
            placeholder="What is this template for?"
            placeholderTextColor={Colors.muted}
            value={description}
            onChangeText={setDescription}
            multiline
          />

          <Text style={styles.inputLabel}>Role</Text>
          <View style={styles.pickerRow}>
            {ALL_IVX_ROLES.map((r) => (
              <TouchableOpacity
                key={r.value}
                style={[styles.pickerChip, role === r.value && styles.pickerChipActive]}
                onPress={() => setRole(r.value)}
              >
                <Text style={[styles.pickerChipText, role === r.value && styles.pickerChipTextActive]}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.inputLabel}>Data Scope</Text>
          <View style={styles.pickerRow}>
            {IVX_ACCESS_SCOPES.map((s) => (
              <TouchableOpacity
                key={s.value}
                style={[styles.pickerChip, dataScope === s.value && styles.pickerChipActive]}
                onPress={() => setDataScope(s.value)}
              >
                <Text style={[styles.pickerChipText, dataScope === s.value && styles.pickerChipTextActive]}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.inputLabel}>Screens ({selectedScreens.length})</Text>
          <View style={styles.screensGrid}>
            {ALL_IVX_SCREENS.map((screen) => {
              const selected = selectedScreens.includes(screen.value);
              return (
                <TouchableOpacity
                  key={screen.value}
                  style={[styles.screenChip, selected && styles.screenChipActive]}
                  onPress={() => toggleScreen(screen.value)}
                >
                  {selected ? (
                    <Eye size={12} color={Colors.primary} />
                  ) : (
                    <EyeOff size={12} color={Colors.muted} />
                  )}
                  <Text style={[styles.screenChipText, selected && styles.screenChipTextActive]}>
                    {screen.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={styles.submitBtn} onPress={handleCreate} disabled={loading}>
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitBtnText}>Create Template</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function UserDetailModal({
  assignment,
  roleDisplayName,
  getRoleScreens,
  visible,
  onClose,
  onUpdateScreens,
  onForceLogout,
  onClearForceLogout,
  onToggleStatus,
  onToggleMfa,
  onRevoke,
}: {
  assignment: IVXRoleAssignment;
  roleDisplayName: string;
  getRoleScreens: (role: string) => IVXScreenPermission[];
  visible: boolean;
  onClose: () => void;
  onUpdateScreens: (screens: IVXScreenPermission[]) => void;
  onForceLogout: () => void;
  onClearForceLogout: () => void;
  onToggleStatus: () => void;
  onToggleMfa: () => void;
  onRevoke: () => void;
}) {
  const [localScreens, setLocalScreens] = useState<IVXScreenPermission[]>([]);

  React.useEffect(() => {
    if (visible) {
      setLocalScreens(assignment.screens.length > 0 ? assignment.screens : getRoleScreens(assignment.role));
    }
  }, [visible, assignment, getRoleScreens]);

  const toggleScreen = (screen: IVXScreenPermission) => {
    setLocalScreens((prev) =>
      prev.includes(screen) ? prev.filter((s) => s !== screen) : [...prev, screen],
    );
  };

  const isExpired = assignment.expirationDate
    ? new Date(assignment.expirationDate).getTime() < Date.now()
    : false;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>User Access</Text>
          <TouchableOpacity onPress={onClose}>
            <X size={24} color={Colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent}>
          <View style={styles.detailSection}>
            <Text style={styles.detailLabel}>Email</Text>
            <Text style={styles.detailValue}>{assignment.userEmail || 'N/A'}</Text>
          </View>

          <View style={styles.detailSection}>
            <Text style={styles.detailLabel}>User ID</Text>
            <Text style={styles.detailValue}>{assignment.userId}</Text>
          </View>

          <View style={styles.detailSection}>
            <Text style={styles.detailLabel}>Role</Text>
            <View style={styles.roleBadge}>
              <IVXBrandIcon size={12} />
              <Text style={styles.roleBadgeText}>{roleDisplayName}</Text>
            </View>
          </View>

          <View style={styles.detailSection}>
            <Text style={styles.detailLabel}>Status</Text>
            <View style={styles.statusRow}>
              <View style={assignment.status === 'active' ? styles.statusPillGood : styles.statusPillWarn}>
                {assignment.status === 'active' ? (
                  <CheckCircle2 size={10} color="#00C853" />
                ) : (
                  <AlertTriangle size={10} color="#FFA500" />
                )}
                <Text style={assignment.status === 'active' ? styles.statusPillTextGood : styles.statusPillTextWarn}>
                  {assignment.status === 'active' ? 'Active' : 'Suspended'}
                </Text>
              </View>
              {assignment.forceLogout && (
                <View style={styles.statusPillDanger}>
                  <LogOut size={10} color="#FF4444" />
                  <Text style={styles.statusPillTextDanger}>Force Logout</Text>
                </View>
              )}
              {isExpired && (
                <View style={styles.statusPillDanger}>
                  <Clock size={10} color="#FF4444" />
                  <Text style={styles.statusPillTextDanger}>Expired</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.detailSection}>
            <Text style={styles.detailLabel}>Data Scope</Text>
            <Text style={styles.detailValue}>{assignment.dataScope}</Text>
          </View>

          {assignment.startDate && (
            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Start Date</Text>
              <Text style={styles.detailValue}>{assignment.startDate.split('T')[0]}</Text>
            </View>
          )}

          {assignment.expirationDate && (
            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Expiration Date</Text>
              <Text style={styles.detailValue}>{assignment.expirationDate.split('T')[0]}</Text>
            </View>
          )}

          <Text style={styles.inputLabel}>Screen Access ({localScreens.length})</Text>
          <View style={styles.screensGrid}>
            {ALL_IVX_SCREENS.map((screen) => {
              const selected = localScreens.includes(screen.value);
              return (
                <TouchableOpacity
                  key={screen.value}
                  style={[styles.screenChip, selected && styles.screenChipActive]}
                  onPress={() => toggleScreen(screen.value)}
                >
                  {selected ? (
                    <Eye size={12} color={Colors.primary} />
                  ) : (
                    <EyeOff size={12} color={Colors.muted} />
                  )}
                  <Text style={[styles.screenChipText, selected && styles.screenChipTextActive]}>
                    {screen.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={styles.submitBtn}
            onPress={() => onUpdateScreens(localScreens)}
          >
            <Text style={styles.submitBtnText}>Save Screens</Text>
          </TouchableOpacity>

          <View style={styles.detailActions}>
            <TouchableOpacity style={styles.detailActionBtn} onPress={onToggleStatus}>
              {assignment.status === 'active' ? (
                <>
                  <Lock size={16} color={Colors.text} />
                  <Text style={styles.detailActionText}>Suspend</Text>
                </>
              ) : (
                <>
                  <Unlock size={16} color={Colors.primary} />
                  <Text style={[styles.detailActionText, { color: Colors.primary }]}>Activate</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.detailActionBtn} onPress={onToggleMfa}>
              <KeyRound size={16} color={assignment.requireMfa ? Colors.primary : Colors.text} />
              <Text style={styles.detailActionText}>{assignment.requireMfa ? 'MFA On' : 'MFA Off'}</Text>
            </TouchableOpacity>

            {assignment.forceLogout ? (
              <TouchableOpacity style={styles.detailActionBtn} onPress={onClearForceLogout}>
                <Unlock size={16} color={Colors.primary} />
                <Text style={[styles.detailActionText, { color: Colors.primary }]}>Clear Lock</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.detailActionBtn} onPress={onForceLogout}>
                <LogOut size={16} color="#FF4444" />
                <Text style={[styles.detailActionText, { color: '#FF4444' }]}>Force Logout</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity style={[styles.submitBtn, { backgroundColor: '#FF4444' }]} onPress={onRevoke}>
            <Text style={styles.submitBtnText}>Revoke All Access</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.muted,
    fontSize: 14,
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  addBtn: {
    padding: 4,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.card,
  },
  tabActive: {
    backgroundColor: Colors.primary + '20',
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.muted,
  },
  tabLabelActive: {
    color: Colors.primary,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    paddingVertical: 4,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  emptySubtext: {
    fontSize: 14,
    color: Colors.muted,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardSelected: {
    borderColor: Colors.primary,
    borderWidth: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  cardLeftSection: {
    flex: 1,
    gap: 4,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  roleBadgeSuspended: {
    backgroundColor: Colors.border,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  roleBadgeTextSuspended: {
    color: Colors.muted,
  },
  cardEmail: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '500',
  },
  statusRow: {
    flexDirection: 'row',
    gap: 4,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  statusPillGood: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#00C85320',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
  },
  statusPillTextGood: {
    fontSize: 10,
    fontWeight: '600',
    color: '#00C853',
  },
  statusPillWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FFA50020',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
  },
  statusPillTextWarn: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFA500',
  },
  statusPillDanger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FF444420',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
  },
  statusPillTextDanger: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FF4444',
  },
  statusPillInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.primary + '20',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
  },
  statusPillTextInfo: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.primary,
  },
  cardMetaRow: {
    marginBottom: 6,
  },
  cardMetaText: {
    fontSize: 12,
    color: Colors.muted,
  },
  cardMetaSubtext: {
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
  },
  cardDesc: {
    fontSize: 13,
    color: Colors.text,
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  cardBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
    backgroundColor: Colors.primary + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  cardAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.muted,
  },
  expandedSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  expandedSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  chipPerm: {
    backgroundColor: Colors.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  chipText: {
    fontSize: 11,
    color: Colors.text,
  },
  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    borderStyle: 'dashed',
  },
  addCardText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 6,
    marginTop: 16,
  },
  textInput: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pickerChip: {
    backgroundColor: Colors.card,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pickerChipActive: {
    backgroundColor: Colors.primary + '20',
    borderColor: Colors.primary,
  },
  pickerChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.muted,
  },
  pickerChipTextActive: {
    color: Colors.primary,
  },
  screensGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  screenChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.card,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  screenChipActive: {
    backgroundColor: Colors.primary + '20',
    borderColor: Colors.primary,
  },
  screenChipText: {
    fontSize: 11,
    color: Colors.muted,
  },
  screenChipTextActive: {
    color: Colors.primary,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 20,
  },
  switchLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  switchText: {
    fontSize: 15,
    color: Colors.text,
  },
  submitBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  detailSection: {
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.muted,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 15,
    color: Colors.text,
  },
  detailActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 20,
    gap: 12,
  },
  detailActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  detailActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
  },
});
