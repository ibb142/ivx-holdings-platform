/**
 * IVX Owner AI background job endpoints.
 *
 * Very long analytical prompts (e.g. "full system audit, 1..50") don't fit in
 * a single synchronous request. The client posts the job, gets a `jobId`, and
 * polls `/status/:jobId`. Sections become available progressively, so the chat
 * UI can render "Generating report... part 2 of 5" with each completed
 * section incrementally instead of waiting for everything.
 */
import { getAIJob, listAIJobs, startAIJob } from '../services/ivx-ai-job-queue';
import { getAIQueueSnapshot } from '../services/ivx-ai-queue';
import { summarizeProviderTelemetry, listProviderTelemetry } from '../services/ivx-provider-telemetry';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { checkPreExecutionGate } from '../services/ivx-pre-execution-gate-middleware';

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const OPTIONS = (): Response => ownerOnlyOptions();

export async function handleIVXAIJobStartRequest(request: Request): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const prompt = readTrimmed(body.prompt) || readTrimmed(body.message);
  if (!prompt) return ownerOnlyJson({ ok: false, error: 'prompt is required.' }, 400);

  // Pre-Execution Feasibility Gate (Stage 0)
  try {
    const gate = await checkPreExecutionGate(request, {
      prompt,
      ownerSessionPresent: true,
      entryPoint: 'owner-ai-jobs-start',
    });
    if (gate.blocked && gate.response) return gate.response;
  } catch (gateError) {
    console.log('[IVXOwnerAIJobs] Pre-execution gate error (non-blocking):', gateError instanceof Error ? gateError.message : 'unknown');
  }

  const job = startAIJob({
    module: readTrimmed(body.module) || 'owner-room',
    conversationId: readTrimmed(body.conversationId) || null,
    prompt,
    system: readTrimmed(body.system) || null,
    model: readTrimmed(body.model) || null,
    maxOutputTokens: Number.isFinite(Number(body.maxOutputTokens))
      ? Math.min(Math.max(Number(body.maxOutputTokens), 1000), 12_000)
      : 6000,
    maxParts: Number.isFinite(Number(body.maxParts))
      ? Math.min(Math.max(Number(body.maxParts), 1), 10)
      : 5,
  });

  return ownerOnlyJson({
    ok: true,
    jobId: job.id,
    status: job.status,
    createdAt: job.createdAt,
  });
}

export async function handleIVXAIJobStatusRequest(request: Request, jobId: string): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  const job = getAIJob(jobId);
  if (!job) return ownerOnlyJson({ ok: false, error: 'job not found' }, 404);

  return ownerOnlyJson({
    ok: true,
    job: {
      id: job.id,
      status: job.status,
      sections: job.sections,
      accumulatedText: job.accumulatedText,
      lastItemNumber: job.lastItemNumber,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
  });
}

export async function handleIVXAIJobsListRequest(request: Request): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
  return ownerOnlyJson({ ok: true, jobs: listAIJobs(20) });
}

export async function handleIVXAIRuntimeObservabilityRequest(request: Request): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  return ownerOnlyJson({
    ok: true,
    queue: getAIQueueSnapshot(),
    telemetry: {
      summary: summarizeProviderTelemetry(100),
      recent: listProviderTelemetry(20),
    },
  });
}

