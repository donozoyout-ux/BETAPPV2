export type GateViewItem = {
  key?: unknown;
  label?: unknown;
  current?: unknown;
  required?: unknown;
  passed?: unknown;
  reason?: unknown;
  reasonCode?: unknown;
};

export type GateHumanModeInput = {
  status: string;
  predictionState?: unknown;
  matchStatus?: unknown;
  gates: GateViewItem[];
  lastEvaluatedAt?: unknown;
};

export type HumanGateGroup = 'SYSTEM' | 'TIME' | 'CRITICAL' | 'WAITING_FOR_DATA' | 'MARKET_CONFIRMATION';
export type HumanGateItem = {
  key: string;
  label: string;
  value: string;
  explanation: string;
  group: HumanGateGroup;
  priority: number;
  tone: 'critical' | 'waiting' | 'info';
};

export type GateHumanView = {
  title: string;
  subtitle: string;
  diagnosis: 'READY' | 'DATA_LIMITED' | 'ANALYSIS_WEAK' | 'MIXED' | 'TIME_ONLY' | 'SYSTEM_BLOCKED';
  diagnosisText: string;
  nextStep: string;
  passedCount: number;
  pendingCount: number;
  totalCount: number;
  topBlockers: HumanGateItem[];
  additionalBlockers: HumanGateItem[];
  passedGates: GateViewItem[];
  lastEvaluatedText: string | null;
};

const escapeHtml = (value: unknown): string => String(value ?? '—')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const keyOf = (gate: GateViewItem): string => String(gate.key ?? 'UNKNOWN');
const finite = (value: unknown): number | null => Number.isFinite(Number(value)) ? Number(value) : null;
const displayNumber = (value: unknown): string => {
  const number = finite(value);
  return number == null ? String(value ?? '—') : Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2)));
};

const presentationValue = (value: unknown): string => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const item = value as Record<string, unknown>;
    if ('bookmakers' in item && 'states' in item) return `${displayNumber(item.bookmakers)} şirket · ${displayNumber(item.states)} ölçüm`;
    return Object.values(item).map(displayNumber).join(' · ');
  }
  if (Array.isArray(value)) return value.map(presentationValue).join(' / ');
  const labels: Record<string, string> = {
    NEUTRAL: 'Belirgin piyasa desteği yok', SUPPORT: 'Piyasa tahmini destekliyor',
    STRONG_SUPPORT: 'Güçlü piyasa desteği', AGAINST: 'Piyasa tahminin ters yönünde',
    CONFLICT: 'Piyasa sinyalleri çelişiyor', UNAVAILABLE: 'Henüz ölçülemedi',
    PAUSED: 'Güvenlik nedeniyle durduruldu', AKTİF: 'Aktif', VAR: 'Var', YOK: 'Yok',
    'HENÜZ YOK': 'Henüz oluşmadı', 'HENÜZ UYGUN DEĞİL': 'Henüz uygun değil',
    UYGUN: 'Uygun', UYGULANMAZ: 'Uygulanmaz', KİLİTLENDİ: 'Kilitlendi',
  };
  return labels[String(value ?? '')] ?? displayNumber(value);
};

const valuePair = (gate: GateViewItem): string => `${presentationValue(gate.current)} / ${presentationValue(gate.required)}`;

const gateMeta: Record<string, { group: HumanGateGroup; priority: number; label: string }> = {
  SELF_AUDIT_GLOBAL: { group: 'SYSTEM', priority: 1, label: 'Sistem güvenliği' },
  SELF_AUDIT_SEGMENT: { group: 'SYSTEM', priority: 2, label: 'Lig ve market güvenliği' },
  OFFICIAL_WINDOW: { group: 'TIME', priority: 10, label: 'Resmi tahmin zamanı' },
  ODDS_ELIGIBILITY: { group: 'CRITICAL', priority: 20, label: 'Oran verisinin uygunluğu' },
  HISTORICAL_SAMPLE: { group: 'CRITICAL', priority: 30, label: 'Benzer geçmiş maç' },
  PREDICTION_SCORE: { group: 'CRITICAL', priority: 40, label: 'Tahmin skoru' },
  DATA_QUALITY: { group: 'WAITING_FOR_DATA', priority: 50, label: 'Veri kalitesi' },
  MODEL_CONFIDENCE: { group: 'WAITING_FOR_DATA', priority: 60, label: 'Model güveni' },
  COMPLETE_STATES: { group: 'WAITING_FOR_DATA', priority: 70, label: 'Oran geçmişi' },
  BOOKMAKERS: { group: 'WAITING_FOR_DATA', priority: 71, label: 'Bahis şirketi kapsamı' },
  MOVEMENT: { group: 'MARKET_CONFIRMATION', priority: 80, label: 'Piyasa hareketi' },
  CORNER_MODEL_CONFLICT: { group: 'MARKET_CONFIRMATION', priority: 81, label: 'Korner modeli uyumu' },
  ODDS_ANALYSIS: { group: 'WAITING_FOR_DATA', priority: 90, label: 'Oran analizi' },
  PREDICTION_RUN: { group: 'WAITING_FOR_DATA', priority: 91, label: 'Maç değerlendirmesi' },
};

function durationText(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours && remainder) return `${hours} saat ${remainder} dakika`;
  if (hours) return `${hours} saat`;
  return `${remainder} dakika`;
}

function timeExplanation(gate: GateViewItem, matchStatus: unknown): string {
  const minutes = finite(gate.current);
  const windowMinutes = typeof gate.required === 'string'
    ? finite(String(gate.required).match(/(\d+)\s*dakika/i)?.[1]) : null;
  if (String(gate.current) === 'KİLİTLENDİ') return 'Resmi tahmin kilitlendi.';
  if (String(matchStatus).toLowerCase() === 'finished') return 'Maç tamamlandı.';
  if (String(matchStatus).toLowerCase() === 'live' || (minutes != null && minutes <= 0)) return 'Maç başladı; maç öncesi resmi tahmin penceresi kapandı.';
  if (gate.passed === true) return 'Resmi tahmin penceresi açık.';
  if (minutes == null) return 'Resmi tahmin zamanlaması henüz hesaplanamadı.';
  return `Maça ${durationText(minutes)} var. Resmi tahmin penceresi maçtan ${windowMinutes ?? 'tanımlı süre'} dakika önce açılır.`;
}

function timeValue(gate: GateViewItem, matchStatus: unknown): string {
  const minutes = finite(gate.current);
  if (String(gate.current) === 'KİLİTLENDİ') return 'Tahmin kilitlendi';
  if (String(matchStatus).toLowerCase() === 'finished') return 'Maç tamamlandı';
  if (String(matchStatus).toLowerCase() === 'live' || (minutes != null && minutes <= 0)) return 'Maç başladı';
  if (gate.passed === true) return 'Resmi tahmin penceresi açık';
  return minutes == null ? 'Zaman bilgisi bekleniyor' : `Maça ${durationText(minutes)} var`;
}

function explanation(gate: GateViewItem, matchStatus: unknown): string {
  const key = keyOf(gate);
  const current = finite(gate.current);
  const required = finite(gate.required);
  if (key === 'OFFICIAL_WINDOW') return timeExplanation(gate, matchStatus);
  if (key === 'HISTORICAL_SAMPLE' && current != null && required != null) {
    return current === 1
      ? `1 benzer maç bulundu; resmi tahmin için ${displayNumber(required)} gerekiyor.`
      : `${displayNumber(current)} benzer maç bulundu; resmi tahmin için ${displayNumber(required)} gerekiyor.`;
  }
  if (key === 'PREDICTION_SCORE') return 'Mevcut analiz puanı resmi tahmin eşiğinin altında.';
  if (key === 'DATA_QUALITY' && current != null && required != null) {
    const closeToTarget = required - current > 0 && required - current <= Math.max(5, required * 0.1);
    return current > 0 ? `Veri kalitesi hedefin ${closeToTarget ? 'biraz ' : ''}altında; yeni verilerle tekrar değerlendirilecek.` : 'Yeterli veri kalitesi henüz ölçülemedi.';
  }
  if (key === 'MODEL_CONFIDENCE' && current != null && required != null) {
    return current > 0 ? 'Model güveni hedefin altında; tahmin skorundan ayrı bir veri tutarlılığı ölçümüdür.' : 'Model güvenini ölçmek için yeterli veri henüz birikmedi.';
  }
  if (key === 'COMPLETE_STATES') return 'Açılış ve güncel oranları karşılaştırmak için yeterli şirket ve ölçüm henüz birikmedi.';
  if (key === 'BOOKMAKERS') return 'Yeterli sayıda bahis şirketinden güncel oran doğrulaması bekleniyor.';
  if (key === 'ODDS_ELIGIBILITY') return 'Oran verisi resmi değerlendirme için henüz yeterli değil.';
  if (key === 'MOVEMENT') return 'Piyasa hareketi tahmini henüz desteklemiyor.';
  if (key.startsWith('SELF_AUDIT')) return 'Sistem güvenlik kontrolü normale dönmeden resmi tahmin oluşturulmaz.';
  if (key === 'ODDS_ANALYSIS') return 'Oran analizi oluştuğunda maç yeniden değerlendirilecek.';
  if (key === 'PREDICTION_RUN') return 'Prediction V1 değerlendirmesi henüz tamamlanmadı.';
  return String(gate.reason ?? 'Bu kontrol henüz tamamlanmadı.');
}

function humanGate(gate: GateViewItem, matchStatus: unknown): HumanGateItem {
  const key = keyOf(gate);
  const meta = gateMeta[key] ?? { group: 'WAITING_FOR_DATA' as const, priority: 99, label: String(gate.label ?? 'Kontrol') };
  return { key, label: meta.label, value: key === 'OFFICIAL_WINDOW' ? timeValue(gate, matchStatus) : valuePair(gate), explanation: explanation(gate, matchStatus),
    group: meta.group, priority: meta.priority,
    tone: meta.group === 'SYSTEM' || meta.group === 'CRITICAL' ? 'critical' : meta.group === 'TIME' || meta.group === 'WAITING_FOR_DATA' ? 'waiting' : 'info' };
}

function formattedEvaluation(value: unknown): string | null {
  if (value == null) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return `Son değerlendirme: ${new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }).format(date)}`;
}

export function buildGateHumanView(input: GateHumanModeInput): GateHumanView {
  const failed = input.gates.filter(item => item.passed !== true).map(item => humanGate(item, input.matchStatus))
    .sort((left, right) => left.priority - right.priority);
  const passedGates = input.gates.filter(item => item.passed === true);
  const failedKeys = new Set(failed.map(item => item.key));
  const systemBlocked = failed.some(item => item.group === 'SYSTEM');
  const timeBlocked = failedKeys.has('OFFICIAL_WINDOW');
  const dataKeys = ['ODDS_ANALYSIS','PREDICTION_RUN','ODDS_ELIGIBILITY','BOOKMAKERS','COMPLETE_STATES','DATA_QUALITY','MODEL_CONFIDENCE','HISTORICAL_SAMPLE'];
  const weakKeys = ['PREDICTION_SCORE','MOVEMENT','CORNER_MODEL_CONFLICT'];
  const dataLimited = dataKeys.some(key => failedKeys.has(key));
  const analysisWeak = weakKeys.some(key => failedKeys.has(key));
  const ready = input.status === 'OFFICIAL' && input.predictionState === 'LOCKED_PREDICTION' && failed.length === 0;
  const diagnosis: GateHumanView['diagnosis'] = ready ? 'READY' : systemBlocked ? 'SYSTEM_BLOCKED'
    : timeBlocked && !dataLimited && !analysisWeak && failed.length === 1 ? 'TIME_ONLY'
      : dataLimited && analysisWeak ? 'MIXED' : analysisWeak ? 'ANALYSIS_WEAK' : 'DATA_LIMITED';
  const diagnosisText: Record<GateHumanView['diagnosis'], string> = {
    READY: 'Bütün güvenlik kontrolleri tamamlandı ve tahmin kilitlendi.',
    DATA_LIMITED: 'Bu maç için yeterli geçmiş ve oran verisi henüz birikmedi.',
    ANALYSIS_WEAK: 'Veri mevcut, ancak mevcut analiz resmi tahmin eşiklerini karşılamıyor.',
    MIXED: 'Hem veri miktarı hem mevcut analiz henüz resmi tahmin için yeterli değil.',
    TIME_ONLY: 'Koşullar uygun olabilir ancak resmi tahmin penceresi henüz açılmadı.',
    SYSTEM_BLOCKED: 'Sistem güvenlik kontrolü nedeniyle yeni resmi tahminler beklemede.',
  };
  const title = ready ? 'RESMİ TAHMİN HAZIR' : systemBlocked ? 'SİSTEM GÜVENLİK NEDENİYLE BEKLEMEDE'
    : diagnosis === 'TIME_ONLY' ? 'RESMİ TAHMİN ZAMANI HENÜZ GELMEDİ'
      : diagnosis === 'ANALYSIS_WEAK' ? 'TAHMİN ŞU AN EŞİK ALTINDA' : 'RESMİ TAHMİN İÇİN VERİ BEKLENİYOR';
  const names = failed.slice(0, 2).map(item => item.label.toLocaleLowerCase('tr-TR')).join(' ve ');
  const subtitle = ready ? 'Tüm kontroller geçti.' : `${failed.length} kontrol tamamlanmadı.${names ? ` En önemli eksikler: ${names}.` : ''}`;
  const nextStep = ready ? 'Tahmin kilitlendi; mevcut resmi kayıt değişmeden gösterilir.'
    : systemBlocked ? 'Sistem güvenlik kontrolü normale dönmeden resmi tahmin oluşturulmaz.'
      : diagnosis === 'TIME_ONLY' ? 'Resmi tahmin penceresi açıldığında maç otomatik olarak yeniden değerlendirilecek.'
        : diagnosis === 'ANALYSIS_WEAK' ? 'Yeni veriler analizi değiştirmezse bu maç için resmi tahmin oluşturulmayabilir.'
          : diagnosis === 'MIXED' ? 'Sistem yeni verileri izlemeye devam edecek; analiz eşikleri karşılanmazsa resmi tahmin oluşturulmayabilir.'
            : 'Sistem yeni oran ve geçmiş veri geldikçe maçı otomatik olarak tekrar değerlendirecek.';
  return { title, subtitle, diagnosis, diagnosisText: diagnosisText[diagnosis], nextStep,
    passedCount: passedGates.length, pendingCount: failed.length, totalCount: input.gates.length,
    topBlockers: failed.slice(0, 3), additionalBlockers: failed.slice(3), passedGates,
    lastEvaluatedText: formattedEvaluation(input.lastEvaluatedAt) };
}

function renderBlocker(item: HumanGateItem, index?: number): string {
  const groupLabels: Record<HumanGateGroup, string> = { SYSTEM: 'Sistem', TIME: 'Zaman', CRITICAL: 'Kritik',
    WAITING_FOR_DATA: 'Veri bekleniyor', MARKET_CONFIRMATION: 'Piyasa doğrulaması' };
  const icon = item.tone === 'critical' ? '!' : item.group === 'TIME' ? '◷' : '…';
  return `<article class="human-blocker ${item.tone}" data-blocker-key="${escapeHtml(item.key)}">
    <span class="human-blocker-icon" aria-hidden="true">${icon}</span><div><small>${escapeHtml(groupLabels[item.group])}</small>
    <h4>${index == null ? '' : `${index}. `}${escapeHtml(item.label)}</h4><strong>${escapeHtml(item.value)}</strong>
    <p>${escapeHtml(item.explanation)}</p>${item.key === 'HISTORICAL_SAMPLE' ? '<p class="human-info">Bu sayı sistemdeki tüm geçmiş maçları değil, bu tahmin için market, seçim, oran ve uygunluk filtrelerinden geçen benzer maçları gösterir.</p>' : ''}
    ${item.key === 'PREDICTION_SCORE' ? '<p class="human-info">Tahmin skoru, resmi tahmin oluşturmak için kullanılan analiz puanıdır; kazanma olasılığı veya başarı yüzdesi değildir.</p>' : ''}
    ${item.key === 'MODEL_CONFIDENCE' ? '<p class="human-info">Model güveni, veri ve model tutarlılığını ölçer; tahmin skoruyla aynı değer değildir.</p>' : ''}
    ${item.key === 'OFFICIAL_WINDOW' ? '<p class="human-info">Resmi tahmin, güncel oran hareketlerini görebilmek için yalnızca maç öncesindeki tanımlı zaman penceresinde kilitlenebilir.</p>' : ''}</div></article>`;
}

function technicalStatus(gate: GateViewItem): string {
  if (keyOf(gate) === 'CORNER_MODEL_CONFLICT' && String(gate.current) === 'UYGULANMAZ') return 'UYGULANMAZ';
  if (gate.passed === true) return 'GEÇTİ';
  const waitingCodes = ['NO_ODDS_ANALYSIS','PREDICTION_NOT_GENERATED','ODDS_NOT_ELIGIBLE','INSUFFICIENT_BOOKMAKERS',
    'INSUFFICIENT_COMPLETE_STATES','LOW_DATA_QUALITY','LOW_MODEL_CONFIDENCE','OFFICIAL_WINDOW_NOT_OPEN'];
  return waitingCodes.includes(String(gate.reasonCode)) ? 'BEKLİYOR' : 'GEÇMEDİ';
}

function renderTechnicalTable(gates: GateViewItem[]): string {
  if (!gates.length) return '<p>Prediction V1 değerlendirmesi oluştuğunda kontroller burada gösterilecek.</p>';
  return `<div class="scroll"><table class="gate-table"><thead><tr><th>Kontrol</th><th>Mevcut</th><th>Gerekli</th><th>Sonuç</th><th>Açıklama</th></tr></thead><tbody>${gates.map(gate => {
    const status = technicalStatus(gate);
    return `<tr><td><strong>${escapeHtml(gate.label)}</strong></td><td>${escapeHtml(presentationValue(gate.current))}</td>
      <td>${escapeHtml(presentationValue(gate.required))}</td><td><span class="gate-result ${status === 'GEÇTİ' ? 'pass' : status === 'BEKLİYOR' ? 'wait' : status === 'UYGULANMAZ' ? 'na' : 'fail'}">${escapeHtml(status)}</span></td>
      <td>${escapeHtml(gate.reason ?? (gate.passed ? 'Koşul karşılandı.' : 'Açıklama henüz mevcut değil.'))}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

export function renderGateHumanMode(input: GateHumanModeInput): string {
  const view = buildGateHumanView(input);
  const progress = view.totalCount ? Math.round((view.passedCount / view.totalCount) * 100) : 0;
  const tone = view.diagnosis === 'READY' ? 'ready' : view.diagnosis === 'SYSTEM_BLOCKED' || view.diagnosis === 'ANALYSIS_WEAK' ? 'blocked' : 'waiting';
  return `<div class="gate-human-mode" data-human-diagnosis="${view.diagnosis}">
    <section class="human-status-card ${tone}"><span class="human-status-label">Mevcut durum</span><h3>${escapeHtml(view.title)}</h3>
      <p>${escapeHtml(view.subtitle)}</p><strong>${escapeHtml(view.diagnosisText)}</strong>${view.lastEvaluatedText ? `<small>${escapeHtml(view.lastEvaluatedText)}</small>` : ''}</section>
    ${view.topBlockers.length ? `<section class="human-section"><div class="human-section-title"><div><span>Neden henüz resmi tahmin yok?</span><h3>En önemli eksikler</h3></div><b>${view.pendingCount} kontrol bekliyor</b></div>
      <div class="human-blockers">${view.topBlockers.map((item, index) => renderBlocker(item, index + 1)).join('')}</div>
      ${view.additionalBlockers.length ? `<details class="additional-blockers"><summary>+ ${view.additionalBlockers.length} diğer kontrol</summary><div class="details-body human-blockers">${view.additionalBlockers.map(item => renderBlocker(item)).join('')}</div></details>` : ''}</section>`
      : `<section class="human-section human-ready-copy"><h3>Neden resmi tahmin hazır?</h3><p>Bütün kontroller tamamlandı ve tahmin kilitlendi.</p></section>`}
    <section class="human-next"><span aria-hidden="true">→</span><div><h3>Şimdi ne olacak?</h3><p>${escapeHtml(view.nextStep)}</p></div></section>
    <section class="human-progress" aria-label="Gate kontrollerinin tamamlanma özeti"><div><h3>${view.passedCount} / ${view.totalCount} kontrol tamamlandı</h3><span>${view.pendingCount} kontrol bekliyor</span></div>
      <div class="progress-track" role="progressbar" aria-label="Tamamlanan gate kontrolleri; tahmin güveni değildir" aria-valuenow="${view.passedCount}" aria-valuemin="0" aria-valuemax="${view.totalCount}"><i style="width:${progress}%"></i></div>
      <p>Bu ilerleme tahmin güveni veya kazanma olasılığı değildir.</p>
      ${view.passedGates.length ? `<details class="passed-gates"><summary>${view.passedCount} geçen kontrolü göster</summary><div class="details-body"><ul>${view.passedGates.map(gate => `<li>✓ ${escapeHtml(gate.label)}</li>`).join('')}</ul></div></details>` : ''}</section>
    <details class="technical-gates"><summary>Teknik detayları göster</summary><div class="details-body"><p>Tüm Prediction V1 kontrolleri ve çalışma anındaki ham eşik karşılaştırmaları.</p>${renderTechnicalTable(input.gates)}</div></details>
  </div>`;
}
