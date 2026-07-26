/**
 * IVX Runtime Resolver
 *
 * Fixes the `spawn bun ENOENT` blocker. The senior-developer validation runner
 * spawned the bare command name `bun`/`bunx`, which throws ENOENT whenever the
 * process can't resolve it on PATH — notably the deployed backend container
 * (`node:20-alpine`), where bun is NOT installed and the app runs on node/tsx.
 *
 * This module resolves an ABSOLUTE path for a runtime by checking, in order:
 *   1. the current interpreter (`process.execPath`) when its name matches,
 *   2. every directory on `PATH` (respecting PATHEXT on Windows),
 *   3. well-known install locations (`~/.bun/bin`, `/usr/local/bin`, ...).
 *
 * When bun is unavailable it returns a node-based fallback so test/validation
 * commands still run in production instead of dying with an opaque ENOENT, and
 * `describeRuntimeAvailability()` reports the exact remediation.
 *
 * The path-list parsing helpers are pure so they can be unit-tested anywhere.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const WELL_KNOWN_DIRS = () => {
    const home = os.homedir();
    return [
        path.join(home, '.bun', 'bin'),
        '/usr/local/bin',
        '/usr/bin',
        '/opt/homebrew/bin',
        path.join(home, '.local', 'bin'),
    ];
};
/** Split a raw PATH-style string into clean directory entries. Pure + testable. */
export function parsePathEntries(rawPath, delimiter = path.delimiter) {
    if (!rawPath)
        return [];
    return rawPath
        .split(delimiter)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}
/** Candidate filenames for a command, accounting for Windows PATHEXT. Pure + testable. */
export function candidateFileNames(command, pathExt = process.env.PATHEXT) {
    if (process.platform !== 'win32')
        return [command];
    const exts = parsePathEntries(pathExt ?? '.EXE;.CMD;.BAT;.COM', ';').map((ext) => ext.toLowerCase());
    const hasExt = exts.some((ext) => command.toLowerCase().endsWith(ext));
    if (hasExt)
        return [command];
    return [command, ...exts.map((ext) => `${command}${ext}`)];
}
function isExecutableFile(candidate) {
    try {
        return existsSync(candidate) && statSync(candidate).isFile();
    }
    catch {
        return false;
    }
}
/**
 * Resolve an absolute executable path for `command`, or null when it can't be
 * found. Honors the current interpreter, PATH, and well-known install dirs.
 */
export function resolveExecutablePath(command) {
    // 1. Current interpreter (e.g. running under bun → process.execPath is bun).
    const execName = path.basename(process.execPath).toLowerCase();
    if (execName === command || execName === `${command}.exe`) {
        if (isExecutableFile(process.execPath))
            return process.execPath;
    }
    // 2. PATH directories, then 3. well-known dirs.
    const searchDirs = [...parsePathEntries(process.env.PATH), ...WELL_KNOWN_DIRS()];
    const seen = new Set();
    for (const dir of searchDirs) {
        if (seen.has(dir))
            continue;
        seen.add(dir);
        for (const fileName of candidateFileNames(command)) {
            const candidate = path.join(dir, fileName);
            if (isExecutableFile(candidate))
                return candidate;
        }
    }
    return null;
}
/**
 * Resolve a runtime command, falling back to a node-based equivalent when the
 * requested runtime (bun/bunx) is missing — so validation/tests keep working in
 * the node-only production container instead of throwing ENOENT.
 */
export function resolveRuntimeCommand(requested) {
    const directPath = resolveExecutablePath(requested);
    if (directPath) {
        return {
            requested,
            resolvedPath: directPath,
            effectiveCommand: directPath,
            usedFallback: false,
            note: `Resolved ${requested} at ${directPath}.`,
        };
    }
    // Fallbacks when the requested runtime isn't installed.
    if (requested === 'bun') {
        const node = resolveExecutablePath('node');
        if (node) {
            return {
                requested,
                resolvedPath: node,
                effectiveCommand: node,
                usedFallback: true,
                note: 'bun not found on PATH; falling back to node (use node --test for *.test.ts that do not require the bun:test runtime).',
            };
        }
    }
    if (requested === 'bunx') {
        const npx = resolveExecutablePath('npx');
        if (npx) {
            return {
                requested,
                resolvedPath: npx,
                effectiveCommand: npx,
                usedFallback: true,
                note: 'bunx not found on PATH; falling back to npx.',
            };
        }
    }
    return {
        requested,
        resolvedPath: null,
        effectiveCommand: requested,
        usedFallback: false,
        note: `${requested} could not be resolved on PATH or well-known install locations, and no node-based fallback is available. Install ${requested} or run the equivalent node command.`,
    };
}
/** Report which runtimes exist, with an exact remediation when none can validate. */
export function describeRuntimeAvailability() {
    const bun = resolveExecutablePath('bun') !== null;
    const bunx = resolveExecutablePath('bunx') !== null;
    const node = resolveExecutablePath('node') !== null;
    const npx = resolveExecutablePath('npx') !== null;
    const canRunValidation = bun || node;
    return {
        bun,
        bunx,
        node,
        npx,
        canRunValidation,
        remediation: canRunValidation
            ? null
            : 'No bun or node runtime found. Install bun (https://bun.sh) or ensure node is on PATH so validation/tests can run.',
    };
}
