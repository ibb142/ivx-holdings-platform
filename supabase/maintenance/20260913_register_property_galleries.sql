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
COMMIT;
