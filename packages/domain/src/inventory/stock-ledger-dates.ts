export const STOCK_ADJUSTMENT_MIRROR_ENTRY_SUFFIX = ":MIRROR";

export interface StockLedgerDateMismatch {
  readonly docType: string;
  readonly docId: string;
  readonly docNo: string | null;
  readonly movedOn: string;
  readonly postedOn: readonly string[];
}

export interface DatedStockMovement {
  readonly sourceDocType: string;
  readonly sourceDocId: string;
  readonly sourceDocNumber: string | null;
  readonly occurredAt: string;
}

export interface DatedJournalEntry {
  readonly id: string;
  readonly date: string;
  readonly sourceDocId: string | null;
  readonly reversesEntryId: string | null;
}

const MONTH = 7;
const DAY = 10;

export function stockLedgerDateMismatches(movements: readonly DatedStockMovement[], entries: readonly DatedJournalEntry[]): StockLedgerDateMismatch[] {
  const postedByDoc = new Map<string, Set<string>>();
  const record = (docId: string, day: string) => postedByDoc.set(docId, (postedByDoc.get(docId) ?? new Set<string>()).add(day));
  for (const entry of entries) {
    const day = entry.date.slice(0, DAY);
    if (entry.id.endsWith(STOCK_ADJUSTMENT_MIRROR_ENTRY_SUFFIX)) {
      record(entry.id.slice(0, -STOCK_ADJUSTMENT_MIRROR_ENTRY_SUFFIX.length), day);
      continue;
    }
    record(entry.id, day);
    if (entry.sourceDocId && !entry.reversesEntryId) record(entry.sourceDocId, day);
  }
  const found = new Map<string, StockLedgerDateMismatch>();
  for (const movement of movements) {
    const posted = postedByDoc.get(movement.sourceDocId);
    if (!posted) continue;
    const movedOn = movement.occurredAt.slice(0, DAY);
    if ([...posted].some((day) => day.slice(0, MONTH) === movedOn.slice(0, MONTH))) continue;
    found.set(`${movement.sourceDocId} ${movedOn}`, { docType: movement.sourceDocType, docId: movement.sourceDocId, docNo: movement.sourceDocNumber, movedOn, postedOn: [...posted].sort() });
  }
  return [...found.values()].sort((a, b) => a.movedOn.localeCompare(b.movedOn) || a.docId.localeCompare(b.docId));
}
