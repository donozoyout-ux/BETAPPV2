import type { DataCoverage } from './coverage.js';
import type { ControlAuditCheck } from '../control-audit.js';
export function coverageAuditChecks(data: DataCoverage): ControlAuditCheck[] {
  const rows = data.competitions.map(c => ({ competition: c.competition, matches: c.matches, status: c.matches > 0 ? 'PASS' : 'WARN' }));
  const last = [...data.backfills].filter(r => r.completedAt != null).sort((a,b) => b.completedAt!.localeCompare(a.completedAt!))[0];
  const importStatus = !last ? 'WARN' : last.status === 'FAILED' && last.fixturesPersisted === 0 ? 'FAIL'
    : last.status === 'PARTIAL' || last.failures.length > 0 ? 'WARN' : 'PASS';
  const targetRows = data.competitions.map(c => ({
    competition: c.competition,
    finished: c.finishedMatches,
    stats: c.matchesWithStats,
    targetFinished: c.target.targetFinishedMatches,
    targetStats: c.target.targetMatchesWithStats,
    deficitScore: c.target.deficitScore,
    needsBackfill: c.target.needsBackfill,
  }));
  const targetGap = targetRows.some((row) => row.needsBackfill);
  return [ { key: 'COMPETITION_DATA_COVERAGE', status: rows.some(r => r.status === 'WARN') ? 'WARN' : 'PASS', value: rows,
    message: rows.some(r => r.status === 'WARN') ? 'Bazı etkin lig/turnuvalarda henüz kalıcı maç verisi yok.' : 'Etkin lig/turnuvalarda kalıcı maç verisi mevcut.' },
  { key: 'HISTORICAL_IMPORT_HEALTH', status: importStatus, value: last ?? null,
    message: !last ? 'Henüz tamamlanan kontrollü aktarım yok.' : importStatus === 'FAIL' ? 'Aktarım fikstürler kaydedilmeden sonlandı.'
      : importStatus === 'WARN' ? 'Aktarımda eksik istatistik veya kısmi hata mevcut.' : 'Son tamamlanan aktarımda ölümcül hata yok.' },
  { key: 'DATA_TARGET_PROGRESS', status: targetGap ? 'WARN' : 'PASS', value: targetRows,
    message: targetGap ? 'Bazı lig/turnuvalar DATA_TARGET_V1 hedefinin altında; otomatik kuyruk eksikleri önceliklendiriyor.'
      : 'Tüm etkin lig/turnuvalar DATA_TARGET_V1 maç ve istatistik hedefini karşıladı.' },
  { key: 'PREMATCH_ODDS_COVERAGE',
    status: data.summary.upcomingMatches7d === 0 || data.summary.upcomingOddsCovered7d === data.summary.upcomingMatches7d ? 'PASS' : 'WARN',
    value: { upcoming7d: data.summary.upcomingMatches7d, withOdds: data.summary.upcomingOddsCovered7d,
      withThreeBookmakers: data.summary.upcomingThreeBookmakerCovered7d, totalSnapshots: data.summary.totalOddsSnapshots },
    message: data.summary.upcomingMatches7d === 0 ? 'Önümüzdeki 7 günde takip edilen planlı maç yok.'
      : data.summary.upcomingOddsCovered7d === data.summary.upcomingMatches7d
        ? 'Önümüzdeki 7 günlük maçların tamamında gerçek pre-match odds snapshotı mevcut.'
        : 'Önümüzdeki 7 günlük bazı maçlarda henüz gerçek pre-match odds snapshotı eksik.' } ];
}
