import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  Gauge, Users, UserPlus, UserCheck, Monitor, Globe,
  Share2, Search, Megaphone, Target, Link2, ExternalLink, Hash} from 'lucide-react-native';
import Colors from '@/constants/colors';
import type { AcquisitionChannel, SessionQuality } from '@/lib/analytics-compute';
import {
  BLUE, GREEN, TEAL, ORANGE, PURPLE, PINK, CHART_COLORS,
  formatSeconds, shared} from './analytics-shared';

interface SourcesTabProps {
  acquisition: AcquisitionChannel[];
  sessionQuality: SessionQuality;
  byPlatform: Array<{ platform: string; count: number }>;
  byReferrer: Array<{ referrer: string; count: number }>;
}

const SOURCE_DETAIL: Record<string, { icon: React.ReactNode; color: string; desc: string; subSources: string[] }> = {
  'Organic Search': { icon: <Search size={18} color={GREEN} />, color: GREEN, desc: 'Visitors from search engines', subSources: ['Google Search', 'Bing', 'Yahoo', 'DuckDuckGo'] },
  'Direct': { icon: <Globe size={18} color={BLUE} />, color: BLUE, desc: 'Typed URL or bookmarked', subSources: ['Direct URL', 'Bookmarks', 'Browser autofill'] },
  'Social': { icon: <Megaphone size={18} color={PINK} />, color: PINK, desc: 'Social media platforms', subSources: ['Instagram', 'Facebook', 'LinkedIn', 'Twitter/X'] },
  'Paid': { icon: <Target size={18} color={PURPLE} />, color: PURPLE, desc: 'Paid advertising campaigns', subSources: ['Google Ads', 'Meta Ads', 'LinkedIn Ads'] },
  'Referral': { icon: <Link2 size={18} color={TEAL} />, color: TEAL, desc: 'Links from other websites', subSources: ['Partner sites', 'Blog mentions', 'News articles'] },
  'Email': { icon: <ExternalLink size={18} color={ORANGE} />, color: ORANGE, desc: 'Email marketing campaigns', subSources: ['Newsletter', 'Investor updates', 'Drip campaigns'] }};

export function SourcesTab({ acquisition, sessionQuality, byPlatform, byReferrer }: SourcesTabProps) {
  const acq = acquisition ?? [];
  const sq = sessionQuality;

  return (
    <>
      {sq && (
        <View style={shared.card}>
          <View style={shared.cardHeader}>
            <Gauge size={16} color={TEAL} />
            <Text style={shared.cardTitle}>Session Quality</Text>
          </View>
          <View style={s.sqGrid}>
            <View style={s.sqItem}>
              <Text style={s.sqValue}>{sq.avgPagesPerSession}</Text>
              <Text style={s.sqLabel}>Events / Session</Text>
            </View>
            <View style={s.sqItem}>
              <Text style={s.sqValue}>{formatSeconds(sq.avgSessionDuration)}</Text>
              <Text style={s.sqLabel}>Avg Duration</Text>
            </View>
            <View style={s.sqItem}>
              <Text style={[s.sqValue, { color: GREEN }]}>{sq.engagedSessionsPct}%</Text>
              <Text style={s.sqLabel}>Engaged</Text>
            </View>
          </View>
        </View>
      )}

      {sq && (
        <View style={shared.card}>
          <View style={shared.cardHeader}>
            <Users size={16} color={PURPLE} />
            <Text style={shared.cardTitle}>New vs Returning</Text>
          </View>
          <View style={s.nvrRow}>
            <View style={s.nvrBlock}>
              <View style={[s.nvrIconWrap, { backgroundColor: BLUE + '18' }]}>
                <UserPlus size={18} color={BLUE} />
              </View>
              <Text style={s.nvrValue}>{sq.newVsReturning.new}</Text>
              <Text style={s.nvrLabel}>New</Text>
              <Text style={[s.nvrPct, { color: BLUE }]}>{sq.newVsReturning.newPct}%</Text>
            </View>
            <View style={s.nvrDivider} />
            <View style={s.nvrBlock}>
              <View style={[s.nvrIconWrap, { backgroundColor: GREEN + '18' }]}>
                <UserCheck size={18} color={GREEN} />
              </View>
              <Text style={s.nvrValue}>{sq.newVsReturning.returning}</Text>
              <Text style={s.nvrLabel}>Returning</Text>
              <Text style={[s.nvrPct, { color: GREEN }]}>{sq.newVsReturning.returningPct}%</Text>
            </View>
          </View>
          <View style={s.nvrBarWrap}>
            <View style={[s.nvrBarNew, { flex: Math.max(sq.newVsReturning.newPct, 1) }]} />
            <View style={[s.nvrBarReturn, { flex: Math.max(sq.newVsReturning.returningPct, 1) }]} />
          </View>
        </View>
      )}

      <View style={s.sourceHeroCard}>
        <View style={s.sourceHeroHeader}>
          <View style={s.sourceHeroIconWrap}>
            <Share2 size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.sourceHeroTitle}>Traffic Source Detail</Text>
            <Text style={s.sourceHeroSub}>Where your visitors are coming from</Text>
          </View>
          <View style={s.sourceHeroBadge}>
            <Text style={s.sourceHeroBadgeText}>{acq.length} sources</Text>
          </View>
        </View>
      </View>

      {acq.length === 0 ? (
        <View style={shared.card}>
          <Text style={shared.noDataText}>No traffic source data yet. Sources will appear as visitors arrive.</Text>
        </View>
      ) : (
        acq.map((ch, i) => {
          const srcDetail = SOURCE_DETAIL[ch.channel] || { icon: <Hash size={18} color={Colors.textTertiary} />, color: Colors.textTertiary, desc: 'Other traffic', subSources: [] };
          const maxSess = acq[0]?.sessions || 1;
          const barW = Math.max(Math.round((ch.sessions / maxSess) * 100), 8);
          return (
            <View key={i} style={s.srcCard}>
              <View style={s.srcCardTop}>
                <View style={[s.srcCardIcon, { backgroundColor: srcDetail.color + '14' }]}>
                  {srcDetail.icon}
                </View>
                <View style={s.srcCardTitleWrap}>
                  <Text style={s.srcCardName}>{ch.channel}</Text>
                  <Text style={s.srcCardDesc}>{srcDetail.desc}</Text>
                </View>
                <View style={[s.srcCardPctCircle, { borderColor: srcDetail.color + '40' }]}>
                  <Text style={[s.srcCardPctValue, { color: srcDetail.color }]}>{ch.pct}%</Text>
                </View>
              </View>
              <View style={{ paddingHorizontal: 2 }}>
                <View style={s.srcCardBarBg}>
                  <View style={[s.srcCardBarFill, { width: `${barW}%` as any, backgroundColor: srcDetail.color }]} />
                </View>
              </View>
              <View style={s.srcCardStats}>
                <View style={s.srcCardStatItem}>
                  <Text style={s.srcCardStatValue}>{ch.sessions}</Text>
                  <Text style={s.srcCardStatLabel}>Sessions</Text>
                </View>
                <View style={s.srcCardStatDivider} />
                <View style={s.srcCardStatItem}>
                  <Text style={s.srcCardStatValue}>{ch.leads}</Text>
                  <Text style={s.srcCardStatLabel}>Leads</Text>
                </View>
                <View style={s.srcCardStatDivider} />
                <View style={s.srcCardStatItem}>
                  <Text style={[s.srcCardStatValue, ch.conversionRate > 0 && { color: GREEN }]}>{ch.conversionRate}%</Text>
                  <Text style={s.srcCardStatLabel}>CVR</Text>
                </View>
              </View>
              {srcDetail.subSources.length > 0 && (
                <View style={s.srcCardSubRow}>
                  {srcDetail.subSources.map((sub, si) => (
                    <View key={si} style={[s.srcCardSubBadge, { backgroundColor: srcDetail.color + '0C' }]}>
                      <Text style={[s.srcCardSubText, { color: srcDetail.color }]}>{sub}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })
      )}

      <View style={shared.splitRow}>
        <View style={shared.splitCard}>
          <View style={shared.cardHeader}>
            <Monitor size={14} color={BLUE} />
            <Text style={[shared.cardTitle, { fontSize: 13 }]}>Platform</Text>
          </View>
          {byPlatform.length === 0 ? (
            <Text style={shared.noDataText}>No data</Text>
          ) : (
            byPlatform.map((p, i) => (
              <View key={i} style={shared.miniListRow}>
                <View style={[shared.miniDot, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
                <Text style={shared.miniLabel} numberOfLines={1}>{p.platform}</Text>
                <Text style={shared.miniValue}>{p.count}</Text>
              </View>
            ))
          )}
        </View>
        <View style={shared.splitCard}>
          <View style={shared.cardHeader}>
            <Globe size={14} color={TEAL} />
            <Text style={[shared.cardTitle, { fontSize: 13 }]}>Referrer</Text>
          </View>
          {byReferrer.length === 0 ? (
            <Text style={shared.noDataText}>No data</Text>
          ) : (
            byReferrer.slice(0, 5).map((r, i) => (
              <View key={i} style={shared.miniListRow}>
                <View style={[shared.miniDot, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
                <Text style={shared.miniLabel} numberOfLines={1}>{r.referrer}</Text>
                <Text style={shared.miniValue}>{r.count}</Text>
              </View>
            ))
          )}
        </View>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  sqGrid: { flexDirection: 'row', gap: 10 },
  sqItem: { flex: 1, backgroundColor: Colors.backgroundSecondary, borderRadius: 12, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  sqValue: { fontSize: 20, fontWeight: '900' as const, color: Colors.text },
  sqLabel: { fontSize: 10, fontWeight: '600' as const, color: Colors.textSecondary, textAlign: 'center' as const },
  nvrRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  nvrBlock: { flex: 1, alignItems: 'center', gap: 6 },
  nvrIconWrap: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  nvrValue: { fontSize: 26, fontWeight: '900' as const, color: Colors.text },
  nvrLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  nvrPct: { fontSize: 14, fontWeight: '800' as const },
  nvrDivider: { width: 1, backgroundColor: Colors.surfaceBorder, marginVertical: 8 },
  nvrBarWrap: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 },
  nvrBarNew: { backgroundColor: BLUE, borderRadius: 4 },
  nvrBarReturn: { backgroundColor: GREEN, borderRadius: 4 },
  sourceHeroCard: { backgroundColor: '#0A1628', borderRadius: 20, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: '#1B365D' },
  sourceHeroHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  sourceHeroIconWrap: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#1B365D', alignItems: 'center', justifyContent: 'center' },
  sourceHeroTitle: { fontSize: 18, fontWeight: '800' as const, color: '#fff', letterSpacing: -0.3 },
  sourceHeroSub: { fontSize: 11, fontWeight: '500' as const, color: '#8BA4C4', marginTop: 2 },
  sourceHeroBadge: { backgroundColor: '#4A90D920', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  sourceHeroBadgeText: { fontSize: 10, fontWeight: '700' as const, color: '#4A90D9' },
  srcCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Colors.surfaceBorder, marginBottom: 10, gap: 12 },
  srcCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  srcCardIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  srcCardTitleWrap: { flex: 1, gap: 2 },
  srcCardName: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  srcCardDesc: { fontSize: 11, fontWeight: '500' as const, color: Colors.textTertiary },
  srcCardPctCircle: { width: 52, height: 52, borderRadius: 26, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  srcCardPctValue: { fontSize: 16, fontWeight: '900' as const },
  srcCardBarBg: { height: 6, backgroundColor: Colors.backgroundSecondary, borderRadius: 3, overflow: 'hidden' },
  srcCardBarFill: { height: 6, borderRadius: 3 },
  srcCardStats: { flexDirection: 'row', gap: 0 },
  srcCardStatItem: { flex: 1, alignItems: 'center', gap: 2 },
  srcCardStatValue: { fontSize: 18, fontWeight: '900' as const, color: Colors.text },
  srcCardStatLabel: { fontSize: 10, fontWeight: '600' as const, color: Colors.textTertiary, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  srcCardStatDivider: { width: 1, backgroundColor: Colors.surfaceBorder, marginVertical: 2 },
  srcCardSubRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  srcCardSubBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  srcCardSubText: { fontSize: 10, fontWeight: '600' as const }});
