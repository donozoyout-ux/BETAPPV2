import { loadConfig } from '../config.js';
import { fotmobCompetitions } from '../providers/fotmob.js';
import { runFotMobDryRun } from './fotmob-dry-run.js';
import { runOpenFootballDryRun } from './openfootball-dry-run.js';

const args = new Map(process.argv.slice(2).filter((item) => item.startsWith('--')).map((item) => {
  const [key, ...rest] = item.slice(2).split('='); return [key!, rest.join('=') || 'true'];
}));

const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'postgres://localhost:5432/readonly_dryrun' };
const config = loadConfig(env);

const provider = (args.get('provider') ?? 'fotmob').toLowerCase();
const compArg = args.get('competition');
const seasonArg = args.get('season')?.replace('-', '/');
const fromArg = args.get('from');

if (provider === 'openfootball') {
  const report = await runOpenFootballDryRun(config, {
    competition: compArg,
    season: seasonArg,
    fromDate: fromArg,
  });
  console.log(JSON.stringify(report, null, 2));
} else {
  const key = (compArg ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const competition = fotmobCompetitions.find((item) => [item.key, item.name, String(item.id)].some((value) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, '') === key));
  const sampleSize = Number(args.get('sample') ?? '12');
  if (!competition || !seasonArg || !Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > 50) {
    throw new Error('Use --competition, --season=YYYY-YYYY and --sample=1..50. This command is read-only.');
  }
  console.log(JSON.stringify(await runFotMobDryRun(config, competition, seasonArg, sampleSize), null, 2));
}

