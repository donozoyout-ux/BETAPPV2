import { liveSection } from './live/view.js';
import { translatePredictionGateReason } from './predictions/gate-inspector.js';

type DashboardData = { matches: Array<Record<string, unknown>>; providers: Array<Record<string, unknown>>;
  recentFinishedMatches?: Array<Record<string, unknown>>; archiveSummary?: Record<string, unknown> | null;
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
  oddsIntelligence?: Array<Record<string, unknown>>;
  predictionReviewCandidates?: Array<Record<string, unknown>>;
  predictionDiagnostics?: Record<string, unknown> | null;
  supportedCompetitions?: string[] };
type ValidationMetric = { count?: unknown; sample?: unknown; averagePredictedProbability?: unknown; actualHitRate?: unknown;
  absoluteCalibrationError?: unknown; mae?: unknown; brier?: unknown };
type DatasetAuditView = { totalMatches?: unknown; cornerCoverage?: { complete?: { rate?: unknown } };
  perCompetition?: unknown[]; perSeason?: unknown[] };
type ValidationView = { mae?: unknown; rmse?: unknown; brier?: unknown; logLoss?: unknown;
  calibration?: Record<string, ValidationMetric>; qualityPerformance?: Record<string, ValidationMetric>;
  confidencePerformance?: Record<string, ValidationMetric> };

export function escapeHtml(value: unknown): string {
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

export function formatDate(value: unknown, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', ...options });
}

function istanbulDateKey(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}


function translateReason(value: unknown): string {
  return translatePredictionGateReason(value);
}

export function gateValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(' / ');
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    if ('bookmakers' in item && 'states' in item) return `${item.bookmakers} şirket · ${item.states} ölçüm`;
    return Object.values(item).join(' / ');
  }
  return String(value ?? '—');
}

function renderGateInspector(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const inspector = value as Record<string, unknown>;
  const gates = Array.isArray(inspector.gates) ? inspector.gates as Array<Record<string, unknown>> : [];
  const status = String(inspector.overallStatus ?? 'REJECTED');
  const labels: Record<string, string> = { OFFICIAL: 'RESMİ TAHMİN', REVIEW: 'İNCELEME',
    REJECTED: 'REDDEDİLDİ', WAITING: 'VERİ BEKLENİYOR' };
  const rows = gates.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${escapeHtml(gateValue(item.current))}</td>
    <td>${escapeHtml(gateValue(item.required))}</td><td>${item.passed ? '✅' : '❌'}</td></tr>`).join('');
  const prompt = status === 'OFFICIAL' ? 'Neden resmi tahmin oluştu?' : 'Neden resmi tahmin yok?';
  const evidence = inspector.evidence && typeof inspector.evidence === 'object'
    ? inspector.evidence as Record<string, unknown> : null;
  const evidenceText = evidence ? `<p class="evidence-note">Yardımcı kanıt · Geçmiş oran benzerleri: ${escapeHtml(evidence.pastTwinsCount ?? 0)}
    · Kanıt gücü: ${escapeHtml(evidence.evidenceStrength ?? 'VERY_LOW')} · Odds route: ${escapeHtml(evidence.oddsRouteStrength ?? 'WEAK')}
    · Prediction V1 kararını değiştirmez.</p>` : '';
  return `<div class="gate-inspector"><div class="row"><strong>Prediction Gate Inspector</strong>
    <span class="badge ${status === 'OFFICIAL' ? 'ok' : status === 'REVIEW' ? 'partial' : 'neutral'}">${escapeHtml(labels[status] ?? status)}</span></div>
    <div class="scroll"><table><thead><tr><th>Kontrol</th><th>Mevcut</th><th>Gerekli</th><th>Sonuç</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p><strong>${prompt}</strong> ${escapeHtml(inspector.summary)}</p>${evidenceText}</div>`;
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

export function translateMarket(value: unknown): string {
  const labels: Record<string, string> = {
    MATCH_RESULT: 'Maç Sonucu', '1X2': 'Maç Sonucu', TOTAL_GOALS: 'Toplam Gol',
    TOTAL_CORNERS: 'Toplam Korner', ASIAN_HANDICAP: 'Asya Handikapı',
  };
  return labels[String(value ?? '').toUpperCase()] ?? String(value ?? '—');
}

function translateCompetitionKey(value: unknown): string {
  const labels: Record<string, string> = {
    PremierLeague: 'Premier League', LaLiga: 'La Liga', Bundesliga: 'Bundesliga',
    SerieA: 'Serie A', Ligue1: 'Ligue 1', SuperLig: 'Süper Lig',
    ChampionsLeague: 'Şampiyonlar Ligi', EuropaLeague: 'Avrupa Ligi',
    ConferenceLeague: 'Konferans Ligi', BrasileiraoSerieA: 'Brasileirão Série A',
    WorldCup: 'FIFA Dünya Kupası', EURO: 'EURO',
    UefaNationsLeagueA: 'UEFA Uluslar Ligi A', UefaNationsLeagueB: 'UEFA Uluslar Ligi B',
    UefaNationsLeagueC: 'UEFA Uluslar Ligi C', UefaNationsLeagueD: 'UEFA Uluslar Ligi D',
    WorldCupQualificationUEFA: 'Dünya Kupası Avrupa Elemeleri',
    InternationalFriendlies: 'Milli Takım Hazırlık Maçları',
  };
  return labels[String(value ?? '')] ?? String(value ?? '—');
}

export function translateSelection(value: unknown): string {
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

function optionalNumber(value: unknown, suffix = ''): string {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : `${Number(value)}${suffix}`;
}

export function optionalOdds(value: unknown): string {
  return value == null || !Number.isFinite(Number(value)) || Number(value) <= 1 ? '—' : Number(value).toFixed(2);
}

export function objectValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function shell(content: string, title = 'BETAPP — Futbol Analiz Terminali'): string {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#07110d"><meta http-equiv="refresh" content="60"><title>${escapeHtml(title)}</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%230b1811'/%3E%3Cpath d='M17 16h18c9 0 14 4 14 11 0 4-2 7-6 9 5 1 8 5 8 10 0 8-6 12-16 12H17V16zm11 9v8h7c3 0 5-1 5-4s-2-4-5-4h-7zm0 17v8h8c4 0 6-1 6-4s-2-4-6-4h-8z' fill='%237cf6a3'/%3E%3C/svg%3E">
  <style>
  :root{color-scheme:dark;--bg:#080b10;--sidebar:#0b0f15;--panel:#10151d;--panel-2:#151c26;--panel-3:#1a2330;--line:#25303d;--line-soft:#1b2531;--green:#61e89a;--green-2:#25c976;--cyan:#57d6ed;--blue:#75a7ff;--amber:#f5bd55;--red:#ee777d;--text:#edf3f8;--muted:#91a0ae;--muted-2:#647280;--shadow:0 12px 34px rgba(0,0,0,.20);--sidebar-w:246px}
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body:before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(circle at 72% -15%,rgba(87,214,237,.065),transparent 34%)}
  a{color:inherit;text-decoration:none}button,input{font:inherit}.app-shell{min-height:100vh}.sidebar{position:fixed;inset:0 auto 0 0;width:var(--sidebar-w);padding:18px 14px;border-right:1px solid var(--line-soft);background:rgba(11,15,21,.97);backdrop-filter:blur(22px);z-index:30}.brand{display:flex;align-items:center;gap:11px;padding:7px 8px 20px;font-weight:950;letter-spacing:-.04em}.brand-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:linear-gradient(145deg,var(--green),#47df82);color:#051108;box-shadow:0 0 0 6px rgba(116,245,156,.07)}.brand small{display:block;color:var(--muted);font-size:.63rem;font-weight:750;letter-spacing:.13em;text-transform:uppercase}.side-group{margin-top:14px}.side-label{padding:0 10px 7px;color:var(--muted-2);font-size:.66rem;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.side-nav{display:grid;gap:4px}.side-nav a{display:flex;align-items:center;gap:10px;padding:10px 11px;border-radius:10px;color:var(--muted);font-size:.86rem;font-weight:700;transition:.18s}.side-nav a:hover,.side-nav a.active{background:var(--panel-2);color:var(--text)}.side-nav .nav-icon{width:20px;text-align:center;color:var(--cyan)}.sidebar-foot{position:absolute;left:14px;right:14px;bottom:18px}.system-pill{display:flex;align-items:center;gap:10px;padding:11px;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--muted);font-size:.78rem}.live-dot{width:8px;height:8px;border-radius:50%;background:var(--green-2);box-shadow:0 0 0 5px rgba(49,216,120,.10)}.live-dot.wait{background:var(--amber);box-shadow:0 0 0 5px rgba(255,201,92,.09)}
  .app-main{margin-left:var(--sidebar-w);min-width:0}.topbar{position:sticky;top:0;z-index:22;height:66px;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:0 28px;border-bottom:1px solid var(--line-soft);background:rgba(8,11,16,.90);backdrop-filter:blur(18px)}.top-title strong{display:block;font-size:.96rem}.top-title span{color:var(--muted);font-size:.72rem}.search{position:relative;width:min(430px,42vw)}.search input{width:100%;height:38px;padding:0 14px 0 36px;border:1px solid var(--line);border-radius:11px;outline:none;background:var(--panel);color:var(--text)}.search input:focus{border-color:rgba(87,214,237,.5);box-shadow:0 0 0 3px rgba(87,214,237,.07)}.search:before{content:"⌕";position:absolute;left:13px;top:8px;color:var(--muted)}.top-actions{display:flex;align-items:center;gap:8px}.top-chip{padding:7px 10px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--muted);font-size:.74rem;font-weight:750}.mobile-menu{display:none}
  .content{width:min(1500px,calc(100% - 44px));margin:auto;padding:26px 0 64px}.command-hero{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,.7fr);gap:16px;margin-bottom:16px}.hero-main,.hero-status{border:1px solid var(--line);border-radius:12px;background:linear-gradient(145deg,rgba(17,22,31,.98),rgba(11,15,21,.98));box-shadow:var(--shadow)}.hero-main{position:relative;overflow:hidden;padding:25px}.hero-main:after{content:"";position:absolute;right:-60px;top:-90px;width:220px;height:220px;border-radius:50%;background:rgba(87,214,237,.045)}.eyebrow{margin:0 0 7px;color:var(--cyan);font-size:.69rem;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.hero-main h1{margin:0;font-size:clamp(1.8rem,3.2vw,3.1rem);line-height:1.03;letter-spacing:-.055em}.hero-copy{max-width:720px;margin:11px 0 0;color:var(--muted);font-size:.88rem}.hero-status{padding:20px}.hero-status-head{display:flex;align-items:center;justify-content:space-between}.hero-status strong{font-size:.86rem}.hero-status-list{display:grid;gap:9px;margin-top:16px}.health-row{display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--muted);font-size:.78rem}.health-row b{color:var(--text);font-weight:800}
  .metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin:14px 0}.metric{min-height:96px;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}.metric-label{color:var(--muted);font-size:.64rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.metric-value{display:block;margin-top:8px;font:900 1.55rem/1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:-.04em}.metric-note{display:block;margin-top:7px;color:var(--muted-2);font-size:.68rem}.metric.alert .metric-value{color:var(--amber)}.metric.danger .metric-value{color:var(--red)}
  .notice{display:flex;gap:12px;padding:13px 15px;margin:12px 0;border:1px solid rgba(255,201,92,.22);border-radius:13px;background:rgba(255,201,92,.055)}.notice-mark{color:var(--amber);font-weight:900}.notice strong{display:block}.notice p{margin:2px 0 0;color:var(--muted);font-size:.8rem}.section{scroll-margin-top:84px;margin-top:18px}.section-title{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin:26px 0 10px}.section-title h2{margin:0;font-size:1.05rem;letter-spacing:-.02em}.section-title p{margin:3px 0 0;color:var(--muted);font-size:.76rem}.section-kicker{color:var(--green);font-size:.63rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
  .workspace{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.35fr);gap:12px}.panel{min-width:0;border:1px solid var(--line);border-radius:17px;background:var(--panel);box-shadow:var(--shadow);overflow:hidden}.panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 17px;border-bottom:1px solid var(--line-soft)}.panel-head h3,.panel-head h2{margin:0;font-size:.9rem}.panel-body{padding:8px}.count{padding:4px 8px;border-radius:999px;background:rgba(116,245,156,.09);color:var(--green);font-size:.68rem;font-weight:850}.match-list,.odds-list{display:grid;gap:4px}.match{display:grid;grid-template-columns:60px minmax(0,1fr) auto;align-items:center;gap:12px;padding:11px;border:1px solid transparent;border-radius:11px;transition:.16s}.match:hover,.odd:hover{background:var(--panel-2);border-color:var(--line)}.match-time{font-size:.9rem;font-weight:900;font-variant-numeric:tabular-nums}.match-time small,.teams small{display:block;color:var(--muted);font-size:.67rem;font-weight:650}.teams{min-width:0;font-weight:780}.teams span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{padding:4px 7px;border-radius:7px;background:#17291f;color:var(--muted);font-size:.64rem;font-weight:850;text-transform:uppercase}.status.live{background:rgba(255,115,115,.12);color:var(--red)}.odd{display:grid;grid-template-columns:minmax(175px,1.45fr) minmax(120px,.9fr) 66px 72px;align-items:center;gap:10px;padding:10px;border:1px solid transparent;border-radius:11px}.odd-match,.odd-market{min-width:0}.odd-match{font-weight:760}.odd-match span,.odd-market span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.odd-match small,.odd-market small{display:block;color:var(--muted);font-size:.66rem}.price{display:inline-flex;justify-content:center;padding:7px 8px;border-radius:8px;background:var(--green);color:#07110d;font-weight:950;font-variant-numeric:tabular-nums}.movement{font-size:.72rem;font-weight:850;text-align:right}.movement.up{color:var(--green)}.movement.down{color:var(--red)}.movement.flat{color:var(--muted)}
  .grid,.source-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:10px}.card,.source{padding:15px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}.card:hover{border-color:#31503c}.row,.source-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.card p,.source p{margin:8px 0 0;color:var(--muted);font-size:.76rem}.source-name{font-weight:850;text-transform:capitalize}.badge{display:inline-flex;align-items:center;padding:4px 7px;border-radius:999px;font-size:.62rem;font-weight:900;text-transform:uppercase;white-space:nowrap}.ok{background:rgba(49,216,120,.11);color:var(--green)}.partial{background:rgba(255,201,92,.11);color:var(--amber)}.bad{background:rgba(255,115,115,.11);color:#ff9898}.neutral{background:#1a2d22;color:var(--muted)}
  .state-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.state-card{position:relative;min-width:0;padding:15px;border:1px solid var(--line);border-radius:11px;background:var(--panel);overflow:hidden}.state-card:before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--cyan)}.state-card.official:before{background:var(--green)}.state-card.review:before{background:var(--amber)}.state-card.rejected:before{background:var(--red)}.state-card-head{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:.67rem}.state-label{font-size:.64rem;font-weight:950;letter-spacing:.1em;color:var(--cyan)}.official .state-label{color:var(--green)}.review .state-label{color:var(--amber)}.rejected .state-label{color:var(--red)}.state-card>small{display:block;margin-top:15px;color:var(--muted);font-size:.68rem}.state-card h3{margin:3px 0 0;font-size:.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.state-card h3 span{color:var(--muted-2)}.state-market{min-height:21px;margin:13px 0 0!important;color:var(--text)!important;font-weight:800}.state-metrics{display:flex;gap:5px;flex-wrap:wrap;margin-top:11px}.state-metrics span{padding:5px 7px;border:1px solid var(--line-soft);border-radius:7px;color:var(--muted);font-size:.65rem}.state-metrics b{color:var(--text);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.state-reason{min-height:36px}.not-official{display:block;margin-top:8px;color:var(--amber);font-size:.72rem}.unavailable{font-style:italic}.analysis-link,.table-action{display:inline-flex;align-items:center;gap:7px;margin-top:10px;color:var(--cyan);font-size:.7rem;font-weight:850}.analysis-link:hover,.table-action:hover{text-decoration:underline}.empty-state{display:flex;min-height:236px;flex-direction:column;justify-content:center}.empty-state strong{margin-top:12px}.filterbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:9px}.filter-buttons{display:flex;gap:5px;flex-wrap:wrap}.filter-button{padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--muted);cursor:pointer;font-size:.68rem;font-weight:800}.filter-button.active{border-color:rgba(87,214,237,.45);background:rgba(87,214,237,.08);color:var(--cyan)}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-variant-numeric:tabular-nums}.table-action{margin:0;white-space:nowrap}.match-table td:nth-child(4),.match-table td:nth-child(5),.match-table td:nth-child(6){color:var(--cyan);font-weight:850}.hidden-by-state{display:none!important}
  .audit-overview{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:10px}.audit-mini{padding:14px;border:1px solid var(--line);border-radius:13px;background:var(--panel)}.audit-mini small{display:block;color:var(--muted);font-size:.65rem;font-weight:850;letter-spacing:.07em;text-transform:uppercase}.audit-mini strong{display:block;margin-top:6px;font-size:1.05rem}.audit-mini span{display:block;margin-top:4px;color:var(--muted-2);font-size:.69rem}
  .evidence-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.evidence-box{padding:11px;border:1px solid var(--line-soft);border-radius:11px;background:rgba(7,17,13,.48)}.evidence-box small{display:block;color:var(--muted-2);font-size:.62rem;font-weight:850;text-transform:uppercase;letter-spacing:.06em}.evidence-box strong{display:block;margin-top:4px;font-size:1rem}.result-map{display:grid;gap:8px;padding:13px 16px;border-top:1px solid var(--line-soft);background:rgba(7,17,13,.28)}.result-map-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.result-map-head strong{font-size:.78rem}.result-map-head span{color:var(--muted);font-size:.65rem}.result-map-row{display:grid;grid-template-columns:minmax(120px,1fr) 1.6fr 54px;gap:9px;align-items:center}.result-map-label{font-size:.7rem;font-weight:750}.result-track{height:8px;border-radius:999px;background:var(--panel-3);overflow:hidden}.result-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--green-2),var(--green))}.result-map-value{text-align:right;font-size:.7rem;font-weight:900}.evidence-note{margin:10px 0 0;color:var(--muted);font-size:.72rem}
  .similarity-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.similarity-card{overflow:hidden;border:1px solid var(--line);border-radius:16px;background:var(--panel);box-shadow:var(--shadow)}.similarity-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px;border-bottom:1px solid var(--line-soft)}.similarity-head h3{margin:0;font-size:.92rem}.similarity-head p{margin:4px 0 0;color:var(--muted);font-size:.7rem}.similarity-current{padding:14px 16px;background:linear-gradient(145deg,rgba(116,245,156,.045),transparent)}.similarity-market{font-weight:900}.similarity-odds{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap}.similarity-arrow{color:var(--muted-2)}.similarity-price{font-size:1.15rem;font-weight:950;font-variant-numeric:tabular-nums}.similarity-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.similar-list{border-top:1px solid var(--line-soft)}.similar-list-title{padding:10px 14px;color:var(--muted);font-size:.66rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.similar-row{display:grid;grid-template-columns:28px minmax(0,1fr) 105px 95px;align-items:center;gap:9px;padding:10px 14px;border-top:1px solid var(--line-soft)}.similar-rank{display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:var(--panel-3);color:var(--green);font-size:.66rem;font-weight:900}.similar-teams{min-width:0}.similar-teams strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.76rem}.similar-teams span{display:block;color:var(--muted);font-size:.64rem}.similar-history-odds{font-size:.72rem;font-weight:800;font-variant-numeric:tabular-nums}.similar-history-odds small{display:block;color:var(--muted);font-size:.61rem;font-weight:650}.similar-result{text-align:right}.similar-result small{display:block;margin-top:3px;color:var(--muted);font-size:.6rem}
  details{margin-top:9px;border:1px solid var(--line);border-radius:13px;background:rgba(13,27,20,.82)}summary{cursor:pointer;list-style:none;padding:14px 16px;font-weight:800;font-size:.82rem}summary::-webkit-details-marker{display:none}summary:after{content:"+";float:right;color:var(--green)}details[open] summary:after{content:"−"}.details-body{padding:0 12px 12px}.scroll{overflow:auto;border:1px solid var(--line-soft);border-radius:11px}table{width:100%;border-collapse:collapse;background:var(--panel);font-size:.75rem}th,td{padding:10px 11px;border-bottom:1px solid var(--line-soft);text-align:left;vertical-align:top;white-space:nowrap}th{color:var(--muted);font-size:.61rem;letter-spacing:.07em;text-transform:uppercase}tr:last-child td{border-bottom:0}.empty{display:flex;align-items:center;gap:13px;min-height:155px;padding:20px;color:var(--muted)}.empty-icon{display:grid;place-items:center;flex:0 0 auto;width:44px;height:44px;border:1px solid var(--line);border-radius:12px;background:var(--panel-2);color:var(--green)}.empty strong{color:var(--text)}.empty p{max-width:420px;margin:3px 0 0;font-size:.78rem}
  .detail-content{display:grid;gap:14px}.match-hero,.detail-panel,.odds-strip,.technical-records{min-width:0;border:1px solid var(--line);border-radius:15px;background:var(--panel);box-shadow:var(--shadow)}.match-hero{padding:20px;background:linear-gradient(135deg,rgba(23,32,43,.98),rgba(10,15,21,.98))}.match-meta{display:flex;justify-content:center;gap:9px;flex-wrap:wrap;color:var(--muted);font-size:.7rem}.match-meta span+span:before{content:"·";margin-right:9px;color:var(--muted-2)}.scoreboard{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:24px;margin:22px auto;text-align:center}.scoreboard>strong{font-size:clamp(1.05rem,2vw,1.65rem);letter-spacing:-.035em}.scoreboard>b{padding:10px 15px;border:1px solid var(--line);border-radius:12px;background:var(--bg);color:var(--cyan);font:950 1.25rem/1 ui-monospace,SFMono-Regular,Consolas,monospace}.hero-gate{display:grid;justify-items:center;gap:5px;padding-top:15px;border-top:1px solid var(--line-soft);text-align:center}.hero-gate>strong{font-size:.92rem}.hero-gate p{max-width:750px;margin:0;color:var(--muted);font-size:.76rem}.odds-strip{display:grid;grid-template-columns:minmax(150px,1fr) repeat(3,minmax(85px,.45fr));gap:8px;align-items:stretch;padding:10px}.odds-strip>div:first-child{display:flex;flex-direction:column;justify-content:center;padding:8px}.odds-strip>div:first-child small{margin-top:3px;color:var(--muted)}.one-x-two{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;padding:11px 13px;border:1px solid var(--line-soft);border-radius:10px;background:var(--panel-2)}.one-x-two span{color:var(--muted);font-weight:850}.one-x-two strong{text-align:right;font:950 1.05rem ui-monospace,SFMono-Regular,Consolas,monospace}.one-x-two small{color:var(--green);font-size:.61rem}.detail-grid{display:grid;gap:14px;align-items:start}.core-grid{grid-template-columns:minmax(0,7fr) minmax(290px,5fr)}.evidence-grid{grid-template-columns:minmax(0,8fr) minmax(300px,4fr)}.split-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.detail-panel{padding:17px}.detail-panel h2{margin:2px 0 13px;font-size:1rem;letter-spacing:-.02em}.detail-title,.why-head,.route-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.detail-title>span{color:var(--muted);font:800 .7rem ui-monospace,SFMono-Regular,Consolas,monospace}.candidate-market{padding:13px;border-left:3px solid var(--green);border-radius:0 10px 10px 0;background:rgba(97,232,154,.06);font-size:1.03rem;font-weight:900}.detail-metrics,.corner-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:12px}.detail-metric{min-width:0;padding:10px;border:1px solid var(--line-soft);border-radius:9px;background:var(--panel-2)}.detail-metric small{display:block;color:var(--muted);font-size:.62rem}.detail-metric strong{display:block;margin-top:4px;overflow-wrap:anywhere;font-size:.8rem}.why-list{display:grid;gap:6px}.why-list>div{display:flex;justify-content:space-between;gap:12px;padding:9px 10px;border:1px solid var(--line-soft);border-radius:9px;color:var(--muted);font-size:.7rem}.why-list b{color:var(--text);font-size:.62rem;white-space:nowrap}.why-list p{color:var(--muted)}.gate-result{font-size:.63rem;font-weight:900}.gate-result.pass{color:var(--green)}.gate-result.fail{color:var(--amber)}.gate-table td:last-child{max-width:330px;white-space:normal}.detail-empty{display:grid;place-items:center;min-height:125px;padding:20px;border:1px dashed var(--line);border-radius:11px;text-align:center}.detail-empty strong{font-size:.83rem}.detail-empty p{max-width:440px;margin:5px 0 0;color:var(--muted);font-size:.72rem}.route-head p{margin:4px 0 0;color:var(--muted);font-size:.68rem}.route-track{display:flex;align-items:center;gap:6px;overflow-x:auto;padding:9px 0 3px}.route-point{flex:1 0 88px;padding:9px;border:1px solid var(--line-soft);border-radius:9px;background:var(--panel-2);text-align:center}.route-point small,.route-point span{display:block;color:var(--muted);font-size:.58rem}.route-point strong{display:block;margin:3px 0;font:900 .88rem ui-monospace,SFMono-Regular,Consolas,monospace}.route-arrow{color:var(--green)}.detail-disclaimer{margin:11px 0 0;color:var(--muted);font-size:.66rem}.twins-summary{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px;color:var(--muted);font-size:.7rem}.twins-summary strong{color:var(--text)}.twin-list{display:grid;gap:6px}.twin-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;align-items:center;gap:10px;padding:10px;border:1px solid var(--line-soft);border-radius:9px}.twin-row div:first-child{min-width:0}.twin-row strong,.twin-row small{display:block}.twin-row div:first-child strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.75rem}.twin-row small{color:var(--muted);font-size:.6rem}.result-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.result-cards article{padding:11px;border:1px solid var(--line-soft);border-radius:10px;background:var(--panel-2)}.result-cards small,.result-cards strong,.result-cards span{display:block}.result-cards small,.result-cards span{color:var(--muted);font-size:.62rem}.result-cards b{display:block;margin-top:5px;color:var(--green);font:900 1.05rem ui-monospace,SFMono-Regular,Consolas,monospace}.conflict-grid{display:grid;gap:6px}.conflict-grid>div{display:flex;justify-content:space-between;gap:12px;padding:10px;border:1px solid var(--line-soft);border-radius:9px;color:var(--muted);font-size:.7rem}.conflict-grid strong{font-size:.63rem}.signal-support{color:var(--green)}.signal-conflict{color:var(--red)}.signal-neutral{color:var(--amber)}.signal-unavailable{color:var(--muted)}.analysis-summary{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px}.analysis-summary span{padding:7px 9px;border:1px solid var(--line-soft);border-radius:8px;color:var(--muted);font-size:.65rem}.analysis-summary b{color:var(--text)}.stats-period+.stats-period{margin-top:12px}.stats-period>strong{display:block;margin-bottom:7px;color:var(--cyan);font-size:.7rem}.stats-period>small{display:block;margin-top:6px;color:var(--muted-2);font-size:.6rem}.stats-list{display:grid;gap:5px}.stat-row{display:grid;grid-template-columns:55px minmax(0,1fr) 55px;gap:7px;padding:8px;border:1px solid var(--line-soft);border-radius:8px;text-align:center}.stat-row span{color:var(--muted);font-size:.7rem}.stat-row b{font:800 .72rem ui-monospace,SFMono-Regular,Consolas,monospace}.technical-records{margin-top:0}.detail-section{scroll-margin-top:82px}
  .why-list span small{display:block;margin:2px 0 0 17px;color:var(--muted-2);font-size:.58rem}.why-list b{align-self:center}
  .footer{display:flex;justify-content:space-between;gap:18px;margin-top:28px;padding:18px 0;border-top:1px solid var(--line);color:var(--muted-2);font-size:.7rem}.footer a{color:var(--green)}.hidden-by-search{display:none!important}
  @media(max-width:1180px){:root{--sidebar-w:215px}.metrics{grid-template-columns:repeat(3,1fr)}.state-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.command-hero{grid-template-columns:1fr}.audit-overview{grid-template-columns:repeat(2,1fr)}.similarity-grid{grid-template-columns:1fr}.detail-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.evidence-grid{grid-template-columns:minmax(0,7fr) minmax(280px,5fr)}}
  @media(max-width:860px){.sidebar{display:none}.app-main{margin-left:0}.mobile-menu{display:inline-flex}.topbar{padding:0 16px}.search{width:min(390px,58vw)}.content{width:min(100% - 26px,1500px)}.workspace{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}.core-grid,.evidence-grid,.split-grid{grid-template-columns:1fr}}
  @media(max-width:560px){.evidence-strip{grid-template-columns:1fr}.result-map-row{grid-template-columns:minmax(95px,1fr) 1.3fr 46px}.top-title{display:none}.top-actions .top-chip{display:none}.search{width:100%}.topbar{gap:10px}.content{width:min(100% - 18px,1500px);padding-top:16px}.hero-main,.hero-status{border-radius:12px}.hero-main{padding:19px}.metrics,.state-grid{grid-template-columns:1fr}.metrics{gap:7px}.metric{min-height:82px;padding:12px}.metric-value{font-size:1.4rem}.audit-overview{grid-template-columns:1fr}.section-title,.filterbar{align-items:flex-start;flex-direction:column;gap:6px}.odd{grid-template-columns:minmax(0,1fr) 62px}.odd-market,.movement{display:none}.match{grid-template-columns:55px minmax(0,1fr)}.match .status{display:none}.grid,.source-grid{grid-template-columns:1fr}.similar-row{grid-template-columns:24px minmax(0,1fr) 86px}.similar-result{grid-column:2/4;text-align:left}.footer{flex-direction:column}.match-hero,.detail-panel{padding:13px}.scoreboard{gap:8px;margin:17px auto}.scoreboard>strong{font-size:.9rem}.scoreboard>b{padding:8px;font-size:.9rem}.odds-strip{grid-template-columns:repeat(3,minmax(0,1fr))}.odds-strip>div:first-child{grid-column:1/-1}.one-x-two{grid-template-columns:auto 1fr;padding:9px}.one-x-two small{grid-column:1/-1}.detail-metrics,.corner-metrics,.result-cards{grid-template-columns:1fr 1fr}.twin-row{grid-template-columns:minmax(0,1fr) auto}.twin-row>:nth-child(n+3){grid-column:auto}.detail-title,.why-head{align-items:flex-start}.gate-table{min-width:670px}}
  </style></head><body>${content}
  <script>
  (()=>{const input=document.querySelector('[data-global-search]');if(input)input.addEventListener('input',()=>{const q=input.value.trim().toLocaleLowerCase('tr-TR');document.querySelectorAll('[data-search-row]').forEach(el=>{const hit=!q||el.textContent.toLocaleLowerCase('tr-TR').includes(q);el.classList.toggle('hidden-by-search',!hit)})});document.querySelectorAll('[data-state-filter]').forEach(button=>button.addEventListener('click',()=>{const state=button.dataset.stateFilter;document.querySelectorAll('[data-state-filter]').forEach(item=>item.classList.toggle('active',item===button));document.querySelectorAll('[data-match-state]').forEach(row=>row.classList.toggle('hidden-by-state',state!=='ALL'&&row.dataset.matchState!==state))}));const links=[...document.querySelectorAll('.side-nav a[href^="#"]')];const obs=new IntersectionObserver(entries=>{for(const e of entries){if(e.isIntersecting){links.forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+e.target.id))}}},{rootMargin:'-25% 0px -65% 0px'});document.querySelectorAll('main section[id]').forEach(s=>obs.observe(s));})();
  </script></body></html>`;
}
export function renderDashboard(data: DashboardData): string {
  const audit = (data.datasetAudit?.report ?? null) as DatasetAuditView | null;
  const validation = (data.validation?.report ?? null) as ValidationView | null;
  const matches = data.matches ?? [];
  const recentFinishedMatches = data.recentFinishedMatches ?? [];
  const archiveSummary = data.archiveSummary ?? {};
  const todayKey = istanbulDateKey(new Date());
  const todayMatches = matches.filter((match) => istanbulDateKey(match.kickoff_at) === todayKey);
  const odds = data.odds ?? [];
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
  const oddsIntelligence = data.oddsIntelligence ?? [];
  const predictionDiagnostics = data.predictionDiagnostics;
  const supportedCompetitions = data.supportedCompetitions ?? [];
  const predictionThresholds = (predictionDiagnostics?.thresholds ?? {}) as Record<string, unknown>;
  const predictionHistorical = (predictionDiagnostics?.historical ?? {}) as Record<string, unknown>;
  const requiredHistoricalSample = finiteNumber(predictionThresholds.minimumHistoricalSample);
  const historicalExampleRaw = predictionHistorical.eligible ?? predictionHistorical.total;
  const historicalExampleCount = finiteNumber(historicalExampleRaw);
  const archivedOddsMatchCount = finiteNumber(archiveSummary.finished_matches_with_odds);
  const preKickoffSnapshotRaw = archiveSummary.pre_kickoff_snapshots;
  const preKickoffSnapshotCount = finiteNumber(preKickoffSnapshotRaw);
  const healthyProviders = data.providers.filter((provider) => provider.status === 'healthy').length;
  const percent = (value: unknown) => `${(finiteNumber(value) * 100).toFixed(1)}%`;
  const sources = data.providers;
  const allSourcesHealthy = sources.length > 0 && healthyProviders === sources.length;
  const statusText = sources.length === 0 ? 'Durum bilinmiyor'
    : healthyProviders === sources.length ? 'Tüm kaynaklar sağlıklı'
    : healthyProviders > 0 ? `${healthyProviders}/${sources.length} kaynak sağlıklı` : 'Kaynaklar kontrol edilmeli';
  const gateStatus = (item: Record<string, unknown>) => String(
    (item.predictionGate as Record<string, unknown> | undefined)?.overallStatus ?? '');
  const reviewPredictions = predictionReviewCandidates.filter((item) => gateStatus(item) === 'REVIEW');

  const matchCards = matches.length ? matches.map((match) => {
    const status = String(match.status ?? 'scheduled');
    const matchId = String(match.id ?? '');
    const matchOdds = odds.filter((odd) => String(odd.match_id ?? '') === matchId).length;
    const officialPrediction = predictions.find((prediction) => String(prediction.match_id ?? '') === matchId);
    const previewPrediction = predictionPreviews.find((prediction) => String(prediction.match_id ?? '') === matchId);
    const reviewCandidate = reviewPredictions.find((item) => String(item.matchId ?? '') === matchId);
    const prediction = officialPrediction ?? previewPrediction;
    const inspectorStatus = String((prediction?.predictionGate as Record<string, unknown> | undefined)?.overallStatus ?? '');
    const decision = inspectorStatus === 'OFFICIAL' ? 'Resmi tahmin'
      : inspectorStatus === 'WAITING' ? 'Veri bekleniyor'
      : inspectorStatus === 'REJECTED' ? 'Reddedildi'
      : reviewCandidate ? 'İnceleme adayı'
      : prediction && String(prediction.decision) === 'SKIP' ? 'Tahmin yok' : 'Henüz değerlendirilmedi';
    const actionHref = matchId ? `/matches/${encodeURIComponent(matchId)}` : '#odds-analysis';
    return `<article class="match" data-search-row><div class="match-time">${escapeHtml(formatDate(match.kickoff_at, { hour: '2-digit', minute: '2-digit' }))}<small>${escapeHtml(formatDate(match.kickoff_at, { day: '2-digit', month: 'short' }))}</small></div>
      <div class="teams"><span>${escapeHtml(match.home_team)} — ${escapeHtml(match.away_team)}</span><small>${escapeHtml(match.league)} · ${matchOdds} oran kaydı · ${escapeHtml(decision)}</small></div>
      <div style="display:flex;align-items:center;gap:6px"><span class="status ${status === 'live' ? 'live' : ''}">${escapeHtml(status === 'live' ? 'Canlı' : status === 'scheduled' ? 'Planlandı' : status)}</span><a class="status" href="${escapeHtml(actionHref)}">ANALİZ</a></div></article>`;
  }).join('') : renderEmpty('⌁', 'Yaklaşan maç görünmüyor', 'Önümüzdeki 7 gün içinde desteklenen liglerde maç yoksa arşiv ve geçmiş analizler aşağıda gösterilmeye devam eder.');
  const upcomingLeagueCounts = [...matches.reduce((map, match) => {
    const league = String(match.league ?? 'Diğer');
    map.set(league, (map.get(league) ?? 0) + 1);
    return map;
  }, new Map<string, number>()).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'tr'));
  const upcomingLeagueSummary = upcomingLeagueCounts.length
    ? `<div class="similarity-meta" style="margin:0 0 12px">${upcomingLeagueCounts.map(([league, count]) =>
        `<span class="badge neutral">${escapeHtml(league)} · ${count} maç</span>`).join('')}</div>`
    : '';

  const recentFinishedCards = recentFinishedMatches.length ? recentFinishedMatches.map((match) => {
    const score = match.home_score == null || match.away_score == null ? 'Sonuç yok'
      : `${escapeHtml(match.home_score)} - ${escapeHtml(match.away_score)}`;
    return `<article class="match" data-search-row>
      <div class="match-time">${score}<small>${escapeHtml(formatDate(match.kickoff_at, { day: '2-digit', month: 'short' }))}</small></div>
      <div class="teams"><span>${escapeHtml(match.home_team)} — ${escapeHtml(match.away_team)}</span>
        <small>${escapeHtml(match.league)} · ${escapeHtml(match.odds_snapshots ?? 0)} geçmiş oran kaydı · ${escapeHtml(match.odds_markets ?? 0)} market</small></div>
      <span class="status">Bitti</span>
    </article>`;
  }).join('') : renderEmpty('◷', 'Henüz bitmiş maç arşivi yok', 'Maçlar sonuçlandıkça geçmiş sonuç ve oran kayıtları burada görünecek.');

  const oddsRows = odds.length ? odds.slice(0, 100).map((odd) => {
    const movement = finiteNumber(odd.movement_percent);
    const movementClass = movement > 0 ? 'up' : movement < 0 ? 'down' : 'flat';
    const movementLabel = `${movement > 0 ? '+' : ''}${movement.toFixed(2)}%`;
    return `<article class="odd" data-search-row><div class="odd-match"><span>${escapeHtml(odd.home_team)} — ${escapeHtml(odd.away_team)}</span><small>${escapeHtml(formatDate(odd.kickoff_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))} · ${escapeHtml(String(odd.provider).replace('nowgoal:', ''))}</small></div>
      <div class="odd-market"><span>${escapeHtml(translateSelection(odd.selection))}</span><small>${escapeHtml(translateMarket(odd.market_type ?? odd.market_name))}${odd.line == null ? '' : ` · ${escapeHtml(odd.line)}`}</small></div>
      <span class="price">${finiteNumber(odd.current_odds).toFixed(2)}</span><span class="movement ${movementClass}">${escapeHtml(movementLabel)}</span></article>`;
  }).join('') : renderEmpty('↗', 'Nowgoal oranları bekleniyor', 'Maçlar FotMob ile eşleştikten sonra 1X2, Asya handikapı, gol ve korner oranları burada listelenecek.');
  const providerCards = sources.length ? sources.map((provider) => {
    const status = String(provider.status ?? 'unknown').toLowerCase();
    const badgeClass = status === 'healthy' ? 'ok' : ['degraded','waiting'].includes(status) ? 'partial' : 'neutral';
    const statusLabel = status === 'healthy' ? 'HEALTHY'
      : ['waiting','degraded'].includes(status) ? 'DEGRADED'
      : status === 'blocked' ? 'BLOCKED' : 'UNKNOWN';
    const name = String(provider.provider ?? 'Veri kaynağı');
    const lower = name.toLowerCase();
    const explanation = lower.includes('fotmob') ? 'Maç, fikstür ve istatistik verileri'
      : lower.includes('nowgoal') ? 'Oran ve oran değişimi verileri'
      : lower.includes('sofascore') ? 'Yedek veri kaynağı'
      : 'Sistem veri kaynağı';
    return `<article class="source"><div class="source-top"><span class="source-name">${escapeHtml(name)}</span>
      <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span></div>
      <p>${escapeHtml(explanation)} · ${escapeHtml(provider.message ?? (status === 'healthy' ? 'Veri akışı aktif' : statusLabel))}</p></article>`;
  }).join('') : renderEmpty('◇', 'Provider durumu bilinmiyor', 'Runtime provider sağlık verisi henüz alınamadı.');

  const capabilities = [...new Set((data.qualification ?? []).map((item) => String(item.capability)))];
  const qualificationProviders = [...new Set((data.qualification ?? []).map((item) => String(item.provider)))];
  const matrix = qualificationProviders.length ? `<div class="scroll"><table><thead><tr><th>Provider</th>${capabilities.map((capability) => `<th>${escapeHtml(capability)}</th>`).join('')}</tr></thead><tbody>${qualificationProviders.map((provider) => `<tr><td><strong>${escapeHtml(provider)}</strong></td>${capabilities.map((capability) => { const item = (data.qualification ?? []).find((entry) => entry.provider === provider && entry.capability === capability); const result = item?.result ?? 'NOT_TESTED'; return `<td><span class="badge ${result === 'SUPPORTED' ? 'ok' : result === 'PARTIAL' ? 'partial' : 'bad'}">${escapeHtml(result)}</span></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>` : renderEmpty('✓', 'Qualification henüz çalışmadı', 'Kaynak yetenek testleri tamamlandığında destek matrisi burada oluşacak.');

  const oddsSimilarityCards = oddsSimilarity.length ? oddsSimilarity.map((entry) => {
    const current = (entry.current ?? {}) as Record<string, unknown>;
    const history = Array.isArray(entry.matches) ? entry.matches as Array<Record<string, unknown>> : [];
    const resultMap = Array.isArray(entry.resultMap) ? entry.resultMap as Array<Record<string, unknown>> : [];
    const evidenceGap = (entry.evidenceGap ?? {}) as Record<string, unknown>;
    const state = String(current.state ?? 'PREVIEW');
    const stateLabel = state === 'LOCKED_PREDICTION' ? 'Resmi tahmin'
      : state === 'MATCH_ONLY' ? 'Karşılaştırma' : 'İnceleme adayı';
    const stateClass = state === 'LOCKED_PREDICTION' ? 'ok' : state === 'MATCH_ONLY' ? 'neutral' : 'partial';
    const hitRate = current.historicalHitRate == null ? null : finiteNumber(current.historicalHitRate);
    const hitRateText = hitRate == null ? 'Henüz hesaplanmadı' : percent(hitRate);
    const avgSimilarity = current.averageSimilarity == null ? '—'
      : `${(finiteNumber(current.averageSimilarity) * 100).toFixed(0)}%`;
    const movement = finiteNumber(current.probabilityDeltaPp);
    const agreement = Math.round(finiteNumber(current.agreementRatio) * 100);
    const line = current.line == null ? '' : ` ${escapeHtml(current.line)}`;
    const marketLabel = `${translateMarket(current.marketType)}${line} · ${translateSelection(current.selection)}`;

    const baselineRate = evidenceGap.baselineRate == null ? null : finiteNumber(evidenceGap.baselineRate);
    const gapPp = evidenceGap.gapPp == null ? null : finiteNumber(evidenceGap.gapPp);
    const gapLabel = gapPp == null ? 'Taban için veri yetersiz'
      : gapPp >= 12 ? 'Güçlü fark'
      : gapPp >= 6 ? 'Belirgin fark'
      : gapPp >= 2 ? 'Hafif fark'
      : gapPp > -2 ? 'Tabana yakın'
      : 'Tabanın altında';
    const gapClass = gapPp == null ? 'neutral' : gapPp >= 6 ? 'ok' : gapPp >= 2 ? 'partial' : gapPp < 0 ? 'bad' : 'neutral';
    const gapText = gapPp == null ? '—' : `${gapPp >= 0 ? '+' : ''}${gapPp.toFixed(1)} puan`;
    const baselineScope = String(evidenceGap.baselineScope ?? '') === 'SAME_COMPETITION' ? 'Lig tabanı' : 'Genel taban';
    const baselineText = baselineRate == null ? '—' : percent(baselineRate);

    const mapRows = resultMap.slice(0, 7).map((item) => {
      const rate = item.positiveRate == null ? 0 : finiteNumber(item.positiveRate);
      const itemLine = item.line == null ? '' : ` ${escapeHtml(item.line)}`;
      const label = `${translateMarket(item.marketType)}${itemLine} · ${translateSelection(item.selection)}`;
      return `<div class="result-map-row"><span class="result-map-label">${escapeHtml(label)} <small style="color:var(--muted)">(${escapeHtml(item.positiveCount)}/${escapeHtml(item.sampleSize)})</small></span>
        <span class="result-track"><span class="result-fill" style="width:${Math.max(0, Math.min(100, rate * 100)).toFixed(0)}%"></span></span>
        <span class="result-map-value">${(rate * 100).toFixed(0)}%</span></div>`;
    }).join('');

    const rows = history.map((item) => {
      const rawOutcome = String(item.outcome ?? '—');
      const outcomeClass = ['WIN','HALF_WIN'].includes(rawOutcome) ? 'ok'
        : ['LOSS','HALF_LOSS'].includes(rawOutcome) ? 'bad' : 'partial';
      const score = item.homeScore == null || item.awayScore == null ? 'Sonuç yok' : `${item.homeScore} - ${item.awayScore}`;
      const cornerScore = item.homeCorners == null || item.awayCorners == null ? null : `${item.homeCorners} - ${item.awayCorners} korner`;
      return `<div class="similar-row" data-search-row>
        <span class="similar-rank">#${escapeHtml(item.rank)}</span>
        <div class="similar-teams"><strong>${escapeHtml(item.homeTeam)} — ${escapeHtml(item.awayTeam)}</strong>
          <span>${escapeHtml(formatDate(item.kickoffAt, { day: '2-digit', month: 'long', year: 'numeric' }))} · ${escapeHtml(item.league)}</span></div>
        <div class="similar-history-odds">${finiteNumber(item.openingOdds).toFixed(2)} → ${finiteNumber(item.currentOdds).toFixed(2)}
          <small>${escapeHtml(translateMarket(item.marketType))} · ${escapeHtml(translateSelection(item.selection))} · karar -${escapeHtml(item.featureLeadMinutes)} dk</small></div>
        <div class="similar-result"><span class="badge ${outcomeClass}">${escapeHtml(outcomeText(rawOutcome))}</span>
          <small>${escapeHtml(score)}${cornerScore ? ` · ${escapeHtml(cornerScore)}` : ''}</small></div>
      </div>`;
    }).join('');

    return `<article class="similarity-card" data-search-row>
      <div class="similarity-head"><div><span class="section-kicker">Geçmiş İkizler</span><h3>${escapeHtml(current.homeTeam)} — ${escapeHtml(current.awayTeam)}</h3>
        <p>${escapeHtml(current.league)} · ${escapeHtml(formatDate(current.kickoffAt, { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }))}</p></div>
        <span class="badge ${stateClass}">${escapeHtml(stateLabel)}</span></div>
      <div class="similarity-current"><div class="similarity-market">${escapeHtml(marketLabel)}</div>
        <div class="similarity-odds"><span class="similarity-price">${finiteNumber(current.openingOdds).toFixed(2)}</span><span class="similarity-arrow">→</span>
          <span class="similarity-price">${finiteNumber(current.currentOdds).toFixed(2)}</span>
          <span class="badge neutral">${escapeHtml(movementText(movement))}</span></div>
        <p class="evidence-note">Bu eşleşme yalnız oran seviyesine değil; açılış, güncel oran, olasılık değişimi ve bahis şirketi uyumuna birlikte bakar.</p>
        <div class="similarity-meta"><span class="badge neutral">Benzer geçmiş maç: ${escapeHtml(current.historicalSettledSampleSize)}</span>
          <span class="badge neutral">Geçmiş başarı: ${escapeHtml(hitRateText)}</span>
          <span class="badge neutral">Ortalama benzerlik: ${escapeHtml(avgSimilarity)}</span>
          <span class="badge neutral">Bahis şirketi uyumu: ${agreement}%</span></div>
        <div class="evidence-strip">
          <div class="evidence-box"><small>Benzer grubun başarısı</small><strong>${escapeHtml(hitRateText)}</strong></div>
          <div class="evidence-box"><small>${escapeHtml(baselineScope)}</small><strong>${escapeHtml(baselineText)}</strong><span style="color:var(--muted);font-size:.65rem">n=${escapeHtml(evidenceGap.baselineSampleSize ?? 0)}</span></div>
          <div class="evidence-box"><small>Kanıt farkı</small><strong>${escapeHtml(gapText)}</strong><span class="badge ${gapClass}" style="margin-top:5px">${escapeHtml(gapLabel)}</span></div>
        </div>
        <p class="evidence-note">${gapPp == null ? 'Henüz güvenilir bir lig/genel taban karşılaştırması oluşturulamadı.'
          : gapPp >= 0 ? `Benzer oran grubunun başarısı ${baselineScope.toLocaleLowerCase('tr-TR')}ndan ${Math.abs(gapPp).toFixed(1)} puan daha yüksek.`
          : `Benzer oran grubunun başarısı ${baselineScope.toLocaleLowerCase('tr-TR')}ndan ${Math.abs(gapPp).toFixed(1)} puan daha düşük.`}</p></div>
      ${mapRows ? `<div class="result-map"><div class="result-map-head"><strong>Sonuç Haritası</strong><span>Aynı geçmiş ikiz grubunda diğer marketler</span></div>${mapRows}</div>` : ''}
      <div class="similar-list"><div class="similar-list-title">Bu hesabı oluşturan en yakın geçmiş maçlar</div>
        ${rows || '<div class="similar-list-title">Bu oran yapısına benzeyen sonuçlanmış maç henüz bulunamadı.</div>'}</div></article>`;
  }).join('') : renderEmpty('∿', 'Henüz geçmiş ikiz bulunamadı',
    oddsAnalyses.length
      ? 'Oranlar takip ediliyor. Yeterli gerçek historical odds örneği oluştuğunda Geçmiş İkizler ve Sonuç Haritası burada açılacak.'
      : 'Önce maçların oran verileri toplanacak, ardından gerçek geçmiş oran kayıtlarıyla karşılaştırılacak.');
  const oddsIntelligenceCards = oddsIntelligence.length ? oddsIntelligence.map((entry) => {
    const match = (entry.match ?? {}) as Record<string, unknown>; const route = (entry.oddsRoute ?? {}) as Record<string, unknown>;
    const twins = Array.isArray(entry.pastTwins) ? entry.pastTwins as Array<Record<string, unknown>> : [];
    const map = Array.isArray(entry.resultMap) ? entry.resultMap as Array<Record<string, unknown>> : [];
    const routeValues = Array.isArray(route.snapshots) ? route.snapshots as Array<Record<string, unknown>> : [];
    const routeText = routeValues.map((item) => finiteNumber(item.medianOdds).toFixed(2)).join(' → ');
    const resultRows = map.filter((item) => finiteNumber(item.sampleSize) > 0).slice(0, 4).map((item) =>
      `<li>${escapeHtml(translateMarket(item.market))} ${item.line == null ? '' : escapeHtml(item.line)} · ${escapeHtml(translateSelection(item.selection))}: <strong>${escapeHtml(item.positiveCount)}/${escapeHtml(item.sampleSize)}</strong> (${percent(item.positiveRate)})</li>`).join('');
    const conflicts = Array.isArray(entry.conflictCheck) ? entry.conflictCheck as Array<Record<string, unknown>> : [];
    return `<article class="card" data-search-row><div class="row"><div><span class="section-kicker">Oran Rotası</span><h3>${escapeHtml(match.homeTeam)} — ${escapeHtml(match.awayTeam)}</h3><p>${escapeHtml(match.league)} · ${escapeHtml(routeText || 'Yeterli gerçek snapshot yok')}</p></div><span class="badge neutral">${escapeHtml(route.direction ?? 'FLAT')} · ${escapeHtml(route.strength ?? 'WEAK')}</span></div><p class="evidence-note">Geçmiş İkizler: ${escapeHtml(twins.length)} · Kanıt seviyesi: ${escapeHtml(entry.evidenceStrength ?? 'VERY_LOW')} · Mod: ${escapeHtml(entry.searchMode ?? 'CLOSEST_NEIGHBORS')}</p><div class="evidence-strip"><div class="evidence-box"><small>Sonuç Haritası</small><strong>${escapeHtml(map.length)}</strong><span>gözlemlenebilir market</span></div><div class="evidence-box"><small>Çelişki Kontrolü</small><strong>${escapeHtml(conflicts.filter((item) => item.state === 'CONFLICT').length)}</strong><span>ters sinyal</span></div></div><ul class="details-list">${resultRows || '<li>Sonuç haritası için yeterli gerçek sonuç yok.</li>'}</ul><p class="evidence-note">Geçmiş benzerlik ve sonuç dağılımıdır; resmi tahmin veya bahis kararı değildir.</p></article>`;
  }).join('') : renderEmpty('↗', 'Oran rotası için veri birikiyor', 'Yalnız gerçek pre-match odds snapshotları yeterli olduğunda analiz görünür.');
  const officialPredictions = predictions.filter((item) => gateStatus(item) === 'OFFICIAL');
  const reviewMatchIds = new Set(reviewPredictions.map((item) => String(item.matchId ?? '')));
  const waitingPredictions = [...predictions, ...predictionPreviews].filter((item) => gateStatus(item) === 'WAITING');
  const rejectedByMatch = new Map<string, Record<string, unknown>>();
  for (const item of [...predictions, ...predictionPreviews]) {
    if (item.predictionGate ? gateStatus(item) !== 'REJECTED' : String(item.decision) !== 'SKIP') continue;
    const matchId = String(item.match_id ?? item.matchId ?? '');
    if (!matchId || reviewMatchIds.has(matchId) || rejectedByMatch.has(matchId)) continue;
    rejectedByMatch.set(matchId, item);
  }
  const rejectedPredictions = [...rejectedByMatch.values()];

  const officialPredictionCards = officialPredictions.length ? officialPredictions.map((prediction) => {
    const gateCandidate = objectValue(objectValue(prediction.predictionGate)?.candidate);
    const gateHistorical = objectValue(gateCandidate?.historical);
    const score = gateCandidate?.predictionScore ?? prediction.prediction_score;
    const hist = gateHistorical?.settledSampleSize ?? prediction.historical_settled_sample_size ?? prediction.historical_sample_size;
    const hitValue = gateHistorical?.historicalHitRate ?? prediction.historical_hit_rate;
    const hit = hitValue == null ? '—' : percent(hitValue);
    const market = gateCandidate?.marketType ?? prediction.market_type;
    const line = gateCandidate?.line ?? prediction.line;
    const selection = gateCandidate?.selection ?? prediction.selection;
    const referenceOdds = gateCandidate?.currentOdds ?? gateCandidate?.referenceOdds ?? prediction.reference_odds;
    return `<article class="card prediction-card" data-search-row><div class="row"><div><strong>${escapeHtml(prediction.home_team)} — ${escapeHtml(prediction.away_team)}</strong>
      <p>${escapeHtml(prediction.league)} · ${escapeHtml(formatDate(prediction.kickoff_at, { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }))}</p></div>
      <span class="badge ok">Resmi tahmin</span></div>
      ${market == null ? '' : `<p style="font-size:1rem;color:var(--text)"><strong>${escapeHtml(translateMarket(market))} ${escapeHtml(line ?? '')} · ${escapeHtml(translateSelection(selection))}</strong></p>`}
      <div class="similarity-meta">${score == null ? '' : `<span class="badge ok">Tahmin skoru ${escapeHtml(score)}/100</span>`}
        ${hist == null ? '' : `<span class="badge neutral">Benzer geçmiş maç: ${escapeHtml(hist)}</span>`}<span class="badge neutral">Geçmiş başarı: ${escapeHtml(hit)}</span>
        ${referenceOdds == null ? '' : `<span class="badge neutral">Oran: ${escapeHtml(optionalOdds(referenceOdds))}</span>`}</div>
      <p>Bu maç mevcut resmi tahmin kurallarının tamamını geçti.</p>
      ${renderGateInspector(prediction.predictionGate)}</article>`;
  }).join('') : renderEmpty('✓', 'Şu anda resmi tahmin yok', 'Sistem kriterleri karşılayan bir maç bulduğunda resmi tahmin burada görünecek.');

  const reviewCandidateCards = reviewPredictions.length ? reviewPredictions.map((entry) => {
    const candidate = (entry.candidate ?? {}) as Record<string, unknown>;
    const historical = (candidate.historical ?? {}) as Record<string, unknown>;
    const reasons = Array.isArray(entry.skipReasons) ? entry.skipReasons : [];
    const predictionGate = (entry.predictionGate ?? {}) as Record<string, unknown>;
    const gateThresholds = (predictionGate.thresholds ?? {}) as Record<string, unknown>;
    const historicalRequired = finiteNumber(gateThresholds.minimumHistoricalSample, requiredHistoricalSample);
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
        <span class="badge ${hist >= historicalRequired ? 'ok' : 'partial'}">Benzer geçmiş maç: ${hist} / gereken ${historicalRequired}</span>
        <span class="badge neutral">Geçmiş başarı: ${escapeHtml(hit)}</span>
        <span class="badge neutral">Bahis şirketi: ${bookmakers}</span></div>
      <p><strong>Veri kalitesi:</strong> ${escapeHtml(translateGrade(candidate.dataQualityGrade))} · <strong>Model güveni:</strong> ${escapeHtml(translateGrade(candidate.confidenceGrade))}</p>
      <p><strong>Bahis şirketi uyumu:</strong> ${Math.round(agreement * 100)}% · Çoğunluğun aynı yönde hareket edip etmediği burada ölçülür.</p>
      <p><strong>Neden henüz resmi tahmin değil?</strong></p>
      <ul style="margin:5px 0 0;padding-left:18px;color:var(--muted)">${missing || '<li>Resmi tahmin için gereken kanıt henüz tamamlanmadı.</li>'}</ul>
      <p class="not-official">Resmi tahmin değildir.</p><p style="color:var(--muted-2)">Bu kart inceleme içindir; performans kaydına dahil değildir.</p>
      ${renderGateInspector(entry.predictionGate)}</article>`;
  }).join('') : renderEmpty('◇', 'Şu anda inceleme adayı yok', 'Resmi tahmin seviyesine yaklaşan maçlar burada gösterilecek.');

  const waitingPredictionCards = waitingPredictions.length ? waitingPredictions.map((prediction) =>
    `<article class="card prediction-card" data-search-row><div class="row"><div><strong>${escapeHtml(prediction.home_team)} — ${escapeHtml(prediction.away_team)}</strong>
      <p>${escapeHtml(prediction.league)} · ${escapeHtml(formatDate(prediction.kickoff_at, { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }))}</p></div>
      <span class="badge neutral">Veri bekleniyor</span></div>${renderGateInspector(prediction.predictionGate)}</article>`).join('')
    : renderEmpty('…', 'Veri bekleyen maç yok', 'İlk oran ölçümü veya resmi tahmin penceresi beklenen maçlar burada görünür.');

  const rejectedRows = rejectedPredictions.map((prediction) => {
    const reasons = Array.isArray(prediction.skip_reasons) ? prediction.skip_reasons as unknown[]
      : Array.isArray(prediction.reasons) ? prediction.reasons as unknown[] : [];
    const mainReason = reasons[0] == null ? 'Resmi tahmin koşulları henüz oluşmadı' : translateReason(reasons[0]);
    return `<tr data-search-row><td><strong>${escapeHtml(prediction.home_team)} — ${escapeHtml(prediction.away_team)}</strong></td>
      <td>${escapeHtml(formatDate(prediction.kickoff_at, { hour: '2-digit', minute: '2-digit' }))}</td>
      <td>${escapeHtml(mainReason)}</td><td><span class="badge bad">Tahmin oluşturulmadı</span></td></tr>`;
  });
  const rejectedCompact = rejectedRows.length
    ? `<div class="scroll"><table><thead><tr><th>Maç</th><th>Saat</th><th>Ana neden</th><th>Durum</th></tr></thead><tbody>${rejectedRows.slice(0, 5).join('')}</tbody></table></div>
      ${rejectedRows.length > 5 ? `<details><summary>Tüm tahmin oluşturulmayan maçları göster (${rejectedRows.length})</summary><div class="details-body"><div class="scroll"><table><tbody>${rejectedRows.join('')}</tbody></table></div></div></details>` : ''}`
    : renderEmpty('—', 'Tahmin oluşturulmayan maç yok', 'Bugünkü maçların değerlendirmesi burada özetlenir.');
  const predictionHistoryRows = predictionHistory.length ? predictionHistory.map((prediction) => {
    const skip = String(prediction.decision) === 'SKIP';
    const outcome = prediction.outcome == null ? 'Bekliyor' : outcomeText(prediction.outcome);
    return `<tr><td>${escapeHtml(formatDate(prediction.kickoff_at, { day: '2-digit', month: 'short' }))}</td>
      <td>${escapeHtml(prediction.home_team)} — ${escapeHtml(prediction.away_team)}</td>
      <td>${skip ? 'Tahmin oluşturulmadı' : `${escapeHtml(translateMarket(prediction.market_type))} ${escapeHtml(prediction.line ?? '')} ${escapeHtml(translateSelection(prediction.selection))}`}</td>
      <td>${skip ? '—' : escapeHtml(prediction.prediction_score)}</td><td>${escapeHtml(outcome)}</td></tr>`;
  }).join('') : '<tr><td colspan="5">Henüz resmi tahmin geçmişi yok.</td></tr>';
  const performanceSummary = predictionPerformance ? `<div class="grid"><article class="card"><strong>Resmi kararlar</strong>
    <p>Toplam ${escapeHtml(predictionPerformance.totalOfficialDecisions)} · Tahmin ${escapeHtml(predictionPerformance.predictCount)} · Tahmin yok ${escapeHtml(predictionPerformance.skipCount)}</p></article>
    <article class="card"><strong>Sonuçlanan tahminler</strong><p>${escapeHtml(predictionPerformance.settled)} maç · Kazanan ${escapeHtml(predictionPerformance.win)} · Kaybeden ${escapeHtml(predictionPerformance.loss)}</p></article>
    <article class="card"><strong>Deneme performansı</strong><p>${escapeHtml(predictionPerformance.referencePaperUnits ?? 0)} birim</p><p style="color:var(--muted)">Gerçek para getirisi değildir.</p></article></div>`
    : renderEmpty('◇', 'Performans verisi yok', 'Resmi tahminler sonuçlandıkça performans özeti burada oluşacak.');
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
      ? `Koruma aktif${pauseUntil ? ` · ${pauseUntil} tarihine kadar` : ''}. Yeni resmi tahminler geçici olarak bekletilir.`
      : status === 'PAUSED'
        ? 'Koruma süresi doldu; sistem yeniden sonuç toplamaya başladı.'
        : 'Geçmiş kayıtlar değiştirilmez; bu kontrol yalnız yeni resmi tahminleri izler.';
    return `<div class="grid"><article class="card"><div class="row"><strong>Genel güvenlik kontrolü</strong>
      <span class="badge ${badgeClass}">${escapeHtml(translateSystemStatus(effectiveStatus))}</span></div>
      <p>Son kontrol edilen örnek: ${escapeHtml(predictionSelfAudit.recentSampleSize ?? 0)} · Sonuçlanmış örnek: ${escapeHtml(predictionSelfAudit.recentBinarySampleSize ?? 0)}</p>
      <p>Başarılı sonuç oranı: <strong>${escapeHtml(positiveRate)}</strong> · Deneme getirisi: <strong>${escapeHtml(roi)}</strong></p>
      <p>Kalibrasyon farkı: ${escapeHtml(calibration)} · Üst üste kayıp: ${escapeHtml(predictionSelfAudit.lossStreak ?? 0)}</p>
      ${reasons.length ? `<p style="color:${guardActive ? 'var(--red)' : 'var(--amber)'}">Sistem performansta dikkat edilmesi gereken bir durum algıladı.</p>` : ''}
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
        <td><span class="badge ${badgeClass}">${escapeHtml(translateSystemStatus(effectiveStatus))}</span></td>
        <td>${escapeHtml(item.recentSampleSize ?? 0)}</td><td>${escapeHtml(rate)}</td><td>${escapeHtml(roi)}</td>
        <td>${escapeHtml(item.lossStreak ?? 0)}</td></tr>`;
    }).join('');
    return `<details><summary>Lig ve bahis türü kontrolü · Lig ve bahis türü ayrıntıları · Durduruldu ${activePaused} · İzleniyor ${watch}</summary>
      <div class="details-body"><p style="color:var(--muted)">Sadece sorunlu market/lig kapatılır. Genel V1 freni ayrıca çalışmaya devam eder.</p>
      <div class="scroll"><table><thead><tr><th>Kapsam</th><th>Segment</th><th>Durum</th><th>Son N</th>
      <th>Positive rate</th><th>Ref. ROI</th><th>Kayıp serisi</th></tr></thead><tbody>${rows}</tbody></table></div></div></details>`;
  })() : `<details><summary>Lig ve bahis türü kontrolü · Lig ve bahis türü ayrıntıları</summary><div class="details-body">${renderEmpty('◇',
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
        <td><span class="badge ${badgeClass}">${escapeHtml(translateSystemStatus(status))}</span></td>
        <td>${escapeHtml(item.binarySampleSize ?? 0)}</td><td>${escapeHtml(rate)}</td><td>${escapeHtml(roi)}</td>
        <td>${escapeHtml(rateGap)}</td><td>${escapeHtml(roiGap)}</td>
        <td>${escapeHtml(evidence)}</td><td>${escapeHtml(item.rootCauseScore ?? 0)}</td></tr>`;
    }).join('');
    return `<details><summary>Performans nedenleri · Performans nedenleri · Yüksek risk ${highRisk} · İzleniyor ${watch}</summary>
      <div class="details-body"><p style="color:var(--muted)">Teşhis katmanıdır; tek başına resmi tahmini durdurmaz.
      Faktör performansı aynı dönem genel baseline ile karşılaştırılır.</p>
      <div class="scroll"><table><thead><tr><th>Faktör</th><th>Bucket</th><th>Durum</th><th>Binary N</th>
      <th>Positive rate</th><th>Ref. ROI</th><th>Rate farkı</th><th>ROI farkı</th><th>Kanıt</th><th>Cause score</th>
      </tr></thead><tbody>${rows}</tbody></table></div></div></details>`;
  })() : `<details><summary>Performans nedenleri · Performans nedenleri</summary><div class="details-body">${renderEmpty('◇',
    'Kök neden verisi henüz yok', 'Yeterli resmi settlement oluşunca hangi koşulların performansı aşağı çektiği burada görünecek.')}</div></details>`;

  const predictionDiagnosticSummary = predictionDiagnostics ? (() => {
    const current = (predictionDiagnostics.current ?? {}) as Record<string, unknown>;
    const historical = (predictionDiagnostics.historical ?? {}) as Record<string, unknown>;
    const thresholds = (predictionDiagnostics.thresholds ?? {}) as Record<string, unknown>;
    const topReasons = Array.isArray(current.topSkipReasons)
      ? current.topSkipReasons as Array<Record<string, unknown>> : [];
    const reasonItems = topReasons.slice(0, 4).map((item) =>
      `<li>${escapeHtml(translateReason(item.reason))} <strong>(${finiteNumber(item.count)} maç)</strong></li>`).join('');
    const histMax = finiteNumber(current.maximumHistoricalSettledSample);
    const histMin = finiteNumber(thresholds.minimumHistoricalSample, requiredHistoricalSample);
    const analyzed = finiteNumber(current.withOddsAnalysis);
    const targets = finiteNumber(current.targets);
    return `<article class="card" style="margin-bottom:12px"><div class="row"><div><strong>Şu anda neden resmi tahmin az?</strong>
      <p>Sistem canlı maçları değerlendiriyor ve hangi şartların eksik olduğunu Türkçe özetliyor.</p></div></div>
      <div class="grid" style="margin-top:12px">
        <article class="audit-mini"><small>Takip edilen maç</small><strong>${targets}</strong><span>Oran analizi hazır: ${analyzed}</span></article>
        <article class="audit-mini"><small>Resmi tahmin</small><strong>${finiteNumber(current.predictRuns)}</strong><span>Tahmin oluşturulmayan: ${finiteNumber(current.skipRuns)}</span></article>
        <article class="audit-mini"><small>En yüksek benzer maç sayısı</small><strong>${histMax}</strong><span>Resmi tahmin için gereken: ${histMin}</span></article>
        <article class="audit-mini"><small>Uygun geçmiş veri</small><strong>${finiteNumber(historical.eligible)}</strong><span>Toplam geçmiş örnek: ${finiteNumber(historical.total)}</span></article>
      </div>
      <p style="margin:12px 0 5px"><strong>En sık eksik olan şartlar:</strong></p>
      <ul style="margin:0;padding-left:18px;color:var(--muted)">${reasonItems || '<li>Henüz yeterli değerlendirme verisi yok.</li>'}</ul></article>`;
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
    return `<details><summary>Sistem önerileri · Kural önerileri · Öneri ${proposed} · Onaylandı ${approved} · Reddedildi ${rejected}</summary>
      <div class="details-body"><p style="color:var(--muted)">V4 yalnız öneri üretir. autoApply=false ve executionAuthority=false.
      Onaylandı durumu bile PredictionConfig'i veya tahmin motorunu otomatik değiştirmez.</p>
      <div class="scroll"><table><thead><tr><th>Risk</th><th>Önerilen koşul</th><th>N</th><th>Rate farkı</th>
      <th>ROI farkı</th><th>Interaction</th><th>Kanıt</th><th>Proposal score</th><th>Karar</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div></details>`;
  })() : `<details><summary>Sistem önerileri · Kural önerileri</summary><div class="details-body">${renderEmpty('◇',
    'Güncel kural önerisi yok', 'V4 yeterli ve tekrarlanabilir zayıflık görürse burada insan onayına sunulan öneriler oluşacak.')}</div></details>`;


  const datasetHealth = audit ? `<div class="grid"><article class="card"><strong>Geçmiş maç</strong><p>${escapeHtml(audit.totalMatches)}</p></article><article class="card"><strong>Korner kapsaması</strong><p>${percent(audit.cornerCoverage?.complete?.rate)}</p></article><article class="card"><strong>Lig</strong><p>${escapeHtml(audit.perCompetition?.length ?? 0)}</p></article><article class="card"><strong>Sezon</strong><p>${escapeHtml(audit.perSeason?.length ?? 0)}</p></article></div>` : renderEmpty('◫', 'Dataset henüz hazır değil', 'Historical backfill ve audit tamamlandığında kalite özeti burada görünecek.');
  const calibrationRows = validation ? Object.entries(validation.calibration ?? {}).map(([bucket, item]) => `<tr><td>${escapeHtml(bucket)}</td><td>${escapeHtml(item.count)}</td><td>${percent(item.averagePredictedProbability)}</td><td>${percent(item.actualHitRate)}</td><td>${percent(item.absoluteCalibrationError)}</td></tr>`).join('') : '';
  const modelValidation = validation ? `<div class="grid"><article class="card"><strong>MAE</strong><p>${finiteNumber(validation.mae).toFixed(3)}</p></article><article class="card"><strong>RMSE</strong><p>${finiteNumber(validation.rmse).toFixed(3)}</p></article><article class="card"><strong>Brier</strong><p>${finiteNumber(validation.brier).toFixed(4)}</p></article><article class="card"><strong>Log loss</strong><p>${finiteNumber(validation.logLoss).toFixed(4)}</p></article></div><div class="scroll" style="margin-top:10px"><table><thead><tr><th>Bucket</th><th>Count</th><th>Predicted</th><th>Actual</th><th>Abs. error</th></tr></thead><tbody>${calibrationRows}</tbody></table></div>` : renderEmpty('∿', 'Backtest sonucu yok', 'Model doğrulaması çalıştırıldığında hata ve kalibrasyon metrikleri burada gösterilecek.');
  const waitingNotice = todayMatches.length
    ? ''
    : matches.length
      ? `<div class="notice"><span class="notice-mark">i</span><div><strong>Bugün desteklenen liglerde maç yok</strong><p>Sistem boş değil. Önümüzdeki 7 günlük fikstür, geçmiş sonuçlar ve oran arşivi aşağıda gösteriliyor.</p></div></div>`
      : (historicalExampleCount > 0 || archivedOddsMatchCount > 0)
        ? `<div class="notice"><span class="notice-mark">i</span><div><strong>Bugün ve önümüzdeki 14 günde maç görünmüyor</strong><p>Geçmiş analiz arşivi aktif: ${historicalExampleCount} historical örnek ve ${archivedOddsMatchCount} gerçek oran geçmişi bulunan bitmiş maç mevcut.</p></div></div>`
        : `<div class="notice"><span class="notice-mark">i</span><div><strong>Veri senkronizasyonu bekleniyor</strong><p>Collector devreye girdiğinde fikstür ve oranlar otomatik olarak burada görünür.</p></div></div>`;

  const officialPredictionCount = officialPredictions.length;
  const reviewCandidateCount = reviewPredictions.length;
  const waitingPredictionCount = waitingPredictions.length;
  const rejectedPredictionCount = rejectedPredictions.length;
  const stateLabel: Record<string, string> = { OFFICIAL: 'RESMİ TAHMİN', REVIEW: 'İNCELEME',
    WAITING: 'VERİ BEKLENİYOR', REJECTED: 'REDDEDİLDİ' };
  const stateClass: Record<string, string> = { OFFICIAL: 'official', REVIEW: 'review',
    WAITING: 'waiting', REJECTED: 'rejected' };
  const featureEntry = (status: string): Record<string, unknown> | undefined => status === 'OFFICIAL'
    ? officialPredictions[0] : status === 'REVIEW' ? reviewPredictions[0]
      : status === 'WAITING' ? waitingPredictions[0] : rejectedPredictions[0];
  const featureCard = (status: 'OFFICIAL' | 'REVIEW' | 'WAITING' | 'REJECTED') => {
    const featureId: Record<string, string> = { OFFICIAL: 'official-predictions', REVIEW: 'review-predictions',
      WAITING: 'waiting-predictions', REJECTED: 'rejected-predictions' };
    const entry = featureEntry(status);
    if (!entry) {
      const emptyText: Record<string, string> = { OFFICIAL: 'Şu anda resmi tahmin yok.',
        REVIEW: 'Şu anda inceleme adayı yok.', WAITING: 'Veri bekleyen maç yok.',
        REJECTED: 'Reddedilen güncel değerlendirme yok.' };
      return `<article class="state-card ${stateClass[status]} empty-state" id="${featureId[status]}" data-prediction-state="${status}">
        <span class="state-label">${stateLabel[status]}</span><strong>${emptyText[status]}</strong>
        <p>Yeni gerçek değerlendirmeler oluştuğunda bu alan otomatik güncellenir.</p></article>`;
    }
    const inspector = objectValue(entry.predictionGate);
    const candidate = objectValue(inspector?.candidate) ?? objectValue(entry.candidate) ?? objectValue(entry.selected_candidate);
    const historical = objectValue(candidate?.historical);
    const matchId = String(entry.match_id ?? entry.matchId ?? '');
    const home = entry.home_team ?? entry.homeTeam;
    const away = entry.away_team ?? entry.awayTeam;
    const league = entry.league;
    const kickoff = entry.kickoff_at ?? entry.kickoffAt;
    const market = candidate?.marketType ?? entry.market_type;
    const selection = candidate?.selection ?? entry.selection;
    const line = candidate?.line ?? entry.line;
    const score = candidate?.predictionScore ?? entry.prediction_score;
    const sample = historical?.settledSampleSize ?? entry.historical_settled_sample_size ?? entry.historical_sample_size;
    const currentOdds = candidate?.currentOdds ?? candidate?.referenceOdds ?? entry.reference_odds;
    const movement = candidate?.movementClass ?? entry.movement_class;
    const bookmakers = candidate?.bookmakerCount ?? entry.bookmaker_count;
    const blockers = Array.isArray(inspector?.blockers) ? inspector.blockers as unknown[]
      : Array.isArray(entry.skipReasons) ? entry.skipReasons as unknown[]
      : Array.isArray(entry.skip_reasons) ? entry.skip_reasons as unknown[] : [];
    const reason = status === 'OFFICIAL' ? inspector?.summary
      : status === 'REVIEW' ? (blockers[0] == null ? inspector?.summary : translateReason(blockers[0]))
      : inspector?.summary ?? (blockers[0] == null ? null : translateReason(blockers[0]));
    const chips = [score == null ? '' : `<span>Tahmin skoru <b>${escapeHtml(score)}/100</b></span>`,
      sample == null ? '' : `<span>Geçmiş örnek <b>${escapeHtml(sample)}</b></span>`,
      currentOdds == null ? '' : `<span>Güncel oran <b>${escapeHtml(optionalOdds(currentOdds))}</b></span>`,
      movement == null ? '' : `<span>Hareket <b>${escapeHtml(movement)}</b></span>`,
      bookmakers == null ? '' : `<span>Bookmaker <b>${escapeHtml(bookmakers)}</b></span>`].filter(Boolean).join('');
    const marketText = market == null ? '' : `${translateMarket(market)}${line == null ? '' : ` ${escapeHtml(line)}`}${selection == null ? '' : ` · ${translateSelection(selection)}`}`;
    return `<article class="state-card ${stateClass[status]}" id="${featureId[status]}" data-prediction-state="${status}" data-search-row>
      <div class="state-card-head"><span class="state-label">${stateLabel[status]}</span><span>${escapeHtml(formatDate(kickoff, { hour: '2-digit', minute: '2-digit' }))}</span></div>
      <small>${escapeHtml(league ?? '—')}</small><h3>${escapeHtml(home ?? '—')} <span>—</span> ${escapeHtml(away ?? '—')}</h3>
      ${status === 'REVIEW' ? '<strong class="not-official">Resmi tahmin değildir.</strong>' : ''}
      ${marketText ? `<p class="state-market">${marketText}</p>` : ''}
      ${chips ? `<div class="state-metrics">${chips}</div>` : '<p class="unavailable">Henüz hesaplanmadı</p>'}
      ${reason ? `<p class="state-reason">${escapeHtml(reason)}</p>` : ''}
      ${matchId ? `<a class="analysis-link" href="/matches/${encodeURIComponent(matchId)}">Detaylı Analiz <span>→</span></a>` : ''}
    </article>`;
  };
  const featuredStateCards = (['OFFICIAL','REVIEW','WAITING','REJECTED'] as const).map(featureCard).join('');

  const predictionForMatch = (matchId: string) => [...predictions, ...predictionPreviews]
    .find((item) => String(item.match_id ?? item.matchId ?? '') === matchId)
    ?? reviewPredictions.find((item) => String(item.matchId ?? '') === matchId);
  const todayMatchRows = todayMatches.length ? todayMatches.map((match) => {
    const matchId = String(match.id ?? '');
    const prediction = predictionForMatch(matchId);
    const inspector = objectValue(prediction?.predictionGate);
    const status = String(inspector?.overallStatus ?? 'UNKNOWN');
    const candidate = objectValue(inspector?.candidate) ?? objectValue(prediction?.candidate);
    const historical = objectValue(candidate?.historical);
    const matchOdds = odds.filter((item) => String(item.match_id ?? '') === matchId
      && ['MATCH_RESULT','1X2'].includes(String(item.market_type ?? item.market_name ?? '').toUpperCase()));
    const price = (selection: string) => optionalOdds(matchOdds.find((item) =>
      String(item.selection ?? '').toUpperCase() === selection)?.current_odds);
    const market = candidate?.marketType == null ? '—' : `${translateMarket(candidate.marketType)}${candidate.line == null ? '' : ` ${candidate.line}`}
      ${candidate.selection == null ? '' : `· ${translateSelection(candidate.selection)}`}`;
    const humanStatus = status === 'UNKNOWN' ? 'Değerlendirilmedi' : stateLabel[status] ?? status;
    return `<tr data-search-row data-match-state="${escapeHtml(status)}"><td class="mono">${escapeHtml(formatDate(match.kickoff_at, { hour: '2-digit', minute: '2-digit' }))}</td>
      <td><strong>${escapeHtml(match.home_team)} — ${escapeHtml(match.away_team)}</strong></td><td>${escapeHtml(match.league)}</td>
      <td class="mono">${price('HOME')}</td><td class="mono">${price('DRAW')}</td><td class="mono">${price('AWAY')}</td>
      <td><span class="badge ${status === 'OFFICIAL' ? 'ok' : status === 'REVIEW' ? 'partial' : status === 'REJECTED' ? 'bad' : 'neutral'}">${escapeHtml(humanStatus)}</span></td>
      <td>${escapeHtml(market)}</td><td class="mono">${escapeHtml(optionalNumber(candidate?.predictionScore, '/100'))}</td>
      <td class="mono">${escapeHtml(optionalNumber(historical?.settledSampleSize))}</td><td>${escapeHtml(candidate?.movementClass ?? '—')}</td>
      <td><a class="table-action" href="/matches/${encodeURIComponent(matchId)}">Analizi Aç</a></td></tr>`;
  }).join('') : '<tr><td colspan="12">Bugün için desteklenen maç bulunmuyor.</td></tr>';
  const globalAuditRaw = String(predictionSelfAudit?.status ?? 'NOT_AVAILABLE');
  const globalAuditGuard = Boolean(predictionSelfAudit?.guardActive);
  const globalAuditStatus = globalAuditRaw === 'PAUSED' && !globalAuditGuard ? 'RECOVERY' : globalAuditRaw;
  const pausedSegments = predictionSelfAuditSegments.filter((item) => item.status === 'PAUSED' && item.guardActive).length;
  const watchSegments = predictionSelfAuditSegments.filter((item) => item.status === 'WATCH').length;
  const highRiskFactors = predictionSelfAuditRootCauses.filter((item) => item.status === 'HIGH_RISK').length;
  const watchFactors = predictionSelfAuditRootCauses.filter((item) => item.status === 'WATCH').length;
  const proposedRules = predictionAdaptiveRuleProposals.filter((item) => item.decision === 'PROPOSED').length;

  const auditOverview = `<div class="audit-overview">
    <article class="audit-mini"><small>Genel tahmin sistemi</small><strong>${escapeHtml(translateSystemStatus(globalAuditStatus))}</strong>
      <span>${globalAuditGuard ? 'Güvenlik freni yeni resmi tahminleri bekletiyor' : 'Genel kontrol normal çalışıyor'}</span></article>
    <article class="audit-mini"><small>Lig ve bahis türleri</small><strong>${pausedSegments} durduruldu · ${watchSegments} izleniyor</strong>
      <span>Sadece sorunlu alanlar ayrı takip edilir</span></article>
    <article class="audit-mini"><small>Performans uyarıları</small><strong>${highRiskFactors} yüksek risk</strong>
      <span>${watchFactors} koşul yakından izleniyor</span></article>
    <article class="audit-mini"><small>Sistem önerileri</small><strong>${proposedRules} öneri</strong>
      <span>Hiçbir değişiklik otomatik uygulanmaz</span></article>
  </div>`;

  return shell(`<div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="/"><span class="brand-mark">B</span><span>BETAPP<small>Analiz Terminali</small></span></a>
      <div class="side-group"><div class="side-label">Terminal</div><nav class="side-nav" aria-label="Ana menü">
        <a class="active" href="#overview"><span class="nav-icon">⌂</span>Genel Bakış</a>
        <a href="#matches"><span class="nav-icon">◫</span>Bugünün Maçları</a>
        <a href="#official-predictions"><span class="nav-icon">●</span>Resmi Tahminler</a>
        <a href="#review-predictions"><span class="nav-icon">◇</span>İnceleme Adayları</a>
        <a href="#odds"><span class="nav-icon">↗</span>Oran Analizi</a>
        <a href="#odds-analysis"><span class="nav-icon">∿</span>Geçmiş İkizler</a>
        <a href="#prediction-history"><span class="nav-icon">◷</span>Tahmin Geçmişi</a>
        <a href="#prediction-self-audit"><span class="nav-icon">◉</span>Sistem Durumu</a>
      </nav></div>
      <div class="sidebar-foot"><a class="system-pill" href="#prediction-self-audit"><span class="live-dot ${allSourcesHealthy ? '' : 'wait'}"></span><span><strong style="display:block;color:var(--text)">${escapeHtml(statusText)}</strong>${sources.length} runtime provider</span></a></div>
    </aside>
    <div class="app-main">
      <header class="topbar"><div class="top-title"><strong>BETAPP Futbol Analiz Terminali</strong><span>${escapeHtml(formatDate(new Date(), { day: '2-digit', month: 'long', year: 'numeric' }))} · ${supportedCompetitions.length ? `${supportedCompetitions.length} desteklenen lig` : 'Lig bilgisi bekleniyor'}</span></div>
        <label class="search" aria-label="Takım veya lig ara"><input data-global-search type="search" placeholder="Takım veya lig ara"></label>
        <div class="top-actions"><a class="top-chip" href="#prediction-self-audit"><span class="live-dot ${allSourcesHealthy ? '' : 'wait'}"></span> ${escapeHtml(statusText)}</a></div>
      </header>
      <main class="content">
      ${liveSection()}
        <section class="command-hero" id="overview">
          <article class="hero-main"><p class="eyebrow">OPERASYON ÖZETİ</p><h1>${todayMatches.length
              ? `Bugün ${todayMatches.length} maç<br>takip ediliyor.`
              : matches.length
                ? `Bugün maç yok.<br>Önümüzdeki 7 günde ${matches.length} maç var.`
                : `Bugün maç yok.<br>Geçmiş analiz arşivi hazır.`}</h1>
            <p class="hero-copy">Fikstür, gerçek pre-match oranlar ve Prediction Gate Inspector durumları tek terminalde izlenir. Bu ekran bahis yürütmez.</p></article>
          <article class="hero-status"><div class="hero-status-head"><strong>Canlı telemetri</strong><span class="badge ${allSourcesHealthy ? 'ok' : sources.length ? 'partial' : 'neutral'}">${escapeHtml(statusText)}</span></div>
            <div class="hero-status-list"><div class="health-row"><span>Yaklaşan fikstür</span><b>${matches.length ? `${matches.length} maç` : 'Bu hafta görünmüyor'}</b></div>
              <div class="health-row"><span>Canlı oranlar</span><b>${odds.length ? `${odds.length} kayıt` : 'Maç bekleniyor'}</b></div>
              <div class="health-row"><span>Historical örnekler</span><b>${historicalExampleCount}</b></div>
              <div class="health-row"><span>Geçmiş oran snapshotları</span><b>${preKickoffSnapshotCount.toLocaleString('tr-TR')}</b></div></div></article>
        </section>
        <section class="metrics" aria-label="Sistem özeti">
          <article class="metric"><span class="metric-label">Bugünkü Maçlar</span><strong class="metric-value">${todayMatches.length}</strong><span class="metric-note">Desteklenen fikstür</span></article>
          <article class="metric"><span class="metric-label">Resmi Tahmin</span><strong class="metric-value">${officialPredictionCount}</strong><span class="metric-note">Gate Inspector OFFICIAL</span></article>
          <article class="metric"><span class="metric-label">İnceleme</span><strong class="metric-value">${reviewCandidateCount}</strong><span class="metric-note">Resmi tahmin değildir</span></article>
          <article class="metric"><span class="metric-label">Veri Bekleyen</span><strong class="metric-value">${waitingPredictionCount}</strong><span class="metric-note">Gate Inspector WAITING</span></article>
          <article class="metric"><span class="metric-label">Tarihsel Örnek</span><strong class="metric-value">${historicalExampleRaw == null ? '—' : historicalExampleCount}</strong><span class="metric-note">Benzerlik motoru verisi</span></article>
          <article class="metric"><span class="metric-label">Pre-match Snapshot</span><strong class="metric-value">${preKickoffSnapshotRaw == null ? '—' : preKickoffSnapshotCount.toLocaleString('tr-TR')}</strong><span class="metric-note">Gerçek oran kaydı</span></article>
        </section>
        ${waitingNotice}

        <section class="section" id="predictions"><div class="section-title"><div><span class="section-kicker">Prediction Gate Inspector</span><h2>Güncel Tahmin Durumları</h2><p>Her durumdan en fazla bir gerçek güncel maç gösterilir.</p></div></div>
          <div class="state-grid">${featuredStateCards}</div></section>

        <section class="section" id="matches"><div class="section-title"><div><span class="section-kicker">Fikstür</span><h2>Bugünün Maçları</h2><p>Gerçek oranlar ve Gate Inspector durumlarıyla kompakt görünüm.</p></div><span class="count">${todayMatches.length}</span></div>
          <div class="filterbar"><div class="filter-buttons" aria-label="Tahmin durumuna göre filtrele">
            <button class="filter-button active" type="button" data-state-filter="ALL">Tümü</button><button class="filter-button" type="button" data-state-filter="OFFICIAL">Resmi</button>
            <button class="filter-button" type="button" data-state-filter="REVIEW">İnceleme</button><button class="filter-button" type="button" data-state-filter="WAITING">Bekleyen</button>
            <button class="filter-button" type="button" data-state-filter="REJECTED">Reddedildi</button></div></div>
          <div class="scroll match-table"><table><thead><tr><th>Saat</th><th>Maç</th><th>Lig</th><th>1</th><th>X</th><th>2</th><th>Durum</th><th>Ana aday</th><th>Tahmin skoru</th><th>Geçmiş örnek</th><th>Hareket</th><th>Action</th></tr></thead><tbody>${todayMatchRows}</tbody></table></div>
          <details><summary>Önümüzdeki 14 Gün · fikstür ve güncel oran akışı</summary><div class="details-body">${upcomingLeagueSummary}
            <div class="workspace"><article class="panel"><div class="panel-head"><h3>Yaklaşan maçlar</h3><span class="count">${matches.length}</span></div><div class="panel-body match-list">${matchCards}</div></article>
              <article class="panel" id="odds"><div class="panel-head"><h3>Güncel oranlar</h3><span class="count">${odds.length}</span></div><div class="panel-body odds-list">${oddsRows}</div></article></div></div></details></section>

        <section class="section" id="archive"><div class="section-title"><div><span class="section-kicker">Sistem boş değil</span><h2>Veri Arşivi</h2><p>Canlı maç olmasa da sistemin elindeki gerçek geçmiş veriyi burada görebilirsin.</p></div></div>
          <div class="grid">
            <article class="card"><strong>Historical analiz örnekleri</strong><p style="font-size:1.45rem;color:var(--text);font-weight:900">${historicalExampleCount}</p><p>Geçmiş oran benzerliği için uygun örnek.</p></article>
            <article class="card"><strong>Gerçek oran geçmişi olan maç</strong><p style="font-size:1.45rem;color:var(--text);font-weight:900">${archivedOddsMatchCount}</p><p>Kickoff öncesi gerçek snapshot bulunan bitmiş maç.</p></article>
            <article class="card"><strong>Pre-match snapshot</strong><p style="font-size:1.45rem;color:var(--text);font-weight:900">${preKickoffSnapshotCount.toLocaleString('tr-TR')}</p><p>Oran Rotası ve geçmiş eşleşme motorunun gerçek ham verisi.</p></article>
            <article class="card"><strong>Geçmiş tahmin kaydı</strong><p style="font-size:1.45rem;color:var(--text);font-weight:900">${predictionHistory.length}</p><p>Son kayıtlar aşağıdaki geçmiş bölümünde listelenir.</p></article>
          </div>
          <div class="section-title"><div><h2>Son Tamamlanan Maçlar</h2><p>Skor ve elimizdeki geçmiş oran kayıtlarıyla birlikte.</p></div></div>
          <article class="panel"><div class="panel-body match-list">${recentFinishedCards}</div></article></section>

        <section class="section" id="prediction-lists"><div class="section-title"><div><span class="section-kicker">Tahminler</span><h2>Tüm Tahmin Kayıtları</h2><p>Resmi tahminler, incelemeye değer adaylar ve neden tahmin oluşturulmadığı.</p></div></div>
          ${predictionDiagnosticSummary}
          <div class="section-title"><div><h2>Resmi Tahminler</h2><p>Sadece tüm resmi kriterleri geçen maçlar.</p></div><span class="badge ok">${officialPredictionCount}</span></div>
          <div class="grid">${officialPredictionCards}</div>
          <div class="section-title"><div><h2>İnceleme Adayları</h2><p>Olumlu işaretler var ancak resmi tahmin için kanıt henüz tamamlanmadı.</p></div><span class="badge partial">${reviewCandidateCount}</span></div>
          <div class="grid">${reviewCandidateCards}</div>
          <div class="section-title"><div><h2>Veri Bekleyenler</h2><p>İlk/tam oran ölçümü veya resmi tahmin penceresi henüz oluşmadı.</p></div><span class="badge neutral">${waitingPredictionCount}</span></div>
          <div class="grid">${waitingPredictionCards}</div>
          <div class="section-title"><div><h2>Tahmin Oluşturulmayan Maçlar</h2><p>Kalabalık kartlar yerine yalnız ana sebebi gösteriyoruz.</p></div><span class="badge neutral">${rejectedPredictionCount}</span></div>
          ${rejectedCompact}</section>

        <section class="section" id="odds-analysis"><div class="section-title"><div><span class="section-kicker">BETAPP Farkı</span><h2>Geçmiş İkizler & Sonuç Haritası</h2><p>Benzer oran profillerini buluyor, o grubun farklı marketlerde nasıl sonuçlandığını ve lig tabanından farkını açıklıyoruz.</p></div></div>
          <div class="similarity-grid">${oddsSimilarityCards}</div></section>

        <section class="section"><div class="section-title"><div><span class="section-kicker">Odds Neighbor Engine V2</span><h2>Oran Rotası · Geçmiş İkizler · Çelişki Kontrolü</h2><p>Bu katman Prediction V1’den ayrıdır; yalnız açıklayıcı geçmiş oran analizi üretir.</p></div></div>
          <div class="grid">${oddsIntelligenceCards}</div></section>

        <section class="section" id="prediction-history"><div class="section-title"><div><span class="section-kicker">Geçmiş</span><h2>Geçmiş Tahminler</h2><p>Resmi tahminlerin ve sonuçların geçmiş kaydı.</p></div></div>
          <div class="scroll"><table><thead><tr><th>Tarih</th><th>Maç</th><th>Tahmin</th><th>Skor</th><th>Sonuç</th></tr></thead><tbody>${predictionHistoryRows}</tbody></table></div>
          <details><summary>Performans özeti</summary><div class="details-body">${performanceSummary}</div></details></section>

        <section class="section" id="prediction-self-audit"><div class="section-title"><div><span class="section-kicker">Güvenlik</span><h2>Sistem Kontrolü</h2><p>Tahmin sistemi ve veri kaynaklarının genel sağlık durumu.</p></div></div>
          ${auditOverview}
          <div class="section-title"><div><h2>Veri Kaynakları</h2><p>Hangi veri bağlantılarının çalıştığını burada görebilirsin.</p></div></div><div class="source-grid">${providerCards}</div>
          <div class="section-title"><div><h2>Aktif Ligler</h2><p>Collector'ın şu anda gerçekten takip etmeye ayarlı olduğu ligler.</p></div><span class="count">${supportedCompetitions.length}</span></div>
          <div class="grid">${supportedCompetitions.length
            ? supportedCompetitions.map((competition) => `<article class="card"><div class="row"><strong>${escapeHtml(translateCompetitionKey(competition))}</strong><span class="badge ok">Aktif</span></div></article>`).join('')
            : renderEmpty('◇', 'Aktif lig bilgisi yok', 'Runtime competition ayarları okunamadı.')}</div>
          <details><summary>Teknik sistem ayrıntılarını göster</summary><div class="details-body">${selfAuditSummary}${segmentAuditSummary}${rootCauseSummary}${adaptiveRuleSummary}
            <details><summary>Gelişmiş veri ve model bilgileri</summary><div class="details-body">${matrix}${datasetHealth}${modelValidation}</div></details>
          </div></details></section>

        <footer class="footer"><span>BETAPP · Futbol oran ve maç analiz sistemi</span><span>Resmi tahminler deterministik kurallarla üretilir · gerçek bahis yürütme yetkisi yoktur.</span></footer>
      </main>
    </div>
  </div>`);
}

export function renderCornerDetail(data: Record<string, unknown>): string {
  const probabilities = (data.probabilities ?? {}) as Record<string, { over: number; under: number }>;
  const probabilityRows = Object.entries(probabilities).map(([line, value]) =>
    `<tr><td>${escapeHtml(line)}</td><td>${(value.over * 100).toFixed(1)}%</td><td>${(value.under * 100).toFixed(1)}%</td></tr>`).join('');
  return shell(`<div class="app-shell"><aside class="sidebar"><a class="brand" href="/"><span class="brand-mark">B</span><span>BETAPP<small>Maç Detayı</small></span></a>
    <div class="side-group"><div class="side-label">Navigasyon</div><nav class="side-nav"><a href="/"><span class="nav-icon">←</span>Ana Panele Dön</a><a class="active" href="#corner-detail"><span class="nav-icon">⌁</span>Korner Analizi</a></nav></div>
    <div class="sidebar-foot"><a class="system-pill" href="/health"><span class="live-dot"></span><span><strong style="display:block;color:var(--text)">BETAPP Online</strong>Sistem Durumu</span></a></div></aside>
    <div class="app-main"><header class="topbar"><div class="top-title"><strong>Korner Analizi</strong><span>${escapeHtml(data.competition)}</span></div><div class="top-actions"><a class="top-chip" href="/">Ana Panel</a><a class="top-chip" href="/health">Sistem Durumu</a></div></header>
    <main class="content" id="corner-detail"><section class="command-hero"><article class="hero-main"><p class="eyebrow">Korner Analizi</p><h1>${escapeHtml(data.home_team)}<br>— ${escapeHtml(data.away_team)}</h1>
      <p class="hero-copy">${escapeHtml(formatDate(data.kickoff_at, { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }))} · ${escapeHtml(data.competition)} · hesaplanan korner beklentisi</p></article>
      <article class="hero-status"><div class="hero-status-head"><strong>Model Durumu</strong><span class="badge ok">${escapeHtml(data.distribution)}</span></div>
      <div class="hero-status-list"><div class="health-row"><span>Veri kalitesi</span><b>${escapeHtml(data.data_quality_score ?? '—')}/100</b></div>
      <div class="health-row"><span>Model güveni</span><b>${escapeHtml(data.model_confidence ?? '—')}/100</b></div></div></article></section>
      <section class="metrics"><article class="metric"><span class="metric-label">Ev korner beklentisi</span><strong class="metric-value">${finiteNumber(data.expected_home_corners).toFixed(2)}</strong></article>
      <article class="metric"><span class="metric-label">Deplasman</span><strong class="metric-value">${finiteNumber(data.expected_away_corners).toFixed(2)}</strong></article>
      <article class="metric"><span class="metric-label">Toplam</span><strong class="metric-value">${finiteNumber(data.expected_total_corners).toFixed(2)}</strong></article>
      <article class="metric"><span class="metric-label">Model güveni</span><strong class="metric-value">${escapeHtml(data.model_confidence ?? '—')}</strong><span class="metric-note">100 üzerinden</span></article></section>
      <section class="section"><div class="section-title"><div><span class="section-kicker">Olasılık tablosu</span><h2>Üst / Alt Olasılıkları</h2><p>Model dağılımından hesaplanan korner çizgileri.</p></div></div>
      <article class="panel"><div class="panel-body"><div class="scroll"><table><thead><tr><th>Çizgi</th><th>Üst</th><th>Alt</th></tr></thead><tbody>${probabilityRows || '<tr><td colspan="3">Olasılık verisi yok.</td></tr>'}</tbody></table></div></div></article></section>
      <section class="section"><details><summary>Hesaplama ayrıntıları</summary><div class="details-body"><pre style="white-space:pre-wrap;overflow:auto;color:var(--muted);font-size:.75rem">${escapeHtml(JSON.stringify(data.calculation_details, null, 2))}</pre></div></details></section>
      <footer class="footer"><span>BETAPP · Korner Analizi</span><span><a href="/">Ana Panel</a> · <a href="/health">Sistem Durumu</a></span></footer>
    </main></div></div>`, `${escapeHtml(data.home_team)} — ${escapeHtml(data.away_team)} | Korner Analizi`);
}
