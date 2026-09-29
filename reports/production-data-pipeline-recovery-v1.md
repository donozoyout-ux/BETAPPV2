# Production Data Pipeline Recovery V1

## Result

**Root cause found:** production Render configuration supplied an API-Football key slot but set `API_FOOTBALL_ENABLED=false` for both web and worker. Therefore `ApiFootballProvider.configured` was always false and its pre-match fallback scheduler returned without provider requests. This is a configuration/wiring failure, not a prediction score, threshold, or UI failure.

The recovery enables API-Football in the Render blueprint without exposing or changing `API_FOOTBALL_KEY`. If the secret is absent at runtime, the provider remains safely disabled and emits `API_FOOTBALL_RUNTIME_STATUS`; it never logs the key.

## Pipeline status

| Stage | Status | Finding |
|---|---|---|
| Fixture discovery | PASS | Football collectors run before pre-match collectors. |
| API-Football instantiation | PARTIAL → recovered | Provider is instantiated, but production flag disabled it. Blueprint now enables it. |
| API-Football scheduler | PASS | `runForever()` is launched in worker mode; `--once` invokes one cycle. |
| API-Football request/response diagnostics | PASS | Added safe `API_FOOTBALL_*` request/response/normalization/cycle events. |
| Nowgoal instantiation/scheduler | PASS | `NOWGOAL_ENABLED=true`; classic collector runs after fixture collection in each main cycle. |
| Nowgoal fixture/snapshot diagnostics | PASS | Existing `PREMATCH_*` events cover selection, provider calls, normalization, snapshots and analysis. Nowgoal now also writes safe collection-state success aggregates. |
| Provider fallback | PASS | Before persistence, each provider yields when the other already has snapshots for the same internal fixture (`NOWGOAL_ALREADY_SELECTED` / `API_FOOTBALL_ALREADY_SELECTED`). When one source has no result, the other remains eligible. |
| Snapshot → analysis | PASS with explicit outcomes | `appendManyAndAnalyze` runs analysis after any inserted snapshot; `NO_NEW_SNAPSHOTS` and `ANALYSIS_FAILED` are logged explicitly. |
| Analysis → candidate/run | PASS | Latest analysis is a required target join. No analysis correctly produces no candidate/run; scoring/gates were not changed. |
| Production diagnostics endpoint | PASS | `GET /api/data-pipeline-status` returns flags, checkpoint times/cursors, collection aggregates and truncated errors only. |

## Exact answers

**“Fixture geliyor ama odds neden gelmiyor?”** For the observed blank fixtures, public production evidence established missing analysis but could not expose fixture-scoped provider logs. The concrete recoverable configuration cause is that API-Football fallback was disabled (`API_FOOTBALL_ENABLED=false`), leaving Nowgoal as the only source. When Nowgoal lacks or cannot link a fixture, there was no fallback request.

**“Odds geldiğinde neden odds_analysis_run oluşmuyor?”** The code invokes analysis only when at least one snapshot is newly inserted. `inserted=0` is an intentional duplicate/no-change result and reports `NO_NEW_SNAPSHOTS`; thrown analysis is reported as `ANALYSIS_FAILED`. No score, bookmaker, freshness, or prediction threshold suppresses an analysis run after a new snapshot. The new logs distinguish these cases.

## Guardrails

- No prediction algorithm, score computation, threshold, UI, Sheets, or historical backfill change.
- No production DB write/import/backfill was performed during diagnosis.
- API keys and raw odds are omitted from logs and endpoint output.
- Existing production Render logs remain required to resolve a specific fixture's Nowgoal reason (`NO_ODDS`, mapping, or provider failure).
