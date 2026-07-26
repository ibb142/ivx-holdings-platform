/**
 * IVX Operational Memory — embeddings via Vercel AI Gateway.
 * Falls back to a deterministic hash-based pseudo-embedding when the gateway
 * is not configured, so the loop and memory still run in lower environments.
 */
import { MEMORY_EMBEDDING_DIM, MEMORY_EMBEDDING_MODEL } from './memory-types';
import { autoDetectGatewayBaseUrl } from '../ivx-provider-autodetect';
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function getGatewayBaseUrl() {
    return autoDetectGatewayBaseUrl();
}
function getApiKey() {
    return readTrimmed(process.env.OPENAI_API_KEY) || readTrimmed(process.env.AI_GATEWAY_API_KEY);
}
function hashEmbedding(input, dim) {
    // Deterministic, normalized pseudo-embedding for offline/test fallback.
    const out = new Array(dim).fill(0);
    let h1 = 2166136261 >>> 0;
    let h2 = 52711 >>> 0;
    for (let i = 0; i < input.length; i++) {
        const c = input.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
        h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
        out[(h1 + i) % dim] += ((c % 31) - 15) / 15;
        out[(h2 + i * 7) % dim] += ((c % 17) - 8) / 8;
    }
    let norm = 0;
    for (let i = 0; i < dim; i++)
        norm += out[i] * out[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++)
        out[i] = out[i] / norm;
    return out;
}
/**
 * Generate an embedding for a single text. Uses OpenAI-compatible /embeddings
 * via the AI Gateway when available; otherwise returns a deterministic
 * hash-based vector so callers can keep working.
 */
export async function embedText(text) {
    const apiKey = getApiKey();
    const truncated = text.slice(0, 8000);
    if (!apiKey) {
        return { vector: hashEmbedding(truncated, MEMORY_EMBEDDING_DIM), model: 'fallback-hash', dim: MEMORY_EMBEDDING_DIM, source: 'fallback_hash' };
    }
    try {
        const response = await fetch(`${getGatewayBaseUrl()}/embeddings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ model: 'text-embedding-3-small', input: truncated }),
        });
        if (!response.ok) {
            console.log('[IVXOpMemory] embedding gateway non-OK, falling back:', response.status);
            return { vector: hashEmbedding(truncated, MEMORY_EMBEDDING_DIM), model: 'fallback-hash', dim: MEMORY_EMBEDDING_DIM, source: 'fallback_hash' };
        }
        const json = await response.json();
        const vec = json.data?.[0]?.embedding;
        if (!Array.isArray(vec) || vec.length === 0) {
            return { vector: hashEmbedding(truncated, MEMORY_EMBEDDING_DIM), model: 'fallback-hash', dim: MEMORY_EMBEDDING_DIM, source: 'fallback_hash' };
        }
        return { vector: vec, model: MEMORY_EMBEDDING_MODEL, dim: vec.length, source: 'gateway' };
    }
    catch (error) {
        console.log('[IVXOpMemory] embedding error, falling back:', error instanceof Error ? error.message : 'unknown');
        return { vector: hashEmbedding(truncated, MEMORY_EMBEDDING_DIM), model: 'fallback-hash', dim: MEMORY_EMBEDDING_DIM, source: 'fallback_hash' };
    }
}
