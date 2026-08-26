export type AutonomousAttribution = 'IVX AUTONOMOUS' | 'INTERNAL WORKER' | 'OWNER / EXTERNAL';

export type AutonomousJobLike = {
  ownerId?: string | null;
  input?: { ownerId?: string | null } | null;
};

const CAMPAIGN_PATTERNS = [
  /^campaign-agent-(\d+)$/i,
  /^completion-campaign:agent:(\d+)$/i,
] as const;

export function autonomousAgentNumber(job: AutonomousJobLike): number | null {
  const ownerId = String(job.ownerId || job.input?.ownerId || '').trim();
  for (const pattern of CAMPAIGN_PATTERNS) {
    const match = ownerId.match(pattern);
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    return Number.isFinite(value) && value >= 1 && value <= 112 ? value : null;
  }
  return null;
}

export function autonomousAttribution(job: AutonomousJobLike): AutonomousAttribution {
  const ownerId = String(job.ownerId || job.input?.ownerId || '').trim();
  if (autonomousAgentNumber(job) !== null) return 'IVX AUTONOMOUS';
  if (/^worker:/i.test(ownerId)) return 'INTERNAL WORKER';
  return 'OWNER / EXTERNAL';
}

export function isIVXAutonomousJob(job: AutonomousJobLike): boolean {
  return autonomousAgentNumber(job) !== null;
}
