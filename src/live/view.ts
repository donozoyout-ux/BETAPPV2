import type { LiveResponseV2 } from './analysis-v2.js';
import { liveResponse } from './analysis.js';
function esc(value: unknown): string {
  return String(value ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
export function liveCard(data: ReturnType<typeof liveResponse> | LiveResponseV2, detail = false): string {
  const v2 = 'LIVE_ANALYSIS_V2' in data ? data : null;
  const m = data.match;
  const labels: Record<string, string> = { possession: 'Topa sahip olma', shots: 'Şut', shotsOnTarget: 'İsabetli şut', corners: 'Korner', yellowCards: 'Sarı kart', redCards: 'Kırmızı kart', fouls: 'Faul', xg: 'xG' };
  return `<article class="card"><span class="badge" style="background:#b91c1c;color:white">${m.status === 'live' ? 'CANLI' : esc(m.status)}</span>
    <p>${esc(m.league)}</p><h3>${esc(m.homeTeam)} — ${esc(m.awayTeam)}</h3>
    <h2>${esc(m.homeScore)} : ${esc(m.awayScore)}</h2><p>Dakika: ${esc(m.minute)}${v2?.addedTime ? `+${esc(v2.addedTime)}` : ''}${m.minute != null ? '′' : ''}</p>
    ${v2 ? renderLiveEvidence(v2, detail) : ''}
    <dl>${Object.entries(m.statistics).map(([k, p]) => `<div><dt>${labels[k]}</dt><dd>${esc(p.home)} / ${esc(p.away)} <small>(${esc(p.updatedAt)})</small></dd></div>`).join('')}</dl>
    <p>Baskı: ${esc(data.LIVE_ANALYSIS_V1.pressureSide)} · ${esc(data.LIVE_ANALYSIS_V1.state)}</p>
    <p>Veri zamanı: ${esc(m.updatedAt)}</p><p>Canlı oran: ${v2?.liveOddsAvailable ? 'MEVCUT' : 'mevcut değil'}</p>
    <a href="/matches/${encodeURIComponent(m.matchId)}">Canlı Analizi Aç</a></article>`;
}
function renderLiveEvidence(data: LiveResponseV2, detail: boolean): string {
  const events = detail ? data.events : data.events.slice(-1);
  return `<p>${data.sourceVerified ? '2 kaynak doğrulandı' : data.minuteSource === 'api-football' ? 'API-Football · FotMob' : 'FotMob'}</p>
    ${data.conflicts.length ? `<div role="alert" style="border:2px solid #ef4444;padding:12px"><strong>Kaynak uyuşmazlığı</strong>${data.conflicts.map(c => `<p>${esc(c.type)} · FotMob: ${esc(JSON.stringify(c.fotmob))} · API-Football: ${esc(JSON.stringify(c.apiFootball))} · ${esc(c.resolution)}</p>`).join('')}</div>` : ''}
    ${detail ? '<h3>CANLI OLAY AKIŞI</h3>' : '<h4>Son olay</h4>'}
    <ol>${events.map(e => `<li>${esc(e.minute)}${e.addedTime ? `+${esc(e.addedTime)}` : ''}′ ${esc(e.type)} — ${esc(e.teamName)} — ${esc(e.playerName)}${e.detail ? ` · ${esc(e.detail)}` : ''}</li>`).join('') || '<li>Olay verisi mevcut değil.</li>'}</ol>
    ${detail ? `<h3>Kaynak sağlığı</h3><p>FotMob: ${esc(data.sourceHealth.fotmob.status)} · API-Football: ${esc(data.sourceHealth.apiFootball.status)}</p>
      <p>Skor: ${data.sourceVerified ? 'DOĞRULANDI' : 'Doğrulanmadı'} · Dakika: ${esc(data.minuteSource)}</p>
      <p>${esc(data.LIVE_ANALYSIS_V2.momentumSummary)}</p>
      ${data.liveOdds.map(o => `<p>${esc(o.provider)} · ${esc(o.bookmaker)} · ${esc(o.market)} ${esc(o.line)} · ${esc(o.selection)}: ${esc(o.odds)} (${esc(o.observedAt)})</p>`).join('')}` : ''}`;
}
export function liveSection(match?: Record<string, unknown>): string {
  const detail = match != null;
  const id = detail ? String(match.id) : '';
  return `<section class="detail-panel" id="live-section" data-match-id="${esc(id)}"><h2>${detail ? 'CANLI MAÇ ANALİZİ' : 'CANLI MAÇLAR'}</h2>
    <p>Canlı analiz açıklayıcıdır; Prediction V1 kararını değiştirmez.</p>
    ${detail ? '<p>Pre-match Prediction V1 ve gate bilgileri aşağıda yalnız bağlam olarak gösterilir.</p>' : ''}
    <p id="live-error" role="status"></p><div id="live-cards" class="grid">${detail ? liveCard(liveResponse(match), true) : 'Canlı maçlar yükleniyor…'}</div></section>
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
