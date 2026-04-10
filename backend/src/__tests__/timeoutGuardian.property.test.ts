import * as fc from 'fast-check';
import { shouldRefundPreDeduct } from '../services/timeoutGuardian';

describe('Feature: frontend-direct-api, Property 2: 超时守护退款完整性', () => {
  it('only flags pre-deduct entries that are timed out and not settled', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.boolean(),
        async (ageMs, timeoutMs, hasSettlement) => {
          const now = 10_000_000;
          const createdAtMs = now - ageMs;
          const expected = ageMs >= timeoutMs && !hasSettlement;
          expect(shouldRefundPreDeduct(createdAtMs, now, timeoutMs, hasSettlement)).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});
