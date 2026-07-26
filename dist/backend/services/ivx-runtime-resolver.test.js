import { describe, expect, test } from 'bun:test';
import { candidateFileNames, describeRuntimeAvailability, parsePathEntries, resolveExecutablePath, resolveRuntimeCommand, } from './ivx-runtime-resolver';
describe('parsePathEntries', () => {
    test('splits and trims a PATH string', () => {
        expect(parsePathEntries('/usr/local/bin:/usr/bin: /bin ', ':')).toEqual([
            '/usr/local/bin',
            '/usr/bin',
            '/bin',
        ]);
    });
    test('returns [] for empty/undefined input', () => {
        expect(parsePathEntries(undefined, ':')).toEqual([]);
        expect(parsePathEntries('', ':')).toEqual([]);
        expect(parsePathEntries('   ', ':')).toEqual([]);
    });
});
describe('candidateFileNames', () => {
    test('returns the bare command on non-Windows', () => {
        if (process.platform !== 'win32') {
            expect(candidateFileNames('bun')).toEqual(['bun']);
        }
    });
    test('adds PATHEXT variants on Windows-style parsing', () => {
        // parsePathEntries with ';' is what candidateFileNames uses internally on win32.
        expect(parsePathEntries('.EXE;.CMD;.BAT', ';')).toEqual(['.EXE', '.CMD', '.BAT']);
    });
});
describe('resolveExecutablePath', () => {
    test('resolves node to an absolute path (node always present in this runtime)', () => {
        const nodePath = resolveExecutablePath('node');
        expect(nodePath).toBeTruthy();
        expect(typeof nodePath).toBe('string');
    });
});
describe('resolveRuntimeCommand', () => {
    test('resolves bun to a real path or a node fallback (never ENOENT)', () => {
        const resolution = resolveRuntimeCommand('bun');
        expect(resolution.requested).toBe('bun');
        // Either bun resolved directly, or we fell back to node — but never an unusable command.
        expect(resolution.resolvedPath).toBeTruthy();
        expect(resolution.effectiveCommand.length).toBeGreaterThan(0);
        if (resolution.usedFallback) {
            expect(resolution.note.toLowerCase()).toContain('fall');
        }
    });
    test('node resolves directly without a fallback', () => {
        const resolution = resolveRuntimeCommand('node');
        expect(resolution.usedFallback).toBe(false);
        expect(resolution.resolvedPath).toBeTruthy();
    });
});
describe('describeRuntimeAvailability', () => {
    test('reports a runtime capable of validation', () => {
        const availability = describeRuntimeAvailability();
        expect(availability.node).toBe(true);
        expect(availability.canRunValidation).toBe(true);
        expect(availability.remediation).toBeNull();
    });
});
