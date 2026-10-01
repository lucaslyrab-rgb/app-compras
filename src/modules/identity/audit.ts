import { database } from "@/db/client";
import { auditEvents } from "@/db/schema";

export type AuditEventInput = {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  requestId?: string | null;
};

type AuditExecutor = {
  insert: (table: typeof auditEvents) => {
    values: (values: typeof auditEvents.$inferInsert) => Promise<unknown>;
  };
};

export async function recordAudit(
  input: AuditEventInput,
  executor?: AuditExecutor
) {
  const db = (executor ?? database().db) as AuditExecutor;
  await db.insert(auditEvents).values({
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: JSON.stringify(input.metadata ?? {}),
    requestId: input.requestId ?? null,
  });
}
