import { describe, expect, it } from "vitest";
import { fxLateReleaseEntryId, realisedFxEntryId, realisedFxReversalId } from "../vouchers/realised-fx.js";
import { purchaseInvoiceCancelEntryId } from "../purchasing/purchase-invoice.js";
import { goodsReceiptCancelEntryId } from "../purchasing/goods-receipt.js";
import { salesInvoiceVoidEntryId } from "../sales-invoices/sales-invoice.js";
import { assetDisposalEntryId } from "../fixed-assets/undo-asset-disposal.js";
import { STOCK_ADJUSTMENT_MIRROR_ENTRY_SUFFIX } from "../inventory/stock-ledger-dates.js";
import { ReservedJournalEntryIdError, isReservedJournalEntryId } from "./reserved-entry-ids.js";

describe("ids reserved for the system's own journal entries", () => {
  it.each([
    realisedFxEntryId("al-1"),
    realisedFxReversalId(realisedFxEntryId("al-1")),
    fxLateReleaseEntryId("inv-1", "al-1", 0),
    purchaseInvoiceCancelEntryId("pi-1"),
    goodsReceiptCancelEntryId("gr-1"),
    salesInvoiceVoidEntryId("inv-1"),
    assetDisposalEntryId("asset-1"),
    `adj-1${STOCK_ADJUSTMENT_MIRROR_ENTRY_SUFFIX}`,
    "PI-JE:pi-1",
    "CHQ-JE:v-1",
    "HIST-SI-JE:inv-1",
    "OPENING-TB:2026-01-01",
    "OB-CUST-JE:cust-1:v2",
    "cert-1-DED",
    "cert-1-DED-VOID",
  ])("%s — an id the system mints — is reserved", (id) => {
    expect(isReservedJournalEntryId(id)).toBe(true);
  });

  it.each(["4be458e5-2c98-4a2b-9f6e-5d0d3b480cf5", "je-1", "mj-ctl", "SCN-X-0042", "قيد-1"])("%s — an id a person or the web client sends — is not", (id) => {
    expect(isReservedJournalEntryId(id)).toBe(false);
  });

  it("the refusal is Arabic with an English twin and names the id", () => {
    const refusal = new ReservedJournalEntryIdError("FXR:release:x");
    expect(refusal.code).toBe("JOURNAL_ENTRY_ID_RESERVED");
    expect(refusal.message).toMatch(/[؀-ۿ]/);
    expect(refusal.message).toContain("FXR:release:x");
    expect(refusal.messageEn).toContain("FXR:release:x");
  });
});
