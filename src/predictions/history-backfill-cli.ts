import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { PredictionRepository } from './service.js';

const pool = createPool(loadConfig());
try { console.log(JSON.stringify(await new PredictionRepository(pool).backfillHistorical(), null, 2)); }
finally { await pool.end(); }
