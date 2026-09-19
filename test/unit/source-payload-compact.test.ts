import { describe, expect, it } from 'vitest';
import { compactPayloadForStorage } from '../../src/db/repository.js';

describe('source payload compaction', () => {
  it('preserves ordinary payloads below the conservative inline limit', () => {
    const payload = { value: 'x'.repeat(39_000) };
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(40_000);
    expect(compactPayloadForStorage(payload)).toBe(payload);
  });

  it('compacts quote-heavy payloads before PostgreSQL jsonb text can exceed the constraint', () => {
    const payload = { value: '"'.repeat(30_000), rows: Array.from({ length: 2_000 }, (_, i) => ({ i, value: '"x"' })) };
    const compacted = compactPayloadForStorage(payload) as Record<string, unknown>;
    expect(compacted.truncated).toBe(true);
    expect(compacted.originalBytes).toBeGreaterThan(40_000);
    expect(String(compacted.payloadSha256)).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.byteLength(JSON.stringify(compacted))).toBeLessThan(20_000);
  });

  it('compacts large unicode payloads with byte length rather than character count', () => {
    const payload = { value: '😀'.repeat(12_000) };
    const compacted = compactPayloadForStorage(payload) as Record<string, unknown>;
    expect(compacted.truncated).toBe(true);
    expect(Number(compacted.originalBytes)).toBeGreaterThan(40_000);
    expect(Buffer.byteLength(JSON.stringify(compacted))).toBeLessThan(40_000);
  });

  it('compacts a large FotMob-like nested statistics payload', () => {
    const payload = {
      h2h: {
        matches: Array.from({ length: 500 }, (_, i) => ({
          id: i,
          home: { id: `h-${i}`, name: `Bayern München ${i}` },
          away: { id: `a-${i}`, name: `Borussia Mönchengladbach ${i}` },
          stats: { possession: [61, 39], shots: [18, 9], corners: [8, 4] },
        })),
      },
    };
    const compacted = compactPayloadForStorage(payload) as Record<string, unknown>;
    expect(compacted.truncated).toBe(true);
    expect(compacted.preview).toBeTypeOf('string');
    expect(String(compacted.preview).length).toBeLessThanOrEqual(8_000);
    expect(Buffer.byteLength(JSON.stringify(compacted))).toBeLessThan(40_000);
  });

  it('keeps the compact representation comfortably below the 65536-byte database constraint', () => {
    const payload = { rows: Array.from({ length: 20_000 }, (_, i) => ({ i, a: 'x', b: 'y', c: 'z' })) };
    const compacted = compactPayloadForStorage(payload);
    expect(Buffer.byteLength(JSON.stringify(compacted))).toBeLessThan(16_384);
  });
});
