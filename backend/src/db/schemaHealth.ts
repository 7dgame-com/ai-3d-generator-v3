import fs from 'node:fs';
import path from 'node:path';
import { pool, query } from './connection';

export const REQUIRED_TABLES = [
  'tasks',
  'credit_usage',
  'system_config',
  'user_accounts',
  'credit_ledger',
  'quota_jobs',
  'power_accounts',
  'power_ledger',
  'power_jobs',
  'site_power_accounts',
  'site_power_ledger',
  'site_power_jobs',
] as const;

export interface SchemaStatus {
  database: string | null;
  tableCount: number;
  existingTables: string[];
  missingTables: string[];
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
        : `数据库 schema 缺少表: ${status.missingTables.join(', ')}`
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

function isDisabled(value: string | undefined): boolean {
  return value !== undefined && ['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

export function isAutoInitSchemaEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isDisabled(env.AUTO_INIT_SCHEMA ?? env.AUTO_MIGRATE);
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

  return {
    database,
    tableCount: existingTables.length,
    existingTables,
    missingTables,
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

export async function ensureSchemaReady(env: NodeJS.ProcessEnv = process.env): Promise<SchemaStatus> {
  let status = await inspectSchema(false);

  if (status.missingTables.length === 0) {
    return status;
  }

  if (status.tableCount === 0 && isAutoInitSchemaEnabled(env)) {
    await runInitSchema();
    status = await inspectSchema(true);
    if (status.missingTables.length === 0) {
      return status;
    }
  }

  throw new SchemaHealthError(status);
}
