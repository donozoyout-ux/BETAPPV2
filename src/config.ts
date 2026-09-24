import { z } from 'zod';

const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true');
const legacyDefaultCompetitionKeys = ['PremierLeague','LaLiga','Bundesliga','SerieA','Ligue1','SuperLig',
  'ChampionsLeague','EuropaLeague','ConferenceLeague'] as const;
const internationalCompetitionKeys = ['WorldCup','EURO','EUROQualification',
  'UefaNationsLeagueA','UefaNationsLeagueB','UefaNationsLeagueC','UefaNationsLeagueD',
  'WorldCupQualificationUEFA','CopaAmerica','WorldCupQualificationCONMEBOL','InternationalFriendlies'] as const;
const expansionCompetitionKeys = ['Eredivisie','BelgianProLeague','DanishSuperliga','Allsvenskan','GreekSuperLeague'] as const;
const supportedCompetitionKeys = [...legacyDefaultCompetitionKeys,'BrasileiraoSerieA',...internationalCompetitionKeys,...expansionCompetitionKeys] as const;
const acceptedCompetitionInputKeys = [...supportedCompetitionKeys,'MLS'] as const;
const defaultCompetitionKeys = supportedCompetitionKeys;
const previousDefaultCompetitionKeys = [...legacyDefaultCompetitionKeys,'MLS','BrasileiraoSerieA'] as const;
const competitionList = z.string().default(defaultCompetitionKeys.join(',')).transform((value, context) => {
  const parsed = value.split(',').map((item) => item.trim()).filter(Boolean);
  const invalid = parsed.filter((item) => !acceptedCompetitionInputKeys.includes(item as typeof acceptedCompetitionInputKeys[number]));
  if (invalid.length) context.addIssue({ code: 'custom', message: `Unsupported competitions: ${invalid.join(', ')}` });
  const withoutMls = parsed.filter((item) => item !== 'MLS');
  const legacyDefault = parsed.length === legacyDefaultCompetitionKeys.length
    && legacyDefaultCompetitionKeys.every((item) => parsed.includes(item));
  const previousDefault = parsed.length === previousDefaultCompetitionKeys.length
    && previousDefaultCompetitionKeys.every((item) => parsed.includes(item));
  const migrated = legacyDefault || previousDefault ? [...defaultCompetitionKeys] : [...new Set(withoutMls)];
  if (!migrated.length) context.addIssue({ code: 'custom', message: 'At least one supported competition is required' });
  return migrated;
});

const positiveIntegerList = z.string().default('2,3,4,14,15,22,136').transform((value, context) => {
  const parsed = value.split(',').map((item) => Number(item.trim()));
  const items = [...new Set(parsed.filter(Number.isFinite))];
  if (!items.length || parsed.some((item) => !Number.isInteger(item) || item <= 0)) {
    context.addIssue({ code: 'custom', message: 'Expected a comma-separated list of positive integer IDs' });
  }
  return items;
});

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: booleanFromString.default(false),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DB_CONNECT_TIMEOUT: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  COLLECTOR_ENABLED: booleanFromString.default(true),
  BACKFILL_ENABLED: booleanFromString.default(false),
  COMPETITION_BACKFILL_AUTO_ENABLED: booleanFromString.default(false),
  COMPETITION_BACKFILL_AUTO_SEASONS: z.coerce.number().int().min(1).max(2).default(1),
  COMPETITION_BACKFILL_AUTO_INTERVAL_MS: z.coerce.number().int().min(300_000).default(900_000),
  API_FOOTBALL_ENABLED: booleanFromString.default(false),
  API_FOOTBALL_KEY: z.string().default(''),
  API_FOOTBALL_PREMATCH_ODDS_ENABLED: booleanFromString.default(true),
  API_FOOTBALL_PREMATCH_INTERVAL_MS: z.coerce.number().int().min(3_600_000).default(10_800_000),
  API_FOOTBALL_PREMATCH_FUTURE_DAYS: z.coerce.number().int().min(0).max(3).default(1),
  API_FOOTBALL_PREMATCH_MAX_FIXTURES: z.coerce.number().int().min(1).max(20).default(4),
  FOTMOB_ENABLED: booleanFromString.default(true),
  NOWGOAL_ENABLED: booleanFromString.default(true),
  NOWGOAL_FUTURE_DAYS: z.coerce.number().int().min(0).max(14).default(3),
  NOWGOAL_COMPANY_IDS: positiveIntegerList,
  SUPPORTED_COMPETITIONS: competitionList,
  COLLECTOR_INTERVAL_MS: z.coerce.number().int().min(60_000).default(900_000),
  COLLECTOR_HISTORY_DAYS: z.coerce.number().int().min(0).max(30).default(2),
  COLLECTOR_FUTURE_DAYS: z.coerce.number().int().min(0).max(90).default(14),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  PROVIDER_REQUESTS_PER_SECOND: z.coerce.number().positive().max(10).default(2),
  PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(4),
  // Historical imports are intentionally slower than the live collector. This is an
  // additional per-match pause; the provider HTTP rate limit still applies as well.
  HISTORICAL_REQUEST_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(750),
  SOFASCORE_BASE_URL: z.string().url().default('https://api.sofascore.com/api/v1'),
  FOTMOB_BASE_URL: z.string().url().default('https://www.fotmob.com/api/data'),
  IDDAA_BASE_URL: z.string().url().default('https://www.iddaa.com'),
  FLASHSCORE_BASE_URL: z.string().url().default('https://www.flashscore.com'),
  NOWGOAL_BASE_URL: z.string().url().default('https://nowgoal816.com/wp-json/sport-theme-plugin/v1/proxy'),
  PROVIDER_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(20).default(3),
  PROVIDER_CIRCUIT_COOLDOWN_MS: z.coerce.number().int().min(10_000).default(300_000),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`).join('; ');
    throw new Error(`Invalid BETAPP environment: ${details}`);
  }
  return result.data;
}
