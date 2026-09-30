# Production Analysis Data-Flow Audit V1

**Status: PARTIAL, production-safe.** Snapshot taken from public `GET` endpoints at 2026-09-29T17:00Z (approximately). No production database connection, write, import, backfill, deployment, or configuration change was made.

## Executive finding

This is **not a fixture-discovery or frontend-mapping failure** for the five blank sample fixtures. All six fixtures are present in `/api/dashboard`, and each has a working per-match analysis/prediction API response. Russia–Iran demonstrates the complete persisted-data path: 760 visible snapshot observations across six Nowgoal bookmakers, an ODDS_V1 analysis, candidates, and 65 prediction runs.

Australia–Brazil, Moldova–Faroe Islands, Finland–Belarus, Spain–Croatia, and Czechia–England stop before `odds_analysis_runs`: their analysis endpoint explicitly returns `NOT_GENERATED`, their gates report `NO_ODDS_ANALYSIS`, and prediction detail contains zero runs. The public API does not expose raw per-fixture collector events or raw snapshots, so it cannot distinguish `NO_PREMATCH_SELECTION`, `NO_PROVIDER_REQUEST`, `PROVIDER_NO_DATA`, `NO_NORMALIZED_QUOTES`, or `NO_ODDS_SNAPSHOT`. Those are deliberately reported as `UNKNOWN`, not guessed.

## Per-fixture trace

`UNKNOWN` means the required raw DB/log fact is not publicly readable; it is not a zero. `0 (public summary)` means the currently exposed Nowgoal upcoming-summary feed has no row, which is insufficient to prove a raw-table zero. For Russia, the snapshot total is the sum of exposed `odds_summary.snapshot_count` values (not a distinct raw-row API).

| Fixture | match_id | Competition / kickoff (UTC) | Fixture + metadata | odds_snapshot_count | bookmaker_count | latest_odds_timestamp | odds_analysis_run_count / latest status | prediction candidate | prediction runs / score / status | API visibility | First confirmed missing stage / reason |
|---|---|---|---|---:|---:|---|---|---|---|---|---|
| Australia–Brazil | `b8d841e2-545d-49c7-add1-f3ea40177182` | Friendlies / 2026-09-29T10:00:00Z | EXISTS; finished | UNKNOWN (finished fixture is outside upcoming feed) | UNKNOWN | UNKNOWN | 0 / `NOT_GENERATED` | no | 0 / — / `NOT_GENERATED` | analysis, prediction and gates all HTTP 200 | `NO_ODDS_ANALYSIS`; upstream reason UNKNOWN |
| Moldova–Faroe Islands | `28cef76d-11c7-4eb6-9ec3-56a50cb897fc` | UEFA Nations League C / 2026-09-29T16:00:00Z | EXISTS; live | 0 (public summary) | 0 (public summary) | UNKNOWN | 0 / `NOT_GENERATED` | no | 0 / — / `NOT_GENERATED` | analysis, prediction and gates all HTTP 200 | `NO_ODDS_ANALYSIS`; upstream reason UNKNOWN |
| Finland–Belarus | `6d105140-5b89-4bbd-8093-105a89ece4b1` | UEFA Nations League C / 2026-09-29T16:00:00Z | EXISTS; live | 0 (public summary) | 0 (public summary) | UNKNOWN | 0 / `NOT_GENERATED` | no | 0 / — / `NOT_GENERATED` | analysis, prediction and gates all HTTP 200 | `NO_ODDS_ANALYSIS`; upstream reason UNKNOWN |
| Russia–Iran | `06aa4a70-815a-473a-a8e7-e1038a2be91a` | Friendlies / 2026-09-29T16:05:00Z | EXISTS; live | 760 (visible summary total) | 6 summary providers; selected candidate uses 4 | not exposed | at least 1 / eligible, latest generated 2026-09-29T16:23:48.221Z | yes; best gate candidate HOME Asian Handicap +0.75 | 65 / 67.84 best gate candidate / `LOCKED_SKIP` | analysis, prediction and gates all HTTP 200 | none before prediction; `INSUFFICIENT_HISTORICAL_SAMPLE`, `LOW_PREDICTION_SCORE`, `LOCK_WINDOW_MISSED` prevent official prediction |
| Spain–Croatia | `9f40f8c6-470d-42c0-92d6-f6fdd0d59cf7` | UEFA Nations League A / 2026-09-29T18:45:00Z | EXISTS; scheduled | 0 (public summary) | 0 (public summary) | UNKNOWN | 0 / `NOT_GENERATED` | no | 0 / — / `NOT_GENERATED` | analysis, prediction and gates all HTTP 200 | `NO_ODDS_ANALYSIS`; upstream reason UNKNOWN |
| Czechia–England | `7e229054-5ca3-4139-9208-2cee02fdb5f0` | UEFA Nations League A / 2026-09-29T18:45:00Z | EXISTS; scheduled | 0 (public summary) | 0 (public summary) | UNKNOWN | 0 / `NOT_GENERATED` | no | 0 / — / `NOT_GENERATED` | analysis, prediction and gates all HTTP 200 | `NO_ODDS_ANALYSIS`; upstream reason UNKNOWN |

### Required stage-by-stage result

| Stage | Russia–Iran | Other five sample fixtures |
|---|---|---|
| 1. Fixture exists | EXISTS | EXISTS |
| 2. Teams/competition metadata exists | EXISTS | EXISTS |
| 3. Classic pre-match collector selects fixture | inferred by downstream persistence | UNKNOWN: worker event is not publicly readable |
| 4. Provider request made | inferred by persisted Nowgoal data | UNKNOWN: worker event is not publicly readable |
| 5. Provider returns odds | inferred by persisted Nowgoal data | UNKNOWN |
| 6. Odds normalized | inferred by persisted Nowgoal data | UNKNOWN |
| 7. `odds_snapshots` written | visible summary proves persisted snapshots | not proven; zero upcoming-summary rows for four active fixtures |
| 8. `odds_analysis_runs` created | EXISTS | `NO_ODDS_ANALYSIS` (explicit API result) |
| 9. Prediction candidate created | EXISTS | `NO_PREDICTION_CANDIDATE`, downstream of no analysis |
| 10. Prediction run created | EXISTS | `NO_PREDICTION_RUN`, downstream of no analysis |
| 11. API returns analysis/prediction | EXISTS | EXISTS and correctly returns `NOT_GENERATED` |
| 12. Frontend renders status/score/candidate | API contract supplies the displayed state | no `UI_MAPPING_PROBLEM` evidenced; API truthfully supplies no analysis/run |

## Classification A–F

| Class | Finding | Evidence |
|---|---|---|
| A) Fixture discovery | Not the failure | All requested fixtures, IDs, teams, competition and kickoff are present in dashboard API. |
| B) Odds collection | Strongly suspected upstream gap, exact substage unproven | Five fixtures have no public current odds summary and no analysis. Public API lacks per-fixture provider/normalization/selection trace. |
| C) Odds analysis | Confirmed absent for five fixtures | `/api/odds-analysis/:matchId` returns `NOT_GENERATED`; gates return `NO_ODDS_ANALYSIS`. |
| D) Prediction generation | Consequence, not first break | No target analysis means no candidate/run for the five. Russia proves generation works; it skips officially only because its normal gates fail. |
| E) API | Not a rendering/data-translation failure; diagnostic observability is incomplete | All three per-match endpoints return HTTP 200 with coherent state. API does not disclose raw snapshot count/timestamp or collector event/reason. |
| F) Frontend rendering | No evidence of a UI mapping problem | Dashboard symptom agrees with the per-match API (`NOT_GENERATED`, no candidate, no runs). |

## Classic collector and requested runtime markers

The requested target branch `codex/nowgoal-live-odds-integration-v2` is at `dbff205810e0f7b5f74c658a84829ae8cfe29e0c`. Its Render worker configuration sets `COLLECTOR_ENABLED=true`, `NOWGOAL_ENABLED=true`, and includes Friendlies plus Nations League A/C in `SUPPORTED_COMPETITIONS`. Its worker constructs the classic `OddsCollector`, emits `PREMATCH_COLLECTOR_RUNTIME_STATUS` immediately before `oddsCollector.runCycle()`, and the classic collector emits the requested `PREMATCH_ODDS_CYCLE_START`, fixture candidate/selected/skipped, provider request/response, normalized, snapshot-written, analysis-created, and cycle-end markers.

Production `/health` shows a healthy Nowgoal provider with `344 fixtures reachable`, last checked `2026-09-29T16:57:23.465Z`, and a worker last success at `2026-09-29T16:57:21.138Z`. This proves the worker/provider health path is alive. It does **not** prove the deployed process is that exact Git SHA or that the named markers were emitted for a given fixture: Render logs are not a public API. Therefore the runtime-log conclusion is `RUNTIME_WIRING_PRESENT; PRODUCTION_MARKER_OBSERVATION_UNAVAILABLE`.

## Safe verification performed

- Public GET only: `/health`, `/api/dashboard`, `/api/odds/upcoming`, `/api/odds-analysis/upcoming`, `/api/odds-analysis/:matchId`, `/api/predictions/:matchId`, `/api/predictions/:matchId/gates`, `/api/predictions/diagnostics`.
- Reviewed target-branch collector, provider, worker and Render wiring without checkout/deploy.
- No production write, import, backfill, migration, prediction logic, threshold, UI, or configuration modification.

## Diagnostic limitation and next safe proof

To convert the five upstream `UNKNOWN`s into one explicit reason code, inspect the existing worker log stream for each fixture's competition/kickoff and correlate `PREMATCH_*` markers. A restricted read-only per-match diagnostic aggregate could also expose raw snapshot count, latest capture time, distinct bookmaker count, last checkpoint/cycle result and resolver reason. This audit does not add it because it would not be deployed to the production process during this task.
