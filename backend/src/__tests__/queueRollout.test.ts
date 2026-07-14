import type { Request, Response } from 'express';
import { rejectLegacyCreationWhenQueueEnabled } from '../routes/directTask';
import {
  getQueueRolloutConfig,
  getQueueRolloutStatus,
  isQueueDispatchEnabled,
  isUnifiedQueueEnabledForUser,
} from '../services/queueRollout';

const originalEnabled = process.env.UNIFIED_PROVIDER_QUEUE_ENABLED;
const originalUserIds = process.env.UNIFIED_PROVIDER_QUEUE_USER_IDS;
const originalDispatchEnabled = process.env.UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED;

function restoreEnv(): void {
  if (originalEnabled === undefined) delete process.env.UNIFIED_PROVIDER_QUEUE_ENABLED;
  else process.env.UNIFIED_PROVIDER_QUEUE_ENABLED = originalEnabled;
  if (originalUserIds === undefined) delete process.env.UNIFIED_PROVIDER_QUEUE_USER_IDS;
  else process.env.UNIFIED_PROVIDER_QUEUE_USER_IDS = originalUserIds;
  if (originalDispatchEnabled === undefined) delete process.env.UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED;
  else process.env.UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED = originalDispatchEnabled;
}

describe('P2 unified queue rollout controls', () => {
  afterEach(restoreEnv);

  it('defaults to the legacy direct path and can explicitly restrict a canary to an allowlist', () => {
    expect(getQueueRolloutConfig({})).toMatchObject({ mode: 'disabled', dispatchEnabled: true });

    const canary = {
      UNIFIED_PROVIDER_QUEUE_ENABLED: 'canary',
      UNIFIED_PROVIDER_QUEUE_USER_IDS: '7, 9, invalid, -1',
      UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED: 'true',
    };
    expect(isUnifiedQueueEnabledForUser(7, canary)).toBe(true);
    expect(isUnifiedQueueEnabledForUser(8, canary)).toBe(false);
    expect(getQueueRolloutStatus(canary)).toEqual({ mode: 'allowlist', allowlistCount: 2, dispatchEnabled: true });

    expect(getQueueRolloutConfig({ UNIFIED_PROVIDER_QUEUE_ENABLED: 'true' })).toMatchObject({ mode: 'all' });
  });

  it('supports a rollback that disables new queue admissions and provider dispatch separately', () => {
    const rollback = {
      UNIFIED_PROVIDER_QUEUE_ENABLED: 'false',
      UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED: 'false',
    };
    expect(isUnifiedQueueEnabledForUser(7, rollback)).toBe(false);
    expect(isQueueDispatchEnabled(rollback)).toBe(false);
  });

  it('rejects direct creation only for users admitted to the queue', () => {
    process.env.UNIFIED_PROVIDER_QUEUE_ENABLED = 'canary';
    process.env.UNIFIED_PROVIDER_QUEUE_USER_IDS = '7';
    const next = jest.fn();
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;

    rejectLegacyCreationWhenQueueEnabled({ user: { userId: 8 } } as unknown as Request, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    rejectLegacyCreationWhenQueueEnabled({ user: { userId: 7 } } as unknown as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'LEGACY_DIRECT_CREATION_DISABLED' }));
  });
});
