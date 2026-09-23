import type { AppConfig } from './config.js';
import type { DatabasePool } from './db/pool.js';

export type ControlAuditStatus = 'PASS' | 'WARN' | 'FAIL';
export type ControlAuditCheck = {
  key: string;
  status: ControlAuditStatus;
  value: unknown;
  message: string;
};

export class ControlAuditService {
  constructor(private readonly pool: DatabasePool, private readonly config: AppConfig) {}

  async run(timeZone = 'Europe/Istanbul') {
    const persistence = (await this.pool.query(`SELECT
      count(*)::integer total,
      count(*) FILTER (WHERE EXISTS(
        SELECT 1 FROM provider_entities p WHERE p.internal_id=m.id AND p.entity_type='match'
      ))::integer mapped
      FROM matches m
      WHERE (m.kickoff_at AT TIME ZONE $1)::date=(now() AT TIME ZONE $1)::date`, [timeZone])).rows[0] ?? { total: 0, mapped: 0 };

    const predictionIntegrity = (await this.pool.query(`SELECT count(*)::integer invalid
      FROM prediction_journal j JOIN matches m ON m.id=j.match_id
      WHERE (m.kickoff_at AT TIME ZONE $1)::date=(now() AT TIME ZONE $1)::date
      AND j.decision='PREDICT'
      AND (j.market_type IS NULL OR j.selection IS NULL OR j.reference_odds IS NULL OR j.prediction_score IS NULL)`, [timeZone])).rows[0] ?? { invalid: 0 };

    const liveFreshness = (await this.pool.query(`SELECT
      count(*)::integer live,
      count(*) FILTER (WHERE s.observed_at IS NULL OR s.observed_at < now()-interval '3 minutes')::integer stale
      FROM matches m LEFT JOIN live_source_snapshots s
        ON s.match_id=m.id AND s.provider='fotmob'
      WHERE m.status='live'`)).rows[0] ?? { live: 0, stale: 0 };

    const pendingSettlement = (await this.pool.query(`SELECT count(*)::integer pending
      FROM prediction_journal j JOIN matches m ON m.id=j.match_id
      LEFT JOIN prediction_settlements s ON s.prediction_journal_id=j.id
      WHERE j.decision='PREDICT' AND m.status='finished' AND s.id IS NULL
      AND m.kickoff_at > now()-interval '2 days'`)).rows[0] ?? { pending: 0 };

    const duplicateEvents = (await this.pool.query(`SELECT count(*)::integer duplicate_groups FROM (
      SELECT match_id,provider,fingerprint,count(*) FROM live_match_events
      GROUP BY match_id,provider,fingerprint HAVING count(*)>1
    ) d`)).rows[0] ?? { duplicate_groups: 0 };

    const staleLive = (await this.pool.query(`SELECT count(*)::integer suspicious
      FROM matches WHERE status='live' AND kickoff_at < now()-interval '5 hours'`)).rows[0] ?? { suspicious: 0 };

    const triggerState = (await this.pool.query(`SELECT count(*)::integer count FROM pg_trigger
      WHERE tgname IN ('prediction_journal_immutable','prediction_settlement_immutable') AND NOT tgisinternal`)).rows[0] ?? { count: 0 };

    let apiStatus = 'NOT_CONFIGURED';
    if (this.config.API_FOOTBALL_ENABLED && this.config.API_FOOTBALL_KEY.trim()) {
      const health = (await this.pool.query(`SELECT status FROM live_provider_health
        WHERE provider='api-football' ORDER BY checked_at DESC LIMIT 1`)).rows[0];
      apiStatus = String(health?.status ?? 'UNAVAILABLE');
    }

    const total = Number(persistence.total ?? 0);
    const mapped = Number(persistence.mapped ?? 0);
    const invalidPredictions = Number(predictionIntegrity.invalid ?? 0);
    const live = Number(liveFreshness.live ?? 0);
    const staleSources = Number(liveFreshness.stale ?? 0);
    const pending = Number(pendingSettlement.pending ?? 0);
    const duplicateGroups = Number(duplicateEvents.duplicate_groups ?? 0);
    const suspiciousLive = Number(staleLive.suspicious ?? 0);
    const triggerCount = Number(triggerState.count ?? 0);

    const checks: ControlAuditCheck[] = [
      {
        key: 'TODAY_MATCH_PERSISTENCE',
        status: total === mapped ? 'PASS' : 'WARN',
        value: { total, mapped, unmapped: Math.max(0, total - mapped) },
        message: total === mapped ? 'Bugünkü maçların provider kimlikleri DB ile eşleşiyor.' : 'Provider kimliği eksik bugünkü maç kaydı var.',
      },
      {
        key: 'OFFICIAL_PREDICTION_INTEGRITY',
        status: invalidPredictions === 0 ? 'PASS' : 'FAIL',
        value: { invalid: invalidPredictions },
        message: invalidPredictions === 0 ? 'Resmi PREDICT kayıtlarının zorunlu alanları tam.' : 'Eksik alanlı resmi tahmin kaydı bulundu.',
      },
      {
        key: 'LIVE_SOURCE_FRESHNESS',
        status: staleSources === 0 ? 'PASS' : 'WARN',
        value: { live, stale: staleSources },
        message: staleSources === 0 ? 'Canlı FotMob snapshotları taze.' : 'Tazeliğini kaybetmiş canlı kaynak snapshotı var.',
      },
      {
        key: 'PENDING_SETTLEMENT',
        status: pending === 0 ? 'PASS' : 'WARN',
        value: { pending },
        message: pending === 0 ? 'Bitmiş resmi tahminlerde bekleyen settlement yok.' : 'Bitmiş bazı resmi tahminler henüz settle edilmemiş.',
      },
      {
        key: 'LIVE_EVENT_DEDUPLICATION',
        status: duplicateGroups === 0 ? 'PASS' : 'FAIL',
        value: { duplicateGroups },
        message: duplicateGroups === 0 ? 'Canlı event fingerprint tekrarları yok.' : 'Duplicate canlı event grubu bulundu.',
      },
      {
        key: 'LIVE_TERMINAL_SANITY',
        status: suspiciousLive === 0 ? 'PASS' : 'WARN',
        value: { suspiciousLive },
        message: suspiciousLive === 0 ? 'Aşırı uzun süredir live kalan maç yok.' : '5 saati aşan live statülü maç kaydı var.',
      },
      {
        key: 'IMMUTABILITY_GUARDS',
        status: triggerCount >= 2 ? 'PASS' : 'FAIL',
        value: { triggerCount },
        message: triggerCount >= 2 ? 'Prediction journal ve settlement immutable triggerları aktif.' : 'Immutable prediction triggerlarından biri eksik.',
      },
      {
        key: 'API_FOOTBALL_HEALTH',
        status: apiStatus === 'SUPPORTED' || apiStatus === 'NOT_CONFIGURED' ? 'PASS' : 'WARN',
        value: { status: apiStatus },
        message: apiStatus === 'SUPPORTED' ? 'API-Football canlı ikinci kaynak aktif.'
          : apiStatus === 'NOT_CONFIGURED' ? 'API-Football opsiyonel ve kapalı.' : 'API-Football ikinci kaynak sağlıklı durumda değil.',
      },
    ];

    const status: ControlAuditStatus = checks.some((item) => item.status === 'FAIL') ? 'FAIL'
      : checks.some((item) => item.status === 'WARN') ? 'WARN' : 'PASS';
    const summary = {
      pass: checks.filter((item) => item.status === 'PASS').length,
      warn: checks.filter((item) => item.status === 'WARN').length,
      fail: checks.filter((item) => item.status === 'FAIL').length,
      executionAuthority: false,
      aiPredictionAuthority: false,
    };

    const saved = await this.pool.query(`INSERT INTO control_audit_runs(version,status,checks,summary)
      VALUES('CONTROL_AUDIT_V1',$1,$2::jsonb,$3::jsonb)
      RETURNING id,version,status,checked_at,checks,summary`,
    [status, JSON.stringify(checks), JSON.stringify(summary)]);
    return saved.rows[0];
  }

  async latest() {
    return (await this.pool.query(`SELECT id,version,status,checked_at,checks,summary
      FROM control_audit_runs ORDER BY checked_at DESC,id DESC LIMIT 1`)).rows[0] ?? null;
  }

  async history(limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    return (await this.pool.query(`SELECT id,version,status,checked_at,checks,summary
      FROM control_audit_runs ORDER BY checked_at DESC,id DESC LIMIT $1`, [safeLimit])).rows;
  }
}
