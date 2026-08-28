# IVX Landing Phase 2 — Instagram/Amazon Excellence War Room

Status: ACTIVE PLAN
Goal: take the IVXHolding landing page from launch-ready to enterprise-grade consumer quality with Instagram-style media fluency and Amazon-style reliability, while keeping claims truthful, accessible, secure, measurable, and production-verifiable.

## Non-negotiable completion standard
Phase 2 is complete only when all P0/P1 findings are closed, all critical paths pass on the exact production SHA, no simulated success is accepted, and Agent 112 issues GO FOR ADVERTISING + GO FOR ENTERPRISE QUALITY with durable evidence.

## 112-agent Phase 2 assignments
001 — Hero visual polish: hierarchy, spacing, typography, CTA prominence, no layout jump.
002 — Hero CTA response under touch/mouse/keyboard; zero dead states.
003 — Above-the-fold conversion clarity in under 5 seconds.
004 — Multi-CTA consistency: one primary action, no competing dead-end flows.
005 — Investor intake transitions feel instant and deterministic.
006 — Form microinteractions: focus, validation, error recovery, success confirmation.
007 — Preserve attribution through every funnel transition and reload-safe state.
008 — Remove unnecessary friction while preserving legal and consent requirements.

009 — GA4 event taxonomy audit against actual conversion funnel.
010 — Meta Pixel dedupe and conversion-event integrity.
011 — TikTok event integrity and consent enforcement.
012 — LinkedIn Insight conversion integrity.
013 — Zero pre-consent ad-tracker leakage.
014 — Zero PII leakage to analytics/logging.
015 — Cross-channel event naming consistency and dedupe.
016 — CRM attribution parity with browser analytics.

017 — Search snippet quality: title/description intent match.
018 — Open Graph previews polished and image-safe.
019 — Twitter/X preview parity.
020 — Structured-data validation and truthful claims.
021 — FAQ schema vs visible FAQ parity.
022 — Canonical/sitemap/robots consistency.
023 — Heading hierarchy and semantic indexability.
024 — Social links ownership, 200 status, and destination quality.

025 — LCP target audit and remediation plan.
026 — CLS target audit and zero-jump priority paths.
027 — INP interaction latency audit.
028 — Script execution budget and duplicate JS removal.
029 — Image compression, responsive srcset, lazy loading, dimensions.
030 — Video/reels preload strategy and mobile bandwidth control.
031 — CDN/cache strategy for immutable assets vs HTML.
032 — Core Web Vitals launch gate with reproducible evidence.

033 — Pixel-perfect 320/360/375/390/414 responsive audit.
034 — Tablet portrait/landscape polish.
035 — Navigation behavior benchmarked against mature consumer apps.
036 — Modal/funnel keyboard focus trap and escape behavior.
037 — Forms: labels, touch targets, announcements, autocomplete.
038 — Contrast, focus visibility, disabled/active states.
039 — Reduced-motion behavior for reels, ticker, transitions.
040 — Screen-reader journey through hero -> deal -> intake -> success.

041 — CSP production dependency closure.
042 — Secret/private credential scan across landing bundle/config.
043 — Supabase anon/RLS public-data boundary validation.
044 — XSS hardening for API/deal/chat content.
045 — Replay/CSRF/idempotency abuse checks for public forms.
046 — Browser security headers consistency.
047 — Storage minimization for identifiers and consent state.
048 — Error sanitization: no stack/token/internal leakage.

049 — Investment risk disclaimer placement and readability.
050 — Remove/flag guaranteed-return or certainty language.
051 — ROI/target/estimate wording consistency.
052 — Fee/expense disclosure discoverability.
053 — Liquidity/hold-period disclosure consistency.
054 — Entity/contact/address consistency.
055 — Privacy/Terms/Disclosures/Cookie/Legal route quality.
056 — Legal substantiation inventory for all trust/investment claims.

057 — Hero copy trust/clarity rewrite recommendations.
058 — Security/trust claims tied to verifiable evidence.
059 — Company credibility section polish and factual accuracy.
060 — Testimonials/reviews anti-fabrication audit.
061 — Statistics/counters source-of-truth validation.
062 — Partner/affiliate compensation wording clarity.
063 — Live vs Coming Soon product-state consistency.
064 — Support promises aligned with real operations.

065 — Deals API correctness and graceful empty state.
066 — Static fallback quality when API is unavailable.
067 — Deal-card missing-data resilience and sanitization.
068 — Loading/error/refresh states with no visual jitter.
069 — Sale price, ownership, ROI semantic parity with backend.
070 — Media/reels URL health and fallback imagery.
071 — API timeout/retry behavior with non-blocking UI.
072 — Public/private deal-data boundary verification.

073 — Chat startup latency and first-response reliability.
074 — Chat graceful fallback and retry path.
075 — Human escalation actually creates a request or gives truthful fallback.
076 — User/model text sanitization and link safety.
077 — Busy/loading/error states visually polished and non-blocking.
078 — Session identifiers privacy audit.
079 — Video upload size/type/progress/error UX.
080 — Mobile chat never blocks CTA/navigation/cookie controls.

081 — Lead payload schema parity with backend.
082 — Lead source persistence into CRM.
083 — Consent version/timestamp/selection persistence.
084 — Email normalization and duplicate-lead behavior.
085 — Phone/SMS behavior aligned with consent language.
086 — Partner application pipeline verification.
087 — Backend outage must never show false success.
088 — Success copy matches real follow-up timeline/process.

089 — Remove every stale APK version reference.
090 — Android versionName/versionCode parity.
091 — Built APK manifest verification.
092 — Package/applicationId verification.
093 — APK signature + SHA-256 evidence.
094 — Download URL MIME/content validation.
095 — QR-to-APK exact URL parity.
096 — APK CTA disabled until certified binary is public.

097 — S3 deploy content integrity and expected file set.
098 — CloudFront invalidation + fresh-content observability.
099 — HTTPS/mixed-content audit.
100 — www -> apex redirect preserving path/query.
101 — Cache-control strategy verification.
102 — Repeated deploy idempotency.
103 — Deploy failure must fail certification.
104 — Public production content must match intended exact release SHA.

105 — Instagram-style reels/media smoothness under slow 4G and repeated scroll.
106 — Interaction consistency for like/save/share/comment without hurting conversion.
107 — App-like state resilience: reload/back-forward/offline/reconnect.
108 — Amazon-style idempotency: double click, refresh, timeout, retry.
109 — Abuse hardening: malformed input, oversized payload, bot/honeypot/rate limit.
110 — Observability: actionable frontend/backend evidence with zero PII exposure.
111 — Paid-traffic red-team from ad click to completed CRM lead; identify every budget-wasting dead end.
112 — Release Commander: aggregate 001-111, require P0=0 and P1=0, validate exact production SHA, issue GO/NO-GO and durable Phase 2 certificate.

## Phase 2 code-quality gate
- No dead code introduced in landing path.
- No duplicate event handlers or duplicate analytics firing.
- No console errors on critical flows.
- No unhandled promise rejections.
- Typecheck, lint, secret scan and relevant tests green.
- All network failures have explicit user-safe fallback behavior.
- DOM updates avoid layout thrash and duplicate listeners.
- All API-rendered content is escaped/sanitized.
- Accessibility states are present for interactive controls.
- CSS/JS behavior is deterministic across refresh/back-forward.

## Final certification
PASS only when:
1. 112/112 Phase 2 assignments have real evidence.
2. P0 = 0.
3. P1 = 0.
4. Exact production SHA equals the certified main SHA.
5. S3/CloudFront deploy is verified.
6. Funnel -> backend -> CRM -> success is verified end-to-end.
7. Analytics + consent + attribution are verified.
8. Mobile + accessibility + performance + security have no launch blockers.
9. Agent 112 issues GO FOR ADVERTISING and GO FOR ENTERPRISE QUALITY.
