-- Audit snapshots must survive deletion of test or retired organizations/users.
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_organization_id_fkey;
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_user_id_fkey;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS before_state jsonb;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS after_state jsonb;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS trace_id text;
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs(resource_type,resource_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_created_idx ON audit_logs(action,created_at DESC);

CREATE OR REPLACE FUNCTION reject_append_only_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE='55000';
END $$;
DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();

CREATE TABLE IF NOT EXISTS system_logs (
  id uuid PRIMARY KEY,
  organization_id uuid,
  actor_user_id uuid,
  request_id uuid NOT NULL,
  trace_id text,
  event text NOT NULL,
  level text NOT NULL CHECK(level IN ('INFO','WARN','ERROR')),
  method text,
  route text,
  status_code integer,
  duration_ms integer CHECK(duration_ms IS NULL OR duration_ms >= 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS system_logs_scope_created_idx ON system_logs(organization_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS system_logs_level_created_idx ON system_logs(level,created_at DESC);
CREATE INDEX IF NOT EXISTS system_logs_request_idx ON system_logs(request_id);

CREATE TABLE IF NOT EXISTS security_events (
  id uuid PRIMARY KEY,
  organization_id uuid,
  actor_user_id uuid,
  request_id uuid NOT NULL,
  trace_id text,
  event text NOT NULL,
  severity text NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH')),
  route text,
  status_code integer,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_events_scope_created_idx ON security_events(organization_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS security_events_event_created_idx ON security_events(event,created_at DESC);
DROP TRIGGER IF EXISTS security_events_append_only ON security_events;
CREATE TRIGGER security_events_append_only BEFORE UPDATE OR DELETE ON security_events
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();

-- Retention applies only to high-volume operational logs. Security and audit records remain append-only.
CREATE OR REPLACE FUNCTION prune_system_logs(retention_days integer) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE deleted_count bigint;
BEGIN
  IF retention_days < 1 OR retention_days > 3650 THEN
    RAISE EXCEPTION 'retention_days must be between 1 and 3650';
  END IF;
  DELETE FROM system_logs WHERE created_at < now() - make_interval(days => retention_days);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END $$;
