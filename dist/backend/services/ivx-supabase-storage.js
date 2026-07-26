/**
 * IVX Supabase Storage service — PHASE 2 (Real Deliverable System).
 *
 * Real artifact upload + signed-URL + download-verification over the Supabase
 * Storage REST API using the backend service-role key. No supabase-js (avoids
 * the Node WebSocket dependency, BLOCK 14) — plain HTTPS, works in any runtime.
 *
 * Every call returns an honest result and never throws into the pipeline:
 *   - ensureBucket()    idempotently creates the deliverables bucket
 *   - uploadObject()    PUTs file bytes → returns the storage path
 *   - createSignedUrl() signs a time-limited download URL
 *   - verifyDownload()  GETs the signed URL and reports the real HTTP result
 *
 * The service-role key is never returned. On missing config every call fails
 * honestly with the exact missing env var.
 */
export const IVX_SUPABASE_STORAGE_MARKER = 'ivx-supabase-storage-2026-06-01';
/** The bucket all owner deliverables are written to. */
export const IVX_DELIVERABLES_BUCKET = 'ivx-deliverables';
const FETCH_TIMEOUT_MS = 20000;
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function resolveConfig() {
    const url = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
    const key = readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY) || readTrimmed(process.env.SUPABASE_SERVICE_KEY);
    const missing = [];
    if (!url)
        missing.push('EXPO_PUBLIC_SUPABASE_URL');
    if (!key)
        missing.push('SUPABASE_SERVICE_ROLE_KEY');
    return { url, key, missing };
}
async function timedFetch(input, init) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await fetch(input, { ...init, signal: controller.signal });
    }
    finally {
        clearTimeout(timeout);
    }
}
/** Mask a Supabase host so the full project ref is never echoed verbatim. */
export function maskStorageHost(url) {
    try {
        const host = new URL(url).host;
        const [ref, ...rest] = host.split('.');
        if (!ref)
            return host;
        const maskedRef = ref.length <= 6 ? `${ref.slice(0, 2)}***` : `${ref.slice(0, 4)}***${ref.slice(-2)}`;
        return [maskedRef, ...rest].join('.');
    }
    catch {
        return null;
    }
}
/** Report whether storage is configured (no secret returned). */
export function getStorageConfigStatus() {
    const { url, missing } = resolveConfig();
    return {
        configured: missing.length === 0,
        missing,
        bucket: IVX_DELIVERABLES_BUCKET,
        projectHostMasked: url ? maskStorageHost(url) : null,
    };
}
/**
 * Idempotently ensure the deliverables bucket exists (private). A 200 from the
 * bucket GET means it exists; otherwise we POST to create it and treat a
 * "already exists" conflict as success.
 */
export async function ensureBucket(bucket = IVX_DELIVERABLES_BUCKET) {
    const { url, key, missing } = resolveConfig();
    if (missing.length > 0)
        return { ok: false, error: `Supabase storage not configured. Missing: ${missing.join(', ')}.`, missing };
    try {
        const getResp = await timedFetch(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
            method: 'GET',
            headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
        if (getResp.ok) {
            return { ok: true, bucket, created: false, alreadyExisted: true };
        }
        const createResp = await timedFetch(`${url}/storage/v1/bucket`, {
            method: 'POST',
            headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: bucket, name: bucket, public: false }),
        });
        if (createResp.ok) {
            return { ok: true, bucket, created: true, alreadyExisted: false };
        }
        const text = await createResp.text();
        // A concurrent create / pre-existing bucket reports a 409 "already exists".
        if (createResp.status === 409 || /exist/i.test(text)) {
            return { ok: true, bucket, created: false, alreadyExisted: true };
        }
        return { ok: false, error: `Bucket create failed (HTTP ${createResp.status}): ${text.slice(0, 200)}` };
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Bucket ensure failed.' };
    }
}
/**
 * Upload file bytes to Supabase Storage (upsert). Returns the stored path +
 * size. Never throws — failures become an honest result with the HTTP status.
 */
export async function uploadObject(input) {
    const { url, key, missing } = resolveConfig();
    if (missing.length > 0)
        return { ok: false, error: `Supabase storage not configured. Missing: ${missing.join(', ')}.`, httpStatus: null, missing };
    const bucket = input.bucket ?? IVX_DELIVERABLES_BUCKET;
    const cleanPath = input.path.replace(/^\/+/, '');
    try {
        const resp = await timedFetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${cleanPath}`, {
            method: 'POST',
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                'Content-Type': input.contentType,
                'x-upsert': 'true',
                'cache-control': 'max-age=3600',
            },
            body: input.body,
        });
        if (!resp.ok) {
            const text = await resp.text();
            return { ok: false, error: `Upload failed (HTTP ${resp.status}): ${text.slice(0, 200)}`, httpStatus: resp.status };
        }
        return {
            ok: true,
            bucket,
            path: cleanPath,
            fullPath: `${bucket}/${cleanPath}`,
            size: input.body.byteLength,
            contentType: input.contentType,
            httpStatus: resp.status,
        };
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Upload failed.', httpStatus: null };
    }
}
/**
 * Create a time-limited signed download URL for a stored object. Supabase
 * returns a relative `signedURL`; we resolve it to an absolute URL.
 */
export async function createSignedUrl(pathInput, expiresIn = 3600, bucket = IVX_DELIVERABLES_BUCKET) {
    const { url, key, missing } = resolveConfig();
    if (missing.length > 0)
        return { ok: false, error: `Supabase storage not configured. Missing: ${missing.join(', ')}.`, httpStatus: null, missing };
    const cleanPath = pathInput.replace(/^\/+/, '');
    const ttl = Math.max(60, Math.min(60 * 60 * 24 * 7, Math.floor(expiresIn)));
    try {
        const resp = await timedFetch(`${url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${cleanPath}`, {
            method: 'POST',
            headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ expiresIn: ttl }),
        });
        if (!resp.ok) {
            const text = await resp.text();
            return { ok: false, error: `Sign URL failed (HTTP ${resp.status}): ${text.slice(0, 200)}`, httpStatus: resp.status };
        }
        const parsed = (await resp.json());
        const relative = readTrimmed(parsed.signedURL ?? parsed.signedUrl);
        if (!relative) {
            return { ok: false, error: 'Sign URL response did not include a signedURL.', httpStatus: resp.status };
        }
        const signedUrl = relative.startsWith('http') ? relative : `${url}/storage/v1${relative.startsWith('/') ? '' : '/'}${relative}`;
        return {
            ok: true,
            signedUrl,
            path: cleanPath,
            bucket,
            expiresIn: ttl,
            expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        };
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Sign URL failed.', httpStatus: null };
    }
}
/**
 * Verify a signed URL actually serves the file. Issues a real GET (Range
 * 0-0 so we don't pull the whole file) and reports the HTTP result. Never
 * throws — a network failure is reported honestly.
 */
export async function verifyDownload(signedUrl) {
    const checkedAt = new Date().toISOString();
    const target = readTrimmed(signedUrl);
    if (!target) {
        return { ok: false, httpStatus: null, contentLength: null, contentType: null, reachable: false, error: 'No signed URL to verify.', checkedAt };
    }
    try {
        const resp = await timedFetch(target, { method: 'GET', headers: { Range: 'bytes=0-0' } });
        const lenHeader = resp.headers.get('content-range') ?? resp.headers.get('content-length');
        let contentLength = null;
        if (lenHeader) {
            const total = lenHeader.includes('/') ? lenHeader.split('/').pop() : lenHeader;
            const n = Number.parseInt(total ?? '', 10);
            if (Number.isFinite(n))
                contentLength = n;
        }
        // 200 (full) or 206 (partial / range) both prove the object is downloadable.
        const ok = resp.status === 200 || resp.status === 206;
        return {
            ok,
            httpStatus: resp.status,
            contentLength,
            contentType: resp.headers.get('content-type'),
            reachable: true,
            error: ok ? null : `Download check returned HTTP ${resp.status}.`,
            checkedAt,
        };
    }
    catch (error) {
        return { ok: false, httpStatus: null, contentLength: null, contentType: null, reachable: false, error: error instanceof Error ? error.message : 'Download verification failed.', checkedAt };
    }
}
