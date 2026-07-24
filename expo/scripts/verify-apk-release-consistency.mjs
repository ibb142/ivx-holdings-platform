import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const expoRoot = path.resolve(scriptDir, '..');

const [appConfig, gradle, landing] = await Promise.all([
  readFile(path.join(expoRoot, 'app.config.ts'), 'utf8'),
  readFile(path.join(expoRoot, 'android/app/build.gradle'), 'utf8'),
  readFile(path.join(expoRoot, 'ivxholding-landing/index.html'), 'utf8'),
]);

const configVersion = appConfig.match(/version:\s*["']([^"']+)["']/)?.[1];
const gradleVersion = gradle.match(/versionName\s+["']([^"']+)["']/)?.[1];
const landingVersions = [...landing.matchAll(/ivx-holdings-v(\d+\.\d+\.\d+)\.apk/g)].map((match) => match[1]);
const expectedVersion = configVersion;

if (!expectedVersion || !gradleVersion || landingVersions.length === 0) {
  throw new Error('APK release consistency check could not read every required version source.');
}
if (gradleVersion !== expectedVersion) {
  throw new Error(`Android versionName ${gradleVersion} does not match app version ${expectedVersion}.`);
}
if (landingVersions.some((version) => version !== expectedVersion)) {
  throw new Error(`Landing APK URLs must all reference v${expectedVersion}; found: ${[...new Set(landingVersions)].join(', ')}.`);
}

console.log(JSON.stringify({ status: 'ok', version: expectedVersion, landingReferences: landingVersions.length }));
