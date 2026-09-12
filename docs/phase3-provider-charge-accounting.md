# Provider charge accounting

The production observer found provider receipts above settled token estimates.
An estimate must never erase a higher charge reported by the provider.

- Settlement keeps the greater of the conservative token estimate and the
  validated gateway response cost. Decimal conversion uses integers and rounds
  upward at nanodollar precision.
- A gateway response without cost needs a matching read-only generation receipt.
  Only the original gateway credential goes to the fixed gateway origin. Lookup
  retries one ingestion 404 after two seconds; each read has a five-second bound.
  These GETs never create or retry inference.
- Missing or invalid cost retains the whole reservation as uncertain. The
  generation ID survives cancellation and invalid usage so a later accounting
  review can find the corresponding charge. Cancelled streams do not query a
  receipt while inference could still be running.
- Catalog `input_tiers`/`output_tiers` and cache tiers use their published `cost`
  fields. The maximum of all applicable tariffs participates in the full-context
  reservation.
- Each quote reserves USD 0.0002 for the two published team-wide fixed fees
  (Provider Allowlist and Zero Data Retention), without asserting which are
  enabled. The allowance remains in the conservative settled upper bound; it is
  not reported as an actual invoice amount.
  Paid Custom Reporting metadata is rejected before provider admission because
  its per-write cost is outside this envelope.
- Malformed stream evidence cannot reuse an earlier apparently valid charge.

Sources verified September 12, 2026:

- [Provider prices and add-on fees](https://vercel.com/docs/ai-gateway/pricing)
- [Generation receipt fields](https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api)
- [Response cost metadata](https://vercel.com/academy/ai-gateway/ai-gateway-pricing)
- [Reporting headers](https://vercel.com/docs/ai-gateway/observability-and-spend/custom-reporting)

This change preserves USD 200/day and global concurrency policy. It does not
rewrite historical settlements, release uncertain charges, configure native
Vercel budgets, or certify all account spending outside the instrumented
backend. Historical discrepancies require their real receipts and a separate
audited accounting correction. The live receipt observer remains the acceptance
check for this patch; unit fixtures alone are not production reconciliation.
