import React, { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import { CheckCircle2, CircleDashed, Play, ShieldCheck, XCircle } from 'lucide-react-native';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  deriveFinalStatus,
  fetchLatestProofLedger,
  runProofLedgerTask,
  type IVXProofFinalStatus,
  type IVXProofLedgerEnvelope} from '@/src/modules/ivx-owner-ai/services/ivxProofLedgerService';

const LATEST_QUERY_KEY = ['ivx-owner-ai', 'proof-ledger', 'latest'] as const;

type RowTone = 'default' | 'yes' | 'no' | 'pending';

function dash(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : '—';
}

function num(value: number | null): string {
  return typeof value === 'number' ? String(value) : '—';
}

function boolText(value: boolean): string {
  return value ? 'PASS' : 'FAIL';
}

function statusColor(status: IVXProofFinalStatus): string {
  switch (status) {
    case 'VERIFIED LIVE':
      return Colors.success;
    case 'PARTIAL':
      return Colors.warning;
    case 'FAILED':
      return Colors.error;
    case 'REPO ONLY':
    default:
      return Colors.textSecondary;
  }
}

type LedgerRowProps = {
  index: number;
  label: string;
  value: string;
  mono?: boolean;
  tone?: RowTone;
  onPress?: () => void;
};

function LedgerRow({ index, label, value, mono, tone = 'default', onPress }: LedgerRowProps) {
  const valueStyle = [
    styles.rowValue,
    mono ? styles.rowValueMono : null,
    tone === 'yes' ? styles.rowValueYes : null,
    tone === 'no' ? styles.rowValueNo : null,
    tone === 'pending' ? styles.rowValuePending : null,
    onPress ? styles.rowValueLink : null,
  ];
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      disabled={!onPress}
      testID={`proof-ledger-row-${index}`}
    >
      <Text style={styles.rowIndex}>{index}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={valueStyle} selectable numberOfLines={onPress ? 1 : undefined}>
          {value}
        </Text>
      </View>
    </Pressable>
  );
}

LedgerRow.displayName = 'ProofLedgerRow';

function StepPill({ label, done, active }: { label: string; done: boolean; active: boolean }) {
  return (
    <View style={[styles.stepPill, done ? styles.stepPillDone : null, active ? styles.stepPillActive : null]}>
      {done ? (
        <CheckCircle2 size={12} color={Colors.black} />
      ) : (
        <CircleDashed size={12} color={active ? Colors.primary : Colors.textTertiary} />
      )}
      <Text style={[styles.stepPillText, done ? styles.stepPillTextDone : null]}>{label}</Text>
    </View>
  );
}

export default function IVXProofLedgerRoute() {
  const [envelope, setEnvelope] = useState<IVXProofLedgerEnvelope | null>(null);

  const latestQuery = useQuery<IVXProofLedgerEnvelope, Error>({
    queryKey: LATEST_QUERY_KEY,
    queryFn: async () => fetchLatestProofLedger(),
    staleTime: 0});

  useEffect(() => {
    if (latestQuery.data && !envelope) {
      setEnvelope(latestQuery.data);
    }
  }, [latestQuery.data, envelope]);

  const runMutation = useMutation<IVXProofLedgerEnvelope, Error, void>({
    mutationFn: async () => runProofLedgerTask(),
    onSuccess: (data) => setEnvelope(data)});

  const handleRun = useCallback((): void => {
    runMutation.mutate();
  }, [runMutation]);

  const handleOpenUrl = useCallback((url: string | null): void => {
    if (url) {
      void Linking.openURL(url);
    }
  }, []);

  const isRunning = runMutation.isPending;
  const active = envelope ?? latestQuery.data ?? null;
  const ledger = active?.ledger ?? null;
  const finalStatus: IVXProofFinalStatus = active ? deriveFinalStatus(active) : 'REPO ONLY';

  const sourceLabel = (() => {
    if (!active) return 'loading';
    if (active.source === 'production-backend') return ledger?.cached ? 'production backend (cached)' : 'production backend (live run)';
    if (active.source === 'no-proof-yet') return 'no proof yet';
    return 'transport error';
  })();

  return (
    <ErrorBoundary fallbackTitle="Proof Ledger unavailable">
      <View style={styles.container} testID="ivx-proof-ledger-screen">
        <Stack.Screen
          options={{
            title: 'Senior Developer Proof Ledger',
            headerStyle: { backgroundColor: Colors.background },
            headerTintColor: Colors.text}}
        />
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.headerRow}>
            <ShieldCheck color={Colors.primary} size={24} />
            <Text style={styles.headerTitle}>Senior Developer Proof Ledger</Text>
          </View>
          <Text style={styles.headerSub}>
            Owner-only audit of one real end-to-end task on the live backend:
            detect → inspect → patch → test → commit → deploy → verify production.
          </Text>

          {/* Verdict banner */}
          <View style={[styles.verdictCard, { borderColor: statusColor(finalStatus) }]} testID="proof-ledger-verdict">
            <Text style={styles.verdictLabel}>FINAL STATUS</Text>
            <Text style={[styles.verdictValue, { color: statusColor(finalStatus) }]}>{finalStatus}</Text>
            <Text style={styles.verdictMeta}>source: {sourceLabel}</Text>
            {active?.fetchedAt ? <Text style={styles.verdictMeta}>fetched: {active.fetchedAt}</Text> : null}
          </View>

          {/* Pipeline */}
          <View style={styles.pipelineWrap}>
            <StepPill label="detect" done={Boolean(ledger?.jobId)} active={isRunning} />
            <StepPill label="inspect" done={(ledger?.changedFiles.length ?? 0) > 0} active={isRunning} />
            <StepPill label="patch" done={Boolean(ledger?.feature.built)} active={isRunning} />
            <StepPill label="test" done={Boolean(ledger?.validationPassed)} active={isRunning} />
            <StepPill label="commit" done={Boolean(ledger?.github.committed)} active={isRunning} />
            <StepPill label="deploy" done={Boolean(ledger?.render.deployTriggered)} active={isRunning} />
            <StepPill label="verify" done={Boolean(ledger?.production.healthOk)} active={isRunning} />
          </View>

          {/* Run button */}
          <Pressable
            style={[styles.runButton, isRunning ? styles.runButtonDisabled : null]}
            onPress={handleRun}
            disabled={isRunning}
            accessibilityRole="button"
            testID="proof-ledger-run-button"
          >
            {isRunning ? (
              <ShimmerIndicator color={Colors.black} />
            ) : (
              <>
                <Play size={16} color={Colors.black} />
                <Text style={styles.runButtonText}>Run one real proof task</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.runHint}>
            Triggers a harmless internal proof marker end-to-end. Cooldown-guarded: rapid taps return the last real proof.
          </Text>

          {isRunning ? (
            <View style={styles.statusBlock} testID="proof-ledger-running">
              <ShimmerIndicator color={Colors.primary} />
              <Text style={styles.statusText}>
                Running on production: building feature → committing → deploying → verifying live (can take a minute)…
              </Text>
            </View>
          ) : null}

          {runMutation.isError ? (
            <View style={styles.errorBlock} testID="proof-ledger-run-error">
              <XCircle color={Colors.error} size={18} />
              <Text style={styles.errorText}>{runMutation.error?.message ?? 'Proof run failed.'}</Text>
            </View>
          ) : null}

          {latestQuery.isLoading && !active ? (
            <View style={styles.statusBlock}>
              <ShimmerIndicator color={Colors.primary} />
              <Text style={styles.statusText}>Loading last persisted proof…</Text>
            </View>
          ) : null}

          {active && active.source !== 'production-backend' && active.error ? (
            <View style={styles.errorBlock} testID="proof-ledger-envelope-error">
              <XCircle color={Colors.warning} size={18} />
              <Text style={styles.errorText}>{active.error}</Text>
            </View>
          ) : null}

          {/* The 18-field ledger */}
          {ledger ? (
            <View style={styles.ledgerCard} testID="proof-ledger-card">
              <LedgerRow index={1} label="Task ID" value={dash(ledger.jobId)} mono />
              <LedgerRow index={2} label="User request (goal)" value={dash(ledger.goal)} />
              <LedgerRow
                index={3}
                label="Files inspected / changed"
                value={ledger.changedFiles.length > 0 ? ledger.changedFiles.join('\n') : '—'}
                mono
              />
              <LedgerRow
                index={4}
                label="Root cause / blocker found"
                value={dash(ledger.blocker) === '—' ? 'No blocker (clean run)' : dash(ledger.blocker)}
                tone={ledger.blocker ? 'no' : 'yes'}
              />
              <LedgerRow
                index={5}
                label="Patch created"
                value={ledger.feature.built ? `YES — ${dash(ledger.feature.title)}` : 'NO'}
                tone={ledger.feature.built ? 'yes' : 'no'}
              />
              <LedgerRow
                index={6}
                label="Exact diff (committed paths)"
                value={ledger.github.committedPaths.length > 0 ? ledger.github.committedPaths.join('\n') : '—'}
                mono
              />
              <LedgerRow
                index={7}
                label="Tests run"
                value={ledger.validationPassed ? 'YES (focused validation)' : 'NO / incomplete'}
                tone={ledger.validationPassed ? 'yes' : 'no'}
              />
              <LedgerRow
                index={8}
                label="Test output"
                value={ledger.validationPassed ? 'validation passed' : dash(ledger.blocker)}
                tone={ledger.validationPassed ? 'yes' : 'no'}
              />
              <LedgerRow
                index={9}
                label="Commit status"
                value={boolText(ledger.github.committed)}
                tone={ledger.github.committed ? 'yes' : 'no'}
              />
              <LedgerRow index={10} label="Commit SHA" value={dash(ledger.github.commitSha)} mono />
              <LedgerRow
                index={11}
                label="GitHub commit URL"
                value={dash(ledger.github.commitUrl)}
                mono
                onPress={ledger.github.commitUrl ? () => handleOpenUrl(ledger.github.commitUrl) : undefined}
              />
              <LedgerRow
                index={12}
                label="Deploy status"
                value={ledger.render.deployTriggered ? dash(ledger.render.deployStatus) || 'triggered' : 'NOT TRIGGERED'}
                tone={ledger.render.deployTriggered ? 'yes' : 'no'}
              />
              <LedgerRow index={13} label="Render deploy ID" value={dash(ledger.render.deployId)} mono />
              <LedgerRow
                index={14}
                label="Production marker before"
                value={active?.mode === 'run' ? 'see /health prior to run' : '—'}
              />
              <LedgerRow
                index={15}
                label="Production marker after (live route)"
                value={dash(ledger.feature.liveUrl)}
                mono
                onPress={ledger.feature.liveUrl ? () => handleOpenUrl(ledger.feature.liveUrl) : undefined}
              />
              <LedgerRow
                index={16}
                label="Production verification response"
                value={`health HTTP ${num(ledger.production.healthHttpStatus)} (${boolText(ledger.production.healthOk)}) · route HTTP ${num(ledger.production.featuresRouteHttpStatus)} (${boolText(ledger.production.featuresRouteOk)})`}
                tone={ledger.production.healthOk ? 'yes' : 'no'}
              />
              <LedgerRow
                index={17}
                label="Watchdog / end-to-end result"
                value={ledger.endToEndProductionComplete ? 'CLEAN — end-to-end production complete' : 'INCOMPLETE'}
                tone={ledger.endToEndProductionComplete ? 'yes' : 'no'}
              />
              <View style={styles.divider} />
              <LedgerRow
                index={18}
                label="Final status"
                value={finalStatus}
                tone={finalStatus === 'VERIFIED LIVE' ? 'yes' : finalStatus === 'FAILED' ? 'no' : 'pending'}
              />
            </View>
          ) : null}

          {active?.source === 'no-proof-yet' && !ledger ? (
            <View style={styles.emptyBlock} testID="proof-ledger-empty">
              <Text style={styles.emptyText}>
                No proof has been run yet. Tap “Run one real proof task” to execute the full pipeline on production.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  scroll: {
    padding: 16,
    gap: 14,
    paddingBottom: 40},
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  headerTitle: {
    color: Colors.text,
    fontSize: 19,
    fontWeight: '800' as const,
    flex: 1},
  headerSub: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18},
  verdictCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 16,
    gap: 4},
  verdictLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1},
  verdictValue: {
    fontSize: 26,
    fontWeight: '900' as const,
    letterSpacing: 0.5},
  verdictMeta: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'monospace'},
  pipelineWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6},
  stepPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  stepPillActive: {
    borderColor: Colors.primary},
  stepPillDone: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  stepPillText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700' as const},
  stepPillTextDone: {
    color: Colors.black},
  runButton: {
    flexDirection: 'row',
    gap: 8,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18},
  runButtonDisabled: {
    opacity: 0.6},
  runButtonText: {
    color: Colors.black,
    fontSize: 16,
    fontWeight: '800' as const},
  runHint: {
    color: Colors.textTertiary,
    fontSize: 12,
    lineHeight: 16},
  statusBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12},
  statusText: {
    color: Colors.textSecondary,
    fontSize: 13,
    flex: 1,
    lineHeight: 18},
  errorBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.error,
    padding: 12},
  errorText: {
    color: Colors.text,
    fontSize: 13,
    flex: 1},
  ledgerCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden'},
  row: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder},
  rowIndex: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '800' as const,
    width: 20,
    textAlign: 'right',
    paddingTop: 2},
  rowBody: {
    flex: 1,
    gap: 3},
  rowLabel: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '700' as const},
  rowValue: {
    color: Colors.text,
    fontSize: 14},
  rowValueMono: {
    fontFamily: 'monospace',
    fontSize: 12.5},
  rowValueYes: {
    color: Colors.success,
    fontWeight: '700' as const},
  rowValueNo: {
    color: Colors.error,
    fontWeight: '700' as const},
  rowValuePending: {
    color: Colors.warning,
    fontWeight: '700' as const},
  rowValueLink: {
    color: Colors.info,
    textDecorationLine: 'underline'},
  divider: {
    height: 1,
    backgroundColor: Colors.surfaceBorder},
  emptyBlock: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16},
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18}});
