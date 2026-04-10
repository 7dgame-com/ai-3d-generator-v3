import { pool } from '../db/connection';
import { powerManager } from './powerManager';

const scheduledTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function scheduleUser(
  userId: number,
  cycleDurationMinutes: number,
  nextCycleAt: Date
): Promise<void> {
  const timerKey = String(userId);
  const existing = scheduledTimers.get(timerKey);
  if (existing !== undefined) {
    clearTimeout(existing);
  }

  const delayMs = Math.max(0, nextCycleAt.getTime() - Date.now());
  const timer = setTimeout(async () => {
    scheduledTimers.delete(timerKey);
    await runCycle(userId, cycleDurationMinutes, nextCycleAt);
  }, delayMs);

  scheduledTimers.set(timerKey, timer);
}

async function runCycle(
  userId: number,
  cycleDurationMinutes: number,
  cycleStartAt: Date
): Promise<void> {
  const cycleKey = `${userId}:${cycleStartAt.toISOString()}`;

  try {
    await pool.query(
      "INSERT INTO power_jobs (user_id, job_type, cycle_key, status) VALUES (?, 'inject', ?, 'pending')",
      [userId, cycleKey]
    );
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') {
      return;
    }
    throw error;
  }

  try {
    await powerManager.settleWallet(userId, `settle:${cycleKey}`);

    const now = new Date();
    const newNextCycleAt = new Date(now.getTime() + cycleDurationMinutes * 60 * 1000);

    await pool.query(
      'UPDATE power_accounts SET cycle_started_at = ?, next_cycle_at = ? WHERE user_id = ?',
      [now, newNextCycleAt, userId]
    );

    await powerManager.injectWallet(userId, `inject:${cycleKey}`);

    await pool.query(
      "UPDATE power_jobs SET status = 'done', executed_at = NOW() WHERE cycle_key = ?",
      [cycleKey]
    );

    await scheduleUser(userId, cycleDurationMinutes, newNextCycleAt);
  } catch (error) {
    const message = (error as Error).message;

    try {
      await pool.query(
        "UPDATE power_jobs SET status = 'failed', error_message = ? WHERE cycle_key = ?",
        [message, cycleKey]
      );
    } catch (updateError) {
      console.error('[QuotaScheduler] 更新 power_jobs 失败状态失败:', (updateError as Error).message);
    }

    const now = new Date();
    const newNextCycleAt = new Date(now.getTime() + cycleDurationMinutes * 60 * 1000);
    await scheduleUser(userId, cycleDurationMinutes, newNextCycleAt);
  }
}

export async function startScheduler(): Promise<void> {
  try {
    const [rows] = await pool.query<any[]>(
      'SELECT user_id, cycle_duration, next_cycle_at FROM power_accounts WHERE next_cycle_at IS NOT NULL'
    );

    if (!rows || rows.length === 0) {
      return;
    }

    for (const row of rows) {
      await scheduleUser(
        Number(row.user_id),
        Number(row.cycle_duration),
        new Date(row.next_cycle_at)
      );
    }
  } catch (error) {
    console.error('[QuotaScheduler] 启动失败:', (error as Error).message);
  }
}

export function stopScheduler(): void {
  for (const timer of scheduledTimers.values()) {
    clearTimeout(timer);
  }
  scheduledTimers.clear();
}

export async function scheduleNextCycle(
  userId: number,
  cycleDurationMinutes: number,
  nextCycleAt: Date
): Promise<void> {
  await scheduleUser(userId, cycleDurationMinutes, nextCycleAt);
}
