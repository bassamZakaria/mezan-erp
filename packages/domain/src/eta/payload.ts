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
  /**
   * The unit price converted to EGP. Required on a foreign-currency line and
   * ignored on an EGP one, where it equals {@link unitPrice} by definition.
   */
  readonly unitPriceEgp?: string;
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
  /**
   * The currency the document was RAISED in (ISO 4217). Defaults to EGP.
   *
   * The payload used to hardcode `currencySold: "EGP"` on every line whatever
   * the document's currency, so a USD invoice was filed as though it had been
   * priced in pounds (D78). The authority reads `currencySold` together with
   * `amountEGP`: for a foreign-currency document both the rate and the pound
   * equivalent have to be stated, which is why {@link exchangeRate} is required
   * the moment this is not EGP.
   */
  readonly currency?: string;
  /**
   * Foreign→EGP rate the document was booked at, as an exact decimal string.
   * Required when {@link currency} is not EGP, and refused when it is — a rate
   * on an EGP document is a contradiction the authority rejects.
   */
  readonly exchangeRate?: string | null;
  /**
   * The document this one corrects — the original invoice's internal id.
   *
   * A credit or debit note the authority cannot tie back to an invoice is
   * rejected, so this is required in practice for `credit_note`/`debit_note`
   * and meaningless on an `invoice`.
   */
  readonly referencedDocumentIds?: readonly string[];
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalAmount: string;
}

const DOCUMENT_TYPE_CODES: Record<EtaInvoiceDocumentType, string> = {
  invoice: "I",
  credit_note: "C",
  debit_note: "D",
};

/** The authority states amounts in EGP alongside the currency they were sold in. */
const BASE_CURRENCY = "EGP";

export class EtaMissingExchangeRateError extends Error {
  readonly code = "ETA_MISSING_EXCHANGE_RATE";
  constructor(readonly currency: string) {
    super(`مستند بعملة ${currency} يتطلب سعر صرف مقابل الجنيه قبل الإرسال للمصلحة.`);
    this.name = "EtaMissingExchangeRateError";
  }
}

export function buildEtaPayload(input: EtaDocumentInput, config: EtaConfig): unknown {
  const currency = (input.currency ?? BASE_CURRENCY).toUpperCase();
  const foreign = currency !== BASE_CURRENCY;
  if (foreign && !input.exchangeRate) {
    throw new EtaMissingExchangeRateError(currency);
  }
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
      // `currencySold` is the document's own currency, not a constant: a USD
      // invoice filed as EGP misstates every line (D78). On a foreign document
      // the authority wants the sold amount, the rate, and the EGP equivalent.
      unitValue: foreign
        ? {
            currencySold: currency,
            amountSold: l.unitPrice,
            currencyExchangeRate: input.exchangeRate,
            amountEGP: l.unitPriceEgp ?? l.unitPrice,
          }
        : { currencySold: BASE_CURRENCY, amountEGP: l.unitPrice },
      netTotal: l.netTotal,
      taxableItems: [
        { taxType: "T1", subType: l.taxSubType, rate: l.taxRate, amount: l.taxAmount },
      ],
    })),
    // A note with nothing to correct is filed with no references rather than an
    // empty array, which the authority reads as a malformed document.
    ...(input.referencedDocumentIds?.length ? { references: [...input.referencedDocumentIds] } : {}),
    totalSalesAmount: input.totalNet,
    totalTaxAmount: input.totalTax,
    totalAmount: input.totalAmount,
  };
}
