# Pre-match Collector Runtime Audit V1

## BRANCH

- Branch: `codex/nowgoal-live-odds-integration-v2`
- Audited HEAD: `a62b4fb39579b1ff57f9b520a03077e8c534b578`
- Working tree at audit start had only existing untracked reports; these were preserved. No production database connection, write, import, or backfill was performed.

## WORKER ENTRYPOINT

- Render worker command: `node dist/worker.js` (`render.yaml`, worker service `betapp-v2-collector`).
- `package.json` also has `start:worker = node dist/worker.js`; `dev:worker = tsx watch src/worker.ts`; `collect:once = tsx src/worker.ts --once`.
- `Dockerfile` builds `dist/worker.js`. Its default runtime command starts `dist/runtime.js`, which can supervise server and worker for non-Render worker usage; Render's explicit `dockerCommand` overrides that for the worker service. Entrypoints are consistent.

## STARTUP WIRING

**Live Nowgoal collector**

- Instantiated at `src/worker.ts`: `new NowgoalLiveOddsCollector(...)` iff `NOWGOAL_LIVE_ODDS_ENABLED` is true.
- In normal mode, started as `liveOddsCollector.runForever()` inside the `COLLECTOR_ENABLED` branch. That loop invokes `runCycle()` and waits `NOWGOAL_LIVE_ODDS_INTERVAL_SECONDS` (Render blueprint: 30s).
- It emits the observed `Nowgoal live odds cycle completed` message.

**Classic pre-match Nowgoal collector**

- Instantiated at `src/worker.ts`: `new OddsCollector(...)` iff `NOWGOAL_ENABLED` is true; otherwise `oddsCollector=null`.
- It is not a separate worker process. Normal worker loop calls `runCycle()` immediately, then sleeps `COLLECTOR_INTERVAL_MS`; within `runCycle()`, after football collection and prediction settlement/audit refresh stages, it calls `oddsCollector?.runCycle()` while the worker is not stopping.
- The first line of `OddsCollector.runCycle()` logs `PREMATCH_ODDS_CYCLE_START`, before DB checkpoint writes and the provider health check. There is no provider-health or fixture filter that can bypass this first log once `runCycle()` is invoked.
- Therefore `PREMATCH_*` events are reachable from the configured production worker entrypoint. They are skipped only if the classic collector is not instantiated (`NOWGOAL_ENABLED=false`), the main collector loop/cycle is not running or is stopped before reaching the odds stage, or the deployed artifact/log stream does not contain/use the a62b4fb logging code. Slow earlier stages can delay the odds stage in an in-progress cycle.

**API-Football pre-match collector**

- `ApiFootballPrematchOddsCollector` is always instantiated in `src/worker.ts`.
- Normal mode starts its `runForever()` in the `COLLECTOR_ENABLED` branch. It returns without issuing API calls unless `provider.configured && API_FOOTBALL_PREMATCH_ODDS_ENABLED`.
- Render YAML declares `API_FOOTBALL_ENABLED=false`; public production `/health` says `apiFootball=NOT_CONFIGURED`. It is therefore not an active production odds fallback in the observed health snapshot.

## PRODUCTION COMMAND / ENV

Render YAML declares:

| Setting | Render worker blueprint | Runtime evidence |
|---|---|---|
| Worker command | `node dist/worker.js` | configured blueprint; deployed command not independently introspectable |
| `COLLECTOR_ENABLED` | `true` | actual value not exposed |
| `NOWGOAL_ENABLED` | `true` | actual value not exposed |
| `NOWGOAL_LIVE_ODDS_ENABLED` | `true` | `/health.liveOdds=NO_DATA`, 0 tracked; this does not identify the flag value |
| `NOWGOAL_LIVE_ODDS_INTERVAL_SECONDS` | `30` | actual value not exposed |
| `COLLECTOR_INTERVAL_MS` | `900000` | actual value not exposed |
| `API_FOOTBALL_ENABLED` | `false` | `/health.apiFootball=NOT_CONFIGURED` |
| `API_FOOTBALL_PREMATCH_ODDS_ENABLED` | `true` | provider is unconfigured, so effective collector disabled |

No secret values were requested or read. The existing `PREMATCH_ODDS_ENV_STATUS` added in a62b4fb logs only environment variable presence at worker startup; it does not report the boolean's effective value and was not available in the public health response.

## PUBLIC PRODUCTION OBSERVATION

Read-only GET to `https://betappv2.onrender.com/health` returned HTTP 200 at `2026-09-28T18:34:39.316Z`:

- `worker.lastRun=2026-09-28T18:34:28.11Z`
- `worker.lastSuccess=2026-09-28T18:18:58.539Z`
- `providers.nowgoal=healthy`, `last_checked_at=2026-09-28T18:19:02.372Z`
- `liveOdds=NO_DATA`, `trackedMatches=0`
- `apiFootball=NOT_CONFIGURED`
- No deployment SHA or runtime marker in the response.

The `worker` timestamp is a `fixtures-and-statistics` checkpoint, not a direct marker that `worker.runCycle()` reached the pre-match odds stage. The Nowgoal provider status can be updated by its collector health check, but the timestamp alone does not prove which deployed code emitted it or that the same cycle created odds.

## a62b4fb PREMATCH LOG REACHABILITY

- The code in local branch HEAD `a62b4fb` has all requested `PREMATCH_*` logs in the classic pre-match path. In particular, `PREMATCH_ODDS_CYCLE_START` is emitted on entry to `OddsCollector.runCycle()`; it does not depend on fixtures or odds being returned.
- With `LOG_LEVEL=info` in Render YAML, these info events should be retained when that code runs.
- If the worker is running this exact build and `NOWGOAL_ENABLED=true`, each classic pre-match cycle must produce `PREMATCH_ODDS_CYCLE_START` before calling `NowgoalProvider.healthCheck()`. No event means the collector did not enter that method in the observed log stream, or the stream/build differs from the checked-in branch.
- User-observed live cycle messages establish the live path is logging. They do not establish that the worker is running commit a62b4fb, nor that `NOWGOAL_ENABLED` is effectively true.

## ROOT_CAUSE

**NOT_CONFIRMED.** No code wiring defect was found in `a62b4fb`: classic pre-match Nowgoal is instantiated conditionally and invoked in the normal production worker loop. The public production API cannot reveal deployed SHA or the effective `NOWGOAL_ENABLED` override. Thus we cannot prove whether the production worker has deployed a62b4fb, whether the classic flag is disabled, or whether the current run has reached the serial odds stage yet.

Likely explanations, in order to check rather than assume:

1. Render worker is still running an image/branch build older than a62b4fb (or its log view is filtering events).
2. Runtime `NOWGOAL_ENABLED` is false/NOT_SET despite the blueprint default, so `oddsCollector` is null while the independent live collector continues.
3. The current main cycle has not reached the serial odds stage yet; preceding fixture/prediction audit work can delay it.

There is no evidence that the live collector is intended to generate these pre-match events. There is also no code evidence that the API-Football collector should emit them in production while the provider is not configured.

## PRODUCTION RUNTIME VERIFICATION

**NOT_VERIFIED.** Public API provided no deployed SHA and no pre-match runtime state. Live collector logs alone do not prove the classic collector started.

## MINIMUM DIAGNOSTIC MARKER

Added a safe `PREMATCH_COLLECTOR_RUNTIME_STATUS` marker at the actual worker call site, and one bootstrap marker when `COLLECTOR_ENABLED=false`. Fields are only:

- `enabled`: effective `NOWGOAL_ENABLED` boolean
- `instantiated`: whether `OddsCollector` exists
- `started`: whether the worker is entering its `runCycle()` call
- `reason`: `NOWGOAL_DISABLED`, `NOT_INSTANTIATED`, `COLLECTOR_DISABLED`, or null
- `source`: `worker.runCycle` or `worker.bootstrap`

The marker contains no secrets, URLs, raw odds, or match IDs and does not change collection logic, schedules, retry behavior, provider configuration, or database schema. After deploying this commit:

- `enabled=true, instantiated=true, started=true` followed by `PREMATCH_ODDS_CYCLE_START` confirms the classic path entered.
- `enabled=false, instantiated=false, started=false, reason=NOWGOAL_DISABLED` proves the env gate prevented it.
- `reason=COLLECTOR_DISABLED` proves the main worker cycle is disabled.
- Marker exists but no subsequent cycle-start event indicates a code path/log/deployment discrepancy worth checking.

## TEST_STATUS

- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run build`: PASS
- `npm run test:unit`: PASS — 59 files, 346 tests.

## RECOMMENDED_MINIMUM_FIX

No collector fix was made because the current code wiring is valid and production runtime cause is unverified. Deploy the requested branch to the Render worker, then search for `PREMATCH_COLLECTOR_RUNTIME_STATUS` and `PREMATCH_ODDS_CYCLE_START`. Confirm the effective runtime flag via the safe marker; if the marker says enabled/started but cycle-start is absent, compare the Render worker's deployed commit and full unfiltered logs. Do not infer production deployment from local git SHA.
