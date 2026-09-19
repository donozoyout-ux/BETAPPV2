type DashboardData = { matches: Array<Record<string, unknown>>; providers: Array<Record<string, unknown>>;
  qualification?: Array<Record<string, unknown>>; cornerAnalyses?: Array<Record<string, unknown>>;
  oddsAnalyses?: Array<Record<string, unknown>>;
  datasetAudit?: Record<string, unknown> | null; validation?: Record<string, unknown> | null;
  backfill?: Array<Record<string, unknown>> };
type ValidationMetric = { count?: unknown; sample?: unknown; averagePredictedProbability?: unknown; actualHitRate?: unknown;
  absoluteCalibrationError?: unknown; mae?: unknown; brier?: unknown };
type DatasetAuditView = { totalMatches?: unknown; cornerCoverage?: { complete?: { rate?: unknown } };
  perCompetition?: unknown[]; perSeason?: unknown[] };
type ValidationView = { mae?: unknown; rmse?: unknown; brier?: unknown; logLoss?: unknown;
  calibration?: Record<string, ValidationMetric>; qualityPerformance?: Record<string, ValidationMetric>;
  confidencePerformance?: Record<string, ValidationMetric> };

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function renderDashboard(data: DashboardData): string {
  const audit = (data.datasetAudit?.report ?? null) as DatasetAuditView | null;
  const validation = (data.validation?.report ?? null) as ValidationView | null;
  const percent = (value: unknown) => `${(Number(value ?? 0) * 100).toFixed(1)}%`;
  const providerCards = data.providers.length
    ? data.providers.map((provider) => `
      <article class="card">
        <div class="row"><strong>${escapeHtml(provider.provider)}</strong><span class="badge ${provider.status === 'healthy' ? 'ok' : 'bad'}">${escapeHtml(provider.status)}</span></div>
        <p>Son veri: ${escapeHtml(provider.last_fetch_at ?? 'Henüz yok')}</p>
        <p>Son kontrol: ${escapeHtml(provider.last_checked_at)}</p>
        <p>Başarı: ${Number(provider.total_attempts ?? 0) > 0 ? `${((Number(provider.total_successes) / Number(provider.total_attempts)) * 100).toFixed(1)}%` : '—'}</p>
        <p>Circuit: ${escapeHtml(provider.circuit_state ?? 'CLOSED')}</p><p>${escapeHtml(provider.message ?? '')}</p>
      </article>`).join('')
    : '<p>Henüz provider durumu yok.</p>';
  const rows = data.matches.length
    ? data.matches.map((match) => {
        const statistics = Array.isArray(match.available_statistics) ? match.available_statistics : [];
        const labels = statistics.map((stat: Record<string, unknown>) => escapeHtml(stat.label)).join(', ');
        return `<tr><td>${escapeHtml(new Date(String(match.kickoff_at)).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }))}</td>
          <td>${escapeHtml(match.league)}</td><td>${escapeHtml(match.home_team)} – ${escapeHtml(match.away_team)}</td>
          <td>${escapeHtml(match.status)}</td><td>${labels || 'Henüz yok'}</td></tr>`;
      }).join('')
    : '<tr><td colspan="5">Bugün desteklenen liglerde maç bulunamadı.</td></tr>';
  const capabilities = [...new Set((data.qualification ?? []).map((item) => String(item.capability)))];
  const qualificationProviders = [...new Set((data.qualification ?? []).map((item) => String(item.provider)))];
  const matrix = qualificationProviders.length ? `<div class="scroll"><table><thead><tr><th>Provider</th>${capabilities.map((capability) => `<th>${escapeHtml(capability)}</th>`).join('')}</tr></thead><tbody>${qualificationProviders.map((provider) => `<tr><td><strong>${escapeHtml(provider)}</strong></td>${capabilities.map((capability) => { const item = (data.qualification ?? []).find((entry) => entry.provider === provider && entry.capability === capability); const result = item?.result ?? 'NOT_TESTED'; return `<td><span class="badge ${result === 'SUPPORTED' ? 'ok' : result === 'PARTIAL' ? 'partial' : 'bad'}">${escapeHtml(result)}</span></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>` : '<p>Qualification henüz çalıştırılmadı. <code>npm run providers:qualify</code></p>';
  const cornerRows = (data.cornerAnalyses ?? []).length ? (data.cornerAnalyses ?? []).map((analysis) => {
    const probabilities = analysis.probabilities as Record<string, { over?: number }> | undefined;
    const percent = (line: string) => probabilities?.[line]?.over == null ? '—' : `${(probabilities[line]!.over! * 100).toFixed(1)}%`;
    return `<tr><td><a href="/matches/${escapeHtml(analysis.match_id)}/corners">${escapeHtml(analysis.home_team)} – ${escapeHtml(analysis.away_team)}</a></td>
      <td>${Number(analysis.expected_total_corners).toFixed(2)}</td><td>${percent('8.5')}</td><td>${percent('9.5')}</td><td>${percent('10.5')}</td>
      <td>${escapeHtml(analysis.data_quality_score)}/100</td><td>${escapeHtml(analysis.model_confidence)}/100</td></tr>`;
  }).join('') : '<tr><td colspan="7">Henüz corner analizi yok.</td></tr>';
  const oddsCards = (data.oddsAnalyses ?? []).length ? (data.oddsAnalyses ?? []).flatMap((analysis) => {
    const items = Array.isArray(analysis.items) ? analysis.items as Array<Record<string, unknown>> : [];
    return items.slice(0, 6).map((item) => {
      const reasons = Array.isArray(item.reasons) ? item.reasons : [];
      const warnings = Array.isArray(item.warnings) ? item.warnings : [];
      const probability = (value: unknown) => `${(Number(value) * 100).toFixed(1)}%`;
      return `<article class="card odds-card"><div class="row"><strong>${escapeHtml(analysis.home_team)} – ${escapeHtml(analysis.away_team)}</strong>
        <span class="badge ${item.analysis_eligible ? 'ok' : 'partial'}">${item.analysis_eligible ? 'UYGUN' : 'SINIRLI'}</span></div>
        <p>${escapeHtml(analysis.league)} · ${escapeHtml(new Date(String(analysis.kickoff_at)).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }))}</p>
        <p><strong>${escapeHtml(item.market_type)} ${item.line == null ? '' : escapeHtml(item.line)} · ${escapeHtml(item.selection)}</strong></p>
        <p>Açılış → Güncel: ${escapeHtml(item.opening_odds)} → ${escapeHtml(item.current_odds)}</p>
        <p>Piyasa Olasılığı: ${probability(item.opening_fair_probability)} → ${probability(item.current_fair_probability)}
          (${Number(item.probability_delta_pp) >= 0 ? '+' : ''}${Number(item.probability_delta_pp).toFixed(2)} pp)</p>
        <p>Oran Hareketi: ${escapeHtml(item.movement_class)} · Skor ${escapeHtml(item.score)}/100</p>
        <p>Bookmaker Teyidi: ${escapeHtml(item.agreeing_bookmaker_count)}/${escapeHtml(item.bookmaker_count)} ·
          Veri Kalitesi: ${escapeHtml(item.data_quality_score)}/100 (${escapeHtml(item.data_quality_grade)}) ·
          Model Güveni: ${escapeHtml(item.confidence_score)}/100 (${escapeHtml(item.confidence_grade)})</p>
        <p class="muted">${reasons.slice(0, 2).map(escapeHtml).join(' · ')}</p>
        ${warnings.length ? `<p class="warning">${warnings.map(escapeHtml).join(' · ')}</p>` : ''}</article>`;
    });
  }).join('') : '<p>Henüz oran analizi üretilmedi.</p>';
  const backfillRows = (data.backfill ?? []).length ? (data.backfill ?? []).map((run) => `<tr><td>${escapeHtml(run.competition_name)}</td>
    <td>${escapeHtml(run.season)}</td><td>${escapeHtml(run.status)}</td><td>${escapeHtml(run.fixtures_discovered)}</td>
    <td>${escapeHtml(run.matches_stored)}</td><td>${escapeHtml(run.corner_complete)}</td><td>${escapeHtml(run.partial)}</td>
    <td>${escapeHtml(run.failed)}</td><td>${escapeHtml(run.retries)}</td><td>${escapeHtml(run.last_checkpoint)}</td></tr>`).join('')
    : '<tr><td colspan="10">Henüz backfill çalıştırılmadı.</td></tr>';
  const datasetHealth = audit ? `<div class="grid">
    <article class="card"><strong>Historical matches</strong><p>${escapeHtml(audit.totalMatches)}</p></article>
    <article class="card"><strong>Corner coverage</strong><p>${percent(audit.cornerCoverage?.complete?.rate)}</p></article>
    <article class="card"><strong>Competitions</strong><p>${escapeHtml(audit.perCompetition?.length ?? 0)}</p></article>
    <article class="card"><strong>Seasons</strong><p>${escapeHtml(audit.perSeason?.length ?? 0)}</p></article></div>`
    : '<p>Dataset audit henüz çalıştırılmadı.</p>';
  const calibrationRows = validation ? Object.entries(validation.calibration ?? {}).map(([bucket, item]) =>
    `<tr><td>${escapeHtml(bucket)}</td><td>${escapeHtml(item.count)}</td><td>${percent(item.averagePredictedProbability)}</td>
     <td>${percent(item.actualHitRate)}</td><td>${percent(item.absoluteCalibrationError)}</td></tr>`).join('') : '';
  const bucketCards = (title: string, values: Record<string, ValidationMetric> | undefined) => values
    ? `<h3>${escapeHtml(title)}</h3><div class="grid">${Object.entries(values).map(([name, item]) =>
      `<article class="card"><strong>${escapeHtml(name)}</strong><p>n=${escapeHtml(item.sample)} · MAE ${Number(item.mae ?? 0).toFixed(3)} · Brier ${Number(item.brier ?? 0).toFixed(3)}</p></article>`).join('')}</div>` : '';
  const modelValidation = validation ? `<div class="grid">
    <article class="card"><strong>MAE</strong><p>${Number(validation.mae).toFixed(3)}</p></article>
    <article class="card"><strong>RMSE</strong><p>${Number(validation.rmse).toFixed(3)}</p></article>
    <article class="card"><strong>Brier</strong><p>${Number(validation.brier).toFixed(4)}</p></article>
    <article class="card"><strong>Log loss</strong><p>${Number(validation.logLoss).toFixed(4)}</p></article></div>
    <h3>Calibration</h3><div class="scroll"><table><thead><tr><th>Bucket</th><th>Count</th><th>Predicted</th><th>Actual</th><th>Abs. error</th></tr></thead><tbody>${calibrationRows}</tbody></table></div>
    ${bucketCards('Data Quality Performance', validation.qualityPerformance)}${bucketCards('Confidence Performance', validation.confidencePerformance)}`
    : '<p>Gerçek backtest henüz çalıştırılmadı.</p>';
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>BETAPP V2</title><style>
    :root{color-scheme:dark;--bg:#09110d;--panel:#122019;--line:#294033;--green:#5ee59a;--text:#edf7f0;--muted:#a8b9ae}*{box-sizing:border-box}
    body{margin:0;background:radial-gradient(circle at top,#163324,var(--bg) 42%);color:var(--text);font:15px system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:36px 20px}
    h1{font-size:clamp(32px,6vw,64px);letter-spacing:-.05em;margin:0}.sub{color:var(--muted);margin:6px 0 32px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px}.row{display:flex;justify-content:space-between;gap:16px}.badge{padding:4px 9px;border-radius:99px;font-size:12px;white-space:nowrap}.ok{background:#173e27;color:var(--green)}.partial{background:#4a401f;color:#ffe68a}.bad{background:#4a2020;color:#ff9e9e}.scroll{overflow:auto}
    section{margin-top:34px}table{width:100%;border-collapse:collapse;background:var(--panel);border-radius:14px;overflow:hidden}th,td{text-align:left;padding:14px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-size:12px;text-transform:uppercase}.muted{color:var(--muted)}.warning{color:#ffe68a}.odds-card p{margin:.55rem 0}@media(max-width:700px){th:nth-child(2),td:nth-child(2){display:none}}
    </style></head><body><main><h1>BETAPP <span style="color:var(--green)">V2</span></h1><p class="sub">Provider-independent futbol veri merkezi · Europe/Istanbul</p>
    <section><h2>Veri Kaynakları</h2><div class="grid">${providerCards}</div></section>
    <section><h2>Provider Qualification Matrix</h2>${matrix}</section>
    <section><h2>Dataset Health</h2>${datasetHealth}<h3>Backfill Progress</h3><div class="scroll"><table><thead><tr><th>Competition</th><th>Season</th><th>Status</th><th>Discovered</th><th>Stored</th><th>Complete</th><th>Partial</th><th>Failed</th><th>Retries</th><th>Checkpoint</th></tr></thead><tbody>${backfillRows}</tbody></table></div></section>
    <section><h2>Corner Model Validation</h2>${modelValidation}</section>
    <section><h2>Corner Analysis</h2><div class="scroll"><table><thead><tr><th>Maç</th><th>Expected Corners</th><th>O8.5</th><th>O9.5</th><th>O10.5</th><th>Data Quality</th><th>Confidence</th></tr></thead><tbody>${cornerRows}</tbody></table></div></section>
    <section><h2>ORAN ANALİZİ V1</h2><p class="muted">Deterministik piyasa hareket analizi; maç sonucu veya bahis önerisi değildir.</p><div class="grid">${oddsCards}</div></section>
    <section><h2>Bugünün Maçları</h2><table><thead><tr><th>Saat</th><th>Lig</th><th>Maç</th><th>Durum</th><th>Mevcut istatistik alanları</th></tr></thead><tbody>${rows}</tbody></table></section>
    </main></body></html>`;
}

export function renderCornerDetail(data: Record<string, unknown>): string {
  const probabilities = data.probabilities as Record<string, { over: number; under: number }>;
  const probabilityRows = Object.entries(probabilities).map(([line, value]) => `<tr><td>${escapeHtml(line)}</td><td>${(value.over * 100).toFixed(1)}%</td><td>${(value.under * 100).toFixed(1)}%</td></tr>`).join('');
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Corner Analysis</title>
  <style>body{max-width:1000px;margin:40px auto;padding:0 20px;background:#09110d;color:#edf7f0;font:15px system-ui}a{color:#5ee59a}section{background:#122019;border:1px solid #294033;border-radius:14px;padding:18px;margin:20px 0}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #294033;text-align:left}pre{white-space:pre-wrap;overflow:auto}</style></head><body>
  <a href="/">← Dashboard</a><h1>${escapeHtml(data.home_team)} – ${escapeHtml(data.away_team)}</h1>
  <section><h2>Expected Corners</h2><p>Home: ${Number(data.expected_home_corners).toFixed(2)} · Away: ${Number(data.expected_away_corners).toFixed(2)} · Total: ${Number(data.expected_total_corners).toFixed(2)}</p>
  <p>Data Quality: ${escapeHtml(data.data_quality_score)}/100 (${escapeHtml(data.data_quality_status)}) · Confidence: ${escapeHtml(data.model_confidence)}/100</p>
  <p>Distribution: ${escapeHtml(data.distribution)} · Model: ${escapeHtml(data.model_version)} · Config: ${escapeHtml(String(data.config_hash).slice(0,12))}</p></section>
  <section><h2>Probabilities</h2><table><thead><tr><th>Line</th><th>Over</th><th>Under</th></tr></thead><tbody>${probabilityRows}</tbody></table></section>
  <section><h2>Profiles, baseline ve hesaplama</h2><pre>${escapeHtml(JSON.stringify(data.calculation_details, null, 2))}</pre></section></body></html>`;
}
