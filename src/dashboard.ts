type DashboardData = { matches: Array<Record<string, unknown>>; providers: Array<Record<string, unknown>>;
  qualification?: Array<Record<string, unknown>>; cornerAnalyses?: Array<Record<string, unknown>>;
  datasetAudit?: Record<string, unknown> | null; validation?: Record<string, unknown> | null;
  backfill?: Array<Record<string, unknown>>; odds?: Array<Record<string, unknown>>;
  oddsAnalyses?: Array<Record<string, unknown>>; predictions?: Array<Record<string, unknown>>;
  predictionPreviews?: Array<Record<string, unknown>>; predictionHistory?: Array<Record<string, unknown>>;
  predictionPerformance?: Record<string, unknown> | null; predictionSelfAudit?: Record<string, unknown> | null;
  predictionSelfAuditSegments?: Array<Record<string, unknown>>;
  predictionSelfAuditRootCauses?: Array<Record<string, unknown>>;
  predictionAdaptiveRuleProposals?: Array<Record<string, unknown>> };
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

function shell(content: string, title = 'BETAPP — Futbol Analiz Terminali'): string {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#07110d"><meta http-equiv="refresh" content="60"><title>${escapeHtml(title)}</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%230b1811'/%3E%3Cpath d='M17 16h18c9 0 14 4 14 11 0 4-2 7-6 9 5 1 8 5 8 10 0 8-6 12-16 12H17V16zm11 9v8h7c3 0 5-1 5-4s-2-4-5-4h-7zm0 17v8h8c4 0 6-1 6-4s-2-4-6-4h-8z' fill='%237cf6a3'/%3E%3C/svg%3E">
  <style>
  :root{color-scheme:dark;--bg:#07110d;--sidebar:#09150f;--panel:#0d1b14;--panel-2:#11231a;--panel-3:#15291f;--line:#20382a;--line-soft:#17291f;--green:#74f59c;--green-2:#31d878;--blue:#75a7ff;--amber:#ffc95c;--red:#ff7373;--text:#f1fbf4;--muted:#91a69a;--muted-2:#667c70;--shadow:0 18px 54px rgba(0,0,0,.22);--sidebar-w:238px}
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body:before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(circle at 72% -15%,rgba(50,216,120,.10),transparent 35%),radial-gradient(circle at 20% 90%,rgba(70,120,255,.055),transparent 30%)}
  a{color:inherit;text-decoration:none}button,input{font:inherit}.app-shell{min-height:100vh}.sidebar{position:fixed;inset:0 auto 0 0;width:var(--sidebar-w);padding:18px 14px;border-right:1px solid var(--line-soft);background:rgba(9,21,15,.96);backdrop-filter:blur(22px);z-index:30}.brand{display:flex;align-items:center;gap:11px;padding:7px 8px 20px;font-weight:950;letter-spacing:-.04em}.brand-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:linear-gradient(145deg,var(--green),#47df82);color:#051108;box-shadow:0 0 0 6px rgba(116,245,156,.07)}.brand small{display:block;color:var(--muted);font-size:.63rem;font-weight:750;letter-spacing:.13em;text-transform:uppercase}.side-group{margin-top:14px}.side-label{padding:0 10px 7px;color:var(--muted-2);font-size:.66rem;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.side-nav{display:grid;gap:4px}.side-nav a{display:flex;align-items:center;gap:10px;padding:10px 11px;border-radius:10px;color:var(--muted);font-size:.86rem;font-weight:700;transition:.18s}.side-nav a:hover,.side-nav a.active{background:var(--panel-2);color:var(--text)}.side-nav .nav-icon{width:20px;text-align:center;color:var(--green)}.sidebar-foot{position:absolute;left:14px;right:14px;bottom:18px}.system-pill{display:flex;align-items:center;gap:10px;padding:11px;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--muted);font-size:.78rem}.live-dot{width:8px;height:8px;border-radius:50%;background:var(--green-2);box-shadow:0 0 0 5px rgba(49,216,120,.10)}.live-dot.wait{background:var(--amber);box-shadow:0 0 0 5px rgba(255,201,92,.09)}
  .app-main{margin-left:var(--sidebar-w);min-width:0}.topbar{position:sticky;top:0;z-index:22;height:66px;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:0 28px;border-bottom:1px solid rgba(32,56,42,.72);background:rgba(7,17,13,.88);backdrop-filter:blur(18px)}.top-title strong{display:block;font-size:.96rem}.top-title span{color:var(--muted);font-size:.72rem}.search{position:relative;width:min(430px,42vw)}.search input{width:100%;height:38px;padding:0 14px 0 36px;border:1px solid var(--line);border-radius:11px;outline:none;background:var(--panel);color:var(--text)}.search input:focus{border-color:rgba(116,245,156,.55);box-shadow:0 0 0 3px rgba(116,245,156,.07)}.search:before{content:"⌕";position:absolute;left:13px;top:8px;color:var(--muted)}.top-actions{display:flex;align-items:center;gap:8px}.top-chip{padding:7px 10px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--muted);font-size:.74rem;font-weight:750}.mobile-menu{display:none}
  .content{width:min(1500px,calc(100% - 44px));margin:auto;padding:26px 0 64px}.command-hero{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,.7fr);gap:16px;margin-bottom:16px}.hero-main,.hero-status{border:1px solid var(--line);border-radius:20px;background:linear-gradient(145deg,rgba(17,35,26,.98),rgba(10,22,16,.98));box-shadow:var(--shadow)}.hero-main{position:relative;overflow:hidden;padding:25px}.hero-main:after{content:"";position:absolute;right:-60px;top:-90px;width:220px;height:220px;border-radius:50%;background:rgba(116,245,156,.055)}.eyebrow{margin:0 0 7px;color:var(--green);font-size:.69rem;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.hero-main h1{margin:0;font-size:clamp(1.8rem,3.2vw,3.1rem);line-height:1.03;letter-spacing:-.055em}.hero-copy{max-width:720px;margin:11px 0 0;color:var(--muted);font-size:.88rem}.hero-status{padding:20px}.hero-status-head{display:flex;align-items:center;justify-content:space-between}.hero-status strong{font-size:.86rem}.hero-status-list{display:grid;gap:9px;margin-top:16px}.health-row{display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--muted);font-size:.78rem}.health-row b{color:var(--text);font-weight:800}
  .metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:16px 0}.metric{min-height:112px;padding:16px;border:1px solid var(--line);border-radius:15px;background:var(--panel);box-shadow:var(--shadow)}.metric-label{color:var(--muted);font-size:.67rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.metric-value{display:block;margin-top:9px;font-size:1.8rem;font-weight:950;line-height:1;letter-spacing:-.05em}.metric-note{display:block;margin-top:7px;color:var(--muted-2);font-size:.7rem}.metric.alert .metric-value{color:var(--amber)}.metric.danger .metric-value{color:var(--red)}
  .notice{display:flex;gap:12px;padding:13px 15px;margin:12px 0;border:1px solid rgba(255,201,92,.22);border-radius:13px;background:rgba(255,201,92,.055)}.notice-mark{color:var(--amber);font-weight:900}.notice strong{display:block}.notice p{margin:2px 0 0;color:var(--muted);font-size:.8rem}.section{scroll-margin-top:84px;margin-top:18px}.section-title{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin:26px 0 10px}.section-title h2{margin:0;font-size:1.05rem;letter-spacing:-.02em}.section-title p{margin:3px 0 0;color:var(--muted);font-size:.76rem}.section-kicker{color:var(--green);font-size:.63rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
  .workspace{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.35fr);gap:12px}.panel{min-width:0;border:1px solid var(--line);border-radius:17px;background:var(--panel);box-shadow:var(--shadow);overflow:hidden}.panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 17px;border-bottom:1px solid var(--line-soft)}.panel-head h3,.panel-head h2{margin:0;font-size:.9rem}.panel-body{padding:8px}.count{padding:4px 8px;border-radius:999px;background:rgba(116,245,156,.09);color:var(--green);font-size:.68rem;font-weight:850}.match-list,.odds-list{display:grid;gap:4px}.match{display:grid;grid-template-columns:60px minmax(0,1fr) auto;align-items:center;gap:12px;padding:11px;border:1px solid transparent;border-radius:11px;transition:.16s}.match:hover,.odd:hover{background:var(--panel-2);border-color:var(--line)}.match-time{font-size:.9rem;font-weight:900;font-variant-numeric:tabular-nums}.match-time small,.teams small{display:block;color:var(--muted);font-size:.67rem;font-weight:650}.teams{min-width:0;font-weight:780}.teams span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{padding:4px 7px;border-radius:7px;background:#17291f;color:var(--muted);font-size:.64rem;font-weight:850;text-transform:uppercase}.status.live{background:rgba(255,115,115,.12);color:var(--red)}.odd{display:grid;grid-template-columns:minmax(175px,1.45fr) minmax(120px,.9fr) 66px 72px;align-items:center;gap:10px;padding:10px;border:1px solid transparent;border-radius:11px}.odd-match,.odd-market{min-width:0}.odd-match{font-weight:760}.odd-match span,.odd-market span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.odd-match small,.odd-market small{display:block;color:var(--muted);font-size:.66rem}.price{display:inline-flex;justify-content:center;padding:7px 8px;border-radius:8px;background:var(--green);color:#07110d;font-weight:950;font-variant-numeric:tabular-nums}.movement{font-size:.72rem;font-weight:850;text-align:right}.movement.up{color:var(--green)}.movement.down{color:var(--red)}.movement.flat{color:var(--muted)}
  .grid,.source-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:10px}.card,.source{padding:15px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}.card:hover{border-color:#31503c}.row,.source-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.card p,.source p{margin:8px 0 0;color:var(--muted);font-size:.76rem}.source-name{font-weight:850;text-transform:capitalize}.badge{display:inline-flex;align-items:center;padding:4px 7px;border-radius:999px;font-size:.62rem;font-weight:900;text-transform:uppercase;white-space:nowrap}.ok{background:rgba(49,216,120,.11);color:var(--green)}.partial{background:rgba(255,201,92,.11);color:var(--amber)}.bad{background:rgba(255,115,115,.11);color:#ff9898}.neutral{background:#1a2d22;color:var(--muted)}
  .audit-overview{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:10px}.audit-mini{padding:14px;border:1px solid var(--line);border-radius:13px;background:var(--panel)}.audit-mini small{display:block;color:var(--muted);font-size:.65rem;font-weight:850;letter-spacing:.07em;text-transform:uppercase}.audit-mini strong{display:block;margin-top:6px;font-size:1.05rem}.audit-mini span{display:block;margin-top:4px;color:var(--muted-2);font-size:.69rem}
  details{margin-top:9px;border:1px solid var(--line);border-radius:13px;background:rgba(13,27,20,.82)}summary{cursor:pointer;list-style:none;padding:14px 16px;font-weight:800;font-size:.82rem}summary::-webkit-details-marker{display:none}summary:after{content:"+";float:right;color:var(--green)}details[open] summary:after{content:"−"}.details-body{padding:0 12px 12px}.scroll{overflow:auto;border:1px solid var(--line-soft);border-radius:11px}table{width:100%;border-collapse:collapse;background:var(--panel);font-size:.75rem}th,td{padding:10px 11px;border-bottom:1px solid var(--line-soft);text-align:left;vertical-align:top;white-space:nowrap}th{color:var(--muted);font-size:.61rem;letter-spacing:.07em;text-transform:uppercase}tr:last-child td{border-bottom:0}.empty{display:flex;align-items:center;gap:13px;min-height:155px;padding:20px;color:var(--muted)}.empty-icon{display:grid;place-items:center;flex:0 0 auto;width:44px;height:44px;border:1px solid var(--line);border-radius:12px;background:var(--panel-2);color:var(--green)}.empty strong{color:var(--text)}.empty p{max-width:420px;margin:3px 0 0;font-size:.78rem}
  .footer{display:flex;justify-content:space-between;gap:18px;margin-top:28px;padding:18px 0;border-top:1px solid var(--line);color:var(--muted-2);font-size:.7rem}.footer a{color:var(--green)}.hidden-by-search{display:none!important}
  @media(max-width:1180px){:root{--sidebar-w:205px}.metrics{grid-template-columns:repeat(3,1fr)}.command-hero{grid-template-columns:1fr}.audit-overview{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:860px){.sidebar{display:none}.app-main{margin-left:0}.mobile-menu{display:inline-flex}.topbar{padding:0 16px}.search{width:min(390px,58vw)}.content{width:min(100% - 26px,1500px)}.workspace{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:560px){.top-title{display:none}.top-actions .top-chip{display:none}.search{width:100%}.topbar{gap:10px}.content{width:min(100% - 18px,1500px);padding-top:16px}.hero-main,.hero-status{border-radius:15px}.hero-main{padding:19px}.metrics{gap:7px}.metric{min-height:95px;padding:12px}.metric-value{font-size:1.45rem}.audit-overview{grid-template-columns:1fr 1fr}.section-title{align-items:flex-start;flex-direction:column;gap:3px}.odd{grid-template-columns:minmax(0,1fr) 62px}.odd-market,.movement{display:none}.match{grid-template-columns:55px minmax(0,1fr)}.match .status{display:none}.grid,.source-grid{grid-template-columns:1fr}.footer{flex-direction:column}}
  </style></head><body>${content}
  <script>
  (()=>{const input=document.querySelector('[data-global-search]');if(!input)return;input.addEventListener('input',()=>{const q=input.value.trim().toLocaleLowerCase('tr-TR');document.querySelectorAll('[data-search-row]').forEach(el=>{const hit=!q||el.textContent.toLocaleLowerCase('tr-TR').includes(q);el.classList.toggle('hidden-by-search',!hit)})});const links=[...document.querySelectorAll('.side-nav a[href^="#"]')];const obs=new IntersectionObserver(entries=>{for(const e of entries){if(e.isIntersecting){links.forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+e.target.id))}}},{rootMargin:'-25% 0px -65% 0px'});document.querySelectorAll('main section[id]').forEach(s=>obs.observe(s));})();
  </script></body></html>`;
}
export function renderDashboard(data: DashboardData): string {
  const audit = (data.datasetAudit?.report ?? null) as DatasetAuditView | null;
  const validation = (data.validation?.report ?? null) as ValidationView | null;
  const matches = data.matches ?? [];
  const odds = data.odds ?? [];
  const analyses = data.cornerAnalyses ?? [];
  const oddsAnalyses = data.oddsAnalyses ?? [];
  const predictions = data.predictions ?? [];
  const predictionPreviews = data.predictionPreviews ?? [];
  const predictionHistory = data.predictionHistory ?? [];
  const predictionPerformance = data.predictionPerformance;
  const predictionSelfAudit = data.predictionSelfAudit;
  const predictionSelfAuditSegments = data.predictionSelfAuditSegments ?? [];
  const predictionSelfAuditRootCauses = data.predictionSelfAuditRootCauses ?? [];
  const predictionAdaptiveRuleProposals = data.predictionAdaptiveRuleProposals ?? [];
  const healthyProviders = data.providers.filter((provider) => provider.status === 'healthy').length;
  const percent = (value: unknown) => `${(finiteNumber(value) * 100).toFixed(1)}%`;
  const sources = data.providers.length ? data.providers : [
    { provider: 'fotmob', status: 'waiting', message: 'Fikstür ve maç verisi bekleniyor' },
    { provider: 'nowgoal', status: 'waiting', message: 'Pre-match oran akışı bekleniyor' },
  ];
  const statusText = healthyProviders > 0 ? `${healthyProviders} kaynak aktif` : 'Sistem hazır · veri bekleniyor';

  const matchCards = matches.length ? matches.map((match) => {
    const status = String(match.status ?? 'scheduled');
    const matchId = String(match.id ?? '');
    const matchOdds = odds.filter((odd) => String(odd.match_id ?? '') === matchId).length;
    const hasCorner = analyses.some((analysis) => String(analysis.match_id ?? '') === matchId);
    const officialPrediction = predictions.find((prediction) => String(prediction.match_id ?? '') === matchId);
    const previewPrediction = predictionPreviews.find((prediction) => String(prediction.match_id ?? '') === matchId);
    const prediction = officialPrediction ?? previewPrediction;
    const decision = prediction
      ? String(prediction.decision) === 'SKIP' ? 'GEÇ' : officialPrediction ? 'RESMİ' : 'ADAY'
      : '—';
    const actionHref = hasCorner && matchId ? `/matches/${encodeURIComponent(matchId)}/corners` : '#odds-analysis';
    return `<article class="match" data-search-row><div class="match-time">${escapeHtml(formatDate(match.kickoff_at, { hour: '2-digit', minute: '2-digit' }))}<small>${escapeHtml(formatDate(match.kickoff_at, { day: '2-digit', month: 'short' }))}</small></div>
      <div class="teams"><span>${escapeHtml(match.home_team)} — ${escapeHtml(match.away_team)}</span><small>${escapeHtml(match.league)} · Odds ${matchOdds} · Tahmin ${escapeHtml(decision)}</small></div>
      <div style="display:flex;align-items:center;gap:6px"><span class="status ${status === 'live' ? 'live' : ''}">${escapeHtml(status)}</span><a class="status" href="${escapeHtml(actionHref)}">${hasCorner ? 'DETAY' : 'ANALİZ'}</a></div></article>`;
  }).join('') : renderEmpty('⌁', 'Henüz maç verisi yok', 'Collector ilk senkronizasyonunu tamamladığında bugünün desteklenen lig maçları burada görünecek.');
  const oddsRows = odds.length ? odds.slice(0, 100).map((odd) => {
    const movement = finiteNumber(odd.movement_percent);
    const movementClass = movement > 0 ? 'up' : movement < 0 ? 'down' : 'flat';
    const movementLabel = `${movement > 0 ? '+' : ''}${movement.toFixed(2)}%`;
    return `<article class="odd" data-search-row><div class="odd-match"><span>${escapeHtml(odd.home_team)} — ${escapeHtml(odd.away_team)}</span><small>${escapeHtml(formatDate(odd.kickoff_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))} · ${escapeHtml(String(odd.provider).replace('nowgoal:', ''))}</small></div>
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
  const predictionCards = [...predictions, ...predictionPreviews].map((prediction) => {
    const locked = String(prediction.state).startsWith('LOCKED');
    const candidate = (prediction.selected_candidate ?? null) as Record<string, unknown> | null;
    const skip = String(prediction.decision) === 'SKIP';
    const reasons = (prediction.reasons ?? prediction.skip_reasons ?? []) as unknown[];
    const score = prediction.prediction_score ?? candidate?.predictionScore;
    const scoreClass = finiteNumber(score) >= 85 ? 'ok' : finiteNumber(score) >= 75 ? 'partial' : 'neutral';
    return `<article class="card prediction-card" data-search-row><div class="row"><div><strong>${escapeHtml(prediction.home_team)} — ${escapeHtml(prediction.away_team)}</strong><p>${escapeHtml(prediction.league)} · ${escapeHtml(formatDate(prediction.kickoff_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))}</p></div>
      <span class="badge ${skip ? 'partial' : locked ? 'ok' : 'neutral'}">${skip ? 'GEÇ' : locked ? 'RESMİ' : 'ADAY'}</span></div>
      ${skip ? `<p><strong>Neden:</strong> ${reasons.map(escapeHtml).join(' · ') || 'Veri eşiği karşılanmadı'}</p>` : `<p><strong>${escapeHtml(prediction.market_type ?? candidate?.marketType)} ${escapeHtml(prediction.line ?? candidate?.line ?? '')} · ${escapeHtml(prediction.selection ?? candidate?.selection)}</strong></p>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px"><span class="badge ${scoreClass}">Score ${escapeHtml(score)}/100</span><span class="badge neutral">Odds ${escapeHtml(prediction.reference_odds ?? candidate?.referenceOdds)}</span><span class="badge neutral">Historical N=${escapeHtml(prediction.historical_settled_sample_size ?? (candidate?.historical as Record<string, unknown> | undefined)?.settledSampleSize ?? 0)}</span></div>`}
      <p style="color:var(--muted-2)">Deterministik kayıt · gerçek bahis yürütme yetkisi yoktur.</p></article>`;
  }).join('') || renderEmpty('◇', 'Henüz tahmin kaydı yok', 'ODDS_V1 verisi oluşunca aday tahminler ve resmi SKIP kararları burada görünecek.');
  const predictionHistoryRows = predictionHistory.length ? predictionHistory.map((prediction) => {
    const skip = String(prediction.decision) === 'SKIP';
    const outcome = prediction.outcome == null ? '⏳ PENDING' : escapeHtml(prediction.outcome);
    return `<tr><td>${escapeHtml(formatDate(prediction.kickoff_at, { day: '2-digit', month: 'short' }))}</td>
      <td>${escapeHtml(prediction.home_team)} — ${escapeHtml(prediction.away_team)}</td>
      <td>${skip ? '⏭ GEÇ' : `${escapeHtml(prediction.market_type)} ${escapeHtml(prediction.line ?? '')} ${escapeHtml(prediction.selection)}`}</td>
      <td>${skip ? '—' : escapeHtml(prediction.prediction_score)}</td><td>${outcome}</td></tr>`;
  }).join('') : '<tr><td colspan="5">Henüz kilitli tahmin geçmişi yok.</td></tr>';
  const performanceSummary = predictionPerformance ? `<div class="grid"><article class="card"><strong>Resmi karar</strong><p>${escapeHtml(predictionPerformance.totalOfficialDecisions)} · PREDICT ${escapeHtml(predictionPerformance.predictCount)} · GEÇ ${escapeHtml(predictionPerformance.skipCount)}</p></article><article class="card"><strong>Settlement</strong><p>N=${escapeHtml(predictionPerformance.settled)} · WIN ${escapeHtml(predictionPerformance.win)} · LOSS ${escapeHtml(predictionPerformance.loss)}</p></article><article class="card"><strong>Reference Paper Units</strong><p>${escapeHtml(predictionPerformance.referencePaperUnits ?? 0)}</p><p style="color:var(--muted)">Gerçek/executable getiri değildir.</p></article></div>` : renderEmpty('◇', 'Performans verisi yok', 'Yalnız kilitli resmi kararlar performansa dahil edilir.');
  const selfAuditSummary = predictionSelfAudit ? (() => {
    const status = String(predictionSelfAudit.status ?? 'NOT_AVAILABLE');
    const guardActive = Boolean(predictionSelfAudit.guardActive);
    const effectiveStatus = status === 'PAUSED' && !guardActive ? 'RECOVERY' : status;
    const badgeClass = effectiveStatus === 'HEALTHY' ? 'ok'
      : ['WATCH','INSUFFICIENT_DATA','RECOVERY'].includes(effectiveStatus) ? 'partial'
      : effectiveStatus === 'PAUSED' ? 'bad' : 'neutral';
    const reasons = Array.isArray(predictionSelfAudit.reasons) ? predictionSelfAudit.reasons : [];
    const positiveRate = predictionSelfAudit.recentPositiveRate == null ? '—' : percent(predictionSelfAudit.recentPositiveRate);
    const roi = predictionSelfAudit.recentReferencePaperRoi == null ? '—'
      : `${(finiteNumber(predictionSelfAudit.recentReferencePaperRoi) * 100).toFixed(1)}%`;
    const calibration = predictionSelfAudit.calibrationMae == null ? '—'
      : finiteNumber(predictionSelfAudit.calibrationMae).toFixed(3);
    const pauseUntil = predictionSelfAudit.pauseUntil == null ? null
      : formatDate(predictionSelfAudit.pauseUntil, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const guardText = status === 'PAUSED' && guardActive
      ? `Koruma aktif${pauseUntil ? ` · ${pauseUntil} tarihine kadar` : ''}. Yeni resmi PREDICT yerine GEÇ kaydı oluşturulur.`
      : status === 'PAUSED'
        ? 'Koruma süresi doldu · recovery modunda yeni sonuç toplanmasına izin verilir.'
        : 'Geçmiş kayıtlar değiştirilmez; audit yalnız yeni resmi tahmin kapısını kontrol eder.';
    return `<div class="grid"><article class="card"><div class="row"><strong>SELF-AUDIT V1</strong>
      <span class="badge ${badgeClass}">${escapeHtml(effectiveStatus)}</span></div>
      <p>Son örnek N=${escapeHtml(predictionSelfAudit.recentSampleSize ?? 0)} · Binary N=${escapeHtml(predictionSelfAudit.recentBinarySampleSize ?? 0)}</p>
      <p>Positive rate: <strong>${escapeHtml(positiveRate)}</strong> · Reference Paper ROI: <strong>${escapeHtml(roi)}</strong></p>
      <p>Calibration MAE: ${escapeHtml(calibration)} · Kayıp serisi: ${escapeHtml(predictionSelfAudit.lossStreak ?? 0)}</p>
      ${reasons.length ? `<p style="color:${guardActive ? 'var(--red)' : 'var(--amber)'}">Neden: ${reasons.map(escapeHtml).join(' · ')}</p>` : ''}
      <p style="color:var(--muted)">${escapeHtml(guardText)}</p>
      </article></div>`;
  })() : renderEmpty('◇', 'Self-Audit henüz çalışmadı', 'Worker ilk döngüsünde tahmin performansını otomatik kontrol edecek.');

  const segmentAuditSummary = predictionSelfAuditSegments.length ? (() => {
    const activePaused = predictionSelfAuditSegments.filter((item) => item.status === 'PAUSED' && item.guardActive).length;
    const watch = predictionSelfAuditSegments.filter((item) => item.status === 'WATCH').length;
    const rows = predictionSelfAuditSegments.slice(0, 30).map((item) => {
      const status = String(item.status ?? 'NOT_AVAILABLE');
      const effectiveStatus = status === 'PAUSED' && !item.guardActive ? 'RECOVERY' : status;
      const badgeClass = effectiveStatus === 'HEALTHY' ? 'ok'
        : ['WATCH','INSUFFICIENT_DATA','RECOVERY'].includes(effectiveStatus) ? 'partial'
        : effectiveStatus === 'PAUSED' ? 'bad' : 'neutral';
      const scope = String(item.scopeType ?? '');
      const label = scope === 'MARKET' ? item.marketType
        : scope === 'LEAGUE' ? item.competitionName
        : `${String(item.competitionName ?? '—')} · ${String(item.marketType ?? '—')}`;
      const rate = item.recentPositiveRate == null ? '—' : percent(item.recentPositiveRate);
      const roi = item.recentReferencePaperRoi == null ? '—'
        : `${(finiteNumber(item.recentReferencePaperRoi) * 100).toFixed(1)}%`;
      return `<tr><td>${escapeHtml(scope)}</td><td><strong>${escapeHtml(label)}</strong></td>
        <td><span class="badge ${badgeClass}">${escapeHtml(effectiveStatus)}</span></td>
        <td>${escapeHtml(item.recentSampleSize ?? 0)}</td><td>${escapeHtml(rate)}</td><td>${escapeHtml(roi)}</td>
        <td>${escapeHtml(item.lossStreak ?? 0)}</td></tr>`;
    }).join('');
    return `<details><summary>SELF-AUDIT V2 · Segment kontrolü · PAUSED ${activePaused} · WATCH ${watch}</summary>
      <div class="details-body"><p style="color:var(--muted)">Sadece sorunlu market/lig kapatılır. Genel V1 freni ayrıca çalışmaya devam eder.</p>
      <div class="scroll"><table><thead><tr><th>Kapsam</th><th>Segment</th><th>Durum</th><th>Son N</th>
      <th>Positive rate</th><th>Ref. ROI</th><th>Kayıp serisi</th></tr></thead><tbody>${rows}</tbody></table></div></div></details>`;
  })() : `<details><summary>SELF-AUDIT V2 · Segment kontrolü</summary><div class="details-body">${renderEmpty('◇',
    'Segment verisi henüz yok', 'İlk resmi tahmin sonuçları oluştukça market ve lig bazlı audit burada başlayacak.')}</div></details>`;

  const rootCauseSummary = predictionSelfAuditRootCauses.length ? (() => {
    const highRisk = predictionSelfAuditRootCauses.filter((item) => item.status === 'HIGH_RISK').length;
    const watch = predictionSelfAuditRootCauses.filter((item) => item.status === 'WATCH').length;
    const rows = predictionSelfAuditRootCauses.slice(0, 30).map((item) => {
      const status = String(item.status ?? 'NOT_AVAILABLE');
      const badgeClass = status === 'HEALTHY' ? 'ok'
        : status === 'WATCH' || status === 'INSUFFICIENT_DATA' ? 'partial'
        : status === 'HIGH_RISK' ? 'bad' : 'neutral';
      const rate = item.positiveRate == null ? '—' : percent(item.positiveRate);
      const roi = item.referencePaperRoi == null ? '—'
        : `${(finiteNumber(item.referencePaperRoi) * 100).toFixed(1)}%`;
      const rateGap = item.positiveRateGap == null ? '—'
        : `${finiteNumber(item.positiveRateGap) >= 0 ? '+' : ''}${(finiteNumber(item.positiveRateGap) * 100).toFixed(1)} pp`;
      const roiGap = item.referencePaperRoiGap == null ? '—'
        : `${finiteNumber(item.referencePaperRoiGap) >= 0 ? '+' : ''}${(finiteNumber(item.referencePaperRoiGap) * 100).toFixed(1)} pp`;
      const evidence = `${(finiteNumber(item.evidenceStrength) * 100).toFixed(0)}%`;
      return `<tr><td>${escapeHtml(item.dimension)}</td><td><strong>${escapeHtml(item.bucketLabel)}</strong></td>
        <td><span class="badge ${badgeClass}">${escapeHtml(status)}</span></td>
        <td>${escapeHtml(item.binarySampleSize ?? 0)}</td><td>${escapeHtml(rate)}</td><td>${escapeHtml(roi)}</td>
        <td>${escapeHtml(rateGap)}</td><td>${escapeHtml(roiGap)}</td>
        <td>${escapeHtml(evidence)}</td><td>${escapeHtml(item.rootCauseScore ?? 0)}</td></tr>`;
    }).join('');
    return `<details><summary>SELF-AUDIT V3 · Kök neden analizi · HIGH RISK ${highRisk} · WATCH ${watch}</summary>
      <div class="details-body"><p style="color:var(--muted)">Teşhis katmanıdır; tek başına resmi tahmini durdurmaz.
      Faktör performansı aynı dönem genel baseline ile karşılaştırılır.</p>
      <div class="scroll"><table><thead><tr><th>Faktör</th><th>Bucket</th><th>Durum</th><th>Binary N</th>
      <th>Positive rate</th><th>Ref. ROI</th><th>Rate farkı</th><th>ROI farkı</th><th>Kanıt</th><th>Cause score</th>
      </tr></thead><tbody>${rows}</tbody></table></div></div></details>`;
  })() : `<details><summary>SELF-AUDIT V3 · Kök neden analizi</summary><div class="details-body">${renderEmpty('◇',
    'Kök neden verisi henüz yok', 'Yeterli resmi settlement oluşunca hangi koşulların performansı aşağı çektiği burada görünecek.')}</div></details>`;

  const adaptiveRuleSummary = predictionAdaptiveRuleProposals.length ? (() => {
    const proposed = predictionAdaptiveRuleProposals.filter((item) => item.decision === 'PROPOSED').length;
    const approved = predictionAdaptiveRuleProposals.filter((item) => item.decision === 'APPROVED').length;
    const rejected = predictionAdaptiveRuleProposals.filter((item) => item.decision === 'REJECTED').length;
    const rows = predictionAdaptiveRuleProposals.slice(0, 20).map((item) => {
      const severity = String(item.severity ?? 'WATCH');
      const decision = String(item.decision ?? 'PROPOSED');
      const severityClass = severity === 'HIGH_RISK' ? 'bad' : 'partial';
      const decisionClass = decision === 'APPROVED' ? 'ok' : decision === 'REJECTED' ? 'neutral' : 'partial';
      const conditions = Array.isArray(item.conditions) ? item.conditions as Array<Record<string, unknown>> : [];
      const label = conditions.map((condition) => String(condition.bucketLabel ?? condition.bucketKey ?? '')).join(' + ');
      const rateGap = `${finiteNumber(item.positiveRateGap) >= 0 ? '+' : ''}${(finiteNumber(item.positiveRateGap) * 100).toFixed(1)} pp`;
      const roiGap = `${finiteNumber(item.referencePaperRoiGap) >= 0 ? '+' : ''}${(finiteNumber(item.referencePaperRoiGap) * 100).toFixed(1)} pp`;
      const interaction = item.interactionPositiveRateGap == null ? '—'
        : `${finiteNumber(item.interactionPositiveRateGap) >= 0 ? '+' : ''}${(finiteNumber(item.interactionPositiveRateGap) * 100).toFixed(1)} pp`;
      const evidence = `${(finiteNumber(item.evidenceStrength) * 100).toFixed(0)}%`;
      return `<tr><td><span class="badge ${severityClass}">${escapeHtml(severity)}</span></td>
        <td><strong>${escapeHtml(item.proposalType)}</strong><br><span style="color:var(--muted)">${escapeHtml(label)}</span></td>
        <td>${escapeHtml(item.binarySampleSize ?? 0)}</td><td>${escapeHtml(rateGap)}</td><td>${escapeHtml(roiGap)}</td>
        <td>${escapeHtml(interaction)}</td><td>${escapeHtml(evidence)}</td><td>${escapeHtml(item.proposalScore ?? 0)}</td>
        <td><span class="badge ${decisionClass}">${escapeHtml(decision)}</span></td></tr>`;
    }).join('');
    return `<details><summary>SELF-AUDIT V4 · Adaptive Rule Proposals · PROPOSED ${proposed} · APPROVED ${approved} · REJECTED ${rejected}</summary>
      <div class="details-body"><p style="color:var(--muted)">V4 yalnız öneri üretir. autoApply=false ve executionAuthority=false.
      APPROVED durumu bile PredictionConfig'i veya tahmin motorunu otomatik değiştirmez.</p>
      <div class="scroll"><table><thead><tr><th>Risk</th><th>Önerilen koşul</th><th>N</th><th>Rate farkı</th>
      <th>ROI farkı</th><th>Interaction</th><th>Kanıt</th><th>Proposal score</th><th>Karar</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div></details>`;
  })() : `<details><summary>SELF-AUDIT V4 · Adaptive Rule Proposals</summary><div class="details-body">${renderEmpty('◇',
    'Güncel kural önerisi yok', 'V4 yeterli ve tekrarlanabilir zayıflık görürse burada insan onayına sunulan öneriler oluşacak.')}</div></details>`;

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
    <section class="section" id="predictions"><div class="section-title"><h2>BUGÜNÜN TAHMİNLERİ</h2><p>PREDICTION V1 · resmi kayıt veya değişebilir önizleme</p></div><div class="grid">${predictionCards}</div></section>
    <section class="section" id="prediction-self-audit"><div class="section-title"><h2>KENDİNİ KONTROL</h2><p>SELF-AUDIT V1 + V2 + V3 + V4 · güvenlik, teşhis ve insan onaylı adaptasyon</p></div>${selfAuditSummary}${segmentAuditSummary}${rootCauseSummary}${adaptiveRuleSummary}</section>
    <section class="section" id="prediction-history"><div class="section-title"><h2>TAHMİN GEÇMİŞİ</h2><p>Yalnız kilitli resmi kararlar · her oran N ile değerlendirilir</p></div><div class="scroll"><table><thead><tr><th>Tarih</th><th>Maç</th><th>Karar</th><th>Score</th><th>Sonuç</th></tr></thead><tbody>${predictionHistoryRows}</tbody></table></div><details><summary>PERFORMANCE LAB</summary><div class="details-body">${performanceSummary}</div></details></section>
    <section class="section" id="sources"><div class="section-title"><h2>Veri kaynakları</h2><p>Sağlık ve son senkronizasyon durumu</p></div><div class="source-grid">${providerCards}</div></section>
    <section class="section" id="system"><div class="section-title"><h2>Analiz ve sistem</h2><p>İleri seviye veri panelleri</p></div><details><summary>Provider qualification matrisi</summary><div class="details-body">${matrix}</div></details><details><summary>Dataset sağlığı ve backfill</summary><div class="details-body">${datasetHealth}<div class="scroll" style="margin-top:10px"><table><thead><tr><th>Lig</th><th>Sezon</th><th>Durum</th><th>Bulunan</th><th>Kaydedilen</th><th>Tam</th><th>Kısmi</th><th>Hata</th><th>Retry</th></tr></thead><tbody>${backfillRows}</tbody></table></div></div></details><details><summary>Korner modeli ve doğrulama</summary><div class="details-body">${modelValidation}<div class="scroll" style="margin-top:10px"><table><thead><tr><th>Maç</th><th>Beklenen</th><th>O8.5</th><th>O9.5</th><th>O10.5</th><th>Veri kalitesi</th><th>Güven</th></tr></thead><tbody>${cornerRows}</tbody></table></div></div></details></section>
    <footer class="footer"><span>BETAPP V2 · Europe/Istanbul · Otomatik yenileme 60 sn</span><span><a href="/health">Sistem sağlığı</a> · <a href="/api/odds/upcoming">Odds API</a></span></footer></main>`);
}

export function renderCornerDetail(data: Record<string, unknown>): string {
  const probabilities = (data.probabilities ?? {}) as Record<string, { over: number; under: number }>;
  const probabilityRows = Object.entries(probabilities).map(([line, value]) => `<tr><td>${escapeHtml(line)}</td><td>${(value.over * 100).toFixed(1)}%</td><td>${(value.under * 100).toFixed(1)}%</td></tr>`).join('');
  return shell(`<main class="wrap"><div style="padding:28px 0"><a href="/" style="color:var(--green)">← Ana panele dön</a><section class="hero" style="margin-top:34px"><div><p class="eyebrow">Korner analizi</p><h1>${escapeHtml(data.home_team)}<br>— ${escapeHtml(data.away_team)}</h1><p class="hero-copy">${escapeHtml(formatDate(data.kickoff_at, { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }))} · ${escapeHtml(data.competition)}</p></div></section><section class="metrics"><article class="metric"><span class="metric-label">Ev</span><strong class="metric-value">${finiteNumber(data.expected_home_corners).toFixed(2)}</strong></article><article class="metric"><span class="metric-label">Deplasman</span><strong class="metric-value">${finiteNumber(data.expected_away_corners).toFixed(2)}</strong></article><article class="metric"><span class="metric-label">Toplam</span><strong class="metric-value">${finiteNumber(data.expected_total_corners).toFixed(2)}</strong></article><article class="metric"><span class="metric-label">Model güveni</span><strong class="metric-value">${escapeHtml(data.model_confidence)}</strong><span class="metric-note">100 üzerinden</span></article></section><section class="panel"><div class="panel-head"><h2>Olasılıklar</h2><span class="badge ok">${escapeHtml(data.distribution)}</span></div><div class="panel-body"><div class="scroll"><table><thead><tr><th>Çizgi</th><th>Üst</th><th>Alt</th></tr></thead><tbody>${probabilityRows}</tbody></table></div></div></section><details><summary>Hesaplama ayrıntıları</summary><div class="details-body"><pre style="white-space:pre-wrap;overflow:auto;color:var(--muted)">${escapeHtml(JSON.stringify(data.calculation_details, null, 2))}</pre></div></details></div></main>`, `${escapeHtml(data.home_team)} — ${escapeHtml(data.away_team)} | Korner Analizi`);
}
