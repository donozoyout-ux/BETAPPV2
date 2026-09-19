# ODDS ANALYSIS V1

`ODDS_V1` bir tahmin veya otomatik bahis sistemi değildir. Execution authority daima `false` değerindedir. Hesaplar LLM kullanmadan, aynı girdide aynı çıktıyı üreten TypeScript fonksiyonlarıyla yapılır.

## Hesap hattı

1. Snapshot'lar `match + bookmaker + marketType + marketName + line` ile ayrılır. `captured_at >= kickoff_at` satırları analiz girdisinden çıkarılır.
2. Her timestamp'te son bilinen seçim değerleriyle piyasa state'i yeniden kurulur. İlk ve son tamamlanmış state açılış ve güncel state'tir. Eksik 1X2 veya eksik iki yönlü piyasa normalize edilmez.
3. Her seçim için `raw = 1 / odds`, `overround = sum(raw)` ve `fair = raw / overround` hesaplanır. Probability delta yüzde puan olarak `(currentFair - openingFair) * 100` değeridir.
4. Her bookmaker bir oy verir. Bookmaker konsensüsü opening/current/delta medyanı, current fair probability MAD'ı, odds relative MAD'ı ve medyan yönüyle aynı işaretli bookmaker oranını kullanır.
5. Merkezi V1 eşikleri movement class üretir. Skorun movement, agreement, coverage, freshness ve stability parçaları API/DB/dashboard'da ayrı görünür.
6. Data Quality bookmaker kapsamı, snapshot kapsamı ve freshness'i; Model Confidence movement büyüklüğü, agreement, coverage ve dispersion'ı ölçer. Bunlar birbirinin yerine kullanılmaz.

## Referans video incelemesi

Verilen [YouTube videosunun](https://youtu.be/X2XLQCl2oTU) Türkçe otomatik transcript'i incelendi. Video ağırlıklı olarak belirli sabit açılış oranlarının geçmiş maç sonuçlarıyla eşleştirildiği bir ürün arayüzünü ve canlı kullanım yorumlarını gösteriyor. Açılış-güncel hareketi, bookmaker konsensüsü, marj kaldırma veya yeniden üretilebilir sayısal movement eşiği tanımlamıyor. Videodaki tekil oran → sonuç iddiaları seçim yanlılığı ve örneklem metodolojisi açıklanmadığı için ODDS_V1 kuralı olarak uygulanmadı. Bu nedenle videodan türetilmiş özel bir sinyal yoktur; implementasyon görevdeki deterministik fair-probability spesifikasyonuna dayanır.

## V1 sınırları

- Varsayılan eşikler engineering başlangıç değerleridir; yeterli historical coverage ile chronological backtest yapılmadan optimize edilmiş kabul edilmez.
- Snapshot tablosu bir selection değişimini kaydettiği için state reconstruction son bilinen değerleri taşır. Açılış yalnızca gereken tüm seçimler ilk kez mevcut olduğunda oluşur.
- Backtest outcome hit rate raporlar. Closing price/stake/return verisi olmadan kârlılık iddiası üretmez.
- Asian handicap yalnızca aynı `line` içindeki uyumlu iki taraf tamamlandığında normalize edilir.
- Corner Engine ve piyasa fair probability farkı bilgi amaçlıdır; iki modelin skoru veya olasılığı birleştirilmez.
