/**
 * Cross-process P2 restart rehearsal for a disposable MySQL clone.
 *
 * The shell wrapper starts this script twice in distinct Node processes. The
 * first process leaves durable checkpoints after dispatcher claim and provider
 * submission; the second process starts with no in-memory state and proves
 * recovery, polling and Power settlement remain idempotent.
 */
import type { CreateTaskInput, CreateTaskOutput, IProviderAdapter, ProviderBalance, TaskStatusOutput } from '../adapters/IProviderAdapter';
import { providerRegistry } from '../adapters/ProviderRegistry';
import { pool, query, testConnection } from '../db/connection';
import { encrypt } from '../services/crypto';
import { releaseProviderSlot, runProviderDispatcherOnce } from '../services/providerQueue';
import { simpleUserUsageQuotaTool } from '../services/simpleUserUsageQuotaTool';
import { startPoller, stopPoller } from '../services/taskPoller';

const PROVIDER_ID = 'tripo3d';
const CRYPTO_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const phase = process.argv[2];
const restartRunId = process.env.AI3D_QUEUE_P2_RESTART_RUN_ID ?? '';
const taskPrefix = `p2-restart-${restartRunId}`;
const userOffset = [...restartRunId].reduce((total, character) => total + character.charCodeAt(0), 0) % 10_000;
const userBase = 910_000_000 + userOffset * 10;

interface TaskRow {
  task_id: string;
  user_id: number;
  status: string;
  provider_task_id: string | null;
  provider_slot_released_at: Date | string | null;
}

interface CountRow {
  total: number | string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`P2 restart rehearsal assertion failed: ${message}`);
}

function count(rows: CountRow[]): number {
  return Number(rows[0]?.total ?? 0);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function taskId(name: string): string {
  return `${taskPrefix}-${name}`;
}

function requireIsolatedDatabase(): void {
  const database = process.env.DB_NAME ?? '';
  assert(process.env.AI3D_QUEUE_P2_SCENARIOS === '1', 'set AI3D_QUEUE_P2_SCENARIOS=1');
  assert(process.env.AI3D_QUEUE_P2_ISOLATED_DB === '1', 'set AI3D_QUEUE_P2_ISOLATED_DB=1 only for a disposable clone');
  assert(/^ai3d(?:_|-)p2(?:_|-)/.test(database), `refusing non-isolated database ${database || '(unset)'}`);
  assert(/^[a-z0-9][a-z0-9-]{5,63}$/.test(restartRunId), 'AI3D_QUEUE_P2_RESTART_RUN_ID must be a safe, unique identifier');
  assert(phase === 'prepare' || phase === 'resume', 'phase must be prepare or resume');
}

class RestartScenarioAdapter implements IProviderAdapter {
  readonly providerId = PROVIDER_ID;
  createCalls = 0;

  validateApiKeyFormat(): boolean {
    return true;
  }

  async verifyApiKey(): Promise<void> {
    return undefined;
  }

  async createTask(_apiKey: string, _input: CreateTaskInput): Promise<CreateTaskOutput> {
    this.createCalls += 1;
    return {
      taskId: `${taskPrefix}-provider-${this.createCalls}`,
      pollingKey: `${taskPrefix}-poll-${this.createCalls}`,
      estimatedCost: 30,
    };
  }

  async getTaskStatus(): Promise<TaskStatusOutput> {
    return {
      status: 'success',
      progress: 100,
      providerWorkFinished: true,
      outputUrl: 'http://127.0.0.1:1/p2-restart.glb',
      creditCost: 30,
    };
  }

  async getBalance(): Promise<ProviderBalance> {
    return { available: 1_000_000, frozen: 0 };
  }
}

async function setup(adapter: RestartScenarioAdapter): Promise<void> {
  if (!process.env.CRYPTO_KEY) process.env.CRYPTO_KEY = CRYPTO_KEY;
  process.env.UNIFIED_PROVIDER_QUEUE_ENABLED = 'true';
  process.env.UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED = 'true';
  providerRegistry.register(adapter);
  await simpleUserUsageQuotaTool.setDefaultLimit(10);
  await query(
    `INSERT INTO provider_runtime_config
      (provider_id, credential_scope, max_concurrency, paused, poll_interval_seconds, retry_limit)
     VALUES (?, 'default', 4, 0, 1, 6)
     ON DUPLICATE KEY UPDATE max_concurrency = VALUES(max_concurrency), paused = 0,
       pause_reason = NULL, poll_interval_seconds = VALUES(poll_interval_seconds), retry_limit = VALUES(retry_limit)`,
    [PROVIDER_ID]
  );
  await query(
    'INSERT INTO system_config (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    [`${PROVIDER_ID}_api_key`, encrypt('p2-restart-scenario-key')]
  );
}

async function enqueue(name: string, userId: number): Promise<string> {
  const id = taskId(name);
  const result = await simpleUserUsageQuotaTool.enqueueWithReservation({
    taskId: id,
    userId,
    providerId: PROVIDER_ID,
    type: 'text_to_model',
    prompt: `P2 restart ${name}`,
    requestPayload: JSON.stringify({ type: 'text_to_model', prompt: `P2 restart ${name}` }),
    reservedPower: 1,
    outstandingLimit: 1,
    userSnapshot: { user_id: userId, username: `p2-restart-${userId}`, roles: ['user'] },
  });
  assert(result.success, `${name} must enter the local queue (${result.errorCode ?? 'unknown'})`);
  return id;
}

async function getTask(id: string): Promise<TaskRow> {
  const rows = await query<TaskRow[]>(
    `SELECT task_id, user_id, status, provider_task_id, provider_slot_released_at
     FROM tasks WHERE task_id = ? LIMIT 1`,
    [id]
  );
  assert(rows[0], `${id} must exist`);
  return rows[0];
}

async function waitForStatus(id: string, expectedStatus: string, timeoutMs = 7_000): Promise<TaskRow> {
  const deadline = Date.now() + timeoutMs;
  let row = await getTask(id);
  while (row.status !== expectedStatus && Date.now() < deadline) {
    await delay(50);
    row = await getTask(id);
  }
  assert(row.status === expectedStatus, `${id} should be ${expectedStatus}, got ${row.status}`);
  return row;
}

async function ledgerCount(id: string, eventType: 'pre_deduct' | 'confirm_deduct'): Promise<number> {
  const rows = await query<CountRow[]>(
    'SELECT COUNT(*) AS total FROM quota_usage_ledger WHERE task_id = ? AND event_type = ?',
    [id, eventType]
  );
  return count(rows);
}

async function prepare(): Promise<void> {
  const existing = await query<CountRow[]>('SELECT COUNT(*) AS total FROM tasks WHERE task_id LIKE ?', [`${taskPrefix}%`]);
  assert(count(existing) === 0, `restart run ID ${restartRunId} is already present; use a new ID`);

  const claimedId = await enqueue('after-dispatcher-claim', userBase + 1);
  await query(
    `UPDATE tasks
     SET status = 'submitting', provider_slot_acquired_at = NOW(),
         lease_expires_at = DATE_SUB(NOW(), INTERVAL 1 SECOND)
     WHERE task_id = ?`,
    [claimedId]
  );

  const createdId = await enqueue('after-provider-create', userBase + 2);
  const terminalId = await enqueue('before-terminal-settlement', userBase + 3);
  await runProviderDispatcherOnce();
  const created = await waitForStatus(createdId, 'queued');
  const terminal = await waitForStatus(terminalId, 'queued');
  assert(created.provider_task_id !== null && terminal.provider_task_id !== null, 'provider-created checkpoints need durable provider task IDs');
  assert((await ledgerCount(claimedId, 'pre_deduct')) === 1, 'claimed task gets exactly one reservation');
  assert((await ledgerCount(createdId, 'pre_deduct')) === 1, 'provider-created task gets exactly one reservation');
  assert((await ledgerCount(terminalId, 'pre_deduct')) === 1, 'terminal checkpoint task gets exactly one reservation');

  console.log(JSON.stringify({
    phase: 'prepare',
    restartRunId,
    taskPrefix,
    checkpoints: {
      afterDispatcherClaim: claimedId,
      afterProviderCreate: createdId,
      beforeTerminalSettlement: terminalId,
    },
  }, null, 2));
}

async function resume(adapter: RestartScenarioAdapter): Promise<void> {
  const claimedId = taskId('after-dispatcher-claim');
  const createdId = taskId('after-provider-create');
  const terminalId = taskId('before-terminal-settlement');
  await Promise.all([getTask(claimedId), getTask(createdId), getTask(terminalId)]);

  await runProviderDispatcherOnce();
  const claimed = await waitForStatus(claimedId, 'provider_state_unknown');
  assert(claimed.provider_task_id === null, 'an expired pre-submit lease must reconcile without blind provider submission');
  assert(adapter.createCalls === 0, 'a fresh process must not resubmit already claimed or provider-created tasks');

  await startPoller();
  try {
    const created = await waitForStatus(createdId, 'success');
    const terminal = await waitForStatus(terminalId, 'success');
    assert(created.provider_task_id !== null && terminal.provider_task_id !== null, 'recovered tasks retain their original provider IDs');
  } finally {
    stopPoller();
  }

  for (const id of [createdId, terminalId]) {
    assert((await ledgerCount(id, 'pre_deduct')) === 1, `${id} must retain one reservation after restart`);
    assert((await ledgerCount(id, 'confirm_deduct')) === 1, `${id} must settle once after restart`);
  }
  await releaseProviderSlot(claimedId);

  console.log(JSON.stringify({
    phase: 'resume',
    restartRunId,
    taskPrefix,
    checkpoints: {
      afterDispatcherClaim: (await getTask(claimedId)).status,
      afterProviderCreate: (await getTask(createdId)).status,
      beforeTerminalSettlement: (await getTask(terminalId)).status,
    },
    providerCreateCallsAfterRestart: adapter.createCalls,
    duplicateReservationOrSettlement: false,
  }, null, 2));
}

async function main(): Promise<void> {
  requireIsolatedDatabase();
  await testConnection();
  const adapter = new RestartScenarioAdapter();
  await setup(adapter);
  if (phase === 'prepare') await prepare();
  else await resume(adapter);
}

void main()
  .catch((error) => {
    console.error('[QueueP2RestartRehearsal] failed:', (error as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    stopPoller();
    await pool.end();
  });
