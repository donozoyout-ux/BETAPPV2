import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';

function appFor(env: Record<string, string>, repository: Record<string, unknown>) {
  const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', LOG_LEVEL: 'silent', ...env });
  return buildApp(config, repository as never, createLogger(config));
}

describe('privileged database endpoints', () => {
  it('blocks destructive cleanup and diagnostics anonymously in production', async () => {
    const dbCleanup = vi.fn(async () => ({ success: true }));
    const dbDiagnostics = vi.fn(async () => ({ tables: [] }));
    const app = appFor({ NODE_ENV: 'production' }, { dbCleanup, dbDiagnostics });
    try {
      const cleanup = await app.inject({ method: 'POST', url: '/api/db-cleanup' });
      expect(cleanup.statusCode).toBe(404);
      const diagnostics = await app.inject('/api/db-diagnostics');
      expect(diagnostics.statusCode).toBe(404);
      expect(dbCleanup).not.toHaveBeenCalled();
      expect(dbDiagnostics).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('does not register a destructive GET cleanup route', async () => {
    const dbCleanup = vi.fn(async () => ({ success: true }));
    const app = appFor({}, { dbCleanup });
    try {
      const response = await app.inject('/api/db-cleanup');
      expect(response.statusCode).toBe(404);
      expect(dbCleanup).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('allows diagnostics in production only with a matching admin token', async () => {
    const dbDiagnostics = vi.fn(async () => ({ tables: [] }));
    const app = appFor({ NODE_ENV: 'production', ADMIN_API_TOKEN: 'integration-admin-token' }, { dbDiagnostics });
    try {
      const denied = await app.inject('/api/db-diagnostics');
      expect(denied.statusCode).toBe(404);
      const allowed = await app.inject({
        method: 'GET',
        url: '/api/db-diagnostics',
        headers: { 'x-admin-token': 'integration-admin-token' },
      });
      expect(allowed.statusCode).toBe(200);
      expect(dbDiagnostics).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
