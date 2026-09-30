# Pre-Match Data Coverage V2

Generated: 2026-09-30. Production inspection was read-only; no collector, provider, import, backfill, database write, threshold, score, gate, or UI change was performed by this audit.

## Root cause

**G — multiple upstream problems.** The immediate measured bottleneck is pre-match odds-analysis coverage: only 4 of 23 current target fixtures have an odds-analysis run. The second measured bottleneck is eligibility: all three stored current prediction runs report `ODDS_NOT_ELIGIBLE`; their best historical samples are 5, 12, and 19, below the existing 30-sample requirement. The deployed web service also returns HTTP 404 for `/api/data-pipeline-status`, although that route exists on this branch, so the current production deployment is not demonstrably running the audited branch revision.

## Production evidence

| Coverage | Measured value | Status |
|---|---:|---|
| PREMATCH COVERAGE | 23 prediction targets | PARTIAL |
| ODDS COVERAGE | 4/84 upcoming seven-day fixtures with odds | FAIL |
| ODDS ANALYSIS COVERAGE | 4/23 current targets | FAIL |
| PREDICTION COVERAGE | 3 runs; 0 `PREDICT`; 3 `SKIP` | GATED |
| HISTORICAL COVERAGE | 326 eligible historical examples total; current max target sample 19/30 | PARTIAL |

The totals are deliberately not conflated: 84 is the existing 7-day fixture view, while 23 is the prediction diagnostic target window.

## Current pipeline trace

| Stage | Count | Percentage of target fixtures | Drop / reason |
|---|---:|---:|---|
| Fixture discovered / target | 23 | 100% | — |
| Odds analysis created | 4 | 17.4% | 19 have no analysis evidence |
| Prediction run created | 3 | 13.0% | one analyzed target has no current run |
| Candidate with historical evidence | 3 | 13.0% | stored runs only |
| Historical sample >= 30 | 0 | 0% | maximum observed sample: 19 |
| Official prediction | 0 | 0% | `ODDS_NOT_ELIGIBLE`; no qualifying sample |

The branch now provides `GET /api/data-coverage?detail=prematch` for aggregate counts, drop reasons, odds/bookmaker/complete-state coverage, prediction coverage, and competition/season historical aggregates. `GET /api/data-coverage?detail=prematch&window=24h` exposes durable 24-hour collection-state counts.

## Telemetry limitation, made explicit

The current schema persists per-fixture collection state and last checkpoints, not historical cycle events or HTTP response codes. The new endpoint therefore returns `null` plus an availability reason for collector-cycle count, normalized quote count, odds-analysis count by 24-hour cycle, and HTTP status distribution when no durable evidence exists. It does not invent those values from logs.

The endpoint also distinguishes the safe runtime flags:

- `NOWGOAL_ENABLED` / pre-match provider configuration and expected collector instantiation;
- `NOWGOAL_LIVE_ODDS_ENABLED` separately;
- `collectorStarted` only when a pre-match checkpoint has durable start evidence.

Nowgoal live odds and Nowgoal pre-match odds are separate collectors in `worker.ts`; a live collector observation is never used as evidence that the pre-match collector ran.

## Turkey–Italy-style fixture trace

For any upcoming fixture, the aggregate endpoint is intentionally anonymous. The source pipeline emits the safe sequence `PREMATCH_FIXTURE_CANDIDATE` → `PREMATCH_FIXTURE_SELECTED` → provider request/response → normalized quote count → snapshot write → analysis-created result. The matching stage persists only after a fixture resolves to the internal record, and the endpoint then reports its aggregate position. Exact fixture-level tracing remains in safe worker logs, not in this public aggregate API, to avoid exposing match identifiers or provider data.

## Why no official prediction today?

**G — multiple upstream problems:** pre-match odds coverage is sparse (4/23 analysis-ready targets), and the available current candidates are also blocked by `ODDS_NOT_ELIGIBLE`; their historical samples remain below 30. The existing score thresholds and gates are behaving as configured and were not changed.
