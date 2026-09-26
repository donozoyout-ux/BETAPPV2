# Nowgoal Live Odds Analysis Integration V2.1 audit

- Branch: `codex/nowgoal-live-odds-integration-v2`
- Base: `origin/main` at `587f96e70a7ff87ccb120473710c2a0f44fd6e4c`
- Migration: `019_nowgoal_live_odds_analysis_v1.sql`
- Package scripts restored from `origin/main`; V2 Nowgoal audit and Sheet smoke scripts retained.
- Dependency lock regenerated with npm; clean `npm ci` passed. `jsdom@29.1.1` and `@csstools/css-tokenizer@4.0.2` resolve.
- Live collector scheduling: exactly one execution path in normal service (`runForever`, configured 30 seconds); `--once` runs one explicit cycle.
- Finished match: a non-empty parsed response persists observations and may mark final capture. Empty successful response records `SOURCE_SUCCESS_NO_DATA` and remains eligible; blocked/error states are separately stored and retryable.
- Candidate filter remains fail-closed on `prediction_runs.decision='PREDICT'`, supported competition, kickoff <= now, scheduled/live/finished status, numeric Nowgoal provider ID linked by provider entity, and finished final-capture absence.
- Google Sheets remains a PostgreSQL mirror at a five-minute cadence. Render documents optional ID/service-account variables without credentials; credentials are not configured in this environment.
- Prediction logic, official semantics, Gate Inspector, thresholds, and execution/AI authority were not modified.

## Audit matrix

| Check | Status |
|---|---|
| PACKAGE_JSON_REGRESSION | PASS |
| PACKAGE_LOCK | PASS |
| NPM_CI | PASS |
| NOWGOAL_DOUBLE_COLLECTION | PASS |
| PREDICTION_RUNS_FILTER | PASS |
| POSTGRES | BLOCKED |
| POSTGRES_INSERT | BLOCKED |
| POSTGRES_DEDUP | BLOCKED |
| NON_ANALYZED_MATCH_BLOCK | BLOCKED |
| FINISHED_MATCH_FINAL_CAPTURE | PARTIAL |
| FINISHED_RETRY_BEHAVIOR | PASS (unit logic; database integration pending) |
| GOOGLE_SHEETS | NOT_CONFIGURED |
| NO_FAKE_DATA | PASS |
| PREDICTION_LOGIC_CHANGED | PASS |
| OFFICIAL_PREDICTION_SEMANTICS_CHANGED | PASS |
| TYPECHECK | PASS |
| LINT | PASS |
| UNIT_TESTS | PASS (289/289) |
| INTEGRATION_TESTS | BLOCKED (container runtime unavailable locally) |
| BUILD | PASS |
| GITHUB_ACTIONS | BLOCKED (run starts after push; not yet checked) |

PostgreSQL integration suite uses deterministic Nowgoal parser fixtures only inside an isolated PostgreSQL Testcontainer. Local run could not start because this Windows host has no working container runtime. CI is configured to run all integration suites on PostgreSQL 16 through Testcontainers.

CI run [36261080920](https://github.com/donozoyout-ux/BETAPPV2/actions/runs/36261080920) executed PostgreSQL integration successfully but failed one eligibility assertion because a fixture named skip-competition was configured as PREDICT in a supported competition. This fixture is being corrected and the run will be repeated.

Final head 7e3be3fbc8cde90a0550dbccb33f569356f3b1ae passed GitHub Actions: [run 36261286611](https://github.com/donozoyout-ux/BETAPPV2/actions/runs/36261286611). Install, typecheck, lint, unit, PostgreSQL integration, and build all passed.
