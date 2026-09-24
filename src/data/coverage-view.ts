import type { DataCoverage } from './coverage.js';
const esc = (value: unknown) => String(value ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function dataPoolCard(data: DataCoverage): string {
  const s = data.summary;
  return `<div class="grid">${[['Toplam maç',s.totalMatches],['Bitmiş maç',s.totalFinishedMatches],['İstatistikli maç',s.totalStatsCovered],
    ['Gerçek oran geçmişi olan maç',s.totalOddsCovered],['3+ bookmaker maç',s.totalThreeBookmakerCovered],
    ['Odds snapshot',s.totalOddsSnapshots],['CSV historical odds maç',s.csvHistoricalOddsMatches],
    ['CSV 3+ bookmaker',s.csvHistoricalThreeBookmakers],['CSV odds quote',s.csvHistoricalOddsQuotes],
    ['Shadow stage örnek',s.csvStageExamples],['Shadow araştırma uygun',s.csvStageResearchEligible],
    ['Prediction historical examples',s.totalHistoricalExamples]].map(([label,value]) => `<article class="card"><strong>${esc(label)}</strong><p>${esc(value)}</p></article>`).join('')}</div>
    <div class="grid"><article class="card"><strong>Önümüzdeki 7 gün</strong><p>${esc(s.upcomingMatches7d)} maç</p></article>
    <article class="card"><strong>Odds covered</strong><p>${esc(s.upcomingOddsCovered7d)} / ${esc(s.upcomingMatches7d)}</p></article>
    <article class="card"><strong>3+ bookmaker</strong><p>${esc(s.upcomingThreeBookmakerCovered7d)} / ${esc(s.upcomingMatches7d)}</p></article></div>
    <div class="scroll"><table><thead><tr><th>Lig / Turnuva</th><th>Tür</th><th>Bitmiş / Hedef</th><th>İstatistik / Hedef</th><th>Veri durumu</th><th>Oran</th><th>3+ BM</th><th>CSV Odds</th><th>CSV 3+ BM</th><th>Shadow</th><th>Shadow 3+ BM</th><th>7g Odds</th><th>Snapshot</th><th>Resmi historical</th><th>Tarih aralığı</th></tr></thead><tbody>
    ${data.competitions.map(c => `<tr><td>${esc(c.competition)}</td><td>${c.type === 'CLUB' ? 'Kulüp' : 'Milli takım'}</td>
      <td>${c.finishedMatches} / ${c.target.targetFinishedMatches}</td><td>${c.matchesWithStats} / ${c.target.targetMatchesWithStats}</td>
      <td>${c.target.needsBackfill ? `EKSİK · ${esc(c.target.deficitScore)}` : 'HEDEF TAMAM'}</td>
      <td>${c.matchesWithOdds}</td><td>${c.matchesWithThreeBookmakers}</td>
      <td>${c.csvHistoricalOddsMatches}</td><td>${c.csvHistoricalThreeBookmakers}</td>
      <td>${c.csvStageExamples}</td><td>${c.csvStageResearchEligible}</td>
      <td>${c.upcomingMatchesWithOdds7d}/${c.upcomingMatches7d}</td><td>${c.oddsSnapshots}</td>
      <td>${c.predictionHistoricalExamples}</td><td>${esc(c.earliestMatch)} — ${esc(c.latestMatch)}</td></tr>`).join('')}</tbody></table></div>
    <p><strong>DATA_TARGET_V1:</strong> Kulüp liglerinde ${esc(data.targetPolicy.clubFinishedMatches)} bitmiş maç, milli takım turnuvalarında ${esc(data.targetPolicy.internationalFinishedMatches)} bitmiş maç; istatistik hedefi %${esc(Math.round(data.targetPolicy.statisticsCoverageRatio * 100))}. Maksimum ${esc(data.targetPolicy.maxSeasonCycles)} sezon/cycle.</p>
    <h3>Otomatik veri yükleme</h3>
    <div class="scroll"><table><thead><tr><th>Lig / Turnuva</th><th>Durum</th><th>Faz</th><th>Kaydedilen</th><th>İstatistik</th><th>Hata</th></tr></thead><tbody>
    ${data.backfills.length ? data.backfills.slice(0,20).map(r => `<tr><td>${esc(r.competition)}</td><td>${esc(r.status)}</td><td>${esc(r.phase)}</td><td>${esc(r.fixturesPersisted)}</td><td>${esc(r.statisticsSucceeded)}</td><td>${esc(r.statisticsFailed)}</td></tr>`).join('')
      : '<tr><td colspan="6">Henüz competition backfill raporu yok.</td></tr>'}</tbody></table></div>
    <h3>OpenFootball CC0 veri yükleme</h3>
    <p>Otomatik açık veri kaynağı: OpenFootball/football.json (CC0). Yalnız explicit kickoff saati ve FT skoru olan bitmiş maçlar içe alınır.</p>
    <div class="scroll"><table><thead><tr><th>Lig</th><th>Sezon</th><th>Durum</th><th>Bitmiş</th><th>İçe aktarılan</th><th>Yeni</th><th>Duplicate</th><th>Unsafe time</th><th>Hata</th></tr></thead><tbody>
    ${data.openFootballImports.length ? data.openFootballImports.map(r => `<tr><td>${esc(r.competition)}</td><td>${esc(r.season)}</td>
      <td>${esc(r.status)}</td><td>${esc(r.finished_rows)}/${esc(r.total_matches)}</td><td>${esc(r.imported_rows)}</td>
      <td>${esc(r.matches_inserted)}</td><td>${esc(r.duplicates_prevented)}</td><td>${esc(r.skipped_unsafe_time)}</td>
      <td>${esc(r.last_error)}</td></tr>`).join('')
      : '<tr><td colspan="9">Henüz OpenFootball importu başlamadı.</td></tr>'}</tbody></table></div>
    <h3>Football-Data arşivi (otomatik çekim kapalı)</h3>
    <p>Mevcut arşiv korunur ve shadow araştırmada kullanılabilir; yeni otomatik indirme kaynak kullanım politikası nedeniyle kapalıdır.</p>
    <div class="scroll"><table><thead><tr><th>Kaynak</th><th>Lig</th><th>Sezon</th><th>Durum</th><th>İçe aktarılan</th><th>İstatistik</th><th>Odds quote</th><th>Hata</th></tr></thead><tbody>
    ${data.publicCsvImports.length ? data.publicCsvImports.map(r => `<tr><td>Football-Data</td><td>${esc(r.competition)}</td><td>${esc(r.season)}</td>
      <td>${esc(r.status)}</td><td>${esc(r.imported_rows)}/${esc(r.valid_rows)}</td><td>${esc(r.statistics_rows)}</td>
      <td>${esc(r.odds_rows)}</td><td>${esc(r.last_error)}</td></tr>`).join('')
      : '<tr><td colspan="8">Henüz açık CSV importu başlamadı.</td></tr>'}</tbody></table></div>
    <h3>CSV Stage Shadow Evidence</h3>
    <p><strong>Güvenlik:</strong> Bu örnekler opening→closing hareketini araştırma için kullanır. Exact capture zamanı bilinmediğinden resmi Prediction V1 historical havuzuna girmez.</p>
    <div class="grid"><article class="card"><strong>Shadow toplam</strong><p>${esc(data.shadowSafety.total)}</p></article>
      <article class="card"><strong>Yanlışlıkla resmi uygun</strong><p>${esc(data.shadowSafety.invalid_official)}</p></article>
      <article class="card"><strong>Yanlış timing işaretli</strong><p>${esc(data.shadowSafety.invalid_timing_known)}</p></article></div>
    <div class="scroll"><table><thead><tr><th>Dataset</th><th>Durum</th><th>Maç</th><th>Shadow örnek</th><th>Araştırma uygun</th><th>Hata</th></tr></thead><tbody>
      ${data.publicCsvStageRefreshes.length ? data.publicCsvStageRefreshes.map(r => `<tr><td>${esc(r.source_key)}</td><td>${esc(r.status)}</td>
        <td>${esc(r.matches_inspected)}</td><td>${esc(r.examples_inserted)}</td><td>${esc(r.research_eligible_examples)}</td>
        <td>${esc(r.last_error)}</td></tr>`).join('')
        : '<tr><td colspan="6">Henüz shadow refresh çalışmadı.</td></tr>'}</tbody></table></div>
    <h3>Shadow hareket araştırması</h3>
    <div class="scroll"><table><thead><tr><th>Market</th><th>Hareket</th><th>N</th><th>Binary N</th><th>Pozitif oran</th><th>Ort. closing fair</th><th>Ort. Δ pp</th></tr></thead><tbody>
      ${data.shadowResearch.length ? data.shadowResearch.map(r => `<tr><td>${esc(r.marketType)}</td><td>${esc(r.movementClass)}</td>
        <td>${esc(r.examples)}</td><td>${esc(r.binaryExamples)}</td><td>${r.positiveRate == null ? '—' : esc((r.positiveRate*100).toFixed(1)+'%')}</td>
        <td>${r.averageClosingFairProbability == null ? '—' : esc((r.averageClosingFairProbability*100).toFixed(1)+'%')}</td>
        <td>${r.averageProbabilityDeltaPp == null ? '—' : esc(r.averageProbabilityDeltaPp.toFixed(2))}</td></tr>`).join('')
        : '<tr><td colspan="7">Araştırma için henüz yeterli stage örneği yok.</td></tr>'}</tbody></table></div>
    <p>Son ölçüm: ${esc(data.generatedAt)} · En az 5 dakika önbellek. Canlı/pre-match snapshot kapsamı yalnız gerçekten timestamp ile kaydedilmiş odds'tur. CSV stage verisi ayrı shadow araştırma katmanıdır; resmi Prediction V1 kararını değiştirmez.</p>`;
}
export function dataPoolSection() {
  return '<section class="section" id="data-pool"><h2>VERİ HAVUZU</h2><p id="data-pool-error" role="status"></p><div id="data-pool-content">Veri kapsamı yükleniyor…</div></section><script src="/data-coverage.js" defer></script>';
}
export const dataPoolScript = `(() => {
  if (!document.getElementById('data-pool')) return;
  async function refresh() {
    try {
      const response = await fetch('/api/data-coverage');
      if (!response.ok) throw new Error('coverage unavailable');
      const data = await response.json();
      document.getElementById('data-pool-content').innerHTML = data.html;
      document.getElementById('data-pool-error').textContent = '';
    } catch { document.getElementById('data-pool-error').textContent = 'Veri kapsamı şu anda okunamıyor.'; }
    setTimeout(refresh, 300000);
  }
  refresh();
})();`;
