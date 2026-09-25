# BETAPP V2 — Dashboard UI Redesign V1

## Kapsam ve temel

- Branch: `codex/ui-dashboard-redesign-v1`.
- Güncel `origin/main` (`20c0ae6`) Odds Neighbor Reliability V1 panelini henüz içermediği için branch, main'in devamı olan doğrulanmış V1 commit'i `0e5851d` üzerine kuruldu. Bu rapordaki UI değişiklikleri o commit'e göre değerlendirilmelidir.
- Ana çalışma dizinindeki mevcut değişikliklere dokunulmadı. Ayrı `BETAPPV2-redesign` worktree'si kullanıldı.
- Main'e merge, deployment, veri aktarımı veya üretim veritabanına yazma yapılmadı.

## Önceki sorunlar ve yeni düzen

Eski ekran; yan menü, on iki sütunlu maç tablosu ve aynı sayfada açılan çok sayıda teknik panel içeriyordu. Yeni arayüz, görsel referanstaki koyu lacivert panelleri, turkuaz vurgu rengini, yatay navigasyonu ve kart hiyerarşisini kullanır. Referans görseldeki örnek sayılar veya başarı iddiaları ürüne alınmadı. Karşılama görseli CSS ve dekoratif futbol simgesiyle oluşturuldu; referans fotoğrafı birebir kopyalanmadı.

Altı ayrı görünüm:

1. **Ana Sayfa:** dört gerçek özet kartı, ilk beş maç, arşiv bağlantıları ve kompakt sistem durumu.
2. **Bugünün Maçları:** yedi sütunlu tablo; mobilde aynı verilerden oluşturulan maç kartları. Takım/lig araması. Gelecek fikstür ve canlı paneller açılır ayrıntılarda.
3. **Resmi Tahminler:** `LOCKED_PREDICTION` ve Gate Inspector `OFFICIAL` birlikte gereklidir. PREVIEW hiçbir zaman resmi olarak sunulmaz. İstenen boş durum metinleri kullanıldı.
4. **İnceleme:** mevcut REVIEW/WAITING kayıtları, gerçek gate açıklamaları ve açılabilir teknik kontroller. Eksik eşikler sıfır olarak uydurulmaz.
5. **Geçmiş Veriler:** özet kartlarından maç arşivi, oran geçmişi, geçmiş benzerler, tahmin geçmişi, performans/kalibrasyon ve veri kapsamı ayrıntılarına erişim.
6. **Ayarlar:** tarayıcı tercihi ve açılabilir sistem tanı bilgileri.

Hash navigasyonu aktif menüyü ve görünür paneli birlikte değiştirir. Geri/ileri navigasyonu ve arşiv içi bağlantılar desteklenir. Küçük ekranlarda açılır menü vardır. Maç detayında Genel Bakış, Tahmin, Oran Analizi, Geçmiş Benzerler, Veri Kalitesi ve Gate Inspector ayrı bölümlerdir.

## Onboarding

İlk ziyarette “Maç Analizine Hazır mısın?” ve “Hadi Başla” gösterilir. Tıklama `betapp_onboarding_completed=true` değerini localStorage'a yazar ve Ana Sayfa'yı açar. Head içindeki küçük kontrol, yeniden yüklemede karşılama bölümünün parlamasını önler. Ayarlar üzerinden tercih silinebilir. Storage engellenirse uygulama çalışmaya devam eder; bu durumda ziyaretler arasında tercih saklanamaz. Üretim DB'sinde tercih tutulmaz.

## Veri ve güvenlik sınırları

- Yeni örnek sayılar, başarı oranları veya sağlık yüzdeleri yoktur. Özetler mevcut SSR verilerinden hesaplanır; veri yokken boş durum veya “Bekleniyor” gösterilir.
- Veritabanı durumu mevcut `/health` yanıtından okunur. Ağ hatası veya eksik yanıt “Bekleniyor” olur; ham hata metinleri ana ekrana taşınmaz. Fikstür/oran durumu ilgili sağlayıcıların mevcut durumuna dayanır. Analiz durumu mevcut analiz kayıtları ve self-audit guard bilgisini kullanır; sürekli çalışan süreç için uptime iddiası değildir.
- Ana tablodaki durumlar yalnız sunumda Türkçeleştirilir. Backend enumları ve scoring/gate kuralları değişmedi.
- V1 `renderHistoricalNeighbors`, küçük örnek uyarıları, aynı/farklı lig ayrımı ve Gate Inspector kontrolleri korundu. Tarihsel kanıt resmi tahmin yetkisi vermez.
- `/api/live`, `/api/live/recommendations`, `/api/control-audit`, `/api/data-coverage`, `/api/odds-intelligence/*`, maç detayı ve gate API'lerinin uygulamaları değişmedi.
- Zorunlu 60 saniyelik tam sayfa yenileme kaldırıldı. Mevcut canlı panel polling'i devam eder; SSR sayılar son yüklemeyi gösterir ve “Verileri yenile” bağlantısı vardır.

## Responsive ve erişilebilirlik

- 850px altında masaüstü tablosu yerine kartlar; dört özet kartı mobilde iki sütun.
- Ana tablo sabit yedi sütunla ekran genişliğine uyar; takım ve lig isimleri gerektiğinde satır kırar.
- Teknik tablolarda yalnız kendi kapsayıcısında yatay kaydırma vardır. Görsel testte bulunan Gate Inspector grid taşması düzeltildi.
- 44px civarı etkileşim alanları, görünür klavye odağı, metinli durumlar, aria-current/aria-expanded ve isimlendirilmiş analiz bağlantıları kullanıldı.
- Javascript görünüm navigasyonu ve onboarding için gereklidir. Temel içerik SSR ile üretilir.

## Değişen dosyalar

- `src/dashboard.ts`: yeni bilgi mimarisi ve sunumda resmi durum kontrolü.
- `src/match-detail.ts`: altı detay bölümü, korunmuş komşu/gate renderers, Türkçe etiketler.
- `src/ui/components.ts`: top navigation, stat card, status badge, match table/card, empty state, system status, detail navigation, onboarding.
- `src/ui/client.ts`: navigasyon, storage tercihi, mobil menü, arama, veritabanı sağlık sunumu.
- `src/ui/styles.ts`: yeni tema ve responsive stiller.
- `test/unit/dashboard-redesign.test.ts`: 12 yeni davranış testi.
- `test/unit/dashboard.test.ts`, `test/unit/match-detail.test.ts`: değişen başlık ve gerçek kilitli durum sözleşmesine uygun fixture güncellemeleri.
- `test/fixtures/dashboard-ui.ts`, `scripts/ui-preview.ts`: üretim verisinden bağımsız, yalnız yerel görsel doğrulama düzeneği.
- `package.json`, `package-lock.json`: DOM davranış testi için jsdom geliştirme bağımlılıkları.
- Bu rapor ve `reports/ui-*.png` görsel doğrulama çıktıları.

## Doğrulama

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run build`: PASS; SSR render testleri PASS.
- `npm test`: 256 test PASS, assertion hatası yok. Yerel PostgreSQL testlerinin setup aşaması Docker/container runtime bulunmadığı için çalışmadı; 11 entegrasyon testi CI'da doğrulanacak.
- Yeni testler: menüler/aktif görünüm, ilk ziyaret, CTA, kalıcılık/reset, engelli storage, gerçek sayaçlar, tablo/kart eşitliği, PREVIEW ayrımı, boş resmi liste, gate nedenleri, arama/mobil menü, arşiv bağlantıları, altı detay bölümü, DB sağlık yanıtı ve kilit gereksinimi.
- Yerel `npx tsx scripts/ui-preview.ts` gerçek Fastify uygulamasını sentetik repository fixture'larıyla açar; hiçbir DB veya sağlayıcı bağlantısı kurmaz. Çalışan uygulama agent-browser ile kontrol edildi.
- Ana sayfanın altı görünümü ve detayın altı bölümü 1440, 1024 ve 390px genişlikte kontrol edildi: sayfa scrollWidth değerleri viewport genişliğine eşit, her navigasyonda tek panel görünür.
- Onboarding tıklama/yenileme, mobil menü, resmi boş durum, inceleme açıklaması, geçmiş komşular ve teknik gate ekranı tarayıcıda kontrol edildi. Görüntüler sentetik test verisi içerir; üretim maçları veya performans sonuçları değildir.
- CI sonucu: branch push sonrasında takip edilecek.

## Bilinen sınırlar

Görsel kontroller Chromium ve sentetik fixture'larla yapıldı; üretim DB içeriği veya farklı tarayıcı motorları bu görevde denetlenmedi. Uzun teknik tablolar mobilde kendi içinde kaydırılır. localStorage engellendiğinde tercih kalıcı olamaz. Tasarım değişikliği yalnız branch'tedir; yayınlanmadı.
