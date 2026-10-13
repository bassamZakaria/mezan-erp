/**
 * Audit trail.
 *
 * docs/archive/plan.md §5.7 + docs/archive/catalog/09 (سجلات المراجعة والأمان, `/audit/reports`):
 * an append-only forensic record with two streams and a severity taxonomy. On
 * desktop this matters MORE, not less — it is the only forensic record when
 * there is no server.
 *
 * Append-only is an invariant: audit events are only ever created and read,
 * never updated or deleted. The port below has no update/delete by design, and
 * the SQLite table in @mezan/persistence enforces it at the storage layer.
 */

/**
 * Severity taxonomy. `CRITICAL` and `WARNING` were observed in the captured app
 * (account lockout = CRITICAL, HR contract creation = WARNING); `INFO`/`ERROR`
 * complete the set per docs/archive/plan.md §5.7.
 */
export const AUDIT_SEVERITIES = [
  "CRITICAL",
  "ERROR",
  "WARNING",
  "INFO",
] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

/**
 * The two audit streams from the catalog: security events (أحداث الأمان) and
 * sensitive operations (العمليات الحساسة). Each has its own tab/count in the UI.
 */
export enum AuditStreamName {
  Security = "security",
  Sensitive = "sensitive",
}
export const AUDIT_STREAMS = ["security", "sensitive"] as const satisfies readonly `${AuditStreamName}`[];
export type AuditStream = (typeof AUDIT_STREAMS)[number];

/**
 * An append-only audit record. `timestamp` is an ISO-8601 UTC string.
 *
 * `branchId` is nullable and stays nullable: rows written before the field
 * existed, and requests whose branch scope spans more than one branch, have no
 * single branch to name. NULL there means "not recorded", never "every branch"
 * — inventing one would fabricate evidence in a forensic log.
 */
export interface AuditEvent {
  readonly stream: AuditStream;
  readonly module: string; // e.g. "auth", "hr"
  readonly entityType: string; // e.g. "AUTH_USER", "CONTRACT"
  /**
   * WHICH entity of that type — the id, so an entity's own trail can be
   * selected. Nullable, and stays nullable: rows written before the column
   * existed have none, and a few events (a sequence counter, a password change)
   * are about a subject the rest of the system does not address by id.
   *
   * Without this the only way to find an employee's or a document's history was
   * to scan every string in `details`, where each module had chosen its own key
   * — `docId`, `invoiceId`, `entryId`, `id`.
   */
  readonly entityId: string | null;
  readonly action: string; // e.g. "ACCOUNT_LOCKED", "CREATE"
  readonly actor: string; // user id / name
  readonly branchId: string | null;
  readonly timestamp: string; // ISO-8601 UTC
  readonly severity: AuditSeverity;
  readonly details: Readonly<Record<string, unknown>> | null;
}

/** Fields the caller supplies; timestamp/branchId/details are filled in if omitted. */
export interface AuditEventInput {
  readonly stream: AuditStream;
  readonly module: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly action: string;
  readonly actor: string;
  readonly branchId?: string | null;
  readonly severity: AuditSeverity;
  readonly timestamp?: string;
  readonly details?: Readonly<Record<string, unknown>> | null;
}

/**
 * Append-only sink port. No update, no delete — the shape encodes the invariant.
 * `query` is read-only, scoped to a stream, newest-first.
 */
export interface AuditSink {
  append(event: AuditEvent): Promise<void>;
  /**
   * Writes on the caller's own connection before returning, so the row joins
   * whatever transaction the caller holds. A sink that cannot do that omits it,
   * and a caller that needs the write to be atomic with its own must refuse.
   */
  appendSync?(event: AuditEvent): void;
  query(stream: AuditStream, limit?: number): Promise<readonly AuditEvent[]>;
  atomic?<T>(fn: () => Promise<T>): Promise<T>;
  insideTransaction?(): boolean;
  settled?(): Promise<void>;
  turn?<T>(fn: () => Promise<T>, observer?: TurnObserver): Promise<T>;
  outsideTurn?<T>(fn: () => Promise<T>): Promise<T>;
  unrecorded?: SecurityEventFallback;
}

export interface UnrecordedSecurityEvent {
  readonly at: string;
  readonly module: string;
  readonly action: string;
  readonly severity: string;
  readonly actor: string;
  readonly entityId: string | null;
  readonly details: Record<string, unknown> | null;
  readonly reason: string;
}

export interface UnrecordedSecurityEvents {
  readonly count: number;
  readonly recent: readonly UnrecordedSecurityEvent[];
}

export interface SecurityEventFallback {
  record(entry: UnrecordedSecurityEvent): void;
  summary(limit?: number): UnrecordedSecurityEvents;
}

/** An event that had to be recorded with the write it describes, and could not be: that write must not commit. */
export class AuditRecordingError extends Error {
  constructor(cause: unknown) {
    super("the audit log could not record this action", { cause });
    this.name = "AuditRecordingError";
  }
}

/** A statement issued from outside the chain that owns the open transaction: refused before it runs, because it would commit or vanish with somebody else's work. */
export class ForeignWriteError extends Error {
  constructor(readonly statement: string) {
    super(`a write was issued inside another operation's open transaction and was refused: ${statement}`);
    this.name = "ForeignWriteError";
  }
}

export interface LostTurnOutcome {
  readonly completed?: { readonly value: unknown };
  readonly cause?: unknown;
}

// REQUIRED: whoever catches this must rethrow it. The holder no longer has the
// connection's turn, so it must stop having written nothing since — a handler
// that reads it as an ordinary failure and records one writes without the turn,
// and one that retries the outside call repeats an effect that already happened.
export class ConnectionTurnLostError extends Error {
  readonly completed?: { readonly value: unknown };

  constructor(waitedMs: number, outcome: LostTurnOutcome = {}) {
    super(`the connection's turn was not taken again within ${waitedMs}ms`, outcome.cause === undefined ? undefined : { cause: outcome.cause });
    this.name = "ConnectionTurnLostError";
    this.completed = outcome.completed;
  }
}

export interface TurnObserver {
  onYield?(): void;
  onSuspend?(): void;
  onResume?(): void;
  readonly retakeTimeoutMs?: number;
  readonly completedRetakeTimeoutMs?: number;
}

/**
 * Multi-field filter for the audit viewer (`/audit`). Every field is
 * optional/AND-combined; `from`/`to` bound `timestamp` (ISO-8601, inclusive).
 * Additive to {@link AuditSink} — a store implements this separately so the
 * append-only write port never grows a read-shaped requirement.
 */
export interface AuditQueryFilter {
  readonly stream?: AuditStream;
  readonly branchId?: string;
  readonly module?: string;
  readonly action?: string;
  readonly actor?: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly field?: string;
  readonly severity?: AuditSeverity;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface AuditQueryResult {
  readonly events: readonly AuditEvent[];
  readonly total: number;
}

/** Read-only, filtered query port for the audit viewer — newest-first. */
export interface AuditQueryPort {
  queryEvents(filter: AuditQueryFilter): Promise<AuditQueryResult>;
}

/** Build a validated, timestamped AuditEvent from caller input. */
export function createAuditEvent(input: AuditEventInput): AuditEvent {
  if (input.module.trim() === "") throw new RangeError("audit: module required");
  if (input.entityType.trim() === "")
    throw new RangeError("audit: entityType required");
  if (input.action.trim() === "") throw new RangeError("audit: action required");
  if (input.actor.trim() === "") throw new RangeError("audit: actor required");
  return {
    stream: input.stream,
    module: input.module,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    action: input.action,
    actor: input.actor,
    branchId: input.branchId ?? null,
    severity: input.severity,
    timestamp: input.timestamp ?? new Date().toISOString(),
    details: input.details ?? null,
  };
}

/** Convenience: record a security-stream event. */
export function recordSecurityEvent(
  sink: AuditSink,
  input: Omit<AuditEventInput, "stream">,
): Promise<void> {
  return sink.append(createAuditEvent({ ...input, stream: "security" }));
}

/** Convenience: record a sensitive-operations event. */
export function recordSensitiveEvent(
  sink: AuditSink,
  input: Omit<AuditEventInput, "stream">,
): Promise<void> {
  return sink.append(createAuditEvent({ ...input, stream: "sensitive" }));
}
