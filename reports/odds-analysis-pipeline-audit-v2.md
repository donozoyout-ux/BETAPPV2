# Odds Analysis Pipeline Audit V2

**Durum: PARTIAL — production API ile fixture ve aggregate kontrolleri yapıldı; hedef branch checkout'ta bulunmadığından branch'in production'da çalışan exact kod/config eşleşmesi doğrulanamadı.**

**Üretim snapshot'ı:** `https://betappv2.onrender.com/api/dashboard` ve ilgili public GET endpoint'leri, 2026-09-28 yaklaşık 20:30 Europe/Istanbul. Production DB'ye doğrudan bağlantı açılmadı; API dışındaki DB state'i UNKNOWN. Hiçbir write/import/backfill yapılmadı.

## SUMMARY

- Dashboard API Türkiye–İtalya (Turkiye–Italy, UEFA Nations League A) fixture'ını scheduled olarak döndürüyor.
- Dashboard'ın upcoming odds listesinde bu fixture'a ait odds satırı yok; dashboard `oddsAnalyses` listesinde hedef fixture yok. Fixture-specific `/api/odds-analysis/:id` ve `/api/predictions/:id` çağrıları 404 verdi. Run/candidate için 404 tek başına MISSING kanıtı değildir; bu nedenle ikisi API üzerinden UNKNOWN olarak raporlandı.
- Son 10 scheduled fixture: 10 fixture; dashboard odds feed'de odds bulunan 0; dashboard `oddsAnalyses` listesinde 1 analiz (Russia–Iran); `prediction_runs` ayrıntılı örneklemesi endpoint sınırlaması nedeniyle UNKNOWN. Son 10 finished fixture: 10 fixture; recent-finished API toplamında 5'inde odds snapshot var; dashboard upcoming-only `oddsAnalyses` listesi bu grupta kullanılamaz; per-match analysis API 404 olduğundan analysis UNKNOWN. `/api/predictions/:id` aynı şekilde 404 verdiğinden run UNKNOWN.
- Ayrı `/api/odds-analysis/upcoming` 200 ve `/api/predictions/diagnostics` 200 döndü; fakat diagnostics aggregate'i örnek 10 fixture'ın per-fixture trace'ini sağlamıyor. `/api/data-coverage?detail=prediction` 200 döndü ancak beklenen `predictionCoverage` alanı yok; bu yüzden last-10 sayımlarını bu endpoint'ten türetmek mümkün değil.
- **Kök neden sınıflandırması: A en güçlü, API ile desteklenen açıklamadır** (hedef fixture için odds feed'de odds görünmüyor). Collector'ın maça gerçekten istek atıp boş yanıt aldığı, fixture'ı filtrelediği veya eşleyemediği production log/endpoint'ten doğrulanamadı. Dolayısıyla A, collector denemesi bakımından kesin değil. B/C/D production verisiyle hedef maç için kanıtlanamıyor.

## ROOT_CAUSE_STATUS

**A — muhtemel/kanıt düzeyi: API görünümüyle sınırlı.** Türkiye–İtalya fixture'ı dashboard'da mevcut; dashboard upcoming odds kayıtlarında karşılığı yok ve dashboard'da gösterilen analiz kayıtlarında yok. Collector invocation/result ve raw `odds_snapshots` fixture-specific API ile okunamadı. Production'da odds hiç toplanmadı demek bu API kanıtını aşar.

Production'da A/B/C/D'yi kesinleştirmek için worker'ın run result (`matched`, `unmatched`, `snapshots`, `analyses`, `reasons`) kayıtları ve fixture'a göre snapshot/analysis aggregate'i veren güvenli read-only endpoint gerekir. Böyle bir API yanıtı bu audit sırasında elde edilmedi.

## CURRENT_PIPELINE

`fixture → provider prematch odds → fixture resolver → new odds snapshot insert → analyzeAndSave → odds_analysis_runs → prediction target query → prediction run → dashboard/API`

- Fixture: `FootballRepository` and dashboard API.
- Classic Nowgoal pre-match odds: `src/collector/odds-collector.ts::runCycle`; güncel tarih ve `NOWGOAL_FUTURE_DAYS` dahil günleri tarar. `src/providers/nowgoal.ts::getPrematchOddsForDate` her configured company ID için odds diary çağırır; sadece `MatchState === 0`, temel schedule/team alanları geçerli ve normalize edilmiş odds listesi boş olmayan fixture döner.
- Fixture resolution: `OddsRepository.resolveMatchDetailed`; scheduled/live adayları, kickoff yakınlığı, takım benzerliği ve varsa canonical competition eşleşmesi ile bağlar. Eşleşmeyenler `unmatched` ve reason olarak cycle sonucuna gider.
- Persist/analysis: `OddsRepository.appendManyAndAnalyze`; yalnızca yeni/değişmiş snapshot eklendiyse `OddsAnalysisRepository.analyzeAndSave` çağrılır.
- Analysis run: `OddsAnalysisRepository.analyzeAndSave` fixture'ı ve odds snapshots'ı okur, `analyzeOdds` çalıştırır ve `save` ile run yazar. Analysis eligibility düşük olsa bile run kaydedilebilir.
- Prediction candidate: `PredictionRepository.loadTargets` scheduled ve future fixture'ları seçer, ayrıca LATERAL INNER JOIN ile en son `odds_analysis_runs` ister. Analysis run yoksa candidate query'den fixture çıkar.
- Prediction run: `PredictionService.refreshPreviewsAndLocks` hedefleri değerlendirir ve target için run saklar. Prediction için ayrıca market/analysis eligibility, data quality, confidence, bookmaker/complete-state, movement, settled historical sample, score ve corner conflict gate'leri vardır.

## TURKEY_ITALY_TRACE

Production dashboard API snapshot'ı:

| Aşama | Durum | Kanıt / sınır |
|---|---|---|
| Fixture | EXISTS | `/api/dashboard.matches` satırı: Turkiye–Italy |
| Competition | EXISTS | UEFA Nations League A |
| Home/away teams | EXISTS | Turkiye ve Italy |
| Kickoff | EXISTS | `2026-09-28T18:45:00Z` |
| Fixture status | EXISTS | API'de `scheduled` |
| Season | UNKNOWN | dashboard fixture payload'ında season yok |
| Odds snapshots | UNKNOWN (dashboard odds feed'de MISSING) | `odds_snapshots` adına sahip direct fixture endpoint yok; dashboard `odds` upcoming feed'de satır görünmedi. Bu, DB tablosunun kesin boş olduğunu kanıtlamaz. |
| Bookmakers | UNKNOWN (dashboard odds feed count 0) | Hedefe ait dashboard odds satırı olmadığı için provider/bookmaker ayrıştırılamadı. |
| Odds analysis input | UNKNOWN | Fixture-specific DB input/raw snapshot endpoint yok. |
| `odds_analysis_runs` | MISSING from dashboard response; DB status UNKNOWN | `/api/dashboard.oddsAnalyses` içinde yalnızca Russia–Iran ve Mexico–Peru vardı. `/api/odds-analysis/:id` 404 verdi. |
| Prediction candidate | UNKNOWN | Candidate listesi fixture-specific response vermedi. Kodda analysis run INNER JOIN'i zorunlu; run yoksa candidate olamaz. Production run yokluğu doğrulanamadı. |
| `prediction_runs` | UNKNOWN | `/api/predictions/:id` 404 verdi; 404'in anlamı run yok mu route mu, API body olmadan ayırt edilemiyor. |

**İstenen kısa cevap:** Fixture **EXISTS**; Odds **UNKNOWN** (dashboard odds feed'inde görünmüyor); Odds Analysis **UNKNOWN** (dashboard listesinde görünmüyor ve direct endpoint 404); Prediction Candidate **UNKNOWN**; Prediction Run **UNKNOWN**.

## RECENT_MATCH_AGGREGATE

Örnekleme dashboard'ın ilk 10 `scheduled` fixture'ı ve `recentFinishedMatches` listesinin ilk 10 satırıdır. “Odds” upcoming grupta dashboard live/upcoming odds feed eşleşmesi; finished grupta `recentFinishedMatches.odds_snapshots > 0` anlamına gelir. Kaynak kolonlarının anlamı farklı olduğundan grupları ayrı okuyun. `odds_analysis_count` yalnızca dashboard `oddsAnalyses` listesinde fixture eşleşmesi olarak sayılmıştır; finished analiz sayısı bilinmiyor. Per-fixture endpoints 404 verdiği için prediction run sayıları UNKNOWN.

| Örnek grubu | fixture_count | odds_count (API tanımına göre) | odds_analysis_count | prediction_run_count |
|---|---:|---:|---:|---|
| Upcoming/scheduled first 10 | 10 | 0 | 1 | UNKNOWN |
| Recent finished first 10 | 10 | 5 | UNKNOWN | UNKNOWN |

Upcoming analysis tek kaydı Russia–Iran'dır; Türkiye–İtalya bu listede yoktur. Recent finished API'de beş fixture için odds snapshot aggregate > 0. Bu, analysis run'larının sayısını göstermez.

## ODDS_COLLECTOR_STATUS

- Worker process: Render blueprint'te `node dist/worker.js`; `src/worker.ts`.
- `COLLECTOR_ENABLED=true` değilse worker döngüsü çalışmaz. Varsayılan cycle `COLLECTOR_INTERVAL_MS=900000` (15 dakika).
- `NOWGOAL_ENABLED=true` ise classic `OddsCollector` kuruluyor ve ana worker `runCycle()` içinde çağrılıyor. Render worker YAML'de true ve 3 future day ayarı var; collector Nowgoal health check başarısızsa cycle'ı failure olarak işaretleyip odds işlemeyi atlar.
- Render YAML'nin `SUPPORTED_COMPETITIONS` env değeri eski liste ve UEFA Nations League A'yı içermiyor. Güncel `src/config.ts` default listesi Nations League A'yı destekliyor. Production gerçek env override'ı public API'den okunamadı. Kodda `PredictionRepository` competition filtresi canonicalized destek listesini kullanıyor; odds resolver'a da bu liste veriliyor. Böylece hedef yarışın worker'da config dışı kalması **güçlü bir deployment-config olasılığıdır**, production config kanıtı değildir.
- Nowgoal provider fixture feed'i competition allowlist ile fetch öncesi filtrelemiyor. Ancak configured provider company ID listesinde odds vermeyen bir maç response'a girmez; `MatchState !== 0`, eksik fixture alanı, geçersiz zaman veya odds listesi boş olması da fixture'ı provider sonucundan düşürür.
- Odds response boş/invalid ise `getPrematchOddsForDate` fixture'ı döndürmez; resolver/append/analysis aşamasına ulaşmaz. Bookmaker veya market minimumu run yaratmak için aranmaz. Prediction uygunluğunda 3 bookmaker ve en az 2 complete state gibi eşikler vardır.
- Classic cycle interval'i ana worker interval'idir (Render `900000` ms). Ayrı `OddsCollector.runForever()` aynı interval'i kullanır fakat `worker.ts` bu metodu çağırmıyor; worker `runCycle` çağırır.
- Nowgoal live odds collector bu checkout'taki `worker.ts` içinde kurulmamış. Başka branch/deployment sürümünde aktif olup olmadığı production API ile doğrulanamadı. Live snapshot saklama, pre-match `odds_analysis_runs` oluşturmakla aynı şey değildir.
- “Provider response boş”, “resolver mismatch”, “provider disabled” ayrımı için worker cycle result veya provider status endpoint'in fixture/competition-scoped kaydı yoktu. Hedef maça ait `reasons` UNKNOWN.

## ODDS_ANALYSIS_GATES

`odds_analysis_runs` oluşturmak için:

1. Fixture DB'de bulunmalı; `analyzeAndSave` fixture bulunamazsa null döner.
2. Source collector fixture'ı işleyip en az bir yeni/değişmiş odds snapshot'ı insert etmeli; **0 insert olursa `appendManyAndAnalyze` analysis çağrısını atlar.** Aynı verinin tekrar gelmesi yeni analysis tetiklemez.
3. Analysis çağrısı DB/model işleminde hata vermemeli.
4. Run hash uniqueness conflict olmamalı. Aynı `match_id/model_version/config_hash/input_hash` tekrarında run insert edilmez.

Minimum 3 bookmaker, minimum market coverage veya `analysisEligible=true`, run yaratmanın şartı değildir. Bunlar odds quality/eligibility ve daha sonra prediction qualification'ını etkiler. `analyzeOdds` kickoff sonrası snapshot'ları valid input'tan çıkarır; boş/complete olmayan input olsa bile fixture varsa POOR/empty analysis run oluşturabilir.

## WORKER_STATUS

- Worker odds collector'ı ana cycle içinde `oddsCollector?.runCycle()` olarak çağırıyor; ardından `predictionService.refreshPreviewsAndLocks()` çağrılıyor.
- Football provider cycle'ları `Promise.allSettled`; hata loglanıyor ve kalan cycle devam ediyor. Odds cycle hata verirse “Odds collector cycle failed” ile loglanır; outer worker loop devam eder.
- `OddsCollector.runCycle` provider health kontrol eder; başarısızsa `markFailed` ve return. Exception `markFailed`, provider status false yapar ve throw edilir. Worker catch edip döngüyü sürdürür.
- Nowgoal HTTP client timeout 10s, rate-limit 2 req/s, max retry 4 default; production gerçek env'i teyit edilemedi.
- Render YAML NOWGOAL classic worker flag'ini true gösteriyor; Render service env override edebilir.
- API-Football odds collector bu checkout'un worker akışında yok. Bu checkout'un Render YAML'sinde API Football odds env görünmüyor. İstenen branch/deployment sürümüyle eşdeğer olduğu kanıtlanmadı.

## REGRESSION_CHECK

Target branch `codex/nowgoal-live-odds-integration-v2` local listede mevcut; active checkout branch `codex/ui-visual-overhaul-v3`, HEAD `99599a5d3f877269dc808ca601494d57f196dea0`. Bu yüzden target branch'in deployed SHA/config eşleşmesi doğrulanamadı. İstenen commit SHA'ları Git history'de mevcut.

- `43c858d` historical backfill kodu/config/report/worker'da değişiklikler içerir; odds collector/repository, odds analysis repository/engine, prediction candidate/service/engine dosyalarına dokunmaz.
- `f148344` reconciliation/parser/backfill dosyaları ve testlerini değiştirir; odds collector, odds analysis, prediction pipeline dosyalarını değiştirmez.
- `c6b5e18` diagnostics endpoint, reconciliation/config/server/backfill dosyalarını değiştirir; odds collector/analysis/prediction pipeline dosyalarını değiştirmez.

Bu üç commit'in kendi diff'lerinde prediction/odds logic değişikliği görünmüyor. Ancak Render'ın hangi SHA'yı deploy ettiği API'den doğrulanamadı. Eski Render YAML supported competition env listesi Nations League A'yı içermiyor; bu somut config farkı olabilir ama production config kanıtı yoktur.

## BLOCKERS

1. Production API per-fixture `/api/odds-analysis/:id` ve `/api/predictions/:id` çağrıları 404 verdi; HTTP 404'in anlamı fixture kaydı mı route mu belirsiz.
2. `/api/data-coverage?detail=prediction` response'u prediction detail alanı sunmadı.
3. Public API fixture bazında odds snapshot/bookmaker count, collector match/unmatch reason veya DB run exists alanı vermiyor.
4. Checkout branch/HEAD istenen branch ile aynı ve working tree'de önceden var olan changes bulunuyor; onlara dokunulmadı.
5. Live Render environment override'ları ve deploy SHA public API'den teyit edilemedi.

## RECOMMENDED_FIX

Fix uygulamadım; istenen kapsam audit-only idi. Teşhisi kapatmak için mevcut auth modeline bağlı bir **read-only aggregate diagnostic** endpoint, fixture ID'lerini response'a koymadan hedef/son N fixture için `odds_snapshot_count`, `distinct_bookmaker_count`, `analysis_run_exists`, `prediction_candidate_exists`, `prediction_run_count`, `latest_collector_result/reason` döndürebilir. Öncelikle Render worker'ın deployed SHA ve gerçek `SUPPORTED_COMPETITIONS`/`NOWGOAL_ENABLED` değerleri kontrol edilmeli; Türkiye–İtalya Nations League A'nın deployed competition listesinde olup olmadığı doğrulanmalı. Bu öneridir; hiçbir değişiklik yapılmadı.

## Test sonucu

`npm run test:unit`: **başarısız** — 31 dosya: 27 geçti, 4 başarısız; 166 testin 155'i geçti, 11'i başarısız. Başarısızlıklar `test/unit/dashboard.test.ts`, `match-detail.test.ts`, `dashboard-route-resilience.test.ts`, `match-detail-route.test.ts` içinde UI metin/HTML beklentileri. Mevcut çalışma ağacında `src/dashboard.ts`, `src/match-detail.ts` modified ve `src/ui/` untracked olduğundan bu test sonucu audit tarafından yaratılmış regresyon olarak nitelenemez. Çalışma ağacına dokunulmadı.
