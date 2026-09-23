import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fotmobClock, fotmobEvents } from '../../src/live/events.js';
import { eventFingerprint } from '../../src/live/events.js';
import { apiEvents, apiFixture, apiLiveOdds, ApiFootballProvider } from '../../src/providers/api-football.js';
import { matchFixture, reconcile } from '../../src/live/reconcile.js';
import { liveResponseV2 } from '../../src/live/analysis-v2.js';
import { liveResponse } from '../../src/live/analysis.js';
import { liveCard } from '../../src/live/view.js';
import { SecondaryLiveRefresh } from '../../src/live/secondary-refresh.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { buildApp } from '../../src/app.js';
import type { SourceData, SourceSnapshot } from '../../src/live/types.js';
const now = new Date('2026-09-23T17:30:00Z');
const id = '12345678-1234-1234-1234-123456789012';
const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', LOG_LEVEL: 'silent' });
const fixturePayload = { fixture: { id: 123, date: '2026-09-23T16:00:00Z', status: { short: '2H', elapsed: 90, extra: 5 } },
  league: { id: 5, round: 'League A - 1' }, teams: { home: { id: 1, name: 'Türkiye' }, away: { id: 2, name: 'France' } }, goals: { home: 1, away: 0 } };
const fixture = apiFixture(fixturePayload, now.toISOString())!;
const row = { id, league: fixture.league, home_team: 'Türkiye', away_team: 'France', kickoff_at: fixture.kickoffAt,
  status: 'live', home_score: 1, away_score: 0, statistics: [], odds: [{ current_odds: 5 }] };
const primary: SourceSnapshot = { ...fixture.snapshot, provider: 'fotmob', externalId: 'fm1', minute: 90, addedTime: 5 };
const source = (snapshot: SourceSnapshot): SourceData => ({ snapshot, events: null, statistics: null, odds: null, detailsAt: null });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('Live events V2', () => {
  it('normalizes audited real FotMob own goal, card, substitutions and provider minute', () => {
    const capture = JSON.parse(readFileSync(new URL('../fixtures/fotmob-live-6140728.json', import.meta.url), 'utf8'));
    const events = fotmobEvents({ header: capture.header, content: { matchFacts: { events: capture.events } } }, id, now.toISOString())!;
    expect(events.find(e => e.type === 'OWN_GOAL')).toMatchObject({ minute: 58, scoreAfter: { home: 1, away: 0 }, playerName: 'Oleg Baklov' });
    expect(events.find(e => e.type === 'YELLOW_CARD')?.minute).toBe(57);
    expect(events.some(e => e.type === 'SUBSTITUTION')).toBe(true);
    expect(fotmobClock(capture.header.status).minute).toBe(68);
    expect(fotmobClock({ utcTime: '2000-01-01' }).minute).toBeNull();
    expect(fotmobEvents({}, id, now.toISOString())).toBeNull();
    expect(eventFingerprint(events[0]!)).toBe(eventFingerprint({ ...events[0]!, observedAt: 'later' }));
  });
  it('normalizes genuine elapsed plus stoppage time without calculating from kickoff', () => {
    expect(fixture.snapshot).toMatchObject({ minute: 90, addedTime: 5, phase: 'SECOND_HALF' });
    const noClock = apiFixture({ ...fixturePayload, fixture: { ...fixturePayload.fixture, status: { short: '2H' } } }, now.toISOString());
    expect(noClock?.snapshot.minute).toBeNull();
    expect(apiFixture({ ...fixturePayload, league: { id: 99999 } }, now.toISOString())).toBeNull();
  });
  it.each(['A','B','C','D'])('supports Nations League %s without broadening competitions', group => {
    expect(apiFixture({ ...fixturePayload, league: { id: 5, round: `League ${group} - 2` } }, now.toISOString())?.league).toBe(`UEFA Nations League ${group}`);
  });
  it.each([1,4,960,32,9,34,10,39])('supports canonical national/club competition %s', leagueId => {
    expect(apiFixture({ ...fixturePayload, league: { id: leagueId } }, now.toISOString())).not.toBeNull();
  });
  it('normalizes goals, all cards and substitutions and deduplicates repeated observations', () => {
    const details = ['Normal Goal','Own Goal','Penalty','Missed Penalty','Yellow Card','Red Card','Yellow-Red Card','Substitution'];
    const events = apiEvents(details.map((detail, i) => ({ time: { elapsed: 67, extra: null }, team: { id: 1, name: 'Türkiye' },
      type: i === 7 ? 'subst' : i < 4 ? 'Goal' : 'Card', detail, player: { name: 'Player' } })), fixture, id, now.toISOString());
    expect(events.map(e => e.type)).toEqual(['GOAL','OWN_GOAL','PENALTY_GOAL','MISSED_PENALTY','YELLOW_CARD','RED_CARD','SECOND_YELLOW','SUBSTITUTION']);
    expect(new Set([...events, ...events].map(eventFingerprint)).size).toBe(8);
  });
  it('rejects ambiguous/reversed/out-of-window fixtures', () => {
    expect(matchFixture(fixture, [row])).toBe(id);
    expect(matchFixture({ ...fixture, homeTeam: 'Turkey' }, [row])).toBe(id);
    expect(matchFixture(fixture, [row, { ...row, id: 'another' }])).toBeNull();
    expect(matchFixture(fixture, [{ ...row, home_team: 'France', away_team: 'Türkiye' }])).toBeNull();
    expect(matchFixture(fixture, [{ ...row, kickoff_at: '2026-09-20' }])).toBeNull();
  });
  it('keeps trusted scores on fresh conflicts and selects clearly newer observations with metadata', () => {
    const conflicting = { ...fixture.snapshot, homeScore: 2 };
    expect(reconcile(primary, conflicting, now.getTime())).toMatchObject({ chosen: undefined, conflicts: [expect.objectContaining({ type: 'SCORE_CONFLICT', resolution: 'KEEP_TRUSTED' })] });
    expect(reconcile({ ...primary, observedAt: new Date(now.getTime()-240_000).toISOString() }, conflicting, now.getTime()).chosen?.provider).toBe('api-football');
    const result = liveResponseV2(row, [source(primary), source(conflicting)], 'SUPPORTED', now);
    expect(result.match.homeScore).toBe(1);
    expect(result.LIVE_ANALYSIS_V2.state).toBe('SOURCE_CONFLICT');
    expect(liveResponseV2({ ...row, status: 'finished' }, [source(primary), source(conflicting)], 'SUPPORTED', now).match.status).toBe('finished');
  });
  it('preserves V1 and authority flags, exposes real live odds only and escapes source text', () => {
    const before = structuredClone(row);
    const odds = apiLiveOdds([{ fixture: { id: 123 }, status: { finished: false, blocked: false, stopped: false },
      odds: [{ name: 'Match Winner', values: [{ value: 'Home', odd: '2.10' }] }] }], fixture, now.toISOString());
    expect(odds).toHaveLength(1);
    expect(apiLiveOdds([{ ...row, current_odds: 9 }], fixture, now.toISOString())).toEqual([]);
    const data = source(fixture.snapshot); data.odds = odds;
    data.events = apiEvents([{ type: 'Goal', detail: 'Normal Goal', time: { elapsed: 67 }, player: { name: '<script>alert(1)</script>' }, team: { id: 1 } }], fixture, id, now.toISOString());
    const result = liveResponseV2(row, [data], 'SUPPORTED', now);
    expect(result.liveOddsAvailable).toBe(true);
    expect(result.LIVE_ANALYSIS_V1).toEqual({ ...liveResponse(row).LIVE_ANALYSIS_V1, generatedAt: result.LIVE_ANALYSIS_V1.generatedAt });
    expect(result.LIVE_ANALYSIS_V2).toMatchObject({ executionAuthority: false, aiPredictionAuthority: false });
    expect(result.LIVE_ANALYSIS_V3).toMatchObject({
      version: 'LIVE_ANALYSIS_V3', executionAuthority: false, aiPredictionAuthority: false,
      shotAcceleration: { state: 'UNAVAILABLE' }, cornerAcceleration: { state: 'UNAVAILABLE' },
    });
    expect(row).toEqual(before);
    expect(liveCard(result, true)).toContain('&lt;script&gt;');
    expect(liveCard(result, true)).not.toContain('<script>alert');
    expect(liveCard(result, true)).toContain('CANLI OLAY AKIŞI');
    expect(liveResponseV2(row, [data], 'SUPPORTED', new Date(now.getTime()+181_000)).liveOddsAvailable).toBe(false);
  });
  it('starts without a key and exposes the events API with V1 and V2 together', async () => {
    const provider = new ApiFootballProvider(config);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await provider.fixtures()).toEqual([]); expect(fetch).not.toHaveBeenCalled();
    const app = buildApp(config, { liveMatches: async () => [row], matchAnalysisDetail: async () => row,
      liveSources: async () => [source(primary)], liveProviderHealth: async () => null } as never, createLogger(config));
    try {
      const result = (await app.inject(`/api/live/${id}`)).json();
      expect(result.sourceHealth.apiFootball.status).toBe('NOT_CONFIGURED');
      expect(result.LIVE_ANALYSIS_V1.version).toBe('LIVE_ANALYSIS_V1');
      expect(result.LIVE_ANALYSIS_V2.version).toBe('LIVE_ANALYSIS_V2');
      expect(result.LIVE_ANALYSIS_V3.version).toBe('LIVE_ANALYSIS_V3');
      expect((await app.inject(`/api/live/${id}/events`)).statusCode).toBe(200);
    } finally { await app.close(); }
  });
  it('backs off 429 without exposing credentials or crashing', async () => {
    const provider = new ApiFootballProvider({ ...config, API_FOOTBALL_ENABLED: true, API_FOOTBALL_KEY: 'test-only-secret' });
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 429 })); vi.stubGlobal('fetch', fetch);
    await expect(provider.fixtures()).rejects.toThrow('API_FOOTBALL_RATE_LIMITED');
    expect(provider.health).toBe('RATE_LIMITED');
    await expect(provider.fixtures()).rejects.toThrow('BACKOFF');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1].headers).toEqual({ 'x-apisports-key': 'test-only-secret' });
  });
  it('prevents overlapping or too-frequent summary cycles', async () => {
    let finish!: (value: []) => void;
    const fixtures = vi.fn(() => new Promise<[]>(r => { finish = r; }));
    const provider = { configured: true, health: 'SUPPORTED', fixtures };
    const repository = { health: vi.fn() };
    const refresh = new SecondaryLiveRefresh(provider as never, repository as never, config, createLogger(config));
    const first = refresh.runCycle(); await refresh.runCycle(); finish([]); await first; await refresh.runCycle();
    expect(fixtures).toHaveBeenCalledTimes(1);
  });
});
