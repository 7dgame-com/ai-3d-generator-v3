import { createHash } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/connection';
import type {
  ConfirmDeductResult,
  QuotaReserveResult,
  QuotaOrganizationScope,
  QuotaOrganizationSummary,
  QuotaStatus,
  QuotaSummary,
  QuotaTool,
  QuotaToolId,
  QuotaUsageListParams,
  QuotaUsageListResult,
  QuotaUserSnapshot,
} from './quotaTool';

const CONFIG_KEY_DEFAULT_LIMIT = 'quota.default_limit_power';
const CONFIG_KEY_ORGANIZATION_LIMIT_PREFIX = `${CONFIG_KEY_DEFAULT_LIMIT}.org.`;
const TOOL_ID: QuotaToolId = 'simple-user-usage-quota';

interface ConfigValueRow extends RowDataPacket {
  key: string;
  value: string | number | null;
}

interface UsageRow extends RowDataPacket {
  user_id: number;
  used_power: string | number;
  updated_at: Date | null;
  user_snapshot?: string | QuotaUserSnapshot | null;
}

interface LedgerAmountRow extends RowDataPacket {
  amount: string | number | null;
}

interface CountRow extends RowDataPacket {
  total: string | number;
}

interface TaskRowForBilling extends RowDataPacket {
  status: string;
  error_message: string | null;
}

export class QuotaScopeMismatchError extends Error {
  status = 403;
  code = 'QUOTA_SCOPE_MISMATCH';

  constructor(message = '目标账号不在当前组织或缺少组织快照') {
    super(message);
    this.name = 'QuotaScopeMismatchError';
  }
}

export class QuotaTargetRoleNotAllowedError extends Error {
  status = 422;
  code = 'QUOTA_TARGET_ROLE_NOT_ALLOWED';

  constructor(message = '只能重置普通学员账号') {
    super(message);
    this.name = 'QuotaTargetRoleNotAllowedError';
  }
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundPower(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeLimit(value: unknown): number {
  const parsed = toNumber(value);
  return parsed > 0 ? roundPower(parsed) : 0;
}

function normalizePage(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function normalizePageSize(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(100, parsed) : 20;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeOptionalNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return normalizeOptionalString(value);
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeComparableText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeOrganizationScope(scope?: QuotaOrganizationScope | null): QuotaOrganizationScope | null {
  if (!scope) {
    return null;
  }

  const id = normalizePositiveInteger(scope.id);
  const name = normalizeOptionalString(scope.name);
  if (id === undefined && !name) {
    return null;
  }

  return {
    ...(id !== undefined ? { id } : {}),
    ...(name ? { name } : {}),
  };
}

function normalizeOrganizationSummary(value: unknown): QuotaOrganizationSummary | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const id = normalizePositiveInteger(raw.id);
  const name = normalizeOptionalString(raw.name);
  const title = normalizeOptionalString(raw.title);
  if (id === undefined && !name && !title) {
    return null;
  }

  return {
    ...(id !== undefined ? { id } : {}),
    ...(name ? { name } : {}),
    ...(title ? { title } : {}),
  };
}

function normalizeOrganizations(value: unknown): QuotaOrganizationSummary[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const organizations = value
    .map(normalizeOrganizationSummary)
    .filter((organization): organization is QuotaOrganizationSummary => organization !== null);

  return organizations.length > 0 ? organizations : undefined;
}

function organizationMatchesScope(
  organization: QuotaOrganizationSummary,
  scope: QuotaOrganizationScope
): boolean {
  const expectedId = normalizePositiveInteger(scope.id);
  const actualId = normalizePositiveInteger(organization.id);
  if (expectedId !== undefined && actualId === expectedId) {
    return true;
  }

  const expectedName = normalizeComparableText(scope.name);
  if (!expectedName) {
    return false;
  }

  return normalizeComparableText(organization.name) === expectedName
    || normalizeComparableText(organization.title) === expectedName;
}

function snapshotBelongsToOrganization(
  snapshot: QuotaUserSnapshot | null,
  scope: QuotaOrganizationScope | null
): boolean {
  if (!scope) {
    return true;
  }

  return Array.isArray(snapshot?.organizations)
    && snapshot.organizations.some((organization) => organizationMatchesScope(organization, scope));
}

function isLearnerSnapshot(snapshot: QuotaUserSnapshot | null): boolean {
  const roles = Array.isArray(snapshot?.roles) ? snapshot.roles : [];
  if (!roles.includes('user')) {
    return false;
  }

  return !roles.some((role) => role === 'root' || role === 'admin' || role === 'manager');
}

function usageRowMatchesSearch(row: UsageRow, search: string): boolean {
  if (!search) {
    return true;
  }

  const snapshot = parseUserSnapshot(row.user_snapshot);
  const fields = [
    String(row.user_id),
    snapshot?.username ?? '',
    snapshot?.nickname ?? '',
    snapshot?.email ?? '',
  ];

  return fields.some((field) => normalizeComparableText(field).includes(search));
}

function usageRowUpdatedAtMs(row: UsageRow): number {
  const value = row.updated_at;
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(', ');
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)));
}

function organizationIdLimitKey(id: unknown): string | null {
  const normalizedId = normalizePositiveInteger(id);
  return normalizedId === undefined ? null : `${CONFIG_KEY_ORGANIZATION_LIMIT_PREFIX}id.${normalizedId}`;
}

function organizationNameLimitKey(name: unknown): string | null {
  const normalizedName = normalizeComparableText(name);
  if (!normalizedName) {
    return null;
  }

  const digest = createHash('sha1').update(normalizedName).digest('hex').slice(0, 16);
  return `${CONFIG_KEY_ORGANIZATION_LIMIT_PREFIX}name.${digest}`;
}

function organizationLimitKeysForScope(scope?: QuotaOrganizationScope | null): string[] {
  const normalizedScope = normalizeOrganizationScope(scope);
  if (!normalizedScope) {
    return [];
  }

  return uniqueStrings([
    organizationIdLimitKey(normalizedScope.id),
    organizationNameLimitKey(normalizedScope.name),
  ]);
}

function organizationLimitWriteKey(scope?: QuotaOrganizationScope | null): string {
  return organizationLimitKeysForScope(scope)[0] ?? CONFIG_KEY_DEFAULT_LIMIT;
}

function organizationLimitKeysForSummary(organization: QuotaOrganizationSummary): string[] {
  return uniqueStrings([
    organizationIdLimitKey(organization.id),
    organizationNameLimitKey(organization.name),
    organizationNameLimitKey(organization.title),
  ]);
}

function organizationLimitKeysForSnapshot(snapshot?: QuotaUserSnapshot | null): string[] {
  return uniqueStrings(
    normalizeOrganizations(snapshot?.organizations)
      ?.flatMap((organization) => organizationLimitKeysForSummary(organization))
      ?? []
  );
}

function normalizeUserSnapshot(userId: number, snapshot?: QuotaUserSnapshot): QuotaUserSnapshot | null {
  if (!snapshot) {
    return null;
  }

  const normalized: QuotaUserSnapshot = {
    user_id: userId,
    captured_at: new Date().toISOString(),
  };
  const username = normalizeOptionalString(snapshot.username);
  const nickname = normalizeOptionalNullableString(snapshot.nickname);
  const email = normalizeOptionalString(snapshot.email);
  const status = Number(snapshot.status);

  if (username) {
    normalized.username = username;
  }
  if (nickname !== undefined) {
    normalized.nickname = nickname;
  }
  if (email) {
    normalized.email = email;
  }
  if (Number.isInteger(status)) {
    normalized.status = status;
  }
  if (Array.isArray(snapshot.roles)) {
    normalized.roles = snapshot.roles.filter((role): role is string => typeof role === 'string');
  }
  const organizations = normalizeOrganizations(snapshot.organizations);
  if (organizations) {
    normalized.organizations = organizations;
  }

  return normalized;
}

function serializeUserSnapshot(userId: number, snapshot?: QuotaUserSnapshot): string | null {
  const normalized = normalizeUserSnapshot(userId, snapshot);
  return normalized ? JSON.stringify(normalized) : null;
}

function parseUserSnapshot(value: unknown): QuotaUserSnapshot | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'object') {
    return value as QuotaUserSnapshot;
  }
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as QuotaUserSnapshot : null;
  } catch {
    return null;
  }
}

function buildStatus(userId: number, limit: number, row?: UsageRow | null): QuotaStatus {
  const usedPower = roundPower(toNumber(row?.used_power));
  return {
    tool: TOOL_ID,
    user_id: userId,
    quota_limit: limit,
    used_power: usedPower,
    remaining_power: roundPower(Math.max(0, limit - usedPower)),
    has_record: !!row,
    updated_at: row?.updated_at ?? null,
    user_snapshot: parseUserSnapshot(row?.user_snapshot),
  };
}

export class SimpleUserUsageQuotaTool implements QuotaTool {
  readonly id = TOOL_ID;

  async getDefaultLimit(organization?: QuotaOrganizationScope | null): Promise<number> {
    return this.getLimitForCandidateKeys(organizationLimitKeysForScope(organization));
  }

  async setDefaultLimit(limit: number, organization?: QuotaOrganizationScope | null): Promise<void> {
    const normalizedLimit = normalizeLimit(limit);
    const configKey = organizationLimitWriteKey(organization);
    await pool.query(
      `INSERT INTO system_config (\`key\`, \`value\`) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = CURRENT_TIMESTAMP`,
      [configKey, String(normalizedLimit)]
    );
  }

  private async getLimitForCandidateKeys(candidateKeys: string[]): Promise<number> {
    const orderedCandidateKeys = uniqueStrings(candidateKeys);
    const keys = uniqueStrings([...orderedCandidateKeys, CONFIG_KEY_DEFAULT_LIMIT]);
    const [rows] = await pool.query<ConfigValueRow[]>(
      `SELECT \`key\`, \`value\`
       FROM system_config
       WHERE \`key\` IN (${placeholders(keys)})`,
      keys
    );
    const valuesByKey = new Map(rows.map((row) => [String(row.key), normalizeLimit(row.value)]));

    for (const key of orderedCandidateKeys) {
      const limit = valuesByKey.get(key);
      if (limit !== undefined) {
        return limit;
      }
    }

    return valuesByKey.get(CONFIG_KEY_DEFAULT_LIMIT)
      ?? normalizeLimit(process.env.DEFAULT_QUOTA_LIMIT_POWER ?? 0);
  }

  private async getLimitForSnapshot(snapshot?: QuotaUserSnapshot | null): Promise<number> {
    return this.getLimitForCandidateKeys(organizationLimitKeysForSnapshot(snapshot));
  }

  async getSummary(organization?: QuotaOrganizationScope | null): Promise<QuotaSummary> {
    const scope = normalizeOrganizationScope(organization);
    const limit = await this.getDefaultLimit(scope);
    if (scope) {
      const rows = await this.listRowsForOrganization(scope);
      const usedUserCount = rows.length;
      const totalUsedPower = roundPower(rows.reduce((sum, row) => sum + toNumber(row.used_power), 0));

      return {
        tool: this.id,
        quota_limit: limit,
        used_user_count: usedUserCount,
        total_used_power: totalUsedPower,
        total_remaining_power: roundPower(Math.max(0, usedUserCount * limit - totalUsedPower)),
      };
    }

    const [rows] = await pool.query<Array<RowDataPacket & {
      used_user_count: string | number;
      total_used_power: string | number | null;
    }>>(
      `SELECT COUNT(*) AS used_user_count,
              COALESCE(SUM(used_power), 0) AS total_used_power
       FROM quota_user_usage`
    );
    const usedUserCount = toNumber(rows?.[0]?.used_user_count);
    const totalUsedPower = roundPower(toNumber(rows?.[0]?.total_used_power));

    return {
      tool: this.id,
      quota_limit: limit,
      used_user_count: usedUserCount,
      total_used_power: totalUsedPower,
      total_remaining_power: roundPower(Math.max(0, usedUserCount * limit - totalUsedPower)),
    };
  }

  async resetAllUsage(
    note = 'admin reset usage',
    organization?: QuotaOrganizationScope | null
  ): Promise<{ affectedUsers: number; clearedPower: number }> {
    const scope = normalizeOrganizationScope(organization);
    if (scope) {
      return this.resetScopedUsage(scope, note);
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [summaryRows] = await conn.query<Array<RowDataPacket & {
        affected_users: string | number;
        cleared_power: string | number | null;
      }>>(
        `SELECT COUNT(*) AS affected_users,
                COALESCE(SUM(used_power), 0) AS cleared_power
         FROM quota_user_usage`
      );
      const affectedUsers = toNumber(summaryRows?.[0]?.affected_users);
      const clearedPower = roundPower(toNumber(summaryRows?.[0]?.cleared_power));

      await conn.query(
        `INSERT INTO quota_usage_ledger
          (user_id, event_type, power_delta, used_power_after, note)
         SELECT user_id, 'admin_reset', -used_power, 0, ?
         FROM quota_user_usage
         WHERE used_power <> 0`,
        [note]
      );
      await conn.query('UPDATE quota_user_usage SET used_power = 0');

      await conn.commit();
      return { affectedUsers, clearedPower };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async resetUserUsage(
    userId: number,
    note = 'admin reset user usage',
    options?: {
      organization?: QuotaOrganizationScope | null;
      requireLearnerRole?: boolean;
    }
  ): Promise<{ affectedUsers: number; clearedPower: number }> {
    const normalizedUserId = normalizePositiveInteger(userId);
    if (normalizedUserId === undefined) {
      return { affectedUsers: 0, clearedPower: 0 };
    }

    const scope = normalizeOrganizationScope(options?.organization);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.query<UsageRow[]>(
        'SELECT user_id, used_power, updated_at, user_snapshot FROM quota_user_usage WHERE user_id = ? FOR UPDATE',
        [normalizedUserId]
      );
      const row = rows?.[0] ?? null;
      if (!row) {
        await conn.commit();
        return { affectedUsers: 0, clearedPower: 0 };
      }

      const snapshot = parseUserSnapshot(row.user_snapshot);
      if (!snapshotBelongsToOrganization(snapshot, scope)) {
        throw new QuotaScopeMismatchError();
      }
      if (options?.requireLearnerRole && !isLearnerSnapshot(snapshot)) {
        throw new QuotaTargetRoleNotAllowedError();
      }

      const clearedPower = roundPower(toNumber(row.used_power));
      if (clearedPower !== 0) {
        await this.insertLedger(conn, {
          userId: normalizedUserId,
          eventType: 'admin_reset',
          powerDelta: -clearedPower,
          usedPowerAfter: 0,
          note,
        });
      }
      await conn.query('UPDATE quota_user_usage SET used_power = 0 WHERE user_id = ?', [normalizedUserId]);

      await conn.commit();
      return { affectedUsers: 1, clearedPower };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async getUserStatus(userId: number, userSnapshot?: QuotaUserSnapshot): Promise<QuotaStatus> {
    const [rows] = await pool.query<UsageRow[]>(
      'SELECT user_id, used_power, updated_at, user_snapshot FROM quota_user_usage WHERE user_id = ? LIMIT 1',
      [userId]
    );
    const row = rows?.[0] ?? null;
    const limit = await this.getLimitForSnapshot(userSnapshot ?? parseUserSnapshot(row?.user_snapshot));
    return buildStatus(userId, limit, row);
  }

  async getUserStatuses(userIds: number[]): Promise<Map<number, QuotaStatus>> {
    const uniqueUserIds = Array.from(new Set(userIds.filter((id) => Number.isInteger(id) && id > 0)));
    const result = new Map<number, QuotaStatus>();
    if (uniqueUserIds.length === 0) {
      return result;
    }

    const [rows] = await pool.query<UsageRow[]>(
      `SELECT user_id, used_power, updated_at, user_snapshot
       FROM quota_user_usage
       WHERE user_id IN (${uniqueUserIds.map(() => '?').join(', ')})`,
      uniqueUserIds
    );
    const rowsByUserId = new Map(rows.map((row) => [Number(row.user_id), row]));

    for (const userId of uniqueUserIds) {
      const row = rowsByUserId.get(userId) ?? null;
      const limit = await this.getLimitForSnapshot(parseUserSnapshot(row?.user_snapshot));
      result.set(userId, buildStatus(userId, limit, row));
    }
    return result;
  }

  async listUsageStatuses(params: QuotaUsageListParams): Promise<QuotaUsageListResult> {
    const page = normalizePage(params.page);
    const pageSize = normalizePageSize(params.pageSize);
    const offset = (page - 1) * pageSize;
    const limit = await this.getDefaultLimit();
    const search = typeof params.search === 'string' ? params.search.trim().toLowerCase() : '';
    const scope = normalizeOrganizationScope(params.organization);

    if (scope) {
      const rows = (await this.listRowsForOrganization(scope))
        .filter((row) => usageRowMatchesSearch(row, search))
        .sort((left, right) => {
          const timeDiff = usageRowUpdatedAtMs(right) - usageRowUpdatedAtMs(left);
          return timeDiff !== 0 ? timeDiff : Number(right.user_id) - Number(left.user_id);
        });
      const total = rows.length;
      const pageRows = rows.slice(offset, offset + pageSize);

      return {
        data: pageRows.map((row) => buildStatus(Number(row.user_id), limit, row)),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      };
    }

    const whereParams: unknown[] = [];
    let whereClause = '';

    if (search) {
      const pattern = `%${search}%`;
      whereClause = `
        WHERE LOWER(CAST(user_id AS CHAR)) LIKE ?
           OR LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(user_snapshot, '$.username')), '')) LIKE ?
           OR LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(user_snapshot, '$.nickname')), '')) LIKE ?
           OR LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(user_snapshot, '$.email')), '')) LIKE ?`;
      whereParams.push(pattern, pattern, pattern, pattern);
    }

    const [countRows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS total FROM quota_user_usage ${whereClause}`,
      whereParams
    );
    const total = toNumber(countRows?.[0]?.total);

    if (total === 0) {
      return {
        data: [],
        pagination: { page, pageSize, total: 0, totalPages: 0 },
      };
    }

    const [rows] = await pool.query<UsageRow[]>(
      `SELECT user_id, used_power, updated_at, user_snapshot
       FROM quota_user_usage
       ${whereClause}
       ORDER BY updated_at DESC, user_id DESC
       LIMIT ? OFFSET ?`,
      [...whereParams, pageSize, offset]
    );

    return {
      data: rows.map((row) => buildStatus(Number(row.user_id), limit, row)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  private async listRowsForOrganization(scope: QuotaOrganizationScope): Promise<UsageRow[]> {
    const [rows] = await pool.query<UsageRow[]>(
      'SELECT user_id, used_power, updated_at, user_snapshot FROM quota_user_usage'
    );

    return rows.filter((row) => snapshotBelongsToOrganization(parseUserSnapshot(row.user_snapshot), scope));
  }

  private async resetScopedUsage(
    scope: QuotaOrganizationScope,
    note: string
  ): Promise<{ affectedUsers: number; clearedPower: number }> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.query<UsageRow[]>(
        'SELECT user_id, used_power, updated_at, user_snapshot FROM quota_user_usage FOR UPDATE'
      );
      const scopedRows = rows.filter((row) => snapshotBelongsToOrganization(parseUserSnapshot(row.user_snapshot), scope));
      const userIds = scopedRows.map((row) => Number(row.user_id)).filter((id) => Number.isInteger(id) && id > 0);
      const affectedUsers = userIds.length;
      const clearedPower = roundPower(scopedRows.reduce((sum, row) => sum + toNumber(row.used_power), 0));

      if (userIds.length > 0) {
        const inClause = placeholders(userIds);
        await conn.query(
          `INSERT INTO quota_usage_ledger
            (user_id, event_type, power_delta, used_power_after, note)
           SELECT user_id, 'admin_reset', -used_power, 0, ?
           FROM quota_user_usage
           WHERE user_id IN (${inClause})
             AND used_power <> 0`,
          [note, ...userIds]
        );
        await conn.query(
          `UPDATE quota_user_usage SET used_power = 0 WHERE user_id IN (${inClause})`,
          userIds
        );
      }

      await conn.commit();
      return { affectedUsers, clearedPower };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async reserve(
    userId: number,
    providerId: string,
    amount: number,
    taskId: string,
    userSnapshot?: QuotaUserSnapshot
  ): Promise<QuotaReserveResult> {
    const reserveAmount = roundPower(amount);
    if (reserveAmount <= 0) {
      return { success: true, usedPowerAfter: 0, remainingPower: (await this.getLimitForSnapshot(userSnapshot)) };
    }

    const conn = await pool.getConnection();
    const snapshotJson = serializeUserSnapshot(userId, userSnapshot);

    try {
      await conn.beginTransaction();
      const [rows] = await conn.query<UsageRow[]>(
        'SELECT user_id, used_power, updated_at, user_snapshot FROM quota_user_usage WHERE user_id = ? FOR UPDATE',
        [userId]
      );

      const limit = await this.getLimitForSnapshot(userSnapshot ?? parseUserSnapshot(rows?.[0]?.user_snapshot));
      const currentUsedPower = roundPower(toNumber(rows?.[0]?.used_power));
      const nextUsedPower = roundPower(currentUsedPower + reserveAmount);
      if (nextUsedPower > limit) {
        await conn.rollback();
        return {
          success: false,
          errorCode: 'INSUFFICIENT_CREDITS',
          usedPowerAfter: currentUsedPower,
          remainingPower: roundPower(Math.max(0, limit - currentUsedPower)),
        };
      }

      if (rows.length > 0) {
        await conn.query(
          'UPDATE quota_user_usage SET used_power = ?, user_snapshot = COALESCE(?, user_snapshot) WHERE user_id = ?',
          [nextUsedPower, snapshotJson, userId]
        );
      } else {
        await conn.query(
          'INSERT INTO quota_user_usage (user_id, used_power, user_snapshot) VALUES (?, ?, ?)',
          [userId, nextUsedPower, snapshotJson]
        );
      }

      await this.insertLedger(conn, {
        userId,
        eventType: 'pre_deduct',
        powerDelta: reserveAmount,
        usedPowerAfter: nextUsedPower,
        taskId,
        providerId,
        powerCost: reserveAmount,
      });

      await conn.commit();
      return {
        success: true,
        usedPowerAfter: nextUsedPower,
        remainingPower: roundPower(Math.max(0, limit - nextUsedPower)),
      };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async refund(userId: number, providerId: string, taskId: string): Promise<void> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [alreadySettledRows] = await conn.query<RowDataPacket[]>(
        `SELECT id
         FROM quota_usage_ledger
         WHERE user_id = ?
           AND task_id = ?
           AND provider_id = ?
           AND event_type IN ('refund', 'confirm_deduct')
         LIMIT 1`,
        [userId, taskId, providerId]
      );
      if (alreadySettledRows.length > 0) {
        await conn.commit();
        return;
      }

      const preDeducted = await this.getPreDeductedAmount(conn, userId, providerId, taskId);
      if (preDeducted <= 0) {
        await conn.commit();
        return;
      }

      const usedPowerAfter = await this.applyUsageDelta(conn, userId, -preDeducted);
      await this.insertLedger(conn, {
        userId,
        eventType: 'refund',
        powerDelta: -preDeducted,
        usedPowerAfter,
        taskId,
        providerId,
        powerCost: preDeducted,
      });

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async finalizeTaskSuccess(
    userId: number,
    providerId: string,
    taskId: string,
    outputUrl: string,
    powerCost: number,
    creditCost: number,
    thumbnailUrl?: string
  ): Promise<ConfirmDeductResult> {
    const actualPowerCost = roundPower(powerCost);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [taskRows] = await conn.query<TaskRowForBilling[]>(
        `SELECT status, error_message
         FROM tasks
         WHERE task_id = ?
         FOR UPDATE`,
        [taskId]
      );
      const task = taskRows?.[0];
      if (!task) {
        throw new Error(`任务不存在: ${taskId}`);
      }

      if (task.status === 'success') {
        await conn.commit();
        return {
          billingStatus: 'settled',
          billingMessage: task.error_message?.startsWith('计费待补扣：') ? task.error_message : null,
          shortfallAmount: 0,
        };
      }

      const preDeducted = await this.getPreDeductedAmount(conn, userId, providerId, taskId);
      const diff = roundPower(actualPowerCost - preDeducted);
      const usedPowerAfter = diff === 0
        ? await this.getCurrentUsedPower(conn, userId)
        : await this.applyUsageDelta(conn, userId, diff);

      await this.insertLedger(conn, {
        userId,
        eventType: 'confirm_deduct',
        powerDelta: diff,
        usedPowerAfter,
        taskId,
        providerId,
        providerCreditCost: creditCost,
        powerCost: actualPowerCost,
        note: `actual=${actualPowerCost},pre=${preDeducted}`,
      });

      await conn.query(
        `UPDATE tasks
         SET status = 'success',
             output_url = ?,
             thumbnail_url = ?,
             credit_cost = ?,
             power_cost = ?,
             error_message = NULL,
             completed_at = NOW()
         WHERE task_id = ?`,
        [outputUrl, thumbnailUrl ?? null, creditCost, actualPowerCost, taskId]
      );

      await conn.commit();
      return {
        billingStatus: 'settled',
        billingMessage: null,
        shortfallAmount: 0,
      };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  private async getCurrentUsedPower(
    conn: Pick<PoolConnection, 'query'>,
    userId: number
  ): Promise<number> {
    const [rows] = await conn.query<UsageRow[]>(
      'SELECT user_id, used_power, updated_at, user_snapshot FROM quota_user_usage WHERE user_id = ? FOR UPDATE',
      [userId]
    );
    return roundPower(toNumber(rows?.[0]?.used_power));
  }

  private async applyUsageDelta(
    conn: Pick<PoolConnection, 'query'>,
    userId: number,
    delta: number
  ): Promise<number> {
    const [rows] = await conn.query<UsageRow[]>(
      'SELECT user_id, used_power, updated_at, user_snapshot FROM quota_user_usage WHERE user_id = ? FOR UPDATE',
      [userId]
    );
    const currentUsedPower = roundPower(toNumber(rows?.[0]?.used_power));
    const nextUsedPower = roundPower(Math.max(0, currentUsedPower + delta));

    if (rows.length > 0) {
      await conn.query(
        'UPDATE quota_user_usage SET used_power = ? WHERE user_id = ?',
        [nextUsedPower, userId]
      );
    } else {
      await conn.query(
        'INSERT INTO quota_user_usage (user_id, used_power) VALUES (?, ?)',
        [userId, nextUsedPower]
      );
    }

    return nextUsedPower;
  }

  private async getPreDeductedAmount(
    conn: Pick<PoolConnection, 'query'>,
    userId: number,
    providerId: string,
    taskId: string
  ): Promise<number> {
    const [rows] = await conn.query<LedgerAmountRow[]>(
      `SELECT COALESCE(SUM(power_delta), 0) AS amount
       FROM quota_usage_ledger
       WHERE user_id = ?
         AND provider_id = ?
         AND task_id = ?
         AND event_type = 'pre_deduct'`,
      [userId, providerId, taskId]
    );
    return roundPower(toNumber(rows?.[0]?.amount));
  }

  private async insertLedger(
    conn: Pick<PoolConnection, 'query'>,
    input: {
      userId: number;
      eventType: 'pre_deduct' | 'refund' | 'confirm_deduct' | 'admin_reset';
      powerDelta: number;
      usedPowerAfter: number;
      taskId?: string | null;
      providerId?: string | null;
      providerCreditCost?: number;
      powerCost?: number;
      note?: string | null;
    }
  ): Promise<void> {
    await conn.query(
      `INSERT INTO quota_usage_ledger
        (user_id, event_type, power_delta, used_power_after, task_id, provider_id,
         provider_credit_cost, power_cost, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.userId,
        input.eventType,
        roundPower(input.powerDelta),
        roundPower(input.usedPowerAfter),
        input.taskId ?? null,
        input.providerId ?? null,
        roundPower(input.providerCreditCost ?? 0),
        roundPower(input.powerCost ?? 0),
        input.note ?? null,
      ]
    );
  }
}

export const simpleUserUsageQuotaTool = new SimpleUserUsageQuotaTool();
