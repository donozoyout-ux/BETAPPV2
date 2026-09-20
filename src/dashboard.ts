type DashboardData = { matches: Array<Record<string, unknown>>; providers: Array<Record<string, unknown>>;
  qualification?: Array<Record<string, unknown>>; cornerAnalyses?: Array<Record<string, unknown>>;
  datasetAudit?: Record<string, unknown> | null; validation?: Record<string, unknown> | null;
  backfill?: Array<Record<string, unknown>>; odds?: Array<Record<string, unknown>>;
  oddsAnalyses?: Array<Record<string, unknown>>; predictions?: Array<Record<string, unknown>>;
  predictionPreviews?: Array<Record<string, unknown>>; predictionHistory?: Array<Record<string, unknown>>;
  predictionPerformance?: Record<string, unknown> | null; predictionSelfAudit?: Record<string, unknown> | null;
  predictionSelfAuditSegments?: Array<Record<string, unknown>>;
  predictionSelfAuditRootCauses?: Array<Record<string, unknown>>;
  predictionAdaptiveRuleProposals?: Array<Record<string, unknown>>;
  oddsSimilarity?: Array<Record<string, unknown>>;
  predictionReviewCandidates?: Array<Record<string, unknown>>;
  predictionDiagnostics?: Record<string, unknown> | null };
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


const reasonTranslations: Record<string, string> = {
  NO_ODDS_ANALYSIS: 'Bu maç için henüz oran analizi oluşmadı',
  ODDS_NOT_ELIGIBLE: 'Oran verisi henüz yeterli değil',
  LOW_DATA_QUALITY: 'Maç verisinin kalitesi yeterli değil',
  LOW_MODEL_CONFIDENCE: 'Sistem bu maç için yeterince emin değil',
  INSUFFICIENT_BOOKMAKERS: 'Yeterli sayıda bahis şirketinden veri yok',
  INSUFFICIENT_COMPLETE_STATES: 'Oran değişimini ölçmek için daha fazla veri gerekiyor',
  MOVEMENT_NOT_SUPPORTED: 'Oran hareketi yeterince güçlü değil',
  INSUFFICIENT_HISTORICAL_SAMPLE: 'Benzer geçmiş maç sayısı yetersiz',
  LOW_PREDICTION_SCORE: 'Tahmin skoru resmi tahmin seviyesinin altında',
  CONFLICTING_CORNER_MODEL: 'Korner modeli piyasa hareketiyle çelişiyor',
  LOCK_WINDOW_MISSED: 'Tahmin oluşturma zamanı geçti',
  UNSUPPORTED_MARKET: 'Bu bahis türü henüz desteklenmiyor',
  NO_SETTLEMENT_DATA: 'Maç sonucu verisi henüz tamamlanmadı',
  SELF_AUDIT_PAUSED: 'Sistem güvenlik nedeniyle yeni tahminleri geçici olarak durdurdu',
  SELF_AUDIT_SEGMENT_PAUSED: 'Bu lig veya bahis türünde tahminler geçici olarak durduruldu',
};

function translateReason(value: unknown): string {
  const code = String(value ?? '');
  const base = code.split(':')[0] ?? code;
  return reasonTranslations[base] ?? 'Bu maç resmi tahmin için gerekli koşulları henüz karşılamıyor';
}

function translateGrade(value: unknown): string {
  const labels: Record<string, string> = { GOOD: 'İyi', LIMITED: 'Sınırlı', POOR: 'Zayıf' };
  return labels[String(value ?? '').toUpperCase()] ?? String(value ?? '—');
}

function translateSystemStatus(value: unknown): string {
  const labels: Record<string, string> = {
    HEALTHY: 'Sağlıklı', WATCH: 'İzleniyor', PAUSED: 'Durduruldu', RECOVERY: 'Yeniden kontrol ediliyor',
    INSUFFICIENT_DATA: 'Veri yetersiz', HIGH_RISK: 'Yüksek risk', NOT_AVAILABLE: 'Henüz veri yok',
    PROPOSED: 'Öneri var', APPROVED: 'Onaylandı', REJECTED: 'Reddedildi',
  };
  return labels[String(value ?? '').toUpperCase()] ?? String(value ?? '—');
}

function translateMarket(value: unknown): string {
  const labels: Record<string, string> = {
    MATCH_RESULT: 'Maç Sonucu', '1X2': 'Maç Sonucu', TOTAL_GOALS: 'Toplam Gol',
    TOTAL_CORNERS: 'Toplam Korner', ASIAN_HANDICAP: 'Asya Handikapı',
  };
  return labels[String(value ?? '').toUpperCase()] ?? String(value ?? '—');
}

function translateSelection(value: unknown): string {
  const labels: Record<string, string> = {
    HOME: 'Ev Sahibi', AWAY: 'Deplasman', DRAW: 'Beraberlik', OVER: 'ÜST', UNDER: 'ALT',
  };
  return labels[String(value ?? '').toUpperCase()] ?? String(value ?? '—');
}

function movementText(delta: unknown): string {
  const value = finiteNumber(delta);
  if (value >= 4) return 'Güçlü şekilde bu seçeneğe yöneliyor';
  if (value >= 2) return 'Bu seçeneğe doğru belirgin hareket var';
  if (value > 0) return 'Bu seçeneğe doğru hafif hareket var';
  if (value <= -4) return 'Bu seçeneğin tersine güçlü hareket var';
  if (value <= -2) return 'Bu seçeneğin tersine belirgin hareket var';
  if (value < 0) return 'Bu seçeneğin tersine hafif hareket var';
  return 'Belirgin oran hareketi yok';
}

function outcomeText(value: unknown): string {
  const labels: Record<string, string> = {
    WIN: 'Kazandı', HALF_WIN: 'Yarı kazandı', LOSS: 'Kaybetti', HALF_LOSS: 'Yarı kaybetti',
    PUSH: 'İade', VOID: 'Geçersiz', PENDING: 'Bekliyor',
  };
  return labels[String(value ?? '').toUpperCase()] ?? String(value ?? '—');
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
  .similarity-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.similarity-card{overflow:hidden;border:1px solid var(--line);border-radius:16px;background:var(--panel);box-shadow:var(--shadow)}.similarity-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px;border-bottom:1px solid var(--line-soft)}.similarity-head h3{margin:0;font-size:.92rem}.similarity-head p{margin:4px 0 0;color:var(--muted);font-size:.7rem}.similarity-current{padding:14px 16px;background:linear-gradient(145deg,rgba(116,245,156,.045),transparent)}.similarity-market{font-weight:900}.similarity-odds{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap}.similarity-arrow{color:var(--muted-2)}.similarity-price{font-size:1.15rem;font-weight:950;font-variant-numeric:tabular-nums}.similarity-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.similar-list{border-top:1px solid var(--line-soft)}.similar-list-title{padding:10px 14px;color:var(--muted);font-size:.66rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.similar-row{display:grid;grid-template-columns:28px minmax(0,1fr) 105px 95px;align-items:center;gap:9px;padding:10px 14px;border-top:1px solid var(--line-soft)}.similar-rank{display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:var(--panel-3);color:var(--green);font-size:.66rem;font-weight:900}.similar-teams{min-width:0}.similar-teams strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.76rem}.similar-teams span{display:block;color:var(--muted);font-size:.64rem}.similar-history-odds{font-size:.72rem;font-weight:800;font-variant-numeric:tabular-nums}.similar-history-odds small{display:block;color:var(--muted);font-size:.61rem;font-weight:650}.similar-result{text-align:right}.similar-result small{display:block;margin-top:3px;color:var(--muted);font-size:.6rem}
  details{margin-top:9px;border:1px solid var(--line);border-radius:13px;background:rgba(13,27,20,.82)}summary{cursor:pointer;list-style:none;padding:14px 16px;font-weight:800;font-size:.82rem}summary::-webkit-details-marker{display:none}summary:after{content:"+";float:right;color:var(--green)}details[open] summary:after{content:"−"}.details-body{padding:0 12px 12px}.scroll{overflow:auto;border:1px solid var(--line-soft);border-radius:11px}table{width:100%;border-collapse:collapse;background:var(--panel);font-size:.75rem}th,td{padding:10px 11px;border-bottom:1px solid var(--line-soft);text-align:left;vertical-align:top;white-space:nowrap}th{color:var(--muted);font-size:.61rem;letter-spacing:.07em;text-transform:uppercase}tr:last-child td{border-bottom:0}.empty{display:flex;align-items:center;gap:13px;min-height:155px;padding:20px;color:var(--muted)}.empty-icon{display:grid;place-items:center;flex:0 0 auto;width:44px;height:44px;border:1px solid var(--line);border-radius:12px;background:var(--panel-2);color:var(--green)}.empty strong{color:var(--text)}.empty p{max-width:420px;margin:3px 0 0;font-size:.78rem}
  .footer{display:flex;justify-content:space-between;gap:18px;margin-top:28px;padding:18px 0;border-top:1px solid var(--line);color:var(--muted-2);font-size:.7rem}.footer a{color:var(--green)}.hidden-by-search{display:none!important}
  @media(max-width:1180px){:root{--sidebar-w:205px}.metrics{grid-template-columns:repeat(3,1fr)}.command-hero{grid-template-columns:1fr}.audit-overview{grid-template-columns:repeat(2,1fr)}.similarity-grid{grid-template-columns:1fr}}
  @media(max-width:860px){.sidebar{display:none}.app-main{margin-left:0}.mobile-menu{display:inline-flex}.topbar{padding:0 16px}.search{width:min(390px,58vw)}.content{width:min(100% - 26px,1500px)}.workspace{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:560px){.top-title{display:none}.top-actions .top-chip{display:none}.search{width:100%}.topbar{gap:10px}.content{width:min(100% - 18px,1500px);padding-top:16px}.hero-main,.hero-status{border-radius:15px}.hero-main{padding:19px}.metrics{gap:7px}.metric{min-height:95px;padding:12px}.metric-value{font-size:1.45rem}.audit-overview{grid-template-columns:1fr 1fr}.section-title{align-items:flex-start;flex-direction:column;gap:3px}.odd{grid-template-columns:minmax(0,1fr) 62px}.odd-market,.movement{display:none}.match{grid-template-columns:55px minmax(0,1fr)}.match .status{display:none}.grid,.source-grid{grid-template-columns:1fr}.similar-row{grid-template-columns:24px minmax(0,1fr) 86px}.similar-result{grid-column:2/4;text-align:left}.footer{flex-direction:column}}
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
  const predictionReviewCandidates = data.predictionReviewCandidates ?? [];
  const predictionHistory = data.predictionHistory ?? [];
  const predictionPerformance = data.predictionPerformance;
  const predictionSelfAudit = data.predictionSelfAudit;
  const predictionSelfAuditSegments = data.predictionSelfAuditSegments ?? [];
  const predictionSelfAuditRootCauses = data.predictionSelfAuditRootCauses ?? [];
  const predictionAdaptiveRuleProposals = data.predictionAdaptiveRuleProposals ?? [];
  const oddsSimilarity = data.oddsSimilarity ?? [];
  const predictionDiagnostics = data.predictionDiagnostics;
  const predictionThresholds = (predictionDiagnostics?.thresholds ?? {}) as Record<string, unknown>;
  const requiredHistoricalSample = finiteNumber(predictionThresholds.minimumHistoricalSample, 30);
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
    const status = String(provider.status ?? 'unknown').toLowerCase();
    const badgeClass = status === 'healthy' ? 'ok' : ['degraded','waiting'].includes(status) ? 'partial' : 'neutral';
    const statusLabel = status === 'healthy' ? 'Çalışıyor'
      : status === 'waiting' ? 'Veri bekleniyor'
      : status === 'degraded' ? 'Kısmi çalışıyor'
      : status === 'blocked' ? 'Kullanılmıyor' : 'Kontrol ediliyor';
    const name = String(provider.provider ?? 'Veri kaynağı');
    const lower = name.toLowerCase();
    const explanation = lower.includes('fotmob') ? 'Maç, fikstür ve istatistik verileri'
      : lower.includes('nowgoal') ? 'Oran ve oran değişimi verileri'
      : lower.includes('sofascore') ? 'Yedek veri kaynağı'
      : 'Sistem veri kaynağı';
    return `<article class="source"><div class="source-top"><span class="source-name">${escapeHtml(name)}</span>
      <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span></div>
      <p>${escapeHtml(explanation)} · ${status === 'healthy' ? 'veri geliyor' : statusLabel.toLocaleLowerCase('tr-TR')}</p></article>`;
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
  const oddsSimilarityCards = oddsSimilarity.length ? oddsSimilarity.map((entry) => {
    const current = (entry.current ?? {}) as Record<string, unknown>;
    const history = Array.isArray(entry.matches) ? entry.matches as Array<Record<string, unknown>> : [];
    const state = String(current.state ?? 'PREVIEW');
    const stateLabel = state === 'LOCKED_PREDICTION' ? 'Resmi tahmin'
      : state === 'MATCH_ONLY' ? 'Karşılaştırma' : 'İnceleme adayı';
    const stateClass = state === 'LOCKED_PREDICTION' ? 'ok' : state === 'MATCH_ONLY' ? 'neutral' : 'partial';
    const hitRate = current.historicalHitRate == null ? 'Henüz hesaplanmadı' : percent(current.historicalHitRate);
    const avgSimilarity = current.averageSimilarity == null ? '—'
      : `${(finiteNumber(current.averageSimilarity) * 100).toFixed(0)}%`;
    const movement = finiteNumber(current.probabilityDeltaPp);
    const line = current.line == null ? '' : ` ${escapeHtml(current.line)}`;
    const marketLabel = `${translateMarket(current.marketType)}${line} · ${translateSelection(current.selection)}`;
    const rows = history.map((item) => {
      const rawOutcome = String(item.outcome ?? '—');
      const outcomeClass = ['WIN','HALF_WIN'].includes(rawOutcome) ? 'ok'
        : ['LOSS','HALF_LOSS'].includes(rawOutcome) ? 'bad' : 'partial';
      const score = item.homeScore == null || item.awayScore == null ? 'Sonuç yok' : `${item.homeScore} - ${item.awayScore}`;
      const cornerScore = item.homeCorners == null || item.awayCorners == null ? null : `${item.homeCorners} - ${item.awayCorners} korner`;
      const similarPct = current.averageSimilarity == null ? null : avgSimilarity;
      return `<div class="similar-row" data-search-row>
        <span class="similar-rank">#${escapeHtml(item.rank)}</span>
        <div class="similar-teams"><strong>${escapeHtml(item.homeTeam)} — ${escapeHtml(item.awayTeam)}</strong>
          <span>${escapeHtml(formatDate(item.kickoffAt, { day: '2-digit', month: 'long', year: 'numeric' }))} · ${escapeHtml(item.league)}</span></div>
        <div class="similar-history-odds">${finiteNumber(item.openingOdds).toFixed(2)} → ${finiteNumber(item.currentOdds).toFixed(2)}
          <small>${escapeHtml(translateMarket(item.marketType))} · ${escapeHtml(translateSelection(item.selection))}${similarPct ? ` · benzerlik ${escapeHtml(similarPct)}` : ''}</small></div>
        <div class="similar-result"><span class="badge ${outcomeClass}">${escapeHtml(outcomeText(rawOutcome))}</span>
          <small>${escapeHtml(score)}${cornerScore ? ` · ${escapeHtml(cornerScore)}` : ''}</small></div>
      </div>`;
    }).join('');
    return `<article class="similarity-card" data-search-row>
      <div class="similarity-head"><div><h3>${escapeHtml(current.homeTeam)} — ${escapeHtml(current.awayTeam)}</h3>
        <p>${escapeHtml(current.league)} · ${escapeHtml(formatDate(current.kickoffAt, { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }))}</p></div>
        <span class="badge ${stateClass}">${escapeHtml(stateLabel)}</span></div>
      <div class="similarity-current"><div class="similarity-market">${escapeHtml(marketLabel)}</div>
        <div class="similarity-odds"><span class="similarity-price">${finiteNumber(current.openingOdds).toFixed(2)}</span><span class="similarity-arrow">→</span>
          <span class="similarity-price">${finiteNumber(current.currentOdds).toFixed(2)}</span>
          <span class="badge neutral">${escapeHtml(movementText(movement))}</span></div>
        <p style="margin:9px 0 0;color:var(--muted)">Açılış oranı → şu anki oran. Sistem geçmişte aynı bahis türünde benzer oran yapıları arıyor.</p>
        <div class="similarity-meta"><span class="badge neutral">Tahmin skoru ${escapeHtml(current.predictionScore)}/100</span>
          <span class="badge neutral">Benzer geçmiş maç: ${escapeHtml(current.historicalSettledSampleSize)}</span>
          <span class="badge neutral">Geçmiş başarı: ${escapeHtml(hitRate)}</span>
          <span class="badge neutral">Ortalama benzerlik: ${escapeHtml(avgSimilarity)}</span></div></div>
      <div class="similar-list"><div class="similar-list-title">En çok benzeyen geçmiş maçlar</div>
        ${rows || '<div class="similar-list-title">Bu oran yapısına benzeyen sonuçlanmış maç henüz bulunamadı.</div>'}</div></article>`;
  }).join('') : renderEmpty('∿', 'Henüz geçmiş oran eşleşmesi yok',
    oddsAnalyses.length
      ? 'Oranlar takip ediliyor. Yeterli geçmiş benzerlik oluştuğunda en yakın maçlar burada gösterilecek.'
      : 'Önce maçların oran verileri toplanacak, ardından geçmiş maçlarla karşılaştırılacak.');
  const officialPredictions = predictions.filter((item) => String(item.decision) === 'PREDICT');
  const reviewMatchIds = new Set(predictionReviewCandidates.map((item) => String(item.matchId ?? '')));
  const rejectedByMatch = new Map<string, Record<string, unknown>>();
  for (const item of [...predictions, ...predictionPreviews]) {
    if (String(item.decision) !== 'SKIP') continue;
    const matchId = String(item.match_id ?? item.matchId ?? '');
    if (!matchId || reviewMatchIds.has(matchId) || rejectedByMatch.has(matchId)) continue;
    rejectedByMatch.set(matchId, item);
  }
  const rejectedPredictions = [...rejectedByMatch.values()];

  const officialPredictionCards = officialPredictions.length ? officialPredictions.map((prediction) => {
    const score = finiteNumber(prediction.prediction_score);
    const hist = finiteNumber(prediction.historical_settled_sample_size ?? prediction.historical_sample_size);
    const hit = prediction.historical_hit_rate == null ? '—' : percent(prediction.historical_hit_rate);
    return `<article class="card prediction-card" data-search-row><div class="row"><div><strong>${escapeHtml(prediction.home_team)} — ${escapeHtml(prediction.away_team)}</strong>
      <p>${escapeHtml(prediction.league)} · ${escapeHtml(formatDate(prediction.kickoff_at, { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }))}</p></div>
      <span class="badge ok">Resmi tahmin</span></div>
      <p style="font-size:1rem;color:var(--text)"><strong>${escapeHtml(translateMarket(prediction.market_type))} ${escapeHtml(prediction.line ?? '')} · ${escapeHtml(translateSelection(prediction.selection))}</strong></p>
      <div class="similarity-meta"><span class="badge ok">Tahmin skoru ${score}/100</span>
        <span class="badge neutral">Benzer geçmiş maç: ${hist}</span><span class="badge neutral">Geçmiş başarı: ${escapeHtml(hit)}</span>
        <span class="badge neutral">Oran: ${finiteNumber(prediction.reference_odds).toFixed(2)}</span></div>
      <p>Bu maç mevcut resmi tahmin kurallarının tamamını geçti.</p></article>`;
  }).join('') : renderEmpty('✓', 'Şu anda resmi tahmin yok', 'Sistem kriterleri karşılayan bir maç bulduğunda resmi tahmin burada görünecek.');

  const reviewCandidateCards = predictionReviewCandidates.length ? predictionReviewCandidates.map((entry) => {
    const candidate = (entry.candidate ?? {}) as Record<string, unknown>;
    const historical = (candidate.historical ?? {}) as Record<string, unknown>;
    const reasons = Array.isArray(entry.skipReasons) ? entry.skipReasons : [];
    const hist = finiteNumber(historical.settledSampleSize);
    const score = finiteNumber(candidate.predictionScore);
    const bookmakers = finiteNumber(candidate.bookmakerCount);
    const agreement = finiteNumber(candidate.agreementRatio);
    const hit = historical.historicalHitRate == null ? 'Henüz güvenilir değil' : percent(historical.historicalHitRate);
    const missing = reasons.slice(0, 3).map((reason) => `<li>${escapeHtml(translateReason(reason))}</li>`).join('');
    const line = candidate.line == null ? '' : ` ${escapeHtml(candidate.line)}`;
    return `<article class="card prediction-card" data-search-row><div class="row"><div><strong>${escapeHtml(entry.homeTeam)} — ${escapeHtml(entry.awayTeam)}</strong>
      <p>${escapeHtml(entry.league)} · ${escapeHtml(formatDate(entry.kickoffAt, { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }))}</p></div>
      <span class="badge partial">İnceleme adayı</span></div>
      <p style="font-size:1rem;color:var(--text)"><strong>${escapeHtml(translateMarket(candidate.marketType))}${line} · ${escapeHtml(translateSelection(candidate.selection))}</strong></p>
      <div class="similarity-odds"><span class="similarity-price">${finiteNumber(candidate.openingOdds).toFixed(2)}</span><span class="similarity-arrow">→</span>
        <span class="similarity-price">${finiteNumber(candidate.currentOdds).toFixed(2)}</span><span class="badge neutral">${escapeHtml(movementText(candidate.probabilityDeltaPp))}</span></div>
      <div class="similarity-meta"><span class="badge neutral">Tahmin skoru: ${score}/100</span>
        <span class="badge ${hist >= requiredHistoricalSample ? 'ok' : 'partial'}">Benzer geçmiş maç: ${hist} / gereken ${requiredHistoricalSample}</span>
        <span class="badge neutral">Geçmiş başarı: ${escapeHtml(hit)}</span>
        <span class="badge neutral">Bahis şirketi: ${bookmakers}</span></div>
      <p><strong>Veri kalitesi:</strong> ${escapeHtml(translateGrade(candidate.dataQualityGrade))} · <strong>Model güveni:</strong> ${escapeHtml(translateGrade(candidate.confidenceGrade))}</p>
      <p><strong>Bahis şirketi uyumu:</strong> ${Math.round(agreement * 100)}% · Çoğunluğun aynı yönde hareket edip etmediği burada ölçülür.</p>
      <p><strong>Neden henüz resmi tahmin değil?</strong></p>
      <ul style="margin:5px 0 0;padding-left:18px;color:var(--muted)">${missing || '<li>Resmi tahmin için gereken kanıt henüz tamamlanmadı.</li>'}</ul>
      <p style="color:var(--muted-2)">Bu kart inceleme içindir; resmi tahmin ve performans kaydına dahil değildir.</p></article>`;
  }).join('') : renderEmpty('◇', 'Şu anda inceleme adayı yok', 'Resmi tahmin seviyesine yaklaşan maçlar burada gösterilecek.');

  const rejectedRows = rejectedPredictions.map((prediction) => {
    const reasons = Array.isArray(prediction.skip_reasons) ? prediction.skip_reasons as unknown[]
      : Array.isArray(prediction.reasons) ? prediction.reasons as unknown[] : [];
    const mainReason = reasons[0] == null ? 'Resmi tahmin koşulları henüz oluşmadı' : translateReason(reasons[0]);
    return `<tr data-search-row><td><strong>${escapeHtml(prediction.home_team)} — ${escapeHtml(prediction.away_team)}</strong></td>
      <td>${escapeHtml(formatDate(prediction.kickoff_at, { hour: '2-digit', minute: '2-digit' }))}</td>
      <td>${escapeHtml(mainReason)}</td><td><span class="badge neutral">Tahmin oluşturulmadı</span></td></tr>`;
  });
  const rejectedCompact = rejectedRows.length
    ? `<div class="scroll"><table><thead><tr><th>Maç</th><th>Saat</th><th>Ana neden</th><th>Durum</th></tr></thead><tbody>${rejectedRows.slice(0, 5).join('')}</tbody></table></div>
      ${rejectedRows.length > 5 ? `<details><summary>Tüm tahmin oluşturulmayan maçları göster (${rejectedRows.length})</summary><div class="details-body"><div class="scroll"><table><tbody>${rejectedRows.join('')}</tbody></table></div></div></details>` : ''}`
    : renderEmpty('—', 'Tahmin oluşturulmayan maç yok', 'Bugünkü maçların değerlendirmesi burada özetlenir.');
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

  const predictionDiagnosticSummary = predictionDiagnostics ? (() => {
    const current = (predictionDiagnostics.current ?? {}) as Record<string, unknown>;
    const historical = (predictionDiagnostics.historical ?? {}) as Record<string, unknown>;
    const thresholds = (predictionDiagnostics.thresholds ?? {}) as Record<string, unknown>;
    const topReasons = Array.isArray(current.topSkipReasons)
      ? current.topSkipReasons as Array<Record<string, unknown>> : [];
    const reasonText = topReasons.slice(0, 4).map((item) =>
      `${String(item.reason ?? 'UNKNOWN')} (${finiteNumber(item.count)})`).join(' · ') || 'Henüz skip nedeni yok';
    const histMax = finiteNumber(current.maximumHistoricalSettledSample);
    const histMin = finiteNumber(thresholds.minimumHistoricalSample);
    const histClass = histMax >= histMin ? 'ok' : 'partial';
    const analyzed = finiteNumber(current.withOddsAnalysis);
    const targets = finiteNumber(current.targets);
    return `<article class="card" style="margin-bottom:10px"><div class="row"><div><strong>Tahmin Tanı Merkezi</strong>
      <p>Canlı gate durumunu gösterir; neden PREDICT çıkmadığını doğrudan DB'den özetler.</p></div>
      <a class="top-chip" href="/api/predictions/diagnostics">Diagnostics API</a></div>
      <div class="grid" style="margin-top:12px">
        <article class="audit-mini"><small>Güncel hedef</small><strong>${targets}</strong><span>Odds analysis olan: ${analyzed}</span></article>
        <article class="audit-mini"><small>Prediction run</small><strong>${finiteNumber(current.predictionRuns)}</strong><span>PREDICT ${finiteNumber(current.predictRuns)} · GEÇ ${finiteNumber(current.skipRuns)}</span></article>
        <article class="audit-mini"><small>Historical evidence</small><strong><span class="badge ${histClass}">MAX N=${histMax}</span></strong><span>Resmi eşik N≥${histMin}</span></article>
        <article class="audit-mini"><small>Eligible history</small><strong>${finiteNumber(historical.eligible)}</strong><span>Toplam örnek ${finiteNumber(historical.total)}</span></article>
      </div>
      <p style="margin-top:12px"><strong>En sık GEÇ nedenleri:</strong> ${escapeHtml(reasonText)}</p></article>`;
  })() : '';

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

  const officialPredictionCount = predictions.filter((item) => String(item.decision) === 'PREDICT').length;
  const skipPredictionCount = predictions.filter((item) => String(item.decision) === 'SKIP').length;
  const pendingSettlementCount = predictionPerformance?.pending == null
    ? predictionHistory.filter((item) => item.outcome == null && String(item.decision) === 'PREDICT').length
    : finiteNumber(predictionPerformance.pending);
  const globalAuditRaw = String(predictionSelfAudit?.status ?? 'NOT_AVAILABLE');
  const globalAuditGuard = Boolean(predictionSelfAudit?.guardActive);
  const globalAuditStatus = globalAuditRaw === 'PAUSED' && !globalAuditGuard ? 'RECOVERY' : globalAuditRaw;
  const pausedSegments = predictionSelfAuditSegments.filter((item) => item.status === 'PAUSED' && item.guardActive).length;
  const watchSegments = predictionSelfAuditSegments.filter((item) => item.status === 'WATCH').length;
  const highRiskFactors = predictionSelfAuditRootCauses.filter((item) => item.status === 'HIGH_RISK').length;
  const watchFactors = predictionSelfAuditRootCauses.filter((item) => item.status === 'WATCH').length;
  const proposedRules = predictionAdaptiveRuleProposals.filter((item) => item.decision === 'PROPOSED').length;
  const providerQuickRows = sources.slice(0, 5).map((provider) => {
    const status = String(provider.status ?? 'unknown');
    const cls = status === 'healthy' ? 'ok' : ['degraded','waiting'].includes(status) ? 'partial' : status === 'blocked' ? 'bad' : 'neutral';
    return `<div class="health-row"><span>${escapeHtml(provider.provider)}</span><span class="badge ${cls}">${escapeHtml(status === 'waiting' ? 'bekliyor' : status)}</span></div>`;
  }).join('');
  const auditOverview = `<div class="audit-overview">
    <article class="audit-mini"><small>V1 · Genel Guard</small><strong>${escapeHtml(globalAuditStatus)}</strong><span>${globalAuditGuard ? 'Yeni resmi tahmin kapısı korunuyor' : 'Genel güvenlik katmanı'}</span></article>
    <article class="audit-mini"><small>V2 · Segment</small><strong>${pausedSegments} PAUSED · ${watchSegments} WATCH</strong><span>Lig ve market bazlı kontrol</span></article>
    <article class="audit-mini"><small>V3 · Kök Neden</small><strong>${highRiskFactors} HIGH RISK</strong><span>${watchFactors} izlenen faktör</span></article>
    <article class="audit-mini"><small>V4 · Öneriler</small><strong>${proposedRules} PROPOSED</strong><span>autoApply=false · insan onayı</span></article>
  </div>`;

  return shell(`<div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="/"><span class="brand-mark">B</span><span>BETAPP<small>Analysis Terminal</small></span></a>
      <div class="side-group"><div class="side-label">Terminal</div><nav class="side-nav" aria-label="Ana menü">
        <a class="active" href="#overview"><span class="nav-icon">⌂</span>Genel Bakış</a>
        <a href="#matches"><span class="nav-icon">◫</span>Maç Merkezi</a>
        <a href="#predictions"><span class="nav-icon">◎</span>Tahmin Merkezi</a>
        <a href="#odds-analysis"><span class="nav-icon">↗</span>Oran Analizi</a>
      </nav></div>
      <div class="side-group"><div class="side-label">Kontrol</div><nav class="side-nav">
        <a href="#prediction-self-audit"><span class="nav-icon">◇</span>Self‑Audit</a>
        <a href="#prediction-history"><span class="nav-icon">◷</span>Geçmiş & Performans</a>
        <a href="#sources"><span class="nav-icon">◉</span>Veri Kaynakları</a>
        <a href="#system"><span class="nav-icon">⚙</span>Sistem</a>
      </nav></div>
      <div class="sidebar-foot"><a class="system-pill" href="/health"><span class="live-dot ${healthyProviders ? '' : 'wait'}"></span><span><strong style="display:block;color:var(--text)">${escapeHtml(statusText)}</strong>Health endpoint</span></a></div>
    </aside>
    <div class="app-main">
      <header class="topbar"><div class="top-title"><strong>BETAPP Command Center</strong><span>Europe/Istanbul · 60 sn otomatik yenileme</span></div>
        <label class="search" aria-label="Panelde ara"><input data-global-search type="search" placeholder="Maç, lig, market veya provider ara…"></label>
        <div class="top-actions"><a class="top-chip" href="/api/predictions/today">Prediction API</a><a class="top-chip" href="/health">System Health</a></div>
      </header>
      <main class="content">
        <section class="command-hero" id="overview">
          <article class="hero-main"><p class="eyebrow">BETAPP UI V3 · Canlı analiz terminali</p><h1>Bugünün futbol verisi,<br>tek kontrol merkezinde.</h1>
            <p class="hero-copy">Fikstür, Nowgoal oran hareketleri, deterministik Prediction V1 ve Self‑Audit V1–V4 aynı panelde. Sistem tahmini ve performansı kaydeder; gerçek bahis yürütme yetkisi yoktur.</p></article>
          <article class="hero-status"><div class="hero-status-head"><strong>Sistem Durumu</strong><span class="badge ${healthyProviders ? 'ok' : 'partial'}">${healthyProviders ? 'ONLINE' : 'WAITING'}</span></div>
            <div class="hero-status-list">${providerQuickRows || '<div class="health-row"><span>Provider</span><b>Veri bekleniyor</b></div>'}
              <div class="health-row"><span>Self‑Audit</span><b>${escapeHtml(globalAuditStatus)}</b></div></div></article>
        </section>
        <section class="metrics" aria-label="Komuta özeti">
          <article class="metric"><span class="metric-label">Bugünkü maç</span><strong class="metric-value">${matches.length}</strong><span class="metric-note">Desteklenen turnuvalar</span></article>
          <article class="metric"><span class="metric-label">Canlı odds</span><strong class="metric-value">${odds.length}</strong><span class="metric-note">Nowgoal eşleşmiş seçim</span></article>
          <article class="metric"><span class="metric-label">Resmi tahmin</span><strong class="metric-value">${officialPredictionCount}</strong><span class="metric-note">GEÇ: ${skipPredictionCount}</span></article>
          <article class="metric ${pendingSettlementCount ? 'alert' : ''}"><span class="metric-label">Settlement bekliyor</span><strong class="metric-value">${pendingSettlementCount}</strong><span class="metric-note">Kilitlemiş PREDICT kayıtları</span></article>
          <article class="metric ${pausedSegments || highRiskFactors ? 'danger' : ''}"><span class="metric-label">Self‑Audit alarm</span><strong class="metric-value">${pausedSegments + highRiskFactors}</strong><span class="metric-note">Paused segment + high risk</span></article>
          <article class="metric"><span class="metric-label">Aktif kaynak</span><strong class="metric-value">${healthyProviders}</strong><span class="metric-note">Provider health</span></article>
        </section>
        ${waitingNotice}

        <section class="section" id="matches"><div class="section-title"><div><span class="section-kicker">Live workspace</span><h2>Maç Merkezi</h2><p>Bugünün maçları ile canlı oran akışı yan yana.</p></div></div>
          <div class="workspace"><article class="panel"><div class="panel-head"><h3>Bugünün maçları</h3><span class="count">${matches.length}</span></div><div class="panel-body match-list">${matchCards}</div></article>
            <article class="panel" id="odds"><div class="panel-head"><h3>Nowgoal oran panosu</h3><span class="count">${odds.length}</span></div><div class="panel-body odds-list">${oddsRows}</div></article></div></section>

        <section class="section" id="predictions"><div class="section-title"><div><span class="section-kicker">Prediction V1</span><h2>Tahmin Merkezi</h2><p>Resmi tahmin, aday tahmin ve GEÇ kararları.</p></div><span class="badge neutral">${predictions.length + predictionPreviews.length} kayıt</span></div>${predictionDiagnosticSummary}<div class="grid">${predictionCards}</div></section>

        <section class="section" id="odds-analysis"><div class="section-title"><div><span class="section-kicker">Historical similarity</span><h2>Tarihsel Oran Eşleşmeleri</h2><p>Kalabalık güncel maç listesi yerine, en fazla 4 güncel analiz ve her biri için en yakın 5 geçmiş oran profili.</p></div><a class="top-chip" href="/api/odds-analysis/similarity">Similarity API</a></div><div class="similarity-grid">${oddsSimilarityCards}</div></section>

        <section class="section" id="prediction-self-audit"><div class="section-title"><div><span class="section-kicker">Control center</span><h2>Self‑Audit Merkezi</h2><p>V1 genel guard · V2 segment kontrolü · V3 kök neden · V4 adaptive proposal.</p></div></div>
          ${auditOverview}${selfAuditSummary}${segmentAuditSummary}${rootCauseSummary}${adaptiveRuleSummary}</section>

        <section class="section" id="prediction-history"><div class="section-title"><div><span class="section-kicker">Journal</span><h2>Tahmin Geçmişi & Performance Lab</h2><p>Yalnız kilitli resmi kararlar performansa dahil edilir.</p></div></div>
          <div class="scroll"><table><thead><tr><th>Tarih</th><th>Maç</th><th>Karar</th><th>Score</th><th>Sonuç</th></tr></thead><tbody>${predictionHistoryRows}</tbody></table></div>
          <details><summary>Performance Lab</summary><div class="details-body">${performanceSummary}</div></details></section>

        <section class="section" id="sources"><div class="section-title"><div><span class="section-kicker">Data layer</span><h2>Veri Kaynakları</h2><p>Provider health ve son senkronizasyon durumu.</p></div></div><div class="source-grid">${providerCards}</div></section>

        <section class="section" id="system"><div class="section-title"><div><span class="section-kicker">Advanced</span><h2>Sistem & Model Laboratuvarı</h2><p>Qualification, dataset, backfill ve korner model doğrulaması.</p></div></div>
          <details><summary>Provider qualification matrisi</summary><div class="details-body">${matrix}</div></details>
          <details><summary>Dataset sağlığı ve backfill</summary><div class="details-body">${datasetHealth}<div class="scroll" style="margin-top:10px"><table><thead><tr><th>Lig</th><th>Sezon</th><th>Durum</th><th>Bulunan</th><th>Kaydedilen</th><th>Tam</th><th>Kısmi</th><th>Hata</th><th>Retry</th></tr></thead><tbody>${backfillRows}</tbody></table></div></div></details>
          <details><summary>Korner modeli ve doğrulama</summary><div class="details-body">${modelValidation}<div class="scroll" style="margin-top:10px"><table><thead><tr><th>Maç</th><th>Beklenen</th><th>O8.5</th><th>O9.5</th><th>O10.5</th><th>Veri kalitesi</th><th>Güven</th></tr></thead><tbody>${cornerRows}</tbody></table></div></div></details>
        </section>
        <footer class="footer"><span>BETAPP UI V3 · Prediction + Self‑Audit Control Center</span><span><a href="/health">Sistem sağlığı</a> · <a href="/api/odds/upcoming">Odds API</a> · <a href="/api/predictions/self-audit/proposals">V4 Proposals</a></span></footer>
      </main>
    </div>
  </div>`);
}

export function renderCornerDetail(data: Record<string, unknown>): string {
  const probabilities = (data.probabilities ?? {}) as Record<string, { over: number; under: number }>;
  const probabilityRows = Object.entries(probabilities).map(([line, value]) =>
    `<tr><td>${escapeHtml(line)}</td><td>${(value.over * 100).toFixed(1)}%</td><td>${(value.under * 100).toFixed(1)}%</td></tr>`).join('');
  return shell(`<div class="app-shell"><aside class="sidebar"><a class="brand" href="/"><span class="brand-mark">B</span><span>BETAPP<small>Match Detail</small></span></a>
    <div class="side-group"><div class="side-label">Navigasyon</div><nav class="side-nav"><a href="/"><span class="nav-icon">←</span>Ana Panele Dön</a><a class="active" href="#corner-detail"><span class="nav-icon">⌁</span>Korner Analizi</a></nav></div>
    <div class="sidebar-foot"><a class="system-pill" href="/health"><span class="live-dot"></span><span><strong style="display:block;color:var(--text)">BETAPP Online</strong>System Health</span></a></div></aside>
    <div class="app-main"><header class="topbar"><div class="top-title"><strong>Korner Analizi</strong><span>${escapeHtml(data.competition)}</span></div><div class="top-actions"><a class="top-chip" href="/">Ana Panel</a><a class="top-chip" href="/health">Health</a></div></header>
    <main class="content" id="corner-detail"><section class="command-hero"><article class="hero-main"><p class="eyebrow">Corner Engine V1</p><h1>${escapeHtml(data.home_team)}<br>— ${escapeHtml(data.away_team)}</h1>
      <p class="hero-copy">${escapeHtml(formatDate(data.kickoff_at, { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }))} · ${escapeHtml(data.competition)} · deterministik model çıktısı</p></article>
      <article class="hero-status"><div class="hero-status-head"><strong>Model Durumu</strong><span class="badge ok">${escapeHtml(data.distribution)}</span></div>
      <div class="hero-status-list"><div class="health-row"><span>Data Quality</span><b>${escapeHtml(data.data_quality_score ?? '—')}/100</b></div>
      <div class="health-row"><span>Model Confidence</span><b>${escapeHtml(data.model_confidence ?? '—')}/100</b></div></div></article></section>
      <section class="metrics"><article class="metric"><span class="metric-label">Ev korner beklentisi</span><strong class="metric-value">${finiteNumber(data.expected_home_corners).toFixed(2)}</strong></article>
      <article class="metric"><span class="metric-label">Deplasman</span><strong class="metric-value">${finiteNumber(data.expected_away_corners).toFixed(2)}</strong></article>
      <article class="metric"><span class="metric-label">Toplam</span><strong class="metric-value">${finiteNumber(data.expected_total_corners).toFixed(2)}</strong></article>
      <article class="metric"><span class="metric-label">Model güveni</span><strong class="metric-value">${escapeHtml(data.model_confidence ?? '—')}</strong><span class="metric-note">100 üzerinden</span></article></section>
      <section class="section"><div class="section-title"><div><span class="section-kicker">Probability table</span><h2>Üst / Alt Olasılıkları</h2><p>Model dağılımından hesaplanan korner çizgileri.</p></div></div>
      <article class="panel"><div class="panel-body"><div class="scroll"><table><thead><tr><th>Çizgi</th><th>Üst</th><th>Alt</th></tr></thead><tbody>${probabilityRows || '<tr><td colspan="3">Olasılık verisi yok.</td></tr>'}</tbody></table></div></div></article></section>
      <section class="section"><details><summary>Hesaplama ayrıntıları</summary><div class="details-body"><pre style="white-space:pre-wrap;overflow:auto;color:var(--muted);font-size:.75rem">${escapeHtml(JSON.stringify(data.calculation_details, null, 2))}</pre></div></details></section>
      <footer class="footer"><span>BETAPP UI V3 · Corner Engine V1</span><span><a href="/">Ana Panel</a> · <a href="/health">System Health</a></span></footer>
    </main></div></div>`, `${escapeHtml(data.home_team)} — ${escapeHtml(data.away_team)} | Korner Analizi`);
}
