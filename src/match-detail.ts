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

const statusLabels: Record<string, string> = { OFFICIAL: 'RESMİ TAHMİN', REVIEW: 'İNCELEME',
  WAITING: 'VERİ BEKLENİYOR', REJECTED: 'REDDEDİLDİ' };
const statusClasses: Record<string, string> = { OFFICIAL: 'ok', REVIEW: 'partial', WAITING: 'neutral', REJECTED: 'bad' };

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

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
    <p>${escapeHtml(route.direction)} · ${escapeHtml(route.strength)} · ${escapeHtml(route.genuineObservations)} gerçek gözlem · ${arrayValue(route.bookmakers).length || (Array.isArray(route.bookmakers) ? route.bookmakers.length : 0)} bookmaker</p></div></div>
    <div class="route-track">${points || `<div class="route-point"><small>Açılış</small><strong>${escapeHtml(optionalOdds(route.openingOdds))}</strong></div><span class="route-arrow">→</span><div class="route-point"><small>Güncel</small><strong>${escapeHtml(optionalOdds(route.latestOdds))}</strong></div>`}</div>
    <p class="detail-disclaimer">Odds Neighbor V2 açıklayıcı kanıttır; Prediction V1 kararını değiştirmez.</p>`;
}

function renderTwins(intelligence: Record<string, unknown> | null, targetLeague = ''): string {
  const targetMatch = objectValue(intelligence?.match);
  const referenceLeague = String(targetMatch?.league ?? targetLeague);
  const twins = arrayValue(intelligence?.pastTwins)
    .filter((item) => finiteNumber(item.similarity, -1) >= 70);
  if (!twins.length) return renderEmpty('Yeterli benzer oran örneği bulunamadı',
    '%70 benzerlik eşiğini geçen sonuçlanmış maç oluştuğunda burada gösterilecek.');
  const averageSimilarity = twins.reduce((sum, item) => sum + finiteNumber(item.similarity), 0) / twins.length;
  const evidenceReady = twins.length >= 5;
  const groupLabel = evidenceReady && averageSimilarity >= 80 ? 'Geçmiş ikizler' : 'Yakın oran örnekleri';
  const evidenceText = evidenceReady ? `Kanıt gücü: ${String(intelligence?.evidenceStrength ?? '—')}`
    : 'Örnek yetersiz · güvenilir başarı oranı için en az 5 maç gerekir';
  const similarityQuality = (value: unknown) => {
    const score = finiteNumber(value);
    return score >= 90 ? 'Güçlü ikiz' : score >= 80 ? 'İyi benzerlik' : score >= 70 ? 'Zayıf benzerlik' : 'Eşik altı';
  };
  return `<div class="twins-summary"><strong>${twins.length} ${escapeHtml(groupLabel)}</strong><span>${escapeHtml(evidenceText)}</span></div>
    <div class="twin-list">${twins.map((item) => {
      const score = item.homeScore == null || item.awayScore == null ? '' : `${item.homeScore} — ${item.awayScore}`;
      const corners = item.homeCorners == null || item.awayCorners == null ? '' : `${item.homeCorners} — ${item.awayCorners} korner`;
      const differentLeague = referenceLeague.length > 0 && String(item.league ?? '') !== referenceLeague;
      return `<article class="twin-row"><div><strong>${escapeHtml(item.homeTeam)} — ${escapeHtml(item.awayTeam)}</strong><small>${escapeHtml(item.league)} · ${escapeHtml(formatDate(item.kickoffAt, { day: '2-digit', month: 'short', year: 'numeric' }))}${differentLeague ? ' · Farklı lig' : ''}</small></div>
        <div class="mono">${escapeHtml(optionalOdds(item.openingOdds))} → ${escapeHtml(optionalOdds(item.decisionOdds))}</div>
        <div><strong>${escapeHtml(percentagePointText(item.similarity))}</strong><small>${escapeHtml(similarityQuality(item.similarity))}${score ? ` · ${escapeHtml(score)}` : ''}${score && corners ? ' · ' : ''}${escapeHtml(corners)}</small></div></article>`;
    }).join('')}</div>`;
}

function renderResultMap(intelligence: Record<string, unknown> | null): string {
  const rows = arrayValue(intelligence?.resultMap);
  if (!rows.length) return renderEmpty('Sonuç haritası henüz yok', 'Geçmiş ikizlerde ölçülebilir sonuç oluştuğunda dağılım gösterilecek.');
  return `<div class="result-cards">${rows.map((item) => {
    const sample = finiteNumber(item.sampleSize);
    return `<article><small>${escapeHtml(translateMarket(item.market))}${item.line == null ? '' : ` ${escapeHtml(item.line)}`}</small>
    <strong>${escapeHtml(translateSelection(item.selection))}</strong><span>${escapeHtml(item.positiveCount)} / ${escapeHtml(item.sampleSize)}</span>
    <b>${sample >= 5 ? escapeHtml(percentText(item.positiveRate)) : 'Örnek yetersiz'}</b></article>`;
  }).join('')}</div>
    <p class="detail-disclaimer">Geçmiş dağılım garantili gelecek sonucu ifade etmez.</p>`;
}

function renderConflicts(intelligence: Record<string, unknown> | null): string {
  const rows = arrayValue(intelligence?.conflictCheck);
  if (!rows.length) return renderEmpty('Kanıt uyumu henüz yok', 'Bağımsız analiz kaynakları oluştuğunda uyum durumu gösterilecek.');
  return `<div class="conflict-grid">${rows.map((item) => {
    const state = String(item.state ?? 'UNAVAILABLE');
    const token = ['SUPPORT','NEUTRAL','CONFLICT','UNAVAILABLE'].includes(state) ? state.toLowerCase() : 'unavailable';
    return `<div><span>${escapeHtml(item.source)}</span><strong class="signal-${token}">${escapeHtml(state)}</strong></div>`;
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
  const periods = new Map<string, Array<Record<string, unknown>>>();
  for (const item of statistics) {
    const period = String(item.period ?? 'ALL');
    periods.set(period, [...(periods.get(period) ?? []), item]);
  }
  return [...periods.entries()].map(([period, rows]) => `<div class="stats-period"><strong>${escapeHtml(period)}</strong>
    <div class="stats-list">${rows.map((item) => `<div class="stat-row"><b>${escapeHtml(item.home_value ?? '—')}</b><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.away_value ?? '—')}</b></div>`).join('')}</div>
    <small>Kaynak: ${escapeHtml([...new Set(rows.map((item) => String(item.provider ?? '—')))].join(', '))}</small></div>`).join('');
}

function renderCorners(matchId: string, corner: Record<string, unknown> | null): string {
  if (!corner) return renderEmpty('Korner analizi mevcut değil', 'Corner Engine bu maç için henüz uygun bir analiz üretmedi.');
  const probabilities = objectValue(corner.probabilities) ?? {};
  const probabilityRows = Object.entries(probabilities).flatMap(([line, raw]) => {
    const value = objectValue(raw);
    return value ? [`<tr><td>${escapeHtml(line)}</td><td>${escapeHtml(percentText(value.over))}</td><td>${escapeHtml(percentText(value.under))}</td></tr>`] : [];
  }).join('');
  return `<div class="corner-metrics">${candidateMetric('Ev korner beklentisi', numberText(corner.expected_home_corners, 2))}
    ${candidateMetric('Deplasman korner beklentisi', numberText(corner.expected_away_corners, 2))}${candidateMetric('Toplam beklenti', numberText(corner.expected_total_corners, 2))}
    ${candidateMetric('Model güveni', numberText(corner.model_confidence))}${candidateMetric('Veri kalitesi', corner.data_quality_status)}${candidateMetric('Dağılım', corner.distribution)}</div>
    ${probabilityRows ? `<div class="scroll"><table><thead><tr><th>Çizgi</th><th>ÜST</th><th>ALT</th></tr></thead><tbody>${probabilityRows}</tbody></table></div>` : ''}
    <a class="analysis-link" href="/matches/${encodeURIComponent(matchId)}/corners">Detaylı Korner Analizi →</a>`;
}

export function renderMatchAnalysis(data: MatchAnalysisPageData): string {
  const match = data.match;
  const matchId = String(match.id ?? '');
  const gate = data.predictionGate ?? null;
  const status = String(gate?.overallStatus ?? 'WAITING');
  const candidate = objectValue(gate?.candidate);
  const historical = objectValue(candidate?.historical);
  const gates = arrayValue(gate?.gates);
  const passed = gates.filter((item) => item.passed === true).length;
  const odds = arrayValue(match.odds);
  const finished = String(match.status ?? '').toLowerCase() === 'finished';
  const score = finished && match.home_score != null && match.away_score != null
    ? `${escapeHtml(match.home_score)} — ${escapeHtml(match.away_score)}` : 'VS';
  const heroCopy = status === 'OFFICIAL' ? 'Resmi tahmin oluştu.' : status === 'REVIEW' ? 'Resmi tahmin değildir.'
    : status === 'REJECTED' ? 'Resmi tahmin oluşturulmadı.' : 'Veri bekleniyor.';
  const mainMarket = candidate ? `${translateMarket(candidate.marketType)}${candidate.line == null ? '' : ` ${candidate.line}`} · ${translateSelection(candidate.selection)}` : null;
  const detail = data.predictionDetail ?? {};
  const runCount = Array.isArray(detail.runs) ? detail.runs.length : 0;
  const safetyGates = gates.filter((item) => ['SELF_AUDIT_GLOBAL','SELF_AUDIT_SEGMENT'].includes(String(item.key)));

  return shell(`<div class="app-shell detail-shell"><aside class="sidebar"><a class="brand" href="/"><span class="brand-mark">B</span><span>BETAPP<small>Maç Analizi</small></span></a>
    <div class="side-group"><div class="side-label">Maç Terminali</div><nav class="side-nav" aria-label="Maç analizi menüsü">
      <a href="/"><span class="nav-icon">←</span>Genel Bakış</a><a class="active" href="#match-overview"><span class="nav-icon">◎</span>Maç Özeti</a>
      <a href="#gate-inspector"><span class="nav-icon">✓</span>Gate Inspector</a><a href="#odds-route"><span class="nav-icon">↗</span>Oran Rotası</a>
      <a href="#past-twins"><span class="nav-icon">∿</span>Benzer Oran Örnekleri</a><a href="#match-statistics"><span class="nav-icon">▤</span>İstatistikler</a>
      <a href="#corner-analysis"><span class="nav-icon">⌁</span>Korner Analizi</a></nav></div>
    <div class="sidebar-foot"><a class="system-pill" href="/"><span class="live-dot ${status === 'OFFICIAL' ? '' : 'wait'}"></span><span><strong style="display:block;color:var(--text)">${escapeHtml(statusLabels[status] ?? status)}</strong>Prediction Gate Inspector</span></a></div></aside>
    <div class="app-main"><header class="topbar"><div class="top-title"><strong>BETAPP Maç Analizi</strong><span>${escapeHtml(match.league)} · ${escapeHtml(formatDate(match.kickoff_at, { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span></div>
      <div class="top-actions"><a class="top-chip" href="/">← Genel Bakış</a></div></header><main class="content detail-content">
      <section class="match-hero" id="match-overview"><div class="match-meta"><span>${escapeHtml(match.league)}</span><span>${escapeHtml(formatDate(match.kickoff_at, { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }))}</span><span>${escapeHtml(match.status)}</span></div>
        <div class="scoreboard"><strong>${escapeHtml(match.home_team)}</strong><b>${score}</b><strong>${escapeHtml(match.away_team)}</strong></div>
        <div class="hero-gate"><span class="badge ${statusClasses[status] ?? 'neutral'}">${escapeHtml(statusLabels[status] ?? status)}</span><strong>${heroCopy}</strong><p>${escapeHtml(gate?.summary ?? 'Prediction V1 değerlendirmesi henüz oluşmadı.')}</p></div></section>
      ${renderOneXTwo(odds)}

      <section class="detail-grid core-grid"><article class="detail-panel core-panel"><span class="section-kicker">BETAPP ANALİZİ</span><h2>Ana Aday</h2>${candidate ? `<div class="candidate-market">${escapeHtml(mainMarket)}</div>
        <div class="detail-metrics">${candidateMetric('Güncel oran', optionalOdds(candidate.currentOdds ?? candidate.referenceOdds))}${candidateMetric('Açılış oranı', optionalOdds(candidate.openingOdds))}
          ${candidateMetric('Tahmin skoru', candidate.predictionScore == null ? null : `${candidate.predictionScore} / 100`)}${candidateMetric('Geçmiş benzer', historical?.settledSampleSize)}
          ${candidateMetric('Geçmiş başarı', percentText(historical?.historicalHitRate))}${candidateMetric('Oran hareketi', candidate.movementClass)}
          ${candidateMetric('Bookmaker', candidate.bookmakerCount)}${candidateMetric('Veri kalitesi', candidate.dataQualityGrade)}${candidateMetric('Model güveni', candidate.confidenceGrade)}</div>`
        : renderEmpty('Henüz resmi aday hesaplanmadı', 'Oran analizi ve Prediction V1 değerlendirmesi tamamlandığında ana aday burada görünecek.')}</article>
        <article class="detail-panel why-panel"><div class="why-head"><div><span class="section-kicker">NEDEN?</span><h2>${passed} / ${gates.length} geçti</h2></div><span class="badge ${statusClasses[status] ?? 'neutral'}">${escapeHtml(statusLabels[status] ?? status)}</span></div>
          <div class="why-list">${gates.length ? gates.map((item) => `<div><span>${item.passed ? '✓' : '×'} ${escapeHtml(item.label)}<small>Mevcut: ${escapeHtml(gateValue(item.current))} · Gerekli: ${escapeHtml(gateValue(item.required))}</small></span><b>${item.passed ? 'GEÇTİ' : 'GEÇMEDİ'}</b></div>`).join('') : '<p>Gate değerlendirmesi henüz oluşmadı.</p>'}</div></article></section>

      <section class="detail-grid evidence-grid"><article class="detail-panel wide" id="gate-inspector"><div class="detail-title"><div><span class="section-kicker">PREDICTION V1</span><h2>Prediction Gate Inspector</h2></div><span>${passed} / ${gates.length} geçti</span></div>${renderGateTable(gates)}</article>
        <article class="detail-panel" id="odds-route"><span class="section-kicker">ODDS NEIGHBOR V2</span><h2>Oran Rotası</h2>${renderOddsRoute(data.oddsIntelligence ?? null)}</article></section>

      <section class="detail-grid split-grid"><article class="detail-panel" id="past-twins"><span class="section-kicker">GEÇMİŞ KANIT</span><h2>Benzer Oran Örnekleri</h2>${renderTwins(data.oddsIntelligence ?? null, String(match.league ?? ''))}</article>
        <article class="detail-panel"><span class="section-kicker">SONUÇ HARİTASI</span><h2>Geçmiş benzer oran profillerinin sonuç dağılımı</h2>${renderResultMap(data.oddsIntelligence ?? null)}</article></section>

      <section class="detail-grid split-grid"><article class="detail-panel"><span class="section-kicker">KANIT UYUMU</span><h2>Çelişki Kontrolü</h2>${renderConflicts(data.oddsIntelligence ?? null)}</article>
        <article class="detail-panel"><span class="section-kicker">SELF-AUDIT</span><h2>Tahmin Güvenliği</h2>${safetyGates.length ? `<div class="conflict-grid">${safetyGates.map((item) => `<div><span>${escapeHtml(item.label)}</span><strong class="${item.passed ? 'signal-support' : 'signal-conflict'}">${item.passed ? 'GEÇTİ' : 'GEÇMEDİ'}</strong></div>`).join('')}</div>` : renderEmpty('Self-Audit gate bilgisi yok', 'Gate Inspector çıktısı oluştuğunda güvenlik durumu gösterilecek.')}</article></section>

      <section class="detail-panel detail-section" id="odds-analysis"><span class="section-kicker">ODDS V1</span><h2>Oran Analizi</h2>${renderOddsAnalysis(data.oddsAnalysis ?? null)}</section>
      <section class="detail-grid split-grid"><article class="detail-panel" id="match-statistics"><span class="section-kicker">GERÇEK MAÇ VERİSİ</span><h2>Maç İstatistikleri</h2>${renderStatistics(match)}</article>
        <article class="detail-panel" id="corner-analysis"><span class="section-kicker">CORNER ENGINE</span><h2>Korner Analizi</h2>${renderCorners(matchId, data.cornerAnalysis ?? null)}</article></section>

      <details class="technical-records"><summary>Teknik Prediction V1 kayıtları</summary><div class="details-body"><div class="analysis-summary">
        <span>Durum <b>${escapeHtml(detail.state ?? 'NOT_GENERATED')}</b></span><span>Run sayısı <b>${runCount}</b></span><span>Journal <b>${detail.journal ? 'VAR' : 'YOK'}</b></span>
        <span>Execution authority <b>FALSE</b></span><span>AI prediction authority <b>FALSE</b></span></div></div></details>
      <footer class="footer"><span>BETAPP · Maç analiz terminali</span><span>Geçmiş kanıt ve model çıktıları garanti veya bahis talimatı değildir.</span></footer>
    </main></div></div>`, `${String(match.home_team ?? '')} — ${String(match.away_team ?? '')} · BETAPP Analizi`);
}
