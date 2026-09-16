import { Injectable } from '@nestjs/common';

const SENSITIVE_KEYS = /password|token|secret|authorization|cookie|api[-_]?key/i;
export const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redact(item)]));
  return value;
};

@Injectable()
export class AuditService {
  /** Persist through the AuditLog repository. Audit records are never updated or deleted by application code. */
  record(event: { organizationId: string; actorId?: string; action: string; resourceType: string; resourceId?: string; reason?: string; before?: unknown; after?: unknown; requestId?: string }) {
    return { ...event, before: redact(event.before), after: redact(event.after), recordedAt: new Date().toISOString() };
  }
}
