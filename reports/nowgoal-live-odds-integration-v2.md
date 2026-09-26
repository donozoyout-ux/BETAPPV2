# NOWGOAL LIVE ODDS V2.2 REAL E2E AUDIT

**Branch:** `codex/nowgoal-live-odds-integration-v2`
**Commit audited:** `59a9ea8a86d53fc4a99e752f8e350e26d8854f26`
**GitHub Actions:** [run 36261526415 — PASS](https://github.com/donozoyout-ux/BETAPPV2/actions/runs/36261526415)
**Working tree at audit start:** clean; HEAD matched the expected commit.

## Code / CI

| Check | Status | Evidence |
|---|---|---|
| PACKAGE_JSON | PASS | `origin/main` scripts restored; both Nowgoal commands retained. |
| PACKAGE_LOCK | PASS | Regenerated with npm; `jsdom@29.1.1` and `@csstools/css-tokenizer@4.0.2` resolve. |
| NPM_CI | PASS | Successful clean install in the audited CI run. |
| TYPECHECK | PASS | GitHub Actions run 36261526415. |
| LINT | PASS | GitHub Actions run 36261526415. |
| UNIT_TESTS | PASS | 290/290; GitHub Actions run 36261526415. |
| INTEGRATION_TESTS | PASS | 16/16 across the two PostgreSQL integration suites; CI used PostgreSQL/Testcontainers fixtures. |
| BUILD | PASS | GitHub Actions run 36261526415. |
| GITHUB_ACTIONS | PASS | Install, typecheck, lint, unit, PostgreSQL integration, build all succeeded for the audited commit. |

## Nowgoal

| Check | Status | Evidence |
|---|---|---|
| SOURCE_ACCESS | PASS | Earlier real public endpoint audit returned HTTP 200 for `/match/live-2993801`; this was not a qualifying analyzed-match E2E. |
| PARSER | PASS | CI/unit coverage and the earlier public-source capture. |
| FT | PASS | Earlier real-source sample: 23 rows. |
| HT | PASS | Earlier real-source sample: 7 rows. |
| AH | PASS | Earlier real-source sample contained AH observations. |
| 1X2 | PASS | Earlier real-source sample contained 1X2 observations (28 rows). |
| OU | PASS | Earlier real-source sample contained O/U observations. |
| BOOKMAKERS | PASS | Earlier sample contained Sb, Bet365, and Sbobet. |
| COLLECTOR_CADENCE | PASS | Dedicated `runForever()` path at 30 seconds; normal `runCycle()` does not call the Nowgoal collector; `--once` invokes one collection cycle. |

The public-source sample above came from the earlier audit and was not tied to a qualifying `prediction_runs` match in this V2.2 session. It is not counted as real E2E completion.

## PostgreSQL (CI integration fixtures)

| Check | Status | Evidence |
|---|---|---|
| MIGRATION_019 | PASS | PostgreSQL CI integration verified migration and tables. |
| PREDICTION_RUNS_FILTER | PASS | Requires `decision='PREDICT'`, supported competition, kickoff at/past, allowed status, numeric linked Nowgoal ID, and no finished final capture. |
| INSERT | PASS | CI integration inserted parsed test-fixture observations into an isolated PostgreSQL container. |
| DEDUP | PASS | Repeated fixture identity produced no additional row. |
| CHANGED_OBSERVATION | PASS | Changed minute/score/hash produced a new fixture row. |
| NON_ANALYZED_MATCH_BLOCK | PASS | CI integration excluded matches without a qualifying prediction run. |
| FINISHED_MATCH_FINAL_CAPTURE | PASS | Nonempty source fixture allowed final capture and removed the candidate. |
| FINISHED_RETRY_BEHAVIOR | PASS | Empty, blocked, and source-error states remain eligible; these are deterministic integration/unit cases. |

These PASS values refer to isolated automated test fixtures only. No live database URL was available locally, so no production or external database rows were read or written during this V2.2 audit.

## Google Sheets

| Check | Status | Evidence |
|---|---|---|
| CREDENTIALS | NOT_CONFIGURED | Spreadsheet ID, service-account email, and private key were absent from the runtime environment and local env files. Secret values were not printed or recorded. |
| SPREADSHEET_ACCESS | NOT_CONFIGURED | No credentials or spreadsheet ID available. |
| LIVE_ODDS_ANALYSIS_TAB | NOT_CONFIGURED | Could not inspect/create tab without access. |
| HEADER | NOT_CONFIGURED | No live spreadsheet schema inspection performed. |
| REAL_APPEND | NOT_CONFIGURED | No real observations were appended. |
| DEDUP | PASS | Duplicate protection has automated/mock coverage; live Sheet behavior was not exercised. |
| DB_SOURCE_OF_TRUTH | PASS | Observations persist to PostgreSQL before Sheet sync; Sheet failure does not undo DB writes. |
| SHEET_FAILURE_HANDLING | PASS | Automated coverage checks failed mirror sync leaves the DB capture persisted and retryable. |
| CONFIG_VARIABLES | PASS | Code/config use `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SHEETS_PRIVATE_KEY`, `GOOGLE_SHEETS_SYNC_MINUTES`. |

## Real E2E

| Check | Status | Evidence |
|---|---|---|
| REAL_E2E | BLOCKED | No `DATABASE_URL`/`DB_TEST_DATABASE_URL` and no Google Sheets credentials were present locally. |
| ANALYZED_MATCH | BLOCKED | Without a database connection, qualifying `prediction_runs` rows could not be queried; no claim is made that none exist. |
| NOWGOAL_SCHEDULE_ID | BLOCKED | No qualifying analyzed match was available to select. Earlier sample ScheduleID `2993801` is not substituted for one. |
| REAL_SOURCE_RESPONSE_FOR_ANALYZED_MATCH | BLOCKED | No candidate ScheduleID was available to fetch in this audit. |
| POSTGRES_ROWS | BLOCKED | No live database connection; only isolated CI fixture rows were used. |
| SHEET_ROWS | NOT_CONFIGURED | No spreadsheet credentials; no live Sheet rows inspected or written. |
| FINAL_CAPTURE_FOR_REAL_MATCH | BLOCKED | No real qualifying finished match was available to audit end to end. |

To run real E2E, provide the database connection through the protected runtime environment and configure `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL`, and `GOOGLE_SHEETS_PRIVATE_KEY`; `GOOGLE_SHEETS_SYNC_MINUTES` defaults to 5. Then select a real qualifying match from `prediction_runs` and verify the corresponding persisted DB and Sheet rows. No credential values belong in source, reports, logs, or commits.

## Safety

| Check | Status | Evidence |
|---|---|---|
| NO_FAKE_DATA | PASS | Fixtures were confined to isolated automated tests; none were treated as real E2E evidence or written to production. |
| PREDICTION_LOGIC_CHANGED | PASS | No prediction/strategy files differ from the branch base in this integration work. No logic changes made. |
| OFFICIAL_PREDICTION_SEMANTICS_CHANGED | PASS | No changes made. |
| EXECUTION_AUTHORITY | PASS | No execution authority added. |
