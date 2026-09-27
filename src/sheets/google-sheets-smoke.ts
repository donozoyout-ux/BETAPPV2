import type { AppConfig } from '../config.js';
import { GoogleLiveOddsSheetSync, type GoogleSheetsSmokeResult } from './nowgoal-live-odds.js';

export async function smokeGoogleSheets(config:AppConfig):Promise<GoogleSheetsSmokeResult>{
  try { return await new GoogleLiveOddsSheetSync(config).smoke(); }
  catch { return {status:'GOOGLE_SHEETS_API_ERROR',error:'Google Sheets smoke check failed.'}; }
}
