import fs from 'node:fs';
import path from 'node:path';
import type { PoolConnection } from 'mysql2/promise';
import { pool, query } from './connection';

export const REQUIRED_TABLES = [
  'tasks',
  'credit_usage',
  'system_config',
  'schema_migrations',
  'quota_user_usage',
  'quota_usage_ledger',
  'provider_runtime_config',
  'provider_task_events',
  'admin_audit_logs',
] as const;

export const REQUIRED_QUEUE_COLUMNS = [
  'tasks.provider_task_id',
  'tasks.request_payload',
  'tasks.credential_scope',
  'tasks.queue_entered_at',
  'tasks.next_attempt_at',
  'tasks.lease_owner',
  'tasks.lease_expires_at',
  'tasks.provider_slot_acquired_at',
  'tasks.provider_slot_released_at',
  'tasks.quota_epoch',
  'tasks.reserved_power',
  'quota_user_usage.quota_epoch',
  'quota_usage_ledger.quota_epoch',
] as const;

const BASE_REQUIRED_TABLES = ['tasks', 'credit_usage', 'system_config'] as const;

export interface SchemaStatus {
  database: string | null;
  tableCount: number;
  existingTables: string[];
  missingTables: string[];
  missingColumns: string[];
  autoInitialized: boolean;
}

export class SchemaHealthError extends Error {
  code = 'DATABASE_SCHEMA_NOT_READY';
  status = 503;
  statusDetails: SchemaStatus;

  constructor(status: SchemaStatus) {
    super(
      status.tableCount === 0
        ? '数据库 schema 未初始化'
        : status.missingTables.length > 0
          ? `数据库 schema 缺少表: ${status.missingTables.join(', ')}`
          : `数据库 schema 缺少队列字段: ${status.missingColumns.join(', ')}`
    );
    this.name = 'SchemaHealthError';
    this.statusDetails = status;
  }
}

interface DatabaseRow {
  db: string | null;
}

interface TableRow {
  table_name: string;
}

interface ColumnRow {
  table_name?: string;
  column_name: string;
}

interface IndexRow {
  index_name: string;
}

interface MigrationRow {
  id: string;
}

interface SchemaMigration {
  id: string;
  description: string;
  up: (connection: PoolConnection) => Promise<void>;
}

function isDisabled(value: string | undefined): boolean {
  return value !== undefined && ['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

export function isAutoInitSchemaEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isDisabled(env.AUTO_INIT_SCHEMA);
}

export function isAutoMigrateSchemaEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isDisabled(env.AUTO_MIGRATE);
}

export async function inspectSchema(autoInitialized = false): Promise<SchemaStatus> {
  const dbRows = await query<DatabaseRow[]>('SELECT DATABASE() AS db');
  const database = dbRows[0]?.db ?? null;

  const tableRows = await query<TableRow[]>(
    `SELECT TABLE_NAME AS table_name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()`
  );
  const existingTables = tableRows.map((row) => row.table_name);
  const existingTableSet = new Set(existingTables);
  const missingTables = REQUIRED_TABLES.filter((table) => !existingTableSet.has(table));
  let missingColumns: string[] = [...REQUIRED_QUEUE_COLUMNS];
  if (missingTables.length === 0) {
    const columnRows = await query<Array<{ table_name: string; column_name: string }>>(
      `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN ('tasks', 'quota_user_usage', 'quota_usage_ledger')`
    );
    const existingColumns = new Set(
      columnRows.map((row) => `${row.table_name}.${row.column_name}`)
    );
    missingColumns = REQUIRED_QUEUE_COLUMNS.filter((column) => !existingColumns.has(column));
  }

  return {
    database,
    tableCount: existingTables.length,
    existingTables,
    missingTables,
    missingColumns,
    autoInitialized,
  };
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote: '"' | "'" | '`' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      current += char;
      if (char === '\n') {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) {
        if (quote === '`' || sql[index - 1] !== '\\') {
          quote = null;
        }
      }
      continue;
    }

    if (char === '-' && next === '-') {
      current += char;
      current += next;
      index += 1;
      lineComment = true;
      continue;
    }

    if (char === '/' && next === '*') {
      current += char;
      current += next;
      index += 1;
      blockComment = true;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }

    if (char === ';') {
      const statement = current.trim();
      if (statement) {
        statements.push(statement);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }

  return statements;
}

export function resolveInitSchemaPath(candidates = [
  path.resolve(__dirname, 'init-schema.sql'),
  path.resolve(process.cwd(), 'src', 'db', 'init-schema.sql'),
  path.resolve(process.cwd(), 'backend', 'src', 'db', 'init-schema.sql'),
]): string {
  const initSchemaPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!initSchemaPath) {
    throw new Error(`找不到数据库初始化 SQL。已检查: ${candidates.join(', ')}`);
  }
  return initSchemaPath;
}

export async function runInitSchema(initSchemaPath = resolveInitSchemaPath()): Promise<void> {
  const sql = fs.readFileSync(initSchemaPath, 'utf8');
  const statements = splitSqlStatements(sql);
  const connection = await pool.getConnection();

  try {
    for (const statement of statements) {
      await connection.query(statement);
    }
  } finally {
    connection.release();
  }
}

async function connectionQueryRows<T>(connection: PoolConnection, sql: string, params?: unknown[]): Promise<T> {
  // mysql2 returns [rows, fields], while tests often mock just rows.
  const result = await connection.query(sql, params as never[]);
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as T;
  }
  return result as T;
}

async function tableExists(connection: PoolConnection, tableName: string): Promise<boolean> {
  const rows = await connectionQueryRows<TableRow[]>(
    connection,
    `SELECT TABLE_NAME AS table_name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [tableName]
  );
  return rows.length > 0;
}

async function columnExists(connection: PoolConnection, tableName: string, columnName: string): Promise<boolean> {
  const rows = await connectionQueryRows<ColumnRow[]>(
    connection,
    `SELECT COLUMN_NAME AS column_name
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function indexExists(connection: PoolConnection, tableName: string, indexName: string): Promise<boolean> {
  const rows = await connectionQueryRows<IndexRow[]>(
    connection,
    `SELECT INDEX_NAME AS index_name
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  return rows.length > 0;
}

async function ensureColumn(
  connection: PoolConnection,
  tableName: string,
  columnName: string,
  definition: string
): Promise<void> {
  if (!(await columnExists(connection, tableName, columnName))) {
    await connection.query(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

async function ensureIndex(
  connection: PoolConnection,
  tableName: string,
  indexName: string,
  definition: string
): Promise<void> {
  if (!(await indexExists(connection, tableName, indexName))) {
    await connection.query(`CREATE INDEX ${indexName} ON ${tableName} ${definition}`);
  }
}

async function ensureSchemaMigrationsTable(connection: PoolConnection): Promise<void> {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id         VARCHAR(128) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function isMigrationApplied(connection: PoolConnection, migrationId: string): Promise<boolean> {
  const rows = await connectionQueryRows<MigrationRow[]>(
    connection,
    'SELECT id FROM schema_migrations WHERE id = ? LIMIT 1',
    [migrationId]
  );
  return rows.length > 0;
}

async function recordMigration(connection: PoolConnection, migration: SchemaMigration): Promise<void> {
  await connection.query(
    `INSERT INTO schema_migrations (id)
     VALUES (?)
     ON DUPLICATE KEY UPDATE applied_at = applied_at`,
    [migration.id]
  );
}

async function ensureTaskV3Columns(connection: PoolConnection): Promise<void> {
  await ensureColumn(
    connection,
    'tasks',
    'provider_id',
    "provider_id VARCHAR(32) NOT NULL DEFAULT 'tripo3d' COMMENT '服务提供商标识符' AFTER user_id"
  );
  await ensureColumn(
    connection,
    'tasks',
    'power_cost',
    "power_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '实际消耗 power（= credit_cost / CREDITS_PER_POWER）' AFTER credit_cost"
  );
  await ensureColumn(
    connection,
    'tasks',
    'file_size',
    "file_size BIGINT UNSIGNED NULL COMMENT '模型文件大小（字节）' AFTER power_cost"
  );
  await ensureColumn(
    connection,
    'tasks',
    'thumbnail_url',
    "thumbnail_url TEXT NULL COMMENT 'Provider 输出缩略图 URL' AFTER output_url"
  );
  await ensureColumn(
    connection,
    'tasks',
    'provider_status_key',
    "provider_status_key VARCHAR(1024) NULL COMMENT 'Provider 轮询任务键，若为空则回退到 task_id' AFTER thumbnail_url"
  );
  await ensureColumn(
    connection,
    'tasks',
    'resource_id',
    "resource_id INT UNSIGNED NULL COMMENT '主系统 Resource 资产 ID（上传后填写）' AFTER provider_status_key"
  );
  await ensureColumn(
    connection,
    'tasks',
    'expires_at',
    "expires_at DATETIME NULL COMMENT '任务输出 URL 过期时间（UTC）' AFTER completed_at"
  );

  await connection.query(
    `ALTER TABLE tasks
     MODIFY COLUMN output_url TEXT COMMENT 'Provider 输出 GLB URL'`
  );
  await connection.query(
    `ALTER TABLE tasks
     MODIFY COLUMN credit_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '实际消耗 credits'`
  );
  await connection.query(
    `ALTER TABLE credit_usage
     MODIFY COLUMN credits_used DECIMAL(12,2) NOT NULL DEFAULT 0.00`
  );

  await ensureIndex(connection, 'tasks', 'idx_provider_id', '(provider_id)');
  await ensureIndex(connection, 'tasks', 'idx_expires_at', '(expires_at)');

  await connection.query(
    `UPDATE tasks
     SET credit_cost = ROUND(power_cost / 0.04776, 2)
     WHERE provider_id = 'tripo3d'
       AND status = 'success'
       AND power_cost > 0
       AND credit_cost = 0`
  );
  await connection.query(
    `UPDATE tasks
     SET credit_cost = ROUND(power_cost / 1.9176, 2)
     WHERE provider_id = 'hyper3d'
       AND status = 'success'
       AND power_cost > 0
       AND credit_cost = 0`
  );
  await connection.query(
    `UPDATE tasks
     SET credit_cost = 30.00,
         power_cost = 1.43
     WHERE provider_id = 'tripo3d'
       AND status = 'success'
       AND credit_cost = 0
       AND power_cost = 0`
  );
  await connection.query(
    `UPDATE tasks
     SET credit_cost = 0.50,
         power_cost = 0.96
     WHERE provider_id = 'hyper3d'
       AND status = 'success'
       AND credit_cost = 0
       AND power_cost = 0`
  );
}

async function ensureDirectApiDefaults(connection: PoolConnection): Promise<void> {
  await connection.query(
    `INSERT INTO system_config (\`key\`, \`value\`)
     VALUES
       ('api_mode', 'direct'),
       ('prepare_timeout_minutes', '15')
     ON DUPLICATE KEY UPDATE \`value\` = \`value\``
  );
}

async function ensureSimpleUserUsageQuotaSchema(connection: PoolConnection): Promise<void> {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS quota_user_usage (
      user_id     INT UNSIGNED NOT NULL PRIMARY KEY COMMENT '主系统用户 ID',
      used_power  DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '累计已使用 power',
      user_snapshot JSON NULL COMMENT '使用时记录的主系统用户快照',
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_quota_user_usage_updated_at (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await ensureColumn(
    connection,
    'quota_user_usage',
    'user_snapshot',
    "user_snapshot JSON NULL COMMENT '使用时记录的主系统用户快照' AFTER used_power"
  );
  await ensureIndex(connection, 'quota_user_usage', 'idx_quota_user_usage_updated_at', '(updated_at)');

  await connection.query(
    `CREATE TABLE IF NOT EXISTS quota_usage_ledger (
      id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id              INT UNSIGNED NOT NULL COMMENT '主系统用户 ID',
      event_type           ENUM('pre_deduct', 'refund', 'confirm_deduct', 'admin_reset') NOT NULL,
      power_delta          DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '本次对 used_power 的增减',
      used_power_after     DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '事件后的累计已用 power',
      task_id              VARCHAR(64) COMMENT '关联任务 ID',
      provider_id          VARCHAR(32) COMMENT '关联 provider_id',
      provider_credit_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Provider 原始 credits 消耗',
      power_cost           DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '内部统一 power 消耗',
      note                 VARCHAR(256),
      created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_quota_usage_ledger_user_id (user_id),
      INDEX idx_quota_usage_ledger_task_id (task_id),
      INDEX idx_quota_usage_ledger_provider_user (provider_id, user_id),
      INDEX idx_quota_usage_ledger_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await ensureIndex(connection, 'quota_usage_ledger', 'idx_quota_usage_ledger_user_id', '(user_id)');
  await ensureIndex(connection, 'quota_usage_ledger', 'idx_quota_usage_ledger_task_id', '(task_id)');
  await ensureIndex(connection, 'quota_usage_ledger', 'idx_quota_usage_ledger_provider_user', '(provider_id, user_id)');
  await ensureIndex(connection, 'quota_usage_ledger', 'idx_quota_usage_ledger_created_at', '(created_at)');

  await connection.query(
    `INSERT INTO system_config (\`key\`, \`value\`)
     VALUES ('quota.default_limit_power', '0')
     ON DUPLICATE KEY UPDATE \`value\` = \`value\``
  );

  const retiredTables = [
    'site_power_jobs',
    'site_power_ledger',
    'site_power_accounts',
    'power_jobs',
    'power_ledger',
    'power_accounts',
    'quota_jobs',
    'credit_ledger',
    'user_accounts',
  ];
  for (const tableName of retiredTables) {
    if (await tableExists(connection, tableName)) {
      await connection.query(`DROP TABLE IF EXISTS ${tableName}`);
    }
  }
}

async function ensureUnifiedProviderQueueSchema(connection: PoolConnection): Promise<void> {
  await connection.query("ALTER TABLE tasks MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'waiting_provider'");

  const taskColumns: Array<[string, string]> = [
    ['provider_task_id', "provider_task_id VARCHAR(128) NULL COMMENT '供应商任务 ID' AFTER task_id"],
    ['request_payload', "request_payload LONGTEXT NULL COMMENT '待派发供应商请求 JSON' AFTER provider_status_key"],
    ['credential_scope', "credential_scope VARCHAR(64) NOT NULL DEFAULT 'default' AFTER provider_id"],
    ['priority', 'priority INT NOT NULL DEFAULT 0 AFTER credential_scope'],
    ['queue_entered_at', 'queue_entered_at DATETIME NULL AFTER priority'],
    ['next_attempt_at', 'next_attempt_at DATETIME NULL AFTER queue_entered_at'],
    ['attempt_count', 'attempt_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER next_attempt_at'],
    ['lease_owner', 'lease_owner VARCHAR(128) NULL AFTER attempt_count'],
    ['lease_expires_at', 'lease_expires_at DATETIME NULL AFTER lease_owner'],
    ['provider_slot_acquired_at', 'provider_slot_acquired_at DATETIME NULL AFTER lease_expires_at'],
    ['provider_slot_released_at', 'provider_slot_released_at DATETIME NULL AFTER provider_slot_acquired_at'],
    ['provider_error_category', 'provider_error_category VARCHAR(32) NULL AFTER provider_slot_released_at'],
    ['provider_error_code', 'provider_error_code VARCHAR(64) NULL AFTER provider_error_category'],
    ['provider_trace_id', 'provider_trace_id VARCHAR(128) NULL AFTER provider_error_code'],
    ['retry_after_seconds', 'retry_after_seconds INT UNSIGNED NULL AFTER provider_trace_id'],
    ['quota_epoch', 'quota_epoch INT UNSIGNED NOT NULL DEFAULT 1 AFTER retry_after_seconds'],
    ['reserved_power', 'reserved_power DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER quota_epoch'],
    ['cancellation_reason', 'cancellation_reason VARCHAR(256) NULL AFTER reserved_power'],
  ];
  for (const [name, definition] of taskColumns) {
    await ensureColumn(connection, 'tasks', name, definition);
  }

  await ensureColumn(
    connection,
    'quota_user_usage',
    'quota_epoch',
    "quota_epoch INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '当前额度周期' AFTER user_id"
  );
  await ensureColumn(
    connection,
    'quota_usage_ledger',
    'quota_epoch',
    "quota_epoch INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '额度周期' AFTER user_id"
  );

  await ensureIndex(
    connection,
    'tasks',
    'idx_provider_queue',
    '(provider_id, credential_scope, status, next_attempt_at, priority, queue_entered_at)'
  );
  await ensureIndex(
    connection,
    'tasks',
    'idx_provider_slots',
    '(provider_id, credential_scope, provider_slot_released_at, status)'
  );
  await ensureIndex(connection, 'tasks', 'idx_lease_expires', '(lease_expires_at)');

  await connection.query(
    `CREATE TABLE IF NOT EXISTS provider_runtime_config (
      provider_id VARCHAR(32) NOT NULL,
      credential_scope VARCHAR(64) NOT NULL DEFAULT 'default',
      max_concurrency INT UNSIGNED NOT NULL,
      paused TINYINT(1) NOT NULL DEFAULT 0,
      pause_reason VARCHAR(256) NULL,
      poll_interval_seconds INT UNSIGNED NOT NULL DEFAULT 3,
      retry_limit INT UNSIGNED NOT NULL DEFAULT 6,
      config_version INT UNSIGNED NOT NULL DEFAULT 1,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (provider_id, credential_scope)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  await connection.query(
    `INSERT INTO provider_runtime_config (provider_id, credential_scope, max_concurrency)
     VALUES ('tripo3d', 'default', 4), ('hyper3d', 'default', 1)
     ON DUPLICATE KEY UPDATE provider_id = provider_id`
  );

  await connection.query(
    `CREATE TABLE IF NOT EXISTS provider_task_events (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      task_id VARCHAR(64) NOT NULL,
      provider_id VARCHAR(32) NOT NULL,
      event_type VARCHAR(64) NOT NULL,
      from_status VARCHAR(32) NULL,
      to_status VARCHAR(32) NULL,
      attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
      trace_id VARCHAR(128) NULL,
      detail_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_provider_task_events_task (task_id, created_at),
      INDEX idx_provider_task_events_provider (provider_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await connection.query(
    `UPDATE tasks
     SET provider_task_id = task_id,
         queue_entered_at = COALESCE(queue_entered_at, created_at),
         provider_slot_acquired_at = COALESCE(provider_slot_acquired_at, created_at)
     WHERE provider_task_id IS NULL
       AND status IN ('queued', 'processing', 'success', 'failed', 'timeout')`
  );
  await connection.query(
    `UPDATE tasks
     SET provider_slot_released_at = COALESCE(provider_slot_released_at, completed_at, NOW())
     WHERE provider_slot_released_at IS NULL
       AND status IN ('success', 'failed', 'timeout', 'cancelled')`
  );
}

async function ensureP1AdminObservabilitySchema(connection: PoolConnection): Promise<void> {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      actor_id INT UNSIGNED NULL,
      action VARCHAR(64) NOT NULL,
      target_type VARCHAR(64) NOT NULL,
      target_id VARCHAR(128) NULL,
      before_json JSON NULL,
      after_json JSON NULL,
      detail_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_admin_audit_logs_created_at (created_at),
      INDEX idx_admin_audit_logs_target (target_type, target_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function ensureP2QueueAdmissionContentionSchema(connection: PoolConnection): Promise<void> {
  // Keep the per-user admission check on a narrow index. Without this index a
  // classroom burst can contend on broad task ranges before any provider call.
  await ensureIndex(
    connection,
    'tasks',
    'idx_user_provider_outstanding',
    '(user_id, provider_id, status)'
  );
}

export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  {
    id: '20260428_direct_api_defaults',
    description: 'Add direct API default system configuration',
    up: ensureDirectApiDefaults,
  },
  {
    id: '20260520_tasks_v3_columns',
    description: 'Upgrade tasks and credit usage tables to the V3 provider/power schema',
    up: ensureTaskV3Columns,
  },
  {
    id: '20260521_simple_user_usage_quota',
    description: 'Create per-user quota tables and retire wallet/pool quota tables',
    up: ensureSimpleUserUsageQuotaSchema,
  },
  {
    id: '20260714_ai3d_unified_provider_queue',
    description: 'Add persistent provider queue, runtime concurrency controls, and quota epochs',
    up: ensureUnifiedProviderQueueSchema,
  },
  {
    id: '20260714_ai3d_p1_admin_observability',
    description: 'Add admin audit storage for provider queue operations and diagnostics',
    up: ensureP1AdminObservabilitySchema,
  },
  {
    id: '20260714_ai3d_p2_queue_admission_contention',
    description: 'Add a narrow index for concurrent per-user queue admission',
    up: ensureP2QueueAdmissionContentionSchema,
  },
] as const;

export async function runKnownSchemaMigrations(): Promise<number> {
  const connection = await pool.getConnection();
  let appliedCount = 0;

  try {
    await ensureSchemaMigrationsTable(connection);

    for (const migration of SCHEMA_MIGRATIONS) {
      if (await isMigrationApplied(connection, migration.id)) {
        continue;
      }
      await migration.up(connection);
      await recordMigration(connection, migration);
      appliedCount += 1;
      console.log(`[DB] 已应用迁移: ${migration.id} - ${migration.description}`);
    }
  } finally {
    connection.release();
  }

  return appliedCount;
}

export async function ensureSchemaReady(env: NodeJS.ProcessEnv = process.env): Promise<SchemaStatus> {
  let status = await inspectSchema(false);
  const baseMissingTables = status.missingTables.filter((table) =>
    (BASE_REQUIRED_TABLES as readonly string[]).includes(table)
  );

  if (baseMissingTables.length > 0 && isAutoInitSchemaEnabled(env)) {
    await runInitSchema();
    status = await inspectSchema(true);
  }

  const remainingBaseMissingTables = status.missingTables.filter((table) =>
    (BASE_REQUIRED_TABLES as readonly string[]).includes(table)
  );
  if (remainingBaseMissingTables.length > 0) {
    throw new SchemaHealthError(status);
  }

  if (isAutoMigrateSchemaEnabled(env)) {
    const appliedMigrations = await runKnownSchemaMigrations();
    if (appliedMigrations > 0 || status.missingTables.length > 0 || status.missingColumns.length > 0) {
      status = await inspectSchema(status.autoInitialized || appliedMigrations > 0);
    }
  }

  if (status.missingTables.length === 0 && status.missingColumns.length === 0) {
    return status;
  }

  throw new SchemaHealthError(status);
}
