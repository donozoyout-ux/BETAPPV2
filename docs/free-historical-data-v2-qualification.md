# Free Historical Data V2 — live qualification record

This is a point-in-time, read-only qualification record captured on 2026-09-20. It is not a claim that a source's terms or payload schema will remain unchanged.

## FotMob

The nine configured competition IDs answered the public season endpoint. Premier League (47), La Liga (87), Bundesliga (54), Serie A (55), Ligue 1 (53), Süper Lig (71), Champions League (42), and Europa League (73) each listed 2010/11 through 2026/27 (17 seasons). Conference League (10216) listed 2021/22 through 2026/27 (6 seasons).

Read-only commands sampled completed 2024/25 match-detail payloads with one request per second maximum plus a 750 ms inter-detail pause:

| Competition | Completed fixtures | Statistics sample | Fields present in every sample |
|---|---:|---:|---|
| Premier League | 380 | 12 | corners, yellow/red cards, shots, shots on target, fouls, offsides, possession, xG, lineups, referee |
| La Liga | 380 | 5 | same fields |
| Süper Lig | 342 | 5 | same fields |

`historical:dry-run` and `historical:backfill -- --dry-run` have no pool or repository dependency. They cannot mutate PostgreSQL. The production import remains opt-in behind `BACKFILL_ENABLED=true`.

The current-season fixture count multiplied by completed historical season indexes gives a planning estimate of approximately 40,317 match-detail payloads. It excludes the in-progress 2026/27 season and is deliberately an estimate: league sizes and European formats have changed over the index period. The 100% field presence above is a bounded sample, not a claim of exhaustive full-history coverage.

## Other sources

Only a single identifiable `robots.txt` request was made by the read-only qualification command; no HTML collector was enabled.

| Source | HTTP / robots evidence | Terms / feed evidence | Decision |
|---|---|---|---|
| StatBunker | `robots.txt` HTTP 200 with an empty wildcard `Disallow` | Its public Data Feed page describes a commercial API, a representative-contact 30-day trial, and schedule/line-up/result/discipline/referee fields. It does not establish a free, self-service production API or automate-page permission. | `MANUAL_REVIEW_REQUIRED`, no collector |
| SoccerStats | Identifiable `robots.txt` request returned HTTP 403. | Terms and automation permission not established by this run. | `MANUAL_REVIEW_REQUIRED`, no collector |
| AdamChoi | `robots.txt` HTTP 200 with no wildcard disallow. | The public terms page returned HTTP 200 but did not yield a server-rendered automation grant. A public fixture URL was not parsed into stable statistics by the raw response; indexed content identifies premium-only fixture data. | `MANUAL_REVIEW_REQUIRED`, no collector |

No proxy rotation, anti-bot bypass, credential registration, purchase, or historical-odds synthesis occurred. Historical match statistics remain separate from `prediction_historical_examples` and odds snapshots.
