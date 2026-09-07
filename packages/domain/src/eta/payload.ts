import type { EtaConfig } from "./config.js";
import type { EtaDocumentType } from "./submission.js";

/**
 * Builds the ETA document payload from a confirmed source document. This is a
 * faithful-shape subset of the ETA document JSON (issuer/receiver/invoiceLines/
 * taxTotals/totalAmount) — enough to queue and (later) transmit — not the full
 * schema. Amounts are exact decimal strings (the caller passes Money.toString()).
 */

export interface EtaPartyInput {
  readonly registrationNumber: string | null;
  readonly name: string;
  readonly type: "B" | "P" | "F"; // Business / Person / Foreigner (ETA receiver types)
}

export interface EtaLineInput {
  readonly description: string;
  /** ETA item code (GS1/EGS), from the item mapping. */
  readonly itemCode: string;
  readonly quantity: string;
  /** The authority's unit-of-measure code, from the unit mapping. */
  readonly unitType: string;
  readonly unitPrice: string;
  readonly netTotal: string;
  /** VAT sub-type code (V009/V003/…) + rate + amount. */
  readonly taxSubType: string;
  readonly taxRate: string;
  readonly taxAmount: string;
}

/**
 * The invoice document covers فاتورة/إشعار خصم/إشعار إضافة only. An
 * `EtaDocumentType` of "receipt" is a different document with a different
 * shape and a different endpoint — see receipt.ts — and excluding it here is
 * what stops it being filed through the wrong builder.
 */
export type EtaInvoiceDocumentType = Exclude<EtaDocumentType, "receipt">;

export interface EtaDocumentInput {
  readonly internalId: string;
  readonly documentType: EtaInvoiceDocumentType;
  /** ISO datetime the document was issued/confirmed. */
  readonly issueDateTime: string;
  readonly receiver: EtaPartyInput;
  /** كود الفرع لدى المصلحة — the issuing branch's registered code. */
  readonly branchCode: string | null;
  readonly lines: readonly EtaLineInput[];
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalAmount: string;
}

const DOCUMENT_TYPE_CODES: Record<EtaInvoiceDocumentType, string> = {
  invoice: "I",
  credit_note: "C",
  debit_note: "D",
};

export function buildEtaPayload(input: EtaDocumentInput, config: EtaConfig): unknown {
  return {
    documentType: DOCUMENT_TYPE_CODES[input.documentType],
    documentTypeVersion: config.documentVersion,
    dateTimeIssued: input.issueDateTime,
    taxpayerActivityCode: config.activityCode,
    internalId: input.internalId,
    issuer: {
      type: "B",
      id: config.taxRegistrationNumber,
      address: config.address
        ? {
            governate: config.address.governorate,
            regionCity: config.address.city,
            street: config.address.street,
            buildingNumber: config.address.buildingNumber,
            postalCode: config.address.postalCode,
            branchId: input.branchCode,
          }
        : null,
    },
    receiver: {
      type: input.receiver.type,
      id: input.receiver.registrationNumber,
      name: input.receiver.name,
    },
    invoiceLines: input.lines.map((l) => ({
      description: l.description,
      itemCode: l.itemCode,
      quantity: l.quantity,
      unitType: l.unitType,
      unitValue: { currencySold: "EGP", amountEGP: l.unitPrice },
      netTotal: l.netTotal,
      taxableItems: [
        { taxType: "T1", subType: l.taxSubType, rate: l.taxRate, amount: l.taxAmount },
      ],
    })),
    totalSalesAmount: input.totalNet,
    totalTaxAmount: input.totalTax,
    totalAmount: input.totalAmount,
  };
}
