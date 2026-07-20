/**
 * IVX Context Pipeline
 *
 * Owner mandate 2026-07-20 Phase 8: provide the model with complete context
 * using retrieval — include only the most relevant context, not the full
 * unfiltered history on every request.
 *
 * The pipeline assembles:
 *   - Current user request
 *   - Relevant conversation history (retrieved, not full)
 *   - Current task state
 *   - Repository and branch
 *   - Relevant source files (retrieved by keyword match)
 *   - Recent code changes (commit log)
 *   - Deployment state
 *   - Production logs (recent health)
 *   - Database schema (relevant tables only)
 *   - Related previous failures
 *   - Owner preferences and restrictions
 *   - Required acceptance criteria
 *   - Available tools and permissions
 */

export const IVX_CONTEXT_PIPELINE_MARKER = 'ivx-context-pipeline-2026-07-20';

export type IVXContextEntry = {
  kind:
    | 'user_request'
    | 'conversation_history'
    | 'task_state'
    | 'repository'
    | 'source_file'
    | 'recent_commit'
    | 'deployment_state'
    | 'production_log'
    | 'database_schema'
    | 'previous_failure'
    | 'owner_preference'
    | 'acceptance_criteria'
    | 'available_tools';
  label: string;
  content: string;
  relevanceScore: number;
  tokenEstimate: number;
};

export type IVXContextPipelineInput = {
  userRequest: string;
  conversationHistory?: { role: string; body: string; createdAt: string }[];
  taskState?: string;
  repository?: { url: string; branch: string; headSha: string };
  sourceFiles?: { path: string; content: string }[];
  recentCommits?: { sha: string; message: string; date: string }[];
  deploymentState?: { serviceId: string; status: string; commitSha: string };
  productionLogs?: { name: string; status: number; detail: string }[];
  databaseSchema?: { tableName: string; columns: string[] }[];
  previousFailures?: { taskId: string; goal: string; error: string; date: string }[];
  ownerPreferences?: string[];
  acceptanceCriteria?: string[];
  availableTools?: { name: string; permission: string }[];
};

export type IVXContextPipelineResult = {
  entries: IVXContextEntry[];
  totalTokenEstimate: number;
  truncated: boolean;
  marker: typeof IVX_CONTEXT_PIPELINE_MARKER;
};

const MAX_CONTEXT_TOKENS = 12000;
const APPROX_CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

function scoreRelevance(entry: IVXContextEntry, keywords: string[]): number {
  const lower = entry.content.toLowerCase();
  let score = entry.relevanceScore;
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) {
      score += 10;
    }
  }
  return score;
}

/**
 * Extract keywords from the user request for retrieval scoring.
 */
export function extractKeywords(request: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'to', 'of', 'in', 'on', 'at',
    'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through',
    'during', 'before', 'after', 'above', 'below', 'from', 'up', 'down',
    'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
    'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few',
    'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
    'own', 'same', 'so', 'than', 'too', 'very', 'and', 'but', 'if', 'or',
    'because', 'as', 'until', 'while', 'i', 'you', 'me', 'my', 'we',
    'now', 'this', 'that', 'these', 'those', 'it', 'its',
  ]);
  const words = request.toLowerCase().match(/[a-z_]+/g) ?? [];
  const keywords = words.filter((w) => w.length > 2 && !stopWords.has(w));
  // Also extract file-path-like tokens and technical terms.
  const paths = request.match(/(?:backend|expo|ios|android)\/[a-z0-9_./-]+/gi) ?? [];
  return [...new Set([...keywords, ...paths.map((p) => p.toLowerCase())])];
}

/**
 * Assemble the context pipeline with retrieval. Only the most relevant entries
 * are included, up to the token budget.
 */
export function buildContextPipeline(input: IVXContextPipelineInput): IVXContextPipelineResult {
  const keywords = extractKeywords(input.userRequest);
  const entries: IVXContextEntry[] = [];

  // Always include the user request (highest priority).
  entries.push({
    kind: 'user_request',
    label: 'Current user request',
    content: input.userRequest,
    relevanceScore: 100,
    tokenEstimate: estimateTokens(input.userRequest),
  });

  // Acceptance criteria.
  if (input.acceptanceCriteria && input.acceptanceCriteria.length > 0) {
    const content = input.acceptanceCriteria.join('\n');
    entries.push({
      kind: 'acceptance_criteria',
      label: 'Required acceptance criteria',
      content,
      relevanceScore: 95,
      tokenEstimate: estimateTokens(content),
    });
  }

  // Owner preferences.
  if (input.ownerPreferences && input.ownerPreferences.length > 0) {
    const content = input.ownerPreferences.join('\n');
    entries.push({
      kind: 'owner_preference',
      label: 'Owner preferences and restrictions',
      content,
      relevanceScore: 90,
      tokenEstimate: estimateTokens(content),
    });
  }

  // Task state.
  if (input.taskState) {
    entries.push({
      kind: 'task_state',
      label: 'Current task state',
      content: input.taskState,
      relevanceScore: 85,
      tokenEstimate: estimateTokens(input.taskState),
    });
  }

  // Repository.
  if (input.repository) {
    const content = `URL: ${input.repository.url}\nBranch: ${input.repository.branch}\nHEAD: ${input.repository.headSha}`;
    entries.push({
      kind: 'repository',
      label: 'Repository and branch',
      content,
      relevanceScore: 80,
      tokenEstimate: estimateTokens(content),
    });
  }

  // Available tools.
  if (input.availableTools && input.availableTools.length > 0) {
    const content = input.availableTools.map((t) => `${t.name}: ${t.permission}`).join('\n');
    entries.push({
      kind: 'available_tools',
      label: 'Available tools and permissions',
      content,
      relevanceScore: 75,
      tokenEstimate: estimateTokens(content),
    });
  }

  // Conversation history — retrieved, most recent + keyword-matched.
  if (input.conversationHistory && input.conversationHistory.length > 0) {
    const recent = input.conversationHistory.slice(-6);
    for (const msg of recent) {
      const content = `[${msg.createdAt}] ${msg.role}: ${msg.body.slice(0, 500)}`;
      const entry: IVXContextEntry = {
        kind: 'conversation_history',
        label: `Conversation: ${msg.role}`,
        content,
        relevanceScore: 50,
        tokenEstimate: estimateTokens(content),
      };
      entry.relevanceScore = scoreRelevance(entry, keywords);
      entries.push(entry);
    }
  }

  // Source files — retrieved by keyword match.
  if (input.sourceFiles) {
    for (const file of input.sourceFiles) {
      const preview = file.content.slice(0, 2000);
      const entry: IVXContextEntry = {
        kind: 'source_file',
        label: file.path,
        content: preview,
        relevanceScore: 30,
        tokenEstimate: estimateTokens(preview),
      };
      entry.relevanceScore = scoreRelevance(entry, keywords);
      entries.push(entry);
    }
  }

  // Recent commits.
  if (input.recentCommits) {
    for (const c of input.recentCommits.slice(0, 5)) {
      const content = `${c.sha.slice(0, 12)} — ${c.message.slice(0, 120)} (${c.date})`;
      const entry: IVXContextEntry = {
        kind: 'recent_commit',
        label: `Commit ${c.sha.slice(0, 8)}`,
        content,
        relevanceScore: 40,
        tokenEstimate: estimateTokens(content),
      };
      entry.relevanceScore = scoreRelevance(entry, keywords);
      entries.push(entry);
    }
  }

  // Deployment state.
  if (input.deploymentState) {
    const content = `Service: ${input.deploymentState.serviceId}\nStatus: ${input.deploymentState.status}\nCommit: ${input.deploymentState.commitSha}`;
    entries.push({
      kind: 'deployment_state',
      label: 'Deployment state',
      content,
      relevanceScore: 70,
      tokenEstimate: estimateTokens(content),
    });
  }

  // Production logs.
  if (input.productionLogs) {
    for (const log of input.productionLogs.slice(0, 5)) {
      const content = `${log.name}: ${log.status} — ${log.detail.slice(0, 200)}`;
      entries.push({
        kind: 'production_log',
        label: log.name,
        content,
        relevanceScore: 60,
        tokenEstimate: estimateTokens(content),
      });
    }
  }

  // Database schema — relevant tables only.
  if (input.databaseSchema) {
    for (const table of input.databaseSchema) {
      const content = `${table.tableName}: ${table.columns.join(', ')}`;
      const entry: IVXContextEntry = {
        kind: 'database_schema',
        label: `Table ${table.tableName}`,
        content,
        relevanceScore: 20,
        tokenEstimate: estimateTokens(content),
      };
      entry.relevanceScore = scoreRelevance(entry, keywords);
      entries.push(entry);
    }
  }

  // Previous failures.
  if (input.previousFailures) {
    for (const f of input.previousFailures.slice(0, 3)) {
      const content = `${f.taskId}: ${f.goal.slice(0, 100)} — ERROR: ${f.error.slice(0, 200)} (${f.date})`;
      const entry: IVXContextEntry = {
        kind: 'previous_failure',
        label: `Previous failure ${f.taskId}`,
        content,
        relevanceScore: 35,
        tokenEstimate: estimateTokens(content),
      };
      entry.relevanceScore = scoreRelevance(entry, keywords);
      entries.push(entry);
    }
  }

  // Sort by relevance score (descending) and truncate to token budget.
  entries.sort((a, b) => b.relevanceScore - a.relevanceScore);

  let totalTokens = 0;
  const kept: IVXContextEntry[] = [];
  for (const entry of entries) {
    if (totalTokens + entry.tokenEstimate > MAX_CONTEXT_TOKENS) {
      break;
    }
    kept.push(entry);
    totalTokens += entry.tokenEstimate;
  }

  return {
    entries: kept,
    totalTokenEstimate: totalTokens,
    truncated: entries.length > kept.length,
    marker: IVX_CONTEXT_PIPELINE_MARKER,
  };
}

/**
 * Render the context pipeline as a text block for the model prompt.
 */
export function renderContextPipeline(result: IVXContextPipelineResult): string {
  const parts = result.entries.map((e) => `### ${e.label} [score=${e.relevanceScore}, ~${e.tokenEstimate} tokens]\n${e.content}`);
  const header = `[IVX CONTEXT PIPELINE — ${result.entries.length} entries, ~${result.totalTokenEstimate} tokens${result.truncated ? ', truncated' : ''}]`;
  return `${header}\n\n${parts.join('\n\n')}`;
}
