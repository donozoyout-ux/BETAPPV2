import { loadConfig } from '../config.js';
import { HistoricalRepository } from '../db/historical-repository.js';
import { createPool } from '../db/pool.js';

const pool = createPool(loadConfig());
try { console.log(JSON.stringify(await new HistoricalRepository(pool).coverageAudit(), null, 2)); }
finally { await pool.end(); }
