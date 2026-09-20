import { loadConfig } from '../config.js';
import { fotmobCompetitions } from '../providers/fotmob.js';
import { runFotMobDryRun } from './fotmob-dry-run.js';

const args = new Map(process.argv.slice(2).filter((item) => item.startsWith('--')).map((item) => {
  const [key, ...rest] = item.slice(2).split('='); return [key!, rest.join('=') || 'true'];
}));
const key = (args.get('competition') ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const competition = fotmobCompetitions.find((item) => [item.key, item.name, String(item.id)].some((value) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '') === key));
const season = args.get('season')?.replace('-', '/');
const sampleSize = Number(args.get('sample') ?? '12');
if (!competition || !season || !Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > 50) {
  throw new Error('Use --competition, --season=YYYY-YYYY and --sample=1..50. This command is read-only.');
}
console.log(JSON.stringify(await runFotMobDryRun(loadConfig(), competition, season, sampleSize), null, 2));
