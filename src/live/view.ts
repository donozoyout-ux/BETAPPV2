import { liveResponse } from './analysis.js';
function esc(value: unknown): string {
  return String(value ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
export function liveCard(data: ReturnType<typeof liveResponse>): string {
  const m = data.match;
  const labels: Record<string, string> = { possession: 'Topa sahip olma', shots: 'Şut', shotsOnTarget: 'İsabetli şut', corners: 'Korner', yellowCards: 'Sarı kart', redCards: 'Kırmızı kart', fouls: 'Faul', xg: 'xG' };
  return `<article class="card"><span class="badge" style="background:#b91c1c;color:white">${m.status === 'live' ? 'CANLI' : esc(m.status)}</span>
    <p>${esc(m.league)}</p><h3>${esc(m.homeTeam)} — ${esc(m.awayTeam)}</h3>
    <h2>${esc(m.homeScore)} : ${esc(m.awayScore)}</h2><p>Dakika: ${esc(m.minute)}</p>
    <dl>${Object.entries(m.statistics).map(([k, p]) => `<div><dt>${labels[k]}</dt><dd>${esc(p.home)} / ${esc(p.away)} <small>(${esc(p.updatedAt)})</small></dd></div>`).join('')}</dl>
    <p>Baskı: ${esc(data.LIVE_ANALYSIS_V1.pressureSide)} · ${esc(data.LIVE_ANALYSIS_V1.state)}</p>
    <p>Veri zamanı: ${esc(m.updatedAt)}</p><p>Canlı oran: mevcut değil</p>
    <a href="/matches/${encodeURIComponent(m.matchId)}">Canlı Analizi Aç</a></article>`;
}
export function liveSection(match?: Record<string, unknown>): string {
  const detail = match != null;
  const id = detail ? String(match.id) : '';
  return `<section class="detail-panel" id="live-section" data-match-id="${esc(id)}"><h2>${detail ? 'CANLI MAÇ ANALİZİ' : 'CANLI MAÇLAR'}</h2>
    <p>Canlı analiz açıklayıcıdır; Prediction V1 kararını değiştirmez.</p>
    ${detail ? '<p>Pre-match Prediction V1 ve gate bilgileri aşağıda yalnız bağlam olarak gösterilir.</p>' : ''}
    <p id="live-error" role="status"></p><div id="live-cards" class="grid">${detail ? liveCard(liveResponse(match)) : 'Canlı maçlar yükleniyor…'}</div></section>
    <script src="/live-poll.js" defer></script>`;
}
// Only server-rendered escaped HTML enters the page. Provider strings never enter JavaScript source.
export const livePollScript = `(() => {
  const root = document.getElementById('live-section');
  if (!root) return;
  const id = root.dataset.matchId;
  let delay = 30000;
  async function refresh() {
    try {
      const response = await fetch(id ? '/api/live/' + encodeURIComponent(id) : '/api/live', {cache: 'no-store'});
      if (!response.ok) throw new Error('live fetch');
      const data = await response.json();
      document.getElementById('live-cards').innerHTML = data.html;
      document.getElementById('live-error').textContent = '';
      delay = (id ? data.match.status === 'live' : data.matches.length > 0) ? 30000 : 60000;
    } catch {
      document.getElementById('live-error').textContent = 'Canlı veri yenilenemedi; son alınan veri gösteriliyor.';
      delay = 60000;
    }
    setTimeout(refresh, delay);
  }
  refresh();
})();`;
