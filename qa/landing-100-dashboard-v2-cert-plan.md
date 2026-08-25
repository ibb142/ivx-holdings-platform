# Landing 100-Worker Dashboard V2 — Acceptance Gates

Target: owner-only, production-backed, aviation/GPS-style control tower for IA-013..IA-112.

PASS requires:
- exactly 100 worker rows loaded from the durable enterprise ledger
- no simulated telemetry or fabricated progress
- 5-second live refresh
- radar-style fleet overview derived only from worker status buckets
- mission strip: WORKING / TESTING / DEPLOYING / VERIFYING / COMPLETED / BLOCKED / FAILED
- per-agent task, tool, source reference, evidence SHA, activity time, counters, success rate
- fleet alert panel for blocked/failed/owner-action workers
- proof meter showing evidence coverage out of 100
- owner-only API remains the single source of truth
- no physical GPS claims; radar is an operational visualization only
- mobile-safe layout and scroll behavior
