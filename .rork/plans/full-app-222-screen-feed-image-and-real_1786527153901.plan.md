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

**Phase 1 — Shared infrastructure**
- Build one canonical `IVXDataProvider` wrapper around React Query that unifies loading, error, empty, offline, retry, timeout, and skeleton states.
- Build a canonical `IVXImage` component on top of `expo-image` that always shows a skeleton placeholder, progressive fade-in, explicit error state, stable aspect ratio, and memory/disk cache policy.
- Build a canonical `IVXFeed` component that wraps `FlatList` with viewport tracking, lazy image loading, request deduplication, pull-to-refresh, background refresh that preserves visible items, and cursor-based or offset-based pagination.
- Build a canonical `useRealtimeChannel` hook on Supabase realtime with automatic reconnect, exponential backoff, and a status surface for debugging.
- Centralize request cancellation and deduplication through React Query and the shared hooks.
- Replace ad-hoc `fetch()` and `supabase.from()` calls in the most common feed/image patterns with the shared hooks, while keeping the same query keys and data shapes.
- Add an `AccessibilityAnnouncer` so screen readers announce loading, error, and update states.

**Phase 2 — Screen inventory and audit**
- Generate a machine-readable inventory of every route file in `expo/app`: route, component name, module, auth requirement, and data dependencies.
- For each screen, trace its API requests, state management, image URLs, and real-time subscriptions.
- Record the current behavior for initial load, image load, text/content render, click/navigation, scroll/pagination, real-time updates, empty/error/retry states, mobile viewport, and desktop viewport.
- Classify every screen as PASS, FAIL, or BLOCKED, with console evidence and network failures attached.

**Phase 3 — Screen-by-screen repair**
- Fix shared infrastructure defects first, then apply the canonical components/hooks to screens that still fail individually.
- Repair empty/frozen states, missing skeletons, broken image loading, pagination failures, stale state, missing env bindings, and broken realtime subscriptions.
- Add stable test selectors only where necessary for automated verification.
- Keep commits focused and traceable on a dedicated branch.

**Phase 4 — QA and verification**
- Run TypeScript type checks, lint, and the existing unit/integration test suites.
- Run production web build and mobile bundle build.
- Run Playwright browser tests for the web build at mobile and desktop viewports against the critical flows: chat, video feed, wallet, property feed, knowledge base, owner dashboard, and notifications.
- Produce a QA matrix with the exact screen count, PASS/FAIL counts, and evidence references.
- Mark any screen or test that could not be executed as UNVERIFIED, not PASS.

**Phase 5 — Deployment**
- Push the verified branch to the owner-controlled GitHub repository.
- Deploy the verified production build using the existing Render + Vercel/Cloudflare configuration.
- Confirm the live production URL serves the verified commit SHA.
- Run independent HTTP smoke tests against production for health, feed, image, and realtime endpoints.
- Capture browser console and network evidence for production.
- Preserve rollback capability through Git history and a known healthy deploy reference.

**Evidence gate**
- The final deliverable will include: exact files changed, real Git diff summary, QA matrix with PASS/FAIL counts, test commands and output, build output, browser-test report, failure screenshots/traces, verified GitHub branch and commit SHA, live production URL, deployment identifier and timestamp, and independent HTTP smoke-test results.
- No commit SHA, deploy ID, test result, or URL will be fabricated.

**Limitations the owner should know about now**
- The current AI gateway keys and AWS credentials are invalid in production, so AI chat responses and S3/APK uploads will remain blocked until the owner provides valid keys. This work does not fix those credentials, but it will make the failures visible and honest instead of blank.
- The project uses a mix of `useQuery`, `useInfiniteQuery`, custom `fetch`, and raw Supabase calls. Full unification across all 255 files is a large effort; the plan prioritizes the most common patterns first and repairs the rest screen-by-screen.
