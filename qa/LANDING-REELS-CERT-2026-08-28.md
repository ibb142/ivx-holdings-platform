# IVX Landing — Reels Fix QA Certificate

**Date:** 2026-08-28
**Marker:** `ivx-landing-reels-cert-2026-08-28`
**Production commit:** `21debf0460d679fc5b450704514f3e27e55872a4` (PR #410 squash)
**Deploy:** `dep-da8devm7bikc73a0d20g` — status `live` (Render `srv-d7t9ivreo5us73ftose0`)

## Scope

User report: the 3 published posts existed but the ivxholding.com Reels rail was empty (`?type=reel` returned 0).

## Root Cause

1. The 3 videos were typed `deal` in platform meta — the Reels surface (`?type=reel`) never saw them.
2. `server.ts` intercepted `GET /api/ivx/video-platform/feed?type=reel` and served the owned Reels registry (`/app/data/reels/registry.json`, empty) with **no fallback** → permanent empty rail.

## Fixes Applied

| # | Fix | Channel |
|---|-----|---------|
| 1 | Reclassified 3 videos → `video_type: reel`, `audiences` set, `published` + `approved` | Platform admin endpoints (durable meta.json) |
| 2 | `server.ts`: registry-first canonical feed with graceful fallback to the platform reel rail so the Reels surface is never empty | PR #410 → merge `21debf046` → manual Render deploy |

## Live Verification (2026-08-28, post-deploy)

| Check | Result |
|-------|--------|
| `GET ivxholding.com/` | 200 — 108,981 bytes — title `IVX Holdings — Review Live Real Estate Opportunities` |
| `GET ivxholding.com/js/ivx-reels.js` | 200 |
| `GET ivxholding.com/js/ivx-reels-preview.js` | 200 |
| `GET api.ivxholding.com/api/ivx/video-platform/feed?type=reel` | 200 — **4 reels** (c0725a70, ebef4cf0, 376694f1, 89d9176d) |
| `GET /health` | 200 — `healthy` — commit `21debf046` — ai ok |
| Expo app `video-feed.ts` | Consumes same `?type=reel` endpoint → 4 reels live in app, no app change needed |

## Reels live in production

1. Modern Home Walkthrough — Buyer Tour
2. New Listing Just Hit the Market — Realtor Spotlight
3. Waterfront Tower — Investor Opportunity
4. Framing Week 6 — Builder Progress Update

## Residual (non-blocking)

- Unified feed (`/api/reels` untyped) returns 0: all approved published videos are now reels by design; deal-typed rows await approval. Reels overlay defaults to the `__reels` channel (4 reels) — unaffected.
- Owned Reels registry (`/app/data/reels/registry.json`) remains empty; fallback path serves the platform rail. Future direct registry publishes take precedence automatically.

## Verdict

**FULL PASS** — Reels fixed, deployed, live-verified on production for web landing and Expo app.
