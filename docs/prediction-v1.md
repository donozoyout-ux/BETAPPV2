# Prediction V1 Journal

`PREDICTION_V1` is a deterministic, pre-match evidence journal. It does not place bets, has no execution authority, and no LLM/AI can choose, score, alter, or settle an official prediction.

## Pipeline and safety

```text
fixtures/results -> Nowgoal odds -> ODDS_V1 -> historical similarity
-> changing preview -> one locked PREDICT or SKIP -> separate settlement -> performance lab
```

The worker preserves fixture-first collection. It settles already locked records after football results are collected, collects odds, then refreshes previews and locks decisions. Prediction failures are isolated and logged; they cannot roll back odds or stop the football, Nowgoal, or Corner Engine pipelines.

Every analysis carries `PREDICTION_V1`, the SHA-256 hash of centrally defined configuration, a deterministic input hash, and a generated time. Initial thresholds in `src/predictions/config.ts` are engineering defaults only; they have not been scientifically optimized or calibrated.

`prediction_runs` records previews and deduplicates identical input/config evaluations. A preview is explicitly `ADAY TAHMİN — DEĞİŞEBİLİR` and is excluded from performance. In the configured pre-kickoff window (default 90 to 10 minutes before kickoff), the first result becomes one immutable `prediction_journal` row: either `PREDICT` or `SKIP`. The database unique key allows at most one `PREDICTION_V1` journal entry per match, and a trigger rejects journal updates/deletes. If the usable window was missed while the match is still pre-kickoff, an auditable locked `SKIP` with `LOCK_WINDOW_MISSED` is stored. Nothing is locked at or after kickoff.

## Historical similarity and leakage prevention

Historical examples are produced idempotently by `npm run predictions:history:backfill` and incrementally refreshed by the worker after every result/settlement cycle. For each finished/cancelled match with odds snapshots, ODDS_V1 is reconstructed at the same deterministic V1 decision time: `historical kickoff - officialWindowStartMinutes` (default 90 minutes). `feature_cutoff_at` and `feature_lead_minutes` are stored with the example. Its input uses only snapshots at or before that cutoff and strictly before historical kickoff; post-kickoff and in-play prices are excluded. A match result is only used as the settlement label after feature reconstruction.

For target match `M`, a historical example `H` is eligible only if `H.kickoff_at < M.kickoff_at` and its reconstructed ODDS_V1 item was analysis-eligible. The feature store records eligibility, data-quality/confidence grades, and complete-state counts; similarity defensively filters ineligible rows too. Identity requires the same market type, market name, selection, and exact line. This prevents mixing 1X2 with totals, goals with corners, Asian handicap with totals, or lines such as 2.5/3.5. Similarity is a transparent, configurable band/distance over opening/current fair probability, movement, opening/current odds, and bookmaker agreement.

The engine first uses the same competition; it only records `GLOBAL_SUPPORTED_COMPETITIONS` when that sample is insufficient. Evidence always includes N, settled N, outcome counts, rate, Wilson 95% interval, average similarity, scope, and market-frequency gap. `PUSH` and `VOID` are excluded from the binary hit-rate denominator; `WIN`/`HALF_WIN` are positive and `LOSS`/`HALF_LOSS` negative. Fewer than the configured historical minimum normally produces `SKIP`.

## Candidates, score, and corners

Supported markets are 1X2, total goals, total corners, and Asian handicap. Only independently qualifying ODDS_V1 selections with `SUPPORT` or `STRONG_SUPPORT` can qualify; an opposing HOME signal is never converted into AWAY automatically. Candidate score is a deterministic 0–100 sum whose config weights total 100: market probability, odds signal, historical evidence, sample reliability, bookmaker agreement, data quality, and model confidence. Components are stored with the journal record.

For total corners the existing Corner Engine V1 is not modified or blended. When a usable comparison exists, its probability, market probability, gap, quality, and confirmation are exposed. A configurable strong conflict produces `CONFLICTING_CORNER_MODEL` and normally a `SKIP`.

Stable SKIP codes include missing/unsafe ODDS_V1 state, eligibility/quality/confidence/bookmaker/completeness failures, unsupported movement/market, insufficient history, low score, corner conflict, lock-window miss, and unavailable settlement data. SKIPs are first-class journal records and appear in performance reporting.

## Settlement

`prediction_settlements` is separate from the immutable journal and has one row at most per journal record. It is idempotent. No row means pending.

- 1X2 uses final `matches.home_score` / `away_score`; cancelled matches are `VOID`, postponed matches stay pending.
- Total goals use total final goals and split quarter lines into adjacent half stakes (for example over 2.25 becomes over 2.0 plus over 2.5).
- Asian handicap uses the stored Nowgoal **HOME-side** line. HOME applies it directly; AWAY applies its opposite. Integer, half, and quarter lines use the same deterministic split logic.
- Total corners uses only normalized `historical_match_stats.home_corners` and `away_corners`. Missing normalized corner data remains pending with `NO_SETTLEMENT_DATA`; it is never guessed.

The performance lab uses only locked journal rows. It reports decision/outcome totals, market/league/score/confidence/quality/bookmaker/history/movement breakdowns, calibration buckets, and historical-estimate calibration. Every rate has a sample size and small samples carry a warning. “Reference Paper Units/ROI” uses stored reference odds only; it is not an executable or real-money return.

## Commands and API

```bash
npm run predictions:history:backfill
npm run predictions:analyze
npm run predictions:settle
npm run predictions:performance
npm run predictions:backtest
```

Backtest is chronological: each target is reconstructed from raw snapshots at `kickoff - officialWindowStartMinutes`, not from the latest stored ODDS analysis. It excludes and counts prices after that simulated lock and after kickoff, and calculates future-historical, decision-time, and post-kickoff leakage counters from actual inputs/selected IDs; they are never hardcoded claims. Sparse data yields `BACKTEST: PARTIAL` rather than fabricated performance.

API endpoints: `GET /api/predictions/today`, `/previews`, `/history?limit=&offset=`, `/performance`, and `/:matchId`. States distinguish `PREVIEW`, `LOCKED_PREDICTION`, `LOCKED_SKIP`, `PENDING`, and `SETTLED` where applicable.


## Self-Audit V1

`SELF_AUDIT_V1` is a deterministic safety layer over the immutable Prediction V1 journal. It does not edit historical predictions or settlements. It evaluates only official locked `PREDICT` decisions produced by the current Prediction V1 config hash.

States:

- `INSUFFICIENT_DATA`: fewer than the minimum settled binary outcomes; predictions continue normally.
- `HEALTHY`: recent performance and calibration checks are inside the engineering guardrails.
- `WATCH`: degradation is visible on the dashboard, but official predictions are not blocked.
- `PAUSED`: severe recent degradation or a configured loss streak activates a temporary guard. During the active guard window an otherwise valid official PREDICT becomes an immutable `SKIP / SELF_AUDIT_PAUSED`.
- After the pause cooldown expires, the dashboard shows recovery mode and new results may be collected again. A pause cannot extend itself unless the underlying settlement input changes and a new audit is created.

The audit tracks recent positive settlement rate, reference-paper ROI, a bucketed probability calibration gap, and consecutive negative settlements. PUSH and VOID are excluded from the binary hit-rate denominator. Calibration compares the mean historical estimate with the observed positive rate inside probability buckets rather than scoring individual outcomes as calibration errors.

Initial thresholds are engineering defaults, not scientifically optimized thresholds. Self-Audit changes the prediction gate only; it has no real-bet execution authority and no AI authority.

API: `GET /api/predictions/self-audit`

CLI: `npm run predictions:self-audit`
