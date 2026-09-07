import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('real execution certificate boot recovery', () => {
  it('wires durable pending-run recovery into the API bootstrap', () => {
    const source = readFileSync(join(import.meta.dir, 'hono.ts'), 'utf8');

    expect(source).toContain("import { resumePendingCertificateRuns } from './services/ivx-real-execution-certificate';");
    expect(source).toContain('export const certificateBootRecovery = resumePendingCertificateRuns()');
    expect(source).toContain('[IVXRealExecutionCert] boot recovery complete');
    expect(source).toContain('void certificateBootRecovery.finally(() => {');
    expect(source.indexOf('export const certificateBootRecovery = resumePendingCertificateRuns()')).toBeLessThan(source.indexOf('void certificateBootRecovery.finally'));

    const service = readFileSync(join(import.meta.dir, 'services/ivx-real-execution-certificate.ts'), 'utf8');
    expect(service).toContain('await Promise.all(processing)');

    const server = readFileSync(join(import.meta.dir, '../server.ts'), 'utf8');
    expect(server).toContain("import app, { certificateBootRecovery } from './backend/hono-extended';");
    expect(server.indexOf('void certificateBootRecovery.finally')).toBeLessThan(server.indexOf('startAutonomous112RuntimeEnforcer()'));

    const runtime = readFileSync(join(import.meta.dir, 'services/ivx-agent-runtime.ts'), 'utf8');
    expect(runtime).toContain('const endISO = new Date(endTime).toISOString();');
    expect(runtime).not.toContain('const endISO = isoSecondPrecision(new Date(endTime));');
  });
});
