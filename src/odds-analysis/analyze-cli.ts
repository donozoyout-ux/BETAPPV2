import { loadConfig } from '../config.js';
import { OddsAnalysisRepository } from '../db/odds-analysis-repository.js';
import { createPool } from '../db/pool.js';
import { createLogger } from '../logger.js';

function argument(name: string): string | undefined {
  return process.argv.slice(2).find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const appConfig = loadConfig();
const logger = createLogger(appConfig, 'odds-analysis-cli');
const pool = createPool(appConfig);
const repository = new OddsAnalysisRepository(pool);
const date = argument('date') ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());

try {
  const matches = await repository.matchesForDate(date);
  const rows: Array<Record<string, string | number | boolean>> = [];
  for (const match of matches) {
    try {
      const saved = await repository.analyzeAndSave(String(match.id));
      if (!saved) continue;
      for (const item of saved.analysis.items) rows.push({
        match: `${String(match.home_team)} - ${String(match.away_team)}`,
        kickoff: new Date(String(match.kickoff_at)).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }),
        market: item.marketType, line: item.line ?? '-', selection: item.selection,
        opening: item.openingOdds, current: item.currentOdds, deltaPp: item.probabilityDeltaPp,
        agreement: `${item.agreeingBookmakerCount}/${item.bookmakerCount}`, score: item.score,
        dataQuality: `${item.dataQuality.score} ${item.dataQuality.grade}`,
        confidence: `${item.modelConfidence.score} ${item.modelConfidence.grade}`, eligible: item.analysisEligible,
      });
    } catch (error) {
      logger.warn({ err: error, matchId: match.id }, 'Odds analysis failed; continuing');
    }
  }
  process.stdout.write(`ODDS ANALYSIS V1 · ${date}\n`);
  if (rows.length) console.table(rows);
  else process.stdout.write('No complete odds markets found.\n');
} finally {
  await pool.end();
}
