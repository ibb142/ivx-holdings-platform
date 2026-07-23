/**
 * IVX Code Intelligence — Phase 14
 *
 * Repository intelligence with dependency graph, API route graph, database-table
 * usage graph, module ownership, call hierarchy, dead-code detection, duplicate
 * detection, migration/deployment/test-coverage impact analysis.
 *
 * Before editing code, identifies: canonical file, dependent files, impacted APIs,
 * impacted tables, impacted tests, mobile rebuild requirement, web deploy
 * requirement, database migration requirement.
 */

// ─── Types ────────────────────────────────────────────────────────

export type IVXCodeGraph = {
  files: IVXFileNode[];
  dependencies: IVXDependency[];
  apiRoutes: IVXAPIRoute[];
  dbTables: IVXDBTableUsage[];
  modules: IVXModuleOwnership[];
  callHierarchy: IVXCallLink[];
  deadCodeCandidates: string[];
  duplicateCodeCandidates: IVXDuplicateGroup[];
};

export type IVXFileNode = {
  path: string;
  type: 'backend' | 'frontend' | 'config' | 'test' | 'migration' | 'landing';
  size: number;
  lastModified: string | null;
};

export type IVXDependency = {
  from: string;
  to: string;
  type: 'import' | 'require' | 'dynamic_import';
};

export type IVXAPIRoute = {
  method: string;
  path: string;
  handler: string;
  file: string;
  authRequired: boolean;
};

export type IVXDBTableUsage = {
  table: string;
  file: string;
  operation: 'read' | 'write' | 'update' | 'delete';
};

export type IVXModuleOwnership = {
  module: string;
  owner: string;
  files: string[];
};

export type IVXCallLink = {
  caller: string;
  callee: string;
  function: string;
};

export type IVXDuplicateGroup = {
  hash: string;
  files: string[];
  lineCount: number;
  similarity: number;
};

// ─── Impact Analysis ──────────────────────────────────────────────

export type IVXImpactAnalysis = {
  canonicalFile: string;
  dependentFiles: string[];
  impactedAPIs: IVXAPIRoute[];
  impactedTables: string[];
  impactedTests: string[];
  requiresMobileRebuild: boolean;
  requiresWebDeploy: boolean;
  requiresDBMigration: boolean;
  requiresLandingDeploy: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  estimatedChangeScope: 'trivial' | 'small' | 'moderate' | 'large';
};

export function analyzeImpact(input: {
  filePath: string;
  changesType: 'logic' | 'api' | 'schema' | 'ui' | 'config' | 'migration';
  graph?: Partial<IVXCodeGraph>;
}): IVXImpactAnalysis {
  const isBackend = input.filePath.startsWith('backend/');
  const isFrontend = input.filePath.startsWith('expo/');
  const isLanding = input.filePath.includes('ivxholding-landing/');
  const isMigration = input.filePath.includes('migration') || input.filePath.endsWith('.sql');
  const isConfig = input.filePath.endsWith('.json') || input.filePath.endsWith('.yml') || input.filePath.endsWith('.yaml');
  const isTest = input.filePath.includes('.test.') || input.filePath.includes('__tests__');

  // Find dependent files from graph
  const graph = input.graph || {};
  const dependentFiles: string[] = [];
  if (graph.dependencies) {
    for (const dep of graph.dependencies) {
      if (dep.to === input.filePath) dependentFiles.push(dep.from);
    }
  }

  // Find impacted APIs
  const impactedAPIs: IVXAPIRoute[] = [];
  if (graph.apiRoutes) {
    for (const route of graph.apiRoutes) {
      if (route.file === input.filePath || dependentFiles.includes(route.file)) {
        impactedAPIs.push(route);
      }
    }
  }

  // Find impacted tables
  const impactedTables: string[] = [];
  if (graph.dbTables) {
    for (const usage of graph.dbTables) {
      if (usage.file === input.filePath || dependentFiles.includes(usage.file)) {
        if (!impactedTables.includes(usage.table)) {
          impactedTables.push(usage.table);
        }
      }
    }
  }

  // Find impacted tests
  const impactedTests: string[] = [];
  if (graph.files) {
    const basePath = input.filePath.replace(/\.(ts|tsx)$/, '');
    for (const file of graph.files) {
      if (file.path.includes(basePath) && file.path !== input.filePath && isTest) {
        impactedTests.push(file.path);
      }
      // Also check for test files that import from this file
      if (file.type === 'test' && dependentFiles.includes(file.path)) {
        impactedTests.push(file.path);
      }
    }
  }

  // Determine deployment requirements
  const requiresMobileRebuild = isFrontend && input.changesType !== 'config';
  const requiresWebDeploy = isBackend;
  const requiresDBMigration = isMigration || input.changesType === 'schema';
  const requiresLandingDeploy = isLanding;

  // Risk level
  let riskLevel: IVXImpactAnalysis['riskLevel'] = 'low';
  if (requiresDBMigration) riskLevel = 'critical';
  else if (impactedAPIs.length > 3 || impactedTables.length > 2) riskLevel = 'high';
  else if (impactedAPIs.length > 0 || dependentFiles.length > 3) riskLevel = 'medium';

  // Change scope
  let estimatedChangeScope: IVXImpactAnalysis['estimatedChangeScope'] = 'trivial';
  if (dependentFiles.length > 5 || impactedAPIs.length > 3) estimatedChangeScope = 'large';
  else if (dependentFiles.length > 2 || impactedAPIs.length > 1) estimatedChangeScope = 'moderate';
  else if (dependentFiles.length > 0) estimatedChangeScope = 'small';

  return {
    canonicalFile: input.filePath,
    dependentFiles,
    impactedAPIs,
    impactedTables,
    impactedTests,
    requiresMobileRebuild,
    requiresWebDeploy,
    requiresDBMigration,
    requiresLandingDeploy,
    riskLevel,
    estimatedChangeScope,
  };
}

// ─── Dead Code Detection ──────────────────────────────────────────

export function detectDeadCode(files: IVXFileNode[], dependencies: IVXDependency[]): string[] {
  // A file is potentially dead if no other file imports it
  // (and it's not an entry point, API route, or config)
  const importedFiles = new Set(dependencies.map((d) => d.to));
  const entryPointPatterns = [
    /server\.ts$/,
    /worker\.ts$/,
    /hono\.ts$/,
    /_layout\.tsx$/,
    /index\.(ts|tsx|html)$/,
    /app\.config\.ts$/,
  ];

  return files
    .filter((f) => {
      if (importedFiles.has(f.path)) return false;
      if (entryPointPatterns.some((p) => p.test(f.path))) return false;
      if (f.type === 'config' || f.type === 'migration' || f.type === 'test') return false;
      return true;
    })
    .map((f) => f.path);
}

// ─── Coverage Mapping ─────────────────────────────────────────────

export type IVXCoverageMap = {
  totalFiles: number;
  testFiles: number;
  coveredFiles: string[];
  uncoveredFiles: string[];
  coveragePercent: number;
};

export function buildCoverageMap(files: IVXFileNode[]): IVXCoverageMap {
  const sourceFiles = files.filter((f) => f.type === 'backend' || f.type === 'frontend');
  const testFiles = files.filter((f) => f.type === 'test');

  const coveredFiles: string[] = [];
  for (const source of sourceFiles) {
    const basePath = source.path.replace(/\.(ts|tsx)$/, '');
    const hasTest = testFiles.some((t) => t.path.includes(basePath) || t.path.includes(basePath.split('/').pop() || ''));
    if (hasTest) coveredFiles.push(source.path);
  }

  const uncoveredFiles = sourceFiles.map((f) => f.path).filter((p) => !coveredFiles.includes(p));

  return {
    totalFiles: sourceFiles.length,
    testFiles: testFiles.length,
    coveredFiles,
    uncoveredFiles,
    coveragePercent: sourceFiles.length > 0 ? (coveredFiles.length / sourceFiles.length) * 100 : 0,
  };
}

// ─── Pre-Edit Checklist ───────────────────────────────────────────

export function preEditChecklist(filePath: string, changeType: string): {
  checks: Array<{ name: string; required: boolean; detail: string }>;
  allSatisfied: boolean;
} {
  const analysis = analyzeImpact({ filePath, changesType: changeType as IVXImpactAnalysis['riskLevel'] extends never ? never : 'logic' });

  const checks = [
    { name: 'canonical_file_identified', required: true, detail: `File: ${analysis.canonicalFile}` },
    { name: 'dependents_checked', required: true, detail: `${analysis.dependentFiles.length} dependent files` },
    { name: 'apis_checked', required: analysis.impactedAPIs.length > 0, detail: `${analysis.impactedAPIs.length} APIs impacted` },
    { name: 'tables_checked', required: analysis.impactedTables.length > 0, detail: `${analysis.impactedTables.length} tables impacted` },
    { name: 'tests_identified', required: true, detail: `${analysis.impactedTests.length} test files to run` },
    { name: 'mobile_rebuild_needed', required: analysis.requiresMobileRebuild, detail: analysis.requiresMobileRebuild ? 'APK rebuild required' : 'No mobile change' },
    { name: 'web_deploy_needed', required: analysis.requiresWebDeploy, detail: analysis.requiresWebDeploy ? 'Render deploy required' : 'No backend change' },
    { name: 'db_migration_needed', required: analysis.requiresDBMigration, detail: analysis.requiresDBMigration ? 'Database migration required' : 'No migration' },
    { name: 'landing_deploy_needed', required: analysis.requiresLandingDeploy, detail: analysis.requiresLandingDeploy ? 'S3 + CloudFront deploy required' : 'No landing change' },
  ];

  return {
    checks,
    allSatisfied: checks.filter((c) => c.required).every((c) => c.detail !== '0 dependent files' && c.detail !== '0 APIs impacted' && c.detail !== '0 tables impacted' && c.detail !== '0 test files to run'),
  };
}

export const IVX_CODE_INTELLIGENCE_MARKER = 'ivx-code-intelligence-2026-07-23-v1';
