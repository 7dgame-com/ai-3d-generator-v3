import {
  REQUIRED_TABLES,
  SCHEMA_MIGRATIONS,
  SchemaHealthError,
  ensureSchemaReady,
  isAutoInitSchemaEnabled,
  isAutoMigrateSchemaEnabled,
  runKnownSchemaMigrations,
  splitSqlStatements,
} from '../db/schemaHealth';

const mockQuery = jest.fn();
const mockConnectionQuery = jest.fn();
const mockRelease = jest.fn();
const mockGetConnection = jest.fn();

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  pool: {
    getConnection: () => mockGetConnection(),
  },
}));

describe('schema health checks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnection.mockResolvedValue({
      query: (...args: unknown[]) => mockConnectionQuery(...args),
      release: mockRelease,
    });
    mockConnectionQuery.mockResolvedValue([]);
  });

  it('keeps SQL statements intact when splitting the init schema', () => {
    const statements = splitSqlStatements(`
      CREATE TABLE example (
        id INT PRIMARY KEY,
        status ENUM('queued', 'success') NOT NULL
      );
      INSERT INTO example VALUES (1, 'queued;still-string');
    `);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("ENUM('queued', 'success')");
    expect(statements[1]).toContain("'queued;still-string'");
  });

  it('auto initializes an empty plugin database', async () => {
    mockQuery
      .mockResolvedValueOnce([{ db: 'ai_3d_generator_v3' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ db: 'ai_3d_generator_v3' }])
      .mockResolvedValueOnce(REQUIRED_TABLES.map((table) => ({ table_name: table })))
      .mockResolvedValueOnce([{ db: 'ai_3d_generator_v3' }])
      .mockResolvedValueOnce(REQUIRED_TABLES.map((table) => ({ table_name: table })));

    const status = await ensureSchemaReady({});

    expect(status.autoInitialized).toBe(true);
    expect(status.missingTables).toEqual([]);
    expect(mockGetConnection).toHaveBeenCalledTimes(2);
    expect(mockConnectionQuery).toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(2);
  });

  it('auto initializes missing tables in an existing plugin database', async () => {
    mockQuery
      .mockResolvedValueOnce([{ db: 'ai_3d_generator_v3' }])
      .mockResolvedValueOnce([{ table_name: 'tasks' }])
      .mockResolvedValueOnce([{ db: 'ai_3d_generator_v3' }])
      .mockResolvedValueOnce(REQUIRED_TABLES.map((table) => ({ table_name: table })))
      .mockResolvedValueOnce([{ db: 'ai_3d_generator_v3' }])
      .mockResolvedValueOnce(REQUIRED_TABLES.map((table) => ({ table_name: table })));

    const status = await ensureSchemaReady({});

    expect(status.autoInitialized).toBe(true);
    expect(status.missingTables).toEqual([]);
    expect(mockGetConnection).toHaveBeenCalledTimes(2);
  });

  it('runs V3 schema migrations on already initialized databases', async () => {
    mockQuery
      .mockResolvedValueOnce([{ db: 'ai_3d_generator_v3' }])
      .mockResolvedValueOnce(REQUIRED_TABLES.map((table) => ({ table_name: table })))
      .mockResolvedValueOnce([{ db: 'ai_3d_generator_v3' }])
      .mockResolvedValueOnce(REQUIRED_TABLES.map((table) => ({ table_name: table })));

    const status = await ensureSchemaReady({});

    expect(status.autoInitialized).toBe(true);
    expect(mockGetConnection).toHaveBeenCalledTimes(1);
    expect(mockConnectionQuery.mock.calls.some((call) => String(call[0]).includes('CREATE TABLE IF NOT EXISTS schema_migrations'))).toBe(true);
    expect(mockConnectionQuery.mock.calls.some((call) => String(call[0]).includes('ALTER TABLE quota_user_usage'))).toBe(true);
    expect(mockConnectionQuery.mock.calls.some((call) => String(call[0]).includes('INSERT INTO schema_migrations'))).toBe(true);
  });

  it('runs migrations when full schema init is disabled but base tables already exist', async () => {
    const baseTables = ['tasks', 'credit_usage', 'system_config'];
    mockQuery
      .mockResolvedValueOnce([{ db: 'ai_3d_generator_v3' }])
      .mockResolvedValueOnce(baseTables.map((table) => ({ table_name: table })))
      .mockResolvedValueOnce([{ db: 'ai_3d_generator_v3' }])
      .mockResolvedValueOnce(REQUIRED_TABLES.map((table) => ({ table_name: table })));

    const status = await ensureSchemaReady({ AUTO_INIT_SCHEMA: 'false' });

    expect(status.autoInitialized).toBe(true);
    expect(status.missingTables).toEqual([]);
    expect(mockGetConnection).toHaveBeenCalledTimes(1);
    expect(mockConnectionQuery.mock.calls.some((call) => String(call[0]).includes('CREATE TABLE IF NOT EXISTS schema_migrations'))).toBe(true);
    expect(mockConnectionQuery.mock.calls.some((call) => String(call[0]).includes('INSERT INTO schema_migrations'))).toBe(true);
  });

  it('skips recorded migrations during startup migration checks', async () => {
    mockConnectionQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT id FROM schema_migrations')) {
        return Promise.resolve([{ id: 'already-applied' }]);
      }
      return Promise.resolve([]);
    });

    const appliedCount = await runKnownSchemaMigrations();

    expect(appliedCount).toBe(0);
    expect(mockConnectionQuery.mock.calls.some((call) => String(call[0]).includes('CREATE TABLE IF NOT EXISTS schema_migrations'))).toBe(true);
    expect(mockConnectionQuery.mock.calls.some((call) => String(call[0]).includes('ALTER TABLE tasks'))).toBe(false);
    expect(SCHEMA_MIGRATIONS.length).toBeGreaterThan(0);
  });

  it('fails partial schemas when auto init is disabled', async () => {
    mockQuery
      .mockResolvedValueOnce([{ db: 'ai_3d_generator_v3' }])
      .mockResolvedValueOnce([{ table_name: 'tasks' }]);

    await expect(ensureSchemaReady({ AUTO_INIT_SCHEMA: 'false' })).rejects.toThrow(SchemaHealthError);
    expect(mockGetConnection).not.toHaveBeenCalled();
  });

  it('allows auto init to be disabled explicitly', () => {
    expect(isAutoInitSchemaEnabled({ AUTO_INIT_SCHEMA: 'false' })).toBe(false);
    expect(isAutoInitSchemaEnabled({ AUTO_MIGRATE: '0' })).toBe(true);
    expect(isAutoInitSchemaEnabled({})).toBe(true);
    expect(isAutoMigrateSchemaEnabled({ AUTO_INIT_SCHEMA: 'false' })).toBe(true);
    expect(isAutoMigrateSchemaEnabled({ AUTO_MIGRATE: '0' })).toBe(false);
    expect(isAutoMigrateSchemaEnabled({})).toBe(true);
  });
});
