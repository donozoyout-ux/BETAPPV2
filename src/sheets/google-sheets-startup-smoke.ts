import type { GoogleSheetsSmokeResult } from './nowgoal-live-odds.js';

export type GoogleSheetsSmokeLogCode='CONNECTED'|'NOT_CONFIGURED'|'PERMISSION_ERROR'|'AUTH_ERROR'|'API_ERROR';
const LOG_CODES:Record<GoogleSheetsSmokeResult['status'],GoogleSheetsSmokeLogCode>={
  GOOGLE_SHEETS_CONNECTED:'CONNECTED',
  GOOGLE_SHEETS_NOT_CONFIGURED:'NOT_CONFIGURED',
  GOOGLE_SHEETS_PERMISSION_ERROR:'PERMISSION_ERROR',
  GOOGLE_SHEETS_AUTH_ERROR:'AUTH_ERROR',
  GOOGLE_SHEETS_API_ERROR:'API_ERROR',
};

export async function runGoogleSheetsStartupSmoke(
  enabled:boolean,
  smoke:()=>Promise<GoogleSheetsSmokeResult>,
  log:(line:string)=>void,
):Promise<GoogleSheetsSmokeLogCode|null>{
  if(!enabled)return null;
  let code:GoogleSheetsSmokeLogCode='API_ERROR';
  try {
    const result=await smoke();
    code=LOG_CODES[result.status];
  }catch{
    // Do not include exception text; it may contain credentials or a signed request.
  }
  try { log(`GOOGLE_SHEETS_SMOKE | ${code}`); }
  catch { /* A diagnostics callback must not block worker startup. */ }
  return code;
}
