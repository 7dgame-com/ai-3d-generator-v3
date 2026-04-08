import fs from 'fs';
import path from 'path';

describe('tasks.thumbnail_url persistence schema', () => {
  const dbDir = path.join(__dirname, '..', 'db');

  it('defines thumbnail_url as a nullable TEXT column in schema.sql', () => {
    const schema = fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf8');

    expect(schema).toMatch(/thumbnail_url\s+TEXT\b/i);
  });

  it('ships a migration that adds thumbnail_url to existing tasks tables', () => {
    const migrationPath = path.join(dbDir, 'migrate_add_task_thumbnail_url.sql');

    expect(fs.existsSync(migrationPath)).toBe(true);

    const migration = fs.readFileSync(migrationPath, 'utf8');
    expect(migration).toMatch(/ALTER\s+TABLE\s+tasks/i);
    expect(migration).toMatch(/ADD\s+COLUMN\s+thumbnail_url\s+TEXT\b/i);
  });
});
