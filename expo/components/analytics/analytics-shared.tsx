import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions, Platform } from 'react-native';
import Colors from '@/constants/colors';
import { renderSafeViewChildren } from '@/components/SafeViewChildren';
import type { TrendDelta } from '@/lib/analytics-compute';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react-native';

export const ACCENT = Colors.primary;
export const BLUE = '#4A90D9';
export const GREEN = '#00C48C';
export const TEAL = '#0097A7';
export const RED = '#E53935';
export const ORANGE = '#F57C00';
export const PURPLE = '#7B61FF';
export const YELLOW = '#F9A825';
export const NAVY = '#1B365D';
export const PINK = '#E91E63';
export const LIME = '#7CB342';
export const CHART_COLORS = [BLUE, GREEN, ORANGE, PURPLE, TEAL, RED, YELLOW, PINK, LIME, NAVY];

export const COUNTRY_FLAGS: Record<string, string> = {
  'United States': '🇺🇸', 'United Kingdom': '🇬🇧', 'Canada': '🇨🇦', 'Germany': '🇩🇪',
  'France': '🇫🇷', 'Australia': '🇦🇺', 'India': '🇮🇳', 'Brazil': '🇧🇷',
  'Japan': '🇯🇵', 'Mexico': '🇲🇽', 'Spain': '🇪🇸', 'Italy': '🇮🇹',
  'Netherlands': '🇳🇱', 'Switzerland': '🇨🇭', 'Sweden': '🇸🇪', 'Singapore': '🇸🇬',
  'UAE': '🇦🇪', 'United Arab Emirates': '🇦🇪', 'Saudi Arabia': '🇸🇦', 'China': '🇨🇳',
  'South Korea': '🇰🇷', 'Nigeria': '🇳🇬', 'South Africa': '🇿🇦', 'Colombia': '🇨🇴',
  'Argentina': '🇦🇷', 'Portugal': '🇵🇹', 'Ireland': '🇮🇪', 'Poland': '🇵🇱',
  'Turkey': '🇹🇷', 'Philippines': '🇵🇭', 'Indonesia': '🇮🇩', 'Thailand': '🇹🇭'};

export function getScreenWidth(): number {
  return Dimensions.get('window').width;
}

export function formatSeconds(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

export function AnimatedRing({ percent, size, strokeWidth, color, children }: {
  percent: number; size: number; strokeWidth: number; color: string; children?: React.ReactNode;
}) {
  const segments = 36;
  const radius = (size - strokeWidth) / 2;
  const segmentAngle = 360 / segments;
  const filled = Math.round((percent / 100) * segments);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: segments }).map((_, i) => {
        const angle = (i * segmentAngle - 90) * (Math.PI / 180);
        const x = Math.cos(angle) * radius + size / 2 - 2;
        const y = Math.sin(angle) * radius + size / 2 - 2;
        const isFilled = i < filled;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor: isFilled ? color : Colors.surfaceBorder}}
          />
        );
      })}
      <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
        {renderSafeViewChildren(children)}
      </View>
    </View>
  );
}

export function MiniSparkBar({ data, color, height = 48 }: { data: number[]; color: string; height?: number }) {
  const max = Math.max(...data, 1);
  const screenW = getScreenWidth();
  const barWidth = Math.max(Math.floor((screenW - 80) / data.length) - 2, 3);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height, gap: 2 }}>
      {data.map((val, i) => {
        const h = Math.max((val / max) * height, 2);
        const isLast = i === data.length - 1;
        return (
          <View
            key={i}
            style={{
              width: barWidth,
              height: h,
              borderRadius: 2,
              backgroundColor: isLast ? color : color + '60'}}
          />
        );
      })}
    </View>
  );
}

export function AnimatedCounter({ value, suffix = '', prefix = '' }: { value: number; suffix?: string; prefix?: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState<number>(0);

  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, { toValue: value, duration: 800, useNativeDriver: false }).start();
    const listener = anim.addListener(({ value: v }) => setDisplay(Math.round(v)));
    return () => anim.removeListener(listener);
  }, [value, anim]);

  return <Text style={shared.counterText}>{prefix}{display.toLocaleString()}{suffix}</Text>;
}

export function PulseIndicator({ active }: { active: boolean }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (active) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.6, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
    }
  }, [active, pulse]);

  return (
    <View style={shared.pulseWrap}>
      {active && (
        <Animated.View style={[shared.pulseRing, { transform: [{ scale: pulse }], borderColor: GREEN + '40' }]} />
      )}
      <View style={[shared.pulseDot, { backgroundColor: active ? GREEN : Colors.textTertiary }]} />
    </View>
  );
}

export function renderTrendBadge(trend: TrendDelta | undefined, invertColor?: boolean) {
  if (!trend || trend.direction === 'flat') return null;
  const isUp = trend.direction === 'up';
  const color = invertColor ? (isUp ? RED : GREEN) : (isUp ? GREEN : RED);
  return (
    <View style={[shared.trendBadge, { backgroundColor: color + '14' }]}>
      {isUp ? <ArrowUpRight size={10} color={color} /> : <ArrowDownRight size={10} color={color} />}
      <Text style={[shared.trendBadgeText, { color }]}>{trend.pct}%</Text>
    </View>
  );
}

export const shared = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: Colors.surfaceBorder, marginBottom: 14 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  cardSubtitle: { fontSize: 11, fontWeight: '600' as const, color: Colors.textTertiary },
  cardBadge: { backgroundColor: '#4A90D918', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  cardBadgeText: { fontSize: 10, fontWeight: '700' as const, color: '#4A90D9' },
  counterText: { fontSize: 32, fontWeight: '900' as const, color: Colors.text, letterSpacing: -1 },
  noDataText: { fontSize: 12, color: Colors.textTertiary, textAlign: 'center' as const, paddingVertical: 16, lineHeight: 18 },
  miniListRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  miniDot: { width: 8, height: 8, borderRadius: 4 },
  miniLabel: { flex: 1, fontSize: 12, fontWeight: '600' as const, color: Colors.text },
  miniValue: { fontSize: 13, fontWeight: '800' as const, color: Colors.text },
  miniPct: { fontSize: 11, fontWeight: '700' as const, width: 36, textAlign: 'right' as const },
  miniRank: { width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  miniRankText: { fontSize: 10, fontWeight: '800' as const },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '800' as const, color: Colors.text },
  emptySubtitle: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 20, paddingHorizontal: 24 },
  splitRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  splitCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder },
  pulseWrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', width: 24, height: 24, borderRadius: 12, borderWidth: 2 },
  pulseDot: { width: 10, height: 10, borderRadius: 5 },
  trendBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  trendBadgeText: { fontSize: 10, fontWeight: '700' as const },
  sparkLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  sparkLabel: { fontSize: 10, fontWeight: '600' as const, color: Colors.textTertiary },
  debugText: { fontSize: 10, color: Colors.textTertiary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }});
