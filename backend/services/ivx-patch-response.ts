export type PatchResponseOperation = {
  path: string; kind: 'replace_exact' | 'create_file'; oldText: string; newText: string; reason: string;
};
export type PatchResponse = { rootCause: string; technicalPlan: string; operations: PatchResponseOperation[] };
type ParsedPatchResponse = { plan: PatchResponse; error: null } | { plan: null; error: string };

export const PATCH_JSON_GUIDANCE = String.raw`Encode source code as JSON strings: use \n for a newline, \" for a double quote, and \\ for a backslash. Do not place literal newlines inside JSON strings. Return every operation with path, kind, oldText and newText. An invalid operation rejects the entire plan; it is never silently discarded. Preserve source code exactly, including Unicode quotes and Markdown fences inside string values.`;

/** Parse an envelope, never repair or rewrite the source code inside it. */
export function diagnosePatchResponse(response: string): ParsedPatchResponse {
  const invalid = (error: string): ParsedPatchResponse => ({ plan: null, error });
  if (response.length > 256_000) return invalid('PATCH_RESPONSE_TOO_LARGE');
  const trimmed = response.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  const text = fenced ? fenced[1]!.trim() : trimmed;
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { return invalid('PATCH_JSON_INVALID: return one complete JSON object; escape newlines, quotes and backslashes inside code strings.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return invalid('PATCH_OBJECT_REQUIRED');
  const object = parsed as Record<string, unknown>;
  if (!Array.isArray(object.operations) || object.operations.length > 50) return invalid('PATCH_OPERATIONS_ARRAY_REQUIRED: maximum 50 operations.');
  const operations: PatchResponseOperation[] = [];
  for (const [index, item] of object.operations.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return invalid(`PATCH_OPERATION_INVALID: operations[${index}] must be an object.`);
    const op = item as Record<string, unknown>;
    if (typeof op.path !== 'string' || !op.path.trim()
      || typeof op.kind !== 'string' || !['replace_exact', 'create_file'].includes(op.kind)
      || typeof op.oldText !== 'string' || typeof op.newText !== 'string'
      || (op.kind === 'replace_exact' && !op.oldText)
      || (op.kind === 'create_file' && (op.oldText !== '' || !op.newText))) {
      return invalid(`PATCH_OPERATION_INVALID: operations[${index}] needs a path, valid kind and exact oldText/newText strings. Use empty oldText only for create_file.`);
    }
    operations.push({ path: op.path, kind: op.kind as PatchResponseOperation['kind'],
      oldText: op.oldText, newText: op.newText, reason: typeof op.reason === 'string' ? op.reason : '' });
  }
  return { error: null, plan: {
    rootCause: typeof object.rootCause === 'string' ? object.rootCause : 'LLM-generated patch',
    technicalPlan: typeof object.technicalPlan === 'string' ? object.technicalPlan : 'Replace exact text per operations',
    operations,
  } };
}
