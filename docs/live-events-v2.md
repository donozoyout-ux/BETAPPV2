# Live Events V2 / secondary API-Football

V1 remains intact; `LIVE_ANALYSIS_V2` is an additive explanatory response. Neither layer writes predictions, gates, locks, Self-Audit rules, or thresholds. Both authority flags remain false.

## Configuration / deployment

Apply migration `013_live_events_v2.sql` with the existing migration runner before starting the new worker/web build. It adds source snapshots, a deduplicated event archive and provider health. Existing match IDs, statistics, prediction and pre-match odds tables are retained. No historical event rows are fabricated.

```
API_FOOTBALL_ENABLED=false
API_FOOTBALL_KEY=
```

Enable only with a server-side API-Sports key. Missing credentials are `NOT_CONFIGURED`, never a startup error. Authentication is the `x-apisports-key` header; URLs, errors, health and browser responses never contain it. No prediction endpoint is used.

## Provider audit

On 2026-09-23 the existing FotMob `/api/data/matchDetails?matchId=6140728` returned HTTP 200. A reduced actual capture is checked in at `test/fixtures/fotmob-live-6140728.json`. It contains `header.status.liveTime.short` (68′), `content.matchFacts.events.events`, a 58-minute own goal with `newScore:[1,0]`, a yellow card and substitutions with `swap` names. V2 parses only explicit provider minute fields, not kickoff-derived elapsed time. Unknown event kinds and shootout goal entries are excluded. Non-goal score-after and occurrence timestamp remain null unless supplied.

API-Football contracts were checked against the official reference and guide:
- https://www.api-football.com/documentation-v3
- https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide

API-Football credentials were not supplied, so adapter tests use representative contract payloads; a credentialed production smoke test remains necessary. No live API-Football odds are claimed to have been fetched.

## Reconciliation / storage

The secondary can only map to an existing FotMob identity with matching canonical competition, normalized home/away names and kickoff within ten minutes. Exactly one candidate is required. Ambiguous matches remain `MATCH_UNRESOLVED`; no fixture is inserted. Nations League subdivisions require explicit A/B/C/D round evidence; ambiguous finals/round labels are left unresolved. Only the existing configured club/national scope is accepted.

Sources are stored separately. Fresh score/status disagreement retains the trusted persisted row; both values and the reason are exposed. A source older than 180 seconds loses priority only when the alternative observation is also more than 180 seconds newer. All fixture writers lock the canonical row; finished remains terminal. Minute differences over two minutes and comparable event-set disagreement are visible conflicts. Event comparison uses type/side/minute/added-time, avoiding spelling-only player conflicts.

Each event uses a provider ID or SHA-256 composite fingerprint (type, minute, extra time, side, player, assist, detail). Repeated polls upsert the same event. Source snapshots retain the current complete event list (including removals/corrections); the event archive retains observed evidence. Display uses the primary current event list, or secondary fallback, never concatenating duplicate cross-provider goals.

V1 statistics and analysis stay unchanged. V2 uses secondary full metric pairs only when primary data is missing/stale and the alternate observation is fresh. Metric provenance, observation timestamps, source snapshots and conflicts remain available. No synthetic minute or zero is inserted.

## Refresh / odds / UI

FotMob keeps its existing 60-second completion-to-next-cycle schedule and shared HTTP limiter/cache. Its detail payload is reused for events. API-Football summary cycles start no more often than every 30 seconds, never overlap, and detail calls run only for resolved configured live matches. Score/phase changes trigger details; otherwise details refresh at most once a minute. HTTP requests are serialized with at least 6.1 seconds between starts. Quota headers, 429, Retry-After and exponential backoff are honored. Exhausted daily quota pauses for 24 hours conservatively.

Only `/odds/live?fixture=...` can populate live odds. Fixture must be live; stopped/blocked/finished markets and suspended quotes are excluded. Quotes older than 90 seconds are unavailable. Bookmaker stays null when absent. There is no pre-match fallback; odds movement stays unavailable without a captured movement series.

Browser polling stays within BETAPP at 30/60 seconds. API adds V2, elapsed/added time, timeline, source health, conflicts, isolated odds and contextual pre-match gates. `/api/live/:matchId/events` returns the current source-selected timeline plus separate source evidence. Provider text is HTML-escaped before insertion. Detail polling continues after completion to expose the final state.

## Validation

Unit coverage includes real FotMob normalization, all supported event kinds, API elapsed/added time, no invented minute, national-team mapping, ambiguity, fingerprint identity, fresh/stale conflicts, immutable V1, real-only odds, credential absence, 429 backoff, XSS and non-overlapping polling. PostgreSQL integration includes repeated-event deduplication, fresh-conflict freezing and terminal scores. Local Docker is unavailable; the existing GitHub `BETAPP CI` workflow runs PostgreSQL Testcontainers before build. Do not merge unless that exact-commit integration job succeeds.
