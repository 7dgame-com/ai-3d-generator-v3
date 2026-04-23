import fs from 'node:fs';
import path from 'node:path';

describe('driver ai-3d-generator-v3 init schema', () => {
  const pluginSchemaPath = path.resolve(__dirname, '..', 'db', 'schema.sql');
  const repoInitSchemaPath = path.resolve(__dirname, '..', 'db', 'init-schema.sql');
  const driverInitSchemaPath = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'driver',
    'ai-3d-generator-v3-schema.sql'
  );
  const initSchemaCandidates = [driverInitSchemaPath, repoInitSchemaPath];

  function resolveInitSchemaPath(candidates = initSchemaCandidates): string {
    const initSchemaPath = candidates.find((candidate) => fs.existsSync(candidate));

    if (!initSchemaPath) {
      throw new Error(`Missing ai_3d_generator_v3 init schema. Checked:\n${candidates.join('\n')}`);
    }

    return initSchemaPath;
  }

  it('ships an init SQL inside the standalone plugin repository', () => {
    expect(fs.existsSync(repoInitSchemaPath)).toBe(true);
  });

  it('uses the repo-local init SQL when the root driver copy is unavailable', () => {
    const missingDriverPath = path.resolve(__dirname, '..', '..', '..', 'tmp', 'missing-driver.sql');

    expect(resolveInitSchemaPath([missingDriverPath, repoInitSchemaPath])).toBe(repoInitSchemaPath);
  });

  it('wraps the plugin schema with database bootstrap statements', () => {
    const pluginSchema = fs.readFileSync(pluginSchemaPath, 'utf8').trim();
    const initSchemaPath = resolveInitSchemaPath();
    const initSchema = fs.readFileSync(initSchemaPath, 'utf8');

    expect(initSchema).toContain("CREATE DATABASE IF NOT EXISTS `ai_3d_generator_v3`");
    expect(initSchema).toContain("USE `ai_3d_generator_v3`;");
    expect(initSchema).toContain(pluginSchema);
  });
});
