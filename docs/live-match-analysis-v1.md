# Live Match Analysis V1

Based on main 84ba10b. No migration is required.

## Provider audit

FotMob already normalizes `started` / `finished` and team scores (with scoreStr fallback). The existing payload types and checked-in samples do not verify a reliable live-minute field. `minute` therefore remains null; kickoff time is never used to infer it. The existing `source_updated_at` is the provider fetch observation time, not a claimed upstream event timestamp. Cached statistics retain their original observation timestamp.

NowGoal exposes only the pre-match collector contract. Live odds and odds movement are unavailable; current_odds is never promoted to live odds.

## Flow

The worker shares the existing FotMob provider, HTTP limiter and retry policy with the regular collector. A separate non-overlapping refresh runs every 60 seconds after completion, covering today and yesterday for midnight transitions. It updates existing match identities and live statistics, and refreshes final statistics for matches observed live in this process. A circuit breaker backs off failures. Regular collection continues to handle historical/final statistics. Web requests never fetch provider data.

Finished matches reject non-finished updates, including observations/consensus changes; older fixture and statistic snapshots cannot overwrite newer state. Existing unique statistics keys are reused.

GET /api/live returns supported live matches. GET /api/live/:matchId returns the current state even after completion so an open detail page can show the final score. Prediction/gate output is contextual only. Both endpoints disable caching. Dashboard and live detail poll at 30 seconds while live, otherwise 60 seconds, retaining visible last-known data and displaying an error on failure. Minute and missing statistics render as a dash. Each metric exposes its own observation time.

Pressure summarizes equal-weight comparisons of shots, shots on target, corners and xG. Cards are reported separately and never count toward attacking pressure. Completeness counts fully available pairs across eight metrics; fewer than three pairs is LOW_DATA. No ML, authority, prediction thresholds, locks, self-audit or prediction engine code is changed.

## Validation scope

Unit tests cover nullable metrics/minute, real zero values, provider separation, no fabricated live odds, input immutability, authority flags, national-team provider refresh, API filtering, contextual predictions, escaped cards and polling intervals. The repository integration test covers scheduled -> live -> score update -> finished and rejects live/scheduled regression while retaining one match ID. Integration requires a working Docker engine or an explicitly configured isolated test database.
