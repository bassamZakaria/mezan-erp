import { describe, expect, it } from "vitest";
import {
  EtaVatSubTypeCode,
  TaxClassificationAlreadyFiledError,
  TaxClassificationFiledUnreadableError,
  TaxClassificationFilingOutcome,
  TaxRateStatusCode,
  type EtaService,
  type EtaSubmission,
  type FrameworkDocument,
  type SalesInvoice,
  type SalesReturnLine,
  type TaxRate,
} from "@mezan/domain";
import { createSalesInvoiceTaxFiling, createSalesReturnTaxFiling } from "./eta-receipts.js";


const DOC_NO = "INV-000900";

function rate(id: string, percent: number, etaSubType: TaxRate["etaSubType"]): TaxRate {
  return { id, code: id, name: id, rate: percent, status: TaxRateStatusCode.Active, etaSubType } as TaxRate;
}

const RATES = [rate("VAT14", 14, EtaVatSubTypeCode.BasicSales), rate("TABLE14", 14, EtaVatSubTypeCode.Exempt)];

function invoiceWith(taxRateId: string | null): SalesInvoice {
  return { id: "I1", docNo: DOC_NO, lines: [{ lineId: "L1", taxRatePercent: 14, taxRateId }] } as unknown as SalesInvoice;
}

function fakeEta(chain: readonly Partial<EtaSubmission>[], requeued: string[]): EtaService {
  const byInternalId = new Map(
    chain.map((submission, index) => {
      const internalId = index === 0 ? DOC_NO : `${DOC_NO}-R${index + 1}`;
      return [internalId, { id: `S${index + 1}`, internalId, ...submission } as EtaSubmission] as const;
    }),
  );
  return {
    findByInternalId: async (internalId: string) => byInternalId.get(internalId) ?? null,
    requeue: async (id: string) => {
      requeued.push(id);
      return {} as EtaSubmission;
    },
  } as unknown as EtaService;
}

function filingFor(submission: Partial<EtaSubmission> | readonly Partial<EtaSubmission>[], taxRates: readonly TaxRate[] = RATES) {
  const requeued: string[] = [];
  const port = createSalesInvoiceTaxFiling({
    eta: fakeEta(Array.isArray(submission) ? submission : [submission as Partial<EtaSubmission>], requeued),
    taxRates: { list: async () => [...taxRates] },
    rebuild: async () => ({ payload: {}, prevalidation: [] }),
  });
  return { port, requeued };
}

const invoicePayload = (subType: string) => ({ invoiceLines: [{ taxableItems: [{ taxType: "T1", subType }] }] });
const receiptPayload = (subType: string) => ({ itemData: [{ taxableItems: [{ taxType: "T1", subType }] }] });

describe("the e-document of an invoice whose line is classified", () => {
  it("leaves an EXCLUDED e-invoice excluded: nothing is rebuilt and nothing is queued", async () => {
    const { port, requeued } = filingFor({ documentType: "invoice", status: "excluded", exclusionReason: "قرار المحاسب", payload: invoicePayload("V009") });
    const outcome = await port.reconcile({ before: invoiceWith(null), after: invoiceWith("TABLE14") });
    expect(outcome).toBe(TaxClassificationFilingOutcome.NotQueued);
    expect(requeued).toEqual([]);
  });

  it("rebuilds and requeues a REJECTED e-invoice even when the classification changes its sub-type", async () => {
    const { port, requeued } = filingFor({ documentType: "invoice", status: "error", payload: invoicePayload("V009") });
    const outcome = await port.reconcile({ before: invoiceWith(null), after: invoiceWith("TABLE14") });
    expect(outcome).toBe(TaxClassificationFilingOutcome.Requeued);
    expect(requeued).toEqual(["S1"]);
  });

  it("allows a REJECTED e-receipt's classification to change its sub-type: the receipt is corrected, not held to what was refused", async () => {
    const { port, requeued } = filingFor({ documentType: "receipt", status: "error", payload: receiptPayload("V009") });
    const outcome = await port.reconcile({ before: invoiceWith(null), after: invoiceWith("TABLE14") });
    expect(outcome).toBe(TaxClassificationFilingOutcome.Requeued);
    expect(requeued).toEqual([]);
  });

  it("holds an ACCEPTED document to the sub-type its FILED payload declares, not to what today's rates would derive", async () => {
    const onlyTable = [rate("TABLE14", 14, EtaVatSubTypeCode.Exempt)];
    for (const [documentType, payload] of [["invoice", invoicePayload("V009")], ["receipt", receiptPayload("V009")]] as const) {
      const { port } = filingFor({ documentType, status: "accepted", payload }, onlyTable);
      await expect(port.reconcile({ before: invoiceWith(null), after: invoiceWith("TABLE14") })).rejects.toBeInstanceOf(TaxClassificationAlreadyFiledError);
    }
    const { port } = filingFor({ documentType: "invoice", status: "accepted", payload: invoicePayload("V003") }, onlyTable);
    expect(await port.reconcile({ before: invoiceWith(null), after: invoiceWith("TABLE14") })).toBe(TaxClassificationFilingOutcome.FiledConsistent);
  });

  it("refuses when the filed payload cannot be read line for line — today's rates never stand in for what was filed", async () => {
    const { port } = filingFor({ documentType: "invoice", status: "accepted", payload: { invoiceLines: [] } });
    await expect(port.reconcile({ before: invoiceWith(null), after: invoiceWith("VAT14") })).rejects.toBeInstanceOf(TaxClassificationFiledUnreadableError);
    const { port: noPayload } = filingFor({ documentType: "receipt", status: "submitted", payload: null });
    await expect(noPayload.reconcile({ before: invoiceWith(null), after: invoiceWith("VAT14") })).rejects.toBeInstanceOf(TaxClassificationFiledUnreadableError);
  });

  it("judges a rejected receipt by its LATEST correction: one already sent holds the classification to what it filed", async () => {
    const rejectedThenSent = [
      { documentType: "receipt", status: "error", payload: receiptPayload("V009") },
      { documentType: "receipt", status: "submitted", payload: receiptPayload("V009") },
    ] as const;
    const { port } = filingFor(rejectedThenSent);
    await expect(port.reconcile({ before: invoiceWith(null), after: invoiceWith("TABLE14") })).rejects.toBeInstanceOf(TaxClassificationAlreadyFiledError);
    expect(await filingFor(rejectedThenSent).port.reconcile({ before: invoiceWith(null), after: invoiceWith("VAT14") })).toBe(TaxClassificationFilingOutcome.FiledConsistent);
  });
});

describe("the e-document of a return whose line a classification names", () => {
  const returned = (taxRateId: string | null) =>
    ({ id: "R1", docNo: DOC_NO, lines: [{ taxRatePercent: 14, taxRateId }] }) as unknown as FrameworkDocument<SalesReturnLine>;

  function returnFiling(submission: Partial<EtaSubmission>) {
    const requeued: string[] = [];
    const rebuilt: string[] = [];
    const port = createSalesReturnTaxFiling({
      eta: fakeEta([submission], requeued),
      taxRates: { list: async () => [...RATES] },
      rebuildCreditNote: async (doc) => {
        rebuilt.push(doc.id);
        return { payload: {}, prevalidation: [] };
      },
    });
    return { port, requeued, rebuilt };
  }

  it("rebuilds and requeues a queued credit note from the classified return", async () => {
    const { port, requeued, rebuilt } = returnFiling({ documentType: "credit_note", status: "ready", payload: invoicePayload("V009") });
    await port.reconcile({ before: returned(null), after: returned("TABLE14") });
    expect([requeued, rebuilt]).toEqual([["S1"], ["R1"]]);
  });

  it("holds a filed credit note or refund receipt to what it was filed under, and leaves an excluded one alone", async () => {
    for (const [documentType, payload] of [["credit_note", invoicePayload("V009")], ["receipt", receiptPayload("V009")]] as const) {
      const { port, requeued } = returnFiling({ documentType, status: "accepted", payload });
      await expect(port.reconcile({ before: returned(null), after: returned("TABLE14") })).rejects.toBeInstanceOf(TaxClassificationAlreadyFiledError);
      await expect(port.reconcile({ before: returned(null), after: returned("VAT14") })).resolves.toBeUndefined();
      expect(requeued).toEqual([]);
    }
    const { port, requeued, rebuilt } = returnFiling({ documentType: "credit_note", status: "excluded", payload: invoicePayload("V009") });
    await port.reconcile({ before: returned(null), after: returned("TABLE14") });
    expect([requeued, rebuilt]).toEqual([[], []]);
  });

  it("leaves a rejected refund receipt to the reissue that follows", async () => {
    const { port, requeued } = returnFiling({ documentType: "receipt", status: "error", payload: receiptPayload("V009") });
    await expect(port.reconcile({ before: returned(null), after: returned("TABLE14") })).resolves.toBeUndefined();
    expect(requeued).toEqual([]);
  });
});
