/**
 * الإيصال الإلكتروني (ETA e-receipt) — a SEPARATE authority mandate from the
 * e-invoice, and a different document entirely.
 *
 * Two differences decide the whole shape of this module:
 *
 *  1. An e-receipt is REPORTED AFTER the sale, not cleared before it. The till
 *     prints, the customer leaves, and the receipt is forwarded to the
 *     authority inside a reporting window. That makes the queue the product:
 *     a shop with no internet keeps selling and the queue drains later, and
 *     the only thing that can go wrong silently is a receipt aging past the
 *     window unnoticed — hence {@link summarizeEtaReceiptQueue}.
 *
 *  2. The UUID is computed by the TILL, before printing, not handed back by
 *     the authority on acceptance. It is the hash of the canonical
 *     serialization of the document, and it is what the QR on the paper
 *     encodes. A reprint must therefore reproduce the stored UUID rather than
 *     recompute or re-mint one — see `EtaService.enqueueReceipt`.
 */

import { ETA_RECEIPT_REPORTING_WINDOW_HOURS, type EtaConfig } from "./config.js";
import { EtaDeviceSerialNotRegisteredError } from "./errors.js";

export { ETA_RECEIPT_REPORTING_WINDOW_HOURS };

/** بيع / مرتجع — the authority's receipt kinds. */
export type EtaReceiptType = "sale" | "refund";

/**
 * EXTERNAL CONTRACT: the authority's receiptType codes. "S" sale, "R" refund —
 * a swapped letter files a refund as a sale.
 */
const RECEIPT_TYPE_CODES: Record<EtaReceiptType, string> = {
  sale: "S",
  refund: "R",
};

const RECEIPT_TYPE_LABELS_AR: Record<EtaReceiptType, string> = {
  sale: "إيصال بيع",
  refund: "إيصال مرتجع",
};

export function getEtaReceiptTypeLabel(type: EtaReceiptType): string {
  return RECEIPT_TYPE_LABELS_AR[type];
}

export type EtaReceiptPaymentMethod = "cash" | "card" | "wallet" | "transfer" | "other";

/** EXTERNAL CONTRACT: the authority's paymentMethod codes. */
const PAYMENT_METHOD_CODES: Record<EtaReceiptPaymentMethod, string> = {
  cash: "C",
  card: "V",
  wallet: "W",
  transfer: "B",
  other: "O",
};

const PAYMENT_METHOD_LABELS_AR: Record<EtaReceiptPaymentMethod, string> = {
  cash: "نقداً",
  card: "بطاقة",
  wallet: "محفظة إلكترونية",
  transfer: "تحويل بنكي",
  other: "أخرى",
};

export function getEtaReceiptPaymentMethodLabel(method: EtaReceiptPaymentMethod): string {
  return PAYMENT_METHOD_LABELS_AR[method];
}

/**
 * The till itself. `deviceSerialNumber` is registered with the authority per
 * POS device and is part of the receipt document — an e-invoice has no
 * equivalent field.
 */
export interface EtaReceiptSellerInput {
  readonly deviceSerialNumber: string;
  /** كود الفرع لدى المصلحة. */
  readonly branchCode: string | null;
  readonly syndicateLicenseNumber?: string | null;
}

/**
 * B2C: the buyer is usually anonymous. `id`/`name` stay null for a walk-in and
 * the authority accepts the receipt without them, which is the whole point of
 * a receipt as opposed to an invoice.
 */
export interface EtaReceiptBuyerInput {
  readonly type: "B" | "P" | "F";
  readonly id: string | null;
  readonly name: string | null;
  readonly mobileNumber?: string | null;
}

/** All amounts are exact decimal strings — the caller passes `Money.toString()`. */
export interface EtaReceiptLineInput {
  /** The shop's own item code. */
  readonly internalCode: string;
  readonly description: string;
  /** "EGS" or "GS1" — which coding scheme `itemCode` belongs to. */
  readonly itemType: string;
  readonly itemCode: string;
  readonly unitType: string;
  readonly quantity: string;
  readonly unitPrice: string;
  /** quantity × unitPrice, before any discount. */
  readonly totalSale: string;
  /** totalSale − commercialDiscount. */
  readonly netSale: string;
  /** netSale + tax − itemDiscount: what this line contributes to totalAmount. */
  readonly total: string;
  readonly commercialDiscount?: string;
  readonly itemDiscount?: string;
  readonly taxSubType: string;
  readonly taxRate: string;
  readonly taxAmount: string;
}

export interface EtaReceiptTaxTotalInput {
  readonly taxType: string;
  readonly amount: string;
}

export interface EtaReceiptInput {
  /** رقم الإيصال — the till's own receipt number; also the submission's internalId. */
  readonly internalId: string;
  readonly issueDateTime: string;
  readonly receiptType: EtaReceiptType;
  /**
   * The UUID of the previous receipt from the same device, which chains the
   * device's receipts so a gap is detectable. Null for the first one.
   */
  readonly previousUuid: string | null;
  /** ISO 4217. Defaults to EGP; anything else needs `exchangeRate`. */
  readonly currency?: string;
  readonly exchangeRate?: string;
  readonly seller: EtaReceiptSellerInput;
  readonly buyer: EtaReceiptBuyerInput;
  readonly paymentMethod: EtaReceiptPaymentMethod;
  readonly lines: readonly EtaReceiptLineInput[];
  readonly totalSales: string;
  readonly totalCommercialDiscount?: string;
  readonly totalItemsDiscount?: string;
  readonly netAmount: string;
  readonly feesAmount?: string;
  readonly totalAmount: string;
  readonly taxTotals: readonly EtaReceiptTaxTotalInput[];
  /** رقم المرجع للإيصال الأصلي — required on a refund. */
  readonly referenceOldUuid?: string | null;
}

const DEFAULT_RECEIPT_CURRENCY = "EGP";

/**
 * The receipt document, which is NOT the invoice document with different
 * values: it nests its identity under `header`, names the parties `seller`
 * and `buyer` (not issuer/receiver), calls the lines `itemData` (not
 * invoiceLines), and carries `deviceSerialNumber`, `paymentMethod` and
 * `previousUUID`, none of which exist on an invoice. Reusing the invoice
 * builder would file a document the receipt endpoint rejects.
 *
 * `uuid` is left out here on purpose — it is the hash OF this payload, added
 * once computed (see {@link canonicalizeEtaDocument}).
 */
export function buildEtaReceiptPayload(input: EtaReceiptInput, config: EtaConfig): Record<string, unknown> {
  // EXTERNAL CONTRACT: the authority binds an e-receipt to the POS device that
  // issued it. A blank serial is accepted by this builder's own shape and
  // rejected by the authority, so it is refused here instead of being reported.
  if (input.seller.deviceSerialNumber.trim() === "") {
    throw new EtaDeviceSerialNotRegisteredError(input.seller.branchCode);
  }
  const currency = input.currency ?? DEFAULT_RECEIPT_CURRENCY;
  return {
    header: {
      dateTimeIssued: input.issueDateTime,
      receiptNumber: input.internalId,
      uuid: "",
      previousUUID: input.previousUuid ?? "",
      referenceOldUUID: input.referenceOldUuid ?? "",
      currency,
      exchangeRate: currency === DEFAULT_RECEIPT_CURRENCY ? "0" : (input.exchangeRate ?? "0"),
    },
    documentType: {
      receiptType: RECEIPT_TYPE_CODES[input.receiptType],
      typeVersion: config.documentVersion,
    },
    seller: {
      rin: config.taxRegistrationNumber,
      companyTradeName: null,
      branchCode: input.seller.branchCode,
      deviceSerialNumber: input.seller.deviceSerialNumber,
      syndicateLicenseNumber: input.seller.syndicateLicenseNumber ?? "",
      activityCode: config.activityCode,
      branchAddress: config.address
        ? {
            governate: config.address.governorate,
            regionCity: config.address.city,
            street: config.address.street,
            buildingNumber: config.address.buildingNumber,
            postalCode: config.address.postalCode,
          }
        : null,
    },
    buyer: {
      type: input.buyer.type,
      id: input.buyer.id,
      name: input.buyer.name,
      mobileNumber: input.buyer.mobileNumber ?? "",
    },
    itemData: input.lines.map((l) => ({
      internalCode: l.internalCode,
      description: l.description,
      itemType: l.itemType,
      itemCode: l.itemCode,
      unitType: l.unitType,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      netSale: l.netSale,
      totalSale: l.totalSale,
      total: l.total,
      commercialDiscountData: l.commercialDiscount
        ? [{ amount: l.commercialDiscount, description: "خصم تجاري" }]
        : [],
      itemDiscountData: l.itemDiscount ? [{ amount: l.itemDiscount, description: "خصم" }] : [],
      taxableItems: [{ taxType: "T1", amount: l.taxAmount, subType: l.taxSubType, rate: l.taxRate }],
    })),
    totalSales: input.totalSales,
    totalCommercialDiscount: input.totalCommercialDiscount ?? "0",
    totalItemsDiscount: input.totalItemsDiscount ?? "0",
    netAmount: input.netAmount,
    feesAmount: input.feesAmount ?? "0",
    totalAmount: input.totalAmount,
    taxTotals: input.taxTotals.map((t) => ({ taxType: t.taxType, amount: t.amount })),
    paymentMethod: PAYMENT_METHOD_CODES[input.paymentMethod],
    adjustment: "0",
  };
}

/**
 * EXTERNAL CONTRACT — the authority's canonical serialization, the string the
 * receipt UUID is the SHA-256 of. Field names are upper-cased and quoted,
 * string values are quoted with `"` escaped, an object is emitted as its
 * fields in declaration order, and an array repeats the property name once per
 * element before serializing it. A deviation here produces a UUID the
 * authority will not recognise, so the shape is fixed, not stylistic.
 */
export function canonicalizeEtaDocument(document: Record<string, unknown>): string {
  return serializeObject(document);
}

function serializeObject(value: Record<string, unknown>): string {
  let out = "";
  for (const [key, child] of Object.entries(value)) {
    out += serializeProperty(key, child);
  }
  return out;
}

function serializeProperty(key: string, value: unknown): string {
  const name = `"${key.toUpperCase()}"`;
  if (Array.isArray(value)) {
    let out = name;
    for (const element of value) {
      out += name;
      out += serializeValue(element);
    }
    return out;
  }
  return name + serializeValue(value);
}

function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return `""`;
  if (typeof value === "object") return serializeObject(value as Record<string, unknown>);
  if (typeof value === "string") return `"${value.replace(/"/g, '\\"')}"`;
  return `"${String(value)}"`;
}

/**
 * SHA-256 port. `node:crypto` may not be imported inside @mezan/domain (the
 * same boundary the webhook signature port exists for), so the primitive is
 * injected and this package only decides WHAT gets hashed.
 */
export interface EtaReceiptUuidPort {
  /** Lowercase hex SHA-256 of the UTF-8 bytes of `canonical`. */
  compute(canonical: string): Promise<string>;
}

export class EtaReceiptUuidUnavailableError extends Error {
  readonly code = "ETA_RECEIPT_UUID_UNAVAILABLE";
  constructor() {
    super(
      "لا يمكن إصدار إيصال إلكتروني: لم تُهيَّأ خدمة حساب المعرِّف (UUID). " +
        "The e-receipt UUID port is not wired in this deployment.",
    );
    this.name = "EtaReceiptUuidUnavailableError";
  }
}

/**
 * The default port: it refuses rather than inventing a UUID. A made-up
 * identifier prints a QR that resolves to nothing at the authority, which is
 * indistinguishable from a working receipt until an inspector scans it.
 */
export function unavailableEtaReceiptUuidPort(): EtaReceiptUuidPort {
  return {
    async compute(): Promise<string> {
      throw new EtaReceiptUuidUnavailableError();
    },
  };
}

const HOUR_MS = 3_600_000;

export function etaReceiptReportingDeadline(
  issuedAt: string,
  windowHours: number = ETA_RECEIPT_REPORTING_WINDOW_HOURS,
): string {
  return new Date(Date.parse(issuedAt) + windowHours * HOUR_MS).toISOString();
}

/** Hours remaining before the window closes; negative once it has passed. */
export function etaReceiptHoursRemaining(
  issuedAt: string,
  now: string,
  windowHours: number = ETA_RECEIPT_REPORTING_WINDOW_HOURS,
): number {
  return (Date.parse(etaReceiptReportingDeadline(issuedAt, windowHours)) - Date.parse(now)) / HOUR_MS;
}

/** Reads the sale moment out of a receipt payload, falling back to the enqueue stamp. */
export function etaReceiptIssuedAt(submission: {
  readonly payload: unknown;
  readonly createdAt: string;
}): string {
  const payload = submission.payload as { header?: { dateTimeIssued?: unknown } } | null;
  const issued = payload?.header?.dateTimeIssued;
  return typeof issued === "string" && issued !== "" ? issued : submission.createdAt;
}

export interface EtaReceiptQueueEntry {
  readonly id: string;
  readonly internalId: string;
  readonly issuedAt: string;
  readonly deadline: string;
  readonly hoursRemaining: number;
}

/**
 * ما لم يُبلَّغ بعد — what the till has printed and the authority has not seen.
 * `overdue` is the count that matters legally; it is reported separately from
 * `pending` because a growing pending count while offline is normal and an
 * overdue count above zero never is.
 */
export interface EtaReceiptQueueSummary {
  readonly pending: number;
  readonly overdue: number;
  /**
   * Pending, inside the window, and close to its end — the last 24 hours, or
   * the second half of the window when the window itself is shorter than that.
   * A fixed 24 made every pending receipt "due soon" on a 24-hour window.
   */
  readonly dueSoon: number;
  readonly oldestPendingIssuedAt: string | null;
  readonly windowHours: number;
  readonly overdueEntries: readonly EtaReceiptQueueEntry[];
}

/** Statuses that mean the authority has not yet been told about this receipt. */
const UNREPORTED_STATUSES = new Set(["ready", "pending_signature", "error"]);

export function summarizeEtaReceiptQueue(
  submissions: readonly {
    readonly id: string;
    readonly internalId: string;
    readonly documentType: string;
    readonly status: string;
    readonly payload: unknown;
    readonly createdAt: string;
  }[],
  now: string,
  windowHours: number = ETA_RECEIPT_REPORTING_WINDOW_HOURS,
): EtaReceiptQueueSummary {
  const unreported = submissions
    .filter((s) => s.documentType === "receipt" && UNREPORTED_STATUSES.has(s.status))
    .map((s) => {
      const issuedAt = etaReceiptIssuedAt(s);
      return {
        id: s.id,
        internalId: s.internalId,
        issuedAt,
        deadline: etaReceiptReportingDeadline(issuedAt, windowHours),
        hoursRemaining: etaReceiptHoursRemaining(issuedAt, now, windowHours),
      };
    })
    .sort((a, b) => (a.issuedAt < b.issuedAt ? -1 : a.issuedAt > b.issuedAt ? 1 : 0));

  const overdueEntries = unreported.filter((e) => e.hoursRemaining <= 0);
  const dueSoonThreshold = Math.min(24, windowHours / 2);
  return {
    pending: unreported.length,
    overdue: overdueEntries.length,
    dueSoon: unreported.filter((e) => e.hoursRemaining > 0 && e.hoursRemaining <= dueSoonThreshold).length,
    oldestPendingIssuedAt: unreported[0]?.issuedAt ?? null,
    windowHours,
    overdueEntries,
  };
}

/**
 * EXTERNAL CONTRACT: what the QR on the paper encodes — the authority's own
 * share URL for the receipt. Scanning it must land on the receipt at the ETA
 * portal, so neither the host nor the path shape is ours to choose.
 */
const ETA_RECEIPT_PORTAL_BASE: Record<EtaConfig["environment"], string> = {
  production: "https://invoicing.eta.gov.eg",
  preproduction: "https://preprod.invoicing.eta.gov.eg",
};

export function etaReceiptQrValue(args: {
  readonly uuid: string;
  readonly issueDateTime: string;
  readonly environment: EtaConfig["environment"];
}): string {
  const base = ETA_RECEIPT_PORTAL_BASE[args.environment];
  return `${base}/receipts/search/${args.uuid}/share/${encodeURIComponent(args.issueDateTime)}`;
}
