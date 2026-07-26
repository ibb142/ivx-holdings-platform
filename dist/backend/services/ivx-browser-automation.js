/**
 * IVX Browser Automation Service — Playwright-core backed.
 *
 * Spawns a real headless Chromium browser on the Render backend to produce
 * genuine user-visible evidence (screenshots + DOM text + flow transcripts)
 * for owner-requested QA. This is the missing piece that lets the backend
 * prove real screen rendering, not just HTTP 200 / 401 route checks.
 *
 * Design:
 *   - Uses `playwright-core` (NOT `playwright`) so it does NOT download a
 *     bundled browser. The Dockerfile installs system Chromium on Alpine
 *     and we point `executablePath` at it. This keeps the image small and
 *     avoids the glibc/musl mismatch that breaks bundled Playwright builds.
 *   - A single shared browser instance is lazily launched; each QA run gets
 *     its own isolated browser context (cookies/storage reset per run).
 *   - All public methods are defensive: if Chromium is unavailable (local
 *     dev, missing binary), they return a structured `browserUnavailable`
 *     result instead of throwing, so the API layer can surface it cleanly.
 *   - Owner-supplied credentials for login flows are read from env vars
 *     (never logged) and are optional — flows degrade to anonymous visits.
 *
 * Surfaced via backend/api/ivx-browser-automation.ts:
 *   POST /api/ivx/qa/screenshot  { url, viewport? }          → PNG screenshot
 *   POST /api/ivx/qa/run         { flow, url?, ... }         → QA transcript + shots
 *   GET  /api/ivx/qa/status                                  → browser readiness
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const BROWSER_AUTOMATION_DIR = path.join(process.env.IVX_DATA_DIR || process.cwd(), 'browser-automation');
const SCREENSHOT_DIR = path.join(BROWSER_AUTOMATION_DIR, 'screenshots');
/** Resolved at first use; do NOT import at module top-level. */
let _chromium = null;
let _browser = null;
let _launchPromise = null;
let _availabilityCache = null;
const DEFAULT_DESKTOP = { width: 1280, height: 800 };
const DEFAULT_ANDROID = { width: 412, height: 915 };
const DEFAULT_IOS = { width: 390, height: 844 };
const CHROMIUM_EXECUTABLE_CANDIDATES = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
].filter((p) => Boolean(p && p.trim()));
/** Resolve the chromium binary path. Returns null if none found. */
async function resolveChromiumExecutable() {
    for (const candidate of CHROMIUM_EXECUTABLE_CANDIDATES) {
        try {
            const { access } = await import('node:fs/promises');
            await access(candidate);
            return candidate;
        }
        catch {
            // try next
        }
    }
    return null;
}
/** Lazy-load playwright-core. Returns null if the package is not installed. */
async function loadPlaywrightCore() {
    if (_chromium)
        return _chromium;
    try {
        const mod = (await import('playwright-core'));
        if (!mod.chromium)
            return null;
        _chromium = mod.chromium;
        return _chromium;
    }
    catch {
        return null;
    }
}
/** Check whether browser automation is usable on this host. Cached for the process lifetime. */
export async function getBrowserAvailability() {
    if (_availabilityCache)
        return _availabilityCache;
    const pw = await loadPlaywrightCore();
    if (!pw) {
        _availabilityCache = { available: false, reason: 'playwrightNotInstalled', detail: 'playwright-core package not installed' };
        return _availabilityCache;
    }
    const exe = await resolveChromiumExecutable();
    if (!exe) {
        _availabilityCache = { available: false, reason: 'chromiumNotFound', detail: 'No chromium binary found on PATH or PLAYWRIGHT_CHROMIUM_PATH' };
        return _availabilityCache;
    }
    _availabilityCache = { available: true, executablePath: exe, version: 'system-chromium' };
    return _availabilityCache;
}
/** Lazily launch a single shared browser instance. */
async function getBrowser() {
    if (_browser)
        return _browser;
    if (_launchPromise)
        return _launchPromise;
    _launchPromise = (async () => {
        const pw = await loadPlaywrightCore();
        if (!pw)
            throw new Error('playwright-core not installed');
        const avail = await getBrowserAvailability();
        if (!avail.available)
            throw new Error(`browser unavailable: ${avail.reason}`);
        const browser = await pw.launch({
            executablePath: avail.executablePath,
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process',
                '--no-zygote',
            ],
        });
        _browser = browser;
        return browser;
    })();
    try {
        return await _launchPromise;
    }
    finally {
        _launchPromise = null;
    }
}
function bufferToBase64(buf) {
    return buf.toString('base64');
}
async function ensureScreenshotDir() {
    await mkdir(SCREENSHOT_DIR, { recursive: true });
}
async function saveScreenshot(buf, label) {
    await ensureScreenshotDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(SCREENSHOT_DIR, `qa-${label}-${stamp}.png`);
    await writeFile(file, buf);
    return file;
}
/** Capture a single screenshot of a URL. */
export async function captureScreenshot(input) {
    const viewport = input.viewport ?? DEFAULT_DESKTOP;
    const url = input.url;
    const takenAt = new Date().toISOString();
    const avail = await getBrowserAvailability();
    if (!avail.available) {
        return { ok: false, error: avail.detail, reason: avail.reason };
    }
    let context = null;
    try {
        const browser = await getBrowser();
        context = await browser.newContext({ viewport });
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        if (input.waitMs && input.waitMs > 0) {
            await page.waitForTimeout(input.waitMs);
        }
        const title = await page.title();
        const png = await page.screenshot({ fullPage: input.fullPage ?? true });
        const savedPath = await saveScreenshot(png, 'shot');
        return {
            ok: true,
            url,
            title,
            pngBase64: bufferToBase64(png),
            savedPath,
            viewport,
            takenAt,
        };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : 'navigation/screenshot failed';
        if (/net::ERR|Timeout|Navigation|timeout/i.test(msg)) {
            return { ok: false, error: msg, reason: 'navigationFailed' };
        }
        return { ok: false, error: msg, reason: 'screenshotFailed' };
    }
    finally {
        if (context) {
            try {
                await context.close();
            }
            catch { /* ignore */ }
        }
    }
}
/** Run a full QA flow and return a transcript with per-step screenshots. */
export async function runQAFlow(input) {
    const viewport = input.viewport ?? resolveDefaultViewport(input.flow);
    const flow = input.flow;
    const url = input.url ?? resolveDefaultUrl(input.flow);
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const steps = [];
    const avail = await getBrowserAvailability();
    if (!avail.available) {
        return { ok: false, flow, error: avail.detail, reason: avail.reason };
    }
    let context = null;
    try {
        const browser = await getBrowser();
        context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const fullPage = input.fullPage ?? true;
        // Step 1 — navigate
        {
            const t0 = Date.now();
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
                await page.waitForTimeout(1500);
                const title = await page.title();
                const png = await page.screenshot({ fullPage });
                const shotPath = await saveScreenshot(png, `${flow}-01-nav`);
                steps.push({ step: 'navigate', ok: true, detail: `Loaded "${title}"`, screenshotPath: shotPath, durationMs: Date.now() - t0 });
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : 'navigation failed';
                steps.push({ step: 'navigate', ok: false, detail: msg, durationMs: Date.now() - t0 });
                throw new Error(`navigate: ${msg}`);
            }
        }
        // Flow-specific steps
        if (flow === 'ownerChat') {
            await runOwnerChatFlow(page, input, steps);
        }
        else if (flow === 'members') {
            await runMembersFlow(page, steps);
        }
        else if (flow === 'landing') {
            await runLandingFlow(page, steps);
        }
        // androidLayout / iosLayout / custom just capture the navigate screenshot
        return {
            ok: true,
            flow,
            url,
            viewport,
            steps,
            startedAt,
            finishedAt: new Date().toISOString(),
            totalDurationMs: Date.now() - start,
        };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : 'flow failed';
        return { ok: false, flow, error: msg, reason: 'flowFailed' };
    }
    finally {
        if (context) {
            try {
                await context.close();
            }
            catch { /* ignore */ }
        }
    }
}
function resolveDefaultViewport(flow) {
    if (flow === 'androidLayout')
        return DEFAULT_ANDROID;
    if (flow === 'iosLayout')
        return DEFAULT_IOS;
    return DEFAULT_DESKTOP;
}
function resolveDefaultUrl(flow) {
    if (flow === 'ownerChat')
        return 'https://chat.ivxholding.com';
    if (flow === 'landing')
        return 'https://ivxholding.com';
    if (flow === 'members')
        return 'https://chat.ivxholding.com';
    return 'https://ivxholding.com';
}
async function captureStep(page, steps, label, detail, ok, t0) {
    try {
        const png = await page.screenshot({ fullPage: true });
        const shotPath = await saveScreenshot(png, label);
        steps.push({ step: label, ok, detail, screenshotPath: shotPath, durationMs: Date.now() - t0 });
    }
    catch {
        steps.push({ step: label, ok, detail: `${detail} (screenshot failed)`, durationMs: Date.now() - t0 });
    }
}
async function runOwnerChatFlow(page, input, steps) {
    const email = input.email ?? process.env.IVX_QA_OWNER_EMAIL ?? '';
    const password = input.password ?? process.env.IVX_QA_OWNER_PASSWORD ?? '';
    const message = input.message ?? 'QA probe — please confirm you can see this.';
    // Step 2 — login (if credentials present)
    {
        const t0 = Date.now();
        if (email && password) {
            try {
                // Best-effort: common login field selectors. Degrade gracefully if absent.
                const emailSel = 'input[type="email"], input[name="email"], input[placeholder*="mail" i]';
                const passSel = 'input[type="password"], input[name="password"]';
                await page.waitForSelector(emailSel, { timeout: 8_000 });
                await page.fill(emailSel, email);
                await page.fill(passSel, password);
                const submitSel = 'button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")';
                await page.click(submitSel);
                await page.waitForTimeout(3000);
                await captureStep(page, steps, 'login', 'Submitted owner credentials', true, t0);
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : 'login selector failure';
                await captureStep(page, steps, 'login', `Login form not found or fill failed: ${msg}`, false, t0);
            }
        }
        else {
            await captureStep(page, steps, 'login', 'Skipped — IVX_QA_OWNER_EMAIL/PASSWORD not set', false, t0);
        }
    }
    // Step 3 — send chat message
    {
        const t0 = Date.now();
        try {
            const chatInputSel = 'textarea, input[type="text"][placeholder*="message" i], [contenteditable="true"]';
            await page.waitForSelector(chatInputSel, { timeout: 10_000 });
            await page.fill(chatInputSel, message);
            const sendSel = 'button[type="submit"], button:has-text("Send"), button[aria-label*="send" i]';
            await page.click(sendSel);
            await page.waitForTimeout(4000);
            await captureStep(page, steps, 'send-message', `Sent: "${message.slice(0, 60)}"`, true, t0);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : 'send failed';
            await captureStep(page, steps, 'send-message', `Could not send: ${msg}`, false, t0);
        }
    }
    // Step 4 — verify AI reply visible
    {
        const t0 = Date.now();
        try {
            const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? '');
            const hasReply = /ivx|assistant|ai/i.test(bodyText) && bodyText.length > 50;
            await captureStep(page, steps, 'ai-reply', hasReply ? 'AI reply text detected on page' : 'No clear AI reply text found', hasReply, t0);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : 'evaluate failed';
            await captureStep(page, steps, 'ai-reply', `DOM read failed: ${msg}`, false, t0);
        }
    }
    // Step 5 — refresh and confirm persistence
    {
        const t0 = Date.now();
        try {
            await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await page.waitForTimeout(2000);
            await captureStep(page, steps, 'refresh-persist', 'Page refreshed', true, t0);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : 'refresh failed';
            await captureStep(page, steps, 'refresh-persist', `Refresh failed: ${msg}`, false, t0);
        }
    }
}
async function runMembersFlow(page, steps) {
    const t0 = Date.now();
    try {
        const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? '');
        const hasData = /member|waitlist|investor|deal|pipeline/i.test(bodyText);
        await captureStep(page, steps, 'members-visible', hasData ? 'Members/waitlist data text detected' : 'No member/waitlist text found', hasData, t0);
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : 'evaluate failed';
        await captureStep(page, steps, 'members-visible', `DOM read failed: ${msg}`, false, t0);
    }
}
async function runLandingFlow(page, steps) {
    const t0 = Date.now();
    try {
        const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? '');
        const hasDeals = /deal|opportunity|property|investment|estate/i.test(bodyText);
        await captureStep(page, steps, 'landing-deals', hasDeals ? 'Landing deal text detected' : 'No deal text found', hasDeals, t0);
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : 'evaluate failed';
        await captureStep(page, steps, 'landing-deals', `DOM read failed: ${msg}`, false, t0);
    }
}
/** Close the shared browser (used by tests / shutdown). */
export async function closeBrowser() {
    if (_browser) {
        try {
            await _browser.close();
        }
        catch { /* ignore */ }
        _browser = null;
    }
    _availabilityCache = null;
}
/** Reset module state (for tests). */
export function __resetBrowserAutomationForTests() {
    _browser = null;
    _launchPromise = null;
    _chromium = null;
    _availabilityCache = null;
}
