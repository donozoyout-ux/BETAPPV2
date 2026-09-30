import { humanValue, navigation, progress, statusBadge } from './ui/components.js';
import { escapeHtml, formatDate, gateValue, objectValue, optionalOdds, shell,
  translateMarket, translateSelection } from './dashboard.js';

export type MatchAnalysisPageData = {
  match: Record<string, unknown>;
  predictionGate?: Record<string, unknown> | null;
  predictionDetail?: Record<string, unknown> | null;
  oddsAnalysis?: Record<string, unknown> | null;
  oddsIntelligence?: Record<string, unknown> | null;
  cornerAnalysis?: Record<string, unknown> | null;
};

function numberText(value: unknown, digits = 0): string {
  return value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits);
}

function percentText(value: unknown): string {
  return value == null || !Number.isFinite(Number(value)) ? '—' : `%${(Number(value) * 100).toFixed(1)}`;
}

function percentagePointText(value: unknown): string {
  return value == null || !Number.isFinite(Number(value)) ? '—' : `%${Number(value).toFixed(1)}`;
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item)
    && typeof item === 'object' && !Array.isArray(item)) : [];
}

function renderEmpty(title: string, text: string): string {
  return `<div class="detail-empty"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`;
}

function candidateMetric(label: string, value: unknown): string {
  return value == null || value === '' ? '' : `<div class="detail-metric"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`;
}

function renderOneXTwo(odds: Array<Record<string, unknown>>): string {
  const rows = odds.filter((item) => ['MATCH_RESULT','1X2'].includes(String(item.market_type ?? item.market_name ?? '').toUpperCase()));
  const providers = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const provider = String(row.provider ?? '');
    providers.set(provider, [...(providers.get(provider) ?? []), row]);
  }
  const selected = [...providers.entries()].sort((a, b) => {
    const coverage = (items: Array<Record<string, unknown>>) => new Set(items.map((item) => String(item.selection))).size;
    return coverage(b[1]) - coverage(a[1]) || a[0].localeCompare(b[0]);
  })[0];
  const selectedRows = selected?.[1] ?? [];
  const cell = (selection: string, label: string) => {
    const row = selectedRows.find((item) => String(item.selection ?? '').toUpperCase() === selection);
    const movement = row?.movement_percent == null || !Number.isFinite(Number(row.movement_percent)) ? ''
      : `<small>${Number(row.movement_percent) > 0 ? '+' : ''}${Number(row.movement_percent).toFixed(2)}%</small>`;
    return `<div class="one-x-two"><span>${label}</span><strong>${escapeHtml(optionalOdds(row?.current_odds))}</strong>${movement}</div>`;
  };
  return `<section class="odds-strip" aria-label="Gerçek 1 X 2 oranları"><div><span class="section-kicker">1 / X / 2</span>
    <small>${selected ? escapeHtml(selected[0]) : 'Gerçek oran henüz yok'}</small></div>${cell('HOME','1')}${cell('DRAW','X')}${cell('AWAY','2')}</section>`;
}

function renderGateTable(gates: Array<Record<string, unknown>>): string {
  if (!gates.length) return renderEmpty('Gate bilgisi henüz yok', 'Prediction V1 değerlendirmesi oluştuğunda kontroller burada gösterilecek.');
  return `<div class="scroll"><table class="gate-table"><thead><tr><th>Kontrol</th><th>Mevcut</th><th>Gerekli</th><th>Durum</th><th>Açıklama</th></tr></thead><tbody>${gates.map((item) =>
    `<tr><td><strong>${escapeHtml(item.label)}</strong></td><td>${escapeHtml(gateValue(item.current))}</td>
      <td>${escapeHtml(gateValue(item.required))}</td><td><span class="gate-result ${item.passed ? 'pass' : 'fail'}">${item.passed ? '✓ GEÇTİ' : '× GEÇMEDİ'}</span></td>
      <td>${escapeHtml(item.reason ?? (item.passed ? 'Koşul karşılandı.' : 'Açıklama henüz mevcut değil.'))}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderOddsRoute(intelligence: Record<string, unknown> | null): string {
  const route = objectValue(intelligence?.oddsRoute);
  if (!route) return renderEmpty('Oran rotası henüz oluşmadı', 'Yeterli gerçek pre-match gözlem biriktiğinde Odds Neighbor V2 rotası gösterilecek.');
  const snapshots = arrayValue(route.snapshots);
  const points = snapshots.map((item, index) => `<div class="route-point"><small>${index === 0 ? 'Açılış' : index === snapshots.length - 1 ? 'Güncel' : formatDate(item.capturedAt, { hour: '2-digit', minute: '2-digit' })}</small>
    <strong>${escapeHtml(optionalOdds(item.medianOdds))}</strong><span>${escapeHtml(item.bookmakerCount ?? '—')} bookmaker</span></div>`).join('<span class="route-arrow">→</span>');
  return `<div class="route-head"><div><strong>${escapeHtml(translateMarket(route.marketType))}${route.line == null ? '' : ` ${escapeHtml(route.line)}`} · ${escapeHtml(translateSelection(route.selection))}</strong>
    <p>${escapeHtml(humanValue(route.direction))} · ${escapeHtml(humanValue(route.strength))} · ${escapeHtml(route.genuineObservations)} gerçek gözlem · ${arrayValue(route.bookmakers).length || (Array.isArray(route.bookmakers) ? route.bookmakers.length : 0)} bookmaker</p></div></div>
    <div class="route-track">${points || `<div class="route-point"><small>Açılış</small><strong>${escapeHtml(optionalOdds(route.openingOdds))}</strong></div><span class="route-arrow">→</span><div class="route-point"><small>Güncel</small><strong>${escapeHtml(optionalOdds(route.latestOdds))}</strong></div>`}</div>
    <p class="detail-disclaimer">Odds Neighbor V2 açıklayıcı kanıttır; Prediction V1 kararını değiştirmez.</p>`;
}

function renderTwins(intelligence: Record<string, unknown> | null): string {
  const twins = arrayValue(intelligence?.pastTwins);
  if (!twins.length) return renderEmpty('Geçmiş ikiz bulunamadı', 'Bu oran profiline benzeyen yeterli sonuçlanmış maç henüz yok.');
  return `<div class="twins-summary"><strong>${twins.length} geçmiş ikiz</strong><span>Kanıt gücü: ${escapeHtml(humanValue(intelligence?.evidenceStrength))}</span></div>
    <div class="twin-list">${twins.map((item, index) => {
      const score = item.homeScore == null || item.awayScore == null ? '' : `${item.homeScore} — ${item.awayScore}`;
      const corners = item.homeCorners == null || item.awayCorners == null ? '' : `${item.homeCorners} — ${item.awayCorners} korner`;
      return `${index === 5 ? '<details><summary>Diğer geçmiş ikizler</summary><div class="details-body">' : ''}<article class="twin-row"><div><strong>${escapeHtml(item.homeTeam)} — ${escapeHtml(item.awayTeam)}</strong><small>${escapeHtml(item.league)} · ${escapeHtml(formatDate(item.kickoffAt, { day: '2-digit', month: 'short', year: 'numeric' }))}</small></div>
        <div class="mono">${escapeHtml(optionalOdds(item.openingOdds))} → ${escapeHtml(optionalOdds(item.decisionOdds))}</div>
        <div><strong>${escapeHtml(percentagePointText(item.similarity))}</strong><small>${escapeHtml(score)}${score && corners ? ' · ' : ''}${escapeHtml(corners)}</small></div></article>`;
    }).join('')}${twins.length > 5 ? '</div></details>' : ''}</div>`;
}

function renderResultMap(intelligence: Record<string, unknown> | null): string {
  const rows = arrayValue(intelligence?.resultMap);
  if (!rows.length) return renderEmpty('Sonuç haritası henüz yok', 'Geçmiş ikizlerde ölçülebilir sonuç oluştuğunda dağılım gösterilecek.');
  return `<div class="result-cards">${rows.map((item) => `<article><small>${escapeHtml(translateMarket(item.market))}${item.line == null ? '' : ` ${escapeHtml(item.line)}`}</small>
    <strong>${escapeHtml(translateSelection(item.selection))}</strong><span>${escapeHtml(item.positiveCount)} / ${escapeHtml(item.sampleSize)}</span>
    <b>${escapeHtml(percentText(item.positiveRate))}</b>${progress(item.positiveRate, 100)}</article>`).join('')}</div>
    <p class="detail-disclaimer">Geçmiş dağılım garantili gelecek sonucu ifade etmez.</p>`;
}

function renderConflicts(intelligence: Record<string, unknown> | null): string {
  const rows = arrayValue(intelligence?.conflictCheck);
  if (!rows.length) return renderEmpty('Kanıt uyumu henüz yok', 'Bağımsız analiz kaynakları oluştuğunda uyum durumu gösterilecek.');
  return `<div class="conflict-grid">${rows.map((item) => {
    const state = String(item.state ?? 'UNAVAILABLE');
    const token = ['SUPPORT','NEUTRAL','CONFLICT','UNAVAILABLE'].includes(state) ? state.toLowerCase() : 'unavailable';
    return `<div><span>${escapeHtml(item.source)}</span><strong class="signal-${token}">${escapeHtml(humanValue(state))}</strong></div>`;
  }).join('')}</div>`;
}

function renderOddsAnalysis(analysis: Record<string, unknown> | null): string {
  if (!analysis) return renderEmpty('Oran analizi henüz oluşmadı', 'ODDS_V1 çalıştığında gerçek market analizi burada görünecek.');
  const items = arrayValue(analysis.items);
  const row = (item: Record<string, unknown>) => `<tr><td>${escapeHtml(translateMarket(item.market_type))}${item.line == null ? '' : ` ${escapeHtml(item.line)}`}</td>
    <td>${escapeHtml(translateSelection(item.selection))}</td><td class="mono">${escapeHtml(optionalOdds(item.opening_odds))}</td>
    <td class="mono">${escapeHtml(optionalOdds(item.current_odds))}</td><td>${escapeHtml(item.bookmaker_count ?? '—')}</td>
    <td>${escapeHtml(item.complete_state_bookmaker_count ?? '—')}</td><td>${escapeHtml(item.movement_class ?? '—')}</td>
    <td>${escapeHtml(item.movement_agreement_ratio == null ? '—' : percentText(item.movement_agreement_ratio))}</td><td>${escapeHtml(item.score ?? '—')}</td></tr>`;
  return `<div class="analysis-summary"><span>Model <b>${escapeHtml(analysis.model_version ?? '—')}</b></span>
    <span>Veri kalitesi <b>${escapeHtml(analysis.data_quality_grade ?? '—')}</b></span><span>Model güveni <b>${escapeHtml(analysis.confidence_grade ?? '—')}</b></span>
    <span>Analize uygun <b>${analysis.analysis_eligible === true ? 'EVET' : analysis.analysis_eligible === false ? 'HAYIR' : '—'}</b></span></div>
    <div class="scroll"><table><thead><tr><th>Market</th><th>Seçim</th><th>Açılış</th><th>Güncel</th><th>Bookmaker</th><th>Tam durum</th><th>Hareket</th><th>Uyum</th><th>Skor</th></tr></thead>
    <tbody>${items.slice(0, 6).map(row).join('')}</tbody></table></div>${items.length > 6 ? `<details><summary>Tümünü göster (${items.length})</summary><div class="details-body scroll"><table><tbody>${items.map(row).join('')}</tbody></table></div></details>` : ''}`;
}

function renderStatistics(match: Record<string, unknown>): string {
  const statistics = arrayValue(match.statistics);
  if (!statistics.length) return renderEmpty('İstatistik mevcut değil', 'Bu maç için takım istatistikleri henüz mevcut değil.');
  const priority = (item: Record<string, unknown>) => /expected.?goals|xg|shots|possession|corners|big.?chances|cards|şut|korner|topa sahip|kart|gol beklentisi|büyük fırsat/i.test(String(item.key ?? '') + ' ' + String(item.label ?? ''));
  const row = (item: Record<string, unknown>) => {
    const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value
      : typeof value === 'string' && /^\d+(\.\d+)?%?$/.test(value.trim()) ? Number(value.replace('%','')) : null;
    const home = numeric(item.home_value);
    const away = numeric(item.away_value);
    const comparable = home != null && away != null && home >= 0 && away >= 0 && home + away > 0;
    const width = comparable ? (home / (home + away)) * 100 : 0;
    return `<div class="stat-row"><b>${escapeHtml(item.home_value ?? '—')}</b><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.away_value ?? '—')}</b>${comparable ? `<span class="comparison-bar" aria-hidden="true"><i style="width:${width.toFixed(2)}%"></i><i style="width:${(100-width).toFixed(2)}%"></i></span>` : ''}</div>`;
  };
  const group = (items: Array<Record<string,unknown>>) => [...new Set(items.map(item => String(item.period ?? 'ALL')))].map(period => {
    const rows = items.filter(item => String(item.period ?? 'ALL') === period);
    return `<div class="stats-period"><strong>${escapeHtml(period)}</strong>${rows.map(row).join('')}<small>Kaynak: ${escapeHtml([...new Set(rows.map(item=>String(item.provider ?? '—')))].join(', '))}</small></div>`;
  }).join('');
  const primary = statistics.filter(priority);
  const other = statistics.filter(item => !priority(item));
  return group(primary) + (other.length ? `<details><summary>Diğer istatistikler (${other.length})</summary><div class="details-body">${group(other)}</div></details>` : '');
}

function renderCorners(matchId: string, corner: Record<string, unknown> | null): string {
  if (!corner) return renderEmpty('Korner analizi mevcut değil', 'Corner Engine bu maç için henüz uygun bir analiz üretmedi.');
  const probabilities = Object.entries(objectValue(corner.probabilities) ?? {});
  const row = ([line,raw]: [string,unknown]) => {
    const value = objectValue(raw);
    return value ? `<div class="probability-row"><span>${escapeHtml(line)} ÜST</span><strong>${escapeHtml(percentText(value.over))}</strong>${progress(value.over,100)}<small>ALT ${escapeHtml(percentText(value.under))}</small></div>` : '';
  };
  return `<div class="corner-metrics">${candidateMetric('Ev beklentisi', numberText(corner.expected_home_corners,2))}${candidateMetric('Deplasman beklentisi',numberText(corner.expected_away_corners,2))}${candidateMetric('Toplam beklenti',numberText(corner.expected_total_corners,2))}</div>
    ${probabilities.slice(0,3).map(row).join('')}${probabilities.length>3 ? `<details><summary>Tüm korner çizgileri</summary><div class="details-body">${probabilities.slice(3).map(row).join('')}</div></details>` : ''}
    <p class="corner-secondary">Model güveni: ${escapeHtml(numberText(corner.model_confidence))} · Veri kalitesi: ${escapeHtml(humanValue(corner.data_quality_status))}</p>
    <a class="analysis-link" href="/matches/${encodeURIComponent(matchId)}/corners">Detaylı Korner Analizi →</a>`;
}

export function renderMatchAnalysis(data: MatchAnalysisPageData): string {
  const match = data.match;
  const matchId = String(match.id ?? '');
  const finishedWithoutEvaluation = String(match.status) === 'finished'
    && (data.predictionDetail?.state ?? data.predictionGate?.state) === 'NOT_GENERATED';
  const gate = finishedWithoutEvaluation ? null : data.predictionGate ?? null;
  const status = finishedWithoutEvaluation ? 'NOT_EVALUATED' : String(gate?.overallStatus ?? 'WAITING');
  const notEvaluatedCopy = 'Bu maç için kickoff öncesinde ODDS_V1 / Prediction V1 değerlendirmesi oluşmadı. Geriye dönük resmi tahmin üretilmez.';
  const candidate = objectValue(gate?.candidate);
  const historical = objectValue(candidate?.historical);
  const gates = arrayValue(gate?.gates);
  const passed = gates.filter((item) => item.passed === true).length;
  const gateCount = finishedWithoutEvaluation ? 'DEĞERLENDİRİLMEDİ' : `${passed} / ${gates.length} geçti`;
  const odds = arrayValue(match.odds);
  const finished = String(match.status ?? '').toLowerCase() === 'finished';
  const score = finished && match.home_score != null && match.away_score != null
    ? `${escapeHtml(match.home_score)} — ${escapeHtml(match.away_score)}` : 'VS';
  const heroCopy = status === 'OFFICIAL' ? 'Resmi tahmin oluştu.' : status === 'REVIEW' ? 'Resmi tahmin değildir.'
    : status === 'REJECTED' ? 'Resmi tahmin oluşturulmadı.' : finishedWithoutEvaluation ? 'Maç öncesi analiz oluşmadı.' : 'Veri bekleniyor.';
  const mainMarket = candidate ? `${translateMarket(candidate.marketType)}${candidate.line == null ? '' : ` ${candidate.line}`} · ${translateSelection(candidate.selection)}` : null;
  const detail = data.predictionDetail ?? {};
  const runCount = Array.isArray(detail.runs) ? detail.runs.length : 0;
  const safetyGates = gates.filter((item) => ['SELF_AUDIT_GLOBAL','SELF_AUDIT_SEGMENT'].includes(String(item.key)));

  const reasons = (status === 'OFFICIAL' ? gates.filter(item => item.passed === true)
    : [...gates.filter(item => item.passed !== true), ...gates.filter(item => item.passed === true)]).slice(0,3);
  return shell(`<div class="app-shell detail-shell">${navigation(true)}<div class="app-main">
    <header class="topbar"><span class="top-title">Futbol / Maç Analizi</span><a href="/">Genel Bakış</a></header>
    <main class="content detail-content">
      <header class="match-hero" id="match-overview"><div class="match-meta"><span>${escapeHtml(match.league)}</span><span>${escapeHtml(formatDate(match.kickoff_at,{day:'2-digit',month:'long',hour:'2-digit',minute:'2-digit'}))}</span></div>
        <h1 class="scoreboard"><strong>${escapeHtml(match.home_team)}</strong><b>${score}</b><strong>${escapeHtml(match.away_team)}</strong></h1>
        <div class="hero-gate">${statusBadge(status)}<p>${escapeHtml(finishedWithoutEvaluation ? notEvaluatedCopy : heroCopy)}</p></div></header>
      <nav class="detail-nav" aria-label="Maç detay bölümleri"><a href="#match-overview">Özet</a><a href="#odds-route">Oranlar</a><a href="#past-twins">Geçmiş İkizler</a><a href="#match-statistics">İstatistik</a><a href="#corner-analysis">Korner</a><a href="#technical">Teknik</a></nav>
      <section class="detail-grid core-grid"><article class="detail-panel core-panel"><span class="section-kicker">BETAPP ANALİZİ</span><h2>Ana Aday</h2>
      ${candidate ? `<div class="candidate-market">${escapeHtml(mainMarket)}</div><div class="detail-metrics">
        ${candidateMetric('Güncel oran',optionalOdds(candidate.currentOdds ?? candidate.referenceOdds))}
        ${candidateMetric('Geçmiş örnek',historical?.settledSampleSize)}${candidateMetric('Geçmiş başarı',percentText(historical?.historicalHitRate))}
        ${candidateMetric('Bookmaker',candidate.bookmakerCount)}</div>
        ${candidate.predictionScore == null ? '' : `<div class="score-progress"><small>Tahmin skoru <strong>${escapeHtml(candidate.predictionScore)} / 100</strong></small>${progress(candidate.predictionScore)}</div>`}`
        : renderEmpty(finishedWithoutEvaluation ? 'Maç öncesi analiz oluşmadı.' : 'Henüz resmi aday hesaplanmadı',finishedWithoutEvaluation ? 'Geriye dönük resmi tahmin üretilmez.' : 'Yeterli gerçek veri oluştuğunda ana aday burada görünür.')}
      </article><article class="detail-panel why-panel"><div class="why-head"><h2>Öne çıkan nedenler</h2><span class="muted">${gateCount}</span></div>
        <div class="why-list">${reasons.length ? reasons.map(item => `<div data-top-reason><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.reason ?? (item.passed ? 'Koşul karşılandı.' : 'Koşul henüz karşılanmadı.'))}</p></div>`).join('') : renderEmpty(finishedWithoutEvaluation ? 'Prediction V1 değerlendirmesi oluşturulmadı.' : 'Gate değerlendirmesi henüz oluşmadı.',finishedWithoutEvaluation ? 'Maç öncesi kontroller çalıştırılmadı.' : 'Kontroller değerlendirme oluştuğunda gösterilir.') }
        </div>${finishedWithoutEvaluation ? '' : `<details id="gate-inspector"><summary>Prediction Gate Inspector · ${gateCount}</summary>${renderGateTable(gates)}</details>`}</article></section>
      ${renderOneXTwo(odds)}
      <section class="detail-panel detail-section" id="odds-route"><h2>Oran Rotası</h2>${renderOddsRoute(data.oddsIntelligence ?? null)}</section>
      <section class="detail-grid split-grid"><article class="detail-panel" id="past-twins"><h2>Geçmiş İkizler</h2>${renderTwins(data.oddsIntelligence ?? null)}</article>
        <article class="detail-panel"><h2>Geçmiş benzer oran profillerinin sonuç dağılımı</h2>${renderResultMap(data.oddsIntelligence ?? null)}</article></section>
      <section class="detail-grid split-grid"><article class="detail-panel" id="match-statistics"><h2>Maç İstatistikleri</h2>${renderStatistics(match)}</article>
        <article class="detail-panel" id="corner-analysis"><h2>Korner Analizi</h2>${renderCorners(matchId,data.cornerAnalysis ?? null)}</article></section>
      <details class="technical-records" id="technical"><summary>Teknik Prediction V1 kayıtları</summary><div class="details-body">
        <div class="analysis-summary"><span>Durum <b>${escapeHtml(detail.state ?? 'NOT_GENERATED')}</b></span><span>Run sayısı <b>${runCount}</b></span><span>Journal <b>${detail.journal ? 'VAR' : 'YOK'}</b></span><span>Execution authority <b>FALSE</b></span><span>AI prediction authority <b>FALSE</b></span></div>
        <h2>Oran Analizi</h2>${renderOddsAnalysis(data.oddsAnalysis ?? null)}
        <h2>Çelişki Kontrolü</h2>${renderConflicts(data.oddsIntelligence ?? null)}
        <h2>Tahmin Güvenliği</h2>${safetyGates.length ? renderGateTable(safetyGates) : renderEmpty('Self-Audit gate bilgisi yok','Gate Inspector çıktısı oluştuğunda güvenlik durumu gösterilecek.')}
      </div></details>
      <footer class="footer"><span>BETAPP · Maç analizi</span><span>Geçmiş kanıt ve model çıktıları garanti veya bahis talimatı değildir.</span></footer>
    </main></div></div>`, `${String(match.home_team ?? '')} — ${String(match.away_team ?? '')} · BETAPP Analizi`);
}
