import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { PredictionRepository, PredictionService } from './service.js';

const pool = createPool(loadConfig());
try { console.log(JSON.stringify(await new PredictionService(new PredictionRepository(pool)).refreshPreviewsAndLocks(), null, 2)); }
finally { await pool.end(); }
