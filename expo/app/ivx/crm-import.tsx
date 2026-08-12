import { useCallback, useMemo, useState } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { Stack, router } from 'expo-router';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  CopyMinus,
  FileSpreadsheet,
  HandCoins,
  Landmark,
  ShoppingBag,
  TrendingUp,
  Upload,
  Users} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import {
  importContacts,
  type ImportReceipt,
  type PartyType} from '@/src/modules/ivx-developer/investorCrmService';

type PartyTab = {
  type: Extract<PartyType, 'investor' | 'buyer' | 'broker' | 'lender' | 'developer'>;
  label: string;
  Icon: typeof Users;
  example: string;
};

const PARTY_TABS: PartyTab[] = [
  { type: 'investor', label: 'Investors', Icon: TrendingUp, example: 'name,email,phone,company,location,typicalCheckSize\nJane Capital,jane@fund.com,305-555-0100,Vista Equity,Miami FL,$250k' },
  { type: 'buyer', label: 'Buyers', Icon: ShoppingBag, example: 'name,email,phone,location\nMarco Buyer,marco@mail.com,305-555-0144,Pembroke Pines FL' },
  { type: 'broker', label: 'Brokers', Icon: Building2, example: 'name,email,company\nLuxe Realty,desk@luxe.com,Luxe Realty Group' },
  { type: 'lender', label: 'Lenders', Icon: Landmark, example: 'name,email,company\nBridge Capital,deals@bridge.com,Bridge Private Credit' },
  { type: 'developer', label: 'Developers', Icon: HandCoins, example: 'name,email,location\nGulf Build Co,info@gulfbuild.com,Jacksonville FL' },
];

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function MetricTile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={[styles.metricValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function ImportScreenInner() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<PartyTab>(PARTY_TABS[0]);
  const [csv, setCsv] = useState<string>('');
  const [sourceDetail, setSourceDetail] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ImportReceipt | null>(null);

  const byPartyType = receipt?.summary?.byPartyType ?? null;

  const handleImport = useCallback(async () => {
    setError(null);
    const trimmed = csv.trim();
    if (!trimmed) {
      setError('Paste CSV rows (or an Excel copy-paste) with a header row including a "name" column.');
      return;
    }
    setBusy(true);
    try {
      const detail = sourceDetail.trim() || `pasted ${todayStamp()}`;
      const result = await importContacts({ partyType: activeTab.type, csv: trimmed, sourceDetail: detail });
      setReceipt(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed. Check your session and try again.');
    } finally {
      setBusy(false);
    }
  }, [csv, sourceDetail, activeTab.type]);

  const engineLinks = useMemo(
    () => [
      { label: 'Capital Network', route: '/ivx/capital-network' },
      { label: 'Deal Matching', route: '/ivx/deal-matching' },
      { label: 'Opportunity Engine', route: '/ivx/opportunity-engine' },
      { label: 'Outreach', route: '/ivx/outreach' },
    ],
    [],
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'CRM Import' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
          keyboardShouldPersistTaps="handled"
          testID="ivx-crm-import-scroll"
        >
          <View style={styles.heroCard}>
            <View style={styles.heroHeaderRow}>
              <Upload size={18} color={Colors.primary} />
              <Text style={styles.heroTitle}>Import real contacts</Text>
            </View>
            <Text style={styles.heroSubtitle}>
              Bring in your real investors, buyers, brokers, lenders, and developers. Paste CSV or copy directly from Excel/Sheets — the header row just needs a name column. IVX never fabricates contacts; rows without a name are skipped and reported.
            </Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
            {PARTY_TABS.map((tab) => {
              const active = tab.type === activeTab.type;
              const TabIcon = tab.Icon;
              const count = byPartyType?.[tab.type] ?? 0;
              return (
                <Pressable
                  key={tab.type}
                  style={[styles.tabChip, active ? styles.tabChipActive : null]}
                  onPress={() => { setActiveTab(tab); setReceipt(null); setError(null); }}
                  testID={`ivx-import-tab-${tab.type}`}
                >
                  <TabIcon size={14} color={active ? Colors.black : Colors.textSecondary} />
                  <Text style={[styles.tabChipText, active ? styles.tabChipTextActive : null]}>
                    {`${tab.label}${count > 0 ? ` (${count})` : ''}`}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{`Import ${activeTab.label.toLowerCase()}`}</Text>
            <Text style={styles.fieldLabel}>Source attribution</Text>
            <TextInput
              style={styles.input}
              value={sourceDetail}
              onChangeText={setSourceDetail}
              placeholder={`e.g. ${activeTab.label} list ${todayStamp()}`}
              placeholderTextColor={Colors.inputPlaceholder}
              testID="ivx-import-source"
            />
            <Text style={styles.fieldLabel}>CSV / Excel rows</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={csv}
              onChangeText={setCsv}
              placeholder={activeTab.example}
              placeholderTextColor={Colors.inputPlaceholder}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              testID="ivx-import-csv"
            />

            {error ? (
              <View style={styles.errorRow}>
                <AlertTriangle size={14} color={Colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              style={[styles.primaryButton, busy ? styles.primaryButtonDisabled : null]}
              onPress={() => { void handleImport(); }}
              disabled={busy}
              testID="ivx-import-submit"
            >
              {busy ? (
                <ShimmerIndicator color={Colors.black} />
              ) : (
                <>
                  <FileSpreadsheet size={16} color={Colors.black} />
                  <Text style={styles.primaryButtonText}>{`Import ${activeTab.label.toLowerCase()}`}</Text>
                </>
              )}
            </Pressable>
          </View>

          {receipt ? (
            <View style={styles.card} testID="ivx-import-receipt">
              <View style={styles.heroHeaderRow}>
                <CheckCircle2 size={16} color={Colors.success} />
                <Text style={styles.cardTitle}>Import receipt</Text>
              </View>
              <View style={styles.metricGrid}>
                <MetricTile label="Rows seen" value={receipt.total} />
                <MetricTile label="Imported" value={receipt.imported} tone={Colors.success} />
                <MetricTile label="Duplicates" value={receipt.duplicates} tone={Colors.warning} />
                <MetricTile label="Invalid" value={receipt.invalid} tone={Colors.error} />
              </View>

              <View style={styles.totalRow}>
                <Users size={14} color={Colors.primary} />
                <Text style={styles.totalText}>{`Total contacts now: ${receipt.totalContacts}`}</Text>
              </View>

              {byPartyType ? (
                <View style={styles.breakdownGrid}>
                  {PARTY_TABS.map((tab) => (
                    <View key={tab.type} style={styles.breakdownItem}>
                      <Text style={styles.breakdownValue}>{byPartyType[tab.type] ?? 0}</Text>
                      <Text style={styles.breakdownLabel}>{tab.label}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {receipt.duplicateRows.length > 0 ? (
                <View style={styles.noteBlock}>
                  <View style={styles.heroHeaderRow}>
                    <CopyMinus size={13} color={Colors.warning} />
                    <Text style={styles.noteTitle}>{`${receipt.duplicateRows.length} duplicate(s) skipped`}</Text>
                  </View>
                  {receipt.duplicateRows.slice(0, 4).map((d) => (
                    <Text key={`dup-${d.row}`} style={styles.noteRow}>{`Row ${d.row}: ${d.reason}`}</Text>
                  ))}
                </View>
              ) : null}

              {receipt.invalidRows.length > 0 ? (
                <View style={styles.noteBlock}>
                  <View style={styles.heroHeaderRow}>
                    <AlertTriangle size={13} color={Colors.error} />
                    <Text style={styles.noteTitle}>{`${receipt.invalidRows.length} invalid row(s) skipped`}</Text>
                  </View>
                  {receipt.invalidRows.slice(0, 4).map((d) => (
                    <Text key={`inv-${d.row}`} style={styles.noteRow}>{`Row ${d.row}: ${d.reason}`}</Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Run the engines</Text>
            <Text style={styles.cardSubtitle}>
              After importing, run the engines against your contacts and the 3 live deals.
            </Text>
            {engineLinks.map((link) => (
              <Pressable
                key={link.route}
                style={styles.engineRow}
                onPress={() => router.push(link.route as never)}
                testID={`ivx-import-open-${link.route}`}
              >
                <Text style={styles.engineRowText}>{link.label}</Text>
                <ArrowRight size={15} color={Colors.primary} />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

export default function CrmImportScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  return (
    <ErrorBoundary>
      <ImportScreenInner />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  content: { padding: 16, gap: 14 },
  heroCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 8},
  heroHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { color: Colors.text, fontSize: 18, fontWeight: '700' as const },
  heroSubtitle: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  tabRow: { gap: 8, paddingVertical: 2 },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  tabChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabChipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
  tabChipTextActive: { color: Colors.black },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 10},
  cardTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  cardSubtitle: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  fieldLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' as const, marginTop: 2 },
  input: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 14},
  textArea: { minHeight: 130, textAlignVertical: 'top' as const, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { color: Colors.error, fontSize: 13, flex: 1 },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 4},
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: Colors.black, fontSize: 15, fontWeight: '700' as const },
  metricGrid: { flexDirection: 'row', gap: 8 },
  metricTile: {
    flex: 1,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 3},
  metricValue: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  metricLabel: { color: Colors.textTertiary, fontSize: 11 },
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  totalText: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  breakdownGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4},
  breakdownItem: {
    flexGrow: 1,
    minWidth: 88,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 2},
  breakdownValue: { color: Colors.primary, fontSize: 16, fontWeight: '700' as const },
  breakdownLabel: { color: Colors.textTertiary, fontSize: 11 },
  noteBlock: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10,
    padding: 10,
    gap: 4,
    marginTop: 4},
  noteTitle: { color: Colors.text, fontSize: 13, fontWeight: '600' as const },
  noteRow: { color: Colors.textSecondary, fontSize: 12, lineHeight: 16 },
  engineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10},
  engineRowText: { color: Colors.text, fontSize: 14, fontWeight: '600' as const }});
