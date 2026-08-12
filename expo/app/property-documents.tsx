import React, { useState, useCallback, useRef } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Animated,
  Platform} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import {
  FileText,
  Upload,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Send,
  Shield,
  Eye,
  Building2,
  ArrowLeft,
  FileCheck,
  FilePlus,
  RefreshCw} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import {
  REQUIRED_TITLE_DOCUMENTS,
  propertyDocumentSubmissions,
  getSubmissionByPropertyId} from '@/mocks/title-company';
import {
  TitleDocument,
  TitleDocumentType,
  TitleDocumentStatus,
  PropertyDocumentSubmission} from '@/types';

const STATUS_CONFIG: Record<TitleDocumentStatus, { color: string; label: string; icon: typeof CheckCircle }> = {
  not_uploaded: { color: Colors.textTertiary, label: 'Not Uploaded', icon: FilePlus },
  uploaded: { color: Colors.info, label: 'Uploaded', icon: Clock },
  under_review: { color: Colors.warning, label: 'Under Review', icon: Eye },
  approved: { color: Colors.success, label: 'Approved', icon: CheckCircle },
  rejected: { color: Colors.error, label: 'Rejected', icon: XCircle }};

export default function PropertyDocumentsScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const { propertyId } = useLocalSearchParams<{ propertyId: string }>();

  const existingSubmission = getSubmissionByPropertyId(propertyId ?? '1');

  const [submission, setSubmission] = useState<PropertyDocumentSubmission | null>(
    existingSubmission ?? null
  );
  const [documents, setDocuments] = useState<TitleDocument[]>(
    existingSubmission?.documents ?? REQUIRED_TITLE_DOCUMENTS.map((doc, idx) => ({
      id: `td-new-${idx}`,
      propertyId: propertyId ?? '1',
      type: doc.type,
      name: doc.name,
      description: doc.description,
      status: 'not_uploaded' as TitleDocumentStatus,
      required: true}))
  );
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const animatedValues = useRef<Record<string, Animated.Value>>({});
  documents.forEach((doc) => {
    if (!animatedValues.current[doc.id]) {
      animatedValues.current[doc.id] = new Animated.Value(0);
    }
  });

  const toggleExpand = useCallback((docId: string) => {
    const isExpanding = expandedDoc !== docId;
    if (expandedDoc && animatedValues.current[expandedDoc]) {
      Animated.timing(animatedValues.current[expandedDoc], {
        toValue: 0,
        duration: 200,
        useNativeDriver: false}).start();
    }
    if (isExpanding && animatedValues.current[docId]) {
      Animated.timing(animatedValues.current[docId], {
        toValue: 1,
        duration: 250,
        useNativeDriver: false}).start();
    }
    setExpandedDoc(isExpanding ? docId : null);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [expandedDoc]);

  const handlePickDocument = useCallback(async (docType: TitleDocumentType, docId: string) => {
    try {
      setUploading(docId);
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true});

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        setDocuments((prev) =>
          prev.map((d) =>
            d.id === docId
              ? {
                  ...d,
                  fileName: file.name,
                  fileUri: file.uri,
                  status: 'uploaded' as TitleDocumentStatus,
                  uploadedAt: new Date().toISOString()}
              : d
          )
        );
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        console.log(`Document uploaded: ${file.name} for ${docType}`);
      }
    } catch (error) {
      console.error('Document pick error:', error);
      Alert.alert('Error', 'Failed to pick document. Please try again.');
    } finally {
      setUploading(null);
    }
  }, []);

  const handleRemoveDocument = useCallback((docId: string) => {
    Alert.alert('Remove Document', 'Are you sure you want to remove this document?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setDocuments((prev) =>
            prev.map((d) =>
              d.id === docId
                ? { ...d, fileName: undefined, fileUri: undefined, status: 'not_uploaded' as TitleDocumentStatus, uploadedAt: undefined }
                : d
            )
          );
        }},
    ]);
  }, []);

  const uploadedCount = documents.filter((d) => d.status !== 'not_uploaded').length;
  const approvedCount = documents.filter((d) => d.status === 'approved').length;
  const totalRequired = documents.length;
  const progress = totalRequired > 0 ? uploadedCount / totalRequired : 0;

  const canSubmit = uploadedCount >= 3;

  const handleSubmitForReview = useCallback(() => {
    if (!canSubmit) {
      Alert.alert('Incomplete', 'Please upload at least the Title Insurance, Warranty Deed, and ALTA Settlement to submit for review.');
      return;
    }

    Alert.alert(
      'Submit for Review',
      'Your documents will be sent to the assigned title company for review. You cannot modify documents once submitted.\n\nContinue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: () => {
            setSubmitting(true);
            setTimeout(() => {
              setSubmitting(false);
              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
              Alert.alert(
                'Documents Submitted',
                'Your documents have been submitted for title company review. You will be notified once the review is complete.'
              );
            }, 1500);
          }},
      ]
    );
  }, [canSubmit]);

  const renderProgressBar = () => {
    const progressWidth = `${Math.round(progress * 100)}%`;
    return (
      <View style={styles.progressSection}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressTitle}>Document Completion</Text>
          <Text style={styles.progressPercent}>{Math.round(progress * 100)}%</Text>
        </View>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: progressWidth as any }]} />
        </View>
        <View style={styles.progressStats}>
          <View style={styles.statChip}>
            <Upload size={12} color={Colors.info} />
            <Text style={styles.statChipText}>{uploadedCount} Uploaded</Text>
          </View>
          <View style={styles.statChip}>
            <CheckCircle size={12} color={Colors.success} />
            <Text style={styles.statChipText}>{approvedCount} Approved</Text>
          </View>
          <View style={styles.statChip}>
            <AlertTriangle size={12} color={Colors.textTertiary} />
            <Text style={styles.statChipText}>{totalRequired - uploadedCount} Pending</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderDocumentCard = (doc: TitleDocument) => {
    const config = STATUS_CONFIG[doc.status];
    const StatusIcon = config.icon;
    const isExpanded = expandedDoc === doc.id;
    const isUploading = uploading === doc.id;
    const isReadOnly = submission?.status === 'in_review' || submission?.status === 'approved';

    const expandAnim = animatedValues.current[doc.id] || new Animated.Value(0);
    const expandHeight = expandAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 160]});

    return (
      <View key={doc.id} style={[styles.docCard, { borderLeftColor: config.color }]}>
        <TouchableOpacity
          style={styles.docHeader}
          onPress={() => toggleExpand(doc.id)}
          activeOpacity={0.7}
          testID={`doc-toggle-${doc.type}`}
        >
          <View style={styles.docHeaderLeft}>
            <View style={[styles.docIconWrap, { backgroundColor: config.color + '15' }]}>
              <StatusIcon size={18} color={config.color} />
            </View>
            <View style={styles.docInfo}>
              <Text style={styles.docName} numberOfLines={1}>{doc.name}</Text>
              <View style={styles.docStatusRow}>
                <View style={[styles.statusBadge, { backgroundColor: config.color + '20' }]}>
                  <Text style={[styles.statusBadgeText, { color: config.color }]}>{config.label}</Text>
                </View>
                {doc.fileName && (
                  <Text style={styles.fileName} numberOfLines={1}>{doc.fileName}</Text>
                )}
              </View>
            </View>
          </View>
          {isExpanded ? (
            <ChevronUp size={18} color={Colors.textSecondary} />
          ) : (
            <ChevronDown size={18} color={Colors.textSecondary} />
          )}
        </TouchableOpacity>

        <Animated.View style={[styles.docExpanded, { maxHeight: expandHeight, opacity: expandAnim }]}>
          <Text style={styles.docDescription}>{doc.description}</Text>

          {doc.status === 'rejected' && doc.rejectionReason && (
            <View style={styles.rejectionBanner}>
              <XCircle size={14} color={Colors.error} />
              <Text style={styles.rejectionText}>{doc.rejectionReason}</Text>
            </View>
          )}

          {!isReadOnly && (
            <View style={styles.docActions}>
              {doc.status === 'not_uploaded' || doc.status === 'rejected' ? (
                <TouchableOpacity
                  style={styles.uploadBtn}
                  onPress={() => handlePickDocument(doc.type, doc.id)}
                  disabled={isUploading}
                  testID={`upload-${doc.type}`}
                >
                  {isUploading ? (
                    <ShimmerIndicator size="small" color={Colors.background} />
                  ) : (
                    <>
                      <Upload size={16} color={Colors.background} />
                      <Text style={styles.uploadBtnText}>
                        {doc.status === 'rejected' ? 'Re-upload' : 'Upload Document'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : (
                <View style={styles.uploadedActions}>
                  <TouchableOpacity style={styles.viewBtn}>
                    <Eye size={14} color={Colors.info} />
                    <Text style={styles.viewBtnText}>View</Text>
                  </TouchableOpacity>
                  {doc.status === 'uploaded' && (
                    <TouchableOpacity
                      style={styles.removeBtn}
                      onPress={() => handleRemoveDocument(doc.id)}
                    >
                      <XCircle size={14} color={Colors.error} />
                      <Text style={styles.removeBtnText}>Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          )}
        </Animated.View>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Document Portal',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text}}
      />
      <View style={styles.container}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.heroSection}>
            <View style={styles.heroIconWrap}>
              <Shield size={28} color={Colors.primary} />
            </View>
            <Text style={styles.heroTitle}>Title Document Portal</Text>
            <Text style={styles.heroSubtitle}>
              Upload all required documents for title company review. These documents ensure a valid lien and legal transfer of title.
            </Text>
          </View>

          {submission?.assignedTitleCompanyName && (
            <View style={styles.assignedBanner}>
              <Building2 size={16} color={Colors.primary} />
              <View style={styles.assignedInfo}>
                <Text style={styles.assignedLabel}>Assigned Title Company</Text>
                <Text style={styles.assignedName}>{submission.assignedTitleCompanyName}</Text>
              </View>
              <View style={[styles.reviewStatusBadge, {
                backgroundColor: submission.status === 'approved' ? Colors.success + '20' :
                  submission.status === 'in_review' ? Colors.warning + '20' : Colors.info + '20'
              }]}>
                <Text style={[styles.reviewStatusText, {
                  color: submission.status === 'approved' ? Colors.success :
                    submission.status === 'in_review' ? Colors.warning : Colors.info
                }]}>
                  {submission.status === 'approved' ? 'Approved' :
                   submission.status === 'in_review' ? 'In Review' : 'Submitted'}
                </Text>
              </View>
            </View>
          )}

          {renderProgressBar()}

          <View style={styles.sectionHeader}>
            <FileText size={18} color={Colors.primary} />
            <Text style={styles.sectionTitle}>Required Documents</Text>
          </View>

          <View style={styles.requiredNote}>
            <AlertTriangle size={14} color={Colors.warning} />
            <Text style={styles.requiredNoteText}>
              All 8 documents are required for complete title review and tokenization approval.
            </Text>
          </View>

          {documents.map(renderDocumentCard)}

          {submission?.status !== 'approved' && submission?.status !== 'in_review' && (
            <TouchableOpacity
              style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
              onPress={handleSubmitForReview}
              disabled={!canSubmit || submitting}
              testID="submit-documents"
            >
              {submitting ? (
                <ShimmerIndicator size="small" color={Colors.background} />
              ) : (
                <>
                  <Send size={18} color={canSubmit ? Colors.background : Colors.textTertiary} />
                  <Text style={[styles.submitBtnText, !canSubmit && styles.submitBtnTextDisabled]}>
                    Submit for Title Review
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {submission?.status === 'approved' && (
            <View style={styles.approvedBanner}>
              <FileCheck size={22} color={Colors.success} />
              <Text style={styles.approvedTitle}>Documents Approved</Text>
              <Text style={styles.approvedSubtitle}>
                All documents have been reviewed and approved. This property is cleared for stock tokenization.
              </Text>
            </View>
          )}

          <View style={styles.legalNote}>
            <Shield size={14} color={Colors.textTertiary} />
            <Text style={styles.legalNoteText}>
              These documents ensure the lender has a valid lien on the property and that all legal requirements for the transfer of title are met. Documents are encrypted and shared only with the assigned title company.
            </Text>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollView: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: 20, paddingBottom: 140 },
  heroSection: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 20 },
  heroIconWrap: { width: 56, height: 56, borderRadius: 18, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  heroTitle: { color: Colors.text, fontSize: 22, fontWeight: '800' as const, textAlign: 'center', marginBottom: 8 },
  heroSubtitle: { color: Colors.text, fontSize: 22, fontWeight: '800' as const, textAlign: 'center', marginBottom: 8 },
  assignedBanner: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  assignedInfo: { flex: 1 },
  assignedLabel: { color: Colors.textSecondary, fontSize: 13 },
  assignedName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  reviewStatusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  reviewStatusText: { color: Colors.textSecondary, fontSize: 13 },
  progressSection: { marginBottom: 16 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  progressTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  progressPercent: { color: Colors.primary, fontSize: 14, fontWeight: '700' as const },
  progressBarBg: { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceBorder },
  progressBarFill: { height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  progressStats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  statChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statChipText: { color: Colors.textSecondary, fontSize: 13 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  requiredNote: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, backgroundColor: Colors.warning + '10', borderRadius: 8, marginBottom: 12 },
  requiredNoteText: { color: Colors.textSecondary, fontSize: 13 },
  docCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  docHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  docHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  docIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  docInfo: { flex: 1 },
  docName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  docStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' as const },
  fileName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  docExpanded: { paddingTop: 12, gap: 8 },
  docDescription: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  rejectionBanner: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  rejectionText: { color: Colors.textSecondary, fontSize: 13 },
  docActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  uploadBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  uploadBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  uploadedActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  viewBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  viewBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  removeBtn: { backgroundColor: Colors.error + '15', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  removeBtnText: { color: Colors.error, fontWeight: '700' as const, fontSize: 15 },
  submitBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  submitBtnTextDisabled: { opacity: 0.4 },
  approvedBanner: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  approvedTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  approvedSubtitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  legalNote: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: Colors.surface, borderRadius: 10, marginTop: 8, borderWidth: 1, borderColor: Colors.surfaceBorder },
  legalNoteText: { color: Colors.textSecondary, fontSize: 13 }});
