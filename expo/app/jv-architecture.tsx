import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Platform} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { renderSafeViewChildren } from '@/components/SafeViewChildren';
import {
  ArrowLeft,
  Database,
  Globe,
  Smartphone,
  Server,
  Cloud,
  ArrowDown,
  ArrowUp,
  ArrowRight,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Zap,
  Shield,
  Eye,
  Radio,
  HardDrive,
  Layers} from 'lucide-react-native';

type LayerStatus = 'healthy' | 'warning' | 'critical';

interface ConnectionPoint {
  id: string;
  from: string;
  to: string;
  label: string;
  protocol: string;
  status: LayerStatus;
  riskNote?: string;
  dataFlow: string;
}

const LAYER_COLORS = {
  frontend: '#0A84FF',
  state: '#5E5CE6',
  storage: '#BF5AF2',
  backend: '#FF9F0A',
  realtime: '#30D158',
  landing: '#FF453A',
  supabase: '#3ECF8E',
  async: '#64D2FF'} as const;

const STATUS_COLORS: Record<LayerStatus, string> = {
  healthy: '#30D158',
  warning: '#FF9F0A',
  critical: '#FF453A'};

const CONNECTIONS: ConnectionPoint[] = [
  {
    id: 'c1',
    from: 'Admin Panel',
    to: 'jv-storage.ts',
    label: 'CRUD Operations',
    protocol: 'Function Call',
    status: 'healthy',
    dataFlow: 'Create / Update / Delete / Trash / Restore deals'},
  {
    id: 'c2',
    from: 'jv-storage.ts',
    to: 'Supabase DB',
    label: 'Primary Sync',
    protocol: 'Supabase SDK (REST)',
    status: 'healthy',
    dataFlow: 'INSERT / UPSERT / SELECT on jv_deals table'},
  {
    id: 'c3',
    from: 'jv-storage.ts',
    to: 'AsyncStorage',
    label: 'Local Fallback',
    protocol: 'AsyncStorage API',
    status: 'healthy',
    dataFlow: 'JSON serialized deals cached locally as backup'},
  {
    id: 'c4',
    from: 'Supabase DB',
    to: 'Realtime Channel',
    label: 'postgres_changes',
    protocol: 'WebSocket (wss://)',
    status: 'warning',
    riskNote: 'Can disconnect on poor network. Fallback polling at 3-5s intervals.',
    dataFlow: 'INSERT / UPDATE / DELETE events on jv_deals table'},
  {
    id: 'c5',
    from: 'Realtime Channel',
    to: 'React Query Cache',
    label: 'Invalidate + Refetch',
    protocol: 'invalidateQueries()',
    status: 'healthy',
    dataFlow: 'Invalidates all jv-deals, published-jv-deals query keys'},
  {
    id: 'c6',
    from: 'React Query Cache',
    to: 'Home / Invest Screens',
    label: 'UI Re-render',
    protocol: 'useQuery() subscription',
    status: 'healthy',
    dataFlow: 'Published deals list auto-refreshes in UI'},
  {
    id: 'c7',
    from: 'Realtime Channel',
    to: 'Landing Sync',
    label: 'Trigger on Published',
    protocol: 'triggerLandingSync()',
    status: 'warning',
    riskNote: 'Debounced 5s. If realtime disconnects, landing page won\'t auto-update.',
    dataFlow: 'Only fires when deal.published === true changes'},
  {
    id: 'c8',
    from: 'Landing Sync',
    to: 'Supabase landing_deals',
    label: 'Upsert Deals',
    protocol: 'Supabase SDK (REST)',
    status: 'warning',
    riskNote: 'Table may not exist. Falls back gracefully with error log.',
    dataFlow: 'Published deal data upserted to landing_deals table'},
  {
    id: 'c9',
    from: 'Landing Sync',
    to: 'Landing API Endpoint',
    label: 'External POST',
    protocol: 'HTTPS POST (fetch)',
    status: 'warning',
    riskNote: 'Requires EXPO_PUBLIC_API_BASE_URL. Falls back to Supabase table if API fails.',
    dataFlow: 'JSON payload of all published deals sent to /api/landing-sync'},
  {
    id: 'c10',
    from: 'ivxholding.com',
    to: 'Supabase landing_deals',
    label: 'Fetch Deals',
    protocol: 'Supabase SDK / REST API',
    status: 'warning',
    riskNote: 'Landing page must be configured to read from landing_deals or API.',
    dataFlow: 'Landing page queries published deals for public display'},
  {
    id: 'c11',
    from: 'BroadcastChannel',
    to: 'React Query Cache',
    label: 'Cross-Tab Sync',
    protocol: 'BroadcastChannel API (Web)',
    status: 'healthy',
    dataFlow: 'Web-only: syncs JV deal changes across browser tabs'},
  {
    id: 'c12',
    from: 'App Startup',
    to: 'Supabase DB',
    label: 'Local→Cloud Sync',
    protocol: 'syncLocalDealsToSupabase()',
    status: 'healthy',
    dataFlow: 'On launch, pushes any local-only deals to Supabase'},
];

function PulsingDot({ color, delay = 0 }: { color: string; delay?: number }) {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const timeout = setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    }, delay);
    return () => clearTimeout(timeout);
  }, [pulseAnim, delay]);

  return (
    <Animated.View style={[styles.pulsingDot, { backgroundColor: color, opacity: pulseAnim }]} />
  );
}

function FlowArrow({ direction, color }: { direction: 'down' | 'up' | 'right' | 'bidirectional'; color: string }) {
  if (direction === 'bidirectional') {
    return (
      <View style={styles.arrowContainer}>
        <ArrowDown size={14} color={color} />
        <ArrowUp size={14} color={color} />
      </View>
    );
  }
  const Icon = direction === 'down' ? ArrowDown : direction === 'up' ? ArrowUp : ArrowRight;
  return (
    <View style={styles.arrowContainer}>
      <Icon size={16} color={color} />
    </View>
  );
}

function LayerCard({
  title,
  subtitle,
  icon,
  color,
  children,
  status}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  color: string;
  children?: React.ReactNode;
  status: LayerStatus;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  return (
    <Animated.View style={[styles.layerCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }], borderLeftColor: color }]}>
      <View style={styles.layerHeader}>
        <View style={[styles.layerIconWrap, { backgroundColor: color + '20' }]}>
          {icon}
        </View>
        <View style={styles.layerTitleWrap}>
          <Text style={styles.layerTitle}>{title}</Text>
          <Text style={styles.layerSubtitle}>{subtitle}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[status] + '20' }]}>
          <PulsingDot color={STATUS_COLORS[status]} />
          <Text style={[styles.statusText, { color: STATUS_COLORS[status] }]}>
            {status.toUpperCase()}
          </Text>
        </View>
      </View>
      {renderSafeViewChildren(children)}
    </Animated.View>
  );
}

function ConnectionLine({ connection, onPress }: { connection: ConnectionPoint; onPress: () => void }) {
  const color = STATUS_COLORS[connection.status];
  return (
    <TouchableOpacity style={styles.connectionLine} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.connectionDotLine}>
        <View style={[styles.connectionDot, { backgroundColor: color }]} />
        <View style={[styles.connectionPipe, { backgroundColor: color + '40' }]}>
          <View style={[styles.connectionPipeInner, { backgroundColor: color }]} />
        </View>
        <View style={[styles.connectionDot, { backgroundColor: color }]} />
      </View>
      <View style={styles.connectionInfo}>
        <View style={styles.connectionLabelRow}>
          <Text style={styles.connectionLabel}>{connection.label}</Text>
          {connection.status === 'warning' && <AlertTriangle size={12} color="#FF9F0A" />}
          {connection.status === 'healthy' && <CheckCircle size={12} color="#30D158" />}
        </View>
        <Text style={styles.connectionProtocol}>{connection.protocol}</Text>
        <Text style={styles.connectionFlow}>{connection.from} → {connection.to}</Text>
      </View>
    </TouchableOpacity>
  );
}

function DetailModal({
  connection,
  onClose}: {
  connection: ConnectionPoint | null;
  onClose: () => void;
}) {
  if (!connection) return null;
  const color = STATUS_COLORS[connection.status];

  return (
    <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
      <TouchableOpacity style={styles.modalContent} activeOpacity={1} onPress={() => {}}>
        <View style={[styles.modalHeader, { borderBottomColor: color + '30' }]}>
          <View style={[styles.modalStatusDot, { backgroundColor: color }]} />
          <Text style={styles.modalTitle}>{connection.label}</Text>
        </View>

        <View style={styles.modalRow}>
          <Text style={styles.modalKey}>From</Text>
          <Text style={styles.modalValue}>{connection.from}</Text>
        </View>
        <View style={styles.modalRow}>
          <Text style={styles.modalKey}>To</Text>
          <Text style={styles.modalValue}>{connection.to}</Text>
        </View>
        <View style={styles.modalRow}>
          <Text style={styles.modalKey}>Protocol</Text>
          <Text style={styles.modalValue}>{connection.protocol}</Text>
        </View>
        <View style={styles.modalRow}>
          <Text style={styles.modalKey}>Data Flow</Text>
          <Text style={styles.modalValue}>{connection.dataFlow}</Text>
        </View>
        <View style={styles.modalRow}>
          <Text style={styles.modalKey}>Status</Text>
          <Text style={[styles.modalValue, { color }]}>{connection.status.toUpperCase()}</Text>
        </View>

        {connection.riskNote && (
          <View style={styles.riskBox}>
            <AlertTriangle size={14} color="#FF9F0A" />
            <Text style={styles.riskText}>{connection.riskNote}</Text>
          </View>
        )}

        <TouchableOpacity style={styles.modalClose} onPress={onClose}>
          <Text style={styles.modalCloseText}>Close</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export default function JVArchitectureScreen() {
  const router = useRouter();
  const [selectedConnection, setSelectedConnection] = useState<ConnectionPoint | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backBtn} testID="arch-back-btn">
            <ArrowLeft size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>JV Module Architecture</Text>
            <Text style={styles.headerSub}>Real-time data flow schematic</Text>
          </View>
          <View style={styles.headerRight}>
            <Layers size={20} color="#5E5CE6" />
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          testID="arch-scroll"
        >
          {/* LAYER 1: FRONTEND */}
          <LayerCard
            title="Frontend Layer"
            subtitle="React Native / Expo Router screens"
            icon={<Smartphone size={18} color={LAYER_COLORS.frontend} />}
            color={LAYER_COLORS.frontend}
            status="healthy"
          >
            <View style={styles.layerModules}>
              <View style={styles.moduleChip}><Text style={styles.moduleChipText}>app/admin/jv-deals.tsx</Text></View>
              <View style={styles.moduleChip}><Text style={styles.moduleChipText}>app/jv-agreement.tsx</Text></View>
              <View style={styles.moduleChip}><Text style={styles.moduleChipText}>app/jv-invest.tsx</Text></View>
              <View style={styles.moduleChip}><Text style={styles.moduleChipText}>app/(tabs)/home</Text></View>
              <View style={styles.moduleChip}><Text style={styles.moduleChipText}>app/buy-shares.tsx</Text></View>
            </View>
            <View style={styles.fileList}>
              <Text style={styles.fileNote}>Admin creates/edits JV deals → calls jv-storage functions</Text>
              <Text style={styles.fileNote}>User screens read published deals via React Query</Text>
            </View>
          </LayerCard>

          <FlowArrow direction="bidirectional" color={LAYER_COLORS.frontend} />

          {/* LAYER 2: STATE MANAGEMENT */}
          <LayerCard
            title="State Management"
            subtitle="React Query + BroadcastChannel"
            icon={<RefreshCw size={18} color={LAYER_COLORS.state} />}
            color={LAYER_COLORS.state}
            status="healthy"
          >
            <View style={styles.layerModules}>
              <View style={styles.moduleChip}><Text style={styles.moduleChipText}>React Query Cache</Text></View>
              <View style={styles.moduleChip}><Text style={styles.moduleChipText}>jv-realtime.ts</Text></View>
              <View style={[styles.moduleChip, styles.moduleChipWeb]}><Text style={styles.moduleChipText}>BroadcastChannel (Web)</Text></View>
            </View>
            <View style={styles.fileList}>
              <Text style={styles.fileNote}>Query keys: jv-deals, published-jv-deals, jv-agreements</Text>
              <Text style={styles.fileNote}>Cross-tab sync via BroadcastChannel (web only)</Text>
              <Text style={styles.fileNote}>AppState listener resumes polling on foreground</Text>
            </View>
          </LayerCard>

          <FlowArrow direction="bidirectional" color={LAYER_COLORS.state} />

          {/* LAYER 3: STORAGE LAYER */}
          <LayerCard
            title="Storage & Business Logic"
            subtitle="jv-storage.ts + investment-service.ts"
            icon={<HardDrive size={18} color={LAYER_COLORS.storage} />}
            color={LAYER_COLORS.storage}
            status="healthy"
          >
            <View style={styles.layerModules}>
              <View style={styles.moduleChip}><Text style={styles.moduleChipText}>jv-storage.ts (CRUD)</Text></View>
              <View style={styles.moduleChip}><Text style={styles.moduleChipText}>investment-service.ts</Text></View>
              <View style={styles.moduleChip}><Text style={styles.moduleChipText}>audit-trail.ts</Text></View>
              <View style={styles.moduleChip}><Text style={styles.moduleChipText}>data-recovery.ts</Text></View>
            </View>
            <View style={styles.dualPathBox}>
              <View style={styles.dualPathItem}>
                <Cloud size={14} color="#3ECF8E" />
                <Text style={styles.dualPathLabel}>Primary: Supabase</Text>
                <Text style={styles.dualPathDesc}>jv_deals table via SDK</Text>
              </View>
              <View style={styles.dualPathDivider} />
              <View style={styles.dualPathItem}>
                <HardDrive size={14} color="#64D2FF" />
                <Text style={styles.dualPathLabel}>Fallback: AsyncStorage</Text>
                <Text style={styles.dualPathDesc}>Local JSON cache</Text>
              </View>
            </View>
            <View style={styles.fileList}>
              <Text style={styles.fileNote}>Admin auth required for delete/trash/restore</Text>
              <Text style={styles.fileNote}>Rate limit: max 3 permanent deletes/min</Text>
              <Text style={styles.fileNote}>Full audit trail on every mutation</Text>
            </View>
          </LayerCard>

          <FlowArrow direction="bidirectional" color={LAYER_COLORS.storage} />

          {/* LAYER 4: SUPABASE */}
          <LayerCard
            title="Supabase (Cloud Database)"
            subtitle="PostgreSQL + Realtime + Auth"
            icon={<Database size={18} color={LAYER_COLORS.supabase} />}
            color={LAYER_COLORS.supabase}
            status="healthy"
          >
            <View style={styles.layerModules}>
              <View style={[styles.moduleChip, styles.moduleChipDB]}><Text style={styles.moduleChipText}>jv_deals</Text></View>
              <View style={[styles.moduleChip, styles.moduleChipDB]}><Text style={styles.moduleChipText}>landing_deals</Text></View>
              <View style={[styles.moduleChip, styles.moduleChipDB]}><Text style={styles.moduleChipText}>audit_trail</Text></View>
              <View style={[styles.moduleChip, styles.moduleChipDB]}><Text style={styles.moduleChipText}>wallets</Text></View>
              <View style={[styles.moduleChip, styles.moduleChipDB]}><Text style={styles.moduleChipText}>transactions</Text></View>
              <View style={[styles.moduleChip, styles.moduleChipDB]}><Text style={styles.moduleChipText}>holdings</Text></View>
            </View>
            <View style={styles.fileList}>
              <Text style={styles.fileNote}>Realtime enabled on jv_deals (postgres_changes)</Text>
              <Text style={styles.fileNote}>RLS policies active on all tables</Text>
              <Text style={styles.fileNote}>Auth via SecureStore (native) / localStorage (web)</Text>
            </View>
          </LayerCard>

          <FlowArrow direction="down" color={LAYER_COLORS.realtime} />

          {/* LAYER 5: REALTIME */}
          <LayerCard
            title="Realtime Engine"
            subtitle="WebSocket channel + fallback polling"
            icon={<Radio size={18} color={LAYER_COLORS.realtime} />}
            color={LAYER_COLORS.realtime}
            status="warning"
          >
            <View style={styles.realtimeFlow}>
              <View style={styles.rtStep}>
                <Zap size={14} color="#30D158" />
                <Text style={styles.rtStepText}>Supabase fires postgres_changes event</Text>
              </View>
              <ArrowDown size={12} color="#555" />
              <View style={styles.rtStep}>
                <RefreshCw size={14} color="#5E5CE6" />
                <Text style={styles.rtStepText}>jv-realtime.ts receives via WebSocket</Text>
              </View>
              <ArrowDown size={12} color="#555" />
              <View style={styles.rtStep}>
                <RefreshCw size={14} color="#0A84FF" />
                <Text style={styles.rtStepText}>invalidateAllJVQueries() fires</Text>
              </View>
              <ArrowDown size={12} color="#555" />
              <View style={styles.rtStep}>
                <Eye size={14} color="#0A84FF" />
                <Text style={styles.rtStepText}>All screens re-render with fresh data</Text>
              </View>
            </View>

            <View style={styles.warningBox}>
              <AlertTriangle size={14} color="#FF9F0A" />
              <View style={styles.warningTextWrap}>
                <Text style={styles.warningTitle}>Potential Disconnect Point</Text>
                <Text style={styles.warningDesc}>
                  WebSocket can drop on poor networks. Fallback: polling every 6s (disconnected) or 20s (connected). Auto-reconnect with exponential backoff up to 12 retries.
                </Text>
              </View>
            </View>
          </LayerCard>

          <FlowArrow direction="down" color={LAYER_COLORS.landing} />

          {/* LAYER 6: LANDING PAGE SYNC */}
          <LayerCard
            title="Landing Page Sync"
            subtitle="landing-sync.ts → ivxholding.com"
            icon={<Globe size={18} color={LAYER_COLORS.landing} />}
            color={LAYER_COLORS.landing}
            status="warning"
          >
            <View style={styles.realtimeFlow}>
              <View style={styles.rtStep}>
                <Zap size={14} color="#30D158" />
                <Text style={styles.rtStepText}>Published deal change detected by realtime</Text>
              </View>
              <ArrowDown size={12} color="#555" />
              <View style={styles.rtStep}>
                <RefreshCw size={14} color="#FF9F0A" />
                <Text style={styles.rtStepText}>triggerLandingSync() debounced (5s)</Text>
              </View>
              <ArrowDown size={12} color="#555" />
              <View style={styles.syncPathBox}>
                <View style={styles.syncPath}>
                  <Server size={12} color="#FF9F0A" />
                  <Text style={styles.syncPathLabel}>Path A: External API</Text>
                  <Text style={styles.syncPathDesc}>POST /api/landing-sync</Text>
                </View>
                <Text style={styles.syncOr}>OR</Text>
                <View style={styles.syncPath}>
                  <Database size={12} color="#3ECF8E" />
                  <Text style={styles.syncPathLabel}>Path B: Supabase Table</Text>
                  <Text style={styles.syncPathDesc}>UPSERT landing_deals</Text>
                </View>
              </View>
              <ArrowDown size={12} color="#555" />
              <View style={styles.rtStep}>
                <Globe size={14} color="#FF453A" />
                <Text style={styles.rtStepText}>ivxholding.com reads from landing_deals / API</Text>
              </View>
            </View>

            <View style={styles.warningBox}>
              <AlertTriangle size={14} color="#FF9F0A" />
              <View style={styles.warningTextWrap}>
                <Text style={styles.warningTitle}>Known Risk Points</Text>
                <Text style={styles.warningDesc}>
                  1. If realtime disconnects → landing sync won't auto-trigger{'\n'}
                  2. If landing_deals table missing → sync logs error but doesn't crash{'\n'}
                  3. Debounce means 5s delay minimum before sync fires{'\n'}
                  4. Landing page must be configured to poll/read from Supabase
                </Text>
              </View>
            </View>
          </LayerCard>

          <View style={styles.dividerLine} />

          {/* CONNECTIONS MAP */}
          <Text style={styles.sectionTitle}>All Connection Points</Text>
          <Text style={styles.sectionSub}>Tap any connection to see full details</Text>

          {CONNECTIONS.map((conn) => (
            <ConnectionLine
              key={conn.id}
              connection={conn}
              onPress={() => setSelectedConnection(conn)}
            />
          ))}

          <View style={styles.dividerLine} />

          {/* LEGEND */}
          <Text style={styles.sectionTitle}>Legend</Text>
          <View style={styles.legendGrid}>
            <View style={styles.legendItem}>
              <PulsingDot color="#30D158" />
              <Text style={styles.legendText}>Healthy — working correctly</Text>
            </View>
            <View style={styles.legendItem}>
              <PulsingDot color="#FF9F0A" />
              <Text style={styles.legendText}>Warning — may disconnect / needs config</Text>
            </View>
            <View style={styles.legendItem}>
              <PulsingDot color="#FF453A" />
              <Text style={styles.legendText}>Critical — broken / missing</Text>
            </View>
          </View>

          <View style={styles.summaryBox}>
            <Shield size={18} color="#30D158" />
            <View style={styles.summaryContent}>
              <Text style={styles.summaryTitle}>Architecture Summary</Text>
              <Text style={styles.summaryLine}>12 total connection points</Text>
              <Text style={styles.summaryLine}>7 healthy, 5 with warnings (network dependent)</Text>
              <Text style={styles.summaryLine}>0 critical issues</Text>
              <Text style={[styles.summaryLine, { color: '#FF9F0A', marginTop: 6 }]}>
                Main risk: WebSocket disconnect → landing page stops auto-updating
              </Text>
              <Text style={[styles.summaryLine, { color: '#30D158' }]}>
                Mitigation: Fallback polling every 6s + manual sync button
              </Text>
            </View>
          </View>

          <View style={{ height: 60 }} />
        </ScrollView>
      </SafeAreaView>

      {selectedConnection && (
        <DetailModal
          connection={selectedConnection}
          onClose={() => setSelectedConnection(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0C0C0E'},
  safeArea: {
    flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1C1C1E'},
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center'},
  headerCenter: {
    flex: 1,
    marginLeft: 12},
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700' as const},
  headerSub: {
    color: '#8E8E93',
    fontSize: 12,
    marginTop: 1},
  headerRight: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#5E5CE620',
    alignItems: 'center',
    justifyContent: 'center'},
  scroll: {
    flex: 1},
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 40},
  layerCard: {
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    padding: 16,
    borderLeftWidth: 3},
  layerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12},
  layerIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'},
  layerTitleWrap: {
    flex: 1,
    marginLeft: 10},
  layerTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600' as const},
  layerSubtitle: {
    color: '#8E8E93',
    fontSize: 11,
    marginTop: 1},
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4},
  statusText: {
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.5},
  pulsingDot: {
    width: 6,
    height: 6,
    borderRadius: 3},
  layerModules: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10},
  moduleChip: {
    backgroundColor: '#2C2C2E',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6},
  moduleChipWeb: {
    borderWidth: 1,
    borderColor: '#64D2FF30'},
  moduleChipDB: {
    borderWidth: 1,
    borderColor: '#3ECF8E30'},
  moduleChipText: {
    color: '#AEAEB2',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace'},
  fileList: {
    gap: 4},
  fileNote: {
    color: '#636366',
    fontSize: 11,
    lineHeight: 16},
  arrowContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    flexDirection: 'row',
    gap: 4},
  dualPathBox: {
    flexDirection: 'row',
    backgroundColor: '#0C0C0E',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    alignItems: 'center'},
  dualPathItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4},
  dualPathLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600' as const,
    textAlign: 'center' as const},
  dualPathDesc: {
    color: '#636366',
    fontSize: 10,
    textAlign: 'center' as const},
  dualPathDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#2C2C2E',
    marginHorizontal: 8},
  realtimeFlow: {
    gap: 6,
    alignItems: 'center',
    marginBottom: 12},
  rtStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0C0C0E',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    width: '100%'},
  rtStepText: {
    color: '#AEAEB2',
    fontSize: 12,
    flex: 1},
  warningBox: {
    flexDirection: 'row',
    backgroundColor: '#FF9F0A10',
    borderWidth: 1,
    borderColor: '#FF9F0A30',
    borderRadius: 10,
    padding: 12,
    gap: 10,
    alignItems: 'flex-start'},
  warningTextWrap: {
    flex: 1},
  warningTitle: {
    color: '#FF9F0A',
    fontSize: 12,
    fontWeight: '600' as const,
    marginBottom: 4},
  warningDesc: {
    color: '#8E8E93',
    fontSize: 11,
    lineHeight: 16},
  syncPathBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: '100%'},
  syncPath: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0C0C0E',
    padding: 10,
    borderRadius: 8},
  syncPathLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600' as const,
    textAlign: 'center' as const},
  syncPathDesc: {
    color: '#636366',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign: 'center' as const},
  syncOr: {
    color: '#636366',
    fontSize: 10,
    fontWeight: '700' as const},
  dividerLine: {
    height: 1,
    backgroundColor: '#2C2C2E',
    marginVertical: 24},
  sectionTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700' as const,
    marginBottom: 4},
  sectionSub: {
    color: '#636366',
    fontSize: 12,
    marginBottom: 16},
  connectionLine: {
    flexDirection: 'row',
    backgroundColor: '#1C1C1E',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 12,
    alignItems: 'center'},
  connectionDotLine: {
    alignItems: 'center',
    gap: 2},
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  connectionPipe: {
    width: 4,
    height: 20,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center'},
  connectionPipeInner: {
    width: 2,
    height: 14,
    borderRadius: 1},
  connectionInfo: {
    flex: 1},
  connectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  connectionLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600' as const},
  connectionProtocol: {
    color: '#636366',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 2},
  connectionFlow: {
    color: '#8E8E93',
    fontSize: 11,
    marginTop: 2},
  legendGrid: {
    gap: 8,
    marginBottom: 20},
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  legendText: {
    color: '#AEAEB2',
    fontSize: 12},
  summaryBox: {
    flexDirection: 'row',
    backgroundColor: '#30D15810',
    borderWidth: 1,
    borderColor: '#30D15830',
    borderRadius: 12,
    padding: 14,
    gap: 12,
    alignItems: 'flex-start'},
  summaryContent: {
    flex: 1},
  summaryTitle: {
    color: '#30D158',
    fontSize: 14,
    fontWeight: '700' as const,
    marginBottom: 6},
  summaryLine: {
    color: '#AEAEB2',
    fontSize: 12,
    lineHeight: 18},
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24},
  modalContent: {
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400},
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 14,
    borderBottomWidth: 1,
    marginBottom: 14},
  modalStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5},
  modalTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700' as const},
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6},
  modalKey: {
    color: '#636366',
    fontSize: 13,
    fontWeight: '500' as const,
    minWidth: 70},
  modalValue: {
    color: '#fff',
    fontSize: 13,
    flex: 1,
    textAlign: 'right' as const},
  riskBox: {
    flexDirection: 'row',
    backgroundColor: '#FF9F0A10',
    borderRadius: 10,
    padding: 12,
    gap: 10,
    marginTop: 14,
    alignItems: 'flex-start'},
  riskText: {
    color: '#FF9F0A',
    fontSize: 12,
    flex: 1,
    lineHeight: 18},
  modalClose: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 10,
    backgroundColor: '#2C2C2E',
    borderRadius: 10},
  modalCloseText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600' as const}});
