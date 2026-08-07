/**
 * IVX Staged Timeout Banner.
 *
 * Replaces the single 180s watchdog timeout with a progressive UX:
 *   15s → "Still working…" (informational, auto-dismiss when response arrives)
 *   45s → One safe retry if no backend request started
 *   90s → Query backend status by traceId
 *  180s → Fail gracefully with exact diagnostic evidence
 *
 * Shows Retry and Cancel actions. No infinite spinner.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, Clock, RefreshCw, X, Activity } from 'lucide-react-native';
import Constants from 'expo-constants';
import { getIVXBuildInfo } from '@/constants/build-info';
import Colors from '@/constants/colors';
import { SafeIcon } from '@/lib/safe-icon';

export type TimeoutStage = 'idle' | 'working' | 'retrying' | 'checking_status' | 'failed' | 'cancelled';

export interface TimeoutEvidence {
  traceId: string;
  requestId: string | null;
  conversationId: string | null;
  messageId: string;
  lastSuccessfulCheckpoint: string | null;
  failedCheckpoint: string | null;
  requestStarted: boolean;
  httpStatus: number | null;
  retryCount: number;
  networkStatus: 'online' | 'offline' | 'unknown';
  appVersion: string;
  buildNumber: string;
  commitSha: string;
  elapsedMs: number;
}

export interface IVXStagedTimeoutBannerProps {
  traceId: string;
  messageId: string;
  conversationId: string | null;
  requestStarted: boolean;
  lastSuccessfulCheckpoint: string | null;
  onRetry: () => void;
  onCancel: () => void;
  onQueryBackendStatus: (traceId: string) => Promise<TimeoutEvidence | null>;
}

const STAGE_WORKING_MS = 30_000;
const STAGE_RETRY_MS = 60_000;
const STAGE_STATUS_CHECK_MS = 120_000;
const STAGE_FAIL_MS = 180_000;

export function IVXStagedTimeoutBanner({
  traceId,
  messageId,
  conversationId,
  requestStarted,
  lastSuccessfulCheckpoint,
  onRetry,
  onCancel,
  onQueryBackendStatus}: IVXStagedTimeoutBannerProps): React.JSX.Element | null {
  const [stage, setStage] = useState<TimeoutStage>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [failedCheckpoint, setFailedCheckpoint] = useState<string | null>(null);
  const [dismissible, setDismissible] = useState(false);
  const startRef = useRef<number>(Date.now());
  const retryFiredRef = useRef(false);
  const statusCheckFiredRef = useRef(false);

  const buildInfo = getIVXBuildInfo();
  const appVersion = buildInfo.appVersion;
  const buildNumber = String(Constants.expoConfig?.android?.versionCode ?? 'unknown');
  const commitSha = buildInfo.commitShort;

  // Timer effect: progress through stages
  useEffect(() => {
    startRef.current = Date.now();
    setStage('working');
    setElapsedMs(0);
    setDismissible(false);
    retryFiredRef.current = false;
    statusCheckFiredRef.current = false;

    const tickInterval = setInterval(() => {
      setElapsedMs(Date.now() - startRef.current);
    }, 1000);

    const retryTimer = setTimeout(() => {
      if (!retryFiredRef.current && !requestStarted) {
        retryFiredRef.current = true;
        setStage('retrying');
        setRetryCount((c) => c + 1);
        onRetry();
        // Return to working state after retry fires
        setTimeout(() => setStage('working'), 2000);
      }
    }, STAGE_RETRY_MS);

    const statusTimer = setTimeout(() => {
      if (!statusCheckFiredRef.current) {
        statusCheckFiredRef.current = true;
        setStage('checking_status');
        void onQueryBackendStatus(traceId).then((evidence) => {
          if (evidence) {
            setHttpStatus(evidence.httpStatus);
            if (evidence.failedCheckpoint) {
              setFailedCheckpoint(evidence.failedCheckpoint);
            }
          }
          // Return to working after status check
          setTimeout(() => setStage('working'), 3000);
        });
      }
    }, STAGE_STATUS_CHECK_MS);

    const failTimer = setTimeout(() => {
      setStage('failed');
      setFailedCheckpoint(lastSuccessfulCheckpoint ? 'NEXT_AFTER_' + lastSuccessfulCheckpoint : 'AI_MUTATION_STARTED');
      setDismissible(true);
    }, STAGE_FAIL_MS);

    return () => {
      clearInterval(tickInterval);
      clearTimeout(retryTimer);
      clearTimeout(statusTimer);
      clearTimeout(failTimer);
    };
  }, [traceId, requestStarted, lastSuccessfulCheckpoint, onRetry, onQueryBackendStatus]);

  const handleCancel = useCallback(() => {
    setStage('cancelled');
    setDismissible(true);
    onCancel();
  }, [onCancel]);

  const handleRetry = useCallback(() => {
    setRetryCount((c) => c + 1);
    setStage('working');
    startRef.current = Date.now();
    retryFiredRef.current = false;
    statusCheckFiredRef.current = false;
    onRetry();
  }, [onRetry]);

  if (stage === 'idle' || stage === 'cancelled') return null;

  const elapsedSeconds = Math.floor(elapsedMs / 1000);

  const evidence: TimeoutEvidence = {
    traceId,
    requestId: null,
    conversationId,
    messageId,
    lastSuccessfulCheckpoint,
    failedCheckpoint,
    requestStarted,
    httpStatus,
    retryCount,
    networkStatus: 'unknown',
    appVersion,
    buildNumber,
    commitSha,
    elapsedMs};

  // Stage-specific styling
  const stageConfig: Record<TimeoutStage, { color: string; bg: string; icon: typeof Clock; label: string }> = {
    idle: { color: Colors.gold, bg: '#2a2a00', icon: Clock, label: '' },
    working: { color: Colors.gold, bg: '#2a2200', icon: Activity, label: `Still working… ${elapsedSeconds}s` },
    retrying: { color: Colors.blue, bg: '#001a2a', icon: RefreshCw, label: `Retrying… (${retryCount})` },
    checking_status: { color: Colors.blue, bg: '#001a2a', icon: Activity, label: 'Checking backend status…' },
    failed: { color: Colors.red, bg: '#2a0000', icon: AlertTriangle, label: 'Request timed out' },
    cancelled: { color: '#888', bg: '#1a1a1a', icon: X, label: 'Cancelled' }};

  const cfg = stageConfig[stage];

  return (
    <View style={[styles.container, { backgroundColor: cfg.bg, borderColor: cfg.color }]}>
      <View style={styles.headerRow}>
        <SafeIcon icon={cfg.icon} name="TimeoutStage" size={16} color={cfg.color} />
        <Text style={[styles.headerText, { color: cfg.color }]}>{cfg.label}</Text>
        {dismissible ? (
          <Pressable onPress={() => setStage('idle')} style={styles.closeButton} hitSlop={8}>
            <SafeIcon icon={X} name="X" size={14} color="#888" />
          </Pressable>
        ) : null}
      </View>

      {/* Evidence lines for failed stage */}
      {stage === 'failed' ? (
        <View style={styles.evidenceContainer}>
          <Text style={styles.evidenceTitle}>Diagnostic evidence:</Text>
          <Text style={styles.evidenceLine}>Trace ID: {traceId}</Text>
          <Text style={styles.evidenceLine}>Message ID: {messageId}</Text>
          <Text style={styles.evidenceLine}>Last checkpoint: {lastSuccessfulCheckpoint ?? 'none'}</Text>
          <Text style={styles.evidenceLine}>Failed at: {failedCheckpoint ?? 'unknown'}</Text>
          <Text style={styles.evidenceLine}>Request started: {requestStarted ? 'YES' : 'NO'}</Text>
          <Text style={styles.evidenceLine}>HTTP status: {httpStatus ?? 'N/A'}</Text>
          <Text style={styles.evidenceLine}>Retry count: {retryCount}</Text>
          <Text style={styles.evidenceLine}>Elapsed: {elapsedSeconds}s</Text>
          <Text style={styles.evidenceLine}>App: {appVersion} (build {buildNumber})</Text>
          <Text style={styles.evidenceLine}>Commit: {commitSha}</Text>
        </View>
      ) : null}

      {/* Action buttons */}
      <View style={styles.actionsRow}>
        {stage !== 'failed' ? (
          <Pressable onPress={handleCancel} style={[styles.actionButton, styles.cancelButton]} hitSlop={8}>
            <SafeIcon icon={X} name="X" size={13} color={Colors.red} />
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        ) : null}
        {stage === 'failed' ? (
          <Pressable onPress={handleRetry} style={[styles.actionButton, styles.retryButton]} hitSlop={8}>
            <SafeIcon icon={RefreshCw} name="RefreshCw" size={13} color={Colors.gold} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        ) : null}
        {stage === 'failed' ? (
          <Pressable onPress={handleCancel} style={[styles.actionButton, styles.dismissButton]} hitSlop={8}>
            <Text style={styles.dismissText}>Dismiss</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1},
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4},
  headerText: {
    fontSize: 14,
    fontWeight: '700' as const,
    marginLeft: 8,
    flex: 1},
  closeButton: {
    padding: 4},
  evidenceContainer: {
    marginTop: 10,
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 8},
  evidenceTitle: {
    color: '#ccc',
    fontSize: 12,
    fontWeight: '600' as const,
    marginBottom: 4},
  evidenceLine: {
    color: '#999',
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 2},
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10},
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 6},
  cancelButton: {
    backgroundColor: 'rgba(255,77,77,0.15)'},
  retryButton: {
    backgroundColor: 'rgba(255,215,0,0.15)'},
  dismissButton: {
    backgroundColor: 'rgba(136,136,136,0.15)'},
  cancelText: {
    color: Colors.red,
    fontSize: 13,
    fontWeight: '600' as const},
  retryText: {
    color: Colors.gold,
    fontSize: 13,
    fontWeight: '600' as const},
  dismissText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600' as const}});
