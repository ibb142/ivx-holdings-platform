import React, { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import {
  Archive,
  Ban,
  CheckCircle2,
  CircleX,
    RotateCcw,
  Trash2,
} from 'lucide-react-native';
import IVXBrandIcon from '@/components/IVXBrandIcon';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';

type VipTier = 'vip1' | 'vip2' | 'vip3' | 'vip4' | 'blocked_review';
type TransactionStatus =
  | 'active_transaction'
  | 'pending_transaction'
  | 'no_transaction'
  | 'expired'
  | 'blocked'
  | 'owner_review';
type ReviewState = 'active' | 'owner_review' | 'archived' | 'blocked' | 'delete_queue';
type RecordType = 'buyer' | 'investor' | 'jv' | 'tokenized_buyer' | 'opportunity' | 'other';
type OwnerActionType =
  | 'approve'
  | 'archive'
  | 'block'
  | 'queue_delete'
  | 'delete'
  | 'return_to_active'
  | 'move_to_review'
  | 'set_transaction_status';

type OrderedRecord = {
  recordId: string;
  orderNumber: number;
  orderNumberFormatted: string;
  createdAt: string;
  name: string;
  company: string;
  type: RecordType;
  vipTier: VipTier;
  score: number;
  transactionStatus: TransactionStatus;
  reviewState: ReviewState;
  reason: string | null;
  autoMoved: boolean;
  lastContactAt: string | null;
  lastActivityAt: string;
  source: string;
  availableActions: OwnerActionType[];
};

type OrderingSummary = {
  total: number;
  highestOrderNumber: number;
  byVipTier: Record<VipTier, number>;
  ownerReview: number;
  blocked: number;
  deleteQueue: number;
  activeTransactions: number;
  noTransaction: number;
  movedToReviewAuto: number;
};

type BoardResponse = {
  ok: boolean;
  summary: OrderingSummary;
  views: Record<string, OrderedRecord[]>;
  error?: string;
};

type ViewKey =
  | 'all'
  | 'vip1'
  | 'vip2'
  | 'vip3'
  | 'vip4'
  | 'owner_review'
  | 'blocked'
  | 'delete_queue'
  | 'active_transactions'
  | 'no_transaction';

const VIEW_TABS: { key: ViewKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'vip1', label: 'VIP 1' },
  { key: 'vip2', label: 'VIP 2' },
  { key: 'vip3', label: 'VIP 3' },
  { key: 'vip4', label: 'VIP 4' },
  { key: 'owner_review', label: 'Owner Review' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'delete_queue', label: 'Delete Queue' },
  { key: 'active_transactions', label: 'Active Tx' },
  { key: 'no_transaction', label: 'No Tx' },
];

const QUERY_KEY = ['ivx', 'ordering', 'board'] as const;

function resolveBaseUrl(): string {
  const candidates = [
    process.env.EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL,
    process.env.EXPO_PUBLIC_IVX_API_BASE_URL,
    process.env.EXPO_PUBLIC_API_BASE_URL,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return c.trim().replace(/\/+$/, '');
    }
  }
  return '';
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getIVXAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchBoard(): Promise<BoardResponse | null> {
  const base = resolveBaseUrl();
  if (!base) return null;
  const res = await fetch(`${base}/api/ivx/ordering/board`, { headers: await authHeaders() });
  const json = (await res.json().catch(() => ({}))) as BoardResponse;
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

async function postAction(input: { recordId: string; action: OwnerActionType; reason?: string }): Promise<void> {
  const base = resolveBaseUrl();
  if (!base) throw new Error('API base URL is not configured.');
  const res = await fetch(`${base}/api/ivx/ordering/action`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `HTTP ${res.status}`);
}

const VIP_COLOR: Record<VipTier, string> = {
  vip1: Colors.gold,
  vip2: Colors.success,
  vip3: Colors.info,
  vip4: Colors.muted,
  blocked_review: Colors.error,
};

const VIP_LABEL: Record<VipTier, string> = {
  vip1: 'VIP 1',
  vip2: 'VIP 2',
  vip3: 'VIP 3',
  vip4: 'VIP 4',
  blocked_review: 'BLOCKED',
};

const TX_COLOR: Record<TransactionStatus, string> = {
  active_transaction: Colors.success,
  pending_transaction: Colors.info,
  no_transaction: Colors.muted,
  expired: Colors.orange,
  blocked: Colors.error,
  owner_review: Colors.warning,
};

const TYPE_LABEL: Record<RecordType, string> = {
  buyer: 'Buyer',
  investor: 'Investor',
  jv: 'JV',
  tokenized_buyer: 'Tokenized',
  opportunity: 'Opportunity',
  other: 'Other',
};

function formatTime(value: string | null): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString();
  } catch {
    return value;
  }
}

const ACTION_LABEL: Record<OwnerActionType, string> = {
  approve: 'Approve',
  archive: 'Archive',
  block: 'Block',
  queue_delete: 'Queue Delete',
  delete: 'Delete',
  return_to_active: 'Return',
  move_to_review: 'Review',
  set_transaction_status: 'Status',
};

const ACTION_ICON: Partial<Record<OwnerActionType, React.ReactNode>> = {
  approve: <CheckCircle2 size={13} color={Colors.success} />,
  archive: <Archive size={13} color={Colors.muted} />,
  block: <Ban size={13} color={Colors.error} />,
  queue_delete: <Trash2 size={13} color={Colors.orange} />,
  delete: <Trash2 size={13} color={Colors.error} />,
  return_to_active: <RotateCcw size={13} color={Colors.info} />,
  move_to_review: <CircleX size={13} color={Colors.warning} />,
};

function SummaryChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <View style={styles.chip}>
      <Text style={[styles.chipValue, { color: tone }]}>{value}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

function RecordRow({
  rec,
  onAction,
  pending,
}: {
  rec: OrderedRecord;
  onAction: (recordId: string, action: OwnerActionType) => void;
  pending: boolean;
}) {
  // The owner-facing actions exclude the bare status setter (handled separately).
  const actions = rec.availableActions.filter((a) => a !== 'set_transaction_status');
  return (
    <View style={styles.row} testID={`record-${rec.recordId}`}>
      <View style={styles.rowHeader}>
        <Text style={styles.orderNum}>#{rec.orderNumberFormatted}</Text>
        <View style={[styles.vipBadge, { borderColor: VIP_COLOR[rec.vipTier] }]}>
          <Text style={[styles.vipText, { color: VIP_COLOR[rec.vipTier] }]}>{VIP_LABEL[rec.vipTier]}</Text>
        </View>
        <Text style={styles.typeText}>{TYPE_LABEL[rec.type]}</Text>
        <Text style={styles.scoreText}>{rec.score}</Text>
      </View>
      <Text style={styles.name} numberOfLines={1}>{rec.name || 'Unnamed'}</Text>
      {rec.company ? <Text style={styles.company} numberOfLines={1}>{rec.company}</Text> : null}
      <View style={styles.metaRow}>
        <View style={[styles.txBadge, { backgroundColor: `${TX_COLOR[rec.transactionStatus]}22` }]}>
          <Text style={[styles.txText, { color: TX_COLOR[rec.transactionStatus] }]}>
            {rec.transactionStatus.replace(/_/g, ' ')}
          </Text>
        </View>
        {rec.reason ? (
          <Text style={styles.reasonText}>
            {rec.autoMoved ? 'auto · ' : ''}{rec.reason.replace(/_/g, ' ')}
          </Text>
        ) : null}
      </View>
      <Text style={styles.dates}>
        created {formatTime(rec.createdAt)} · contact {formatTime(rec.lastContactAt)} · {rec.source}
      </Text>
      {actions.length > 0 ? (
        <View style={styles.actionRow}>
          {actions.map((a) => (
            <Pressable
              key={a}
              style={styles.actionBtn}
              disabled={pending}
              onPress={() => onAction(rec.recordId, a)}
              testID={`action-${a}-${rec.recordId}`}
            >
              {ACTION_ICON[a]}
              <Text style={styles.actionText}>{ACTION_LABEL[a]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function OwnerOrderingScreen() {
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState<ViewKey>('all');

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchBoard,
    refetchInterval: 60_000,
  });

  const actionMutation = useMutation({
    mutationFn: postAction,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const onAction = useCallback(
    (recordId: string, action: OwnerActionType) => {
      actionMutation.mutate({ recordId, action });
    },
    [actionMutation],
  );

  const rows = useMemo<OrderedRecord[]>(() => {
    if (!data) return [];
    return data.views[activeView] ?? [];
  }, [data, activeView]);

  const summary = data?.summary;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Investor Ordering & Review' }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={Colors.text} />}
      >
        <View style={styles.hero}>
          <View style={styles.heroRow}>
            <IVXBrandIcon size={20} />
            <Text style={styles.heroTitle}>Owner Ordering & Block Review</Text>
          </View>
          <Text style={styles.heroSub}>
            Every buyer, investor, JV partner and opportunity — numbered from #000001, VIP-tiered, and reviewable. No record is deleted without your approval.
          </Text>
        </View>

        {summary ? (
          <View style={styles.chipGrid}>
            <SummaryChip label="Total" value={summary.total} tone={Colors.text} />
            <SummaryChip label="VIP 1" value={summary.byVipTier.vip1} tone={Colors.gold} />
            <SummaryChip label="VIP 2" value={summary.byVipTier.vip2} tone={Colors.success} />
            <SummaryChip label="VIP 3" value={summary.byVipTier.vip3} tone={Colors.info} />
            <SummaryChip label="VIP 4" value={summary.byVipTier.vip4} tone={Colors.muted} />
            <SummaryChip label="Review" value={summary.ownerReview} tone={Colors.warning} />
            <SummaryChip label="Blocked" value={summary.blocked} tone={Colors.error} />
            <SummaryChip label="Active Tx" value={summary.activeTransactions} tone={Colors.success} />
          </View>
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabsScroll}
          contentContainerStyle={styles.tabs}
        >
          {VIEW_TABS.map((tab) => {
            const count = data?.views[tab.key]?.length ?? 0;
            const active = tab.key === activeView;
            return (
              <Pressable
                key={tab.key}
                style={[styles.tab, active ? styles.tabActive : null]}
                onPress={() => setActiveView(tab.key)}
                testID={`tab-${tab.key}`}
              >
                <Text style={[styles.tabText, active ? styles.tabTextActive : null]}>
                  {tab.label} {count}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {isLoading ? (
          <View style={styles.center}><ActivityIndicator color={Colors.gold} /></View>
        ) : isError ? (
          <View style={styles.errorCard}>
            <CircleX size={18} color={Colors.error} />
            <Text style={styles.errorText}>{error instanceof Error ? error.message : 'Failed to load board.'}</Text>
          </View>
        ) : !data ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>API base URL is not configured.</Text>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No records in this view yet.</Text>
          </View>
        ) : (
          rows.map((rec) => (
            <RecordRow key={rec.recordId} rec={rec} onAction={onAction} pending={actionMutation.isPending} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

export default function OwnerOrderingScreenWrapper() {
  return (
    <ErrorBoundary>
      <OwnerOrderingScreen />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48, gap: 14 },
  hero: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 8,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { color: Colors.text, fontSize: 18, fontWeight: '700' as const },
  heroSub: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    minWidth: 72,
    alignItems: 'center',
  },
  chipValue: { fontSize: 18, fontWeight: '800' as const },
  chipLabel: { color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  tabsScroll: { marginHorizontal: -16 },
  tabs: { paddingHorizontal: 16, gap: 8 },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  tabActive: { backgroundColor: Colors.gold, borderColor: Colors.gold },
  tabText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
  tabTextActive: { color: Colors.black },
  center: { paddingVertical: 40, alignItems: 'center' },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: `${Colors.error}22`,
    borderRadius: 12,
    padding: 14,
  },
  errorText: { color: Colors.error, fontSize: 13, flex: 1 },
  emptyCard: { padding: 24, alignItems: 'center' },
  emptyText: { color: Colors.textTertiary, fontSize: 13 },
  row: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 4,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  orderNum: { color: Colors.textTertiary, fontSize: 13, fontWeight: '700' as const, fontVariant: ['tabular-nums'] },
  vipBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  vipText: { fontSize: 10, fontWeight: '800' as const },
  typeText: { color: Colors.textSecondary, fontSize: 11 },
  scoreText: { color: Colors.text, fontSize: 13, fontWeight: '700' as const, marginLeft: 'auto' },
  name: { color: Colors.text, fontSize: 15, fontWeight: '600' as const },
  company: { color: Colors.textSecondary, fontSize: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  txBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  txText: { fontSize: 11, fontWeight: '700' as const, textTransform: 'capitalize' as const },
  reasonText: { color: Colors.orange, fontSize: 11, textTransform: 'capitalize' as const },
  dates: { color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionText: { color: Colors.text, fontSize: 12, fontWeight: '600' as const },
});
