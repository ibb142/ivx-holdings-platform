import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const EXPO_ROOT = join(__dirname, '..');
const REELS_PATH = join(EXPO_ROOT, 'ivxholding-landing', 'ivx-reels.js');
const LANDING_PATH = join(EXPO_ROOT, 'ivxholding-landing', 'index.html');
const DEPLOY_PATH = join(EXPO_ROOT, 'deploy-s3-direct.mjs');

const reels = readFileSync(REELS_PATH, 'utf8');
const landing = readFileSync(LANDING_PATH, 'utf8');
const deploy = readFileSync(DEPLOY_PATH, 'utf8');

describe('Landing Reels recovery contract', () => {
  it('loads the recovered Reels asset from the public landing', () => {
    expect(landing).toContain('/ivx-reels-landing-e2e-20260818-4.js');
    expect(deploy).toContain("LANDING_DIR + '/ivx-reels.js'");
    expect(deploy).toContain("key: 'ivx-reels-landing-e2e-20260818-4.js'");
  });

  it('uses the certified canonical /api/reels feed and fallback', () => {
    expect(reels).toContain("var u = '/api/reels?limit=6&viewer_id='");
    expect(reels).toContain("u += '&type=reel'");
    expect(reels).toContain("apiFetchJson('/api/reels?limit=6&viewer_id='");
  });

  it('retains API host failover instead of calling the static S3 host as an API', () => {
    expect(reels).toContain("var PROD_API = 'https://api.ivxholding.com'");
    expect(reels).toContain("var RENDER_API = 'https://ivx-holdings-platform.onrender.com'");
    expect(reels).toContain('API_CANDIDATES');
    expect(reels).toContain('all API hosts failed');
    expect(reels).toContain('AbortController');
  });

  it('opens Reels from both the floating launcher and landing navigation', () => {
    expect(reels).toContain("launch.addEventListener('click', openReels)");
    expect(reels).toContain("document.getElementById('navReelsBtn')");
    expect(reels).toContain("navLaunch.addEventListener('click', openReels)");
    expect(reels).toContain('window.IVXOpenReels = openReels');
  });

  it('retains full-screen vertical playback, HLS and deep-link behavior', () => {
    expect(reels).toContain('scroll-snap-type:y mandatory');
    expect(reels).toContain('loadHlsJs');
    expect(reels).toContain('attachSource');
    expect(reels).toContain("qs.get('video')");
    expect(reels).toContain('setTimeout(openReels, 600)');
  });

  it('retains the complete engagement rail', () => {
    expect(reels).toContain('ivxr-act like');
    expect(reels).toContain('ivxr-act cmt');
    expect(reels).toContain('ivxr-act sav');
    expect(reels).toContain('ivxr-act shr');
    expect(reels).toContain('ivxr-act ivxr-follow');
    expect(reels).toContain('ivxr-act rpt');
    expect(reels).toContain("'/api/projects/' + v.id + '/like'");
    expect(reels).toContain("'/api/projects/' + v.id + '/save'");
    expect(reels).toContain("'/api/projects/' + v.id + '/share'");
    expect(reels).toContain("'/api/ivx/video-platform/follow'");
    expect(reels).toContain("'/api/ivx/video-platform/videos/' + v.id + '/report'");
  });

  it('retains deal discovery and invest actions inside Reels', () => {
    expect(reels).toContain('data-r="view-deal"');
    expect(reels).toContain('data-r="invest-now"');
    expect(reels).toContain("cta: 'view_deal'");
    expect(reels).toContain("cta: 'invest_now'");
    expect(reels).toContain("'https://ivxholding.com/invest/' + encodeURIComponent(deal.id)");
  });

  it('retains first-party analytics and watch lifecycle controls', () => {
    expect(reels).toContain("'/api/ivx/video-platform/events'");
    expect(reels).toContain("'view': 'reel_view'");
    expect(reels).toContain("'complete': 'reel_complete'");
    expect(reels).toContain("'share': 'reel_share'");
    expect(reels).toContain("document.addEventListener('visibilitychange'");
    expect(reels).toContain("window.addEventListener('pagehide'");
  });

  it('remains IVX-owned and does not reintroduce Meta runtime credentials', () => {
    expect(reels).not.toContain('graph.facebook.com');
    expect(reels).not.toContain('META_ACCESS_TOKEN');
    expect(reels).not.toContain('META_INSTAGRAM_USER_ID');
  });
});
