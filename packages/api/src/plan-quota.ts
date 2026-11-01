import type { Context } from "hono";
import {
  BYTES_PER_MB,
  LimitKind,
  LIMIT_OF_QUOTA,
  limitRefusal,
  QuotaKind,
  tenantMonthOf,
  usedStorageMb,
  type Entitlements,
  type LimitRefusal,
  type PlanLabel,
} from "@mezan/domain";
import { tenantToday } from "./tenant-day.js";

/**
 * Plan usage quotas, enforced at CREATION only (DEC-31 rule 6).
 *
 * The count is always recomputed here from stored rows for the tenant's own
 * calendar month — never taken from the request, and never from the UTC day,
 * which in Cairo is the previous month for three hours on the 1st.
 *
 * A quota may only ever refuse a NEW document. Nothing here is reachable from
 * a return, a void, a reversal, a collection against an existing invoice, the
 * e-receipt of a recorded sale, a period close, an export or any read: those
 * routes do not call `withQuota`, and the guard is opt-in per route rather
 * than mounted as middleware precisely so that stays true by construction.
 */
export interface QuotaEnforcement {
  /** Rows already recorded against `kind` in the tenant month `month` (`YYYY-MM`). */
  readonly countInMonth: (kind: QuotaKind, month: string) => Promise<number>;
  /**
   * Runs `fn` in ONE serialized write transaction. The recount and the insert
   * must share it, or two creates at 99/100 both read 99 and both succeed.
   */
  readonly serializeWrite: <T>(fn: () => Promise<T>) => Promise<T>;
}

export class QuotaReachedError extends Error {
  constructor(readonly refusal: LimitRefusal) {
    super(refusal.message);
    this.name = "QuotaReachedError";
  }
}

export function planLabelOf(entitlements: Entitlements): PlanLabel & { readonly code: string } {
  return {
    code: entitlements.plan,
    nameAr: entitlements.planNameAr ?? entitlements.plan,
    nameEn: entitlements.planNameEn ?? entitlements.plan,
  };
}

export function allowedQuota(entitlements: Entitlements | undefined, kind: QuotaKind): number | null {
  const value = entitlements?.quotas?.[kind];
  return typeof value === "number" ? value : null;
}

/** The tenant's own calendar month, `YYYY-MM`. */
export async function tenantMonth(c: Context, today?: () => string): Promise<string> {
  return tenantMonthOf(await tenantToday(c, today));
}

export interface WithQuotaResult<T> {
  readonly refusal: LimitRefusal | null;
  readonly value: T | null;
}

/**
 * Checks `kind` before the write transaction — so the refusal is cheap and
 * names the limit — and again INSIDE it, which is the check that actually
 * holds under concurrency.
 */
export async function withQuota<T>(
  c: Context,
  quota: QuotaEnforcement | undefined,
  kind: QuotaKind,
  write: () => Promise<T>,
  today?: () => string,
): Promise<WithQuotaResult<T>> {
  const entitlements = c.get("entitlements");
  const allowed = allowedQuota(entitlements, kind);
  if (!quota || allowed === null || !entitlements) return { refusal: null, value: await write() };

  const limit: LimitKind = LIMIT_OF_QUOTA[kind];
  const month = await tenantMonth(c, today);
  const plan = planLabelOf(entitlements);

  const usedBefore = await quota.countInMonth(kind, month);
  if (usedBefore >= allowed) return { refusal: limitRefusal(limit, allowed, usedBefore, plan), value: null };

  try {
    const value = await quota.serializeWrite(async () => {
      const used = await quota.countInMonth(kind, month);
      if (used >= allowed) throw new QuotaReachedError(limitRefusal(limit, allowed, used, plan));
      return write();
    });
    return { refusal: null, value };
  } catch (err) {
    if (err instanceof QuotaReachedError) return { refusal: err.refusal, value: null };
    throw err;
  }
}

export interface StorageEnforcement {
  readonly usedBytes: () => Promise<number>;
  readonly serializeWrite: <T>(fn: () => Promise<T>) => Promise<T>;
}

/**
 * The plan's attachment storage, checked before a NEW file is stored. Like
 * `withQuota` it checks once cheaply and again inside the serialized write, so
 * two uploads racing for the last megabytes cannot both land. Nothing already
 * stored is ever refused: reading, downloading and deleting never come here.
 */
export async function withStorageQuota<T>(
  c: Context,
  storage: StorageEnforcement | undefined,
  incomingBytes: number,
  write: () => Promise<T>,
): Promise<WithQuotaResult<T>> {
  const entitlements = c.get("entitlements");
  const allowedMb = allowedQuota(entitlements, QuotaKind.StorageMb);
  if (!storage || allowedMb === null || !entitlements) return { refusal: null, value: await write() };

  const allowedBytes = allowedMb * BYTES_PER_MB;
  const plan = planLabelOf(entitlements);
  const refusalAt = (used: number) => limitRefusal(LimitKind.StorageMb, allowedMb, usedStorageMb(used), plan);

  const usedBefore = await storage.usedBytes();
  if (usedBefore + incomingBytes > allowedBytes) return { refusal: refusalAt(usedBefore), value: null };

  try {
    const value = await storage.serializeWrite(async () => {
      const used = await storage.usedBytes();
      if (used + incomingBytes > allowedBytes) throw new QuotaReachedError(refusalAt(used));
      return write();
    });
    return { refusal: null, value };
  } catch (err) {
    if (err instanceof QuotaReachedError) return { refusal: err.refusal, value: null };
    throw err;
  }
}

/** The 409 a quota refusal answers with: bilingual, naming the limit and what has already been used. */
export function quotaRefusalResponse(c: Context, refusal: LimitRefusal): Response {
  return c.json(refusal, 409);
}
