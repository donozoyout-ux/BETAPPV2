import { describe, expect, it } from 'vitest';
import { predictionPresentationStatus, renderDashboard } from '../../src/dashboard.js';

const candidate = (score = 75) => ({ marketType: 'TOTAL_GOALS', line: 2.5, selection: 'UNDER', predictionScore: score,
  bookmakerCount: 4, dataQualityGrade: 'GOOD', confidenceGrade: 'GOOD', movementClass: 'SUPPORT',
  historical: { settledSampleSize: 35, historicalHitRate: 0.62 } });
const item = (overrides: Record<string, unknown> = {}) => ({ match_id: 'today-1', state: 'PREVIEW',
  predictionGate: { overallStatus: 'REJECTED', blockers: [], gates: [], candidate: candidate() }, ...overrides });
const dashboard = (predictions: Array<Record<string, unknown>>) => renderDashboard({ matches: [{ id: 'today-1', home_team: 'Home', away_team: 'Away', league: 'Test League', kickoff_at: new Date().toISOString() }], providers: [], predictions });

describe('official prediction and Today presentation', () => {
  it('labels only a locked, gate-approved record as official', () => {
    expect(predictionPresentationStatus(item({ state: 'LOCKED_PREDICTION', predictionGate: { overallStatus: 'OFFICIAL', blockers: [], gates: [], candidate: candidate() } }))).toBe('OFFICIAL');
  });
  it('labels a candidate below the score threshold as Eşik Altı', () => {
    expect(predictionPresentationStatus(item({ predictionGate: { overallStatus: 'REJECTED', blockers: ['LOW_PREDICTION_SCORE'], gates: [], candidate: candidate(62) } }))).toBe('CANDIDATE_REJECTED');
  });
  it('labels a missing historical sample as waiting for data', () => {
    expect(predictionPresentationStatus(item({ predictionGate: { overallStatus: 'REJECTED', blockers: ['INSUFFICIENT_HISTORICAL_SAMPLE'], gates: [], candidate: candidate() } }))).toBe('WAITING_FOR_DATA');
  });
  it('labels missing odds analysis as waiting for data', () => {
    expect(predictionPresentationStatus(item({ predictionGate: { overallStatus: 'WAITING', blockers: ['NO_ODDS_ANALYSIS'], gates: [], candidate: null } }))).toBe('WAITING_FOR_DATA');
  });
  it('labels a missing Prediction V1 run as waiting for data', () => {
    expect(predictionPresentationStatus(item({ predictionGate: { overallStatus: 'WAITING', blockers: ['PREDICTION_NOT_GENERATED'], gates: [], candidate: null } }))).toBe('WAITING_FOR_DATA');
  });
  it('labels an explicit analysis failure as analysis error', () => {
    expect(predictionPresentationStatus(item({ analysisStatus: 'FAILED', predictionGate: { overallStatus: 'REJECTED', blockers: [], gates: [], candidate: null } }))).toBe('ANALYSIS_FAILED');
  });
  it('does not promote a failing candidate to official', () => {
    expect(predictionPresentationStatus(item())).toBe('CANDIDATE_REJECTED');
  });
  it('keeps a complete locked candidate official only when every gate is approved', () => {
    expect(predictionPresentationStatus(item({ state: 'LOCKED_PREDICTION', predictionGate: { overallStatus: 'REJECTED', blockers: ['LOW_PREDICTION_SCORE'], gates: [], candidate: candidate() } }))).toBe('CANDIDATE_REJECTED');
  });
  it('shows only locked official records in Today official predictions', () => {
    const official = item({ state: 'LOCKED_PREDICTION', home_team: 'Home', away_team: 'Away', league: 'Test League', kickoff_at: new Date().toISOString(), predictionGate: { overallStatus: 'OFFICIAL', blockers: [], gates: [], candidate: candidate() } });
    const html = dashboard([official, item({ match_id: 'other', home_team: 'Not Official' })]);
    const today = html.slice(html.indexOf('id="today"'), html.indexOf('id="official"'));
    expect(today).toContain('RESMİ TAHMİNLER · 1');
    expect(today).toContain('Home — Away');
    expect(today).not.toContain('Not Official');
  });
  it('keeps Today status and its Gate Inspector presentation in parity', () => {
    const rejected = item({ predictionGate: { overallStatus: 'REJECTED', blockers: ['LOW_PREDICTION_SCORE'], gates: [], candidate: candidate(50) } });
    const html = dashboard([rejected]);
    expect(html).toContain('Eşik Altı');
    expect(html).toContain('Resmi tahmin: yayınlanmadı.');
  });
});
