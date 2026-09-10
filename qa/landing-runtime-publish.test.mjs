import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildLandingRelease, publishLandingRelease } from './landing-runtime-publish.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ivx-landing-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const landing = join(root, 'expo/ivxholding-landing'), images = join(root, 'expo/assets/images');
  mkdirSync(landing, { recursive: true }); mkdirSync(images, { recursive: true });
  for (const name of ['ivx-app.js', 'ivx-reels.js', 'robots.txt', 'sitemap.xml']) writeFileSync(join(landing, name), 'fixture');
  writeFileSync(join(landing, 'index.html'), '<html><head></head><body>__IVX_SUPABASE_URL__ __IVX_SUPABASE_ANON_KEY__</body></html>');
  const binary = Buffer.from([137, 80, 78, 71, 0, 255, 128, 0]);
  writeFileSync(join(landing, 'binary.png'), binary);
  for (const name of ['ivx-logo.png', 'ivx-logo-master.png', 'ivx-symbol.png', 'ivx-og-image.png',
    'favicon.png', 'favicon-16.png', 'favicon-32.png', 'favicon-180.png', 'favicon-192.png']) writeFileSync(join(images, name), binary);
  const env = { GITHUB_SHA: 'a'.repeat(40), EXPO_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fixture', AWS_SECRET_ACCESS_KEY: 'private-aws-fixture',
    IVX_SYSTEM_SECRET: 'private-system-fixture' };
  return { root, landing, binary, env };
}

test('binds all assets to reviewed SHA, preserves binary bytes, and excludes private credentials', t => {
  const f = fixture(t), release = buildLandingRelease(f.root, f.env, f.env.GITHUB_SHA);
  assert.equal(release.uploads.at(-1).Key, 'index.html');
  assert.deepEqual(release.uploads.find(x => x.Key === 'binary.png').Body, f.binary);
  assert.match(release.uploads.at(-1).Body.toString(), new RegExp(`name="ivx-deployment-sha" content="${f.env.GITHUB_SHA}"`));
  for (const upload of release.uploads) {
    assert.equal(upload.Metadata['ivx-source-sha'], f.env.GITHUB_SHA);
    assert.equal(upload.Body.includes('private-aws-fixture'), false);
    assert.equal(upload.Body.includes('private-system-fixture'), false);
  }
});

test('rejects stale source, private Supabase keys and incomplete assets before publication', t => {
  const f = fixture(t);
  assert.throws(() => buildLandingRelease(f.root, f.env, 'b'.repeat(40)), /SHA mismatch/);
  const secretKey = `eyJ.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.fixture`;
  assert.throws(() => buildLandingRelease(f.root, { ...f.env, EXPO_PUBLIC_SUPABASE_ANON_KEY: secretKey }, f.env.GITHUB_SHA), /Only a public/);
  rmSync(join(f.landing, 'ivx-app.js'));
  assert.throws(() => buildLandingRelease(f.root, f.env, f.env.GITHUB_SHA), /Required landing asset/);
});

test('failed dependency prevents entry-page publication and invalidation', async t => {
  const f = fixture(t), release = buildLandingRelease(f.root, f.env, f.env.GITHUB_SHA), calls = [];
  await assert.rejects(publishLandingRelease(release, {
    put: async item => { calls.push(item.Key); if (item.Key === 'ivx-app.js') throw new Error('S3 denied'); },
    invalidate: async () => { calls.push('invalidation'); },
  }), /S3 denied/);
  assert.equal(calls.includes('index.html'), false);
  assert.equal(calls.includes('invalidation'), false);
});

test('certification requires completed invalidation after all uploads', async t => {
  const f = fixture(t), release = buildLandingRelease(f.root, f.env, f.env.GITHUB_SHA);
  await assert.rejects(publishLandingRelease(release, { put: async () => {}, invalidate: async () => ({ id: 'I1', status: 'InProgress' }) }), /not complete/);
  let uploaded = 0;
  const proof = await publishLandingRelease(release, { put: async () => { uploaded++; }, invalidate: async () => {
    assert.equal(uploaded, release.uploads.length); return { id: 'I1', status: 'Completed' };
  } });
  assert.equal(proof.sourceCommitSha, f.env.GITHUB_SHA);
  assert.equal(proof.invalidationStatus, 'Completed');
});
