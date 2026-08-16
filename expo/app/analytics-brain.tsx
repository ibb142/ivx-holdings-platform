import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  getBrainDashboard,
  analyzeMember,
  type BrainDashboard as BrainDashboardType,
  type MemberProfile,
} from '@/lib/analytics-brain-client';

const { width } = Dimensions.get('window');

const COLORS = {
  bg: '#0A0B0F',
  card: '#15171E',
  cardAlt: '#1C1F28',
  border: '#252836',
  text: '#FFFFFF',
  textSecondary: '#8B8D97',
  accent: '#6366F1',
  accentLight: '#818CF8',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  critical: '#DC2626',
};

export default function AnalyticsBrainScreen() {
  const [dashboard, setDashboard] = useState<BrainDashboardType | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'scam' | 'retention'>('overview');

  const fetchDashboard = useCallback(async () => {
    try {
      setError(null);
      const res = await getBrainDashboard();
      setDashboard(res.dashboard);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={styles.loadingText}>Loading Analytics Brain...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !dashboard) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Unable to connect</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchDashboard}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const d = dashboard;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Analytics Brain</Text>
          <Text style={styles.headerSubtitle}>Per-member behavioral intelligence</Text>
        </View>

        {/* Tab Selector */}
        <View style={styles.tabBar}>
          {(['overview', 'members', 'scam', 'retention'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeTab === 'overview' && d && (
          <View>
            {/* Key Metrics */}
            <View style={styles.metricsGrid}>
              <MetricCard label="Total Members" value={d.total_members} color={COLORS.accent} />
              <MetricCard label="Active Today" value={d.active_today} color={COLORS.success} />
              <MetricCard label="Total Events" value={d.total_events} color={COLORS.accentLight} />
              <MetricCard label="Scams Detected" value={d.brain_summary.scams_detected} color={COLORS.danger} />
            </View>

            {/* Brain Summary */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Brain Summary</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Avg Intent Score</Text>
                <Text style={styles.summaryValue}>{d.brain_summary.avg_intent}/100</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Conversion Ready</Text>
                <Text style={[styles.summaryValue, { color: COLORS.success }]}>
                  {d.brain_summary.conversion_ready}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Churn Risk</Text>
                <Text style={[styles.summaryValue, { color: d.brain_summary.churn_risk_count > 0 ? COLORS.danger : COLORS.success }]}>
                  {d.brain_summary.churn_risk_count} members
                </Text>
              </View>
            </View>

            {/* Funnel Distribution */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Funnel Distribution</Text>
              {Object.entries(d.funnel_distribution).map(([stage, count]) => (
                <View key={stage} style={styles.funnelRow}>
                  <Text style={styles.funnelStage}>{stage.replace(/_/g, ' ')}</Text>
                  <View style={styles.funnelBarBg}>
                    <View
                      style={[
                        styles.funnelBar,
                        {
                          width: `${Math.min(100, (count / Math.max(1, d.total_members)) * 100)}%`,
                          backgroundColor: getStageColor(stage),
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.funnelCount}>{count}</Text>
                </View>
              ))}
              {Object.keys(d.funnel_distribution).length === 0 && (
                <Text style={styles.emptyText}>No members yet</Text>
              )}
            </View>

            {/* High Intent Members */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>High Intent Members</Text>
              {d.high_intent_members.slice(0, 5).map((m, i) => (
                <MemberRow key={i} member={m} />
              ))}
              {d.high_intent_members.length === 0 && (
                <Text style={styles.emptyText}>No high-intent members yet</Text>
              )}
            </View>

            {/* At Risk Members */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Churn Risk Members</Text>
              {d.at_risk_members.slice(0, 5).map((m, i) => (
                <MemberRow key={i} member={m} isRisk />
              ))}
              {d.at_risk_members.length === 0 && (
                <Text style={styles.emptyText}>No at-risk members</Text>
              )}
            </View>
          </View>
        )}

        {activeTab === 'members' && d && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>All Members ({d.total_members})</Text>
            {d.high_intent_members.map((m, i) => (
              <MemberRow key={i} member={m} />
            ))}
            {d.at_risk_members.map((m, i) => (
              <MemberRow key={`risk-${i}`} member={m} isRisk />
            ))}
            {d.high_intent_members.length === 0 && d.at_risk_members.length === 0 && (
              <Text style={styles.emptyText}>No members yet. Events will appear here as members use the app.</Text>
            )}
          </View>
        )}

        {activeTab === 'scam' && d && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Scam Detection Results</Text>
            {d.scam_analyses.map((s, i) => (
              <View key={i} style={styles.scamRow}>
                <View style={styles.scamHeader}>
                  <Text style={styles.scamName}>{s.asset_name || s.asset_id}</Text>
                  <View style={[styles.scamBadge, { backgroundColor: getVerdictColor(s.brain_verdict) }]}>
                    <Text style={styles.scamBadgeText}>{s.brain_verdict}</Text>
                  </View>
                </View>
                <Text style={styles.scamType}>{s.asset_type} • Score: {s.scam_score}/100</Text>
                {s.red_flags.slice(0, 3).map((f, j) => (
                  <Text key={j} style={[styles.scamFlag, { color: getSeverityColor(f.severity) }]}>
                    ⚠ {f.flag}
                  </Text>
                ))}
              </View>
            ))}
            {d.scam_analyses.length === 0 && (
              <Text style={styles.emptyText}>No assets analyzed yet. Use the scam detection API to analyze JV deals and tokenized assets.</Text>
            )}
          </View>
        )}

        {activeTab === 'retention' && d && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Retention Cohorts</Text>
            {d.retention_cohorts.map((c, i) => (
              <View key={i} style={styles.cohortRow}>
                <View style={styles.cohortHeader}>
                  <Text style={styles.cohortDate}>{c.cohort_date}</Text>
                  <Text style={styles.cohortSize}>{c.cohort_size} members</Text>
                </View>
                <View style={styles.retentionBars}>
                  {c.retention_data.map((r, j) => (
                    <View key={j} style={styles.retentionBarWrap}>
                      <View
                        style={[styles.retentionBar, { height: Math.max(4, r.retention_pct * 0.6), backgroundColor: getRetentionColor(r.retention_pct) }]}
                      />
                      <Text style={styles.retentionPct}>{r.retention_pct}%</Text>
                      <Text style={styles.retentionPeriod}>P{r.period}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.cohortInsight}>
                  {(c.brain_insights as Record<string, unknown>)?.insight as string || 'No insights'}
                </Text>
              </View>
            ))}
            {d.retention_cohorts.length === 0 && (
              <Text style={styles.emptyText}>No retention data yet. Cohorts will appear as members use the app.</Text>
            )}
          </View>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.metricCard, { borderColor: color + '40' }]}>
      <Text style={[styles.metricValue, { color }]}>{value.toLocaleString()}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function MemberRow({ member, isRisk }: { member: MemberProfile; isRisk?: boolean }) {
  const intentColor = member.intent_score >= 60 ? COLORS.success : member.intent_score >= 30 ? COLORS.warning : COLORS.textSecondary;
  return (
    <TouchableOpacity
      style={styles.memberRow}
      onPress={async () => {
        const id = member.user_id || member.anonymous_id || '';
        if (id) {
          try {
            await analyzeMember(id, !member.user_id);
          } catch {
            // ignore
          }
        }
      }}
    >
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>{member.email || member.anonymous_id || 'Unknown'}</Text>
        <Text style={styles.memberStage}>{member.funnel_stage.replace(/_/g, ' ')}</Text>
      </View>
      <View style={styles.memberScore}>
        <Text style={[styles.memberIntent, { color: intentColor }]}>{member.intent_score}</Text>
        <Text style={styles.memberIntentLabel}>intent</Text>
      </View>
      {isRisk && <View style={[styles.riskDot, { backgroundColor: COLORS.danger }]} />}
    </TouchableOpacity>
  );
}

function getStageColor(stage: string): string {
  const colors: Record<string, string> = {
    visitor: '#6B7280',
    registered: '#3B82F6',
    engaged: '#8B5CF6',
    interested: '#F59E0B',
    ready_to_invest: '#10B981',
    invested: '#059669',
    churned: '#EF4444',
  };
  return colors[stage] || COLORS.accent;
}

function getVerdictColor(verdict: string): string {
  const colors: Record<string, string> = {
    legitimate: COLORS.success,
    suspicious: COLORS.warning,
    likely_scam: COLORS.danger,
    unverified: COLORS.textSecondary,
  };
  return colors[verdict] || COLORS.textSecondary;
}

function getSeverityColor(severity: string): string {
  const colors: Record<string, string> = {
    low: COLORS.warning,
    medium: COLORS.warning,
    high: COLORS.danger,
    critical: COLORS.critical,
  };
  return colors[severity] || COLORS.textSecondary;
}

function getRetentionColor(pct: number): string {
  if (pct >= 50) return COLORS.success;
  if (pct >= 25) return COLORS.warning;
  return COLORS.danger;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: COLORS.textSecondary,
    marginTop: 12,
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorTitle: {
    color: COLORS.danger,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryText: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },
  header: {
    marginBottom: 20,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 14,
    marginTop: 4,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: COLORS.accent,
  },
  tabText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: COLORS.text,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  metricCard: {
    width: (width - 52) / 2,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
  },
  metricValue: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 4,
  },
  metricLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 14,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  summaryLabel: {
    color: COLORS.textSecondary,
    fontSize: 14,
  },
  summaryValue: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
  funnelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  funnelStage: {
    color: COLORS.textSecondary,
    fontSize: 13,
    width: 100,
    textTransform: 'capitalize' as const,
  },
  funnelBarBg: {
    flex: 1,
    height: 8,
    backgroundColor: COLORS.cardAlt,
    borderRadius: 4,
    overflow: 'hidden' as const,
  },
  funnelBar: {
    height: '100%' as unknown as number,
    borderRadius: 4,
  },
  funnelCount: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '700',
    width: 30,
    textAlign: 'right' as const,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 8,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  memberStage: {
    color: COLORS.textSecondary,
    fontSize: 12,
    textTransform: 'capitalize' as const,
    marginTop: 2,
  },
  memberScore: {
    alignItems: 'center' as const,
  },
  memberIntent: {
    fontSize: 18,
    fontWeight: '800',
  },
  memberIntentLabel: {
    color: COLORS.textSecondary,
    fontSize: 10,
  },
  riskDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  scamRow: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  scamHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  scamName: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  scamBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  scamBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  scamType: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginBottom: 8,
  },
  scamFlag: {
    fontSize: 12,
    paddingVertical: 2,
  },
  cohortRow: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  cohortHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cohortDate: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  cohortSize: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  retentionBars: {
    flexDirection: 'row',
    alignItems: 'flex-end' as const,
    height: 70,
    gap: 6,
    marginBottom: 8,
  },
  retentionBarWrap: {
    alignItems: 'center' as const,
    flex: 1,
  },
  retentionBar: {
    width: '100%' as unknown as number,
    borderRadius: 4,
    minHeight: 4,
  },
  retentionPct: {
    color: COLORS.textSecondary,
    fontSize: 9,
    marginTop: 4,
  },
  retentionPeriod: {
    color: COLORS.textSecondary,
    fontSize: 9,
  },
  cohortInsight: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 8,
    fontStyle: 'italic' as const,
  },
  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    textAlign: 'center' as const,
    paddingVertical: 20,
  },
  errorBanner: {
    backgroundColor: COLORS.danger + '20',
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
  },
  errorBannerText: {
    color: COLORS.danger,
    fontSize: 13,
  },
});
