import type { Context } from "hono";
import type { DocumentService, FrameworkDocument } from "@mezan/domain";
import { voidReturnSchema } from "@mezan/contracts";
import { callerUserId } from "./permission-gate.js";
import { tenantDay, tenantToday } from "./tenant-day.js";

export const VOID_REASON_REQUIRED = {
  error: "VOID_REASON_REQUIRED",
  message: "سبب الإلغاء مطلوب: اكتب لماذا يُلغى هذا المرتجع، ويُحفظ السبب عليه وفي سجل المراجعة.",
  messageEn: "A reason is required: say why this return is being voided. It is kept on the return and in the audit trail.",
} as const;

export interface VoidedReturn<Line> {
  readonly original: FrameworkDocument<Line>;
  readonly reversal: FrameworkDocument<Line>;
  readonly reason: string;
}

export const isReturnMirror = (doc: { readonly reversesDocId: string | null }): boolean => doc.reversesDocId !== null;

export async function voidReasonOf<Line>(service: DocumentService<Line>, doc: FrameworkDocument<Line>): Promise<string | null> {
  if (!doc.reversedByDocId) return null;
  return (await service.findById(doc.reversedByDocId))?.memo ?? null;
}

// INVARIANT: every guard on a return's void lives in the service's
// `reverseGuard`, which reads the return inside the reversal's transaction.
// This reads nothing about the return's state.
export async function voidReturn<Line>(c: Context, service: DocumentService<Line>, id: string): Promise<VoidedReturn<Line> | null> {
  const parsed = voidReturnSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return null;
  const date = parsed.data.date ? await tenantDay(c, parsed.data.date) : await tenantToday(c);
  const { original, reversal } = await service.reverse(id, {
    reversalId: `${id}:void`,
    date,
    memo: parsed.data.reason,
    reason: parsed.data.reason,
    actor: callerUserId(c),
  });
  return { original, reversal, reason: parsed.data.reason };
}
