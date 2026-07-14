import { query } from '../db/connection';

const SENSITIVE_KEY = /api[_-]?key|authorization|token|secret|password|image|base64|request[_-]?payload/i;

export function redactDiagnosticValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactDiagnosticValue);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactDiagnosticValue(child),
    ])
  );
}

export interface AdminAuditInput {
  actorId: number | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  detail?: unknown;
}

export async function recordAdminAudit(input: AdminAuditInput): Promise<void> {
  await query(
    `INSERT INTO admin_audit_logs
      (actor_id, action, target_type, target_id, before_json, after_json, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.actorId,
      input.action,
      input.targetType,
      input.targetId ?? null,
      input.before === undefined ? null : JSON.stringify(redactDiagnosticValue(input.before)),
      input.after === undefined ? null : JSON.stringify(redactDiagnosticValue(input.after)),
      input.detail === undefined ? null : JSON.stringify(redactDiagnosticValue(input.detail)),
    ]
  );
}
