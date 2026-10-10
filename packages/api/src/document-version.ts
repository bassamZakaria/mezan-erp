import type { Context } from "hono";

/**
 * الإصدار — optimistic concurrency on the documents two tills can hold open at
 * once (N-9).
 *
 * Before this, a second till acting on a document somebody else had already
 * moved simply won, and the first act vanished with no record anywhere: two
 * cashiers open one invoice, both act, one act is gone.
 *
 * A screen loads a document, keeps the `version` it was served, and sends it
 * back as `expectedVersion` on the act. If the stored row has moved on, the act
 * is refused with 409 and the operator is told to reload — and told WHO moved
 * it, which is what turns "it didn't work" into a conversation across the shop
 * floor.
 */
export interface DocumentVersionPort {
  read(id: string): Promise<{ readonly version: number; readonly lastModifiedBy: string | null } | null>;
  /** One statement for a whole list page — a list must never read version per row. */
  readMany(ids: readonly string[]): Promise<ReadonlyMap<string, number>>;
  stampModifier(id: string, actor: string | null): Promise<void>;
}

export const DOCUMENT_VERSION_CONFLICT = "DOCUMENT_VERSION_CONFLICT";

export function staleDocumentMessage(userName: string | null): string {
  return userName
    ? `تم تعديل هذا المستند قبل قليل بواسطة ${userName} — أعد التحميل`
    : "تم تعديل هذا المستند قبل قليل — أعد التحميل";
}

export interface DocumentVersionGuard {
  readonly versions: DocumentVersionPort;
  /** Turns the winning editor's user id into the name the refusal names. */
  readonly displayNameOf?: (userId: string) => Promise<string | null>;
}

/**
 * Refuses the act when the caller's `expectedVersion` is behind the stored row.
 *
 * `expectedVersion` is OPTIONAL on the wire and enforced when present: a client
 * that has not been updated keeps working exactly as before, and one that sends
 * it gets the guarantee. Returns `null` when the act may proceed.
 */
export async function refuseStaleDocument(
  c: Context,
  guard: DocumentVersionGuard | undefined,
  id: string,
  expectedVersion: number | undefined,
): Promise<Response | null> {
  if (!guard || expectedVersion === undefined) return null;
  const current = await guard.versions.read(id);
  if (!current || current.version === expectedVersion) return null;
  const name = current.lastModifiedBy && guard.displayNameOf ? await guard.displayNameOf(current.lastModifiedBy) : null;
  return c.json(
    {
      error: DOCUMENT_VERSION_CONFLICT,
      message: staleDocumentMessage(name ?? current.lastModifiedBy),
      expectedVersion,
      currentVersion: current.version,
    },
    409,
  );
}

/** Records who made the change that just won, so the NEXT stale caller can be told. */
export async function stampDocumentModifier(
  guard: DocumentVersionGuard | undefined,
  id: string,
  actor: string | undefined,
): Promise<void> {
  if (!guard) return;
  await guard.versions.stampModifier(id, actor ?? null);
}

/** The version to serve on a document's detail read, so a screen can send it back. */
export async function documentVersionOf(
  guard: DocumentVersionGuard | undefined,
  id: string,
): Promise<number | null> {
  if (!guard) return null;
  return (await guard.versions.read(id))?.version ?? null;
}

/**
 * The versions for a whole list page, in one query.
 *
 * A screen that acts straight off a list row — confirm, cancel, send from the
 * row's kebab — can only send `expectedVersion` if the row carried one, so a
 * list that omits it turns the guard into a silent no-op (N-9).
 */
export async function documentVersionsOf(
  guard: DocumentVersionGuard | undefined,
  ids: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  if (!guard || ids.length === 0) return new Map();
  return guard.versions.readMany(ids);
}

/** Parses an optional `expectedVersion` off a request body without rejecting the rest of it. */
export function expectedVersionOf(body: unknown): number | undefined {
  if (!body || typeof body !== "object") return undefined;
  const value = (body as { expectedVersion?: unknown }).expectedVersion;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export type RequestedReversalDate = { readonly ok: true; readonly date: string | undefined } | { readonly ok: false };

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The day a cancel or void is to be dated, when the caller names one. Absent means today. */
export function requestedReversalDate(body: unknown): RequestedReversalDate {
  const value = body && typeof body === "object" ? (body as { date?: unknown }).date : undefined;
  if (value === undefined || value === null) return { ok: true, date: undefined };
  if (typeof value !== "string" || !CALENDAR_DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) return { ok: false };
  return { ok: true, date: value };
}

export const INVALID_REVERSAL_DATE = {
  error: "VALIDATION_ERROR",
  message: "تاريخ الإلغاء يجب أن يكون بالصيغة YYYY-MM-DD.",
  messageEn: "The cancellation date must be a calendar day, YYYY-MM-DD.",
} as const;

/** Reads a body that may legitimately be absent — a lifecycle POST often has none. */
export async function readOptionalBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}
