import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { AlertTriangle, Database, WifiOff, RefreshCw, Shield } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { analytics } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import { GREEN, RED, BLUE, ORANGE } from './analytics-shared';

interface DiagnosticsProps {
  hasNoRealData: boolean;
  period: string;
  isConnected: boolean;
}

interface TableDiagnostic {
  table: string;
  exists: boolean;
  rowCount: number | null;
  error: string | null;
  rlsBlocked: boolean;
}

export function AnalyticsDiagnostics({ hasNoRealData, period, isConnected }: DiagnosticsProps) {
  const [tableDiags, setTableDiags] = useState<TableDiagnostic[]>([]);
  const [checking, setChecking] = useState(false);
  const [authStatus, setAuthStatus] = useState<string>('unknown');

  const runDiagnostics = useCallback(() => {
    void runTableDiagnostics();
  }, []);

  useEffect(() => {
    if (hasNoRealData) {
      runDiagnostics();
    }
  }, [hasNoRealData, runDiagnostics]);

  async function runTableDiagnostics() {
    setChecking(true);
    const tables = ['landing_analytics', 'analytics_events'];
    const results: TableDiagnostic[] = [];

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        setAuthStatus(`authenticated (${session.user.email || session.user.id.substring(0, 8)})`);
      } else {
        setAuthStatus('not authenticated — SELECT blocked by RLS');
        console.warn('[Diagnostics] No auth session. Analytics SELECT requires authenticated user.');
      }
    } catch {
      setAuthStatus('auth check failed');
    }

    for (const table of tables) {
      try {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });

        if (error) {
          const notExist = error.code === '42P01' || error.message?.includes('does not exist');
          const rlsBlock = error.code === '42501' || error.message?.includes('RLS') || error.message?.includes('permission');
          results.push({
            table,
            exists: !notExist,
            rowCount: null,
            error: error.message,
            rlsBlocked: rlsBlock});
        } else {
          const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
          const supabaseKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
          let realCount: number | null = null;

          if (count === 0 && supabaseUrl && supabaseKey) {
            try {
              const { data: { session } } = await supabase.auth.getSession();
              const token = session?.access_token || supabaseKey;
              const resp = await fetch(
                `${supabaseUrl}/rest/v1/${table}?select=id&limit=3`,
                {
                  headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'count=exact'}}
              );
              const countHeader = resp.headers.get('content-range');
              if (countHeader) {
                const match = countHeader.match(/\/(\d+|\*)/);
                if (match && match[1] && match[1] !== '*') {
                  realCount = parseInt(match[1], 10);
                }
              }
              console.log(`[Diagnostics] ${table} REST count header:`, countHeader, 'realCount:', realCount);
            } catch (restErr) {
              console.log(`[Diagnostics] ${table} REST count failed:`, (restErr as Error)?.message);
            }
          }

          const effectiveCount = realCount ?? count ?? 0;
          const rlsBlocked = count === 0 && realCount !== null && realCount > 0;

          results.push({
            table,
            exists: true,
            rowCount: effectiveCount,
            error: null,
            rlsBlocked});

          if (rlsBlocked) {
            console.error(`[Diagnostics] RLS CONFIRMED: ${table} has ${realCount} rows but Supabase client returns 0. Fix RLS SELECT policy.`);
          }
        }
      } catch (err) {
        results.push({
          table,
          exists: false,
          rowCount: null,
          error: (err as Error)?.message ?? 'Unknown',
          rlsBlocked: false});
      }
    }

    setTableDiags(results);
    setChecking(false);
  }

  if (!hasNoRealData) return null;

  const health = analytics.getSyncHealth();
  const hasRlsIssue = tableDiags.some(d => d.rlsBlocked);
  const hasTableMissing = tableDiags.some(d => !d.exists);
  const totalServerRows = tableDiags.reduce((sum, d) => sum + (d.rowCount ?? 0), 0);

  return (
    <View style={s.diagnosticCard}>
      <View style={s.diagnosticHeader}>
        <AlertTriangle size={18} color={hasRlsIssue ? RED : '#FFB800'} />
        <Text style={[s.diagnosticTitle, hasRlsIssue && { color: RED }]}>
          {hasRlsIssue ? 'RLS Policy Blocking Data' : totalServerRows > 0 ? 'Data Found — Fetching...' : 'No Analytics Data Yet'}
        </Text>
      </View>

      {hasRlsIssue && (
        <View style={[s.warningBox, { marginTop: 0, marginBottom: 10 }]}>
          <Shield size={14} color={RED} />
          <Text style={s.warningText}>
            Your Supabase tables have data but RLS is blocking reads. Ensure you are logged in and the RLS policy allows SELECT TO authenticated.
          </Text>
        </View>
      )}

      {authStatus !== 'unknown' && (
        <View style={s.diagnosticRow}>
          <Text style={s.diagnosticLabel}>Auth</Text>
          <Text style={[s.diagnosticValue, { color: authStatus.includes('not auth') ? RED : GREEN, fontSize: 11 }]}>
            {authStatus}
          </Text>
        </View>
      )}

      <Text style={s.diagnosticDesc}>
        {hasRlsIssue
          ? 'Fix: Run this SQL in Supabase SQL Editor:\nCREATE POLICY landing_analytics_auth_select ON landing_analytics FOR SELECT TO authenticated USING (true);\nCREATE POLICY analytics_events_auth_select ON analytics_events FOR SELECT TO authenticated USING (true);'
          : 'Events are tracked as visitors use your landing page and app. Data syncs automatically.'}
      </Text>

      <View style={s.diagnosticGrid}>
        <View style={s.diagnosticRow}>
          <Text style={s.diagnosticLabel}>Period</Text>
          <Text style={s.diagnosticValue}>{period}</Text>
        </View>
        <View style={s.diagnosticRow}>
          <Text style={s.diagnosticLabel}>Server</Text>
          <View style={[s.diagnosticBadge, { backgroundColor: isConnected ? GREEN + '20' : RED + '20' }]}>
            <Text style={[s.diagnosticBadgeText, { color: isConnected ? GREEN : RED }]}>
              {isConnected ? 'Connected' : 'Offline'}
            </Text>
          </View>
        </View>
        {totalServerRows > 0 && (
          <View style={s.diagnosticRow}>
            <Text style={s.diagnosticLabel}>Server Rows</Text>
            <Text style={[s.diagnosticValue, { color: GREEN }]}>{totalServerRows.toLocaleString()}</Text>
          </View>
        )}
      </View>

      {tableDiags.length > 0 && (
        <View style={s.tableGrid}>
          {tableDiags.map((diag) => (
            <View key={diag.table} style={[s.tableItem, diag.rlsBlocked && { borderColor: RED + '40' }]}>
              <View style={s.tableItemHeader}>
                {diag.rlsBlocked ? (
                  <Shield size={12} color={RED} />
                ) : !diag.exists ? (
                  <Database size={12} color={ORANGE} />
                ) : (
                  <Database size={12} color={GREEN} />
                )}
                <Text style={s.tableItemName} numberOfLines={1}>{diag.table}</Text>
              </View>
              <Text style={[s.tableItemStatus, {
                color: diag.rlsBlocked ? RED : !diag.exists ? ORANGE : GREEN}]}>
                {diag.rlsBlocked ? 'RLS BLOCKED' : !diag.exists ? 'MISSING' : diag.rowCount !== null ? `${diag.rowCount} rows` : 'OK'}
              </Text>
              {diag.error && (
                <Text style={s.tableItemError} numberOfLines={2}>{diag.error}</Text>
              )}
            </View>
          ))}
        </View>
      )}

      {health.tableMissing && !hasTableMissing && (
        <View style={s.warningBox}>
          <Database size={14} color={RED} />
          <Text style={s.warningText}>
            analytics_events table missing for event writes.
          </Text>
        </View>
      )}

      {health.failureCount > 0 && (
        <View style={s.warningBox}>
          <WifiOff size={14} color={RED} />
          <Text style={s.warningText}>
            {health.failureCount} sync failures. Last: {health.lastError ?? 'Unknown'}
          </Text>
        </View>
      )}

      <View style={s.healthGrid}>
        <View style={s.healthItem}>
          <Text style={s.healthValue}>{health.totalSynced}</Text>
          <Text style={s.healthLabel}>Synced</Text>
        </View>
        <View style={s.healthItem}>
          <Text style={s.healthValue}>{health.pendingCount}</Text>
          <Text style={s.healthLabel}>Pending</Text>
        </View>
        <View style={s.healthItem}>
          <Text style={s.healthValue}>{health.duplicateCount}</Text>
          <Text style={s.healthLabel}>Dupes</Text>
        </View>
        <View style={s.healthItem}>
          <Text style={[s.healthValue, health.failureCount > 0 && { color: RED }]}>{health.failureCount}</Text>
          <Text style={s.healthLabel}>Failures</Text>
        </View>
      </View>

      <TouchableOpacity
        style={s.rerunBtn}
        onPress={() => void runTableDiagnostics()}
        activeOpacity={0.7}
      >
        <RefreshCw size={12} color={BLUE} />
        <Text style={s.rerunBtnText}>{checking ? 'Checking...' : 'Re-run Diagnostics'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  diagnosticCard: {
    backgroundColor: '#FFB80008',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FFB80030',
    marginBottom: 16},
  diagnosticHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8},
  diagnosticTitle: { fontSize: 15, fontWeight: '700' as const, color: '#FFB800' },
  diagnosticDesc: { fontSize: 12, color: Colors.textSecondary, marginBottom: 12, lineHeight: 18 },
  diagnosticGrid: { gap: 8 },
  diagnosticRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  diagnosticLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },
  diagnosticValue: { fontSize: 13, color: Colors.text, fontWeight: '700' as const },
  diagnosticBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  diagnosticBadgeText: { fontSize: 11, fontWeight: '700' as const },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: RED + '08',
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: RED + '20'},
  warningText: { flex: 1, fontSize: 11, color: RED, lineHeight: 16 },
  healthGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12},
  healthItem: {
    flex: 1,
    backgroundColor: BLUE + '08',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    gap: 4},
  healthValue: { fontSize: 16, fontWeight: '900' as const, color: Colors.text },
  healthLabel: { fontSize: 9, fontWeight: '600' as const, color: Colors.textTertiary, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  tableGrid: { flexDirection: 'row' as const, gap: 8, marginTop: 12, marginBottom: 4 },
  tableItem: { flex: 1, backgroundColor: Colors.backgroundSecondary, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: Colors.surfaceBorder, gap: 4 },
  tableItemHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5 },
  tableItemName: { fontSize: 10, fontWeight: '600' as const, color: Colors.textSecondary, flex: 1 },
  tableItemStatus: { fontSize: 11, fontWeight: '800' as const },
  tableItemError: { fontSize: 9, color: Colors.textTertiary, lineHeight: 13 },
  rerunBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, marginTop: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: BLUE + '10', borderWidth: 1, borderColor: BLUE + '25' },
  rerunBtnText: { fontSize: 11, fontWeight: '700' as const, color: BLUE }});
