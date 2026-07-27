/**
 * IVX Chat QA Panel — Owner-only diagnostic panel for the inverted FlatList
 * chat fix. Displays live runtime metrics, test pass/fail selectors,
 * Copy QA Evidence, and Export QA Report buttons.
 *
 * SECURITY: This panel is gated behind `developerToolsAllowed` (owner auth).
 * It never displays message contents, auth tokens, or user PII — only
 * structural metadata (IDs, counts, booleans, timestamps).
 *
 * REMOVAL: Set `IVX_CHAT_QA_PANEL_ENABLED` to false in chatQaDiagnostics.ts
 * to hide this panel after certification.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ClipboardCheck, Download, FileText, X } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { safeSetString } from '@/lib/safe-clipboard';
import {
  type ChatQaMetrics,
  buildQaReport,
  createDefaultTestResults,
  formatQaMetricsForCopy,
  QA_TEST_LABELS,
} from '@/src/modules/chat/services/chatQaDiagnostics';

type TestResult = 'pass' | 'fail' | 'blocked' | 'untested';
type TestResults = Record<string, TestResult>;

interface ChatQaPanelProps {
  /** Live metrics snapshot collected from the chat screen. */
  metrics: ChatQaMetrics;
  /** Called when the owner taps Close. */
  onClose: () => void;
  /** Called when the owner submits evidence to the backend. */
  onSubmitEvidence: (report: string) => void;
  /** Whether evidence submission is in progress. */
  submitting: boolean;
  /** Whether the last evidence submission succeeded. */
  submitResult: 'idle' | 'success' | 'error' | null;
}

const RESULT_COLORS: Record<TestResult, string> = {
  pass: Colors.primary,
  fail: Colors.error,
  blocked: Colors.warning,
  untested: Colors.textTertiary,
};

const RESULT_LABELS: Record<TestResult, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  blocked: 'BLOCKED',
  untested: '—',
};

const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace' }) as string;

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel} numberOfLines={2}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function TestSelector({
  testKey,
  label,
  current,
  onSelect,
}: {
  testKey: string;
  label: string;
  current: TestResult;
  onSelect: (key: string, result: TestResult) => void;
}) {
  const options: TestResult[] = ['pass', 'fail', 'blocked', 'untested'];
  return (
    <View style={styles.testRow}>
      <Text style={styles.testLabel}>{label}</Text>
      <View style={styles.testButtons}>
        {options.map((opt) => (
          <Pressable
            key={opt}
            style={[
              styles.testButton,
              current === opt ? { backgroundColor: RESULT_COLORS[opt] } : null,
            ]}
            onPress={() => onSelect(testKey, opt)}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={`${label} — mark as ${RESULT_LABELS[opt]}`}
          >
            <Text
              style={[
                styles.testButtonText,
                current === opt ? styles.testButtonTextActive : null,
              ]}
            >
              {RESULT_LABELS[opt]}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function ChatQaPanel({
  metrics,
  onClose,
  onSubmitEvidence,
  submitting,
  submitResult,
}: ChatQaPanelProps) {
  const [testResults, setTestResults] = useState<TestResults>(createDefaultTestResults);
  const [ownerComments, setOwnerComments] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  const handleSelectTest = useCallback((key: string, result: TestResult) => {
    setTestResults((prev) => ({ ...prev, [key]: result }));
  }, []);

  const handleCopyEvidence = useCallback(() => {
    const text = formatQaMetricsForCopy(metrics);
    safeSetString(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [metrics]);

  const handleExportReport = useCallback(() => {
    const report = buildQaReport(metrics, testResults, ownerComments);
    onSubmitEvidence(report);
  }, [metrics, testResults, ownerComments, onSubmitEvidence]);

  const passedCount = useMemo(
    () => Object.values(testResults).filter((r) => r === 'pass').length,
    [testResults],
  );
  const failedCount = useMemo(
    () => Object.values(testResults).filter((r) => r === 'fail').length,
    [testResults],
  );
  const totalTests = Object.keys(testResults).length;

  return (
    <View style={styles.overlay} testID="ivx-chat-qa-panel">
      <View style={styles.panel}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <ClipboardCheck size={16} color={Colors.primary} />
            <Text style={styles.title}>Chat QA Diagnostics</Text>
          </View>
          <Pressable
            style={styles.closeButton}
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close QA panel"
          >
            <X size={18} color={Colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
        >
          <View style={styles.traceBanner}>
            <Text style={styles.traceLabel}>TRACE ID</Text>
            <Text style={styles.traceValue}>{metrics.traceId}</Text>
          </View>

          <Text style={styles.sectionTitle}>Live Metrics</Text>
          <View style={styles.metricsCard}>
            <MetricRow label="conversation_id" value={metrics.conversationId ?? 'null'} />
            <MetricRow label="active_room_id" value={metrics.activeRoomId ?? 'null'} />
            <MetricRow label="message_count" value={String(metrics.messageCount)} />
            <MetricRow label="list_inverted" value={String(metrics.listInverted)} />
            <MetricRow label="first_content_offset" value={metrics.firstContentOffset != null ? String(metrics.firstContentOffset) : 'null'} />
            <MetricRow label="initial_position_applied" value={String(metrics.initialPositionApplied)} />
            <MetricRow label="user_near_latest" value={String(metrics.userNearLatest)} />
            <MetricRow label="yellow_arrow_visible" value={String(metrics.yellowArrowVisible)} />
            <MetricRow label="first_rendered_message_id" value={metrics.firstRenderedMessageId ?? 'null'} />
            <MetricRow label="newest_server_message_id" value={metrics.newestServerMessageId ?? 'null'} />
            <MetricRow label="oldest_rendered_message_id" value={metrics.oldestRenderedMessageId ?? 'null'} />
            <MetricRow label="pagination_cursor" value={metrics.paginationCursor ?? 'null'} />
            <MetricRow label="has_more_older_messages" value={String(metrics.hasMoreOlderMessages)} />
            <MetricRow label="duplicate_message_count" value={String(metrics.duplicateMessageCount)} />
            <MetricRow label="realtime_subscription_count" value={String(metrics.realtimeSubscriptionCount)} />
            <MetricRow label="last_reconnect_time" value={metrics.lastReconnectTime ?? 'null'} />
            <View style={styles.metricDivider} />
            <MetricRow label="app_version" value={metrics.appVersion} />
            <MetricRow label="commit_sha" value={metrics.commitSha} />
            <MetricRow label="device_platform" value={metrics.devicePlatform} />
            <MetricRow label="timestamp" value={metrics.timestamp} />
          </View>

          <Text style={styles.sectionTitle}>{`Owner Test Results (${passedCount}/${totalTests} pass, ${failedCount} fail)`}</Text>
          <View style={styles.testsCard}>
            {Object.entries(QA_TEST_LABELS).map(([key, label]) => (
              <TestSelector
                key={key}
                testKey={key}
                label={label}
                current={testResults[key] ?? 'untested'}
                onSelect={handleSelectTest}
              />
            ))}
          </View>

          <Text style={styles.sectionTitle}>Owner Comments</Text>
          <TextInput
            style={styles.commentsInput}
            value={ownerComments}
            onChangeText={setOwnerComments}
            placeholder="Notes, defects observed, device model, Android version…"
            placeholderTextColor={Colors.textTertiary}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          <View style={styles.actionsRow}>
            <Pressable
              style={[styles.actionButton, styles.copyButton]}
              onPress={handleCopyEvidence}
              testID="ivx-chat-qa-copy"
            >
              <FileText size={14} color={Colors.black} />
              <Text style={styles.copyButtonText}>{copied ? 'Copied!' : 'Copy QA Evidence'}</Text>
            </Pressable>
            <Pressable
              style={[styles.actionButton, styles.exportButton, submitting ? styles.actionButtonDisabled : null]}
              onPress={handleExportReport}
              disabled={submitting}
              testID="ivx-chat-qa-export"
            >
              <Download size={14} color={Colors.black} />
              <Text style={styles.exportButtonText}>{submitting ? 'Submitting…' : 'Export QA Report'}</Text>
            </Pressable>
          </View>

          {submitResult === 'success' ? (
            <Text style={styles.submitSuccess}>{`Evidence submitted. Trace ID: ${metrics.traceId}`}</Text>
          ) : null}
          {submitResult === 'error' ? (
            <Text style={styles.submitError}>Submission failed. Copy evidence and retry.</Text>
          ) : null}

          <Text style={styles.footnote}>
            Owner-only diagnostic panel. No message contents, tokens, or PII are exposed. Disable by setting IVX_CHAT_QA_PANEL_ENABLED = false after certification.
          </Text>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  panel: {
    width: '92%',
    maxHeight: '88%',
    backgroundColor: Colors.background,
    borderRadius: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  closeButton: {
    padding: 4,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  traceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.card,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  traceLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 1,
  },
  traceValue: {
    fontSize: 12,
    fontFamily: MONO_FONT,
    color: Colors.text,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginBottom: 8,
    marginTop: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metricsCard: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 12,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 4,
  },
  metricLabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    flex: 1,
    marginRight: 8,
  },
  metricValue: {
    fontSize: 12,
    color: Colors.text,
    fontFamily: MONO_FONT,
    textAlign: 'right',
    flex: 1,
  },
  metricDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginVertical: 6,
  },
  testsCard: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 12,
  },
  testRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  testLabel: {
    fontSize: 13,
    color: Colors.text,
    flex: 1,
  },
  testButtons: {
    flexDirection: 'row',
    gap: 4,
  },
  testButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: Colors.background,
    minWidth: 56,
    alignItems: 'center',
  },
  testButtonText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  testButtonTextActive: {
    color: Colors.black,
  },
  commentsInput: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    color: Colors.text,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  copyButton: {
    backgroundColor: Colors.card,
  },
  copyButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
  },
  exportButton: {
    backgroundColor: Colors.primary,
  },
  exportButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.black,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  submitSuccess: {
    fontSize: 12,
    color: Colors.primary,
    marginTop: 10,
    textAlign: 'center',
  },
  submitError: {
    fontSize: 12,
    color: Colors.error,
    marginTop: 10,
    textAlign: 'center',
  },
  footnote: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 16,
    textAlign: 'center',
  },
});
