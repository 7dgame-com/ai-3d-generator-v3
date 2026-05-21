import {
  REQUIRED_TABLES,
  SchemaHealthError,
  ensureSchemaReady,
  isAutoInitSchemaEnabled,
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
      .mockResolvedValueOnce(REQUIRED_TABLES.map((table) => ({ table_name: table })));

    const status = await ensureSchemaReady({});

    expect(status.autoInitialized).toBe(true);
    expect(status.missingTables).toEqual([]);
    expect(mockGetConnection).toHaveBeenCalledTimes(1);
    expect(mockConnectionQuery).toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('fails partial schemas instead of blindly running the full init schema', async () => {
    mockQuery
      .mockResolvedValueOnce([{ db: 'ai_3d_generator_v3' }])
      .mockResolvedValueOnce([{ table_name: 'tasks' }]);

    await expect(ensureSchemaReady({})).rejects.toThrow(SchemaHealthError);
    expect(mockGetConnection).not.toHaveBeenCalled();
  });

  it('allows auto init to be disabled explicitly', () => {
    expect(isAutoInitSchemaEnabled({ AUTO_INIT_SCHEMA: 'false' })).toBe(false);
    expect(isAutoInitSchemaEnabled({ AUTO_MIGRATE: '0' })).toBe(false);
    expect(isAutoInitSchemaEnabled({})).toBe(true);
  });
});
