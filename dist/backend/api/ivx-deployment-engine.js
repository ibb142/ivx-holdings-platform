import { assertIVXOwnerOnly, ownerOnlyJson } from './owner-only';
import { getDeploymentState, initializeDeploymentEngine, runDeploymentCycle, triggerRenderDeploy, getGitHubHeadSha, getProductionHealth, verifyCommitMatch, discoverCredentials, generateDeploymentEvidence, generateEvidenceReport, startAutonomousMonitor, stopAutonomousMonitor, } from '../services/ivx-enterprise-deployment-engine';
// ─── CORS Helpers ──────────────────────────────────────────────────────
const PUBLIC_HEADERS = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'https://ivxholding.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
};
function publicJson(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: PUBLIC_HEADERS });
}
// ─── OPTIONS ────────────────────────────────────────────────────────────
export function OPTIONS() {
    return new Response(null, { status: 204, headers: PUBLIC_HEADERS });
}
// ─── PUBLIC: Deployment Status ──────────────────────────────────────────
export async function handleDeployStatus() {
    await initializeDeploymentEngine();
    const state = getDeploymentState();
    return publicJson({
        ok: true,
        initialized: state.initialized,
        autonomousMode: state.autonomousMode,
        driftDetected: state.driftDetected,
        lastCheck: state.lastCheck,
        lastDeploy: state.lastDeploy,
        deploymentCount: state.deploymentHistory.length,
        credentialCount: state.credentials.length,
        credentialsValid: state.credentials.filter(c => c.status === 'valid').length,
        credentialsMasked: state.credentials.map(c => ({ name: c.name, status: c.status, masked: c.masked })),
        currentEvidence: state.currentEvidence,
        timestamp: new Date().toISOString(),
    });
}
// ─── PUBLIC: Deployment Evidence ────────────────────────────────────────
export async function handleDeployEvidence() {
    const evidence = await generateDeploymentEvidence();
    return publicJson({
        ok: true,
        evidence,
        report: generateEvidenceReport(evidence),
        timestamp: new Date().toISOString(),
    });
}
// ─── AUTH: Trigger Deploy ──────────────────────────────────────────────
export async function handleDeployTrigger(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'unauthorized';
        return ownerOnlyJson({ ok: false, error: message }, 401);
    }
    const clearCache = false;
    const trigger = await triggerRenderDeploy(clearCache);
    if (!trigger.ok || !trigger.deploy) {
        return ownerOnlyJson({
            ok: false,
            error: trigger.error ?? 'Failed to trigger deploy',
            deploy: trigger.deploy,
        }, 502);
    }
    return ownerOnlyJson({
        ok: true,
        deploy: trigger.deploy,
        message: `Deploy triggered: ${trigger.deploy.id}`,
        timestamp: new Date().toISOString(),
    });
}
// ─── AUTH: Verify Production ───────────────────────────────────────────
export async function handleDeployVerify(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'unauthorized';
        return ownerOnlyJson({ ok: false, error: message }, 401);
    }
    const [github, prod, match] = await Promise.all([
        getGitHubHeadSha(),
        getProductionHealth(),
        verifyCommitMatch(),
    ]);
    return ownerOnlyJson({
        ok: true,
        github,
        production: prod,
        commitMatch: match,
        timestamp: new Date().toISOString(),
    });
}
// ─── AUTH: Run Deployment Cycle ─────────────────────────────────────────
export async function handleDeployCycle(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'unauthorized';
        return ownerOnlyJson({ ok: false, error: message }, 401);
    }
    const result = await runDeploymentCycle();
    return ownerOnlyJson({
        ok: true,
        driftDetected: result.driftDetected,
        deployTriggered: result.deployTriggered,
        deployId: result.deployId,
        evidence: result.evidence,
        report: generateEvidenceReport(result.evidence),
        timestamp: new Date().toISOString(),
    });
}
// ─── AUTH: Credentials Audit ───────────────────────────────────────────
export async function handleDeployCredentialsAudit(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'unauthorized';
        return ownerOnlyJson({ ok: false, error: message }, 401);
    }
    const credentials = await discoverCredentials();
    return ownerOnlyJson({
        ok: true,
        credentials: credentials.map(c => ({
            name: c.name,
            status: c.status,
            present: c.present,
            source: c.source,
            tested: c.tested,
            testResult: c.testResult,
            masked: c.masked,
        })),
        validCount: credentials.filter(c => c.status === 'valid').length,
        totalCount: credentials.length,
        timestamp: new Date().toISOString(),
    });
}
// ─── AUTH: Monitor Control ─────────────────────────────────────────────
export async function handleDeployMonitorStart(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'unauthorized';
        return ownerOnlyJson({ ok: false, error: message }, 401);
    }
    startAutonomousMonitor();
    const state = getDeploymentState();
    return ownerOnlyJson({
        ok: true,
        message: 'Autonomous deployment monitor started (5 min interval)',
        autonomousMode: state.autonomousMode,
        timestamp: new Date().toISOString(),
    });
}
export async function handleDeployMonitorStop(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'unauthorized';
        return ownerOnlyJson({ ok: false, error: message }, 401);
    }
    stopAutonomousMonitor();
    const state = getDeploymentState();
    return ownerOnlyJson({
        ok: true,
        message: 'Autonomous deployment monitor stopped',
        autonomousMode: state.autonomousMode,
        timestamp: new Date().toISOString(),
    });
}
// ─── PUBLIC: Health + Version (for external verification) ──────────────
export async function handleDeployHealth() {
    const [prod, match] = await Promise.all([
        getProductionHealth(),
        verifyCommitMatch(),
    ]);
    return publicJson({
        ok: prod.ok,
        status: prod.status ?? 'unknown',
        productionCommit: prod.commitShort || prod.commit,
        productionBootTime: prod.bootTime,
        commitMatch: match.match,
        githubHead: match.githubSha,
        productionSha: match.productionSha,
        timestamp: new Date().toISOString(),
    });
}
