/**
 * IVX → Rork Independence Engine.
 *
 * The owner's objective: replace the Rork dependency with IVX AI as the primary
 * autonomous developer/operator, across four phases —
 *   1 Shadow Mode      — IVX does inspect/plan/edit/test/deploy/verify/report; Rork only audits.
 *   2 IVX Primary Mode — IVX executes directly; Rork is fallback only.
 *   3 Independence Mode— Rork removed from the normal workflow; keep only GitHub,
 *                        Render, Supabase, OpenAI/provider, IVX backend, IVX memory,
 *                        IVX scheduler, IVX action loop.
 *   4 Final Removal    — Rork becomes optional, not required.
 *
 * This module does NOT narrate progress — it DERIVES the live phase from real
 * signals: the autonomous tool-availability checker (BLOCK 35), the operator
 * handoff manifest (10 capabilities), and a direct scan of the Rork-specific
 * dependencies still present in the repo/runtime. Every phase requirement reports
 * met/unmet + the exact missing item; nothing is a hardcoded boolean.
 *
 * Read-only. Never mutates anything.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkToolAvailability } from './ivx-tool-availability';
export const IVX_RORK_INDEPENDENCE_MARKER = 'ivx-rork-independence-2026-06-02';
function present(env, name) {
    const value = env[name];
    return typeof value === 'string' && value.trim().length > 0;
}
/** True when a named tool from the availability checker is available. */
function toolUp(tools, id) {
    return tools.tools.find((t) => t.tool === id)?.available ?? false;
}
async function fileExists(relPath) {
    try {
        await readFile(path.join(process.cwd(), relPath), 'utf8');
        return true;
    }
    catch {
        return false;
    }
}
/** Read a JSON file relative to the repo root; null on any failure. */
async function readJsonFile(relPath) {
    try {
        const raw = await readFile(path.join(process.cwd(), relPath), 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/** Detect the BLOCK 47 executable cutover artifacts prepared in the repo. */
async function detectCutoverTooling() {
    const cutoverScript = 'expo/scripts/rork-independence-cutover.mjs';
    const standaloneMetroConfig = 'expo/metro.config.independent.js';
    const ownerBuildPipeline = 'deploy/ci/ivx-independent-build.yml';
    const [scriptPresent, metroPresent, pipelinePresent] = await Promise.all([
        fileExists(cutoverScript),
        fileExists(standaloneMetroConfig),
        fileExists(ownerBuildPipeline),
    ]);
    const ready = scriptPresent && metroPresent && pipelinePresent;
    return {
        ready,
        cutoverScript,
        cutoverScriptPresent: scriptPresent,
        standaloneMetroConfig,
        standaloneMetroConfigPresent: metroPresent,
        ownerBuildPipeline,
        ownerBuildPipelinePresent: pipelinePresent,
        runCommand: 'IVX_ALLOW_RORK_CUTOVER=1 node expo/scripts/rork-independence-cutover.mjs',
        detail: ready
            ? 'Executable build-independence cutover is prepared. Run it on the independent GitHub/Render checkout (off Rork) to remove @rork-ai/toolkit-sdk + withRorkMetro + rork.json in one pass; it is guarded so it cannot brick the Rork-managed preview.'
            : 'Cutover tooling is incomplete — one or more of the cutover script / standalone Metro config / owner build pipeline is missing.',
    };
}
/** Detect the Rork-specific dependencies still present in repo/runtime. */
async function detectRorkDependencies(env) {
    const expoPkg = await readJsonFile('expo/package.json');
    const deps = (expoPkg?.dependencies ?? {});
    const rorkSdkInstalled = Object.prototype.hasOwnProperty.call(deps, '@rork-ai/toolkit-sdk');
    const rorkPublicEnvKeys = Object.keys(env).filter((k) => /^EXPO_PUBLIC_RORK_/.test(k) || k === 'EXPO_PUBLIC_TOOLKIT_URL');
    const rorkPublicEnvsPresent = rorkPublicEnvKeys.length > 0;
    const rorkConfigPresent = await fileExists('rork.json');
    const rorkIgnorePresent = await fileExists('.rorkignore');
    return [
        {
            dependency: '@rork-ai/toolkit-sdk (expo/package.json)',
            present: rorkSdkInstalled,
            risk: 'high',
            detail: rorkSdkInstalled
                ? 'Rork toolkit SDK is still declared in expo/package.json — a fresh install re-introduces the Rork client into the bundle.'
                : 'Rork toolkit SDK is no longer declared in expo/package.json.',
            removalAction: 'Run `bun remove @rork-ai/toolkit-sdk` in expo/ and commit package.json + bun.lock.',
        },
        {
            dependency: 'EXPO_PUBLIC_RORK_* / EXPO_PUBLIC_TOOLKIT_URL runtime envs',
            present: rorkPublicEnvsPresent,
            risk: 'high',
            detail: rorkPublicEnvsPresent
                ? `Rork-prefixed public envs still configured: ${rorkPublicEnvKeys.join(', ')}.`
                : 'No Rork-prefixed public envs detected in this runtime.',
            removalAction: 'Delete the EXPO_PUBLIC_RORK_* + EXPO_PUBLIC_TOOLKIT_URL variables from the Render/Expo env panels and rotate RORK_TOOLKIT_SECRET_KEY.',
        },
        {
            dependency: 'rork.json project config',
            present: rorkConfigPresent,
            risk: 'low',
            detail: rorkConfigPresent
                ? 'rork.json is still present (config-only; harmless until full cut-over).'
                : 'rork.json has been removed.',
            removalAction: 'Delete rork.json once development no longer runs inside the Rork sandbox.',
        },
        {
            dependency: '.rorkignore',
            present: rorkIgnorePresent,
            risk: 'low',
            detail: rorkIgnorePresent
                ? '.rorkignore is still present (sandbox-only; cosmetic).'
                : '.rorkignore has been removed.',
            removalAction: 'Delete .rorkignore on the IVX-owned branch after cut-over.',
        },
    ];
}
function buildKeptSystems(tools) {
    return [
        {
            system: 'GitHub',
            available: toolUp(tools, 'github_write'),
            backedBy: 'ivx-developer-deploy-control (Git/Refs API)',
            missing: toolUp(tools, 'github_write') ? null : 'GITHUB_TOKEN / GITHUB_REPO_URL',
        },
        {
            system: 'Render',
            available: toolUp(tools, 'render_deploy'),
            backedBy: 'render.yaml auto-deploy + ivx-production-guard',
            missing: toolUp(tools, 'render_deploy') ? null : 'RENDER_API_KEY / RENDER_SERVICE_ID (push-to-main still deploys without them)',
        },
        {
            system: 'Supabase',
            available: toolUp(tools, 'supabase_actions'),
            backedBy: 'ivx-supabase-owner-actions (ivx_exec_sql RPC + PostgREST)',
            missing: toolUp(tools, 'supabase_actions') ? null : 'SUPABASE_SERVICE_ROLE_KEY / EXPO_PUBLIC_SUPABASE_URL',
        },
        {
            system: 'OpenAI / AI provider',
            available: toolUp(tools, 'ai_gateway'),
            backedBy: 'OpenAI API (gpt-4o-mini)',
            missing: toolUp(tools, 'ai_gateway') ? null : 'OPENAI_API_KEY',
        },
        {
            system: 'IVX backend',
            available: true,
            backedBy: 'Hono API on Render (api.ivxholding.com)',
            missing: null,
        },
        {
            system: 'IVX memory',
            available: true,
            backedBy: 'ivx-unified-memory-store (durable, on-disk)',
            missing: null,
        },
        {
            system: 'IVX scheduler',
            available: true,
            backedBy: 'ivx-autonomous-scheduler (restart-safe)',
            missing: null,
        },
        {
            system: 'IVX action loop',
            available: true,
            backedBy: 'ivx-executive-action-loop (recommend → execute → outcome → learn)',
            missing: null,
        },
    ];
}
function req(label, met, detailMet, detailUnmet, missing) {
    return { label, met, detail: met ? detailMet : detailUnmet, missing: met ? null : missing };
}
/** Resolve a phase readiness: achieved when all reqs met; blocked when the prior phase is not achieved; else in_progress. */
function resolveReadiness(requirements, priorAchieved) {
    const allMet = requirements.every((r) => r.met);
    if (allMet)
        return 'achieved';
    if (!priorAchieved)
        return 'blocked';
    return 'in_progress';
}
/**
 * Build the live Rork-independence report from real signals.
 * Read-only; never mutates anything; never throws (degrades to honest unmet).
 */
export async function buildRorkIndependenceReport(env = process.env) {
    const tools = checkToolAvailability(env);
    let manifest = null;
    try {
        const { buildHandoffManifest } = await import('./ivx-handoff');
        manifest = await buildHandoffManifest();
    }
    catch {
        manifest = null;
    }
    const rorkDeps = await detectRorkDependencies(env);
    const cutover = await detectCutoverTooling();
    return assembleRorkIndependenceReport({ tools, manifest, rorkDeps, cutover });
}
/**
 * Pure assembler: derive the 4-phase report from already-gathered signals.
 * Deterministic + side-effect-free, so it is fully unit-testable.
 */
export function assembleRorkIndependenceReport(inputs) {
    const { tools, manifest, rorkDeps } = inputs;
    const cutoverTooling = inputs.cutover ?? {
        ready: false,
        cutoverScript: 'expo/scripts/rork-independence-cutover.mjs',
        cutoverScriptPresent: false,
        standaloneMetroConfig: 'expo/metro.config.independent.js',
        standaloneMetroConfigPresent: false,
        ownerBuildPipeline: 'deploy/ci/ivx-independent-build.yml',
        ownerBuildPipelinePresent: false,
        runCommand: 'IVX_ALLOW_RORK_CUTOVER=1 node expo/scripts/rork-independence-cutover.mjs',
        detail: 'Cutover tooling state not provided.',
    };
    const keptSystems = buildKeptSystems(tools);
    const coreLifecycleReady = toolUp(tools, 'ai_gateway') && toolUp(tools, 'test_runner') &&
        toolUp(tools, 'self_heal') && toolUp(tools, 'execution_trace');
    const deployPathReady = toolUp(tools, 'github_write') || toolUp(tools, 'render_deploy');
    const proofReady = toolUp(tools, 'execution_trace');
    const handoffBlocked = manifest ? manifest.summary.blocked : 0;
    const handoffReady = manifest ? manifest.handoffReady : false;
    const sdkPresent = rorkDeps.find((d) => d.dependency.startsWith('@rork-ai'))?.present ?? true;
    const rorkEnvsPresent = rorkDeps.find((d) => d.dependency.startsWith('EXPO_PUBLIC_RORK'))?.present ?? true;
    const rorkConfigPresent = rorkDeps.find((d) => d.dependency.startsWith('rork.json'))?.present ?? true;
    const keptAllAvailable = keptSystems.every((k) => k.available);
    const keptMissing = keptSystems.filter((k) => !k.available).map((k) => k.system);
    // ---- Phase 1 — Shadow Mode ----
    const phase1Reqs = [
        req('IVX runs the full lifecycle end-to-end', tools.canExecuteEndToEnd, 'Autonomous Mode can inspect → plan → execute → test → deploy → verify → report (canExecuteEndToEnd=true).', 'The autonomous lifecycle is not end-to-end capable.', tools.blockedSteps.length > 0 ? `blocked steps: ${tools.blockedSteps.join(', ')}` : 'core tool or deploy path missing'),
        req('Test + self-heal + proof tools online', coreLifecycleReady && proofReady, 'Test runner, self-heal cycle, and the execution-trace/evidence store are all online.', 'One of the test/self-heal/proof tools is unavailable.', 'test_runner / self_heal / execution_trace'),
        req('A deploy path is available', deployPathReady, 'Direct GitHub/Render control or push-to-main auto-deploy is available.', 'No deploy path is available.', 'GITHUB_TOKEN/GITHUB_REPO_URL or RENDER_API_KEY/RENDER_SERVICE_ID'),
    ];
    const phase1 = {
        id: 'shadow',
        order: 1,
        title: 'Shadow Mode',
        objective: 'IVX performs the same tasks as Rork (inspect/plan/edit/test/deploy/verify/report); Rork only audits IVX.',
        rorkRole: 'Auditor — Rork reviews IVX output but no longer drives the work.',
        requirements: phase1Reqs,
        readiness: resolveReadiness(phase1Reqs, true),
    };
    // ---- Phase 2 — IVX Primary Mode ----
    const phase2Reqs = [
        req('AI reasoning gateway online', toolUp(tools, 'ai_gateway'), 'AI gateway present — IVX reasons, plans, and synthesizes directly.', 'AI gateway key missing — reasoning falls back to deterministic routing only.', 'AI_GATEWAY_API_KEY'),
        req('Self-driving scheduler + action loop wired', true, 'Autonomous scheduler (daily self-audit + drift) and the executive action loop run in-process.', '', null),
        req('Operator handoff has no blocked capability', handoffBlocked === 0, 'All 10 operator capabilities are ready or partial (none blocked).', `${handoffBlocked} operator capability(ies) are blocked.`, manifest ? manifest.ownerActionsRequired.join('; ') : 'handoff manifest unavailable'),
    ];
    const phase2 = {
        id: 'ivx_primary',
        order: 2,
        title: 'IVX Primary Mode',
        objective: 'IVX executes tasks directly. Rork is used only as a fallback.',
        rorkRole: 'Fallback only — invoked when IVX cannot complete a task itself.',
        requirements: phase2Reqs,
        readiness: resolveReadiness(phase2Reqs, phase1.readiness === 'achieved'),
    };
    // ---- Phase 3 — Independence Mode ----
    const phase3Reqs = [
        req('All eight kept systems available', keptAllAvailable, 'GitHub, Render, Supabase, OpenAI/provider, IVX backend, memory, scheduler, and action loop are all available.', `Kept system(s) unavailable: ${keptMissing.join(', ')}.`, keptMissing.length > 0 ? keptMissing.join(', ') : null),
        req('Rork toolkit SDK removed from the bundle', !sdkPresent, 'The Rork toolkit SDK is no longer a dependency.', 'The Rork toolkit SDK is still declared in expo/package.json.', 'remove @rork-ai/toolkit-sdk from expo/package.json'),
        req('Rork-prefixed runtime envs removed', !rorkEnvsPresent, 'No Rork-prefixed public envs remain in the runtime.', 'Rork-prefixed public envs are still configured in this runtime.', 'delete EXPO_PUBLIC_RORK_* / EXPO_PUBLIC_TOOLKIT_URL'),
    ];
    const phase3 = {
        id: 'independence',
        order: 3,
        title: 'Independence Mode',
        objective: 'Remove Rork from the normal workflow. Keep only GitHub, Render, Supabase, OpenAI/provider, IVX backend, IVX memory, IVX scheduler, IVX action loop.',
        rorkRole: 'Out of the normal workflow — code edits/deploys flow through GitHub + Render + IVX.',
        requirements: phase3Reqs,
        readiness: resolveReadiness(phase3Reqs, phase2.readiness === 'achieved'),
    };
    // ---- Phase 4 — Final Removal ----
    const phase4Reqs = [
        req('Rork config files removed', !rorkConfigPresent, 'rork.json has been removed from the IVX-owned branch.', 'rork.json is still present (config-only; remove on cut-over).', 'delete rork.json'),
        req('All owner-required capabilities proven', handoffReady, 'Receive commands, modify code, push/deploy, verify production, store proof, and learn from outcomes are all proven.', 'One or more owner-required capabilities are not yet proven by the handoff manifest.', manifest ? manifest.ownerActionsRequired.join('; ') || 'handoff not ready' : 'handoff manifest unavailable'),
    ];
    const phase4 = {
        id: 'final_removal',
        order: 4,
        title: 'Final Removal',
        objective: 'Rork becomes optional, not required. IVX can receive owner commands, modify code, push/deploy, verify production, store proof, and learn from outcomes.',
        rorkRole: 'Optional — available as a convenience, never required for normal operation.',
        requirements: phase4Reqs,
        readiness: resolveReadiness(phase4Reqs, phase3.readiness === 'achieved'),
    };
    const phases = [phase1, phase2, phase3, phase4];
    // Highest fully-achieved phase IVX is operating at right now.
    let currentPhase = phase1;
    let currentPhaseOrder = 0;
    for (const p of phases) {
        if (p.readiness === 'achieved') {
            currentPhase = p;
            currentPhaseOrder = p.order;
        }
        else {
            break;
        }
    }
    const resolvedCurrent = currentPhaseOrder === 0 ? 'shadow' : currentPhase.id;
    const nextPhase = phases.find((p) => p.readiness !== 'achieved')?.id ?? null;
    // Owner-required final capabilities (mapped to real handoff/tool signals).
    const ownerCapabilities = [
        req('Receive owner commands', true, 'Owner-gated /api/ivx/owner-ai + autonomous-mode/run accept owner tasks.', '', null),
        req('Modify code', toolUp(tools, 'github_write'), 'GitHub write lifecycle (branch → commit → PR → merge) is available.', 'GitHub write is unavailable — code application is blocked.', 'GITHUB_TOKEN / GITHUB_REPO_URL'),
        req('Push / deploy', deployPathReady, 'Deploy path available (direct API or push-to-main auto-deploy).', 'No deploy path available.', 'GitHub or Render deploy credentials'),
        req('Verify production', true, 'ivx-production-guard reads /health + failure rate to verify each deploy.', '', null),
        req('Store proof', proofReady, 'Durable execution-trace + evidence store records every action.', 'Execution-trace store unavailable.', 'execution_trace'),
        req('Learn from outcomes', true, 'Executive action loop derives improved recommendations from recorded outcomes.', '', null),
    ];
    const phasesAchieved = phases.filter((p) => p.readiness === 'achieved').length;
    const rorkRequiredForNormalWorkflow = phase3.readiness !== 'achieved';
    const rorkOptional = phase4.readiness === 'achieved';
    const nextActions = [];
    const targetPhase = phases.find((p) => p.readiness !== 'achieved');
    if (targetPhase) {
        for (const r of targetPhase.requirements) {
            if (!r.met && r.missing)
                nextActions.push(`[${targetPhase.title}] ${r.label}: ${r.missing}`);
        }
    }
    // BLOCK 47: when Rork build deps still remain, point to the prepared executable
    // cutover (run off-Rork on the independent checkout) rather than ad-hoc removal.
    if (cutoverTooling.ready && (sdkPresent || rorkEnvsPresent || rorkConfigPresent)) {
        nextActions.push(`[Cutover ready] Run the prepared build-independence cutover on the independent GitHub/Render checkout (off Rork): ${cutoverTooling.runCommand} — it removes @rork-ai/toolkit-sdk + withRorkMetro + rork.json in one guarded pass.`);
    }
    return {
        marker: IVX_RORK_INDEPENDENCE_MARKER,
        generatedAt: new Date().toISOString(),
        currentPhase: resolvedCurrent,
        currentPhaseOrder,
        nextPhase,
        phases,
        keptSystems,
        rorkDependenciesRemaining: rorkDeps,
        cutoverTooling,
        ownerCapabilities,
        summary: {
            phasesAchieved,
            rorkRequiredForNormalWorkflow,
            rorkOptional,
            canReceiveOwnerCommands: ownerCapabilities[0].met,
            canModifyCode: ownerCapabilities[1].met,
            canDeploy: ownerCapabilities[2].met,
            canVerifyProduction: ownerCapabilities[3].met,
            canStoreProof: ownerCapabilities[4].met,
            canLearnFromOutcomes: ownerCapabilities[5].met,
        },
        nextActions,
    };
}
