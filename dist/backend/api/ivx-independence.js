/**
 * IVX Independence API Routes
 *
 * Exposes all independence-layer endpoints:
 *   GET  /api/ivx/independence/vault        — vault audit
 *   GET  /api/ivx/independence/tools         — tool catalog
 *   POST /api/ivx/independence/tools/:name   — execute a tool
 *   POST /api/ivx/independence/brain         — run the brain
 *   GET  /api/ivx/independence/brain/status  — brain status
 *   GET  /api/ivx/independence/upgrade/audit — self-upgrade audit
 *   POST /api/ivx/independence/upgrade/run   — execute capability
 *   GET  /api/ivx/independence/scanner       — technology scan
 *   GET  /api/ivx/independence/verify        — full independence verification
 *   GET  /api/ivx/independence/status        — quick independence status
 */
import { Hono } from 'hono';
import { auditVault, buildVaultStatus } from '../services/ivx-secure-vault';
import { executeTool, TOOL_CATALOG, EXTENDED_TOOLS } from '../services/ivx-tool-engine';
import { runSeniorDeveloperBrain, getBrainStatus } from '../services/ivx-senior-developer-brain';
import { runSelfUpgradeAudit, executeCapability } from '../services/ivx-self-upgrade-engine';
import { runTechnologyScan } from '../services/ivx-technology-scanner';
import { verifyIndependence, quickIndependenceCheck } from '../services/ivx-independence-verifier';
const independenceRoutes = new Hono();
// ─── Vault ──────────────────────────────────────────────────────────
independenceRoutes.get('/vault', async (c) => {
    const audit = await auditVault();
    return c.json(audit);
});
independenceRoutes.get('/vault/status', async (c) => {
    const status = buildVaultStatus();
    return c.json(status);
});
// ─── Tools ──────────────────────────────────────────────────────────
independenceRoutes.get('/tools', async (c) => {
    const allTools = [...TOOL_CATALOG, ...EXTENDED_TOOLS].map((t) => ({
        name: t.name,
        category: t.category,
        purpose: t.purpose,
        requiresCredentials: t.requiresCredentials,
    }));
    return c.json({ ok: true, toolCount: allTools.length, tools: allTools });
});
independenceRoutes.post('/tools/:name', async (c) => {
    const toolName = c.req.param('name');
    const body = await c.req.json().catch(() => ({}));
    const result = await executeTool(toolName, body);
    return c.json(result, result.ok ? 200 : 500);
});
// ─── Brain ──────────────────────────────────────────────────────────
independenceRoutes.post('/brain', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const result = await runSeniorDeveloperBrain({
        goal: body.goal ?? 'Audit and report',
        approvePatch: body.approvePatch ?? false,
        approveGitDeploy: body.approveGitDeploy ?? false,
        validationMode: body.validationMode ?? 'focused',
        systemMode: body.systemMode ?? false,
    });
    return c.json(result, result.ok ? 200 : 500);
});
independenceRoutes.get('/brain/status', async (c) => {
    const status = await getBrainStatus();
    return c.json(status);
});
// ─── Self-Upgrade ───────────────────────────────────────────────────
independenceRoutes.get('/upgrade/audit', async (c) => {
    const audit = await runSelfUpgradeAudit();
    return c.json(audit);
});
independenceRoutes.post('/upgrade/run', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const result = await executeCapability(body.capability ?? 'run_qa', {
        goal: body.goal,
        approvePatch: body.approvePatch,
        approveGitDeploy: body.approveGitDeploy,
    });
    return c.json(result, result.ok ? 200 : 500);
});
// ─── Scanner ────────────────────────────────────────────────────────
independenceRoutes.get('/scanner', async (c) => {
    const scan = await runTechnologyScan();
    return c.json(scan);
});
// ─── Independence Verification ──────────────────────────────────────
independenceRoutes.get('/verify', async (c) => {
    const report = await verifyIndependence();
    return c.json(report, report.finalStatus === 'VERIFIED' ? 200 : 500);
});
independenceRoutes.get('/status', async (c) => {
    const status = await quickIndependenceCheck();
    return c.json(status);
});
// ─── OPTIONS (CORS preflight) ───────────────────────────────────────
independenceRoutes.options('*', (c) => {
    return c.body(null, 204);
});
export { independenceRoutes };
export default independenceRoutes;
