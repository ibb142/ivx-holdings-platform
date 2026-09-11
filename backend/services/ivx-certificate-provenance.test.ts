import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ivx-real-execution-certificate.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function getCertificateForApi(');
const end = source.indexOf('\n}', start) + 2;
const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end).replace('export ', ''));

for (const storedSha of [null, 'a'.repeat(40)]) {
  test(`certificate provenance survives a different expected/runtime SHA (record ${storedSha ? 'present' : 'absent'})`, async () => {
    const cert = storedSha ? { commit_sha: storedSha, passed: true } : null;
    const read = new Function('fetchLatestCertificate', 'enforceRegistryIntegrity', 'commitSha',
      'REAL_EXECUTION_WORKFLOW_ID', 'REAL_EXECUTION_WORKFLOW_NAME', 'IVX_AGENT_RUNTIME_VERSION',
      'WAR_ROOM_POLICY', 'getActiveRunProgress', 'process', code + '\nreturn getCertificateForApi;')(
      async () => ({ data: cert ? [cert] : [] }), () => ({}), () => 'b'.repeat(40),
      'fixture', 'fixture', 'fixture', {}, () => null, { env: { EXPECTED_COMMIT_SHA: 'b'.repeat(40) } });
    const result = await read();
    expect(result.commitSha).toBe(storedSha);
    expect(result.runtimeCommitSha).toBe('b'.repeat(40));
    expect(result.commitMatchesRuntime).toBe(false);
    expect(result.ok).toBe(Boolean(cert));
  });
}
