import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  Users, UserCheck, Clock, Flame, Eye, TrendingUp,
  Globe, MapPin, Fingerprint, Monitor, Smartphone,
  Share2, Network} from 'lucide-react-native';
import Colors from '@/constants/colors';
import type { AcquisitionChannel } from '@/lib/analytics-compute';
import {
  BLUE, GREEN, RED, ORANGE, PURPLE, CHART_COLORS, COUNTRY_FLAGS,
  formatSeconds, shared} from './analytics-shared';

interface LeadsTabProps {
  totalLeads: number;
  registeredUsers: number;
  waitlistLeads: number;
  uniqueSessions: number;
  visitorIntent: { highIntent: number; mediumIntent: number };
  geoZones: {
    byCountry: Array<{ country: string; count: number; pct: number }>;
    byRegion: Array<{ region: string; count: number; pct: number }>;
  } | null;
  sessions: Array<{
    sessionId: string;
    ip: string;
    device: string;
    os: string;
    browser: string;
    geo?: { city?: string; country?: string; region?: string };
    currentStep: number;
    sessionDuration: number;
    lastSeen: string;
    isActive: boolean;
  }>;
  acquisition: AcquisitionChannel[];
}

export function LeadsTab({
  totalLeads, registeredUsers, waitlistLeads, uniqueSessions,
  visitorIntent, geoZones, sessions, acquisition}: LeadsTabProps) {
  const highIntent = visitorIntent.highIntent;
  const warmIntent = visitorIntent.mediumIntent;
  const browsing = Math.max(uniqueSessions - highIntent - warmIntent, 0);
  const totalSessions = Math.max(uniqueSessions, 1);

  return (
    <>
      <View style={s.leadsPipelineCard}>
        <View style={s.leadsPipelineHeader}>
          <View style={s.leadsPipelineIconWrap}>
            <Network size={24} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.leadsPipelineTitle}>Investor Leads Pipeline</Text>
            <Text style={s.leadsPipelineSub}>Real-time lead tracking & intelligence</Text>
          </View>
          <View style={s.leadsPipelineLive}>
            <View style={s.leadsPipelineLiveDot} />
            <Text style={s.leadsPipelineLiveText}>LIVE</Text>
          </View>
        </View>
        <View style={s.leadsPipelineGrid}>
          {[
            { value: totalLeads, label: 'Total Leads', color: GREEN, icon: <Users size={16} color={GREEN} /> },
            { value: registeredUsers, label: 'Registered', color: BLUE, icon: <UserCheck size={16} color={BLUE} /> },
            { value: waitlistLeads, label: 'Waitlist', color: ORANGE, icon: <Clock size={16} color={ORANGE} /> },
            { value: highIntent, label: 'Hot Leads', color: RED, icon: <Flame size={16} color={RED} /> },
          ].map((stat, i) => (
            <View key={i} style={s.leadsPipelineStat}>
              <View style={[s.leadsPipelineStatIcon, { backgroundColor: stat.color + '18' }]}>
                {stat.icon}
              </View>
              <Text style={[s.leadsPipelineStatValue, { color: stat.color }]}>{stat.value}</Text>
              <Text style={s.leadsPipelineStatLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>
        <View style={s.leadsPipelineBar}>
          {registeredUsers > 0 && <View style={[s.leadsPipelineBarSeg, { flex: registeredUsers, backgroundColor: GREEN }]} />}
          {waitlistLeads > 0 && <View style={[s.leadsPipelineBarSeg, { flex: waitlistLeads, backgroundColor: ORANGE }]} />}
          {highIntent > 0 && <View style={[s.leadsPipelineBarSeg, { flex: highIntent, backgroundColor: RED }]} />}
          {registeredUsers === 0 && waitlistLeads === 0 && highIntent === 0 && <View style={[s.leadsPipelineBarSeg, { flex: 1, backgroundColor: Colors.surfaceBorder }]} />}
        </View>
      </View>

      <View style={shared.card}>
        <View style={shared.cardHeader}>
          <Flame size={16} color={RED} />
          <Text style={shared.cardTitle}>Lead Quality Breakdown</Text>
        </View>
        {[
          { label: 'Hot Leads', desc: 'Submitted form / registered', count: highIntent, color: RED, icon: <Flame size={16} color={RED} /> },
          { label: 'Warm Leads', desc: 'Clicked CTA + deep scroll', count: warmIntent, color: ORANGE, icon: <TrendingUp size={16} color={ORANGE} /> },
          { label: 'Browsing', desc: 'Viewed but no action taken', count: browsing, color: BLUE, icon: <Eye size={16} color={BLUE} /> },
        ].map((lead, i) => {
          const pct = Math.round((lead.count / totalSessions) * 100);
          return (
            <View key={i} style={s.leadQualityRow}>
              <View style={[s.leadQualityIcon, { backgroundColor: lead.color + '12' }]}>
                {lead.icon}
              </View>
              <View style={s.leadQualityInfo}>
                <View style={s.leadQualityTop}>
                  <Text style={s.leadQualityName}>{lead.label}</Text>
                  <View style={[s.leadQualityPctBadge, { backgroundColor: lead.color + '14' }]}>
                    <Text style={[s.leadQualityPctBadgeText, { color: lead.color }]}>{pct}%</Text>
                  </View>
                </View>
                <Text style={s.leadQualityDesc}>{lead.desc}</Text>
                <View style={s.leadQualityBarBg}>
                  <View style={[s.leadQualityBarFill, { width: `${Math.max(pct, 3)}%` as any, backgroundColor: lead.color }]} />
                </View>
              </View>
              <View style={s.leadQualityCountWrap}>
                <Text style={[s.leadQualityCount, { color: lead.color }]}>{lead.count}</Text>
              </View>
            </View>
          );
        })}
      </View>

      {geoZones && geoZones.byCountry.length > 0 && (
        <View style={shared.card}>
          <View style={shared.cardHeader}>
            <Globe size={16} color={BLUE} />
            <Text style={shared.cardTitle}>Investor Geographic Data</Text>
            <Text style={shared.cardSubtitle}>{geoZones.byCountry.length} countries</Text>
          </View>
          {geoZones.byCountry.slice(0, 8).map((c, i) => {
            const flag = COUNTRY_FLAGS[c.country] || '🌍';
            const maxC = geoZones.byCountry[0]?.count || 1;
            const barW = Math.max(Math.round((c.count / maxC) * 100), 4);
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
      )}

      <View style={shared.card}>
        <View style={shared.cardHeader}>
          <Fingerprint size={16} color={PURPLE} />
          <Text style={shared.cardTitle}>Recent Visitor Sessions</Text>
          <Text style={shared.cardSubtitle}>{sessions.length} sessions</Text>
        </View>
        {sessions.length === 0 ? (
          <Text style={shared.noDataText}>No session data yet.</Text>
        ) : (
          sessions.slice(0, 25).map((sess, i) => {
            const intentColor = sess.currentStep >= 3 ? GREEN : sess.currentStep >= 2 ? ORANGE : BLUE;
            const intentLabel = sess.currentStep >= 3 ? 'HOT' : sess.currentStep >= 2 ? 'WARM' : 'BROWSING';
            const deviceIcon = sess.device === 'Mobile' ? <Smartphone size={12} color={Colors.textTertiary} /> : <Monitor size={12} color={Colors.textTertiary} />;
            return (
              <View key={sess.sessionId || i} style={s.visitorSessionRow}>
                <View style={[s.visitorSessionStatus, { backgroundColor: sess.isActive ? GREEN : Colors.textTertiary }]} />
                <View style={s.visitorSessionContent}>
                  <View style={s.visitorSessionTopRow}>
                    <View style={[s.visitorSessionBadge, { backgroundColor: intentColor + '14' }]}>
                      <Text style={[s.visitorSessionBadgeText, { color: intentColor }]}>{intentLabel}</Text>
                    </View>
                    {sess.isActive && (
                      <View style={s.visitorSessionActiveBadge}>
                        <View style={s.visitorSessionActiveDot} />
                        <Text style={s.visitorSessionActiveText}>ACTIVE</Text>
                      </View>
                    )}
                  </View>
                  <View style={s.visitorSessionDeviceRow}>
                    {deviceIcon}
                    <Text style={s.visitorSessionDevice}>{sess.device} · {sess.os} · {sess.browser}</Text>
                  </View>
                  {sess.geo?.country && (
                    <View style={s.visitorSessionGeoRow}>
                      <MapPin size={11} color={Colors.textTertiary} />
                      <Text style={s.visitorSessionGeo}>
                        {COUNTRY_FLAGS[sess.geo.country] || '🌍'} {sess.geo.city ? `${sess.geo.city}, ` : ''}{sess.geo.region ? `${sess.geo.region}, ` : ''}{sess.geo.country}
                      </Text>
                    </View>
                  )}
                  <View style={s.visitorSessionBottomRow}>
                    <Text style={s.visitorSessionDuration}>{formatSeconds(sess.sessionDuration)}</Text>
                    <Text style={s.visitorSessionTime}>{new Date(sess.lastSeen).toLocaleTimeString()}</Text>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </View>

      <View style={shared.card}>
        <View style={shared.cardHeader}>
          <Share2 size={16} color="#0097A7" />
          <Text style={shared.cardTitle}>Lead Acquisition Sources</Text>
        </View>
        {acquisition.length === 0 ? (
          <Text style={shared.noDataText}>No acquisition data yet.</Text>
        ) : (
          acquisition.map((ch, i) => {
            const maxLeads = Math.max(...acquisition.map(a => a.leads), 1);
            const barW = Math.max(Math.round((ch.leads / maxLeads) * 100), 5);
            return (
              <View key={i} style={s.leadAcqRow}>
                <View style={[s.leadAcqDot, { backgroundColor: ch.color }]} />
                <View style={s.leadAcqInfo}>
                  <View style={s.leadAcqTopRow}>
                    <Text style={s.leadAcqName}>{ch.channel}</Text>
                    <Text style={[s.leadAcqPct, { color: ch.color }]}>{ch.pct}%</Text>
                  </View>
                  <View style={s.leadAcqBarBg}>
                    <View style={[s.leadAcqBarFill, { width: `${barW}%` as any, backgroundColor: ch.color }]} />
                  </View>
                </View>
                <View style={s.leadAcqCountWrap}>
                  <Text style={s.leadAcqCount}>{ch.leads}</Text>
                  <Text style={s.leadAcqCountLabel}>leads</Text>
                </View>
              </View>
            );
          })
        )}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  leadsPipelineCard: { backgroundColor: '#0A1628', borderRadius: 22, padding: 22, marginBottom: 16, borderWidth: 1, borderColor: '#1B365D', gap: 16 },
  leadsPipelineHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  leadsPipelineIconWrap: { width: 52, height: 52, borderRadius: 16, backgroundColor: '#1B365D', alignItems: 'center', justifyContent: 'center' },
  leadsPipelineTitle: { fontSize: 18, fontWeight: '800' as const, color: '#fff', letterSpacing: -0.3 },
  leadsPipelineSub: { fontSize: 11, fontWeight: '500' as const, color: '#8BA4C4', marginTop: 2 },
  leadsPipelineLive: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#00C48C18', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  leadsPipelineLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00C48C' },
  leadsPipelineLiveText: { fontSize: 9, fontWeight: '800' as const, color: '#00C48C', letterSpacing: 0.5 },
  leadsPipelineGrid: { flexDirection: 'row', gap: 8 },
  leadsPipelineStat: { flex: 1, backgroundColor: '#1B365D40', borderRadius: 14, padding: 12, alignItems: 'center', gap: 6 },
  leadsPipelineStatIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  leadsPipelineStatValue: { fontSize: 22, fontWeight: '900' as const },
  leadsPipelineStatLabel: { fontSize: 9, fontWeight: '600' as const, color: '#8BA4C4', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  leadsPipelineBar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', gap: 2 },
  leadsPipelineBarSeg: { borderRadius: 3 },
  leadQualityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  leadQualityIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  leadQualityInfo: { flex: 1, gap: 5 },
  leadQualityTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  leadQualityName: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  leadQualityPctBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  leadQualityPctBadgeText: { fontSize: 11, fontWeight: '800' as const },
  leadQualityDesc: { fontSize: 10, fontWeight: '500' as const, color: Colors.textTertiary },
  leadQualityBarBg: { height: 6, backgroundColor: Colors.backgroundSecondary, borderRadius: 3, overflow: 'hidden' },
  leadQualityBarFill: { height: 6, borderRadius: 3 },
  leadQualityCountWrap: { alignItems: 'center', justifyContent: 'center', minWidth: 40 },
  leadQualityCount: { fontSize: 20, fontWeight: '900' as const },
  geoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  geoFlag: { fontSize: 20, width: 28, textAlign: 'center' as const },
  geoInfo: { flex: 1, gap: 4 },
  geoTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  geoName: { fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  geoPct: { fontSize: 11, fontWeight: '600' as const, color: Colors.textTertiary },
  geoBarBg: { height: 5, backgroundColor: Colors.backgroundSecondary, borderRadius: 3, overflow: 'hidden' },
  geoBarFill: { height: 5, borderRadius: 3 },
  geoCount: { width: 36, fontSize: 14, fontWeight: '800' as const, color: Colors.text, textAlign: 'right' as const },
  visitorSessionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  visitorSessionStatus: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  visitorSessionContent: { flex: 1, gap: 6 },
  visitorSessionTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  visitorSessionBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  visitorSessionBadgeText: { fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.5 },
  visitorSessionActiveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  visitorSessionActiveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#00C48C' },
  visitorSessionActiveText: { fontSize: 8, fontWeight: '700' as const, color: '#00C48C', letterSpacing: 0.5 },
  visitorSessionDeviceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  visitorSessionDevice: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary },
  visitorSessionGeoRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  visitorSessionGeo: { fontSize: 11, fontWeight: '600' as const, color: Colors.text },
  visitorSessionBottomRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  visitorSessionDuration: { fontSize: 10, fontWeight: '600' as const, color: Colors.textSecondary },
  visitorSessionTime: { fontSize: 10, fontWeight: '500' as const, color: Colors.textTertiary },
  leadAcqRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  leadAcqDot: { width: 10, height: 10, borderRadius: 5 },
  leadAcqInfo: { flex: 1, gap: 4 },
  leadAcqTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  leadAcqName: { fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  leadAcqPct: { fontSize: 12, fontWeight: '800' as const },
  leadAcqBarBg: { height: 5, backgroundColor: Colors.backgroundSecondary, borderRadius: 3, overflow: 'hidden' },
  leadAcqBarFill: { height: 5, borderRadius: 3 },
  leadAcqCountWrap: { alignItems: 'flex-end', minWidth: 42 },
  leadAcqCount: { fontSize: 16, fontWeight: '900' as const, color: Colors.text },
  leadAcqCountLabel: { fontSize: 8, fontWeight: '600' as const, color: Colors.textTertiary, textTransform: 'uppercase' as const }});
