# Official Prediction / Today Audit V1

Generated: 2026-09-30 (read-only production inspection).

## Verdict

The absence of official predictions is not caused by a prediction-score threshold regression or a UI-only failure. Production diagnostics report 23 target fixtures, 4 with an odds analysis, 3 prediction runs, 0 `PREDICT` runs, and a maximum historical settled sample of 19 where the existing requirement is 30. No threshold, score calculation, candidate qualification, or locking rule was changed.

| Area | Status | Evidence |
|---|---|---|
| Fixture discovery | PASS | Upcoming fixtures are returned by the dashboard. |
| Odds collection | PARTIAL | Only 4/23 target fixtures have odds analysis. |
| Odds analysis | PARTIAL | Analysis exists only where usable snapshots reached the pipeline. |
| Prediction generation | PASS (gated) | Runs are created, but all observed runs correctly skip; no `PREDICT` run exists. |
| API | PASS | Dashboard and diagnostics expose the raw gate evidence. |
| Today rendering | FIXED | The UI now presents the same gate outcome in operational Turkish labels. |

## Root cause

The current production bottleneck is upstream data coverage: most fixtures have no completed odds-analysis route, and the largest available comparable historical sample is 19/30. A candidate is therefore not an official prediction merely because it has a visible score.

Observed examples:

- Mexico — Peru: candidate score 63.49; blocked by insufficient historical sample, low score, and missed lock window.
- Papua New Guinea — Solomon Islands: candidate score 40.25; no eligible odds route, insufficient bookmaker/complete-state evidence, weak data quality, insufficient history, and low score.
- São Paulo — Santos: preview score 48.95; waiting on complete data/history and official window.

## Presentation contract

- `LOCKED_PREDICTION` plus Gate Inspector `OFFICIAL` → **Resmi Tahmin**.
- Candidate with only qualification/score failure → **Eşik Altı**; it remains explicitly unpublished.
- Missing odds, analysis, complete states, bookmakers, quality, movement, history, or open window → **Veri Bekleniyor**.
- No analysis record → **Analiz Edilmedi**.
- Explicit analysis error signal → **Analiz Hatası**.

The Today page now starts with **RESMİ TAHMİNLER** and contains only locked official records. When none exist, it states: “Şu an hiçbir maç tüm güvenlik koşullarını geçip kilitlenmiş resmi tahmin değil.” Candidate rows retain the candidate and add “Resmi tahmin: yayınlanmadı.”

## Scope assurance

No production database writes, imports, backfills, provider calls, prediction-score changes, threshold changes, or gate weakening occurred. The change is a presentation mapping derived from existing Gate Inspector data.
