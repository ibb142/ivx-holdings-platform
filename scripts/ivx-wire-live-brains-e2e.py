from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old in text:
        return text.replace(old, new, 1)
    if new in text:
        return text
    raise SystemExit(f'{label} anchor missing')


runtime_path = Path('backend/services/ivx-agent-runtime.ts')
s = runtime_path.read_text()

anchor = "import { type CompanyId, type DivisionId } from './ivx-enterprise-master-registry';\n"
imp = "import { getIVXAIConfigurationSnapshot, requestIVXAIText } from '../ivx-ai-runtime';\n"
if imp not in s:
    if anchor not in s:
        raise SystemExit('runtime import anchor missing')
    s = s.replace(anchor, anchor + imp, 1)

s = replace_once(
    s,
    "export const IVX_AGENT_RUNTIME_MARKER = 'ivx-agent-runtime-2026-07-27';",
    """export const IVX_AGENT_RUNTIME_MARKER = 'ivx-agent-runtime-2026-08-16-live-brain-v2';

const IVX_AGENT_BRAIN_ESCALATION_POLICY = [
  'Use the live IVX AI runtime for reasoning; deterministic template output is not a brain.',
  'Preserve agent identity, mission, memory namespace, permissions, tool limits, and owner-approval gates.',
  'Continuously improve reasoning, memory, tool use, reliability, and evidence without an artificial capability ceiling.',
  'Evaluate credible quantum computing, quantum-inspired optimization, agent orchestration, memory, and reasoning advances when relevant.',
  'Separate deployable technology from speculative research. Never represent simulation or fallback text as deployed capability.',
  'Never claim a tool or external action executed unless durable run evidence proves it.',
].join(' ');""",
    'runtime marker',
)

s = s.replace(
    "const toolsUsed = contract.allowedTools.slice(0, Math.min(3, contract.allowedTools.length));",
    "const toolsUsed: string[] = [];",
    1,
)

old_exec = """  const taskId = `direct-${agentId}-${startTime}`;
  const output = produceAgentOutput(contract, taskType, payload);

  const endTime = Date.now();
  const endISO = new Date(endTime).toISOString();
"""
new_exec = """  const taskId = `direct-${agentId}-${startTime}`;
  const requestId = `agent-brain-${agentId}-${startTime}`;
  const memoryContext = memResult.ok && memResult.record?.value
    ? memResult.record.value
    : 'No prior agent memory is available.';
  let aiResult: Awaited<ReturnType<typeof requestIVXAIText>>;
  try {
    aiResult = await requestIVXAIText({
      module: `enterprise-agent-${contract.agentNumber}`,
      requestId,
      system: `${contract.systemInstructions}\\n\\nCONTINUOUS BRAIN ESCALATION POLICY: ${IVX_AGENT_BRAIN_ESCALATION_POLICY}`,
      prompt: [
        `Agent: ${contract.agentNumber} ${contract.agentName}`,
        `Role: ${contract.roleName}`,
        `Division: ${contract.divisionId}`,
        `Company: ${contract.companyId}`,
        `Mission: ${contract.mission}`,
        `Task type: ${taskType}`,
        `Authorized tools (not automatically executed): ${contract.allowedTools.join(', ')}`,
        `Prior memory: ${memoryContext}`,
        `Task payload: ${JSON.stringify(payload)}`,
        'Return concise role-specific reasoning and the next safe action. Never claim a tool ran unless evidence proves execution.',
      ].join('\\n'),
      maxOutputTokens: 1200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Live IVX AI brain invocation failed';
    const endTime = Date.now();
    const endISO = new Date(endTime).toISOString();
    state.activeTaskId = null;
    state.availability = state.pauseState ? 'paused' : 'available';
    state.totalRuns += 1;
    state.failedRuns += 1;
    state.lastFailedRun = endISO;
    state.health = 'degraded';
    state.errorState = message;
    state.retryCount += 1;
    const failedRecord: AgentRunRecord = {
      runId: `run-${agentId}-${startTime}`,
      agentId,
      agentNumber: contract.agentNumber,
      agentName: contract.agentName,
      taskId,
      taskType,
      contractVersion: contract.version,
      instructionHash: contract.instructionHash,
      memoryNamespace: contract.memoryNamespace,
      queueNamespace: contract.queueNamespace,
      toolsAuthorized: contract.allowedTools,
      toolsUsed: [],
      startTime: startISO,
      endTime: endISO,
      durationMs: endTime - startTime,
      output: {
        brainMode: 'live_ivx_ai_runtime',
        requestId,
        providerConfigured: getIVXAIConfigurationSnapshot().configured,
      },
      evidence: [{ type: 'live_brain_failure', description: message, reference: requestId }],
      finalStatus: 'failed',
      error: message,
      ownerApprovalRecord: approvalRecord,
      commitSha: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT_SHA || null,
    };
    recordRun(failedRecord);
    return { ok: false, runRecord: failedRecord, error: message };
  }

  const output = {
    summary: aiResult.text.trim(),
    details: {
      brainMode: 'live_ivx_ai_runtime',
      requestId,
      providerMetadata: aiResult.providerMetadata,
      memoryLoaded: Boolean(memResult.record?.value),
      escalationPolicy: 'continuous_quantum_and_ai_discovery',
      payloadKeys: Object.keys(payload),
    },
  };

  const endTime = Date.now();
  const endISO = new Date(endTime).toISOString();
"""
s = replace_once(s, old_exec, new_exec, 'executeAgentRun')

old_ev = """    {
      type: 'output_artifact',
      description: output.summary,
      reference: `output-${agentId}-${startTime}`,
    },
  ];
"""
new_ev = """    {
      type: 'output_artifact',
      description: output.summary,
      reference: `output-${agentId}-${startTime}`,
    },
    {
      type: 'live_ai_provider',
      description: `Live IVX AI inference completed with ${aiResult.providerMetadata.provider} / ${aiResult.providerMetadata.model}`,
      reference: aiResult.providerMetadata.endpoint || requestId,
    },
    {
      type: 'brain_escalation_policy',
      description: 'Continuous AI plus quantum-technology discovery policy was loaded into this agent reasoning context.',
      reference: IVX_AGENT_RUNTIME_MARKER,
    },
  ];
"""
s = replace_once(s, old_ev, new_ev, 'evidence')

# Replace the success-path null SHA only; failure path already has a runtime SHA above.
pos = s.find("const runRecord: AgentRunRecord = {")
if pos < 0:
    raise SystemExit('success run record anchor missing')
tail = s[pos:]
tail = tail.replace(
    'commitSha: null,',
    'commitSha: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT_SHA || null,',
    1,
)
s = s[:pos] + tail

old_complete = """  // Update execution state
  completeTask(agentId, taskId, { status: 'completed' });

  return { ok: true, runRecord, error: null };
"""
new_complete = """  // This is a direct controlled run, not an inbox task. Update state directly.
  state.activeTaskId = null;
  state.availability = state.pauseState ? 'paused' : 'available';
  state.totalRuns += 1;
  state.successfulRuns += 1;
  state.lastSuccessfulRun = endISO;
  state.health = 'healthy';
  state.errorState = null;
  state.retryCount = 0;
  state.evidenceCount += evidence.length;

  return { ok: true, runRecord, error: null };
"""
s = replace_once(s, old_complete, new_complete, 'direct completion')

old_type = """  failedRuns: number;
  divisionA: { total: number; active: number; idle: number; paused: number; disabled: number };
"""
new_type = """  failedRuns: number;
  brain: {
    mode: 'live_ivx_ai_runtime';
    escalationEnabled: true;
    quantumDiscoveryEnabled: true;
    continuousImprovement: true;
    liveInferenceRequired: true;
    providerConfigured: boolean;
    model: string;
    endpoint: string | null;
    certificationStatus: 'LIVE_RUNTIME_WIRED_REQUIRES_100_WORKER_RERUN' | 'AI_PROVIDER_NOT_CONFIGURED';
  };
  divisionA: { total: number; active: number; idle: number; paused: number; disabled: number };
"""
s = replace_once(s, old_type, new_type, 'dashboard type')

old_fn = """export function generateDashboard(): EnterpriseAgentDashboard {
  const states = getAllExecutionStates();
  const contracts = ALL_AGENT_CONTRACTS;
"""
new_fn = """export function generateDashboard(): EnterpriseAgentDashboard {
  const states = getAllExecutionStates();
  const contracts = ALL_AGENT_CONTRACTS;
  const ai = getIVXAIConfigurationSnapshot();
"""
s = replace_once(s, old_fn, new_fn, 'dashboard function')

old_return = """    failedRuns: states.reduce((sum, s) => sum + s.failedRuns, 0),
    divisionA: {
"""
new_return = """    failedRuns: states.reduce((sum, s) => sum + s.failedRuns, 0),
    brain: {
      mode: 'live_ivx_ai_runtime',
      escalationEnabled: true,
      quantumDiscoveryEnabled: true,
      continuousImprovement: true,
      liveInferenceRequired: true,
      providerConfigured: ai.configured,
      model: ai.model,
      endpoint: ai.endpoint,
      certificationStatus: ai.configured
        ? 'LIVE_RUNTIME_WIRED_REQUIRES_100_WORKER_RERUN'
        : 'AI_PROVIDER_NOT_CONFIGURED',
    },
    divisionA: {
"""
s = replace_once(s, old_return, new_return, 'dashboard return')
runtime_path.write_text(s)


ui_path = Path('expo/app/ivx/autonomous-activity.tsx')
u = ui_path.read_text()

u = replace_once(
    u,
    """async function authHeaders(): Promise<Record<string, string>> {
  const token = await getIVXAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
""",
    """async function authHeaders(): Promise<Array<[string, string]>> {
  const token = await getIVXAccessToken();
  const headers: Array<[string, string]> = [['Content-Type', 'application/json']];
  if (token) headers.push(['Authorization', `Bearer ${token}`]);
  return headers;
}
""",
    'React Native fetch headers',
)

growth = """type GrowthOverview = {
  ideas: number;
  jvDeals: number;
  tokenizationConcepts: number;
  moduleSpecs: number;
  outreachDrafts: number;
};
"""
brain_type = growth + """
type AgentBrainDashboard = {
  totalAgents: number;
  brain?: {
    mode: string;
    escalationEnabled: boolean;
    quantumDiscoveryEnabled: boolean;
    continuousImprovement: boolean;
    liveInferenceRequired: boolean;
    providerConfigured: boolean;
    model: string;
    endpoint: string | null;
    certificationStatus: string;
  };
};
"""
if 'type AgentBrainDashboard' not in u:
    u = replace_once(u, growth, brain_type, 'AgentBrainDashboard type')

u = replace_once(
    u,
    """type ActivityData = {
  reports: ReportsResponse | null;
  growth: GrowthOverview | null;
  leads: StagedLead[];
};
""",
    """type ActivityData = {
  reports: ReportsResponse | null;
  growth: GrowthOverview | null;
  leads: StagedLead[];
  agentBrain: AgentBrainDashboard | null;
};
""",
    'ActivityData',
)

u = replace_once(
    u,
    """  const [reportsRes, growthRes, leadsRes] = await Promise.all([
    fetch(`${base}/api/ivx/autonomous-scale/reports?limit=50`, { headers }).catch(() => null),
    fetch(`${base}/api/growth/overview`, { headers }).catch(() => null),
    fetch(`${base}/api/growth/leads`, { headers }).catch(() => null),
  ]);
""",
    """  const [reportsRes, growthRes, leadsRes, agentBrainRes] = await Promise.all([
    fetch(`${base}/api/ivx/autonomous-scale/reports?limit=50`, { headers }).catch(() => null),
    fetch(`${base}/api/growth/overview`, { headers }).catch(() => null),
    fetch(`${base}/api/growth/leads`, { headers }).catch(() => null),
    fetch(`${base}/api/ivx/agents/dashboard`, { headers }).catch(() => null),
  ]);
""",
    'dashboard fetch',
)

u = replace_once(
    u,
    """  if (!reports && !growth && leads.length === 0) {
    throw new Error('Could not reach the autonomous endpoints. Confirm you are signed in as owner.');
  }

  return { reports, growth, leads };
""",
    """  let agentBrain: AgentBrainDashboard | null = null;
  if (agentBrainRes) {
    const json = (await agentBrainRes.json().catch(() => ({}))) as AgentBrainDashboard & { ok?: boolean };
    if (agentBrainRes.ok && json.ok !== false && typeof json.totalAgents === 'number') agentBrain = json;
  }

  if (!reports && !growth && leads.length === 0 && !agentBrain) {
    throw new Error('Could not reach the autonomous endpoints. Confirm you are signed in as owner.');
  }

  return { reports, growth, leads, agentBrain };
""",
    'dashboard return',
)

card_anchor = """            <View style={styles.card}>
              <Text style={styles.cardTitle}>Growth pipeline (where the work lands)</Text>
"""
if 'IA Brain Escalation' not in u:
    brain_card = """            <View style={styles.card}>
              <Text style={styles.cardTitle}>IA Brain Escalation</Text>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>Registered IA agents</Text><Text style={styles.pipeValue}>{data?.agentBrain?.totalAgents ?? 0}</Text></View>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>Brain mode</Text><Text style={styles.pipeValue}>{data?.agentBrain?.brain?.mode ?? 'not deployed'}</Text></View>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>Live inference required</Text><Text style={styles.pipeValue}>{data?.agentBrain?.brain?.liveInferenceRequired ? 'YES' : 'NO'}</Text></View>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>AI provider configured</Text><Text style={styles.pipeValue}>{data?.agentBrain?.brain?.providerConfigured ? 'YES' : 'NO'}</Text></View>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>Continuous improvement</Text><Text style={styles.pipeValue}>{data?.agentBrain?.brain?.continuousImprovement ? 'ON' : 'OFF'}</Text></View>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>Quantum technology discovery</Text><Text style={styles.pipeValue}>{data?.agentBrain?.brain?.quantumDiscoveryEnabled ? 'ON' : 'OFF'}</Text></View>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>Model</Text><Text style={styles.pipeValue}>{data?.agentBrain?.brain?.model ?? 'unknown'}</Text></View>
              <Text style={styles.cardBody}>Certificate: {data?.agentBrain?.brain?.certificationStatus ?? 'not deployed'}</Text>
            </View>

"""
    u = replace_once(u, card_anchor, brain_card + card_anchor, 'dashboard card')

ui_path.write_text(u)
