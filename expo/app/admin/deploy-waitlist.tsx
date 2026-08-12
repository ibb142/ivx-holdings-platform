import React, { useState, useCallback, useRef, useEffect } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Animated,
  Platform,
  RefreshControl} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Database,
  Rocket,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Users,
  Mail,
  Phone,
  DollarSign,
  TrendingUp,
  Copy,
  RefreshCw,
  Zap,
  Table2,
  Shield,
  Eye,
  ChevronDown,
  ChevronUp} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { safeSetString } from '@/lib/safe-clipboard';
import { executeSupabaseSqlScript, isSupabaseSqlExecMissing } from '@/lib/supabase-sql-executor';
import Colors from '@/constants/colors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type DeployStatus = 'idle' | 'checking' | 'deploying' | 'success' | 'error';

interface WaitlistEntry {
  id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  investment_range?: string;
  return_expectation?: string;
  preferred_contact_hour?: string;
  created_at?: string;
}

const WAITLIST_SQL = `-- IVX Bootstrap: Waitlist Table + Auto-Deploy Function
-- Run this ONCE in Supabase SQL Editor to enable auto-deploy

-- 1. Create exec_sql function for future auto-deploys
CREATE OR REPLACE FUNCTION ivx_exec_sql(sql_text TEXT)
RETURNS VOID AS $
BEGIN
  EXECUTE sql_text;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create waitlist table
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  investment_range TEXT,
  return_expectation TEXT,
  preferred_contact_hour TEXT,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Enable RLS
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
DO $ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow anonymous inserts on waitlist') THEN
    CREATE POLICY "Allow anonymous inserts on waitlist" ON waitlist FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated read on waitlist') THEN
    CREATE POLICY "Allow authenticated read on waitlist" ON waitlist FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated update on waitlist') THEN
    CREATE POLICY "Allow authenticated update on waitlist" ON waitlist FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $;

-- 5. Enable Realtime (ignore if already added)
DO $ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE waitlist;
EXCEPTION WHEN duplicate_object THEN NULL;
END $;

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);

-- 7. Auto-update trigger
CREATE OR REPLACE FUNCTION update_waitlist_updated_at()
RETURNS TRIGGER AS $
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS waitlist_updated_at ON waitlist;
CREATE TRIGGER waitlist_updated_at
  BEFORE UPDATE ON waitlist
  FOR EACH ROW
  EXECUTE FUNCTION update_waitlist_updated_at();`;

export default function DeployWaitlistScreen() {
  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deployStatus, setDeployStatus] = useState<DeployStatus>('idle');
  const [deployMessage, setDeployMessage] = useState('');
  const [showSql, setShowSql] = useState(false);
  const [showEntries, setShowEntries] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const successScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (deployStatus === 'deploying' || deployStatus === 'checking') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.5, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [deployStatus, pulseAnim]);

  const tableCheckQuery = useQuery({
    queryKey: ['waitlist-table-check'],
    queryFn: async () => {
      console.log('[DeployWaitlist] Checking if waitlist table exists...');
      if (!isSupabaseConfigured()) {
        return { exists: false, rowCount: 0, error: 'Supabase not configured' };
      }
      try {
        const { count, error } = await supabase
          .from('waitlist')
          .select('*', { count: 'exact', head: true });

        if (error) {
          const msg = (error.message || '').toLowerCase();
          if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('could not find')) {
            console.log('[DeployWaitlist] Table does NOT exist');
            return { exists: false, rowCount: 0, error: null };
          }
          console.log('[DeployWaitlist] Table check error:', error.message);
          return { exists: true, rowCount: 0, error: null };
        }
        console.log('[DeployWaitlist] Table exists with', count, 'rows');
        return { exists: true, rowCount: count ?? 0, error: null };
      } catch (err) {
        console.log('[DeployWaitlist] Check exception:', (err as Error)?.message);
        return { exists: false, rowCount: 0, error: (err as Error)?.message };
      }
    },
    staleTime: 5000});

  const entriesQuery = useQuery({
    queryKey: ['waitlist-entries'],
    queryFn: async () => {
      console.log('[DeployWaitlist] Fetching waitlist entries...');
      if (!isSupabaseConfigured()) return [];
      try {
        const { data, error } = await supabase
          .from('waitlist')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) {
          console.log('[DeployWaitlist] Fetch entries error:', error.message);
          return [];
        }
        console.log('[DeployWaitlist] Fetched', data?.length ?? 0, 'entries');
        return (data ?? []) as WaitlistEntry[];
      } catch (err) {
        console.log('[DeployWaitlist] Fetch exception:', (err as Error)?.message);
        return [];
      }
    },
    enabled: tableCheckQuery.data?.exists === true,
    staleTime: 10000});

  const getSupabaseProjectRef = useCallback((): string | null => {
    const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
    try {
      const hostname = new URL(url).hostname;
      const ref = hostname.split('.')[0];
      return ref || null;
    } catch {
      return null;
    }
  }, []);

  const openSupabaseSqlEditor = useCallback(async (sql: string) => {
    const ref = getSupabaseProjectRef();
    if (!ref) {
      console.log('[DeployWaitlist] Could not extract project ref from URL');
      return false;
    }
    const editorUrl = `https://supabase.com/dashboard/project/${ref}/sql/new`;
    console.log('[DeployWaitlist] Opening Supabase SQL Editor:', editorUrl);
    const copied = await safeSetString(sql);
    console.log('[DeployWaitlist] SQL copied to clipboard:', copied);
    try {
      await Linking.openURL(editorUrl);
      return true;
    } catch (e) {
      console.log('[DeployWaitlist] Failed to open URL:', e);
      return false;
    }
  }, [getSupabaseProjectRef]);

  const deployMutation = useMutation({
    mutationFn: async () => {
      console.log('[DeployWaitlist] Starting waitlist table deploy...');
      setDeployStatus('deploying');
      setDeployMessage('Checking table status...');

      if (!isSupabaseConfigured()) {
        throw new Error('Supabase is not configured. Add your Supabase URL and Anon Key.');
      }

      const { error: existsError } = await supabase
        .from('waitlist')
        .select('*', { count: 'exact', head: true });

      const tableAlreadyExists = !existsError || 
        !((existsError.message || '').toLowerCase().includes('does not exist') || 
          (existsError.message || '').toLowerCase().includes('relation'));

      if (tableAlreadyExists) {
        console.log('[DeployWaitlist] Table already exists, verifying...');
        setDeployMessage('Table exists! Verifying...');
        await new Promise(r => setTimeout(r, 500));
        return { success: true, openedEditor: false, alreadyExists: true };
      }

      setDeployMessage('Creating waitlist table...');

      try {
        await executeSupabaseSqlScript(supabase, WAITLIST_SQL, ({ current, total }) => {
          const progressLabel = `Deploying SQL step ${current}/${total}...`;
          console.log('[DeployWaitlist] Progress:', progressLabel);
          setDeployMessage(progressLabel);
        });
      } catch (error) {
        const message = (error as Error)?.message ?? 'Deploy failed';
        if (isSupabaseSqlExecMissing(message)) {
          console.log('[DeployWaitlist] ivx_exec_sql not found — opening Supabase SQL Editor');
          setDeployMessage('Opening Supabase SQL Editor...');

          const opened = await openSupabaseSqlEditor(WAITLIST_SQL);

          if (opened) {
            setDeployStatus('idle');
            setDeployMessage('SQL copied! Paste in Supabase SQL Editor and click Run. Then tap Refresh to verify.');
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(
              'First-Time Setup',
              'The SQL has been copied to your clipboard and the Supabase SQL Editor is opening. Paste it and click "Run". This creates the waitlist table AND enables auto-deploy for the future.',
              [{ text: 'Got It' }]
            );
            return { success: true, openedEditor: true };
          }

          setShowSql(true);
          throw new Error(
            'Could not open browser. Tap "Show SQL Script" below, copy the SQL, then paste and run it in your Supabase SQL Editor.'
          );
        }
        throw error;
      }

      setDeployMessage('Verifying table...');
      await new Promise(r => setTimeout(r, 1000));

      const { error: verifyError } = await supabase
        .from('waitlist')
        .select('*', { count: 'exact', head: true });

      if (verifyError) {
        const vMsg = (verifyError.message || '').toLowerCase();
        if (vMsg.includes('does not exist') || vMsg.includes('relation')) {
          throw new Error('Table creation was attempted but verification failed. Please run the SQL manually.');
        }
      }

      setDeployMessage('Logging deployment...');
      try {
        await supabase.from('landing_deployments').insert({
          deployed_at: new Date().toISOString(),
          status: 'success',
          trigger: 'manual',
          details: JSON.stringify({ action: 'deploy_waitlist_table', source: 'admin' })});
      } catch {
        console.log('[DeployWaitlist] Deploy log insert failed (non-critical)');
      }

      return { success: true, openedEditor: false };
    },
    onSuccess: (data) => {
      if (data?.openedEditor) return;
      setDeployStatus('success');
      setDeployMessage(data?.alreadyExists ? 'Waitlist table is already deployed!' : 'Waitlist table deployed successfully!');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Animated.spring(successScale, { toValue: 1, tension: 60, friction: 6, useNativeDriver: true }).start();
      void queryClient.invalidateQueries({ queryKey: ['waitlist-table-check'] });
      void queryClient.invalidateQueries({ queryKey: ['waitlist-entries'] });
      console.log('[DeployWaitlist] Deploy SUCCESS');
    },
    onError: (err: Error) => {
      setDeployStatus('error');
      setDeployMessage(err.message);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.log('[DeployWaitlist] Deploy FAILED:', err.message);
    }});

  const handleDeploy = useCallback(() => {
    if (tableCheckQuery.data?.exists) {
      Alert.alert(
        'Table Already Exists',
        'The waitlist table is already deployed in Supabase. Re-deploying will update the schema without losing data. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Re-Deploy', onPress: () => deployMutation.mutate() },
        ]
      );
    } else {
      Alert.alert(
        'Deploy Waitlist Table',
        'This will create the waitlist table in your Supabase database with RLS policies, indexes, and realtime enabled. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Deploy Now', onPress: () => deployMutation.mutate() },
        ]
      );
    }
  }, [tableCheckQuery.data?.exists, deployMutation]);

  const handleCopySql = useCallback(async () => {
    const copied = await safeSetString(WAITLIST_SQL);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (copied) {
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2000);
      Alert.alert('SQL Copied', 'Paste this in your Supabase SQL Editor and run it. This includes ivx_exec_sql function for auto-deploy.');
    } else {
      Alert.alert(
        'Copy Not Available',
        'Your browser blocked clipboard access. Please long-press the SQL text below to select and copy it manually.'
      );
    }
  }, []);

  const onRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['waitlist-table-check'] });
    void queryClient.invalidateQueries({ queryKey: ['waitlist-entries'] });
  }, [queryClient]);

  const tableExists = tableCheckQuery.data?.exists === true;
  const rowCount = tableCheckQuery.data?.rowCount ?? 0;
  const entries = entriesQuery.data ?? [];
  const isDeploying = deployStatus === 'deploying';

  const formatDate = (dateString?: string) => {
    if (!dateString) return '—';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
    } catch { return dateString; }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Database size={20} color={Colors.primary} />
          <Text style={styles.headerTitle}>Deploy Waitlist</Text>
        </View>
        <TouchableOpacity
          onPress={onRefresh}
          style={styles.refreshBtn}
          disabled={tableCheckQuery.isFetching}
        >
          <RefreshCw size={18} color={tableCheckQuery.isFetching ? Colors.textTertiary : Colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={tableCheckQuery.isFetching}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        <Animated.View style={[styles.statusCard, { opacity: isDeploying ? pulseAnim : 1 }]}>
          <View style={styles.statusTop}>
            <View style={[
              styles.statusRing,
              { borderColor: tableExists ? '#00E676' : tableCheckQuery.isLoading ? Colors.primary : '#FF5252' },
            ]}>
              {tableCheckQuery.isLoading ? (
                <ShimmerIndicator size="small" color={Colors.primary} />
              ) : tableExists ? (
                <CheckCircle size={28} color="#00E676" />
              ) : (
                <XCircle size={28} color="#FF5252" />
              )}
            </View>
            <View style={styles.statusInfo}>
              <Text style={styles.statusLabel}>Waitlist Table</Text>
              <Text style={[
                styles.statusValue,
                { color: tableExists ? '#00E676' : tableCheckQuery.isLoading ? Colors.primary : '#FF5252' },
              ]}>
                {tableCheckQuery.isLoading ? 'Checking...' : tableExists ? 'DEPLOYED' : 'NOT FOUND'}
              </Text>
              {tableExists && (
                <Text style={styles.statusMeta}>{rowCount} submissions · Realtime ON</Text>
              )}
            </View>
          </View>

          <View style={styles.statusGrid}>
            <View style={styles.statusStat}>
              <Table2 size={14} color="#42A5F5" />
              <Text style={styles.statusStatValue}>{tableExists ? 'OK' : '—'}</Text>
              <Text style={styles.statusStatLabel}>Table</Text>
            </View>
            <View style={styles.statusStat}>
              <Shield size={14} color="#AB47BC" />
              <Text style={styles.statusStatValue}>{tableExists ? 'ON' : '—'}</Text>
              <Text style={styles.statusStatLabel}>RLS</Text>
            </View>
            <View style={styles.statusStat}>
              <Users size={14} color="#FF9800" />
              <Text style={styles.statusStatValue}>{rowCount}</Text>
              <Text style={styles.statusStatLabel}>Entries</Text>
            </View>
            <View style={styles.statusStat}>
              <Zap size={14} color={tableExists ? '#00E676' : '#FF5252'} />
              <Text style={styles.statusStatValue}>{tableExists ? 'LIVE' : 'OFF'}</Text>
              <Text style={styles.statusStatLabel}>Realtime</Text>
            </View>
          </View>
        </Animated.View>

        {deployStatus === 'success' && (
          <Animated.View style={[styles.successBanner, { transform: [{ scale: successScale }] }]}>
            <CheckCircle size={18} color="#00E676" />
            <Text style={styles.successText}>{deployMessage}</Text>
          </Animated.View>
        )}

        {deployStatus === 'error' && (
          <View style={styles.errorBanner}>
            <AlertTriangle size={18} color="#FF5252" />
            <Text style={styles.errorText}>{deployMessage}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[
            styles.deployBtn,
            isDeploying && styles.deployBtnDisabled,
            tableExists && styles.deployBtnUpdate,
          ]}
          onPress={handleDeploy}
          disabled={isDeploying}
          activeOpacity={0.85}
          testID="deploy-waitlist-btn"
        >
          {isDeploying ? (
            <View style={styles.deployBtnInner}>
              <ShimmerIndicator color="#000" size="small" />
              <Text style={styles.deployBtnText}>{deployMessage}</Text>
            </View>
          ) : (
            <View style={styles.deployBtnInner}>
              <Rocket size={20} color="#000" />
              <Text style={styles.deployBtnText}>
                {tableExists ? 'Re-Deploy Waitlist Table' : 'Deploy Waitlist to Supabase'}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.sqlToggle}
          onPress={() => setShowSql(p => !p)}
          activeOpacity={0.7}
        >
          <View style={styles.sqlToggleLeft}>
            <Database size={16} color={Colors.primary} />
            <Text style={styles.sqlToggleText}>Show SQL Script</Text>
          </View>
          {showSql ? <ChevronUp size={16} color={Colors.textSecondary} /> : <ChevronDown size={16} color={Colors.textSecondary} />}
        </TouchableOpacity>

        {showSql && (
          <View style={styles.sqlBlock}>
            <TouchableOpacity style={styles.copyBtn} onPress={handleCopySql} activeOpacity={0.7}>
              <Copy size={14} color={copiedSql ? '#00E676' : Colors.primary} />
              <Text style={[styles.copyBtnText, copiedSql && { color: '#00E676' }]}>
                {copiedSql ? 'Copied!' : 'Copy SQL'}
              </Text>
            </TouchableOpacity>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text style={styles.sqlText} selectable>{WAITLIST_SQL}</Text>
            </ScrollView>
          </View>
        )}

        {tableExists && (
          <>
            <TouchableOpacity
              style={styles.entriesToggle}
              onPress={() => setShowEntries(p => !p)}
              activeOpacity={0.7}
            >
              <View style={styles.entriesToggleLeft}>
                <Eye size={16} color={Colors.info} />
                <Text style={styles.entriesToggleText}>Waitlist Entries ({rowCount})</Text>
              </View>
              {showEntries ? <ChevronUp size={16} color={Colors.textSecondary} /> : <ChevronDown size={16} color={Colors.textSecondary} />}
            </TouchableOpacity>

            {showEntries && (
              <View style={styles.entriesBlock}>
                {entriesQuery.isLoading ? (
                  <View style={styles.entriesLoading}>
                    <ShimmerIndicator size="small" color={Colors.primary} />
                    <Text style={styles.entriesLoadingText}>Loading entries...</Text>
                  </View>
                ) : entries.length === 0 ? (
                  <View style={styles.entriesEmpty}>
                    <Users size={32} color={Colors.textTertiary} />
                    <Text style={styles.entriesEmptyTitle}>No Submissions Yet</Text>
                    <Text style={styles.entriesEmptyText}>
                      Investors will appear here when they submit through the waitlist form.
                    </Text>
                  </View>
                ) : (
                  entries.map((entry, idx) => (
                    <View key={entry.id || idx} style={styles.entryCard}>
                      <View style={styles.entryHeader}>
                        <Text style={styles.entryName}>
                          {entry.first_name} {entry.last_name}
                        </Text>
                        <Text style={styles.entryDate}>{formatDate(entry.created_at)}</Text>
                      </View>
                      <View style={styles.entryRow}>
                        <Mail size={12} color={Colors.textTertiary} />
                        <Text style={styles.entryDetail}>{entry.email || '—'}</Text>
                      </View>
                      {entry.phone ? (
                        <View style={styles.entryRow}>
                          <Phone size={12} color={Colors.textTertiary} />
                          <Text style={styles.entryDetail}>{entry.phone}</Text>
                        </View>
                      ) : null}
                      <View style={styles.entryTags}>
                        {entry.investment_range ? (
                          <View style={styles.entryTag}>
                            <DollarSign size={10} color={Colors.primary} />
                            <Text style={styles.entryTagText}>{entry.investment_range}</Text>
                          </View>
                        ) : null}
                        {entry.return_expectation ? (
                          <View style={styles.entryTag}>
                            <TrendingUp size={10} color="#00E676" />
                            <Text style={styles.entryTagText}>{entry.return_expectation}</Text>
                          </View>
                        ) : null}
                        {entry.preferred_contact_hour ? (
                          <View style={styles.entryTag}>
                            <Clock size={10} color={Colors.info} />
                            <Text style={styles.entryTagText}>{entry.preferred_contact_hour}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}
          </>
        )}

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>How It Works</Text>
          <View style={styles.infoStep}>
            <View style={styles.infoStepNum}><Text style={styles.infoStepNumText}>1</Text></View>
            <Text style={styles.infoStepText}>Tap "Deploy" to create the waitlist table in Supabase</Text>
          </View>
          <View style={styles.infoStep}>
            <View style={styles.infoStepNum}><Text style={styles.infoStepNumText}>2</Text></View>
            <Text style={styles.infoStepText}>RLS policies, indexes, and realtime are auto-configured</Text>
          </View>
          <View style={styles.infoStep}>
            <View style={styles.infoStepNum}><Text style={styles.infoStepNumText}>3</Text></View>
            <Text style={styles.infoStepText}>Landing page waitlist form will save submissions directly</Text>
          </View>
          <View style={styles.infoStep}>
            <View style={styles.infoStepNum}><Text style={styles.infoStepNumText}>4</Text></View>
            <Text style={styles.infoStepText}>View and manage investor submissions here in admin</Text>
          </View>
        </View>

        <View style={styles.manualCard}>
          <AlertTriangle size={16} color={Colors.warning} />
          <View style={styles.manualContent}>
            <Text style={styles.manualTitle}>Manual Deploy Option</Text>
            <Text style={styles.manualText}>
              If auto-deploy fails, tap "Show SQL Script" above, copy it, and paste in your Supabase SQL Editor at supabase.com → SQL Editor → New Query.
            </Text>
          </View>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12},
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.card,
    justifyContent: 'center',
    alignItems: 'center'},
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text},
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border},
  content: {
    flex: 1},
  statusCard: {
    margin: 16,
    padding: 18,
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border},
  statusTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 18},
  statusRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background},
  statusInfo: {
    flex: 1,
    gap: 3},
  statusLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500' as const},
  statusValue: {
    fontSize: 16,
    fontWeight: '800' as const,
    letterSpacing: 0.5},
  statusMeta: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2},
  statusGrid: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 14},
  statusStat: {
    flex: 1,
    alignItems: 'center',
    gap: 4},
  statusStatValue: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text},
  statusStatLabel: {
    fontSize: 10,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#0D2818',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#00E67630'},
  successText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#00E676'},
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    backgroundColor: '#1A0808',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FF525240'},
  errorText: {
    flex: 1,
    fontSize: 12,
    color: '#FF8A80',
    lineHeight: 18},
  deployBtn: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: Colors.primary,
    borderRadius: 16,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center'},
  deployBtnDisabled: {
    opacity: 0.7},
  deployBtnUpdate: {
    backgroundColor: '#1A3D1A',
    borderWidth: 1.5,
    borderColor: '#00E676'},
  deployBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  deployBtnText: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: '#000'},
  sqlToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 4,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border},
  sqlToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  sqlToggleText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text},
  sqlBlock: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#0A0A0A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    maxHeight: 300},
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.primary + '15',
    marginBottom: 10},
  copyBtnText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.primary},
  sqlText: {
    fontSize: 11,
    color: '#8FBC8F',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 17},
  entriesToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border},
  entriesToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  entriesToggleText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text},
  entriesBlock: {
    marginHorizontal: 16,
    marginBottom: 12},
  entriesLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 30},
  entriesLoadingText: {
    fontSize: 13,
    color: Colors.textSecondary},
  entriesEmpty: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 6},
  entriesEmptyTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 6},
  entriesEmptyText: {
    fontSize: 12,
    color: Colors.textTertiary,
    textAlign: 'center' as const,
    paddingHorizontal: 20,
    lineHeight: 18},
  entryCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.border},
  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8},
  entryName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text},
  entryDate: {
    fontSize: 11,
    color: Colors.textTertiary},
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3},
  entryDetail: {
    fontSize: 13,
    color: Colors.textSecondary},
  entryTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8},
  entryTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.background,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8},
  entryTagText: {
    fontSize: 11,
    color: Colors.text,
    fontWeight: '500' as const},
  infoCard: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border},
  infoTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 14},
  infoStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10},
  infoStepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary + '20',
    justifyContent: 'center',
    alignItems: 'center'},
  infoStepNumText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.primary},
  infoStepText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginTop: 2},
  manualCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    backgroundColor: '#1A0E00',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FF980030'},
  manualContent: {
    flex: 1},
  manualTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#FF9800',
    marginBottom: 4},
  manualText: {
    fontSize: 12,
    color: '#B87A3D',
    lineHeight: 18}});
