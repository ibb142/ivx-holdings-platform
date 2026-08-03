import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router';
import {
  ArrowLeft,
  TrendingUp,
  BarChart3,
  Clock,
  DollarSign,
  ShieldCheck,
  Leaf,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Zap,
  Target} from 'lucide-react-native';
import Colors from '@/constants/colors';
import {
  assetClassComparison,
  returnProjections,
  AssetClassPerformance} from '@/mocks/competitive-stats';

import { formatCurrencyWithDecimals } from '@/lib/formatters';

function ReturnBar({ asset, maxReturn }: { asset: AssetClassPerformance; maxReturn: number }) {
  const widthAnim = useRef(new Animated.Value(0)).current;
  const barWidth = (asset.annualReturn / maxReturn) * 100;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: barWidth,
      duration: 800,
      delay: 200,
      useNativeDriver: false}).start();
  }, [barWidth, widthAnim]);

  const animatedWidth = widthAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%']});

  return (
    <View style={styles.barRow}>
      <View style={styles.barLabel}>
        <View style={[styles.barDot, { backgroundColor: asset.color }]} />
        <Text style={styles.barName} numberOfLines={1}>{asset.name}</Text>
      </View>
      <View style={styles.barTrack}>
        <Animated.View
          style={[
            styles.barFill,
            {
              width: animatedWidth,
              backgroundColor: asset.color},
          ]}
        />
      </View>
      <Text style={[styles.barValue, { color: asset.color }]}>{asset.annualReturn}%</Text>
    </View>
  );
}

function ComparisonRow({ label, icon, values }: { label: string; icon: React.ReactNode; values: { asset: string; value: string; highlight?: boolean }[] }) {
  return (
    <View style={styles.compRow}>
      <View style={styles.compRowHeader}>
        {icon}
        <Text style={styles.compRowLabel}>{label}</Text>
      </View>
      <View style={styles.compRowValues}>
        {values.map((v, i) => (
          <View key={i} style={[styles.compCell, v.highlight && styles.compCellHighlight]}>
            <Text style={[styles.compCellValue, v.highlight && styles.compCellValueHighlight]}>{v.value}</Text>
            <Text style={styles.compCellAsset} numberOfLines={1}>{v.asset}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ProjectionCalculator() {
  const [amount, setAmount] = useState(10000);
  const [riskProfile, setRiskProfile] = useState<'conservative' | 'moderate' | 'aggressive'>('moderate');
  const profiles = returnProjections;
  const selected = profiles[riskProfile];

  const amounts = [1000, 5000, 10000, 25000, 50000, 100000];
  const risks: { key: typeof riskProfile; label: string; color: string }[] = [
    { key: 'conservative', label: 'Conservative', color: '#4ECDC4' },
    { key: 'moderate', label: 'Balanced', color: Colors.primary },
    { key: 'aggressive', label: 'Growth', color: '#FF6B6B' },
  ];

  const yearlyProjection = useMemo(() => {
    const results = [];
    let value = amount;
    for (let year = 1; year <= 10; year++) {
      value = value * (1 + selected.annual / 100);
      results.push({ year, value: Math.round(value) });
    }
    return results;
  }, [amount, selected.annual]);

  const fiveYearValue = yearlyProjection[4]?.value ?? 0;
  const tenYearValue = yearlyProjection[9]?.value ?? 0;

  return (
    <View style={styles.calculatorSection}>
      <Text style={styles.calcTitle}>Return Projector</Text>
      <Text style={styles.calcSubtitle}>See how your money could grow with IVXHOLDINGS</Text>

      <Text style={styles.calcLabel}>Investment Amount</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.amountScroll}>
        {amounts.map(a => (
          <TouchableOpacity
            key={a}
            style={[styles.amountPill, amount === a && styles.amountPillActive]}
            onPress={() => setAmount(a)}
          >
            <Text style={[styles.amountPillText, amount === a && styles.amountPillTextActive]}>
              {formatCurrencyWithDecimals(a)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={[styles.calcLabel, { marginTop: 16 }]}>Risk Profile</Text>
      <View style={styles.riskRow}>
        {risks.map(r => (
          <TouchableOpacity
            key={r.key}
            style={[styles.riskPill, riskProfile === r.key && { backgroundColor: r.color + '20', borderColor: r.color + '50' }]}
            onPress={() => setRiskProfile(r.key)}
          >
            <View style={[styles.riskDot, { backgroundColor: riskProfile === r.key ? r.color : Colors.textTertiary }]} />
            <Text style={[styles.riskPillText, riskProfile === r.key && { color: r.color }]}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.projectionCards}>
        <View style={styles.projCard}>
          <Text style={styles.projLabel}>5 Years</Text>
          <Text style={styles.projValue}>{formatCurrencyWithDecimals(fiveYearValue)}</Text>
          <Text style={[styles.projGain, { color: Colors.success }]}>
            +{formatCurrencyWithDecimals(fiveYearValue - amount)} ({((fiveYearValue - amount) / amount * 100).toFixed(0)}%)
          </Text>
        </View>
        <View style={[styles.projCard, styles.projCardHighlight]}>
          <Text style={[styles.projLabel, { color: Colors.primary }]}>10 Years</Text>
          <Text style={styles.projValue}>{formatCurrencyWithDecimals(tenYearValue)}</Text>
          <Text style={[styles.projGain, { color: Colors.success }]}>
            +{formatCurrencyWithDecimals(tenYearValue - amount)} ({((tenYearValue - amount) / amount * 100).toFixed(0)}%)
          </Text>
        </View>
      </View>

      <View style={styles.yearlyBreakdown}>
        {yearlyProjection.map((yr) => (
          <View key={yr.year} style={styles.yearRow}>
            <Text style={styles.yearLabel}>Year {yr.year}</Text>
            <View style={styles.yearBarTrack}>
              <View
                style={[
                  styles.yearBarFill,
                  {
                    width: `${Math.min((yr.value / tenYearValue) * 100, 100)}%`,
                    backgroundColor: riskProfile === 'conservative' ? '#4ECDC4' : riskProfile === 'moderate' ? Colors.primary : '#FF6B6B'},
                ]}
              />
            </View>
            <Text style={styles.yearValue}>{formatCurrencyWithDecimals(yr.value)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.disclaimerBox}>
        <Text style={styles.disclaimerText}>
          Past performance does not guarantee future results. Projections are based on historical IVXHOLDINGS returns and are for illustrative purposes only.
        </Text>
      </View>
    </View>
  );
}

export default function CompareInvestmentsScreen() {
  const router = useRouter();
  const maxReturn = Math.max(...assetClassComparison.map(a => a.annualReturn));

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Why IVXHOLDINGS Wins</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <View style={styles.heroCard}>
            <View style={styles.heroIconContainer}>
              <Zap size={28} color={Colors.primary} />
            </View>
            <Text style={styles.heroTitle}>Smarter Than Stocks</Text>
            <Text style={styles.heroSubtitle}>
              Real estate tokenization combines the stability of property with the liquidity of the stock market — at a fraction of the cost.
            </Text>
          </View>

          <Text style={styles.sectionTitle}>Annual Returns Comparison</Text>
          <View style={styles.barsContainer}>
            {assetClassComparison.map(asset => (
              <ReturnBar key={asset.name} asset={asset} maxReturn={maxReturn} />
            ))}
          </View>

          <Text style={styles.sectionTitle}>Head-to-Head</Text>
          <ComparisonRow
            label="Min. Investment"
            icon={<DollarSign size={16} color={Colors.primary} />}
            values={[
              { asset: 'IVXHOLDINGS', value: '$1', highlight: true },
              { asset: 'S&P 500', value: '$500' },
              { asset: 'Trad. RE', value: '$50K+' },
            ]}
          />
          <ComparisonRow
            label="Trading Hours"
            icon={<Clock size={16} color={Colors.primary} />}
            values={[
              { asset: 'IVXHOLDINGS', value: '24/7', highlight: true },
              { asset: 'S&P 500', value: '6.5h/day' },
              { asset: 'Trad. RE', value: '3-6 mo.' },
            ]}
          />
          <ComparisonRow
            label="Dividend Yield"
            icon={<BarChart3 size={16} color={Colors.primary} />}
            values={[
              { asset: 'IVXHOLDINGS', value: '7.2%', highlight: true },
              { asset: 'S&P 500', value: '1.5%' },
              { asset: 'Bonds', value: '4.2%' },
            ]}
          />
          <ComparisonRow
            label="Volatility"
            icon={<TrendingUp size={16} color={Colors.primary} />}
            values={[
              { asset: 'IVXHOLDINGS', value: '8.2%', highlight: true },
              { asset: 'S&P 500', value: '15.6%' },
              { asset: 'Bitcoin', value: '62.4%' },
            ]}
          />

          <View style={styles.advantageSection}>
            <Text style={styles.sectionTitle}>IVXHOLDINGS Exclusive Advantages</Text>
            {[
              { icon: <ShieldCheck size={20} color="#4ECDC4" />, title: 'Asset-Backed', desc: 'Every share is backed by a real, insured property with a first lien' },
              { icon: <Leaf size={20} color="#00C48C" />, title: 'Inflation Hedge', desc: 'Real estate historically rises with inflation, unlike cash or bonds' },
              { icon: <Target size={20} color={Colors.primary} />, title: 'Dual Income', desc: 'Earn from price appreciation AND quarterly rental dividends' },
              { icon: <Clock size={20} color="#45B7D1" />, title: 'Instant Liquidity', desc: 'Sell your shares in seconds, 24/7 — no 3-month escrow wait' },
            ].map((item, i) => (
              <View key={i} style={styles.advantageCard}>
                <View style={styles.advantageIcon}>{item.icon}</View>
                <View style={styles.advantageMeta}>
                  <Text style={styles.advantageTitle}>{item.title}</Text>
                  <Text style={styles.advantageDesc}>{item.desc}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.featureGrid}>
            <Text style={styles.sectionTitle}>Feature Matrix</Text>
            <View style={styles.matrixHeader}>
              <View style={styles.matrixLabelCell} />
              <Text style={[styles.matrixHeaderText, { color: Colors.primary }]}>IVXHOLDINGS</Text>
              <Text style={styles.matrixHeaderText}>Stocks</Text>
              <Text style={styles.matrixHeaderText}>Bonds</Text>
              <Text style={styles.matrixHeaderText}>Crypto</Text>
            </View>
            {[
              { label: 'Tangible Asset', ipx: true, stocks: false, bonds: false, crypto: false },
              { label: '24/7 Trading', ipx: true, stocks: false, bonds: false, crypto: true },
              { label: 'Dividend Income', ipx: true, stocks: true, bonds: true, crypto: false },
              { label: 'Inflation Hedge', ipx: true, stocks: false, bonds: false, crypto: false },
              { label: '$1 Minimum', ipx: true, stocks: false, bonds: false, crypto: true },
              { label: 'Insurance', ipx: true, stocks: true, bonds: true, crypto: false },
              { label: 'Low Volatility', ipx: true, stocks: false, bonds: true, crypto: false },
              { label: 'Tax Benefits', ipx: true, stocks: true, bonds: true, crypto: false },
            ].map((row, i) => (
              <View key={i} style={[styles.matrixRow, i % 2 === 0 && styles.matrixRowAlt]}>
                <Text style={styles.matrixLabel}>{row.label}</Text>
                <View style={styles.matrixCell}>
                  {row.ipx ? <CheckCircle2 size={18} color={Colors.success} /> : <XCircle size={18} color={Colors.error} />}
                </View>
                <View style={styles.matrixCell}>
                  {row.stocks ? <CheckCircle2 size={18} color={Colors.success} /> : <XCircle size={18} color={Colors.textTertiary} />}
                </View>
                <View style={styles.matrixCell}>
                  {row.bonds ? <CheckCircle2 size={18} color={Colors.success} /> : <XCircle size={18} color={Colors.textTertiary} />}
                </View>
                <View style={styles.matrixCell}>
                  {row.crypto ? <CheckCircle2 size={18} color={Colors.success} /> : <XCircle size={18} color={Colors.textTertiary} />}
                </View>
              </View>
            ))}
          </View>

          <ProjectionCalculator />

          <TouchableOpacity
            style={styles.ctaButton}
            onPress={() => router.push('/(tabs)/market' as any)}
            activeOpacity={0.8}
          >
            <Text style={styles.ctaText}>Start Investing Now</Text>
            <ChevronRight size={20} color={Colors.background} />
          </TouchableOpacity>

          <View style={styles.bottomPadding} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backButton: { padding: 8 },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  scrollContent: { padding: 20, paddingBottom: 140 },
  heroCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  heroIconContainer: { width: 56, height: 56, borderRadius: 18, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  heroTitle: { color: Colors.text, fontSize: 22, fontWeight: '800' as const, textAlign: 'center', marginBottom: 8 },
  heroSubtitle: { color: Colors.textSecondary, fontSize: 14, fontWeight: '500' as const, textAlign: 'center', marginBottom: 8, lineHeight: 20 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  barsContainer: { gap: 8 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, minWidth: 100 },
  barDot: { width: 8, height: 8, borderRadius: 4 },
  barName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: Colors.surfaceBorder, overflow: 'hidden' as const },
  barFill: { height: 8, borderRadius: 4 },
  barValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  compRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  compRowHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  compRowLabel: { color: Colors.textSecondary, fontSize: 13 },
  compRowValues: { flexDirection: 'row', gap: 8 },
  compCell: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  compCellHighlight: { flex: 1, alignItems: 'center', backgroundColor: Colors.primary + '10', borderRadius: 8, paddingVertical: 6 },
  compCellValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  compCellValueHighlight: { color: Colors.primary, fontSize: 14, fontWeight: '700' as const },
  compCellAsset: { color: Colors.textTertiary, fontSize: 10, marginTop: 2 },
  advantageSection: { marginBottom: 16 },
  advantageCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  advantageIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  advantageMeta: { flex: 1, gap: 4 },
  advantageTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  advantageDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  featureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  matrixHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  matrixLabelCell: { flex: 1.5, paddingVertical: 8 },
  matrixHeaderText: { color: Colors.textSecondary, fontSize: 11, flex: 1, textAlign: 'center' as const },
  matrixRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  matrixRowAlt: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surfaceLight, borderRadius: 6, paddingHorizontal: 4 },
  matrixLabel: { color: Colors.textSecondary, fontSize: 12, flex: 1.5 },
  matrixCell: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  calculatorSection: { marginBottom: 16 },
  calcTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  calcSubtitle: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500' as const },
  calcLabel: { color: Colors.textSecondary, fontSize: 13 },
  amountScroll: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  amountPill: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: Colors.surfaceBorder },
  amountPillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  amountPillText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
  amountPillTextActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  riskRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  riskPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.surfaceBorder },
  riskDot: { width: 8, height: 8, borderRadius: 4 },
  riskPillText: { color: Colors.textSecondary, fontSize: 13 },
  projectionCards: { gap: 6 },
  projCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  projCardHighlight: { backgroundColor: Colors.primary + '08', borderColor: Colors.primary + '30' },
  projLabel: { color: Colors.textSecondary, fontSize: 13 },
  projValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  projGain: { color: Colors.success, fontSize: 13, fontWeight: '600' as const, marginTop: 4 },
  yearlyBreakdown: { gap: 8, marginTop: 10 },
  yearRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  yearLabel: { color: Colors.textSecondary, fontSize: 13 },
  yearBarTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.surfaceBorder, overflow: 'hidden' as const },
  yearBarFill: { height: 6, borderRadius: 3 },
  yearValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  disclaimerBox: { padding: 16, backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.surfaceBorder, marginTop: 8 },
  disclaimerText: { color: Colors.textSecondary, fontSize: 13 },
  ctaButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  ctaText: { color: '#000000', fontSize: 13, fontWeight: '600' as const },
  bottomPadding: { height: 120 },
  scrollView: { backgroundColor: Colors.background }});
