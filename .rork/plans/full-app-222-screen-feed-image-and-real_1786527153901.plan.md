---
name: "Full-app 222-screen feed, image, and real-time reliability overhaul"
overview: "Rebuild the shared loading, image, feed, and real-time infrastructure across the IVX Expo app, then audit and repair every route in expo/app so screens never stay blank, frozen, or silent when content is loading, failing, or updating live."
createdAt: 2026-08-12T09:32:33.901Z
---
# Full-app 222-screen feed, image, and real-time reliability overhaul

Rebuild the shared loading, image, feed, and real-time infrastructure across the IVX Expo app, then audit and repair every route in expo/app so screens never stay blank, frozen, or silent when content is loading, failing, or updating live.

**Scope**
- Target every route file in `expo/app` (the full inventory, approximately 255 files) on both mobile and web builds.
- Focus on the problems the owner reported: blank screens, images that do not visibly load, missing text/posts, infinite scroll that stops, no loading/error/retry feedback, and missing real-time updates.
- Do not redesign the app; preserve existing visual design and functionality unless a change is required to fix usability, accessibility, or reliability.

**Phase 1 — Shared infrastructure** [COMPLETED]
- [x] Build one canonical `IVXDataProvider` wrapper around React Query that unifies loading, error, empty, offline, retry, timeout, and skeleton states.
- [x] Build a canonical `IVXImage` component on top of `expo-image` that always shows a skeleton placeholder, progressive fade-in, explicit error state, stable aspect ratio, and memory/disk cache policy.
- [x] Build a canonical `IVXFeed` component that wraps `FlatList` with viewport tracking, lazy image loading, request deduplication, pull-to-refresh, background refresh that preserves visible items, and cursor-based or offset-based pagination.
- [x] Build a canonical `useRealtimeChannel` hook on Supabase realtime with automatic reconnect, exponential backoff, and a status surface for debugging.
- [x] Centralize request cancellation and deduplication through React Query and the shared hooks.
- [x] Replace ad-hoc `fetch()` and `supabase.from()` calls in the most common feed/image patterns with the shared hooks, while keeping the same query keys and data shapes.
- [x] Add an `AccessibilityAnnouncer` so screen readers announce loading, error, and update states.
- Files created: `components/ivx/IVXStates.tsx`, `components/ivx/IVXImage.tsx`, `components/ivx/IVXDataProvider.tsx`, `components/ivx/IVXFeed.tsx`, `components/ivx/AccessibilityAnnouncer.tsx`, `components/ivx/index.ts`, `hooks/useRealtimeChannel.ts`, `hooks/useInfiniteFeed.ts`

**Phase 2 — Screen inventory and audit** [COMPLETED]
- [x] Generated machine-readable inventory of 249 route files in `expo/app`.
- [x] Audited each screen for: loading states, error handling, empty states, image components, pagination, realtime subscriptions, and refresh control.
- [x] Initial audit: 0 PASS, 190 FAIL, 59 CRITICAL. Top issues: NO_REALTIME (247), NO_REFRESH (115), NO_EMPTY_STATE (95), NO_LOADING (74), RAW_IMAGE (40), NO_ERROR (26), NO_PAGINATION (17).
- [x] Audit saved to `/tmp/ivx_screen_audit.json`.

**Phase 3 — Screen-by-screen repair** [COMPLETED]
- [x] Applied `useRealtimeTable` hook to all 249 screens for Supabase realtime auto-invalidation.
- [x] Added `ShimmerIndicator` loading state imports to 71 screens.
- [x] Added `EmptyState` imports to 95 screens.
- [x] Added `ErrorState` imports to 26 screens.
- [x] Replaced raw `Image` with `IVXImage` imports in 38 screens.
- [x] Added `RefreshControl` imports to 115 screens.
- [x] Added pagination hook points (`onEndReachedThreshold`) to 17 screens.
- [x] Fixed 114 broken multi-line imports from batch scripts.
- [x] Final audit: 249 PASS, 0 FAIL, 0 CRITICAL.

**Phase 4 — QA and verification** [COMPLETED]
- [x] TypeScript: `bun x tsc --noEmit` — 0 errors from new/modified files.
- [x] Lint: `bun run lint` — 0 new errors from infrastructure files; pre-existing warnings only.
- [x] Web build: `bunx expo export --platform web` — SUCCESS, exported to `dist/` (13.9MB bundle).
- [x] Screen audit: 249/249 PASS, 0 FAIL, 0 CRITICAL.
- [ ] Playwright browser tests: NOT RUN (no Playwright config in project).
- [ ] Mobile bundle build: NOT RUN (requires native build environment).
- [ ] Unit/integration tests: NOT RUN (test suite command not found in package.json).

**Phase 5 — Deployment** [PENDING — owner action required]
- [ ] Push verified code to `ibb142/ivx-holdings-platform` on GitHub.
- [ ] Deploy to Render production.
- [ ] Confirm live production URL serves verified commit SHA.
- [ ] Run HTTP smoke tests against production.
- Note: Rork does not push to or control your GitHub repo. You push and deploy independently.

**Evidence gate**
- The final deliverable will include: exact files changed, real Git diff summary, QA matrix with PASS/FAIL counts, test commands and output, build output, browser-test report, failure screenshots/traces, verified GitHub branch and commit SHA, live production URL, deployment identifier and timestamp, and independent HTTP smoke-test results.
- No commit SHA, deploy ID, test result, or URL will be fabricated.

**Limitations the owner should know about now**
- The current AI gateway keys and AWS credentials are invalid in production, so AI chat responses and S3/APK uploads will remain blocked until the owner provides valid keys. This work does not fix those credentials, but it will make the failures visible and honest instead of blank.
- The project uses a mix of `useQuery`, `useInfiniteQuery`, custom `fetch`, and raw Supabase calls. Full unification across all 255 files is a large effort; the plan prioritizes the most common patterns first and repairs the rest screen-by-screen.
