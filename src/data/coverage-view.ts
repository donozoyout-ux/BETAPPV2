import type { DataCoverage } from './coverage.js';
const esc = (value: unknown) => String(value ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function dataPoolCard(data: DataCoverage): string {
  const s = data.summary;
  return `<div class="grid">${[['Toplam maç',s.totalMatches],['Bitmiş maç',s.totalFinishedMatches],['İstatistikli maç',s.totalStatsCovered],
    ['Gerçek oran geçmişi olan maç',s.totalOddsCovered],['Prediction historical examples',s.totalHistoricalExamples]].map(([label,value]) => `<article class="card"><strong>${esc(label)}</strong><p>${esc(value)}</p></article>`).join('')}</div>
    <div class="scroll"><table><thead><tr><th>Lig / Turnuva</th><th>Tür</th><th>Maç</th><th>İstatistik</th><th>Oran</th><th>Historical örnek</th><th>Tarih aralığı</th></tr></thead><tbody>
    ${data.competitions.map(c => `<tr><td>${esc(c.competition)}</td><td>${c.type === 'CLUB' ? 'Kulüp' : 'Milli takım'}</td><td>${c.matches}</td><td>${c.matchesWithStats}</td><td>${c.matchesWithOdds}</td><td>${c.predictionHistoricalExamples}</td><td>${esc(c.earliestMatch)} — ${esc(c.latestMatch)}</td></tr>`).join('')}</tbody></table></div>
    <p>Son ölçüm: ${esc(data.generatedAt)} · En az 5 dakika önbellek. Oran kapsamı yalnız gerçek maç öncesi kayıtlardır.</p>`;
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
