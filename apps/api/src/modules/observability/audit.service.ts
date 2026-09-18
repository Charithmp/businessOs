import { Injectable } from '@nestjs/common';
import { AuditAction } from '@bos/db';
import { PrismaService } from '../../database/prisma.service';

const SENSITIVE_KEYS = /password|token|secret|authorization|cookie|api[-_]?key/i;
export const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redact(item)]));
  return value;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}
  /** Persist through the AuditLog repository. Audit records are never updated or deleted by application code. */
  record(event: { organizationId: string; actorId?: string; action: AuditAction; resourceType: string; resourceId?: string; reason?: string; before?: unknown; after?: unknown; requestId?: string }) {
    return this.prisma.auditLog.create({ data: { ...event, before: redact(event.before) as never, after: redact(event.after) as never } });
  }
}
