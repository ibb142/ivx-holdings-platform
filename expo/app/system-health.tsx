import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Animated,
  Dimensions,
  Platform} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useScreenFocusState } from '@/hooks/useScreenFocusState';
import {
  ArrowLeft,
  Activity,
  Database,
  Globe,
  Shield,
  Zap,
  Server,
  Monitor,
  Smartphone,
  Radio,
  CheckCircle,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Lock,
  Cpu,
  HardDrive,
  Layers,
  ChevronDown,
  ChevronUp,
  GitBranch,
  Mail,
  Bell,
  Cloud,
  Filter,
  BarChart3} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { EmptyState } from '@/components/ivx';
import {
  runFullHealthCheck,
  type SystemHealthSnapshot,
  type HealthCheck,
  type HealthStatus,
  type ConnectionFlow} from '@/lib/system-health-checker';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const AUTO_REFRESH_INTERVAL_MS = 90_000;
const AUTO_REFRESH_INTERVAL_SECONDS = Math.round(AUTO_REFRESH_INTERVAL_MS / 1000);
const AUTO_REFRESH_INTERVAL_LABEL = `${AUTO_REFRESH_INTERVAL_SECONDS}s`;
const AUTO_REFRESH_INTERVAL_TEXT = `${AUTO_REFRESH_INTERVAL_SECONDS} seconds`;

const STATUS_COLORS: Record<HealthStatus, string> = {
  green: '#00E676',
  yellow: '#FFD600',
  red: '#FF1744'};

const STATUS_LABELS: Record<HealthStatus, string> = {
  green: 'HEALTHY',
  yellow: 'REVIEW',
  red: 'FIX NOW'};

const CATEGORY_CONFIG: Record<string, { icon: typeof Activity; color: string; label: string }> = {
  frontend: { icon: Monitor, color: '#00BCD4', label: 'Frontend' },
  backend: { icon: Server, color: '#7C4DFF', label: 'Backend' },
  database: { icon: Database, color: '#FF6D00', label: 'Database' },
  infrastructure: { icon: Cpu, color: '#E91E63', label: 'Infrastructure' },
  realtime: { icon: Radio, color: '#00E676', label: 'Realtime' },
  services: { icon: Zap, color: '#FFD600', label: 'Services' }};

const CHECK_ICONS: Record<string, typeof Activity> = {
  'landing-page': Globe,
  'app-frontend': Smartphone,
  'expo-router': GitBranch,
  'supabase-db': Database,
  'supabase-auth': Lock,
  'supabase-realtime': Radio,
  'supabase-rls': Shield,
  'jv-deals-data': BarChart3,
  'async-storage': HardDrive,
  'secure-store': Lock,
  'react-query': Zap,
  'email-service': Mail,
  'push-notifications': Bell,
  'aws-infra': Cloud};

type FilterMode = 'all' | 'green' | 'yellow' | 'red';

function PulsingRing({ color, size = 80 }: { color: string; size?: number }) {
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 1500, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0.4, duration: 1200, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, [pulseAnim, glowAnim]);

  const scale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.15]});

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 3,
          borderColor: color,
          opacity: glowAnim,
          transform: [{ scale }]}}
      />
      <View
        style={{
          width: size - 16,
          height: size - 16,
          borderRadius: (size - 16) / 2,
          backgroundColor: color + '15',
          borderWidth: 2,
          borderColor: color + '60',
          alignItems: 'center',
          justifyContent: 'center'}}
      />
    </View>
  );
}

function LiveDot({ color = '#00E676' }: { color?: string }) {
  const anim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, [anim]);
  return <Animated.View style={[styles.liveDot, { backgroundColor: color, opacity: anim }]} />;
}

function ScanBar() {
  const scanAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(scanAnim, { toValue: 1, duration: 2500, useNativeDriver: false })
    ).start();
  }, [scanAnim]);

  const left = scanAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['0%', '70%', '0%']});
  const width = scanAnim.interpolate({
    inputRange: [0, 0.3, 0.7, 1],
    outputRange: ['10%', '30%', '30%', '10%']});

  return (
    <View style={styles.scanBarTrack}>
      <Animated.View style={[styles.scanBarFill, { left: left as any, width: width as any }]} />
    </View>
  );
}

function StatusIcon({ status, size = 14 }: { status: HealthStatus; size?: number }) {
  const color = STATUS_COLORS[status];
  if (status === 'green') return <CheckCircle size={size} color={color} />;
  if (status === 'yellow') return <AlertTriangle size={size} color={color} />;
  return <XCircle size={size} color={color} />;
}

function OverallHealthCard({ snapshot }: { snapshot: SystemHealthSnapshot }) {
  const color = STATUS_COLORS[snapshot.overallStatus];
  const pct = Math.round((snapshot.totalGreen / snapshot.checks.length) * 100);

  return (
    <View style={styles.overallCard}>
      <View style={styles.overallLeft}>
        <PulsingRing color={color} size={90} />
        <View style={styles.overallScoreOverlay}>
          <Text style={[styles.overallScore, { color }]}>{pct}</Text>
          <Text style={styles.overallScoreLabel}>%</Text>
        </View>
      </View>
      <View style={styles.overallRight}>
        <Text style={styles.overallTitle}>System Health</Text>
        <View style={[styles.overallBadge, { backgroundColor: color + '20' }]}>
          <StatusIcon status={snapshot.overallStatus} size={12} />
          <Text style={[styles.overallBadgeText, { color }]}>
            {STATUS_LABELS[snapshot.overallStatus]}
          </Text>
        </View>
        <View style={styles.overallCountsRow}>
          <View style={styles.overallCount}>
            <View style={[styles.countDot, { backgroundColor: STATUS_COLORS.green }]} />
            <Text style={styles.countNum}>{snapshot.totalGreen}</Text>
            <Text style={styles.countLabel}>OK</Text>
          </View>
          <View style={styles.overallCount}>
            <View style={[styles.countDot, { backgroundColor: STATUS_COLORS.yellow }]} />
            <Text style={styles.countNum}>{snapshot.totalYellow}</Text>
            <Text style={styles.countLabel}>Review</Text>
          </View>
          <View style={styles.overallCount}>
            <View style={[styles.countDot, { backgroundColor: STATUS_COLORS.red }]} />
            <Text style={styles.countNum}>{snapshot.totalRed}</Text>
            <Text style={styles.countLabel}>Fix</Text>
          </View>
        </View>
        <Text style={styles.overallTimestamp}>
          Scanned: {snapshot.timestamp.toLocaleTimeString()}
        </Text>
      </View>
    </View>
  );
}

function TechStackDiagram({ snapshot }: { snapshot: SystemHealthSnapshot }) {
  const getCheckStatus = useCallback((id: string): HealthStatus => {
    return snapshot.checks.find(c => c.id === id)?.status || 'red';
  }, [snapshot]);

  const nodes: { id: string; label: string; row: number; col: number; icon: typeof Activity }[] = [
    { id: 'landing-page', label: 'Landing', row: 0, col: 0, icon: Globe },
    { id: 'app-frontend', label: 'App', row: 0, col: 1, icon: Smartphone },
    { id: 'expo-router', label: 'Router', row: 0, col: 2, icon: GitBranch },
    { id: 'supabase-auth', label: 'Auth', row: 1, col: 0, icon: Lock },
    { id: 'react-query', label: 'Cache', row: 1, col: 1, icon: Zap },
    { id: 'supabase-realtime', label: 'Realtime', row: 1, col: 2, icon: Radio },
    { id: 'supabase-db', label: 'PostgreSQL', row: 2, col: 0, icon: Database },
    { id: 'supabase-rls', label: 'RLS', row: 2, col: 1, icon: Shield },
    { id: 'jv-deals-data', label: 'JV Deals', row: 2, col: 2, icon: BarChart3 },
    { id: 'aws-infra', label: 'AWS', row: 3, col: 0, icon: Cloud },
    { id: 'async-storage', label: 'Storage', row: 3, col: 1, icon: HardDrive },
    { id: 'secure-store', label: 'Secure', row: 3, col: 2, icon: Lock },
  ];

  const nodeWidth = (SCREEN_WIDTH - 72) / 3;

  return (
    <View style={styles.stackCard}>
      <View style={styles.stackHeader}>
        <Layers size={16} color={Colors.primary} />
        <Text style={styles.stackTitle}>IVX Tech Stack — Live</Text>
      </View>
      <View style={styles.stackGrid}>
        {[0, 1, 2, 3].map(row => (
          <View key={row} style={styles.stackRow}>
            <Text style={styles.stackRowLabel}>
              {row === 0 ? 'FRONTEND' : row === 1 ? 'MIDDLEWARE' : row === 2 ? 'DATABASE' : 'INFRA'}
            </Text>
            <View style={styles.stackNodeRow}>
              {nodes.filter(n => n.row === row).map(node => {
                const status = getCheckStatus(node.id);
                const color = STATUS_COLORS[status];
                const NodeIcon = node.icon;
                return (
                  <View key={node.id} style={[styles.stackNode, { width: nodeWidth, borderColor: color + '50' }]}>
                    <View style={[styles.stackNodeDot, { backgroundColor: color }]} />
                    <View style={[styles.stackNodeIconWrap, { backgroundColor: color + '15' }]}>
                      <NodeIcon size={18} color={color} />
                    </View>
                    <Text style={styles.stackNodeLabel} numberOfLines={1}>{node.label}</Text>
                    <Text style={[styles.stackNodeStatus, { color }]}>
                      {status === 'green' ? 'OK' : status === 'yellow' ? 'REVIEW' : 'FIX'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function ConnectionsPanel({ connections }: { connections: ConnectionFlow[] }) {
  return (
    <View style={styles.connectionsCard}>
      <View style={styles.connectionsHeader}>
        <GitBranch size={16} color={Colors.primary} />
        <Text style={styles.connectionsTitle}>Live Connections</Text>
        <Text style={styles.connectionsCount}>{connections.length} flows</Text>
      </View>
      {connections.map((conn, i) => {
        const color = STATUS_COLORS[conn.status];
        return (
          <View key={i} style={styles.connectionRow}>
            <View style={[styles.connectionDot, { backgroundColor: color }]} />
            <View style={styles.connectionInfo}>
              <Text style={styles.connectionLabel}>{conn.label}</Text>
              <Text style={styles.connectionPath}>
                {conn.from.replace(/-/g, ' ')} → {conn.to.replace(/-/g, ' ')}
              </Text>
            </View>
            <View style={styles.connectionRight}>
              {conn.latency !== undefined && (
                <Text style={[styles.connectionLatency, { color }]}>{conn.latency}ms</Text>
              )}
              <StatusIcon status={conn.status} size={12} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function CheckCard({ check, expanded, onToggle }: { check: HealthCheck; expanded: boolean; onToggle: () => void }) {
  const color = STATUS_COLORS[check.status];
  const Icon = CHECK_ICONS[check.id] || Activity;
  const catConfig = CATEGORY_CONFIG[check.category] || CATEGORY_CONFIG.services;
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(slideAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 12 }).start();
  }, [slideAnim]);

  return (
    <Animated.View style={[styles.checkCard, { borderLeftColor: color, opacity: slideAnim, transform: [{ translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [15, 0] }) }] }]}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.7} style={styles.checkCardInner}>
        <View style={styles.checkRow}>
          <View style={[styles.checkIconWrap, { backgroundColor: color + '15' }]}>
            <Icon size={18} color={color} />
          </View>
          <View style={styles.checkInfo}>
            <Text style={styles.checkName}>{check.name}</Text>
            <Text style={styles.checkMessage} numberOfLines={1}>{check.message}</Text>
          </View>
          <View style={styles.checkRight}>
            <View style={[styles.checkStatusBadge, { backgroundColor: color + '20' }]}>
              <Text style={[styles.checkStatusText, { color }]}>
                {check.status === 'green' ? 'OK' : check.status === 'yellow' ? 'REVIEW' : 'FIX'}
              </Text>
            </View>
            {expanded ? <ChevronUp size={14} color={Colors.textSecondary} /> : <ChevronDown size={14} color={Colors.textSecondary} />}
          </View>
        </View>

        {expanded && (
          <View style={styles.checkDetails}>
            <View style={styles.checkDetailRow}>
              <Text style={styles.checkDetailLabel}>Category</Text>
              <View style={[styles.checkCatBadge, { backgroundColor: catConfig.color + '15' }]}>
                <Text style={[styles.checkCatText, { color: catConfig.color }]}>{catConfig.label}</Text>
              </View>
            </View>
            <View style={styles.checkDetailRow}>
              <Text style={styles.checkDetailLabel}>Latency</Text>
              <Text style={styles.checkDetailValue}>{check.latency}ms</Text>
            </View>
            {check.port && (
              <View style={styles.checkDetailRow}>
                <Text style={styles.checkDetailLabel}>Port</Text>
                <Text style={[styles.checkDetailValue, styles.mono]}>{check.port}</Text>
              </View>
            )}
            {check.endpoint && (
              <View style={styles.checkDetailRow}>
                <Text style={styles.checkDetailLabel}>Endpoint</Text>
                <Text style={[styles.checkDetailValue, styles.mono]} numberOfLines={1}>{check.endpoint}</Text>
              </View>
            )}
            {check.linesOfCode !== undefined && check.linesOfCode > 0 && (
              <View style={styles.checkDetailRow}>
                <Text style={styles.checkDetailLabel}>Lines of Code</Text>
                <Text style={styles.checkDetailValue}>{new Intl.NumberFormat('en-US').format(check.linesOfCode)}</Text>
              </View>
            )}
            {check.details && (
              <View style={styles.checkDetailRow}>
                <Text style={styles.checkDetailLabel}>Details</Text>
                <Text style={styles.checkDetailValue}>{check.details}</Text>
              </View>
            )}
            <View style={styles.checkDetailRow}>
              <Text style={styles.checkDetailLabel}>Last Check</Text>
              <Text style={styles.checkDetailValue}>{check.lastChecked.toLocaleTimeString()}</Text>
            </View>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function SystemHealthScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<SystemHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [autoRefreshCount, setAutoRefreshCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanInFlightRef = useRef(false);
  const isScreenFocused = useScreenFocusState(true);

  const runScan = useCallback(async (isRefresh = false, force = false) => {
    if (scanInFlightRef.current) {
      console.log('[SystemHealth] Scan skipped because another scan is still running');
      return;
    }

    scanInFlightRef.current = true;
    console.log('[SystemHealth] Running scan...');
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const result = await runFullHealthCheck({ force });
      setSnapshot(result);
      setAutoRefreshCount(prev => prev + 1);
    } catch (err) {
      console.error('[SystemHealth] Scan error:', err);
    } finally {
      scanInFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!isScreenFocused) {
      console.log('[SystemHealth] Screen blurred — pausing auto refresh');
      return;
    }

    void runScan();

    intervalRef.current = setInterval(() => {
      void runScan();
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isScreenFocused, runScan]);

  const filteredChecks = useMemo(() => {
    if (!snapshot) return [];
    if (filter === 'all') return snapshot.checks;
    return snapshot.checks.filter(c => c.status === filter);
  }, [snapshot, filter]);

  const onRefresh = useCallback(() => {
    void runScan(true, true);
  }, [runScan]);

  if (loading && !snapshot) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <PulsingRing color={Colors.primary} size={100} />
          <Text style={styles.loadingText}>Scanning all systems...</Text>
          <ScanBar />
          <Text style={styles.loadingSubtext}>
            Checking landing page, backend, database, AWS, realtime connections...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <LiveDot color={snapshot ? STATUS_COLORS[snapshot.overallStatus] : '#00E676'} />
            <Text style={styles.headerTitle}>System Health</Text>
          </View>
          <Text style={styles.headerSubtitle}>
            Light scan · refresh #{autoRefreshCount} · every {AUTO_REFRESH_INTERVAL_LABEL}
          </Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/system-blueprint' as any)} style={styles.blueprintBtn}>
          <Layers size={16} color="#00E676" />
          <Text style={styles.blueprintBtnText}>3D</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn} testID="system-health-refresh-button">
          <RefreshCw size={18} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <ScanBar />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {snapshot && (
          <>
            <OverallHealthCard snapshot={snapshot} />
            <TechStackDiagram snapshot={snapshot} />
            <ConnectionsPanel connections={snapshot.connections} />

            <View style={styles.filterSection}>
              <View style={styles.filterHeader}>
                <Filter size={14} color={Colors.textSecondary} />
                <Text style={styles.filterTitle}>All Checks ({snapshot.checks.length})</Text>
              </View>
              <View style={styles.filterRow}>
                {(['all', 'green', 'yellow', 'red'] as FilterMode[]).map(f => {
                  const isActive = filter === f;
                  const fColor = f === 'all' ? Colors.primary : STATUS_COLORS[f];
                  const count = f === 'all'
                    ? snapshot.checks.length
                    : snapshot.checks.filter(c => c.status === f).length;
                  return (
                    <TouchableOpacity
                      key={f}
                      style={[styles.filterBtn, isActive && { backgroundColor: fColor + '20', borderColor: fColor + '50' }]}
                      onPress={() => setFilter(f)}
                    >
                      {f !== 'all' && <View style={[styles.filterDot, { backgroundColor: fColor }]} />}
                      <Text style={[styles.filterBtnText, isActive && { color: fColor }]}>
                        {f === 'all' ? 'All' : f === 'green' ? 'OK' : f === 'yellow' ? 'Review' : 'Fix'} ({count})
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {filteredChecks.map(check => (
              <CheckCard
                key={check.id}
                check={check}
                expanded={expandedCheck === check.id}
                onToggle={() => setExpandedCheck(expandedCheck === check.id ? null : check.id)}
              />
            ))}

            <View style={styles.legend}>
              <Text style={styles.legendTitle}>Color Legend</Text>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS.green }]} />
                  <View>
                    <Text style={styles.legendLabel}>Green — Healthy</Text>
                    <Text style={styles.legendDesc}>Everything working well</Text>
                  </View>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS.yellow }]} />
                  <View>
                    <Text style={styles.legendLabel}>Yellow — Review</Text>
                    <Text style={styles.legendDesc}>Needs attention/check</Text>
                  </View>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS.red }]} />
                  <View>
                    <Text style={styles.legendLabel}>Red — Fix Now</Text>
                    <Text style={styles.legendDesc}>Broken, needs immediate fix</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.footer}>
              <Text style={styles.footerText}>IVX Holding — Real-Time System Health v2.0</Text>
              <Text style={styles.footerText}>
                {Platform.OS} · {snapshot.checks.length} checks · {snapshot.connections.length} connections
              </Text>
              <Text style={styles.footerText}>Auto-refreshes every {AUTO_REFRESH_INTERVAL_TEXT}</Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060609'},
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 16},
  loadingText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 12},
  loadingSubtext: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#151518'},
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#12121A',
    alignItems: 'center',
    justifyContent: 'center'},
  headerCenter: {
    flex: 1,
    alignItems: 'center'},
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  headerTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.3},
  headerSubtitle: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2},
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#12121A',
    alignItems: 'center',
    justifyContent: 'center'},
  liveDot: {
    width: 9,
    height: 9,
    borderRadius: 5},
  scanBarTrack: {
    height: 3,
    backgroundColor: '#12121A',
    overflow: 'hidden' as const},
  scanBarFill: {
    position: 'absolute' as const,
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 2},
  scroll: {
    flex: 1},
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 40},
  overallCard: {
    flexDirection: 'row',
    backgroundColor: '#0D0D14',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1A1A22',
    marginBottom: 12,
    alignItems: 'center'},
  overallLeft: {
    position: 'relative' as const,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 18},
  overallScoreOverlay: {
    position: 'absolute' as const,
    flexDirection: 'row',
    alignItems: 'baseline'},
  overallScore: {
    fontSize: 30,
    fontWeight: '900' as const},
  overallScoreLabel: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.textTertiary},
  overallRight: {
    flex: 1,
    gap: 8},
  overallTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text},
  overallBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignSelf: 'flex-start' as const},
  overallBadgeText: {
    fontSize: 12,
    fontWeight: '800' as const,
    letterSpacing: 0.5},
  overallCountsRow: {
    flexDirection: 'row',
    gap: 14},
  overallCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5},
  countDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  countNum: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.text},
  countLabel: {
    fontSize: 11,
    color: Colors.textTertiary},
  overallTimestamp: {
    fontSize: 10,
    color: Colors.textTertiary},
  stackCard: {
    backgroundColor: '#0D0D14',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1A1A22',
    marginBottom: 12},
  stackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14},
  stackTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text},
  stackGrid: {
    gap: 14},
  stackRow: {
    gap: 6},
  stackRowLabel: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: Colors.textTertiary,
    letterSpacing: 1.5,
    marginBottom: 4,
    marginLeft: 2},
  stackNodeRow: {
    flexDirection: 'row',
    gap: 8},
  stackNode: {
    borderRadius: 14,
    backgroundColor: '#0A0A10',
    borderWidth: 1,
    padding: 10,
    alignItems: 'center',
    gap: 5,
    position: 'relative' as const},
  stackNodeDot: {
    position: 'absolute' as const,
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 4},
  stackNodeIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'},
  stackNodeLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.text},
  stackNodeStatus: {
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 0.5},
  connectionsCard: {
    backgroundColor: '#0D0D14',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1A1A22',
    marginBottom: 12},
  connectionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12},
  connectionsTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    flex: 1},
  connectionsCount: {
    fontSize: 11,
    color: Colors.textTertiary},
  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#12121A'},
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10},
  connectionInfo: {
    flex: 1},
  connectionLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text},
  connectionPath: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 1},
  connectionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  connectionLatency: {
    fontSize: 11,
    fontWeight: '700' as const},
  filterSection: {
    marginBottom: 10,
    marginTop: 4},
  filterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10},
  filterTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text},
  filterRow: {
    flexDirection: 'row',
    gap: 6},
  filterBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#0D0D12',
    borderWidth: 1,
    borderColor: '#1A1A22',
    gap: 4},
  filterDot: {
    width: 6,
    height: 6,
    borderRadius: 3},
  filterBtnText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textTertiary},
  checkCard: {
    backgroundColor: '#0D0D14',
    borderRadius: 14,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#1A1A22',
    borderLeftWidth: 4,
    overflow: 'hidden' as const},
  checkCardInner: {
    padding: 14},
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  checkIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'},
  checkInfo: {
    flex: 1},
  checkName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text},
  checkMessage: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2},
  checkRight: {
    alignItems: 'flex-end',
    gap: 4},
  checkStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6},
  checkStatusText: {
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 0.5},
  checkDetails: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1A1A22',
    gap: 8},
  checkDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'},
  checkDetailLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3},
  checkDetailValue: {
    fontSize: 12,
    color: Colors.text,
    flex: 1,
    textAlign: 'right' as const,
    marginLeft: 12},
  checkCatBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6},
  checkCatText: {
    fontSize: 10,
    fontWeight: '700' as const},
  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10},
  legend: {
    backgroundColor: '#0D0D14',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1A1A22',
    marginTop: 12},
  legendTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12},
  legendRow: {
    gap: 10},
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  legendDot: {
    width: 14,
    height: 14,
    borderRadius: 7},
  legendLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text},
  legendDesc: {
    fontSize: 11,
    color: Colors.textTertiary},
  blueprintBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.3)',
    backgroundColor: 'rgba(0, 230, 118, 0.08)'},
  blueprintBtnText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#00E676',
    letterSpacing: 0.5},
  footer: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 4},
  footerText: {
    fontSize: 11,
    color: Colors.textTertiary}});
