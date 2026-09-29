# Production Analysis Data-Flow Audit V1

**Status: PARTIAL, production-safe.** Snapshot taken from public `GET` endpoints at 2026-09-29T17:00Z. No production database connection, write, import, backfill, deployment, or configuration change was made.

## Executive finding

This is not a fixture-discovery or frontend-mapping failure for the five blank sample fixtures. All six fixtures are present in `/api/dashboard`, and each has a working per-match analysis/prediction API response. Russia–Iran demonstrates the complete persisted-data path: 760 visible snapshot observations across six Nowgoal bookmakers, an ODDS_V1 analysis, candidates, and 65 prediction runs.

Australia–Brazil, Moldova–Faroe Islands, Finland–Belarus, Spain–Croatia, and Czechia–England stop before `odds_analysis_runs`: analysis is explicitly `NOT_GENERATED`, gates report `NO_ODDS_ANALYSIS`, and prediction detail contains zero runs. The public API does not expose raw per-fixture collector events or raw snapshots, so `NO_PREMATCH_SELECTION`, `NO_PROVIDER_REQUEST`, `PROVIDER_NO_DATA`, `NO_NORMALIZED_QUOTES`, and `NO_ODDS_SNAPSHOT` remain `UNKNOWN` rather than guessed.

## Per-fixture trace

`UNKNOWN` is not zero. `0 (public summary)` means the exposed current Nowgoal summary has no row; it does not prove the raw DB table is empty. Russia's total is the sum of exposed `odds_summary.snapshot_count` values.

| Fixture | match_id | Competition / kickoff UTC | snapshots / bookmakers / latest timestamp | analysis | candidate / prediction | API visibility | explicit reason |
|---|---|---|---|---|---|---|---|
| Australia–Brazil | `b8d841e2-545d-49c7-add1-f3ea40177182` | Friendlies / 2026-09-29T10:00:00Z | UNKNOWN / UNKNOWN / UNKNOWN | 0, `NOT_GENERATED` | no / no, —, `NOT_GENERATED` | all per-match endpoints HTTP 200 | `NO_ODDS_ANALYSIS`; upstream UNKNOWN |
| Moldova–Faroe Islands | `28cef76d-11c7-4eb6-9ec3-56a50cb897fc` | Nations League C / 2026-09-29T16:00:00Z | 0 public summary / 0 / UNKNOWN | 0, `NOT_GENERATED` | no / no, —, `NOT_GENERATED` | HTTP 200 | `NO_ODDS_ANALYSIS`; upstream UNKNOWN |
| Finland–Belarus | `6d105140-5b89-4bbd-8093-105a89ece4b1` | Nations League C / 2026-09-29T16:00:00Z | 0 public summary / 0 / UNKNOWN | 0, `NOT_GENERATED` | no / no, —, `NOT_GENERATED` | HTTP 200 | `NO_ODDS_ANALYSIS`; upstream UNKNOWN |
| Russia–Iran | `06aa4a70-815a-473a-a8e7-e1038a2be91a` | Friendlies / 2026-09-29T16:05:00Z | 760 / 6 / not exposed | at least 1; eligible; latest 2026-09-29T16:23:48.221Z | yes / yes, 67.84, `LOCKED_SKIP` | HTTP 200 | no upstream failure; official prediction blocked by historical sample, score, lock window |
| Spain–Croatia | `9f40f8c6-470d-42c0-92d6-f6fdd0d59cf7` | Nations League A / 2026-09-29T18:45:00Z | 0 public summary / 0 / UNKNOWN | 0, `NOT_GENERATED` | no / no, —, `NOT_GENERATED` | HTTP 200 | `NO_ODDS_ANALYSIS`; upstream UNKNOWN |
| Czechia–England | `7e229054-5ca3-4139-9208-2cee02fdb5f0` | Nations League A / 2026-09-29T18:45:00Z | 0 public summary / 0 / UNKNOWN | 0, `NOT_GENERATED` | no / no, —, `NOT_GENERATED` | HTTP 200 | `NO_ODDS_ANALYSIS`; upstream UNKNOWN |

## Stages and A–F classification

| Stage / class | Result |
|---|---|
| 1–2 fixture and metadata; A discovery | EXISTS for every fixture; not the failure. |
| 3–6 pre-match selection, request, provider response, normalization; B collection | Russia is proven by persisted Nowgoal data. Other five: UNKNOWN because fixture-scoped worker events are not public. |
| 7 snapshots | Russia persisted. Four active fixtures have zero public summary rows; Australia is outside that feed. |
| 8 analysis; C | Russia EXISTS; all five explicitly `NO_ODDS_ANALYSIS`. |
| 9–10 candidate/run; D | Russia EXISTS. Five have `NO_PREDICTION_CANDIDATE` and `NO_PREDICTION_RUN` as downstream effects. |
| 11 API; E | Correctly returns coherent data/`NOT_GENERATED` with HTTP 200; raw diagnostics are incomplete. |
| 12 frontend; F | No `UI_MAPPING_PROBLEM` evidence: dashboard symptom matches per-match API state. |

## Classic collector/runtime markers

Target branch `codex/nowgoal-live-odds-integration-v2` (`dbff205810e0f7b5f74c658a84829ae8cfe29e0c`) wires the classic `OddsCollector`; Render config enables `COLLECTOR_ENABLED` and `NOWGOAL_ENABLED` and includes Friendlies plus Nations League A/C. `PREMATCH_COLLECTOR_RUNTIME_STATUS` is logged immediately before `oddsCollector.runCycle()`. The target's classic path contains all requested `PREMATCH_*` markers: cycle start/end, fixture candidate/selected/skipped, provider request/response, normalized, snapshot written, and analysis created.

Production `/health` reports Nowgoal healthy, `344 fixtures reachable`, and worker last success `2026-09-29T16:57:21.138Z`. This proves live worker/provider health, not the deployed Git SHA nor individual marker emission: public API does not expose Render logs. Runtime conclusion: `RUNTIME_WIRING_PRESENT; PRODUCTION_MARKER_OBSERVATION_UNAVAILABLE`.

## Safe checks and limitation

Only public GET endpoints were used: health, dashboard, upcoming odds/analyses, per-match analysis/prediction/gates, and prediction diagnostics. No business logic, thresholds, UI, production data, or deployment changed. To convert upstream `UNKNOWN` to an explicit reason, inspect existing Render worker logs for the fixture competition/kickoff and correlate `PREMATCH_*` events.
