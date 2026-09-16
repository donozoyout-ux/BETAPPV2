import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabasePool } from './pool.js';

function migrationsDirectory() {
  return join(dirname(fileURLToPath(import.meta.url)), 'migrations');
}

export async function migrationStatus(pool: DatabasePool) {
  const files = (await readdir(migrationsDirectory())).filter((file) => file.endsWith('.sql')).sort();
  const table = await pool.query<{ exists: boolean }>("SELECT to_regclass('schema_migrations') IS NOT NULL AS exists");
  const applied = table.rows[0]?.exists
    ? (await pool.query<{ version: string; applied_at: Date }>('SELECT version,applied_at FROM schema_migrations ORDER BY version')).rows
    : [];
  const versions = new Set(applied.map((item) => item.version));
  const pending = files.filter((file) => !versions.has(file));
  return {
    connection: 'ok' as const,
    currentMigrations: applied,
    pendingMigrations: pending,
    schemaVersion: applied.at(-1)?.version ?? null,
    expectedSchemaVersion: files.at(-1) ?? null,
  };
}

export async function runMigrations(pool: DatabasePool): Promise<void> {
  const directory = migrationsDirectory();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['betapp-v2:migrations']);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if (existing.rowCount) continue;
      const sql = await readFile(join(directory, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['betapp-v2:migrations']).catch(() => undefined);
    client.release();
  }
}
