/**
 * Executes the P2 queue acceptance scenarios against a disposable MySQL clone.
 *
 * The script uses a local fake provider, but the queue, claim lease, Power
 * reservation, settlement, reset and recovery code paths are the real ones.
 * It never calls Tripo3D or Hyper3D and refuses to run unless the DB name is
 * explicitly marked as an isolated P2 database.
 *
 * Example:
 *   AI3D_QUEUE_P2_SCENARIOS=1 AI3D_QUEUE_P2_ISOLATED_DB=1 \
 *     DB_NAME=ai3d_p2_rehearsal_... npm run verify:p2-scenarios
 */
import { randomUUID } from 'node:crypto';
import type { CreateTaskInput, CreateTaskOutput, IProviderAdapter, ProviderBalance, TaskStatusOutput } from '../adapters/IProviderAdapter';
import { providerRegistry } from '../adapters/ProviderRegistry';
import { encrypt } from '../services/crypto';
import { pool, query, testConnection } from '../db/connection';
import { simpleUserUsageQuotaTool } from '../services/simpleUserUsageQuotaTool';
import { releaseProviderSlot, runProviderDispatcherOnce } from '../services/providerQueue';

const SCENARIO_PREFIX = `p2-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const SCENARIO_USER_BASE = 900_000_000 + Math.floor(Math.random() * 10_000);
const PROVIDER_ID = 'tripo3d';
const SCENARIO_CRYPTO_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

interface TaskRow {
  task_id: string;
  user_id: number;
  status: string;
  provider_task_id: string | null;
  provider_slot_released_at: Date | string | null;
  provider_error_category: string | null;
  quota_epoch: number;
}

interface CountRow {
  total: number | string;
}

interface RuntimeRow {
  paused: number | string;
}

interface ScenarioResult {
  name: string;
  taskId: string;
  status: string;
  errorCategory?: string | null;
}

interface CapacityBaseline {
  submissionMs: number;
  queueDrainMs: number;
  maxActiveSlots: number;
  queueWaitP50Ms: number;
  queueWaitP95Ms: number;
  queueWaitMaxMs: number;
  workerCount: number;
  scanIntervalMs: number;
  pollIntervalSeconds: number;
}

interface CapacityScenario {
  results: ScenarioResult[];
  baseline: CapacityBaseline;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`P2 scenario assertion failed: ${message}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function count(rows: CountRow[]): number {
  return Number(rows[0]?.total ?? 0);
}

function percentile(values: number[], percentileValue: number): number {
  assert(values.length > 0, 'cannot calculate a percentile from an empty sample');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1))];
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function requireIsolatedDatabase(): void {
  const database = process.env.DB_NAME ?? '';
  if (process.env.AI3D_QUEUE_P2_SCENARIOS !== '1') {
    throw new Error('Refusing to run: set AI3D_QUEUE_P2_SCENARIOS=1 for an isolated database clone');
  }
  if (process.env.AI3D_QUEUE_P2_ISOLATED_DB !== '1') {
    throw new Error('Refusing to run: set AI3D_QUEUE_P2_ISOLATED_DB=1 only after confirming this is disposable');
  }
  if (!/^ai3d(?:_|-)p2(?:_|-)/.test(database)) {
    throw new Error(`Refusing to run against non-isolated database: ${database || '(unset)'}`);
  }
}

class ScenarioProviderAdapter implements IProviderAdapter {
  readonly providerId = PROVIDER_ID;
  createCalls = 0;

  validateApiKeyFormat(): boolean {
    return true;
  }

  async verifyApiKey(): Promise<void> {
    return undefined;
  }

  async createTask(_apiKey: string, input: CreateTaskInput): Promise<CreateTaskOutput> {
    this.createCalls += 1;
    const mode = input.prompt ?? '';
    if (mode.includes('P2::429')) {
      throw Object.assign(new Error('rate limited'), {
        response: { status: 429, headers: { 'retry-after': '60' }, data: { message: 'rate limited' } },
      });
    }
    if (mode.includes('P2::5xx')) {
      throw Object.assign(new Error('upstream unavailable'), {
        response: { status: 503, headers: { 'retry-after': '60' }, data: { message: 'upstream unavailable' } },
      });
    }
    if (mode.includes('P2::network')) {
      throw Object.assign(new Error('DNS lookup failed'), { code: 'ENOTFOUND' });
    }
    if (mode.includes('P2::unknown')) {
      throw Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' });
    }
    if (mode.includes('P2::balance')) {
      throw new Error('insufficient balance');
    }
    if (mode.includes('P2::access')) {
      throw Object.assign(new Error('forbidden'), { response: { status: 403, data: { message: 'forbidden' } } });
    }
    if (mode.includes('P2::slow')) {
      await delay(180);
    }
    return {
      taskId: `${SCENARIO_PREFIX}-provider-${this.createCalls}`,
      pollingKey: `${SCENARIO_PREFIX}-poll-${this.createCalls}`,
      estimatedCost: 30,
    };
  }

  async getTaskStatus(): Promise<TaskStatusOutput> {
    return { status: 'processing', progress: 50 };
  }

  async getBalance(): Promise<ProviderBalance> {
    return { available: 1_000_000, frozen: 0 };
  }
}

async function getTask(taskId: string): Promise<TaskRow> {
  const rows = await query<TaskRow[]>(
    `SELECT task_id, user_id, status, provider_task_id, provider_slot_released_at,
            provider_error_category, quota_epoch
     FROM tasks WHERE task_id = ? LIMIT 1`,
    [taskId]
  );
  const row = rows[0];
  assert(row, `task ${taskId} should exist`);
  return row;
}

async function waitForTask(taskId: string, expectedStatus: string, timeoutMs = 5_000): Promise<TaskRow> {
  const deadline = Date.now() + timeoutMs;
  let latest = await getTask(taskId);
  while (latest.status !== expectedStatus && Date.now() < deadline) {
    await delay(25);
    latest = await getTask(taskId);
  }
  assert(latest.status === expectedStatus, `${taskId} should reach ${expectedStatus}, got ${latest.status}`);
  return latest;
}

async function countScenarioTasks(status?: string): Promise<number> {
  const rows = await query<CountRow[]>(
    `SELECT COUNT(*) AS total FROM tasks
     WHERE task_id LIKE ?${status ? ' AND status = ?' : ''}`,
    status ? [`${SCENARIO_PREFIX}%`, status] : [`${SCENARIO_PREFIX}%`]
  );
  return count(rows);
}

async function setScopePaused(paused: boolean): Promise<void> {
  await query(
    `UPDATE provider_runtime_config
     SET paused = ?, pause_reason = CASE WHEN ? = 1 THEN 'P2 scenario pause' ELSE NULL END
     WHERE provider_id = ? AND credential_scope = 'default'`,
    [paused ? 1 : 0, paused ? 1 : 0, PROVIDER_ID]
  );
}

async function verifyScopePaused(expected: boolean): Promise<void> {
  const rows = await query<RuntimeRow[]>(
    `SELECT paused FROM provider_runtime_config WHERE provider_id = ? AND credential_scope = 'default'`,
    [PROVIDER_ID]
  );
  assert(Boolean(Number(rows[0]?.paused ?? 0)) === expected, `provider scope paused=${expected}`);
}

async function enqueue(userId: number, label: string, reservedPower = 1): Promise<string> {
  const taskId = `${SCENARIO_PREFIX}-${label}`;
  const result = await simpleUserUsageQuotaTool.enqueueWithReservation({
    taskId,
    userId,
    providerId: PROVIDER_ID,
    type: 'text_to_model',
    prompt: label,
    requestPayload: JSON.stringify({ type: 'text_to_model', prompt: label }),
    reservedPower,
    outstandingLimit: 1,
    userSnapshot: { user_id: userId, username: `p2-${userId}`, roles: ['user'] },
  });
  assert(result.success, `${label} should reserve Power and enter the local queue (${result.errorCode ?? 'unknown'})`);
  return taskId;
}

async function preDeductCount(taskId: string): Promise<number> {
  const rows = await query<CountRow[]>(
    `SELECT COUNT(*) AS total FROM quota_usage_ledger
     WHERE task_id = ? AND event_type = 'pre_deduct'`,
    [taskId]
  );
  return count(rows);
}

async function settleAndRelease(task: TaskRow): Promise<void> {
  await simpleUserUsageQuotaTool.finalizeTaskSuccess(
    task.user_id,
    PROVIDER_ID,
    task.task_id,
    `https://p2.invalid/${task.task_id}.glb`,
    1,
    30
  );
  await releaseProviderSlot(task.task_id);
}

async function waitForActiveCapacity(expected: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let active = -1;
  while (Date.now() < deadline) {
    const rows = await query<CountRow[]>(
      `SELECT COUNT(*) AS total FROM tasks
       WHERE task_id LIKE ?
         AND provider_slot_acquired_at IS NOT NULL
         AND provider_slot_released_at IS NULL`,
      [`${SCENARIO_PREFIX}%`]
    );
    active = count(rows);
    if (active === expected) return;
    await delay(25);
  }
  assert(active === expected, `expected ${expected} active provider slots, got ${active}`);
}

async function freezeRetry(taskId: string): Promise<void> {
  await query(
    "UPDATE tasks SET next_attempt_at = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE task_id = ? AND status = 'retry_wait'",
    [taskId]
  );
}

async function verifyCapacityScenario(): Promise<CapacityScenario> {
  await simpleUserUsageQuotaTool.setDefaultLimit(10);
  const users = Array.from({ length: 30 }, (_, index) => SCENARIO_USER_BASE + index + 1);
  const startedAt = Date.now();
  const taskIds = await Promise.all(users.map((userId, index) => enqueue(userId, `capacity-${String(index + 1).padStart(2, '0')}`)));
  const submissionMs = Date.now() - startedAt;
  assert(submissionMs <= 3_000, `30 local admissions must finish within 3 seconds, got ${submissionMs}ms`);
  assert((await countScenarioTasks('waiting_provider')) === 30, 'all 30 submissions must first enter the local queue');

  await runProviderDispatcherOnce();
  await waitForActiveCapacity(4);
  let maxActiveSlots = 4;
  const completionMs = new Map<string, number>();
  assert((await countScenarioTasks('waiting_provider')) === 26, 'Tripo capacity 4 must leave 26 tasks waiting');

  const initialPreDeductRows = await query<CountRow[]>(
    `SELECT COUNT(*) AS total FROM quota_usage_ledger
     WHERE task_id LIKE ? AND event_type = 'pre_deduct'`,
    [`${SCENARIO_PREFIX}-capacity-%`]
  );
  assert(count(initialPreDeductRows) === 30, 'each capacity task must receive exactly one Power reservation');

  let safety = 0;
  while ((await countScenarioTasks('success')) < 30) {
    assert(safety < 20, 'capacity scenario should drain without looping indefinitely');
    const activeRows = await query<TaskRow[]>(
      `SELECT task_id, user_id, status, provider_task_id, provider_slot_released_at,
              provider_error_category, quota_epoch
       FROM tasks
       WHERE task_id LIKE ?
         AND provider_slot_acquired_at IS NOT NULL
         AND provider_slot_released_at IS NULL
       ORDER BY task_id`,
      [`${SCENARIO_PREFIX}-capacity-%`]
    );
    maxActiveSlots = Math.max(maxActiveSlots, activeRows.length);
    for (const task of activeRows) {
      await settleAndRelease(task);
      completionMs.set(task.task_id, Date.now() - startedAt);
    }
    await runProviderDispatcherOnce();
    await delay(50);
    safety += 1;
  }

  assert((await countScenarioTasks('waiting_provider')) === 0, 'the 30-task local queue must drain');
  assert((await countScenarioTasks('success')) === 30, 'all 30 tasks must settle exactly once');
  const confirmedRows = await query<CountRow[]>(
    `SELECT COUNT(*) AS total FROM quota_usage_ledger
     WHERE task_id LIKE ? AND event_type = 'confirm_deduct'`,
    [`${SCENARIO_PREFIX}-capacity-%`]
  );
  assert(count(confirmedRows) === 30, 'each capacity task must have one final settlement');

  const queueWaitMs = taskIds.map((taskId) => {
    const completedIn = completionMs.get(taskId);
    assert(completedIn !== undefined, `capacity task ${taskId} must have a completion timestamp`);
    return completedIn;
  });
  const runtime = await query<Array<{ poll_interval_seconds: number | string }>>(
    `SELECT poll_interval_seconds FROM provider_runtime_config
     WHERE provider_id = ? AND credential_scope = 'default' LIMIT 1`,
    [PROVIDER_ID]
  );

  return {
    results: taskIds.map((taskId) => ({ name: 'capacity', taskId, status: 'success' })),
    baseline: {
      submissionMs,
      queueDrainMs: Date.now() - startedAt,
      maxActiveSlots,
      queueWaitP50Ms: percentile(queueWaitMs, 0.5),
      queueWaitP95Ms: percentile(queueWaitMs, 0.95),
      queueWaitMaxMs: Math.max(...queueWaitMs),
      workerCount: positiveIntegerEnv('AI3D_QUEUE_BASELINE_WORKERS', 1),
      scanIntervalMs: positiveIntegerEnv('PROVIDER_QUEUE_SCAN_MS', 2_000),
      pollIntervalSeconds: Number(runtime[0]?.poll_interval_seconds ?? 1),
    },
  };
}

async function verifyFault(
  adapter: ScenarioProviderAdapter,
  userId: number,
  name: string,
  expectedStatus: string,
  expectedCategory: string
): Promise<ScenarioResult> {
  const taskId = await enqueue(userId, `P2::${name}`);
  const beforeCreateCalls = adapter.createCalls;
  await runProviderDispatcherOnce();
  const task = await waitForTask(taskId, expectedStatus);
  assert(task.provider_error_category === expectedCategory, `${name} should use ${expectedCategory}`);
  assert((await preDeductCount(taskId)) === 1, `${name} must not create a second Power reservation`);
  assert(adapter.createCalls === beforeCreateCalls + 1, `${name} should attempt provider creation once`);

  if (expectedStatus === 'retry_wait') {
    assert(task.provider_slot_released_at !== null, `${name} retry must release its provider slot`);
    await freezeRetry(taskId);
  }
  if (expectedStatus === 'provider_state_unknown') {
    assert(task.provider_slot_released_at === null, 'ambiguous submission must retain its provider slot for reconciliation');
    await releaseProviderSlot(taskId);
  }
  return { name, taskId, status: task.status, errorCategory: task.provider_error_category };
}

async function verifyFaultScenarios(adapter: ScenarioProviderAdapter): Promise<ScenarioResult[]> {
  await simpleUserUsageQuotaTool.setDefaultLimit(10);
  const results = [
    await verifyFault(adapter, SCENARIO_USER_BASE + 101, '429', 'retry_wait', 'THROTTLED'),
    await verifyFault(adapter, SCENARIO_USER_BASE + 102, '5xx', 'retry_wait', 'TEMPORARY'),
    await verifyFault(adapter, SCENARIO_USER_BASE + 103, 'network', 'retry_wait', 'TEMPORARY'),
    await verifyFault(adapter, SCENARIO_USER_BASE + 104, 'unknown', 'provider_state_unknown', 'SUBMISSION_UNKNOWN'),
  ];

  const balance = await verifyFault(adapter, SCENARIO_USER_BASE + 105, 'balance', 'retry_wait', 'NO_BALANCE');
  await verifyScopePaused(true);
  await setScopePaused(false);
  const access = await verifyFault(adapter, SCENARIO_USER_BASE + 106, 'access', 'retry_wait', 'NO_ACCESS');
  await verifyScopePaused(true);
  await setScopePaused(false);

  const slowTaskId = await enqueue(SCENARIO_USER_BASE + 107, 'P2::slow');
  await runProviderDispatcherOnce();
  const submitting = await getTask(slowTaskId);
  assert(submitting.status === 'submitting', 'a slow supplier call must retain a local submitting record');
  const slowTask = await waitForTask(slowTaskId, 'queued');
  assert((await preDeductCount(slowTaskId)) === 1, 'slow supplier calls must not duplicate the reservation');
  await settleAndRelease(slowTask);
  results.push({ name: 'slow', taskId: slowTaskId, status: 'success' }, balance, access);
  return results;
}

async function verifyResetAndCapScenario(): Promise<ScenarioResult[]> {
  await simpleUserUsageQuotaTool.setDefaultLimit(1);
  const waitingUser = SCENARIO_USER_BASE + 201;
  const activeUser = SCENARIO_USER_BASE + 202;

  const waitingTaskId = await enqueue(waitingUser, 'reset-waiting');
  await simpleUserUsageQuotaTool.resetUserUsage(waitingUser, 'P2 reset at queue stage');
  const activeTaskId = await enqueue(activeUser, 'reset-active');
  await runProviderDispatcherOnce();
  const activeTask = await waitForTask(activeTaskId, 'queued');
  await simpleUserUsageQuotaTool.resetUserUsage(activeUser, 'P2 reset at running stage');
  const cancelled = await waitForTask(waitingTaskId, 'cancelled');
  const retained = await getTask(activeTaskId);
  assert(retained.status === 'queued', 'already accepted provider work must remain traceable after reset');

  const activeStatusAfterReset = await simpleUserUsageQuotaTool.getUserStatus(activeUser);
  assert(activeStatusAfterReset.quota_epoch === Number(activeTask.quota_epoch) + 1, 'reset must advance the active task user epoch');
  assert(activeStatusAfterReset.used_power === 0, 'new epoch starts with zero used Power');
  await settleAndRelease(activeTask);
  const activeStatusAfterLateSettlement = await simpleUserUsageQuotaTool.getUserStatus(activeUser);
  assert(activeStatusAfterLateSettlement.used_power === 0, 'late old-epoch settlement must not change current epoch usage');

  const postResetTask = await enqueue(waitingUser, 'post-reset-cap-one');
  const rejected = await simpleUserUsageQuotaTool.enqueueWithReservation({
    taskId: `${SCENARIO_PREFIX}-post-reset-cap-one-rejected`,
    userId: waitingUser,
    providerId: PROVIDER_ID,
    type: 'text_to_model',
    prompt: 'post-reset-cap-one-rejected',
    requestPayload: JSON.stringify({ type: 'text_to_model', prompt: 'post-reset-cap-one-rejected' }),
    reservedPower: 1,
    outstandingLimit: 1,
    userSnapshot: { user_id: waitingUser, username: `p2-${waitingUser}`, roles: ['user'] },
  });
  assert(!rejected.success && rejected.errorCode === 'INSUFFICIENT_CREDITS', 'a cap of 1 must reject a second current-epoch reservation');
  await query(
    "UPDATE tasks SET next_attempt_at = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE task_id = ? AND status = 'waiting_provider'",
    [postResetTask]
  );

  return [
    { name: 'reset-waiting', taskId: waitingTaskId, status: cancelled.status },
    { name: 'reset-running', taskId: activeTaskId, status: 'success' },
    { name: 'cap-one', taskId: postResetTask, status: 'waiting_provider' },
  ];
}

async function verifyRecoveryScenario(adapter: ScenarioProviderAdapter): Promise<ScenarioResult[]> {
  await simpleUserUsageQuotaTool.setDefaultLimit(10);
  const abandonedTaskId = await enqueue(SCENARIO_USER_BASE + 301, 'restart-before-provider-create');
  await query(
    `UPDATE tasks
     SET status = 'submitting', provider_slot_acquired_at = NOW(), lease_expires_at = DATE_SUB(NOW(), INTERVAL 1 SECOND)
     WHERE task_id = ?`,
    [abandonedTaskId]
  );
  const beforeCreateCalls = adapter.createCalls;
  await runProviderDispatcherOnce();
  const unknown = await waitForTask(abandonedTaskId, 'provider_state_unknown');
  assert(adapter.createCalls === beforeCreateCalls, 'expired pre-submit lease must reconcile without a blind second submission');
  await releaseProviderSlot(abandonedTaskId);

  const submittedTaskId = await enqueue(SCENARIO_USER_BASE + 302, 'restart-after-provider-create');
  await runProviderDispatcherOnce();
  const submitted = await waitForTask(submittedTaskId, 'queued');
  const createCallsAfterSubmission = adapter.createCalls;
  await runProviderDispatcherOnce();
  await delay(30);
  assert(adapter.createCalls === createCallsAfterSubmission, 'already accepted provider task must not be submitted again after another scan');
  await settleAndRelease(submitted);
  await simpleUserUsageQuotaTool.finalizeTaskSuccess(
    submitted.user_id,
    PROVIDER_ID,
    submitted.task_id,
    `https://p2.invalid/${submitted.task_id}.glb`,
    1,
    30
  );
  const settledRows = await query<CountRow[]>(
    `SELECT COUNT(*) AS total FROM quota_usage_ledger
     WHERE task_id = ? AND event_type = 'confirm_deduct'`,
    [submittedTaskId]
  );
  assert(count(settledRows) === 1, 'duplicate settlement invocation must remain idempotent');

  return [
    { name: 'restart-before-provider-create', taskId: abandonedTaskId, status: unknown.status, errorCategory: unknown.provider_error_category },
    { name: 'restart-after-provider-create', taskId: submittedTaskId, status: 'success' },
  ];
}

async function setupScenario(adapter: ScenarioProviderAdapter): Promise<void> {
  if (!process.env.CRYPTO_KEY) {
    process.env.CRYPTO_KEY = SCENARIO_CRYPTO_KEY;
  }
  process.env.UNIFIED_PROVIDER_QUEUE_ENABLED = 'true';
  process.env.UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED = 'true';
  providerRegistry.register(adapter);
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
    [`${PROVIDER_ID}_api_key`, encrypt('p2-scenario-key')]
  );
}

async function main(): Promise<void> {
  requireIsolatedDatabase();
  await testConnection();
  const adapter = new ScenarioProviderAdapter();
  await setupScenario(adapter);

  const capacity = await verifyCapacityScenario();
  const faults = await verifyFaultScenarios(adapter);
  const reset = await verifyResetAndCapScenario();
  const recovery = await verifyRecoveryScenario(adapter);

  const report = {
    database: process.env.DB_NAME,
    scenarioPrefix: SCENARIO_PREFIX,
    capacity: {
      submitted: capacity.results.length,
      maxActiveSlots: capacity.baseline.maxActiveSlots,
      finalStatus: 'success',
      baseline: capacity.baseline,
    },
    faultInjection: faults,
    resetAndCap: reset,
    recovery,
    totalProviderCreateCalls: adapter.createCalls,
  };
  console.log(JSON.stringify(report, null, 2));
}

void main()
  .catch((error) => {
    console.error('[QueueP2ScenarioVerification] failed:', (error as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
