/**
 * IVX AI Engineering Command Center — Owner-only dashboard.
 *
 * Displays all 12 AI agents with seniority scores, assigned developer roles,
 * task ledger, ownership rules, and drill-down capability details.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  Modal,
  StyleSheet,
  FlatList,
  Linking} from "react-native";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { router } from 'expo-router';
import {
  getAgentAuditOverview,
  createTaskLedgerEntry,
  type AgentAuditResult,
  type AgentAuditOverview,
  type CapabilityScore,
  type SeniorityLevel,
  type TaskLedgerEntry} from '@/src/modules/ivx-owner-ai/services/ivxAgentAuditService';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const GOLD = '#FFD700';
const GREEN = '#00C48C';
const RED = '#FF4D4D';
const BLUE = '#4A90D9';
const DARK_BG = '#0A0A0F';
const CARD_BG = '#15151F';
const CARD_BORDER = '#252535';

const SENIORITY_COLORS: Record<SeniorityLevel, string> = {
  SENIOR: GREEN,
  MID: GOLD,
  JUNIOR: BLUE,
  NOT_A_DEVELOPER: RED};

const SCORE_COLORS: Record<CapabilityScore, string> = {
  PASS: GREEN,
  PARTIAL: GOLD,
  FAIL: RED,
  NOT_CONFIGURED: '#666'};

const STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: '#666',
  ANALYZING: BLUE,
  IN_PROGRESS: GOLD,
  CODE_COMPLETE: BLUE,
  REVIEW_REQUIRED: GOLD,
  TEST_FAILED: RED,
  TEST_PASSED: GREEN,
  DEPLOYMENT_FAILED: RED,
  DEPLOYED: BLUE,
  PRODUCTION_VERIFIED: GREEN,
  BLOCKED: RED,
  REJECTED: RED};

type AgentFilter = 'all' | SeniorityLevel;
type LedgerFilter = 'all' | 'completed' | 'failed' | 'blocked' | 'deployed' | 'verified';

export default function AgentCommandCenterScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const queryClient = useQueryClient();
  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all');
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>('all');
  const [selectedAgent, setSelectedAgent] = useState<AgentAuditResult | null>(null);
  const [showLedger, setShowLedger] = useState(false);

  const auditQuery = useQuery<AgentAuditOverview>({
    queryKey: ['ivx-agent-audit', 'overview'],
    queryFn: getAgentAuditOverview});

  const onRefresh = useCallback(() => {
    void auditQuery.refetch();
  }, [auditQuery]);

  const createTaskMutation = useMutation({
    mutationFn: (input: { title: string; module: string; assignedAI: number; reviewingAI: number; priority: 'critical' | 'high' | 'medium' | 'low' }) =>
      createTaskLedgerEntry(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ivx-agent-audit', 'overview'] });
    }});

  const data = auditQuery.data;
  const summary = data?.summary;
  const agents = data?.agents ?? [];
  const ledger = data?.taskLedger ?? [];

  const filteredAgents = useMemo(() => {
    if (agentFilter === 'all') return agents;
    return agents.filter((a) => a.seniority === agentFilter);
  }, [agents, agentFilter]);

  const filteredLedger = useMemo(() => {
    if (ledgerFilter === 'all') return ledger;
    if (ledgerFilter === 'completed') return ledger.filter((t) => t.status === 'PRODUCTION_VERIFIED');
    if (ledgerFilter === 'failed') return ledger.filter((t) => t.status === 'TEST_FAILED' || t.status === 'DEPLOYMENT_FAILED' || t.status === 'REJECTED');
    if (ledgerFilter === 'blocked') return ledger.filter((t) => t.status === 'BLOCKED');
    if (ledgerFilter === 'deployed') return ledger.filter((t) => t.status === 'DEPLOYED' || t.status === 'PRODUCTION_VERIFIED');
    if (ledgerFilter === 'verified') return ledger.filter((t) => t.status === 'PRODUCTION_VERIFIED');
    return ledger;
  }, [ledger, ledgerFilter]);

  if (auditQuery.isLoading && !data) {
    return (
      <View style={styles.loadingContainer}>
        <ShimmerIndicator size="large" color={GOLD} />
        <Text style={styles.loadingText}>Loading AI Engineering Command Center…</Text>
      </View>
    );
  }

  if (auditQuery.error && !data) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorTitle}>Failed to load command center</Text>
        <Text style={styles.errorBody}>
          {auditQuery.error instanceof Error ? auditQuery.error.message : 'Unknown error'}
        </Text>
        <Pressable style={styles.retryBtn} onPress={onRefresh}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl tintColor={GOLD} refreshing={auditQuery.isFetching} onRefresh={onRefresh} />}
      testID="agent-command-center-scroll"
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="command-center-back">
          <Text style={styles.backBtn}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>IVX AI Engineering</Text>
        <Text style={styles.headerSubtitle}>Command Center</Text>
      </View>

      {/* Executive Summary */}
      {summary && (
        <View style={styles.summaryCard} testID="command-center-summary">
          <View style={styles.summaryRow}>
            <View style={styles.summaryTile}>
              <Text style={[styles.summaryValue, { color: GREEN }]}>{summary.seniorCount}</Text>
              <Text style={styles.summaryLabel}>Senior</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={[styles.summaryValue, { color: GOLD }]}>{summary.midCount}</Text>
              <Text style={styles.summaryLabel}>Mid-level</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={[styles.summaryValue, { color: BLUE }]}>{summary.juniorCount}</Text>
              <Text style={styles.summaryLabel}>Junior</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={[styles.summaryValue, { color: RED }]}>{summary.notDeveloperCount}</Text>
              <Text style={styles.summaryLabel}>Non-dev</Text>
            </View>
          </View>
          <View style={styles.summaryRow}>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValueSmall}>{summary.withRepoExecution}</Text>
              <Text style={styles.summaryLabel}>Code exec</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValueSmall}>{summary.withDeploymentCapability}</Text>
              <Text style={styles.summaryLabel}>Deploy</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValueSmall}>{summary.withProductionEvidence}</Text>
              <Text style={styles.summaryLabel}>Evidence</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValueSmall}>{summary.totalAgents}</Text>
              <Text style={styles.summaryLabel}>Total</Text>
            </View>
          </View>
          {summary.criticalGaps.length > 0 && (
            <View style={styles.gapsContainer}>
              <Text style={styles.gapsTitle}>Critical Gaps</Text>
              {summary.criticalGaps.map((gap, i) => (
                <Text key={i} style={styles.gapItem}>• {gap}</Text>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Agent Filter */}
      <View style={styles.filterRow}>
        {(['all', 'SENIOR', 'MID', 'JUNIOR', 'NOT_A_DEVELOPER'] as AgentFilter[]).map((f) => (
          <Pressable
            key={f}
            style={[styles.filterChip, agentFilter === f && styles.filterChipActive]}
            onPress={() => setAgentFilter(f)}
          >
            <Text style={[styles.filterText, agentFilter === f && styles.filterTextActive]}>
              {f === 'all' ? 'All' : f === 'NOT_A_DEVELOPER' ? 'Non-dev' : f.charAt(0) + f.slice(1).toLowerCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Agent Cards */}
      <View style={styles.agentsContainer} testID="command-center-agents">
        {filteredAgents.map((agent) => (
          <Pressable
            key={agent.executiveAgentId}
            style={styles.agentCard}
            onPress={() => setSelectedAgent(agent)}
            testID={`agent-audit-card-${agent.agentNumber}`}
          >
            <View style={styles.agentCardHeader}>
              <View style={styles.agentNumberBadge}>
                <Text style={styles.agentNumberText}>AI {agent.agentNumber}</Text>
              </View>
              <View style={[styles.seniorityBadge, { backgroundColor: SENIORITY_COLORS[agent.seniority] + '20', borderColor: SENIORITY_COLORS[agent.seniority] }]}>
                <Text style={[styles.seniorityText, { color: SENIORITY_COLORS[agent.seniority] }]}>
                  {agent.seniority.replace(/_/g, ' ')}
                </Text>
              </View>
            </View>
            <Text style={styles.agentName}>{agent.currentName}</Text>
            <Text style={styles.agentRole}>{agent.assignedRoleTitle}</Text>
            <View style={styles.scoreBar}>
              <View style={[styles.scoreBarFill, { width: `${agent.scorePercentage}%`, backgroundColor: SENIORITY_COLORS[agent.seniority] }]} />
            </View>
            <Text style={styles.scoreText}>{agent.scorePercentage}% senior developer score</Text>
            <Text style={styles.agentGap} numberOfLines={2}>{agent.mainGap}</Text>
            <View style={styles.agentMetaRow}>
              <Text style={styles.agentMeta}>Tools: {agent.allowedTools.length}</Text>
              <Text style={styles.agentMeta}>Risk: {agent.riskLevel}</Text>
              <Text style={styles.agentMeta}>{agent.canExecuteCode ? 'Can code' : 'Analysis only'}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      {/* Task Ledger Toggle */}
      <Pressable
        style={styles.ledgerToggle}
        onPress={() => setShowLedger(!showLedger)}
        testID="command-center-ledger-toggle"
      >
        <Text style={styles.ledgerToggleText}>
          {showLedger ? '▼' : '▶'} Task Ledger ({ledger.length})
        </Text>
      </Pressable>

      {showLedger && (
        <View style={styles.ledgerContainer} testID="command-center-ledger">
          <View style={styles.ledgerFilterRow}>
            {(['all', 'completed', 'failed', 'blocked', 'deployed', 'verified'] as LedgerFilter[]).map((f) => (
              <Pressable
                key={f}
                style={[styles.filterChip, ledgerFilter === f && styles.filterChipActive]}
                onPress={() => setLedgerFilter(f)}
              >
                <Text style={[styles.filterText, ledgerFilter === f && styles.filterTextActive]}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
          {filteredLedger.length === 0 ? (
            <Text style={styles.emptyText}>No tasks in ledger. Tasks appear here as agents are assigned work.</Text>
          ) : (
            filteredLedger.map((task) => <TaskLedgerRow key={task.taskId} task={task} />)
          )}
        </View>
      )}

      {/* Ownership Rules */}
      {data && (
        <View style={styles.rulesContainer} testID="command-center-rules">
          <Text style={styles.rulesTitle}>Ownership Rules</Text>
          {data.ownershipRules.map((rule, i) => (
            <Text key={i} style={styles.ruleItem}>{i + 1}. {rule}</Text>
          ))}
        </View>
      )}

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Marker: {data?.marker ?? 'N/A'} · Generated: {data?.generatedAt ? new Date(data.generatedAt).toUTCString() : 'N/A'}
        </Text>
      </View>

      {/* Agent Detail Modal */}
      <Modal
        visible={selectedAgent !== null}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedAgent(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedAgent && (
              <ScrollView testID="agent-detail-modal">
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>AI {selectedAgent.agentNumber}: {selectedAgent.currentName}</Text>
                  <Pressable onPress={() => setSelectedAgent(null)} testID="agent-detail-close">
                    <Text style={styles.modalCloseBtn}>✕</Text>
                  </Pressable>
                </View>

                <Text style={styles.modalSection}>Assigned Role</Text>
                <Text style={styles.modalRoleText}>{selectedAgent.assignedRoleTitle}</Text>

                <Text style={styles.modalSection}>Current Engine</Text>
                <Text style={styles.modalMetaText}>{selectedAgent.currentEngine}</Text>

                <Text style={styles.modalSection}>Framework Agent</Text>
                <Text style={styles.modalMetaText}>{selectedAgent.frameworkAgentId} (risk: {selectedAgent.riskLevel})</Text>

                <Text style={styles.modalSection}>Allowed Tools</Text>
                <Text style={styles.modalMetaText}>{selectedAgent.allowedTools.join(', ') || 'none'}</Text>

                <Text style={styles.modalSection}>Files Owned</Text>
                {selectedAgent.filesOwned.map((f, i) => (
                  <Text key={i} style={styles.modalFileText}>• {f}</Text>
                ))}

                <Text style={styles.modalSection}>Current Blocker</Text>
                <Text style={[styles.modalMetaText, { color: RED }]}>{selectedAgent.currentBlocker}</Text>

                <Text style={styles.modalSection}>Main Gap</Text>
                <Text style={[styles.modalMetaText, { color: GOLD }]}>{selectedAgent.mainGap}</Text>

                <Text style={styles.modalSection}>20-Capability Scorecard</Text>
                <Text style={styles.modalScoreText}>Overall: {selectedAgent.scorePercentage}% · {selectedAgent.seniority.replace(/_/g, ' ')}</Text>

                {selectedAgent.capabilities.map((cap, i) => (
                  <View key={i} style={styles.capabilityRow}>
                    <View style={[styles.capabilityDot, { backgroundColor: SCORE_COLORS[cap.score] }]} />
                    <View style={styles.capabilityContent}>
                      <Text style={styles.capabilityName}>{i + 1}. {cap.capability}</Text>
                      <Text style={[styles.capabilityScore, { color: SCORE_COLORS[cap.score] }]}>
                        {cap.score}
                      </Text>
                      <Text style={styles.capabilityEvidence}>{cap.evidence}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function TaskLedgerRow({ task }: { task: TaskLedgerEntry }) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = STATUS_COLORS[task.status] ?? '#666';

  return (
    <Pressable
      style={styles.ledgerRow}
      onPress={() => setExpanded(!expanded)}
      testID={`ledger-row-${task.taskId}`}
    >
      <View style={styles.ledgerHeader}>
        <View style={[styles.ledgerStatusDot, { backgroundColor: statusColor }]} />
        <Text style={styles.ledgerTitle} numberOfLines={1}>{task.title || task.taskId}</Text>
        <Text style={[styles.ledgerStatus, { color: statusColor }]}>{task.status.replace(/_/g, ' ')}</Text>
      </View>
      <Text style={styles.ledgerMeta}>
        AI {task.assignedAI} → Review AI {task.reviewingAI} · {task.priority} · {task.module}
      </Text>
      {expanded && (
        <View style={styles.ledgerDetail}>
          {task.startTime && <Text style={styles.ledgerDetailText}>Start: {task.startTime}</Text>}
          {task.lastActivityTime && <Text style={styles.ledgerDetailText}>Last activity: {task.lastActivityTime}</Text>}
          {task.commitSha && <Text style={styles.ledgerDetailText}>Commit: {task.commitSha.slice(0, 12)}</Text>}
          {task.deploymentId && <Text style={styles.ledgerDetailText}>Deploy ID: {task.deploymentId}</Text>}
          {task.testCommand && <Text style={styles.ledgerDetailText}>Test: {task.testCommand}</Text>}
          {task.testResult && <Text style={styles.ledgerDetailText}>Test result: {task.testResult}</Text>}
          {task.productionUrl && <Text style={styles.ledgerDetailText}>URL: {task.productionUrl}</Text>}
          {task.blocker && <Text style={[styles.ledgerDetailText, { color: RED }]}>Blocker: {task.blocker}</Text>}
          {task.verificationEvidence && <Text style={[styles.ledgerDetailText, { color: GREEN }]}>Evidence: {task.verificationEvidence}</Text>}
          {task.filesChanged.length > 0 && (
            <View>
              <Text style={styles.ledgerDetailText}>Files changed:</Text>
              {task.filesChanged.map((f, i) => <Text key={i} style={styles.ledgerFile}>  • {f}</Text>)}
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DARK_BG },
  loadingContainer: { flex: 1, backgroundColor: DARK_BG, justifyContent: 'center', alignItems: 'center', padding: 24 },
  loadingText: { color: GOLD, fontSize: 16, marginTop: 12, fontWeight: '600' as const },
  errorTitle: { color: RED, fontSize: 18, fontWeight: '700' as const, marginBottom: 8 },
  errorBody: { color: '#999', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn: { backgroundColor: GOLD, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  retryBtnText: { color: DARK_BG, fontWeight: '700' as const, fontSize: 14 },
  header: { padding: 20, paddingTop: 60, backgroundColor: CARD_BG, borderBottomWidth: 1, borderBottomColor: CARD_BORDER },
  backBtn: { color: GOLD, fontSize: 16, fontWeight: '600' as const, marginBottom: 8 },
  headerTitle: { color: GOLD, fontSize: 24, fontWeight: '800' as const },
  headerSubtitle: { color: '#FFF', fontSize: 16, fontWeight: '500' as const, marginTop: 2 },
  summaryCard: { backgroundColor: CARD_BG, margin: 12, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: CARD_BORDER },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 12 },
  summaryTile: { alignItems: 'center' },
  summaryValue: { fontSize: 28, fontWeight: '800' as const },
  summaryValueSmall: { fontSize: 20, fontWeight: '700' as const, color: '#FFF' },
  summaryLabel: { fontSize: 11, color: '#888', marginTop: 4 },
  gapsContainer: { marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: CARD_BORDER },
  gapsTitle: { color: RED, fontSize: 14, fontWeight: '700' as const, marginBottom: 6 },
  gapItem: { color: '#CCC', fontSize: 12, marginBottom: 4 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 6, marginBottom: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER },
  filterChipActive: { borderColor: GOLD, backgroundColor: GOLD + '15' },
  filterText: { color: '#888', fontSize: 12, fontWeight: '600' as const },
  filterTextActive: { color: GOLD },
  agentsContainer: { padding: 12, gap: 12 },
  agentCard: { backgroundColor: CARD_BG, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: CARD_BORDER },
  agentCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  agentNumberBadge: { backgroundColor: GOLD + '20', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  agentNumberText: { color: GOLD, fontSize: 11, fontWeight: '700' as const },
  seniorityBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  seniorityText: { fontSize: 11, fontWeight: '700' as const },
  agentName: { color: '#FFF', fontSize: 16, fontWeight: '700' as const, marginBottom: 2 },
  agentRole: { color: '#AAA', fontSize: 13, marginBottom: 8 },
  scoreBar: { height: 6, backgroundColor: '#333', borderRadius: 3, marginBottom: 4 },
  scoreBarFill: { height: 6, borderRadius: 3 },
  scoreText: { color: '#888', fontSize: 11, marginBottom: 6 },
  agentGap: { color: '#999', fontSize: 12, marginBottom: 8, lineHeight: 16 },
  agentMetaRow: { flexDirection: 'row', gap: 12 },
  agentMeta: { color: '#666', fontSize: 11 },
  ledgerToggle: { padding: 16, backgroundColor: CARD_BG, marginHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: CARD_BORDER },
  ledgerToggleText: { color: GOLD, fontSize: 16, fontWeight: '700' as const },
  ledgerContainer: { marginHorizontal: 12, marginBottom: 12, backgroundColor: CARD_BG, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: CARD_BORDER },
  ledgerFilterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  emptyText: { color: '#666', fontSize: 14, textAlign: 'center', padding: 16 },
  ledgerRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: CARD_BORDER },
  ledgerHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ledgerStatusDot: { width: 8, height: 8, borderRadius: 4 },
  ledgerTitle: { color: '#FFF', fontSize: 14, fontWeight: '600' as const, flex: 1 },
  ledgerStatus: { fontSize: 11, fontWeight: '700' as const },
  ledgerMeta: { color: '#888', fontSize: 11, marginTop: 4 },
  ledgerDetail: { marginTop: 8, paddingLeft: 16 },
  ledgerDetailText: { color: '#AAA', fontSize: 12, marginBottom: 4 },
  ledgerFile: { color: '#888', fontSize: 11, marginBottom: 2 },
  rulesContainer: { margin: 12, backgroundColor: CARD_BG, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: CARD_BORDER },
  rulesTitle: { color: GOLD, fontSize: 16, fontWeight: '700' as const, marginBottom: 8 },
  ruleItem: { color: '#CCC', fontSize: 12, marginBottom: 6, lineHeight: 16 },
  footer: { padding: 20, paddingBottom: 40 },
  footerText: { color: '#444', fontSize: 10, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: CARD_BG, height: '85%', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: GOLD, fontSize: 18, fontWeight: '800' as const, flex: 1 },
  modalCloseBtn: { color: '#FFF', fontSize: 24, fontWeight: '700' as const, paddingLeft: 16 },
  modalSection: { color: GOLD, fontSize: 13, fontWeight: '700' as const, marginTop: 16, marginBottom: 4 },
  modalRoleText: { color: '#FFF', fontSize: 16, fontWeight: '600' as const },
  modalMetaText: { color: '#AAA', fontSize: 13, lineHeight: 18 },
  modalFileText: { color: '#888', fontSize: 12, marginBottom: 2 },
  modalScoreText: { color: '#FFF', fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  capabilityRow: { flexDirection: 'row', marginBottom: 12, paddingRight: 8 },
  capabilityDot: { width: 10, height: 10, borderRadius: 5, marginTop: 3, marginRight: 8 },
  capabilityContent: { flex: 1 },
  capabilityName: { color: '#FFF', fontSize: 13, fontWeight: '500' as const, marginBottom: 2 },
  capabilityScore: { fontSize: 11, fontWeight: '700' as const, marginBottom: 2 },
  capabilityEvidence: { color: '#888', fontSize: 11, lineHeight: 15 }});
