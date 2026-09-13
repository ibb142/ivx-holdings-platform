-- Execute only after the two public HTTPS objects pass MIME, checksum and
-- playback verification against videos/galleries/manifest.json.
-- These assets are labelled image galleries, not recorded property tours.
BEGIN;
SET LOCAL statement_timeout = '3s';
SET LOCAL lock_timeout = '1s';
WITH assets(id, project_id, video_url, thumbnail_url, caption, storage_path) AS (
 VALUES
  ('bcf9efc3-9169-5e55-b45f-938b69f6f42f', 'perez-residence-001', 'https://ivxholding.com/videos/galleries/perez-residence-001-image-gallery-a1a53ddf1daf.mp4', 'https://kvclcdjmjghndxsngfzb.supabase.co/storage/v1/object/public/deal-photos/perez-residence-001/1774308382162-yoirw1-1.jpg', 'PEREZ RESIDENCE — Galería de imágenes / Image gallery', 'videos/galleries/perez-residence-001-image-gallery-a1a53ddf1daf.mp4'),
  ('cada42dc-9edb-5b15-870d-d597991b42d8', 'JV-202603-5190', 'https://ivxholding.com/videos/galleries/jv-202603-5190-image-gallery-10e0aab9c516.mp4', 'https://kvclcdjmjghndxsngfzb.supabase.co/storage/v1/object/public/deal-photos/JV-202603-5190/1774317801683-pqr6cl-0.jpg', 'IVX JACKSONVILLE PRIME — Galería de imágenes / Image gallery', 'videos/galleries/jv-202603-5190-image-gallery-10e0aab9c516.mp4')
)
INSERT INTO public.jv_deal_reels
  (id, project_id, video_url, thumbnail_url, caption, storage_path,
   published, approved, visibility, is_global, reel_type, category_tags)
SELECT a.id::uuid, a.project_id, a.video_url, a.thumbnail_url, a.caption, a.storage_path,
       true, true, 'public', false, 'jv', ARRAY['image_gallery', 'published_project_images']
FROM assets a
JOIN public.jv_deals d ON d.id = a.project_id AND d.published = true
WHERE NOT EXISTS (
  SELECT 1 FROM public.jv_deal_reels r
  WHERE r.project_id = a.project_id AND r.video_url = a.video_url
)
ON CONFLICT (id) DO NOTHING
RETURNING id, project_id, video_url, caption;

-- /api/projects/:slug/media uses the canonical UUID mapping maintained in
-- backend/api/ivx-project-engagement.ts. Register the same verified binaries
-- there so property-card video slides and the public deals API agree.
WITH assets(id, deal_id, project_id, title, video_url, thumbnail_url, duration_sec, file_size_bytes) AS (
 VALUES
  ('bcf9efc3-9169-5e55-b45f-938b69f6f42f', 'perez-residence-001', 'a1e52b77-3c04-4b58-9a41-7f2d8c6e1b90', 'PEREZ RESIDENCE — Galería de imágenes / Image gallery', 'https://ivxholding.com/videos/galleries/perez-residence-001-image-gallery-a1a53ddf1daf.mp4', 'https://kvclcdjmjghndxsngfzb.supabase.co/storage/v1/object/public/deal-photos/perez-residence-001/1774308382162-yoirw1-1.jpg', 24, 877248),
  ('cada42dc-9edb-5b15-870d-d597991b42d8', 'JV-202603-5190', 'b7c93d21-58f6-4e0a-8d12-4a9e3f7c2d55', 'IVX JACKSONVILLE PRIME — Galería de imágenes / Image gallery', 'https://ivxholding.com/videos/galleries/jv-202603-5190-image-gallery-10e0aab9c516.mp4', 'https://kvclcdjmjghndxsngfzb.supabase.co/storage/v1/object/public/deal-photos/JV-202603-5190/1774317801683-pqr6cl-0.jpg', 27, 830631)
)
INSERT INTO public.project_videos
  (id, project_id, title, video_url, thumbnail_url, cover_url, duration_sec,
   width, height, orientation, file_size_bytes, mime_type, is_pinned, is_approved, video_type)
SELECT a.id::uuid, a.project_id::uuid, a.title, a.video_url, a.thumbnail_url, a.thumbnail_url,
       a.duration_sec, 1280, 720, 'landscape', a.file_size_bytes, 'video/mp4', false, true, 'deal'
FROM assets a
JOIN public.jv_deals d ON d.id = a.deal_id AND d.published = true
WHERE NOT EXISTS (
  SELECT 1 FROM public.project_videos v
  WHERE v.project_id = a.project_id::uuid AND v.video_url = a.video_url
)
ON CONFLICT (id) DO NOTHING
RETURNING id, project_id, video_url, title;
COMMIT;
