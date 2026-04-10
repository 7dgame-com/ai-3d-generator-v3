import { computeExpiresAt } from '../utils/urlExpiry';

describe('Feature: task-expiry-pagination, computeExpiresAt', () => {
  it('uses the earlier parsed expiry across output and thumbnail URLs', () => {
    const completedAt = new Date('2026-04-09T10:00:00.000Z');

    const result = computeExpiresAt(
      'https://cdn.example.com/model.glb?Expires=1900003600',
      'https://cdn.example.com/preview.webp?Expires=1900001800',
      completedAt
    );

    expect(result.toISOString()).toBe('2030-03-17T18:16:40.000Z');
  });

  it('falls back to completedAt plus 24 hours when no URL expiry can be parsed', () => {
    const completedAt = new Date('2026-04-09T10:00:00.000Z');

    const result = computeExpiresAt(
      'https://cdn.example.com/model.glb',
      'https://cdn.example.com/preview.webp',
      completedAt
    );

    expect(result.toISOString()).toBe('2026-04-10T10:00:00.000Z');
  });

  it('accepts null URLs and still returns the fallback expiry', () => {
    const completedAt = new Date('2026-04-09T10:00:00.000Z');

    const result = computeExpiresAt(null, null, completedAt);

    expect(result.toISOString()).toBe('2026-04-10T10:00:00.000Z');
  });
});
