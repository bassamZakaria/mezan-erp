import type { Context, MiddlewareHandler } from "hono";
import {
  JournalEntryAlreadyReversedError,
  JournalEntryNotFoundError,
  JournalEntryNotPostedError,
  ReversalDateBeforeOriginalError,
  recordSensitiveEvent,
  type AuditSeverity,
  type AuditSink,
} from "@mezan/domain";
import { postingRefusalResponse } from "./posting-refusal.js";
import { tenantDay } from "./tenant-day.js";

export function reversalRefusalResponse(c: Context, err: unknown): Response | null {
  const postingRefusal = postingRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  if (err instanceof ReversalDateBeforeOriginalError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 422);
  }
  if (err instanceof JournalEntryAlreadyReversedError || err instanceof JournalEntryNotPostedError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  }
  if (err instanceof JournalEntryNotFoundError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 404);
  }
  return null;
}

const REVERSAL_REASON_REQUIRED = {
  error: "REVERSAL_REASON_REQUIRED",
  message: "اكتب سبب العكس؛ لا يُعكس مستند مرحَّل بلا سبب مسجَّل.",
  messageEn: "Give the reason for the reversal; a posted document is not reversed without one on record.",
} as const;

/** INVARIANT: mounted on every registry route whose `takesReason` is true (reversal-paths/registry.test.ts) — the screen's own check is a convenience, this is the control. */
export const requireReversalReason: MiddlewareHandler = async (c, next) => {
  const body = (await c.req.json().catch(() => null)) as { memo?: unknown } | null;
  if (typeof body?.memo !== "string" || body.memo.trim() === "") return c.json(REVERSAL_REASON_REQUIRED, 422);
  await next();
};

export interface ReversalRequest {
  readonly date: string;
  readonly memo: string | undefined;
}

/** INVARIANT: a reversal with no date is dated the tenant's today, never the original's day — the original's period may be closed (reversal-paths/registry-dates.test.ts). */
export async function readReversalRequest(c: Context): Promise<ReversalRequest> {
  const body = (await c.req.json().catch(() => ({}))) as { date?: unknown; memo?: unknown } | null;
  const date = await tenantDay(c, typeof body?.date === "string" && body.date !== "" ? body.date : new Date().toISOString());
  const memo = typeof body?.memo === "string" && body.memo.trim() !== "" ? body.memo.trim() : undefined;
  return { date, memo };
}

export interface DocumentReversalAudit {
  readonly module: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly actor: string;
  readonly action?: string;
  readonly severity?: AuditSeverity;
  readonly details: Record<string, unknown>;
}

export async function recordDocumentReversal(audit: AuditSink | undefined, event: DocumentReversalAudit): Promise<void> {
  if (!audit) return;
  await recordSensitiveEvent(audit, {
    module: event.module,
    entityType: event.entityType,
    entityId: event.entityId,
    action: event.action ?? "REVERSE",
    actor: event.actor,
    severity: event.severity ?? "WARNING",
    details: event.details,
  });
}
