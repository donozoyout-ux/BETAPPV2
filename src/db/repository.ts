import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { MatchStatistics, NormalizedLeague, NormalizedMatch, NormalizedTeam } from '../domain/types.js';
import { resolveConsensus } from '../consensus/engine.js';
import { competitionKey } from '../matching/competition.js';
import { kickoffConfidence, normalizeTeamAlias } from '../matching/team-alias.js';
import type { DatabasePool } from './pool.js';
import { migrationStatus } from './migrator.js';
import { databaseErrorMessage } from './error.js';

type EntityType = 'league' | 'team' | 'match';

function payloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

const MAX_INLINE_PAYLOAD_BYTES = 40_000;
const MAX_ESTIMATED_JSONB_TEXT_BYTES = 50_000;
const PAYLOAD_PREVIEW_CHARS = 8_000;

function estimatedJsonbTextBytes(value: unknown): number {
  if (value === null) return 4;
  if (typeof value === 'string') return Buffer.byteLength(JSON.stringify(value));
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (typeof value === 'number') {
    const encoded = JSON.stringify(value);
    // PostgreSQL jsonb may expand exponent notation into a much longer decimal
    // representation. Compact such payloads rather than guessing the expansion.
    return /[eE]/.test(encoded) ? Number.POSITIVE_INFINITY : Buffer.byteLength(encoded);
  }
  if (Array.isArray(value)) {
    if (!value.length) return 2;
    return 2 + value.reduce((sum, item) => sum + estimatedJsonbTextBytes(item), 0) + (value.length - 1) * 2;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => JSON.stringify(item) !== undefined);
    if (!entries.length) return 2;
    return 2 + entries.reduce((sum, [key, item]) =>
      sum + Buffer.byteLength(JSON.stringify(key)) + 2 + estimatedJsonbTextBytes(item), 0) + (entries.length - 1) * 2;
  }
  return 4;
}

export function compactPayloadForStorage(payload: unknown): unknown {
  const serialized = JSON.stringify(payload);
  const originalBytes = Buffer.byteLength(serialized);
  const estimatedJsonbBytes = estimatedJsonbTextBytes(payload);
  if (originalBytes <= MAX_INLINE_PAYLOAD_BYTES && estimatedJsonbBytes <= MAX_ESTIMATED_JSONB_TEXT_BYTES) return payload;
  return {
    truncated: true,
    originalBytes,
    estimatedJsonbBytes: Number.isFinite(estimatedJsonbBytes) ? estimatedJsonbBytes : null,
    payloadSha256: createHash('sha256').update(serialized).digest('hex'),
    preview: serialized.slice(0, PAYLOAD_PREVIEW_CHARS),
  };
}

export class FootballRepository {
  private lastSuccessfulQuery: Date | null = null;

  constructor(private readonly pool: DatabasePool) {}

  private async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockEntity(client: PoolClient, provider: string, type: EntityType, externalId: string) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
      `${provider}:${type}`,
      externalId,
    ]);
  }

  private async mapping(client: PoolClient, provider: string, type: EntityType, externalId: string) {
    const result = await client.query<{ internal_id: string }>(
      'SELECT internal_id FROM provider_entities WHERE provider=$1 AND entity_type=$2 AND external_id=$3',
      [provider, type, externalId],
    );
    return result.rows[0]?.internal_id;
  }

  private async savePayload(
    client: PoolClient,
    provider: string,
    type: EntityType | 'statistics',
    externalId: string,
    payload: unknown,
    sourceUpdatedAt: Date,
  ) {
    const compact = compactPayloadForStorage(payload);
    await client.query(
      `INSERT INTO source_payloads(provider,entity_type,external_id,payload_hash,payload,source_updated_at,content_type,parser_version)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,'application/json','2') ON CONFLICT DO NOTHING`,
      [provider, type, externalId, payloadHash(compact), JSON.stringify(compact), sourceUpdatedAt],
    );
  }

  private async upsertLeague(client: PoolClient, provider: string, league: NormalizedLeague) {
    await this.lockEntity(client, provider, 'league', league.providerExternalId);
    let id = await this.mapping(client, provider, 'league', league.providerExternalId);
    if (!id) {
      const key = competitionKey(league.name);
      if (!key) throw new Error(`Unsupported competition rejected: ${league.name}`);
      const candidates = await client.query<{ id: string; name: string }>('SELECT id,name FROM leagues');
      id = candidates.rows.find((row) => competitionKey(row.name) === key)?.id;
      if (!id) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO leagues(name,country,logo_url) VALUES ($1,$2,$3) RETURNING id`,
          [league.name, league.country, league.logoUrl],
        );
        id = inserted.rows[0]!.id;
      }
      await client.query(
        `INSERT INTO provider_entities(provider,entity_type,external_id,internal_id,source_updated_at)
         VALUES ($1,'league',$2,$3,$4)
         ON CONFLICT(provider,entity_type,internal_id) DO UPDATE SET
         external_id=excluded.external_id,source_updated_at=excluded.source_updated_at,last_seen_at=now()`,
        [provider, league.providerExternalId, id, league.sourceUpdatedAt],
      );
    } else {
      await client.query(
        `UPDATE leagues SET name=$2,country=$3,logo_url=$4,updated_at=now() WHERE id=$1`,
        [id, league.name, league.country, league.logoUrl],
      );
      await this.touchMapping(client, provider, 'league', league.providerExternalId, league.sourceUpdatedAt);
    }
    await this.savePayload(client, provider, 'league', league.providerExternalId, league.raw, league.sourceUpdatedAt);
    return id;
  }

  private async upsertTeam(client: PoolClient, provider: string, team: NormalizedTeam) {
    await this.lockEntity(client, provider, 'team', team.providerExternalId);
    let id = await this.mapping(client, provider, 'team', team.providerExternalId);
    if (!id) {
      const normalizedAlias = normalizeTeamAlias(team.name);
      const alias = await client.query<{ team_id: string }>(
        'SELECT team_id FROM team_aliases WHERE normalized_alias=$1 ORDER BY provider NULLS FIRST LIMIT 1',
        [normalizedAlias],
      );
      id = alias.rows[0]?.team_id;
      if (!id) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO teams(name,short_name,country,logo_url) VALUES ($1,$2,$3,$4) RETURNING id`,
          [team.name, team.shortName, team.country, team.logoUrl],
        );
        id = inserted.rows[0]!.id;
      }
      await client.query(
        `INSERT INTO team_aliases(team_id,alias,normalized_alias,provider) VALUES($1,$2,$3,$4)
         ON CONFLICT(normalized_alias,provider) DO UPDATE SET team_id=excluded.team_id,alias=excluded.alias`,
        [id, team.name, normalizedAlias, provider],
      );
      await client.query(
        `INSERT INTO provider_entities(provider,entity_type,external_id,internal_id,source_updated_at)
         VALUES ($1,'team',$2,$3,$4)
         ON CONFLICT(provider,entity_type,internal_id) DO UPDATE SET
         external_id=excluded.external_id,source_updated_at=excluded.source_updated_at,last_seen_at=now()`,
        [provider, team.providerExternalId, id, team.sourceUpdatedAt],
      );
    } else {
      await client.query(
        `UPDATE teams SET name=$2,short_name=$3,country=$4,logo_url=$5,updated_at=now() WHERE id=$1`,
        [id, team.name, team.shortName, team.country, team.logoUrl],
      );
      await this.touchMapping(client, provider, 'team', team.providerExternalId, team.sourceUpdatedAt);
    }
    await this.savePayload(client, provider, 'team', team.providerExternalId, team.raw, team.sourceUpdatedAt);
    return id;
  }

  private async touchMapping(
    client: PoolClient,
    provider: string,
    type: EntityType,
    externalId: string,
    sourceUpdatedAt: Date,
  ) {
    await client.query(
      `UPDATE provider_entities SET source_updated_at=$4,last_seen_at=now()
       WHERE provider=$1 AND entity_type=$2 AND external_id=$3`,
      [provider, type, externalId, sourceUpdatedAt],
    );
  }

  async upsertMatch(provider: string, match: NormalizedMatch): Promise<string> {
    return this.withTransaction(async (client) => {
      const leagueId = await this.upsertLeague(client, provider, match.league);
      const homeTeamId = await this.upsertTeam(client, provider, match.homeTeam);
      const awayTeamId = await this.upsertTeam(client, provider, match.awayTeam);
      await this.lockEntity(client, provider, 'match', match.providerExternalId);
      let id = await this.mapping(client, provider, 'match', match.providerExternalId);
      let matchConfidence = 'EXACT';
      const values = [
        leagueId,
        homeTeamId,
        awayTeamId,
        match.kickoffAt,
        match.status,
        match.round,
        match.season,
        match.homeScore,
        match.awayScore,
        match.sourceUpdatedAt,
      ];
      if (!id) {
        const candidates = await client.query<{ id: string; kickoff_at: Date }>(
          `SELECT id,kickoff_at FROM matches WHERE league_id=$1 AND home_team_id=$2 AND away_team_id=$3
           AND kickoff_at BETWEEN $4::timestamptz - interval '2 hours' AND $4::timestamptz + interval '2 hours'
           ORDER BY abs(extract(epoch FROM (kickoff_at-$4::timestamptz))) LIMIT 1`,
          [leagueId, homeTeamId, awayTeamId, match.kickoffAt],
        );
        const candidate = candidates.rows[0];
        if (candidate) matchConfidence = kickoffConfidence(candidate.kickoff_at, match.kickoffAt);
        if (candidate && !['LOW', 'UNMATCHED'].includes(matchConfidence)) id = candidate.id;
        if (!id) {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO matches(league_id,home_team_id,away_team_id,kickoff_at,status,round,season,home_score,away_score,source_updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, values);
          id = inserted.rows[0]!.id;
          matchConfidence = candidate ? matchConfidence : 'UNMATCHED';
        }
        await client.query(
          `INSERT INTO provider_entities(provider,entity_type,external_id,internal_id,source_updated_at,match_confidence)
           VALUES ($1,'match',$2,$3,$4,$5)
           ON CONFLICT(provider,entity_type,internal_id) DO UPDATE SET
           external_id=excluded.external_id,source_updated_at=excluded.source_updated_at,
           match_confidence=excluded.match_confidence,last_seen_at=now()`,
          [provider, match.providerExternalId, id, match.sourceUpdatedAt, matchConfidence],
        );
      } else {
        await client.query(
          `UPDATE matches SET league_id=$2,home_team_id=$3,away_team_id=$4,kickoff_at=$5,status=$6,
           round=$7,season=$8,home_score=$9,away_score=$10,source_updated_at=$11,updated_at=now() WHERE id=$1`,
          [id, ...values],
        );
        await this.touchMapping(client, provider, 'match', match.providerExternalId, match.sourceUpdatedAt);
      }
      await this.savePayload(client, provider, 'match', match.providerExternalId, match.raw, match.sourceUpdatedAt);
      for (const [metric, value] of [['home_score', match.homeScore], ['away_score', match.awayScore]] as const) {
        if (value == null) continue;
        await client.query(
          `INSERT INTO data_observations(match_id,metric,provider,value,observed_at) VALUES($1,$2,$3,$4,$5)
           ON CONFLICT DO NOTHING`, [id, metric, provider, String(value), match.sourceUpdatedAt]);
        const latest = await client.query<{ provider: string; value: string | null }>(
          `SELECT DISTINCT ON(provider) provider,value FROM data_observations WHERE match_id=$1 AND metric=$2
           ORDER BY provider,observed_at DESC`, [id, metric]);
        const consensus = resolveConsensus(latest.rows);
        await client.query(
          `INSERT INTO data_consensus(match_id,metric,resolved_value,status,provider_count,agreement_count,confidence)
           VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(match_id,metric) DO UPDATE SET resolved_value=excluded.resolved_value,
           status=excluded.status,provider_count=excluded.provider_count,agreement_count=excluded.agreement_count,
           confidence=excluded.confidence,updated_at=now()`,
          [id, metric, consensus.resolvedValue, consensus.status, consensus.providerCount,
            consensus.agreementCount, consensus.confidence],
        );
      }
      return id;
    });
  }

  async upsertStatistics(provider: string, data: MatchStatistics): Promise<void> {
    await this.withTransaction(async (client) => {
      const matchId = await this.mapping(client, provider, 'match', data.matchProviderExternalId);
      if (!matchId) throw new Error(`Match mapping not found: ${data.matchProviderExternalId}`);
      for (const stat of data.statistics) {
        await client.query(
          `INSERT INTO match_statistics(match_id,provider,period,stat_key,label,home_value,away_value,source_updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT(match_id,provider,period,stat_key) DO UPDATE SET
             label=excluded.label,home_value=excluded.home_value,away_value=excluded.away_value,
             source_updated_at=excluded.source_updated_at,updated_at=now()`,
          [matchId, provider, stat.period, stat.key, stat.label, stat.homeValue, stat.awayValue, data.sourceUpdatedAt],
        );
        for (const [side, value] of [['home', stat.homeValue], ['away', stat.awayValue]] as const) {
          await client.query(
            `INSERT INTO data_observations(match_id,metric,provider,value,observed_at) VALUES($1,$2,$3,$4,$5)
             ON CONFLICT DO NOTHING`,
            [matchId, `${stat.key}.${side}`, provider, value == null ? null : String(value), data.sourceUpdatedAt],
          );
          const latest = await client.query<{ provider: string; value: string | null }>(
            `SELECT DISTINCT ON(provider) provider,value FROM data_observations WHERE match_id=$1 AND metric=$2
             ORDER BY provider,observed_at DESC`, [matchId, `${stat.key}.${side}`]);
          const consensus = resolveConsensus(latest.rows);
          await client.query(
            `INSERT INTO data_consensus(match_id,metric,resolved_value,status,provider_count,agreement_count,confidence)
             VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(match_id,metric) DO UPDATE SET resolved_value=excluded.resolved_value,
             status=excluded.status,provider_count=excluded.provider_count,agreement_count=excluded.agreement_count,
             confidence=excluded.confidence,updated_at=now()`,
            [matchId, `${stat.key}.${side}`, consensus.resolvedValue, consensus.status, consensus.providerCount,
              consensus.agreementCount, consensus.confidence],
          );
        }
      }
      await this.savePayload(client, provider, 'statistics', data.matchProviderExternalId, data.raw, data.sourceUpdatedAt);
    });
  }

  async getCheckpoint(provider: string, scope: string): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query<{ cursor: Record<string, unknown> }>(
      'SELECT cursor FROM collector_checkpoints WHERE provider=$1 AND scope=$2',
      [provider, scope],
    );
    return result.rows[0]?.cursor ?? null;
  }

  async markStarted(provider: string, scope: string, cursor: Record<string, unknown>) {
    await this.pool.query(
      `INSERT INTO collector_checkpoints(provider,scope,cursor,last_started_at) VALUES($1,$2,$3::jsonb,now())
       ON CONFLICT(provider,scope) DO UPDATE SET cursor=excluded.cursor,last_started_at=now(),updated_at=now()`,
      [provider, scope, JSON.stringify(cursor)],
    );
  }

  async markSucceeded(provider: string, scope: string, cursor: Record<string, unknown>) {
    await this.pool.query(
      `UPDATE collector_checkpoints SET cursor=$3::jsonb,last_succeeded_at=now(),last_error=NULL,updated_at=now()
       WHERE provider=$1 AND scope=$2`,
      [provider, scope, JSON.stringify(cursor)],
    );
  }

  async markFailed(provider: string, scope: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await this.pool.query(
      `UPDATE collector_checkpoints SET last_failed_at=now(),last_error=$3,updated_at=now()
       WHERE provider=$1 AND scope=$2`,
      [provider, scope, message.slice(0, 2000)],
    );
  }

  async updateProviderStatus(provider: string, ok: boolean, latencyMs: number, message?: string) {
    const failureStatus = message && /HTTP (403|429)/.test(message) ? 'blocked' : 'unavailable';
    await this.pool.query(
      `INSERT INTO provider_status(provider,status,last_checked_at,last_success_at,last_failure_at,latency_ms,consecutive_failures,message,total_attempts,total_successes)
       VALUES($1,$2,now(),CASE WHEN $3 THEN now() END,CASE WHEN NOT $3 THEN now() END,$4,CASE WHEN $3 THEN 0 ELSE 1 END,$5,1,CASE WHEN $3 THEN 1 ELSE 0 END)
       ON CONFLICT(provider) DO UPDATE SET status=excluded.status,last_checked_at=now(),
         last_success_at=CASE WHEN $3 THEN now() ELSE provider_status.last_success_at END,
         last_failure_at=CASE WHEN NOT $3 THEN now() ELSE provider_status.last_failure_at END,
         latency_ms=$4,consecutive_failures=CASE WHEN $3 THEN 0 ELSE provider_status.consecutive_failures+1 END,
         message=$5,total_attempts=provider_status.total_attempts+1,
         total_successes=provider_status.total_successes+CASE WHEN $3 THEN 1 ELSE 0 END,updated_at=now()`,
      [provider, ok ? 'healthy' : failureStatus, ok, latencyMs, message ?? null],
    );
  }

  async markProviderFetch(provider: string) {
    await this.pool.query('UPDATE provider_status SET last_fetch_at=now(),updated_at=now() WHERE provider=$1', [provider]);
  }

  async updateCircuitState(provider: string, state: string, cooldownUntil: Date | null) {
    await this.pool.query(
      `INSERT INTO provider_status(provider,status,last_checked_at,circuit_state,cooldown_until)
       VALUES($1,'unknown',now(),$2,$3) ON CONFLICT(provider) DO UPDATE SET circuit_state=$2,cooldown_until=$3,updated_at=now()`,
      [provider, state, cooldownUntil],
    );
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
    this.lastSuccessfulQuery = new Date();
  }

  async databaseHealth() {
    const startedAt = Date.now();
    const requiredTables = ['leagues','teams','matches','provider_entities','match_statistics','collector_checkpoints','odds_snapshots',
      'historical_match_stats','team_corner_profiles','league_corner_baselines','corner_model_versions','corner_analyses',
      'corner_backtests','backfill_runs','backfill_failures','dataset_audits','odds_analysis_model_versions',
      'odds_analysis_runs','odds_analysis_items','odds_analysis_backtests'];
    requiredTables.push('prediction_model_versions','prediction_runs','prediction_historical_examples','prediction_historical_refreshes','prediction_journal','prediction_settlements','prediction_self_audits','prediction_self_audit_segments','prediction_self_audit_factors','prediction_adaptive_rule_runs','prediction_adaptive_rule_proposals','prediction_adaptive_rule_decisions');
    requiredTables.push('historical_stat_provenance','historical_backfill_jobs');
    const requiredIndexes = ['matches_kickoff_idx','provider_entities_internal_idx','historical_stats_competition_kickoff_idx',
      'historical_stats_home_kickoff_idx','historical_stats_away_kickoff_idx','backfill_runs_status_idx',
      'backfill_failures_retry_idx','dataset_audits_created_idx','corner_backtests_created_idx','odds_history_idx',
      'odds_analysis_runs_match_created_idx','odds_analysis_items_run_idx','odds_analysis_backtests_created_idx'];
    requiredIndexes.push('prediction_runs_match_created_idx','prediction_historical_examples_lookup_idx','prediction_historical_examples_eligible_idx',
      'prediction_journal_kickoff_idx','prediction_settlements_outcome_idx','prediction_self_audits_latest_idx',
      'prediction_self_audit_segments_latest_idx','prediction_self_audit_segments_status_idx',
      'prediction_self_audit_factors_latest_idx','prediction_self_audit_factors_risk_idx',
      'prediction_adaptive_rule_runs_latest_idx','prediction_adaptive_rule_proposals_latest_idx',
      'prediction_adaptive_rule_proposals_risk_idx');
    requiredIndexes.push('historical_stat_provenance_match_idx','historical_backfill_jobs_status_idx');
    requiredIndexes.push('odds_snapshots_neighbor_market_idx','matches_status_kickoff_idx');
    const checks = { connection: false, read: false, write: false, transaction: false, advisoryLock: false,
      migrationTable: false, requiredTables: false, requiredIndexes: false };
    try {
      await this.pool.query('SELECT 1');
      checks.connection = true; checks.read = true;
      const client = await this.pool.connect();
      let locked = false;
      try {
        await client.query('BEGIN');
        await client.query('CREATE TEMP TABLE betapp_health_write(value integer) ON COMMIT DROP');
        await client.query('INSERT INTO betapp_health_write(value) VALUES(1)');
        const written = await client.query<{ value: number }>('SELECT value FROM betapp_health_write');
        checks.write = written.rows[0]?.value === 1;
        await client.query('ROLLBACK');
        checks.transaction = checks.write;
        const lock = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', ['betapp-v2:health']);
        locked = lock.rows[0]?.locked === true;
        checks.advisoryLock = locked;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['betapp-v2:health']).catch(() => undefined);
        client.release();
      }
      const migrations = await migrationStatus(this.pool);
      checks.migrationTable = true;
      const tables = await this.pool.query<{ table_name: string }>(
        'SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=ANY($1::text[])', [requiredTables]);
      const indexes = await this.pool.query<{ indexname: string }>(
        'SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND indexname=ANY($1::text[])', [requiredIndexes]);
      const foundTables = new Set(tables.rows.map((row) => row.table_name));
      const foundIndexes = new Set(indexes.rows.map((row) => row.indexname));
      checks.requiredTables = requiredTables.every((name) => foundTables.has(name));
      checks.requiredIndexes = requiredIndexes.every((name) => foundIndexes.has(name));
      this.lastSuccessfulQuery = new Date();
      const healthy = Object.values(checks).every(Boolean) && migrations.pendingMigrations.length === 0;
      return { status: healthy ? 'ok' : 'degraded', latencyMs: Date.now() - startedAt, checks, migrations,
        missingTables: requiredTables.filter((name) => !foundTables.has(name)),
        missingIndexes: requiredIndexes.filter((name) => !foundIndexes.has(name)),
        lastSuccessfulQuery: this.lastSuccessfulQuery.toISOString() };
    } catch (error) {
      return { status: 'down', latencyMs: Date.now() - startedAt, checks,
        migrations: null, lastSuccessfulQuery: this.lastSuccessfulQuery?.toISOString() ?? null,
        error: databaseErrorMessage(error) };
    }
  }

  async operationalHealth() {
    const [providerRows, qualificationRows, workerRows, backfillRows] = await Promise.all([
      this.pool.query('SELECT provider,status,last_checked_at,last_success_at,last_failure_at,message FROM provider_status'),
      this.pool.query(`SELECT provider,max(checked_at) checked_at,
        CASE WHEN bool_or(result='SUPPORTED') THEN 'healthy' WHEN bool_or(result='BLOCKED') THEN 'blocked' ELSE 'unavailable' END status
        FROM provider_qualification GROUP BY provider`),
      this.pool.query(`SELECT max(last_started_at) last_run,max(last_succeeded_at) last_success
        FROM collector_checkpoints WHERE scope='fixtures-and-statistics'`),
      this.pool.query('SELECT status,competition_name,season,updated_at FROM backfill_runs ORDER BY updated_at DESC LIMIT 1'),
    ]);
    const providerMap = new Map(providerRows.rows.map((row) => [row.provider, row]));
    for (const row of qualificationRows.rows) if (!providerMap.has(row.provider)) providerMap.set(row.provider, row);
    const providers = Object.fromEntries(['fotmob','sofascore','iddaa','flashscore','nowgoal'].map((name) =>
      [name, providerMap.get(name) ?? { provider: name, status: 'unknown' }]));
    return { providers, worker: { lastRun: workerRows.rows[0]?.last_run ?? null, lastSuccess: workerRows.rows[0]?.last_success ?? null },
      backfill: backfillRows.rows[0] ?? { status: 'NOT_STARTED' } };
  }

  async backfillStatus() {
    const [runs, failures] = await Promise.all([
      this.pool.query(`SELECT competition_name competition,season,status,fixtures_discovered discovered,matches_fetched fetched,
        matches_stored stored,corner_complete "cornerComplete",partial,failed,retries,started_at "startedAt",
        updated_at "updatedAt",completed_at "completedAt",last_checkpoint "lastCheckpoint"
        FROM backfill_runs ORDER BY started_at DESC`),
      this.pool.query(`SELECT competition_external_id,season,classification,count(*)::integer count
        FROM backfill_failures WHERE resolved_at IS NULL GROUP BY 1,2,3 ORDER BY 1,2,3`),
    ]);
    return { runs: runs.rows, unresolvedFailures: failures.rows };
  }

  async dashboardData(timeZone: string) {
    const [matches, recentFinished, archiveSummary, providers, qualification, cornerAnalyses, oddsAnalyses, datasetAudit, validation, backfill, odds] = await Promise.all([
      this.pool.query(
        `SELECT m.id,m.kickoff_at,m.status,m.home_score,m.away_score,l.name AS league,
          ht.name AS home_team,at.name AS away_team,
          COALESCE(jsonb_agg(DISTINCT jsonb_build_object('key',s.stat_key,'label',s.label,'period',s.period))
            FILTER (WHERE s.stat_key IS NOT NULL),'[]'::jsonb) AS available_statistics
         FROM matches m JOIN leagues l ON l.id=m.league_id JOIN teams ht ON ht.id=m.home_team_id
         JOIN teams at ON at.id=m.away_team_id LEFT JOIN match_statistics s ON s.match_id=m.id
         WHERE (m.kickoff_at AT TIME ZONE $1)::date BETWEEN (now() AT TIME ZONE $1)::date
           AND (now() AT TIME ZONE $1)::date + 14
         GROUP BY m.id,l.name,ht.name,at.name ORDER BY m.kickoff_at`,
        [timeZone],
      ),
      this.pool.query(
        `SELECT m.id,m.kickoff_at,m.status,m.home_score,m.away_score,l.name league,
          ht.name home_team,at.name away_team,
          count(DISTINCT os.id)::integer odds_snapshots,
          count(DISTINCT (os.market_type,os.market_name,os.line,os.selection))::integer odds_markets
         FROM matches m
         JOIN leagues l ON l.id=m.league_id
         JOIN teams ht ON ht.id=m.home_team_id
         JOIN teams at ON at.id=m.away_team_id
         LEFT JOIN odds_snapshots os ON os.match_id=m.id AND os.captured_at<m.kickoff_at
         WHERE m.status='finished'
         GROUP BY m.id,l.name,ht.name,at.name
         ORDER BY m.kickoff_at DESC
         LIMIT 15`
      ),
      this.pool.query(
        `SELECT
          count(DISTINCT m.id) FILTER(WHERE m.status='finished')::integer finished_matches,
          count(DISTINCT m.id) FILTER(WHERE m.status='finished' AND os.captured_at<m.kickoff_at)::integer finished_matches_with_odds,
          count(*) FILTER(WHERE m.status='finished' AND os.captured_at<m.kickoff_at)::bigint pre_kickoff_snapshots,
          min(m.kickoff_at) FILTER(WHERE m.status='finished' AND os.captured_at<m.kickoff_at) earliest_odds_match,
          max(m.kickoff_at) FILTER(WHERE m.status='finished' AND os.captured_at<m.kickoff_at) latest_odds_match
         FROM matches m
         LEFT JOIN odds_snapshots os ON os.match_id=m.id`
      ),
      this.pool.query('SELECT * FROM provider_status ORDER BY provider'),
      this.pool.query('SELECT * FROM provider_qualification ORDER BY provider,capability'),
      this.pool.query(
        `SELECT DISTINCT ON(ca.match_id) ca.*,ht.name home_team,at.name away_team,m.kickoff_at
         FROM corner_analyses ca JOIN matches m ON m.id=ca.match_id JOIN teams ht ON ht.id=m.home_team_id
         JOIN teams at ON at.id=m.away_team_id
         WHERE (m.kickoff_at AT TIME ZONE $1)::date >= (now() AT TIME ZONE $1)::date
         ORDER BY ca.match_id,ca.created_at DESC`, [timeZone]),
      this.pool.query(`SELECT r.*,m.kickoff_at,l.name league,ht.name home_team,at.name away_team,
        COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.score DESC) FILTER(WHERE i.id IS NOT NULL),'[]'::jsonb) items
        FROM odds_analysis_runs r JOIN matches m ON m.id=r.match_id JOIN leagues l ON l.id=m.league_id
        JOIN teams ht ON ht.id=m.home_team_id JOIN teams at ON at.id=m.away_team_id
        LEFT JOIN odds_analysis_items i ON i.run_id=r.id
        WHERE m.kickoff_at>=now() AND NOT EXISTS(SELECT 1 FROM odds_analysis_runs newer
          WHERE newer.match_id=r.match_id AND newer.model_version=r.model_version
          AND (newer.created_at,newer.id)>(r.created_at,r.id))
        GROUP BY r.id,m.kickoff_at,l.name,ht.name,at.name ORDER BY m.kickoff_at`),
      this.pool.query('SELECT report,created_at FROM dataset_audits ORDER BY created_at DESC LIMIT 1'),
      this.pool.query('SELECT report,model_version,config_hash,created_at FROM corner_backtests ORDER BY created_at DESC LIMIT 1'),
      this.pool.query('SELECT * FROM backfill_runs ORDER BY updated_at DESC LIMIT 20'),
      this.upcomingOdds(300),
    ]);
    return { matches: matches.rows, recentFinishedMatches: recentFinished.rows, archiveSummary: archiveSummary.rows[0] ?? null,
      providers: providers.rows, qualification: qualification.rows, cornerAnalyses: cornerAnalyses.rows,
      oddsAnalyses: oddsAnalyses.rows, datasetAudit: datasetAudit.rows[0] ?? null,
      validation: validation.rows[0] ?? null, backfill: backfill.rows, odds };
  }

  async upcomingOdds(limit = 300) {
    const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));
    return (await this.pool.query(
      `SELECT os.match_id,m.kickoff_at,l.name league,home.name home_team,away.name away_team,
        os.provider,os.market_type,os.market_name,os.line,os.selection,os.opening_odds,os.current_odds,
        os.highest_odds,os.lowest_odds,os.movement_percent,os.snapshot_count
       FROM odds_summary os JOIN matches m ON m.id=os.match_id JOIN leagues l ON l.id=m.league_id
       JOIN teams home ON home.id=m.home_team_id JOIN teams away ON away.id=m.away_team_id
       WHERE m.status IN ('scheduled','live') AND m.kickoff_at >= now() - interval '3 hours'
       AND os.provider LIKE 'nowgoal:%'
       ORDER BY m.kickoff_at,home.name,os.market_type,os.line NULLS FIRST,os.provider,os.selection
       LIMIT $1`, [safeLimit])).rows;
  }

  async cornerAnalysisDetail(matchId: string) {
    const result = await this.pool.query(
      `SELECT ca.*,ht.name home_team,at.name away_team,l.name competition,m.kickoff_at
       FROM corner_analyses ca JOIN matches m ON m.id=ca.match_id JOIN teams ht ON ht.id=m.home_team_id
       JOIN teams at ON at.id=m.away_team_id JOIN leagues l ON l.id=m.league_id
       WHERE ca.match_id=$1 ORDER BY ca.created_at DESC LIMIT 1`, [matchId]);
    return result.rows[0] ?? null;
  }
}
