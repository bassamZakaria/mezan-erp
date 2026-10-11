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
export const AUDIT_STREAMS = ["security", "sensitive"] as const;
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
  query(stream: AuditStream, limit?: number): Promise<readonly AuditEvent[]>;
  /**
   * Runs `fn` in the transaction this sink's appends join, so a write and the
   * event recording it commit or roll back together. A sink that cannot share a
   * transaction with the writes it records leaves this out.
   */
  atomic?<T>(fn: () => Promise<T>): Promise<T>;
  /** True when the caller is already inside a transaction this sink's appends would join. */
  insideTransaction?(): boolean;
  /** Resolves once no transaction is open on the connection this sink writes to. */
  settled?(): Promise<void>;
  /**
   * Runs `fn` as the only writer on the connection this sink writes to, from its
   * first statement to its last. Called from inside a turn or a transaction the
   * caller already holds, it runs `fn` straight through.
   */
  turn?<T>(fn: () => Promise<T>, observer?: TurnObserver): Promise<T>;
  /**
   * Runs `fn` with that turn handed back, and takes it again before returning.
   * For work that is not the database — a hash, a child process, a socket.
   */
  outsideTurn?<T>(fn: () => Promise<T>): Promise<T>;
}

/** An event that had to be recorded with the write it describes, and could not be: that write must not commit. */
export class AuditRecordingError extends Error {
  constructor(cause: unknown) {
    super("the audit log could not record this action", { cause });
    this.name = "AuditRecordingError";
  }
}

export interface TurnObserver {
  /** The holder gave the event loop back with the turn still held. */
  onYield?(): void;
  onSuspend?(): void;
  onResume?(): void;
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
