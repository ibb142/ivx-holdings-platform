import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { resolveMediaProvenance, isMediaLabel, MEDIA_LABELS } from './ivx-media-labels';
import { selectMediaProvider, estimateMediaCostUsd, listMediaProviderSelections } from './ivx-media-providers';
import { generateIVXImage } from './ivx-image-generation';
import { understandIVXVideo, buildVideoTimeline } from './ivx-video-understanding';
import { buildMultimodalStackReport } from './ivx-multimodal-stack';
import { generateIVX3DModel, buildProceduralPreview } from './ivx-model3d-generation';
import { MEDIA_EVIDENCE_LABELS } from './ivx-media-labels';

describe('media labels', () => {
  it('labels prompt-only output GENERATED with a synthetic disclaimer', () => {
    const p = resolveMediaProvenance({ kind: 'image', sourceImageCount: 0 });
    expect(p.label).toBe(MEDIA_LABELS.GENERATED);
    expect(p.isSynthetic).toBe(true);
    expect(p.disclaimer).toContain('Not a real photograph');
  });

  it('labels source+edit EDITED and source-only REFERENCE_BASED', () => {
    expect(resolveMediaProvenance({ kind: 'image', sourceImageCount: 2, edited: true }).label).toBe(MEDIA_LABELS.EDITED);
    expect(resolveMediaProvenance({ kind: 'model3d', sourceImageCount: 1 }).label).toBe(MEDIA_LABELS.REFERENCE_BASED);
  });

  it('labels understanding ANALYZED with no disclaimer and not synthetic', () => {
    const p = resolveMediaProvenance({ kind: 'analysis' });
    expect(p.label).toBe(MEDIA_LABELS.ANALYZED);
    expect(p.isSynthetic).toBe(false);
    expect(p.disclaimer).toBeNull();
  });

  it('isMediaLabel guards the four canonical labels', () => {
    expect(isMediaLabel('GENERATED')).toBe(true);
    expect(isMediaLabel('NONSENSE')).toBe(false);
  });
});

describe('media providers + cost', () => {
  it('selects a concrete provider per capability', () => {
    expect(selectMediaProvider('image_generation').modelId).toBe('openai/gpt-image-2');
    expect(selectMediaProvider('image_understanding').authSource).toBe('IVX_AI_GATEWAY_KEY');
    // No owner 3D key in the test env -> procedural fallback, never a Rork toolkit secret.
    expect(selectMediaProvider('model3d_generation').authSource).toBe('PROCEDURAL');
    expect(listMediaProviderSelections()).toHaveLength(4);
  });

  it('estimates USD cost linearly and returns null for credit-metered 3D', () => {
    const one = estimateMediaCostUsd('image_generation', 1) ?? 0;
    const five = estimateMediaCostUsd('image_generation', 5) ?? 0;
    expect(five).toBeCloseTo(one * 5, 6);
    expect(estimateMediaCostUsd('model3d_generation', 3)).toBeNull();
  });
});

describe('image generation (injected gateway)', () => {
  let prevKey: string | undefined;
  beforeAll(() => {
    prevKey = process.env.IVX_AI_GATEWAY_KEY;
    process.env.IVX_AI_GATEWAY_KEY = 'test-key';
  });
  afterAll(() => {
    if (prevKey === undefined) delete process.env.IVX_AI_GATEWAY_KEY;
    else process.env.IVX_AI_GATEWAY_KEY = prevKey;
  });

  it('returns GENERATED images on success', async () => {
    const result = await generateIVXImage(
      { prompt: 'A clean app mockup' },
      async () => [{ base64: 'AAAA', mediaType: 'image/png' }],
    );
    expect(result.ok).toBe(true);
    expect(result.images).toHaveLength(1);
    expect(result.provenance.label).toBe(MEDIA_LABELS.GENERATED);
    expect(result.provider.modelId).toBe('openai/gpt-image-2');
  });

  it('switches to an image LLM + REFERENCE_BASED label when sources are provided', async () => {
    const result = await generateIVXImage(
      { prompt: 'Restyle this room', sourceImages: ['https://x/y.png'] },
      async (input) => {
        expect(input.modelId).toContain('gemini');
        return [{ base64: 'BBBB', mediaType: 'image/png' }];
      },
    );
    expect(result.ok).toBe(true);
    expect(result.provenance.label).toBe(MEDIA_LABELS.REFERENCE_BASED);
  });

  it('fails honestly on empty prompt without calling the gateway', async () => {
    let called = false;
    const result = await generateIVXImage({ prompt: '   ' }, async () => {
      called = true;
      return [];
    });
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
    expect(result.error).toContain('prompt is required');
  });

  it('surfaces the gateway error without throwing', async () => {
    const result = await generateIVXImage({ prompt: 'x' }, async () => {
      throw new Error('gateway 500');
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('gateway 500');
  });
});

describe('video understanding (injected analyzer)', () => {
  it('orders frames by timestamp then input order', () => {
    const { timeline } = buildVideoTimeline([
      { url: 'c', timestampSeconds: 3 },
      { url: 'a', timestampSeconds: 1 },
      { url: 'untimed' },
    ]);
    expect(timeline.map((t) => t.url)).toEqual(['a', 'c', 'untimed']);
  });

  it('analyzes frames as a timeline and labels output ANALYZED', async () => {
    const result = await understandIVXVideo(
      { frames: [{ url: 'f0', timestampSeconds: 0 }, { url: 'f1', timestampSeconds: 1 }], goal: 'bug_detection' },
      async ({ frames, instruction }) => {
        expect(frames).toHaveLength(2);
        expect(instruction).toContain('visual bugs');
        return 'Frame 1 shows a broken layout.';
      },
    );
    expect(result.ok).toBe(true);
    expect(result.frameCount).toBe(2);
    expect(result.provenance.label).toBe(MEDIA_LABELS.ANALYZED);
  });

  it('returns the ffmpeg/server-extraction blocker when no frames are provided', async () => {
    const result = await understandIVXVideo({ frames: [] }, async () => 'unused');
    expect(result.ok).toBe(false);
    expect(result.blocker).toContain('no ffmpeg');
  });
});

describe('multimodal stack report', () => {
  it('reports image capabilities COMPLETE when the gateway key is set and 3D BLOCKED (procedural) without an owner 3D key', () => {
    const prevGateway = process.env.IVX_AI_GATEWAY_KEY;
    const prevMeshy = process.env.MESHY_API_KEY;
    const prevTripo = process.env.TRIPO_API_KEY;
    process.env.IVX_AI_GATEWAY_KEY = 'test-key';
    delete process.env.MESHY_API_KEY;
    delete process.env.TRIPO_API_KEY;
    try {
      const report = buildMultimodalStackReport();
      const byId = Object.fromEntries(report.capabilities.map((c) => [c.id, c]));
      expect(byId.image_understanding.status).toBe('COMPLETE');
      expect(byId.image_generation.status).toBe('COMPLETE');
      expect(byId.video_understanding.status).toBe('COMPLETE');
      expect(byId.model3d_generation.status).toBe('BLOCKED');
      // Owner-controlled dependency only — never a Rork toolkit secret.
      expect(byId.model3d_generation.blocker?.dependency).toContain('MESHY_API_KEY');
      expect(byId.model3d_generation.blocker?.dependency).not.toContain('RORK');
      expect(report.labels).toContain('GENERATED');
      expect(report.labels).toContain('GENERATED_3D');
      expect(report.labels).toContain('PROCEDURAL_PREVIEW');
      expect(report.summary.total).toBe(4);
    } finally {
      if (prevGateway === undefined) delete process.env.IVX_AI_GATEWAY_KEY;
      else process.env.IVX_AI_GATEWAY_KEY = prevGateway;
      if (prevMeshy === undefined) delete process.env.MESHY_API_KEY;
      else process.env.MESHY_API_KEY = prevMeshy;
      if (prevTripo === undefined) delete process.env.TRIPO_API_KEY;
      else process.env.TRIPO_API_KEY = prevTripo;
    }
  });
});

describe('owner-controlled 3D generation (no Rork toolkit)', () => {
  it('returns a deterministic PROCEDURAL_PREVIEW when no owner 3D key is set', async () => {
    const prevMeshy = process.env.MESHY_API_KEY;
    const prevTripo = process.env.TRIPO_API_KEY;
    delete process.env.MESHY_API_KEY;
    delete process.env.TRIPO_API_KEY;
    try {
      const result = await generateIVX3DModel({ prompt: 'A modern villa' });
      expect(result.ok).toBe(true);
      expect(result.label).toBe(MEDIA_EVIDENCE_LABELS.PROCEDURAL_PREVIEW);
      expect(result.provider.authSource).toBe('PROCEDURAL');
      expect(result.proceduralPreview?.objects.length).toBeGreaterThan(0);
      expect(result.blocker?.dependency).toContain('MESHY_API_KEY');
      // Deterministic for the same prompt.
      expect(buildProceduralPreview('A modern villa')).toEqual(buildProceduralPreview('A modern villa'));
    } finally {
      if (prevMeshy === undefined) delete process.env.MESHY_API_KEY;
      else process.env.MESHY_API_KEY = prevMeshy;
      if (prevTripo === undefined) delete process.env.TRIPO_API_KEY;
      else process.env.TRIPO_API_KEY = prevTripo;
    }
  });

  it('returns GENERATED_3D via the owner Meshy key + injected submitter', async () => {
    const prevMeshy = process.env.MESHY_API_KEY;
    process.env.MESHY_API_KEY = 'owner-meshy-key';
    try {
      const result = await generateIVX3DModel({ prompt: 'A product render' }, async (input) => {
        expect(input.provider).toBe('meshy');
        expect(input.apiKey).toBe('owner-meshy-key');
        return { taskId: 'meshy-task-123', modelUrl: null };
      });
      expect(result.ok).toBe(true);
      expect(result.label).toBe(MEDIA_EVIDENCE_LABELS.GENERATED_3D);
      expect(result.provider.authSource).toBe('MESHY_API_KEY');
      expect(result.submission?.taskId).toBe('meshy-task-123');
    } finally {
      if (prevMeshy === undefined) delete process.env.MESHY_API_KEY;
      else process.env.MESHY_API_KEY = prevMeshy;
    }
  });

  it('fails honestly with no prompt and no source image', async () => {
    const result = await generateIVX3DModel({ prompt: '   ' });
    expect(result.ok).toBe(false);
    expect(result.label).toBe(MEDIA_EVIDENCE_LABELS.BLOCKED_MISSING_PROVIDER_KEY);
    expect(result.error).toContain('required');
  });
});
