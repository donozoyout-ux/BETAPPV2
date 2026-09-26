# BETAPP V2 — Gate Human Mode V1.1 Blocker Priority & Severity

## Kapsam ve güvenlik

- Branch: `codex/gate-human-priority-v1-1`
- Base: `origin/main` (`587f96e`), Gate Inspector Human Mode V1 dahil.
- Değişiklik yalnız açıklama, önem derecesi, sıralama ve görsel sunum katmanındadır.
- Prediction matematiği, eşikler, gate `passed` değerleri, OFFICIAL/PREVIEW/LOCKED_PREDICTION semantiği, oran/historical hesapları, veritabanı, provider, execution authority ve AI authority değiştirilmedi.

## Eski sıralama problemi

V1, resmi tahmin zamanını her başarısız durumda ilk engel olarak gösteriyordu. Bir maçta zaman penceresi henüz açılmamışken 2/30 geçmiş örnek, 36.66/70 tahmin skoru ve 25/50 veri kalitesi gibi daha temel sorunlar ilk görünümden düşebiliyordu. Ayrıca 44/45 model güveni ile 2/30 geçmiş örnek aynı görsel ağırlığa sahipti.

## Yeni severity modeli

Sunum katmanı başarısız gate'lere şu etiketleri verir:

- `CRITICAL` / `KRİTİK`: sayısal hedefin %50'sinden azı; geçmiş örnekte ayrıca değer ≤2 veya hedefin %25'inden azı.
- `MAJOR` / `CİDDİ EKSİK`: hedefin %50–79'u.
- `WAITING` / `VERİ BEKLENİYOR`: hedefin %80–94'ü veya bekleyen kategorik doğrulama.
- `NEAR_THRESHOLD` / `EŞİĞE YAKIN`: hedefin en az %95'i, fakat gate hâlâ geçmemiş.
- `INFO` / `BİLGİ`: normal karma durumda resmi zaman penceresi.

Oran uygunluğu, piyasa hareketi, sistem güvenliği, zaman ve complete-state kontrolleri için özel kategorik kurallar kullanılır. Severity yalnız yeni `HumanGateItem` sunum nesnesinde bulunur; gate girdisine yazılmaz.

## Sayısal tamamlanma ve fark açıklaması

Sayısal gate'lerde oran `current / required` olarak hesaplanır ve güvenli biçimde 0–1 aralığına sıkıştırılır. Geçersiz, eksik veya sıfır hedefler `WAITING` olarak ele alınır ve `NaN` üretilmez.

- 2/30: `KRİTİK`; “28 uygun geçmiş örnek daha gerekiyor.”
- 36.66/70: `CİDDİ EKSİK`; “Eşiğe 33.34 puan var.”
- 25/50: `CİDDİ EKSİK`; “Hedefin yarısı seviyesinde.”
- 44/45: `EŞİĞE YAKIN`; “Yalnızca 1 puan eksik.”

## Deterministik sıralama

Sıralama şu anahtarlarla yapılır:

1. Sistem güvenlik engeli her zaman önce gelir.
2. Normal karma durumda zaman gate'i Top 3 adaylarından çıkarılır.
3. Severity sırası: `CRITICAL`, `MAJOR`, `WAITING`, `NEAR_THRESHOLD`, `INFO`.
4. Aynı severity içinde sabit gate önceliği uygulanır: tahmin skoru, geçmiş örnek, oran uygunluğu, veri kalitesi, complete states, model güveni, bookmaker, piyasa hareketi ve diğerleri.

Bu yapı 2/30 geçmiş örneği 69/70 gibi eşiğe yakın bir skordan öne çıkarır. Üretim benzeri fixture'ın Top 3 sırası: geçmiş örnek, tahmin skoru, veri kalitesi.

## Zamanın ayrılması

`OFFICIAL_WINDOW`, başka analitik veya veri engelleri varken Top 3'e girmez. Ayrı zamanlama kartı şunları gösterir:

- Maça kalan süre.
- Gate'in gerçek `required` değerinden çıkarılan resmi pencere süresi.
- Pencerenin açılmasına kalan süre.

281 dakika ve `0–90 dakika` girdisi için kart “Maça 4 saat 41 dakika var” ve “Resmi tahmin penceresi 3 saat 11 dakika sonra açılacak” der. Pencere süresi sabit kodlanmaz; gate gereksiniminden okunur. Yalnız zaman gate'i başarısızsa `TIME_ONLY` korunur ve zaman ana engel olur.

## Bilgi hiyerarşisi

1. Ana durum
2. En önemli üç substantive engel
3. Ayrı zamanlama kartı
4. Sonraki adım
5. Kontrol ilerlemesi
6. Varsayılan olarak kapalı teknik tablo

Karma durumda başlık “RESMİ TAHMİN İÇİN KOŞULLAR HENÜZ YETERLİ DEĞİL” ve açıklama “Hem veri miktarı hem mevcut analiz resmi tahmin koşullarını henüz karşılamıyor” olur.

## Testler

- Üretim benzeri tam fixture ve MIXED sınıflandırması
- Top 3 sırası ve zamanın dışarı alınması
- Severity oran sınırları
- 2/30 geçmiş örnek özel kuralı
- 36/70 skorun 44/45 güvenden önce gelmesi
- 25/50 veri kalitesinin zaman bilgisinden önce gelmesi
- TIME_ONLY ve sistem güvenliği önceliği
- Geçen gate'lerin dışlanması
- Geçersiz sayısal değer güvenliği
- Complete-state ve NEUTRAL piyasa açıklaması
- Metinli severity etiketleri
- Teknik tablonun yapısı ve kapalı başlaması
- OFFICIAL için LOCKED_PREDICTION gereksinimi
- PREVIEW'ın resmi hazır sayılmaması
- Girdi nesnesinin, score ve enum değerlerinin değişmemesi

Yerel sonuçlar:

- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run test:unit`: 273 PASS
- `npm run build`: PASS
- `npm test`: 273 PASS; yerel makinede container runtime bulunmadığı için 11 PostgreSQL testi başlatılamadı. CI'da PostgreSQL servisiyle doğrulanacak.

## Görsel doğrulama

- `reports/gate-priority-desktop.png`: 1440px genişlik, üretim benzeri fixture.
- `reports/gate-priority-mobile.png`: 390px genişlik, aynı fixture.

Tarayıcıda Top 3 sırası geçmiş örnek / tahmin skoru / veri kalitesi olarak doğrulandı. Başlık MIXED durumu gösteriyor, zaman ayrı kartta, teknik detay kapalı. 1440px ve 390px görünümlerde sayfa `scrollWidth` değerleri viewport genişliğiyle aynı; konsol ve framework overlay hatası yok.

## Bilinen sınırlamalar

- Severity, mevcut gate'in sunduğu current/required değerleriyle sınırlıdır; kategorik gate'in açıklamadığı bir kök neden tahmin edilmez.
- Complete-state severity, şirket ve ölçüm oranlarının daha düşük olanını raporlar ve sunumda `MAJOR` olarak sınıflanır.
- Görsel doğrulama sentetik fixture ile Chromium üzerinde yapıldı; üretim veritabanı okunmadı veya değiştirilmedi.
