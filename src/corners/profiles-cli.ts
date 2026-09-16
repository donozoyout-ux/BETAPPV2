import { loadConfig } from '../config.js';
import { CornerRepository } from '../db/corner-repository.js';
import { createPool } from '../db/pool.js';
import { createLogger } from '../logger.js';
import { buildAllLeagueBaselines, buildAllTeamProfiles } from './profiles.js';

const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config);
const repository = new CornerRepository(pool);
try {
  const history = await repository.loadHistory();
  const profiles = buildAllTeamProfiles(history);
  const baselines = buildAllLeagueBaselines(history);
  await repository.saveProfiles(profiles);
  await repository.saveBaselines(baselines);
  logger.info({ matches: history.length, profiles: profiles.length, baselines: baselines.length }, 'Corner profiles calculated');
} finally { await pool.end(); }
