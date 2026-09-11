/**
 * Controls who may create work through the persistent provider queue.
 *
 * `UNIFIED_PROVIDER_QUEUE_ENABLED` accepts `true`/`all`, `false`/`disabled`
 * (default), or `canary`. When `UNIFIED_PROVIDER_QUEUE_USER_IDS` is present,
 * only those numeric user IDs use the queue. This makes a canary sticky at the
 * API boundary: a user can enter either the old prepare/register flow or the
 * queued flow, never both under the same configuration.
 */
export type QueueRolloutMode = 'all' | 'allowlist' | 'disabled';

const DISABLED_VALUES = new Set(['0', 'false', 'off', 'no', 'disabled']);
const CANARY_VALUES = new Set(['canary', 'allowlist', 'limited']);

function parseUserIds(value: string | undefined): Set<number> {
  const ids = new Set<number>();
  for (const rawId of String(value ?? '').split(',')) {
    const userId = Number(rawId.trim());
    if (Number.isSafeInteger(userId) && userId > 0) ids.add(userId);
  }
  return ids;
}

export interface QueueRolloutConfig {
  mode: QueueRolloutMode;
  allowedUserIds: Set<number>;
  dispatchEnabled: boolean;
}

export function getQueueRolloutConfig(env: NodeJS.ProcessEnv = process.env): QueueRolloutConfig {
  const enabledValue = String(env.UNIFIED_PROVIDER_QUEUE_ENABLED ?? 'false').trim().toLowerCase();
  const allowedUserIds = parseUserIds(env.UNIFIED_PROVIDER_QUEUE_USER_IDS);
  const dispatchValue = String(env.UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED ?? 'true').trim().toLowerCase();

  const mode: QueueRolloutMode = DISABLED_VALUES.has(enabledValue)
    ? 'disabled'
    : (CANARY_VALUES.has(enabledValue) || allowedUserIds.size > 0 ? 'allowlist' : 'all');

  return {
    mode,
    allowedUserIds,
    dispatchEnabled: !DISABLED_VALUES.has(dispatchValue),
  };
}

export function isUnifiedQueueEnabledForUser(userId: number, env: NodeJS.ProcessEnv = process.env): boolean {
  const config = getQueueRolloutConfig(env);
  if (config.mode === 'disabled') return false;
  return config.mode === 'all' || config.allowedUserIds.has(userId);
}

export function isQueueDispatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return getQueueRolloutConfig(env).dispatchEnabled;
}

/** Safe operational view: it intentionally exposes only the canary count. */
export function getQueueRolloutStatus(env: NodeJS.ProcessEnv = process.env): {
  mode: QueueRolloutMode;
  allowlistCount: number;
  dispatchEnabled: boolean;
} {
  const config = getQueueRolloutConfig(env);
  return {
    mode: config.mode,
    allowlistCount: config.allowedUserIds.size,
    dispatchEnabled: config.dispatchEnabled,
  };
}
