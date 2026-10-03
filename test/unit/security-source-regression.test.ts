import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFile(path, 'utf8');

describe('security source regression', () => {
  it('migrator no longer truncates data or terminates application backends', async () => {
    const migrator = await source('src/db/migrator.ts');
    expect(migrator).not.toMatch(/TRUNCATE\s+TABLE/i);
    expect(migrator).not.toMatch(/pg_terminate_backend/i);
    expect(migrator).toContain('pg_advisory_lock');
  });

  it('nowgoal provider never executes remote JavaScript', async () => {
    const nowgoal = await source('src/providers/nowgoal.ts');
    expect(nowgoal).not.toMatch(/new Function/);
    expect(nowgoal).not.toMatch(/\beval\s*\(/);
    expect(nowgoal).not.toMatch(/vm\.(runInNewContext|runInThisContext|Script)/);
    expect(nowgoal).toContain('parseNowgoalFixtureDiary');
  });
});
