/**
 * Investor-facing IVX Protection Dashboard.
 *
 * Aggregates the investor's protection-layer view: wallet summary
 * (cash/pending/invested/available/token/profit), investments (real estate /
 * JV / private lender / tokenized), pending withdrawals with live workflow
 * status, compliance status (KYC/AML/accredited/identity), and active
 * sessions with the ability to revoke. Designed to match the dark/gold IVX
 * admin aesthetic so iOS and Android show the same surface.
 */
import React, { useState } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  Alert} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  Shield,
  Wallet,
  Landmark,
  Handshake,
  Coins,
  Banknote,
  TrendingUp,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MonitorSmartphone,
  Building2,
  ArrowUpRight,
  KeyRound} from 'lucide-react-native';
import { getDirectApiBaseUrl } from '@/lib/api-base';
import { assertOwnerSessionAccessToken } from '@/src/modules/ivx-owner-ai/services/ownerSessionPreflight';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const GOLD = '#FFD700';
const BG = '#000000';
const CARD = '#141414';
const CARD_ALT = '#1A1A1A';
const BORDER = '#2A2A2A';
const TEXT = '#FFFFFF';
const SUB = '#909090';
const GREEN = '#00C48C';
const RED = '#FF4D4D';
const AMBER = '#F59E0B';
const BLUE = '#4A90D9';

// ---------------------------------------------------------------------------
// API helpers — owner bearer doubles as the investor bearer in the IVX trust
// model; members authenticate via the same Supabase bearer used elsewhere.
// ---------------------------------------------------------------------------

async function authedGet<T>(path: string): Promise<T> {
  const token = await assertOwnerSessionAccessToken();
  const base = getDirectApiBaseUrl().replace(/\/+$/, '');
  const response = await fetch(`${base}${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }});
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `Request failed (${response.status})`);
  }
  return payload as unknown as T;
}

async function authedPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = await assertOwnerSessionAccessToken();
  const base = getDirectApiBaseUrl().replace(/\/+$/, '');
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)});
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `Request failed (${response.status})`);
  }
  return payload as unknown as T;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WalletSummary {
  userId: string;
  cashBalance: number;
  pendingDeposits: number;
  pendingWithdrawals: number;
  investmentBalance: number;
  availableBalance: number;
  tokenBalance: number;
  profitEarned: number;
  profitPaid: number;
  transactionCount: number;
  generatedAt: string;
}

interface WalletResponse { ok: boolean; wallet: WalletSummary }

interface InvestmentRecord {
  id: string;
  investmentType: 'real_estate' | 'jv_deal' | 'private_lender' | 'tokenized';
  name: string;
  amountInvested: number;
  ownershipPercentage: number;
  currentValuation: number;
  profitDistributed: number;
  tokenBalance: number;
  status: string;
  createdAt: string;
}

interface InvestmentsResponse { ok: boolean; investments: InvestmentRecord[]; count: number }

interface WithdrawalRecord {
  id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'under_review' | 'approved' | 'rejected' | 'sent' | 'completed';
  rejectionReason: string;
  createdAt: string;
}

interface WithdrawalsResponse { ok: boolean; withdrawals: WithdrawalRecord[]; count: number }

interface ComplianceRecord {
  userId: string;
  kycStatus: string;
  amlStatus: string;
  accreditedInvestorStatus: string;
  identityVerified: boolean;
  riskFlags: Array<{ flag: string; severity: string; note: string }>;
}

interface ComplianceResponse { ok: boolean; record: ComplianceRecord | null }

interface SessionRecord {
  id: string;
  device: string;
  ip: string;
  location: string;
  active: boolean;
  lastSeenAt: string;
  createdAt: string;
}

interface SessionsResponse { ok: boolean; sessions: SessionRecord[]; count: number }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function money(value: number | undefined): string {
  const amount = typeof value === 'number' ? value : 0;
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function withdrawalColor(status: string): string {
  switch (status) {
    case 'completed': return GREEN;
    case 'sent': return BLUE;
    case 'approved': return GOLD;
    case 'under_review': return AMBER;
    case 'rejected': return RED;
    case 'pending': return SUB;
    default: return SUB;
  }
}

const INVESTMENT_LABEL: Record<InvestmentRecord['investmentType'], string> = {
  real_estate: 'Real Estate',
  jv_deal: 'JV Deal',
  private_lender: 'Private Lender',
  tokenized: 'Tokenized'};

const INVESTMENT_ICON: Record<InvestmentRecord['investmentType'], React.ReactNode> = {
  real_estate: <Building2 color={GOLD} size={18} />,
  jv_deal: <Handshake color={GOLD} size={18} />,
  private_lender: <Banknote color={GOLD} size={18} />,
  tokenized: <Coins color={GOLD} size={18} />};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

type TabKey = 'wallet' | 'investments' | 'withdrawals' | 'compliance' | 'sessions';

export default function InvestorProtectionScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('wallet');

  const walletQuery = useQuery<WalletResponse>({
    queryKey: ['investor-protection-wallet'],
    queryFn: () => authedGet<WalletResponse>('/api/ivx/protection/wallet?userId=me')});

  const investmentsQuery = useQuery<InvestmentsResponse>({
    queryKey: ['investor-protection-investments'],
    queryFn: () => authedGet<InvestmentsResponse>('/api/ivx/protection/investments?userId=me'),
    enabled: tab === 'investments'});

  const withdrawalsQuery = useQuery<WithdrawalsResponse>({
    queryKey: ['investor-protection-withdrawals'],
    queryFn: () => authedGet<WithdrawalsResponse>('/api/ivx/protection/withdrawals?userId=me'),
    enabled: tab === 'withdrawals'});

  const complianceQuery = useQuery<ComplianceResponse>({
    queryKey: ['investor-protection-compliance'],
    queryFn: () => authedGet<ComplianceResponse>('/api/ivx/protection/compliance?userId=me'),
    enabled: tab === 'compliance'});

  const sessionsQuery = useQuery<SessionsResponse>({
    queryKey: ['investor-protection-sessions'],
    queryFn: () => authedGet<SessionsResponse>('/api/ivx/protection/sessions?userId=me&active=1'),
    enabled: tab === 'sessions'});

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) =>
      authedPost<{ ok: boolean; session: SessionRecord }>('/api/ivx/protection/sessions/revoke', {
        sessionId,
        reason: 'Revoked by investor from protection dashboard.'}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['investor-protection-sessions'] }),
    onError: (err: unknown) => {
      Alert.alert('Revoke failed', err instanceof Error ? err.message : 'Unknown error');
    }});

  const refreshing =
    walletQuery.isRefetching ||
    (tab === 'investments' && investmentsQuery.isRefetching) ||
    (tab === 'withdrawals' && withdrawalsQuery.isRefetching) ||
    (tab === 'compliance' && complianceQuery.isRefetching) ||
    (tab === 'sessions' && sessionsQuery.isRefetching);

  const onRefresh = () => {
    walletQuery.refetch();
    if (tab === 'investments') investmentsQuery.refetch();
    if (tab === 'withdrawals') withdrawalsQuery.refetch();
    if (tab === 'compliance') complianceQuery.refetch();
    if (tab === 'sessions') sessionsQuery.refetch();
  };

  const wallet = walletQuery.data?.wallet;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'My Protection',
          headerStyle: { backgroundColor: BG },
          headerTintColor: GOLD,
          headerTitleStyle: { color: TEXT }}}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GOLD} />}
      >
        <View style={styles.hero}>
          <Shield color={GOLD} size={22} />
          <View style={styles.heroBody}>
            <Text style={styles.heroTitle}>Investor Protection</Text>
            <Text style={styles.heroSub}>
              Your wallet, investments, withdrawals, compliance, and sessions — secured by an immutable ledger.
            </Text>
          </View>
        </View>

        {walletQuery.isError ? (
          <View style={[styles.card, { borderColor: RED }]}>
            <AlertTriangle color={RED} size={18} />
            <Text style={styles.errorText}>
              {walletQuery.error instanceof Error ? walletQuery.error.message : 'Failed to load wallet.'}
            </Text>
          </View>
        ) : null}

        <TabBar tab={tab} onChange={setTab} />

        {tab === 'wallet' ? <WalletTab wallet={wallet} loading={walletQuery.isLoading} /> : null}
        {tab === 'investments' ? <InvestmentsTab query={investmentsQuery} /> : null}
        {tab === 'withdrawals' ? <WithdrawalsTab query={withdrawalsQuery} /> : null}
        {tab === 'compliance' ? <ComplianceTab query={complianceQuery} /> : null}
        {tab === 'sessions' ? (
          <SessionsTab query={sessionsQuery} onRevoke={(id) => revokeMutation.mutate(id)} revoking={revokeMutation.isPending} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

function TabBar({ tab, onChange }: { tab: TabKey; onChange: (t: TabKey) => void }) {
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'wallet', label: 'Wallet' },
    { key: 'investments', label: 'Investments' },
    { key: 'withdrawals', label: 'Withdrawals' },
    { key: 'compliance', label: 'KYC/AML' },
    { key: 'sessions', label: 'Sessions' },
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBarContent}>
      {tabs.map((t) => {
        const active = t.key === tab;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            style={[styles.tab, active ? styles.tabActive : null]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.tabText, active ? styles.tabTextActive : null]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Wallet tab — section 3
// ---------------------------------------------------------------------------

function WalletTab({ wallet, loading }: { wallet: WalletSummary | undefined; loading: boolean }) {
  if (loading && !wallet) {
    return (
      <View style={styles.card}>
        <ShimmerIndicator color={GOLD} />
        <Text style={styles.cardSub}>Loading wallet…</Text>
      </View>
    );
  }
  return (
    <View style={styles.stack}>
      <View style={styles.heroRow}>
        <View style={styles.heroCard}>
          <Wallet color={GOLD} size={20} />
          <Text style={styles.heroLabel}>Available Balance</Text>
          <Text style={styles.heroValue}>{money(wallet?.availableBalance)}</Text>
        </View>
        <View style={styles.heroCard}>
          <Landmark color={GOLD} size={20} />
          <Text style={styles.heroLabel}>Invested</Text>
          <Text style={styles.heroValue}>{money(wallet?.investmentBalance)}</Text>
        </View>
      </View>

      <View style={styles.statGrid}>
        <StatTile icon={<Wallet color={GOLD} size={16} />} label="Cash Balance" value={money(wallet?.cashBalance)} />
        <StatTile icon={<Clock color={AMBER} size={16} />} label="Pending Deposits" value={money(wallet?.pendingDeposits)} />
        <StatTile icon={<ArrowUpRight color={AMBER} size={16} />} label="Pending Withdrawals" value={money(wallet?.pendingWithdrawals)} />
        <StatTile icon={<Coins color={GOLD} size={16} />} label="Token Balance" value={String(wallet?.tokenBalance ?? 0)} />
        <StatTile icon={<TrendingUp color={GREEN} size={16} />} label="Profit Earned" value={money(wallet?.profitEarned)} tone={GREEN} />
        <StatTile icon={<CheckCircle2 color={GREEN} size={16} />} label="Profit Paid" value={money(wallet?.profitPaid)} />
      </View>

      <View style={styles.card}>
        <Shield color={GREEN} size={18} />
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>Immutable Ledger</Text>
          <Text style={styles.cardSub}>
            {wallet?.transactionCount ?? 0} transactions · append-only · nothing deleted · every edit tracked
          </Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Investments tab — section 4
// ---------------------------------------------------------------------------

function InvestmentsTab({ query }: { query: ReturnType<typeof useQuery<InvestmentsResponse>> }) {
  if (query.isLoading) return <LoadingCard label="Loading investments…" />;
  if (query.isError) return <ErrorCard message={query.error instanceof Error ? query.error.message : 'Failed to load investments.'} />;
  const investments = query.data?.investments ?? [];
  if (investments.length === 0) return <EmptyCard label="No investments yet." />;
  return (
    <View style={styles.stack}>
      {investments.map((inv) => (
        <View key={inv.id} style={styles.card}>
          {INVESTMENT_ICON[inv.investmentType] ?? <Landmark color={GOLD} size={18} />}
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>{inv.name}</Text>
            <Text style={styles.cardSub}>{INVESTMENT_LABEL[inv.investmentType]} · {inv.status}</Text>
            <Text style={styles.cardSub}>invested {money(inv.amountInvested)} · valuation {money(inv.currentValuation)}</Text>
            <Text style={styles.cardSub}>ownership {inv.ownershipPercentage}% · profit {money(inv.profitDistributed)}</Text>
            {inv.investmentType === 'tokenized' ? (
              <Text style={styles.cardSub}>tokens {inv.tokenBalance}</Text>
            ) : null}
            <Text style={styles.cardSub}>{new Date(inv.createdAt).toLocaleString()}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Withdrawals tab — section 6
// ---------------------------------------------------------------------------

function WithdrawalsTab({ query }: { query: ReturnType<typeof useQuery<WithdrawalsResponse>> }) {
  if (query.isLoading) return <LoadingCard label="Loading withdrawals…" />;
  if (query.isError) return <ErrorCard message={query.error instanceof Error ? query.error.message : 'Failed to load withdrawals.'} />;
  const withdrawals = query.data?.withdrawals ?? [];
  if (withdrawals.length === 0) return <EmptyCard label="No withdrawal requests." />;
  return (
    <View style={styles.stack}>
      <Text style={styles.flowText}>pending → under_review → approved → sent → completed</Text>
      {withdrawals.map((w) => (
        <View key={w.id} style={styles.card}>
          <Banknote color={withdrawalColor(w.status)} size={18} />
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>{money(w.amount)} {w.currency}</Text>
            <Text style={[styles.stateBadge, { color: withdrawalColor(w.status), borderColor: withdrawalColor(w.status) }]}>
              {w.status.toUpperCase().replace(/_/g, ' ')}
            </Text>
            {w.rejectionReason ? <Text style={[styles.cardSub, { color: RED }]}>rejected: {w.rejectionReason}</Text> : null}
            <Text style={styles.cardSub}>{new Date(w.createdAt).toLocaleString()}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Compliance tab — section 11
// ---------------------------------------------------------------------------

function ComplianceTab({ query }: { query: ReturnType<typeof useQuery<ComplianceResponse>> }) {
  if (query.isLoading) return <LoadingCard label="Loading compliance…" />;
  if (query.isError) return <ErrorCard message={query.error instanceof Error ? query.error.message : 'Failed to load compliance.'} />;
  const record = query.data?.record;
  if (!record) {
    return (
      <View style={styles.card}>
        <KeyRound color={GOLD} size={18} />
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>No compliance record yet</Text>
          <Text style={styles.cardSub}>KYC verification has not been started. Visit the KYC screen to begin.</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Shield color={GOLD} size={18} />
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>Compliance Status</Text>
          <View style={styles.badgeRow}>
            <Badge label={`KYC ${record.kycStatus}`} tone={record.kycStatus === 'verified' ? GREEN : record.kycStatus === 'rejected' ? RED : AMBER} />
            <Badge label={`AML ${record.amlStatus}`} tone={record.amlStatus === 'cleared' ? GREEN : record.amlStatus === 'flagged' ? RED : SUB} />
            <Badge label={`Accredited ${record.accreditedInvestorStatus}`} tone={record.accreditedInvestorStatus === 'verified' ? GREEN : SUB} />
            <Badge label={record.identityVerified ? 'ID verified' : 'ID pending'} tone={record.identityVerified ? GREEN : AMBER} />
          </View>
          {record.riskFlags.length > 0 ? (
            <View style={styles.riskList}>
              {record.riskFlags.map((f, i) => (
                <Text key={i} style={[styles.cardSub, { color: f.severity === 'high' ? RED : AMBER }]}>
                  ⚑ {f.flag} ({f.severity}) — {f.note}
                </Text>
              ))}
            </View>
          ) : (
            <Text style={styles.cardSub}>No risk flags.</Text>
          )}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sessions tab — section 1 (session management)
// ---------------------------------------------------------------------------

function SessionsTab({
  query,
  onRevoke,
  revoking}: {
  query: ReturnType<typeof useQuery<SessionsResponse>>;
  onRevoke: (id: string) => void;
  revoking: boolean;
}) {
  if (query.isLoading) return <LoadingCard label="Loading sessions…" />;
  if (query.isError) return <ErrorCard message={query.error instanceof Error ? query.error.message : 'Failed to load sessions.'} />;
  const sessions = query.data?.sessions ?? [];
  if (sessions.length === 0) return <EmptyCard label="No active sessions." />;
  return (
    <View style={styles.stack}>
      <Text style={styles.flowText}>Review the devices signed into your account. Revoke any you do not recognize.</Text>
      {sessions.map((s) => (
        <View key={s.id} style={styles.card}>
          <MonitorSmartphone color={s.active ? GREEN : SUB} size={18} />
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>{s.device || 'Unknown device'}</Text>
            <Text style={styles.cardSub}>ip {s.ip || '—'} · {s.location || 'location unknown'}</Text>
            <Text style={styles.cardSub}>last seen {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : '—'}</Text>
            <Text style={styles.cardSub}>signed in {new Date(s.createdAt).toLocaleString()}</Text>
          </View>
          {s.active ? (
            <Pressable
              onPress={() => onRevoke(s.id)}
              disabled={revoking}
              style={({ pressed }) => [styles.revokeBtn, pressed ? { opacity: 0.6 } : null]}
              accessibilityRole="button"
              accessibilityLabel="Revoke session"
            >
              <XCircle color={RED} size={18} />
              <Text style={styles.revokeText}>Revoke</Text>
            </Pressable>
          ) : (
            <Text style={[styles.stateBadge, { color: SUB, borderColor: SUB }]}>REVOKED</Text>
          )}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Reusable
// ---------------------------------------------------------------------------

function StatTile({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: string }) {
  return (
    <View style={styles.statTile}>
      {icon}
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone: string }) {
  return (
    <View style={[styles.badge, { borderColor: tone }]}>
      <Text style={[styles.badgeText, { color: tone }]}>{label}</Text>
    </View>
  );
}

function LoadingCard({ label }: { label: string }) {
  return (
    <View style={styles.card}>
      <ShimmerIndicator color={GOLD} />
      <Text style={styles.cardSub}>{label}</Text>
    </View>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <View style={[styles.card, { borderColor: RED }]}>
      <AlertTriangle color={RED} size={18} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

function EmptyCard({ label }: { label: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardSub}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  stack: { gap: 12 },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: CARD_ALT,
    borderColor: GOLD,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16},
  heroBody: { flex: 1, gap: 4 },
  heroTitle: { color: GOLD, fontSize: 16, fontWeight: '700' as const },
  heroSub: { color: SUB, fontSize: 11, lineHeight: 16 },
  heroRow: { flexDirection: 'row', gap: 12 },
  heroCard: {
    flex: 1,
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 6},
  heroLabel: { color: SUB, fontSize: 12 },
  heroValue: { color: GOLD, fontSize: 24, fontWeight: '700' as const },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statTile: {
    width: '48%',
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 4},
  statLabel: { color: SUB, fontSize: 11 },
  statValue: { color: TEXT, fontSize: 16, fontWeight: '600' as const },
  statSub: { color: SUB, fontSize: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14},
  cardBody: { flex: 1, gap: 3 },
  cardTitle: { color: TEXT, fontSize: 14, fontWeight: '600' as const },
  cardSub: { color: SUB, fontSize: 11 },
  stateBadge: {
    alignSelf: 'flex-start',
    fontSize: 10,
    fontWeight: '700' as const,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
    textTransform: 'uppercase' as const},
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: '700' as const },
  riskList: { gap: 2, marginTop: 4 },
  flowText: { color: SUB, fontSize: 11, fontStyle: 'italic' as const },
  errorText: { color: RED, fontSize: 13, flex: 1 },
  tabBarContent: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 999},
  tabActive: { borderColor: GOLD, backgroundColor: CARD_ALT },
  tabText: { color: SUB, fontSize: 12, fontWeight: '600' as const },
  tabTextActive: { color: GOLD },
  revokeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6 },
  revokeText: { color: RED, fontSize: 11, fontWeight: '700' as const }});
