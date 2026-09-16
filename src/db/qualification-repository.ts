import type { ProviderQualification } from '../qualification/types.js';
import type { DatabasePool } from './pool.js';

export class QualificationRepository {
  constructor(private readonly pool: DatabasePool) {}

  async save(report: ProviderQualification) {
    const status = report.connection === 'SUPPORTED' ? 'healthy' : report.connection === 'PARTIAL' ? 'degraded'
      : report.connection === 'BLOCKED' ? 'blocked' : report.connection === 'UNAVAILABLE' ? 'unavailable' : 'unknown';
    await this.pool.query(
      `INSERT INTO provider_status(provider,status,last_checked_at,last_success_at,last_failure_at,consecutive_failures,message,total_attempts,total_successes)
       VALUES($1,$2,now(),CASE WHEN $3 THEN now() END,CASE WHEN NOT $3 THEN now() END,CASE WHEN $3 THEN 0 ELSE 1 END,$4,1,CASE WHEN $3 THEN 1 ELSE 0 END)
       ON CONFLICT(provider) DO UPDATE SET status=$2,last_checked_at=now(),
         last_success_at=CASE WHEN $3 THEN now() ELSE provider_status.last_success_at END,
         last_failure_at=CASE WHEN NOT $3 THEN now() ELSE provider_status.last_failure_at END,
         consecutive_failures=CASE WHEN $3 THEN 0 ELSE provider_status.consecutive_failures+1 END,
         message=$4,total_attempts=provider_status.total_attempts+1,
         total_successes=provider_status.total_successes+CASE WHEN $3 THEN 1 ELSE 0 END,updated_at=now()`,
      [report.provider, status, report.connection === 'SUPPORTED' || report.connection === 'PARTIAL',
        `Qualification: ${report.connection}`],
    );
    for (const check of report.checks) {
      await this.pool.query(
        `INSERT INTO provider_qualification(provider,capability,result,source,checked_at,http_status,latency_ms,sample_count,parse_success,error,notes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT(provider,capability) DO UPDATE SET result=excluded.result,source=excluded.source,checked_at=excluded.checked_at,
           http_status=excluded.http_status,latency_ms=excluded.latency_ms,sample_count=excluded.sample_count,
           parse_success=excluded.parse_success,error=excluded.error,notes=excluded.notes`,
        [report.provider, check.capability, check.result, check.source, check.checkedAt, check.httpStatus,
          check.latencyMs, check.sampleCount, check.parseSuccess, check.error, check.notes],
      );
    }
  }

  async matrix() {
    const result = await this.pool.query('SELECT * FROM provider_qualification ORDER BY provider,capability');
    return result.rows;
  }
}
