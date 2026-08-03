import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Globe, Smartphone, Monitor, Radio, Layers, RefreshCw } from 'lucide-react-native';
import Colors from '@/constants/colors';
import type { LivePresenceState } from '@/lib/realtime-presence';
import {
  BLUE, GREEN, TEAL, RED, ORANGE, PURPLE, CHART_COLORS,
  COUNTRY_FLAGS, PulseIndicator, shared} from './analytics-shared';

interface LiveTabProps {
  presenceState: LivePresenceState;
  onRefresh: () => void;
}

function formatTimeAgo(isoStr: string) {
  const diff = Math.round((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 10) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function getSourceColor(source: string) {
  return source === 'landing' ? TEAL : PURPLE;
}

export function LiveTab({ presenceState, onRefresh }: LiveTabProps) {
  const hasPresence = presenceState.isConnected;
  const totalOnline = presenceState.totalOnline;
  const landingOnline = presenceState.landingOnline;
  const appOnline = presenceState.appOnline;
  const presenceUsers = presenceState.users;
  const presenceByCountry = presenceState.byCountry;
  const presenceByDevice = presenceState.byDevice;
  const presenceByPage = presenceState.byPage;

  if (!hasPresence) {
    return (
      <View style={shared.emptyWrap}>
        <View style={s.liveEmptyIcon}>
          <Radio size={44} color={BLUE} />
        </View>
        <Text style={shared.emptyTitle}>Connecting to Presence...</Text>
        <Text style={shared.emptySubtitle}>Establishing real-time presence channel. Make sure Supabase Realtime is configured.</Text>
        <TouchableOpacity style={s.retryBtn} onPress={onRefresh}>
          <RefreshCw size={14} color="#000" />
          <Text style={s.retryBtnText}>Refresh</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (totalOnline === 0) {
    return (
      <View style={shared.emptyWrap}>
        <View style={s.liveEmptyIcon}>
          <Radio size={44} color={BLUE} />
        </View>
        <Text style={shared.emptyTitle}>No Active Sessions</Text>
        <Text style={shared.emptySubtitle}>Live visitor sessions will appear here in real-time when someone visits your landing page or app.</Text>
        <View style={[s.presenceStatusBadge, { backgroundColor: GREEN + '15', marginTop: 12 }]}>
          <View style={[s.presenceStatusDot, { backgroundColor: GREEN }]} />
          <Text style={[s.presenceStatusText, { color: GREEN }]}>Realtime Presence Active</Text>
        </View>
        <TouchableOpacity style={s.retryBtn} onPress={onRefresh}>
          <RefreshCw size={14} color="#000" />
          <Text style={s.retryBtnText}>Refresh</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <View style={s.liveHero}>
        <PulseIndicator active={totalOnline > 0} />
        <Text style={s.liveCount}>{totalOnline}</Text>
        <Text style={s.liveLabel}>Online Right Now</Text>
        <View style={s.liveSubRow}>
          <View style={s.liveSub}>
            <Globe size={12} color={TEAL} />
            <Text style={s.liveSubText}>{landingOnline} landing</Text>
          </View>
          <View style={s.liveSub}>
            <Smartphone size={12} color={PURPLE} />
            <Text style={s.liveSubText}>{appOnline} app</Text>
          </View>
        </View>
        <View style={[s.presenceStatusBadge, { backgroundColor: GREEN + '15' }]}>
          <View style={[s.presenceStatusDot, { backgroundColor: GREEN }]} />
          <Text style={[s.presenceStatusText, { color: GREEN }]}>Realtime Presence Active</Text>
        </View>
        {presenceState.lastSync ? (
          <Text style={s.presenceSyncText}>Last sync: {formatTimeAgo(presenceState.lastSync)}</Text>
        ) : null}
      </View>

      {presenceByPage.length > 0 && (
        <View style={shared.card}>
          <View style={shared.cardHeader}>
            <Layers size={16} color={BLUE} />
            <Text style={shared.cardTitle}>Active by Page</Text>
          </View>
          <View style={s.liveStepGrid}>
            {presenceByPage.slice(0, 4).map((pg, i) => (
              <View key={i} style={[s.liveStepCard, { borderTopColor: CHART_COLORS[i % CHART_COLORS.length] ?? BLUE }]}>
                <Text style={[s.liveStepCount, { color: CHART_COLORS[i % CHART_COLORS.length] ?? BLUE }]}>{pg.count}</Text>
                <Text style={s.liveStepLabel} numberOfLines={1}>{pg.page}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {presenceByCountry.length > 0 && (
        <View style={shared.card}>
          <View style={shared.cardHeader}>
            <Globe size={16} color={GREEN} />
            <Text style={shared.cardTitle}>Live by Country</Text>
          </View>
          {presenceByCountry.slice(0, 8).map((c, i) => (
            <View key={i} style={shared.miniListRow}>
              <Text style={{ fontSize: 16, width: 24, textAlign: 'center' as const }}>
                {COUNTRY_FLAGS[c.country] || '🌍'}
              </Text>
              <Text style={shared.miniLabel} numberOfLines={1}>{c.country}</Text>
              <Text style={shared.miniValue}>{c.count}</Text>
            </View>
          ))}
        </View>
      )}

      {presenceByDevice.length > 0 && (
        <View style={shared.card}>
          <View style={shared.cardHeader}>
            <Monitor size={16} color={PURPLE} />
            <Text style={shared.cardTitle}>Live by Device</Text>
          </View>
          <View style={s.liveStepGrid}>
            {presenceByDevice.map((d, i) => {
              const icon = d.device === 'Mobile' ? ORANGE : d.device === 'Tablet' ? TEAL : BLUE;
              return (
                <View key={i} style={[s.liveStepCard, { borderTopColor: icon }]}>
                  <Text style={[s.liveStepCount, { color: icon }]}>{d.count}</Text>
                  <Text style={s.liveStepLabel}>{d.device}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      <View style={shared.card}>
        <View style={shared.cardHeader}>
          <Radio size={16} color={RED} />
          <Text style={shared.cardTitle}>
            Online Users ({presenceUsers.length})
          </Text>
        </View>
        {presenceUsers.length === 0 ? (
          <Text style={shared.noDataText}>No users online right now.</Text>
        ) : (
          presenceUsers.slice(0, 30).map((user, i) => (
            <View key={user.sessionId || i} style={s.sessionRow}>
              <PulseIndicator active={true} />
              <View style={s.sessionInfo}>
                <View style={s.sessionTopRow}>
                  <View style={[s.sessionSourceBadge, { backgroundColor: getSourceColor(user.source) + '18' }]}>
                    <Text style={[s.sessionSourceText, { color: getSourceColor(user.source) }]}>
                      {user.source === 'landing' ? 'LANDING' : 'APP'}
                    </Text>
                  </View>
                  {user.page && (
                    <Text style={s.sessionIP} numberOfLines={1}>{user.page}</Text>
                  )}
                </View>
                <Text style={s.sessionDetail} numberOfLines={1}>
                  {user.device} · {user.os} · {user.browser}
                </Text>
                <View style={s.sessionMetaRow}>
                  {user.geo?.country && (
                    <Text style={s.sessionMeta}>
                      {COUNTRY_FLAGS[user.geo.country] || ''} {user.geo.city || user.geo.country}
                    </Text>
                  )}
                  <Text style={s.sessionMeta}>{formatTimeAgo(user.lastSeen)}</Text>
                </View>
              </View>
            </View>
          ))
        )}
      </View>
    </>
  );
}

const ACCENT_COLOR = Colors.primary;

const s = StyleSheet.create({
  liveEmptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#4A90D915', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: ACCENT_COLOR, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, marginTop: 8 },
  retryBtnText: { fontSize: 13, fontWeight: '700' as const, color: '#000' },
  presenceStatusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5, marginTop: 8 },
  presenceStatusDot: { width: 6, height: 6, borderRadius: 3 },
  presenceStatusText: { fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.5 },
  presenceSyncText: { fontSize: 10, fontWeight: '500' as const, color: Colors.textTertiary, marginTop: 4 },
  liveHero: { backgroundColor: Colors.surface, borderRadius: 20, padding: 28, borderWidth: 1, borderColor: Colors.surfaceBorder, marginBottom: 16, alignItems: 'center', gap: 8 },
  liveCount: { fontSize: 56, fontWeight: '900' as const, color: Colors.text, letterSpacing: -2 },
  liveLabel: { fontSize: 14, fontWeight: '700' as const, color: Colors.textSecondary },
  liveSubRow: { flexDirection: 'row', gap: 16, marginTop: 4 },
  liveSub: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveSubText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textTertiary },
  liveStepGrid: { flexDirection: 'row', gap: 8 },
  liveStepCard: { flex: 1, backgroundColor: Colors.backgroundSecondary, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.surfaceBorder, borderTopWidth: 3, alignItems: 'center', gap: 4 },
  liveStepCount: { fontSize: 22, fontWeight: '900' as const },
  liveStepLabel: { fontSize: 10, fontWeight: '600' as const, color: Colors.textSecondary },
  sessionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  sessionInfo: { flex: 1, gap: 3 },
  sessionTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sessionIP: { fontSize: 13, fontWeight: '800' as const, color: Colors.text },
  sessionSourceBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  sessionSourceText: { fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.5 },
  sessionDetail: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary },
  sessionMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  sessionMeta: { fontSize: 10, fontWeight: '500' as const, color: Colors.textTertiary }});
