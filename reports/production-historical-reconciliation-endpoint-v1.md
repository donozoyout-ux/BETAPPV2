# Production Historical Reconciliation Diagnostics V1

## Endpoint

`GET /api/admin/historical-reconciliation`

The endpoint uses the existing OpenFootball source discovery and parser for the configured base URL, competitions supported by the current reconciliation implementation, and seasons `2024-25`, `2025-26`, and `2026-27`. It evaluates events from `2024-01-01` through the request's UTC date. Current parser rules require a finished result and a valid kickoff, exclude events before the cutoff and after the request cutoff, and retain the strict historical event-time boundary used by reconciliation.

## Security and read-only guarantee

The endpoint is not public. Set `HISTORICAL_RECONCILIATION_TOKEN` in the web service environment, then send it as `Authorization: Bearer <token>`. The Render blueprint declares the variable as `sync:false`; without a configured token the route returns `503`, and an absent or incorrect token returns `401`. The token is compared without logging it and responses use `Cache-Control: no-store`.

Production DB access is only through the application's existing pool and `DATABASE_URL`; local production DB access is not used. Reconciliation begins a PostgreSQL transaction and immediately runs `SET TRANSACTION READ ONLY`. Its SQL consists of aggregate `SELECT`s and bounded match-candidate `SELECT`s in batches of 150; statement timeout is 12 seconds, lock timeout is 2 seconds, and a candidate query is capped at 2,000 rows. The endpoint does not call any importer, regardless of `DATA_BACKFILL_ENABLED` or import command flags. It performs no `INSERT`, `UPDATE`, `DELETE`, `UPSERT`, or `TRUNCATE`.

Fetched source data uses the existing parser. Response content is limited to counts, competition/season labels, date metadata, and status. It does not expose match identifiers, team identifiers, raw odds, bookmaker data, DB connection details, or source candidate records. Results are cached in memory for 10 minutes and concurrent requests share one in-flight computation.

## Response schema example

```json
{
  "status": "RECONCILED",
  "generatedAt": "2026-09-27T12:00:00.000Z",
  "dateFrom": "2024-01-01",
  "dateTo": "2026-09-27",
  "sourceCandidates": 0,
  "eligibleCandidates": 0,
  "existingDuplicates": 0,
  "newInsertable": 0,
  "ambiguous": 0,
  "invalid": 0,
  "sourceErrors": 0,
  "competitionSummary": [
    { "competition": "Premier League", "sourceCandidates": 0, "eligible": 0,
      "duplicates": 0, "newInsertable": 0, "ambiguous": 0, "sourceErrors": 0 }
  ],
  "seasonSummary": [
    { "competition": "Premier League", "season": "2024-25", "sourceCandidates": 0,
      "eligible": 0, "duplicates": 0, "newInsertable": 0, "ambiguous": 0, "sourceErrors": 0 }
  ],
  "productionMatchCount": 0,
  "productionFinishedMatchCount": 0
}
```

The zeroes above are schema examples only; they are not production measurements.

## Verification

- `npm ci`: PASS
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run test:unit`: PASS (59 files, 342 tests)
- `npm run build`: PASS

Production reconciliation has not been run. No production import was run.
