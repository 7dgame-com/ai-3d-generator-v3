import fs from 'node:fs';
import path from 'node:path';

describe('driver ai-3d-generator-v3 init schema', () => {
  const pluginSchemaPath = path.resolve(__dirname, '..', 'db', 'schema.sql');
  const initSchemaPath = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'driver',
    'ai-3d-generator-v3-schema.sql'
  );

  it('ships a standalone root-level init SQL for ai_3d_generator_v3', () => {
    expect(fs.existsSync(initSchemaPath)).toBe(true);
  });

  it('wraps the plugin schema with database bootstrap statements', () => {
    const pluginSchema = fs.readFileSync(pluginSchemaPath, 'utf8').trim();
    const initSchema = fs.readFileSync(initSchemaPath, 'utf8');

    expect(initSchema).toContain("CREATE DATABASE IF NOT EXISTS `ai_3d_generator_v3`");
    expect(initSchema).toContain("USE `ai_3d_generator_v3`;");
    expect(initSchema).toContain(pluginSchema);
  });
});
