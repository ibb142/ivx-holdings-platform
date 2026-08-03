import React, { useState, useCallback } from 'react';
import logger from '@/lib/logger';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
  Platform} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  Shield,
  Building2,
  AlertTriangle,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Send,
  FileCheck,
  X,
  Download,
  ChevronRight,
  Lock} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  propertyDocumentSubmissions,
  REQUIRED_TITLE_DOCUMENTS} from '@/mocks/title-company';
import {
  TitleDocument,
  TitleDocumentStatus,
  PropertyDocumentSubmission} from '@/types';

const STATUS_CONFIG: Record<TitleDocumentStatus, { color: string; label: string }> = {
  not_uploaded: { color: Colors.textTertiary, label: 'Not Uploaded' },
  uploaded: { color: Colors.info, label: 'Pending Review' },
  under_review: { color: Colors.warning, label: 'Under Review' },
  approved: { color: Colors.success, label: 'Approved' },
  rejected: { color: Colors.error, label: 'Rejected' }};

export default function TitleReviewScreen() {
  const router = useRouter();
  const { submissionId } = useLocalSearchParams<{ submissionId: string }>();

  const initialSubmission = propertyDocumentSubmissions.find(
    (s) => s.id === (submissionId ?? 'pds-1')
  ) ?? propertyDocumentSubmissions[0];

  const [submission, setSubmission] = useState<PropertyDocumentSubmission>(initialSubmission);
  const [documents, setDocuments] = useState<TitleDocument[]>(initialSubmission.documents);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewingDoc, setReviewingDoc] = useState<TitleDocument | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [overallNotes, setOverallNotes] = useState('');

  const approvedCount = documents.filter((d) => d.status === 'approved').length;
  const rejectedCount = documents.filter((d) => d.status === 'rejected').length;
  const pendingCount = documents.filter((d) => d.status === 'uploaded' || d.status === 'under_review').length;
  const totalUploaded = documents.filter((d) => d.status !== 'not_uploaded').length;

  const canFinalize = totalUploaded > 0 && pendingCount === 0;
  const allApproved = approvedCount === documents.length;

  const handleOpenReview = useCallback((doc: TitleDocument) => {
    if (doc.status === 'not_uploaded') {
      Alert.alert('Not Available', 'This document has not been uploaded yet.');
      return;
    }
    setReviewingDoc(doc);
    setReviewNotes(doc.reviewNotes ?? '');
    setRejectionReason('');
    setShowReviewModal(true);
  }, []);

  const handleApproveDocument = useCallback(() => {
    if (!reviewingDoc) return;

    setProcessing(true);
    setTimeout(() => {
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === reviewingDoc.id
            ? {
                ...d,
                status: 'approved' as TitleDocumentStatus,
                reviewedAt: new Date().toISOString(),
                reviewedBy: 'Title Reviewer',
                reviewNotes}
            : d
        )
      );
      setProcessing(false);
      setShowReviewModal(false);
      setReviewingDoc(null);

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      logger.titleReview.log(`Document approved: ${reviewingDoc.name}`);
    }, 600);
  }, [reviewingDoc, reviewNotes]);

  const handleRejectDocument = useCallback(() => {
    if (!reviewingDoc) return;
    if (!rejectionReason.trim()) {
      Alert.alert('Reason Required', 'Please provide a rejection reason so the property owner can resubmit.');
      return;
    }

    setProcessing(true);
    setTimeout(() => {
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === reviewingDoc.id
            ? {
                ...d,
                status: 'rejected' as TitleDocumentStatus,
                reviewedAt: new Date().toISOString(),
                reviewedBy: 'Title Reviewer',
                reviewNotes,
                rejectionReason}
            : d
        )
      );
      setProcessing(false);
      setShowReviewModal(false);
      setReviewingDoc(null);
      setRejectionReason('');

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
      logger.titleReview.log(`Document rejected: ${reviewingDoc.name}, reason: ${rejectionReason}`);
    }, 600);
  }, [reviewingDoc, reviewNotes, rejectionReason]);

  const handleFinalizeReview = useCallback((approved: boolean) => {
    setProcessing(true);
    setTimeout(() => {
      setSubmission((prev) => ({
        ...prev,
        status: approved ? 'approved' : 'needs_revision',
        completedAt: approved ? new Date().toISOString() : undefined,
        overallNotes,
        tokenizationApproved: approved}));
      setProcessing(false);
      setShowFinalizeModal(false);

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(
          approved
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Warning
        );
      }

      Alert.alert(
        approved ? 'Review Complete' : 'Revision Requested',
        approved
          ? 'All documents approved. This property is cleared for tokenization.'
          : 'The property owner has been notified to revise and resubmit documents.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    }, 1000);
  }, [overallNotes, router]);

  const renderDocumentRow = (doc: TitleDocument) => {
    const config = STATUS_CONFIG[doc.status];
    const isReviewable = doc.status === 'uploaded' || doc.status === 'under_review';

    return (
      <TouchableOpacity
        key={doc.id}
        style={styles.docRow}
        onPress={() => handleOpenReview(doc)}
        activeOpacity={0.7}
        testID={`review-doc-${doc.type}`}
      >
        <View style={[styles.docStatusIndicator, { backgroundColor: config.color }]} />
        <View style={styles.docRowContent}>
          <Text style={styles.docRowName} numberOfLines={1}>{doc.name}</Text>
          <View style={styles.docRowMeta}>
            <View style={[styles.docRowBadge, { backgroundColor: config.color + '20' }]}>
              <Text style={[styles.docRowBadgeText, { color: config.color }]}>{config.label}</Text>
            </View>
            {doc.fileName && (
              <Text style={styles.docRowFile} numberOfLines={1}>{doc.fileName}</Text>
            )}
          </View>
          {doc.reviewNotes && (
            <View style={styles.docRowNotes}>
              <MessageSquare size={11} color={Colors.textTertiary} />
              <Text style={styles.docRowNotesText} numberOfLines={1}>{doc.reviewNotes}</Text>
            </View>
          )}
        </View>
        {isReviewable ? (
          <View style={styles.reviewIndicator}>
            <Eye size={16} color={Colors.primary} />
          </View>
        ) : doc.status === 'not_uploaded' ? (
          <Lock size={16} color={Colors.textTertiary} />
        ) : (
          <ChevronRight size={16} color={Colors.textTertiary} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Title Review',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text}}
      />
      <View style={styles.container}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.propertyHeader}>
            <View style={styles.propertyIconWrap}>
              <Building2 size={24} color={Colors.primary} />
            </View>
            <View style={styles.propertyInfo}>
              <Text style={styles.propertyName}>{submission.propertyName}</Text>
              <Text style={styles.propertyAddress}>{submission.propertyAddress}</Text>
              <View style={styles.ownerRow}>
                <Text style={styles.ownerLabel}>Owner:</Text>
                <Text style={styles.ownerName}>{submission.ownerName}</Text>
              </View>
            </View>
          </View>

          {submission.assignedTitleCompanyName && (
            <View style={styles.companyBanner}>
              <Shield size={16} color={Colors.primary} />
              <Text style={styles.companyBannerText}>
                Reviewing as: <Text style={styles.companyBannerName}>{submission.assignedTitleCompanyName}</Text>
              </Text>
            </View>
          )}

          <View style={styles.statsRow}>
            <View style={[styles.statCard, { borderColor: Colors.success + '40' }]}>
              <CheckCircle size={18} color={Colors.success} />
              <Text style={[styles.statValue, { color: Colors.success }]}>{approvedCount}</Text>
              <Text style={styles.statLabel}>Approved</Text>
            </View>
            <View style={[styles.statCard, { borderColor: Colors.warning + '40' }]}>
              <Clock size={18} color={Colors.warning} />
              <Text style={[styles.statValue, { color: Colors.warning }]}>{pendingCount}</Text>
              <Text style={styles.statLabel}>Pending</Text>
            </View>
            <View style={[styles.statCard, { borderColor: Colors.error + '40' }]}>
              <XCircle size={18} color={Colors.error} />
              <Text style={[styles.statValue, { color: Colors.error }]}>{rejectedCount}</Text>
              <Text style={styles.statLabel}>Rejected</Text>
            </View>
            <View style={[styles.statCard, { borderColor: Colors.textTertiary + '40' }]}>
              <FileText size={18} color={Colors.textTertiary} />
              <Text style={[styles.statValue, { color: Colors.text }]}>{totalUploaded}/{documents.length}</Text>
              <Text style={styles.statLabel}>Uploaded</Text>
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <FileText size={16} color={Colors.primary} />
            <Text style={styles.sectionTitle}>Documents for Review</Text>
          </View>

          <View style={styles.docsContainer}>
            {documents.map(renderDocumentRow)}
          </View>

          {canFinalize && (
            <TouchableOpacity
              style={styles.finalizeBtn}
              onPress={() => setShowFinalizeModal(true)}
              testID="finalize-review"
            >
              <FileCheck size={18} color={Colors.background} />
              <Text style={styles.finalizeBtnText}>Finalize Review</Text>
            </TouchableOpacity>
          )}

          {submission.status === 'approved' && (
            <View style={styles.approvedBanner}>
              <CheckCircle size={24} color={Colors.success} />
              <Text style={styles.approvedTitle}>Review Complete - Approved</Text>
              <Text style={styles.approvedSub}>
                Property cleared for stock tokenization.
              </Text>
            </View>
          )}

          <View style={styles.legalFooter}>
            <Shield size={13} color={Colors.textTertiary} />
            <Text style={styles.legalText}>
              This review portal is confidential. Documents are shared exclusively with the assigned title company. All review actions are logged and auditable.
            </Text>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>

      <Modal visible={showReviewModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Review Document</Text>
              <TouchableOpacity onPress={() => { setShowReviewModal(false); setReviewingDoc(null); }}>
                <X size={22} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {reviewingDoc && (
              <ScrollView style={styles.modalScroll}>
                <View style={styles.reviewDocInfo}>
                  <FileText size={20} color={Colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewDocName}>{reviewingDoc.name}</Text>
                    <Text style={styles.reviewDocFile}>{reviewingDoc.fileName}</Text>
                  </View>
                </View>

                <Text style={styles.reviewDocDesc}>{reviewingDoc.description}</Text>

                <TouchableOpacity style={styles.viewDocBtn}>
                  <Download size={16} color={Colors.info} />
                  <Text style={styles.viewDocBtnText}>Open Document</Text>
                </TouchableOpacity>

                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Review Notes (Optional)</Text>
                  <TextInput
                    style={[styles.formInput, styles.formTextArea]}
                    value={reviewNotes}
                    onChangeText={setReviewNotes}
                    placeholder="Add notes about this document..."
                    placeholderTextColor={Colors.inputPlaceholder}
                    multiline
                    textAlignVertical="top"
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Rejection Reason (Required if rejecting)</Text>
                  <TextInput
                    style={[styles.formInput, styles.formTextArea]}
                    value={rejectionReason}
                    onChangeText={setRejectionReason}
                    placeholder="Explain why this document is being rejected..."
                    placeholderTextColor={Colors.inputPlaceholder}
                    multiline
                    textAlignVertical="top"
                  />
                </View>
              </ScrollView>
            )}

            <View style={styles.reviewActions}>
              <TouchableOpacity
                style={styles.rejectBtn}
                onPress={handleRejectDocument}
                disabled={processing}
              >
                {processing ? (
                  <ShimmerIndicator size="small" color={Colors.error} />
                ) : (
                  <>
                    <ThumbsDown size={16} color={Colors.error} />
                    <Text style={styles.rejectBtnText}>Reject</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.approveBtn}
                onPress={handleApproveDocument}
                disabled={processing}
              >
                {processing ? (
                  <ShimmerIndicator size="small" color={Colors.background} />
                ) : (
                  <>
                    <ThumbsUp size={16} color={Colors.background} />
                    <Text style={styles.approveBtnText}>Approve</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showFinalizeModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Finalize Review</Text>
              <TouchableOpacity onPress={() => setShowFinalizeModal(false)}>
                <X size={22} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll}>
              <View style={styles.finalizeSummary}>
                <Text style={styles.finalizeSummaryTitle}>Review Summary</Text>
                <View style={styles.finalizeStat}>
                  <CheckCircle size={14} color={Colors.success} />
                  <Text style={styles.finalizeStatText}>{approvedCount} documents approved</Text>
                </View>
                <View style={styles.finalizeStat}>
                  <XCircle size={14} color={Colors.error} />
                  <Text style={styles.finalizeStatText}>{rejectedCount} documents rejected</Text>
                </View>
              </View>

              {rejectedCount > 0 && (
                <View style={styles.warningBox}>
                  <AlertTriangle size={16} color={Colors.warning} />
                  <Text style={styles.warningText}>
                    Some documents were rejected. You can approve with conditions or request full revision.
                  </Text>
                </View>
              )}

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Overall Notes</Text>
                <TextInput
                  style={[styles.formInput, styles.formTextArea]}
                  value={overallNotes}
                  onChangeText={setOverallNotes}
                  placeholder="Final notes for the property owner..."
                  placeholderTextColor={Colors.inputPlaceholder}
                  multiline
                  textAlignVertical="top"
                />
              </View>
            </ScrollView>

            <View style={styles.reviewActions}>
              {rejectedCount > 0 && (
                <TouchableOpacity
                  style={styles.revisionBtn}
                  onPress={() => handleFinalizeReview(false)}
                  disabled={processing}
                >
                  {processing ? (
                    <ShimmerIndicator size="small" color={Colors.warning} />
                  ) : (
                    <Text style={styles.revisionBtnText}>Request Revision</Text>
                  )}
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.approveAllBtn, rejectedCount > 0 && { flex: 1 }]}
                onPress={() => handleFinalizeReview(true)}
                disabled={processing || rejectedCount > 0}
              >
                {processing ? (
                  <ShimmerIndicator size="small" color={Colors.background} />
                ) : (
                  <>
                    <Shield size={16} color={Colors.background} />
                    <Text style={styles.approveAllBtnText}>
                      Approve for Tokenization
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollView: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: 20, paddingBottom: 140 },
  propertyHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  propertyIconWrap: { width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  propertyInfo: { flex: 1 },
  propertyName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  propertyAddress: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ownerLabel: { color: Colors.textSecondary, fontSize: 13 },
  ownerName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  companyBanner: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  companyBannerText: { color: Colors.textSecondary, fontSize: 13 },
  companyBannerName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  docsContainer: { gap: 8 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  docStatusIndicator: { width: 4, borderRadius: 2 },
  docRowContent: { flex: 1, gap: 4 },
  docRowName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  docRowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  docRowBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  docRowBadgeText: { fontSize: 11, fontWeight: '700' as const },
  docRowFile: { color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  docRowNotes: { marginTop: 6, padding: 8, backgroundColor: Colors.warning + '10', borderRadius: 8 },
  docRowNotesText: { color: Colors.textSecondary, fontSize: 13 },
  reviewIndicator: { width: 4, borderRadius: 2 },
  finalizeBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  finalizeBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  approvedBanner: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  approvedTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  approvedSub: { color: Colors.textTertiary, fontSize: 12, marginTop: 2 },
  legalFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  legalText: { color: Colors.textSecondary, fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  modalScroll: { maxHeight: 400 },
  reviewDocInfo: { flex: 1 },
  reviewDocName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  reviewDocFile: { gap: 8 },
  reviewDocDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  viewDocBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  viewDocBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  formGroup: { gap: 6, marginBottom: 12 },
  formLabel: { color: Colors.textSecondary, fontSize: 13 },
  formInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  formTextArea: { backgroundColor: '#1A1A1A', borderRadius: 12, padding: 14, color: '#E0E0E0', fontSize: 16, borderWidth: 1, borderColor: '#2A2A2A', minHeight: 100, textAlignVertical: 'top' },
  reviewActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  rejectBtn: { backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  rejectBtnText: { color: Colors.error, fontWeight: '700' as const, fontSize: 15 },
  approveBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  approveBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  finalizeSummary: { backgroundColor: '#FFD700', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  finalizeSummaryTitle: { color: '#000000', fontSize: 16, fontWeight: '700' as const },
  finalizeStat: { backgroundColor: '#FFD700', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  finalizeStatText: { color: '#000000', fontSize: 13 },
  warningBox: { backgroundColor: Colors.warning + '10', borderRadius: 12, padding: 14, flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: Colors.warning + '20' },
  warningText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18, flex: 1 },
  revisionBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  revisionBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  approveAllBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  approveAllBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 }});
