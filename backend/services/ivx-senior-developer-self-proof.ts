/**
 * IVX Senior Developer — one-click, no-token, in-process production self-proof.
 *
 * WHY THIS EXISTS
 *   The Senior Developer mutation route (`POST /api/ivx/senior-developer/run`)
 *   is intentionally gated by a real Supabase owner bearer. That makes a live,
 *   end-to-end proof (create feature -> commit to GitHub -> deploy to Render ->
 *   verify live) impossible to trigger without first minting an owner JWT, and
 *   the GitHub/Render/Supabase credentials only exist on the PRODUCTION runtime
 *   (never in a developer sandbox).
 *
 *   This module removes that friction for the OWNER: it runs the exact same real
 *   runtime IN-PROCESS in `systemMode` (so it uses the production-side
 *   credentials directly), then persists a compact, secret-free proof to durable
 *   Supabase storage so it survives the very deploy it triggers.
 *
 * LOOP / ABUSE SAFETY
 *   - A hard cooldown (`SELF_PROOF_COOLDOWN_MS`) means a fresh commit+deploy can
 *     be triggered at most once per window; within the window the durable cached
 *     proof is returned instead of pushing another commit.
 *   - An in-process lock prevents concurrent runs.
 *   - The underlying runtime only ever writes allowlisted, non-destructive
 *     generated-feature files — never secrets, never destructive edits.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditDir } from './ivx-data-root';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson } from './ivx-durable-store';
import {
  IVX_GIT_DEPLOY_CONFIRM_TEXT,
  IVX_SAFE_PATCH_CONFIRM_TEXT,
  runIVXSeniorDeveloperTask,
} from './ivx-senior-developer-runtime';

export const IVX_SENIOR_DEVELOPER_SELF_PROOF_MARKER = 'ivx-senior-developer-self-proof-v1';

/** Minimum gap between real commit+deploy runs. Within this window the cached proof is served. */
const SELF_PROOF_COOLDOWN_MS = 10 * 60 * 1000;

const ROOT = auditDir('senior-developer-self-proof');
const STATE_FILE = path.join(ROOT, 'latest.json');

/** Compact, secret-free, owner-readable proof of the full end-to-end run. */
export type IVXSeniorDeveloperSelfProof = {
  marker: typeof IVX_SENIOR_DEVELOPER_SELF_PROOF_MARKER;
  ok: boolean;
  endToEndProductionComplete: boolean;
  goal: string;
  jobId: string;
  /** 1. New feature created */
  feature: {
    built: boolean;
    slug: string | null;
    title: string | null;
    liveRoute: string | null;
    liveUrl: string | null;
  };
  /** 2. Commit pushed + 3. GitHub SHA */
  github: {
    committed: boolean;
    commitSha: string | null;
    commitUrl: string | null;
    branch: string | null;
    committedPaths: string[];
    /** Raw GitHub API failure (status + message + docs url), secret-free, when the commit fails. */
    error: string | null;
  };
  /** 4. Render deployment triggered */
  render: {
    deployTriggered: boolean;
    deployId: string | null;
    deployStatus: string | null;
    /** Raw Render API failure, secret-free, when the deploy trigger fails. */
    error: string | null;
  };
  /** 5. Production HTTP 200 from the live feature subsystem */
  production: {
    healthHttpStatus: number | null;
    healthOk: boolean;
    featuresRouteHttpStatus: number | null;
    featuresRouteOk: boolean;
    featuresRouteEndpoint: string | null;
  };
  validationPassed: boolean;
  changedFiles: string[];
  blocker: string | null;
  ranAt: string;
  secretValuesReturned: false;
};

export type IVXSeniorDeveloperSelfProofResponse = IVXSeniorDeveloperSelfProof & {
  cached: boolean;
  /** True when the cooldown window has elapsed — the proof is historical, not active. */
  stale?: boolean;
  cooldownMs: number;
  nextEligibleAt: string | null;
};

let inFlight: Promise<IVXSeniorDeveloperSelfProof> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function productionBaseUrl(): string {
  const read = (name: string): string => (typeof process.env[name] === 'string' ? (process.env[name] ?? '').trim() : '');
  return (
    read('PRODUCTION_BASE_URL')
    || read('EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL')
    || read('EXPO_PUBLIC_IVX_API_BASE_URL')
    || read('EXPO_PUBLIC_API_BASE_URL')
    || 'https://api.ivxholding.com'
  ).replace(/\/+$/, '');
}

async function readLatest(): Promise<IVXSeniorDeveloperSelfProof | null> {
  try {
    if (isDurableStoreConfigured()) {
      const value = await readDurableJson<IVXSeniorDeveloperSelfProof | null>(STATE_FILE, null);
      return value && value.marker === IVX_SENIOR_DEVELOPER_SELF_PROOF_MARKER ? value : null;
    }
    const raw = await readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as IVXSeniorDeveloperSelfProof;
    return parsed && parsed.marker === IVX_SENIOR_DEVELOPER_SELF_PROOF_MARKER ? parsed : null;
  } catch {
    return null;
  }
}

async function persistLatest(proof: IVXSeniorDeveloperSelfProof): Promise<void> {
  try {
    if (isDurableStoreConfigured()) {
      await writeDurableJson(STATE_FILE, proof);
      return;
    }
    await mkdir(ROOT, { recursive: true });
    await writeFile(STATE_FILE, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.log('[IVXSeniorDeveloperSelfProof] persist failed:', error instanceof Error ? error.message : 'unknown');
  }
}

function defaultGoal(): string {
  const stamp = nowIso();
  return `Senior Developer end-to-end production self-proof: create a brand-new live feature module, commit it to GitHub (real SHA), trigger a Render deploy, and verify the live production feature subsystem responds 200. Run id ${stamp}.`;
}

/**
 * Run the real runtime in systemMode and project it onto the compact owner proof.
 *
 * Every field is read null-safely. The underlying runtime proof shape can evolve
 * across deploys, so a missing/renamed field must surface as a clear blocker in
 * the proof payload — it must never throw and turn the owner endpoint into a 500.
 */
async function executeRealProof(goal: string): Promise<IVXSeniorDeveloperSelfProof> {
  const result = await runIVXSeniorDeveloperTask({
    goal,
    systemMode: true,
    approvePatch: true,
    patchConfirmationText: IVX_SAFE_PATCH_CONFIRM_TEXT,
    approveGitDeploy: true,
    gitDeployConfirmationText: IVX_GIT_DEPLOY_CONFIRM_TEXT,
    validationMode: 'focused',
  });

  const r = (result ?? {}) as Partial<typeof result>;
  const generatedFeature = (r.generatedFeature ?? {}) as Record<string, unknown>;
  const gitDeployOperator = (r.gitDeployOperator ?? {}) as Record<string, unknown>;
  const github = ((gitDeployOperator.github ?? {}) as Record<string, unknown>);
  const render = ((gitDeployOperator.render ?? {}) as Record<string, unknown>);
  const productionVerification = ((r.productionVerification ?? {}) as Record<string, unknown>);
  const changedRouteVerification = ((r.changedRouteVerification ?? {}) as Record<string, unknown>);
  const validations = Array.isArray(r.validations) ? r.validations : [];
  const changedFiles = Array.isArray(r.changedFiles) ? r.changedFiles : [];
  const feature = (generatedFeature.feature ?? null) as Record<string, unknown> | null;

  const asString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
  const asNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const asStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

  const liveRoute = asString(generatedFeature.liveRoute);
  const commitSha = asString(github.commitSha);
  const committed = gitDeployOperator.status === 'executed' && Boolean(commitSha);
  const validationPassed = validations.length > 0 && validations.every((entry) => Boolean((entry as { ok?: boolean }).ok));
  const ok = Boolean(r.ok);

  return {
    marker: IVX_SENIOR_DEVELOPER_SELF_PROOF_MARKER,
    ok,
    endToEndProductionComplete: Boolean(r.endToEndProductionComplete),
    goal: asString(r.goal) ?? goal,
    jobId: asString(r.jobId) ?? '',
    feature: {
      built: Boolean(generatedFeature.built),
      slug: asString(feature?.slug),
      title: asString(feature?.title),
      liveRoute,
      liveUrl: liveRoute ? `${productionBaseUrl()}${liveRoute}` : null,
    },
    github: {
      committed,
      commitSha,
      commitUrl: asString(github.commitUrl),
      branch: asString(github.branch),
      committedPaths: asStringArray(github.committedPaths),
      error: asString(github.error),
    },
    render: {
      deployTriggered: Boolean(render.deployAttempted),
      deployId: asString(render.deployId),
      deployStatus: asString(render.deployStatus),
      error: asString(render.error),
    },
    production: {
      healthHttpStatus: asNumber(productionVerification.httpStatus),
      healthOk: Boolean(productionVerification.ok),
      featuresRouteHttpStatus: asNumber(changedRouteVerification.httpStatus),
      featuresRouteOk: Boolean(changedRouteVerification.ok),
      featuresRouteEndpoint: asString(changedRouteVerification.endpoint),
    },
    validationPassed,
    changedFiles,
    blocker: ok
      ? null
      : (asString(github.error)
        || asString(render.error)
        || asString(gitDeployOperator.reason)
        || asString(productionVerification.error)
        || 'Senior developer self-proof did not complete end-to-end.'),
    ranAt: nowIso(),
    secretValuesReturned: false,
  };
}

/**
 * Owner-facing entry point. Returns the cached proof when a real run already
 * happened inside the cooldown window (unless `force` is set), otherwise runs the
 * real end-to-end proof in-process and persists it durably.
 */
export async function runSeniorDeveloperSelfProof(options: { force?: boolean } = {}): Promise<IVXSeniorDeveloperSelfProofResponse> {
  const latest = await readLatest();
  const lastRanMs = latest ? Date.parse(latest.ranAt) : Number.NaN;
  const withinCooldown = Number.isFinite(lastRanMs) && Date.now() - lastRanMs < SELF_PROOF_COOLDOWN_MS;
  const nextEligibleAt = Number.isFinite(lastRanMs) ? new Date(lastRanMs + SELF_PROOF_COOLDOWN_MS).toISOString() : null;

  // Serve the durable cached proof when a real run already happened within the
  // cooldown window. `force` only bypasses a SUCCESSFUL cache — never the
  // cooldown — so the endpoint can never be used to spam commits/deploys.
  if (latest && withinCooldown && (!options.force || latest.ok)) {
    return { ...latest, cached: true, cooldownMs: SELF_PROOF_COOLDOWN_MS, nextEligibleAt };
  }

  if (inFlight) {
    const running = await inFlight;
    return { ...running, cached: true, cooldownMs: SELF_PROOF_COOLDOWN_MS, nextEligibleAt };
  }

  inFlight = (async () => {
    const proof = await executeRealProof(defaultGoal());
    await persistLatest(proof);
    return proof;
  })();

  try {
    const proof = await inFlight;
    const ranMs = Date.parse(proof.ranAt);
    return {
      ...proof,
      cached: false,
      cooldownMs: SELF_PROOF_COOLDOWN_MS,
      nextEligibleAt: Number.isFinite(ranMs) ? new Date(ranMs + SELF_PROOF_COOLDOWN_MS).toISOString() : null,
    };
  } finally {
    inFlight = null;
  }
}

/** Read-only: return the last persisted self-proof without triggering a new run.
 *  A proof whose cooldown window has elapsed is marked `stale: true` so callers can
 *  distinguish a live/in-window result from historical data. Stale proofs are still
 *  served (this is a read-only endpoint), but consumers should not treat a stale
 *  non-ok proof as an active failure. */
export async function getLatestSeniorDeveloperSelfProof(): Promise<IVXSeniorDeveloperSelfProofResponse | null> {
  const latest = await readLatest();
  if (!latest) return null;
  const lastRanMs = Date.parse(latest.ranAt);
  const withinCooldown = Number.isFinite(lastRanMs) && Date.now() - lastRanMs < SELF_PROOF_COOLDOWN_MS;
  return {
    ...latest,
    cached: true,
    stale: !withinCooldown,
    cooldownMs: SELF_PROOF_COOLDOWN_MS,
    nextEligibleAt: Number.isFinite(lastRanMs) ? new Date(lastRanMs + SELF_PROOF_COOLDOWN_MS).toISOString() : null,
  };
}
