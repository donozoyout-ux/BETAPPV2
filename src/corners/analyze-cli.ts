import { loadConfig } from '../config.js';
import { CornerRepository } from '../db/corner-repository.js';
import { createPool } from '../db/pool.js';
import { createLogger } from '../logger.js';
import { configHash, cornerModelConfig } from './config.js';
import { analyzeCorners } from './engine.js';
import { buildLeagueBaseline } from './profiles.js';

function argument(name: string) {
  const item = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  return item?.split('=').slice(1).join('=') || process.env[`npm_config_${name}`];
}

const date = argument('date') ?? new Date().toISOString().slice(0, 10);
const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config);
const repository = new CornerRepository(pool);
const hash = configHash(cornerModelConfig);
try {
  const history = await repository.loadHistory();
  const upcoming = await repository.upcoming(date);
  for (const match of upcoming) {
    const baseline = buildLeagueBaseline(history, match.competition_id, match.season ?? 'unknown', new Date(match.kickoff_at));
    const analysis = analyzeCorners({ match: { competitionId: match.competition_id, season: match.season ?? 'unknown',
      kickoffAt: new Date(match.kickoff_at), homeTeamId: match.home_team_id, awayTeamId: match.away_team_id }, history, baseline }, cornerModelConfig);
    await repository.saveAnalysis(match.id, analysis, cornerModelConfig, hash);
    console.log(`\nMATCH: ${match.home_team} - ${match.away_team}`);
    console.log(`EXPECTED HOME CORNERS: ${analysis.expectedHomeCorners.toFixed(2)}`);
    console.log(`EXPECTED AWAY CORNERS: ${analysis.expectedAwayCorners.toFixed(2)}`);
    console.log(`EXPECTED TOTAL: ${analysis.expectedTotalCorners.toFixed(2)}`);
    for (const line of ['7.5','8.5','9.5','10.5','11.5','12.5']) console.log(`O${line}: ${(analysis.probabilities[line]!.over * 100).toFixed(1)}%`);
    console.log(`DATA QUALITY: ${analysis.dataQuality.score}/100 (${analysis.dataQuality.status})`);
    console.log(`MODEL CONFIDENCE: ${analysis.modelConfidence}/100`);
    console.log(`DISTRIBUTION: ${analysis.distribution}`);
    console.log(`SAMPLE: home=${analysis.sample.home} away=${analysis.sample.away} league=${analysis.sample.league}`);
  }
  logger.info({ date, matches: upcoming.length, model: cornerModelConfig.modelVersion, configHash: hash }, 'Corner analysis completed');
} finally { await pool.end(); }
