# IVX Landing 112 Enterprise Remediation Router

Status: ACTIVE EXECUTION PLAN
Purpose: replace the old item-number=agent-number assignment with role-aligned routing.
Source checklist: `qa/landing-112-agent-war-room.md`.
Rule: an item is not complete until the assigned agent set produces durable evidence appropriate to the task.

## Workstream routing

### Items 001-008 — Conversion Funnel
Primary agents: IA-09 Sales/Marketing, IA-10 Technology/Platform, IA-17 Investor Acquisition, IA-18 Investor Retention, IA-19 Buyer Acquisition, IA-20 Buyer Qualification, IA-21 Buyer Follow-Up, IA-41 Data Intelligence.
Acceptance evidence: live CTA/funnel trace, backend/CRM record, idempotency result, attribution persistence, measurable conversion finding.

### Items 009-016 — Advertising Analytics
Primary agents: IA-13 App Advertising, IA-14 Paid Media, IA-15 Social Media Growth, IA-16 Brand Expansion, IA-40 Automation Innovation, IA-41 Data Intelligence, IA-42 Market Intelligence, IA-43 Competitor Intelligence.
Acceptance evidence: consent-gated pixel/network evidence, sanitized analytics payloads, attribution fields persisted to CRM.

### Items 017-024 — SEO / Social / Discoverability
Primary agents: IA-15 Social Media Growth, IA-16 Brand Expansion, IA-34 PropTech Research, IA-35 New Technology Discovery, IA-41 Data Intelligence, IA-43 Competitor Intelligence, IA-61 Strategic Growth, IA-103 Experimental Products.
Acceptance evidence: live HTML/meta/structured-data checks, social asset HTTP evidence, dead-link list, corrected source commit.

### Items 025-032 — Performance / Core Web Vitals
Primary agents: IA-68 Frontend Architecture, IA-69 Backend Architecture, IA-71 API Design, IA-72 AI Architecture, IA-76 Analytics, IA-80 Web, IA-86 App Automation, IA-91 App Monitoring.
Acceptance evidence: measured LCP/CLS/INP or equivalent reproducible trace, asset/cache findings, source fixes and regression check.

### Items 033-040 — Mobile / Responsive / Accessibility
Primary agents: IA-66 UX Architecture, IA-67 UI Design, IA-68 Frontend Architecture, IA-78 iOS, IA-79 Android, IA-80 Web, IA-87 App Testing, IA-88 App QA.
Acceptance evidence: viewport/device matrix, keyboard/focus/accessibility checks, source fix where needed, reproducible UI evidence.

### Items 041-048 — Security / Privacy / Browser Hardening
Primary agents: IA-08 Legal/Compliance, IA-11 Security/QA/Certification, IA-73 Security Architecture, IA-74 Authentication, IA-89 Security Testing, IA-96 Project Legal Structure, IA-100 Project Automation, IA-110 Internal Tool Creation.
Acceptance evidence: CSP/secret/RLS/XSS/CSRF/storage/error-path verification with exact source/route evidence. Item 043 specifically requires proof that public Supabase access uses anon credentials plus RLS, never service-role exposure.

### Items 049-056 — Legal / Financial Advertising / Disclosures
Primary agents: IA-08 Legal/Compliance, IA-12 Research/Intelligence, IA-31 Tokenized Assets, IA-44 Economic Intelligence, IA-52 Capital Markets, IA-61 Strategic Growth, IA-96 Project Legal Structure, IA-108 Tokenization Product Creation.
Acceptance evidence: claim inventory, source/legal-reference evidence, corrected disclosures. No legal conclusion is certified beyond documented source/policy scope.

### Items 057-064 — Trust / Content / Credibility
Primary agents: IA-09 Sales/Marketing, IA-16 Brand Expansion, IA-18 Investor Retention, IA-41 Data Intelligence, IA-43 Competitor Intelligence, IA-61 Strategic Growth, IA-92 App Growth, IA-103 Experimental Products.
Acceptance evidence: claim-to-source matrix, removal of unsupported claims, live content verification.

### Items 065-072 — Deals / Data / APIs
Primary agents: IA-03 Underwriting/Analytics, IA-05 Asset Management, IA-22 New Market Expansion, IA-28 JV Deal Origination, IA-31 Tokenized Assets, IA-41 Data Intelligence, IA-45 Real Estate Intelligence, IA-69 Backend Architecture.
Acceptance evidence: live endpoint/data trace, fallback behavior, sanitized rendering, timeout/retry behavior, proof no private investor data is exposed.

### Items 073-080 — Chat / Support / Realtime
Primary agents: IA-10 Technology/Platform, IA-40 Automation Innovation, IA-72 AI Architecture, IA-74 Authentication, IA-77 Notifications, IA-80 Web, IA-86 App Automation, IA-87 App Testing.
Acceptance evidence: production chat request/response trace, sanitization, retry/fallback, session/privacy check, mobile obstruction test.

### Items 081-088 — Lead Capture / CRM / Communications
Primary agents: IA-17 Investor Acquisition, IA-18 Investor Retention, IA-19 Buyer Acquisition, IA-20 Buyer Qualification, IA-21 Buyer Follow-Up, IA-27 Partnership Development, IA-41 Data Intelligence, IA-76 App Analytics.
Acceptance evidence: CRM row IDs, consent/attribution fields, duplicate behavior, outage/retry behavior, truthful success-state verification.

### Items 089-096 — Android APK / Mobile Distribution
Primary agents: IA-67 UI Design, IA-68 Frontend Architecture, IA-73 Security Architecture, IA-78 iOS, IA-79 Android, IA-87 App Testing, IA-88 App QA, IA-90 App Deployment.
Acceptance evidence: app version, applicationId, signed APK SHA-256, MIME/download response, QR parity, gated CTA state.

### Items 097-104 — AWS / Deploy / CDN / DNS
Primary agents: IA-10 Technology/Platform, IA-40 Automation Innovation, IA-69 Backend Architecture, IA-71 API Design, IA-73 Security Architecture, IA-86 App Automation, IA-90 App Deployment, IA-91 App Monitoring.
Acceptance evidence: S3 object/deploy ID, CloudFront invalidation, HTTPS/DNS behavior, cache headers, exact release SHA parity, failure-stop behavior.

### Items 105-112 — Enterprise Adversarial QA
Primary agents: IA-11 Security/QA/Certification, IA-41 Data Intelligence, IA-73 Security Architecture, IA-87 App Testing, IA-88 App QA, IA-89 Security Testing, IA-91 App Monitoring, IA-112 Continuous Innovation Lab.
Acceptance evidence: slow-network/reload/retry/abuse/observability/red-team results. IA-11 is release gate owner; GO is prohibited while any P0/P1 lacks durable evidence.

## Execution order
1. P0 conversion + CRM + security/privacy + deploy parity.
2. P1 analytics + performance + mobile/accessibility + deals/APIs + APK.
3. P1 legal/trust/chat/communications.
4. Adversarial QA 105-112.
5. IA-11 release gate aggregates only evidence-backed PASS/FAIL.

## Certification rule
Each checklist item must produce: item ID, assigned agent(s), start/end timestamps, tool/source, artifact or route, evidence hash/commit/deploy when applicable, PASS/FAIL/BLOCKED, blocker, and remediation commit. No generic research execution counts as completion for engineering or deployment work.
