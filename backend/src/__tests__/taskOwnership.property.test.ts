import * as fc from 'fast-check';
import { isTaskOwner } from '../controllers/directTask';

describe('Feature: frontend-direct-api, Property 3: 任务所有权验证', () => {
  it('allows only the exact task owner to operate the task', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 999999 }),
        fc.integer({ min: 1, max: 999999 }),
        async (ownerUserId, actorUserId) => {
          expect(isTaskOwner(ownerUserId, actorUserId)).toBe(ownerUserId === actorUserId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
