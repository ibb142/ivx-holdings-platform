import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Validate the committed galleries before publishing any binary asset. */
export function loadGalleryAssets(landingDir) {
  const manifest = JSON.parse(readFileSync(join(landingDir, 'videos/galleries/manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.videos) || !manifest.videos.length) {
    throw new Error('Missing property image-gallery manifest');
  }
  const seen = new Set();
  return manifest.videos.map(video => {
    if (!/^videos\/galleries\/[a-z0-9-]+-[a-f0-9]{12}\.mp4$/.test(video.key)
      || !/^[a-f0-9]{64}$/.test(video.sha256)
      || !video.key.endsWith(`-${video.sha256.slice(0, 12)}.mp4`)
      || video.content_type !== 'video/mp4' || video.asset_type !== 'image_gallery_video'
      || video.recorded_footage !== false || seen.has(video.key)) {
      throw new Error('Invalid property image-gallery identity');
    }
    seen.add(video.key);
    const path = join(landingDir, video.key);
    const body = readFileSync(path);
    if (body.length !== video.bytes || body.toString('ascii', 4, 8) !== 'ftyp'
      || createHash('sha256').update(body).digest('hex') !== video.sha256) {
      throw new Error(`Property image-gallery bytes do not match: ${video.key}`);
    }
    return { path, key: video.key, type: 'video/mp4' };
  });
}
