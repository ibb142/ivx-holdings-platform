# IVX Holdings Landing — Phases 1–4 / Items 1–38 Audit Certificate

Date: 2026-08-20
Scope: Rork 100-item landing narrative, items 1–38 only
Production reviewed: https://ivxholding.com
Repository baseline reviewed: main @ 6ca1cd71f2b9602d079c141805f918279888e7da
Method: evidence-first. PASS requires repository and/or live production evidence. Missing runtime evidence is UNVERIFIED, not assumed PASS.

Status legend: PASS = evidenced; PARTIAL = implementation exists but one acceptance condition remains unproven; FAIL = requested behavior absent or contradicted; UNVERIFIED = cannot truthfully certify without runtime/device/API evidence.

## Phase 1 — Instant Arrival & First Impression (1–10)

1. Sub-0.3-second page load (0.16–0.25s target) — UNVERIFIED. No current measured navigation/LCP evidence was produced in this audit.
2. Forced HTTPS with valid TLS and HTTP→HTTPS redirect — PARTIAL. Production is reachable over HTTPS and source contains security/canonical handling; redirect/TLS-chain evidence was not independently captured in this audit.
3. Mobile-first responsive layout — PARTIAL. Responsive/mobile navigation code exists, but 320/360/375/390/414px live-device evidence is still required.
4. Live deal ticker with real-time clock — PARTIAL. Live ticker content is present in production; real-time clock behavior was not independently exercised.
5. Sticky navigation with hamburger menu on mobile — PARTIAL. Hamburger control exists in production source; sticky/mobile interaction still needs live browser/device proof.
6. Hero value proposition — PASS. Production renders a clear investor-intake/live-opportunity hero and primary CTA.
7. Live platform statistics — AUM and investor count — FAIL against the Rork requirement. Current production hero shows Published Deals, Document Review and Active Investor Intake rather than evidenced live AUM + investor count.
8. Cookie consent banner — Accept All / Essentials Only — UNVERIFIED. Cookie Policy is reachable, but this audit did not capture live consent-banner behavior or prove pixels remain blocked before consent.
9. Toast notifications — instant feedback on every action — PARTIAL. Toast implementation exists for reel actions; 'every action' coverage is not proven.
10. Full SEO + link-preview stack — PARTIAL. Title, description, canonical, OG, Twitter tags and structured data exist in source; robots.txt, sitemap.xml and live asset response validation remain to be evidenced.

Phase 1 rollup: 1 PASS / 7 PARTIAL-UNVERIFIED / 1 FAIL / 1 PARTIAL-SEO. NOT 10/10.

## Phase 2 — Discover Live Deals (11–22)

11. Featured Deals section — PASS. Production exposes a Featured Deals section.
12. Live properties grid pulled from backend API in real time — PARTIAL. Production states 3 live opportunities and code contains backend/API resolution; this audit did not capture the live API response and bind each rendered card to that response.
13. Live deal counter — PASS. Production visibly reports 3 published/live opportunities.
14. Auto-refresh with 'refreshed X ago' — FAIL. Production text exposes a Refresh control but no evidenced 'refreshed X ago' state was found.
15. Manual refresh button — PARTIAL. Refresh control is visible; click/network behavior still needs live interaction proof.
16. Graceful error state with retry — UNVERIFIED. No forced backend-failure test was executed in this audit.
17. ROI displayed on every deal card — UNVERIFIED. ROI is evidenced in the investment flow for CASA ROSARIO, but 'every deal card' was not proven.
18. Equity stake shown on every card — UNVERIFIED. Equity/ownership is present in the investment flow, but 'every card' coverage was not proven.
19. Deal type + minimum allocation on each card — UNVERIFIED. Deal type/minimum are evidenced in CASA ROSARIO flow; each-card coverage was not proven.
20. Full deal review modal — PARTIAL. A multi-step deal/investment modal is present in production; complete per-deal review parity across every opportunity remains unproven.
21. Per-deal PDF summary — FAIL/UNVERIFIED. No downloadable per-deal diligence PDF was evidenced from the production landing in this audit.
22. 'Browse Deals →' deep link to full catalog — PARTIAL. A Browse Deals action exists in the portal flow; the requested public full-catalog deep-link behavior was not independently proven.

Phase 2 rollup: 2 PASS / 7 PARTIAL-UNVERIFIED / 2 FAIL / 1 PARTIAL. NOT 12/12.

## Phase 3 — Investment Reels (23–30)

23. Investment reels on landing page — PASS. Production states a featured project reel is included and reel/feed implementation exists.
24. Vertical video playback — MP4/CDN HTTP 200 — UNVERIFIED. Video/HLS source handling exists, but this audit did not capture a concrete production media URL with HTTP 200 evidence.
25. Instant thumbnail paint — PARTIAL. Reel implementation supports poster/thumbnail and skeleton rendering; live paint timing was not measured.
26. Live video feed API — same feed mobile app uses — PARTIAL. Landing reel code resolves backend media data and production claims app parity; exact response parity with the mobile app was not independently compared.
27. Reel-to-deal linkage — UNVERIFIED. No complete live test proved that every reel navigates to the matching deal.
28. Lazy-loaded media — PASS BY CODE. Reel code uses IntersectionObserver and non-eager video preload behavior.
29. Share + invest CTAs from every reel — PARTIAL/FAIL. Share actions are implemented; an investment CTA on every reel was not proven.
30. Content parity with mobile app — UNVERIFIED. Production claims the same sequence as the app, but a side-by-side catalog comparison was not executed.

Phase 3 rollup: 2 PASS / 6 PARTIAL-UNVERIFIED. NOT 8/8.

## Phase 4 — Trust, Compliance & Risk (31–38)

31. 'Who investors are dealing with' / company transparency — PASS. Production identifies IVX Holdings LLC, investor-relations email, business address and management diligence access.
32. Credibility section — track record and structure explained — PARTIAL/FAIL. Structure/company identity are present; an evidence-backed track-record section was not established.
33. Trust signals throughout scroll — PASS WITH SUBSTANTIATION CONDITION. Security, escrow-structured, review-gate and disclosure messaging are distributed across the page; factual claims still require source/legal substantiation.
34. Reviews section — real member testimonials — FAIL. No testimonial content was found in production text, and prior repository/database review did not establish a verified testimonial source. Fabricated testimonials are prohibited.
35. Risk disclosures shown before investing — PASS. Production displays risk-of-loss, fees, liquidity and no-guaranteed-return language, and the confirmation flow repeats risk language before confirmation.
36. Explicit 'Understood' acknowledgement / informed-consent gate — PARTIAL. Production has an agreement/risk acknowledgement before confirmation and an 'Understood' action after submission; the exact requested pre-confirmation 'Understood' informed-consent gate is not separately proven.
37. 'Agree to terms to confirm' — PASS. Production Review & Confirm displays agreement/risk text and an 'Agree to terms to confirm' gate.
38. Escrow-structured offerings + deal-level distribution terms — PARTIAL. General escrow structure and CASA ROSARIO distribution/ownership terms are visible; each published deal still needs its own evidenced escrow/distribution/fee/liquidity terms.

Phase 4 rollup: 4 PASS / 2 PARTIAL / 2 FAIL-or-partial. NOT 8/8.

# Current Certificate Result

Items reviewed: 38
Fully evidenced PASS: 9
Not yet fully certified: 29

PHASES 1–4 FINAL STATUS: NOT YET 38/38 CERTIFIED.

This is a truthful evidence certificate, not a launch-failure claim. It means the remaining items need runtime proof and/or implementation before they may be marked PASS.

## Exact closure plan for 38/38

P0/P1 closure gates:
- Capture real performance evidence for item 1 and set an explicit pass threshold.
- Execute mobile viewport QA at 320/360/375/390/414px for items 3 and 5.
- Exercise ticker clock and cookie-consent behavior, including proof that non-essential analytics do not load before consent.
- Either restore evidence-backed live AUM + investor count for item 7 or formally revise the Rork requirement; current content does not satisfy the stated item.
- Validate robots.txt, sitemap.xml, OG/Twitter assets and canonical redirects for item 10.
- Capture backend response/render binding for live deals and forced-error/retry behavior for items 12 and 16.
- Implement or prove 'refreshed X ago' for item 14.
- Prove ROI/equity/type/minimum on every rendered deal card for items 17–19.
- Add/prove per-deal downloadable diligence PDF for item 21 and public Browse Deals full-catalog routing for item 22.
- Capture real media URLs and HTTP 200, reel→deal navigation, every-reel invest CTA and side-by-side app parity for items 24, 27, 29, 30.
- Add evidence-backed credibility/track-record content or revise item 32 so it does not require unsupported history.
- Do not fabricate item 34. Add only authentic, consented member testimonials with provenance, or keep the item FAIL until real testimonials exist.
- Make item 36 an explicit pre-confirm informed-consent acknowledgement if that is the intended requirement, and test bypass attempts.
- Prove deal-level escrow/distribution/fees/liquidity terms for every published deal for item 38.

## Final certification rule
38/38 may be issued only when every numbered item has executable or live evidence and no P0/P1 blocker remains. Missing evidence never rolls up to PASS.
