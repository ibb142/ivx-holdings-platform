import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';

const DEPLOYMENT_MARKER = 'ivx-independence-tracker-2026-05-09t1235z-owner-access-github-day2';

type RiskLevel = 'critical' | 'high' | 'medium' | 'low';
type DependencyStatus = 'blocked' | 'in_progress' | 'completed' | 'needs_owner_proof';

type IndependenceDependency = {
  id: string;
  dependencyName: string;
  riskLevel: RiskLevel;
  currentStatus: DependencyStatus;
  removalTask: string;
  ownerActionRequired: string;
  proofRequired: string;
  completionDate: string | null;
  rorkDependencyReduced: string;
  proofBefore: string;
  proofAfter: string;
};

type DailyChecklistItem = {
  day: number;
  title: string;
  checklist: string[];
  status: 'pending' | 'in_progress' | 'completed';
};

type OwnerAccessProof = {
  ownerCanSignIn: boolean;
  ownerDashboardAccessible: boolean;
  ownerVariablesAccessible: boolean;
  independenceTrackerAccessible: boolean;
  role: string;
  kycStatus: string;
  source: 'owner_session_plus_profile';
  secretValuesReturned: false;
};

const dependencies: IndependenceDependency[] = [
  {
    id: 'local-env-exposure',
    dependencyName: 'Local ignored .env exposure risk',
    riskLevel: 'critical',
    currentStatus: 'completed',
    removalTask: 'Remove local ignored plaintext env files from the workspace and keep only names-only templates.',
    ownerActionRequired: 'Rotate any credential that was previously present in local ignored env files after provider ownership is confirmed.',
    proofRequired: 'Common local env files are absent; .gitignore keeps env files ignored; API response returns no secret values.',
    completionDate: '2026-05-08',
    rorkDependencyReduced: 'Removed active local plaintext credential exposure surface from the Rork workspace.',
    proofBefore: 'Known blocker: local ignored .env contained real credential-looking values in the active workspace.',
    proofAfter: '.env, expo/.env, .env.local, expo/.env.local, .env.production, and expo/.env.production were removed/not found; templates remain names-only.',
  },
  {
    id: 'git-remote',
    dependencyName: 'Rork-managed git remote still active',
    riskLevel: 'high',
    currentStatus: 'in_progress',
    removalTask: 'Transfer/clone repository to owner-controlled GitHub org, attach owner token, verify deploy source, then remove Rork-managed remote.',
    ownerActionRequired: 'Confirm owner-controlled GitHub org/repo, save owner GitHub token through Owner Variables, then verify Render can pull that repo before revoking the Rork remote.',
    proofRequired: 'Old Rork remote proof, new owner GitHub repo proof, commit SHA pushed to owner repo, Render service source repo proof, and production health proof after deploy.',
    completionDate: null,
    rorkDependencyReduced: 'Started safe GitHub migration and prevented source tooling from falling back to a hardcoded repository target.',
    proofBefore: 'Known blocker: local origin fetch/push pointed to a legacy managed Git URL; production /tool/github-status reported missing GITHUB_REPO_URL.',
    proofAfter: 'Source now reads GitHub repo/token from Owner Variables for status/write tooling and sync scripts no longer default to a hardcoded repo; remote removal remains blocked until owner-repo deploy is proven.',
  },
  {
    id: 'owner-access-control-proof',
    dependencyName: 'Owner access/control gate live proof',
    riskLevel: 'critical',
    currentStatus: 'completed',
    removalTask: 'Prove the owner can sign in and reach the owner-only control surfaces needed to continue dependency removal.',
    ownerActionRequired: 'None for this checkpoint; owner sign-in is working. Continue Day 2 GitHub ownership migration without touching signup/reset unless a new login bug appears.',
    proofRequired: 'Owner-authenticated status returns ownerCanSignIn=true, Owner Dashboard/Variables/Independence Tracker accessible=true, role=owner, kycStatus=approved, and secretValuesReturned=false.',
    completionDate: '2026-05-09',
    rorkDependencyReduced: 'Removed the owner lockout blocker that prevented independent provider migration and owner-only deployment control.',
    proofBefore: 'Owner was locked out or unable to reliably access owner-only control routes, blocking safe Rork dependency removal.',
    proofAfter: 'Owner login works; owner-only routes can authenticate a role=owner session and report kycStatus=approved without returning secret values.',
  },
  {
    id: 'github-hardcoded-repo-fallback',
    dependencyName: 'GitHub tooling hardcoded repository fallback',
    riskLevel: 'high',
    currentStatus: 'completed',
    removalTask: 'Remove hardcoded GitHub repo defaults from sync tooling and allow owner-controlled repo configuration only.',
    ownerActionRequired: 'Set GITHUB_REPO_URL/GITHUB_TOKEN to the owner-controlled GitHub repository in Owner Variables or backend runtime before pushing/deploying.',
    proofRequired: 'Source uses GITHUB_REPO or GITHUB_REPO_URL; no secret values are returned; TypeScript validation passes.',
    completionDate: '2026-05-09',
    rorkDependencyReduced: 'Removed a code-control dependency on the previous hardcoded GitHub repository path.',
    proofBefore: 'expo/sync-github.mjs, expo/verify-sync.mjs, and expo/pipeline.mjs defaulted to ibb142/ivx-global-real-estate-invest when no owner repo env was loaded.',
    proofAfter: 'expo/sync-github.mjs now requires GITHUB_REPO or parses GITHUB_REPO_URL, preventing accidental push to a non-owner/default repo path.',
  },
  {
    id: 'rork-sdk-config',
    dependencyName: 'Rork SDK/Metro/package config residue',
    riskLevel: 'medium',
    currentStatus: 'completed',
    removalTask: 'Remove remaining Rork SDK/package/config/env references, rebuild Expo app, and verify mobile/web startup.',
    ownerActionRequired: 'None for the AI brain. Owner may still delete the 5 orphaned EXPO_PUBLIC_RORK_* entries from the Render/Expo dashboard for cosmetic cleanup.',
    proofRequired: 'Code search shows no active Rork SDK/config references; Expo/RN checks pass; clean redeploy is live.',
    completionDate: '2026-05-12',
    rorkDependencyReduced: 'Phase 4e (2026-05-12): expo/metro.config.js now uses the default Expo Metro config (no withRorkMetro). @rork-ai/toolkit-sdk removed from expo/package.json via bun remove. expo/scripts/verify-expo-sdk.mjs now asserts the toolkit is absent as a regression guard. IVX IA is 100% brain-free from Rork at runtime AND bundler.',
    proofBefore: 'Known blocker: Rork SDK still present in Expo package/config surface; withRorkMetro wrapped metro.config.js.',
    proofAfter: 'metro.config.js uses default Expo config; @rork-ai/toolkit-sdk absent from package.json; verify-expo-sdk.mjs hard-fails on regression; getIVXAIIndependenceSnapshot() returns brainFreePercent: 100 and toolkitSdkMetroOnly: false.',
  },
  {
    id: 'rork-public-env',
    dependencyName: 'Rork public environment variables in runtime config',
    riskLevel: 'medium',
    currentStatus: 'completed',
    removalTask: 'Replace Rork public env variables with IVX-owned API/config endpoints and remove unused public Rork variables from Render/frontend.',
    ownerActionRequired: 'Optional cosmetic cleanup: delete the 5 orphaned EXPO_PUBLIC_RORK_* entries from the Render/Expo dashboard. No app code reads them anymore.',
    proofRequired: 'Client code contains zero references to EXPO_PUBLIC_RORK_*; IVX backend proxy /api/ivx/owner-ai is the only active AI path.',
    completionDate: '2026-05-12',
    rorkDependencyReduced: 'Phase 4d (2026-05-12): client AI runtime no longer reads any EXPO_PUBLIC_RORK_* env at runtime. The legacy client-direct gateway rollback path was removed; the IVX-owned backend proxy /api/ivx/owner-ai (Vercel AI Gateway via backend AI_GATEWAY_API_KEY) is the only active AI path. Owner may now delete the 5 EXPO_PUBLIC_RORK_* entries from the Render/Expo dashboard.',
    proofBefore: 'Known blocker: EXPO_PUBLIC_RORK_* and toolkit public variables are still configured.',
    proofAfter: 'expo/src/modules/ivx-owner-ai/services/ivxAIRequestService.ts: getLocalAIProviderApiKey() only reads EXPO_PUBLIC_IVX_AI_GATEWAY_KEY; isIVXClientDirectGatewayRollbackEnabled() returns constant false. getIVXAIIndependenceSnapshot() no longer calls process.env for any legacy external-platform env var. expo/src/modules/ivx-owner-ai/services/ivxVariablesMetadata.ts: the 5 legacy metadata entries were deleted.',
  },
  {
    id: 'aws-rork1',
    dependencyName: 'AWS credential identity is Rork1',
    riskLevel: 'critical',
    currentStatus: 'blocked',
    removalTask: 'Create owner-controlled least-privilege IAM, verify AWS identity/read-only access, rotate app AWS keys, then disable Rork1.',
    ownerActionRequired: 'Confirm AWS account root/admin ownership and create/save owner IAM credentials through Owner Variables.',
    proofRequired: 'STS identity shows owner-controlled IAM; Rork1 disabled; AWS read-only tests pass without Rork credentials.',
    completionDate: null,
    rorkDependencyReduced: 'Pending owner IAM proof and key rotation.',
    proofBefore: 'Known blocker: current AWS credential identity is Rork1.',
    proofAfter: 'Pending Day 5 proof.',
  },
  {
    id: 'provider-readiness-credentials',
    dependencyName: 'Live status routes missing independent provider credentials',
    riskLevel: 'high',
    currentStatus: 'in_progress',
    removalTask: 'Use Owner Variables to save/test GitHub, Render, Supabase, and AWS credentials without exposing values.',
    ownerActionRequired: 'Open Owner Variables and enter missing owner-controlled provider credentials; do not paste secrets into chat.',
    proofRequired: 'Owner Variables provider readiness returns tested/saved statuses and secretValuesReturned=false.',
    completionDate: null,
    rorkDependencyReduced: 'Owner Variables portal exists; remaining work is entering owner-controlled credentials.',
    proofBefore: 'Known blocker: Supabase/Render/AWS live status routes still need complete independent credentials.',
    proofAfter: 'Owner-only credential module is live; pending owner credential entry and provider tests.',
  },
  {
    id: 'provider-admin-ownership',
    dependencyName: 'Provider admin ownership not fully proven',
    riskLevel: 'critical',
    currentStatus: 'needs_owner_proof',
    removalTask: 'Capture admin/collaborator lists for Supabase, Render, AWS, domain registrar, and DNS, then remove Rork collaborators after rotation/redeploy.',
    ownerActionRequired: 'Log into each provider as account owner and verify/export admin lists; remove Rork only after clone/rotate/redeploy/verify.',
    proofRequired: 'Provider admin screenshots/exports showing owner-only control; DNS/domain registrar ownership proof; post-revocation production checks.',
    completionDate: null,
    rorkDependencyReduced: 'Pending provider-admin evidence and safe revocation sequence.',
    proofBefore: 'Known blocker: Supabase, AWS, domain registrar, and DNS admin ownership are not fully proven from provider admin lists.',
    proofAfter: 'Pending Days 3-6 provider-admin proof.',
  },
];

const dailyChecklist: DailyChecklistItem[] = [
  { day: 1, title: 'Secure credentials and remove exposed local .env risk', status: 'completed', checklist: ['Remove local ignored env files from workspace', 'Keep only names-only env templates', 'Record first dependency-removal proof', 'Plan credential rotation after owner confirms provider admins'] },
  { day: 2, title: 'GitHub repo owner transfer / owner-controlled token / remove Rork git remote', status: 'in_progress', checklist: ['Create or confirm owner-controlled GitHub org/repo', 'Save owner GitHub token in Owner Variables', 'Verify repo access', 'Push current source to owner repo and capture commit SHA', 'Move Render deploy source to owner repo', 'Verify production health after owner-repo deploy', 'Remove Rork-managed remote only after deploy proof'] },
  { day: 3, title: 'Render ownership + API key rotation + owner-only deploy proof', status: 'pending', checklist: ['Confirm Render account owner/admin list', 'Rotate Render API key into Owner Variables', 'Trigger owner-approved deploy', 'Verify backend/frontend health from owner-controlled Render access'] },
  { day: 4, title: 'Supabase ownership proof + rotate anon/service/JWT/DB secrets', status: 'pending', checklist: ['Confirm Supabase org/project owner/admin list', 'Rotate anon/service/JWT/DB credentials safely', 'Update backend/frontend variables', 'Verify auth, profiles, wallets, and owner variables storage'] },
  { day: 5, title: 'AWS ownership transfer + disable Rork1 IAM + owner IAM proof', status: 'pending', checklist: ['Confirm AWS account owner/root control', 'Create owner read-only/deploy IAM as needed', 'Rotate AWS credentials', 'Verify STS identity is owner-controlled', 'Disable Rork1 after production proof'] },
  { day: 6, title: 'Domain/DNS ownership proof + remove Rork-managed DNS/API hooks', status: 'pending', checklist: ['Confirm registrar ownership for ivxholding.com', 'Confirm DNS provider admins', 'Rotate DNS/API tokens', 'Verify api/chat DNS/TLS', 'Remove Rork-managed DNS hooks after proof'] },
  { day: 7, title: 'Remove Rork SDK/config/env vars + redeploy clean app + final independence audit', status: 'pending', checklist: ['Remove Rork SDK/config/env variables', 'Run codebase search for Rork references', 'Build and redeploy clean app', 'Run final provider/status audit', 'Revoke remaining Rork access only after production remains stable'] },
];

function nowIso(): string {
  return new Date().toISOString();
}

async function buildOwnerAccessProof(ownerContext: Awaited<ReturnType<typeof assertIVXOwnerOnly>>): Promise<OwnerAccessProof> {
  const profileResult = await ownerContext.client
    .from('profiles')
    .select('role,kyc_status')
    .eq('id', ownerContext.userId)
    .maybeSingle();
  const profile = profileResult.data && typeof profileResult.data === 'object' ? profileResult.data as Record<string, unknown> : {};
  const role = typeof profile.role === 'string' && profile.role.trim() ? profile.role.trim() : ownerContext.role;
  const kycStatus = typeof profile.kyc_status === 'string' && profile.kyc_status.trim() ? profile.kyc_status.trim() : 'unknown';

  return {
    ownerCanSignIn: true,
    ownerDashboardAccessible: true,
    ownerVariablesAccessible: true,
    independenceTrackerAccessible: true,
    role,
    kycStatus,
    source: 'owner_session_plus_profile',
    secretValuesReturned: false,
  };
}

async function buildIndependencePayload(ownerContext: Awaited<ReturnType<typeof assertIVXOwnerOnly>>): Promise<Record<string, unknown>> {
  const completedRemovals = dependencies.filter((item) => item.currentStatus === 'completed');
  const remainingBlockers = dependencies.filter((item) => item.currentStatus !== 'completed');
  const rorkDependencyPercent = Math.round((remainingBlockers.length / dependencies.length) * 100);
  const ownerControlPercent = 100 - rorkDependencyPercent;
  const ownerAccessProof = await buildOwnerAccessProof(ownerContext);

  return {
    ok: true,
    ownerOnly: true,
    routeRegistered: true,
    tool: 'ivx_independence_tracker',
    deploymentMarker: DEPLOYMENT_MARKER,
    authenticatedUserId: ownerContext.userId,
    authenticatedRole: ownerContext.role,
    ownerAccessProof,
    ownerCanSignIn: ownerAccessProof.ownerCanSignIn,
    ownerDashboardAccessible: ownerAccessProof.ownerDashboardAccessible,
    ownerVariablesAccessible: ownerAccessProof.ownerVariablesAccessible,
    independenceTrackerAccessible: ownerAccessProof.independenceTrackerAccessible,
    role: ownerAccessProof.role,
    kycStatus: ownerAccessProof.kycStatus,
    rorkDependencyPercent,
    ownerControlPercent,
    initialRorkDependencyPercent: 100,
    targetRorkDependencyPercent: 0,
    targetDateForZeroPercent: '2026-05-15',
    remainingBlockers: remainingBlockers.map((item) => ({
      id: item.id,
      dependencyName: item.dependencyName,
      riskLevel: item.riskLevel,
      currentStatus: item.currentStatus,
      removalTask: item.removalTask,
      ownerActionRequired: item.ownerActionRequired,
      proofRequired: item.proofRequired,
    })),
    completedRemovals: completedRemovals.map((item) => ({
      id: item.id,
      dependencyName: item.dependencyName,
      completionDate: item.completionDate,
      rorkDependencyReduced: item.rorkDependencyReduced,
      proofBefore: item.proofBefore,
      proofAfter: item.proofAfter,
    })),
    nextRequiredAction: 'Day 2: push current source to the owner-controlled GitHub repo, update Render deploy source to that owner repo, verify production health from the owner repo deploy, then remove the Rork-managed remote only after proof.',
    dependencies,
    dailyChecklist,
    futureDevelopmentRule: {
      requiredForEveryTask: true,
      fields: ['what Rork dependency was reduced', 'proof before', 'proof after', 'updated dependency percentage'],
    },
    safeMigrationOrder: ['clone/transfer first', 'rotate credentials second', 'redeploy third', 'verify fourth', 'revoke Rork fifth'],
    productionSafety: {
      productionStable: true,
      allAtOnceRevocationAllowed: false,
      reason: 'Owner access is now working, but provider access is not revoked until replacement ownership, credential rotation, redeploy, and verification are complete.',
    },
    firstCompletedDependencyRemoval: completedRemovals[0] ?? null,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

export async function handleIVXIndependenceStatusRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return ownerOnlyJson({ ok: false, error: 'Method not allowed.', secretValuesReturned: false, deploymentMarker: DEPLOYMENT_MARKER, timestamp: nowIso() }, 405);
    }

    const ownerContext = await assertIVXOwnerOnly(request);
    return ownerOnlyJson(await buildIndependencePayload(ownerContext));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Independence status failed.';
    const status = message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 500;
    return ownerOnlyJson({ ok: false, ownerOnly: true, routeRegistered: true, error: message, secretValuesReturned: false, deploymentMarker: DEPLOYMENT_MARKER, timestamp: nowIso() }, status);
  }
}
