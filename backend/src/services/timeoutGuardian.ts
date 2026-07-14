import { query } from '../db/connection';
import { activeQuotaTool } from './quotaToolRegistry';

export const PREPARE_TIMEOUT_MS = 15 * 60 * 1000;
export const GUARDIAN_INTERVAL_MS = 60 * 1000;

interface TimedOutLedgerRow {
  user_id: number;
  provider_id: string;
  task_id: string;
}

let guardianTimer: NodeJS.Timeout | null = null;

export function shouldRefundPreDeduct(
  createdAtMs: number,
  nowMs: number,
  timeoutMs: number,
  hasSettlement: boolean
): boolean {
  return !hasSettlement && nowMs - createdAtMs >= timeoutMs;
}

export async function runTimeoutGuardianOnce(_now: Date = new Date()): Promise<{
  scanned: number;
  refunded: number;
  failed: number;
}> {
  const timeoutSeconds = Math.floor(PREPARE_TIMEOUT_MS / 1000);
  const rows = await query<TimedOutLedgerRow[]>(
    `SELECT l.user_id, l.provider_id, l.task_id
     FROM quota_usage_ledger l
     INNER JOIN tasks t ON t.task_id = l.task_id
     WHERE l.event_type = 'pre_deduct'
       AND l.task_id IS NOT NULL
       AND l.created_at <= DATE_SUB(NOW(), INTERVAL ? SECOND)
       AND t.status IN ('waiting_provider', 'retry_wait')
       AND NOT EXISTS (
         SELECT 1
         FROM quota_usage_ledger settled
         WHERE settled.user_id = l.user_id
           AND settled.provider_id = l.provider_id
           AND settled.task_id = l.task_id
           AND settled.event_type IN ('confirm_deduct', 'refund')
       )`,
    [timeoutSeconds]
  );

  let refunded = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    try {
      await activeQuotaTool.refund(row.user_id, row.provider_id, row.task_id);
      await query(
        "UPDATE tasks SET status = 'timeout', error_message = '排队超过安全等待时间，系统自动退款', completed_at = NOW(), provider_slot_released_at = COALESCE(provider_slot_released_at, NOW()) WHERE task_id = ? AND status IN ('waiting_provider', 'retry_wait')",
        [row.task_id]
      );
      refunded += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `[TimeoutGuardian] refund failed (providerId=${row.provider_id}, taskId=${row.task_id}):`,
        (error as Error).message
      );
    }
  }

  return {
    scanned: rows?.length ?? 0,
    refunded,
    failed,
  };
}

export function startTimeoutGuardian(): void {
  if (guardianTimer) {
    return;
  }

  guardianTimer = setInterval(() => {
    void runTimeoutGuardianOnce().catch((error) => {
      console.error('[TimeoutGuardian] run failed:', (error as Error).message);
    });
  }, GUARDIAN_INTERVAL_MS);
}

export function stopTimeoutGuardian(): void {
  if (!guardianTimer) {
    return;
  }

  clearInterval(guardianTimer);
  guardianTimer = null;
}
