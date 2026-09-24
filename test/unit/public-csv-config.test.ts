import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('public CSV import configuration', () => {
  it('is disabled by default and validates conservative settings', () => {
    const disabled=loadConfig({DATABASE_URL:'postgresql://localhost/test'});
    expect(disabled.PUBLIC_CSV_IMPORT_ENABLED).toBe(false);
    expect(disabled.PUBLIC_CSV_IMPORT_SEASONS).toEqual(['2627','2526','2425']);
    expect(disabled.PUBLIC_CSV_IMPORT_BATCH_SIZE).toBe(100);
    expect(disabled.PUBLIC_CSV_IMPORT_INTERVAL_MS).toBe(600000);
    expect(disabled.PUBLIC_CSV_CURRENT_REFRESH_MS).toBe(43200000);
    expect(() => loadConfig({DATABASE_URL:'postgresql://localhost/test',PUBLIC_CSV_IMPORT_SEASONS:'bad'})).toThrow();
    expect(() => loadConfig({DATABASE_URL:'postgresql://localhost/test',PUBLIC_CSV_IMPORT_BATCH_SIZE:'501'})).toThrow();
    expect(() => loadConfig({DATABASE_URL:'postgresql://localhost/test',PUBLIC_CSV_IMPORT_INTERVAL_MS:'299999'})).toThrow();
    expect(() => loadConfig({DATABASE_URL:'postgresql://localhost/test',PUBLIC_CSV_CURRENT_REFRESH_MS:'21599999'})).toThrow();
  });

  it('enables the seed only on the Render worker', () => {
    const yaml=readFileSync('render.yaml','utf8');
    const worker=yaml.split('name: betapp-v2-collector')[1] ?? '';
    const web=yaml.split('name: betapp-v2-web')[1]?.split('name: betapp-v2-collector')[0] ?? '';
    expect(worker).toContain('key: PUBLIC_CSV_IMPORT_ENABLED\n        value: "true"');
    expect(worker).toContain('key: PUBLIC_CSV_IMPORT_SEASONS\n        value: 2627,2526,2425');
    expect(worker).toContain('key: PUBLIC_CSV_IMPORT_BATCH_SIZE\n        value: "100"');
    expect(worker).toContain('key: PUBLIC_CSV_IMPORT_INTERVAL_MS\n        value: "600000"');
    expect(worker).toContain('key: PUBLIC_CSV_CURRENT_REFRESH_MS\n        value: "43200000"');
    expect(web).not.toContain('PUBLIC_CSV_IMPORT_ENABLED');
  });
});
