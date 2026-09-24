# Competition data expansion V1

This delivery contains code, tests, and a live provider discovery dry-run only. No production database import was executed. A dry-run PASS means discovery succeeded, not that statistics or odds were imported.

## Existing architecture and reuse

The FotMob adapter already exposed season discovery and finished fixtures. `getSeasonFixtures` now contains the shared fixture decoder; `getHistoricalFixtures` retains its finished-only contract. This allows discovery to inspect whether a cycle is complete before importing it. The existing `FootballRepository.upsertMatch` persists leagues, teams, results, provider identities, seasons and protected source payloads. The controlled runner uses the existing `historical_backfill_jobs` checkpoint table, `historical_stat_provenance`, shared `historical_match_stats` and corner failure records. It does not create another historical datastore or require a migration.

After details, the CLI refreshes existing corner profiles, league baselines and dataset audit, then calls `PredictionRepository.refreshHistoricalIncremental`. Prediction source, eligibility, pre-kickoff cutoff and thresholds are unchanged. Match/stat records without real pre-kickoff odds cannot manufacture prediction odds examples.

## Running

Dry-run needs no database connection or credentials:

```sh
npm run backfill:competitions -- --dry-run --seasons 2 --output report.json
npm run backfill:competitions -- --competition Eredivisie --seasons 2 --dry-run
```

For a separately authorized import, configure the intended DATABASE_URL, FOTMOB_ENABLED=true and BACKFILL_ENABLED=true, apply existing migrations, then run:

```sh
npm run backfill:competitions -- --competition Eredivisie --seasons 2 --resume --output report.json
```

Competition selection accepts configured key, canonical name or FotMob ID. Without a selector it runs the five added domestic leagues and eleven supported international competitions. `--seasons` accepts only 1 or 2 cycles, default 2. Both spaced and equals-form flags work. No worker startup or web request automatically runs this backfill.

Imports are sequential. FotMob's existing requests-per-second limiter, timeout/retry policy and HISTORICAL_REQUEST_DELAY_MS remain active. The CLI holds an advisory lock against another expansion CLI and borrows one PostgreSQL connection for repository operations, including with DB_POOL_MAX=1. No pool setting is increased. The regular live collector should retain its existing operating limits.

Phase A persists every selected finished fixture before Phase B requests any match details. A failed detail is recorded and other matches continue. Missing fields stay NULL, while genuine zero values remain zero. Sparse responses do not erase existing known historical fields. National aliases use exact senior names before club-suffix normalization and refuse ambiguous identity matches.

`--resume` reads provider match-ID checkpoints rather than list offsets. Interrupted/partial runs pin their previously discovered cycles; provider catalogs must still contain those labels. Successful details are skipped, failed details are retried, and fixture upserts are duplicate-safe. A run without --resume rechecks fixtures while still skipping completed details. Unavailable completed details are recorded as unavailable; retrying those requires deliberate checkpoint/provenance review, not an unbounded repeated crawl.

Each competition report is stored in `collector_checkpoints` under `competition-expansion:<providerId>` and optionally in the JSON output file. Existing historical job cursors store persisted/detail IDs. Reports distinguish fetched fixtures, finished fixtures, inserted/updated matches, teams, detail success/unavailability/failure, skipped details, duplicates, new examples, actual odds/corner coverage and failure reasons. PARTIAL includes unavailable statistics; FAILED means fatal/no fixture persistence. Dry-run performs discovery only and does not write these database reports.

## Coverage and audit

`GET /api/data-coverage` includes every configured competition, explicit zeros, CLUB/INTERNATIONAL type, matches, finished matches, real statistics/odds/corners, prediction examples and date bounds. It aggregates evidence tables before joining to avoid multiplying match counts. The service caches for five minutes and shares concurrent reads. The dashboard VERİ HAVUZU section displays that API and refreshes no more frequently than five minutes.

CONTROL_AUDIT_V1 retains existing checks and adds COMPETITION_DATA_COVERAGE (zero matches is WARN) and HISTORICAL_IMPORT_HEALTH (last completed import; partial WARN, failed before fixtures FAIL). No audit changes configuration. Coverage is database evidence; the dry-run file is not presented as imported data.

## Observed provider scope

Observed on 2026-09-24 with unchanged provider rate controls. EURO Qualification has separate group and playoff labels within a cycle: 2023 + 2022/2023, and 2019 + 2018/2019. These four real labels form two cycles. International Friendlies exposes only 2026, so no previous cycle was invented. Discovery scans a bounded latest five cycle groups and selects at most two; only a genuinely completed earlier group is accepted.

| Competition | FotMob ID | Selected provider labels | Fixtures | Finished | Discovery |
| --- | --- | --- | ---: | ---: | --- |
| Eredivisie | 57 | 2026/2027, 2025/2026 | 615 | 372 | PASS |
| Belgian Pro League | 40 | 2026/2027, 2025/2026 | 619 | 376 | PASS |
| Danish Superliga | 46 | 2026/2027, 2025/2026 | 325 | 247 | PASS |
| Allsvenskan | 67 | 2026, 2025 | 480 | 416 | PASS |
| Greek Super League | 135 | 2026/2027, 2025/2026 | 418 | 271 | PASS |
| FIFA World Cup | 77 | 2026, 2022 | 168 | 168 | PASS |
| EURO | 50 | 2024, 2020 | 102 | 102 | PASS |
| UEFA Nations League A | 9806 | 2026/2027, 2024/2025 | 108 | 60 | PASS |
| UEFA Nations League B | 9807 | 2026/2027, 2024/2025 | 96 | 48 | PASS |
| UEFA Nations League C | 9808 | 2026/2027, 2024/2025 | 96 | 48 | PASS |
| UEFA Nations League D | 9809 | 2026/2027, 2024/2025 | 24 | 12 | PASS |
| World Cup Qualification UEFA | 10195 | 2025/2026, 2021/2022 | 463 | 462 | PASS |
| EURO Qualification | 10607 | 2022/2023, 2023, 2018/2019, 2019 | 501 | 501 | PASS |
| Copa America | 44 | 2024, 2021 | 70 | 60 | PASS |
| World Cup Qualification CONMEBOL | 10199 | 2023/2025, 2020/2022 | 181 | 179 | PASS |
| Friendlies | 114 | 2026 | 379 | 298 | PASS |

Full report: [competition-expansion-dry-run.json](reports/competition-expansion-dry-run.json). All insertion, detail and historical-example counters are zero because this was a dry-run. Existing production coverage was not measured.

## Safety invariants

- minimumHistoricalSample=30, minimumPredictionScore=70, minimumBookmakerCount=3, minimumCompleteStateCount=2 unchanged.
- executionAuthority=false; aiPredictionAuthority=false.
- No generated odds, statistics, season labels or AI predictions; no betting execution.
- No merge or production import in this delivery.

## Verification

Unit tests cover config/IDs/aliases/Render parity, discovered cycle grouping, CLI bounds, phase ordering, resume, failure continuation, missing stats, cache/coverage/API escaping and audit statuses. PostgreSQL integration tests exercise the actual repositories, null/zero retention, checkpoints, repeat imports, odds-free history eligibility and national/club identity separation. Local PostgreSQL tests need a working Docker runtime; the branch CI runs them using PostgreSQL 16 testcontainers alongside typecheck, lint, unit tests and build.
