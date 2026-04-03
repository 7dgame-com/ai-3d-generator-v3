import { query } from '../src/db/connection';
import { encrypt } from '../src/services/crypto';
import { creditManager } from '../src/services/creditManager';
import { createTask } from '../src/controllers/task';
import { providerRegistry } from '../src/adapters/ProviderRegistry';
import { hyper3dAdapter } from '../src/adapters/Hyper3DAdapter';
import { tripo3dAdapter } from '../src/adapters/Tripo3DAdapter';

const userId = Number(process.env.TEST_USER_ID ?? 9001);
const providerId = process.env.TEST_PROVIDER ?? 'hyper3d';
const prompt = process.env.TEST_PROMPT ?? 'a simple low poly red chair';
const hyperKey = 'NGizYlZup1ugVhS9xfQQhdUwDAobebj7nRVBG8LFURDpsw5CcyzQVAx1wmiA0bic';
const tripoKey = 'tsk_Aiaz7YMR0Z5_AgipLvdMoHbyNFoG6Mmbz_x8A9ggOPm';

async function main() {
  providerRegistry.register(tripo3dAdapter);
  providerRegistry.register(hyper3dAdapter);

  await query('DELETE FROM credit_ledger WHERE user_id = ?', [userId]);
  await query('DELETE FROM credit_usage WHERE user_id = ?', [userId]);
  await query('DELETE FROM tasks WHERE user_id = ?', [userId]);
  await query('DELETE FROM quota_jobs WHERE user_id = ?', [userId]);
  await query('DELETE FROM user_accounts WHERE user_id = ?', [userId]);
  await query("DELETE FROM system_config WHERE `key` IN ('hyper3d_api_key','tripo3d_api_key')");

  await query(
    `INSERT INTO system_config (\`key\`, \`value\`) VALUES (?, ?), (?, ?)
     ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = CURRENT_TIMESTAMP`,
    ['hyper3d_api_key', encrypt(hyperKey), 'tripo3d_api_key', encrypt(tripoKey)]
  );
  console.log('config:stored');

  await creditManager.recharge(userId, providerId, {
    wallet_amount: 60,
    pool_amount: 40,
    total_duration: 120,
    cycle_duration: 60,
  });
  console.log('recharge:done', JSON.stringify(await creditManager.getStatus(userId, providerId)));

  await creditManager.injectWallet(userId, providerId, 'manual:test-cycle-1');
  console.log('inject:done', JSON.stringify(await creditManager.getStatus(userId, providerId)));

  const req = {
    body: {
      type: 'text_to_model',
      prompt,
      provider_id: providerId,
    },
    user: { userId },
  } as any;

  const resState: { statusCode: number; payload: unknown } = { statusCode: 200, payload: null };
  const res = {
    status(code: number) {
      resState.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      resState.payload = payload;
      return this;
    },
  } as any;

  await createTask(req, res);
  console.log('createTask:response', JSON.stringify(resState));
  if (resState.statusCode !== 201 || !(resState.payload as { taskId?: string } | null)?.taskId) {
    process.exit(2);
  }

  const taskId = (resState.payload as { taskId: string }).taskId;
  let finalTask: Record<string, unknown> | null = null;

  for (let i = 0; i < 80; i += 1) {
    const rows = await query<Array<Record<string, unknown>>>(
      'SELECT task_id, status, progress, credit_cost, output_url, error_message, created_at, completed_at FROM tasks WHERE task_id = ? LIMIT 1',
      [taskId]
    );
    finalTask = rows[0] ?? null;
    console.log('poll', i + 1, JSON.stringify(finalTask));
    if (finalTask && ['success', 'failed', 'timeout'].includes(String(finalTask.status))) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  const accountRows = await query<Array<Record<string, unknown>>>(
    `SELECT user_id, provider_id, wallet_balance, pool_balance, pool_baseline,
            wallet_injection_per_cycle, cycles_remaining, cycle_started_at, next_cycle_at
     FROM user_accounts
     WHERE user_id = ? AND provider_id = ?
     LIMIT 1`,
    [userId, providerId]
  );

  const ledgerRows = await query<Array<Record<string, unknown>>>(
    `SELECT event_type, wallet_delta, pool_delta, task_id, idempotency_key, note
     FROM credit_ledger
     WHERE user_id = ? AND provider_id = ?
     ORDER BY id ASC`,
    [userId, providerId]
  );

  console.log('account:final', JSON.stringify(accountRows[0] ?? null));
  console.log('ledger:final', JSON.stringify(ledgerRows));
  console.log('task:final', JSON.stringify(finalTask));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
