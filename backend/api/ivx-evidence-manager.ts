import { listEvidence, recordEvidence } from '../services/ivx-evidence-service';

export async function handleListEvidence(request: Request): Promise<Response> {
  const agentId = request.headers.get('X-Agent-Id');
  if (!agentId) return new Response('Agent ID required', { status: 400 });
  const evidence = await listEvidence(agentId);
  return new Response(JSON.stringify({ ok: true, evidence }), { status: 200 });
}

export async function handleRecordEvidence(request: Request): Promise<Response> {
  const agentId = request.headers.get('X-Agent-Id');
  if (!agentId) return new Response('Agent ID required', { status: 400 });
  const evidenceRecord = await request.json();
  const result = await recordEvidence(agentId, evidenceRecord);
  return new Response(JSON.stringify({ ok: result }), { status: result ? 200 : 500 });
}
