# Nowgoal Live Odds Analysis Integration V2 audit

- Branch: `codex/nowgoal-live-odds-integration-v2`
- Base: current `origin/main` at `587f96e70a7ff87ccb120473710c2a0f44fd6e4c` (Prediction V1, Gate Inspector Human Mode, dashboard and odds-neighbor work present)
- Migration: `019_nowgoal_live_odds_analysis_v1.sql`; `016` is already used by current main, so schema ordering is preserved by adding the next available migration.
- Nowgoal structured endpoint: HTTP 200 from `/Ajax/SoccerAjax?type=4&id=<ScheduleID>&p=<timestamp>`; 30 real source observations; 3 bookmakers; FT 23; HT 7; AH, 1X2, O/U parsed.
- Candidate filter: SQL is fail-closed on `prediction_runs`, supported competition, kickoff, status, and numeric Nowgoal provider ID. PostgreSQL-backed A/B/C integration scenarios are not confirmed locally.
- Poll cadence: separate serialized Nowgoal collector timer, default 30 seconds; Sheets sync is independently throttled to 5 minutes.
- Google Sheets: credentials are absent. `npm run odds:live-sheet-smoke` returned `SYNC_DISABLED`, with no fabricated rows or append.
- PostgreSQL: BLOCKED locally; local port 5432 refused and no container runtime is available. CI workflow has the PostgreSQL integration job, but branch CI has not yet completed.
- Prediction logic and official semantics are unchanged; no AI or execution authority was added.

## Requested status matrix

| Check | Status |
|---|---|
| NOWGOAL_LIVE_SOURCE | PASS |
| LIVE_ODDS_PARSER | PASS |
| AH | PASS |
| 1X2 | PASS |
| OVER_UNDER | PASS |
| FT | PASS |
| HT | PASS |
| MULTI_BOOKMAKER | PASS |
| HISTORY_ROWS | PASS |
| PREDICTION_RUNS_FILTER | PARTIAL |
| ANALYZED_MATCH_CAPTURE | BLOCKED |
| NON_ANALYZED_MATCH_BLOCK | PARTIAL |
| POSTGRES | BLOCKED |
| DEDUPLICATION | PARTIAL |
| FINISHED_MATCH_FINAL_CAPTURE | PARTIAL |
| LIVE_COLLECTION_INTERVAL | PASS |
| GOOGLE_SHEETS | NOT_CONFIGURED |
| SHEET_TAB | PARTIAL |
| SHEET_BATCH_SYNC | PARTIAL |
| SHEET_DUPLICATION_PROTECTION | PARTIAL |
| NO_FAKE_DATA | PASS |
| PREDICTION_LOGIC_CHANGED | PASS (no change) |
| OFFICIAL_PREDICTION_SEMANTICS_CHANGED | PASS (no change) |
| EXECUTION_AUTHORITY | PASS (none added) |
| AI_PREDICTION_AUTHORITY | PASS (none added) |
| TYPECHECK | PASS |
| LINT | PASS |
| UNIT_TESTS | PARTIAL |
| POSTGRES_TESTS | BLOCKED |
| BUILD | PASS |
| CI | BLOCKED (not yet run on remote branch) |

Unit-suite notes: current-main Windows runs have unrelated LF-only YAML assertions and a missing jsdom CSS transitive package; 3 V2 mocked Sheets tests also currently fail and require follow-up. Targeted parser and collector tests pass.
