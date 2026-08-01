import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  VideoJobStore,
  VideoToolingUnavailableError,
  runVideoPipeline,
  getVideoWorkerCapabilities,
  type ExtractedFrame,
  type MediaToolingStatus,
  type ProbeResult,
  type VideoWorkerDeps,
  type VideoWorkerInput,
} from './ivx-video-worker';

const toolingReady: MediaToolingStatus = {
  ffmpegAvailable: true,
  ffprobeAvailable: true,
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  detail: 'ready',
};

const toolingMissing: MediaToolingStatus = {
  ffmpegAvailable: false,
  ffprobeAvailable: false,
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  detail: 'missing',
};

const probe: ProbeResult = { durationSeconds: 8, width: 1280, height: 720, hasAudio: true };

function makeFrames(n: number): ExtractedFrame[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    timestampSeconds: i + 1,
    base64: 'AAAA',
    mimeType: 'image/jpeg',
  }));
}

function makeDeps(overrides: Partial<VideoWorkerDeps> = {}): VideoWorkerDeps {
  return {
    detectTooling: async () => toolingReady,
    probe: async () => probe,
    extractFrames: async (_s, n) => makeFrames(n),
    extractAudio: async () => new Uint8Array([1, 2, 3]),
    transcribe: async () => ({ text: 'hello world', provider: 'elevenlabs_scribe', languageCode: 'en', durationSeconds: 8 }),
    analyzeFrames: async () => 'The video shows a login flow followed by a dashboard.',
    ...overrides,
  };
}

const input: VideoWorkerInput = {
  source: { localPath: '/tmp/fake.mp4', fileName: 'fake.mp4', mimeType: 'video/mp4' },
  frameCount: 4,
  goal: 'describe',
  transcribe: true,
};

describe('runVideoPipeline', () => {
  it('runs probe -> frames -> transcribe -> analyze and reports stage transitions', async () => {
    const stages: string[] = [];
    const result = await runVideoPipeline(input, makeDeps(), (s) => stages.push(s));
    expect(result.frameCount).toBe(4);
    expect(result.timeline).toHaveLength(4);
    expect(result.transcript?.text).toBe('hello world');
    expect(result.analysis).toContain('dashboard');
    expect(stages).toEqual(['probing', 'extracting_frames', 'transcribing', 'analyzing']);
  });

  it('skips transcription when the video has no audio track', async () => {
    const deps = makeDeps({ probe: async () => ({ ...probe, hasAudio: false }) });
    const result = await runVideoPipeline(input, deps);
    expect(result.transcript).toBeNull();
  });

  it('throws VideoToolingUnavailableError when ffmpeg/ffprobe are missing', async () => {
    const deps = makeDeps({ detectTooling: async () => toolingMissing });
    await expect(runVideoPipeline(input, deps)).rejects.toBeInstanceOf(VideoToolingUnavailableError);
  });

  it('clamps frame count to the bounded maximum', async () => {
    let requested = 0;
    const deps = makeDeps({ extractFrames: async (_s, n) => { requested = n; return makeFrames(n); } });
    await runVideoPipeline({ ...input, frameCount: 9999 }, deps);
    expect(requested).toBe(16);
  });
});

describe('VideoJobStore', () => {
  let store: VideoJobStore;
  const resolver = async (): Promise<VideoWorkerInput> => input;

  beforeEach(() => { store = new VideoJobStore(); });
  afterEach(() => { store.clear(); });

  it('enqueues a queued job scoped to the owner', () => {
    const job = store.enqueue({ ownerUserId: 'owner-1', storagePath: 'p/v.mp4', bucket: 'b' });
    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(0);
    expect(store.list('owner-1')).toHaveLength(1);
    expect(store.list('other')).toHaveLength(0);
  });

  it('completes a job through the full pipeline', async () => {
    const job = store.enqueue({ ownerUserId: 'owner-1', storagePath: 'p/v.mp4' });
    const processed = await store.process(job.id, resolver, makeDeps());
    expect(processed?.status).toBe('completed');
    expect(processed?.attempts).toBe(1);
    expect(processed?.result?.analysis).toContain('dashboard');
    expect(processed?.error).toBeNull();
  });

  it('marks failed with the tooling blocker and disables retry when ffmpeg is missing', async () => {
    const job = store.enqueue({ ownerUserId: 'owner-1', storagePath: 'p/v.mp4' });
    const processed = await store.process(job.id, resolver, makeDeps({ detectTooling: async () => toolingMissing }));
    expect(processed?.status).toBe('failed');
    expect(processed?.blocker).toContain('no ffmpeg');
    expect(processed?.nextRetryAt).toBeNull();
    expect(store.canRetry(job.id)).toBe(false);
  });

  it('schedules a retry on transient failure and succeeds on the next attempt', async () => {
    const job = store.enqueue({ ownerUserId: 'owner-1', storagePath: 'p/v.mp4', maxAttempts: 3 });
    let calls = 0;
    const flaky = makeDeps({
      analyzeFrames: async () => {
        calls += 1;
        if (calls === 1) throw new Error('temporary gateway error');
        return 'recovered analysis';
      },
    });

    const first = await store.process(job.id, resolver, flaky);
    expect(first?.status).toBe('failed');
    expect(first?.attempts).toBe(1);
    expect(first?.error).toContain('temporary gateway error');
    // First retry backoff is 0ms, so retry is immediately allowed.
    expect(store.canRetry(job.id)).toBe(true);

    const second = await store.process(job.id, resolver, flaky);
    expect(second?.status).toBe('completed');
    expect(second?.attempts).toBe(2);
    expect(second?.result?.analysis).toBe('recovered analysis');
  });

  it('stops retrying after maxAttempts is reached', async () => {
    const job = store.enqueue({ ownerUserId: 'owner-1', storagePath: 'p/v.mp4', maxAttempts: 2 });
    const alwaysFails = makeDeps({ analyzeFrames: async () => { throw new Error('persistent failure'); } });

    await store.process(job.id, resolver, alwaysFails); // attempt 1
    const second = await store.process(job.id, resolver, alwaysFails); // attempt 2 == max
    expect(second?.attempts).toBe(2);
    expect(second?.status).toBe('failed');
    expect(second?.nextRetryAt).toBeNull();
    expect(store.canRetry(job.id)).toBe(false);
  });
});

describe('getVideoWorkerCapabilities', () => {
  const prev = {
    eleven: process.env.ELEVENLABS_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    whisper: process.env.WHISPER_API_KEY,
    gateway: process.env.IVX_AI_GATEWAY_KEY,
  };
  afterEach(() => {
    process.env.ELEVENLABS_API_KEY = prev.eleven;
    process.env.OPENAI_API_KEY = prev.openai;
    process.env.WHISPER_API_KEY = prev.whisper;
    process.env.IVX_AI_GATEWAY_KEY = prev.gateway;
  });

  it('always reports upload + retry tracking, and lists concrete remaining runtime dependencies', async () => {
    const caps = await getVideoWorkerCapabilities();
    expect(caps.videoUpload).toBe(true);
    expect(caps.videoMetadataSummary).toBe(true);
    expect(caps.retryStatusTracking).toBe(true);
    // Frame analysis/transcription are gated on real runtime tooling + keys.
    expect(typeof caps.videoFrameAnalysis).toBe('boolean');
    expect(Array.isArray(caps.remainingRuntimeDependencies)).toBe(true);
  });
});
