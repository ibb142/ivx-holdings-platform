/**
 * IVX Browser Automation API — owner-gated QA + screenshot endpoints.
 *
 *   GET  /api/ivx/qa/status                              → browser readiness
 *   POST /api/ivx/qa/screenshot  { url, viewport? }       → PNG screenshot (base64 + saved)
 *   POST /api/ivx/qa/run         { flow, url?, ... }      → QA transcript + per-step shots
 *
 * All endpoints require IVX owner auth (assertIVXOwnerOnly). Screenshots are
 * returned inline as base64 AND persisted under $IVX_DATA_DIR/browser-automation
 * for forensic evidence.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { captureScreenshot, closeBrowser, getBrowserAvailability, runQAFlow, } from '../services/ivx-browser-automation';
export const OPTIONS = () => ownerOnlyOptions();
async function requireOwner(request) {
    try {
        const owner = await assertIVXOwnerOnly(request);
        if (!owner.userId) {
            return { ok: false, response: ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401) };
        }
        return { ok: true };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'IVX owner authentication required.';
        const status = message.toLowerCase().includes('missing bearer') ? 401 : 403;
        return { ok: false, response: ownerOnlyJson({ ok: false, error: message }, status) };
    }
}
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function asViewport(value, fallback) {
    if (value && typeof value === 'object') {
        const v = value;
        const width = typeof v.width === 'number' ? v.width : Number(v.width);
        const height = typeof v.height === 'number' ? v.height : Number(v.height);
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
            return { width, height };
        }
    }
    return fallback;
}
/** GET /api/ivx/qa/status — report whether headless Chromium is usable on this host. */
export async function handleQaStatusRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    const avail = await getBrowserAvailability();
    return ownerOnlyJson({
        ok: true,
        available: avail.available,
        reason: avail.available ? null : avail.reason,
        detail: avail.available ? `executable=${avail.executablePath}` : avail.detail,
        timestamp: new Date().toISOString(),
    });
}
/** POST /api/ivx/qa/screenshot — capture a single screenshot of a URL. */
export async function handleQaScreenshotRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    let body;
    try {
        body = await request.json();
    }
    catch {
        return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
    }
    const url = asString(body.url);
    if (!url || !/^https?:\/\//i.test(url)) {
        return ownerOnlyJson({ ok: false, error: 'A valid `url` (http/https) is required.' }, 400);
    }
    const input = {
        url,
        viewport: body.viewport ? asViewport(body.viewport, { width: 1280, height: 800 }) : undefined,
        fullPage: body.fullPage !== false,
        waitMs: typeof body.waitMs === 'number' ? body.waitMs : undefined,
    };
    const result = await captureScreenshot(input);
    if (!result.ok) {
        return ownerOnlyJson({ ok: false, error: result.error, reason: result.reason }, 503);
    }
    // Note: pngBase64 can be large; ownerOnlyJson truncates if over the ceiling.
    // The saved file on disk is always complete.
    return ownerOnlyJson({
        ok: true,
        url: result.url,
        title: result.title,
        savedPath: result.savedPath,
        viewport: result.viewport,
        takenAt: result.takenAt,
        pngBase64: result.pngBase64,
    });
}
/** POST /api/ivx/qa/run — execute a full QA flow with per-step screenshots. */
export async function handleQaRunRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    let body;
    try {
        body = await request.json();
    }
    catch {
        return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
    }
    const flow = asString(body.flow);
    const allowedFlows = ['ownerChat', 'landing', 'members', 'androidLayout', 'iosLayout', 'custom'];
    if (!allowedFlows.includes(flow)) {
        return ownerOnlyJson({ ok: false, error: `Invalid flow. Allowed: ${allowedFlows.join(', ')}` }, 400);
    }
    const input = {
        flow,
        url: asString(body.url) || undefined,
        viewport: body.viewport ? asViewport(body.viewport, resolveDefaultViewportForFlow(flow)) : undefined,
        selector: asString(body.selector) || undefined,
        email: asString(body.email) || undefined,
        password: asString(body.password) || undefined,
        message: asString(body.message) || undefined,
        fullPage: body.fullPage !== false,
    };
    const result = await runQAFlow(input);
    if (!result.ok) {
        return ownerOnlyJson({ ok: false, flow: result.flow, error: result.error, reason: result.reason }, 503);
    }
    return ownerOnlyJson({
        ok: true,
        flow: result.flow,
        url: result.url,
        viewport: result.viewport,
        steps: result.steps,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        totalDurationMs: result.totalDurationMs,
    });
}
function resolveDefaultViewportForFlow(flow) {
    if (flow === 'androidLayout')
        return { width: 412, height: 915 };
    if (flow === 'iosLayout')
        return { width: 390, height: 844 };
    return { width: 1280, height: 800 };
}
/** Allow tests / shutdown hooks to close the shared browser. */
export async function handleQaCloseRequest(_request) {
    await closeBrowser();
    return ownerOnlyJson({ ok: true, closed: true });
}
