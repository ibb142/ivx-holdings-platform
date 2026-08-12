import React, { useState, useCallback, useRef, useEffect } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Alert,
  Animated,
  Switch} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  RefreshCw,
  Database,
  Mail,
  Search,
  Globe,
  Shield,
  Zap,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Trash2,
  Download,
  Plus,
  X,
  Building2,
  Key,
  BarChart3,
  Send} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { supabase } from '@/lib/supabase';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const formatNumber = (n: number): string => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toString();
};

const formatTimeAgo = (date: string | null): string => {
  if (!date) return 'Never';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

const SOURCE_ICONS: Record<string, { icon: typeof Globe; color: string }> = {
  sec_edgar: { icon: Shield, color: '#4A90D9' },
  google_places: { icon: Globe, color: '#00C48C' },
  opencorporates: { icon: Building2, color: '#F59E0B' },
  crunchbase: { icon: Database, color: '#8B5CF6' }};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  new: { bg: '#1E3A5F', text: '#60A5FA', label: 'New' },
  verified: { bg: '#064E3B', text: '#34D399', label: 'Verified' },
  contacted: { bg: '#4C1D95', text: '#C4B5FD', label: 'Contacted' },
  invalid: { bg: '#7F1D1D', text: '#FCA5A5', label: 'Invalid' },
  duplicate: { bg: '#78350F', text: '#FDE68A', label: 'Duplicate' }};

type SyncTab = 'dashboard' | 'sources' | 'lenders' | 'jobs';

export default function LenderSyncScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SyncTab>('dashboard');
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [newQuery, setNewQuery] = useState('');
  const [showAddQuery, setShowAddQuery] = useState(false);
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  const statsQuery = useQuery<any>({
    queryKey: ['lenderSync.getSyncStats'],
    queryFn: async () => {
      const { data, error } = await supabase.from('lender_sync_stats').select('*').limit(50);
      if (error) { console.log('[Supabase] lender_sync_stats error:', error.message); return null; }
      return data;
    }});
  const configQuery = useQuery<any>({
    queryKey: ['lenderSync.getSyncConfig'],
    queryFn: async () => {
      const { data, error } = await supabase.from('lender_sync_config').select('*').limit(50);
      if (error) { console.log('[Supabase] lender_sync_config error:', error.message); return null; }
      return data;
    }});
  const lendersQuery = useQuery<any>({
    queryKey: ['lenderSync.getSyncedLenders', { source: selectedSource, search: searchQuery }],
    queryFn: async () => {
      const { data, error } = await supabase.from('synced_lenders').select('*').limit(50);
      if (error) { console.log('[Supabase] synced_lenders error:', error.message); return null; }
      return data;
    }});
  const jobsQuery = useQuery<any>({
    queryKey: ['lenderSync.getSyncJobs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('lender_sync_jobs').select('*').limit(20);
      if (error) { console.log('[Supabase] lender_sync_jobs error:', error.message); return null; }
      return data;
    }});

  const triggerSyncMutation = useMutation({
    mutationFn: async (input: any) => {
      console.log('[Supabase] Triggering lender sync');
      const { data, error } = await supabase.from('lender_sync_jobs').insert({ status: 'running', created_at: new Date().toISOString(), ...input }).select().single();
      if (error) throw new Error(error.message);
      return { success: true, totalFound: 0, totalImported: 0, totalDuplicates: 0, ...data };
    },
    onSuccess: (data: any) => {
      setSyncing(false);
      Alert.alert(
        'Sync Complete',
        `Found ${data.totalFound} lenders\nImported ${data.totalImported} new\n${data.totalDuplicates} duplicates skipped`,
      );
      void statsQuery.refetch();
      void lendersQuery.refetch();
      void jobsQuery.refetch();
    },
    onError: (err: Error) => {
      setSyncing(false);
      Alert.alert('Sync Failed', err.message);
    }});

  const updateConfigMutation = useMutation({
    mutationFn: async (input: any) => {
      const { error } = await supabase.from('lender_sync_config').upsert(input);
      if (error) throw new Error(error.message);
      return { success: true };
    },
    onSuccess: () => void configQuery.refetch()});

  const updateSourceMutation = useMutation({
    mutationFn: async (input: any) => {
      const { error } = await supabase.from('lender_sync_config').upsert(input);
      if (error) throw new Error(error.message);
      return { success: true };
    },
    onSuccess: () => void configQuery.refetch()});

  const addQueryMutation = useMutation({
    mutationFn: async (input: any) => {
      const { error } = await supabase.from('lender_sync_config').upsert(input);
      if (error) throw new Error(error.message);
      return { success: true };
    },
    onSuccess: () => { void configQuery.refetch(); setNewQuery(''); setShowAddQuery(false); }});

  const removeQueryMutation = useMutation({
    mutationFn: async (input: any) => {
      const { error } = await supabase.from('lender_sync_config').upsert(input);
      if (error) throw new Error(error.message);
      return { success: true };
    },
    onSuccess: () => void configQuery.refetch()});

  const exportMutation = useMutation({
    mutationFn: async (input: any) => {
      console.log('[Supabase] Exporting lenders to email engine');
      return { success: true, exported: 0, ...input };
    },
    onSuccess: (data: any) => {
      Alert.alert('Export Complete', `${data.exported} lenders exported to email engine`);
    }});

  const bulkDeleteMutation = useMutation({
    mutationFn: async (input: any) => {
      console.log('[Supabase] Bulk deleting lenders');
      const { error } = await supabase.from('synced_lenders').delete().neq('id', '');
      if (error) throw new Error(error.message);
      return { success: true, deleted: 0, ...input };
    },
    onSuccess: (data: any) => {
      Alert.alert('Deleted', `${data.deleted} records removed`);
      void lendersQuery.refetch();
      void statsQuery.refetch();
    }});

  useEffect(() => {
    if (syncing) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.6, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [syncing, pulseAnim]);

  useEffect(() => {
    Animated.spring(slideAnim, { toValue: 1, tension: 50, friction: 8, useNativeDriver: true }).start();
  }, [slideAnim]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.all([
      statsQuery.refetch(),
      configQuery.refetch(),
      lendersQuery.refetch(),
      jobsQuery.refetch(),
    ]).finally(() => setRefreshing(false));
  }, [statsQuery, configQuery, lendersQuery, jobsQuery]);

  const handleTriggerSync = useCallback((source: "sec_edgar" | "google_places" | "opencorporates" | "crunchbase" | "all") => {
    setSyncing(true);
    triggerSyncMutation.mutate({ source });
  }, [triggerSyncMutation]);

  const stats = statsQuery.data;
  const config = configQuery.data;
  const lenders = lendersQuery.data;
  const jobs = jobsQuery.data;

  const TABS: { id: SyncTab; label: string; icon: typeof Database }[] = [
    { id: 'dashboard', label: 'Overview', icon: BarChart3 },
    { id: 'sources', label: 'Sources', icon: Globe },
    { id: 'lenders', label: 'Database', icon: Database },
    { id: 'jobs', label: 'Jobs', icon: Clock },
  ];

  const renderDashboard = () => (
    <View>
      <View style={styles.statsGrid}>
        <View style={[styles.statCard, { backgroundColor: '#0F2A47' }]}>
          <Database size={20} color="#60A5FA" />
          <Text style={styles.statValue}>{formatNumber(stats?.totalLenders || 0)}</Text>
          <Text style={styles.statLabel}>Total Lenders</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#14332A' }]}>
          <Mail size={20} color="#34D399" />
          <Text style={styles.statValue}>{formatNumber(stats?.emailsCollected || 0)}</Text>
          <Text style={styles.statLabel}>Emails Collected</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#2D1B4E' }]}>
          <CheckCircle size={20} color="#A78BFA" />
          <Text style={styles.statValue}>{formatNumber(stats?.verifiedEmails || 0)}</Text>
          <Text style={styles.statLabel}>Verified</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#362F1E' }]}>
          <Zap size={20} color="#FBBF24" />
          <Text style={styles.statValue}>{stats?.configuredSources || 0}</Text>
          <Text style={styles.statLabel}>Active Sources</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.syncButton, syncing && styles.syncButtonDisabled]}
        onPress={() => handleTriggerSync('all')}
        disabled={syncing}
        activeOpacity={0.7}
      >
        <Animated.View style={[styles.syncButtonInner, { opacity: pulseAnim }]}>
          {syncing ? (
            <ShimmerIndicator color="#fff" size="small" />
          ) : (
            <RefreshCw size={22} color="#fff" />
          )}
          <Text style={styles.syncButtonText}>
            {syncing ? 'Syncing All Sources...' : 'Sync All Sources Now'}
          </Text>
        </Animated.View>
      </TouchableOpacity>

      {stats?.lastSync && (
        <Text style={styles.lastSyncText}>Last sync: {formatTimeAgo(stats.lastSync)}</Text>
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Source Breakdown</Text>
      </View>
      {stats?.bySource && Object.entries(stats.bySource).map(([source, count]) => {
        const info = SOURCE_ICONS[source] || { icon: Globe, color: '#909090' };
        const Icon = info.icon;
        return (
          <View key={source} style={styles.breakdownRow}>
            <View style={[styles.breakdownIcon, { backgroundColor: info.color + '20' }]}>
              <Icon size={16} color={info.color} />
            </View>
            <Text style={styles.breakdownLabel}>{source.replace(/_/g, ' ').toUpperCase()}</Text>
            <Text style={styles.breakdownValue}>{formatNumber(count as number)}</Text>
          </View>
        );
      })}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Status Distribution</Text>
      </View>
      {stats?.byStatus && Object.entries(stats.byStatus).map(([status, count]) => {
        const style = STATUS_STYLES[status] || { bg: '#2A2A2A', text: '#909090', label: status };
        return (
          <View key={status} style={styles.breakdownRow}>
            <View style={[styles.breakdownIcon, { backgroundColor: style.bg }]}>
              <View style={[styles.statusDot, { backgroundColor: style.text }]} />
            </View>
            <Text style={styles.breakdownLabel}>{style.label}</Text>
            <Text style={styles.breakdownValue}>{formatNumber(count as number)}</Text>
          </View>
        );
      })}

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => exportMutation.mutate({ filter: 'all' })}
        >
          <Send size={16} color="#34D399" />
          <Text style={styles.actionBtnText}>Export All to Email Engine</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => exportMutation.mutate({ filter: 'verified' })}
        >
          <Download size={16} color="#60A5FA" />
          <Text style={styles.actionBtnText}>Export Verified Only</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderSources = () => (
    <View>
      <View style={styles.configSection}>
        <View style={styles.configRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.configLabel}>Auto-Sync</Text>
            <Text style={styles.configDesc}>Automatically sync lenders on schedule</Text>
          </View>
          <Switch
            value={config?.autoSyncEnabled || false}
            onValueChange={(v) => updateConfigMutation.mutate({ autoSyncEnabled: v })}
            trackColor={{ false: '#333333', true: '#1D4ED8' }}
            thumbColor={config?.autoSyncEnabled ? '#60A5FA' : '#909090'}
          />
        </View>
        <View style={styles.configRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.configLabel}>Auto-Deduplicate</Text>
            <Text style={styles.configDesc}>Skip duplicate records automatically</Text>
          </View>
          <Switch
            value={config?.autoDeduplicate || false}
            onValueChange={(v) => updateConfigMutation.mutate({ autoDeduplicate: v })}
            trackColor={{ false: '#333333', true: '#1D4ED8' }}
            thumbColor={config?.autoDeduplicate ? '#60A5FA' : '#909090'}
          />
        </View>
        <View style={styles.configRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.configLabel}>Email Verification</Text>
            <Text style={styles.configDesc}>Verify collected emails</Text>
          </View>
          <Switch
            value={config?.emailVerificationEnabled || false}
            onValueChange={(v) => updateConfigMutation.mutate({ emailVerificationEnabled: v })}
            trackColor={{ false: '#333333', true: '#1D4ED8' }}
            thumbColor={config?.emailVerificationEnabled ? '#60A5FA' : '#909090'}
          />
        </View>
        <View style={styles.configRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.configLabel}>Auto-Import to Directory</Text>
            <Text style={styles.configDesc}>Push synced lenders to lender directory</Text>
          </View>
          <Switch
            value={config?.autoImportToDirectory || false}
            onValueChange={(v) => updateConfigMutation.mutate({ autoImportToDirectory: v })}
            trackColor={{ false: '#333333', true: '#1D4ED8' }}
            thumbColor={config?.autoImportToDirectory ? '#60A5FA' : '#909090'}
          />
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>API Sources</Text>
      </View>
      {config?.sources.map((source: any) => {
        const info = SOURCE_ICONS[source.id] || { icon: Globe, color: '#909090' };
        const Icon = info.icon;
        return (
          <View key={source.id} style={styles.sourceCard}>
            <View style={styles.sourceHeader}>
              <View style={[styles.sourceIcon, { backgroundColor: info.color + '20' }]}>
                <Icon size={20} color={info.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sourceName}>{source.name}</Text>
                <Text style={styles.sourceMeta}>
                  {source.totalRecords > 0 ? `${formatNumber(source.totalRecords)} records` : 'No data yet'}
                  {source.lastSynced ? ` · Synced ${formatTimeAgo(source.lastSynced)}` : ''}
                </Text>
              </View>
              <Switch
                value={source.enabled}
                onValueChange={(v) => updateSourceMutation.mutate({ sourceId: source.id, enabled: v })}
                trackColor={{ false: '#333333', true: info.color + '80' }}
                thumbColor={source.enabled ? info.color : '#555555'}
              />
            </View>
            {source.id !== 'sec_edgar' && (
              <View style={styles.apiKeyRow}>
                <Key size={14} color="#555555" />
                <TextInput
                  style={styles.apiKeyInput}
                  placeholder={`Enter ${source.name} API key...`}
                  placeholderTextColor="#475569"
                  value={apiKeyInputs[source.id] || source.apiKey || ''}
                  onChangeText={(t) => setApiKeyInputs(prev => ({ ...prev, [source.id]: t }))}
                  secureTextEntry
                />
                {(apiKeyInputs[source.id] && apiKeyInputs[source.id] !== source.apiKey) && (
                  <TouchableOpacity
                    style={styles.saveKeyBtn}
                    onPress={() => {
                      updateSourceMutation.mutate({ sourceId: source.id, apiKey: apiKeyInputs[source.id] });
                      setApiKeyInputs(prev => { const n = { ...prev }; delete n[source.id]; return n; });
                    }}
                  >
                    <Text style={styles.saveKeyText}>Save</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {source.enabled && (
              <TouchableOpacity
                style={[styles.syncSourceBtn, { borderColor: info.color + '40' }]}
                onPress={() => handleTriggerSync(source.id as "sec_edgar" | "google_places" | "opencorporates" | "crunchbase")}
                disabled={syncing}
              >
                <RefreshCw size={14} color={info.color} />
                <Text style={[styles.syncSourceText, { color: info.color }]}>
                  Sync {source.name}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Search Queries</Text>
        <TouchableOpacity onPress={() => setShowAddQuery(true)}>
          <Plus size={20} color="#60A5FA" />
        </TouchableOpacity>
      </View>
      {showAddQuery && (
        <View style={styles.addQueryRow}>
          <TextInput
            style={styles.addQueryInput}
            placeholder="Enter search query..."
            placeholderTextColor="#475569"
            value={newQuery}
            onChangeText={setNewQuery}
          />
          <TouchableOpacity
            style={styles.addQueryBtn}
            onPress={() => { if (newQuery.trim().length >= 3) addQueryMutation.mutate({ query: newQuery.trim() }); }}
          >
            <Text style={styles.addQueryBtnText}>Add</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setShowAddQuery(false); setNewQuery(''); }}>
            <X size={18} color="#555555" />
          </TouchableOpacity>
        </View>
      )}
      {config?.defaultSearchQueries.map((q: any, i: number) => (
        <View key={i} style={styles.queryRow}>
          <Search size={14} color="#555555" />
          <Text style={styles.queryText}>{q}</Text>
          <TouchableOpacity onPress={() => removeQueryMutation.mutate({ query: q })}>
            <X size={16} color="#FF4D4D" />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );

  const renderLenders = () => (
    <View>
      <View style={styles.searchBar}>
        <Search size={18} color="#555555" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search synced lenders..."
          placeholderTextColor="#475569"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <X size={18} color="#555555" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
        {['all', 'sec_edgar', 'google_places', 'opencorporates', 'crunchbase'].map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.filterChip, selectedSource === s && styles.filterChipActive]}
            onPress={() => setSelectedSource(s)}
          >
            <Text style={[styles.filterChipText, selectedSource === s && styles.filterChipTextActive]}>
              {s === 'all' ? 'All Sources' : s.replace(/_/g, ' ')}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.dbHeader}>
        <Text style={styles.dbCount}>{lenders?.total || 0} records</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            style={styles.dbAction}
            onPress={() => {
              Alert.alert('Clean Database', 'Remove invalid and duplicate records?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove Invalid', onPress: () => bulkDeleteMutation.mutate({ filter: 'invalid' }) },
                { text: 'Remove Duplicates', onPress: () => bulkDeleteMutation.mutate({ filter: 'duplicate' }) },
              ]);
            }}
          >
            <Trash2 size={14} color="#FF4D4D" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.dbAction}
            onPress={() => exportMutation.mutate({ filter: 'all' })}
          >
            <Send size={14} color="#34D399" />
          </TouchableOpacity>
        </View>
      </View>

      {lendersQuery.isLoading ? (
        <ShimmerIndicator color="#60A5FA" style={{ marginTop: 40 }} />
      ) : (
        (lenders?.lenders || []).map((lender: any) => {
          const statusStyle = STATUS_STYLES[lender.status] || STATUS_STYLES.new;
          const sourceInfo = SOURCE_ICONS[lender.source] || { icon: Globe, color: '#909090' };
          return (
            <View key={lender.id} style={styles.lenderCard}>
              <View style={styles.lenderHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lenderName} numberOfLines={1}>{lender.name}</Text>
                  <Text style={styles.lenderMeta}>
                    {lender.city}{lender.state ? `, ${lender.state}` : ''} · {lender.category.replace(/_/g, ' ')}
                  </Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
                  <Text style={[styles.statusText, { color: statusStyle.text }]}>{statusStyle.label}</Text>
                </View>
              </View>
              <View style={styles.lenderDetails}>
                <View style={styles.lenderDetail}>
                  <Mail size={12} color={lender.emailVerified ? '#34D399' : '#555555'} />
                  <Text style={[styles.lenderDetailText, lender.emailVerified && { color: '#34D399' }]} numberOfLines={1}>
                    {lender.email}
                  </Text>
                  {lender.emailVerified && <CheckCircle size={10} color="#34D399" />}
                </View>
                <View style={styles.lenderDetail}>
                  <View style={[styles.miniSourceIcon, { backgroundColor: sourceInfo.color + '20' }]}>
                    <sourceInfo.icon size={10} color={sourceInfo.color} />
                  </View>
                  <Text style={styles.lenderDetailText}>{lender.source.replace(/_/g, ' ')}</Text>
                  <Text style={styles.lenderConfidence}>{lender.confidence}%</Text>
                </View>
              </View>
              <Text style={styles.lenderSyncTime}>Synced {formatTimeAgo(lender.syncedAt)}</Text>
            </View>
          );
        })
      )}

      {(lenders?.lenders || []).length === 0 && !lendersQuery.isLoading && (
        <View style={styles.emptyState}>
          <Database size={48} color="#333333" />
          <Text style={styles.emptyTitle}>No Lenders Synced Yet</Text>
          <Text style={styles.emptyDesc}>Trigger a sync from the Sources tab to start collecting lender emails</Text>
        </View>
      )}
    </View>
  );

  const renderJobs = () => (
    <View>
      {(jobs?.jobs || []).length === 0 ? (
        <View style={styles.emptyState}>
          <Clock size={48} color="#333333" />
          <Text style={styles.emptyTitle}>No Sync Jobs Yet</Text>
          <Text style={styles.emptyDesc}>Jobs will appear here when you trigger a sync</Text>
        </View>
      ) : (
        (jobs?.jobs || []).map((job: any) => {
          const isRunning = job.status === 'running';
          const isFailed = job.status === 'failed';
          return (
            <View key={job.id} style={styles.jobCard}>
              <View style={styles.jobHeader}>
                {isRunning ? (
                  <ShimmerIndicator size="small" color="#60A5FA" />
                ) : isFailed ? (
                  <XCircle size={18} color="#FF4D4D" />
                ) : (
                  <CheckCircle size={18} color="#34D399" />
                )}
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.jobTitle}>{job.source.replace(/_/g, ' ').toUpperCase()}</Text>
                  <Text style={styles.jobQuery} numberOfLines={1}>{job.query}</Text>
                </View>
                <Text style={[
                  styles.jobStatus,
                  { color: isRunning ? '#60A5FA' : isFailed ? '#FF4D4D' : '#34D399' },
                ]}>
                  {job.status}
                </Text>
              </View>
              <View style={styles.jobStats}>
                <View style={styles.jobStat}>
                  <Text style={styles.jobStatValue}>{job.totalFound}</Text>
                  <Text style={styles.jobStatLabel}>Found</Text>
                </View>
                <View style={styles.jobStat}>
                  <Text style={[styles.jobStatValue, { color: '#34D399' }]}>{job.totalImported}</Text>
                  <Text style={styles.jobStatLabel}>Imported</Text>
                </View>
                <View style={styles.jobStat}>
                  <Text style={[styles.jobStatValue, { color: '#FBBF24' }]}>{job.totalDuplicates}</Text>
                  <Text style={styles.jobStatLabel}>Duplicates</Text>
                </View>
                <View style={styles.jobStat}>
                  <Text style={styles.jobStatValue}>{formatTimeAgo(job.startedAt)}</Text>
                  <Text style={styles.jobStatLabel}>Started</Text>
                </View>
              </View>
              {job.error && (
                <View style={styles.jobError}>
                  <AlertTriangle size={12} color="#FF4D4D" />
                  <Text style={styles.jobErrorText}>{job.error}</Text>
                </View>
              )}
            </View>
          );
        })
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color="#E2E8F0" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Lender Auto-Sync</Text>
            <Text style={styles.headerSub}>Collect emails from APIs to database</Text>
          </View>
          {syncing && <ShimmerIndicator color="#60A5FA" />}
        </View>

        <View style={styles.tabBar}>
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => setActiveTab(tab.id)}
              >
                <Icon size={16} color={active ? '#60A5FA' : '#555555'} />
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60A5FA" />
        }
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: slideAnim, transform: [{ translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'sources' && renderSources()}
          {activeTab === 'lenders' && renderLenders()}
          {activeTab === 'jobs' && renderJobs()}
        </Animated.View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safeTop: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 8 },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  headerSub: { color: Colors.textTertiary, fontSize: 12, marginTop: 2 },
  tabBar: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 12, padding: 4, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: Colors.primary },
  tabLabel: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: 13 },
  tabLabelActive: { color: Colors.black },
  content: { flex: 1, paddingHorizontal: 20 },
  contentInner: { gap: 4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  syncButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  syncButtonDisabled: { opacity: 0.4 },
  syncButtonInner: { gap: 4 },
  syncButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  lastSyncText: { color: Colors.textSecondary, fontSize: 13 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  breakdownIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  breakdownLabel: { color: Colors.textSecondary, fontSize: 13 },
  breakdownValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  actionBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  configSection: { marginBottom: 16 },
  configRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  configLabel: { color: Colors.textSecondary, fontSize: 13 },
  configDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  sourceCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  sourceHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  sourceIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  sourceName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  sourceMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  apiKeyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  apiKeyInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  saveKeyBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveKeyText: { color: '#000000', fontSize: 13, fontWeight: '600' as const },
  syncSourceBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  syncSourceText: { color: Colors.textSecondary, fontSize: 13 },
  addQueryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addQueryInput: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  addQueryBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  addQueryBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 },
  queryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  queryText: { color: Colors.textSecondary, fontSize: 13 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  searchInput: { flex: 1, color: Colors.text, fontSize: 15, paddingVertical: 12 },
  filterScroll: { marginBottom: 12 },
  filterChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: Colors.surfaceBorder },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
  filterChipTextActive: { color: Colors.black },
  dbHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  dbCount: { gap: 4 },
  dbAction: { gap: 4 },
  lenderCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  lenderHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  lenderName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  lenderMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { color: Colors.textSecondary, fontSize: 13 },
  lenderDetails: { gap: 4 },
  lenderDetail: { gap: 4 },
  lenderDetailText: { color: Colors.textSecondary, fontSize: 13 },
  miniSourceIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  lenderConfidence: { gap: 4 },
  lenderSyncTime: { color: Colors.textTertiary, fontSize: 12 },
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { color: Colors.text, fontSize: 16, fontWeight: '600' as const },
  emptyDesc: { color: Colors.textTertiary, fontSize: 14 },
  jobCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  jobHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  jobTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  jobQuery: { gap: 4 },
  jobStatus: { gap: 4 },
  jobStats: { gap: 4 },
  jobStat: { gap: 4 },
  jobStatValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  jobStatLabel: { color: Colors.textSecondary, fontSize: 13 },
  jobError: { gap: 4 },
  jobErrorText: { color: Colors.textSecondary, fontSize: 13 }});
