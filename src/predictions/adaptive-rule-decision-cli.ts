import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { PredictionRepository } from './service.js';

const [proposalId, rawDecision, ...noteParts] = process.argv.slice(2);
const decision = rawDecision?.toUpperCase();
if (!proposalId || !['APPROVED','REJECTED'].includes(decision ?? '')) {
  throw new Error('Usage: npm run predictions:proposal:decide -- <proposal-uuid> <APPROVED|REJECTED> [note]');
}

const appConfig = loadConfig();
const pool = createPool(appConfig);

try {
  const repository = new PredictionRepository(pool);
  const result = await repository.decideAdaptiveRuleProposal(
    proposalId,
    decision as 'APPROVED' | 'REJECTED',
    noteParts.length ? noteParts.join(' ') : null,
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
