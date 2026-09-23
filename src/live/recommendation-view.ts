import type { buildLiveRecommendation } from './recommendation.js';

type RecommendationItem = {
  prediction: Record<string, unknown>;
  live: { match: { matchId: string; league: unknown; homeTeam: unknown; awayTeam: unknown; status: unknown; homeScore: unknown; awayScore: unknown; minute: unknown } };
  recommendation: ReturnType<typeof buildLiveRecommendation>;
};

function esc(value: unknown): string {
  return String(value ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function liveRecommendationCard(item: RecommendationItem): string {
  const r = item.recommendation;
  const m = item.live.match;
  const badge = r.recommendation === 'DESTEKLENIYOR' ? 'ok'
    : r.recommendation === 'ZAYIFLIYOR' || r.recommendation === 'BEKLE' ? 'partial' : 'neutral';
  const minute = r.live.minute == null ? '—' : `${r.live.minute}${r.live.addedTime ? `+${r.live.addedTime}` : ''}′`;
  return `<article class="card"><div class="row"><strong>${esc(m.homeTeam)} — ${esc(m.awayTeam)}</strong>
    <span class="badge ${badge}">${esc(r.recommendation)}</span></div>
    <p>${esc(m.league)} · ${esc(minute)} · ${esc(r.live.homeScore)} : ${esc(r.live.awayScore)}</p>
    <p><strong>Pre-match:</strong> ${esc(r.preMatch.marketName ?? r.preMatch.marketType)} · ${esc(r.preMatch.selection)}
      ${r.preMatch.line == null ? '' : ` · ${esc(r.preMatch.line)}`} · skor ${esc(r.preMatch.predictionScore)}</p>
    <p>${r.reasons.map(esc).join(' · ')}</p>
    <a href="/matches/${encodeURIComponent(m.matchId)}">Maç detayını aç</a></article>`;
}

export function liveRecommendationsSection(): string {
  return `<section class="section" id="live-recommendations"><div class="section-title"><div>
    <span class="section-kicker">Bugünün resmi önerileri</span><h2>Canlı Öneriler</h2>
    <p>Prediction V1'in bugün resmi PREDICT verdiği maçlar canlı veriyle ayrıca izlenir. Canlı katman Prediction V1'i değiştirmez.</p>
    </div></div><p id="live-recommendations-error" role="status"></p>
    <div id="live-recommendations-cards" class="grid">Canlı öneriler yükleniyor…</div></section>
    <script src="/live-recommendations-poll.js" defer></script>`;
}

export const liveRecommendationsPollScript = `(() => {
  const root = document.getElementById('live-recommendations');
  if (!root) return;
  let delay = 30000;
  async function refresh() {
    try {
      const response = await fetch('/api/live/recommendations', {cache: 'no-store'});
      if (!response.ok) throw new Error('live recommendations fetch');
      const data = await response.json();
      document.getElementById('live-recommendations-cards').innerHTML = data.html;
      document.getElementById('live-recommendations-error').textContent = '';
      delay = data.hasLive ? 30000 : 60000;
    } catch {
      document.getElementById('live-recommendations-error').textContent = 'Canlı öneriler yenilenemedi; son görünüm korunuyor.';
      delay = 60000;
    }
    setTimeout(refresh, delay);
  }
  refresh();
})();`;
