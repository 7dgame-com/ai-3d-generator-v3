/**
 * Read-safe migration rehearsal for a production-structure replica.
 *
 * Usage:
 *   AI3D_MIGRATION_REHEARSAL=1 npm exec tsx src/scripts/rehearseQueueMigration.ts
 *
 * The script intentionally performs only the normal additive schema bootstrap.
 * It never removes data. It verifies that the migration leaves historical task,
 * quota-ledger, and unfinished-task counts unchanged, then proves that the
 * configuration rollback posture stops new queue submissions and dispatching.
 */
import { pool, query, testConnection } from '../db/connection';
import { ensureSchemaReady } from '../db/schemaHealth';
import { getQueueRolloutStatus, isQueueDispatchEnabled, isUnifiedQueueEnabledForUser } from '../services/queueRollout';

interface CountRow {
  total: number | string;
}

interface RehearsalSnapshot {
  taskCount: number;
  ledgerCount: number;
  unfinishedTaskCount: number;
}

function countOf(rows: CountRow[]): number {
  return Number(rows[0]?.total ?? 0);
}

async function snapshot(): Promise<RehearsalSnapshot> {
  const [tasks, ledger, unfinished] = await Promise.all([
    query<CountRow[]>('SELECT COUNT(*) AS total FROM tasks'),
    query<CountRow[]>('SELECT COUNT(*) AS total FROM quota_usage_ledger'),
    query<CountRow[]>(`SELECT COUNT(*) AS total FROM tasks
      WHERE status NOT IN ('success', 'failed', 'cancelled', 'timeout')`),
  ]);
  return {
    taskCount: countOf(tasks),
    ledgerCount: countOf(ledger),
    unfinishedTaskCount: countOf(unfinished),
  };
}

function sameSnapshot(left: RehearsalSnapshot, right: RehearsalSnapshot): boolean {
  return left.taskCount === right.taskCount
    && left.ledgerCount === right.ledgerCount
    && left.unfinishedTaskCount === right.unfinishedTaskCount;
}

async function main(): Promise<void> {
  if (process.env.AI3D_MIGRATION_REHEARSAL !== '1') {
    throw new Error('Refusing to run: set AI3D_MIGRATION_REHEARSAL=1 for a disposable production-structure replica');
  }

  await testConnection();
  const before = await snapshot();
  const schema = await ensureSchemaReady({ ...process.env, AUTO_MIGRATE: 'true' });
  const after = await snapshot();
  const rollbackEnv = {
    ...process.env,
    UNIFIED_PROVIDER_QUEUE_ENABLED: 'false',
    UNIFIED_PROVIDER_QUEUE_DISPATCH_ENABLED: 'false',
  };
  const rollbackValidated = !isUnifiedQueueEnabledForUser(1, rollbackEnv)
    && !isQueueDispatchEnabled(rollbackEnv);

  const report = {
    database: schema.database,
    schema: {
      autoInitialized: schema.autoInitialized,
      tableCount: schema.tableCount,
      missingTables: schema.missingTables,
      missingColumns: schema.missingColumns,
    },
    before,
    after,
    countsPreserved: sameSnapshot(before, after),
    rollback: {
      validated: rollbackValidated,
      status: getQueueRolloutStatus(rollbackEnv),
    },
  };
  console.log(JSON.stringify(report, null, 2));

  if (!report.countsPreserved || schema.missingTables.length > 0 || schema.missingColumns.length > 0 || !rollbackValidated) {
    process.exitCode = 1;
  }
}

void main()
  .catch((error) => {
    console.error('[QueueMigrationRehearsal] failed:', (error as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
