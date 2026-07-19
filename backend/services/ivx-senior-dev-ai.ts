/**
 * IVX-SENIOR-DEV-01 — AI Reasoning Client
 *
 * Thin client over the Vercel AI Gateway (https://ai-gateway.vercel.sh/v1)
 * used by the autonomous senior developer worker to reason about code changes.
 * Mirrors the proven call pattern in backend/services/ivx-ai-provider-fallback.ts.
 *
 * Reads credentials from process.env:
 *   - OPENAI_API_KEY or AI_GATEWAY_API_KEY (vck_ key, required)
 */

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';

export interface AIReasoningResult {
  ok: boolean;
  content: string;
  error: string | null;
  model: string;
  usage: { promptTokens: number | null; completionTokens: number | null } | null;
}

function readEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

function resolveApiKey(): string {
  return readEnv('OPENAI_API_KEY') || readEnv('AI_GATEWAY_API_KEY');
}

function resolveModel(): string {
  // Vercel AI Gateway requires the provider prefix (e.g. "openai/gpt-4o").
  // The runtime health endpoint confirms the working key is vck_ + openai/gpt-4o.
  // Default to the proven-working model so AI planning actually succeeds.
  const explicit = readEnv('IVX_SENIOR_DEV_MODEL');
  if (explicit) return explicit;
  const fallback = readEnv('IVX_OPENAI_FALLBACK_MODEL');
  if (fallback) return fallback.startsWith('openai/') || fallback.startsWith('anthropic/') ? fallback : `openai/${fallback}`;
  return 'openai/gpt-4o';
}

/**
 * Ask the AI gateway a question and return the assistant message content.
 * Returns { ok: false, error } on any failure — the worker must handle gracefully.
 */
export async function askAI(prompt: string, opts: { systemPrompt?: string; maxTokens?: number; timeoutMs?: number } = {}): Promise<AIReasoningResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return { ok: false, content: '', error: 'AI gateway key not configured (OPENAI_API_KEY or AI_GATEWAY_API_KEY).', model: 'none', usage: null };
  }
  const model = resolveModel();
  const messages: { role: string; content: string }[] = [];
  if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: opts.maxTokens ?? 2000,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, content: '', error: `AI gateway HTTP ${res.status}: ${text.slice(0, 300)}`, model, usage: null };
    }
    const data = (await res.json()) as Record<string, unknown>;
    const choices = Array.isArray(data.choices) ? (data.choices as Array<Record<string, unknown>>) : [];
    const message = choices[0]?.message as Record<string, unknown> | undefined;
    const content = typeof message?.content === 'string' ? message.content : '';
    const usage = data.usage as Record<string, unknown> | undefined;
    return {
      ok: true,
      content,
      error: null,
      model,
      usage: {
        promptTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : null,
        completionTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : null,
      },
    };
  } catch (err) {
    return { ok: false, content: '', error: err instanceof Error ? err.message : String(err), model, usage: null };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Ask the AI to produce a structured plan (JSON) for an engineering task.
 * If repoFileTree is provided, it is injected so the AI plans against actual
 * files (not hallucinated paths).
 */
export async function planEngineeringTask(taskPrompt: string, repoFileTree: string[] = []): Promise<AIReasoningResult> {
  const fileTreeSection = repoFileTree.length > 0
    ? `\n\n--- REPOSITORY FILE TREE (actual files you may inspect or edit) ---\n${repoFileTree.join('\n')}\n--- END FILE TREE ---\n\nIMPORTANT: Only reference files that appear in the file tree above. Do NOT invent paths.\n`
    : '';
  const systemPrompt = [
    'You are an autonomous senior developer reasoning about a code change request.',
    'Inspect the repository context given and return a JSON object with keys:',
    '  "summary": one-line description of the change,',
    '  "filesToInspect": array of repo-relative file paths to read before editing (must exist in the file tree if provided),',
    '  "filesToChange": array of {path, reason} describing each file to edit (must exist in the file tree if provided),',
    '  "testsToRun": array of test commands (e.g. "bun test backend/services/foo.test.ts"),',
    '  "requiresDeploy": boolean — true if the change must deploy to production,',
    '  "rollbackNotes": short rollback plan if the change breaks production.',
    'Return ONLY the JSON object. No prose, no markdown fences.',
    'Prefer the SMALLEST safe change that fixes a real defect. Do NOT invent file paths.',
  ].join('\n');
  return askAI(`Engineering task:\n${taskPrompt}${fileTreeSection}\nReturn the plan JSON now.`, { systemPrompt, maxTokens: 1500, timeoutMs: 90_000 });
}

/**
 * Ask the AI to generate a file patch given the current file content + goal.
 * Returns the full new file content (not a diff) for simplicity and reliability.
 */
export async function generateFilePatch(input: { filePath: string; currentContent: string; goal: string; priorContext?: string }): Promise<AIReasoningResult> {
  const systemPrompt = [
    'You are an autonomous senior developer editing a file in a TypeScript + React Native (Expo) + Hono backend monorepo.',
    'Return the COMPLETE new file content only — no prose, no markdown fences, no explanations.',
    'Preserve all existing imports and structure unless the goal explicitly requires changing them.',
    'Follow the existing code style (TypeScript strict, explicit types).',
  ].join('\n');
  const userPrompt = [
    `File: ${input.filePath}`,
    `Goal: ${input.goal}`,
    input.priorContext ? `Prior context:\n${input.priorContext}` : '',
    '--- CURRENT FILE ---',
    input.currentContent,
    '--- END CURRENT FILE ---',
    'Return the complete new file content now.',
  ].filter(Boolean).join('\n\n');
  return askAI(userPrompt, { systemPrompt, maxTokens: 4000, timeoutMs: 120_000 });
}
