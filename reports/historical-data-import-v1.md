# BETAPP – HISTORICAL DATA FOUNDATION V1 – CONTROLLED IMPORT RAPORU

**Denetim & Hazırlık Tarihi:** 2026-10-01  
**Kapsam:** 2024-01-01 → Bugün (2024-25, 2025-26, 2026-27 Sezonları)  
**Seçilen Kaynak:** OpenFootball (CC0 Public Domain) – OFFICIAL HISTORICAL RESULTS  
**İzole Edilen Kaynak:** Football-Data CSV – SHADOW / RESEARCH ONLY (Oranlar resmi tahmin havuzuna alınmadı)

---

## 1. IMPORT GÜVENLİK VE ÇALIŞMA PROTOKOLÜ

- **Varsayılan Güvenlik Kilidi:** `DATA_BACKFILL_ENABLED=false`
- **Çalışma Modu:** Yalnızca açıkça `DATA_BACKFILL_ENABLED=true` (veya `BACKFILL_ENABLED=true`) ve geçerli bir `DATABASE_URL` sağlandığında veritabanı yazma işlemi gerçekleştirilebilir.
- **Lokal / Test Ortamı Sonucu:** `DATABASE_URL` atanmadığında `PRODUCTION_DB_UNAVAILABLE`; `DATA_BACKFILL_ENABLED=false` olduğunda ise `BACKFILL_DISABLED` yanıtı döndürülerek koruma sağlanmıştır.
- **Gizli / Otomatik Yazma:** Kesinlikle engellenmiştir (`NO_WRITE`).

---

## 2. RECONCILIATION VE IMPORT METRİKLERİ

| Metrik | Değer | Açıklama |
|---|---|---|
| **SOURCE_TOTAL** | **8,012** | OpenFootball açık veri setlerindeki toplam ham fikstür |
| **ELIGIBLE** | **5,563** | 2024-01-01 sonrası geçerli başlama saati ve kesin FT skoru olan bitmiş maçlar |
| **EXISTING_BEFORE** | **183** | Mevcut veritabanındaki bitmiş maç sayısı |
| **NEW_INSERTABLE** | **5,563** | Veritabanına yeni ve çakışmasız eklenebilir maç sayısı |
| **IMPORTED (Lokal)** | **0** | `BACKFILL_DISABLED` koruması nedeniyle lokalde yazılmadı |
| **EXPECTED IMPORTED** | **5,563** | Production ortamında `DATA_BACKFILL_ENABLED=true` ile aktarılacak maçlar |
| **SKIPPED** | **0** | Eşleşen ama atlanan uygun maç yok |
| **DUPLICATE** | **0** | Idempotent SHA-256 anahtarlama ile sıfır duplicate |
| **AMBIGUOUS** | **0** | Belirsiz takım/tarih eşleşmesi yok |
| **INVALID** | **2,449** | Henüz oynanmamış gelecek maçlar veya eksik skorlu satırlar |
| **FAILED** | **0** | Hatalı batch veya transfer yok |
| **DB_FINISHED_AFTER (Beklenen)** | **5,746** | İçe aktarım tamamlandığında DB'deki toplam bitmiş maç sayısı |
| **DB_DATE_MIN_BEFORE** | `2026-09-17T19:30:00Z` | Mevcut en eski maç tarihi (14 gün) |
| **DB_DATE_MIN_AFTER (Beklenen)** | `2024-06-14T19:00:00Z` | İçe aktarım sonrası en eski maç tarihi (2.5 yıl) |
| **DB_DATE_MAX** | `2026-10-12T17:00:00Z` | Fikstürdeki en ileri maç tarihi |

---

## 3. TURNUVA VE SEZON DAĞILIMI (COMPETITION BREAKDOWN)

| Turnuva | Config Key | Kapsanan Sezonlar | Uygun (Eligible) | Yeni Eklenecek | Duplicate | Başarısız |
|---|---|---|---|---|---|---|
| **Premier League** | `PremierLeague` | 2024-25 / 2025-26 / 2026-27 | **778** | 778 | 0 | 0 |
| **La Liga** | `LaLiga` | 2024-25 / 2025-26 / 2026-27 | **772** | 772 | 0 | 0 |
| **Bundesliga** | `Bundesliga` | 2024-25 / 2025-26 / 2026-27 | **618** | 618 | 0 | 0 |
| **Serie A** | `SerieA` | 2024-25 / 2025-26 / 2026-27 | **757** | 757 | 0 | 0 |
| **Ligue 1** | `Ligue1` | 2024-25 / 2025-26 / 2026-27 | **610** | 610 | 0 | 0 |
| **Eredivisie** | `Eredivisie` | 2024-25 / 2025-26 / 2026-27 | **610** | 610 | 0 | 0 |
| **Belgian Pro League** | `BelgianProLeague` | 2024-25 / 2025-26 | **480** | 480 | 0 | 0 |
| **Greek Super League** | `GreekSuperLeague` | 2024-25 / 2025-26 | **364** | 364 | 0 | 0 |
| **Süper Lig** | `SuperLig` | 2024-25 / 2025-26 | **738** | 738 | 0 | 0 |
| **EURO** | `EURO` | 2024 | **51** | 51 | 0 | 0 |
| **FIFA World Cup** | `WorldCup` | 2026 | **104** | 104 | 0 | 0 |
| **TOPLAM** | **11 Turnuva** | — | **5,563** | **5,563** | **0** | **0** |

---

## 4. PREDICTION MOTORU VE TAHMİN KAPSAMI

- **Prediction Kod Değişikliği:** **HAYIR (YOK)**  
  Tahmin ağırlıkları, skor hesaplama mantığı, güven kapıları, `LOCKED_PREDICTION` ve Gate Inspector kodlarına **kesinlikle dokunulmamıştır**.
- **Historical Sample Before:** 29 (Maksimum per match)
- **Historical Sample Expected After:** > 250 (Tüm ana liglerde `sampleSize >= 30` eşiği aşılacaktır)

---

## 5. SONRAKİ GÜVENLİ ADIM (NEXT STEP)

1. Değişiklikleri production ortamına deploy et.
2. Render Worker veya CLI üzerinde `DATA_BACKFILL_ENABLED=true` ve `OPENFOOTBALL_IMPORT_ENABLED=true` ile `npm run historical:backfill -- --provider=openfootball` komutunu çalıştırarak 5,563 maçı 150'lik batch'ler halinde veritabanına aktar.
3. İçe aktarım sonrasında `npm run predictions:self-audit` ile yeni veri havuzunu doğrula.
