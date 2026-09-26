import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { NowgoalLiveOddsRepository } from '../db/nowgoal-live-odds-repository.js';
import { GoogleLiveOddsSheetSync } from './nowgoal-live-odds.js';

const config=loadConfig();
const pool=createPool(config);
try {
  const repository=new NowgoalLiveOddsRepository(pool);
  const sync=new GoogleLiveOddsSheetSync(config,repository);
  const append=process.argv.includes('--append-real-db-rows');
  const result=await sync.inspect(append);
  console.log(JSON.stringify({googleSheets:result.status,configured:result.configured,appendEnabled:append,
    wouldAppend:result.wouldAppend??0,appended:result.appended,error:result.error??null},null,2));
  if(!result.configured||result.status!=='SYNCED'||(result.error&&/ECONNREFUSED|connect/i.test(result.error)))process.exitCode=2;
} finally { await pool.end(); }
