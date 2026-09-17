import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { QualificationRepository } from '../db/qualification-repository.js';
import { createLogger } from '../logger.js';
import { FotMobProvider } from '../providers/fotmob.js';
import { FlashscoreProvider, IddaaProvider } from '../providers/public-page-provider.js';
import { SofascoreProvider } from '../providers/sofascore.js';
import type { ProviderQualification } from './types.js';
import { NowgoalProvider } from '../providers/nowgoal.js';

function printReport(report: ProviderQualification) {
  console.log(`\n${report.provider.toUpperCase()}\nConnection: ${report.connection}`);
  for (const item of report.checks) {
    console.log(`${item.capability}: ${item.result} | HTTP ${item.httpStatus ?? '-'} | ${item.latencyMs}ms | samples=${item.sampleCount}${item.error ? ` | ${item.error}` : ''}`);
  }
}

const config = loadConfig();
const logger = createLogger({ ...config, LOG_LEVEL: 'silent' }, 'betapp-qualification');
const pool = createPool(config);
const repository = new QualificationRepository(pool);
const providers = [
  new SofascoreProvider(config, logger),
  new FotMobProvider(config, logger),
  new IddaaProvider(config),
  new FlashscoreProvider(config),
  new NowgoalProvider(config, logger),
];

console.log('PROVIDER QUALIFICATION');
try {
  for (const provider of providers) {
    const report = await provider.qualify();
    await repository.save(report);
    printReport(report);
  }
} finally {
  await pool.end();
}
