# IVX Landing 112-Agent Enterprise War Room

Status: ACTIVE PLAN
Goal: close paid-traffic landing gaps to a verified GO standard. Benchmark behaviors may resemble mature consumer/enterprise products such as Instagram-style media UX and Amazon-style reliability, but acceptance is based on IVX production evidence.

## Schedule
- GitHub landing deploy: every 5 minutes (already configured separately).
- ChatGPT autonomous QA war room: hourly today.
- 112-agent activation workflow: push-triggered on its own workflow file and available for manual reruns.

## Rules
- No agent may claim PASS without evidence.
- P0 blocks paid traffic. P1 must close before 10/10. P2 may follow after launch if non-blocking.
- Every finding must include: severity, evidence, file/URL, fix suggestion, verification step.

## Agents 001-008 — Conversion Funnel
001 — Verify hero primary CTA opens investor intake on desktop/mobile; P0 if dead.
002 — Verify all Get Started/Start Intake buttons route to the same conversion flow.
003 — Verify funnel step 1 goal selection, keyboard/touch behavior, and state transitions.
004 — Verify funnel step 2 required fields, validation, consent, and error messages.
005 — Verify successful lead submission reaches backend/CRM and success state is truthful.
006 — Verify duplicate-submit/idempotency behavior under double tap and network retry.
007 — Verify UTM/gclid/fbclid attribution survives from page load through lead submission.
008 — Audit conversion friction and propose only measurable, non-deceptive improvements.

## Agents 009-016 — Advertising Analytics
009 — Verify Google Ads/GA4 config injection and PageView after consent.
010 — Verify Meta Pixel config injection and PageView/conversion event behavior after consent.
011 — Verify TikTok Pixel config injection and page/conversion events after consent.
012 — Verify LinkedIn Insight tag config injection and conversion events after consent.
013 — Verify no ad pixel loads before consent and Essentials Only remains respected.
014 — Verify PII sanitizer prevents email/phone/account leakage into analytics events.
015 — Verify CTA, registration-start, registration-complete and form-error tracking semantics.
016 — Verify source/medium/campaign/content/term and click IDs are available for CRM attribution.

## Agents 017-024 — SEO / Social / Discoverability
017 — Verify title, meta description, canonical and robots directives.
018 — Verify Open Graph title/description/image/url and social preview assets return 200.
019 — Verify Twitter/X card tags and image asset behavior.
020 — Validate FinancialService structured data for syntax and claim accuracy.
021 — Validate FAQ structured data for consistency with visible content.
022 — Validate sitemap/robots availability and canonical apex consistency.
023 — Check headings, internal anchor structure and indexable content hierarchy.
024 — Audit social profile links and remove/flag any dead or unowned destination.

## Agents 025-032 — Performance / Core Web Vitals
025 — Audit LCP path: hero image/font/CSS/script blockers.
026 — Audit CLS sources from images, fonts, dynamic deals and video/reels.
027 — Audit INP risks from inline handlers, large JS, modal work and event storms.
028 — Audit bundle/script loading order, defer/async use and duplicated libraries.
029 — Audit image sizes, lazy loading, dimensions, formats and offscreen delivery.
030 — Audit video preload/autoplay behavior to prevent bandwidth waste on mobile.
031 — Audit cache-control/versioning strategy for static assets behind CloudFront.
032 — Define performance launch thresholds and produce a P0/P1 remediation list.

## Agents 033-040 — Mobile / Responsive / Accessibility
033 — Verify layout at 320/360/375/390/414px widths with no horizontal overflow.
034 — Verify tablet breakpoints and orientation changes.
035 — Verify navigation hamburger, focus, aria-expanded and escape behavior.
036 — Verify modals/funnel focus trapping, close controls and keyboard navigation.
037 — Verify form labels/aria/error announcements and touch target sizes.
038 — Verify color contrast and visible focus states for core CTA/funnel paths.
039 — Verify reduced-motion/accessibility expectations for animated ticker/reels.
040 — Verify screen-reader semantics of headings, links, buttons and dynamic status regions.

## Agents 041-048 — Security / Privacy / Browser Hardening
041 — Audit CSP directives against every production script/image/connect/media dependency.
042 — Verify no secret/private credential is present in landing HTML/JS/config.
043 — Verify Supabase anon usage is appropriate and public-facing access depends on RLS.
044 — Audit XSS injection surfaces from API/deal/chat content and HTML rendering helpers.
045 — Audit CSRF/replay exposure of public forms and state-changing endpoints.
046 — Verify referrer, frame, object, base and permissions policies are coherent.
047 — Audit localStorage/sessionStorage use for sensitive or identifying information.
048 — Verify error paths do not expose stack traces, tokens, account data or backend internals.

## Agents 049-056 — Legal / Financial Advertising / Disclosures
049 — Verify risk-of-loss disclaimer is visible before or near investment CTAs.
050 — Verify no guaranteed-return language or misleading performance certainty remains.
051 — Verify projected ROI language is consistently labeled estimate/target and non-guaranteed.
052 — Verify fees/expenses disclosure language exists and points users to deal-specific terms.
053 — Verify liquidity/hold-period language is visible and consistent.
054 — Verify entity identity, contact information and business address consistency.
055 — Verify Privacy/Terms/Disclosures/Cookie/Legal links exist and are reachable.
056 — Flag claims such as escrow, insurance, title verification, accreditation and entity structure that require factual/legal substantiation.

## Agents 057-064 — Trust / Content / Credibility
057 — Audit hero copy for clarity, credibility and paid-traffic relevance.
058 — Audit trust/security section for evidence-backed claims only.
059 — Audit company credibility section and management-call language.
060 — Audit testimonials/review-like content to ensure it is not fabricated or misleading.
061 — Audit statistics/counters so dynamic numbers are sourced or safely generic.
062 — Audit partner program claims and compensation wording.
063 — Audit app/mobile messaging so Coming Soon vs Live is internally consistent.
064 — Audit investor support promises, response-time claims and operational truthfulness.

## Agents 065-072 — Deals / Data / APIs
065 — Verify live deals endpoint/config resolves in production.
066 — Verify static fallback deals render when live APIs fail.
067 — Verify deal cards sanitize API content and tolerate missing fields.
068 — Verify refresh logic, loading states and error states.
069 — Verify sale price/ownership/ROI labels match backend semantics.
070 — Verify project media/reels URLs return usable assets and graceful fallback.
071 — Verify API timeout/retry behavior does not freeze conversion UI.
072 — Verify public page never exposes private investor-only deal data.

## Agents 073-080 — Chat / Support / Realtime
073 — Verify landing investor chat initializes with production config.
074 — Verify public chat endpoint returns a useful response and graceful fallback on failure.
075 — Verify human-support escalation creates a real request or clearly states fallback contact.
076 — Verify chat sanitizes user and model text against HTML/script injection.
077 — Verify chat busy/loading/error states and retry behavior.
078 — Verify chat memory/session identifiers do not leak sensitive user data.
079 — Verify optional video upload path size/type/error/processing states.
080 — Verify chat UI on mobile does not obstruct CTA, cookie banner or navigation.

## Agents 081-088 — Lead Capture / CRM / Communications
081 — Verify lead payload schema, required fields and backend status handling.
082 — Verify lead source attribution is persisted with CRM record.
083 — Verify consent timestamp/version/selection is stored with applicable lead data.
084 — Verify email field normalization and duplicate-lead handling.
085 — Verify phone optionality matches actual SMS/contact behavior and consent language.
086 — Verify partner application form reaches the correct pipeline.
087 — Verify error/retry behavior during backend outage without false success.
088 — Verify success-state copy matches actual follow-up process and timing.

## Agents 089-096 — Android APK / Mobile Distribution
089 — Verify landing contains no link to stale v1.10.14/v1.10.13 APK.
090 — Verify current Android source versionName/versionCode are aligned with app.config.
091 — Verify QA APK manifest versionCode/versionName from built artifact.
092 — Verify APK package/applicationId is expected for owner/QA distribution.
093 — Verify APK signature with apksigner and record SHA-256.
094 — Verify landing download URL returns application/vnd.android.package-archive, not HTML/404.
095 — Verify QR code encodes the exact same certified APK URL.
096 — Verify APK CTA remains gated/disabled until certified binary is public.

## Agents 097-104 — AWS / Deploy / CDN / DNS
097 — Verify S3 deployment writes expected landing files to ivxholding.com bucket.
098 — Verify CloudFront invalidation succeeds and new content is observable publicly.
099 — Verify apex HTTPS certificate/response and no mixed-content dependencies.
100 — Verify www redirects to apex while preserving path/query where required.
101 — Verify static asset cache headers and HTML no-stale strategy.
102 — Verify deploy is idempotent and safe under repeated 5-minute execution.
103 — Verify deployment failures stop certification and do not report false success.
104 — Verify public production page corresponds to intended current release evidence.

## Agents 105-112 — Enterprise Adversarial QA / Instagram-Amazon Benchmark Behaviors
105 — Mobile-feed stress test: media cards/reels under slow 4G, failures and repeated scroll.
106 — Interaction consistency test: like/save/share/comment controls never break conversion path.
107 — Reliability test: reload/back-forward/offline/reconnect preserve safe state without duplicate actions.
108 — Amazon-style conversion resilience: double click, refresh, timeout and retry remain idempotent.
109 — Abuse test: malformed inputs, oversized payloads, bot honeypot and rate-limit expectations.
110 — Observability test: critical frontend/backend failures produce actionable evidence without PII.
111 — Paid-traffic red-team: inspect every path from ad click to lead completion for budget-wasting dead ends.
112 — Release commander: aggregate 001-111 findings, classify P0/P1/P2, refuse GO until every P0/P1 launch gate has evidence.

## Launch Definition
GO FOR ADVERTISING requires: public landing reachable; primary investor intake functional; CRM capture verified; attribution/tracking configured and consent-compliant; legal/disclosures reachable; mobile conversion path usable; no stale APK download; S3/CloudFront deploy verified; no unresolved P0; and all P1 launch blockers closed or explicitly proven non-blocking.
