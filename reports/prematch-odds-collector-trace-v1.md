# Pre-match Odds Collector Trace V1

## FLOW

Audited branch: `codex/nowgoal-live-odds-integration-v2`, base `c6b5e186952c17ae991d4beed47b3d7d42f51cac`.

The observability changes cover both pre-match sources already wired in `src/worker.ts`; they do not instrument or modify the Nowgoal live odds collector.

- Nowgoal: worker conditionally constructs `OddsCollector` when `NOWGOAL_ENABLED`; worker `runCycle()` calls `OddsCollector.runCycle()` every `COLLECTOR_INTERVAL_MS` (Render blueprint: 900000 ms). That function calls provider health and then `NowgoalProvider.getPrematchOddsForDate()` for the present day through `NOWGOAL_FUTURE_DAYS` (Render blueprint: 3 days).
- `NowgoalProvider.getPrematchOddsForDate()` issues the existing fixture diary request and one existing odds diary request per configured company. No requests were added. `normalizeNowgoalOddsRows()` maps only supported `1x2`, `HDP`, `OU`, and `CR` rows into normalized quotes.
- Provider fixture filters produce safe skip events for non-upcoming state, invalid fixture fields/time, or no normalized odds. Accepted provider fixtures are candidates; `OddsCollector.runCycle()` then calls `OddsRepository.resolveMatchDetailed()`. Existing resolution reasons are logged unchanged; a resolved DB fixture is selected.
- `OddsRepository.appendManyAndAnalyze()` behavior is unchanged. We log its returned inserted-snapshot count and whether an analysis run was created. No-new-snapshot is logged as `NO_NEW_SNAPSHOTS`.
- API-Football: same stage event vocabulary is added to `ApiFootballPrematchOddsCollector`; provider methods now accept an optional HTTP status observer, which does not change request URL, headers, rate limit, retry, or scheduling.
- Live collector, prediction engine/thresholds, schema, historical import/backfill, Google Sheets, and odds analysis algorithm were not changed.

## LOG_POINTS

All new log messages are structured JSON and use the requested event string as both `event` and message:

- `PREMATCH_ODDS_CYCLE_START` — provider, start time, scan days.
- `PREMATCH_PROVIDER_REQUEST` — provider, request type and date (or safe internal match ID for per-fixture API-Football odds request); never URL/headers.
- `PREMATCH_PROVIDER_RESPONSE` — HTTP status, request success, count, and safe error class on failure. Provider response body is never logged.
- `PREMATCH_FIXTURE_CANDIDATE` — competition, kickoff, provider, status, quote count; pre-match Nowgoal logs a truncated one-way hash (`fixtureRef`) instead of the raw provider fixture ID.
- `PREMATCH_ODDS_NORMALIZED` — source row count, normalized quote count and candidate count.
- `PREMATCH_FIXTURE_SELECTED` — internal match ID, competition, kickoff, provider, status, existing resolver reason, quote count.
- `PREMATCH_FIXTURE_SKIPPED` — safe fixture reference or internal match ID, competition/kickoff when available, status and actual skip/resolver reason.
- `PREMATCH_SNAPSHOT_WRITTEN` — internal match ID and inserted count.
- `PREMATCH_ANALYSIS_CREATED` — internal match ID, created boolean, status and known skip/failure reason.
- `PREMATCH_CYCLE_END` — status and cycle aggregate counts.
- `PREMATCH_ODDS_ENV_STATUS` — worker startup presence only (`SET` / `NOT_SET`) for `NOWGOAL_ENABLED`, `API_FOOTBALL_PREMATCH_ODDS_ENABLED`, `COLLECTOR_INTERVAL_MS`, `NOWGOAL_BASE_URL`, and `NOWGOAL_COMPANY_IDS`. Values and secrets are not logged. Since Render may override blueprint settings, these runtime worker logs are the authoritative post-deploy presence check.

## SKIP_REASONS

- Provider gates use direct condition labels: `NOT_UPCOMING`, `INVALID_FIXTURE`, `NO_ODDS`.
- Resolver skips log its existing reason enum: `NO_CANDIDATE`, `LEAGUE_MISMATCH`, `TEAM_MISMATCH`, `AMBIGUOUS`, `KICKOFF_MISMATCH`.
- API-Football disabled provider logs `PROVIDER_DISABLED`; candidate cap uses `MAX_FIXTURES_PER_CYCLE`; failed Nowgoal provider health ends the cycle as `PROVIDER_UNAVAILABLE`.
- Provider/date fetch failure records `requestSuccess:false`, safe HTTP status if available and error class; it does not record exception message/body in the new event.
- No season, team ID, raw odds value, provider ID or full request URL is added to logs.

## ENV_STATUS

The checked-in Render blueprint declares worker `NOWGOAL_ENABLED=true`, `NOWGOAL_LIVE_ODDS_ENABLED=true`, live interval 30 seconds, `API_FOOTBALL_PREMATCH_ODDS_ENABLED=true`, `API_FOOTBALL_ENABLED=false`, and `COLLECTOR_INTERVAL_MS=900000`. These are blueprint declarations, not verified live Render overrides. No production secret or environment value was read. After deploy, inspect the worker's `PREMATCH_ODDS_ENV_STATUS` line for presence only. `NOWGOAL_LIVE_ODDS_*` is deliberately not instrumented by this pre-match-only change.

## TEST_STATUS

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run build`: PASS.
- `npm run test:unit`: PASS — 59 files, 345 tests.
- `npm test`: PARTIAL — 59 files passed; two integration suites could not initialize because Testcontainers reports `Could not find a working container runtime strategy`: `test/integration/nowgoal-live-odds.test.ts` and `test/integration/repository.test.ts`. 345 tests passed and 16 integration tests were skipped. No integration assertion failure was reached.
- Added unit coverage for candidate/selection, resolver and no-odds skip reason, request/response status, normalized count, inserted snapshot, analysis-created result, and no raw odds/provider-ID/secret leakage.

## SECURITY

New log payloads contain stage names, counts, HTTP status, resolver reason, competition/kickoff, and internal match UUID only after DB resolution. Before resolution, provider ScheduleID is hashed and truncated. No raw odds/response, API key/token, Authorization header, private key, DATABASE_URL, or full provider URL is included. Request volume and intervals are unchanged. `git diff --check` passed.

## EXPECTED_RENDER_LOGS

Example (counts and match IDs illustrative):

```json
{"level":30,"service":"betapp-worker","event":"PREMATCH_PROVIDER_REQUEST","provider":"nowgoal","requestType":"odds_diary","date":"2026-09-28","msg":"PREMATCH_PROVIDER_REQUEST"}
{"level":30,"service":"betapp-worker","event":"PREMATCH_PROVIDER_RESPONSE","provider":"nowgoal","requestType":"odds_diary","httpStatus":200,"requestSuccess":true,"count":123,"msg":"PREMATCH_PROVIDER_RESPONSE"}
{"level":30,"service":"betapp-worker","event":"PREMATCH_FIXTURE_SELECTED","matchId":"<internal-match-id>","competition":"UEFA Nations League A","kickoff":"2026-09-28T18:45:00.000Z","provider":"nowgoal","status":"scheduled","reason":"MATCHED_EXACT","count":3,"msg":"PREMATCH_FIXTURE_SELECTED"}
{"level":30,"service":"betapp-worker","event":"PREMATCH_SNAPSHOT_WRITTEN","matchId":"<internal-match-id>","count":3,"msg":"PREMATCH_SNAPSHOT_WRITTEN"}
{"level":30,"service":"betapp-worker","event":"PREMATCH_ANALYSIS_CREATED","matchId":"<internal-match-id>","created":true,"status":"CREATED","count":3,"msg":"PREMATCH_ANALYSIS_CREATED"}
```

In Render worker logs search for `PREMATCH_ODDS_CYCLE_START`, then the fixture's competition/kickoff on candidate/selected/skipped entries, followed by response/normalized/snapshot/analysis events. If no fixture-specific candidate/skip appears, date-level response counts and cycle end show whether the fixture reached the provider parser output. No production result is claimed before the new code is deployed.
