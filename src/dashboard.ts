type DashboardData = { matches: Array<Record<string, unknown>>; providers: Array<Record<string, unknown>>;
  qualification?: Array<Record<string, unknown>>; cornerAnalyses?: Array<Record<string, unknown>>;
  datasetAudit?: Record<string, unknown> | null; validation?: Record<string, unknown> | null;
  backfill?: Array<Record<string, unknown>>; odds?: Array<Record<string, unknown>>;
  oddsAnalyses?: Array<Record<string, unknown>> };
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

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDate(value: unknown, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', ...options });
}

function renderEmpty(icon: string, title: string, description: string): string {
  return `<div class="empty"><span class="empty-icon" aria-hidden="true">${escapeHtml(icon)}</span>
    <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p></div></div>`;
}

function shell(content: string, title = 'BETAPP — Canlı Futbol Veri Merkezi'): string {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#07100c"><meta http-equiv="refresh" content="60"><title>${escapeHtml(title)}</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%230b1811'/%3E%3Cpath d='M17 16h18c9 0 14 4 14 11 0 4-2 7-6 9 5 1 8 5 8 10 0 8-6 12-16 12H17V16zm11 9v8h7c3 0 5-1 5-4s-2-4-5-4h-7zm0 17v8h8c4 0 6-1 6-4s-2-4-6-4h-8z' fill='%237cf6a3'/%3E%3C/svg%3E">
  <style>
  :root{color-scheme:dark;--bg:#07100c;--panel:#0d1812;--panel-2:#111f17;--line:#21352a;--line-soft:#17281f;--green:#7cf6a3;--green-2:#33d17a;--amber:#ffc857;--red:#ff7070;--text:#effaf2;--muted:#8fa297;--shadow:0 22px 70px rgba(0,0,0,.26)}
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body:before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(circle at 72% -10%,rgba(60,226,120,.13),transparent 32%),radial-gradient(circle at 0 25%,rgba(75,132,255,.07),transparent 26%);z-index:-1}
  a{color:inherit;text-decoration:none}button{font:inherit}.wrap{width:min(1380px,calc(100% - 40px));margin:auto}.topbar{position:sticky;top:0;z-index:20;background:rgba(7,16,12,.88);backdrop-filter:blur(18px);border-bottom:1px solid rgba(73,104,86,.36)}.topbar-inner{height:70px;display:flex;align-items:center;justify-content:space-between;gap:24px}.brand{display:flex;align-items:center;gap:11px;font-weight:900;letter-spacing:-.04em}.brand-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:var(--green);color:#06110a;box-shadow:0 0 0 5px rgba(124,246,163,.08)}.brand small{display:block;color:var(--muted);font-size:.68rem;font-weight:650;letter-spacing:.11em;text-transform:uppercase}.nav{display:flex;gap:6px;color:var(--muted);font-size:.88rem}.nav a{padding:9px 12px;border-radius:9px}.nav a:hover{background:var(--panel-2);color:var(--text)}
  main{padding:34px 0 70px}.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:30px;margin-bottom:24px}.eyebrow{margin:0 0 7px;color:var(--green);font-size:.76rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.hero h1{margin:0;font-size:clamp(2rem,4vw,4rem);line-height:1;letter-spacing:-.065em}.hero-copy{max-width:650px;margin:13px 0 0;color:var(--muted)}.live-pill{display:flex;align-items:center;gap:9px;flex:0 0 auto;border:1px solid var(--line);border-radius:999px;background:rgba(17,31,23,.74);padding:10px 14px;color:var(--muted);font-size:.84rem}.live-dot{width:9px;height:9px;border-radius:50%;background:var(--green-2);box-shadow:0 0 0 6px rgba(51,209,122,.11)}.live-dot.wait{background:var(--amber);box-shadow:0 0 0 6px rgba(255,200,87,.1)}
  .metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.metric{position:relative;overflow:hidden;min-height:126px;padding:18px;border:1px solid var(--line);border-radius:16px;background:linear-gradient(145deg,rgba(17,31,23,.98),rgba(10,20,14,.98));box-shadow:var(--shadow)}.metric:after{content:"";position:absolute;width:76px;height:76px;border-radius:50%;right:-28px;top:-30px;background:rgba(124,246,163,.06)}.metric-label{color:var(--muted);font-size:.76rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.metric-value{display:block;margin-top:9px;font-size:2.15rem;font-weight:900;line-height:1;letter-spacing:-.06em}.metric-note{display:block;margin-top:8px;color:var(--muted);font-size:.78rem}
  .notice{display:flex;align-items:flex-start;gap:13px;margin:0 0 16px;padding:14px 16px;border:1px solid rgba(255,200,87,.23);border-radius:14px;background:rgba(255,200,87,.055)}.notice-mark{color:var(--amber);font-weight:900}.notice strong{display:block}.notice p{margin:2px 0 0;color:var(--muted);font-size:.86rem}
  .workspace{display:grid;grid-template-columns:minmax(0,1.02fr) minmax(0,1.45fr);gap:16px}.panel{min-width:0;border:1px solid var(--line);border-radius:18px;background:rgba(13,24,18,.93);box-shadow:var(--shadow)}.panel-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;border-bottom:1px solid var(--line-soft)}.panel-head h2{margin:0;font-size:1rem;letter-spacing:-.02em}.count{padding:4px 9px;border-radius:999px;background:#182b20;color:var(--green);font-size:.76rem;font-weight:800}.panel-body{padding:10px}.match-list{display:grid;gap:8px}.match{display:grid;grid-template-columns:76px minmax(0,1fr) auto;align-items:center;gap:14px;padding:13px 12px;border:1px solid transparent;border-radius:12px}.match:hover{background:var(--panel-2);border-color:var(--line)}.match-time{font-weight:850;font-variant-numeric:tabular-nums}.match-time small,.teams small{display:block;color:var(--muted);font-size:.72rem;font-weight:600}.teams{min-width:0;font-weight:750}.teams span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{padding:5px 9px;border-radius:8px;background:#17271e;color:var(--muted);font-size:.71rem;font-weight:800;text-transform:uppercase}.status.live{background:rgba(255,112,112,.12);color:var(--red)}
  .odds-list{display:grid;gap:7px}.odd{display:grid;grid-template-columns:minmax(170px,1.45fr) minmax(120px,1fr) 75px 84px;align-items:center;gap:12px;padding:12px;border:1px solid transparent;border-radius:12px}.odd:hover{background:var(--panel-2);border-color:var(--line)}.odd-match{min-width:0;font-weight:750}.odd-match span,.odd-market span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.odd-match small,.odd-market small{display:block;color:var(--muted);font-size:.72rem}.price{display:inline-flex;justify-content:center;min-width:64px;padding:8px 10px;border-radius:9px;background:var(--green);color:#07100c;font-weight:950;font-variant-numeric:tabular-nums}.movement{font-size:.78rem;font-weight:800;text-align:right}.movement.up{color:var(--green)}.movement.down{color:var(--red)}.movement.flat{color:var(--muted)}
  .empty{display:flex;align-items:center;gap:15px;min-height:185px;padding:25px;color:var(--muted)}.empty-icon{display:grid;place-items:center;flex:0 0 auto;width:48px;height:48px;border:1px solid var(--line);border-radius:14px;background:var(--panel-2);color:var(--green);font-size:1.2rem}.empty strong{color:var(--text)}.empty p{max-width:410px;margin:4px 0 0;font-size:.86rem}
  .section{margin-top:16px}.section-title{display:flex;align-items:center;justify-content:space-between;margin:28px 0 12px}.section-title h2{margin:0;font-size:1.15rem;letter-spacing:-.025em}.section-title p{margin:0;color:var(--muted);font-size:.82rem}.source-grid,.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(225px,1fr));gap:10px}.source,.card{padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}.source-top,.row{display:flex;align-items:center;justify-content:space-between;gap:12px}.source-name{font-weight:850;text-transform:capitalize}.source p,.card p{margin:9px 0 0;color:var(--muted);font-size:.82rem}.badge{display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:.69rem;font-weight:850;text-transform:uppercase}.ok{background:rgba(51,209,122,.12);color:var(--green)}.partial{background:rgba(255,200,87,.12);color:var(--amber)}.bad{background:rgba(255,112,112,.11);color:#ff9494}.neutral{background:#1a2a21;color:var(--muted)}
  details{margin-top:12px;border:1px solid var(--line);border-radius:14px;background:rgba(13,24,18,.78)}summary{cursor:pointer;list-style:none;padding:16px 18px;font-weight:800}summary::-webkit-details-marker{display:none}summary:after{content:"+";float:right;color:var(--green)}details[open] summary:after{content:"−"}.details-body{padding:0 14px 14px}.scroll{overflow:auto;border:1px solid var(--line-soft);border-radius:12px}table{width:100%;border-collapse:collapse;background:var(--panel);font-size:.82rem}th,td{padding:12px 13px;border-bottom:1px solid var(--line-soft);text-align:left;vertical-align:top;white-space:nowrap}th{color:var(--muted);font-size:.67rem;letter-spacing:.07em;text-transform:uppercase}tr:last-child td{border-bottom:0}code{color:var(--green)}.footer{display:flex;justify-content:space-between;gap:20px;margin-top:34px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:.76rem}.footer a{color:var(--green)}
  @media(max-width:980px){.metrics{grid-template-columns:repeat(2,1fr)}.workspace{grid-template-columns:1fr}.nav{display:none}}
  @media(max-width:620px){.wrap{width:min(100% - 24px,1380px)}.topbar-inner{height:62px}.hero{align-items:flex-start;flex-direction:column;margin-bottom:18px}.hero-copy{font-size:.9rem}.live-pill{padding:8px 11px}.metrics{gap:8px;margin:18px 0}.metric{min-height:105px;padding:14px}.metric-value{font-size:1.7rem}.workspace{gap:10px}.panel-head{padding:15px}.panel-body{padding:7px}.match{grid-template-columns:61px minmax(0,1fr);gap:10px}.match .status{display:none}.odd{grid-template-columns:minmax(0,1fr) 68px}.odd-market,.movement{display:none}.source-grid{grid-template-columns:1fr}.section-title{align-items:flex-start;flex-direction:column;gap:2px}.footer{flex-direction:column}}
  </style></head><body>${content}</body></html>`;
}

export function renderDashboard(data: DashboardData): string {
  const audit = (data.datasetAudit?.report ?? null) as DatasetAuditView | null;
  const validation = (data.validation?.report ?? null) as ValidationView | null;
  const matches = data.matches ?? [];
  const odds = data.odds ?? [];
  const analyses = data.cornerAnalyses ?? [];
  const oddsAnalyses = data.oddsAnalyses ?? [];
  const healthyProviders = data.providers.filter((provider) => provider.status === 'healthy').length;
  const percent = (value: unknown) => `${(finiteNumber(value) * 100).toFixed(1)}%`;
  const sources = data.providers.length ? data.providers : [
    { provider: 'fotmob', status: 'waiting', message: 'Fikstür ve maç verisi bekleniyor' },
    { provider: 'nowgoal', status: 'waiting', message: 'Pre-match oran akışı bekleniyor' },
  ];
  const statusText = healthyProviders > 0 ? `${healthyProviders} kaynak aktif` : 'Sistem hazır · veri bekleniyor';

  const matchCards = matches.length ? matches.map((match) => {
    const status = String(match.status ?? 'scheduled');
    return `<article class="match"><div class="match-time">${escapeHtml(formatDate(match.kickoff_at, { hour: '2-digit', minute: '2-digit' }))}<small>${escapeHtml(formatDate(match.kickoff_at, { day: '2-digit', month: 'short' }))}</small></div>
      <div class="teams"><span>${escapeHtml(match.home_team)} — ${escapeHtml(match.away_team)}</span><small>${escapeHtml(match.league)}</small></div>
      <span class="status ${status === 'live' ? 'live' : ''}">${escapeHtml(status)}</span></article>`;
  }).join('') : renderEmpty('⌁', 'Henüz maç verisi yok', 'Collector ilk senkronizasyonunu tamamladığında bugünün desteklenen lig maçları burada görünecek.');

  const oddsRows = odds.length ? odds.slice(0, 80).map((odd) => {
    const movement = finiteNumber(odd.movement_percent);
    const movementClass = movement > 0 ? 'up' : movement < 0 ? 'down' : 'flat';
    const movementLabel = `${movement > 0 ? '+' : ''}${movement.toFixed(2)}%`;
    return `<article class="odd"><div class="odd-match"><span>${escapeHtml(odd.home_team)} — ${escapeHtml(odd.away_team)}</span><small>${escapeHtml(formatDate(odd.kickoff_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))} · ${escapeHtml(String(odd.provider).replace('nowgoal:', ''))}</small></div>
      <div class="odd-market"><span>${escapeHtml(odd.selection)}</span><small>${escapeHtml(odd.market_name)}${odd.line == null ? '' : ` · ${escapeHtml(odd.line)}`}</small></div>
      <span class="price">${finiteNumber(odd.current_odds).toFixed(2)}</span><span class="movement ${movementClass}">${escapeHtml(movementLabel)}</span></article>`;
  }).join('') : renderEmpty('↗', 'Nowgoal oranları bekleniyor', 'Maçlar FotMob ile eşleştikten sonra 1X2, Asya handikapı, gol ve korner oranları burada listelenecek.');

  const providerCards = sources.map((provider) => {
    const status = String(provider.status ?? 'unknown');
    const badgeClass = status === 'healthy' ? 'ok' : status === 'degraded' ? 'partial' : 'neutral';
    const label = status === 'waiting' ? 'bekliyor' : status;
    return `<article class="source"><div class="source-top"><span class="source-name">${escapeHtml(provider.provider)}</span><span class="badge ${badgeClass}">${escapeHtml(label)}</span></div>
      <p>${escapeHtml(provider.message ?? (provider.last_fetch_at ? `Son veri: ${provider.last_fetch_at}` : 'Henüz veri alınmadı'))}</p></article>`;
  }).join('');

  const capabilities = [...new Set((data.qualification ?? []).map((item) => String(item.capability)))];
  const qualificationProviders = [...new Set((data.qualification ?? []).map((item) => String(item.provider)))];
  const matrix = qualificationProviders.length ? `<div class="scroll"><table><thead><tr><th>Provider</th>${capabilities.map((capability) => `<th>${escapeHtml(capability)}</th>`).join('')}</tr></thead><tbody>${qualificationProviders.map((provider) => `<tr><td><strong>${escapeHtml(provider)}</strong></td>${capabilities.map((capability) => { const item = (data.qualification ?? []).find((entry) => entry.provider === provider && entry.capability === capability); const result = item?.result ?? 'NOT_TESTED'; return `<td><span class="badge ${result === 'SUPPORTED' ? 'ok' : result === 'PARTIAL' ? 'partial' : 'bad'}">${escapeHtml(result)}</span></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>` : renderEmpty('✓', 'Qualification henüz çalışmadı', 'Kaynak yetenek testleri tamamlandığında destek matrisi burada oluşacak.');
  const cornerRows = analyses.length ? analyses.map((analysis) => {
    const probabilities = analysis.probabilities as Record<string, { over?: number }> | undefined;
    const probability = (line: string) => probabilities?.[line]?.over == null ? '—' : `${(probabilities[line]!.over! * 100).toFixed(1)}%`;
    return `<tr><td><a href="/matches/${escapeHtml(analysis.match_id)}/corners"><strong>${escapeHtml(analysis.home_team)} — ${escapeHtml(analysis.away_team)}</strong></a></td>
      <td>${finiteNumber(analysis.expected_total_corners).toFixed(2)}</td><td>${probability('8.5')}</td><td>${probability('9.5')}</td><td>${probability('10.5')}</td><td>${escapeHtml(analysis.data_quality_score)}/100</td><td>${escapeHtml(analysis.model_confidence)}/100</td></tr>`;
  }).join('') : '<tr><td colspan="7">Henüz corner analizi yok.</td></tr>';
  const oddsAnalysisCards = oddsAnalyses.length ? oddsAnalyses.flatMap((analysis) => {
    const items = Array.isArray(analysis.items) ? analysis.items as Array<Record<string, unknown>> : [];
    return items.slice(0, 6).map((item) => {
      const reasons = Array.isArray(item.reasons) ? item.reasons : [];
      const warnings = Array.isArray(item.warnings) ? item.warnings : [];
      const fair = (value: unknown) => `${(finiteNumber(value) * 100).toFixed(1)}%`;
      return `<article class="card"><div class="row"><strong>${escapeHtml(analysis.home_team)} — ${escapeHtml(analysis.away_team)}</strong>
        <span class="badge ${item.analysis_eligible ? 'ok' : 'partial'}">${item.analysis_eligible ? 'uygun' : 'sınırlı'}</span></div>
        <p>${escapeHtml(analysis.league)} · ${escapeHtml(formatDate(analysis.kickoff_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))}</p>
        <p><strong>${escapeHtml(item.market_type)} ${item.line == null ? '' : escapeHtml(item.line)} · ${escapeHtml(item.selection)}</strong></p>
        <p>Açılış → Güncel: ${escapeHtml(item.opening_odds)} → ${escapeHtml(item.current_odds)}</p>
        <p>Piyasa Olasılığı: ${fair(item.opening_fair_probability)} → ${fair(item.current_fair_probability)}
          (${finiteNumber(item.probability_delta_pp) >= 0 ? '+' : ''}${finiteNumber(item.probability_delta_pp).toFixed(2)} pp)</p>
        <p>Oran hareketi: ${escapeHtml(item.movement_class)} · Skor ${escapeHtml(item.score)}/100</p>
        <p>Bookmaker Teyidi: ${escapeHtml(item.agreeing_bookmaker_count)}/${escapeHtml(item.bookmaker_count)} · Veri kalitesi:
          ${escapeHtml(item.data_quality_score)}/100 (${escapeHtml(item.data_quality_grade)}) · Model güveni:
          ${escapeHtml(item.confidence_score)}/100 (${escapeHtml(item.confidence_grade)})</p>
        ${reasons.length ? `<p>${reasons.slice(0, 2).map(escapeHtml).join(' · ')}</p>` : ''}
        ${warnings.length ? `<p style="color:var(--amber)">${warnings.map(escapeHtml).join(' · ')}</p>` : ''}</article>`;
    });
  }).join('') : renderEmpty('∿', 'Henüz oran analizi yok', 'Yeni Nowgoal snapshot değişimleri kaydedildiğinde ODDS_V1 analizi burada görünecek.');
  const backfillRows = (data.backfill ?? []).length ? (data.backfill ?? []).map((run) => `<tr><td>${escapeHtml(run.competition_name)}</td><td>${escapeHtml(run.season)}</td><td>${escapeHtml(run.status)}</td><td>${escapeHtml(run.fixtures_discovered)}</td><td>${escapeHtml(run.matches_stored)}</td><td>${escapeHtml(run.corner_complete)}</td><td>${escapeHtml(run.partial)}</td><td>${escapeHtml(run.failed)}</td><td>${escapeHtml(run.retries)}</td></tr>`).join('') : '<tr><td colspan="9">Henüz backfill çalıştırılmadı.</td></tr>';
  const datasetHealth = audit ? `<div class="grid"><article class="card"><strong>Geçmiş maç</strong><p>${escapeHtml(audit.totalMatches)}</p></article><article class="card"><strong>Korner kapsaması</strong><p>${percent(audit.cornerCoverage?.complete?.rate)}</p></article><article class="card"><strong>Lig</strong><p>${escapeHtml(audit.perCompetition?.length ?? 0)}</p></article><article class="card"><strong>Sezon</strong><p>${escapeHtml(audit.perSeason?.length ?? 0)}</p></article></div>` : renderEmpty('◫', 'Dataset henüz hazır değil', 'Historical backfill ve audit tamamlandığında kalite özeti burada görünecek.');
  const calibrationRows = validation ? Object.entries(validation.calibration ?? {}).map(([bucket, item]) => `<tr><td>${escapeHtml(bucket)}</td><td>${escapeHtml(item.count)}</td><td>${percent(item.averagePredictedProbability)}</td><td>${percent(item.actualHitRate)}</td><td>${percent(item.absoluteCalibrationError)}</td></tr>`).join('') : '';
  const modelValidation = validation ? `<div class="grid"><article class="card"><strong>MAE</strong><p>${finiteNumber(validation.mae).toFixed(3)}</p></article><article class="card"><strong>RMSE</strong><p>${finiteNumber(validation.rmse).toFixed(3)}</p></article><article class="card"><strong>Brier</strong><p>${finiteNumber(validation.brier).toFixed(4)}</p></article><article class="card"><strong>Log loss</strong><p>${finiteNumber(validation.logLoss).toFixed(4)}</p></article></div><div class="scroll" style="margin-top:10px"><table><thead><tr><th>Bucket</th><th>Count</th><th>Predicted</th><th>Actual</th><th>Abs. error</th></tr></thead><tbody>${calibrationRows}</tbody></table></div>` : renderEmpty('∿', 'Backtest sonucu yok', 'Model doğrulaması çalıştırıldığında hata ve kalibrasyon metrikleri burada gösterilecek.');
  const waitingNotice = matches.length || odds.length ? '' : `<div class="notice"><span class="notice-mark">i</span><div><strong>İlk veri senkronizasyonu bekleniyor</strong><p>Uygulama ve veritabanı hazır. Collector devreye girdiğinde bu ekran otomatik olarak 60 saniyede bir yenilenir.</p></div></div>`;

  return shell(`<header class="topbar"><div class="wrap topbar-inner"><a class="brand" href="/"><span class="brand-mark">B</span><span>BETAPP<small>Data Terminal</small></span></a><nav class="nav" aria-label="Ana menü"><a href="#matches">Maçlar</a><a href="#odds">Oranlar</a><a href="#sources">Kaynaklar</a><a href="#system">Sistem</a></nav><a class="live-pill" href="/health"><span class="live-dot ${healthyProviders ? '' : 'wait'}"></span>${escapeHtml(statusText)}</a></div></header>
    <main class="wrap"><section class="hero"><div><p class="eyebrow">Canlı futbol veri merkezi</p><h1>Maçlar, oranlar,<br>tek ekranda.</h1><p class="hero-copy">Dokuz elit turnuvadaki fikstürleri, Nowgoal pre-match oranlarını ve korner analizlerini İstanbul saatine göre takip edin.</p></div></section>
    <section class="metrics" aria-label="Özet"><article class="metric"><span class="metric-label">Bugünkü maç</span><strong class="metric-value">${matches.length}</strong><span class="metric-note">Desteklenen ligler</span></article><article class="metric"><span class="metric-label">Canlı oran</span><strong class="metric-value">${odds.length}</strong><span class="metric-note">Eşleşmiş seçim</span></article><article class="metric"><span class="metric-label">Aktif kaynak</span><strong class="metric-value">${healthyProviders}</strong><span class="metric-note">FotMob + Nowgoal</span></article><article class="metric"><span class="metric-label">Korner analizi</span><strong class="metric-value">${analyses.length}</strong><span class="metric-note">Yaklaşan maçlar</span></article></section>
    ${waitingNotice}<section class="workspace"><article class="panel" id="matches"><div class="panel-head"><h2>Bugünün maçları</h2><span class="count">${matches.length}</span></div><div class="panel-body match-list">${matchCards}</div></article><article class="panel" id="odds"><div class="panel-head"><h2>Nowgoal oran panosu</h2><span class="count">${odds.length}</span></div><div class="panel-body odds-list">${oddsRows}</div></article></section>
    <section class="section" id="odds-analysis"><div class="section-title"><h2>ORAN ANALİZİ V1</h2><p>Deterministik piyasa hareketi · bahis önerisi değildir</p></div><div class="grid">${oddsAnalysisCards}</div></section>
    <section class="section" id="sources"><div class="section-title"><h2>Veri kaynakları</h2><p>Sağlık ve son senkronizasyon durumu</p></div><div class="source-grid">${providerCards}</div></section>
    <section class="section" id="system"><div class="section-title"><h2>Analiz ve sistem</h2><p>İleri seviye veri panelleri</p></div><details><summary>Provider qualification matrisi</summary><div class="details-body">${matrix}</div></details><details><summary>Dataset sağlığı ve backfill</summary><div class="details-body">${datasetHealth}<div class="scroll" style="margin-top:10px"><table><thead><tr><th>Lig</th><th>Sezon</th><th>Durum</th><th>Bulunan</th><th>Kaydedilen</th><th>Tam</th><th>Kısmi</th><th>Hata</th><th>Retry</th></tr></thead><tbody>${backfillRows}</tbody></table></div></div></details><details><summary>Korner modeli ve doğrulama</summary><div class="details-body">${modelValidation}<div class="scroll" style="margin-top:10px"><table><thead><tr><th>Maç</th><th>Beklenen</th><th>O8.5</th><th>O9.5</th><th>O10.5</th><th>Veri kalitesi</th><th>Güven</th></tr></thead><tbody>${cornerRows}</tbody></table></div></div></details></section>
    <footer class="footer"><span>BETAPP V2 · Europe/Istanbul · Otomatik yenileme 60 sn</span><span><a href="/health">Sistem sağlığı</a> · <a href="/api/odds/upcoming">Odds API</a></span></footer></main>`);
}

export function renderCornerDetail(data: Record<string, unknown>): string {
  const probabilities = (data.probabilities ?? {}) as Record<string, { over: number; under: number }>;
  const probabilityRows = Object.entries(probabilities).map(([line, value]) => `<tr><td>${escapeHtml(line)}</td><td>${(value.over * 100).toFixed(1)}%</td><td>${(value.under * 100).toFixed(1)}%</td></tr>`).join('');
  return shell(`<main class="wrap"><div style="padding:28px 0"><a href="/" style="color:var(--green)">← Ana panele dön</a><section class="hero" style="margin-top:34px"><div><p class="eyebrow">Korner analizi</p><h1>${escapeHtml(data.home_team)}<br>— ${escapeHtml(data.away_team)}</h1><p class="hero-copy">${escapeHtml(formatDate(data.kickoff_at, { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }))} · ${escapeHtml(data.competition)}</p></div></section><section class="metrics"><article class="metric"><span class="metric-label">Ev</span><strong class="metric-value">${finiteNumber(data.expected_home_corners).toFixed(2)}</strong></article><article class="metric"><span class="metric-label">Deplasman</span><strong class="metric-value">${finiteNumber(data.expected_away_corners).toFixed(2)}</strong></article><article class="metric"><span class="metric-label">Toplam</span><strong class="metric-value">${finiteNumber(data.expected_total_corners).toFixed(2)}</strong></article><article class="metric"><span class="metric-label">Model güveni</span><strong class="metric-value">${escapeHtml(data.model_confidence)}</strong><span class="metric-note">100 üzerinden</span></article></section><section class="panel"><div class="panel-head"><h2>Olasılıklar</h2><span class="badge ok">${escapeHtml(data.distribution)}</span></div><div class="panel-body"><div class="scroll"><table><thead><tr><th>Çizgi</th><th>Üst</th><th>Alt</th></tr></thead><tbody>${probabilityRows}</tbody></table></div></div></section><details><summary>Hesaplama ayrıntıları</summary><div class="details-body"><pre style="white-space:pre-wrap;overflow:auto;color:var(--muted)">${escapeHtml(JSON.stringify(data.calculation_details, null, 2))}</pre></div></details></div></main>`, `${escapeHtml(data.home_team)} — ${escapeHtml(data.away_team)} | Korner Analizi`);
}
