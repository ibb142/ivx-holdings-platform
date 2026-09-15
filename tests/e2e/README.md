# Reels smoke checks and production playback

Run the smoke check against the intended landing deployment:

```bash
LANDING_BASE=https://ivxholding.com npx playwright test --config=tests/e2e/playwright.config.ts
```

The test uses the actual Reels navigation and observes `/api/reels?type=reel`.
It gives the application's own retries 20 seconds to recover. If every observed
response is HTTP 200 and explicitly reports unavailable data, Playwright records
the playback test as **skipped** with a reason and a `feed-health` attachment.
That attachment records `playbackVerified: false`. No response, malformed data,
unexpected error codes, HTTP errors, and failures to decode or advance an
available video still fail the test. Available cached videos marked degraded
continue through the playback assertions.

For required production playback:

```bash
IVX_REELS_REQUIRE_PLAYBACK=1 LANDING_BASE=https://ivxholding.com npx playwright test --config=tests/e2e/playwright.config.ts
```

The live certificate workflow sets this flag explicitly, including on PR runs.
It cannot issue a playback certificate for an unavailable feed. An omitted
smoke test does not repair missing assets or approve other failing CI checks.
