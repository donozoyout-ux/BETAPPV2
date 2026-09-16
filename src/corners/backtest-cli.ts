import { loadConfig } from '../config.js';
import { CornerRepository } from '../db/corner-repository.js';
import { createPool } from '../db/pool.js';
import { configHash, cornerModelConfig } from './config.js';
import { runBacktest } from './backtest.js';

const config = loadConfig();
const pool = createPool(config);
const repository = new CornerRepository(pool);
const hash = configHash(cornerModelConfig);
const argumentsMap = new Map(process.argv.slice(2).filter((item) => item.startsWith('--')).map((item) => {
  const [key, ...value] = item.slice(2).split('='); return [key!, value.join('=') || 'true'];
}));
try {
  let history = await repository.loadHistory();
  const competition = argumentsMap.get('competition');
  const season = argumentsMap.get('season')?.replace('-', '/');
  let validationStage: string | null = null;
  if (argumentsMap.get('stage') === '1') {
    validationStage = 'CORNER_V1 VALIDATION STAGE 1';
    history = history.filter((match) => match.competitionName === 'Premier League');
    const seasons = [...new Set(history.map((match) => match.season))].sort().reverse();
    const previousFullSeason = seasons.length > 1 ? seasons[1]! : seasons[0];
    history = previousFullSeason ? history.filter((match) => match.season === previousFullSeason) : [];
  } else {
    if (competition) history = history.filter((match) => match.competitionName === competition || match.competitionId === competition);
    if (season) history = history.filter((match) => match.season.replace('-', '/') === season);
  }
  const report = { validationStage, scope: { competition: competition ?? null, season: season ?? null },
    ...runBacktest(history, cornerModelConfig) };
  await repository.saveBacktest(report, cornerModelConfig, hash);
  console.log(JSON.stringify({ modelVersion: cornerModelConfig.modelVersion, configHash: hash, ...report }, null, 2));
} finally { await pool.end(); }
