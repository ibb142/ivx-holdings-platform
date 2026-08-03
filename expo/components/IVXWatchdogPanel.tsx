/**
 * IVX Owner AI Watchdog UI.
 *
 * Two surfaces:
 * 1. <IVXWatchdogBanner /> — a compact red banner shown when the latest
 *    report's finalStatus is BLOCKED, SILENT_FAILURE, or VISIBLE_ERROR.
 *    Tapping it opens the drawer.
 * 2. <IVXWatchdogDrawer /> — a full-screen modal showing the last 20
 *    reports with every checkpoint, file:line, and fix hint. Built so the
 *    owner can screenshot it from a mobile device.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CHECKPOINT_ORDER, ivxAIWatchdog, type WatchdogReport, type WatchdogSnapshot } from '@/src/modules/ivx-owner-ai/services/ivxAIWatchdog';
import {
  analyzeBackendPostFailures,
  BACKEND_POST_FAILURE_CAUSE_LABEL,
  classifyWatchdogWarning,
  resolveDegradedRecoveryFields,
  resolveFailureBannerFields,
  type AnalyzableWatchdogReport,
  type BannerReportInput} from '@/src/modules/ivx-owner-ai/services/ivxBackendPostFailureAnalyzer';
import { getIVXOwnerAIResolvedEndpoint, getIVXOwnerAIConfigAudit, getIVXAuthStatusSnapshot, type IVXAuthStatusSnapshot } from '@/lib/ivx-supabase-client';

const CANONICAL_OWNER_AI_URL = 'https://api.ivxholding.com/api/ivx/owner-ai';

function resolveDisplayOwnerAIUrl(): { url: string; forced: boolean; raw: string | null } {
  let raw: string | null = null;
  try {
    raw = getIVXOwnerAIResolvedEndpoint();
  } catch {
    raw = null;
  }
  const trimmed = (raw ?? '').trim();
  const lower = trimmed.toLowerCase();
  const looksBad = !trimmed
    || lower === 'undefined'
    || lower === 'null'
    || lower.includes('ivxtest.dev')
    || lower.includes('localhost')
    || lower.includes('127.0.0.1')
    || lower.includes('192.168.')
    || (typeof window !== 'undefined' && typeof window.location?.origin === 'string' && window.location.origin && lower.startsWith(window.location.origin.toLowerCase()));
  if (looksBad) {
    return { url: CANONICAL_OWNER_AI_URL, forced: true, raw };
  }
  return { url: trimmed, forced: false, raw };
}

const COLORS = {
  bannerBg: '#3a0a0a',
  bannerBorder: '#ff4d4f',
  bannerText: '#ffd7d8',
  bannerSubtext: '#ff9a9c',
  pendingBg: '#2a1f05',
  pendingBorder: '#f59e0b',
  pendingText: '#fde68a',
  drawerBg: '#0b0d10',
  cardBg: '#15181d',
  cardBorder: '#23272f',
  passGreen: '#4ade80',
  failRed: '#f87171',
  pendingGrey: '#6b7280',
  successBadge: '#16a34a',
  infoBadge: '#2563eb',
  errorBadge: '#dc2626',
  blockedBadge: '#b91c1c',
  silentBadge: '#7c2d12',
  degradedBadge: '#d97706',
  warnBannerBg: '#2a1f05',
  warnBannerBorder: '#f59e0b',
  warnBannerText: '#fde68a',
  warnBannerSubtext: '#fbbf24',
  text: '#e5e7eb',
  subtext: '#9ca3af'} as const;

function useWatchdogSnapshot(): WatchdogSnapshot {
  const [snapshot, setSnapshot] = useState<WatchdogSnapshot>(() => ivxAIWatchdog.getSnapshot());
  useEffect(() => {
    void ivxAIWatchdog.hydrate();
    const unsub = ivxAIWatchdog.subscribe(setSnapshot);
    return () => {
      unsub();
    };
  }, []);
  return snapshot;
}

function useLatestReports(): WatchdogReport[] {
  const snapshot = useWatchdogSnapshot();
  return snapshot.finalized;
}

// Module-level single-instance guard. Prevents stacked HUDs caused by
// duplicate route mounts, fast-refresh remounts, or accidental double renders.
let HUD_INSTANCE_COUNT = 0;
let BANNER_INSTANCE_COUNT = 0;

const BUILD_TAG = 'hud-v2-' + (typeof __DEV__ !== 'undefined' && __DEV__ ? 'dev' : 'prod');

/**
 * Always-visible HUD: shows tap counter, active trace count, latest report status.
 * Single-instance enforced — any additional mount logs a warning and renders null.
 *
 * IMPORTANT: All hooks MUST be called above the early-return for duplicate mounts.
 * Otherwise the first render (isPrimary=false) and the post-effect render
 * (isPrimary=true) would execute a different number of hooks → React throws
 * "Rendered more hooks than during the previous render" → white screen in Expo Go.
 */
export function IVXWatchdogHUD({ onPress }: { onPress: () => void }): React.ReactElement | null {
  // --- all hooks up-front (stable order across renders) ---
  const snapshot = useWatchdogSnapshot();
  const [mountTick, setMountTick] = useState<number>(0);
  const [isPrimary, setIsPrimary] = useState<boolean>(false);
  const [authStatus, setAuthStatus] = useState<IVXAuthStatusSnapshot | null>(null);

  useEffect(() => {
    HUD_INSTANCE_COUNT += 1;
    const primary = HUD_INSTANCE_COUNT === 1;
    setIsPrimary(primary);
    const mountedAt = new Date().toISOString();
    if (primary) {
      console.log('[IVX_HUD] MOUNTED (primary)', mountedAt);
    } else {
      console.log('[IVX_HUD] DUPLICATE_MOUNT_SUPPRESSED', { mountedAt, totalInstances: HUD_INSTANCE_COUNT });
    }
    setMountTick(Date.now());
    const interval = setInterval(() => setMountTick(Date.now()), 1000);
    return () => {
      clearInterval(interval);
      HUD_INSTANCE_COUNT = Math.max(0, HUD_INSTANCE_COUNT - 1);
      console.log('[IVX_HUD] UNMOUNTED', { at: new Date().toISOString(), remainingInstances: HUD_INSTANCE_COUNT });
    };
  }, []);

  const urlInfo = useMemo(() => resolveDisplayOwnerAIUrl(), [mountTick]);

  useEffect(() => {
    if (!isPrimary) return;
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const snap = await getIVXAuthStatusSnapshot();
        if (!cancelled) setAuthStatus(snap);
      } catch (err) {
        console.log('[IVX_HUD] auth status refresh failed:', err instanceof Error ? err.message : 'unknown');
      }
    };
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isPrimary]);

  // --- early-return for duplicate mounts AFTER all hooks ---
  if (!isPrimary) return null;

  const latest = snapshot.active[snapshot.active.length - 1] ?? snapshot.finalized[0] ?? null;
  const statusLabel = latest ? latest.finalStatus : 'idle';
  const lastCp = latest?.lastSuccessfulCheckpoint ?? '—';
  const failedCp = latest?.failedCheckpoint ?? '—';
  const tapLabel = snapshot.lastTap
    ? `${snapshot.lastTap.at.slice(11, 19)}${snapshot.lastTap.blocked ? ` BLOCKED:${snapshot.lastTap.reason}` : ''}`
    : 'no taps yet';
  const color = (() => {
    if (!latest) return '#6b7280';
    if (latest.finalStatus === 'PENDING') return '#f59e0b';
    if (latest.finalStatus === 'SUCCESS') return '#16a34a';
    if (latest.finalStatus === 'DEGRADED') return '#d97706';
    // Yellow for recoverable/degraded warnings, red only for true errors.
    return classifyWatchdogWarning(latest as unknown as AnalyzableWatchdogReport).severity === 'error' ? '#dc2626' : '#d97706';
  })();
  const aliveSec = Math.floor((Date.now() - (mountTick || Date.now())) / 1000);
  const issuerHost = (() => {
    if (!authStatus?.issuer) return '—';
    try { return new URL(authStatus.issuer).host; } catch { return authStatus.issuer; }
  })();
  return (
    <Pressable onPress={onPress} style={[styles.hud, { borderColor: color }]} testID="ivx-watchdog-hud">
      <Text style={styles.hudHeader}>● IVX WATCHDOG HUD · alive {aliveSec}s · build {BUILD_TAG}</Text>
      <Text style={[styles.hudTitle, { color }]}>{statusLabel} · taps:{snapshot.tapCount} blocked:{snapshot.blockedTapCount} active:{snapshot.active.length} reports:{snapshot.finalized.length}</Text>
      <Text style={styles.hudLine} selectable>resolvedOwnerAIUrl: {urlInfo.url}{urlInfo.forced ? ' (FORCED canonical)' : ''}</Text>
      <Text style={styles.hudLine} selectable>
        auth: tokenPresent={String(authStatus?.tokenPresent ?? 'pending')} len={authStatus?.tokenLength ?? 0} expiresIn={authStatus?.expiresInSeconds ?? 'n/a'}s
      </Text>
      <Text style={styles.hudLine} selectable>
        issuer: {issuerHost} projectMatch={String(authStatus?.matchesFrontendSupabase ?? 'n/a')} mode={authStatus?.securityMode ?? 'n/a'} bypass={String(authStatus?.ownerBypassEnabled ?? false)} platform={authStatus?.platform ?? 'n/a'}
      </Text>
      {urlInfo.forced && urlInfo.raw ? <Text style={styles.hudLine} selectable>rawResolved: {urlInfo.raw}</Text> : null}
      <Text style={styles.hudLine}>lastTap: {tapLabel}</Text>
      <Text style={styles.hudLine}>lastSuccessful: {lastCp}  failed: {failedCp}</Text>
      {latest?.fileLine ? <Text style={styles.hudLine}>file: {latest.fileLine}</Text> : null}
      <Text style={styles.hudHint}>Tap to open watchdog drawer</Text>
    </Pressable>
  );
}

/**
 * Returns the most recent report that should drive the live banner:
 * any active (PENDING) trace, else the latest finalized report.
 */
function useLatestTrackedReport(): WatchdogReport | null {
  const snapshot = useWatchdogSnapshot();
  if (snapshot.active.length > 0) {
    return snapshot.active[snapshot.active.length - 1] ?? null;
  }
  return snapshot.finalized[0] ?? null;
}

interface BannerProps {
  onPress: () => void;
}

/** Terminal failure states that should raise the red "IVX AI BLOCKED" banner. */
const FAILURE_STATUSES: ReadonlySet<WatchdogReport['finalStatus']> = new Set([
  'BLOCKED',
  'SILENT_FAILURE',
  'VISIBLE_ERROR',
]);

/** Split an "owner/file/path.ts:functionName" checkpoint owner into path + function. */
function splitFileAndFunction(fileLine: string | null): { filePath: string; functionName: string } {
  if (!fileLine) {
    return { filePath: '—', functionName: '—' };
  }
  const colon = fileLine.indexOf(':');
  if (colon === -1) {
    return { filePath: fileLine, functionName: '—' };
  }
  return {
    filePath: fileLine.slice(0, colon).trim() || '—',
    functionName: fileLine.slice(colon + 1).trim() || '—'};
}

export function IVXWatchdogBanner({ onPress }: BannerProps): React.ReactElement | null {
  // All hooks above the early-return — see IVXWatchdogHUD note on hook order.
  const [isPrimary, setIsPrimary] = useState<boolean>(false);
  const latest = useLatestTrackedReport();
  const warning = useMemo(
    () => (latest ? classifyWatchdogWarning(latest as unknown as AnalyzableWatchdogReport) : null),
    [latest],
  );
  useEffect(() => {
    BANNER_INSTANCE_COUNT += 1;
    const primary = BANNER_INSTANCE_COUNT === 1;
    setIsPrimary(primary);
    if (!primary) {
      console.log('[IVX_BANNER] DUPLICATE_MOUNT_SUPPRESSED', { totalInstances: BANNER_INSTANCE_COUNT });
    }
    return () => {
      BANNER_INSTANCE_COUNT = Math.max(0, BANNER_INSTANCE_COUNT - 1);
    };
  }, []);
  if (!isPrimary) return null;
  if (!latest || !warning) return null;

  // TRUTHFUL severity, not a raw finalStatus map:
  //   success → never shown (no decoration on a clean answer).
  //   warning (DEGRADED_RECOVERY / AUTH_REQUIRED) → YELLOW "degraded" banner.
  //     A valid answer was delivered (recovered via fallback) or the owner
  //     session just needs a refresh — NEVER the red "BLOCKED" alarm.
  //   error (NETWORK_FAILED / TIMEOUT / PARSE_ERROR / TRUE_FAILURE) → RED banner.
  // This removes the false red BACKEND_POST_FINISHED warning when a response
  // exists / the request recovered via fallback / the assistant persisted.
  if (warning.severity === 'success') return null;
  const isError = warning.severity === 'error';
  const isInProgress = warning.severity === 'info';

  // IN_PROGRESS (still in-flight): show an honest WORKING banner with elapsed
  // time + the last checkpoint reached. Never blank "DEGRADED" fields — a
  // working request has not failed OR recovered, so failure fields are N/A.
  if (isInProgress) {
    const elapsedSec = Math.max(0, Math.floor((Date.now() - new Date(latest.startedAt).getTime()) / 1000));
    const lastReached = latest.lastSuccessfulCheckpoint ?? 'SEND_TAP';
    return (
      <Pressable
        onPress={onPress}
        style={[styles.banner, styles.bannerInfo]}
        testID="ivx-watchdog-banner"
        accessibilityRole="button"
      >
        <Text style={[styles.bannerTitle, styles.bannerTitleInfo]}>◐ IVX AI WORKING — {warning.label}</Text>
        <Text style={styles.bannerSummary} selectable>
          in progress {elapsedSec}s — last reached: {lastReached}
        </Text>
        <Text style={styles.bannerLine} selectable>state: WORKING (not failed, not recovered)</Text>
        <Text style={styles.bannerLine} selectable>traceId: {latest.traceId}</Text>
        <Text style={styles.bannerLine} selectable>lastReached: {lastReached}</Text>
        <Text style={styles.bannerLine} selectable>elapsed: {elapsedSec}s</Text>
        <Text style={styles.bannerHint}>Tap to open watchdog drawer.</Text>
      </Pressable>
    );
  }

  // DEGRADED_RECOVERY (yellow, recovered via fallback): show the REAL recovery
  // metadata. "—" is replaced with UNKNOWN_WITH_REASON so a recovered request
  // never shows blank diagnostic fields (owner spec).
  if (!isError && warning.classification === 'DEGRADED_RECOVERY') {
    const fields = resolveDegradedRecoveryFields(latest as unknown as BannerReportInput);
    return (
      <Pressable
        onPress={onPress}
        style={[styles.banner, styles.bannerWarn]}
        testID="ivx-watchdog-banner"
        accessibilityRole="button"
      >
        <Text style={[styles.bannerTitle, styles.bannerTitleWarn]}>▲ IVX AI DEGRADED — {warning.classification} ({warning.label})</Text>
        <Text style={styles.bannerSummary} selectable>
          recovered via fallback — a real answer was delivered.
        </Text>
        <Text style={styles.bannerLine} selectable>recoveredViaFallback: {fields.recoveredViaFallback}</Text>
        <Text style={styles.bannerLine} selectable>degradedRoute: {fields.degradedRoute}</Text>
        <Text style={styles.bannerLine} selectable>recoveredRoute: {fields.recoveredRoute}</Text>
        <Text style={styles.bannerLine} selectable>statusCode: {fields.statusCode}</Text>
        <Text style={styles.bannerLine} selectable>classification: {fields.classification}</Text>
        <Text style={styles.bannerLine} selectable>reason: {fields.reason}</Text>
        <Text style={styles.bannerLine} selectable>traceId: {latest.traceId}</Text>
        <Text style={styles.bannerLine} selectable>lastSuccessful: {fields.lastSuccessful}</Text>
        <Text style={styles.bannerHint}>Tap to open watchdog drawer.</Text>
      </Pressable>
    );
  }

  const failureFields = resolveFailureBannerFields(latest as unknown as BannerReportInput);
  const titlePrefix = isError ? '● IVX AI BLOCKED' : '▲ IVX AI DEGRADED';

  return (
    <Pressable
      onPress={onPress}
      style={[styles.banner, isError ? null : styles.bannerWarn]}
      testID="ivx-watchdog-banner"
      accessibilityRole="button"
    >
      <Text style={[styles.bannerTitle, isError ? null : styles.bannerTitleWarn]}>{titlePrefix} — {warning.classification} ({warning.label})</Text>
      <Text style={styles.bannerSummary} selectable>
        {failureFields.lastSuccessful} ok → {failureFields.checkpoint} failed: {failureFields.reason}
      </Text>
      <Text style={styles.bannerLine} selectable>checkpoint: {failureFields.checkpoint}</Text>
      <Text style={styles.bannerLine} selectable>traceId: {latest.traceId}</Text>
      <Text style={styles.bannerLine} selectable>file: {failureFields.filePath}</Text>
      <Text style={styles.bannerLine} selectable>function: {failureFields.functionName}</Text>
      <Text style={styles.bannerLine} selectable>reason: {failureFields.reason}</Text>
      <Text style={styles.bannerLine} selectable>nextFix: {failureFields.nextFix}</Text>
      <Text style={styles.bannerLine} selectable>statusCode: {failureFields.statusCode}</Text>
      <Text style={styles.bannerLine} selectable>backendResponse: {failureFields.backendResponse}</Text>
      <Text style={styles.bannerLine} selectable>lastSuccessful: {failureFields.lastSuccessful}</Text>
      <Text style={styles.bannerLine} selectable>failedCheckpoint: {failureFields.checkpoint}</Text>
      <Text style={styles.bannerHint}>Tap to open watchdog drawer.</Text>
    </Pressable>
  );
}

interface DrawerProps {
  visible: boolean;
  onClose: () => void;
}

export function IVXWatchdogDrawer({ visible, onClose }: DrawerProps): React.ReactElement {
  const snapshot = useWatchdogSnapshot();
  const reports: WatchdogReport[] = useMemo(
    () => [...snapshot.active.slice().reverse(), ...snapshot.finalized],
    [snapshot.active, snapshot.finalized],
  );
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={styles.drawer}>
        <View style={styles.drawerHeader}>
          <Text style={styles.drawerTitle}>IVX Owner AI watchdog</Text>
          <Pressable onPress={onClose} style={styles.closeBtn} testID="ivx-watchdog-close">
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
        </View>
        <View style={styles.drawerToolbar}>
          <Text style={styles.drawerToolbarText}>Last {reports.length} report(s) — newest first</Text>
          <Pressable
            onPress={() => {
              void ivxAIWatchdog.clear();
            }}
            style={styles.clearBtn}
            testID="ivx-watchdog-clear"
          >
            <Text style={styles.clearBtnText}>Clear</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.drawerContent}>
          <BackendPostFailureAnalysisCard reports={snapshot.finalized} />
          {reports.length === 0 ? (
            <Text style={styles.emptyText}>No reports yet. Send a message to generate one.</Text>
          ) : (
            reports.map((report) => <ReportCard key={report.traceId} report={report} />)
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/**
 * Root-cause grouping: traces every BACKEND_POST_FINISHED failure across the
 * persisted reports, groups by cause, and shows the top 5 by frequency with
 * counts + status codes + the latest trace id as evidence.
 */
function BackendPostFailureAnalysisCard({ reports }: { reports: WatchdogReport[] }): React.ReactElement | null {
  const analysis = useMemo(
    () => analyzeBackendPostFailures(reports as unknown as AnalyzableWatchdogReport[]),
    [reports],
  );
  if (analysis.totalFailures === 0) return null;
  return (
    <View style={styles.analysisCard}>
      <Text style={styles.analysisTitle}>BACKEND_POST_FINISHED — root-cause grouping</Text>
      <Text style={styles.analysisSubtitle}>
        {analysis.totalFailures} failure(s) across last {analysis.totalReports} report(s) · top {Math.min(5, analysis.top5.length)} causes
      </Text>
      {analysis.top5.map((group, idx) => (
        <View key={group.cause} style={styles.analysisRow}>
          <Text style={styles.analysisRank}>{idx + 1}.</Text>
          <View style={styles.analysisBody}>
            <Text style={styles.analysisCause} selectable>
              {BACKEND_POST_FAILURE_CAUSE_LABEL[group.cause]} — {group.count}×
            </Text>
            <Text style={styles.analysisMeta} selectable>
              status: {group.statusCodes.length > 0 ? group.statusCodes.join(', ') : '—'} · latest trace: {group.traceIds[0] ?? '—'}
            </Text>
            <Text style={styles.analysisMeta} selectable numberOfLines={2}>
              e.g. {group.sampleReason || '—'}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function ReportCard({ report }: { report: WatchdogReport }): React.ReactElement {
  const warning = useMemo(
    () => classifyWatchdogWarning(report as unknown as AnalyzableWatchdogReport),
    [report],
  );
  const badgeStyle = useMemo(() => {
    // Color by TRUTHFUL severity: green success · yellow degraded/auth-recoverable
    // · red real failure. Never a red badge when the request actually recovered.
    if (report.finalStatus === 'PENDING') return { backgroundColor: COLORS.pendingGrey };
    if (warning.severity === 'success') return { backgroundColor: COLORS.successBadge };
    if (warning.severity === 'info') return { backgroundColor: COLORS.infoBadge };
    if (warning.severity === 'warning') return { backgroundColor: COLORS.degradedBadge };
    return { backgroundColor: COLORS.errorBadge };
  }, [report.finalStatus, warning.severity]);

  const orderedCheckpoints = useMemo(() => {
    const byName = new Map(report.checkpoints.map((cp) => [cp.name, cp] as const));
    return CHECKPOINT_ORDER.map((name) => byName.get(name)).filter((cp): cp is NonNullable<typeof cp> => Boolean(cp));
  }, [report.checkpoints]);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.statusBadge, badgeStyle]}>
          <Text style={styles.statusBadgeText}>{report.finalStatus} · {warning.classification}</Text>
        </View>
        <Text style={styles.cardTimestamp}>{report.startedAt}</Text>
      </View>

      <Text style={styles.cardKey}>traceId</Text>
      <Text style={styles.cardValue}>{report.traceId}</Text>
      <Text style={styles.cardKey}>userText</Text>
      <Text style={styles.cardValue}>{report.userText || '—'}</Text>
      <Text style={styles.cardKey}>userMessageId</Text>
      <Text style={styles.cardValue}>{report.userMessageId}</Text>
      <Text style={styles.cardKey}>conversationId</Text>
      <Text style={styles.cardValue}>{report.conversationId ?? '—'}</Text>
      <Text style={styles.cardKey}>startedAt → endedAt</Text>
      <Text style={styles.cardValue}>{report.startedAt} → {report.endedAt ?? 'pending'}</Text>

      {report.finalStatus !== 'SUCCESS' && report.finalStatus !== 'DEGRADED' && report.finalStatus !== 'PENDING' && warning.severity === 'error' ? (
        <View style={styles.failureBox}>
          <Text style={styles.failureTitle}>Failure</Text>
          <Text style={styles.failureLine}>failedCheckpoint: {report.failedCheckpoint ?? '—'}</Text>
          <Text style={styles.failureLine}>lastSuccessful: {report.lastSuccessfulCheckpoint ?? '—'}</Text>
          <Text style={styles.failureLine}>fileLine: {report.fileLine ?? '—'}</Text>
          <Text style={styles.failureLine}>reason: {report.failureReason ?? '—'}</Text>
          <Text style={styles.failureLine}>nextFix: {report.fixHint ?? '—'}</Text>
        </View>
      ) : null}

      <View style={styles.checkpointList}>
        {orderedCheckpoints.map((cp, idx) => (
          <View key={cp.name} style={styles.checkpointRow}>
            <Text style={[styles.checkpointDot, cp.status === 'pass' ? styles.dotPass : cp.status === 'fail' ? styles.dotFail : styles.dotPending]}>
              {cp.status === 'pass' ? '✓' : cp.status === 'fail' ? '✗' : '·'}
            </Text>
            <View style={styles.checkpointBody}>
              <Text style={styles.checkpointName}>{`${idx + 1}. ${cp.name}`}</Text>
              <Text style={styles.checkpointMeta}>expected: {cp.expected}</Text>
              <Text style={styles.checkpointMeta}>file: {cp.fileLine}</Text>
              <Text style={styles.checkpointMeta}>actual: {cp.actual ?? (cp.status === 'pending' ? 'not reached' : '—')}</Text>
              {cp.status === 'fail' ? (
                <Text style={styles.checkpointFail}>FAILED</Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: COLORS.bannerBg,
    borderColor: COLORS.bannerBorder,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 12,
    marginBottom: 8},
  bannerPending: {
    backgroundColor: COLORS.pendingBg,
    borderColor: COLORS.pendingBorder},
  bannerWarn: {
    backgroundColor: '#3a2a05',
    borderColor: '#f59e0b'},
  bannerTitleWarn: {
    color: '#fbbf24'},
  bannerInfo: {
    backgroundColor: '#0b1f3a',
    borderColor: COLORS.infoBadge},
  bannerTitleInfo: {
    color: '#93c5fd'},
  bannerTitle: {
    color: COLORS.bannerBorder,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4},
  bannerTitlePending: {
    color: COLORS.pendingBorder,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4},
  bannerLine: {
    color: COLORS.bannerText,
    fontSize: 11,
    fontFamily: 'Menlo',
    lineHeight: 15},
  bannerSummary: {
    color: '#ffffff',
    fontSize: 12,
    fontFamily: 'Menlo',
    fontWeight: '700',
    lineHeight: 16,
    marginBottom: 4},
  bannerHint: {
    color: COLORS.bannerSubtext,
    fontSize: 10,
    marginTop: 6,
    fontStyle: 'italic'},
  analysisCard: {
    backgroundColor: '#1a1207',
    borderColor: COLORS.pendingBorder,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12},
  analysisTitle: {
    color: COLORS.pendingText,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2},
  analysisSubtitle: {
    color: COLORS.subtext,
    fontSize: 11,
    marginBottom: 10},
  analysisRow: {
    flexDirection: 'row',
    marginBottom: 8},
  analysisRank: {
    color: COLORS.pendingText,
    fontSize: 12,
    fontWeight: '700',
    width: 18},
  analysisBody: {
    flex: 1},
  analysisCause: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '600'},
  analysisMeta: {
    color: COLORS.subtext,
    fontSize: 10,
    fontFamily: 'Menlo',
    lineHeight: 14},
  hud: {
    backgroundColor: '#ff00aa',
    borderWidth: 2,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginHorizontal: 12,
    marginBottom: 6,
    marginTop: 4},
  hudHeader: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'Menlo',
    marginBottom: 4,
    letterSpacing: 0.5},
  hudHint: {
    color: '#ffffff',
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 4,
    opacity: 0.85},
  hudTitle: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Menlo',
    marginBottom: 2,
    color: '#ffffff'},
  hudLine: {
    color: '#ffffff',
    fontSize: 11,
    fontFamily: 'Menlo',
    lineHeight: 14},
  drawer: {
    flex: 1,
    backgroundColor: COLORS.drawerBg},
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8},
  drawerTitle: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '700'},
  closeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: COLORS.cardBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.cardBorder},
  closeBtnText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600'},
  drawerToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8},
  drawerToolbarText: {
    color: COLORS.subtext,
    fontSize: 12},
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: COLORS.errorBadge,
    borderRadius: 6},
  clearBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600'},
  drawerContent: {
    paddingHorizontal: 12,
    paddingBottom: 32},
  emptyText: {
    color: COLORS.subtext,
    textAlign: 'center',
    marginTop: 40,
    fontSize: 14},
  card: {
    backgroundColor: COLORS.cardBg,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12},
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8},
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6},
  statusBadgeText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 11},
  cardTimestamp: {
    color: COLORS.subtext,
    fontSize: 10,
    fontFamily: 'Menlo'},
  cardKey: {
    color: COLORS.subtext,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5},
  cardValue: {
    color: COLORS.text,
    fontSize: 12,
    fontFamily: 'Menlo'},
  failureBox: {
    marginTop: 10,
    padding: 10,
    backgroundColor: COLORS.bannerBg,
    borderColor: COLORS.bannerBorder,
    borderWidth: 1,
    borderRadius: 8},
  failureTitle: {
    color: COLORS.bannerBorder,
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 4},
  failureLine: {
    color: COLORS.bannerText,
    fontSize: 11,
    fontFamily: 'Menlo',
    lineHeight: 15},
  checkpointList: {
    marginTop: 12},
  checkpointRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder},
  checkpointDot: {
    width: 22,
    textAlign: 'center',
    fontWeight: '700',
    fontSize: 14,
    marginTop: 2},
  dotPass: { color: COLORS.passGreen },
  dotFail: { color: COLORS.failRed },
  dotPending: { color: COLORS.pendingGrey },
  checkpointBody: { flex: 1 },
  checkpointName: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '600'},
  checkpointMeta: {
    color: COLORS.subtext,
    fontSize: 10,
    fontFamily: 'Menlo',
    lineHeight: 14},
  checkpointFail: {
    color: COLORS.failRed,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2}});
