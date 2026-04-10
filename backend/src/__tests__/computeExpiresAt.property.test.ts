import * as fc from 'fast-check';
import { computeExpiresAt } from '../utils/urlExpiry';

interface UrlSpec {
  url: string | null;
  parsedExpiry: number | null;
}

function formatSigDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function truncateToSecond(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

function encodeCloudFrontPolicy(epochSeconds: number): string {
  const policy = JSON.stringify({
    Statement: [
      {
        Resource: 'https://cdn.example.com/*',
        Condition: {
          DateLessThan: {
            'AWS:EpochTime': epochSeconds,
          },
        },
      },
    ],
  });

  return Buffer.from(policy, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '~');
}

const unsignedUrlArb = fc.constant<UrlSpec>({
  url: 'https://cdn.example.com/model.glb',
  parsedExpiry: null,
});

const expiresUrlArb = fc.integer({ min: 1_700_000_000, max: 1_900_000_000 }).map((epochSeconds) => ({
  url: `https://cdn.example.com/model.glb?Expires=${epochSeconds}`,
  parsedExpiry: epochSeconds * 1000,
}));

const cloudFrontUrlArb = fc.integer({ min: 1_700_000_000, max: 1_900_000_000 }).map((epochSeconds) => ({
  url: `https://cdn.example.com/model.glb?Policy=${encodeCloudFrontPolicy(epochSeconds)}`,
  parsedExpiry: epochSeconds * 1000,
}));

const s3UrlArb = fc
  .record({
    signedAtMs: fc.integer({
      min: Date.parse('2025-01-01T00:00:00.000Z'),
      max: Date.parse('2030-12-31T23:59:59.000Z'),
    }),
    expiresSeconds: fc.integer({ min: 1, max: 7 * 24 * 60 * 60 }),
  })
  .map(({ signedAtMs, expiresSeconds }) => {
    const normalizedSignedAt = truncateToSecond(new Date(signedAtMs));
    return {
      url: `https://bucket.s3.amazonaws.com/model.glb?X-Amz-Date=${formatSigDate(normalizedSignedAt)}&X-Amz-Expires=${expiresSeconds}`,
      parsedExpiry: normalizedSignedAt.getTime() + expiresSeconds * 1000,
    };
  });

const tosUrlArb = fc
  .record({
    signedAtMs: fc.integer({
      min: Date.parse('2025-01-01T00:00:00.000Z'),
      max: Date.parse('2030-12-31T23:59:59.000Z'),
    }),
    expiresSeconds: fc.integer({ min: 1, max: 7 * 24 * 60 * 60 }),
  })
  .map(({ signedAtMs, expiresSeconds }) => {
    const normalizedSignedAt = truncateToSecond(new Date(signedAtMs));
    return {
      url: `https://bucket.tos-cn-beijing.volces.com/model.glb?X-Tos-Date=${formatSigDate(normalizedSignedAt)}&X-Tos-Expires=${expiresSeconds}`,
      parsedExpiry: normalizedSignedAt.getTime() + expiresSeconds * 1000,
    };
  });

const parseableOrUnsignedUrlArb = fc.oneof(unsignedUrlArb, expiresUrlArb, cloudFrontUrlArb, s3UrlArb, tosUrlArb);

describe('Feature: task-expiry-pagination, Property 1: 过期时间计算正确性', () => {
  it('returns the earliest parsed expiry or falls back to completedAt + 24h', () => {
    fc.assert(
      fc.property(
        parseableOrUnsignedUrlArb,
        fc.option(parseableOrUnsignedUrlArb, { nil: null }),
        fc.date({ min: new Date('2025-01-01T00:00:00.000Z'), max: new Date('2030-12-31T23:59:59.000Z') }),
        (outputSpec, thumbnailSpec, completedAt) => {
          const result = computeExpiresAt(outputSpec.url, thumbnailSpec?.url ?? null, completedAt);
          const candidates = [outputSpec.parsedExpiry, thumbnailSpec?.parsedExpiry ?? null].filter(
            (value): value is number => value !== null
          );

          const expected = candidates.length > 0
            ? new Date(Math.min(...candidates))
            : new Date(completedAt.getTime() + 24 * 60 * 60 * 1000);

          expect(result.toISOString()).toBe(expected.toISOString());
        }
      ),
      { numRuns: 100 }
    );
  });
});
