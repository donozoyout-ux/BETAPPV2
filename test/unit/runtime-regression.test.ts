import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string) { return readFile(path, 'utf8'); }

describe('current-main runtime regression', () => {
  it('preserves fixture-first football, corner and Nowgoal ODDS_V1 worker composition', async () => {
    const worker = await source('src/worker.ts');
    for (const required of ['SofascoreProvider','FotMobProvider','CornerRepository','NowgoalProvider',
      'OddsCollector','OddsRepository','appendManyAndAnalyze']) expect(worker + await source('src/collector/odds-collector.ts')).toContain(required);
    expect(worker.indexOf('footballCollectors.map')).toBeLessThan(worker.indexOf('oddsCollector?.runCycle'));
    expect(worker).toContain('buildAllTeamProfiles');
    expect(worker).toContain('buildAllLeagueBaselines');
  });

  it('preserves combined web/worker restart, migrations, Render and keep-awake behavior', async () => {
    const [runtime, dockerfile, render, keepAwake] = await Promise.all([
      source('src/runtime.ts'), source('Dockerfile'), source('render.yaml'), source('.github/workflows/keep-render-awake.yml'),
    ]);
    expect(runtime).toContain("start('dist/worker.js'");
    expect(runtime).toContain("start('dist/server.js'");
    expect(runtime).toContain('Worker stopped; restarting in 30 seconds');
    expect(dockerfile).toContain('node dist/db/migrate.js && exec node dist/runtime.js');
    expect(render).toContain('NOWGOAL_ENABLED');
    expect(render).toContain('preDeployCommand: node dist/db/migrate.js');
    expect(keepAwake).toContain('*/10 * * * *');
  });
});
