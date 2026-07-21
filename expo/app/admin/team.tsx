import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Modal,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Users,
  UserPlus,
    X,
  Mail,
  Phone,
  Clock,
  Check,
  AlertTriangle,
  Edit2,
  Trash2,
  Eye,
  Settings,
  HeadphonesIcon,
  BarChart3,
  ArrowLeft,
} from 'lucide-react-native';
import IVXBrandIcon from '@/components/IVXBrandIcon';
import Colors from '@/constants/colors';
import { TeamMember, AdminRole } from '@/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const DEFAULT_ROLES: AdminRole[] = [
  { id: 'role-ceo', name: 'CEO', type: 'ceo', permissions: [], description: 'Full access', isSystemRole: true },
  { id: 'role-manager', name: 'Manager', type: 'manager', permissions: [], description: 'Manage operations', isSystemRole: true },
  { id: 'role-analyst', name: 'Analyst', type: 'analyst', permissions: [], description: 'View analytics', isSystemRole: true },
  { id: 'role-support', name: 'Support', type: 'support', permissions: [], description: 'Handle support', isSystemRole: true },
  { id: 'role-viewer', name: 'Viewer', type: 'viewer', permissions: [], description: 'Read-only access', isSystemRole: true },
];

const CURRENT_ADMIN = {
  id: 'ceo',
  email: 'ceo@ivxholding.com',
  firstName: 'Ivan',
  lastName: 'Perez',
  roleId: 'role-ceo',
  role: DEFAULT_ROLES[0],
  status: 'active' as const,
  createdAt: '2024-01-01T00:00:00Z',
};

export default function TeamManagement() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const _queryClient = useQueryClient();
  const [roles] = useState<AdminRole[]>(DEFAULT_ROLES);
  const [currentAdmin] = useState(CURRENT_ADMIN);

  const teamQuery = useQuery({
    queryKey: ['admin-team-members'],
    queryFn: async () => {
      console.log('[Team] Fetching staff from Supabase profiles');
      const { data, error } = await supabase.from('profiles').select('*').in('role', ['owner', 'ceo', 'staff', 'manager', 'analyst', 'support', 'viewer']).limit(50);
      if (error) { console.log('[Team] profiles error:', error.message); return []; }
      return (data ?? []).map((p: any): TeamMember => ({
        id: p.id,
        email: p.email || '',
        firstName: p.first_name || '',
        lastName: p.last_name || '',
        roleId: `role-${p.role || 'viewer'}`,
        role: DEFAULT_ROLES.find(r => r.type === (p.role || 'viewer')) || DEFAULT_ROLES[4],
        status: p.status === 'active' ? 'active' : 'suspended',
        createdAt: p.created_at || new Date().toISOString(),
      }));
    },
    staleTime: 30000,
  });

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFirstName, setInviteFirstName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState('role-viewer');

  React.useEffect(() => {
    if (teamQuery.data) setTeamMembers(teamQuery.data);
  }, [teamQuery.data]);

  const isCEO = currentAdmin.role.type === 'ceo';

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void teamQuery.refetch().finally(() => setRefreshing(false));
  }, [teamQuery]);

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getRoleIcon = (roleType: string) => {
    switch (roleType) {
      case 'ceo':
        return <IVXBrandIcon size={16} />;
      case 'manager':
        return <Settings size={16} color={Colors.primary} />;
      case 'analyst':
        return <BarChart3 size={16} color={Colors.accent} />;
      case 'support':
        return <HeadphonesIcon size={16} color={Colors.positive} />;
      default:
        return <Eye size={16} color={Colors.textSecondary} />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return Colors.positive;
      case 'invited':
        return Colors.warning;
      case 'suspended':
        return Colors.negative;
      default:
        return Colors.textSecondary;
    }
  };

  const handleInviteMember = () => {
    if (!inviteEmail || !inviteFirstName || !inviteLastName) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    const newMember: TeamMember = {
      id: `admin-${Date.now()}`,
      email: inviteEmail,
      firstName: inviteFirstName,
      lastName: inviteLastName,
      roleId: selectedRoleId,
      role: roles.find(r => r.id === selectedRoleId) || roles[4],
      status: 'invited',
      invitedBy: currentAdmin.id,
      invitedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    setTeamMembers([...teamMembers, newMember]);
    setShowInviteModal(false);
    setInviteEmail('');
    setInviteFirstName('');
    setInviteLastName('');
    setSelectedRoleId('role-viewer');
    Alert.alert('Success', `Invitation sent to ${inviteEmail}`);
  };

  const handleChangeRole = (member: TeamMember) => {
    if (member.role.type === 'ceo') {
      Alert.alert('Error', 'Cannot change CEO role');
      return;
    }
    setSelectedMember(member);
    setSelectedRoleId(member.roleId);
    setShowRoleModal(true);
  };

  const handleSaveRole = () => {
    if (!selectedMember) return;
    
    const updatedMembers = teamMembers.map(m => {
      if (m.id === selectedMember.id) {
        return {
          ...m,
          roleId: selectedRoleId,
          role: roles.find(r => r.id === selectedRoleId) || m.role,
        };
      }
      return m;
    });
    
    setTeamMembers(updatedMembers);
    setShowRoleModal(false);
    setSelectedMember(null);
    Alert.alert('Success', 'Role updated successfully');
  };

  const handleRemoveMember = (member: TeamMember) => {
    if (member.role.type === 'ceo') {
      Alert.alert('Error', 'Cannot remove CEO');
      return;
    }

    Alert.alert(
      'Remove Team Member',
      `Are you sure you want to remove ${member.firstName} ${member.lastName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setTeamMembers(teamMembers.filter(m => m.id !== member.id));
            Alert.alert('Success', 'Team member removed');
          },
        },
      ]
    );
  };

  const handleSuspendMember = (member: TeamMember) => {
    if (member.role.type === 'ceo') {
      Alert.alert('Error', 'Cannot suspend CEO');
      return;
    }

    const newStatus = member.status === 'suspended' ? 'active' : 'suspended';
    const updatedMembers = teamMembers.map(m => {
      if (m.id === member.id) {
        return { ...m, status: newStatus as TeamMember['status'] };
      }
      return m;
    });
    
    setTeamMembers(updatedMembers);
    Alert.alert(
      'Success',
      `${member.firstName} ${member.lastName} has been ${newStatus === 'suspended' ? 'suspended' : 'reactivated'}`
    );
  };

  const activeMembers = teamMembers.filter(m => m.status === 'active').length;
  const invitedMembers = teamMembers.filter(m => m.status === 'invited').length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Team Management</Text>
          <Text style={styles.subtitle}>Manage admin access & roles</Text>
        </View>
        {isCEO && (
          <TouchableOpacity
            style={styles.inviteButton}
            onPress={() => setShowInviteModal(true)}
          >
            <UserPlus size={18} color="#fff" />
            <Text style={styles.inviteButtonText}>Invite</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={styles.ceoCard}>
          <View style={styles.ceoHeader}>
            <IVXBrandIcon size={20} />
            <Text style={styles.ceoTitle}>CEO Access Only</Text>
          </View>
          <Text style={styles.ceoDescription}>
            Only the CEO of IVX HOLDINGS LLC can manage team members, invite new employees, and assign roles. Current CEO: {currentAdmin.firstName} {currentAdmin.lastName}
          </Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: Colors.primary + '20' }]}>
              <Users size={18} color={Colors.primary} />
            </View>
            <Text style={styles.statValue}>{teamMembers.length}</Text>
            <Text style={styles.statLabel}>Total Team</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: Colors.positive + '20' }]}>
              <Check size={18} color={Colors.positive} />
            </View>
            <Text style={styles.statValue}>{activeMembers}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: Colors.warning + '20' }]}>
              <Clock size={18} color={Colors.warning} />
            </View>
            <Text style={styles.statValue}>{invitedMembers}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Team Members</Text>
          {teamMembers.map((member) => (
            <View key={member.id} style={styles.memberCard}>
              <View style={styles.memberHeader}>
                {member.avatar ? (
                  <Image source={{ uri: member.avatar }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Text style={styles.avatarText}>
                      {member.firstName[0]}{member.lastName[0]}
                    </Text>
                  </View>
                )}
                <View style={styles.memberInfo}>
                  <View style={styles.memberNameRow}>
                    <Text style={styles.memberName}>
                      {member.firstName} {member.lastName}
                    </Text>
                    {member.role.type === 'ceo' && (
                      <IVXBrandIcon size={14} />
                    )}
                  </View>
                  <Text style={styles.memberEmail}>{member.email}</Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: getStatusColor(member.status) + '20' },
                  ]}
                >
                  <Text
                    style={[styles.statusText, { color: getStatusColor(member.status) }]}
                  >
                    {member.status}
                  </Text>
                </View>
              </View>

              <View style={styles.memberDetails}>
                <View style={styles.detailRow}>
                  <View style={styles.detailItem}>
                    {getRoleIcon(member.role.type)}
                    <Text style={styles.detailText}>{member.role.name}</Text>
                  </View>
                  {member.phone && (
                    <View style={styles.detailItem}>
                      <Phone size={14} color={Colors.textSecondary} />
                      <Text style={styles.detailText}>{member.phone}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.detailRow}>
                  <View style={styles.detailItem}>
                    <Clock size={14} color={Colors.textSecondary} />
                    <Text style={styles.detailText}>
                      Last login: {formatDate(member.lastLogin)}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.permissionsRow}>
                <Text style={styles.permissionsLabel}>Permissions:</Text>
                <View style={styles.permissionTags}>
                  {member.role.permissions.slice(0, 3).map((perm) => (
                    <View key={perm} style={styles.permissionTag}>
                      <Text style={styles.permissionText}>
                        {perm.replace('_', ' ')}
                      </Text>
                    </View>
                  ))}
                  {member.role.permissions.length > 3 && (
                    <View style={styles.permissionTag}>
                      <Text style={styles.permissionText}>
                        +{member.role.permissions.length - 3}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {isCEO && member.role.type !== 'ceo' && (
                <View style={styles.memberActions}>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: Colors.primary + '15', borderColor: Colors.primary }]}
                    onPress={() => handleChangeRole(member)}
                  >
                    <Edit2 size={14} color={Colors.primary} />
                    <Text style={[styles.actionText, { color: Colors.primary }]}>
                      Change Role
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: Colors.warning + '15', borderColor: Colors.warning }]}
                    onPress={() => handleSuspendMember(member)}
                  >
                    <AlertTriangle size={14} color={Colors.warning} />
                    <Text style={[styles.actionText, { color: Colors.warning }]}>
                      {member.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: Colors.negative + '15', borderColor: Colors.negative }]}
                    onPress={() => handleRemoveMember(member)}
                  >
                    <Trash2 size={14} color={Colors.negative} />
                    <Text style={[styles.actionText, { color: Colors.negative }]}>
                      Remove
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Available Roles</Text>
          {roles.map((role) => (
            <View key={role.id} style={styles.roleCard}>
              <View style={styles.roleHeader}>
                {getRoleIcon(role.type)}
                <Text style={styles.roleName}>{role.name}</Text>
                {role.type === 'ceo' && (
                  <View style={styles.systemBadge}>
                    <Text style={styles.systemBadgeText}>System</Text>
                  </View>
                )}
              </View>
              <Text style={styles.roleDescription}>{role.description}</Text>
              <View style={styles.rolePermissions}>
                {role.permissions.map((perm) => (
                  <View key={perm} style={styles.rolePermTag}>
                    <Check size={12} color={Colors.positive} />
                    <Text style={styles.rolePermText}>
                      {perm.replace(/_/g, ' ')}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>

      <Modal
        visible={showInviteModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowInviteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite Team Member</Text>
              <TouchableOpacity onPress={() => setShowInviteModal(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>First Name</Text>
              <TextInput
                style={styles.input}
                value={inviteFirstName}
                onChangeText={setInviteFirstName}
                placeholder="Enter first name"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Last Name</Text>
              <TextInput
                style={styles.input}
                value={inviteLastName}
                onChangeText={setInviteLastName}
                placeholder="Enter last name"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email Address</Text>
              <TextInput
                style={styles.input}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                placeholder="employee@ipxholding.com"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Role</Text>
              <View style={styles.roleSelector}>
                {roles.filter(r => r.type !== 'ceo').map((role) => (
                  <TouchableOpacity
                    key={role.id}
                    style={[
                      styles.roleSelectorItem,
                      selectedRoleId === role.id && styles.roleSelectorItemActive,
                    ]}
                    onPress={() => setSelectedRoleId(role.id)}
                  >
                    {getRoleIcon(role.type)}
                    <Text
                      style={[
                        styles.roleSelectorText,
                        selectedRoleId === role.id && styles.roleSelectorTextActive,
                      ]}
                    >
                      {role.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity
              style={styles.inviteSubmitButton}
              onPress={handleInviteMember}
            >
              <Mail size={18} color="#fff" />
              <Text style={styles.inviteSubmitText}>Send Invitation</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showRoleModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowRoleModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Role</Text>
              <TouchableOpacity onPress={() => setShowRoleModal(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {selectedMember && (
              <View style={styles.selectedMemberInfo}>
                <Text style={styles.selectedMemberName}>
                  {selectedMember.firstName} {selectedMember.lastName}
                </Text>
                <Text style={styles.selectedMemberEmail}>
                  {selectedMember.email}
                </Text>
              </View>
            )}

            <View style={styles.roleList}>
              {roles.filter(r => r.type !== 'ceo').map((role) => (
                <TouchableOpacity
                  key={role.id}
                  style={[
                    styles.roleListItem,
                    selectedRoleId === role.id && styles.roleListItemActive,
                  ]}
                  onPress={() => setSelectedRoleId(role.id)}
                >
                  <View style={styles.roleListItemContent}>
                    {getRoleIcon(role.type)}
                    <View style={styles.roleListItemText}>
                      <Text style={styles.roleListItemName}>{role.name}</Text>
                      <Text style={styles.roleListItemDesc}>{role.description}</Text>
                    </View>
                  </View>
                  {selectedRoleId === role.id && (
                    <Check size={20} color={Colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={styles.saveRoleButton}
              onPress={handleSaveRole}
            >
              <Text style={styles.saveRoleText}>Save Changes</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  title: { color: Colors.text, fontSize: 18, fontWeight: '800' as const, flexShrink: 1 },
  subtitle: { color: Colors.textSecondary, fontSize: 13, marginTop: 4 },
  inviteButton: { backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, flexDirection: 'row' as const, alignItems: 'center', gap: 6 },
  inviteButtonText: { color: '#000000', fontWeight: '700' as const, fontSize: 14 },
  content: { flex: 1, paddingHorizontal: 20 },
  ceoCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  ceoHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  ceoTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  ceoDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  section: { marginBottom: 20 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  memberCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  memberHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Colors.primary, fontSize: 16, fontWeight: '700' as const },
  memberInfo: { flex: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  memberName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  memberEmail: { color: Colors.textSecondary, fontSize: 13 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { color: Colors.textSecondary, fontSize: 13 },
  memberDetails: { gap: 8, marginTop: 8 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  detailText: { color: Colors.textSecondary, fontSize: 13 },
  permissionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  permissionsLabel: { color: Colors.textSecondary, fontSize: 13 },
  permissionTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  permissionTag: { backgroundColor: Colors.backgroundSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  permissionText: { color: Colors.textSecondary, fontSize: 13 },
  memberActions: { flexDirection: 'row' as const, gap: 6, marginTop: 12 },
  actionButton: { flex: 1, flexDirection: 'row' as const, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 8, borderWidth: 1 },
  actionText: { fontSize: 12, fontWeight: '600' as const },
  roleCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  roleHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  roleName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  systemBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  systemBadgeText: { fontSize: 11, fontWeight: '700' as const },
  roleDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  rolePermissions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  rolePermTag: { backgroundColor: Colors.backgroundSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  rolePermText: { color: Colors.textSecondary, fontSize: 13 },
  bottomPadding: { height: 120 },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  inputGroup: { gap: 6, marginBottom: 12 },
  inputLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginBottom: 6 },
  input: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  roleSelector: { gap: 8 },
  roleSelectorItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  roleSelectorItemActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  roleSelectorText: { color: Colors.textSecondary, fontSize: 13 },
  roleSelectorTextActive: { color: '#000' },
  inviteSubmitButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, flexDirection: 'row' as const, alignItems: 'center', justifyContent: 'center', gap: 8 },
  inviteSubmitText: { color: '#000000', fontSize: 15, fontWeight: '700' as const },
  selectedMemberInfo: { flex: 1 },
  selectedMemberName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  selectedMemberEmail: { color: Colors.textSecondary, fontSize: 13 },
  roleList: { gap: 8 },
  roleListItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  roleListItemActive: { backgroundColor: '#FFD700' + '15', borderColor: '#FFD700' },
  roleListItemContent: { flex: 1, gap: 4 },
  roleListItemText: { flex: 1 },
  roleListItemName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  roleListItemDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  saveRoleButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveRoleText: { color: '#000000', fontSize: 15, fontWeight: '700' as const },
});
