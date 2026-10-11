import { describe, expect, it } from "vitest";
import {
  EtaVatSubTypeCode,
  TaxClassificationAlreadyFiledError,
  TaxClassificationFilingOutcome,
  TaxRateStatusCode,
  type EtaService,
  type EtaSubmission,
  type SalesInvoice,
  type TaxRate,
} from "@mezan/domain";
import { createSalesInvoiceTaxFiling } from "./eta-receipts.js";

/**
 * What a tax classification may do to the e-document of its invoice, by the
 * state that document is in (D79 round 5).
 */

const DOC_NO = "INV-000900";

function rate(id: string, percent: number, etaSubType: TaxRate["etaSubType"]): TaxRate {
  return { id, code: id, name: id, rate: percent, status: TaxRateStatusCode.Active, etaSubType } as TaxRate;
}

const RATES = [rate("VAT14", 14, EtaVatSubTypeCode.BasicSales), rate("TABLE14", 14, EtaVatSubTypeCode.Exempt)];

function invoiceWith(taxRateId: string | null): SalesInvoice {
  return { id: "I1", docNo: DOC_NO, lines: [{ lineId: "L1", taxRatePercent: 14, taxRateId }] } as unknown as SalesInvoice;
}

function filingFor(submission: Partial<EtaSubmission>, taxRates: readonly TaxRate[] = RATES) {
  const requeued: string[] = [];
  const port = createSalesInvoiceTaxFiling({
    eta: {
      findByInternalId: async () => ({ id: "S1", internalId: DOC_NO, ...submission }) as EtaSubmission,
      requeue: async (id: string) => {
        requeued.push(id);
        return {} as EtaSubmission;
      },
    } as unknown as EtaService,
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
});
