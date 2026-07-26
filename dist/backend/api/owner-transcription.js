import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { autoDetectGatewayBaseUrl } from '../services/ivx-provider-autodetect';
const DEPLOYMENT_MARKER = 'ivx-owner-transcription-2026-05-15t-feature3';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function getElevenLabsApiKey() {
    return readTrimmed(process.env.ELEVENLABS_API_KEY) || readTrimmed(process.env.ELEVENLABS_SECRET_KEY);
}
function getOpenAITranscriptionApiKey() {
    return readTrimmed(process.env.OPENAI_API_KEY) || readTrimmed(process.env.WHISPER_API_KEY) || readTrimmed(process.env.AI_GATEWAY_API_KEY);
}
function getOpenAITranscriptionBaseUrl() {
    const configured = readTrimmed(process.env.OPENAI_AUDIO_BASE_URL) || readTrimmed(process.env.IVX_OPENAI_AUDIO_BASE_URL);
    if (configured)
        return configured.replace(/\/+$/, '');
    return autoDetectGatewayBaseUrl();
}
function getMultipartFileName(file) {
    const name = readTrimmed(file.name);
    if (name)
        return name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120);
    return `voice-${Date.now()}.m4a`;
}
function getAudioMimeType(file) {
    return readTrimmed(file.type) || 'audio/m4a';
}
async function requireAudioFile(request) {
    const formData = await request.formData();
    const file = formData.get('file') ?? formData.get('audio');
    if (!(file instanceof File)) {
        throw new Error('Audio file is required.');
    }
    if (file.size <= 0) {
        throw new Error('Audio file is empty.');
    }
    if (file.size > MAX_AUDIO_BYTES) {
        throw new Error('Audio file exceeds the 25 MB transcription limit.');
    }
    return file;
}
function extractTextFromPayload(payload) {
    if (!payload || typeof payload !== 'object')
        return '';
    const record = payload;
    const text = readTrimmed(record.text) || readTrimmed(record.transcript);
    if (text)
        return text;
    const words = Array.isArray(record.words) ? record.words : [];
    return words
        .map((word) => typeof word === 'object' && word ? readTrimmed(word.text) : '')
        .filter(Boolean)
        .join(' ')
        .trim();
}
function extractLanguageCode(payload) {
    if (!payload || typeof payload !== 'object')
        return null;
    const record = payload;
    return readTrimmed(record.language_code) || readTrimmed(record.language) || null;
}
function extractDurationSeconds(payload) {
    if (!payload || typeof payload !== 'object')
        return null;
    const record = payload;
    const candidates = [record.audio_duration_secs, record.duration, record.duration_seconds];
    for (const candidate of candidates) {
        if (typeof candidate === 'number' && Number.isFinite(candidate))
            return candidate;
    }
    return null;
}
async function parseJsonResponse(response) {
    const text = await response.text();
    try {
        return text ? JSON.parse(text) : null;
    }
    catch {
        return { error: text.slice(0, 400) };
    }
}
function extractProviderError(payload, fallback) {
    if (!payload || typeof payload !== 'object')
        return fallback;
    const record = payload;
    const detail = record.detail;
    if (typeof detail === 'string' && detail.trim())
        return detail.trim();
    if (detail && typeof detail === 'object') {
        const message = detail.message;
        if (typeof message === 'string' && message.trim())
            return message.trim();
    }
    const error = record.error;
    if (typeof error === 'string' && error.trim())
        return error.trim();
    if (error && typeof error === 'object') {
        const message = error.message;
        if (typeof message === 'string' && message.trim())
            return message.trim();
    }
    return fallback;
}
async function transcribeWithElevenLabs(file) {
    const apiKey = getElevenLabsApiKey();
    if (!apiKey) {
        throw new Error('ELEVENLABS_API_KEY is not configured.');
    }
    const body = new FormData();
    body.append('model_id', 'scribe_v2');
    body.append('diarize', 'false');
    body.append('file', file, getMultipartFileName(file));
    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: {
            'xi-api-key': apiKey,
        },
        body,
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(extractProviderError(payload, `ElevenLabs Scribe returned HTTP ${response.status}.`));
    }
    const text = extractTextFromPayload(payload);
    if (!text) {
        throw new Error('ElevenLabs Scribe returned an empty transcript.');
    }
    return {
        text,
        provider: 'elevenlabs_scribe',
        model: 'scribe_v2',
        languageCode: extractLanguageCode(payload),
        durationSeconds: extractDurationSeconds(payload),
    };
}
async function transcribeWithWhisper(file) {
    const apiKey = getOpenAITranscriptionApiKey();
    if (!apiKey) {
        throw new Error('OpenAI Whisper fallback is not configured.');
    }
    const body = new FormData();
    body.append('model', readTrimmed(process.env.OPENAI_WHISPER_MODEL) || 'whisper-1');
    body.append('response_format', 'json');
    body.append('file', file, getMultipartFileName(file));
    const response = await fetch(`${getOpenAITranscriptionBaseUrl()}/audio/transcriptions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
        body,
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(extractProviderError(payload, `Whisper returned HTTP ${response.status}.`));
    }
    const text = extractTextFromPayload(payload);
    if (!text) {
        throw new Error('Whisper returned an empty transcript.');
    }
    return {
        text,
        provider: 'openai_whisper',
        model: readTrimmed(process.env.OPENAI_WHISPER_MODEL) || 'whisper-1',
        languageCode: extractLanguageCode(payload),
        durationSeconds: extractDurationSeconds(payload),
    };
}
function getErrorStatus(error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('missing bearer token') || message.includes('invalid or expired'))
        return 401;
    if (message.includes('privileged ivx access is required'))
        return 403;
    if (message.includes('required') || message.includes('empty') || message.includes('exceeds'))
        return 400;
    if (message.includes('not configured'))
        return 503;
    return 500;
}
export async function handleOwnerAudioTranscribe(request) {
    try {
        const ctx = await assertIVXOwnerOnly(request);
        const file = await requireAudioFile(request);
        console.log('[IVXTranscription] Audio transcription requested:', {
            userId: ctx.userId,
            fileName: getMultipartFileName(file),
            mimeType: getAudioMimeType(file),
            size: file.size,
            hasElevenLabs: !!getElevenLabsApiKey(),
            hasWhisperFallback: !!getOpenAITranscriptionApiKey(),
        });
        let result;
        let elevenLabsError = null;
        try {
            result = await transcribeWithElevenLabs(file);
        }
        catch (error) {
            elevenLabsError = error instanceof Error ? error.message : 'ElevenLabs transcription failed.';
            console.log('[IVXTranscription] ElevenLabs Scribe failed, trying Whisper fallback:', elevenLabsError);
            result = await transcribeWithWhisper(file);
        }
        return ownerOnlyJson({
            ok: true,
            text: result.text,
            transcript: result.text,
            provider: result.provider,
            model: result.model,
            languageCode: result.languageCode,
            durationSeconds: result.durationSeconds,
            fallbackUsed: result.provider !== 'elevenlabs_scribe',
            primaryError: elevenLabsError,
            deploymentMarker: DEPLOYMENT_MARKER,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : 'Transcription failed.';
        return ownerOnlyJson({
            ok: false,
            error: detail,
            detail,
            deploymentMarker: DEPLOYMENT_MARKER,
            timestamp: new Date().toISOString(),
        }, getErrorStatus(error));
    }
}
export function ownerTranscriptionOptions() {
    return ownerOnlyOptions();
}
