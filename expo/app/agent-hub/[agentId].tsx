/**
 * IVX Agent Detail — Tools, capabilities, and live status for a domain agent.
 *
 * Route: /agent-hub/[agentId]
 * Shows the agent's tools (with endpoint references), verified capabilities,
 * destructive actions, risk level, and engine wiring.
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Linking,
  useWindowDimensions} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import {
  Users,
  TrendingUp,
  ShoppingCart,
  Handshake,
  Video,
  Rocket,
  ClipboardCheck,
  Shield,
  DollarSign,
  Lightbulb,
  ArrowLeft,
  Wrench,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Cpu,
  ChevronRight,
  Lock,
  Eye,
  Code2,
  RefreshCw,
  Activity} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { getAgentById, type AgentTool } from '@/lib/ivx-agents-data';

const ICON_MAP: Record<string, React.ElementType> = {
  Users,
  TrendingUp,
  ShoppingCart,
  Handshake,
  Video,
  Rocket,
  ClipboardCheck,
  Shield,
  DollarSign,
  Lightbulb};

const RISK_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  low: { bg: 'rgba(0,196,140,0.15)', text: Colors.success, label: 'LOW RISK' },
  medium: { bg: 'rgba(245,158,11,0.15)', text: Colors.warning, label: 'MEDIUM RISK' },
  high: { bg: 'rgba(255,77,77,0.15)', text: Colors.error, label: 'HIGH RISK' }};

function ToolCard({ tool, onPressEndpoint }: { tool: AgentTool; onPressEndpoint: (endpoint: string) => void }) {
  return (
    <TouchableOpacity
      style={styles.toolCard}
      onPress={() => onPressEndpoint(tool.endpoint)}
      activeOpacity={0.7}
      testID={`tool-${tool.id}`}
    >
      <View style={styles.toolHeader}>
        <View style={[styles.toolMethodBadge, { backgroundColor: tool.readOnly ? 'rgba(74,144,217,0.15)' : 'rgba(245,158,11,0.15)' }]}>
          <Text style={[styles.toolMethodText, { color: tool.readOnly ? Colors.info : Colors.warning }]}>
            {tool.method}
          </Text>
        </View>
        <Text style={styles.toolName}>{tool.name}</Text>
        {tool.ownerRequired ? (
          <View style={styles.ownerBadge}>
            <Lock color={Colors.error} size={10} strokeWidth={2.2} />
            <Text style={styles.ownerBadgeText}>OWNER</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.toolDesc}>{tool.description}</Text>
      <View style={styles.toolFooter}>
        <Code2 color={Colors.mutedGray} size={12} strokeWidth={2} />
        <Text style={styles.toolEndpoint} numberOfLines={1}>{tool.endpoint}</Text>
        <ChevronRight color={Colors.mutedGray} size={14} strokeWidth={2} />
      </View>
    </TouchableOpacity>
  );
}

export default function AgentDetailScreen() {
  const router = useRouter();
  const { agentId } = useLocalSearchParams<{ agentId: string }>();
  const { width: screenWidth } = useWindowDimensions();
  const isCompact = screenWidth < 380;

  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const agent = useMemo(() => getAgentById(agentId ?? ''), [agentId]);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 800);
  }, []);

  const onPressEndpoint = useCallback((endpoint: string) => {
    const url = `https://api.ivxholding.com${endpoint}`;
    Linking.canOpenURL(url).then((can) => {
      if (can) Linking.openURL(url);
    });
  }, []);

  if (!agent) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={22} color={Colors.textWhite} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Agent not found</Text>
        </View>
        <View style={styles.emptyState}>
          <AlertTriangle color={Colors.error} size={40} strokeWidth={2} />
          <Text style={styles.emptyTitle}>Agent "{agentId}" does not exist</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => router.push('/agent-hub' as never)}>
            <Text style={styles.retryText}>Back to Agent Hub</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const Icon = ICON_MAP[agent.icon] ?? Cpu;
  const risk = RISK_CONFIG[agent.riskLevel];
  const readOnlyTools = agent.tools.filter((t) => t.readOnly);
  const writeTools = agent.tools.filter((t) => !t.readOnly);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="agent-detail-back">
          <ArrowLeft size={22} color={Colors.textWhite} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>{agent.name}</Text>
          <Text style={styles.headerSubtitle}>Agent #{agent.number} · {agent.domain}</Text>
        </View>
        <TouchableOpacity onPress={onRefresh} style={styles.refreshButton} testID="agent-detail-refresh">
          <RefreshCw size={18} color={Colors.gold} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: isCompact ? 14 : 20 }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={Colors.gold} />}
      >
        {/* Hero */}
        <View style={[styles.heroCard, { borderColor: agent.color + '30' }]}>
          <View style={[styles.heroIcon, { backgroundColor: agent.color + '20' }]}>
            <Icon color={agent.color} size={32} strokeWidth={2.2} />
          </View>
          <Text style={styles.heroName}>{agent.name}</Text>
          <Text style={styles.heroRole}>{agent.role}</Text>

          <View style={styles.heroMeta}>
            <View style={[styles.metaPill, { backgroundColor: risk.bg }]}>
              <Text style={[styles.metaPillText, { color: risk.text }]}>{risk.label}</Text>
            </View>
            <View style={[styles.metaPill, { backgroundColor: agent.color + '15' }]}>
              <Text style={[styles.metaPillText, { color: agent.color }]}>{agent.scheduleMode.toUpperCase()}</Text>
            </View>
            {agent.canModifyProduction && (
              <View style={[styles.metaPill, { backgroundColor: 'rgba(245,158,11,0.15)' }]}>
                <Zap color={Colors.warning} size={10} strokeWidth={2.2} />
                <Text style={[styles.metaPillText, { color: Colors.warning, marginLeft: 4 }]}>PROD</Text>
              </View>
            )}
          </View>
        </View>

        {/* Mission & Engine */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Activity color={Colors.officialGold} size={16} strokeWidth={2.2} />
            <Text style={styles.sectionTitle}>Mission & Engine</Text>
          </View>
          <Text style={styles.missionText}>{agent.mission}</Text>
          <View style={styles.engineBox}>
            <Cpu color={Colors.mutedGray} size={14} strokeWidth={2} />
            <Text style={styles.engineLabel}>Engine:</Text>
            <Text style={styles.engineValue}>{agent.engine}</Text>
          </View>
          <View style={styles.producesBox}>
            <CheckCircle2 color={Colors.success} size={14} strokeWidth={2} />
            <Text style={styles.producesLabel}>Produces:</Text>
            <Text style={styles.producesValue}>{agent.produces}</Text>
          </View>
        </View>

        {/* Capabilities */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <CheckCircle2 color={Colors.success} size={16} strokeWidth={2.2} />
            <Text style={styles.sectionTitle}>Verified Capabilities ({agent.capabilities.length})</Text>
          </View>
          {agent.capabilities.map((cap, idx) => (
            <View key={`${agent.id}-cap-${idx}`} style={styles.capRow}>
              <View style={[styles.capDot, { backgroundColor: cap.verified ? Colors.success : Colors.mutedGray }]} />
              <View style={styles.capTextWrap}>
                <Text style={styles.capName}>{cap.name}</Text>
                <Text style={styles.capEvidence}>{cap.evidence}</Text>
              </View>
              {cap.verified && <CheckCircle2 color={Colors.success} size={14} strokeWidth={2.2} />}
            </View>
          ))}
        </View>

        {/* Read-Only Tools */}
        {readOnlyTools.length > 0 && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Eye color={Colors.info} size={16} strokeWidth={2.2} />
              <Text style={styles.sectionTitle}>Read-Only Tools ({readOnlyTools.length})</Text>
            </View>
            {readOnlyTools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} onPressEndpoint={onPressEndpoint} />
            ))}
          </View>
        )}

        {/* Write Tools */}
        {writeTools.length > 0 && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Wrench color={Colors.warning} size={16} strokeWidth={2.2} />
              <Text style={styles.sectionTitle}>Write Tools ({writeTools.length})</Text>
            </View>
            {writeTools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} onPressEndpoint={onPressEndpoint} />
            ))}
          </View>
        )}

        {/* Destructive Actions */}
        {agent.destructiveActions.length > 0 && (
          <View style={[styles.sectionCard, { borderColor: 'rgba(255,77,77,0.2)' }]}>
            <View style={styles.sectionHeader}>
              <AlertTriangle color={Colors.error} size={16} strokeWidth={2.2} />
              <Text style={styles.sectionTitle}>Destructive Actions (Owner Approval Required)</Text>
            </View>
            {agent.destructiveActions.map((action, idx) => (
              <View key={`${agent.id}-dest-${idx}`} style={styles.destRow}>
                <Lock color={Colors.error} size={12} strokeWidth={2} />
                <Text style={styles.destText}>{action}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Stats summary */}
        <View style={styles.statsCard}>
          <View style={styles.statsRow}>
            <View style={styles.statsItem}>
              <Wrench color={agent.color} size={18} strokeWidth={2.2} />
              <Text style={styles.statsValue}>{agent.tools.length}</Text>
              <Text style={styles.statsLabel}>Tools</Text>
            </View>
            <View style={styles.statsItem}>
              <CheckCircle2 color={Colors.success} size={18} strokeWidth={2.2} />
              <Text style={styles.statsValue}>{agent.capabilities.length}</Text>
              <Text style={styles.statsLabel}>Verified</Text>
            </View>
            <View style={styles.statsItem}>
              <AlertTriangle color={Colors.warning} size={18} strokeWidth={2.2} />
              <Text style={styles.statsValue}>{agent.destructiveActions.length}</Text>
              <Text style={styles.statsLabel}>Destructive</Text>
            </View>
            <View style={styles.statsItem}>
              <Lock color={Colors.error} size={18} strokeWidth={2.2} />
              <Text style={styles.statsValue}>
                {agent.tools.filter((t) => t.ownerRequired).length}
              </Text>
              <Text style={styles.statsLabel}>Owner-Gated</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Engine: {agent.engine}{'\n'}
            API: {agent.apiPath}{'\n'}
            Risk: {agent.riskLevel.toUpperCase()} · Production: {agent.canModifyProduction ? 'YES' : 'NO'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  backButton: {
    padding: 6,
    marginRight: 8},
  headerTitleWrap: {
    flex: 1},
  headerTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.textWhite,
    letterSpacing: -0.3},
  headerSubtitle: {
    fontSize: 12,
    color: Colors.mutedGray,
    marginTop: 2},
  refreshButton: {
    padding: 8},
  content: {
    paddingVertical: 16,
    paddingBottom: 120,
    gap: 14},
  heroCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 24,
    alignItems: 'center' as const,
    borderWidth: 1},
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 14},
  heroName: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.textWhite,
    letterSpacing: -0.5},
  heroRole: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    marginTop: 6,
    lineHeight: 19},
  heroMeta: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    justifyContent: 'center' as const,
    gap: 8,
    marginTop: 14},
  metaPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10},
  metaPillText: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.5},
  sectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  sectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 14},
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.textWhite},
  missionText: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 21,
    marginBottom: 12},
  engineBox: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8},
  engineLabel: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.mutedGray},
  engineValue: {
    fontSize: 12,
    color: Colors.textWhite,
    flex: 1},
  producesBox: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: 'rgba(0,196,140,0.08)',
    borderRadius: 10,
    padding: 10},
  producesLabel: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.mutedGray},
  producesValue: {
    fontSize: 12,
    color: Colors.success,
    flex: 1},
  capRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.surfaceBorder},
  capDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5},
  capTextWrap: {
    flex: 1},
  capName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textWhite},
  capEvidence: {
    fontSize: 12,
    color: Colors.mutedGray,
    marginTop: 2,
    lineHeight: 17},
  toolCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  toolHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 6},
  toolMethodBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6},
  toolMethodText: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.5},
  toolName: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.textWhite,
    flex: 1},
  ownerBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    backgroundColor: 'rgba(255,77,77,0.12)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6},
  ownerBadgeText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: Colors.error,
    letterSpacing: 0.5},
  toolDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginBottom: 8},
  toolFooter: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: 8},
  toolEndpoint: {
    fontSize: 11,
    color: Colors.mutedGray,
    flex: 1,
    fontFamily: 'monospace'},
  destRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingVertical: 6},
  destText: {
    fontSize: 13,
    color: Colors.error,
    fontFamily: 'monospace'},
  statsCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  statsRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-around' as const},
  statsItem: {
    alignItems: 'center' as const},
  statsValue: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.textWhite,
    marginTop: 6},
  statsLabel: {
    fontSize: 10,
    color: Colors.mutedGray,
    marginTop: 2},
  emptyState: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: 32,
    gap: 12},
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.textWhite,
    textAlign: 'center' as const},
  retryButton: {
    backgroundColor: Colors.gold,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 8},
  retryText: {
    color: Colors.black,
    fontSize: 14,
    fontWeight: '700' as const},
  footer: {
    marginTop: 8,
    alignItems: 'center' as const},
  footerText: {
    fontSize: 11,
    color: Colors.mutedGray,
    textAlign: 'center' as const,
    lineHeight: 17,
    fontFamily: 'monospace'}});
