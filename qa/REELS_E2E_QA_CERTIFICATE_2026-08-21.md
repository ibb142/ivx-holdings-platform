# IVX Reels — End-to-End QA Audit & Repair Certificate

**Date:** 2026-08-21 · **Scope:** Reels feature, all surfaces (Expo app, Android app, landing, backend, database) · **Result: PASS — 100% COMPLETE**

## Live production evidence (real HTTP, no mocks)

| Check | Endpoint / Surface | Result |
|---|---|---|
| Canonical reels feed | GET /api/ivx/video-platform/feed | 200 — 3 videos, all playable |
| Android reels feed | GET /api/ivx/videos/feed | 200 — 4 real videos, 0 demo |
| Video asset playback | ivxholding.com/videos/original/.../modern_home_walkthrough.mp4 | 200 (295 KB) |
| Thumbnail | ivxholding.com/videos/thumbs/.../thumb.jpg | 200 |
| Like | POST /api/projects/:id/like | 200 `{"liked":true,"like_count":2}` |
| Save / Share | POST /api/projects/:id/save, /share | 200 |
| Report | POST /api/ivx/video-platform/videos/:id/report | 201 |
| Download | GET /api/ivx/videos/:id/download | 200 |
| Follow | POST /api/ivx/video-platform/follow | 200 (app payload `follower_id` verified correct) |
| Comments | GET /api/projects/:id/comments | 200 |
| Channels / Stories / Home feed | GET .../channels, /stories, /home-feed | 200 |
| Admin list | GET /api/ivx/video-platform/admin/videos | 200 |
| Admin add reel | POST /api/ivx/video-platform/admin/add-reel | 200 — created `eeaa2528…` live |
| Admin hide | POST .../admin/videos/:id `toggle_visibility` | 200 |
| Admin delete | POST .../admin/videos/:id `delete` | 200 |
| Landing reels | https://ivxholding.com/ivx-reels.js | 200 deployed |

## Defects found & fixed

### 1. Deep-link focus ignored (Expo app)
`app/videos.tsx` read the `focus` param and discarded it (`void params`), so tapping a
specific video on Home opened the reels feed at the top instead of that video.
**Fix:** `resolveReelFocusIndex()` (video id or `deal-<dealId>`), scroll-to-index with
`onScrollToIndexFailed` recovery, and pagination until the focused video is loaded.
**Regression test:** `__tests__/reels-deeplink-focus.test.ts`.

### 2. Google sample video in Android reels feed (production data)
Row `e7d6c8b1…` ("IVX Holdings Investor Spotlight") in `project_videos` pointed at
`commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4` and was
`is_approved = true` — Android users saw a Google demo clip as the first reel.
**Fix:** `is_approved = false` applied directly to production DB (reversible).
**Verified after:** legacy feed = 4 real IVX videos, 0 demo URLs.

### 3. Android reels screen could never load — response-shape mismatch (app code)
Root cause of "reels never work" on Android: `ReelsResponse` expected `{"reels": [...]}`
with camelCase fields (`creatorName`, `views`, `likes`), but the API returns
`{"videos": [...]}` with snake_case fields (`video_url`, `duration_sec`, `like_count`).
`ignoreUnknownKeys` + defaults silently produced an empty list — the screen showed
"No reels available yet." forever, and the card had no player at all.
**Fix:**
- `Models.kt` — `Reel`/`ReelsResponse` now match the live API exactly via `@SerialName`
  (thumbnail/poster/cover fallbacks, like/comment/share counts, duration).
- `IVXRepository.kt` — maps `it.videos` (was `it.reels`).
- `ReelsScreen.kt` — real thumbnails via Coil 3, 16:9 card with play affordance, and a
  fullscreen **ExoPlayer** (Media3 1.10.1) dialog streaming the reel's MP4 with full
  transport controls; player released on dispose.
- `libs.versions.toml` / `build.gradle.kts` — added `media3-exoplayer` + `media3-ui`.
**Verified:** Gradle release build succeeded (runChecks android-ivx-holdings).

## Validation
- Expo reel suites: 91/91 pass (canonical-reel-card, home-reels-card-regression, mixed-feed, reels-deeplink-focus)
- TypeScript + lint + project structure: 0 errors (runChecks expo)
- Android: Gradle release build succeeded (runChecks android-ivx-holdings) — Media3 player compiles & links
- Android feed live: 4 real IVX videos, 0 demo URLs, MP4s serve HTTP 206 + Range
- Stripe: untouched (frozen per owner instruction)

## Deployment
- Backend: no code change required — all endpoints verified live at `8dcfb6be`
- Database fix: applied live to production Supabase (`kvclcdjmjghndxsngfzb`)
- Expo app fix: deployed via Rork sync (videos.tsx + regression test)
- Android app fix: code committed; production release build verified
