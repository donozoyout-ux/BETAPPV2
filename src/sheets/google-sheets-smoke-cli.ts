import { loadConfig } from '../config.js';
import { GoogleLiveOddsSheetSync } from './nowgoal-live-odds.js';

const config=loadConfig();
const credentialsConfigured=Boolean(config.GOOGLE_SHEETS_SPREADSHEET_ID
  &&config.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL&&config.GOOGLE_SHEETS_PRIVATE_KEY);
if(!credentialsConfigured){
  console.log('GOOGLE_SHEETS_NOT_CONFIGURED');
  process.exitCode=1;
}else{
  // This checks Google access and initializes only the tab/header; it never reads or appends DB rows.
  const result=await new GoogleLiveOddsSheetSync(config).smoke();
  console.log(result.status);
  if(result.error)console.error(result.error);
  if(result.status!=='GOOGLE_SHEETS_CONNECTED')process.exitCode=1;
}
