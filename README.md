# BETAPP V2

BETAPP V2; bağımsız futbol veri kaynaklarını qualification testinden geçiren, provider-bağımsız kimliklerle normalize eden ve PostgreSQL'de saklayan TypeScript/Node.js servisidir. FotMob aktif maç/istatistik provider'ı, Nowgoal aktif pre-match odds provider'ı, Sofascore bağımsız fakat bu ortamda engelli provider, Iddaa odds adayı ve Flashscore doğrulama adayıdır. Bu sürüm veri toplama, odds geçmişi, kaynak uzlaşması, sağlık izleme, dashboard ve açıklanabilir matematiksel Corner Engine V1'i içerir. AI, bahis önerisi ve otomatik bahis içermez.

## Kapsam

Yalnızca şu turnuvalar kabul edilir: Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Süper Lig, UEFA Champions League, UEFA Europa League ve UEFA Conference League. Filtre provider yanıtı normalize edilmeden önce Sofascore `uniqueTournament.id` üzerinden uygulanır.

> Sofascore için herkese açık, sözleşmeli bir geliştirici API'si kullanılmamaktadır. Provider adaptörü Sofascore'un web istemcisinin kullandığı endpoint'lere dayanır. Üretim kullanımından önce Sofascore kullanım koşulları, robots/rate-limit politikası ve veri lisanslarını doğrulayın. Adaptörün ayrı tutulmasının nedeni endpoint değişikliklerini çekirdek modele yaymadan değiştirebilmektir. Football API kullanılmaz.

## Mimari

```text
SofascoreProvider -> dayanıklı HTTP istemcisi -> Collector Worker
                                               |
                                               v
                                     PostgreSQL repository
                                      |      |        |
                               internal ID  cursor  source payload
                                      |                 |
                                      v                 v
                              Fastify API         Corner Engine V1
                              + Dashboard       profiles / backtest
                                   ^
                                   |
 odds_snapshots -> ODDS_V1 fair probability / movement / consensus
```

- `FootballDataProvider` bütün maç verisi kaynakları için ortak interface'tir. Sofascore ve FotMob collector'ları ayrı devre/cursor ile eşzamanlı çalışır; birinin arızası diğerini durdurmaz.
- `QualifiableProvider`, 21 capability için `SUPPORTED`, `PARTIAL`, `UNAVAILABLE`, `BLOCKED` veya `NOT_TESTED` sonucu ve HTTP/latency/sample/parser kanıtını üretir.
- `teams`, `leagues` ve `matches` BETAPP UUID'lerini tutar. `provider_entities`, dış ID ile internal ID arasındaki bağlantıdır.
- `(provider, entity_type, external_id)` primary key'i, transaction ve advisory lock birlikte tekrar eklemeyi engeller. İstatistikler de doğal bileşik anahtarla upsert edilir.
- `collector_checkpoints` sıradaki tarihi JSON cursor olarak saklar. Başarılı her günün sonunda checkpoint ilerler; restart aynı yerden devam eder.
- Takım alias normalizasyonu ve competition/kickoff/home/away tabanlı `EXACT`, `HIGH`, `MEDIUM`, `LOW`, `UNMATCHED` eşleştirme vardır. `LOW` ve `UNMATCHED` otomatik merge edilmez.
- Ham yanıtların yalnızca ilgili kompakt parçaları, parser sürümü, content type, SHA-256 hash ve fetch zamanı ile saklanır; payload satırı 64 KiB ile sınırlandırılır.
- `odds_snapshots` aynı oranı overwrite etmez. Ardışık aynı değer atlanır; değişimler opening/current/highest/lowest/movement/snapshotCount özetine dönüşür.
- Nowgoal adapter'ı erişilebilir public web proxy'sinden 1X2, Asya handikapı, toplam gol ve toplam korner pre-match oranlarını alır. Bookmaker'lar `nowgoal:bet365`, `nowgoal:pinnacle` gibi ayrı provider anahtarlarıyla saklanır. Hong Kong formatındaki handikap/üst-alt fiyatları decimal formata çevrilir; maçlar takım adları ve kickoff zamanı ile mevcut FotMob kayıtlarına güvenli biçimde bağlanır, belirsiz eşleşmeler atlanır.
- `data_observations` provider ölçümlerini, `data_consensus` ise basit `VERIFIED`, `SINGLE_SOURCE`, `CONFLICT`, `MISSING` kararını tutar.
- HTTP istemcisi timeout, istek hızı sınırı, exponential backoff ve jitter uygular. Provider kesintisi cycle'ı pas geçer; worker yaşamaya devam eder.
- Art arda provider hatalarında circuit breaker açılır ve cooldown boyunca gereksiz istek gönderilmez.
- Web ve worker ayrı süreçlerdir. Aynı migration'ı eşzamanlı başlatmaları PostgreSQL advisory lock ile güvenlidir.

### Corner Engine V1

- `historical_match_stats`, eksik istatistikleri `NULL` olarak korur; tek bir eksik alan yüzünden tamamlanmış maç atılmaz.
- Takım profilleri `LAST_5`, `LAST_10`, `LAST_20`, `SEASON` pencerelerinde ve `HOME`/`AWAY` ayrımında üretilir. Worker yeni tamamlanmış maçları yazdıktan sonra cycle sonunda profilleri ve lig baseline'larını atomik olarak yeniler.
- Beklenen ev/deplasman kornerleri; venue profili, rakibin against profili, recency, lig prior'ı ve küçük örneklem shrinkage'ından deterministik olarak hesaplanır. H2H ağırlığı en fazla `%10` olabilir. Pressure feature varsayılan olarak kapalıdır.
- Olasılıklar 6.5–13.5 çizgileri için Poisson veya Negative Binomial ile hesaplanır. `AUTO`, lig varyans/ortalama oranına göre dağılımı seçer ve overdispersion durumunu analiz detayında saklar.
- Data Quality kaynak/veri yeterliliğini, Model Confidence ise model kararlılığını ölçer; ikisi ayrı 0–100 skorudur. `POOR` kalitede olasılık hesaplanabilir fakat `analysisEligible=false` olur.
- Her analiz `CORNER_V1`, merkezi config'in SHA-256 hash'i ve oluşturulma zamanı ile saklanır. Config değişince eski analiz overwrite edilmez.
- Backtest her historical maçı yalnızca daha eski satırlarla yeniden oynatır; MAE, RMSE, Brier, log loss ve calibration bucket'larını raporlar.

### Odds Analysis V1

- `ODDS_V1`, aynı bookmaker/piyasa/line içindeki tüm seçimlerde `1 / decimalOdds` ham olasılığını hesaplar ve overround'a bölerek marjdan arındırılmış fair probability üretir. `1X2` için HOME + DRAW + AWAY, iki yönlü piyasalarda iki taraf yaklaşık `1` eder.
- Açılış ve güncel durum, yalnızca tamamlanmış piyasa state'lerinden ve kesinlikle `captured_at < kickoff_at` satırlarından oluşturulur. Düşen oran ile yükselen piyasa olasılığı ayrı yönler olarak gösterilir.
- Her bookmaker önce kendi içinde normalize edilir ve konsensüste yalnızca bir oy alır. Medyan ve MAD, uç değerlerin tek başına sonucu sürüklemesini sınırlar. `line`, piyasa anahtarının parçasıdır; 2.5 ile 3.5 birleştirilmez.
- `STRONG_SUPPORT`, `SUPPORT`, `NEUTRAL`, `OPPOSE`, `STRONG_OPPOSE` yalnızca piyasa hareketi sınıflarıdır. Sonuç garantisi veya bahis önerisi değildir. V1 eşikleri merkezi `src/odds-analysis/config.ts` dosyasındadır ve bilimsel olarak optimize edilmiş sayılmaz.
- Açıklanabilir 0–100 skorun movement, agreement, coverage, freshness ve stability bileşenleri ayrı saklanır. Data Quality verinin kullanılabilirliğini, Model Confidence ise hareketin büyüklük/tutarlılığını ölçer. `POOR` Data Quality her zaman `analysisEligible=false` üretir.
- Her koşu config SHA-256 ve snapshot-set SHA-256 ile history olarak saklanır. Aynı config ve aynı snapshot seti tekrar yazılmaz. Total corners için Corner Engine olasılığı mevcut ve kaliteli ise yalnızca nötr `modelMarketGapPp` karşılaştırması sunulur; skorlar birleştirilmez.
- Worker her cycle'da önce FotMob/Sofascore fikstürlerini kaydeder, sonra Nowgoal eşleştirmesi ve odds transaction'ını çalıştırır. Yeni snapshot yazılmışsa ODDS_V1 aynı maç için transaction sonrasında çalışır; analiz hatası odds kaydını geri almaz veya sonraki maçı durdurmaz.
- Bookmaker movement kalitesi yalnız selection sayısına dayanmaz: complete state sayısı, opening/current complete timestamp'leri ve iki state'in ayrık olması izlenir. Tek complete state yalnız diagnostic üretir ve eligible sayılmaz.
- Odds backtest'inde HOME/DRAW/AWAY binary event'leri probability calibration için ayrı tutulur; sinyal hit-rate raporları yalnız `SUPPORT` ve `STRONG_SUPPORT` sınıflarını kullanır. Leakage audit toplam girdi, kullanılan pre-kickoff, dışlanan kickoff-sonrası ve unsafe kullanılan snapshot sayılarını ayrı raporlar.
- Ayrıntılı yöntem, video inceleme notu ve sınırlar: [`docs/odds-analysis-v1.md`](docs/odds-analysis-v1.md).

### Prediction V1

- `PREDICTION_V1` ODDS_V1'dan aday üretir, benzer historical maçları yalnız kickoff öncesi oranlarla yeniden kurar, açıklanabilir skor üretir ve her maç için en fazla bir immutable resmi `PREDICT` veya `SKIP` kararı kilitler. Bu bir otomatik bahis motoru değildir: gerçek bahis yerleştirme ve AI prediction authority **false**'tur.
- Historical benzerlik aynı market/selection/line kimliğiyle çalışır; aynı lig örneklemini önce dener, gerektiğinde açıkça global kapsama geçer. Future leakage engeli hem canlı değerlendirmede hem chronological backtest'te zorunludur.
- Settlement 1X2, total goals/corners ve Nowgoal HOME-side Asian handicap convention'ını integer/half/quarter-line split ile destekler. Resmi journal değişmez; settlement ayrı tabloda tek idempotent satırdır.
- Dashboard ve API, değişebilir `ADAY TAHMİN`, kilitli resmi tahmin, `GEÇ`, sonuç ve yalnız locked kayıtları kullanan performans/kalibrasyon verilerini ayırır. Her yüzde N ile birlikte gösterilir; “Reference Paper Return” stored reference odds'a dayalı teorik ölçümdür, executable return değildir.
- Ayrıntılı pipeline, SKIP, settlement, lock, calibration ve sınırlar: [`docs/prediction-v1.md`](docs/prediction-v1.md).

### Free Historical Data V1

- FotMob, geçmiş maç istatistikleri için öncelikli ve etkin kaynaktır. `historical:backfill` job'u yeniden başlatılabilir, idempotenttir ve her import için kaynak/payload hash/normalizasyon sürümü provenance kaydı tutar.
- StatBunker, SoccerStats ve AdamChoi bu sürümde yalnız qualification durumundadır. Açık otomatik erişim izni olmadan production collector başlatılamaz. FootyStats HTML scraper kesinlikle kapalıdır; yalnız belgelenmiş API için ayrı yetkilendirme değerlendirilir.
- Historical istatistikler historical odds değildir. Hiçbir istatistik kaydı ODDS_V1/PREDICTION_V1 odds similarity örneği üretmez.
- Canlı, sınırlı FotMob audit ve diğer kaynaklar için gerçek qualification kaydı: [`docs/free-historical-data-v2-qualification.md`](docs/free-historical-data-v2-qualification.md).

### Odds Neighbor Engine V2

- **Oran Rotası**, yalnız gerçek, kickoff-öncesi `odds_snapshots` noktalarından bookmaker-normalize median rota oluşturur; ara oran türetmez.
- **Geçmiş İkizler**, Prediction V1'den bağımsızdır. Aynı market/line/selection için `CLOSEST_NEIGHBORS` veya ayrı anlam taşıyan `ODDS_BAND` araması yapar; her maç kendi 0–100 similarity skoru ile döner.
- **Sonuç Haritası** ikizleri yalnız gerçek historical odds kanıtıyla seçer; ardından skor ve mevcutsa FotMob historical stats ile goals, BTTS, corners ve cards dağılımlarını zenginleştirir. Eksik alanların paydası ayrı tutulur. İlk yarı golü, gerçek devre skoru yoksa üretilmez.
- **Kanıt Farkı** aynı lig tabanını tercih eder, örnek yetersizse global desteklenen liglere düşer; Wilson %95 aralığı ve ayrı kanıt seviyesi sunar. **Çelişki Kontrolü** açıklayıcıdır; resmi tahmin veya bahis kararı değildir.

```bash
# Chronological, cutoff-safe odds-neighbor backtest
npm run odds-neighbors:backtest
```

```bash
# FotMob geçmiş maç/statistik backfill (BACKFILL_ENABLED=true gerekir)
npm run historical:backfill -- --provider=fotmob --competition=PremierLeague --season=2025-2026

# Provider-independent kapsama yüzdeleri
npm run historical:audit

# PostgreSQL'e yazmadan sınırlı canlı FotMob örneklemesi
npm run historical:dry-run -- --competition=PremierLeague --season=2024-2025 --sample=12

# Sadece robots.txt üzerinden, kalıcı kayıt oluşturmayan source-policy sorgusu
npm run historical:qualify -- --provider=statbunker

# Güvenli policy/robots qualification
npm run providers:qualify -- --provider=statbunker
```

## Yerel kurulum

Gereksinimler: Node.js 22+, npm ve PostgreSQL 16+.

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

Ayrı terminalde collector:

```bash
npm run dev:worker
```

Tek seferlik veri toplama için `npm run collect:once` kullanın. Dashboard `http://localhost:3000`, health endpoint `GET /health`, dashboard JSON verisi `GET /api/dashboard`, normalize edilmiş yaklaşan Nowgoal oranları `GET /api/odds/upcoming` adresindedir.

Corner veri hattı:

```bash
# Dokuz yarışmanın mevcut ve önceki sezonunu idempotent biçimde indirir.
BACKFILL_ENABLED=true npm run data:backfill

# Tek lig/sezon veya tarih aralığı; varsayılan resume=true.
npm run data:backfill -- --competition=PremierLeague --season=2025-2026 --resume
npm run data:backfill -- --competition=LaLiga --from=2025-08-01 --to=2026-06-30
npm run data:backfill -- --competition=Bundesliga --season=2025-2026 --dry-run

# Persist edilmiş geçmişten rolling profilleri ve lig baseline'larını yeniler.
npm run corners:profiles

# Belirli günün upcoming maçlarını analiz eder.
npm run corners:analyze -- --date=2026-09-17

# Future leakage korumalı chronological replay çalıştırır.
npm run corners:backtest

# Premier League önceki tam sezon ile erken Stage 1 doğrulaması.
npm run corners:backtest:stage1

# Coverage, duplicate/invalid kayıt, sample ve dispersion audit'i üretir.
npm run data:audit

# Bugünün veya seçilen tarihin persist edilmiş oranlarını analiz eder.
npm run odds:analyze
npm run odds:analyze -- --date=2026-09-17

# Mevcut historical odds coverage üzerinde kickoff-safe replay yapar.
npm run odds:backtest

# Prediction V1: historical feature store, preview/lock, settlement, performance and chronological backtest.
npm run predictions:history:backfill
npm run predictions:analyze
npm run predictions:settle
npm run predictions:performance
npm run predictions:backtest
```

Persist edilmiş ODDS_V1 sonuçları `GET /api/odds-analysis/upcoming` ve `GET /api/odds-analysis/:matchId` endpoint'lerinden okunur. Henüz analiz yoksa match endpoint'i HTTP 500 yerine `NOT_GENERATED` empty state döndürür. Dashboard'daki **ORAN ANALİZİ V1** bölümü açılış/güncel oranı, fair probability değişimini, bookmaker teyidini, açıklanabilir skoru, Data Quality ve Model Confidence değerlerini gösterir.

Backfill lig/sezon checkpoint'i tuttuğundan restart sonrası kaldığı manifestten devam eder. `--resume=false` scope'u baştan idempotent olarak yeniden işler. Terminal ve dashboard; discovered/fetched/stored/corner-complete/partial/failed/retry/checkpoint sayaçlarını gösterir. İşlem sonunda profiller, lig baseline'ları ve dataset audit otomatik yenilenir. FotMob'a kontrollü yük bindirmek için provider rate limit, timeout ve retry ayarları geçerlidir. Tam backfill uzun sürebilir; production worker ile aynı anda başlatmadan önce bağlantı havuzu ve rate limit kapasitesini değerlendirin.

Veritabanı bağlantısı ve migration durumu:

```bash
npm run db:status
```

Çıktı bağlantı durumunu, uygulanmış/bekleyen migration'ları ve schema version'ı içerir. `/health`; read/write/transaction/advisory-lock kontrollerini, zorunlu tablo/index durumunu, sorgu latency'sini, migration özetini ve son başarılı sorgu zamanını ayrı `database` nesnesinde döndürür. Write kontrolü transaction içinde yapılıp rollback edilir.

Backtest raporu yalnızca maç kickoff'undan eski satırları kullanır. Warmup eşiğini karşılamayan maçlar `SKIPPED_INSUFFICIENT_HISTORY` olarak ayrılır; threshold, calibration, Data Quality ve Model Confidence bucket performansları ile en büyük 20 hata saklanır. Bu doğrulama model ağırlıklarını otomatik değiştirmez.

Provider qualification çalıştırmak ve sonucu PostgreSQL'e kaydetmek için:

```bash
npm run providers:qualify
```

Qualification yalnızca bağlantı kontrolü yapmaz; desteklenen liglerden en az bir yaklaşan ve bir tamamlanmış maç bulur, tamamlanmış maçın score/stat/lineup/H2H alanlarını gerçek payload üzerinde parse eder. Public HTML erişimi olan fakat doğrulanmış veri şeması bulunmayan capability'ler `NOT_TESTED` kalır.

Tam Docker ortamı:

```bash
docker compose up --build
```

İzole local integration database'i gerektiğinde ayrı profile ile başlatın:

```bash
docker compose --profile test up -d postgres_test
DB_TEST_DATABASE_URL=postgresql://betapp_test:betapp_test@localhost:5433/betapp_test \
DB_TEST_SCHEMA=betapp_test_integration npm run test:integration:db
```

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---:|---|
| `DATABASE_URL` | zorunlu | PostgreSQL connection URI |
| `DATABASE_SSL` | `false` | Render gibi ortamlarda TLS açar |
| `DB_POOL_MAX` | `10` | Süreç başına PostgreSQL pool üst sınırı |
| `DB_CONNECT_TIMEOUT` | `5000` | PostgreSQL bağlantı timeout'u (ms) |
| `DB_TEST_DATABASE_URL` | boş | Yalnızca integration testleri için ayrılmış, adında `test` geçen PostgreSQL URL'si |
| `DB_TEST_SCHEMA` | `betapp_test_integration` | `betapp_test_` prefix'li izole test schema'sı |
| `HOST` | `0.0.0.0` | HTTP bind adresi |
| `PORT` | `3000` | HTTP portu; Render bunu otomatik sağlar |
| `LOG_LEVEL` | `info` | Pino structured log seviyesi |
| `COLLECTOR_ENABLED` | `true` | Worker döngüsünü etkinleştirir |
| `BACKFILL_ENABLED` | `false` | Uzun historical backfill job'una açık opt-in verir |
| `FOTMOB_ENABLED` | `true` | FotMob collector/backfill provider'ını etkinleştirir |
| `NOWGOAL_ENABLED` | `true` | Nowgoal pre-match odds collector'ını etkinleştirir |
| `NOWGOAL_FUTURE_DAYS` | `3` | Bugün dahil ileri odds toplama penceresi |
| `NOWGOAL_COMPANY_IDS` | `2,3,4,14,15,22,136` | Virgülle ayrılmış Nowgoal bookmaker ID listesi |
| `SUPPORTED_COMPETITIONS` | dokuz turnuva | Virgülle ayrılmış sabit competition key listesi |
| `COLLECTOR_INTERVAL_MS` | `900000` | Cycle aralığı (en az 60 sn) |
| `COLLECTOR_HISTORY_DAYS` | `2` | Her tamamlanan cycle'da geriye bakış |
| `COLLECTOR_FUTURE_DAYS` | `14` | İleri fixture penceresi |
| `PROVIDER_TIMEOUT_MS` | `10000` | İstek timeout'u |
| `PROVIDER_REQUESTS_PER_SECOND` | `2` | Süreç başına provider hız limiti |
| `PROVIDER_MAX_RETRIES` | `4` | 408/429/5xx ve ağ hatası retry sayısı |
| `HISTORICAL_REQUEST_DELAY_MS` | `750` | Her historical match-detail isteği arasındaki ek koruyucu bekleme |
| `SOFASCORE_BASE_URL` | `https://api.sofascore.com/api/v1` | Provider base URL; bölgesel/WAF engelinde değiştirilebilir |
| `FOTMOB_BASE_URL` | `https://www.fotmob.com/api/data` | FotMob public web veri endpoint'i |
| `IDDAA_BASE_URL` | `https://www.iddaa.com` | Iddaa public site qualification adresi |
| `FLASHSCORE_BASE_URL` | `https://www.flashscore.com` | Flashscore public site qualification adresi |
| `NOWGOAL_BASE_URL` | public proxy URL | Nowgoal web istemcisinin kullandığı, değiştirilebilir odds proxy adresi |
| `PROVIDER_CIRCUIT_FAILURE_THRESHOLD` | `3` | Circuit açılmadan önce hata sayısı |
| `PROVIDER_CIRCUIT_COOLDOWN_MS` | `300000` | Yeniden deneme bekleme süresi |

## Test ve kalite

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:integration:db
npm run build
```

`DB_TEST_DATABASE_URL` ve `DB_TEST_SCHEMA` verilmezse integration testi Testcontainers ile geçici PostgreSQL 16 başlatır ve Docker daemon gerektirir. Production `DATABASE_URL` yalnızca açıkça `DB_TEST_SCHEMA` verilirse kullanılabilir. Önerilen yöntem adında `test` bulunan tamamen ayrı bir database URL'sidir:

```bash
DB_TEST_DATABASE_URL=postgresql://user:password@localhost:5432/betapp_test \
DB_TEST_SCHEMA=betapp_test_corner_engine \
npm run test:integration:db
```

Test başlangıçta bu schema'yı oluşturur, search path'i sadece ona yönlendirir ve sonunda yalnızca doğrulanmış test schema'sını siler. Production `DATABASE_URL` değerini destructive integration testlerinde kullanmayın.

## DEPLOY TO RENDER

`render.yaml`, Frankfurt bölgesinde web servisi, collector worker, production PostgreSQL ve ayrı test PostgreSQL'i Blueprint olarak tanımlar. Production servisleri yalnızca production database'in internal URL'sini kullanır. `Dockerfile` multi-stage build kullanır ve uygulamayı root olmayan kullanıcıyla çalıştırır.

1. GitHub'da boş repository oluşturup yerel commit'i gönderin:

   ```bash
   git remote add origin https://github.com/OWNER/BETAPPV2.git
   git push -u origin main
   ```

2. Render CLI mevcutsa authenticate edip Blueprint'i doğrulayın:

   ```bash
   render login
   render blueprints validate
   ```

3. Render Dashboard'da **New > Blueprint** seçip GitHub repository'sini bağlayın. Blueprint web, worker, production PostgreSQL ve izole test PostgreSQL kaynaklarını oluşturur.
4. İlk deploy sırasında web ve worker `preDeployCommand` ile `node dist/db/migrate.js` çalıştırır. Migration advisory lock iki instance'ın migration'ı eşzamanlı uygulamasını engeller. Manuel kontrol:

   ```bash
   npm run db:status
   npm run providers:qualify
   ```

5. `/health`, `/api/dashboard` ve `/api/backfill/status` endpoint'lerini doğrulayın. FotMob ve Nowgoal canlı erişimi qualification çıktısında `SUPPORTED` olmalıdır; Sofascore bölgesel olarak `BLOCKED` kalabilir.
6. Render Shell veya aynı internal database'e bağlı kontrollü job ortamında önce önceki tam Premier League sezonunu doldurun:

   ```bash
   BACKFILL_ENABLED=true npm run data:backfill -- --competition=PremierLeague --season=2025-2026 --resume
   npm run data:audit
   npm run corners:backtest:stage1
   ```

7. Stage 1 raporu doğrulandıktan sonra kalan ligleri README'deki sırayla backfill edin ve son olarak `npm run corners:backtest` çalıştırın.

Render web süreci `Dockerfile` varsayılan komutunu, worker ise `node dist/worker.js` komutunu kullanır. Docker web başlangıcı önce advisory-lock korumalı, idempotent migration komutunu çalıştırır; bu sayede pre-deploy alanı sunmayan manuel Render servisleri de güvenli biçimde hazırlanır. Blueprint ayrıca aynı migration'ı pre-deploy aşamasında çalıştırabilir. Render servisleri aynı production database'in internal URL'sini kullanır; dışarıdan kullanılan Render PostgreSQL URL'lerinde TLS açılmalıdır.

## Yeni provider ekleme

1. Maç verisi için `src/providers/provider.ts` içindeki `FootballDataProvider`, qualification için `QualifiableProvider` interface'ini uygulayın.
2. Provider payloadını `NormalizedMatch` ve `MatchStatistics` modellerine dönüştürün.
3. İzin verilen turnuvaları provider'ın kendi turnuva ID'leriyle açıkça eşleyin.
4. Worker composition root'unda provider'ı kaydedin.

Provider'a özgü ID veya payloadlar domain tablolarına anahtar olarak taşınmamalıdır; bunlar `provider_entities` ve `source_payloads` sınırında kalır.

Nowgoal web endpoint'i resmi/sözleşmeli bir geliştirici API'si değildir. Üretim kullanımı öncesi kullanım koşullarını ve veri lisansını doğrulayın. Endpoint değişikliği veya erişim engeli halinde adapter `UNAVAILABLE/BLOCKED` raporlar; boş ya da sentetik oran üretmez. İlk görülen geçerli fiyat opening snapshot olur, sonraki farklı fiyatlar movement geçmişine eklenir.
