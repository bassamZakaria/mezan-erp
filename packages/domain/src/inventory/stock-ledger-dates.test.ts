import { describe, expect, it } from "vitest";
import { STOCK_ADJUSTMENT_MIRROR_ENTRY_SUFFIX, stockLedgerDateMismatches } from "./stock-ledger-dates.js";

const moved = (sourceDocId: string, occurredAt: string, sourceDocNumber: string | null = null) => ({ sourceDocType: "ADJUSTMENT", sourceDocId, sourceDocNumber, occurredAt });
const entry = (id: string, date: string, sourceDocId: string | null = null, reversesEntryId: string | null = null) => ({ id, date, sourceDocId, reversesEntryId });

describe("a stock movement and the entry its document posted must fall in the same month", () => {
  it("finds nothing when the movement and its entry share a month, whichever day of it each carries", () => {
    expect(stockLedgerDateMismatches([moved("ADJ-1", "2026-08-03T00:00:00.000Z")], [entry("ADJ-1", "2026-08-31")])).toEqual([]);
    expect(stockLedgerDateMismatches([moved("PI-1", "2026-08-20T00:00:00.000Z")], [entry("PI-JE:PI-1", "2026-08-20", "PI-1")])).toEqual([]);
  });

  it("names the document whose stock moved in one month and whose entry sits in another, with both days", () => {
    expect(stockLedgerDateMismatches([moved("ADJ-2", "2026-08-31T00:00:00.000Z", "ADJ-000002")], [entry("ADJ-2", "2026-09-01")])).toEqual([
      { docType: "ADJUSTMENT", docId: "ADJ-2", docNo: "ADJ-000002", movedOn: "2026-08-31", postedOn: ["2026-09-01"] },
    ]);
  });

  it("a document with several entries is satisfied by any one of them in the movement's month, and reported once per day it moved wrongly", () => {
    const entries = [entry("LC-1", "2026-08-10"), entry("LC-1:ABSORBED", "2026-09-10", "LC-1")];
    expect(stockLedgerDateMismatches([moved("LC-1", "2026-09-10T00:00:00.000Z")], entries)).toEqual([]);
    expect(stockLedgerDateMismatches([moved("LC-1", "2026-10-02T00:00:00.000Z"), moved("LC-1", "2026-10-02T00:00:00.000Z")], entries)).toEqual([
      { docType: "ADJUSTMENT", docId: "LC-1", docNo: null, movedOn: "2026-10-02", postedOn: ["2026-08-10", "2026-09-10"] },
    ]);
  });

  it("a reversal's movements are held to the reversal's own mirror entry, not to the original's", () => {
    const entries = [entry("ADJ-3", "2026-08-18"), entry(`ADJ-3:REVERSAL${STOCK_ADJUSTMENT_MIRROR_ENTRY_SUFFIX}`, "2026-10-13", "ADJ-3")];
    expect(stockLedgerDateMismatches([moved("ADJ-3", "2026-08-18T00:00:00.000Z"), moved("ADJ-3:REVERSAL", "2026-10-13T00:00:00.000Z")], entries)).toEqual([]);
    expect(stockLedgerDateMismatches([moved("ADJ-3:REVERSAL", "2026-08-18T00:00:00.000Z")], entries)).toEqual([
      { docType: "ADJUSTMENT", docId: "ADJ-3:REVERSAL", docNo: null, movedOn: "2026-08-18", postedOn: ["2026-10-13"] },
    ]);
  });

  it("the entry that reverses a document speaks for the reversal document only — it cannot excuse the original's own movement", () => {
    const entries = [entry("ADJ-4", "2026-09-01"), entry("ADJ-4:REVERSAL", "2026-08-20", "ADJ-4", "ADJ-4")];
    expect(stockLedgerDateMismatches([moved("ADJ-4", "2026-08-18T00:00:00.000Z"), moved("ADJ-4:REVERSAL", "2026-08-20T00:00:00.000Z")], entries)).toEqual([
      { docType: "ADJUSTMENT", docId: "ADJ-4", docNo: null, movedOn: "2026-08-18", postedOn: ["2026-09-01"] },
    ]);
  });

  it("a document that posts no entry at all — a transfer between warehouses — has nothing to disagree with", () => {
    expect(stockLedgerDateMismatches([moved("TR-1", "2026-08-18T00:00:00.000Z")], [entry("ADJ-9", "2026-09-01")])).toEqual([]);
  });
});
