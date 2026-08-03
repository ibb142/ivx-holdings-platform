import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import {
  CheckCircle2,
  CircleDashed,
  Lock,
  ShieldCheck,
  Unplug,
  XCircle} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  getIndependenceReport,
  type IndependencePhase,
  type KeptSystem,
  type PhaseReadiness,
  type PhaseRequirement,
  type ExternalDependency,
  type IndependenceReport} from '@/src/modules/ivx-developer/rorkIndependenceService';

const POLL_INTERVAL_MS = 25000;

const READINESS_COLOR: Record<PhaseReadiness, string> = {
  achieved: Colors.success,
  in_progress: Colors.warning,
  blocked: Colors.error};

const READINESS_LABEL: Record<PhaseReadiness, string> = {
  achieved: 'ACHIEVED',
  in_progress: 'IN PROGRESS',
  blocked: 'BLOCKED'};

function ReqRow({ req }: { req: PhaseRequirement }) {
  return (
    <View style={styles.reqRow}>
      {req.met ? (
        <CheckCircle2 size={15} color={Colors.success} />
      ) : (
        <XCircle size={15} color={Colors.warning} />
      )}
      <View style={styles.reqCopy}>
        <Text style={styles.reqLabel}>{req.label}</Text>
        <Text style={styles.reqDetail} numberOfLines={3}>{req.detail}</Text>
        {req.missing ? <Text style={styles.reqMissing}>Missing: {req.missing}</Text> : null}
      </View>
    </View>
  );
}

function PhaseCard({ phase, isCurrent }: { phase: IndependencePhase; isCurrent: boolean }) {
  const color = READINESS_COLOR[phase.readiness];
  return (
    <View style={[styles.phaseCard, isCurrent && styles.phaseCardCurrent]}>
      <View style={styles.phaseHeaderRow}>
        <View style={styles.phaseNumber}>
          <Text style={styles.phaseNumberText}>{phase.order}</Text>
        </View>
        <View style={styles.phaseTitleCol}>
          <Text style={styles.phaseTitle}>{phase.title}</Text>
          {isCurrent ? <Text style={styles.phaseCurrentTag}>CURRENT</Text> : null}
        </View>
        <View style={[styles.readinessPill, { backgroundColor: color }]}>
          <Text style={styles.readinessPillText}>{READINESS_LABEL[phase.readiness]}</Text>
        </View>
      </View>
      <Text style={styles.phaseObjective}>{phase.objective}</Text>
      <Text style={styles.phaseExternal}><Text style={styles.phaseExternalLabel}>Rork: </Text>{phase.externalRole}</Text>
      <View style={styles.reqList}>
        {phase.requirements.map((r, i) => (
          <ReqRow key={i} req={r} />
        ))}
      </View>
    </View>
  );
}

function KeptSystemRow({ system }: { system: KeptSystem }) {
  return (
    <View style={styles.kvRow}>
      {system.available ? (
        <CheckCircle2 size={14} color={Colors.success} />
      ) : (
        <XCircle size={14} color={Colors.error} />
      )}
      <View style={styles.kvCopy}>
        <Text style={styles.kvLabel}>{system.system}</Text>
        <Text style={styles.kvDetail} numberOfLines={2}>{system.backedBy}</Text>
        {system.missing ? <Text style={styles.reqMissing}>Missing: {system.missing}</Text> : null}
      </View>
    </View>
  );
}

function DependencyRow({ dep }: { dep: ExternalDependency }) {
  return (
    <View style={styles.kvRow}>
      {dep.present ? (
        <CircleDashed size={14} color={Colors.warning} />
      ) : (
        <CheckCircle2 size={14} color={Colors.success} />
      )}
      <View style={styles.kvCopy}>
        <Text style={styles.kvLabel}>{dep.dependency}</Text>
        <Text style={styles.kvDetail} numberOfLines={3}>{dep.detail}</Text>
        {dep.present ? <Text style={styles.reqMissing}>Action: {dep.removalAction}</Text> : null}
      </View>
    </View>
  );
}

function IndependenceContent() {
  const insets = useSafeAreaInsets();

  const query = useQuery<IndependenceReport | null>({
    queryKey: ['ivx-independence-status'],
    queryFn: getIndependenceReport,
    refetchInterval: POLL_INTERVAL_MS});

  const data = query.data ?? null;
  const onRefresh = useCallback(() => { void query.refetch(); }, [query]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
      refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={query.isFetching} onRefresh={onRefresh} />}
      testID="ivx-independence-status-scroll"
    >
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <Unplug size={18} color={Colors.primary} />
          <Text style={styles.heroTitle}>Rork → IVX Independence</Text>
        </View>
        <Text style={styles.heroSub}>
          Live status of replacing Rork with IVX as the primary autonomous developer/operator — derived from real
          tool, handoff, and dependency signals.
        </Text>
      </View>

      {query.isLoading && !data ? (
        <View style={styles.loadingBox}>
          <ShimmerIndicator color={Colors.primary} />
          <Text style={styles.loadingText}>Computing independence state…</Text>
        </View>
      ) : null}

      {query.isError && !data ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>
            {query.error instanceof Error ? query.error.message : 'Failed to load the independence report.'}
          </Text>
        </View>
      ) : null}

      {data ? (
        <>
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <ShieldCheck size={16} color={Colors.primary} />
              <Text style={styles.summaryTitle}>
                Current phase: {data.currentPhaseOrder > 0 ? `${data.currentPhaseOrder} · ` : ''}
                {data.phases.find((p) => p.id === data.currentPhase)?.title ?? 'Shadow Mode'}
              </Text>
            </View>
            <Text style={styles.summaryLine}>
              {data.summary.phasesAchieved}/4 phases achieved ·{' '}
              {data.summary.externalRequiredForNormalWorkflow ? 'External services still in normal workflow' : 'External services out of normal workflow'}
              {data.summary.externalOptional ? ' · External services optional' : ''}
            </Text>
            <View style={styles.capRow}>
              {([
                ['Commands', data.summary.canReceiveOwnerCommands],
                ['Modify code', data.summary.canModifyCode],
                ['Deploy', data.summary.canDeploy],
                ['Verify', data.summary.canVerifyProduction],
                ['Proof', data.summary.canStoreProof],
                ['Learn', data.summary.canLearnFromOutcomes],
              ] as const).map(([label, ok]) => (
                <View key={label} style={[styles.capChip, { borderColor: ok ? Colors.success : Colors.warning }]}>
                  <Text style={[styles.capChipText, { color: ok ? Colors.success : Colors.warning }]}>
                    {ok ? '✓ ' : '• '}{label}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {data.phases.map((p) => (
            <PhaseCard key={p.id} phase={p} isCurrent={p.id === data.currentPhase && data.currentPhaseOrder > 0} />
          ))}

          <Text style={styles.sectionHeading}>Kept systems (Independence Mode)</Text>
          <View style={styles.listCard}>
            {data.keptSystems.map((s, i) => (
              <KeptSystemRow key={i} system={s} />
            ))}
          </View>

          <Text style={styles.sectionHeading}>External dependencies remaining</Text>
          <View style={styles.listCard}>
            {data.externalDependenciesRemaining.map((d, i) => (
              <DependencyRow key={i} dep={d} />
            ))}
          </View>

          {data.nextActions.length > 0 ? (
            <>
              <Text style={styles.sectionHeading}>Next actions</Text>
              <View style={styles.listCard}>
                {data.nextActions.map((a, i) => (
                  <View key={i} style={styles.nextActionRow}>
                    <Lock size={13} color={Colors.warning} />
                    <Text style={styles.nextActionText}>{a}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <Text style={styles.footerNote}>Marker {data.marker} · {new Date(data.generatedAt).toLocaleString()}</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

export default function IndependenceScreen() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Rork Independence', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.text }} />
      <IndependenceContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 14 },
  heroCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { color: Colors.text, fontSize: 18, fontWeight: '700' as const },
  heroSub: { color: Colors.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 19 },
  loadingBox: { padding: 24, alignItems: 'center', gap: 10 },
  loadingText: { color: Colors.textSecondary, fontSize: 13 },
  errorBox: { backgroundColor: Colors.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.error },
  errorText: { color: Colors.error, fontSize: 13 },
  summaryCard: { backgroundColor: Colors.surfaceElevated, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.primary },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const, flex: 1 },
  summaryLine: { color: Colors.textSecondary, fontSize: 12.5, marginTop: 6 },
  capRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  capChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  capChipText: { fontSize: 11, fontWeight: '600' as const },
  phaseCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder },
  phaseCardCurrent: { borderColor: Colors.primary },
  phaseHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  phaseNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.backgroundTertiary, alignItems: 'center', justifyContent: 'center' },
  phaseNumberText: { color: Colors.primary, fontSize: 14, fontWeight: '700' as const },
  phaseTitleCol: { flex: 1 },
  phaseTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  phaseCurrentTag: { color: Colors.primary, fontSize: 10, fontWeight: '700' as const, marginTop: 2 },
  readinessPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  readinessPillText: { color: Colors.black, fontSize: 10, fontWeight: '800' as const },
  phaseObjective: { color: Colors.textSecondary, fontSize: 12.5, marginTop: 8, lineHeight: 18 },
  phaseExternal: { color: Colors.textTertiary, fontSize: 12, marginTop: 6 },
  phaseExternalLabel: { color: Colors.textSecondary, fontWeight: '700' as const },
  reqList: { marginTop: 10, gap: 8 },
  reqRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  reqCopy: { flex: 1 },
  reqLabel: { color: Colors.text, fontSize: 13, fontWeight: '600' as const },
  reqDetail: { color: Colors.textSecondary, fontSize: 12, marginTop: 1, lineHeight: 17 },
  reqMissing: { color: Colors.warning, fontSize: 11.5, marginTop: 2 },
  sectionHeading: { color: Colors.text, fontSize: 15, fontWeight: '700' as const, marginTop: 6 },
  listCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder, gap: 10 },
  kvRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  kvCopy: { flex: 1 },
  kvLabel: { color: Colors.text, fontSize: 13, fontWeight: '600' as const },
  kvDetail: { color: Colors.textSecondary, fontSize: 12, marginTop: 1, lineHeight: 17 },
  nextActionRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  nextActionText: { color: Colors.textSecondary, fontSize: 12.5, flex: 1, lineHeight: 18 },
  footerNote: { color: Colors.textTertiary, fontSize: 11, marginTop: 8, textAlign: 'center' }});
