import {describe,expect,it,vi} from 'vitest';
import {runGoogleSheetsStartupSmoke} from '../../src/sheets/google-sheets-startup-smoke.js';
import type {GoogleSheetsSmokeResult} from '../../src/sheets/nowgoal-live-odds.js';
import {loadConfig} from '../../src/config.js';

describe('worker startup Google Sheets smoke',()=>{
  it('defaults the startup smoke flag to false and accepts an explicit true',()=>{
    const base={...process.env,DATABASE_URL:'postgres://localhost/betapp'};
    expect(loadConfig(base).GOOGLE_SHEETS_SMOKE_ON_STARTUP).toBe(false);
    expect(loadConfig({...base,GOOGLE_SHEETS_SMOKE_ON_STARTUP:'true'}).GOOGLE_SHEETS_SMOKE_ON_STARTUP).toBe(true);
  });

  it('does not run or log when the flag is false',async()=>{
    const smoke=vi.fn();const log=vi.fn();
    expect(await runGoogleSheetsStartupSmoke(false,smoke,log)).toBeNull();
    expect(smoke).not.toHaveBeenCalled();expect(log).not.toHaveBeenCalled();
  });

  it('runs exactly once when enabled and logs only the connected code',async()=>{
    const smoke=vi.fn().mockResolvedValue({status:'GOOGLE_SHEETS_CONNECTED'} satisfies GoogleSheetsSmokeResult);
    const log=vi.fn();
    expect(await runGoogleSheetsStartupSmoke(true,smoke,log)).toBe('CONNECTED');
    expect(smoke).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledExactlyOnceWith('GOOGLE_SHEETS_SMOKE | CONNECTED');
  });

  it.each([
    ['GOOGLE_SHEETS_CONNECTED','CONNECTED'],
    ['GOOGLE_SHEETS_NOT_CONFIGURED','NOT_CONFIGURED'],
    ['GOOGLE_SHEETS_PERMISSION_ERROR','PERMISSION_ERROR'],
    ['GOOGLE_SHEETS_AUTH_ERROR','AUTH_ERROR'],
    ['GOOGLE_SHEETS_API_ERROR','API_ERROR'],
  ] as const)('logs the safe %s state as %s',async(status,code)=>{
    const log=vi.fn();
    expect(await runGoogleSheetsStartupSmoke(true,async()=>({status}),log)).toBe(code);
    expect(log).toHaveBeenCalledExactlyOnceWith(`GOOGLE_SHEETS_SMOKE | ${code}`);
  });

  it('keeps startup going after a smoke failure and never logs exception secrets',async()=>{
    const secret='PRIVATE-KEY-JWT-ACCESS-TOKEN-SECRET';const log=vi.fn();
    const result=await runGoogleSheetsStartupSmoke(true,async()=>{throw new Error(secret);},log);
    expect(result).toBe('API_ERROR');
    expect(log).toHaveBeenCalledExactlyOnceWith('GOOGLE_SHEETS_SMOKE | API_ERROR');
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    const startupSequence=['smoke-start'];
    await runGoogleSheetsStartupSmoke(true,async()=>{throw new Error(secret);},log);
    startupSequence.push('worker-started');
    expect(startupSequence).toEqual(['smoke-start','worker-started']);
  });

  it('keeps worker startup moving if logging itself fails',async()=>{
    const log=vi.fn(()=>{throw new Error('logger failed');});
    await expect(runGoogleSheetsStartupSmoke(true,async()=>({status:'GOOGLE_SHEETS_PERMISSION_ERROR'}),log))
      .resolves.toBe('PERMISSION_ERROR');
  });
});
