import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import { CalendarDays, CheckCircle2, ChevronRight, LockKeyhole, RefreshCw, ShieldAlert, ShieldCheck, Target } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  getIVXIndependenceStatus,
  type IVXIndependenceChecklistItem,
  type IVXIndependenceDependency,
  type IVXIndependenceDependencyStatus,
  type IVXIndependenceRiskLevel,
  type IVXIndependenceStatus} from '@/src/modules/ivx-owner-ai/services/ivxVariablesToolService';

const IVX_INDEPENDENCE_STATUS_QUERY_KEY = ['ivx-owner-ai', 'independence-status'] as const;

function getRiskColor(riskLevel: IVXIndependenceRiskLevel): string {
  if (riskLevel === 'critical') return Colors.error;
  if (riskLevel === 'high') return Colors.warning;
  if (riskLevel === 'medium') return Colors.info;
  return Colors.success;
}

function getStatusColor(status: IVXIndependenceDependencyStatus | IVXIndependenceChecklistItem['status']): string {
  if (status === 'completed') return Colors.success;
  if (status === 'in_progress') return Colors.info;
  if (status === 'needs_owner_proof') return Colors.warning;
  return Colors.error;
}

function getStatusLabel(status: IVXIndependenceDependencyStatus | IVXIndependenceChecklistItem['status']): string {
  if (status === 'completed') return 'completed';
  if (status === 'in_progress') return 'in progress';
  if (status === 'needs_owner_proof') return 'needs owner proof';
  return 'blocked';
}

function ScoreRing({ label, value, tone }: { label: string; value: number; tone: 'risk' | 'owner' }) {
  const clampedValue = Math.min(100, Math.max(0, value));
  const color = tone === 'risk' ? Colors.error : Colors.success;
  return (
    <View style={styles.scoreCard} testID={`ivx-independence-score-${tone}`}>
      <View style={[styles.scoreCircle, { borderColor: color }]}>
        <Text style={[styles.scoreValue, { color }]}>{clampedValue}%</Text>
      </View>
      <Text style={styles.scoreLabel}>{label}</Text>
    </View>
  );
}

function DependencyCard({ dependency, index }: { dependency: IVXIndependenceDependency; index: number }) {
  const riskColor = getRiskColor(dependency.riskLevel);
  const statusColor = getStatusColor(dependency.currentStatus);
  return (
    <View style={styles.dependencyCard} testID={`ivx-independence-dependency-${dependency.id}`}>
      <View style={styles.dependencyTopRow}>
        <Text style={styles.dependencyIndex}>{String(index + 1).padStart(2, '0')}</Text>
        <View style={styles.dependencyTitleBlock}>
          <Text style={styles.dependencyTitle}>{dependency.dependencyName}</Text>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, { borderColor: riskColor, backgroundColor: `${riskColor}1F` }]}>
              <Text style={[styles.badgeText, { color: riskColor }]}>{dependency.riskLevel}</Text>
            </View>
            <View style={[styles.badge, { borderColor: statusColor, backgroundColor: `${statusColor}1F` }]}>
              <Text style={[styles.badgeText, { color: statusColor }]}>{getStatusLabel(dependency.currentStatus)}</Text>
            </View>
          </View>
        </View>
      </View>
      <View style={styles.detailBlock}>
        <Text style={styles.detailLabel}>Removal task</Text>
        <Text style={styles.detailText}>{dependency.removalTask}</Text>
      </View>
      <View style={styles.detailBlock}>
        <Text style={styles.detailLabel}>Owner action required</Text>
        <Text style={styles.detailText}>{dependency.ownerActionRequired}</Text>
      </View>
      <View style={styles.detailBlock}>
        <Text style={styles.detailLabel}>Proof required</Text>
        <Text style={styles.detailText}>{dependency.proofRequired}</Text>
      </View>
      {dependency.currentStatus === 'completed' ? (
        <View style={styles.completedProofBox}>
          <CheckCircle2 size={15} color={Colors.success} />
          <View style={styles.completedProofCopy}>
            <Text style={styles.completedProofTitle}>Completed {dependency.completionDate ?? 'today'}</Text>
            <Text style={styles.completedProofText}>Before: {dependency.proofBefore}</Text>
            <Text style={styles.completedProofText}>After: {dependency.proofAfter}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function DayCard({ item }: { item: IVXIndependenceChecklistItem }) {
  const statusColor = getStatusColor(item.status);
  return (
    <View style={styles.dayCard} testID={`ivx-independence-day-${item.day}`}>
      <View style={styles.dayHeader}>
        <View style={styles.dayNumberPill}>
          <Text style={styles.dayNumber}>Day {item.day}</Text>
        </View>
        <View style={styles.dayTitleBlock}>
          <Text style={styles.dayTitle}>{item.title}</Text>
          <Text style={[styles.dayStatus, { color: statusColor }]}>{getStatusLabel(item.status)}</Text>
        </View>
      </View>
      <View style={styles.dayChecklist}>
        {item.checklist.map((task, index) => (
          <View key={`${item.day}-${index}`} style={styles.checklistRow}>
            <View style={[styles.checkDot, item.status === 'completed' ? styles.checkDotDone : null]} />
            <Text style={styles.checklistText}>{task}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function IVXIndependenceTrackerRoute() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const statusQuery = useQuery<IVXIndependenceStatus, Error>({
    queryKey: IVX_INDEPENDENCE_STATUS_QUERY_KEY,
    queryFn: getIVXIndependenceStatus,
    refetchInterval: 60_000});

  const status = statusQuery.data ?? null;
  const dependencies = useMemo<IVXIndependenceDependency[]>(() => status?.dependencies ?? [], [status?.dependencies]);
  const completedCount = useMemo<number>(() => dependencies.filter((item) => item.currentStatus === 'completed').length, [dependencies]);

  const handleRefresh = () => {
    if (statusQuery.isFetching) {
      return;
    }
    void statusQuery.refetch();
  };

  return (
    <ErrorBoundary fallbackTitle="IVX Independence Tracker unavailable">
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(120, insets.bottom + 96) }]}
        refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={statusQuery.isFetching} onRefresh={handleRefresh} />}
        testID="ivx-independence-tracker-screen"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <LockKeyhole size={15} color={Colors.black} />
            <Text style={styles.heroBadgeText}>owner/admin only</Text>
          </View>
          <Text style={styles.heroTitle}>IVX 7-Day External Dependency Removal</Text>
          <Text style={styles.heroSubtitle}>Every task now must remove or reduce one external dependency using the safe order: clone/transfer, rotate, redeploy, verify, then revoke.</Text>
          <View style={styles.scoreRow}>
            <ScoreRing label="External dependency" value={status?.externalDependencyPercent ?? 100} tone="risk" />
            <ScoreRing label="Owner control" value={status?.ownerControlPercent ?? 0} tone="owner" />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Target size={18} color={Colors.primary} />
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>Live proof status</Text>
              <Text style={styles.cardSubtitle}>{`${completedCount}/${dependencies.length || 7} dependency removals complete · target 0% by ${status?.targetDateForZeroPercent ?? '2026-05-15'}`}</Text>
            </View>
            <Pressable style={styles.refreshButton} onPress={handleRefresh} testID="ivx-independence-refresh">
              <RefreshCw size={13} color={Colors.black} />
              <Text style={styles.refreshButtonText}>Refresh</Text>
            </Pressable>
          </View>
          {statusQuery.isLoading ? (
            <View style={styles.loadingRow}>
              <ShimmerIndicator color={Colors.primary} size="small" />
              <Text style={styles.mutedText}>Loading owner-only independence proof…</Text>
            </View>
          ) : statusQuery.error ? (
            <Text style={styles.errorText}>{statusQuery.error.message}</Text>
          ) : null}
          <View style={styles.proofGrid}>
            <Text style={styles.proofText}>Route: GET /api/ivx/independence/status</Text>
            <Text style={styles.proofText}>Marker: {status?.deploymentMarker ?? 'not loaded'}</Text>
            <Text style={styles.proofText}>Secret values returned: {status?.secretValuesReturned === false ? 'false' : 'not verified'}</Text>
            <Text style={styles.proofText}>Owner can sign in: {status?.ownerCanSignIn ? 'true' : 'not verified'}</Text>
            <Text style={styles.proofText}>Owner Dashboard accessible: {status?.ownerDashboardAccessible ? 'true' : 'not verified'}</Text>
            <Text style={styles.proofText}>Owner Variables accessible: {status?.ownerVariablesAccessible ? 'true' : 'not verified'}</Text>
            <Text style={styles.proofText}>Independence Tracker accessible: {status?.independenceTrackerAccessible ? 'true' : 'not verified'}</Text>
            <Text style={styles.proofText}>role: {status?.role ?? status?.authenticatedRole ?? 'not verified'}</Text>
            <Text style={styles.proofText}>kycStatus: {status?.kycStatus ?? 'not verified'}</Text>
            <Text style={styles.proofText}>Production stable: {status?.productionSafety.productionStable ? 'yes' : 'not verified'}</Text>
          </View>
          <View style={styles.nextActionBox}>
            <ShieldAlert size={16} color={Colors.warning} />
            <Text style={styles.nextActionText}>{status?.nextRequiredAction ?? 'Sign in as owner/admin to load the next required action.'}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <ShieldCheck size={18} color={Colors.primary} />
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>Dependency tracker</Text>
              <Text style={styles.cardSubtitle}>Name, risk, status, task, owner action, required proof, and completion date for every known dependency.</Text>
            </View>
          </View>
          {dependencies.map((dependency, index) => (
            <DependencyCard key={dependency.id} dependency={dependency} index={index} />
          ))}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <CalendarDays size={18} color={Colors.primary} />
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>Daily migration checklist</Text>
              <Text style={styles.cardSubtitle}>Do not revoke external access all at once. Follow the safe sequence and verify production after each step.</Text>
            </View>
          </View>
          {(status?.dailyChecklist ?? []).map((item) => <DayCard key={item.day} item={item} />)}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <ShieldCheck size={18} color={Colors.success} />
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>First completed removal</Text>
              <Text style={styles.cardSubtitle}>{status?.firstCompletedDependencyRemoval?.dependencyName ?? 'Local .env exposure risk removed'}</Text>
            </View>
          </View>
          <Text style={styles.detailText}>{status?.firstCompletedDependencyRemoval?.externalDependencyReduced ?? 'Local plaintext env files were removed from the workspace without changing production provider variables.'}</Text>
          <Text style={styles.detailText}>Production safety: {status?.productionSafety.reason ?? 'Provider access was not revoked; production remains stable while migrations continue.'}</Text>
          <Pressable style={styles.ownerVariablesButton} onPress={() => router.push('/ivx/variables' as never)} testID="ivx-independence-open-variables">
            <Text style={styles.ownerVariablesButtonText}>Open Owner Variables</Text>
            <ChevronRight size={16} color={Colors.black} />
          </Pressable>
        </View>
      </ScrollView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  content: {
    padding: 16,
    gap: 14},
  heroCard: {
    padding: 20,
    borderRadius: 30,
    backgroundColor: '#071019',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.28)',
    gap: 14},
  heroBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: Colors.primary},
  heroBadgeText: {
    color: Colors.black,
    fontSize: 11,
    fontWeight: '900' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5},
  heroTitle: {
    color: Colors.text,
    fontSize: 28,
    lineHeight: 33,
    fontWeight: '900' as const},
  heroSubtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600' as const},
  scoreRow: {
    flexDirection: 'row' as const,
    gap: 12},
  scoreCard: {
    flex: 1,
    padding: 12,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center' as const,
    gap: 8},
  scoreCircle: {
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 7,
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  scoreValue: {
    fontSize: 24,
    fontWeight: '900' as const},
  scoreLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '800' as const,
    textAlign: 'center' as const},
  card: {
    padding: 16,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 14},
  cardHeaderRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10},
  cardHeaderCopy: {
    flex: 1,
    gap: 3},
  cardTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '900' as const},
  cardSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600' as const},
  refreshButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.primary},
  refreshButtonText: {
    color: Colors.black,
    fontSize: 11,
    fontWeight: '900' as const},
  loadingRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  mutedText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700' as const},
  errorText: {
    color: Colors.error,
    fontSize: 12,
    fontWeight: '800' as const},
  proofGrid: {
    gap: 7},
  proofText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700' as const},
  nextActionBox: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    padding: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)'},
  nextActionText: {
    flex: 1,
    color: Colors.warning,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800' as const},
  dependencyCard: {
    padding: 14,
    borderRadius: 20,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12},
  dependencyTopRow: {
    flexDirection: 'row' as const,
    gap: 11,
    alignItems: 'flex-start' as const},
  dependencyIndex: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '900' as const,
    paddingTop: 2},
  dependencyTitleBlock: {
    flex: 1,
    gap: 8},
  dependencyTitle: {
    color: Colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900' as const},
  badgeRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 7},
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1},
  badgeText: {
    fontSize: 10,
    fontWeight: '900' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.35},
  detailBlock: {
    gap: 4},
  detailLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '900' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5},
  detailText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700' as const},
  completedProofBox: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 9,
    padding: 11,
    borderRadius: 16,
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.28)'},
  completedProofCopy: {
    flex: 1,
    gap: 4},
  completedProofTitle: {
    color: Colors.success,
    fontSize: 12,
    fontWeight: '900' as const},
  completedProofText: {
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700' as const},
  dayCard: {
    padding: 14,
    borderRadius: 20,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12},
  dayHeader: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10},
  dayNumberPill: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Colors.primary},
  dayNumber: {
    color: Colors.black,
    fontSize: 11,
    fontWeight: '900' as const},
  dayTitleBlock: {
    flex: 1,
    gap: 3},
  dayTitle: {
    color: Colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900' as const},
  dayStatus: {
    fontSize: 11,
    fontWeight: '900' as const,
    textTransform: 'uppercase'},
  dayChecklist: {
    gap: 8},
  checklistRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8},
  checkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
    backgroundColor: Colors.textTertiary},
  checkDotDone: {
    backgroundColor: Colors.success},
  checklistText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700' as const},
  ownerVariablesButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: Colors.primary},
  ownerVariablesButtonText: {
    color: Colors.black,
    fontSize: 12,
    fontWeight: '900' as const}});
