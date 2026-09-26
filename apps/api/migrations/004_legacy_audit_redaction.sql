-- Existing Phase 1/2 audit reasons predate application-level redaction.
-- Trusted migration temporarily disables the immutable-row guard to remove sensitive legacy text.
DROP TRIGGER audit_logs_append_only ON audit_logs;
UPDATE audit_logs SET reason='[REDACTED]'
WHERE reason ~* '(password|passphrase|secret|token|authorization|api[_-]?key|card|cvv|bearer|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})';
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
