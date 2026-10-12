import { Qty } from "../money/index.js";
import type { FrameworkDocument } from "./document.js";
import { InvalidDocumentError } from "./errors.js";
import { overdrawnSourceLines, type ReturnableSourceLine } from "./match-source-lines.js";

export interface ReturnDocumentLine {
  readonly itemId: string;
  readonly sourceInvoiceId: string;
  readonly sourceLineId?: string | null;
  readonly qty: Qty;
  readonly availableQty: Qty;
}

export interface ReturnSourceInvoice {
  readonly lines: readonly ReturnableSourceLine[];
}

// INVARIANT: the ONE test of "this return stands". A voided return is
// `reversed`; the mirror document that voided it is `confirmed` and names it
// in `reversesDocId` — neither took anything off an invoice, a customer or a
// supplier, and no aggregate may count either.
export function isStandingReturn(doc: { readonly status: string; readonly reversesDocId?: string | null }): boolean {
  return doc.status === "confirmed" && !doc.reversesDocId;
}

export type ReturnConfirmGuard<Line> = (doc: FrameworkDocument<Line>) => Promise<void>;

function sourceLineKey(line: ReturnDocumentLine): string {
  return line.sourceLineId ? `${line.sourceInvoiceId}|line|${line.sourceLineId}` : `${line.sourceInvoiceId}|item|${line.itemId}`;
}

export function assertReturnTotalsWithinAvailable(docType: string, docId: string, lines: readonly ReturnDocumentLine[]): void {
  const totals = new Map<string, { itemId: string; requested: Qty; available: Qty }>();
  for (const line of lines) {
    const key = sourceLineKey(line);
    const slot = totals.get(key);
    totals.set(key, {
      itemId: line.itemId,
      requested: (slot?.requested ?? Qty.zero()).add(line.qty),
      available: slot && slot.available.compare(line.availableQty) < 0 ? slot.available : line.availableQty,
    });
  }
  for (const { itemId, requested, available } of totals.values()) {
    if (requested.compare(available) > 0) {
      throw new InvalidDocumentError(
        docType,
        docId,
        `بند الصنف "${itemId}": إجمالي كمية الإرجاع على بند الفاتورة نفسه (${requested.toString()}) يتجاوز المتاح للإرجاع (${available.toString()}).`,
      );
    }
  }
}

// INVARIANT: runs inside the confirm's transaction, against what CONFIRMED
// returns have taken — a draft's own `availableQty` is a snapshot from the day
// it was drafted, and two drafts against one line each hold the whole of it.
export function createReturnConfirmGuard<Line extends ReturnDocumentLine>(
  docType: string,
  findInvoice: (sourceInvoiceId: string) => Promise<ReturnSourceInvoice | null>,
): ReturnConfirmGuard<Line> {
  return async (doc) => {
    if (doc.reversesDocId) return;
    const sourceInvoiceId = doc.lines[0]?.sourceInvoiceId;
    if (!sourceInvoiceId) return;
    const invoice = await findInvoice(sourceInvoiceId);
    if (!invoice) {
      throw new InvalidDocumentError(docType, doc.id, "الفاتورة المصدر غير موجودة أو غير مؤكدة.");
    }
    const { overdrawn, unmatched } = overdrawnSourceLines(invoice.lines, doc.lines);
    const missing = unmatched[0];
    if (missing) {
      throw new InvalidDocumentError(docType, doc.id, `بند الصنف "${missing.itemId}" غير موجود في الفاتورة المصدر.`);
    }
    const first = overdrawn[0];
    if (first) {
      throw new InvalidDocumentError(
        docType,
        doc.id,
        `بند الصنف "${first.line.itemId}": كمية الإرجاع (${first.requested.toString()}) تتجاوز المتاح للإرجاع (${first.available.toString()}).`,
      );
    }
  };
}
