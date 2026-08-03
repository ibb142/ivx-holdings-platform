/**
 * IVX Agent Hub — 10 Domain Agent Tools
 *
 * Shows all 10 specialized IVX agents with their tools, capabilities,
 * and live status. Each agent maps to a real backend engine.
 *
 * Agents: Member, Investor, Buyer, JV, Reels, Deployment, QA, Security,
 * Capital, Research.
 */
import React, { useState, useMemo, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  useWindowDimensions} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
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
  Search,
  ChevronRight,
  Cpu,
  Wrench,
  CheckCircle2,
  AlertTriangle,
  Zap,
  ArrowLeft} from 'lucide-react-native';
import Colors from '@/constants/colors';
import {
  IVX_DOMAIN_AGENTS,
  getAgentById,
  getTotalTools,
  getTotalCapabilities,
  searchAgents,
  type IVXDomainAgent} from '@/lib/ivx-agents-data';

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

const RISK_COLORS: Record<string, { bg: string; text: string }> = {
  low: { bg: 'rgba(0,196,140,0.15)', text: Colors.success },
  medium: { bg: 'rgba(245,158,11,0.15)', text: Colors.warning },
  high: { bg: 'rgba(255,77,77,0.15)', text: Colors.error }};

function AgentCard({
  agent,
  onPress,
  isCompact}: {
  agent: IVXDomainAgent;
  onPress: () => void;
  isCompact: boolean;
}) {
  const Icon = ICON_MAP[agent.icon] ?? Cpu;
  const risk = RISK_COLORS[agent.riskLevel];
  const cardWidth = isCompact ? '100%' : '48%';

  return (
    <TouchableOpacity
      style={[styles.agentCard, { width: cardWidth, borderColor: agent.color + '30' }]}
      onPress={onPress}
      activeOpacity={0.85}
      testID={`agent-${agent.id}`}
    >
      <View style={styles.agentHeader}>
        <View style={[styles.agentIcon, { backgroundColor: agent.color + '20' }]}>
          <Icon color={agent.color} size={22} strokeWidth={2.2} />
        </View>
        <View style={styles.agentHeaderText}>
          <Text style={styles.agentNumber}>#{agent.number}</Text>
          <Text style={styles.agentName} numberOfLines={1}>{agent.name}</Text>
        </View>
      </View>

      <Text style={styles.agentRole} numberOfLines={2}>{agent.role}</Text>

      <View style={styles.agentMeta}>
        <View style={[styles.metaPill, { backgroundColor: agent.color + '15' }]}>
          <Text style={[styles.metaPillText, { color: agent.color }]}>{agent.domain}</Text>
        </View>
        <View style={[styles.metaPill, { backgroundColor: risk.bg }]}>
          <Text style={[styles.metaPillText, { color: risk.text }]}>{agent.riskLevel.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.agentStats}>
        <View style={styles.statItem}>
          <Wrench color={Colors.mutedGray} size={13} strokeWidth={2} />
          <Text style={styles.statText}>{agent.tools.length} tools</Text>
        </View>
        <View style={styles.statItem}>
          <CheckCircle2 color={Colors.mutedGray} size={13} strokeWidth={2} />
          <Text style={styles.statText}>{agent.capabilities.length} verified</Text>
        </View>
      </View>

      {agent.canModifyProduction && (
        <View style={styles.prodBadge}>
          <Zap color={Colors.warning} size={11} strokeWidth={2.2} />
          <Text style={styles.prodBadgeText}>PRODUCTION ACCESS</Text>
        </View>
      )}

      <View style={styles.agentFooter}>
        <Text style={styles.engineText} numberOfLines={1}>{agent.engine}</Text>
        <ChevronRight color={Colors.mutedGray} size={16} strokeWidth={2} />
      </View>
    </TouchableOpacity>
  );
}

export default function AgentHubScreen() {
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const isCompact = screenWidth < 380;

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const filteredAgents = useMemo(() => {
    return searchQuery.trim() ? searchAgents(searchQuery) : IVX_DOMAIN_AGENTS;
  }, [searchQuery]);

  const totalTools = useMemo(() => getTotalTools(), []);
  const totalCaps = useMemo(() => getTotalCapabilities(), []);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 800);
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="agent-hub-back">
          <ArrowLeft size={22} color={Colors.textWhite} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>IVX Agent Hub</Text>
          <Text style={styles.headerSubtitle}>10 domain agents · {totalTools} tools · {totalCaps} capabilities</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={Colors.gold} />
        }
        keyboardShouldPersistTaps="handled"
      >
        {/* Stats banner */}
        <View style={styles.statsBanner}>
          <View style={styles.statsItem}>
            <Cpu color={Colors.officialGold} size={20} strokeWidth={2.2} />
            <Text style={styles.statsValue}>{IVX_DOMAIN_AGENTS.length}</Text>
            <Text style={styles.statsLabel}>Agents</Text>
          </View>
          <View style={styles.statsDivider} />
          <View style={styles.statsItem}>
            <Wrench color={Colors.officialGold} size={20} strokeWidth={2.2} />
            <Text style={styles.statsValue}>{totalTools}</Text>
            <Text style={styles.statsLabel}>Tools</Text>
          </View>
          <View style={styles.statsDivider} />
          <View style={styles.statsItem}>
            <CheckCircle2 color={Colors.officialGold} size={20} strokeWidth={2.2} />
            <Text style={styles.statsValue}>{totalCaps}</Text>
            <Text style={styles.statsLabel}>Verified</Text>
          </View>
          <View style={styles.statsDivider} />
          <View style={styles.statsItem}>
            <AlertTriangle color={Colors.officialGold} size={20} strokeWidth={2.2} />
            <Text style={styles.statsValue}>
              {IVX_DOMAIN_AGENTS.filter((a) => a.riskLevel === 'high').length}
            </Text>
            <Text style={styles.statsLabel}>High Risk</Text>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <Search color={Colors.mutedGray} size={18} strokeWidth={2} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search agents, tools, domains..."
            placeholderTextColor={Colors.mutedGray}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            testID="agent-search-input"
          />
        </View>

        {/* Agent grid */}
        <View style={styles.agentGrid}>
          {filteredAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onPress={() => router.push(`/agent-hub/${agent.id}` as never)}
              isCompact={isCompact}
            />
          ))}
        </View>

        {filteredAgents.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No agents found</Text>
            <Text style={styles.emptyBody}>Try a different search term.</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Each agent maps to a real backend engine.{'\n'}
            Tools reference live API endpoints. Capabilities are verified with production evidence.
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
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.textWhite,
    letterSpacing: -0.5},
  headerSubtitle: {
    fontSize: 12,
    color: Colors.mutedGray,
    marginTop: 2},
  content: {
    padding: 16,
    paddingBottom: 120},
  statsBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-around' as const,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 16,
    paddingVertical: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  statsItem: {
    alignItems: 'center' as const,
    flex: 1},
  statsValue: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.textWhite,
    marginTop: 6},
  statsLabel: {
    fontSize: 11,
    color: Colors.mutedGray,
    marginTop: 2},
  statsDivider: {
    width: 1,
    height: 40,
    backgroundColor: Colors.surfaceBorder},
  searchContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 10},
  searchInput: {
    flex: 1,
    color: Colors.textWhite,
    fontSize: 15,
    padding: 0},
  agentGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    justifyContent: 'space-between' as const,
    gap: 12},
  agentCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    minHeight: 200},
  agentHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 12},
  agentIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: 12},
  agentHeaderText: {
    flex: 1},
  agentNumber: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.mutedGray,
    letterSpacing: 0.5},
  agentName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.textWhite,
    marginTop: 1},
  agentRole: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginBottom: 10},
  agentMeta: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
    marginBottom: 8},
  metaPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8},
  metaPillText: {
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.3},
  agentStats: {
    flexDirection: 'row' as const,
    gap: 12,
    marginBottom: 8},
  statItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4},
  statText: {
    fontSize: 11,
    color: Colors.mutedGray},
  prodBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: 'rgba(245,158,11,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start' as const,
    marginBottom: 8},
  prodBadgeText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: Colors.warning,
    letterSpacing: 0.5},
  agentFooter: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: 8,
    marginTop: 4},
  engineText: {
    fontSize: 10,
    color: Colors.mutedGray,
    flex: 1},
  emptyState: {
    alignItems: 'center' as const,
    paddingVertical: 40},
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.textWhite},
  emptyBody: {
    fontSize: 13,
    color: Colors.mutedGray,
    marginTop: 4},
  footer: {
    marginTop: 24,
    alignItems: 'center' as const},
  footerText: {
    fontSize: 11,
    color: Colors.mutedGray,
    textAlign: 'center' as const,
    lineHeight: 17}});
