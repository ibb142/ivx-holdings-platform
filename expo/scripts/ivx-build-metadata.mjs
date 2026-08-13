/**
 * IVX Build Metadata Generator (items 185-187)
 *
 * 185: Update ivx-config.json version during deployment
 * 186: Include version and code revision in build
 * 187: Generate build metadata automatically
 *
 * Usage: node ivx-build-metadata.mjs [output-path]
 * Default output: ./ivx-build-metadata.json
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const timestamp = new Date().toISOString();
const version = 'v' + timestamp.slice(0, 10).replace(/-/g, '');

let gitSha = 'unknown';
let gitBranch = 'unknown';
let gitMessage = 'unknown';

try {
  gitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  gitMessage = execSync('git log -1 --pretty=%B', { encoding: 'utf-8' }).trim().slice(0, 200);
} catch (e) {
  console.warn('Warning: Could not get git info:', e.message);
}

const metadata = {
  version,
  gitSha,
  gitBranch,
  gitMessage,
  builtAt: timestamp,
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
  // Items 185-187: all build metadata in one file
  buildId: `ivx-${version}-${(gitSha || 'unknown').slice(0, 8)}`,
};

const outputPath = process.argv[2] || './ivx-build-metadata.json';
writeFileSync(outputPath, JSON.stringify(metadata, null, 2));
console.log('Build metadata written to', outputPath);
console.log(JSON.stringify(metadata, null, 2));

// Also update ivx-config.json if it exists (item 185)
const configPath = './ivx-config.json';
if (existsSync(configPath)) {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.version = version;
    config.gitSha = gitSha;
    config.builtAt = timestamp;
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('\nUpdated ivx-config.json with build metadata');
  } catch (e) {
    console.warn('Warning: Could not update ivx-config.json:', e.message);
  }
}
