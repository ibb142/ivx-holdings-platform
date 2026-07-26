/**
 * IVX Self-Upgrade Engine — IVX can build, fix, deploy, and improve itself.
 *
 * Extends the existing ivx-tool-self-upgrade lifecycle with additional
 * capabilities:
 *
 *   - build new modules      (delegates to app generator)
 *   - build new apps         (delegates to app generator)
 *   - fix bugs               (delegates to senior developer worker)
 *   - add APIs               (delegates to senior developer worker)
 *   - add frontend screens   (delegates to senior developer worker)
 *   - run QA                 (delegates to tool engine)
 *   - deploy                 (delegates to tool engine)
 *   - verify production      (delegates to tool engine)
 *   - create rollback plan   (delegates to tool engine)
 *   - improve its own tools  (delegates to self-upgrade)
 *
 * This is the BLOCK that proves IVX can truly operate independently.
 */
import { auditVault } from './ivx-secure-vault';
import { executeTool } from './ivx-tool-engine';
import { runSeniorDeveloperBrain } from './ivx-senior-developer-brain';
import { proposeNextTool, runSelfUpgrade } from './ivx-tool-self-upgrade';
export const SELF_UPGRADE_ENGINE_MARKER = 'ivx-self-upgrade-engine-2026-07-02';
// ─── Capability Definitions ──────────────────────────────────────────
const CAPABILITIES = [
    {
        capability: 'build_new_module',
        label: 'Build a new backend module or service',
        requiresCredentials: [],
    },
    {
        capability: 'build_new_app',
        label: 'Build a new frontend app screen or component',
        requiresCredentials: [],
    },
    {
        capability: 'fix_bugs',
        label: 'Fix bugs in existing code',
        requiresCredentials: [],
    },
    {
        capability: 'add_apis',
        label: 'Add new API endpoints',
        requiresCredentials: [],
    },
    {
        capability: 'add_frontend_screens',
        label: 'Add new frontend screens',
        requiresCredentials: [],
    },
    {
        capability: 'run_qa',
        label: 'Run production QA suite',
        requiresCredentials: [],
    },
    {
        capability: 'deploy',
        label: 'Deploy code to production via Render',
        requiresCredentials: ['IVX_RENDER_API_KEY', 'IVX_RENDER_SERVICE_ID'],
    },
    {
        capability: 'verify_production',
        label: 'Verify production endpoints and commit match',
        requiresCredentials: [],
    },
    {
        capability: 'create_rollback_plan',
        label: 'Create a rollback plan for production',
        requiresCredentials: ['IVX_RENDER_API_KEY', 'IVX_RENDER_SERVICE_ID'],
    },
    {
        capability: 'improve_own_tools',
        label: 'Propose, build, test, and activate new tools',
        requiresCredentials: [],
    },
];
// ─── Capability Checks ────────────────────────────────────────────────
async function checkCapability(cap, vaultBlockers) {
    const missingCredentials = cap.requiresCredentials.filter((name) => vaultBlockers.some((b) => b.includes(name)));
    const status = missingCredentials.length > 0 ? 'blocked' : 'ready';
    return {
        capability: cap.capability,
        status,
        label: cap.label,
        requiresCredentials: cap.requiresCredentials,
        missingCredentials,
        evidence: status === 'ready' ? 'Credentials present — capability available' : null,
        lastRun: null,
    };
}
/**
 * Execute a specific capability and return evidence.
 */
export async function executeCapability(capability, input = {}) {
    const start = Date.now();
    switch (capability) {
        case 'build_new_module':
        case 'build_new_app':
        case 'fix_bugs':
        case 'add_apis':
        case 'add_frontend_screens': {
            try {
                const result = await runSeniorDeveloperBrain({
                    goal: input.goal ?? `Execute capability: ${capability}`,
                    approvePatch: input.approvePatch ?? false,
                    approveGitDeploy: input.approveGitDeploy ?? false,
                    validationMode: 'focused',
                    systemMode: false,
                });
                return {
                    capability,
                    ok: result.ok,
                    result,
                    error: null,
                    durationMs: Date.now() - start,
                };
            }
            catch (err) {
                return {
                    capability,
                    ok: false,
                    result: null,
                    error: err instanceof Error ? err.message : String(err),
                    durationMs: Date.now() - start,
                };
            }
        }
        case 'run_qa': {
            const result = await executeTool('production.qa');
            return {
                capability,
                ok: result.ok,
                result,
                error: result.error,
                durationMs: Date.now() - start,
            };
        }
        case 'deploy': {
            const result = await executeTool('render.deploy', { clearCache: false });
            return {
                capability,
                ok: result.ok,
                result,
                error: result.error,
                durationMs: Date.now() - start,
            };
        }
        case 'verify_production': {
            const [health, version, commit] = await Promise.all([
                executeTool('production.health'),
                executeTool('production.version'),
                executeTool('commit.match'),
            ]);
            const allOk = health.ok && version.ok && commit.ok;
            return {
                capability,
                ok: allOk,
                result: { health, version, commit },
                error: allOk ? null : 'One or more verification checks failed',
                durationMs: Date.now() - start,
            };
        }
        case 'create_rollback_plan': {
            const deploys = await executeTool('render.logs', { limit: 5 });
            return {
                capability,
                ok: deploys.ok,
                result: {
                    latestDeploys: deploys.data?.deploys ?? [],
                    rollbackPlan: deploys.ok
                        ? 'To rollback: identify the last healthy deploy from the list and call render.rollback with its deployId.'
                        : 'Cannot create rollback plan without Render access.',
                },
                error: deploys.error,
                durationMs: Date.now() - start,
            };
        }
        case 'improve_own_tools': {
            try {
                const proposal = await proposeNextTool();
                if (!proposal) {
                    return {
                        capability,
                        ok: true,
                        result: { message: 'No new safe tools to build — all approved tools are already active.' },
                        error: null,
                        durationMs: Date.now() - start,
                    };
                }
                const proof = await runSelfUpgrade();
                return {
                    capability,
                    ok: proof.ok,
                    result: proof,
                    error: proof.ok ? null : proof.summary,
                    durationMs: Date.now() - start,
                };
            }
            catch (err) {
                return {
                    capability,
                    ok: false,
                    result: null,
                    error: err instanceof Error ? err.message : String(err),
                    durationMs: Date.now() - start,
                };
            }
        }
        default:
            return {
                capability,
                ok: false,
                result: null,
                error: `Unknown capability: ${capability}`,
                durationMs: Date.now() - start,
            };
    }
}
// ─── Full Report ──────────────────────────────────────────────────────
/**
 * Run a full self-upgrade capability audit.
 */
export async function runSelfUpgradeAudit() {
    const vault = await auditVault();
    const checks = await Promise.all(CAPABILITIES.map((cap) => checkCapability(cap, vault.blockers)));
    const ready = checks.filter((c) => c.status === 'ready').length;
    const blocked = checks.filter((c) => c.status === 'blocked').length;
    const failed = checks.filter((c) => c.status === 'failed').length;
    const unverified = checks.filter((c) => c.status === 'unverified').length;
    return {
        marker: SELF_UPGRADE_ENGINE_MARKER,
        generatedAt: new Date().toISOString(),
        capabilities: checks,
        ready,
        blocked,
        failed,
        unverified,
        allReady: blocked === 0 && failed === 0,
        blockers: [...new Set(checks.flatMap((c) => c.missingCredentials))],
        secretValuesReturned: false,
    };
}
export default {
    runSelfUpgradeAudit,
    executeCapability,
    SELF_UPGRADE_ENGINE_MARKER,
};
