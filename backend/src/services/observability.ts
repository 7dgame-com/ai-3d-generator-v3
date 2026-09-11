import { query } from '../db/connection';

const RETENTION_DAYS = Math.min(365, Math.max(7, Number(process.env.AI3D_DIAGNOSTIC_RETENTION_DAYS ?? 90)));
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
let retentionTimer: NodeJS.Timeout | null = null;

export interface StructuredLogFields {
  event: string;
  localTaskId?: string;
  providerTaskId?: string | null;
  providerId?: string;
  credentialScope?: string;
  quotaEpoch?: number;
  attemptCount?: number;
  taskStatus?: string;
  providerCategory?: string | null;
  providerCode?: string | null;
  internalTraceId?: string;
  providerTraceId?: string | null;
  durationMs?: number;
}

export function logQueueEvent(fields: StructuredLogFields): void {
  // JSON keeps diagnostics queryable by the existing log collector. Never pass request payloads or credentials here.
  console.info(JSON.stringify({ component: 'ai3d-provider-queue', timestamp: new Date().toISOString(), ...fields }));
}

export async function purgeExpiredDiagnostics(): Promise<void> {
  await query('DELETE FROM provider_task_events WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [RETENTION_DAYS]);
  await query('DELETE FROM admin_audit_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [RETENTION_DAYS]);
}

export function startObservabilityRetention(): void {
  if (retentionTimer) return;
  void purgeExpiredDiagnostics().catch((error) => {
    console.error('[Observability] initial diagnostic retention cleanup failed:', (error as Error).message);
  });
  retentionTimer = setInterval(() => {
    void purgeExpiredDiagnostics().catch((error) => {
      console.error('[Observability] diagnostic retention cleanup failed:', (error as Error).message);
    });
  }, RETENTION_INTERVAL_MS);
}

export function stopObservabilityRetention(): void {
  if (retentionTimer) clearInterval(retentionTimer);
  retentionTimer = null;
}

export function getObservabilityRetentionHealth(): { running: boolean; retentionDays: number } {
  return { running: retentionTimer !== null, retentionDays: RETENTION_DAYS };
}

export interface QueueOperationalHealth {
  pausedScopes: string[];
  backloggedScopes: Array<{ providerId: string; credentialScope: string; queueDepth: number; oldestWaitSeconds: number }>;
  unknownTaskCount: number;
}

/**
 * Operational warnings intentionally stay separate from process health: pausing one
 * supplier must be visible to operators without turning the entire plugin unhealthy.
 */
export async function getQueueOperationalHealth(): Promise<QueueOperationalHealth> {
  const waitThresholdSeconds = Math.max(60, Number(process.env.AI3D_QUEUE_WAIT_ALERT_SECONDS ?? 600));
  const rows = await query<Array<Record<string, unknown>>>(
    `SELECT c.provider_id, c.credential_scope, c.paused,
            SUM(CASE WHEN t.status IN ('waiting_provider', 'retry_wait') THEN 1 ELSE 0 END) AS queue_depth,
            MIN(CASE WHEN t.status IN ('waiting_provider', 'retry_wait') THEN t.queue_entered_at END) AS oldest_wait,
            SUM(CASE WHEN t.status = 'provider_state_unknown' THEN 1 ELSE 0 END) AS unknown_count
     FROM provider_runtime_config c
     LEFT JOIN tasks t ON t.provider_id = c.provider_id AND t.credential_scope = c.credential_scope
     GROUP BY c.provider_id, c.credential_scope, c.paused`
  );
  const now = Date.now();
  const pausedScopes: string[] = [];
  const backloggedScopes: QueueOperationalHealth['backloggedScopes'] = [];
  let unknownTaskCount = 0;
  for (const row of rows) {
    const providerId = String(row.provider_id);
    const credentialScope = String(row.credential_scope);
    if (Boolean(row.paused)) pausedScopes.push(`${providerId}:${credentialScope}`);
    unknownTaskCount += Number(row.unknown_count ?? 0);
    const oldest = row.oldest_wait ? new Date(String(row.oldest_wait)).getTime() : null;
    const oldestWaitSeconds = oldest && Number.isFinite(oldest) ? Math.max(0, Math.floor((now - oldest) / 1000)) : 0;
    if (oldestWaitSeconds >= waitThresholdSeconds) {
      backloggedScopes.push({ providerId, credentialScope, queueDepth: Number(row.queue_depth ?? 0), oldestWaitSeconds });
    }
  }
  return { pausedScopes, backloggedScopes, unknownTaskCount };
}
