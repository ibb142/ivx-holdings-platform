import React, { useState, useCallback } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
  Platform} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Building2,
  Plus,
  Search,
  CheckCircle,
  MapPin,
  Mail,
  FileText,
  Link2,
  Unlink2,
  ArrowLeft,
  AlertTriangle,
  Hash,
  Users,
  X} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { RefreshControl } from 'react-native';
import {
  titleCompanies as mockCompanies,
  titleCompanyAssignments as mockAssignments,
  propertyDocumentSubmissions} from '@/mocks/title-company';
import {
  TitleCompany,
  TitleCompanyAssignment,
  TitleCompanyStatus} from '@/types';

type TabType = 'companies' | 'assignments';

const STATUS_COLORS: Record<TitleCompanyStatus, string> = {
  active: Colors.success,
  inactive: Colors.textTertiary,
  pending_verification: Colors.warning};

const ASSIGNMENT_COLORS: Record<string, string> = {
  assigned: Colors.info,
  in_review: Colors.warning,
  completed: Colors.success,
  revoked: Colors.error};

export default function TitleCompaniesScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [tab, setTab] = useState<TabType>('companies');
  const [companies, setCompanies] = useState<TitleCompany[]>(mockCompanies);
  const [assignments, setAssignments] = useState<TitleCompanyAssignment[]>(mockAssignments);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showAddCompanyModal, setShowAddCompanyModal] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<string | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  const [newCompany, setNewCompany] = useState({
    name: '',
    contactName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    licenseNumber: ''});

  const filteredCompanies = companies.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.contactName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.city.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredAssignments = assignments.filter(
    (a) =>
      a.propertyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.titleCompanyName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAssignCompany = useCallback(() => {
    if (!selectedProperty || !selectedCompany) {
      Alert.alert('Error', 'Please select both a property and a title company.');
      return;
    }

    const property = propertyDocumentSubmissions.find((s) => s.propertyId === selectedProperty);
    const company = companies.find((c) => c.id === selectedCompany);

    if (!property || !company) return;

    const existingAssignment = assignments.find(
      (a) => a.propertyId === selectedProperty && a.status !== 'revoked'
    );
    if (existingAssignment) {
      Alert.alert('Already Assigned', 'This property is already assigned to a title company. Revoke the current assignment first.');
      return;
    }

    setAssigning(true);
    setTimeout(() => {
      const newAssignment: TitleCompanyAssignment = {
        id: `tca-${Date.now()}`,
        propertyId: property.propertyId,
        propertyName: property.propertyName,
        propertyAddress: property.propertyAddress,
        titleCompanyId: company.id,
        titleCompanyName: company.name,
        assignedAt: new Date().toISOString(),
        assignedBy: 'Admin Owner',
        status: 'assigned'};

      setAssignments((prev) => [...prev, newAssignment]);
      setAssigning(false);
      setShowAssignModal(false);
      setSelectedProperty(null);
      setSelectedCompany(null);

      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      Alert.alert('Assigned', `${property.propertyName} has been assigned to ${company.name} for title review.`);
      console.log('Title company assigned:', newAssignment);
    }, 800);
  }, [selectedProperty, selectedCompany, companies, assignments]);

  const handleRevokeAssignment = useCallback((assignmentId: string) => {
    const assignment = assignments.find((a) => a.id === assignmentId);
    if (!assignment) return;

    Alert.alert(
      'Revoke Assignment',
      `Remove ${assignment.titleCompanyName} from reviewing ${assignment.propertyName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => {
            setAssignments((prev) =>
              prev.map((a) => (a.id === assignmentId ? { ...a, status: 'revoked' as const } : a))
            );
            if (Platform.OS !== 'web') {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }
          }},
      ]
    );
  }, [assignments]);

  const handleAddCompany = useCallback(() => {
    if (!newCompany.name || !newCompany.email || !newCompany.licenseNumber) {
      Alert.alert('Missing Info', 'Please fill in at least the company name, email, and license number.');
      return;
    }

    const company: TitleCompany = {
      id: `tc-${Date.now()}`,
      ...newCompany,
      status: 'pending_verification',
      assignedProperties: [],
      completedReviews: 0,
      averageReviewDays: 0,
      createdAt: new Date().toISOString()};

    setCompanies((prev) => [...prev, company]);
    setShowAddCompanyModal(false);
    setNewCompany({ name: '', contactName: '', email: '', phone: '', address: '', city: '', state: '', licenseNumber: '' });

    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    Alert.alert('Company Added', `${company.name} has been added and is pending verification.`);
  }, [newCompany]);

  const renderCompanyCard = (company: TitleCompany) => {
    const statusColor = STATUS_COLORS[company.status];
    const assignedCount = assignments.filter(
      (a) => a.titleCompanyId === company.id && a.status !== 'revoked'
    ).length;

    return (
      <TouchableOpacity
        key={company.id}
        style={styles.companyCard}
        activeOpacity={0.7}
        testID={`company-${company.id}`}
      >
        <View style={styles.companyHeader}>
          <View style={[styles.companyIcon, { backgroundColor: '#FFD70012' }]}>
            <Building2 size={18} color={Colors.primary} />
          </View>
          <View style={styles.companyInfo}>
            <Text style={styles.companyName}>{company.name}</Text>
            <View style={styles.companyMeta}>
              <MapPin size={12} color={Colors.textTertiary} />
              <Text style={styles.companyMetaText}>{company.city}, {company.state}</Text>
            </View>
          </View>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        </View>

        <View style={styles.companyDetails}>
          <View style={styles.detailRow}>
            <Users size={13} color={Colors.textTertiary} />
            <Text style={styles.detailText}>{company.contactName}</Text>
          </View>
          <View style={styles.detailRow}>
            <Mail size={13} color={Colors.textTertiary} />
            <Text style={styles.detailText} numberOfLines={1}>{company.email}</Text>
          </View>
          <View style={styles.detailRow}>
            <Hash size={13} color={Colors.textTertiary} />
            <Text style={styles.detailText}>{company.licenseNumber}</Text>
          </View>
        </View>

        <View style={styles.companyStats}>
          <View style={styles.companyStat}>
            <Text style={styles.companyStatValue}>{assignedCount}</Text>
            <Text style={styles.companyStatLabel}>Assigned</Text>
          </View>
          <View style={styles.companyStatDivider} />
          <View style={styles.companyStat}>
            <Text style={styles.companyStatValue}>{company.completedReviews}</Text>
            <Text style={styles.companyStatLabel}>Reviews</Text>
          </View>
          <View style={styles.companyStatDivider} />
          <View style={styles.companyStat}>
            <Text style={styles.companyStatValue}>
              {company.averageReviewDays > 0 ? `${company.averageReviewDays}d` : '-'}
            </Text>
            <Text style={styles.companyStatLabel}>Avg Time</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderAssignmentCard = (assignment: TitleCompanyAssignment) => {
    const statusColor = ASSIGNMENT_COLORS[assignment.status] ?? Colors.textTertiary;
    const isActive = assignment.status !== 'revoked' && assignment.status !== 'completed';

    return (
      <View key={assignment.id} style={[styles.assignmentCard, { borderLeftColor: statusColor }]}>
        <View style={styles.assignmentHeader}>
          <View style={styles.assignmentProperty}>
            <Text style={styles.assignmentPropertyName}>{assignment.propertyName}</Text>
            <Text style={styles.assignmentAddress}>{assignment.propertyAddress}</Text>
          </View>
          <View style={[styles.assignmentStatus, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.assignmentStatusText, { color: statusColor }]}>
              {assignment.status.replace('_', ' ').toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={styles.assignmentCompany}>
          <Building2 size={14} color={Colors.primary} />
          <Text style={styles.assignmentCompanyName}>{assignment.titleCompanyName}</Text>
        </View>

        <View style={styles.assignmentFooter}>
          <Text style={styles.assignmentDate}>
            Assigned {new Date(assignment.assignedAt).toLocaleDateString()}
          </Text>
          {isActive && (
            <TouchableOpacity
              style={styles.revokeBtn}
              onPress={() => handleRevokeAssignment(assignment.id)}
              testID={`revoke-${assignment.id}`}
            >
              <Unlink2 size={14} color={Colors.error} />
              <Text style={styles.revokeBtnText}>Revoke</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const allProperties = propertyDocumentSubmissions.filter((s) => s.status !== 'draft');
  const activeCompanies = companies.filter((c) => c.status === 'active');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Title Companies</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setShowAddCompanyModal(true)}
          testID="add-company"
        >
          <Plus size={20} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchInput}>
          <Search size={16} color={Colors.textTertiary} />
          <TextInput
            style={styles.searchText}
            placeholder="Search companies or properties..."
            placeholderTextColor={Colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            underlineColorAndroid="transparent"
            selectionColor={Colors.textSecondary}
            cursorColor={Colors.textSecondary}
          />
        </View>
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'companies' && styles.tabActive]}
          onPress={() => setTab('companies')}
        >
          <Building2 size={16} color={tab === 'companies' ? Colors.primary : Colors.textTertiary} />
          <Text style={[styles.tabText, tab === 'companies' && styles.tabTextActive]}>
            Companies ({companies.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'assignments' && styles.tabActive]}
          onPress={() => setTab('assignments')}
        >
          <Link2 size={16} color={tab === 'assignments' ? Colors.primary : Colors.textTertiary} />
          <Text style={[styles.tabText, tab === 'assignments' && styles.tabTextActive]}>
            Assignments ({assignments.filter((a) => a.status !== 'revoked').length})
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        {tab === 'companies' && (
          <>
            {filteredCompanies.map(renderCompanyCard)}
            {filteredCompanies.length === 0 && (
              <View style={styles.empty}>
                <Building2 size={40} color={Colors.textTertiary} />
                <Text style={styles.emptyText}>No title companies found</Text>
              </View>
            )}
          </>
        )}

        {tab === 'assignments' && (
          <>
            <TouchableOpacity
              style={styles.assignNewBtn}
              onPress={() => setShowAssignModal(true)}
              testID="assign-new"
            >
              <Link2 size={18} color={Colors.background} />
              <Text style={styles.assignNewBtnText}>Assign Title Company to Property</Text>
            </TouchableOpacity>

            {filteredAssignments.length > 0 ? (
              filteredAssignments.map(renderAssignmentCard)
            ) : (
              <View style={styles.empty}>
                <Link2 size={40} color={Colors.textTertiary} />
                <Text style={styles.emptyText}>No assignments found</Text>
              </View>
            )}
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <Modal visible={showAssignModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Assign Title Company</Text>
              <TouchableOpacity onPress={() => setShowAssignModal(false)}>
                <X size={22} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll}>
              <Text style={styles.modalSectionTitle}>Select Property</Text>
              {allProperties.map((sub) => {
                const hasAssignment = assignments.some(
                  (a) => a.propertyId === sub.propertyId && a.status !== 'revoked'
                );
                return (
                  <TouchableOpacity
                    key={sub.propertyId}
                    style={[
                      styles.selectItem,
                      selectedProperty === sub.propertyId && styles.selectItemActive,
                      hasAssignment && styles.selectItemDisabled,
                    ]}
                    onPress={() => !hasAssignment && setSelectedProperty(sub.propertyId)}
                    disabled={hasAssignment}
                  >
                    <View style={styles.selectItemLeft}>
                      <FileText size={16} color={selectedProperty === sub.propertyId ? Colors.primary : Colors.textSecondary} />
                      <View>
                        <Text style={[styles.selectItemName, hasAssignment && styles.selectItemNameDisabled]}>
                          {sub.propertyName}
                        </Text>
                        <Text style={styles.selectItemSub}>{sub.propertyAddress}</Text>
                      </View>
                    </View>
                    {hasAssignment && (
                      <Text style={styles.alreadyAssigned}>Already Assigned</Text>
                    )}
                    {selectedProperty === sub.propertyId && (
                      <CheckCircle size={18} color={Colors.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}

              <Text style={[styles.modalSectionTitle, { marginTop: 20 }]}>Select Title Company</Text>
              <View style={styles.noteBox}>
                <AlertTriangle size={14} color={Colors.warning} />
                <Text style={styles.noteBoxText}>
                  Each property can only be shared with one title company at a time.
                </Text>
              </View>
              {activeCompanies.map((company) => (
                <TouchableOpacity
                  key={company.id}
                  style={[
                    styles.selectItem,
                    selectedCompany === company.id && styles.selectItemActive,
                  ]}
                  onPress={() => setSelectedCompany(company.id)}
                >
                  <View style={styles.selectItemLeft}>
                    <Building2 size={16} color={selectedCompany === company.id ? Colors.primary : Colors.textSecondary} />
                    <View>
                      <Text style={styles.selectItemName}>{company.name}</Text>
                      <Text style={styles.selectItemSub}>{company.city}, {company.state}</Text>
                    </View>
                  </View>
                  {selectedCompany === company.id && (
                    <CheckCircle size={18} color={Colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalSubmitBtn, (!selectedProperty || !selectedCompany) && styles.modalSubmitBtnDisabled]}
              onPress={handleAssignCompany}
              disabled={!selectedProperty || !selectedCompany || assigning}
            >
              {assigning ? (
                <ShimmerIndicator size="small" color={Colors.background} />
              ) : (
                <Text style={styles.modalSubmitBtnText}>Assign Title Company</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showAddCompanyModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Title Company</Text>
              <TouchableOpacity onPress={() => setShowAddCompanyModal(false)}>
                <X size={22} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll}>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Company Name *</Text>
                <TextInput
                  style={styles.formInput}
                  value={newCompany.name}
                  onChangeText={(v) => setNewCompany((p) => ({ ...p, name: v }))}
                  placeholder="e.g. First American Title"
                  placeholderTextColor={Colors.inputPlaceholder}
                />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Contact Person</Text>
                <TextInput
                  style={styles.formInput}
                  value={newCompany.contactName}
                  onChangeText={(v) => setNewCompany((p) => ({ ...p, contactName: v }))}
                  placeholder="Full name"
                  placeholderTextColor={Colors.inputPlaceholder}
                />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Email *</Text>
                <TextInput
                  style={styles.formInput}
                  value={newCompany.email}
                  onChangeText={(v) => setNewCompany((p) => ({ ...p, email: v }))}
                  placeholder="email@company.com"
                  placeholderTextColor={Colors.inputPlaceholder}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Phone</Text>
                <TextInput
                  style={styles.formInput}
                  value={newCompany.phone}
                  onChangeText={(v) => setNewCompany((p) => ({ ...p, phone: v }))}
                  placeholder="+1 (555) 000-0000"
                  placeholderTextColor={Colors.inputPlaceholder}
                  keyboardType="phone-pad"
                />
              </View>
              <View style={styles.formRow}>
                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.formLabel}>City</Text>
                  <TextInput
                    style={styles.formInput}
                    value={newCompany.city}
                    onChangeText={(v) => setNewCompany((p) => ({ ...p, city: v }))}
                    placeholder="City"
                    placeholderTextColor={Colors.inputPlaceholder}
                  />
                </View>
                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.formLabel}>State</Text>
                  <TextInput
                    style={styles.formInput}
                    value={newCompany.state}
                    onChangeText={(v) => setNewCompany((p) => ({ ...p, state: v }))}
                    placeholder="State"
                    placeholderTextColor={Colors.inputPlaceholder}
                  />
                </View>
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>License Number *</Text>
                <TextInput
                  style={styles.formInput}
                  value={newCompany.licenseNumber}
                  onChangeText={(v) => setNewCompany((p) => ({ ...p, licenseNumber: v }))}
                  placeholder="e.g. CA-TI-2024-1234"
                  placeholderTextColor={Colors.inputPlaceholder}
                  autoCapitalize="characters"
                />
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalSubmitBtn, (!newCompany.name || !newCompany.email || !newCompany.licenseNumber) && styles.modalSubmitBtnDisabled]}
              onPress={handleAddCompany}
              disabled={!newCompany.name || !newCompany.email || !newCompany.licenseNumber}
            >
              <Text style={styles.modalSubmitBtnText}>Add Company</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 8 },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  addBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 12, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden' as const },
  searchInput: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchText: { flex: 1, color: Colors.text, fontSize: 15, paddingVertical: 12 },
  tabs: { flexDirection: 'row', gap: 4, marginHorizontal: 16, marginBottom: 12, backgroundColor: Colors.surface, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden' as const },
  tab: { flex: 1, flexDirection: 'row', paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 10, gap: 6 },
  tabActive: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  tabText: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: 13 },
  tabTextActive: { color: Colors.primary, fontWeight: '700' as const },
  content: { flex: 1 },
  contentContainer: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 140 },
  companyCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  companyHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  companyIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden' as const },
  companyInfo: { flex: 1 },
  companyName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  companyMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  companyMetaText: { color: Colors.textSecondary, fontSize: 13 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  companyDetails: { gap: 4 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailText: { color: Colors.textSecondary, fontSize: 13 },
  companyStats: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  companyStat: { flex: 1, alignItems: 'center' },
  companyStatValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  companyStatLabel: { color: Colors.textSecondary, fontSize: 13 },
  companyStatDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder },
  assignmentCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  assignmentHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  assignmentProperty: { gap: 4 },
  assignmentPropertyName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  assignmentAddress: { gap: 4 },
  assignmentStatus: { gap: 4 },
  assignmentStatusText: { color: Colors.textSecondary, fontSize: 13 },
  assignmentCompany: { gap: 4 },
  assignmentCompanyName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  assignmentFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  assignmentDate: { color: Colors.textTertiary, fontSize: 12 },
  revokeBtn: { backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  revokeBtnText: { color: Colors.error, fontWeight: '700' as const, fontSize: 15 },
  assignNewBtn: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, marginBottom: 16 },
  assignNewBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyText: { color: Colors.textTertiary, fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  modalScroll: { maxHeight: 400 },
  modalSectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 10 },
  noteBox: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8, padding: 12, backgroundColor: Colors.surface, borderRadius: 10 },
  noteBoxText: { color: Colors.textSecondary, fontSize: 13 },
  selectItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  selectItemActive: { backgroundColor: Colors.surface, borderColor: Colors.primary },
  selectItemDisabled: { opacity: 0.4 },
  selectItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  selectItemName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  selectItemNameDisabled: { opacity: 0.4 },
  selectItemSub: { color: Colors.textTertiary, fontSize: 12, marginTop: 2 },
  alreadyAssigned: { gap: 4 },
  modalSubmitBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  modalSubmitBtnDisabled: { opacity: 0.4 },
  modalSubmitBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  formGroup: { gap: 6, marginBottom: 12 },
  formLabel: { color: Colors.textSecondary, fontSize: 13 },
  formInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  formRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }});
