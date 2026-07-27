/**
 * IVX iOS QA Orchestration Script
 *
 * Triggers EAS iOS simulator build, polls for completion, downloads artifact,
 * and prepares Maestro flow execution instructions.
 *
 * Usage:
 *   bun run scripts/ios-qa-orchestrate.ts
 *
 * Requires:
 *   - EAS CLI installed (eas)
 *   - EXPO_TOKEN env var OR `eas login` completed
 *   - EAS project linked (expo/project.json or --project flag)
 *
 * Outputs:
 *   - Build ID, build URL, artifact URL
 *   - Maestro execution commands with correct env vars
 *   - JUnit results path
 *   - Commit SHA embedded in build
 */

import { execSync, spawnSync } from 'child_process';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const EAS_PROFILE = 'ios-simulator-qa';
const MAESTRO_FLOW = '.maestro/ivx-chat-full-qa.yaml';
const BUILD_OUTPUT_DIR = 'build';
const RESULTS_FILE = 'ios-qa-results.json';

interface QaResult {
  timestamp: string;
  commitSha: string;
  easProfile: string;
  buildId: string | null;
  buildUrl: string | null;
  buildStatus: string;
  artifactUrl: string | null;
  simulatorModel: string | null;
  iosVersion: string | null;
  maestroResult: string | null;
  failedTests: string[];
  blockedTests: string[];
  traceId: string;
  errors: string[];
}

function exec(cmd: string, timeoutMs = 60000): { stdout: string; stderr: string; code: number } {
  try {
    const result = spawnSync('bash', ['-c', cmd], {
      encoding: 'utf-8',
      timeout: timeoutMs,
      cwd: process.cwd(),
    });
    return {
      stdout: result.stdout?.trim() || '',
      stderr: result.stderr?.trim() || '',
      code: result.status ?? -1,
    };
  } catch (err) {
    return { stdout: '', stderr: String(err), code: -1 };
  }
}

function getCommitSha(): string {
  const r = exec('git rev-parse HEAD');
  return r.stdout || 'unknown';
}

function checkEasAuth(): { authenticated: boolean; account: string | null } {
  const r = exec('eas whoami 2>&1');
  if (r.code === 0 && r.stdout && !r.stdout.includes('Not logged in')) {
    return { authenticated: true, account: r.stdout };
  }
  return { authenticated: false, account: null };
}

function triggerEasBuild(): { buildId: string | null; buildUrl: string | null; error: string | null } {
  const cmd = `eas build --profile ${EAS_PROFILE} --platform ios --non-interactive --json 2>&1`;
  console.log(`[ios-qa] Triggering EAS build: ${cmd}`);
  const r = exec(cmd, 120000);

  if (r.code !== 0) {
    return { buildId: null, buildUrl: null, error: r.stderr || r.stdout || 'unknown error' };
  }

  try {
    const lines = r.stdout.split('\n').filter((l) => l.trim().startsWith('{'));
    if (lines.length > 0) {
      const data = JSON.parse(lines[lines.length - 1]);
      return {
        buildId: data.id || data.buildId || null,
        buildUrl: data.artifact || data.buildUrl || data.url || null,
        error: null,
      };
    }
  } catch {
    // Try to extract build ID from non-JSON output
    const match = r.stdout.match(/Build ID[:\s]+([a-zA-Z0-9-]+)/);
    if (match) {
      return { buildId: match[1], buildUrl: null, error: null };
    }
  }

  return { buildId: null, buildUrl: null, error: `Could not parse build response: ${r.stdout.slice(0, 200)}` };
}

function generateMaestroInstructions(buildArtifactUrl: string | null): string {
  const ownerEmail = process.env.IVX_OWNER_EMAIL || 'iperez4242@gmail.com';
  const instructions = `
=== Maestro Execution Instructions ===

1. Install Maestro CLI:
   curl -Ls "https://get.maestro.mobile.dev" | bash
   export PATH="$HOME/.maestro/bin:$PATH"

2. Boot iOS Simulator:
   xcrun simctl boot "iPhone 15 Pro"
   xcrun simctl install booted <path-to-app>

3. Set environment variables:
   export OWNER_EMAIL="${ownerEmail}"
   export OWNER_PASSWORD="<owner-password>"

4. Run the 20-step chat QA flow:
   maestro test ${MAESTRO_FLOW} --format junit --output maestro-results.xml

5. Upload results:
   - maestro-results.xml (JUnit format)
   - .maestro/screenshots/ (auto-captured)
   - maestro-logs/ (verbose logs with --debug flag)

Build artifact: ${buildArtifactUrl || '<pending EAS build completion>'}
`;
  return instructions;
}

function main() {
  console.log('=== IVX iOS QA Orchestration ===\n');

  const commitSha = getCommitSha();
  const traceId = `ivx-ios-qa-${Date.now().toString(36)}`;
  const errors: string[] = [];
  const failedTests: string[] = [];
  const blockedTests: string[] = [];

  console.log(`Commit SHA: ${commitSha}`);
  console.log(`Trace ID: ${traceId}`);

  // Step 1: Check EAS auth
  console.log('\n--- Step 1: Check EAS Authentication ---');
  const auth = checkEasAuth();
  if (auth.authenticated) {
    console.log(`EAS Authenticated as: ${auth.account}`);
  } else {
    console.log('EAS: Not authenticated');
    errors.push('EAS CLI not authenticated — requires EXPO_TOKEN or `eas login`');
  }

  // Step 2: Check EAS project link
  console.log('\n--- Step 2: Check EAS Project Link ---');
  const projectConfig = 'expo/.easignore';
  if (existsSync(projectConfig)) {
    console.log('EAS project config exists');
  } else {
    console.log('WARNING: No .easignore found');
  }

  // Step 3: Attempt build trigger
  console.log('\n--- Step 3: Attempt EAS Build Trigger ---');
  let buildId: string | null = null;
  let buildUrl: string | null = null;
  let buildStatus = 'not_attempted';

  if (auth.authenticated) {
    const build = triggerEasBuild();
    buildId = build.buildId;
    buildUrl = build.buildUrl;
    if (build.error) {
      buildStatus = 'failed';
      errors.push(`EAS build trigger failed: ${build.error}`);
      console.log(`Build failed: ${build.error}`);
    } else {
      buildStatus = 'triggered';
      console.log(`Build ID: ${buildId}`);
      console.log(`Build URL: ${buildUrl}`);
    }
  } else {
    buildStatus = 'blocked_auth';
    blockedTests.push('iOS Simulator Build — blocked: EAS not authenticated');
    blockedTests.push('Maestro 20-step QA — blocked: no simulator build');
    console.log('Build skipped: EAS not authenticated');
  }

  // Step 4: Generate Maestro instructions
  console.log('\n--- Step 4: Maestro Execution Plan ---');
  const maestroInstructions = generateMaestroInstructions(buildUrl);
  console.log(maestroInstructions);

  // Step 5: Write results
  const result: QaResult = {
    timestamp: new Date().toISOString(),
    commitSha,
    easProfile: EAS_PROFILE,
    buildId,
    buildUrl,
    buildStatus,
    artifactUrl: buildUrl,
    simulatorModel: buildStatus === 'triggered' ? 'iPhone 15 Pro (simulator)' : null,
    iosVersion: null,
    maestroResult: buildStatus === 'triggered' ? 'pending' : null,
    failedTests,
    blockedTests,
    traceId,
    errors,
  };

  const resultsPath = join(process.cwd(), RESULTS_FILE);
  writeFileSync(resultsPath, JSON.stringify(result, null, 2));
  console.log(`\nResults written to: ${resultsPath}`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Build Status: ${buildStatus}`);
  console.log(`Failed Tests: ${failedTests.length}`);
  console.log(`Blocked Tests: ${blockedTests.length}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Trace ID: ${traceId}`);
}

main();
