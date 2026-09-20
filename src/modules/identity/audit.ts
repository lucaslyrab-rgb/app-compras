import { database } from "@/db/client";
import { auditEvents } from "@/db/schema";

export async function recordAudit(input: { actorId?: string | null; action: string; entityType: string; entityId?: string | null; metadata?: Record<string, unknown>; requestId?: string | null }) {
  await database().db.insert(auditEvents).values({
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: JSON.stringify(input.metadata ?? {}),
    requestId: input.requestId ?? null
  });
}
