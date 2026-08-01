/**
 * IVX Historical QA Evidence Archive Manifest
 * All files in qa-archive/ are HISTORICAL — NOT CURRENT PRODUCTION PROOF.
 * Recovered from git history for audit value only.
 */

export interface ArchivedFile {
  originalPath: string;
  archivePath: string;
  deletedByCommit: string;
  deletedByMessage: string;
  lastGoodCommit: string;
  lines: number;
  classification: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  classificationLabel: string;
  action: 'restored' | 'archived' | 'rewritten' | 'merged' | 'retired';
  actionDetail: string;
}

export const ARCHIVED_FILES: ArchivedFile[] = [
  // === QA Automation Scripts (17) — Archived, replaced by unified runner ===
  { originalPath: 'qa-404-check.mjs', archivePath: 'qa-archive/historical/scripts/qa-404-check.mjs', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 28, classification: 'A', classificationLabel: 'Executable QA code', action: 'retired', actionDetail: '404 check merged into unified QA runner as QA-LANDING-001' },
  { originalPath: 'qa-autonomous.mjs', archivePath: 'qa-archive/historical/scripts/qa-autonomous.mjs', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 199, classification: 'A', classificationLabel: 'Executable QA code', action: 'merged', actionDetail: 'Cross-viewport checks merged into unified QA runner' },
  { originalPath: 'qa-build22-device.mjs', archivePath: 'qa-archive/historical/scripts/qa-build22-device.mjs', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 184, classification: 'A', classificationLabel: 'Executable QA code', action: 'archived', actionDetail: 'ADB device test — requires physical Android device, archived for reference' },
  { originalPath: 'qa-closeout-playwright.mjs', archivePath: 'qa-archive/historical/scripts/qa-closeout-playwright.mjs', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 128, classification: 'A', classificationLabel: 'Executable QA code', action: 'merged', actionDetail: 'Closeout checks merged into unified QA runner' },
  { originalPath: 'qa-diagnose.mjs', archivePath: 'qa-archive/historical/scripts/qa-diagnose.mjs', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 128, classification: 'A', classificationLabel: 'Executable QA code', action: 'merged', actionDetail: 'Diagnostic checks merged into unified QA runner' },
  { originalPath: 'qa-errors.mjs', archivePath: 'qa-archive/historical/scripts/qa-errors.mjs', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 27, classification: 'A', classificationLabel: 'Executable QA code', action: 'merged', actionDetail: 'Error checking merged into unified QA runner' },
  { originalPath: 'qa-final.mjs', archivePath: 'qa-archive/historical/scripts/qa-final.mjs', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 206, classification: 'A', classificationLabel: 'Executable QA code', action: 'merged', actionDetail: 'Final cross-viewport QA merged into unified QA runner' },
  { originalPath: 'qa-reels-playwright.mjs', archivePath: 'qa-archive/historical/scripts/qa-reels-playwright.mjs', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 155, classification: 'A', classificationLabel: 'Executable QA code', action: 'merged', actionDetail: 'Reels QA merged into unified QA runner as QA-REELS-001' },
  { originalPath: 'qa-screenshots.ts', archivePath: 'qa-archive/historical/scripts/qa-screenshots.ts', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 89, classification: 'A', classificationLabel: 'Executable QA code', action: 'merged', actionDetail: 'Screenshot capture merged into evidence generator' },
  { originalPath: 'shoot-banner-proof.mjs', archivePath: 'qa-archive/historical/scripts/shoot-banner-proof.mjs', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 26, classification: 'A', classificationLabel: 'Executable QA code', action: 'retired', actionDetail: 'Obsolete screenshot script — superseded by evidence generator' },
  { originalPath: 'shoot-chat-fix-proof.mjs', archivePath: 'qa-archive/historical/scripts/shoot-chat-fix-proof.mjs', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 31, classification: 'A', classificationLabel: 'Executable QA code', action: 'retired', actionDetail: 'Obsolete screenshot script — superseded by evidence generator' },
  { originalPath: 'shoot-chat-real-proof.mjs', archivePath: 'qa-archive/historical/scripts/shoot-chat-real-proof.mjs', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 52, classification: 'A', classificationLabel: 'Executable QA code', action: 'retired', actionDetail: 'Obsolete screenshot script — superseded by evidence generator' },
  { originalPath: 'shoot-final-qa.mjs', archivePath: 'qa-archive/historical/scripts/shoot-final-qa.mjs', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 25, classification: 'A', classificationLabel: 'Executable QA code', action: 'retired', actionDetail: 'Obsolete screenshot script — superseded by evidence generator' },
  { originalPath: 'shoot-home-local-proof.mjs', archivePath: 'qa-archive/historical/scripts/shoot-home-local-proof.mjs', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 54, classification: 'A', classificationLabel: 'Executable QA code', action: 'retired', actionDetail: 'Obsolete screenshot script — superseded by evidence generator' },
  { originalPath: 'shoot-home-proof.mjs', archivePath: 'qa-archive/historical/scripts/shoot-home-proof.mjs', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 60, classification: 'A', classificationLabel: 'Executable QA code', action: 'retired', actionDetail: 'Obsolete screenshot script — superseded by evidence generator' },
  { originalPath: 'shoot-no-loading-proof.mjs', archivePath: 'qa-archive/historical/scripts/shoot-no-loading-proof.mjs', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 31, classification: 'A', classificationLabel: 'Executable QA code', action: 'retired', actionDetail: 'Obsolete screenshot script — superseded by evidence generator' },
  { originalPath: 'shoot-reels-proof.mjs', archivePath: 'qa-archive/historical/scripts/shoot-reels-proof.mjs', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 65, classification: 'A', classificationLabel: 'Executable QA code', action: 'retired', actionDetail: 'Obsolete screenshot script — superseded by evidence generator' },

  // === CI Workflow Files (8) — To be restored ===
  { originalPath: '.github/workflows/ivx-e2e.yml', archivePath: 'qa-archive/historical/scripts/ivx-e2e.yml', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 81, classification: 'C', classificationLabel: 'CI workflow file', action: 'rewritten', actionDetail: 'Rewritten as .github/workflows/ivx-qa-suite.yml with full QA matrix' },
  { originalPath: '.github/workflows/build-apk-release.yml', archivePath: 'qa-archive/historical/scripts/build-apk-release.yml', deletedByCommit: '64c0ace6', deletedByMessage: 'New version from Rork', lastGoodCommit: 'f655312d', lines: 111, classification: 'C', classificationLabel: 'CI workflow file', action: 'archived', actionDetail: 'APK build workflow archived — manual builds used currently' },
  { originalPath: '.github/workflows/deploy-landing.yml', archivePath: 'qa-archive/historical/scripts/deploy-landing.yml', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 102, classification: 'C', classificationLabel: 'CI workflow file', action: 'archived', actionDetail: 'Landing deploy workflow archived for reference' },
  { originalPath: '.github/workflows/deploy.yml', archivePath: 'qa-archive/historical/scripts/deploy.yml', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 142, classification: 'C', classificationLabel: 'CI workflow file', action: 'archived', actionDetail: 'General deploy workflow archived for reference' },
  { originalPath: '.github/workflows/infrastructure.yml', archivePath: 'qa-archive/historical/scripts/infrastructure.yml', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 84, classification: 'C', classificationLabel: 'CI workflow file', action: 'archived', actionDetail: 'Infrastructure workflow archived for reference' },
  { originalPath: '.github/workflows/render-deploy-trigger.yml', archivePath: 'qa-archive/historical/scripts/render-deploy-trigger.yml', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 131, classification: 'C', classificationLabel: 'CI workflow file', action: 'archived', actionDetail: 'Render deploy trigger archived for reference' },
  { originalPath: '.github/workflows/render-deploy.yml', archivePath: 'qa-archive/historical/scripts/render-deploy.yml', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 185, classification: 'C', classificationLabel: 'CI workflow file', action: 'archived', actionDetail: 'Render deploy workflow archived for reference' },

  // === Top-level QA Reports (3) — Archived as historical ===
  { originalPath: 'IVX_FINAL_QA_REPORT_2026-07-16.md', archivePath: 'qa-archive/historical/reports/IVX_FINAL_QA_REPORT_2026-07-16.md', deletedByCommit: 'a6b5cf84', deletedByMessage: 'New version from Rork', lastGoodCommit: 'e0841389', lines: 159, classification: 'E', classificationLabel: 'Historical evidence only', action: 'archived', actionDetail: 'Historical QA report — NOT CURRENT PRODUCTION PROOF' },
  { originalPath: 'DEPLOYMENT_PROOF.json', archivePath: 'qa-archive/historical/reports/DEPLOYMENT_PROOF.json', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 111, classification: 'E', classificationLabel: 'Historical evidence only', action: 'archived', actionDetail: 'Historical deployment proof — NOT CURRENT PRODUCTION PROOF' },
  { originalPath: 'DEPLOYMENT.md', archivePath: 'qa-archive/historical/reports/DEPLOYMENT.md', deletedByCommit: '428eea31', deletedByMessage: 'Improved the video view for properties...', lastGoodCommit: '34970b6f', lines: 141, classification: 'E', classificationLabel: 'Historical evidence only', action: 'archived', actionDetail: 'Historical deployment doc — NOT CURRENT PRODUCTION PROOF' },

  // === Backend QA Source Files (2) — Already restored in V6.17 ===
  { originalPath: 'backend/services/chat-web-qa-runner.ts', archivePath: 'backend/services/chat-web-qa-runner.ts', deletedByCommit: 'f4c8861a', deletedByMessage: 'The profile section was thoroughly tested...', lastGoodCommit: '34970b6f', lines: 582, classification: 'A', classificationLabel: 'Executable QA code', action: 'restored', actionDetail: 'Restored to original path in V6.17 commit 40790e62' },
  { originalPath: 'backend/api/ivx-senior-developer-worker.test.ts', archivePath: 'backend/api/ivx-senior-developer-worker.test.ts', deletedByCommit: '64c0ace6', deletedByMessage: 'New version from Rork', lastGoodCommit: '34970b6f', lines: 92, classification: 'B', classificationLabel: 'Test fixtures required by current tests', action: 'restored', actionDetail: 'Restored to original path in V6.17 commit 40790e62' },
];

export const HISTORICAL_WARNING = 'HISTORICAL — NOT CURRENT PRODUCTION PROOF';

/**
 * Get summary stats for the archive.
 */
export function getArchiveStats() {
  const total = ARCHIVED_FILES.length;
  const byAction = {
    restored: ARCHIVED_FILES.filter(f => f.action === 'restored').length,
    archived: ARCHIVED_FILES.filter(f => f.action === 'archived').length,
    rewritten: ARCHIVED_FILES.filter(f => f.action === 'rewritten').length,
    merged: ARCHIVED_FILES.filter(f => f.action === 'merged').length,
    retired: ARCHIVED_FILES.filter(f => f.action === 'retired').length,
  };
  const byClassification = {
    A: ARCHIVED_FILES.filter(f => f.classification === 'A').length,
    B: ARCHIVED_FILES.filter(f => f.classification === 'B').length,
    C: ARCHIVED_FILES.filter(f => f.classification === 'C').length,
    D: ARCHIVED_FILES.filter(f => f.classification === 'D').length,
    E: ARCHIVED_FILES.filter(f => f.classification === 'E').length,
    F: ARCHIVED_FILES.filter(f => f.classification === 'F').length,
  };
  return { total, byAction, byClassification };
}
