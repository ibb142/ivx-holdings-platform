import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Globe, MapPin, Map, Crosshair, Clock } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ACCENT, BLUE, GREEN, ORANGE, PURPLE, CHART_COLORS, COUNTRY_FLAGS, shared } from './analytics-shared';

interface GeoData {
  byCountry: Array<{ country: string; count: number; pct: number }>;
  byCity: Array<{ city: string; count: number; country: string; pct: number }>;
  byRegion: Array<{ region: string; count: number; pct: number }>;
  byTimezone: Array<{ timezone: string; count: number }>;
  totalWithGeo: number;
}

interface GeoTabProps {
  geo: GeoData | null;
}

const STATE_ICONS: Record<string, string> = {
  'Florida': '🌴', 'New York': '🗽', 'California': '🌉', 'Texas': '⛳',
  'Illinois': '🏙️', 'Georgia': '🍑', 'Pennsylvania': '🔔', 'Ohio': '🌰',
  'Michigan': '🚗', 'New Jersey': '🏖️', 'Virginia': '🏛️', 'Washington': '🌲',
  'Massachusetts': '📚', 'Arizona': '🌵', 'Colorado': '⛰️', 'North Carolina': '🐝',
  'Maryland': '🦀', 'Nevada': '🎰', 'Oregon': '🌿', 'Connecticut': '🏘️'};

export function GeoTab({ geo }: GeoTabProps) {
  if (!geo || (geo.byCountry.length === 0 && geo.byCity.length === 0)) {
    return (
      <View style={shared.emptyWrap}>
        <MapPin size={48} color={Colors.textTertiary} />
        <Text style={shared.emptyTitle}>No Geo Data Yet</Text>
        <Text style={shared.emptySubtitle}>Location data will appear as visitors arrive.</Text>
      </View>
    );
  }

  return (
    <>
      <View style={s.geoKpiRow}>
        {[
          { icon: <Globe size={18} color={BLUE} />, value: geo.byCountry.length, label: 'Countries', color: BLUE },
          { icon: <MapPin size={18} color={GREEN} />, value: geo.byCity.length, label: 'Cities', color: GREEN },
          { icon: <Map size={18} color={ORANGE} />, value: geo.byRegion?.length ?? 0, label: 'Regions', color: ORANGE },
          { icon: <Crosshair size={18} color={PURPLE} />, value: geo.totalWithGeo, label: 'Tracked', color: PURPLE },
        ].map((kpi, i) => (
          <View key={i} style={[s.geoKpiCard, { borderTopColor: kpi.color }]}>
            {kpi.icon}
            <Text style={s.geoKpiValue}>{kpi.value}</Text>
            <Text style={s.geoKpiLabel}>{kpi.label}</Text>
          </View>
        ))}
      </View>

      <View style={shared.card}>
        <View style={shared.cardHeader}>
          <Globe size={16} color={BLUE} />
          <Text style={shared.cardTitle}>Top Countries</Text>
        </View>
        {geo.byCountry.map((c, i) => {
          const maxC = geo.byCountry[0]?.count || 1;
          const barW = Math.max(Math.round((c.count / maxC) * 100), 4);
          const flag = COUNTRY_FLAGS[c.country] || '🌍';
          return (
            <View key={i} style={s.geoRow}>
              <Text style={s.geoFlag}>{flag}</Text>
              <View style={s.geoInfo}>
                <View style={s.geoTopRow}>
                  <Text style={s.geoName} numberOfLines={1}>{c.country}</Text>
                  <Text style={s.geoPct}>{c.pct}%</Text>
                </View>
                <View style={s.geoBarBg}>
                  <View style={[s.geoBarFill, { width: `${barW}%` as any, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
                </View>
              </View>
              <Text style={s.geoCount}>{c.count}</Text>
            </View>
          );
        })}
      </View>

      {geo.byRegion?.length > 0 && (
        <View style={s.stateCard}>
          <View style={s.stateCardHeader}>
            <View style={s.stateCardIconWrap}>
              <Map size={20} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.stateCardTitle}>Top States / Regions</Text>
              <Text style={s.stateCardSub}>{geo.byRegion.length} regions tracked</Text>
            </View>
          </View>
          {geo.byRegion.slice(0, 15).map((r, i) => {
            const maxR = geo.byRegion[0]?.count || 1;
            const barW = Math.max(Math.round((r.count / maxR) * 100), 6);
            const chartColor = CHART_COLORS[i % CHART_COLORS.length] ?? BLUE;
            const stateEmoji = STATE_ICONS[r.region] || '📍';
            const isMedal = i < 3;
            const medalColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
            return (
              <View key={i} style={[s.stateRow, i === 0 && s.stateRowFirst]}>
                <View style={[s.stateRank, { backgroundColor: isMedal ? (medalColors[i] ?? chartColor) + '20' : chartColor + '12' }]}>
                  {isMedal ? (
                    <Text style={s.stateMedal}>{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</Text>
                  ) : (
                    <Text style={[s.stateRankNum, { color: chartColor }]}>{i + 1}</Text>
                  )}
                </View>
                <Text style={s.stateEmoji}>{stateEmoji}</Text>
                <View style={s.stateInfo}>
                  <View style={s.stateTopRow}>
                    <Text style={s.stateName} numberOfLines={1}>{r.region}</Text>
                    <View style={[s.statePctBadge, { backgroundColor: chartColor + '14' }]}>
                      <Text style={[s.statePctText, { color: chartColor }]}>{r.pct}%</Text>
                    </View>
                  </View>
                  <View style={s.stateBarContainer}>
                    <View style={s.stateBarBg}>
                      <View style={[s.stateBarFill, { width: `${barW}%` as any, backgroundColor: chartColor }]} />
                    </View>
                    <Text style={s.stateBarCount}>{r.count}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={shared.card}>
        <View style={shared.cardHeader}>
          <MapPin size={16} color={GREEN} />
          <Text style={shared.cardTitle}>Top Cities</Text>
        </View>
        {geo.byCity.slice(0, 10).map((c, i) => (
          <View key={i} style={s.cityRow}>
            <View style={[s.cityRank, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '18' }]}>
              <Text style={[s.cityRankText, { color: CHART_COLORS[i % CHART_COLORS.length] }]}>{i + 1}</Text>
            </View>
            <View style={s.cityInfo}>
              <Text style={s.cityName} numberOfLines={1}>{c.city}</Text>
              <Text style={s.cityCountry}>{c.country}</Text>
            </View>
            <Text style={s.cityCount}>{c.count}</Text>
          </View>
        ))}
      </View>

      {geo.byTimezone?.length > 0 && (
        <View style={shared.card}>
          <View style={shared.cardHeader}>
            <Clock size={16} color={ACCENT} />
            <Text style={shared.cardTitle}>Timezone Distribution</Text>
          </View>
          {geo.byTimezone.slice(0, 8).map((tz, i) => (
            <View key={i} style={shared.miniListRow}>
              <View style={[shared.miniDot, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
              <Text style={shared.miniLabel} numberOfLines={1}>{tz.timezone.replace(/_/g, ' ')}</Text>
              <Text style={shared.miniValue}>{tz.count}</Text>
            </View>
          ))}
        </View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  geoKpiRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  geoKpiCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder, borderTopWidth: 3, alignItems: 'center', gap: 6 },
  geoKpiValue: { fontSize: 24, fontWeight: '900' as const, color: Colors.text },
  geoKpiLabel: { fontSize: 10, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  geoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  geoFlag: { fontSize: 20, width: 28, textAlign: 'center' as const },
  geoInfo: { flex: 1, gap: 4 },
  geoTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  geoName: { fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  geoPct: { fontSize: 11, fontWeight: '600' as const, color: Colors.textTertiary },
  geoBarBg: { height: 5, backgroundColor: Colors.backgroundSecondary, borderRadius: 3, overflow: 'hidden' },
  geoBarFill: { height: 5, borderRadius: 3 },
  geoCount: { width: 36, fontSize: 14, fontWeight: '800' as const, color: Colors.text, textAlign: 'right' as const },
  stateCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: Colors.surfaceBorder, marginBottom: 14 },
  stateCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  stateCardIconWrap: { width: 44, height: 44, borderRadius: 14, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  stateCardTitle: { fontSize: 17, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.3 },
  stateCardSub: { fontSize: 11, fontWeight: '500' as const, color: Colors.textTertiary, marginTop: 2 },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  stateRowFirst: { borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  stateRank: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stateMedal: { fontSize: 16 },
  stateRankNum: { fontSize: 12, fontWeight: '800' as const },
  stateEmoji: { fontSize: 18, width: 24, textAlign: 'center' as const },
  stateInfo: { flex: 1, gap: 6 },
  stateTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stateName: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  statePctBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statePctText: { fontSize: 11, fontWeight: '800' as const },
  stateBarContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stateBarBg: { flex: 1, height: 7, backgroundColor: Colors.backgroundSecondary, borderRadius: 4, overflow: 'hidden' },
  stateBarFill: { height: 7, borderRadius: 4 },
  stateBarCount: { fontSize: 14, fontWeight: '900' as const, color: Colors.text, minWidth: 32, textAlign: 'right' as const },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  cityRank: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cityRankText: { fontSize: 11, fontWeight: '800' as const },
  cityInfo: { flex: 1, gap: 1 },
  cityName: { fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  cityCountry: { fontSize: 10, fontWeight: '500' as const, color: Colors.textTertiary },
  cityCount: { fontSize: 14, fontWeight: '800' as const, color: Colors.text }});
