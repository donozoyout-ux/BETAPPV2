# BETAPPV2 Production Data Coverage Audit V2

**Status: BLOCKED**  
**Branch:** `codex/nowgoal-live-odds-integration-v2`  
**Audit date:** 2026-09-27

## Database access and safety

Production coverage measurement could not run. This checkout has no production `DATABASE_URL`; only `.env.example` is present, and the primary workspace has no `.env`. The production connection was not attempted and no SQL ran. No database writes were made.

The planned production audit is read-only and uses `SELECT` statements only. To complete the measurements, provide `DATABASE_URL` and `DATABASE_SSL` through a secure runtime/secrets channel for the audit, or export the existing production `/api/data-coverage` and `/api/predictions/diagnostics` responses. Do not paste database credentials into chat or commit them.

## Requested production numbers

All numeric coverage results are unavailable, not zero:

| Metric | Result |
|---|---:|
| Total matches | BLOCKED |
| Settled/completed matches | BLOCKED |
| Upcoming matches | BLOCKED |
| 30+ compatible historical settled sample | BLOCKED |
| 20+ sample | BLOCKED |
| 10+ sample | BLOCKED |
| Zero sample | BLOCKED |
| Matches without prematch odds | BLOCKED |
| Matches waiting for metadata | BLOCKED |
| Available date range | BLOCKED |
| Competition and season breakdowns | BLOCKED |

The exact sample buckets (`0`, `1–9`, `10–19`, `20–29`, `30–49`, `50–99`, `100+`) and requested readiness categories are present in the companion JSON with null counts. Null means unmeasured because access was unavailable.

## Coverage tables

Competition coverage requires `competition`, `settled_matches`, `matches_with_odds`, `30_plus_sample`, `20_plus_sample`, and `zero_sample`; season coverage requires the same fields grouped by season. Both tables are blocked until the production database or production diagnostics data is available.

Readiness counts for `READY_FOR_PREDICTION`, `WAITING_FOR_SAMPLE`, `WAITING_FOR_ODDS`, `WAITING_FOR_METADATA`, `BLOCKED_BY_GATE`, and `NO_HISTORICAL_DATA` are also blocked. They must be derived from real current production matches and existing persisted odds-analysis inputs using current gate semantics; no prediction runs were executed for this audit.

## Historical leakage

The existing Prediction V1 evaluator requires `historical.kickoffAt < target.kickoffAt`, so equal-time and future candidates are excluded in the code path. Production candidate records could not be checked. Therefore the code-level guard is known, but the requested production-row leakage check remains **PARTIAL**.

## Backfill impact

No 1-, 2-, or 3-season backfill recommendation is made before measuring current coverage. Depending on the chosen source and a separate approved import, likely destination tables include `matches`, `leagues`, `teams`, `provider_entities`, `odds_snapshots`, `prediction_historical_examples`, `historical_csv_imports`, `historical_market_odds`, and `openfootball_imports`. This audit changed none of them.

## Completion needed

Provide the production database connection to the audit runtime securely, or supply fresh production exports of the two existing diagnostics endpoints. Then rerun the strictly read-only measurement to replace the null counts and produce competition/season tables. Until then, no real coverage count, missing-odds total, metadata gap total, or backfill need can be stated accurately.

Machine-readable fields and statuses are in [`production-data-coverage-audit-v2.json`](./production-data-coverage-audit-v2.json).
