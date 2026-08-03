import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ArrowDownRight, PieChart } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { BLUE, GREEN, ORANGE, PURPLE, RED, shared } from './analytics-shared';

interface FunnelData {
  pageViews: number;
  scroll25: number;
  scroll50: number;
  scroll75: number;
  scroll100: number;
  formFocuses: number;
  formSubmits: number;
}

interface FunnelTabProps {
  funnel: FunnelData;
}

export function FunnelTab({ funnel }: FunnelTabProps) {
  const funnelSteps = useMemo(() => [
    { label: 'Page Views', count: funnel.pageViews, color: BLUE, pct: 100 },
    { label: 'Scroll 25%', count: funnel.scroll25, color: PURPLE, pct: funnel.pageViews > 0 ? Math.round((funnel.scroll25 / funnel.pageViews) * 100) : 0 },
    { label: 'Scroll 50%', count: funnel.scroll50, color: '#9B59B6', pct: funnel.pageViews > 0 ? Math.round((funnel.scroll50 / funnel.pageViews) * 100) : 0 },
    { label: 'Scroll 75%', count: funnel.scroll75, color: ORANGE, pct: funnel.pageViews > 0 ? Math.round((funnel.scroll75 / funnel.pageViews) * 100) : 0 },
    { label: 'Form Focus', count: funnel.formFocuses, color: GREEN, pct: funnel.pageViews > 0 ? Math.round((funnel.formFocuses / funnel.pageViews) * 100) : 0 },
    { label: 'Submitted', count: funnel.formSubmits, color: '#27AE60', pct: funnel.pageViews > 0 ? Math.round((funnel.formSubmits / funnel.pageViews) * 100) : 0 },
  ], [funnel]);

  return (
    <>
      <View style={s.funnelHero}>
        <Text style={s.funnelHeroTitle}>Conversion Funnel</Text>
        <Text style={s.funnelHeroSub}>
          {funnel.pageViews} visitors → {funnel.formSubmits} signups
        </Text>
      </View>

      <View style={s.funnelVisual}>
        {funnelSteps.map((step, i) => {
          const widthPct = Math.max(step.pct, 12);
          const isLast = i === funnelSteps.length - 1;
          const prevStep = funnelSteps[i - 1];
          const dropoff = i > 0 && prevStep ? prevStep.pct - step.pct : 0;
          return (
            <View key={i} style={s.funnelStepWrap}>
              <View style={s.funnelStepRow}>
                <View style={[s.funnelBar, { width: `${widthPct}%` as any, backgroundColor: step.color }]}>
                  <Text style={s.funnelBarText}>{step.count.toLocaleString()}</Text>
                </View>
                <Text style={s.funnelPct}>{step.pct}%</Text>
              </View>
              <View style={s.funnelLabelRow}>
                <Text style={s.funnelLabel}>{step.label}</Text>
                {i > 0 && dropoff > 0 && (
                  <View style={s.funnelDropoff}>
                    <ArrowDownRight size={9} color={RED} />
                    <Text style={s.funnelDropoffText}>-{dropoff}%</Text>
                  </View>
                )}
              </View>
              {!isLast && <View style={s.funnelConnector} />}
            </View>
          );
        })}
      </View>

      <View style={shared.card}>
        <View style={shared.cardHeader}>
          <PieChart size={16} color="#E91E63" />
          <Text style={shared.cardTitle}>Drop-off Analysis</Text>
        </View>
        {funnelSteps.slice(1).map((step, i) => {
          const prev = funnelSteps[i];
          if (!prev) return null;
          const dropCount = prev.count - step.count;
          const dropPct = prev.count > 0 ? Math.round((dropCount / prev.count) * 100) : 0;
          return (
            <View key={i} style={s.dropoffRow}>
              <View style={[s.dropoffIcon, { backgroundColor: step.color + '18' }]}>
                <ArrowDownRight size={12} color={step.color} />
              </View>
              <View style={s.dropoffInfo}>
                <Text style={s.dropoffLabel}>{prev.label} → {step.label}</Text>
                <View style={s.dropoffBarBg}>
                  <View style={[s.dropoffBarFill, { width: `${Math.max(dropPct, 3)}%` as any, backgroundColor: RED + '60' }]} />
                </View>
              </View>
              <View style={s.dropoffStats}>
                <Text style={s.dropoffValue}>-{dropCount}</Text>
                <Text style={s.dropoffPctText}>{dropPct}%</Text>
              </View>
            </View>
          );
        })}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  funnelHero: { backgroundColor: Colors.surface, borderRadius: 18, padding: 24, borderWidth: 1, borderColor: Colors.surfaceBorder, marginBottom: 16, alignItems: 'center', gap: 6 },
  funnelHeroTitle: { fontSize: 22, fontWeight: '900' as const, color: Colors.text, letterSpacing: -0.3 },
  funnelHeroSub: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  funnelVisual: { backgroundColor: Colors.surface, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: Colors.surfaceBorder, marginBottom: 14, gap: 2 },
  funnelStepWrap: { gap: 4, marginBottom: 6 },
  funnelStepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  funnelBar: { height: 36, borderRadius: 10, justifyContent: 'center', paddingHorizontal: 12, minWidth: 50 },
  funnelBarText: { fontSize: 12, fontWeight: '800' as const, color: '#FFFFFF' },
  funnelPct: { fontSize: 13, fontWeight: '800' as const, color: Colors.text, width: 40, textAlign: 'right' as const },
  funnelLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 4 },
  funnelLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary },
  funnelDropoff: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#E5393518', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  funnelDropoffText: { fontSize: 9, fontWeight: '700' as const, color: '#E53935' },
  funnelConnector: { width: 1, height: 8, backgroundColor: Colors.surfaceBorder, marginLeft: 20 },
  dropoffRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  dropoffIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dropoffInfo: { flex: 1, gap: 4 },
  dropoffLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary },
  dropoffBarBg: { height: 4, backgroundColor: Colors.backgroundSecondary, borderRadius: 2, overflow: 'hidden' },
  dropoffBarFill: { height: 4, borderRadius: 2 },
  dropoffStats: { alignItems: 'flex-end', width: 44 },
  dropoffValue: { fontSize: 13, fontWeight: '800' as const, color: '#E53935' },
  dropoffPctText: { fontSize: 9, fontWeight: '600' as const, color: Colors.textTertiary }});
