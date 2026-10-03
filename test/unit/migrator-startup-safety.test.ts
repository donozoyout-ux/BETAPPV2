import { describe, expect, it, vi } from 'vitest';
import type { DatabasePool } from '../../src/db/pool.js';

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(async () => []),
  readFile: vi.fn(async () => ''),
}));

import { runMigrations } from '../../src/db/migrator.js';

describe('runMigrations startup safety', () => {
  it('never truncates observability/provenance tables or terminates backends on startup', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    };
    const pool = { connect: async () => client } as unknown as DatabasePool;

    await runMigrations(pool);

    const log = statements.join('\n');
    expect(log).not.toMatch(/TRUNCATE\s+TABLE/i);
    expect(log).not.toMatch(/pg_terminate_backend/i);
    expect(log).toMatch(/pg_advisory_lock/i);
  });
});
