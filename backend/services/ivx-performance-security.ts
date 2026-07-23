/**
 * IVX Performance & Cost Tracking — Phase 17
 * IVX Intelligence Security — Phase 18
 *
 * Phase 17: Measures time to first response, plan, first tool call, total duration,
 * model calls, tokens, retrieval/tool/verification latency, total cost.
 * Uses smaller models for simple tasks, stronger models only where needed.
 *
 * Phase 18: Protects against prompt injection, retrieved-document injection,
 * malicious code comments, secret extraction, tool escalation, owner-role spoofing,
 * memory poisoning, fake evidence, cross-project retrieval, unapproved writes,
 * hidden instructions in uploaded documents.
 */

import { randomUUID } from 'crypto';

// ─── Phase 17: Performance Tracking ───────────────────────────────

export type IVXPerformanceMetric = {
  metricId: string;
  taskId: string;
  phase: 'planning' | 'retrieval' | 'tool_execution' | 'ai_call' | 'verification' | 'response_build' | 'total';
  durationMs: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  timestamp: string;
};

const performanceMetrics: IVXPerformanceMetric[] = [];
const MAX_METRICS = 300;

export function recordPerformanceMetric(input: {
  taskId: string;
  phase: IVXPerformanceMetric['phase'];
  durationMs: number;
  modelCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
}): void {
  const metric: IVXPerformanceMetric = {
    metricId: randomUUID(),
    taskId: input.taskId,
    phase: input.phase,
    durationMs: input.durationMs,
    modelCalls: input.modelCalls || 0,
    inputTokens: input.inputTokens || 0,
    outputTokens: input.outputTokens || 0,
    estimatedCost: input.estimatedCost || 0,
    timestamp: new Date().toISOString(),
  };
  performanceMetrics.push(metric);
  if (performanceMetrics.length > MAX_METRICS) {
    performanceMetrics.shift();
  }
}

export type IVXPerformanceReport = {
  totalTasks: number;
  avgTimeToFirstResponse: number;
  avgTimeToPlan: number;
  avgTimeToFirstToolCall: number;
  avgTotalTaskDuration: number;
  totalModelCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCost: number;
  avgRetrievalLatency: number;
  avgToolLatency: number;
  avgVerificationLatency: number;
  byPhase: Record<string, { count: number; avgDuration: number; totalCost: number }>;
};

export function getPerformanceReport(): IVXPerformanceReport {
  const byTaskId = new Map<string, IVXPerformanceMetric[]>();
  for (const m of performanceMetrics) {
    if (!byTaskId.has(m.taskId)) byTaskId.set(m.taskId, []);
    byTaskId.get(m.taskId)!.push(m);
  }

  const taskIds = [...byTaskId.keys()];
  const taskMetrics = [...byTaskId.values()];

  const getAvg = (metrics: IVXPerformanceMetric[], phase: string) => {
    const filtered = metrics.filter((m) => m.phase === phase);
    if (filtered.length === 0) return 0;
    return filtered.reduce((sum, m) => sum + m.durationMs, 0) / filtered.length;
  };

  const byPhase: Record<string, { count: number; avgDuration: number; totalCost: number }> = {};
  for (const m of performanceMetrics) {
    if (!byPhase[m.phase]) byPhase[m.phase] = { count: 0, avgDuration: 0, totalCost: 0 };
    byPhase[m.phase].count++;
    byPhase[m.phase].totalCost += m.estimatedCost;
  }
  for (const phase of Object.keys(byPhase)) {
    byPhase[phase].avgDuration = byPhase[phase].count > 0
      ? performanceMetrics.filter((m) => m.phase === phase).reduce((sum, m) => sum + m.durationMs, 0) / byPhase[phase].count
      : 0;
  }

  return {
    totalTasks: taskIds.length,
    avgTimeToFirstResponse: taskMetrics.reduce((sum, m) => sum + getAvg(m, 'ai_call'), 0) / Math.max(1, taskMetrics.length),
    avgTimeToPlan: taskMetrics.reduce((sum, m) => sum + getAvg(m, 'planning'), 0) / Math.max(1, taskMetrics.length),
    avgTimeToFirstToolCall: taskMetrics.reduce((sum, m) => sum + getAvg(m, 'tool_execution'), 0) / Math.max(1, taskMetrics.length),
    avgTotalTaskDuration: taskMetrics.reduce((sum, m) => sum + getAvg(m, 'total'), 0) / Math.max(1, taskMetrics.length),
    totalModelCalls: performanceMetrics.reduce((sum, m) => sum + m.modelCalls, 0),
    totalInputTokens: performanceMetrics.reduce((sum, m) => sum + m.inputTokens, 0),
    totalOutputTokens: performanceMetrics.reduce((sum, m) => sum + m.outputTokens, 0),
    totalEstimatedCost: performanceMetrics.reduce((sum, m) => sum + m.estimatedCost, 0),
    avgRetrievalLatency: getAvg(performanceMetrics, 'retrieval'),
    avgToolLatency: getAvg(performanceMetrics, 'tool_execution'),
    avgVerificationLatency: getAvg(performanceMetrics, 'verification'),
    byPhase,
  };
}

// ─── Phase 18: Security ───────────────────────────────────────────

export type IVXSecurityCheck = {
  name: string;
  passed: boolean;
  detail: string;
  severity: 'info' | 'warning' | 'critical';
};

export type IVXSecurityScanResult = {
  checks: IVXSecurityCheck[];
  overallPassed: boolean;
  criticalFindings: string[];
  blockedContent: string[];
};

/**
 * Scan input text for prompt injection attempts.
 */
export function detectPromptInjection(text: string): { detected: boolean; patterns: string[]; sanitized: string } {
  const patterns: string[] = [];
  let sanitized = text;

  // System prompt override attempts
  if (/\b(ignore (all )?(previous |above )?instructions?|disregard (your |the )?(system |original )?prompt|you are now|new instructions?:)\b/i.test(text)) {
    patterns.push('system_prompt_override');
  }

  // Role switch attempts
  if (/\b(you are (now )?(an? )?(admin|owner|developer|root|superuser)|act as (an? )?(admin|owner|developer)|pretend you are)\b/i.test(text)) {
    patterns.push('role_escalation');
  }

  // Secret extraction attempts
  if (/\b(show (me )?(the )?(secret|api key|service role|password|token)|reveal (the )?(secret|key|token)|what is (the )?(service role|secret) key|print (the )?(env|environment|secrets?))\b/i.test(text)) {
    patterns.push('secret_extraction');
  }

  // Tool escalation attempts
  if (/\b(skip (the )?approval|bypass (the )?gate|don'?t ask for (permission|approval)|execute without (confirm|approval))\b/i.test(text)) {
    patterns.push('tool_escalation');
  }

  // Hidden instructions in markup
  if (/<!--\s*[^>]*(?:ignore|execute|deploy|delete|drop)\s*[^>]*-->|\/\*\s*[^*]*(?:ignore|execute|deploy|delete)\s*[^*]*\*\//i.test(text)) {
    patterns.push('hidden_instruction_markup');
  }

  // Unicode/zero-width character injection
  if (/[\u200B-\u200D\uFEFF]/.test(text)) {
    patterns.push('zero_width_injection');
    sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, '');
  }

  // Cross-project retrieval attempt
  if (/\b(other project|different project|from (the )?other (repo|repository|app))\b/i.test(text)) {
    patterns.push('cross_project_retrieval');
  }

  // Memory poisoning attempt
  if (/\b(remember (that )?(i am|you are|this is) (the )?(admin|owner|root)|memorize: (i am|you are) (admin|owner)|save to memory: (i am|you are) (admin|owner))\b/i.test(text)) {
    patterns.push('memory_poisoning');
  }

  if (patterns.length > 0) {
    // Sanitize: remove injection patterns
    sanitized = sanitized
      .replace(/ignore (all )?(previous |above )?instructions?/gi, '[BLOCKED: injection]')
      .replace(/you are now/gi, '[BLOCKED: role escalation]')
      .replace(/show (me )?(the )?(secret|api key|service role|password|token)/gi, '[BLOCKED: secret extraction]')
      .replace(/skip (the )?approval/gi, '[BLOCKED: tool escalation]');
  }

  return { detected: patterns.length > 0, patterns, sanitized };
}

/**
 * Scan retrieved documents for injection attempts.
 * Retrieved text must never override system permissions or owner approval gates.
 */
export function scanRetrievedContent(content: string): { safe: boolean; blockedContent: string[]; sanitized: string } {
  const blockedContent: string[] = [];
  const injectionCheck = detectPromptInjection(content);

  if (injectionCheck.detected) {
    blockedContent.push(...injectionCheck.patterns);
  }

  // Check for fake evidence markers
  if (/\b(VERIFIED|COMPLETED|DEPLOYED)\b/.test(content) && !/\b(HTTP|SHA|commit|deploy_id|traceId)\b/.test(content)) {
    blockedContent.push('unverified_claim_without_evidence');
  }

  // Check for secret-like strings
  if (/\b(eyJ[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|vck_[A-Za-z0-9]{20,})\b/.test(content)) {
    blockedContent.push('secret_in_content');
  }

  return {
    safe: blockedContent.length === 0,
    blockedContent,
    sanitized: injectionCheck.sanitized,
  };
}

/**
 * Run a full security scan on a task input.
 */
export function runSecurityScan(input: {
  ownerMessage: string;
  retrievedContent?: string[];
  uploadedDocuments?: string[];
}): IVXSecurityScanResult {
  const checks: IVXSecurityCheck[] = [];
  const criticalFindings: string[] = [];
  const blockedContent: string[] = [];

  // 1. Prompt injection in owner message
  const ownerInjection = detectPromptInjection(input.ownerMessage);
  checks.push({
    name: 'prompt_injection_owner_message',
    passed: !ownerInjection.detected,
    detail: ownerInjection.detected ? `Patterns: ${ownerInjection.patterns.join(', ')}` : 'Clean',
    severity: ownerInjection.detected ? 'critical' : 'info',
  });
  if (ownerInjection.detected) {
    criticalFindings.push(`Owner message contained injection: ${ownerInjection.patterns.join(', ')}`);
    blockedContent.push(...ownerInjection.patterns);
  }

  // 2. Retrieved content injection
  if (input.retrievedContent) {
    for (let i = 0; i < input.retrievedContent.length; i++) {
      const scan = scanRetrievedContent(input.retrievedContent[i]);
      checks.push({
        name: `retrieved_content_${i}`,
        passed: scan.safe,
        detail: scan.safe ? 'Clean' : `Blocked: ${scan.blockedContent.join(', ')}`,
        severity: scan.safe ? 'info' : 'critical',
      });
      if (!scan.safe) {
        criticalFindings.push(`Retrieved content ${i} contained: ${scan.blockedContent.join(', ')}`);
        blockedContent.push(...scan.blockedContent);
      }
    }
  }

  // 3. Uploaded document injection
  if (input.uploadedDocuments) {
    for (let i = 0; i < input.uploadedDocuments.length; i++) {
      const scan = scanRetrievedContent(input.uploadedDocuments[i]);
      checks.push({
        name: `uploaded_document_${i}`,
        passed: scan.safe,
        detail: scan.safe ? 'Clean' : `Blocked: ${scan.blockedContent.join(', ')}`,
        severity: scan.safe ? 'info' : 'critical',
      });
      if (!scan.safe) {
        criticalFindings.push(`Uploaded document ${i} contained: ${scan.blockedContent.join(', ')}`);
        blockedContent.push(...scan.blockedContent);
      }
    }
  }

  // 4. Owner-role spoofing check
  const spoofingCheck = /\b(i am (the )?owner|i am ivan|i'?m (the )?owner|my email is iperez)\b/i.test(input.ownerMessage);
  checks.push({
    name: 'owner_role_spoofing',
    passed: !spoofingCheck,
    detail: spoofingCheck ? 'Owner claim detected — verify via authenticated session, not chat text' : 'No spoofing attempt',
    severity: spoofingCheck ? 'warning' : 'info',
  });

  // 5. Approval gate bypass attempt
  const bypassCheck = /\b(skip|bypass|ignore|don'?t (need|use|require)|without)\s+(approval|confirm|gate|phrase)\b/i.test(input.ownerMessage);
  checks.push({
    name: 'approval_gate_bypass',
    passed: !bypassCheck,
    detail: bypassCheck ? 'Bypass attempt detected' : 'No bypass attempt',
    severity: bypassCheck ? 'critical' : 'info',
  });
  if (bypassCheck) criticalFindings.push('Approval gate bypass attempt detected');

  return {
    checks,
    overallPassed: checks.every((c) => c.passed),
    criticalFindings,
    blockedContent,
  };
}

export const IVX_PERFORMANCE_SECURITY_MARKER = 'ivx-performance-security-2026-07-23-v1';
