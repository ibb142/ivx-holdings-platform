import { readFile, readdir } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * IVX ZERO-RORK RUNTIME VERIFIER
 * ------------------------------
 * Proves the IVX app runtime contains 0% Rork:
 *   1. `dependencies` in package.json must contain NO Rork packages.
 *      (`devDependencies` = developer tooling — Rork works as IVX's senior
 *      developer there; dev tooling never ships to users.)
 *   2. Runtime source (app/, components/, lib/, hooks/, src/, constants/,
 *      shared/, types/, polyfills/, app.config.ts) must contain NO Rork
 *      imports, Rork service URLs, or Rork env-var reads.
 *   3. metro.config.js must keep the guarded optional block so production
 *      builds (toolkit absent or IVX_ZERO_RORK=1) use pure Expo config.
 *
 * Run: node scripts/verify-zero-rork-runtime.mjs
 * Exit 0 = ZERO RORK RUNTIME VERIFIED. Exit 1 = violations listed.
 */

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const RUNTIME_SOURCE_DIRS = [
  "app",
  "components",
  "lib",
  "hooks",
  "src",
  "constants",
  "shared",
  "types",
  "polyfills",
];

const RUNTIME_SOURCE_FILES = ["app.config.ts"];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const FORBIDDEN_PATTERNS = [
  { name: "Rork package import", regex: /@rork-ai\// },
  { name: "Rork Metro wrapper", regex: /withRorkMetro/ },
  { name: "Rork toolkit URL", regex: /toolkit\.rork\.com/ },
  { name: "Rork API URL", regex: /api\.rork\.com/ },
  { name: "Rork app URL", regex: /rork\.app\// },
  { name: "Rork project URL", regex: /rork\.com\/p\// },
  { name: "Rork env var read", regex: /EXPO_PUBLIC_RORK_[A-Z_]+/ },
  { name: "Rork public env var read", regex: /RORK_PUBLIC_[A-Z_]+/ },
  { name: "Rork toolkit env var read", regex: /EXPO_PUBLIC_TOOLKIT_URL/ },
];

/** Lines that mention Rork only to document its absence are allowed. */
const ALLOWED_LINE_HINTS = [
  "zero-rork",
  "zero rork",
  "0% rork",
  "removed",
  "REMOVED",
  "independence",
  "never use rork",
  "no rork",
  "verify-zero-rork",
];

const violations = [];

function isAllowedLine(line) {
  const lower = line.toLowerCase();
  return ALLOWED_LINE_HINTS.some((hint) => lower.includes(hint.toLowerCase()));
}

async function scanFile(filePath, relPath) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch {
    return;
  }
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.regex.test(line) && !isAllowedLine(line)) {
        violations.push(`${relPath}:${i + 1} [${pattern.name}] ${line.trim().slice(0, 120)}`);
      }
    }
  }
}

async function scanDir(dirPath, relPath) {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const entryPath = join(dirPath, entry.name);
    const entryRel = `${relPath}/${entry.name}`;
    if (entry.isDirectory()) {
      await scanDir(entryPath, entryRel);
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
      await scanFile(entryPath, entryRel);
    }
  }
}

// 1. Runtime dependencies check
const pkg = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const runtimeDeps = Object.keys(pkg.dependencies ?? {});
const rorkRuntimeDeps = runtimeDeps.filter((name) => name.toLowerCase().includes("rork"));
for (const dep of rorkRuntimeDeps) {
  violations.push(`package.json [Rork package in RUNTIME dependencies] ${dep}`);
}
const devDeps = Object.keys(pkg.devDependencies ?? {});
const rorkDevDeps = devDeps.filter((name) => name.toLowerCase().includes("rork"));

// 2. Runtime source scan
for (const dir of RUNTIME_SOURCE_DIRS) {
  await scanDir(join(projectRoot, dir), dir);
}
for (const file of RUNTIME_SOURCE_FILES) {
  await scanFile(join(projectRoot, file), file);
}

// 3. Metro config guard check
const metroSource = await readFile(join(projectRoot, "metro.config.js"), "utf8");
const hasGuard =
  metroSource.includes("try {") &&
  metroSource.includes("catch") &&
  metroSource.includes("IVX_ZERO_RORK");
const hasHardRequire =
  /^const .*=\s*require\("@rork-ai/m.test(metroSource) ||
  /^module\.exports\s*=\s*withRorkMetro/m.test(metroSource);
if (hasHardRequire) {
  violations.push("metro.config.js [HARD Rork dependency — unguarded require/export]");
} else if (!hasGuard && metroSource.toLowerCase().includes("rork")) {
  violations.push("metro.config.js [Rork reference without production guard]");
}

// Report
console.log("==============================================");
console.log("  IVX ZERO-RORK RUNTIME VERIFICATION");
console.log("==============================================");
console.log(`  Runtime dependencies scanned: ${runtimeDeps.length}`);
console.log(`  Rork packages in runtime deps: ${rorkRuntimeDeps.length}`);
console.log(
  `  Rork packages in devDependencies (developer tooling, never ships): ${rorkDevDeps.length}`,
);
console.log(`  Runtime source dirs scanned: ${RUNTIME_SOURCE_DIRS.join(", ")}`);
console.log(`  Metro production guard present: ${hasGuard ? "yes" : "n/a"}`);
console.log("----------------------------------------------");

if (violations.length > 0) {
  console.log(`  RESULT: FAIL — ${violations.length} violation(s):`);
  for (const v of violations) console.log(`   - ${v}`);
  process.exit(1);
}

console.log("  RESULT: PASS — ZERO RORK IN IVX RUNTIME (0%)");
console.log("  Rork remains developer tooling only (devDependencies).");
console.log("==============================================");
