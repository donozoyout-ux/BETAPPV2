# BETAPP V2 — Gate Inspector Human Mode V1

## Kapsam

- Branch: `codex/gate-inspector-human-mode-v1`
- Base: `origin/main` (`7640001`), Dashboard Redesign V1 ve Odds Neighbor Reliability V1 dahil.
- Değişiklik yalnız sunum ve açıklama katmanındadır. Prediction config, gate üretimi, eşikler, aday seçimi, oran analizi, OFFICIAL/PREVIEW/LOCKED_PREDICTION semantiği, execution authority ve AI authority değiştirilmedi.
- Main'e merge veya deployment yapılmadı.

## Eski UX problemi

Gate Inspector ilk olarak 14 satırlık teknik karşılaştırma gösteriyordu. Bütün başarısız kontroller eşit görünüyordu; kullanıcı veri birikmesini mi, zayıf analizi mi, resmi zaman penceresini mi yoksa sistem güvenliğini mi beklediğini hızlıca anlayamıyordu. `495 / 0–90 dakika`, `NEUTRAL` ve birbirine benzeyen skor/güven değerleri açıklamasızdı.

## Human Mode mimarisi

Yeni bir saf sunum modeli `src/ui/gate-human-mode.ts` içinde mevcut gate dizisini okur ve aşağıdaki sırada sunar:

1. Birincil durum kartı
2. En önemli üç engel
3. Açılır “diğer kontroller” listesi
4. “Şimdi ne olacak?” açıklaması
5. Kontrol ilerlemesi ve açılır geçen kontroller
6. Varsayılan olarak kapalı teknik tablo

Model gate nesnelerini değiştirmez. Aynı gate dizisi teknik tabloya da verilir. Son değerlendirme zamanı yalnız prediction run üzerinde gerçek `generated_at`/`generatedAt` bulunduğunda gösterilir. Yeni polling eklenmedi; sayfa mevcut SSR veri yenileme davranışını kullanır.

## Engel grupları ve öncelik

Sunum önceliği deterministiktir:

1. Sistem güvenliği: genel ve lig/market self-audit guard
2. Resmi tahmin zamanı
3. Oran uygunluğu
4. Benzer geçmiş maç sayısı
5. Tahmin skoru
6. Veri kalitesi
7. Model güveni
8. Açılış/güncel ölçümler ve bahis şirketi kapsamı
9. Piyasa hareketi ve korner uyumu
10. Oran analizi / Prediction V1 değerlendirmesi gibi ikincil beklemeler

İlk görünüm en fazla üç engel gösterir. Kalan sayı gerçek başarısız gate sayısından hesaplanır. Geçen kontroller ana alanı doldurmaz.

## Durum sınıflandırması

- `READY`: Yalnız `status=OFFICIAL`, `predictionState=LOCKED_PREDICTION` ve başarısız gate yoksa.
- `SYSTEM_BLOCKED`: Self-audit güvenlik gate'lerinden biri geçmediyse.
- `TIME_ONLY`: Tek başarısız koşul resmi tahmin penceresiyse.
- `DATA_LIMITED`: Geçmiş örnek, oran uygunluğu, şirket/ölçüm, kalite veya model güveni eksikse.
- `ANALYSIS_WEAK`: Tahmin skoru, piyasa desteği veya ilgili analiz doğrulaması eşik altındaysa.
- `MIXED`: Veri ve analiz koşulları birlikte eksikse.

PREVIEW, bütün gate'ler geçse bile “RESMİ TAHMİN HAZIR” durumuna alınmaz. Human Mode yeni bir karar üretmez; yalnız mevcut sonucu açıklar.

## İnsan dilindeki açıklamalar

- `1 / 30` için “1 benzer maç bulundu; resmi tahmin için 30 gerekiyor” denir; “veri yok” denmez.
- Geçmiş örnek sayısının tüm veritabanını değil, bu tahminin market/seçim/oran/uygunluk filtrelerinden geçen örnekleri anlattığı bilgi notu bulunur.
- Tahmin skorunun olasılık veya başarı yüzdesi olmadığı açıkça belirtilir.
- Model güveninin tahmin skorundan ayrı bir veri/model tutarlılığı ölçümü olduğu açıklanır.
- `495 dakika`, “Maça 8 saat 15 dakika var” biçimine dönüştürülür ve pencerenin açılma kuralı anlatılır.
- `NEUTRAL`, “Belirgin piyasa desteği yok” olarak sunulur. Backend enum değeri değişmez.
- 47/50 gibi mevcut ve eşiğe yakın kalite değeri “hedefin biraz altında” olarak açıklanır.

## Teknik tablo

Teknik tablo silinmedi ve bütün gate'leri şu sütunlarla gösterir: Kontrol, Mevcut, Gerekli, Sonuç, Açıklama. Sonuçlar `GEÇTİ`, `BEKLİYOR`, `GEÇMEDİ` ve `UYGULANMAZ` olarak sunulur. Tablo varsayılan olarak kapalıdır. Mobilde açıldığında yatay kaydırma yalnız tablo kapsayıcısındadır.

## Testler

- Human summary ve birincil durum kartı
- Öncelik sırası, ilk üç engel ve kalan engel sayısı
- 1/30 örnek açıklaması ve geçmiş örnek bilgi notu
- Veri / zayıf analiz / karma / yalnız zaman / sistem güvenliği ayrımı
- Resmi hazır durumunun kilit gereksinimi ve PREVIEW ayrımı
- Skorun olasılık olarak etiketlenmemesi
- Model güveninin ayrı açıklanması
- Geçen gate'lerin ana engel listesinden çıkarılması
- Teknik tablonun korunması ve kapalı başlaması
- Girdi gate enumlarının ve nesnelerinin değiştirilmemesi
- Mobil DOM sırası

Yerel doğrulama:

- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run test:unit`: 269 PASS
- `npm run build`: PASS
- `npm test`: Unit testler geçti. Yerel makinede Docker/container runtime bulunmadığı için 11 PostgreSQL entegrasyon testi başlatılamadı; push sonrasında GitHub CI üzerinde çalıştırılacak.

## Görsel doğrulama

Sentetik örnek yalnız yerel preview içindir ve üretim uygulamasına veri eklemez. Fixture 1/30 geçmiş örnek, 45.85/70 tahmin skoru, 39/45 model güveni, 47/50 veri kalitesi, NEUTRAL hareket ve 495 dakika zaman değerlerini kullanır.

- `reports/gate-human-desktop.png`: 1440 × 1000, Human Mode ilk görünüm
- `reports/gate-human-mobile.png`: 390 × 844, mobil Human Mode
- `reports/gate-human-mobile-technical.png`: 390 × 844, açılmış teknik tablo

Tarayıcı kontrollerinde sayfa içerik üretti, framework hata overlay'i ve konsol hatası bulunmadı. 390px görünümde sayfa `scrollWidth=390`; teknik tablo açıldığında tablo kapsayıcısı 338px genişlik içinde kaydırılabilir ve sayfa genişlemez.

## Değişen dosyalar

- `src/ui/gate-human-mode.ts`
- `src/match-detail.ts`
- `src/ui/styles.ts`
- `test/unit/gate-human-mode.test.ts`
- `scripts/ui-preview.ts` (yalnız yerel görsel fixture)
- `reports/gate-human-*.png`
- `reports/gate-inspector-human-mode-v1.md`

## Bilinen sınırlamalar

- Son değerlendirme zamanı eski prediction kayıtlarında timestamp alanı yoksa gösterilmez.
- Human Mode mevcut gate sonuçlarının kalitesiyle sınırlıdır; yeni açıklama metadata'sı veya backend durumu üretmez.
- Görsel doğrulama Chromium ve sentetik fixture ile yapıldı. Üretim DB verisi bu görevde okunmadı veya değiştirilmedi.
- CI sonucu push sonrasında bu rapora eklenecektir.
