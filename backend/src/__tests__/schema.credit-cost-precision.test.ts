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

  it('defines the new global power account tables in schema.sql', () => {
    const schema = readDbFile('schema.sql');

    expect(schema).toContain('CREATE TABLE power_accounts');
    expect(schema).toContain('CREATE TABLE power_ledger');
    expect(schema).toContain('CREATE TABLE power_jobs');
  });

  it('includes a migration that backfills task power_cost and creates global account tables', () => {
    const migration = readDbFile('migrate_global_power_accounts.sql');

    expect(migration).toContain('ALTER TABLE tasks');
    expect(migration).toContain("WHEN 'tripo3d' THEN credit_cost / 30");
    expect(migration).toContain("WHEN 'hyper3d' THEN credit_cost / 0.5");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS power_accounts');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS power_ledger');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS power_jobs');
  });

  it('defines dedicated site power tables in schema.sql', () => {
    const schema = readDbFile('schema.sql');

    expect(schema).toContain('CREATE TABLE site_power_accounts');
    expect(schema).toContain('CREATE TABLE site_power_ledger');
    expect(schema).toContain('CREATE TABLE site_power_jobs');
  });

  it('includes a migration that creates dedicated site power tables', () => {
    const migration = readDbFile('migrate_site_power.sql');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS site_power_accounts');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS site_power_ledger');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS site_power_jobs');
  });
});
