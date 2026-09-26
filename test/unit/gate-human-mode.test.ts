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
const productionFixture = () => withFailures(
  gate('ODDS_ELIGIBILITY', 'HENÜZ UYGUN DEĞİL', 'UYGUN', false, 'ODDS_NOT_ELIGIBLE'),
  gate('HISTORICAL_SAMPLE', 2, 30), gate('PREDICTION_SCORE', 36.66, 70), gate('DATA_QUALITY', 25, 50),
  gate('MODEL_CONFIDENCE', 44, 45), gate('COMPLETE_STATES', { bookmakers: 0, states: 1 }, { bookmakers: 3, states: 2 }),
  gate('MOVEMENT', 'NEUTRAL', ['SUPPORT','STRONG_SUPPORT']), gate('OFFICIAL_WINDOW', 281, '0–90 dakika', false, 'OFFICIAL_WINDOW_NOT_OPEN'));

describe('Gate Inspector Human Mode V1.1 priority and severity', () => {
  it('ranks substantive production blockers ahead of time and near-threshold confidence', () => {
    const view = buildGateHumanView({ status: 'REVIEW', predictionState: 'PREVIEW', matchStatus: 'scheduled', gates: productionFixture() });
    expect(view.diagnosis).toBe('MIXED');
    expect(view.title).toBe('RESMİ TAHMİN İÇİN KOŞULLAR HENÜZ YETERLİ DEĞİL');
    expect(view.topBlockers.map(item => item.key)).toEqual(['HISTORICAL_SAMPLE','PREDICTION_SCORE','DATA_QUALITY']);
    expect(view.topBlockers.map(item => item.key)).not.toContain('OFFICIAL_WINDOW');
    expect(view.additionalBlockers.find(item => item.key === 'MODEL_CONFIDENCE')?.severity).toBe('NEAR_THRESHOLD');
  });

  it('renders the production timing banner from runtime values', () => {
    const view = buildGateHumanView({ status: 'REVIEW', matchStatus: 'scheduled', gates: productionFixture() });
    expect(view.timing).toMatchObject({ value: 'Maça 4 saat 41 dakika var', explanation: 'Resmi tahmin penceresi 3 saat 11 dakika sonra açılacak.', windowMinutes: 90, opensInMinutes: 191 });
    const html = renderGateHumanMode({ status: 'REVIEW', matchStatus: 'scheduled', gates: productionFixture() });
    expect(html).toContain('human-timing');
    expect(html).toContain('Maça 4 saat 41 dakika var');
    expect(html).toContain('3 saat 11 dakika sonra açılacak');
  });

  it('makes time the main blocker only in a time-only state', () => {
    const gates = withFailures(gate('OFFICIAL_WINDOW', 281, '0–90 dakika', false, 'OFFICIAL_WINDOW_NOT_OPEN'));
    const view = buildGateHumanView({ status: 'WAITING', matchStatus: 'scheduled', gates });
    expect(view.diagnosis).toBe('TIME_ONLY');
    expect(view.title).toBe('RESMİ TAHMİN ZAMANI HENÜZ GELMEDİ');
    expect(view.topBlockers.map(item => item.key)).toEqual(['OFFICIAL_WINDOW']);
  });

  it('assigns deterministic numeric severities at ratio boundaries', () => {
    expect(buildGateHumanView({ status: 'REVIEW', gates: withFailures(gate('PREDICTION_SCORE', 34, 70)) }).topBlockers[0]?.severity).toBe('CRITICAL');
    expect(buildGateHumanView({ status: 'REVIEW', gates: withFailures(gate('PREDICTION_SCORE', 35, 70)) }).topBlockers[0]?.severity).toBe('MAJOR');
    expect(buildGateHumanView({ status: 'REVIEW', gates: withFailures(gate('PREDICTION_SCORE', 56, 70)) }).topBlockers[0]?.severity).toBe('WAITING');
    expect(buildGateHumanView({ status: 'REVIEW', gates: withFailures(gate('PREDICTION_SCORE', 67, 70)) }).topBlockers[0]?.severity).toBe('NEAR_THRESHOLD');
  });

  it('applies the small historical sample critical rule', () => {
    const view = buildGateHumanView({ status: 'REVIEW', gates: withFailures(gate('HISTORICAL_SAMPLE', 2, 30)) });
    expect(view.topBlockers[0]).toMatchObject({ key: 'HISTORICAL_SAMPLE', severity: 'CRITICAL' });
    expect(view.topBlockers[0]?.explanation).toContain('28 uygun geçmiş örnek daha gerekiyor');
  });

  it('ranks 2/30 historical and 36/70 score ahead of 44/45 confidence', () => {
    const view = buildGateHumanView({ status: 'REVIEW', gates: withFailures(
      gate('HISTORICAL_SAMPLE', 2, 30), gate('PREDICTION_SCORE', 36, 70), gate('MODEL_CONFIDENCE', 44, 45)) });
    expect(view.topBlockers.map(item => item.key)).toEqual(['HISTORICAL_SAMPLE','PREDICTION_SCORE','MODEL_CONFIDENCE']);
    expect(view.topBlockers[2]?.severity).toBe('NEAR_THRESHOLD');
  });

  it('ranks 25/50 data quality ahead of the informational time gate', () => {
    const view = buildGateHumanView({ status: 'REVIEW', gates: withFailures(
      gate('DATA_QUALITY', 25, 50), gate('OFFICIAL_WINDOW', 281, '0–90 dakika')) });
    expect(view.topBlockers.map(item => item.key)).toEqual(['DATA_QUALITY']);
    expect(view.topBlockers[0]?.severity).toBe('MAJOR');
    expect(view.topBlockers[0]?.explanation).toContain('Hedefin yarısı seviyesinde');
  });

  it('always puts system safety before substantive blockers', () => {
    const view = buildGateHumanView({ status: 'REJECTED', gates: withFailures(
      gate('HISTORICAL_SAMPLE', 1, 30), gate('SELF_AUDIT_GLOBAL', 'PAUSED', 'PAUSE YOK')) });
    expect(view.diagnosis).toBe('SYSTEM_BLOCKED');
    expect(view.topBlockers[0]?.key).toBe('SELF_AUDIT_GLOBAL');
  });

  it('excludes passed gates from blocker ranking', () => {
    const view = buildGateHumanView({ status: 'REVIEW', gates: withFailures(gate('MOVEMENT', 'NEUTRAL', ['SUPPORT'])) });
    expect(view.topBlockers).toHaveLength(1);
    expect(view.passedGates).toHaveLength(13);
  });

  it('handles invalid numeric values safely as waiting', () => {
    const view = buildGateHumanView({ status: 'REVIEW', gates: withFailures(gate('DATA_QUALITY', 'unknown', 50)) });
    expect(view.topBlockers[0]).toMatchObject({ severity: 'WAITING', completionRatio: null });
    expect(renderGateHumanMode({ status: 'REVIEW', gates: withFailures(gate('DATA_QUALITY', 'unknown', 50)) })).not.toContain('NaN');
    expect(buildGateHumanView({ status: 'REVIEW', gates: withFailures(gate('DATA_QUALITY', null, 50)) }).topBlockers[0]?.severity).toBe('WAITING');
  });

  it('shows clear complete-state and market movement explanations', () => {
    const html = renderGateHumanMode({ status: 'REVIEW', gates: withFailures(
      gate('COMPLETE_STATES', { bookmakers: 0, states: 1 }, { bookmakers: 3, states: 2 }),
      gate('MOVEMENT', 'NEUTRAL', ['SUPPORT'])) });
    expect(html).toContain('Mevcut: 0 şirket · 1 ölçüm. Gereken: 3 şirket · 2 ölçüm.');
    expect(html).toContain('bookmaker hareketleri mevcut tahmini belirgin biçimde desteklemiyor');
  });

  it('renders severity with text and visually distinct classes', () => {
    const html = renderGateHumanMode({ status: 'REVIEW', gates: productionFixture() });
    expect(html).toContain('data-severity="CRITICAL"');
    expect(html).toContain('KRİTİK');
    expect(html).toContain('CİDDİ EKSİK');
    expect(html).toContain('EŞİĞE YAKIN');
  });

  it('keeps the technical source-of-truth table collapsed and unchanged in structure', () => {
    const html = renderGateHumanMode({ status: 'REVIEW', gates: productionFixture() });
    expect(html).toContain('<summary>Teknik detayları göster</summary>');
    expect(html).not.toContain('<details class="technical-gates" open');
    expect(html).toContain('<th>Kontrol</th><th>Mevcut</th><th>Gerekli</th><th>Sonuç</th><th>Açıklama</th>');
  });

  it('still requires LOCKED_PREDICTION for official-ready', () => {
    expect(buildGateHumanView({ status: 'OFFICIAL', predictionState: 'LOCKED_PREDICTION', gates: base }).diagnosis).toBe('READY');
    expect(buildGateHumanView({ status: 'OFFICIAL', predictionState: 'PREVIEW', gates: base }).diagnosis).not.toBe('READY');
  });

  it('never treats PREVIEW as official-ready', () => {
    const view = buildGateHumanView({ status: 'WAITING', predictionState: 'PREVIEW', gates: base });
    expect(view.title).not.toContain('HAZIR');
  });

  it('does not mutate gate state, score, status, or enum values', () => {
    const gates = productionFixture();
    const before = structuredClone(gates);
    buildGateHumanView({ status: 'REVIEW', predictionState: 'PREVIEW', gates });
    expect(gates).toEqual(before);
    expect(gates.find(item => item.key === 'PREDICTION_SCORE')?.current).toBe(36.66);
    expect(gates.find(item => item.key === 'MOVEMENT')?.current).toBe('NEUTRAL');
  });

  it('keeps the compact mobile-first DOM order with timing before next action', () => {
    const html = renderGateHumanMode({ status: 'REVIEW', gates: productionFixture() });
    expect(html.indexOf('human-status-card')).toBeLessThan(html.indexOf('human-section'));
    expect(html.indexOf('human-section')).toBeLessThan(html.indexOf('human-timing'));
    expect(html.indexOf('human-timing')).toBeLessThan(html.indexOf('human-next'));
    expect(html.indexOf('human-progress')).toBeLessThan(html.indexOf('technical-gates'));
  });
});
