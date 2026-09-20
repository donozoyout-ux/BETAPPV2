import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { OddsIntelligenceRepository } from './repository.js';

const pool = createPool(loadConfig());
try { console.log(JSON.stringify(await new OddsIntelligenceRepository(pool).backtest(), null, 2)); }
finally { await pool.end(); }
