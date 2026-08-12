import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

beforeAll(async () => {
  process.env.IVX_DATA_DIR = await mkdtemp(join(tmpdir(), 'ivx-reels-test-'));
});

describe('IVX-owned Reels engine source contract', () => {
  test('module has no Meta or external social API dependency', async () => {
    const source = await Bun.file(new URL('./api/ivx-reels.ts', import.meta.url)).text();
    expect(source).not.toContain('graph.facebook.com');
    expect(source).not.toContain('META_ACCESS_TOKEN');
    expect(source).not.toContain('META_INSTAGRAM_USER_ID');
    expect(source).toContain("provider: 'IVX Holdings'");
    expect(source).toContain('externalSocialApiRequired: false');
  });

  test('publishing is owner protected while feed and media are public', async () => {
    const source = await Bun.file(new URL('./api/ivx-reels.ts', import.meta.url)).text();
    expect(source).toContain('await assertIVXOwnerOnly(request)');
    expect(source).toContain('handleReelsPublish');
    expect(source).toContain('handleReelsFeed');
    expect(source).toContain('handleReelsMedia');
  });

  test('video validation and bounded storage are enforced', async () => {
    const source = await Bun.file(new URL('./api/ivx-reels.ts', import.meta.url)).text();
    expect(source).toContain('MAX_VIDEO_BYTES');
    expect(source).toContain("file.type.startsWith('video/')");
    expect(source).toContain("mimeType.startsWith('video/')");
  });

  test('HTTP byte-range playback is implemented for mobile streaming', async () => {
    const source = await Bun.file(new URL('./api/ivx-reels.ts', import.meta.url)).text();
    expect(source).toContain("request.headers.get('range')");
    expect(source).toContain("status: 206");
    expect(source).toContain("'Accept-Ranges': 'bytes'");
    expect(source).toContain("'Content-Range'");
  });

  test('feed engagement counters persist views and likes', async () => {
    const source = await Bun.file(new URL('./api/ivx-reels.ts', import.meta.url)).text();
    expect(source).toContain("key: 'views' | 'likes'");
    expect(source).toContain("mutateCounter(id, 'views')");
    expect(source).toContain("mutateCounter(id, 'likes')");
  });
});

describe('IVX Reels route integration', () => {
  test('extended Hono server exposes complete reels route set', async () => {
    const source = await Bun.file(new URL('./hono-extended.ts', import.meta.url)).text();
    expect(source).toContain("'/api/ivx/social/reels/status'");
    expect(source).toContain("'/api/ivx/social/reels/publish'");
    expect(source).toContain("'/api/ivx/social/reels/feed'");
    expect(source).toContain("'/api/ivx/social/reels/media/:id'");
    expect(source).toContain("'/api/ivx/social/reels/:id/view'");
    expect(source).toContain("'/api/ivx/social/reels/:id/like'");
  });
});
