-- P2 queue-admission contention migration reference.
-- Production startup applies the idempotent equivalent through schemaHealth.ts.
-- migration id: 20260714_ai3d_p2_queue_admission_contention.

CREATE INDEX idx_user_provider_outstanding ON tasks (user_id, provider_id, status);
