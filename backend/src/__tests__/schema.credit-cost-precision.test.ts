import fs from 'node:fs';
import path from 'node:path';

function readDbFile(fileName: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', 'db', fileName), 'utf8');
}

describe('database credit cost precision', () => {
  it('stores tasks.credit_cost as a decimal to support fractional provider credits', () => {
    const schema = readDbFile('schema.sql');

    expect(schema).toContain('credit_cost   DECIMAL(12,2) NOT NULL DEFAULT 0.00');
    expect(schema).toContain('power_cost    DECIMAL(12,2) NOT NULL DEFAULT 0.00');
  });

  it('includes a migration that upgrades existing credit_cost columns to decimal precision', () => {
    const migration = readDbFile('migrate_credit_cost_decimal.sql');

    expect(migration).toContain('ALTER TABLE tasks');
    expect(migration).toContain('MODIFY COLUMN credit_cost DECIMAL(12,2)');
  });

  it('defines simple per-user usage quota tables in schema.sql', () => {
    const schema = readDbFile('schema.sql');

    expect(schema).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS quota_user_usage');
    expect(schema).toContain('used_power  DECIMAL(12,2) NOT NULL DEFAULT 0.00');
    expect(schema).toContain('user_snapshot JSON NULL');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS quota_usage_ledger');
    expect(schema).toContain("event_type           ENUM('pre_deduct', 'refund', 'confirm_deduct', 'admin_reset')");
  });

  it('includes a migration that creates simple quota tables and drops retired quota tables', () => {
    const migration = readDbFile('migrate_simple_user_usage_quota.sql');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS quota_user_usage');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
    expect(migration).toContain('user_snapshot JSON NULL');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS quota_usage_ledger');
    expect(migration).toContain('20260521_simple_user_usage_quota');
    expect(migration).toContain("('quota.default_limit_power', '0')");
    expect(migration).toContain('DROP TABLE IF EXISTS site_power_accounts');
    expect(migration).toContain('DROP TABLE IF EXISTS power_accounts');
    expect(migration).toContain('DROP TABLE IF EXISTS quota_jobs');
    expect(migration).toContain('DROP TABLE IF EXISTS credit_ledger');
    expect(migration).toContain('DROP TABLE IF EXISTS user_accounts');
  });
});
