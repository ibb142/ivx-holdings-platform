import { useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import {
  Building2,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  MapPin,
  Search,
  ShieldCheck,
  TrendingUp,
  Users} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  generateInvestorReport,
  runInvestorDiscovery,
  type DiscoveredInvestor,
  type InvestorDiscoveryClass,
  type InvestorDiscoveryResult,
  type InvestorReportResult} from '@/src/modules/ivx-developer/investorDiscoveryService';

const CLASS_LABEL: Record<InvestorDiscoveryClass, string> = {
  buyers: 'Buyers ($10M+)',
  jv_deals: 'JV / Investors'};

function formatUsd(value: number | null): string {
  if (value === null) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

function InvestorCard({ investor }: { investor: DiscoveredInvestor }) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const location = [investor.businessCity, investor.businessState].filter(Boolean).join(', ');
  return (
    <View style={styles.card} testID={`ivx-investor-${investor.cik}`}>
      <View style={styles.cardHeaderRow}>
        <View style={styles.typeBadge}>
          <Building2 size={12} color={Colors.black} />
          <Text style={styles.typeBadgeText}>{investor.entityType ?? 'Entity'}</Text>
        </View>
        <View style={styles.amountPill}>
          <Text style={styles.amountPillText}>{formatUsd(investor.totalOfferingAmountUsd)}</Text>
        </View>
      </View>

      <Text style={styles.entityName}>{investor.entityName}</Text>

      {location ? (
        <View style={styles.metaRow}>
          <MapPin size={12} color={Colors.textTertiary} />
          <Text style={styles.metaText}>{location}</Text>
        </View>
      ) : null}

      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{formatUsd(investor.totalAmountSoldUsd)}</Text>
          <Text style={styles.statLabel}>Raised</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{investor.investorsAlreadyInvested ?? '—'}</Text>
          <Text style={styles.statLabel}>Investors in</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{investor.filingDate ?? '—'}</Text>
          <Text style={styles.statLabel}>Filed</Text>
        </View>
      </View>

      {investor.relatedPersons.length > 0 ? (
        <Pressable style={styles.expandButton} onPress={() => setExpanded((v) => !v)} testID={`ivx-investor-expand-${investor.cik}`}>
          <Text style={styles.expandButtonText}>
            {expanded ? 'Hide principals' : `${investor.relatedPersons.length} named principal${investor.relatedPersons.length === 1 ? '' : 's'}`}
          </Text>
        </Pressable>
      ) : null}

      {expanded ? (
        <View style={styles.expandBody}>
          {investor.relatedPersons.map((p) => (
            <View key={`${p.fullName}-${p.relationships.join('-')}`} style={styles.personRow}>
              <Users size={12} color={Colors.textSecondary} />
              <Text style={styles.personName}>{p.fullName}</Text>
              <Text style={styles.personRole} numberOfLines={1}>{p.relationships.join(' · ') || 'Related person'}</Text>
            </View>
          ))}
          {investor.industryGroup ? <Text style={styles.industryText}>{`Industry: ${investor.industryGroup}`}</Text> : null}
          {investor.jurisdiction ? <Text style={styles.industryText}>{`Jurisdiction: ${investor.jurisdiction}`}</Text> : null}
        </View>
      ) : null}

      <Pressable
        style={styles.sourceButton}
        onPress={() => Linking.openURL(investor.filingUrl).catch(() => undefined)}
        testID={`ivx-investor-source-${investor.cik}`}
      >
        <ExternalLink size={12} color={Colors.primary} />
        <Text style={styles.sourceButtonText}>View official SEC filing</Text>
      </Pressable>
    </View>
  );
}

function InvestorDiscoveryScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState<string>('real estate');
  const [discoveryClass, setDiscoveryClass] = useState<InvestorDiscoveryClass>('buyers');

  const mutation = useMutation<InvestorDiscoveryResult, Error, void>({
    mutationFn: () => runInvestorDiscovery({ query: query.trim() || 'real estate', discoveryClass })});

  const reportMutation = useMutation<InvestorReportResult, Error, void>({
    mutationFn: () => generateInvestorReport({ query: query.trim() || 'real estate', discoveryClass })});

  const onScan = useCallback(() => {
    mutation.mutate();
  }, [mutation]);

  const onGenerateReport = useCallback(() => {
    reportMutation.mutate();
  }, [reportMutation]);

  const result = mutation.data;
  const report = reportMutation.data;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Investor Discovery', headerStyle: { backgroundColor: Colors.black }, headerTintColor: Colors.white }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.headline}>Real investors from public SEC filings</Text>
        <Text style={styles.subhead}>
          Live SEC EDGAR Form D data — real entity names, named principals, business address, offering amount, and a link to the official filing for every record.
        </Text>

        <View style={styles.classRow}>
          {(Object.keys(CLASS_LABEL) as InvestorDiscoveryClass[]).map((cls) => {
            const active = discoveryClass === cls;
            return (
              <Pressable
                key={cls}
                style={[styles.classChip, active && styles.classChipActive]}
                onPress={() => setDiscoveryClass(cls)}
                testID={`ivx-discovery-class-${cls}`}
              >
                {cls === 'buyers' ? (
                  <TrendingUp size={13} color={active ? Colors.black : Colors.textSecondary} />
                ) : (
                  <Users size={13} color={active ? Colors.black : Colors.textSecondary} />
                )}
                <Text style={[styles.classChipText, active && styles.classChipTextActive]}>{CLASS_LABEL[cls]}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.searchRow}>
          <Search size={16} color={Colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="real estate, multifamily, a sponsor name…"
            placeholderTextColor={Colors.textTertiary}
            returnKeyType="search"
            onSubmitEditing={onScan}
            testID="ivx-discovery-query"
          />
        </View>

        <Pressable style={styles.scanButton} onPress={onScan} disabled={mutation.isPending} testID="ivx-discovery-scan">
          {mutation.isPending ? (
            <ShimmerIndicator color={Colors.black} />
          ) : (
            <Text style={styles.scanButtonText}>Find real investors</Text>
          )}
        </Pressable>

        {mutation.isError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{mutation.error.message}</Text>
          </View>
        ) : null}

        {result ? (
          <View style={styles.resultHeader}>
            <Text style={styles.resultCount}>{`${result.resultCount} real ${result.discoveryClass === 'buyers' ? 'buyer' : 'investor'} entit${result.resultCount === 1 ? 'y' : 'ies'}`}</Text>
            <Text style={styles.resultMeta}>{`${result.totalFilingsMatched.toLocaleString()} Form D filings matched · scanned ${result.scannedFilings}`}</Text>
          </View>
        ) : null}

        {result && !result.ok ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{result.error ?? 'SEC EDGAR request failed.'}</Text>
          </View>
        ) : null}

        {result?.investors.map((investor) => (
          <InvestorCard key={`${investor.cik}-${investor.accessionNumber}`} investor={investor} />
        ))}

        {result && result.ok && result.investors.length === 0 ? (
          <Text style={styles.emptyText}>No filings matched these filters. Try a broader query or the JV / Investors class.</Text>
        ) : null}

        {result && result.ok && result.investors.length > 0 ? (
          <Pressable
            style={styles.reportButton}
            onPress={onGenerateReport}
            disabled={reportMutation.isPending}
            testID="ivx-discovery-generate-report"
          >
            {reportMutation.isPending ? (
              <ShimmerIndicator color={Colors.white} />
            ) : (
              <>
                <FileSpreadsheet size={16} color={Colors.white} />
                <Text style={styles.reportButtonText}>Generate downloadable report (CSV)</Text>
              </>
            )}
          </Pressable>
        ) : null}

        {reportMutation.isError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{reportMutation.error.message}</Text>
          </View>
        ) : null}

        {report ? (
          <View style={[styles.reportResultBox, report.ok && report.deliverable?.signedUrl ? styles.reportResultOk : styles.reportResultPending]}>
            <Text style={styles.reportResultStatus}>
              {report.ok && report.deliverable?.signedUrl ? 'REPORT READY' : report.status === 'queued' ? 'GENERATING…' : 'REPORT NOT READY'}
            </Text>
            <Text style={styles.reportResultMessage}>{report.message}</Text>
            {report.deliverable?.signedUrl ? (
              <Pressable
                style={styles.reportDownloadButton}
                onPress={() => Linking.openURL(report.deliverable!.signedUrl as string).catch(() => undefined)}
                testID="ivx-discovery-download-report"
              >
                <Download size={14} color={Colors.black} />
                <Text style={styles.reportDownloadText}>
                  {`Download ${report.rowCount} records · ${report.deliverable.fileSize ?? 0} bytes`}
                </Text>
              </Pressable>
            ) : null}
            {report.deliverable?.downloadHttpStatus ? (
              <View style={styles.reportProofRow}>
                <CheckCircle2 size={12} color={Colors.success} />
                <Text style={styles.reportProofText}>{`Download verified · HTTP ${report.deliverable.downloadHttpStatus}`}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {result ? (
          <View style={styles.complianceBox}>
            <ShieldCheck size={13} color={Colors.textSecondary} />
            <Text style={styles.complianceText}>{result.complianceNote}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

export default function InvestorDiscoveryScreenWithBoundary() {
  return (
    <ErrorBoundary>
      <InvestorDiscoveryScreen />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 16 },
  headline: { fontSize: 22, fontWeight: '800' as const, color: Colors.text, marginBottom: 6 },
  subhead: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 16 },
  classRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  classChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border},
  classChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  classChipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  classChipTextActive: { color: Colors.black },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 12},
  searchInput: { flex: 1, color: Colors.text, fontSize: 14, paddingVertical: 10 },
  scanButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16},
  scanButtonText: { fontSize: 15, fontWeight: '700' as const, color: Colors.black },
  errorBox: { backgroundColor: '#3a1212', borderRadius: 10, padding: 12, marginBottom: 12 },
  errorText: { color: '#ff9b9b', fontSize: 13, lineHeight: 18 },
  resultHeader: { marginBottom: 12 },
  resultCount: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  resultMeta: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 12},
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primary,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 7},
  typeBadgeText: { fontSize: 11, fontWeight: '700' as const, color: Colors.black },
  amountPill: { backgroundColor: Colors.background, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 7 },
  amountPillText: { fontSize: 13, fontWeight: '800' as const, color: Colors.success },
  entityName: { fontSize: 16, fontWeight: '700' as const, color: Colors.text, marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 },
  metaText: { fontSize: 13, color: Colors.textSecondary },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  statBox: { flex: 1, backgroundColor: Colors.background, borderRadius: 9, paddingVertical: 8, alignItems: 'center' },
  statValue: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  statLabel: { fontSize: 10, color: Colors.textTertiary, marginTop: 2 },
  expandButton: { paddingVertical: 8 },
  expandButtonText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },
  expandBody: { backgroundColor: Colors.background, borderRadius: 10, padding: 10, marginBottom: 8 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  personName: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  personRole: { fontSize: 12, color: Colors.textTertiary, flex: 1 },
  industryText: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  sourceButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 6 },
  sourceButtonText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },
  emptyText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginVertical: 16 },
  reportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.black,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 4,
    marginBottom: 12},
  reportButtonText: { fontSize: 14, fontWeight: '700' as const, color: Colors.white },
  reportResultBox: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  reportResultOk: { backgroundColor: '#0f2417', borderColor: Colors.success },
  reportResultPending: { backgroundColor: Colors.card, borderColor: Colors.border },
  reportResultStatus: { fontSize: 12, fontWeight: '800' as const, color: Colors.text, letterSpacing: 0.5, marginBottom: 4 },
  reportResultMessage: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  reportDownloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 11,
    marginTop: 10},
  reportDownloadText: { fontSize: 13, fontWeight: '700' as const, color: Colors.black },
  reportProofRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  reportProofText: { fontSize: 11, color: Colors.success, fontWeight: '600' as const },
  complianceBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 12,
    marginTop: 8},
  complianceText: { flex: 1, fontSize: 11, color: Colors.textTertiary, lineHeight: 16 }});
