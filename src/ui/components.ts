import { escapeHtml, formatDate, objectValue, translateMarket, translateSelection } from '../dashboard.js';

export function icon(name = 'grid'): string {
  const paths: Record<string,string> = {
    grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    ball:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M8 9l4-3 4 3-2 5h-4z',
    check:'M5 12l4 4L19 6', search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',
    chart:'M3 18l6-7 4 3 8-10 M3 21h18', history:'M3 12a9 9 0 1 0 3-7 M3 3v6h6 M12 7v5l3 2',
    system:'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M6 6l2 2 M16 16l2 2 M6 18l2-2 M16 8l2-2 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
    menu:'M4 6h16 M4 12h16 M4 18h16', arrow:'M4 12h16 M14 6l6 6-6 6', review:'M12 3l9 17H3z M12 9v5 M12 17h.01',
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] ?? paths.grid}"/></svg>`;
}

export const statusLabels: Record<string,string> = {OFFICIAL:'RESMİ',REVIEW:'İNCELEME',WAITING:'BEKLİYOR',REJECTED:'UYGUN DEĞİL',NOT_EVALUATED:'ANALİZ OLUŞMADI'};
export function statusBadge(status: string): string {
  const known = Object.hasOwn(statusLabels,status) ? status : 'WAITING';
  return `<span class="status-badge ${known.toLowerCase()}"><i aria-hidden="true"></i>${statusLabels[known]}</span>`;
}
export function humanValue(value: unknown): string {
  const labels: Record<string,string> = {SUPPORT:'Destek',STRONG_SUPPORT:'Güçlü destek',NEUTRAL:'Nötr',CONFLICT:'Ters',
    WEAK:'Zayıf',MODERATE:'Orta',STRONG:'Güçlü',UP:'Yükseliş',DOWN:'Düşüş',FLAT:'Sabit',MIXED:'Karışık',
    VERY_LOW:'Çok düşük',LOW:'Düşük',MEDIUM:'Orta',HIGH:'Yüksek',GOOD:'İyi',EXCELLENT:'Çok iyi',LIMITED:'Sınırlı',POOR:'Yetersiz',UNAVAILABLE:'Veri yok'};
  return labels[String(value)] ?? String(value ?? '—');
}
export function progress(value: unknown, scale = 1): string {
  if (value == null || !Number.isFinite(Number(value))) return '';
  const width = Math.max(0,Math.min(100,Number(value)*scale));
  return `<span class="progress-track" aria-hidden="true"><span style="width:${width.toFixed(2)}%"></span></span>`;
}
export function navigation(detail = false): string {
  const links = detail ? [['grid','#match-overview','Özet'],['chart','#odds-route','Oranlar'],['history','#past-twins','Geçmiş İkizler'],['ball','#match-statistics','İstatistik'],['chart','#corner-analysis','Korner'],['system','#technical','Teknik']]
    : [['grid','#overview','Genel Bakış'],['ball','#matches','Maçlar'],['check','#matches','Resmi Tahminler','OFFICIAL'],['review','#matches','İnceleme','REVIEW'],['chart','#odds','Oran Analizi'],['history','#odds-analysis','Geçmiş İkizler'],['system','#system','Sistem']];
  const markup = links.map(([glyph,href,label,filter])=>`<a href="${href}"${filter ? ` data-nav-filter="${filter}"` : ''}>${icon(glyph)}${label}</a>`).join('');
  return `<aside class="sidebar"><a class="brand" href="/">BETAPP<small>ANALYTICS</small></a><nav class="side-nav" aria-label="Ana menü">${detail ? `<a href="/">${icon('grid')}Genel Bakış</a>` : ''}${markup}</nav><div class="sidebar-foot"><span class="feed-dot"></span> VERİ KAYNAKLARI<small>FotMob + NowGoal</small></div></aside>
    <details class="mobile-nav"><summary aria-label="Menüyü aç">${icon('menu')} BETAPP</summary><nav aria-label="Mobil menü">${detail ? '<a href="/">Genel Bakış</a>' : ''}${markup}</nav></details>`;
}
export function matchState(match: Record<string,unknown>, prediction?: Record<string,unknown>): string {
  const gate = objectValue(prediction?.predictionGate);
  if (match.status === 'finished' && (!prediction || (prediction.state ?? gate?.state) === 'NOT_GENERATED')) return 'NOT_EVALUATED';
  return String(gate?.overallStatus ?? 'WAITING');
}
export function matchRow(match: Record<string,unknown>, prediction?: Record<string,unknown>): string {
  const gate = objectValue(prediction?.predictionGate);
  const candidate = objectValue(gate?.candidate) ?? objectValue(prediction?.candidate);
  const id = String(match.id ?? match.match_id ?? match.matchId ?? '');
  const status = matchState(match,prediction);
  const market = candidate ? `${translateMarket(candidate.marketType)} ${candidate.line ?? ''} · ${translateSelection(candidate.selection)}` : '';
  return `<article class="match-row" data-search-row data-match-state="${escapeHtml(status)}"><div class="match-when"><strong>${escapeHtml(formatDate(match.kickoff_at ?? match.kickoffAt,{hour:'2-digit',minute:'2-digit'}))}</strong><small>${escapeHtml(match.league)}</small></div>
    <div class="match-teams"><strong>${escapeHtml(match.home_team ?? match.homeTeam)}</strong><strong>${escapeHtml(match.away_team ?? match.awayTeam)}</strong></div>
    <div class="match-verdict">${statusBadge(status)}<span>${escapeHtml(market || (status==='NOT_EVALUATED' ? 'Maç öncesi analiz oluşmadı' : 'Henüz analiz oluşmadı'))}</span>${status==='REVIEW' ? '<small>Resmi tahmin değildir.</small>' : ''}</div>
    <div class="match-score">${candidate?.predictionScore == null ? '<span>—</span>' : `<strong>${escapeHtml(candidate.predictionScore)}<small> / 100</small></strong>`}</div>
    ${id ? `<a class="analysis-link" href="/matches/${encodeURIComponent(id)}" aria-label="${escapeHtml(match.home_team ?? match.homeTeam)} maç analizini aç">Analizi Aç ${icon('arrow')}</a>` : ''}</article>`;
}
