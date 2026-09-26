import { describe, expect, it } from 'vitest';
import { buildGateHumanView, renderGateHumanMode, type GateViewItem } from '../../src/ui/gate-human-mode.js';

const gate = (key: string, current: unknown, required: unknown, passed = false, reasonCode: string | null = null): GateViewItem => ({
  key, label: key, current, required, passed, reasonCode, reason: passed ? null : `${key} açıklaması`,
});
const passed = (key: string) => gate(key, 'UYGUN', 'UYGUN', true);
const base = [passed('ODDS_ANALYSIS'), passed('PREDICTION_RUN'), passed('ODDS_ELIGIBILITY'),
  passed('BOOKMAKERS'), passed('COMPLETE_STATES'), passed('DATA_QUALITY'), passed('MODEL_CONFIDENCE'),
  passed('MOVEMENT'), passed('HISTORICAL_SAMPLE'), passed('PREDICTION_SCORE'), passed('CORNER_MODEL_CONFLICT'),
  passed('OFFICIAL_WINDOW'), passed('SELF_AUDIT_GLOBAL'), passed('SELF_AUDIT_SEGMENT')];
const withFailures = (...failures: GateViewItem[]) => {
  const failed = new Map(failures.map(item => [item.key, item]));
  return base.map(item => failed.get(item.key) ?? item);
};

describe('Gate Inspector Human Mode', () => {
  it('renders a primary human summary and hides the technical table in a disclosure', () => {
    const html = renderGateHumanMode({ status: 'REVIEW', predictionState: 'PREVIEW', gates: withFailures(
      gate('HISTORICAL_SAMPLE', 1, 30, false, 'INSUFFICIENT_HISTORICAL_SAMPLE')) });
    expect(html).toContain('Neden henüz resmi tahmin yok?');
    expect(html).toContain('RESMİ TAHMİN İÇİN VERİ BEKLENİYOR');
    expect(html).toContain('<summary>Teknik detayları göster</summary>');
    expect(html).not.toContain('<details class="technical-gates" open');
    expect(html).toContain('<th>Kontrol</th><th>Mevcut</th><th>Gerekli</th><th>Sonuç</th><th>Açıklama</th>');
  });

  it('selects no more than three top blockers and counts all remaining blockers', () => {
    const gates = withFailures(
      gate('HISTORICAL_SAMPLE', 1, 30), gate('PREDICTION_SCORE', 45.85, 70),
      gate('MODEL_CONFIDENCE', 39, 45), gate('DATA_QUALITY', 47, 50),
      gate('MOVEMENT', 'NEUTRAL', ['SUPPORT','STRONG_SUPPORT']), gate('OFFICIAL_WINDOW', 495, '0–90 dakika'));
    const view = buildGateHumanView({ status: 'REVIEW', gates });
    expect(view.topBlockers).toHaveLength(3);
    expect(view.additionalBlockers).toHaveLength(3);
    expect(view.topBlockers.map(item => item.key)).toEqual(['OFFICIAL_WINDOW','HISTORICAL_SAMPLE','PREDICTION_SCORE']);
    expect(renderGateHumanMode({ status: 'REVIEW', gates })).toContain('+ 3 diğer kontrol');
  });

  it('explains a small historical sample without claiming that data does not exist', () => {
    const html = renderGateHumanMode({ status: 'REVIEW', gates: withFailures(gate('HISTORICAL_SAMPLE', 1, 30)) });
    expect(html).toContain('1 benzer maç bulundu; resmi tahmin için 30 gerekiyor.');
    expect(html).not.toContain('Geçmiş veri yok');
    expect(html).toContain('sistemdeki tüm geçmiş maçları değil');
  });

  it('classifies score-only failure as weak analysis and never calls score probability', () => {
    const view = buildGateHumanView({ status: 'REVIEW', gates: withFailures(gate('PREDICTION_SCORE', 45.85, 70)) });
    expect(view.diagnosis).toBe('ANALYSIS_WEAK');
    expect(view.title).toBe('TAHMİN ŞU AN EŞİK ALTINDA');
    const html = renderGateHumanMode({ status: 'REVIEW', gates: withFailures(gate('PREDICTION_SCORE', 45.85, 70)) });
    expect(html).toContain('kazanma olasılığı veya başarı yüzdesi değildir');
    expect(html).not.toContain('45.85%');
  });

  it('classifies time-only failure and renders an understandable duration', () => {
    const gates = withFailures(gate('OFFICIAL_WINDOW', 495, '0–90 dakika', false, 'OFFICIAL_WINDOW_NOT_OPEN'));
    const view = buildGateHumanView({ status: 'WAITING', gates, matchStatus: 'scheduled' });
    expect(view.diagnosis).toBe('TIME_ONLY');
    expect(view.title).toBe('RESMİ TAHMİN ZAMANI HENÜZ GELMEDİ');
    expect(view.topBlockers[0]?.value).toBe('Maça 8 saat 15 dakika var');
    expect(view.topBlockers[0]?.explanation).toContain('90 dakika önce açılır');
    expect(view.nextStep).toContain('otomatik olarak yeniden değerlendirilecek');
  });

  it('classifies combined data and score failures as mixed', () => {
    const view = buildGateHumanView({ status: 'REVIEW', gates: withFailures(
      gate('HISTORICAL_SAMPLE', 12, 30), gate('PREDICTION_SCORE', 60, 70)) });
    expect(view.diagnosis).toBe('MIXED');
    expect(view.diagnosisText).toContain('Hem veri miktarı hem mevcut analiz');
    expect(view.nextStep).not.toContain('oluşturulacak');
  });

  it('shows official-ready only for a locked prediction with all gates passed', () => {
    const ready = buildGateHumanView({ status: 'OFFICIAL', predictionState: 'LOCKED_PREDICTION', gates: base });
    expect(ready.diagnosis).toBe('READY');
    expect(ready.title).toBe('RESMİ TAHMİN HAZIR');
    const preview = buildGateHumanView({ status: 'WAITING', predictionState: 'PREVIEW', gates: base });
    expect(preview.diagnosis).not.toBe('READY');
    expect(preview.title).not.toContain('HAZIR');
  });

  it('puts a system safety block before every other blocker', () => {
    const view = buildGateHumanView({ status: 'REJECTED', gates: withFailures(
      gate('HISTORICAL_SAMPLE', 1, 30), gate('OFFICIAL_WINDOW', 300, '0–90 dakika'),
      gate('SELF_AUDIT_GLOBAL', 'PAUSED', 'PAUSE YOK', false, 'SELF_AUDIT_PAUSED')) });
    expect(view.diagnosis).toBe('SYSTEM_BLOCKED');
    expect(view.topBlockers[0]?.key).toBe('SELF_AUDIT_GLOBAL');
    expect(view.title).toBe('SİSTEM GÜVENLİK NEDENİYLE BEKLEMEDE');
  });

  it('keeps passed rows out of primary blockers and available behind a disclosure', () => {
    const view = buildGateHumanView({ status: 'REVIEW', gates: withFailures(gate('MOVEMENT', 'NEUTRAL', ['SUPPORT'])) });
    expect(view.topBlockers).toHaveLength(1);
    expect(view.passedGates).toHaveLength(13);
    const html = renderGateHumanMode({ status: 'REVIEW', gates: withFailures(gate('MOVEMENT', 'NEUTRAL', ['SUPPORT'])) });
    expect(html).toContain('13 geçen kontrolü göster');
  });

  it('explains model confidence separately from prediction score', () => {
    const html = renderGateHumanMode({ status: 'REVIEW', gates: withFailures(
      gate('MODEL_CONFIDENCE', 39, 45), gate('PREDICTION_SCORE', 45.85, 70)) });
    expect(html).toContain('Model güveni, veri ve model tutarlılığını ölçer');
    expect(html).toContain('tahmin skoruyla aynı değer değildir');
  });

  it('describes an existing near-threshold quality value as slightly below target', () => {
    const view = buildGateHumanView({ status: 'REVIEW', gates: withFailures(gate('DATA_QUALITY', 47, 50)) });
    expect(view.topBlockers[0]?.explanation).toContain('hedefin biraz altında');
    expect(view.topBlockers[0]?.explanation).not.toContain('Veri yok');
  });

  it('does not mutate raw gate values or enum codes', () => {
    const gates = withFailures(gate('MOVEMENT', 'NEUTRAL', ['SUPPORT','STRONG_SUPPORT'], false, 'MOVEMENT_NOT_SUPPORTED'));
    const before = structuredClone(gates);
    const html = renderGateHumanMode({ status: 'REVIEW', gates });
    expect(gates).toEqual(before);
    expect(html).toContain('Belirgin piyasa desteği yok');
    expect(gates.find(item => item.key === 'MOVEMENT')?.current).toBe('NEUTRAL');
  });

  it('uses a mobile-first DOM order and keeps the technical table last', () => {
    const html = renderGateHumanMode({ status: 'REVIEW', gates: withFailures(gate('HISTORICAL_SAMPLE', 1, 30)) });
    const status = html.indexOf('human-status-card');
    const blockers = html.indexOf('human-section');
    const next = html.indexOf('human-next');
    const progress = html.indexOf('human-progress');
    const technical = html.indexOf('technical-gates');
    expect(status).toBeLessThan(blockers);
    expect(blockers).toBeLessThan(next);
    expect(next).toBeLessThan(progress);
    expect(progress).toBeLessThan(technical);
  });
});
