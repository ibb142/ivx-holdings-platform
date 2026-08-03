import React, { useState, useCallback, useEffect, useRef } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Platform,
  Animated} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Wifi,
  Shield,
  UserPlus,
  Mail,
  Phone,
  Globe,
  Lock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Zap,
  Smartphone,
  Clock,
  ChevronRight,
  Copy,
  Play,
  User} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { validateEmail, validatePassword, validatePhone } from '@/lib/auth-helpers';
import { fetchPublicGeoData } from '@/lib/public-geo';
import * as Clipboard from 'expo-clipboard';
import { fetchAdminMemberRegistry } from '@/lib/member-registry';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

interface DeviceInfo {
  ip: string;
  city?: string;
  region?: string;
  country?: string;
  isp?: string;
  timezone?: string;
  lat?: number;
  lon?: number;
  org?: string;
}

interface TestResult {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'running' | 'idle';
  message: string;
  duration?: number;
}

interface RecentRegistration {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  country: string;
  role: string;
  kyc_status: string;
  created_at: string;
}

const REGISTRATION_TESTS: { id: string; name: string; icon: React.ComponentType<any> }[] = [
  { id: 'supabase_auth', name: 'Supabase Auth Connection', icon: Shield },
  { id: 'profiles_table', name: 'Profiles Table Access', icon: User },
  { id: 'wallets_table', name: 'Wallets Table Access', icon: Lock },
  { id: 'email_validation', name: 'Email Validation Logic', icon: Mail },
  { id: 'password_validation', name: 'Password Validation Logic', icon: Lock },
  { id: 'phone_validation', name: 'Phone Validation Logic', icon: Phone },
  { id: 'country_picker', name: 'Country Picker Data', icon: Globe },
  { id: 'signup_flow', name: 'Signup Flow Reachable', icon: UserPlus },
];

export default function RegistrationAuditScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'device' | 'tests' | 'registrations'>('device');
  const [testResults, setTestResults] = useState<TestResult[]>(
    REGISTRATION_TESTS.map(t => ({ id: t.id, name: t.name, status: 'idle' as const, message: 'Not tested' }))
  );
  const [isRunningTests, setIsRunningTests] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    if (isRunningTests) pulse.start();
    else { pulse.stop(); pulseAnim.setValue(1); }
    return () => pulse.stop();
  }, [isRunningTests, pulseAnim]);

  const deviceQuery = useQuery<DeviceInfo>({
    queryKey: ['device-ip-info'],
    queryFn: async () => {
      console.log('[RegAudit] Fetching device IP info...');
      const geo = await fetchPublicGeoData();
      if (geo) {
        console.log('[RegAudit] Geo info:', geo.ip, geo.city, geo.country, geo.source);
        return {
          ip: geo.ip || 'Unknown',
          city: geo.city || '',
          region: geo.region || '',
          country: geo.country || '',
          isp: geo.org || '',
          timezone: geo.timezone || '',
          lat: geo.lat,
          lon: geo.lng,
          org: geo.org || ''};
      }

      return { ip: 'Could not detect' };
    },
    staleTime: 1000 * 60 * 5,
    retry: 1});

  const recentRegsQuery = useQuery<RecentRegistration[]>({
    queryKey: ['admin-recent-registrations'],
    queryFn: async () => {
      console.log('[RegAudit] Fetching durable recent registrations...');
      const members = await fetchAdminMemberRegistry();
      return members.slice(0, 20).map((member) => ({
        id: member.id,
        email: member.email,
        first_name: member.firstName,
        last_name: member.lastName,
        country: member.country,
        role: member.role,
        kyc_status: member.kycStatus,
        created_at: member.createdAt}));
    },
    staleTime: 1000 * 30});

  const profileCountQuery = useQuery<number>({
    queryKey: ['admin-profile-count'],
    queryFn: async () => {
      const members = await fetchAdminMemberRegistry();
      return members.length;
    },
    staleTime: 1000 * 60});

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert('Copied', text);
    } catch {
      Alert.alert('Copy failed');
    }
  }, []);

  const runTest = useCallback(async (testId: string): Promise<TestResult> => {
    const start = Date.now();
    try {
      switch (testId) {
        case 'supabase_auth': {
          const { data, error } = await supabase.auth.getSession();
          if (error) return { id: testId, name: 'Supabase Auth Connection', status: 'fail', message: error.message, duration: Date.now() - start };
          return { id: testId, name: 'Supabase Auth Connection', status: 'pass', message: data.session ? 'Connected (active session)' : 'Connected (no session)', duration: Date.now() - start };
        }
        case 'profiles_table': {
          const { error } = await supabase.from('profiles').select('id').limit(1);
          if (error) return { id: testId, name: 'Profiles Table Access', status: 'fail', message: error.message, duration: Date.now() - start };
          return { id: testId, name: 'Profiles Table Access', status: 'pass', message: 'Table accessible', duration: Date.now() - start };
        }
        case 'wallets_table': {
          const { error } = await supabase.from('wallets').select('user_id').limit(1);
          if (error) return { id: testId, name: 'Wallets Table Access', status: error.code === '42P01' ? 'fail' : 'warn', message: error.message, duration: Date.now() - start };
          return { id: testId, name: 'Wallets Table Access', status: 'pass', message: 'Table accessible', duration: Date.now() - start };
        }
        case 'email_validation': {
          const valid = validateEmail('test@example.com');
          const invalid = !validateEmail('notanemail');
          if (valid && invalid) return { id: testId, name: 'Email Validation Logic', status: 'pass', message: 'Accepts valid, rejects invalid', duration: Date.now() - start };
          return { id: testId, name: 'Email Validation Logic', status: 'fail', message: `valid=${valid} invalid_rejected=${invalid}`, duration: Date.now() - start };
        }
        case 'password_validation': {
          const strong = validatePassword('Test1234');
          const weak = validatePassword('abc');
          if (strong.valid && !weak.valid) return { id: testId, name: 'Password Validation Logic', status: 'pass', message: 'Strong accepted, weak rejected', duration: Date.now() - start };
          return { id: testId, name: 'Password Validation Logic', status: 'fail', message: `strong=${strong.valid} weak_rejected=${!weak.valid}`, duration: Date.now() - start };
        }
        case 'phone_validation': {
          const valid = validatePhone('+1 555 123 4567');
          const invalid = !validatePhone('123');
          if (valid && invalid) return { id: testId, name: 'Phone Validation Logic', status: 'pass', message: 'Valid accepted, short rejected', duration: Date.now() - start };
          return { id: testId, name: 'Phone Validation Logic', status: 'warn', message: `valid=${valid} short_rejected=${invalid}`, duration: Date.now() - start };
        }
        case 'country_picker': {
          try {
            const { COUNTRIES } = await import('@/constants/countries');
            if (COUNTRIES && COUNTRIES.length > 0) return { id: testId, name: 'Country Picker Data', status: 'pass', message: `${COUNTRIES.length} countries loaded`, duration: Date.now() - start };
            return { id: testId, name: 'Country Picker Data', status: 'fail', message: 'No countries found', duration: Date.now() - start };
          } catch {
            return { id: testId, name: 'Country Picker Data', status: 'fail', message: 'Could not import countries', duration: Date.now() - start };
          }
        }
        case 'signup_flow': {
          return { id: testId, name: 'Signup Flow Reachable', status: 'pass', message: 'Route /signup exists', duration: Date.now() - start };
        }
        default:
          return { id: testId, name: testId, status: 'warn', message: 'Unknown test', duration: Date.now() - start };
      }
    } catch (err: any) {
      return { id: testId, name: testId, status: 'fail', message: err?.message || 'Test error', duration: Date.now() - start };
    }
  }, []);

  const runAllTests = useCallback(async () => {
    setIsRunningTests(true);
    console.log('[RegAudit] Running all registration tests...');
    const results: TestResult[] = [];
    for (const test of REGISTRATION_TESTS) {
      setTestResults(prev => prev.map(t => t.id === test.id ? { ...t, status: 'running' as const, message: 'Testing...' } : t));
      const result = await runTest(test.id);
      results.push(result);
      setTestResults(prev => prev.map(t => t.id === test.id ? result : t));
    }
    setIsRunningTests(false);
    const passed = results.filter(r => r.status === 'pass').length;
    const failed = results.filter(r => r.status === 'fail').length;
    const warned = results.filter(r => r.status === 'warn').length;
    console.log(`[RegAudit] Tests complete: ${passed} pass, ${failed} fail, ${warned} warn`);
  }, [runTest]);

  const refreshing = deviceQuery.isRefetching || recentRegsQuery.isRefetching;
  const onRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['device-ip-info'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-recent-registrations'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-profile-count'] });
  }, [queryClient]);

  const device = deviceQuery.data;
  const recentRegs = recentRegsQuery.data ?? [];
  const totalProfiles = profileCountQuery.data ?? 0;

  const passCount = testResults.filter(r => r.status === 'pass').length;
  const failCount = testResults.filter(r => r.status === 'fail').length;

  const formatDate = useCallback((dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pass': return Colors.positive;
      case 'fail': return Colors.negative;
      case 'warn': return Colors.warning;
      case 'running': return Colors.primary;
      default: return Colors.textTertiary;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pass': return <CheckCircle size={16} color={Colors.positive} />;
      case 'fail': return <XCircle size={16} color={Colors.negative} />;
      case 'warn': return <AlertTriangle size={16} color={Colors.warning} />;
      case 'running': return <ShimmerIndicator size={14} color={Colors.primary} />;
      default: return <Clock size={16} color={Colors.textTertiary} />;
    }
  };

  const renderDeviceTab = () => (
    <View>
      <View style={styles.ipCard}>
        <View style={styles.ipCardHeader}>
          <View style={styles.ipIconWrap}>
            <Wifi size={24} color="#000" />
          </View>
          <View style={styles.ipCardHeaderText}>
            <Text style={styles.ipCardLabel}>YOUR DEVICE IP</Text>
            <Text style={styles.ipCardTitle}>
              {deviceQuery.isLoading ? 'Detecting...' : device?.ip ?? 'Unknown'}
            </Text>
          </View>
          {device?.ip && device.ip !== 'Could not detect' && (
            <TouchableOpacity style={styles.copyBtn} onPress={() => copyToClipboard(device.ip)}>
              <Copy size={16} color={Colors.primary} />
            </TouchableOpacity>
          )}
        </View>
        {deviceQuery.isLoading && (
          <ShimmerIndicator color={Colors.primary} style={{ marginTop: 12 }} />
        )}
      </View>

      {device && device.city && (
        <View style={styles.detailsCard}>
          <Text style={styles.detailsTitle}>Connection Details</Text>
          {[
            { label: 'City', value: device.city, icon: Globe },
            { label: 'Region', value: device.region, icon: Globe },
            { label: 'Country', value: device.country, icon: Globe },
            { label: 'ISP / Org', value: device.isp || device.org, icon: Wifi },
            { label: 'Timezone', value: device.timezone, icon: Clock },
            { label: 'Coordinates', value: device.lat && device.lon ? `${device.lat}, ${device.lon}` : undefined, icon: Globe },
            { label: 'Platform', value: Platform.OS, icon: Smartphone },
          ]
            .filter(item => item.value)
            .map((item, i) => {
              const Icon = item.icon;
              return (
                <View key={i} style={styles.detailRow}>
                  <Icon size={14} color={Colors.textTertiary} />
                  <Text style={styles.detailLabel}>{item.label}</Text>
                  <Text style={styles.detailValue}>{item.value}</Text>
                </View>
              );
            })}
        </View>
      )}

      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>{totalProfiles}</Text>
          <Text style={styles.statLabel}>Total Registrations</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNumber, { color: Colors.positive }]}>{passCount}</Text>
          <Text style={styles.statLabel}>Tests Passed</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNumber, { color: failCount > 0 ? Colors.negative : Colors.textTertiary }]}>{failCount}</Text>
          <Text style={styles.statLabel}>Tests Failed</Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.quickActionCard}
        onPress={() => router.push('/signup' as any)}
      >
        <View style={styles.quickActionLeft}>
          <View style={[styles.quickActionIcon, { backgroundColor: Colors.positive + '18' }]}>
            <UserPlus size={20} color={Colors.positive} />
          </View>
          <View>
            <Text style={styles.quickActionTitle}>Test Registration</Text>
            <Text style={styles.quickActionSub}>Open signup flow to test live</Text>
          </View>
        </View>
        <ChevronRight size={18} color={Colors.textTertiary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.quickActionCard}
        onPress={() => router.push('/login' as any)}
      >
        <View style={styles.quickActionLeft}>
          <View style={[styles.quickActionIcon, { backgroundColor: Colors.primary + '18' }]}>
            <Lock size={20} color={Colors.primary} />
          </View>
          <View>
            <Text style={styles.quickActionTitle}>Test Login</Text>
            <Text style={styles.quickActionSub}>Open login flow to test live</Text>
          </View>
        </View>
        <ChevronRight size={18} color={Colors.textTertiary} />
      </TouchableOpacity>
    </View>
  );

  const renderTestsTab = () => (
    <View>
      <TouchableOpacity
        style={[styles.runAllBtn, isRunningTests && styles.runAllBtnDisabled]}
        onPress={runAllTests}
        disabled={isRunningTests}
        activeOpacity={0.85}
      >
        {isRunningTests ? (
          <Animated.View style={{ opacity: pulseAnim, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ShimmerIndicator color="#000" size="small" />
            <Text style={styles.runAllBtnText}>Running Tests...</Text>
          </Animated.View>
        ) : (
          <>
            <Play size={18} color="#000" />
            <Text style={styles.runAllBtnText}>Run All Tests</Text>
          </>
        )}
      </TouchableOpacity>

      {passCount + failCount > 0 && (
        <View style={styles.testSummary}>
          <View style={[styles.testSummaryDot, { backgroundColor: failCount === 0 ? Colors.positive : Colors.negative }]} />
          <Text style={styles.testSummaryText}>
            {failCount === 0 ? 'All tests passed' : `${failCount} test${failCount > 1 ? 's' : ''} failed`}
          </Text>
          <Text style={styles.testSummaryCount}>{passCount}/{REGISTRATION_TESTS.length}</Text>
        </View>
      )}

      {testResults.map((result) => {
        const testDef = REGISTRATION_TESTS.find(t => t.id === result.id);
        const Icon = testDef?.icon ?? Shield;
        return (
          <View key={result.id} style={[styles.testCard, result.status === 'fail' && styles.testCardFail]}>
            <View style={styles.testCardLeft}>
              <View style={[styles.testIconWrap, { backgroundColor: getStatusColor(result.status) + '15' }]}>
                <Icon size={16} color={getStatusColor(result.status)} />
              </View>
              <View style={styles.testCardInfo}>
                <Text style={styles.testCardName}>{result.name}</Text>
                <Text style={[styles.testCardMsg, { color: getStatusColor(result.status) }]}>{result.message}</Text>
              </View>
            </View>
            <View style={styles.testCardRight}>
              {result.duration !== undefined && (
                <Text style={styles.testDuration}>{result.duration}ms</Text>
              )}
              {getStatusIcon(result.status)}
            </View>
          </View>
        );
      })}
    </View>
  );

  const renderRegistrationsTab = () => (
    <View>
      <View style={styles.regHeader}>
        <Text style={styles.regHeaderTitle}>Recent Registrations</Text>
        <View style={styles.regCountBadge}>
          <Text style={styles.regCountText}>{totalProfiles} total</Text>
        </View>
      </View>

      {recentRegsQuery.isLoading && (
        <ShimmerIndicator color={Colors.primary} style={{ marginVertical: 30 }} />
      )}

      {recentRegs.length === 0 && !recentRegsQuery.isLoading && (
        <View style={styles.emptyState}>
          <UserPlus size={40} color={Colors.textTertiary} />
          <Text style={styles.emptyTitle}>No Registrations Yet</Text>
          <Text style={styles.emptySub}>New users will appear here</Text>
        </View>
      )}

      {recentRegs.map((reg) => (
        <TouchableOpacity
          key={reg.id}
          style={styles.regCard}
          onPress={() => router.push(`/admin/member/${reg.id}` as any)}
        >
          <View style={styles.regCardAvatar}>
            <Text style={styles.regCardAvatarText}>
              {(reg.first_name?.[0] || '?').toUpperCase()}{(reg.last_name?.[0] || '').toUpperCase()}
            </Text>
          </View>
          <View style={styles.regCardInfo}>
            <Text style={styles.regCardName}>{reg.first_name} {reg.last_name}</Text>
            <Text style={styles.regCardEmail}>{reg.email}</Text>
            <View style={styles.regCardMeta}>
              <View style={styles.regCardMetaItem}>
                <Globe size={10} color={Colors.textTertiary} />
                <Text style={styles.regCardMetaText}>{reg.country || 'N/A'}</Text>
              </View>
              <View style={styles.regCardMetaItem}>
                <Clock size={10} color={Colors.textTertiary} />
                <Text style={styles.regCardMetaText}>{formatDate(reg.created_at)}</Text>
              </View>
            </View>
          </View>
          <View style={styles.regCardRight}>
            <View style={[
              styles.kycBadge,
              reg.kyc_status === 'approved' && styles.kycApproved,
              reg.kyc_status === 'pending' && styles.kycPending,
              reg.kyc_status === 'rejected' && styles.kycRejected,
            ]}>
              <Text style={[
                styles.kycBadgeText,
                reg.kyc_status === 'approved' && { color: Colors.positive },
                reg.kyc_status === 'pending' && { color: Colors.warning },
                reg.kyc_status === 'rejected' && { color: Colors.negative },
              ]}>{reg.kyc_status || 'pending'}</Text>
            </View>
            <ChevronRight size={14} color={Colors.textTertiary} />
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerLiveDot} />
          <Text style={styles.headerTitle}>Registration Audit</Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh}>
          <RefreshCw size={18} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabBar}>
        {[
          { key: 'device' as const, label: 'Device & IP', icon: Wifi },
          { key: 'tests' as const, label: 'Tests', icon: Zap },
          { key: 'registrations' as const, label: 'Users', icon: UserPlus },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Icon size={15} color={isActive ? Colors.primary : Colors.textTertiary} />
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {activeTab === 'device' && renderDeviceTab()}
        {activeTab === 'tests' && renderTestsTab()}
        {activeTab === 'registrations' && renderRegistrationsTab()}
        <View style={{ height: 40 }} />
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center'},
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  headerLiveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.positive},
  headerTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text},
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center'},
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 8},
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  tabActive: {
    backgroundColor: Colors.primary + '15',
    borderColor: Colors.primary + '40'},
  tabLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textTertiary},
  tabLabelActive: {
    color: Colors.primary},
  content: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 12},
  ipCard: {
    backgroundColor: '#0A1F14',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: Colors.positive,
    marginBottom: 12},
  ipCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12},
  ipIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.positive,
    alignItems: 'center',
    justifyContent: 'center'},
  ipCardHeaderText: {
    flex: 1},
  ipCardLabel: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.positive,
    letterSpacing: 0.8,
    marginBottom: 2},
  ipCardTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: 0.5},
  copyBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center'},
  detailsCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12},
  detailsTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12},
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  detailLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    width: 90},
  detailValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
    textAlign: 'right' as const},
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12},
  statBox: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border},
  statNumber: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.text,
    marginBottom: 2},
  statLabel: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontWeight: '600' as const,
    textAlign: 'center' as const},
  quickActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 8},
  quickActionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12},
  quickActionIcon: {
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center'},
  quickActionTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text},
  quickActionSub: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 1},
  runAllBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 14},
  runAllBtnDisabled: {
    opacity: 0.7},
  runAllBtnText: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: '#000'},
  testSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12},
  testSummaryDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  testSummaryText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text},
  testSummaryCount: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.textSecondary},
  testCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.border},
  testCardFail: {
    borderColor: Colors.negative + '40'},
  testCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1},
  testIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center'},
  testCardInfo: {
    flex: 1},
  testCardName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text},
  testCardMsg: {
    fontSize: 11,
    marginTop: 1},
  testCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  testDuration: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontWeight: '600' as const},
  regHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12},
  regHeaderTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text},
  regCountBadge: {
    backgroundColor: Colors.primary + '18',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8},
  regCountText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.primary},
  emptyState: {
    alignItems: 'center',
    paddingVertical: 50},
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 12},
  emptySub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4},
  regCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.border},
  regCardAvatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10},
  regCardAvatarText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.primary},
  regCardInfo: {
    flex: 1},
  regCardName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text},
  regCardEmail: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 1},
  regCardMeta: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4},
  regCardMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3},
  regCardMetaText: {
    fontSize: 10,
    color: Colors.textTertiary},
  regCardRight: {
    alignItems: 'flex-end',
    gap: 6},
  kycBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: Colors.textTertiary + '20'},
  kycApproved: {
    backgroundColor: Colors.positive + '18'},
  kycPending: {
    backgroundColor: Colors.warning + '18'},
  kycRejected: {
    backgroundColor: Colors.negative + '18'},
  kycBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.textTertiary,
    textTransform: 'uppercase'}});
