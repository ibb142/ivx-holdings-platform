import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('real execution certificate boot recovery', () => {
  it('wires durable pending-run recovery into the API bootstrap', () => {
    const source = readFileSync(join(import.meta.dir, 'hono.ts'), 'utf8');

    expect(source).toContain("import { resumePendingCertificateRuns } from './services/ivx-real-execution-certificate';");
    expect(source).toContain('const certificateBootRecovery = resumePendingCertificateRuns()');
    expect(source).toContain('[IVXRealExecutionCert] boot recovery complete');
    expect(source).toContain('void certificateBootRecovery.finally(() => {');
    expect(source.indexOf('const certificateBootRecovery = resumePendingCertificateRuns()')).toBeLessThan(source.indexOf('void certificateBootRecovery.finally'));

    const service = readFileSync(join(import.meta.dir, 'services/ivx-real-execution-certificate.ts'), 'utf8');
    expect(service).toContain('await Promise.all(processing)');
  });
});
