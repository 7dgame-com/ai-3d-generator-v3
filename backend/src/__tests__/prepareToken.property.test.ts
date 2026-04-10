import * as fc from 'fast-check';
import { isPrepareTokenTaskMatch } from '../services/prepareToken';

describe('Feature: frontend-direct-api, Property 4: PrepareToken 与任务匹配验证', () => {
  it('accepts only exact tempTaskId matches', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 64 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        async (tempTaskId, ledgerTaskId) => {
          expect(isPrepareTokenTaskMatch(tempTaskId, ledgerTaskId)).toBe(tempTaskId === ledgerTaskId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
