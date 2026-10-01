# BETAPP – TÜM MAÇLAR İÇİN VERİ KAPSAMI AUDIT V1

**Denetim Tarihi:** 2026-10-01  
**Hedef Ortam:** Production (`https://betappv2.onrender.com`)  
**Denetim Tipi:** Read-Only Veri Kapsamı, Kaynak Haritası ve Pipeline Kayıp Analizi  
**Kural Uyumu:** Kod değiştirilmedi, DB'ye yazılmadı, fake veri üretilmedi, commit/push yapılmadı.

---

## 1. YÖNETİCİ ÖZETİ (EXECUTIVE SUMMARY)

| Metrik | Ölçülen Değer | Açıklama |
|---|---|---|
| **Toplam Yapılandırılmış Turnuva** | **26** | `fotmobCompetitions` ve `SUPPORTED_COMPETITIONS` tanımı |
| **Fikstürü Bulunan Turnuva** | **16** | DB'de en az 1 maçı olan turnuvalar |
| **Sıfır Fikstürlü Turnuva** | **10** | Turnuvası başlamamış veya çekilmemiş ligler |
| **Toplam Fikstür (Matches)** | **446** | DB'deki toplam maç sayısı |
| **Bitmiş Maç (Finished)** | **183** | FT skoru kesinleşmiş maçlar (%41.0) |
| **Planlanmış Gelecek Maç** | **263** | Gelecek maçlar (161'i 7 gün içinde) |
| **İstatistikli Maçlar (Stats)** | **161** | Bitmiş maçların %88.0'ı, toplamın %36.1'i |
| **Oranlı Maçlar (Odds)** | **84** | Bitmiş maçların %41.0'ı, toplamın %18.8'i |
| **3+ Bookmaker Oranlı Maçlar** | **79** | 3 veya daha fazla bürosu olan maçlar (%17.7) |
| **Toplam Oran Snapshot Sayısı** | **28,329** | 27,855'i pre-kickoff, 1,907'si post-kickoff |
| **Historical Settled Sample** | **335** | 129 1X2, 108 AH, 98 O/U (Sadece 8 ligde var, 18 ligde 0!) |
| **Maksimum Historical Sample** | **29** | Hiçbir maçta minimum 30 sample eşiğine ulaşılamadı |
| **Resmi Prediction Kararı** | **59** | 0 PREDICT (%0), 59 SKIP (%100) |
| **Tarihsel Veri Derinliği** | **14 Gün** | En eski maç: `2026-09-17`. 2024-2025 arşivi: 0 maç! |

---

## 2. VERİ KAYNAKLARI VE SAĞLAYICI HARİTASI (PROVIDER CAPABILITY MATRIX)

Kodda tanımlı olan veri sağlayıcılarının BETAPP içinde **gerçekte ne kadar uygulandığı ve kullanıldığı** aşağıda haritalanmıştır:

| Provider | Fixtures | Results | Team Data | Team Form | Match Stats | H2H | Standings | Odds | Historical Odds | Lineups | Events | Çalışma Durumu (Production) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Fotmob** | **PASS** | **PASS** | **PASS** | **FAIL** | **PASS** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **HEALTHY** (Aktif birincil kaynak) |
| **Sofascore** | **BLOCKED** | **BLOCKED** | **BLOCKED** | **FAIL** | **BLOCKED** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **BLOCKED** (Cloudflare HTTP 403) |
| **Nowgoal (Pre-match)** | **PARTIAL** | **FAIL** | **PARTIAL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **PASS** | **FAIL** | **FAIL** | **FAIL** | **BLOCKED** (HTTP 403 - Periyodik kilitlenme) |
| **Nowgoal (Live Odds)** | **PARTIAL** | **PARTIAL** | **PARTIAL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **PASS** | **PARTIAL** | **FAIL** | **FAIL** | **HEALTHY** (30s canlı capture) |
| **API-Football** | **UNCONFIGURED** | **UNCONFIGURED** | **UNCONFIGURED** | **FAIL** | **UNCONFIGURED** | **FAIL** | **FAIL** | **UNCONFIGURED** | **FAIL** | **FAIL** | **UNCONFIGURED** | **NOT_CONFIGURED** (API Key boş) |
| **OpenFootball (CC0)** | **DISABLED** | **DISABLED** | **DISABLED** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **DISABLED** (Config'de kapalı) |
| **Public CSV (Football-Data)**| **DISABLED** | **DISABLED** | **DISABLED** | **FAIL** | **DISABLED** | **FAIL** | **FAIL** | **DISABLED** | **DISABLED** | **FAIL** | **FAIL** | **DISABLED** (Config'de kapalı) |
| **Iddaa** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **PARTIAL** | **FAIL** | **FAIL** | **FAIL** | **UNKNOWN** (Yalnızca parser taslağı) |
| **AdamChoi** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **NOT_IMPLEMENTED** (Boş stub) |
| **SoccerStats** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **NOT_IMPLEMENTED** (Boş stub) |
| **Statbunker** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **NOT_IMPLEMENTED** (Boş stub) |

### Önemli Tespitler:
1. **Fotmob:** Fikstür ve maç istatistikleri (korner, şut, faul, kart, topla oynama, xG) için kusursuz çalışıyor. Ancak Fotmob oran, puan durumu, H2H ve kadro sağlamıyor (veya kodda DB'ye kaydedilmiyor).
2. **Nowgoal:** 15 bookmaker'dan 1X2, Asya Handikap, Alt/Üst ve Korner oranlarını çekebilen tek sağlayıcı. Fakat Render IP'si Cloudflare/HTTP 403 engeline takıldığı için oran akışı sık sık kesiliyor.
3. **Sofascore:** Cloudflare bot koruması nedeniyle tamamen kilitli (HTTP 403). Hiçbir veri akmıyor.
4. **API-Football:** Kod altyapısı hazır olmasına rağmen API Key tanımlanmadığı için devre dışı.
5. **OpenFootball & Public CSV:** Kodda tam teşekküllü import modülleri olmasına rağmen environment ayarlarında `ENABLED=false` olduğu için geçmiş yıllara ait yüzlerce maçlık veri tabana aktarılamıyor.

---

## 3. VERİ KAYBI HUNİSİ (THEORETICAL PIPELINE & LOSS FUNNEL)

Bir maç fikstürünün resmi tahmine dönüşene kadar geçtiği her aşamadaki gerçek üretim verisi ve kayıp oranları:

```
[1. Fikstür (Fixture)] --------------------> 446 Maç (%100.0)
         │  (263 maç henüz oynanmadı / planlandı)
         ▼
[2. Sonuçlanma (Result)] ------------------> 183 Bitmiş Maç (%41.0)
         │  (Tüm takımlar isim ve ID olarak mevcut)
         ▼
[3. Takım Verisi (Team Data)] ------------> 446 Maç (%100.0)
         │  (Geçmiş derinlik 14 gün; >=5 maçlık takım formu üretilemiyor)
         ▼
[4. Takım Formu (Recent Form L5)] ---------> 0 Takım / 0 Maç (%0.0)  <-- [KRİTİK VERİ BOŞLUĞU]
         │  (Bitmiş 183 maçın 161'inde korner/şut/xg var)
         ▼
[5. Maç İstatistikleri (Stats)] ----------> 161 Maç (%36.1 genel / %88.0 bitmiş)
         │  (Nowgoal 403 engeli + eşleşmeyen maçlar: 77 maçta oran eksik)
         ▼
[6. Pre-Match Oran (Odds)] ---------------> 84 Maç (%18.8 genel / %45.9 bitmiş)
         │  (En az 3 büro şartı)
         ▼
[7. 3+ Bookmaker Oranı] -----------------> 79 Maç (%17.7 genel / %43.2 bitmiş)
         │  (Yalnızca canlı/yaklaşan birkaç maç için tetikleniyor)
         ▼
[8. Oran Analizi (Odds Analysis)] --------> 7 Maç (%1.6)
         │  (Settled historical sample >= 30 şartı; DB'deki maks sample = 29)
         ▼
[9. Yeterli Historical Sample (>=30)] ----> 0 Maç (%0.0)  <-- [PREDICTION KİLİDİ]
         │  (Bugün ve yaklaşan maçlardaki adaylar)
         ▼
[10. Prediction Adayı (Candidates)] -------> 12 Maç (%2.7)
         │  (ODDS_NOT_ELIGIBLE & SAMPLE < 30 nedeniyle hepsi eleniyor)
         ▼
[11. Resmi Tahmin (PREDICT)] -------------> 0 Maç (%0.0)  (59 kararın 59'u SKIP)
```

---

## 4. TÜM COMPETITION'LAR İÇİN KAPSAM TABLOSU (COMPETITION COVERAGE TABLE)

Sistemde tanımlı olan **26 turnuvanın tamamı** için production DB ölçümleri:

| # | Competition | Season | Fixtures | Finished | Stats | Odds | 3+ Bookmakers | Odds Analysis | Historical Sample | Prediction Candidates | Official Predictions | PREDICT Count |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Premier League** | 2026-27 | 30 | 10 | 10 | 9 | 9 | 0 | 57 | 0 | 3 | 0 |
| 2 | **La Liga** | 2026-27 | 30 | 10 | 10 | 7 | 7 | 0 | 46 | 0 | 4 | 0 |
| 3 | **Bundesliga** | 2026-27 | 27 | 9 | 9 | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| 4 | **Serie A** | 2026-27 | 30 | 10 | 10 | 10 | 10 | 0 | 50 | 0 | 5 | 0 |
| 5 | **Ligue 1** | 2026-27 | 27 | 9 | 9 | 2 | 2 | 0 | 34 | 0 | 1 | 0 |
| 6 | **Süper Lig** | 2026-27 | 27 | 9 | 9 | 4 | 4 | 0 | 30 | 0 | 2 | 0 |
| 7 | **UEFA Champions League** | 2026-27 | 36 | 18 | 18 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 8 | **UEFA Europa League** | 2026-27 | 36 | 18 | 18 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 9 | **UEFA Conference League** | 2026-27 | 18 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 10 | **Brasileirão Série A** | 2026-27 | 10 | 0 | 0 | 1 | 1 | 1 | 0 | 1 | 0 | 0 |
| 11 | **Eredivisie** | 2026-27 | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 12 | **Belgian Pro League** | 2026-27 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 13 | **Danish Superliga** | 2026-27 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 14 | **Allsvenskan** | 2026-27 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 15 | **Greek Super League** | 2026-27 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 16 | **FIFA World Cup** | UNKNOWN | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 17 | **EURO** | UNKNOWN | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 18 | **UEFA Nations League A** | 2026-27 | 32 | 16 | 16 | 3 | 3 | 1 | 16 | 1 | 2 | 0 |
| 19 | **UEFA Nations League B** | 2026-27 | 32 | 16 | 16 | 4 | 4 | 0 | 0 | 0 | 4 | 0 |
| 20 | **UEFA Nations League C** | 2026-27 | 32 | 16 | 16 | 8 | 8 | 0 | 0 | 0 | 8 | 0 |
| 21 | **UEFA Nations League D** | 2026-27 | 8 | 4 | 5 | 2 | 2 | 0 | 2 | 0 | 2 | 0 |
| 22 | **World Cup Qualification UEFA** | UNKNOWN | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 23 | **EURO Qualification** | UNKNOWN | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 24 | **Copa America** | UNKNOWN | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 25 | **World Cup Qualification CONMEBOL**| UNKNOWN | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 26 | **Friendlies (Hazırlık Maçları)** | 2026-27 | 77 | 38 | 15 | 33 | 28 | 5 | 100 | 10 | 28 | 0 |
| **TOPLAM** | **26 Turnuva** | — | **446** | **183** | **161** | **84** | **79** | **7** | **335** | **12** | **59** | **0** |

---

## 5. EN KRİTİK ANALİZ (SORU VE CEVAPLAR)

### A) Fixture verisi geniş ama historical match data dar mı?
**EVET.** 
Fikstür havuzunda 446 maç mevcuttur; ancak veritabanındaki en eski maç tarihi **`2026-09-17`**dir. Yani sistem yalnızca son **14 günlük** maç geçmişine sahiptir. 2024, 2025 veya 2026 başından gelen hiçbir derin historical arşiv veritabanında yoktur.

### B) Match results var ama statistics eksik mi?
**KISMEN.** 
Bitmiş 183 maçın 161'inde (%88.0) Fotmob üzerinden çekilmiş detaylı istatistikler (şut, korner, faul, kart, possession, xG) mevcuttur. Ancak toplam 446 fikstür bazında bakıldığında oran %36.1'dir.

### C) Stats var ama odds eksik mi?
**EVET, EN KRİTİK DARBOĞAZLARDAN BİRİ.** 
İstatistiği olan 161 maçın sadece 84'ünde oran kaydedilebilmiştir (%52.2). Bitmiş 183 maçın 108'inde (%59.0) hiç oran verisi yoktur. Şampiyonlar Ligi ve Avrupa Ligi'ndeki 36 bitmiş maçın **0 tanesinde** oran kaydedilmemiştir.

### D) Odds var ama odds_analysis eksik mi?
**EVET.** 
Oran kaydedilmiş 84 maç bulunmasına rağmen, odds analysis pipeline'ı yalnızca yaklaşan ve dashboard'da incelenen çok az sayıda maç için çalıştırılmıştır (şu an sadece 7 maç).

### E) Historical results var ama prediction sample oluşturulamıyor mu?
**EVET.** 
Bir bitmiş maçın `prediction_historical_examples` tablosuna girebilmesi için hem FT skorunun hem de **maç öncesi doğrulanmış oranının (`pre_kickoff_verified`)** bulunması şarttır. Oransız maçlar sample oluşturamadığı için, 183 bitmiş maçtan yalnızca 335 market örneği türetilebilmiştir. 18 ligde historical sample sayısı **0**'dır.

### F) Bazı competition'lar provider tarafından hiç desteklenmiyor mu?
**KISMEN.** 
Fotmob 26 turnuvanın tamamını tanımlamaktadır; ancak milli takım turnuvaları (Dünya Kupası, EURO, Copa America) aktif olmadığı için fikstürleri sıfırdır. Nowgoal ise Eredivisie, Belçika Ligi, İskandinav ligleri gibi liglerin oranlarını sağlamamaktadır veya eşleştirememektedir.

### G) Provider destekliyor fakat bizim importer almıyor mu?
**EVET.** 
OpenFootball (CC0) ve Football-Data CSV import servisleri kodda tamamen yazılmıştır; ancak Render ortamında `OPENFOOTBALL_IMPORT_ENABLED=false` ve `PUBLIC_CSV_IMPORT_ENABLED=false` olarak kapalı tutulmaktadır. Dolayısıyla mevcut ücretsiz arşivler sisteme aktarılmamaktadır.

### H) Importer alıyor fakat DB'ye yazılmıyor mu?
**HAYIR.** 
Importer çalıştığı zaman DB'ye doğru yazmaktadır; ancak `FotmobProvider` H2H, kadro ve olay verilerini API yanıtında almasına rağmen DB tablolarına parse edip yazmamaktadır (sadece `match_statistics` tablosuna yazmaktadır).

### I) DB'de var fakat prediction query kullanmıyor mu?
**EVET.** 
Prediction V1 motorunun katı güvenlik kapıları (`sampleSize >= 30`, `ODDS_ELIGIBLE`, `BOOKMAKER_COUNT >= 3`) bulunmaktadır. Veritabanındaki en yüksek sample boyutu 29 olduğu için, prediction engine tüm adayları `ODDS_NOT_ELIGIBLE` ve `LOW_MODEL_CONFIDENCE` gerekçesiyle **SKIP** etmektedir (59 değerlendirmenin 59'u da SKIP).

---

## 6. PROVIDER COVERAGE: DIŞARI DÜNYA VS. BETAPP DB AYRIMI

| Sağlayıcı | Dış Dünyada Sağladığı İddia Edilen Veri | BETAPP Kodundaki Durum | BETAPP DB'deki Gerçek Durum |
|---|---|---|---|
| **Fotmob** | Küresel fikstür, canlı skor, detaylı istatistik, xG, kadro, H2H, puan durumu, oranlar | Fikstür, skor ve maç istatistikleri yazılıyor; kadro, H2H, puan durumu ve oranlar parse edilmiyor | 446 fikstür, 183 sonuç, 161 istatistik mevcut. Oran/H2H/Kadro sıfır. |
| **Sofascore** | Fikstür, oyuncu puanları, ısı haritası, istatistik, oranlar | HTTP client ve parser kodu mevcut | **0 veri** (Cloudflare HTTP 403 engeli) |
| **Nowgoal** | 100+ lig, 20+ bookmaker pre-match ve canlı oranları | 1X2, AH, OU, Corner oranları parse ediliyor | 84 maçta oran, 28,329 snapshot. Ancak sık sık 403 engeline takılıyor. |
| **API-Football** | Tüm dünya ligleri, canlı olaylar, istatistikler, oranlar | Tam parser ve modeller hazır | **0 veri** (API Key atanmamış, disabled) |
| **OpenFootball** | 2024-2027 tüm büyük liglerin maç sonuçları ve skorları (CC0) | Batch importer ve parser hazır | **0 veri** (Config'de disabled) |
| **Football-Data CSV** | 2024-2027 lig maç sonuçları, istatistikleri ve kapanış oranları | CSV parser ve repository hazır | **0 veri** (Config'de disabled) |

---

## 7. TARİHSEL VERİ DERİNLİĞİ (HISTORICAL DATA AUDIT)

- **DB'deki En Eski Maç:** `2026-09-17T19:30:00.000Z`
- **DB'deki En Yeni Maç:** `2026-10-12T17:00:00.000Z`
- **Toplam Tarihsel Kapsam:** **14 Gün**
- **2024-01-01 - 2026-09-16 Arası Veri:** **0 Maç**

### Turnuva Bazında Tarihsel Örnek Dağılımı:
- **Friendlies:** 100 örnek
- **Premier League:** 57 örnek
- **Serie A:** 50 örnek
- **La Liga:** 46 örnek
- **Ligue 1:** 34 örnek
- **Süper Lig:** 30 örnek
- **UEFA Nations League A:** 16 örnek
- **UEFA Nations League D:** 2 örnek
- **Geri Kalan 18 Turnuva:** **0 örnek!**

---

## 8. KRİTİK VERİ EKSİKLİKLERİ (CRITICAL GAPS)

1. **CRITICAL GAP 1 (Derin Tarihsel Arşiv Yokluğu):**  
   Veritabanında 14 günden eski tek bir maç dahi yoktur. Prediction motorunun ihtiyaç duyduğu tarihsel benzerlik ve kalibrasyon havuzu boştur.

2. **CRITICAL GAP 2 (Nowgoal Oran Sağlayıcısı Kırılganlığı):**  
   Oran sağlayan tek aktif servis Nowgoal'dir ve Render sunucularından Cloudflare HTTP 403 ile engellenmektedir. 183 bitmiş maçın %59'unda oran kaydedilememiştir.

3. **CRITICAL GAP 3 (Takım Formu ve H2H Boşluğu):**  
   Son 14 günde takımların yalnızca 1-2 maçı kaydedilebildiği için rolling form (son 5 maç formu, iç/dış saha gol beklentisi) hesaplanamamaktadır.

4. **CRITICAL GAP 4 (Prediction V1 %100 SKIP Kilitlenmesi):**  
   Minimum 30 historical sample ve katı odds filtreleri nedeniyle bugüne kadar üretilen 59 resmi kararın tamamı SKIP olmuştur.

5. **CRITICAL GAP 5 (Açık Veri İçe Aktarımının Kapalı Olması):**  
   OpenFootball ve Football-Data CSV gibi sıfır maliyetli 3 yıllık hazır veri arşivleri sistemde kodlanmış olmasına rağmen kapalı tutulmaktadır.

6. **CRITICAL GAP 6 (Tek Sağlayıcı Bağımlılığı):**  
   Fikstür ve istatistikte sadece Fotmob çalışmakta; Sofascore (403) ve API-Football (unconfigured) çalışmadığı için yedeklilik bulunmamaktadır.

---

## 9. HEDEF MİMARİ: UNIFIED FOOTBALL DATA LAYER

Mevcut sistemi bozmadan, veri sağlayıcılarını tahmin motorundan tamamen soyutlayan hedef mimari:

```
  +------------------+  +------------------+  +------------------+  +------------------+
  |  Fotmob Provider |  | Nowgoal Provider |  | API-Football     |  | OpenFootball/CSV |
  | (Fixtures/Stats) |  |   (Odds Engine)  |  |  (Live Backup)   |  | (Historical CC0) |
  +------------------+  +------------------+  +------------------+  +------------------+
            │                     │                     │                     │
            └─────────────────────┼─────────────────────┴─────────────────────┘
                                  ▼
                     +──────────────────────────+
                     |  CANONICAL NORMALIZER    |
                     |  - Team Alias Mapping    |
                     |  - Competition Aliasing  |
                     |  - Timestamp UTC Lock    |
                     +──────────────────────────+
                                  │
                                  ▼
                     +──────────────────────────+
                     |  POSTGRESQL RELATIONAL   |
                     |  - canonical_matches     |
                     |  - match_statistics      |
                     |  - pre_match_odds        |
                     |  - historical_samples    |
                     +──────────────────────────+
                                  │
                                  ▼
                     +──────────────────────────+
                     | FEATURE & ANALYTICS LAYER|
                     | - Rolling Form (L5/L10)  |
                     | - Home/Away Splits       |
                     | - Odds Neighbor Routes   |
                     +──────────────────────────+
                                  │
                                  ▼
                     +──────────────────────────+
                     | PREDICTION ENGINE (V1/V2)|
                     | - Autonomous Decision    |
                     | - Confidence & Gates     |
                     | - AI Verification Guard  |
                     +──────────────────────────+
```

---

## 10. DENETİM ÇIKTI RAPORLARI

- **Markdown Raporu:** `reports/all-match-data-coverage-audit-v1.md`
- **JSON Veri Dosyası:** `reports/all-match-data-coverage-audit-v1.json`
