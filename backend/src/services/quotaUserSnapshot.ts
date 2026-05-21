import type { UserInfo } from '../middleware/auth';
import type { QuotaUserSnapshot } from './quotaTool';

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return optionalString(value);
}

export function buildQuotaUserSnapshot(user: UserInfo): QuotaUserSnapshot {
  const snapshot: QuotaUserSnapshot = {
    user_id: user.userId,
  };
  const username = optionalString(user.username);
  const nickname = optionalNullableString(user.nickname);
  const email = optionalString(user.email);
  const status = Number(user.status);

  if (username) {
    snapshot.username = username;
  }
  if (nickname !== undefined) {
    snapshot.nickname = nickname;
  }
  if (email) {
    snapshot.email = email;
  }
  if (Number.isInteger(status)) {
    snapshot.status = status;
  }
  if (Array.isArray(user.roles)) {
    snapshot.roles = user.roles.filter((role): role is string => typeof role === 'string');
  }

  return snapshot;
}
