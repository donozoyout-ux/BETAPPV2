# Free Historical Data V1

This module increases provider-independent historical **statistics**, not odds. A historical statistical record never creates opening, current, or closing odds; `prediction_historical_examples` continues to require genuine pre-match odds snapshots.

## Source policy

FotMob is the active historical source. Its existing bounded HTTP client, retries, rate limit, circuit isolation, season discovery, and fixture/statistics flow are reused.

StatBunker, SoccerStats, and AdamChoi are qualification-only while automated-access permission is unconfirmed. Qualification may make a single public `robots.txt` request with an identifiable user agent; it does not crawl pages, bypass anti-bot controls, or use hidden/private endpoints. FootyStats HTML automation is disabled: its own terms prohibit automated interaction except an authorized API, and the documented API subscription is not a project dependency. Flashscore, CornerProBet, Stats24, and FootyStats HTML collection are explicit disabled policies.

## Canonical storage and provenance

`historical_match_stats` has provider-neutral match metrics. Missing data remains `NULL`. Migration 011 adds offsides, external referee identity, and a quality grade. `historical_stat_provenance` records every source attempt with provider external ID, fetch/source times, SHA-256 payload hash, normalization version, field presence, and raw source payload. It never silently discards a conflicting source.

Provider precedence is deterministic: FotMob, then StatBunker, then SoccerStats, then AdamChoi. A weaker provider cannot replace an equal-or-better quality higher-priority record. A stronger source may replace it; all source records remain in provenance.

## Backfill and audit

`historical_backfill_jobs` stores provider/competition/season cursor, counters, errors, timestamps, and terminal status. The FotMob CLI updates the job after every fixture, resumes from its cursor by default, and treats one fixture failure as a partial job rather than crashing the whole run.

`historical:dry-run` is a separate read-only command: it has no database pool or repository dependency, samples a bounded number of completed match-detail payloads, applies the normal bounded HTTP client plus circuit breaker, and honours `HISTORICAL_REQUEST_DELAY_MS` (750 ms by default). Match-detail responses have a five-minute process-local cache to avoid duplicate qualification/backfill requests. It is a coverage sample, not a historical-odds import.

`npm run historical:audit` reports match/result and field coverage for corners, cards, shots, shots on target, fouls, offsides, possession, xG, and referee per competition/season.

New provider data remains outside official Prediction V1 until its quality, coverage, and replay behavior are independently reviewed.
