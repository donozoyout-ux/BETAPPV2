import type { PoolClient } from 'pg';
import type { DatabasePool } from '../db/pool.js';
import type { NormalizedMatch } from '../domain/types.js';
import type { ApiFixture } from '../providers/api-football.js';
import { eventFingerprint, fotmobClock, fotmobPhase } from './events.js';
import { matchFixture, reconcile } from './reconcile.js';
import { obj, type ProviderHealth, type SourceData, type SourceSnapshot } from './types.js';

type Queryable = Pick<PoolClient, 'query'>;
export async function sourceData(db: Queryable, matchId: string): Promise<SourceData[]> {
  return (await db.query<{ data: SourceData }>('SELECT data FROM live_source_snapshots WHERE match_id=$1', [matchId])).rows.map(r => r.data);
}
export async function saveSource(db: Queryable, matchId: string, data: SourceData) {
  await db.query(`INSERT INTO live_source_snapshots(match_id,provider,data,observed_at) VALUES($1,$2,$3::jsonb,$4)
    ON CONFLICT(match_id,provider) DO UPDATE SET data=excluded.data,observed_at=excluded.observed_at
    WHERE live_source_snapshots.observed_at <= excluded.observed_at`, [matchId, data.snapshot.provider, JSON.stringify(data), data.snapshot.observedAt]);
  if (data.events == null) return;
  for (const event of data.events) {
    await db.query(`INSERT INTO live_match_events(match_id,provider,fingerprint,data,observed_at) VALUES($1,$2,$3,$4::jsonb,$5)
      ON CONFLICT(match_id,provider,fingerprint) DO UPDATE SET data=excluded.data,observed_at=excluded.observed_at,updated_at=now()
      WHERE live_match_events.observed_at <= excluded.observed_at`, [matchId, event.provider, eventFingerprint(event), JSON.stringify(event), event.observedAt]);
  }
}
// Runs inside the existing fixture transaction, serializing all providers on the canonical match row.
export async function guardPrimary(db: Queryable, id: string, provider: string, match: NormalizedMatch): Promise<boolean> {
  await db.query('SELECT id FROM matches WHERE id=$1 FOR UPDATE', [id]);
  const sources = await sourceData(db, id);
  if (provider !== 'fotmob') return !sources.length;
  if (match.status !== 'live' && !sources.length) return true;
  const old = sources.find(s => s.snapshot.provider === 'fotmob');
  const clock = fotmobClock(obj(match.raw).status);
  const snapshot: SourceSnapshot = { provider: 'fotmob', externalId: match.providerExternalId, status: match.status,
    phase: fotmobPhase(obj(match.raw).status), homeScore: match.homeScore, awayScore: match.awayScore,
    ...clock, observedAt: match.sourceUpdatedAt.toISOString() };
  await saveSource(db, id, { snapshot, events: old?.events ?? null, statistics: old?.statistics ?? null,
    odds: null, detailsAt: old?.detailsAt ?? null });
  const result = reconcile(snapshot, sources.find(s => s.snapshot.provider === 'api-football')?.snapshot);
  return result.chosen?.provider === 'fotmob';
}
export class LiveRepository {
  constructor(private readonly pool: DatabasePool) {}
  async health(status: ProviderHealth, detail: string | null = null) {
    await this.pool.query(`INSERT INTO live_provider_health(provider,status,detail) VALUES('api-football',$1,$2)
      ON CONFLICT(provider) DO UPDATE SET status=excluded.status,detail=excluded.detail,checked_at=now()`, [status, detail]);
  }
  async readHealth() {
    return (await this.pool.query('SELECT status,checked_at,detail FROM live_provider_health WHERE provider=$1', ['api-football'])).rows[0] ?? null;
  }
  async read(id: string) { return sourceData(this.pool, id); }
  async resolve(fixture: ApiFixture): Promise<string | null> {
    const rows = (await this.pool.query(`SELECT m.id,m.kickoff_at,l.name league,h.name home_team,a.name away_team
      FROM matches m JOIN leagues l ON l.id=m.league_id JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id
      WHERE m.status <> 'finished' AND m.kickoff_at BETWEEN $1::timestamptz-interval '10 minutes' AND $1::timestamptz+interval '10 minutes'
      AND EXISTS(SELECT 1 FROM provider_entities p WHERE p.internal_id=m.id AND p.entity_type='match' AND p.provider='fotmob')`, [fixture.kickoffAt])).rows;
    const id = matchFixture(fixture, rows);
    if (!id) return null;
    const existing = await this.pool.query(`SELECT internal_id FROM provider_entities WHERE provider='api-football' AND entity_type='match' AND external_id=$1`, [fixture.snapshot.externalId]);
    if (existing.rows[0] && String(existing.rows[0].internal_id) !== id) return null;
    await this.pool.query(`INSERT INTO provider_entities(provider,entity_type,external_id,internal_id,source_updated_at,match_confidence)
      VALUES('api-football','match',$1,$2,$3,'HIGH') ON CONFLICT DO NOTHING`, [fixture.snapshot.externalId, id, fixture.snapshot.observedAt]);
    const mapping = await this.pool.query(`SELECT internal_id FROM provider_entities WHERE provider='api-football' AND entity_type='match' AND external_id=$1`, [fixture.snapshot.externalId]);
    return String(mapping.rows[0]?.internal_id) === id ? id : null;
  }
  async save(id: string, incoming: SourceData) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query('SELECT status,home_score,away_score,source_updated_at FROM matches WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row) throw new Error('MATCH_UNRESOLVED');
      const before = await sourceData(client, id);
      if (incoming.snapshot.provider === 'api-football' && !before.some(s => s.snapshot.provider === 'fotmob')) {
        const mapping = (await client.query("SELECT external_id FROM provider_entities WHERE internal_id=$1 AND entity_type='match' AND provider='fotmob'", [id])).rows[0];
        if (mapping) {
          const base: SourceData = { snapshot: { provider: 'fotmob', externalId: String(mapping.external_id),
            status: row.status, phase: row.status === 'finished' ? 'FINISHED' : 'UNKNOWN',
            homeScore: row.home_score, awayScore: row.away_score, minute: null, addedTime: null,
            observedAt: new Date(row.source_updated_at).toISOString() }, events: null, statistics: null, odds: null, detailsAt: null };
          before.push(base); await saveSource(client, id, base);
        }
      }
      const previous = before.find(s => s.snapshot.provider === incoming.snapshot.provider);
      if (!previous || Date.parse(previous.snapshot.observedAt) <= Date.parse(incoming.snapshot.observedAt)) {
        const data = { ...incoming, events: incoming.events ?? previous?.events ?? null,
          statistics: incoming.statistics ?? previous?.statistics ?? null,
          detailsAt: incoming.detailsAt ?? previous?.detailsAt ?? null };
        await saveSource(client, id, data);
        if (incoming.snapshot.provider === 'api-football') {
          const result = reconcile(before.find(s => s.snapshot.provider === 'fotmob')?.snapshot, incoming.snapshot);
          const chosen = result.chosen;
          if (chosen?.provider === 'api-football' && row.status !== 'finished') {
            await client.query(`UPDATE matches SET status=$2,home_score=COALESCE($3,home_score),away_score=COALESCE($4,away_score),
              source_updated_at=$5,updated_at=now() WHERE id=$1 AND status <> 'finished'
              AND source_updated_at <= $5`, [id, chosen.status, chosen.homeScore, chosen.awayScore, chosen.observedAt]);
          }
        }
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
