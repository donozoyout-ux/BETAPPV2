import { writeFile } from 'node:fs/promises';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { createPool, type DatabasePool } from '../db/pool.js';
import { FootballRepository } from '../db/repository.js';
import { HistoricalRepository } from '../db/historical-repository.js';
import { CornerRepository } from '../db/corner-repository.js';
import { PredictionRepository } from '../predictions/service.js';
import { buildAllTeamProfiles, buildAllLeagueBaselines } from '../corners/profiles.js';
import { auditDataset } from '../data/audit.js';
import { FotMobProvider, fotmobCompetitions } from '../providers/fotmob.js';
import { expansionKeys, parseExpansionArgs } from './competition-scope.js';
import { runCompetitionBackfill } from './competition-backfill.js';
const options = parseExpansionArgs(process.argv.slice(2));
// Dry-run has no database connection and must not require production credentials.
const config = loadConfig(options.dryRun ? { ...process.env, DATABASE_URL: 'postgresql://localhost/unused_dry_run' } : process.env);
if (!config.FOTMOB_ENABLED) throw new Error('FOTMOB_ENABLED=true is required');
if (!options.dryRun && !config.BACKFILL_ENABLED) throw new Error('BACKFILL_ENABLED=true is required for database writes');
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const selected = fotmobCompetitions.filter(c => config.SUPPORTED_COMPETITIONS.includes(c.key)
  && (options.competition ? [c.key,c.name,String(c.id)].some(s => normalize(s) === normalize(options.competition!)) : expansionKeys.includes(c.key)));
if (!selected.length) throw new Error('No configured competition matches --competition');
const pool = options.dryRun ? null : createPool({ ...config, DB_POOL_MAX: Math.min(config.DB_POOL_MAX, 2) });
const logger = createLogger(config, 'competition-expansion');
const provider = new FotMobProvider(config, logger);
const lock = pool ? await pool.connect() : null;
// All DB work borrows the same connection. Repository transactions cannot release the CLI lease.
const borrowed = lock ? Object.assign(Object.create(lock), { query: lock.query.bind(lock), release: () => undefined }) : null;
const database = lock ? { query: lock.query.bind(lock), connect: async () => borrowed } as unknown as DatabasePool : null;
const football = database ? new FootballRepository(database) : null;
const historical = database ? new HistoricalRepository(database) : null;
const corners = database ? new CornerRepository(database) : null;
const reports = [];
const pause = () => new Promise<void>(resolve => setTimeout(resolve, config.HISTORICAL_REQUEST_DELAY_MS));
try {
  if (lock && !(await lock.query("SELECT pg_try_advisory_lock(hashtext('competition-expansion-v1')) locked")).rows[0]?.locked) {
    throw new Error('Another competition expansion import is running');
  }
  for (const competition of selected) {
    const report = await runCompetitionBackfill(competition, options, {
      provider, football: football!, historical: historical!, corners: corners!, pause,
      refreshPipeline: async () => {
        const history = await corners!.loadHistory();
        await corners!.saveProfiles(buildAllTeamProfiles(history));
        await corners!.saveBaselines(buildAllLeagueBaselines(history));
        await corners!.saveDatasetAudit(auditDataset(history, await corners!.auditIntegrity()));
        // Existing cutoff/eligibility rules are retained. Match data alone never creates odds evidence.
        await new PredictionRepository(database!, config.SUPPORTED_COMPETITIONS).refreshHistoricalIncremental();
      },
    });
    reports.push(report); console.log(JSON.stringify(report));
    if (options.output) await writeFile(options.output, JSON.stringify({ reports }, null, 2), 'utf8');
  }
  if (reports.some(r => r.status === 'FAILED')) process.exitCode = 1;
} finally {
  if (lock) { await lock.query("SELECT pg_advisory_unlock(hashtext('competition-expansion-v1'))").catch(() => undefined); lock.release(); }
  await pool?.end();
}
