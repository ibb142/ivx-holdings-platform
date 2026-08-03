/**
 * Admin — IVX Enterprise Investor Protection Center.
 *
 * Aggregates all 12 sections of the investor protection spec into one
 * owner-only control surface: account states & deletion protection, recovery
 * + sessions, investments, withdrawal workflow, encrypted wire queue,
 * compliance (KYC/AML/accredited), immutable audit log, and owner reports.
 */
import React, { useMemo, useState } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  Modal,
  TextInput} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Users,
  Landmark,
  Banknote,
  Building2,
  Handshake,
  Coins,
  FileClock,
  Lock,
  Unlock,
  KeyRound,
  MonitorSmartphone,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ScrollText,
  TrendingUp} from 'lucide-react-native';
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
// API helpers
// ---------------------------------------------------------------------------

async function ownerGet<T>(path: string): Promise<T> {
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

async function ownerPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
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

interface DashboardSummary {
  totalMembers: number;
  totalInvestors: number;
  totalBuyers: number;
  totalJvDeals: number;
  totalPrivateLenders: number;
  totalTokenizedInvestments: number;
  capitalRaised: number;
  capitalDeployed: number;
  pendingWithdrawals: number;
  pendingWithdrawalCount: number;
  pendingWires: number;
  completedWires: number;
  jvCapital: number;
  tokenizedCapital: number;
  privateLenderCapital: number;
  totalProfitDistributed: number;
  accountsByState: Record<string, number>;
  kycVerifiedCount: number;
  amlFlaggedCount: number;
  accreditedCount: number;
  generatedAt: string;
}

interface ProtectionDashboardResponse {
  ok: boolean;
  marker: string;
  summary: DashboardSummary;
}

interface LedgerIntegrityResponse {
  ok: boolean;
  treasuryLedgerIntegrity: { valid: boolean; totalEntries: number; firstBrokenAt: string | null } | null;
  immutable: boolean;
  deletable: boolean;
  message: string;
}

interface AccountStateRecord {
  id: string;
  userId: string;
  accountState: 'active' | 'suspended' | 'locked' | 'archived' | 'closed';
  reason: string;
  operatorEmail: string;
  previousState: string;
  hasFunds: boolean;
  updatedAt: string;
  createdAt: string;
}

interface AccountStatesResponse {
  ok: boolean;
  states: AccountStateRecord[];
  count: number;
}

interface WithdrawalRecord {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'under_review' | 'approved' | 'rejected' | 'sent' | 'completed';
  availableBalanceAtRequest: number;
  rejectionReason: string;
  auditTrail: Array<{ at: string; actor: string; action: string; detail: string }>;
  createdAt: string;
  updatedAt: string;
}

interface WithdrawalsResponse {
  ok: boolean;
  withdrawals: WithdrawalRecord[];
  count: number;
}

interface WireSafeView {
  id: string;
  userId: string;
  bankName: string;
  accountHolder: string;
  accountNumberLast4: string;
  routingMasked: string;
  swiftMasked: string;
  ibanMasked: string;
  isInternational: boolean;
  status: 'pending' | 'initiated' | 'confirmed' | 'failed' | 'reversed';
  createdAt: string;
}

interface WireQueueResponse {
  ok: boolean;
  queue: WireSafeView[];
  count: number;
}

interface ComplianceRecord {
  id: string;
  userId: string;
  kycStatus: string;
  amlStatus: string;
  accreditedInvestorStatus: string;
  identityVerified: boolean;
  riskFlags: Array<{ flag: string; severity: string; note: string }>;
  updatedAt: string;
}

interface ComplianceListResponse {
  ok: boolean;
  records: ComplianceRecord[];
  count: number;
}

interface AuditLogEntry {
  id: string;
  actorEmail: string;
  action: string;
  targetUserId: string;
  targetEntity: string;
  ip: string;
  device: string;
  reason: string;
  createdAt: string;
}

interface AuditLogResponse {
  ok: boolean;
  entries: AuditLogEntry[];
  count: number;
}

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

function stateColor(state: string): string {
  switch (state) {
    case 'active': return GREEN;
    case 'suspended': return AMBER;
    case 'locked': return RED;
    case 'archived': return SUB;
    case 'closed': return SUB;
    default: return SUB;
  }
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

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

type TabKey = 'overview' | 'accounts' | 'withdrawals' | 'wires' | 'compliance' | 'audit';

export default function InvestorProtectionScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('overview');

  const dashboardQuery = useQuery<ProtectionDashboardResponse>({
    queryKey: ['protection-dashboard'],
    queryFn: () => ownerGet<ProtectionDashboardResponse>('/api/ivx/protection/dashboard')});

  const integrityQuery = useQuery<LedgerIntegrityResponse>({
    queryKey: ['protection-ledger-integrity'],
    queryFn: () => ownerGet<LedgerIntegrityResponse>('/api/ivx/protection/ledger-integrity')});

  const accountStatesQuery = useQuery<AccountStatesResponse>({
    queryKey: ['protection-account-states'],
    queryFn: () => ownerGet<AccountStatesResponse>('/api/ivx/protection/account-states'),
    enabled: tab === 'accounts'});

  const withdrawalsQuery = useQuery<WithdrawalsResponse>({
    queryKey: ['protection-withdrawals'],
    queryFn: () => ownerGet<WithdrawalsResponse>('/api/ivx/protection/withdrawals'),
    enabled: tab === 'withdrawals'});

  const wireQueueQuery = useQuery<WireQueueResponse>({
    queryKey: ['protection-wire-queue'],
    queryFn: () => ownerGet<WireQueueResponse>('/api/ivx/protection/wire-queue'),
    enabled: tab === 'wires'});

  const complianceQuery = useQuery<ComplianceListResponse>({
    queryKey: ['protection-compliance'],
    queryFn: () => ownerGet<ComplianceListResponse>('/api/ivx/protection/compliance'),
    enabled: tab === 'compliance'});

  const auditQuery = useQuery<AuditLogResponse>({
    queryKey: ['protection-audit-log'],
    queryFn: () => ownerGet<AuditLogResponse>('/api/ivx/protection/audit-log?limit=80'),
    enabled: tab === 'audit'});

  const summary = dashboardQuery.data?.summary;
  const integrity = integrityQuery.data;
  const refreshing = dashboardQuery.isRefetching || integrityQuery.isRefetching;

  const onRefresh = () => {
    dashboardQuery.refetch();
    integrityQuery.refetch();
    if (tab === 'accounts') accountStatesQuery.refetch();
    if (tab === 'withdrawals') withdrawalsQuery.refetch();
    if (tab === 'wires') wireQueueQuery.refetch();
    if (tab === 'compliance') complianceQuery.refetch();
    if (tab === 'audit') auditQuery.refetch();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Investor Protection',
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
            <Text style={styles.heroTitle}>Enterprise Investor Protection</Text>
            <Text style={styles.heroSub}>
              Account states · deletion protection · recovery · wallets · investments · withdrawals · wires · compliance · audit
            </Text>
          </View>
        </View>

        {dashboardQuery.isError ? (
          <View style={[styles.card, { borderColor: RED }]}>
            <AlertTriangle color={RED} size={18} />
            <Text style={styles.errorText}>
              {dashboardQuery.error instanceof Error ? dashboardQuery.error.message : 'Failed to load protection dashboard.'}
            </Text>
          </View>
        ) : null}

        <TabBar tab={tab} onChange={setTab} />

        {tab === 'overview' ? (
          <OverviewTab
            summary={summary}
            integrity={integrity}
            loading={dashboardQuery.isLoading}
          />
        ) : null}

        {tab === 'accounts' ? (
          <AccountsTab
            query={accountStatesQuery}
          />
        ) : null}

        {tab === 'withdrawals' ? (
          <WithdrawalsTab query={withdrawalsQuery} />
        ) : null}

        {tab === 'wires' ? (
          <WiresTab query={wireQueueQuery} />
        ) : null}

        {tab === 'compliance' ? (
          <ComplianceTab query={complianceQuery} />
        ) : null}

        {tab === 'audit' ? (
          <AuditTab query={auditQuery} />
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
    { key: 'overview', label: 'Overview' },
    { key: 'accounts', label: 'Accounts' },
    { key: 'withdrawals', label: 'Withdrawals' },
    { key: 'wires', label: 'Wires' },
    { key: 'compliance', label: 'KYC/AML' },
    { key: 'audit', label: 'Audit Log' },
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
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab({
  summary,
  integrity,
  loading}: {
  summary: DashboardSummary | undefined;
  integrity: LedgerIntegrityResponse | undefined;
  loading: boolean;
}) {
  if (loading && !summary) {
    return (
      <View style={styles.card}>
        <ShimmerIndicator color={GOLD} />
        <Text style={styles.cardSub}>Loading protection summary…</Text>
      </View>
    );
  }
  const accountsByState = summary?.accountsByState ?? {};
  return (
    <View style={styles.stack}>
      <View style={styles.heroRow}>
        <HeroCard icon={<Users color={GOLD} size={20} />} label="Members" value={String(summary?.totalMembers ?? 0)} />
        <HeroCard icon={<Landmark color={GOLD} size={20} />} label="Investors" value={String(summary?.totalInvestors ?? 0)} />
      </View>

      <Text style={styles.sectionTitle}>Capital</Text>
      <View style={styles.statGrid}>
        <StatTile icon={<Landmark color={GOLD} size={16} />} label="Capital Raised" value={money(summary?.capitalRaised)} />
        <StatTile icon={<TrendingUp color={GREEN} size={16} />} label="Capital Deployed" value={money(summary?.capitalDeployed)} />
        <StatTile icon={<Handshake color={GOLD} size={16} />} label="JV Capital" value={money(summary?.jvCapital)} />
        <StatTile icon={<Coins color={GOLD} size={16} />} label="Tokenized Capital" value={money(summary?.tokenizedCapital)} />
        <StatTile icon={<Banknote color={GOLD} size={16} />} label="Private Lender Capital" value={money(summary?.privateLenderCapital)} />
        <StatTile icon={<TrendingUp color={GREEN} size={16} />} label="Profit Distributed" value={money(summary?.totalProfitDistributed)} />
      </View>

      <Text style={styles.sectionTitle}>Money Movement</Text>
      <View style={styles.statGrid}>
        <StatTile icon={<Clock color={AMBER} size={16} />} label="Pending Withdrawals" value={money(summary?.pendingWithdrawals)} sub={`${summary?.pendingWithdrawalCount ?? 0} requests`} />
        <StatTile icon={<Banknote color={BLUE} size={16} />} label="Pending Wires" value={String(summary?.pendingWires ?? 0)} />
        <StatTile icon={<CheckCircle2 color={GREEN} size={16} />} label="Completed Wires" value={String(summary?.completedWires ?? 0)} />
      </View>

      <Text style={styles.sectionTitle}>Account States (deletion protection)</Text>
      <View style={styles.stateRow}>
        {(['active', 'suspended', 'locked', 'archived', 'closed'] as const).map((s) => (
          <View key={s} style={[styles.statePill, { borderColor: stateColor(s) }]}>
            <Text style={[styles.statePillText, { color: stateColor(s) }]}>{s}</Text>
            <Text style={styles.statePillCount}>{accountsByState[s] ?? 0}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Compliance</Text>
      <View style={styles.statGrid}>
        <StatTile icon={<ShieldCheck color={GREEN} size={16} />} label="KYC Verified" value={String(summary?.kycVerifiedCount ?? 0)} />
        <StatTile icon={<ShieldAlert color={RED} size={16} />} label="AML Flagged" value={String(summary?.amlFlaggedCount ?? 0)} tone={summary?.amlFlaggedCount ? RED : undefined} />
        <StatTile icon={<CheckCircle2 color={GREEN} size={16} />} label="Accredited" value={String(summary?.accreditedCount ?? 0)} />
      </View>

      <Text style={styles.sectionTitle}>Safety & Integrity</Text>
      <View style={[styles.card, integrity?.treasuryLedgerIntegrity?.valid === false ? { borderColor: RED } : { borderColor: GREEN }]}>
        {integrity?.treasuryLedgerIntegrity?.valid === false ? (
          <ShieldAlert color={RED} size={18} />
        ) : (
          <ShieldCheck color={GREEN} size={18} />
        )}
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>Immutable Hash-Chained Ledger</Text>
          <Text style={styles.cardSub}>
            {integrity?.treasuryLedgerIntegrity
              ? `${integrity.treasuryLedgerIntegrity.totalEntries} entries · ${integrity.treasuryLedgerIntegrity.valid ? 'chain verified' : 'CHAIN BROKEN'}`
              : 'Verifying…'}
          </Text>
          <Text style={styles.cardSub}>No account with funds can be deleted. No transaction can be deleted.</Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Accounts tab
// ---------------------------------------------------------------------------

function AccountsTab({ query }: { query: ReturnType<typeof useQuery<AccountStatesResponse>> }) {
  if (query.isLoading) return <LoadingCard label="Loading account states…" />;
  if (query.isError) return <ErrorCard message={query.error instanceof Error ? query.error.message : 'Failed to load account states.'} />;
  const states = query.data?.states ?? [];
  if (states.length === 0) return <EmptyCard label="No account-state records yet." />;
  return (
    <View style={styles.stack}>
      {states.map((s) => (
        <View key={s.id} style={styles.card}>
          <Lock color={stateColor(s.accountState)} size={18} />
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>{shortId(s.userId)}</Text>
            <Text style={[styles.stateBadge, { color: stateColor(s.accountState), borderColor: stateColor(s.accountState) }]}>
              {s.accountState.toUpperCase()}
            </Text>
            <Text style={styles.cardSub}>reason: {s.reason || '—'}</Text>
            <Text style={styles.cardSub}>funds: {s.hasFunds ? 'YES' : 'no'} · prev: {s.previousState}</Text>
            <Text style={styles.cardSub}>operator: {s.operatorEmail || 'system'} · {new Date(s.updatedAt).toLocaleString()}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Withdrawals tab
// ---------------------------------------------------------------------------

function WithdrawalsTab({ query }: { query: ReturnType<typeof useQuery<WithdrawalsResponse>> }) {
  if (query.isLoading) return <LoadingCard label="Loading withdrawals…" />;
  if (query.isError) return <ErrorCard message={query.error instanceof Error ? query.error.message : 'Failed to load withdrawals.'} />;
  const withdrawals = query.data?.withdrawals ?? [];
  if (withdrawals.length === 0) return <EmptyCard label="No withdrawal requests." />;
  return (
    <View style={styles.stack}>
      <Text style={styles.sectionTitle}>Withdrawal Workflow</Text>
      <Text style={styles.flowText}>pending → under_review → approved → sent → completed (rejected at any pre-send stage)</Text>
      {withdrawals.map((w) => (
        <View key={w.id} style={styles.card}>
          <Banknote color={withdrawalColor(w.status)} size={18} />
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>{money(w.amount)} {w.currency}</Text>
            <Text style={[styles.stateBadge, { color: withdrawalColor(w.status), borderColor: withdrawalColor(w.status) }]}>
              {w.status.toUpperCase().replace(/_/g, ' ')}
            </Text>
            <Text style={styles.cardSub}>user: {shortId(w.userId)}</Text>
            <Text style={styles.cardSub}>available at request: {money(w.availableBalanceAtRequest)}</Text>
            {w.rejectionReason ? <Text style={[styles.cardSub, { color: RED }]}>rejected: {w.rejectionReason}</Text> : null}
            <Text style={styles.cardSub}>{new Date(w.createdAt).toLocaleString()}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Wires tab
// ---------------------------------------------------------------------------

function WiresTab({ query }: { query: ReturnType<typeof useQuery<WireQueueResponse>> }) {
  if (query.isLoading) return <LoadingCard label="Loading wire queue…" />;
  if (query.isError) return <ErrorCard message={query.error instanceof Error ? query.error.message : 'Failed to load wire queue.'} />;
  const queue = query.data?.queue ?? [];
  if (queue.length === 0) return <EmptyCard label="No wires pending initiation." />;
  return (
    <View style={styles.stack}>
      <Text style={styles.sectionTitle}>Wire Queue (encrypted at rest)</Text>
      <Text style={styles.flowText}>Full account numbers are never displayed. Only last 4 digits shown.</Text>
      {queue.map((w) => (
        <View key={w.id} style={styles.card}>
          <Building2 color={GOLD} size={18} />
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>{w.bankName}</Text>
            <Text style={styles.cardSub}>{w.accountHolder} · ••••{w.accountNumberLast4}</Text>
            <Text style={styles.cardSub}>routing {w.routingMasked} · SWIFT {w.swiftMasked}</Text>
            {w.isInternational ? <Text style={[styles.cardSub, { color: AMBER }]}>international · IBAN {w.ibanMasked}</Text> : null}
            <Text style={styles.cardSub}>user: {shortId(w.userId)}</Text>
            <Text style={styles.cardSub}>{new Date(w.createdAt).toLocaleString()}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Compliance tab
// ---------------------------------------------------------------------------

function ComplianceTab({ query }: { query: ReturnType<typeof useQuery<ComplianceListResponse>> }) {
  if (query.isLoading) return <LoadingCard label="Loading compliance records…" />;
  if (query.isError) return <ErrorCard message={query.error instanceof Error ? query.error.message : 'Failed to load compliance.'} />;
  const records = query.data?.records ?? [];
  if (records.length === 0) return <EmptyCard label="No compliance records yet." />;
  return (
    <View style={styles.stack}>
      {records.map((r) => (
        <View key={r.id} style={styles.card}>
          <Shield color={GOLD} size={18} />
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>{shortId(r.userId)}</Text>
            <View style={styles.badgeRow}>
              <Badge label={`KYC ${r.kycStatus}`} tone={r.kycStatus === 'verified' ? GREEN : r.kycStatus === 'rejected' ? RED : AMBER} />
              <Badge label={`AML ${r.amlStatus}`} tone={r.amlStatus === 'cleared' ? GREEN : r.amlStatus === 'flagged' ? RED : SUB} />
              <Badge label={`ACC ${r.accreditedInvestorStatus}`} tone={r.accreditedInvestorStatus === 'verified' ? GREEN : SUB} />
              <Badge label={r.identityVerified ? 'ID verified' : 'ID pending'} tone={r.identityVerified ? GREEN : AMBER} />
            </View>
            {r.riskFlags.length > 0 ? (
              <View style={styles.riskList}>
                {r.riskFlags.map((f, i) => (
                  <Text key={i} style={[styles.cardSub, { color: f.severity === 'high' ? RED : AMBER }]}>
                    ⚑ {f.flag} ({f.severity}) — {f.note}
                  </Text>
                ))}
              </View>
            ) : null}
            <Text style={styles.cardSub}>updated {new Date(r.updatedAt).toLocaleString()}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Audit tab
// ---------------------------------------------------------------------------

function AuditTab({ query }: { query: ReturnType<typeof useQuery<AuditLogResponse>> }) {
  if (query.isLoading) return <LoadingCard label="Loading audit log…" />;
  if (query.isError) return <ErrorCard message={query.error instanceof Error ? query.error.message : 'Failed to load audit log.'} />;
  const entries = query.data?.entries ?? [];
  if (entries.length === 0) return <EmptyCard label="No audit entries yet." />;
  return (
    <View style={styles.stack}>
      <Text style={styles.sectionTitle}>Append-Only Audit Log</Text>
      <Text style={styles.flowText}>Every action records user, admin, IP, device, old/new value, and reason. Nothing is deleted.</Text>
      {entries.map((e) => (
        <View key={e.id} style={styles.card}>
          <ScrollText color={GOLD} size={16} />
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>{e.action.replace(/_/g, ' ')}</Text>
            <Text style={styles.cardSub}>actor: {e.actorEmail || 'system'}</Text>
            <Text style={styles.cardSub}>target: {e.targetEntity} {e.targetUserId ? shortId(e.targetUserId) : ''}</Text>
            <Text style={styles.cardSub}>ip: {e.ip || '—'} · device: {e.device || '—'}</Text>
            {e.reason ? <Text style={styles.cardSub}>reason: {e.reason}</Text> : null}
            <Text style={styles.cardSub}>{new Date(e.createdAt).toLocaleString()}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Reusable cards
// ---------------------------------------------------------------------------

function HeroCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.heroCard}>
      {icon}
      <Text style={styles.heroLabel}>{label}</Text>
      <Text style={styles.heroValue}>{value}</Text>
    </View>
  );
}

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
  sectionTitle: { color: TEXT, fontSize: 15, fontWeight: '700' as const, marginTop: 8 },
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
  stateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: CARD,
    borderWidth: 1,
    borderRadius: 999,
    alignItems: 'center',
    gap: 2},
  statePillText: { fontSize: 11, fontWeight: '700' as const, textTransform: 'uppercase' as const },
  statePillCount: { color: TEXT, fontSize: 14, fontWeight: '700' as const },
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
  badge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2},
  badgeText: { fontSize: 10, fontWeight: '700' as const },
  riskList: { gap: 2, marginTop: 4 },
  flowText: { color: SUB, fontSize: 11, fontStyle: 'italic' as const },
  empty: { color: SUB, fontSize: 13 },
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
  tabTextActive: { color: GOLD }});
