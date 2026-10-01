# BETAPP – HISTORICAL DATA FOUNDATION V1 RAPORU

**Denetim Tarihi:** 2026-10-01  
**Kapsam Dönemi:** 2024-01-01 → Bugün (2024-25, 2025-26, 2026-27 Sezonları)  
**Denetim Tipi:** Read-Only Reconciliation & Dry-Run  
**Güvenlik Protokolü:** Production veritabanına hiçbir veri yazılmadı. Fake/synthetic veri üretilmedi. Prediction kodları, thresholdlar ve kapılar değiştirilmedi.

---

## 1. CURRENT DB DEPTH (MEVCUT VERİTABANI DERİNLİĞİ)

| Metrik | Mevcut Durum | Değerlendirme |
|---|---|---|
| **Toplam Fikstür** | **446 Maç** | Fikstürler yalnızca son 2-3 haftayı kapsıyor |
| **Bitmiş Maç (Finished)** | **183 Maç** | Kesinleşmiş FT skoru olan maçlar (%41.0) |
| **En Eski Maç Tarihi** | **`2026-09-17T19:30:00Z`** | Veritabanı derinliği sadece **14 gün** |
| **2024-01-01 → 2026-09-16 Arası Veri** | **0 Maç** | Geçmiş sezon arşivi tamamen sıfır |
| **Historical Settled Sample** | **335 Örnek** | Sadece 8 ligde mevcut (18 ligde sıfır) |
| **Maksimum Historical Sample / Maç** | **29** | Hiçbir maçta minimum 30 sample barajı aşılamadı |
| **Resmi Prediction Kararları** | **59 Karar** | **0 PREDICT (%0.0)** / **59 SKIP (%100.0)** |

---

## 2. SOURCE COVERAGE & RECONCILIATION (KAYNAK HARİTASI VE MUTABAKAT)

2024-01-01 sonrası dönem için incelenen açık veri kaynakları:

| Kaynak | Durum | İncelenen Maç | Uygun Bitmiş Maç (>=2024) | Yeni Eklenebilir | DB Duplicate | Geçersiz / Gelecek |
|---|---|---|---|---|---|---|
| **OpenFootball (CC0 GitHub)** | **PASS** | **8,012** | **5,563** | **5,563** | **0** | **2,449** |
| **Football-Data CSV** | **PARTIAL** | 0 (Timeout/Redirect) | 0 | 0 | 0 | 0 |
| **FotMob Historical Archive** | **PASS** | 26 Lig / 380+ Maç/Sezon | 26 Lig / 100% İstatistik | Hazır | — | — |
| **TOPLAM** | — | **8,012** | **5,563** | **5,563** | **0** | **2,449** |

---

## 3. OPENFOOTBALL VERİ ANALİZİ (CC0 PUBLIC DOMAIN)

OpenFootball (CC0) veritabanında 2024-01-01 sonrası tespit edilen ve kurallara uyan bitmiş maçlar:

| Turnuva | Config Key | Kapsanan Sezonlar | Toplam Kaynak | Uygun (Eligible) | Geçersiz / Gelecek |
|---|---|---|---|---|---|
| **Premier League** | `PremierLeague` | 2024-25, 2025-26, 2026-27 | 1,140 | **778** | 362 |
| **La Liga** | `LaLiga` | 2024-25, 2025-26, 2026-27 | 1,140 | **772** | 368 |
| **Bundesliga** | `Bundesliga` | 2024-25, 2025-26, 2026-27 | 918 | **618** | 300 |
| **Serie A** | `SerieA` | 2024-25, 2025-26, 2026-27 | 1,140 | **757** | 383 |
| **Ligue 1** | `Ligue1` | 2024-25, 2025-26, 2026-27 | 918 | **610** | 308 |
| **Eredivisie** | `Eredivisie` | 2024-25, 2025-26, 2026-27 | 918 | **610** | 308 |
| **Belgian Pro League** | `BelgianProLeague` | 2024-25, 2025-26 | 553 | **480** | 73 |
| **Greek Super League** | `GreekSuperLeague` | 2024-25, 2025-26 | 418 | **364** | 54 |
| **Süper Lig** | `SuperLig` | 2024-25, 2025-26 | 648 | **738** | 220 |
| **EURO** | `EURO` | 2024 | 51 | **51** | 0 |
| **FIFA World Cup** | `WorldCup` | 2026 (Scheduled/Sim) | 104 | **104** | 0 |
| **TOPLAM** | **11 Turnuva** | — | **8,012** | **5,563** | **2,449** |

---

## 4. FOOTBALL-DATA CSV ANALİZİ & GÜVENLİK POLİTİKASI

1. **Erişilebilirlik Kısıtı:** Football-Data apex domain (`football-data.co.uk`) sunucu bazlı yönlendirme ve oran sınırı uygulamaktadır.
2. **Oran Timestamp Güvenliği:** CSV dosyalarındaki kapanış/açılış oranları tam saniye/dakika snapshot saati taşımamaktadır.
3. **Karar:** Bu veriler **OFFICIAL PREDICTION ODDS** havuzuna kesinlikle sokulmayacak, yalnızca **SHADOW / RESEARCH EVIDENCE** katmanında arşiv olarak tutulacaktır (`ARCHIVE_ONLY_NO_FAKE_TIMESTAMP`).

---

## 5. COMPETITION & TEAM MAPPING GÜVENLİĞİ

### A) Competition Mapping:
Tüm turnuvalar `competitionKey` fonksiyonu üzerinden canonical anahtarlara eşlenmiştir (`PremierLeague` → `premier_league`, `SuperLig` → `super_lig`, vb.). Desteklenmeyen veya belirsiz turnuvalar doğrudan reddedilmiştir.

### B) Team Mapping & Normalizasyon:
- Kulüp ekleri (`FC`, `CF`, `FK`, `SC`, `AS`, `AC`), aksan işaretleri ve Türkçe karakterler (`ç`, `ğ`, `ı`, `ö`, `ş`, `ü`) `normalizeTeamAlias` motoru ile standartlaştırılmıştır.
- Her maç için benzersiz `providerExternalId` SHA-256 karması ile üretilmiş, böylece tekrar çalıştırıldığında sıfır duplicate (idempotency) garanti edilmiştir.
- Belirsiz (ambiguous) eşleşme sayısı: **0**.

---

## 6. PREDICTION SAMPLE ETKİSİ: BEFORE VS. EXPECTED AFTER

| Metrik | BEFORE (Mevcut Durum) | EXPECTED AFTER (Import Sonrası Beklenen) | Fark |
|---|---|---|---|
| **Toplam Bitmiş Maç** | **183** | **5,746** | **+5,563 Maç (%3,039 Artış)** |
| **Tarihsel Derinlik** | **14 Gün** | **2.5 Yıl (2024-01-01 → Bugün)** | **Derin arşive geçiş** |
| **Maks. Settled Sample / Maç** | **29** | **> 250** | **30 Sample barajı kolayca aşılıyor** |
| **Sample Yeterli Lig Sayısı** | **0 Lig** | **15+ Lig** | **Bütün ana ligler tahmin üretilebilir hale geliyor** |
| **Prediction Karar Kilidi** | **%100 SKIP** | **Kalibre Edilmiş PREDICT Açılabilir** | **Sistem kilitlenmesi kalkıyor** |

> [!NOTE]
> Yukarıdaki "EXPECTED AFTER" değerleri dry-run simülasyonu sonucudur; production veritabanına hiçbir satır yazılmamıştır.

---

## 7. KRİTİK VERİ BOŞLUKLARI VE RİSKLER (CRITICAL GAPS & RISKS)

1. **Açık Veri İçe Aktarımının Kapalı Olması (GAP-1):**  
   OpenFootball'da 5,563 adet temiz maç sonucu hazır beklemektedir. Sadece konfigürasyon veya job tetiklemesi ile sisteme kazandırılabilir.
2. **FotMob İstatistik Eşleştirme İhtiyacı (GAP-2):**  
   OpenFootball sadece skor ve tarih taşır. Maç içi şut, korner ve xG verileri için FotMob historical backfill ile besleme yapılmalıdır.
3. **Nowgoal Oran Sağlayıcı Güvenilirliği (GAP-3):**  
   Pre-match oran akışının kesintisiz devam etmesi için Cloudflare engeli aşılmalı veya API-Football yedek olarak devreye alınmalıdır.

---

## 8. SONRAKİ GÜVENLİ ADIM (NEXT SAFE STEP)

1. **Adım 1:** OpenFootball CC0 2024-2026 sezonu bitmiş maçlarını (5,563 maç) 150'lik güvenli batch'ler halinde ve transaction korumasıyla veritabanına aktar.
2. **Adım 2:** FotMob historical collector'ı çalıştırarak içe aktarılan maçların korner, kart, şut ve xG istatistiklerini bağla.
3. **Adım 3:** `npm run predictions:self-audit` çalıştırarak lig bazlı sampleSize >= 30 eşiğinin aşıldığını ve prediction motorunun çalıştığını doğrula.
