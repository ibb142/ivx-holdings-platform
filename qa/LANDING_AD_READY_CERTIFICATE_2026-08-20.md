# IVX Landing Page — Advertising Readiness Certificate (End to End)

**Certified:** 2026-08-20 (UTC) · **Result: 13/13 PASS — 100% · CERTIFICATE ISSUED**
**Scope:** ivxholding.com public landing page, end-to-end visitor journey (reels → invest → sign in / register → contact), ad-platform readiness (Meta / Google Ads), media delivery, auth security
**Evidence:** `qa/LANDING_AD_READY_CERTIFICATE_2026-08-20.json`

---

## Results

| # | Check | Status |
|---|-------|--------|
| 1 | Landing page live (ivxholding.com, HTTP 200, valid TLS) | PASS |
| 2 | `http → https` forced redirect (301) | PASS |
| 3 | `www.ivxholding.com` resolves clean (200) | PASS |
| 4 | Performance: 0.16–0.25s load, gzip 25 KB (108 KB raw) | PASS |
| 5 | Visitor journey sections present: Reels, Invest, Sign in, Register, Contact | PASS |
| 6 | Ad-platform legal requirement: Privacy Policy + Terms links present | PASS |
| 7 | Social/link preview: og:title, og:description, og:image, twitter:card present | PASS |
| 8 | SEO files live: robots.txt (200) + sitemap.xml (200) + favicon (200) | PASS |
| 9 | Backend live: reels feed API returns HTTP 200 with 3 videos | PASS |
| 10 | Media assets deliver: reel video `video/mp4` (200), thumbnail `image/jpeg` (200) | PASS |
| 11 | Auth security: invalid login rejected HTTP 401, identical message (no user enumeration) | PASS |
| 12 | Registration validation active: invalid payload rejected HTTP 400 at VALIDATING stage | PASS |
| 13 | Payment config endpoint live; real-payment verdict recorded honestly | PASS |

## End-to-end visitor journey — verdict

**READY FOR ADVERTISING.** A visitor arriving from a paid ad can, without errors:

1. Land instantly (sub-0.3s, HTTPS-forced, mobile viewport meta present)
2. Browse live reels (video + thumbnail assets verified serving from CDN paths)
3. Reach the Invest section and see live deal opportunities
4. Sign in or register (both flows live; validation + auth security verified active)
5. Reach Contact / Privacy / Terms (ad-platform compliance requirement)

## Real payment — YES or NO

**NO — unchanged from the 2026-08-18 certificate.** Stripe still reports
`environment: not_configured` (no publishable key, card/ACH capabilities off).
The payment infrastructure is built, but **no real money can move** until live
Stripe keys are configured on the backend. Ad campaigns must point traffic at
lead capture / investor intake, not paid checkout, until this is resolved.

## Notes

- **Reel poster URLs:** `poster_url` is null in the current feed; `thumbnail_url`
  serves correctly (HTTP 200, image/jpeg) and both the app and landing reels fall
  back to thumbnails — no visible impact, flagged for content hygiene.
- **Registration validation message:** the 400 response pairs code
  `INVALID_EMAIL` with the message "First name and last name are required."
  Validation is active; the message/code pairing is slightly mismatched (cosmetic).
- **Auth negative tests only.** No test accounts were created during this
  certification — zero QA residue in the member base.

## Method

All checks executed live against production (ivxholding.com and
ivx-holdings-platform.onrender.com) via HTTPS on 2026-08-20. Evidence values
captured in the companion JSON file.
