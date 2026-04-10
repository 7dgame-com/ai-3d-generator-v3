import { pool } from '../db/connection';
import { sitePowerManager } from './sitePowerManager';

const SITE_TIMER_KEY = 'site';

const scheduledTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function scheduleSiteTimer(
  cycleDurationMinutes: number,
  nextCycleAt: Date
): Promise<void> {
  const existing = scheduledTimers.get(SITE_TIMER_KEY);
  if (existing !== undefined) {
    clearTimeout(existing);
  }

  const delayMs = Math.max(0, nextCycleAt.getTime() - Date.now());
  const timer = setTimeout(async () => {
    scheduledTimers.delete(SITE_TIMER_KEY);
    await runSiteCycle(cycleDurationMinutes, nextCycleAt);
  }, delayMs);

  scheduledTimers.set(SITE_TIMER_KEY, timer);
}

async function runSiteCycle(
  cycleDurationMinutes: number,
  cycleStartAt: Date
): Promise<void> {
  const cycleKey = `site:${cycleStartAt.toISOString()}`;

  try {
    await pool.query(
      "INSERT INTO site_power_jobs (job_type, cycle_key, status) VALUES ('inject', ?, 'pending')",
      [cycleKey]
    );
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') {
      return;
    }
    throw error;
  }

  try {
    await sitePowerManager.settleWallet(`settle:${cycleKey}`);

    const now = new Date();
    const newNextCycleAt = new Date(now.getTime() + cycleDurationMinutes * 60 * 1000);

    await pool.query(
      'UPDATE site_power_accounts SET cycle_started_at = ?, next_cycle_at = ? WHERE id = 1',
      [now, newNextCycleAt]
    );

    await sitePowerManager.injectWallet(`inject:${cycleKey}`);

    await pool.query(
      "UPDATE site_power_jobs SET status = 'done', executed_at = NOW() WHERE cycle_key = ?",
      [cycleKey]
    );

    await scheduleSiteTimer(cycleDurationMinutes, newNextCycleAt);
  } catch (error) {
    const message = (error as Error).message;

    try {
      await pool.query(
        "UPDATE site_power_jobs SET status = 'failed', error_message = ? WHERE cycle_key = ?",
        [message, cycleKey]
      );
    } catch (updateError) {
      console.error(
        '[SiteQuotaScheduler] 更新 site_power_jobs 失败状态失败:',
        (updateError as Error).message
      );
    }

    const now = new Date();
    const newNextCycleAt = new Date(now.getTime() + cycleDurationMinutes * 60 * 1000);
    await scheduleSiteTimer(cycleDurationMinutes, newNextCycleAt);
  }
}

export async function startSiteScheduler(): Promise<void> {
  try {
    const [rows] = await pool.query<any[]>(
      'SELECT id, cycle_duration, next_cycle_at FROM site_power_accounts WHERE next_cycle_at IS NOT NULL'
    );

    if (!rows || rows.length === 0) {
      return;
    }

    const row = rows[0];
    await scheduleSiteTimer(Number(row.cycle_duration), new Date(row.next_cycle_at));
  } catch (error) {
    console.error('[SiteQuotaScheduler] 启动失败:', (error as Error).message);
  }
}

export function stopSiteScheduler(): void {
  const timer = scheduledTimers.get(SITE_TIMER_KEY);
  if (timer !== undefined) {
    clearTimeout(timer);
  }
  scheduledTimers.clear();
}

export async function scheduleNextSiteCycle(
  cycleDurationMinutes: number,
  nextCycleAt: Date
): Promise<void> {
  await scheduleSiteTimer(cycleDurationMinutes, nextCycleAt);
}
