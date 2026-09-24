import type { HistoricalNeighbors } from './reliability.js';
import { neighborReliabilityConfig } from './reliability.js';
const esc=(v:unknown)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export const evidenceLabels = {INSUFFICIENT_DATA:'Yetersiz veri',WEAK_EVIDENCE:'Zayıf kanıt',MODERATE_EVIDENCE:'Orta düzey kanıt',STRONG_EVIDENCE:'Güçlü tarihsel kanıt'};
export function historicalRateText(wins:unknown,sample:unknown,rate:unknown) {
  const n=Number(sample);
  return `${esc(wins)} / ${esc(sample)} kazandı · ${!Number.isFinite(n)||n===0?'Veri yok':n<neighborReliabilityConfig.minDisplaySample?'Yetersiz örnek':rate==null?'Oran mevcut değil':`%${esc(Number(rate).toFixed(1))} ham oran`}`;
}
export function renderHistoricalNeighbors(data:HistoricalNeighbors|null|undefined) {
  if(!data || !data.sampleSize) return '<p>Karşılaştırılabilir geçmiş örnek bulunmuyor. 0 kullanılabilir / 0 ham örnek · Yetersiz veri.</p>';
  const small=data.settledSampleSize<neighborReliabilityConfig.minDisplaySample;
  const warning=small?'Geçmiş örnek sayısı güvenilir kanıt olarak değerlendirilemeyecek kadar az.':data.usableSampleSize===0?'Geçmiş maçlar mevcut ancak benzerlik kalitesi çok düşük.':data.status==='WEAK_EVIDENCE'?'Örnek kalitesi veya lig dağılımı yeterli değil.':'';
  return `<div class="twins-summary"><strong>${evidenceLabels[data.status]}</strong><span>${data.usableSampleSize} kullanılabilir / ${data.sampleSize} ham örnek</span></div>
    <p>${historicalRateText(data.wins,data.settledSampleSize,data.rawWinRate)}</p><p>${esc(warning)}</p>
    <p>Ağırlıklı oran (${data.usableSampleSize} kullanılabilir örnek): ${small||data.weightedWinRate==null?'—':esc(data.weightedWinRate)+'%'} · Ortalama benzerlik: ${esc(data.averageSimilarityScore)} / 100</p>
    <p>Aynı lig: ${data.sameLeagueCount} · Farklı lig: ${data.crossLeagueCount} · Lig bilgisi yok: ${data.unknownLeagueCount} · Sonucu mevcut değil: ${data.unavailableOutcomeCount}</p>
    <div class="twin-list">${data.neighbors.map(n=>`<details class="twin-row"><summary>${esc(n.homeTeam)} — ${esc(n.awayTeam)} · ${esc(n.league)} · ${esc(new Date(n.date).toISOString().slice(0,10))}
      · ${esc(({TOTAL_GOALS:'Toplam gol',TOTAL_CORNERS:'Toplam korner',TOTAL_CARDS:'Toplam kart',MATCH_RESULT:'Maç sonucu',BTTS:'Karşılıklı gol',FIRST_HALF_GOALS:'İlk yarı gol'} as Record<string,string>)[n.market] ?? n.market)} ${n.line==null?'':esc(n.line)} ${esc(({OVER:'Üst',UNDER:'Alt',HOME:'Ev',AWAY:'Deplasman',DRAW:'Beraberlik',YES:'Var',NO:'Yok'} as Record<string,string>)[n.selection] ?? n.selection)} · Oran ${esc(n.odds)} · ${n.outcome==='WIN'?'Kazandı':n.outcome==='LOSS'?'Kaybetti':'Sonuç mevcut değil'}
      · Benzerlik ${n.similarityScore}/100 · ${n.quality==='HIGH'?'Yüksek':n.quality==='MEDIUM'?'Orta':'Düşük'} · ${n.sameLeague===true?'Aynı lig':n.sameLeague===false?'Farklı lig':'Lig bilgisi yok'}</summary>
      <p>${Object.entries(n.breakdown).map(([k,v])=>`${({market:'Market',odds:'Oran',league:'Lig',context:'Bağlam'} as Record<string,string>)[k]}: ${esc(v)} / ${neighborReliabilityConfig.weights[k as keyof typeof neighborReliabilityConfig.weights]}`).join(' · ')}</p>
      <p>${esc(n.contextDescription)} Eksik bileşenler: ${esc(n.unavailableComponents.join(', ')||'Yok')}.</p></details>`).join('')}</div>
    <p class="detail-disclaimer">Ham oran tüm sonucu bilinen örnekleri; ağırlıklı oran yalnız kullanılabilir örnekleri kapsar. Tarihsel kanıt resmi tahmin yetkisi vermez.</p>`;
}
