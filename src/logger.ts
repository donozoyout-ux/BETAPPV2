import pino from 'pino';
import type { AppConfig } from './config.js';

export function createLogger(config: Pick<AppConfig, 'LOG_LEVEL' | 'NODE_ENV'>, service = 'betapp-v2') {
  return pino({
    level: config.LOG_LEVEL,
    base: { service, environment: config.NODE_ENV },
    redact: { paths: ['req.headers.authorization','req.headers.cookie','headers.authorization','databaseUrl','DATABASE_URL',
      '*.password','*.token','*.apiKey','*.authorization'], censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
