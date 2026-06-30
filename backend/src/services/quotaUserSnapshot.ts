import type { UserInfo } from '../middleware/auth';
import type { QuotaOrganizationSummary, QuotaUserSnapshot } from './quotaTool';

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

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeOrganizations(value: unknown): QuotaOrganizationSummary[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const organizations = value.flatMap((item): QuotaOrganizationSummary[] => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const raw = item as Record<string, unknown>;
    const id = positiveInteger(raw.id);
    const name = optionalString(raw.name);
    const title = optionalString(raw.title);
    if (id === undefined && !name && !title) {
      return [];
    }

    const organization: QuotaOrganizationSummary = {};
    if (id !== undefined) {
      organization.id = id;
    }
    if (name) {
      organization.name = name;
    }
    if (title) {
      organization.title = title;
    }
    return [organization];
  });

  return organizations.length > 0 ? organizations : undefined;
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
  const organizations = normalizeOrganizations(user.organizations);
  if (organizations) {
    snapshot.organizations = organizations;
  }

  return snapshot;
}
