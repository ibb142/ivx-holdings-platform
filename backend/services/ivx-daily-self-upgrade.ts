/**
 * IVX DAILY AUTONOMOUS SELF-UPGRADE SCHEDULER
 *
 * The system runs an evidence-gated improvement cycle by:
 *   1. Reading fail-closed fleet truth (leases + heartbeats + capacity)
 *   2. Scoring the nine owner-requested operational capabilities
 *   3. Creating bounded corrective work from measured gaps
 *   4. Generating an optional evidence-grounded corrective plan
 *   5. Sending an optional owner summary
 *   6. Recording the result in the durable audit store
 *
 * This runs automatically every 24 hours, but can also be triggered
 * manually via POST /api/ivx/signalwire/self-upgrade
 */
import { randomUUID, createHash } from 'node:crypto';
import { requestIVXAIText, isIVXAIConfigured } from '../ivx-ai-runtime';
import { sendSMS, makeVoiceCall } from './ivx-signalwire-service';
import { getAutonomousTruthSnapshot } from './ivx-autonomous-truth-control';
import {
  buildAutonomousProjectManagerReport,
  type AutonomousProjectManagerReport,
} from './ivx-autonomous-project-manager';
import { runAutonomousDecisionQualityLoop } from './ivx-autonomous-decision-quality';
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
} from './ivx-durable-store';

export const IVX_SELF_UPGRADE_MARKER = 'ivx-daily-self-upgrade-v2-evidence-gated-2026-09-07';
export const IVX_SELF_UPGRADE_VERSION = '2.0.0';

const SELF_UPGRADE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const OWNER_PHONE = process.env['IVX_OWNER_PHONE']?.trim() ?? '';
const UPGRADE_LOG_KEY = 'self-upgrade/daily-upgrade-log.json';

export type SelfUpgradeResult = {
  upgradeId: string;
  timestamp: string;
  success: boolean;
  verified10of10: boolean;
  phases: {
    agentFleetReview: {
      ok: boolean;
      totalAgents: number;
      workingAgents: number;
      distinctActiveLeases: number;
      freshHeartbeatAgents: number;
      deployedConcurrency: number;
      details: string;
    };
    codeExecutionCert: { ok: boolean; proofHash: string | null; details: string };
    correctiveWork: {
      ok: boolean;
      createdTaskIds: string[];
      createdTaskKeys: string[];
      skipped: string[];
      error: string | null;
      details: string;
    };
    capabilityAudit: AutonomousProjectManagerReport['capabilityCertification'];
    aiBrainUpgrade: { ok: boolean; upgradeText: string; planOnly: true; details: string };
    ownerNotification: { ok: boolean; smsSid: string | null; voiceSid: string | null; details: string };
  };
  summary: string;
  proofHash: string;
  durationMs: number;
};

export type UpgradeLogEntry = {
  upgradeId: string;
  timestamp: string;
  success: boolean;
  verified10of10: boolean;
  capabilityScoreOutOf10: number;
  summary: string;
  proofHash: string;
};

// Fast process cache backed by the durable Supabase document store.
const upgradeLog: UpgradeLogEntry[] = [];
const MAX_LOG_ENTRIES = 30;
let logHydrated = false;
let logHydration: Promise<void> | null = null;

async function hydrateUpgradeLog(): Promise<void> {
  if (logHydrated || !isDurableStoreConfigured()) return;
  if (!logHydration) {
    logHydration = readDurableJson<UpgradeLogEntry[]>(UPGRADE_LOG_KEY, [])
      .then((stored) => {
        upgradeLog.splice(0, upgradeLog.length, ...stored.slice(0, MAX_LOG_ENTRIES));
        logHydrated = true;
      })
      .catch((error) => {
        console.warn('[IVX Self-Upgrade] Durable log hydration failed:', error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        logHydration = null;
      });
  }
  await logHydration;
}

async function persistUpgradeLog(): Promise<void> {
  if (!isDurableStoreConfigured()) return;
  await writeDurableJson(UPGRADE_LOG_KEY, upgradeLog.slice(0, MAX_LOG_ENTRIES));
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Phase 1: Review the 112 IA agent fleet
 * Reads the fail-closed truth contract. Registry membership alone is not work.
 */
async function reviewAgentFleet(): Promise<SelfUpgradeResult['phases']['agentFleetReview']> {
  try {
    const truth = await getAutonomousTruthSnapshot();
    const totalAgents = truth.agents.rows.length;
    const workingAgents = truth.certification.workingAgents;
    const distinctActiveLeases = truth.certification.distinctActiveLeases;
    const freshHeartbeatAgents = truth.certification.freshHeartbeatAgents;
    const deployedConcurrency = truth.autonomous.maxConcurrency;
    const ok = truth.certification.continuousRuntimeCertified;
    const details = ok
      ? `Fleet VERIFIED: ${workingAgents}/112 working with ${distinctActiveLeases} distinct leases, ${freshHeartbeatAgents} fresh heartbeats and deployed concurrency ${deployedConcurrency}.`
      : `Fleet NOT VERIFIED: registered=${totalAgents}/112, working=${workingAgents}/112, leases=${distinctActiveLeases}/112, freshHeartbeats=${freshHeartbeatAgents}/112, deployedConcurrency=${deployedConcurrency}/112; ${truth.certification.reason}`;

    return { ok, totalAgents, workingAgents, distinctActiveLeases, freshHeartbeatAgents, deployedConcurrency, details };
  } catch (err) {
    return {
      ok: false,
      totalAgents: 0,
      workingAgents: 0,
      distinctActiveLeases: 0,
      freshHeartbeatAgents: 0,
      deployedConcurrency: 0,
      details: `Fleet truth review failed closed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Phase 2: Read the exact evidence-gated execution score.
 * One generated file from one sample agent is never called a 112-agent cert.
 */
function runCodeExecutionCert(report: AutonomousProjectManagerReport): { ok: boolean; proofHash: string | null; details: string } {
  const skill = report.capabilityCertification.capabilities.find((item) => item.id === 'skill');
  const ok = skill?.status === 'VERIFIED_10_10';
  const proofHash = skill ? sha256(JSON.stringify({ sourceSha: report.sourceSha, evidence: skill.evidence })) : null;
  const details = skill
    ? `Evidence-gated execution skill: ${skill.scoreOutOf10}/10 (${skill.status}); sourceSha=${report.sourceSha}; proof=${proofHash}. No synthetic file was generated and one sample agent was not used to certify 112 agents.`
    : 'Evidence-gated execution skill is missing from the capability report.';
  return { ok, proofHash, details };
}

/**
 * Phase 3: AI-assisted corrective planning.
 * Generating text is a plan, never proof that the system upgraded itself.
 */
async function runAIBrainUpgrade(
  report: AutonomousProjectManagerReport,
  fleetReview: SelfUpgradeResult['phases']['agentFleetReview'],
): Promise<SelfUpgradeResult['phases']['aiBrainUpgrade']> {
  if (!isIVXAIConfigured()) {
    return { ok: false, upgradeText: '', planOnly: true, details: 'AI not configured; no corrective plan was generated.' };
  }

  try {
    const systemPrompt = `You are the I V X Holdings Autonomous Project Manager performing a daily evidence review. The supplied JSON is the only accepted current state. Never claim that an agent is working, a capability is upgraded, or a task is complete unless the JSON explicitly verifies it. Generate a concise corrective plan. Focus on:
1. What the 112 I A agents should focus on today
2. Any code quality or deployment improvements
3. New features or capabilities to add
4. Risk areas to monitor

Keep it to 3-4 sentences. Be specific and actionable.`;

    const today = new Date().toISOString().split('T')[0];
    const prompt = `Daily self-upgrade planning for ${today}. Evidence: ${JSON.stringify({
      sourceSha: report.sourceSha,
      fleet: {
        certified: fleetReview.ok,
        registered: fleetReview.totalAgents,
        working: fleetReview.workingAgents,
        leases: fleetReview.distinctActiveLeases,
        heartbeats: fleetReview.freshHeartbeatAgents,
        deployedConcurrency: fleetReview.deployedConcurrency,
      },
      allNineTenOfTenVerified: report.capabilityCertification.allNineTenOfTenVerified,
      capabilityScoreOutOf10: report.capabilityCertification.scoreOutOf10,
      capabilities: report.capabilityCertification.capabilities.map((item) => ({
        id: item.id,
        scoreOutOf10: item.scoreOutOf10,
        status: item.status,
        blockers: item.blockers,
      })),
      nextActions: report.nextActions.slice(0, 5),
    })}. Generate today's evidence-bounded improvement plan; do not describe the plan itself as a completed upgrade.`;

    const result = await requestIVXAIText({
      module: 'self-upgrade' as any,
      system: systemPrompt,
      prompt,
      maxOutputTokens: 300,
    });

    const upgradeText = (result.text || '').trim();
    const ok = upgradeText.length > 20;
    const details = `AI corrective plan: ${ok ? 'generated' : 'empty'} (${upgradeText.length} chars). Plan generation alone is not upgrade proof.`;

    return { ok, upgradeText, planOnly: true, details };
  } catch (err) {
    return { ok: false, upgradeText: '', planOnly: true, details: `AI corrective planning failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Phase 4: Notify the owner via SMS + voice call
 */
async function notifyOwner(upgradeSummary: string): Promise<{ ok: boolean; smsSid: string | null; voiceSid: string | null; details: string }> {
  if (!OWNER_PHONE) {
    return { ok: false, smsSid: null, voiceSid: null, details: 'Owner notification skipped: IVX_OWNER_PHONE is not configured.' };
  }
  const ts = new Date().toISOString();
  const smsBody = `IVX Daily Self-Upgrade Review — ${ts}. ${upgradeSummary.substring(0, 100)}`;
  const voiceMessage = `Hello, this is I V X Holdings Autonomous with your daily evidence review. ${upgradeSummary.substring(0, 200)} You can ask me questions about I V X Holdings now.`;

  const [smsResult, voiceResult] = await Promise.all([
    sendSMS(OWNER_PHONE, smsBody),
    makeVoiceCall(OWNER_PHONE, { message: voiceMessage }),
  ]);

  const ok = smsResult.ok && voiceResult.ok;
  const details = `SMS: ${smsResult.ok ? 'sent' : 'failed'} (${smsResult.sid || 'no sid'}), Voice: ${voiceResult.ok ? 'connected' : 'failed'} (${voiceResult.sid || 'no sid'})`;

  return { ok, smsSid: smsResult.sid, voiceSid: voiceResult.sid, details };
}

/**
 * Run the full daily self-upgrade cycle.
 */
export async function runDailySelfUpgrade(): Promise<SelfUpgradeResult> {
  const start = Date.now();
  const upgradeId = `ivx-self-upgrade-${randomUUID().slice(0, 8)}`;
  const timestamp = new Date().toISOString();

  console.log(`[IVX Self-Upgrade] Starting daily upgrade ${upgradeId}...`);
  await hydrateUpgradeLog();

  // Phase 1: Review agent fleet through the fail-closed truth contract.
  const fleetReview = await reviewAgentFleet();
  console.log(`[IVX Self-Upgrade] Phase 1 (fleet review): ${fleetReview.details}`);

  // Phase 2: Audit all nine capabilities from objectives, tasks and evidence.
  const projectManagerReport = await buildAutonomousProjectManagerReport();

  // Phase 3: Convert measured gaps into bounded, idempotent corrective work.
  const decisionLoop = await runAutonomousDecisionQualityLoop(projectManagerReport.sourceSha, true);
  const correctiveWork: SelfUpgradeResult['phases']['correctiveWork'] = {
    ok: decisionLoop.ok,
    createdTaskIds: decisionLoop.correctiveTaskIds,
    createdTaskKeys: decisionLoop.correctiveTaskKeys,
    skipped: decisionLoop.skipped,
    error: decisionLoop.error,
    details: decisionLoop.ok
      ? `Corrective loop completed: created=${decisionLoop.correctiveTaskIds.length}, skipped=${decisionLoop.skipped.length}. Tasks still require normal evidence, QA and owner gates before completion.`
      : `Corrective loop failed closed: ${decisionLoop.error ?? 'unknown error'}`,
  };
  console.log(`[IVX Self-Upgrade] Phase 3 (corrective work): ${correctiveWork.details}`);

  // Phase 4: Read exact execution proof. Do not manufacture a proof file.
  const codeCert = runCodeExecutionCert(projectManagerReport);
  console.log(`[IVX Self-Upgrade] Phase 4 (code cert): ${codeCert.details}`);

  // Phase 5: Generate a grounded corrective plan. Text is not completion proof.
  const brainUpgrade = await runAIBrainUpgrade(projectManagerReport, fleetReview);
  console.log(`[IVX Self-Upgrade] Phase 5 (corrective plan): ${brainUpgrade.details}`);

  // Build summary
  const verified10of10 = projectManagerReport.capabilityCertification.allNineTenOfTenVerified;
  const upgradeSummary = `Fleet: ${fleetReview.workingAgents}/112 working (${fleetReview.distinctActiveLeases} leases, ${fleetReview.freshHeartbeatAgents} fresh heartbeats). Nine-capability score: ${projectManagerReport.capabilityCertification.scoreOutOf10}/10; exact 10/10: ${verified10of10 ? 'VERIFIED' : 'NOT VERIFIED'}. Corrective plan: ${brainUpgrade.ok ? 'generated' : 'unavailable'}. ${brainUpgrade.upgradeText.substring(0, 150)}`;

  // Phase 6: Notify owner
  const notification = await notifyOwner(upgradeSummary);
  console.log(`[IVX Self-Upgrade] Phase 6 (notify): ${notification.details}`);

  const success = fleetReview.ok && codeCert.ok && correctiveWork.ok && verified10of10;
  const proofHash = sha256(`${upgradeId}|${timestamp}|${fleetReview.totalAgents}|${codeCert.proofHash || ''}|${success}`);

  const result: SelfUpgradeResult = {
    upgradeId,
    timestamp,
    success,
    verified10of10,
    phases: {
      agentFleetReview: fleetReview,
      codeExecutionCert: codeCert,
      correctiveWork,
      capabilityAudit: projectManagerReport.capabilityCertification,
      aiBrainUpgrade: brainUpgrade,
      ownerNotification: notification,
    },
    summary: upgradeSummary,
    proofHash,
    durationMs: Date.now() - start,
  };

  // Add to log
  upgradeLog.unshift({
    upgradeId,
    timestamp,
    success,
    verified10of10,
    capabilityScoreOutOf10: projectManagerReport.capabilityCertification.scoreOutOf10,
    summary: upgradeSummary,
    proofHash,
  });
  if (upgradeLog.length > MAX_LOG_ENTRIES) {
    upgradeLog.length = MAX_LOG_ENTRIES;
  }
  await persistUpgradeLog().catch((error) => {
    console.error('[IVX Self-Upgrade] Durable log persistence failed:', error instanceof Error ? error.message : String(error));
  });

  console.log(`[IVX Self-Upgrade] Complete: ${upgradeId} success=${success} duration=${result.durationMs}ms`);

  return result;
}

/**
 * Get the upgrade log (last N entries).
 */
export function getUpgradeLog(limit = 10): UpgradeLogEntry[] {
  void hydrateUpgradeLog();
  return upgradeLog.slice(0, limit);
}

/**
 * Get self-upgrade status.
 */
export function getSelfUpgradeStatus() {
  void hydrateUpgradeLog();
  return {
    ok: true,
    marker: IVX_SELF_UPGRADE_MARKER,
    version: IVX_SELF_UPGRADE_VERSION,
    intervalMs: SELF_UPGRADE_INTERVAL_MS,
    intervalHours: SELF_UPGRADE_INTERVAL_MS / (60 * 60 * 1000),
    lastUpgrade: upgradeLog[0] || null,
    totalUpgrades: upgradeLog.length,
    log: upgradeLog.slice(0, 5),
    capabilities: {
      agentFleetReview: true,
      codeExecutionCert: true,
      aiBrainUpgrade: isIVXAIConfigured(),
      boundedCorrectiveWork: true,
      ownerNotification: true,
      evidenceBackedNineCapabilityGate: true,
      durableUpgradeLog: isDurableStoreConfigured(),
    },
    timestamp: new Date().toISOString(),
  };
}

let schedulerStarted = false;

/**
 * Start the daily self-upgrade scheduler.
 * Runs every 24 hours automatically.
 */
export function startSelfUpgradeScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  void hydrateUpgradeLog();

  // Run first upgrade after 60 seconds (let the server boot fully)
  setTimeout(() => {
    runDailySelfUpgrade().catch((err) => {
      console.error('[IVX Self-Upgrade] First run failed:', err instanceof Error ? err.message : err);
    });
  }, 60_000);

  // Schedule recurring upgrades every 24 hours
  setInterval(() => {
    runDailySelfUpgrade().catch((err) => {
      console.error('[IVX Self-Upgrade] Scheduled run failed:', err instanceof Error ? err.message : err);
    });
  }, SELF_UPGRADE_INTERVAL_MS);

  console.log(`[IVX Self-Upgrade] Scheduler started — runs every ${SELF_UPGRADE_INTERVAL_MS / (60 * 60 * 1000)} hours`);
}
