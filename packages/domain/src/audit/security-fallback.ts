import {
  createAuditEvent,
  type AuditEventInput,
  type AuditSink,
  type SecurityEventFallback,
  type UnrecordedSecurityEvent,
} from "./audit-event.js";

export type { SecurityEventFallback, UnrecordedSecurityEvent, UnrecordedSecurityEvents } from "./audit-event.js";

export const UNRECORDED_RECENT_LIMIT = 20;

const SECRET_KEY = /pin|password|passcode|token|secret|otp|code|hash|authorization|cookie/i;
const MAX_VALUE_LENGTH = 200;

// SECURITY: the fallback file sits beside the database in plain text and is
// read back onto a report screen, so a credential must never reach it. Keys are
// refused by name and every value is flattened to a short scalar.
export function withoutSecrets(details: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!details) return null;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SECRET_KEY.test(key)) continue;
    if (typeof value === "number" || typeof value === "boolean" || value === null) kept[key] = value;
    else if (typeof value === "string") kept[key] = value.slice(0, MAX_VALUE_LENGTH);
  }
  return kept;
}

function reasonOf(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  return text.slice(0, MAX_VALUE_LENGTH);
}

export function createMemorySecurityEventFallback(capacity = 200): SecurityEventFallback {
  const entries: UnrecordedSecurityEvent[] = [];
  let count = 0;
  return {
    record(entry) {
      count += 1;
      entries.push(entry);
      if (entries.length > capacity) entries.splice(0, entries.length - capacity);
    },
    summary(limit = UNRECORDED_RECENT_LIMIT) {
      return { count, recent: entries.slice(-limit).reverse(), dropped: count - entries.length, corrupted: 0 };
    },
  };
}

export async function recordSecurityEventOrFallback(
  sink: AuditSink,
  input: Omit<AuditEventInput, "stream">,
  fallback: SecurityEventFallback | undefined = sink.unrecorded,
): Promise<void> {
  const event = createAuditEvent({ ...input, stream: "security" });
  try {
    await sink.append(event);
  } catch (cause) {
    if (!fallback) {
      console.error(`[security] ${event.severity} ${event.action} could not be recorded in the audit log, and this sink has no fallback`, cause);
      return;
    }
    try {
      fallback.record({
        at: event.timestamp,
        module: event.module,
        action: event.action,
        severity: event.severity,
        actor: event.actor,
        entityId: event.entityId,
        details: withoutSecrets(event.details as Record<string, unknown> | null),
        reason: reasonOf(cause),
      });
    } catch (fallbackFailure) {
      console.error(`[security] ${event.severity} ${event.action} could be recorded neither in the audit log nor in its fallback`, cause, fallbackFailure);
    }
  }
}
