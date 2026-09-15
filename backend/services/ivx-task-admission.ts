import { z } from 'zod';
import type { CreateTaskInput } from './ivx-autonomous-task-engine';

const text = z.string().trim().min(1);
const optionalText = text.nullable().optional();
const criterion = z.object({
  id: text,
  description: text,
  verificationMethod: z.enum(['code_diff', 'test_pass', 'http_200', 'production_check', 'evidence', 'manual', 'source_file_inspected']),
  expectedSource: text.optional(),
  expectedCommitSha: z.string().regex(/^[a-f0-9]{40}$/i).optional(),
  // Admission records requirements. Only the evidence verifier can certify them.
  met: z.literal(false).default(false),
  evidence: z.null().default(null),
}).strict();

const inputSchema = z.object({
  objectiveId: optionalText,
  parentTaskId: optionalText,
  title: text,
  description: text,
  taskType: z.enum(['development', 'security', 'investor_research', 'buyer_research', 'outreach', 'deployment', 'qa', 'reporting', 'discovery', 'configuration']).optional(),
  // A stable caller key is required. A server timestamp creates duplicates on retry.
  idempotencyKey: text,
  assignedAgentNumber: z.number().int().min(1).max(112).nullable().optional(),
  assignedEngine: optionalText,
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  businessValue: z.number().int().min(1).max(5).optional(),
  estimatedMinutes: z.number().int().min(1).max(43_200).nullable().optional(),
  milestone: optionalText,
  ownerRole: optionalText,
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  acceptanceCriteria: z.array(criterion).min(1).max(100).optional(),
  dependencies: z.array(text).max(112).optional(),
  executionOrder: z.number().int().min(0).optional(),
  maxRetries: z.number().int().min(0).max(100).optional(),
}).strict().superRefine((input, context) => {
  const ids = input.acceptanceCriteria?.map(item => item.id) ?? [];
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['acceptanceCriteria'], message: 'Criterion IDs must be unique.' });
  }
});

/** HTTP boundary only: no coercion, inferred approval, state mutation or DB access. */
export function parseTaskAdmission(body: unknown):
  | { ok: true; input: CreateTaskInput }
  | { ok: false; code: 'INVALID_TASK_PAYLOAD'; issues: Array<{ path: string; message: string }> } {
  const parsed = inputSchema.safeParse(body);
  if (parsed.success) return { ok: true, input: parsed.data };
  return { ok: false, code: 'INVALID_TASK_PAYLOAD', issues: parsed.error.issues.map(issue => ({
    path: issue.path.join('.') || 'body', message: issue.message,
  })) };
}
