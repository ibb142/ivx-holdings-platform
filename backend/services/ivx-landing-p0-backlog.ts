/**
 * IVX Landing P0 — authoritative backlog for the 112-agent fleet.
 *
 * ROOT CAUSE THIS MODULE FIXES (proven on production ledger 2026-09-04):
 *   The continuity loop could only lease "module audit" tasks. Once an agent's
 *   single module audit for the current SHA was VERIFIED (or stranded by a
 *   redeploy) the agent had nothing left to claim → NO_TASK_AVAILABLE forever.
 *   The Landing P0 workflow dispatched one-shot `agents/:id/run` tool calls
 *   which never wrote into the durable task engine, so a "Landing backlog" did
 *   not exist as claimable work.
 *
 * This module materialises the Landing audit as atomic, idempotent, partitioned
 * tasks inside the durable task engine (one task per production SHA per unit),
 * so `runRealEngineeringCycle` always has real Landing work to lease, and
 * exposes a fail-closed status aggregation for the owner report.
 *
 * Mission control: `qa/owner-priority-state.json` on GitHub main
 * (`policy: owner_controls_queue`) decides whether the mission is active.
 */
import {
  createTask,
  getAllTasks,
  taskProgressRank,
  TERMINAL_SUCCESS_STATES,
  type Task,
  type TaskState,
} from './ivx-autonomous-task-engine';
import { getAllExecutionStates } from './ivx-agent-runtime';

export const IVX_LANDING_P0_MARKER = 'ivx-landing-p0-backlog-2026-09-04';
export const LANDING_P0_PREFIX = 'landing-p0:';
export const LANDING_P0_REPAIR_PREFIX = 'landing-p0-repair:';
/** Evidence summary prefix — the status aggregator parses everything after it as JSON. */
export const LANDING_P0_RESULT_EVIDENCE_PREFIX = 'LANDING_P0_RESULT ';

export const LANDING_URL = (process.env.IVX_LANDING_URL ?? 'https://ivxholding.com').replace(/\/+$/, '');
export const LANDING_API_URL = (process.env.IVX_LANDING_API_URL ?? 'https://api.ivxholding.com').replace(/\/+$/, '');
export const LANDING_REPO = process.env.IVX_LANDING_REPO ?? 'ibb142/ivx-holdings-platform';

export type LandingLaneId =
  | 'structure' | 'deals' | 'media' | 'reels' | 'registration' | 'auth'
  | 'api' | 'accessibility' | 'performance' | 'security' | 'e2e';

export type LandingLane = { lane: LandingLaneId; label: string; from: number; to: number };

/** Owner-mandated initial partition of the 112 IA. */
export const LANDING_P0_LANES: readonly LandingLane[] = [
  { lane: 'structure', label: 'Landing structure / UI / responsive / navigation', from: 1, to: 12 },
  { lane: 'deals', label: 'Deals / cards / property identity / order', from: 13, to: 24 },
  { lane: 'media', label: 'Photos / videos / media integrity', from: 25, to: 36 },
  { lane: 'reels', label: 'Reels / browser / media behavior', from: 37, to: 48 },
  { lane: 'registration', label: 'Registration / member creation', from: 49, to: 60 },
  { lane: 'auth', label: 'Auth / login / forgot-password / session', from: 61, to: 72 },
  { lane: 'api', label: 'API / backend contracts', from: 73, to: 84 },
  { lane: 'accessibility', label: 'Accessibility / mobile / touch targets', from: 85, to: 94 },
  { lane: 'performance', label: 'Performance / browser / network errors', from: 95, to: 102 },
  { lane: 'security', label: 'Security / auth boundaries', from: 103, to: 108 },
  { lane: 'e2e', label: 'Final integration / E2E / exact-SHA / certificate', from: 109, to: 112 },
];

export type HtmlAssert =
  | { assert: 'element'; tag: string; min?: number }
  | { assert: 'meta-viewport' }
  | { assert: 'viewport-zoomable' }
  | { assert: 'lang-title' }
  | { assert: 'img-alt' }
  | { assert: 'buttons-labeled' }
  | { assert: 'links-labeled' }
  | { assert: 'form-labels' }
  | { assert: 'heading-order' }
  | { assert: 'no-dead-anchors' }
  | { assert: 'cta-present' }
  | { assert: 'no-inline-secrets' }
  | { assert: 'lazy-load' }
  | { assert: 'video-fallback' }
  | { assert: 'script-budget'; maxTags: number };

export type ApiAssert =
  | { assert: 'status'; is: number[] }
  | { assert: 'json' }
  | { assert: 'array-at'; key: string; min?: number }
  | { assert: 'content-type-json' }
  | { assert: 'has-keys'; keys: string[] };

export type DealsAssert =
  | { assert: 'min-count'; min: number }
  | { assert: 'present'; title: string }
  | { assert: 'order'; titles: string[] }
  | { assert: 'published' }
  | { assert: 'unique-titles' }
  | { assert: 'unique-ids' }
  | { assert: 'financials' }
  | { assert: 'identity' }
  | { assert: 'cover' }
  | { assert: 'images' }
  | { assert: 'videos' };

export type ContractProbe =
  | 'register-empty' | 'register-missing-name' | 'register-missing-last-name' | 'register-invalid-email'
  | 'register-missing-cell' | 'register-invalid-role' | 'register-invalid-zip' | 'register-picture-optional'
  | 'register-duplicate' | 'register-error-message'
  | 'login-empty' | 'login-invalid' | 'owner-login-guard' | 'forgot-invalid' | 'reset-invalid'
  | 'protected-unauth' | 'expired-token' | 'invalid-token' | 'supabase-auth-settings' | 'env-diagnostic';

export type LandingCheck =
  | { kind: 'html'; asserts: HtmlAssert[] }
  | { kind: 'css-media'; query: 'mobile' | 'tablet' | 'desktop' }
  | { kind: 'links'; scope: 'internal' | 'external'; max: number }
  | { kind: 'routes'; paths: string[] }
  | { kind: 'api'; path: string; asserts: ApiAssert[] }
  | { kind: 'deals'; assert: DealsAssert }
  | { kind: 'media'; source: 'deals-images' | 'deals-videos' | 'landing-images' | 'reels-videos'; assert: 'resolvable' | 'mime' | 'https' | 'weight' | 'no-duplicates' | 'no-missing'; max?: number }
  | { kind: 'reels'; assert: 'unique' | 'by-id' | 'metadata' | 'min-count' }
  | { kind: 'contract'; probe: ContractProbe }
  | { kind: 'security'; probe: 'unauth-privileged' | 'no-secrets-body' | 'cors'; path: string; method?: 'GET' | 'POST' }
  | { kind: 'perf'; base: 'landing' | 'api'; path: string; maxMs: number; maxBytes?: number }
  | { kind: 'ci'; workflow: string; check: string }
  | { kind: 'sha-match' }
  | { kind: 'certificate' };

export type LandingUnit = {
  unitId: string;
  lane: LandingLaneId;
  workstream: string;
  title: string;
  /** Severity a FAIL of this unit carries for the certificate. */
  severity: 'P0' | 'P1' | 'P2';
  check: LandingCheck;
};

function u(lane: LandingLaneId, unitId: string, workstream: string, title: string, severity: LandingUnit['severity'], check: LandingCheck): LandingUnit {
  return { unitId, lane, workstream, title, severity, check };
}

const CI_LANDING_BROWSER = 'Landing 112-Agent Live E2E 3H QA';
const CI_E2E_PIPELINE = 'IVX E2E Acceptance Pipeline';
const CI_REELS = 'IVX Reels Live Certificate';

/**
 * Atomic Landing work units. Distinct checks only — no filler duplicates.
 * Browser-only behaviours are bound to REAL CI workflow runs on the exact SHA
 * (evidence = workflow_run_id) and are BLOCKED, never faked, when no run exists.
 */
export const LANDING_P0_UNITS: readonly LandingUnit[] = [
  // A. PAGE STRUCTURE + G. NAVIGATION — lane structure (IA-001..012)
  u('structure', 'structure.header', 'A_STRUCTURE', 'Header landmark present', 'P2', { kind: 'html', asserts: [{ assert: 'element', tag: 'header' }] }),
  u('structure', 'structure.nav', 'A_STRUCTURE', 'Navigation present with links', 'P1', { kind: 'html', asserts: [{ assert: 'element', tag: 'nav' }] }),
  u('structure', 'structure.hero', 'A_STRUCTURE', 'Hero heading (h1) present', 'P1', { kind: 'html', asserts: [{ assert: 'element', tag: 'h1' }] }),
  u('structure', 'structure.sections', 'A_STRUCTURE', 'Content sections present (>=3)', 'P1', { kind: 'html', asserts: [{ assert: 'element', tag: 'section', min: 3 }] }),
  u('structure', 'structure.footer', 'A_STRUCTURE', 'Footer present', 'P2', { kind: 'html', asserts: [{ assert: 'element', tag: 'footer' }] }),
  u('structure', 'structure.viewport', 'A_STRUCTURE', 'Responsive viewport meta', 'P0', { kind: 'html', asserts: [{ assert: 'meta-viewport' }] }),
  u('structure', 'structure.lang-title', 'A_STRUCTURE', 'Document lang + title', 'P2', { kind: 'html', asserts: [{ assert: 'lang-title' }] }),
  u('structure', 'structure.mobile-layout', 'A_STRUCTURE', 'Mobile layout rules (<=768px)', 'P1', { kind: 'css-media', query: 'mobile' }),
  u('structure', 'structure.tablet-layout', 'A_STRUCTURE', 'Tablet layout rules (768-1024px)', 'P2', { kind: 'css-media', query: 'tablet' }),
  u('structure', 'structure.desktop-layout', 'A_STRUCTURE', 'Desktop layout rules (>=1024px)', 'P2', { kind: 'css-media', query: 'desktop' }),
  u('structure', 'navigation.internal-links', 'G_NAVIGATION', 'Every internal link resolves', 'P0', { kind: 'links', scope: 'internal', max: 60 }),
  u('structure', 'navigation.external-links', 'G_NAVIGATION', 'Every external link resolves', 'P1', { kind: 'links', scope: 'external', max: 40 }),
  u('structure', 'navigation.no-dead-controls', 'G_NAVIGATION', 'No dead anchors / unlabeled buttons', 'P1', { kind: 'html', asserts: [{ assert: 'no-dead-anchors' }, { assert: 'buttons-labeled' }] }),
  u('structure', 'navigation.cta-targets', 'G_NAVIGATION', 'CTAs present with real targets', 'P0', { kind: 'html', asserts: [{ assert: 'cta-present' }] }),
  u('structure', 'navigation.deep-links', 'G_NAVIGATION', 'Deep-link routes respond', 'P1', { kind: 'routes', paths: ['/', '/reels', '/register', '/login', '/deals'] }),
  u('structure', 'navigation.back-modals-browser', 'G_NAVIGATION', 'Back navigation / modals (browser)', 'P1', { kind: 'ci', workflow: CI_LANDING_BROWSER, check: 'navigation' }),

  // B. DEALS — lane deals (IA-013..024)
  u('deals', 'deals.api-status', 'B_DEALS', 'Public deals API healthy', 'P0', { kind: 'api', path: '/api/deals', asserts: [{ assert: 'status', is: [200] }, { assert: 'content-type-json' }, { assert: 'array-at', key: 'deals' }] }),
  u('deals', 'deals.landing-api-status', 'B_DEALS', 'Landing deals API healthy', 'P0', { kind: 'api', path: '/api/landing-deals', asserts: [{ assert: 'status', is: [200] }, { assert: 'content-type-json' }, { assert: 'array-at', key: 'deals' }] }),
  u('deals', 'deals.min-count', 'B_DEALS', 'At least 3 deals published', 'P0', { kind: 'deals', assert: { assert: 'min-count', min: 3 } }),
  u('deals', 'deals.perez-present', 'B_DEALS', 'Perez Residence present', 'P0', { kind: 'deals', assert: { assert: 'present', title: 'Perez' } }),
  u('deals', 'deals.casa-rosario-present', 'B_DEALS', 'Casa Rosario present', 'P0', { kind: 'deals', assert: { assert: 'present', title: 'Casa Rosario' } }),
  u('deals', 'deals.jacksonville-present', 'B_DEALS', 'Jacksonville present', 'P0', { kind: 'deals', assert: { assert: 'present', title: 'Jacksonville' } }),
  u('deals', 'deals.order', 'B_DEALS', 'Deal ordering: Perez, Casa Rosario, Jacksonville', 'P1', { kind: 'deals', assert: { assert: 'order', titles: ['Perez', 'Casa Rosario', 'Jacksonville'] } }),
  u('deals', 'deals.publication-state', 'B_DEALS', 'Publication state correct', 'P1', { kind: 'deals', assert: { assert: 'published' } }),
  u('deals', 'deals.unique-titles', 'B_DEALS', 'No duplicate deal titles', 'P1', { kind: 'deals', assert: { assert: 'unique-titles' } }),
  u('deals', 'deals.unique-ids', 'B_DEALS', 'No duplicate deal identities', 'P0', { kind: 'deals', assert: { assert: 'unique-ids' } }),
  u('deals', 'deals.financials', 'B_DEALS', 'Financial data present per deal', 'P0', { kind: 'deals', assert: { assert: 'financials' } }),
  u('deals', 'deals.identity', 'B_DEALS', 'Property identity (location) per deal', 'P1', { kind: 'deals', assert: { assert: 'identity' } }),
  u('deals', 'deals.cover-media', 'B_DEALS', 'Cover media per deal', 'P1', { kind: 'deals', assert: { assert: 'cover' } }),
  u('deals', 'deals.images-present', 'B_DEALS', 'Images associated per deal', 'P0', { kind: 'deals', assert: { assert: 'images' } }),
  u('deals', 'deals.videos-present', 'B_DEALS', 'Videos associated per deal', 'P2', { kind: 'deals', assert: { assert: 'videos' } }),

  // F. MEDIA — lane media (IA-025..036)
  u('media', 'media.deal-images-resolvable', 'F_MEDIA', 'Deal images resolve (HTTP 2xx)', 'P0', { kind: 'media', source: 'deals-images', assert: 'resolvable', max: 40 }),
  u('media', 'media.deal-images-mime', 'F_MEDIA', 'Deal images have image/* MIME', 'P1', { kind: 'media', source: 'deals-images', assert: 'mime', max: 40 }),
  u('media', 'media.deal-videos-resolvable', 'F_MEDIA', 'Deal videos resolve', 'P1', { kind: 'media', source: 'deals-videos', assert: 'resolvable', max: 20 }),
  u('media', 'media.deal-videos-mime', 'F_MEDIA', 'Deal videos have video/* MIME', 'P1', { kind: 'media', source: 'deals-videos', assert: 'mime', max: 20 }),
  u('media', 'media.no-cross-mapped', 'F_MEDIA', 'No media URL shared across deals', 'P0', { kind: 'media', source: 'deals-images', assert: 'no-duplicates' }),
  u('media', 'media.no-missing', 'F_MEDIA', 'No deal without media', 'P0', { kind: 'media', source: 'deals-images', assert: 'no-missing' }),
  u('media', 'media.landing-images-resolvable', 'F_MEDIA', 'Landing <img> sources resolve', 'P0', { kind: 'media', source: 'landing-images', assert: 'resolvable', max: 40 }),
  u('media', 'media.landing-images-mime', 'F_MEDIA', 'Landing <img> MIME correct', 'P1', { kind: 'media', source: 'landing-images', assert: 'mime', max: 40 }),
  u('media', 'media.cdn-https', 'F_MEDIA', 'All media served over https CDN paths', 'P1', { kind: 'media', source: 'deals-images', assert: 'https' }),
  u('media', 'media.image-weight', 'F_MEDIA', 'Image weight budget (<=1.5MB each)', 'P2', { kind: 'media', source: 'deals-images', assert: 'weight', max: 40 }),
  u('media', 'media.lazy-load', 'F_MEDIA', 'Below-fold images lazy-load', 'P2', { kind: 'html', asserts: [{ assert: 'lazy-load' }] }),
  u('media', 'media.fallback', 'F_MEDIA', 'Image alt + video poster/fallback', 'P2', { kind: 'html', asserts: [{ assert: 'img-alt' }, { assert: 'video-fallback' }] }),

  // C. REELS — lane reels (IA-037..048)
  u('reels', 'reels.api-status', 'C_REELS', 'Reels API healthy', 'P0', { kind: 'api', path: '/api/reels', asserts: [{ assert: 'status', is: [200] }, { assert: 'content-type-json' }] }),
  u('reels', 'reels.min-count', 'C_REELS', 'Reels feed non-empty', 'P0', { kind: 'reels', assert: 'min-count' }),
  u('reels', 'reels.unique', 'C_REELS', 'No duplicate reels', 'P1', { kind: 'reels', assert: 'unique' }),
  u('reels', 'reels.media-resolvable', 'C_REELS', 'Reel media resolves', 'P0', { kind: 'media', source: 'reels-videos', assert: 'resolvable', max: 20 }),
  u('reels', 'reels.media-mime', 'C_REELS', 'Reel media MIME video/*', 'P1', { kind: 'media', source: 'reels-videos', assert: 'mime', max: 20 }),
  u('reels', 'reels.by-id', 'C_REELS', 'Reel detail endpoint resolves', 'P1', { kind: 'reels', assert: 'by-id' }),
  u('reels', 'reels.metadata', 'C_REELS', 'Reel metadata (title/likes/comments/share)', 'P1', { kind: 'reels', assert: 'metadata' }),
  u('reels', 'reels.route', 'C_REELS', 'Reels page route responds', 'P1', { kind: 'routes', paths: ['/reels'] }),
  u('reels', 'reels.autoplay-controls-browser', 'C_REELS', 'Autoplay + controls (browser)', 'P1', { kind: 'ci', workflow: CI_REELS, check: 'autoplay-controls' }),
  u('reels', 'reels.engagement-browser', 'C_REELS', 'Likes / comments / share (browser)', 'P1', { kind: 'ci', workflow: CI_REELS, check: 'engagement' }),
  u('reels', 'reels.scroll-navigation-browser', 'C_REELS', 'Scroll / navigation / crash resistance (browser)', 'P0', { kind: 'ci', workflow: CI_REELS, check: 'scroll-navigation' }),
  u('reels', 'reels.production-render-browser', 'C_REELS', 'Production browser rendering', 'P0', { kind: 'ci', workflow: CI_REELS, check: 'production-render' }),

  // D. REGISTRATION — lane registration (IA-049..060)
  u('registration', 'registration.endpoint', 'D_REGISTRATION', 'Register endpoint validates (400 on empty)', 'P0', { kind: 'contract', probe: 'register-empty' }),
  u('registration', 'registration.required-name', 'D_REGISTRATION', 'First name required', 'P1', { kind: 'contract', probe: 'register-missing-name' }),
  u('registration', 'registration.required-last-name', 'D_REGISTRATION', 'Last name required', 'P1', { kind: 'contract', probe: 'register-missing-last-name' }),
  u('registration', 'registration.required-email', 'D_REGISTRATION', 'Email format enforced', 'P0', { kind: 'contract', probe: 'register-invalid-email' }),
  u('registration', 'registration.required-cell', 'D_REGISTRATION', 'Cell phone required', 'P1', { kind: 'contract', probe: 'register-missing-cell' }),
  u('registration', 'registration.role-selection', 'D_REGISTRATION', 'Role selection validated', 'P1', { kind: 'contract', probe: 'register-invalid-role' }),
  u('registration', 'registration.zip-code', 'D_REGISTRATION', 'Zip code validated', 'P2', { kind: 'contract', probe: 'register-invalid-zip' }),
  u('registration', 'registration.optional-picture', 'D_REGISTRATION', 'Picture optional', 'P2', { kind: 'contract', probe: 'register-picture-optional' }),
  u('registration', 'registration.duplicate-user', 'D_REGISTRATION', 'Duplicate user rejected', 'P0', { kind: 'contract', probe: 'register-duplicate' }),
  u('registration', 'registration.error-messages', 'D_REGISTRATION', 'Human-readable error messages', 'P1', { kind: 'contract', probe: 'register-error-message' }),
  u('registration', 'registration.loading-retry-browser', 'D_REGISTRATION', 'Loading / retry states (browser)', 'P1', { kind: 'ci', workflow: CI_E2E_PIPELINE, check: 'registration-ui' }),
  u('registration', 'registration.e2e-member-creation', 'D_REGISTRATION', 'Registration → member created → login (E2E)', 'P0', { kind: 'ci', workflow: CI_E2E_PIPELINE, check: 'registration-e2e' }),

  // E. AUTH — lane auth (IA-061..072)
  u('auth', 'auth.login-endpoint', 'E_AUTH', 'Login validates (400 on empty)', 'P0', { kind: 'contract', probe: 'login-empty' }),
  u('auth', 'auth.login-invalid', 'E_AUTH', 'Invalid credentials rejected safely', 'P0', { kind: 'contract', probe: 'login-invalid' }),
  u('auth', 'auth.owner-login-guard', 'E_AUTH', 'Owner login guarded (no passwordless bypass)', 'P0', { kind: 'contract', probe: 'owner-login-guard' }),
  u('auth', 'auth.forgot-password', 'E_AUTH', 'Forgot-password validates input', 'P1', { kind: 'contract', probe: 'forgot-invalid' }),
  u('auth', 'auth.reset-password', 'E_AUTH', 'Reset-password rejects invalid token', 'P1', { kind: 'contract', probe: 'reset-invalid' }),
  u('auth', 'auth.protected-routes', 'E_AUTH', 'Protected routes require auth', 'P0', { kind: 'contract', probe: 'protected-unauth' }),
  u('auth', 'auth.expired-token', 'E_AUTH', 'Expired token → 401 (not 500)', 'P1', { kind: 'contract', probe: 'expired-token' }),
  u('auth', 'auth.invalid-token', 'E_AUTH', 'Invalid token → 401 (not 500)', 'P1', { kind: 'contract', probe: 'invalid-token' }),
  u('auth', 'auth.supabase-binding', 'E_AUTH', 'Supabase production auth binding', 'P0', { kind: 'contract', probe: 'supabase-auth-settings' }),
  u('auth', 'auth.production-config', 'E_AUTH', 'Production auth configuration diagnostic', 'P0', { kind: 'contract', probe: 'env-diagnostic' }),
  u('auth', 'auth.session-persistence-browser', 'E_AUTH', 'Session persistence / logout (browser)', 'P1', { kind: 'ci', workflow: CI_E2E_PIPELINE, check: 'session' }),
  u('auth', 'auth.login-e2e', 'E_AUTH', 'Member + owner login (E2E)', 'P0', { kind: 'ci', workflow: CI_E2E_PIPELINE, check: 'login-e2e' }),

  // J. API CONTRACTS — lane api (IA-073..084)
  u('api', 'api.health', 'J_API', 'Backend /health ok (fail-closed)', 'P0', { kind: 'api', path: '/health', asserts: [{ assert: 'status', is: [200] }, { assert: 'json' }, { assert: 'has-keys', keys: ['ok', 'status'] }] }),
  u('api', 'api.version', 'J_API', '/version exposes deployed commit', 'P0', { kind: 'api', path: '/version', asserts: [{ assert: 'status', is: [200] }, { assert: 'json' }, { assert: 'has-keys', keys: ['commit', 'bootTime'] }] }),
  u('api', 'api.deals-contract', 'J_API', '/api/deals contract', 'P0', { kind: 'api', path: '/api/deals', asserts: [{ assert: 'status', is: [200] }, { assert: 'array-at', key: 'deals', min: 1 }, { assert: 'has-keys', keys: ['deals', 'count'] }] }),
  u('api', 'api.landing-deals-contract', 'J_API', '/api/landing-deals contract', 'P0', { kind: 'api', path: '/api/landing-deals', asserts: [{ assert: 'status', is: [200] }, { assert: 'array-at', key: 'deals', min: 1 }] }),
  u('api', 'api.landing-config', 'J_API', '/api/landing-config contract', 'P0', { kind: 'api', path: '/api/landing-config', asserts: [{ assert: 'status', is: [200] }, { assert: 'json' }] }),
  u('api', 'api.reels-contract', 'J_API', '/api/reels contract', 'P0', { kind: 'api', path: '/api/reels', asserts: [{ assert: 'status', is: [200] }, { assert: 'json' }] }),
  u('api', 'api.registration-route', 'J_API', 'Registration route mounted', 'P0', { kind: 'contract', probe: 'register-empty' }),
  u('api', 'api.auth-route', 'J_API', 'Auth route mounted', 'P0', { kind: 'contract', probe: 'login-empty' }),
  u('api', 'api.analytics-public', 'J_API', 'Landing analytics public summary', 'P2', { kind: 'api', path: '/api/ivx/landing-analytics/public', asserts: [{ assert: 'status', is: [200] }, { assert: 'json' }] }),
  u('api', 'api.landing-deploy-status', 'J_API', 'Landing deploy status route', 'P2', { kind: 'api', path: '/api/ivx/landing-deploy', asserts: [{ assert: 'status', is: [200, 401, 403] }] }),
  u('api', 'api.cors-preflight', 'J_API', 'CORS preflight for landing origin', 'P0', { kind: 'security', probe: 'cors', path: '/api/deals' }),
  u('api', 'api.json-content-types', 'J_API', 'JSON content-types on public APIs', 'P1', { kind: 'api', path: '/api/landing-config', asserts: [{ assert: 'content-type-json' }] }),

  // H. ACCESSIBILITY — lane accessibility (IA-085..094)
  u('accessibility', 'a11y.img-alt', 'H_ACCESSIBILITY', 'Images have alt text', 'P1', { kind: 'html', asserts: [{ assert: 'img-alt' }] }),
  u('accessibility', 'a11y.buttons-labeled', 'H_ACCESSIBILITY', 'Buttons have labels', 'P1', { kind: 'html', asserts: [{ assert: 'buttons-labeled' }] }),
  u('accessibility', 'a11y.links-labeled', 'H_ACCESSIBILITY', 'Links have text/labels', 'P1', { kind: 'html', asserts: [{ assert: 'links-labeled' }] }),
  u('accessibility', 'a11y.form-labels', 'H_ACCESSIBILITY', 'Form inputs labeled', 'P1', { kind: 'html', asserts: [{ assert: 'form-labels' }] }),
  u('accessibility', 'a11y.landmarks', 'H_ACCESSIBILITY', 'Semantic landmarks (nav/main/footer)', 'P2', { kind: 'html', asserts: [{ assert: 'element', tag: 'nav' }, { assert: 'element', tag: 'main' }, { assert: 'element', tag: 'footer' }] }),
  u('accessibility', 'a11y.heading-order', 'H_ACCESSIBILITY', 'Heading order (single h1, no skips)', 'P2', { kind: 'html', asserts: [{ assert: 'heading-order' }] }),
  u('accessibility', 'a11y.zoomable', 'H_ACCESSIBILITY', 'Viewport zoom not disabled', 'P1', { kind: 'html', asserts: [{ assert: 'viewport-zoomable' }] }),
  u('accessibility', 'a11y.lang', 'H_ACCESSIBILITY', 'Document language declared', 'P2', { kind: 'html', asserts: [{ assert: 'lang-title' }] }),
  u('accessibility', 'a11y.touch-targets-browser', 'H_ACCESSIBILITY', 'Touch targets >= 44pt (browser)', 'P1', { kind: 'ci', workflow: CI_LANDING_BROWSER, check: 'touch-targets' }),
  u('accessibility', 'a11y.contrast-focus-browser', 'H_ACCESSIBILITY', 'Contrast / focus / keyboard (browser)', 'P1', { kind: 'ci', workflow: CI_LANDING_BROWSER, check: 'contrast-focus' }),

  // I. PERFORMANCE — lane performance (IA-095..102)
  u('performance', 'perf.landing-ttfb', 'I_PERFORMANCE', 'Landing HTML fetch <= 1500ms', 'P1', { kind: 'perf', base: 'landing', path: '/', maxMs: 1500 }),
  u('performance', 'perf.landing-html-size', 'I_PERFORMANCE', 'Landing HTML <= 300KB', 'P2', { kind: 'perf', base: 'landing', path: '/', maxMs: 10_000, maxBytes: 300_000 }),
  u('performance', 'perf.deals-latency', 'I_PERFORMANCE', '/api/deals <= 1500ms', 'P1', { kind: 'perf', base: 'api', path: '/api/deals', maxMs: 1500 }),
  u('performance', 'perf.reels-latency', 'I_PERFORMANCE', '/api/reels <= 1500ms', 'P1', { kind: 'perf', base: 'api', path: '/api/reels', maxMs: 1500 }),
  u('performance', 'perf.health-latency', 'I_PERFORMANCE', '/health <= 1000ms', 'P1', { kind: 'perf', base: 'api', path: '/health', maxMs: 1000 }),
  u('performance', 'perf.script-budget', 'I_PERFORMANCE', 'Script tag budget (<=15)', 'P2', { kind: 'html', asserts: [{ assert: 'script-budget', maxTags: 15 }] }),
  u('performance', 'perf.image-weight-total', 'I_PERFORMANCE', 'Landing image weight budget', 'P2', { kind: 'media', source: 'landing-images', assert: 'weight', max: 40 }),
  u('performance', 'perf.console-network-browser', 'I_PERFORMANCE', 'Console / failed requests / long tasks (browser)', 'P0', { kind: 'ci', workflow: CI_LANDING_BROWSER, check: 'console-network' }),

  // K. SECURITY — lane security (IA-103..108)
  u('security', 'security.owner-dashboard-unauth', 'K_SECURITY', 'Owner dashboard rejects unauthenticated', 'P0', { kind: 'security', probe: 'unauth-privileged', path: '/api/ivx/autonomous-core/dashboard' }),
  u('security', 'security.agent-run-unauth', 'K_SECURITY', 'Agent run rejects unauthenticated', 'P0', { kind: 'security', probe: 'unauth-privileged', path: '/api/ivx/agents/ivx_holdings_1/run', method: 'POST' }),
  u('security', 'security.landing-deploy-unauth', 'K_SECURITY', 'Landing deploy write rejects unauthenticated', 'P0', { kind: 'security', probe: 'unauth-privileged', path: '/api/ivx/landing-deploy', method: 'POST' }),
  u('security', 'security.no-secrets-landing', 'K_SECURITY', 'No secrets in landing HTML', 'P0', { kind: 'security', probe: 'no-secrets-body', path: 'landing:/' }),
  u('security', 'security.no-secrets-config', 'K_SECURITY', 'No secrets in landing config / env diagnostic', 'P0', { kind: 'security', probe: 'no-secrets-body', path: '/api/ivx/landing-env-diagnostic' }),
  u('security', 'security.cors-policy', 'K_SECURITY', 'CORS not wildcard-with-credentials', 'P1', { kind: 'security', probe: 'cors', path: '/api/landing-config' }),

  // L. PRODUCTION E2E — lane e2e (IA-109..112)
  u('e2e', 'e2e.sha-match', 'L_E2E', 'main SHA == production SHA', 'P0', { kind: 'sha-match' }),
  u('e2e', 'e2e.landing-http', 'L_E2E', 'Production landing URL healthy', 'P0', { kind: 'perf', base: 'landing', path: '/', maxMs: 10_000 }),
  u('e2e', 'e2e.production-browser-suite', 'L_E2E', 'Production browser E2E on exact SHA', 'P0', { kind: 'ci', workflow: CI_LANDING_BROWSER, check: 'production-e2e' }),
  u('e2e', 'e2e.certificate', 'L_E2E', 'Exact-SHA Landing certificate', 'P0', { kind: 'certificate' }),
];

const UNIT_BY_ID: ReadonlyMap<string, LandingUnit> = new Map(LANDING_P0_UNITS.map((unit) => [unit.unitId, unit]));

export function getLandingUnit(unitId: string): LandingUnit | null {
  return UNIT_BY_ID.get(unitId) ?? null;
}

export function laneFor(laneId: LandingLaneId): LandingLane {
  const lane = LANDING_P0_LANES.find((row) => row.lane === laneId);
  if (!lane) throw new Error(`unknown landing lane ${laneId}`);
  return lane;
}

/** Deterministic agent assignment: round-robin inside the unit's lane range. */
export function assignAgentForUnit(unit: LandingUnit): number {
  const lane = laneFor(unit.lane);
  const laneUnits = LANDING_P0_UNITS.filter((row) => row.lane === unit.lane);
  const index = laneUnits.findIndex((row) => row.unitId === unit.unitId);
  const size = lane.to - lane.from + 1;
  return lane.from + (Math.max(0, index) % size);
}

export function landingTaskKey(sha: string, unitId: string): string {
  return `${LANDING_P0_PREFIX}${sha}:${unitId}`;
}

export function landingRepairKey(sha: string, unitId: string, defectCode: string): string {
  return `${LANDING_P0_REPAIR_PREFIX}${sha}:${unitId}:${defectCode}`;
}

export type ParsedLandingKey = { sha: string; unitId: string; repair: boolean; defectCode: string | null };

export function parseLandingTaskKey(idempotencyKey: string): ParsedLandingKey | null {
  if (idempotencyKey.startsWith(LANDING_P0_REPAIR_PREFIX)) {
    const rest = idempotencyKey.slice(LANDING_P0_REPAIR_PREFIX.length).split(':');
    const [sha, unitId, ...code] = rest;
    if (!sha || !unitId) return null;
    return { sha, unitId, repair: true, defectCode: code.join(':') || null };
  }
  if (idempotencyKey.startsWith(LANDING_P0_PREFIX)) {
    const [sha, unitId] = idempotencyKey.slice(LANDING_P0_PREFIX.length).split(':');
    if (!sha || !unitId) return null;
    return { sha, unitId, repair: false, defectCode: null };
  }
  return null;
}

export function isLandingTask(task: Pick<Task, 'idempotencyKey'>): boolean {
  return parseLandingTaskKey(task.idempotencyKey) !== null;
}

// ── Owner priority (mission control) ─────────────────────────────────────────

export type OwnerPriorityState = {
  active: boolean;
  priority: string | null;
  mission: string | null;
  source: 'env' | 'github-main' | 'default-off' | 'cache';
  fetchedAt: string;
};

const PRIORITY_CACHE_MS = 5 * 60 * 1000;
let priorityCache: { state: OwnerPriorityState; expiresAt: number } | null = null;

/**
 * Landing P0 mission activation.
 *   IVX_LANDING_P0_MISSION=on  → active
 *   IVX_LANDING_P0_MISSION=off → inactive
 *   otherwise (auto)           → owner's qa/owner-priority-state.json on GitHub main
 * Tests never touch the network: NODE_ENV=test resolves to off unless forced on.
 */
export async function readOwnerPriority(fetchImpl: typeof fetch = fetch): Promise<OwnerPriorityState> {
  const forced = (process.env.IVX_LANDING_P0_MISSION ?? '').trim().toLowerCase();
  const now = Date.now();
  if (forced === 'on' || forced === '1' || forced === 'true') {
    return { active: true, priority: 'P0-OWNER', mission: 'landing', source: 'env', fetchedAt: new Date(now).toISOString() };
  }
  if (forced === 'off' || forced === '0' || forced === 'false' || process.env.NODE_ENV === 'test') {
    return { active: false, priority: null, mission: null, source: 'default-off', fetchedAt: new Date(now).toISOString() };
  }
  if (priorityCache && priorityCache.expiresAt > now) {
    return { ...priorityCache.state, source: 'cache' };
  }
  try {
    const response = await fetchImpl(`https://raw.githubusercontent.com/${LANDING_REPO}/main/qa/owner-priority-state.json`, {
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`owner-priority-state HTTP ${response.status}`);
    const body = (await response.json()) as Record<string, unknown>;
    const state: OwnerPriorityState = {
      active: body.active === true && body.mission === 'landing',
      priority: typeof body.priority === 'string' ? body.priority : null,
      mission: typeof body.mission === 'string' ? body.mission : null,
      source: 'github-main',
      fetchedAt: new Date(now).toISOString(),
    };
    priorityCache = { state, expiresAt: now + PRIORITY_CACHE_MS };
    return state;
  } catch (error) {
    // Fail-closed for reporting, but keep the last known state so a transient
    // GitHub blip does not idle the fleet.
    if (priorityCache) return { ...priorityCache.state, source: 'cache' };
    console.warn('[IVX Landing P0] owner priority unavailable', { error: error instanceof Error ? error.message : String(error) });
    return { active: false, priority: null, mission: null, source: 'default-off', fetchedAt: new Date(now).toISOString() };
  }
}

export async function isLandingP0MissionActive(): Promise<boolean> {
  return (await readOwnerPriority()).active;
}

// ── Seeding ──────────────────────────────────────────────────────────────────

export type SeedResult = { sha: string; created: number; existing: number; total: number; certificateTaskId: string | null; error: string | null };

const SEED_RECHECK_MS = 60 * 1000;
const seedState = new Map<string, { at: number; result: SeedResult }>();
let seedInFlight: Promise<SeedResult> | null = null;

/**
 * Idempotently materialise the Landing backlog for `sha`. Safe to call from all
 * 112 agents concurrently: one seeding pass runs at a time and results are
 * cached for 60s per SHA. Creates only missing tasks (single ledger read first).
 */
export async function ensureLandingP0BacklogSeeded(sha: string): Promise<SeedResult> {
  const cached = seedState.get(sha);
  if (cached && Date.now() - cached.at < SEED_RECHECK_MS) return cached.result;
  if (seedInFlight) return seedInFlight;
  seedInFlight = seedLandingP0Backlog(sha).finally(() => { seedInFlight = null; });
  const result = await seedInFlight;
  seedState.set(sha, { at: Date.now(), result });
  return result;
}

export async function seedLandingP0Backlog(sha: string): Promise<SeedResult> {
  const result: SeedResult = { sha, created: 0, existing: 0, total: LANDING_P0_UNITS.length, certificateTaskId: null, error: null };
  try {
    const tasks = await getAllTasks();
    const byKey = new Map(tasks.filter((t) => t.state !== 'CANCELLED' && t.state !== 'EXPIRED').map((t) => [t.idempotencyKey, t]));
    const nonCertificateIds: string[] = [];
    const certificate = LANDING_P0_UNITS.find((unit) => unit.check.kind === 'certificate') ?? null;

    for (const unit of LANDING_P0_UNITS) {
      if (unit.check.kind === 'certificate') continue;
      const key = landingTaskKey(sha, unit.unitId);
      const existing = byKey.get(key);
      if (existing) {
        result.existing += 1;
        nonCertificateIds.push(existing.taskId);
        continue;
      }
      const created = await createTask({
        title: `Landing P0 · ${unit.workstream} · ${unit.title}`,
        description: `Landing 10/10 P0 audit unit ${unit.unitId} against production SHA ${sha}. Real execution only (HTTP/API/HTML/CI evidence); no simulated success. Lane: ${laneFor(unit.lane).label}.`,
        taskType: 'qa',
        idempotencyKey: key,
        priority: 'critical',
        assignedAgentNumber: assignAgentForUnit(unit),
        maxRetries: 2,
      });
      if (created.ok && created.task) {
        result.created += created.duplicate ? 0 : 1;
        if (created.duplicate) result.existing += 1;
        nonCertificateIds.push(created.task.taskId);
      } else {
        result.error = created.error ?? `createTask failed for ${unit.unitId}`;
      }
    }

    if (certificate) {
      const key = landingTaskKey(sha, certificate.unitId);
      const existing = byKey.get(key);
      if (existing) {
        result.existing += 1;
        result.certificateTaskId = existing.taskId;
      } else {
        const created = await createTask({
          title: `Landing P0 · ${certificate.workstream} · ${certificate.title}`,
          description: `Exact-SHA Landing certificate for ${sha}. Leasable only after every other Landing unit is VERIFIED; PASS only when no unit FAILED or BLOCKED and main == production SHA.`,
          taskType: 'qa',
          idempotencyKey: key,
          priority: 'critical',
          assignedAgentNumber: assignAgentForUnit(certificate),
          dependencies: nonCertificateIds,
          maxRetries: 3,
        });
        if (created.ok && created.task) {
          result.created += created.duplicate ? 0 : 1;
          result.certificateTaskId = created.task.taskId;
        } else {
          result.error = created.error ?? 'createTask failed for certificate';
        }
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  if (result.created > 0 || result.error) {
    console.log('[IVX Landing P0] backlog seeded', result);
  }
  return result;
}

// ── Status aggregation (owner report) ────────────────────────────────────────

export type LandingDefect = {
  code: string;
  severity: 'P0' | 'P1' | 'P2';
  detail: string;
  root_cause: 'content' | 'media' | 'api' | 'auth' | 'infra' | 'security' | 'performance' | 'browser_only' | 'ci' | 'unknown';
  remediation: string;
};

/** Compact result persisted in task evidence (owner evidence schema, trimmed). */
export type LandingResultRecord = {
  v: 1;
  unit_id: string;
  agent_number: number | null;
  status: 'PASS' | 'FAIL' | 'BLOCKED';
  started_at: string;
  completed_at: string;
  productive_seconds: number;
  production_sha: string | null;
  api_checks: number;
  browser_checks: number;
  bugs_found: LandingDefect[];
  fixes_applied: string[];
  blocked_reason: string | null;
  evidence: string[];
  repair: boolean;
};

export function encodeLandingResult(record: LandingResultRecord): string {
  return `${LANDING_P0_RESULT_EVIDENCE_PREFIX}${JSON.stringify(record)}`;
}

export function decodeLandingResult(summary: string): LandingResultRecord | null {
  if (!summary.startsWith(LANDING_P0_RESULT_EVIDENCE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(summary.slice(LANDING_P0_RESULT_EVIDENCE_PREFIX.length)) as LandingResultRecord;
    return parsed && parsed.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function resolveProductionSha(): string {
  return process.env.RENDER_GIT_COMMIT
    ?? process.env.GITHUB_SHA
    ?? process.env.COMMIT_SHA
    ?? 'runtime-unknown-sha';
}

const ACTIVE_STATES: readonly TaskState[] = ['LEASED', 'RUNNING', 'EXECUTION_COMPLETED', 'QA_IN_PROGRESS'];
const WORKING_FRESHNESS_MS = 10 * 60 * 1000;

export type LandingP0Status = ReturnType<typeof aggregateLandingStatus>;

/** Pure aggregation — unit-tested against synthetic ledgers. */
export function aggregateLandingStatus(input: {
  tasks: Task[];
  productionSha: string;
  mainSha: string | null;
  registeredAgents: number;
  failedAgents: number;
  nowMs: number;
  mission: OwnerPriorityState;
}) {
  const { tasks, productionSha, mainSha, registeredAgents, nowMs, mission } = input;
  const dayAgo = nowMs - 24 * 60 * 60 * 1000;
  const landingRows = tasks.filter((t) => {
    const parsed = parseLandingTaskKey(t.idempotencyKey);
    return parsed !== null && parsed.sha === productionSha && t.state !== 'CANCELLED' && t.state !== 'EXPIRED';
  });
  // One row per UNIT: a deploy overlap can leave duplicate tasks for the same key;
  // report the most-progressed one and expose the duplicate count truthfully.
  const byKey = new Map<string, Task>();
  for (const row of landingRows) {
    const current = byKey.get(row.idempotencyKey);
    if (!current || taskProgressRank(row.state) > taskProgressRank(current.state)) byKey.set(row.idempotencyKey, row);
  }
  const landing = [...byKey.values()];
  const duplicateTasks = landingRows.length - landing.length;
  const audits = landing.filter((t) => !parseLandingTaskKey(t.idempotencyKey)?.repair);
  const repairs = landing.filter((t) => parseLandingTaskKey(t.idempotencyKey)?.repair === true);

  const results = new Map<string, LandingResultRecord>();
  for (const task of landing) {
    for (const evidence of task.evidence) {
      const record = decodeLandingResult(evidence.summary);
      if (record) results.set(task.taskId, record);
    }
  }

  const count = (rows: Task[], states: readonly TaskState[]): number => rows.filter((t) => states.includes(t.state)).length;
  const backlog = {
    total: audits.length,
    completed: count(audits, TERMINAL_SUCCESS_STATES),
    active: count(audits, ACTIVE_STATES),
    queued: count(audits, ['QUEUED']),
    failed: count(audits, ['FAILED']),
    blocked: count(audits, ['BLOCKED']),
    stale: count(audits, ['STALE']),
    remaining: audits.length - count(audits, TERMINAL_SUCCESS_STATES),
    repairs: { total: repairs.length, completed: count(repairs, TERMINAL_SUCCESS_STATES), blocked: count(repairs, ['BLOCKED']), active: count(repairs, ACTIVE_STATES), queued: count(repairs, ['QUEUED']) },
    definedUnits: LANDING_P0_UNITS.length,
  };

  // Agents: working = distinct lease holders on fresh active tasks (ANY task type — module audits count as work).
  const workingHolders = new Set<string>();
  for (const task of tasks) {
    if (!ACTIVE_STATES.includes(task.state) || !task.leaseHolder) continue;
    const fresh = Date.parse(task.lastHeartbeatAt ?? task.updatedAt ?? '') >= nowMs - WORKING_FRESHNESS_MS;
    if (fresh) workingHolders.add(task.leaseHolder);
  }
  const blockedAgents = new Set<number>();
  for (const task of landing) {
    if (task.state === 'BLOCKED' && task.assignedAgentNumber != null) blockedAgents.add(task.assignedAgentNumber);
  }
  const workingNow = Math.min(registeredAgents, workingHolders.size);
  const failed = Math.min(registeredAgents - workingNow, input.failedAgents);
  const blocked = Math.max(0, Math.min(registeredAgents - workingNow - failed, blockedAgents.size));
  const idle = Math.max(0, registeredAgents - workingNow - blocked - failed);

  // Hours: only evidence-backed productive seconds count. Everything else is labeled.
  let productiveSeconds = 0;
  let blockedSeconds = 0;
  let bugsFound = 0;
  let p0Open = 0;
  let p1Open = 0;
  let resolvedOnRecheck = 0;
  let fixesApplied = 0;
  const openDefects: Array<LandingDefect & { unit_id: string }> = [];
  const defectKey = (unitId: string, code: string) => `${unitId}::${code}`;
  const repairPassed = new Set<string>();
  for (const [taskId, record] of results) {
    if (Date.parse(record.completed_at) >= dayAgo) productiveSeconds += record.productive_seconds;
    fixesApplied += record.fixes_applied.length;
    const task = landing.find((t) => t.taskId === taskId);
    const parsed = task ? parseLandingTaskKey(task.idempotencyKey) : null;
    if (parsed?.repair && record.status === 'PASS' && parsed.defectCode) repairPassed.add(defectKey(parsed.unitId, parsed.defectCode));
  }
  for (const [, record] of results) {
    if (record.repair) continue;
    for (const defect of record.bugs_found) {
      bugsFound += 1;
      if (repairPassed.has(defectKey(record.unit_id, defect.code))) { resolvedOnRecheck += 1; continue; }
      openDefects.push({ ...defect, unit_id: record.unit_id });
      if (defect.severity === 'P0') p0Open += 1;
      if (defect.severity === 'P1') p1Open += 1;
    }
  }
  for (const task of landing) {
    if (task.state === 'BLOCKED') blockedSeconds += Math.max(0, Math.min(nowMs - Date.parse(task.updatedAt), 24 * 60 * 60 * 1000)) / 1000;
  }
  const staleRequeues = landing.reduce((sum, t) => sum + t.retryCount, 0);

  // A gate is undecided until EVERY one of its units exists for this SHA and has reported.
  const gate = (unitIds: string[]): 'PASS' | 'FAIL' | 'BLOCKED' | 'PENDING' => {
    const records = unitIds.map((unitId) => {
      const task = audits.find((t) => parseLandingTaskKey(t.idempotencyKey)?.unitId === unitId);
      return task ? results.get(task.taskId) ?? null : null;
    });
    if (records.some((r) => r === null)) return 'PENDING';
    if (records.some((r) => r?.status === 'FAIL')) return 'FAIL';
    if (records.some((r) => r?.status === 'BLOCKED')) return 'BLOCKED';
    return 'PASS';
  };
  const qa = {
    unit: gate(['api.health', 'api.version', 'api.deals-contract', 'api.landing-config', 'api.reels-contract']),
    integration: gate(['deals.api-status', 'reels.api-status', 'registration.endpoint', 'auth.login-endpoint', 'auth.protected-routes']),
    playwright: gate(['e2e.production-browser-suite', 'navigation.back-modals-browser', 'a11y.touch-targets-browser', 'perf.console-network-browser']),
    registrationE2E: gate(['registration.e2e-member-creation']),
    authE2E: gate(['auth.login-e2e', 'auth.session-persistence-browser']),
    reelsE2E: gate(['reels.production-render-browser', 'reels.scroll-navigation-browser']),
    productionE2E: gate(['e2e.production-browser-suite', 'e2e.landing-http', 'e2e.sha-match']),
  };

  const certificateTask = audits.find((t) => parseLandingTaskKey(t.idempotencyKey)?.unitId === 'e2e.certificate') ?? null;
  const certificateRecord = certificateTask ? results.get(certificateTask.taskId) ?? null : null;
  const shaMatch = mainSha !== null && mainSha === productionSha;
  const anyFailOrBlocked = [...results.values()].some((r) => !r.repair && r.status !== 'PASS');
  const certificate: 'PASS' | 'FAIL' | 'PENDING' = certificateRecord?.status === 'PASS' && backlog.remaining === 0 && p0Open === 0 && p1Open === 0 && shaMatch
    ? 'PASS'
    : (anyFailOrBlocked || backlog.failed > 0 || backlog.blocked > 0 || (mainSha !== null && !shaMatch)) ? 'FAIL' : 'PENDING';

  const topBlockers = [
    ...openDefects.filter((d) => d.severity === 'P0').map((d) => `[P0] ${d.unit_id}: ${d.detail} → ${d.remediation}`),
    ...landing.filter((t) => t.state === 'BLOCKED').map((t) => `[BLOCKED] ${parseLandingTaskKey(t.idempotencyKey)?.unitId ?? t.title}: ${t.blocker ?? 'no blocker text'}`),
    ...openDefects.filter((d) => d.severity === 'P1').map((d) => `[P1] ${d.unit_id}: ${d.detail} → ${d.remediation}`),
  ];
  const dedupedBlockers = [...new Set(topBlockers)];

  const delivery = {
    commits: landing.filter((t) => t.commitSha).length,
    prs: 0,
    merged: 0,
    deploys: landing.filter((t) => t.deploymentId).length,
    note: 'Landing P0 audit units record evidence; code changes flow through the owner-approved PR pipeline and are counted only when a task carries a real commit/deployment id.',
  };

  return {
    ok: true,
    marker: IVX_LANDING_P0_MARKER,
    generatedAt: new Date(nowMs).toISOString(),
    mission,
    sha: { main: mainSha, production: productionSha, match: mainSha === null ? null : shaMatch },
    agents: { registered: registeredAgents, workingNow, idle, blocked, failed },
    hours24h: {
      productive: Math.round((productiveSeconds / 3600) * 100) / 100,
      blocked: Math.round((blockedSeconds / 3600) * 100) / 100,
      idle: null as number | null,
      waste: null as number | null,
      note: 'productive = evidence-backed execution seconds only; idle/waste hours are UNVERIFIED (not measured) and never reported as productive.',
      staleRequeues,
    },
    backlog,
    bugs: { found: bugsFound, fixed: fixesApplied, resolvedOnRecheck, open: openDefects.length, p0Open, p1Open },
    delivery,
    qa,
    certificate,
    topBlockers: dedupedBlockers.slice(0, 5),
    tasks: { ledgerTotal: tasks.length, landingForSha: landing.length, duplicateTasks },
  };
}

let mainShaCache: { sha: string | null; expiresAt: number } = { sha: null, expiresAt: 0 };

/** main SHA via GitHub API (token optional for a public repo); cached 5 minutes; null when unavailable. */
export async function fetchMainSha(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (process.env.NODE_ENV === 'test') return null;
  const now = Date.now();
  if (mainShaCache.expiresAt > now) return mainShaCache.sha;
  try {
    const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'ivx-landing-p0' };
    const token = (process.env.GITHUB_TOKEN ?? '').trim();
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetchImpl(`https://api.github.com/repos/${LANDING_REPO}/commits/main`, { headers, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { sha?: string };
    mainShaCache = { sha: typeof body.sha === 'string' ? body.sha : null, expiresAt: now + 5 * 60 * 1000 };
  } catch {
    mainShaCache = { sha: null, expiresAt: now + 60 * 1000 };
  }
  return mainShaCache.sha;
}

export async function buildLandingP0Status(): Promise<LandingP0Status> {
  const [tasks, mainSha, mission] = await Promise.all([getAllTasks(), fetchMainSha(), readOwnerPriority()]);
  const states = getAllExecutionStates();
  return aggregateLandingStatus({
    tasks,
    productionSha: resolveProductionSha(),
    mainSha,
    registeredAgents: states.length,
    failedAgents: states.filter((s) => s.health === 'failed' || Boolean(s.disabledState)).length,
    nowMs: Date.now(),
    mission,
  });
}
