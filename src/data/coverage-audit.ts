import type { DataCoverage } from './coverage.js';
import type { ControlAuditCheck } from '../control-audit.js';
export function coverageAuditChecks(data: DataCoverage): ControlAuditCheck[] {
  const rows = data.competitions.map(c => ({ competition: c.competition, matches: c.matches, status: c.matches > 0 ? 'PASS' : 'WARN' }));
  const last = [...data.backfills].filter(r => r.completedAt != null).sort((a,b) => b.completedAt!.localeCompare(a.completedAt!))[0];
  const importStatus = !last ? 'WARN' : last.status === 'FAILED' && last.fixturesPersisted === 0 ? 'FAIL'
    : last.status === 'PARTIAL' || last.failures.length > 0 ? 'WARN' : 'PASS';
  return [ { key: 'COMPETITION_DATA_COVERAGE', status: rows.some(r => r.status === 'WARN') ? 'WARN' : 'PASS', value: rows,
    message: rows.some(r => r.status === 'WARN') ? 'Bazı etkin lig/turnuvalarda henüz kalıcı maç verisi yok.' : 'Etkin lig/turnuvalarda kalıcı maç verisi mevcut.' },
  { key: 'HISTORICAL_IMPORT_HEALTH', status: importStatus, value: last ?? null,
    message: !last ? 'Henüz tamamlanan kontrollü aktarım yok.' : importStatus === 'FAIL' ? 'Aktarım fikstürler kaydedilmeden sonlandı.'
      : importStatus === 'WARN' ? 'Aktarımda eksik istatistik veya kısmi hata mevcut.' : 'Son tamamlanan aktarımda ölümcül hata yok.' } ];
}
