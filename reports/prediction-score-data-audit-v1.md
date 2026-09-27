# BETAPPV2 Prediction Score and Data Coverage Audit V1

**Branch:** `codex/nowgoal-live-odds-integration-v2`  
**Audit status:** `PARTIAL` — score logic is statically audited and covered by tests; actual production database coverage counts are `BLOCKED` because this checkout has no configured `DATABASE_URL`.

## PREDICTION_SCORE — PASS

The prediction score is computed by `scorePrediction()` in `src/predictions/scoring.ts`. It is a weighted sum, rounded to two decimal places at each component and again at the end. It is distinct from the upstream ODDS_V1 odds-analysis score.

| Component | Formula | Weight / maximum |
|---|---|---:|
| Market probability | `currentFairProbability × 20` (fair probability comes from the pre-kickoff market consensus) | 20 |
| Odds signal | `clamp(max(probabilityDeltaPp, 0) / 5, 0, 1) × 20` | 20 |
| Historical evidence | `(historicalHitRate ?? 0) × 25` | 25 |
| Sample reliability | `min(1, settledSampleSize / 100) × 15` | 15 |
| Bookmaker agreement | `movementAgreementRatio × 10` | 10 |
| Data quality | `dataQuality.score / 100 × 5` | 5 |
| Model confidence | `modelConfidence.score / 100 × 5` | 5 |

The weights total 100. Probability values are fractions from zero to one. The current defaults are in `src/predictions/config.ts`: minimum score 70, minimum settled historical sample 30, reliability target 100 examples, maximum 250 selected examples, minimum data quality 50, confidence 45, at least 3 bookmakers, at least 2 complete states, official window 90 minutes, and minimum lock lead 10 minutes. These are engineering defaults; comments explicitly say they are not scientifically calibrated.

### Score to decision

`evaluatePrediction()` in `src/predictions/engine.ts` scores every odds-analysis item, gets blocker reasons from `officialCandidateBlockers()` in `src/predictions/prediction-gates.ts`, sorts only candidates with no blockers by score and deterministic tie-breakers, then returns `PREDICT` if one survives; otherwise it returns `SKIP`. A score of 70 alone is insufficient. Supported market, analysis eligibility, data quality, model confidence, bookmaker count, complete states, supported movement, historical settled sample, corner conflict, and score all have gates. The prediction service locks an immutable `PREDICT`/`SKIP` in its 90-minute window and retains the minimum 10-minute lead for official PREDICT.

### Similarity and history

History must have the same market type, market name, line, and selection. Opening/current fair-probability distances, movement, opening/current odds percentages, and agreement must all fit configured tolerances. Compatible examples are sorted by normalized distance. Similarity does **not** have its own score weight: distance filters the pool and ranks examples; `averageSimilarity` is descriptive metadata. The engine uses same-competition settled binary examples when at least 30 are available; otherwise it falls back to compatible examples across supported competitions. This global fallback is permitted by current rules and is recorded as `GLOBAL_SUPPORTED_COMPETITIONS`.

PUSH and VOID outcomes do not count toward the settled binary denominator or the 30-example minimum. Mixed history can therefore have `sampleSize > settledSampleSize`. If there is no history, the hit rate stays null and both historical score contributions are zero. **The score remains a numeric, possibly low value instead of becoming null.** Missing odds produce no candidate and an explicit `NO_ODDS_ANALYSIS` skip; no candidate is not a real score of zero, even though the gate inspector may show zero as its “current” presentation value when no candidate exists.

### Math example

For a candidate with current fair probability `.56`, positive movement `11pp`, hit rate `1.0`, settled sample `100`, agreement `1.0`, quality `90`, and confidence `85`, the components are `11.20 + 20 + 25 + 15 + 10 + 4.50 + 4.25 = 89.95`. This is an illustrative deterministic calculation from the audited test fixture, **not** a production match measurement.

## UI/API score source — PASS

The live preview and gate API expose the candidate’s `predictionScore`; the persisted journal/API supplies `prediction_score`. The UI prefers `predictionGate.candidate.predictionScore` and falls back to the journal value for official prediction cards. Detail and review cards display the candidate value. These are the same value saved from the selected candidate in `PredictionRepository.lock()`. No arithmetic is performed in the UI.

## Data coverage and missing gaps — BLOCKED

No production database connection was available in this checkout: only `.env.example` exists and it contains no `DATABASE_URL`. I did not connect to an external database or infer its contents. Therefore the required numerical counts remain unavailable:

- Total, completed, upcoming matches; league/country distribution
- Result and team/league metadata coverage
- Prematch odds, market, and three-bookmaker coverage
- Same-competition and cross-competition historical evidence coverage
- Per-target compatible neighbor count and 20/30-neighbor availability
- Number of matches meeting the 30 settled example minimum
- Number of targets that would PREDICT versus SKIP, and categorized gap counts

The repository already has `/api/data-coverage` (`src/data/coverage.ts`) which aggregates league-level finished matches, prematch odds/snapshots, bookmaker counts, CSV historical odds, stage examples, upcoming odds, corners, and prediction historical examples. `/api/predictions/diagnostics` returns the score/sample thresholds, eligible example counts, current target/odds analysis counts, historical sample maxima, and skip reasons. These endpoints should be exported from the target production DB and included before claiming real coverage.

Gap categories requested in the audit must be counted from match-level joins, not guessed from aggregate provider counts. `SIMILARITY_TOO_LOW`, `SAMPLE_TOO_SMALL`, `TIME_WINDOW_TOO_NARROW`, and `CROSS_LEAGUE_BLOCK` especially require rerunning the deterministic evaluator over actual current targets and recording candidate scope/distance; they cannot be recovered exactly from aggregate match totals.

## Similarity / sample coverage — PARTIAL

The evaluator considers at most 250 compatible examples. There is no independent “similarity score >= X” threshold. `odds-intelligence` has separate historical-neighbor display settings; its 20/30 display count is not the Prediction V1 evidence sample. The production query is required to measure actual compatible-neighbor availability.

## Lookahead protection — PASS

- Odds analysis excludes snapshots where `capturedAt >= kickoffAt` and also requires `capturedAt <= generatedAt` (`src/odds-analysis/engine.ts`).
- Historical evidence requires `example.kickoffAt < target.kickoffAt` (`src/predictions/similarity.ts`). Equal-time and future examples are excluded.
- Historical examples are built at `kickoffAt - officialWindowStartMinutes`; the database requires positive feature lead (`src/predictions/service.ts`, migration 006).
- Historical CSV stage evidence without verified exact capture time is marked research-only and official-ineligible (`prediction_stage_historical_examples`).

## Data gap categories

Requested categories (`DATA_MISSING`, `ODDS_MISSING`, `RESULT_MISSING`, `TEAM_METADATA_MISSING`, `LEAGUE_METADATA_MISSING`, `MARKET_MISSING`, `SIMILARITY_TOO_LOW`, `SAMPLE_TOO_SMALL`, `TIME_WINDOW_TOO_NARROW`, `CROSS_LEAGUE_BLOCK`, `OTHER`) are preserved in the JSON schema, but their production counts are null/blocked until read-only DB measurements are available. Existing engine skip reasons are documented in the companion JSON; they are not silently converted into fabricated gap counts.

## Data source and backfill plan — PARTIAL

Available source paths in code include:

1. **OpenFootball**: fixtures/results and competition/team matching; import to `matches`, `leagues`, `teams`, `provider_entities`. This is result/metadata coverage only, never odds evidence.
2. **Nowgoal and odds providers**: timestamped quotes into `odds_snapshots`; market analysis output into `odds_analysis_runs` and `odds_analysis_items`. Keep only real snapshots with `captured_at < feature cutoff` for historical features.
3. **football-data.co.uk CSV**: result data, historical bookmaker odds, market identity and provenance into `historical_csv_imports` and `historical_market_odds`. When exact capture timestamps cannot be verified, retain the existing research-only/shadow eligibility; do not promote closing/stage-only odds into official historical features.
4. **FotMob/provider competition and team metadata**: `leagues`, `teams`, `provider_entities`, aliases, and verified result/stat fields. Preserve provenance and avoid matching by display name alone when provider IDs exist.
5. **`prediction_historical_examples`**: continue building official evidence from time-safe odds analysis plus settled results, rather than directly treating imported result-only rows as scored examples.

No data was imported. Before selecting 1-, 2-, or 3-season backfill windows, measure each by league and market: number of time-safe settled examples, proportion with at least 30 same-competition neighbors, compatible-distance distribution, explicit global fallback share, and walk-forward performance. A longer window should be used only if it adds compatible evidence without worsening match/market compatibility or temporal safety. No single season interval can be recommended responsibly without those measurements.

## Tests — PASS (code-level); production coverage tests BLOCKED

Added deterministic score-component/weight checks, absent-history behavior, no-odds SKIP behavior, local-versus-global evidence scope, exact market/line and odds tolerance filtering, PUSH/VOID denominator handling, equal/future kickoff cutoff, unsupported market and low-score blockers. Existing UI/API paths were traced to the same persisted/candidate score field. No prediction logic or thresholds were changed. Production DB coverage and live sample availability remain untested because DB credentials are absent.

The machine-readable status details and null coverage measurements are in [`prediction-score-data-audit-v1.json`](./prediction-score-data-audit-v1.json).
