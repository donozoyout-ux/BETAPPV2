import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { autoBackfillTargets, priorityAutoBackfillKeys } from '../../src/historical/competition-auto-backfill.js';

describe('automatic competition backfill', () => {
  it('targets only the priority domestic and national competitions', () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/test' });
    const keys = autoBackfillTargets(config).map((item) => item.key);
    expect(keys).toEqual(expect.arrayContaining([...priorityAutoBackfillKeys]));
    expect(keys).not.toContain('PremierLeague');
    expect(keys).not.toContain('CopaAmerica');
  });

  it('is opt-in by config and capped to one or two seasons', () => {
    const disabled = loadConfig({ DATABASE_URL: 'postgresql://localhost/test' });
    expect(disabled.COMPETITION_BACKFILL_AUTO_ENABLED).toBe(false);
    expect(disabled.COMPETITION_BACKFILL_AUTO_SEASONS).toBe(1);
    const enabled = loadConfig({ DATABASE_URL: 'postgresql://localhost/test',
      BACKFILL_ENABLED: 'true', COMPETITION_BACKFILL_AUTO_ENABLED: 'true',
      COMPETITION_BACKFILL_AUTO_SEASONS: '2' });
    expect(enabled.BACKFILL_ENABLED).toBe(true);
    expect(enabled.COMPETITION_BACKFILL_AUTO_ENABLED).toBe(true);
    expect(enabled.COMPETITION_BACKFILL_AUTO_SEASONS).toBe(2);
    expect(() => loadConfig({ DATABASE_URL: 'postgresql://localhost/test',
      COMPETITION_BACKFILL_AUTO_SEASONS: '3' })).toThrow();
  });

  it('enables the safe one-season auto queue only on the Render worker', () => {
    const yaml = readFileSync('render.yaml', 'utf8');
    const worker = yaml.split('name: betapp-v2-collector')[1] ?? '';
    const web = yaml.split('name: betapp-v2-web')[1]?.split('name: betapp-v2-collector')[0] ?? '';
    expect(worker).toContain('key: BACKFILL_ENABLED\n        value: "true"');
    expect(worker).toContain('key: COMPETITION_BACKFILL_AUTO_ENABLED\n        value: "true"');
    expect(worker).toContain('key: COMPETITION_BACKFILL_AUTO_SEASONS\n        value: "1"');
    expect(web).toContain('key: BACKFILL_ENABLED\n        value: "false"');
    expect(web).not.toContain('COMPETITION_BACKFILL_AUTO_ENABLED');
  });
});
