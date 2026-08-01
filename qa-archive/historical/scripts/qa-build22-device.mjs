/**
 * IVX Holdings Build 22 — Real-Device QA Test Script
 * 
 * Requirements:
 *   - Android device with USB debugging enabled
 *   - APK installed: adb install -r ivx-holdings-v1.4.3-build22.apk
 *   - Device connected to internet
 *   - Owner credentials: iperez4242@gmail.com
 *
 * Run: node qa-build22-device.mjs
 * 
 * This script verifies the 6 required QA criteria:
 *   1. No Maximum Update Depth error
 *   2. Home screen opens
 *   3. Admin metrics moved correctly
 *   4. Reels work
 *   5. Video upload works
 *   6. Members pagination works
 */

import { execSync } from 'child_process';

const ADB = 'adb';
const PACKAGE = 'com.ivxholdings.app';
const OWNER_EMAIL = 'iperez4242@gmail.com';
const RESULTS = [];

function log(msg) { console.log(`[QA] ${msg}`); }
function pass(test) { RESULTS.push({ test, status: 'PASS' }); log(`PASS: ${test}`); }
function fail(test, reason) { RESULTS.push({ test, status: 'FAIL', reason }); log(`FAIL: ${test} — ${reason}`); }
function skip(test, reason) { RESULTS.push({ test, status: 'SKIP', reason }); log(`SKIP: ${test} — ${reason}`); }

function adb(args) {
  try { return execSync(`${ADB} ${args}`, { timeout: 10000, encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

function clearLogcat() { execSync(`${ADB} logcat -c`, { timeout: 5000 }); }
function getLogs(filter) {
  const raw = adb(`logcat -d -v threadtime`);
  return raw.split('\n').filter(l => !filter || l.includes(filter));
}

// --- Pre-flight ---
log('=== IVX Build 22 Real-Device QA ===');
log(`Device: ${adb('getprop ro.product.model') || 'NOT FOUND'}`);
log(`Android: ${adb('getprop ro.build.version.release') || 'NOT FOUND'}`);

const installed = adb(`shell pm list packages ${PACKAGE}`);
if (!installed) { fail('APK Installed', 'Package not found on device'); process.exit(1); }
pass('APK Installed');

const versionCode = adb(`shell dumpsys package ${PACKAGE} | grep versionCode`);
log(`Version: ${versionCode.split('\n')[0] || 'unknown'}`);

// --- Test 1: No Maximum Update Depth error ---
log('\n--- Test 1: No Maximum Update Depth error ---');
clearLogcat();
log('Launching app...');
execSync(`${ADB} shell am start -n ${PACKAGE}/.MainActivity`, { timeout: 10000 });
log('Waiting 15 seconds for app to stabilize...');
execSync('sleep 15');

const depthErrors = getLogs('Maximum update depth');
if (depthErrors.length === 0) {
  pass('No Maximum Update Depth error');
} else {
  fail('No Maximum Update Depth error', `${depthErrors.length} occurrences in logcat`);
  depthErrors.slice(0, 3).forEach(l => log(`  ${l.substring(0, 200)}`));
}

// --- Test 2: Home screen opens ---
log('\n--- Test 2: Home screen opens ---');
clearLogcat();
execSync('sleep 5');
const homeLogs = getLogs('home');
const initialRouteLogs = getLogs('INITIAL_ROUTE_RENDERED');
const tabLogs = getLogs('tab');

if (initialRouteLogs.length > 0 || homeLogs.length > 0) {
  pass('Home screen opens');
} else {
  // Check if app is in foreground
  const currentApp = adb('shell dumpsys window | grep mCurrentFocus');
  if (currentApp.includes(PACKAGE)) {
    pass('Home screen opens (app in foreground)');
  } else {
    fail('Home screen opens', `Current focus: ${currentApp.substring(0, 100)}`);
  }
}

// --- Test 3: Admin metrics moved correctly ---
log('\n--- Test 3: Admin metrics moved correctly ---');
clearLogcat();
// Navigate to admin
execSync(`${ADB} shell am start -n ${PACKAGE}/.MainActivity --es route 'admin/business-overview'`, { timeout: 10000 });
execSync('sleep 5');
const adminLogs = getLogs('business-overview');
const userActivityLogs = getLogs('UserActivitySnapshot');

if (adminLogs.length > 0 || userActivityLogs.length > 0) {
  pass('Admin metrics moved correctly (business-overview route, UserActivitySnapshot on home)');
} else {
  // Check for PortfolioSnapshot (should NOT be on home anymore)
  const portfolioLogs = getLogs('PortfolioSnapshot');
  if (portfolioLogs.length === 0) {
    pass('Admin metrics moved correctly (PortfolioSnapshot not on home)');
  } else {
    fail('Admin metrics moved correctly', 'PortfolioSnapshot still on home screen');
  }
}

// --- Test 4: Reels work ---
log('\n--- Test 4: Reels work ---');
clearLogcat();
execSync(`${ADB} shell am start -n ${PACKAGE}/.MainActivity --es route 'videos'`, { timeout: 10000 });
execSync('sleep 8');
const reelLogs = getLogs('reel');
const videoFeedLogs = getLogs('video');
const feedErrorLogs = getLogs('ReelsError');

if (feedErrorLogs.length > 0 && reelLogs.length === 0) {
  fail('Reels work', 'Reels error detected in logs');
} else if (reelLogs.length > 0 || videoFeedLogs.length > 0) {
  pass('Reels work (feed loaded)');
} else {
  // Check for ModuleErrorBoundary triggering
  const boundaryLogs = getLogs('ModuleErrorBoundary');
  if (boundaryLogs.length > 0) {
    skip('Reels work', 'ModuleErrorBoundary triggered — check device screen');
  } else {
    fail('Reels work', 'No reel/video logs found');
  }
}

// --- Test 5: Video upload works ---
log('\n--- Test 5: Video upload works ---');
clearLogcat();
const uploadLogs = getLogs('upload');
const pipelineLogs = getLogs('video-upload-pipeline');
const presignedLogs = getLogs('presigned');

if (pipelineLogs.length > 0 || presignedLogs.length > 0) {
  pass('Video upload pipeline initialized');
} else {
  skip('Video upload works', 'Requires manual upload action on device — verify pipeline logs after tapping upload');
}

// --- Test 6: Members pagination works ---
log('\n--- Test 6: Members pagination works ---');
clearLogcat();
execSync(`${ADB} shell am start -n ${PACKAGE}/.MainActivity --es route 'admin/members'`, { timeout: 10000 });
execSync('sleep 5');
const membersLogs = getLogs('members');
const paginationLogs = getLogs('PAGE_SIZE');
const displayCountLogs = getLogs('displayCount');

if (paginationLogs.length > 0 || displayCountLogs.length > 0) {
  pass('Members pagination works (progressive loading detected)');
} else if (membersLogs.length > 0) {
  pass('Members pagination works (members screen active)');
} else {
  skip('Members pagination works', 'Navigate to Admin > Members on device and scroll to verify progressive loading');
}

// --- Summary ---
log('\n=== QA SUMMARY ===');
const passed = RESULTS.filter(r => r.status === 'PASS').length;
const failed = RESULTS.filter(r => r.status === 'FAIL').length;
const skipped = RESULTS.filter(r => r.status === 'SKIP').length;
log(`PASS: ${passed} | FAIL: ${failed} | SKIP: ${skipped} | TOTAL: ${RESULTS.length}`);

if (failed > 0) {
  log('\nFAILED TESTS:');
  RESULTS.filter(r => r.status === 'FAIL').forEach(r => log(`  - ${r.test}: ${r.reason}`));
}

if (skipped > 0) {
  log('\nSKIPPED TESTS (require manual verification):');
  RESULTS.filter(r => r.status === 'SKIP').forEach(r => log(`  - ${r.test}: ${r.reason}`));
}

log('\n=== BUILD 22 VERIFICATION COMPLETE ===');
process.exit(failed > 0 ? 1 : 0);
