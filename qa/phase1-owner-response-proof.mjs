export function decodeOwnerResponse(raw, marker) {
  const frames = String(raw).split('\n').filter(line => line.startsWith('data:')).flatMap(line => {
    try { return [JSON.parse(line.slice(5).trim())]; } catch { return []; }
  });
  const final = frames.find(frame => frame.type === 'final');
  const body = final?.body;
  const answer = body?.answer ?? body?.text;
  const valid = final?.status === 200 && final.ok !== false && typeof answer === 'string'
    && answer.includes(marker) && typeof body.model === 'string' && body.model.length > 0
    && !/fallback|error|^ivx_/i.test(body.model) && !body.providerError && !body.fallback
    && !frames.some(frame => frame.type === 'error');
  return { valid: !!valid, answer: valid ? answer : null,
    events: [...new Set(frames.map(frame => frame.type))], finalStatus: final?.status ?? null,
    model: body?.model ?? null, provider: body?.provider ?? null,
    requestId: body?.requestId ?? frames.find(frame => frame.type === 'start')?.requestId ?? null,
    usage: body?.usage ?? null };
}
