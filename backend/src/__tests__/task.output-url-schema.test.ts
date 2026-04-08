import fs from 'node:fs';
import path from 'node:path';

describe('tasks.output_url persistence capacity', () => {
  const dbDir = path.resolve(__dirname, '../db');

  it('schema.sql stores task output URLs in a wide-enough column', () => {
    const schema = fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf8');

    expect(schema).toMatch(/output_url\s+TEXT\b/i);
  });

  it('ships a migration that widens existing tasks.output_url columns', () => {
    const migrationPath = path.join(dbDir, 'migrate_expand_task_output_url.sql');

    expect(fs.existsSync(migrationPath)).toBe(true);

    const migration = fs.readFileSync(migrationPath, 'utf8');
    expect(migration).toMatch(/ALTER\s+TABLE\s+tasks/i);
    expect(migration).toMatch(/MODIFY\s+COLUMN\s+output_url\s+TEXT\b/i);
  });
});
