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

import type { BilingualReason } from "../collections/errors.js";
import { ETA_RECEIPT_REPORTING_WINDOW_HOURS, type EtaConfig } from "./config.js";
import {
  EtaBuyerIdentityRequiredError,
  EtaDeviceSerialNotRegisteredError,
  EtaReceiptNotReadyError,
  EtaRefundReferenceRequiredError,
} from "./errors.js";
import { EtaMissingExchangeRateError } from "./payload.js";

export { ETA_RECEIPT_REPORTING_WINDOW_HOURS };

/** بيع / مرتجع — the authority's receipt kinds. */
export type EtaReceiptType = "sale" | "refund";

/**
 * EXTERNAL CONTRACT (SDK, Receipt v1.2 / Return Receipt v1.2): receiptType is
 * "s" for a sale and "r" for a return, lower case, at typeVersion "1.2". The
 * e-invoice's `documentVersion` (0.9/1.0) is a different regime's version and
 * must never leak into a receipt.
 */
const RECEIPT_TYPE_CODES: Record<EtaReceiptType, string> = {
  sale: "s",
  refund: "r",
};

export const ETA_RECEIPT_TYPE_VERSION = "1.2";

const RECEIPT_TYPE_LABELS_AR: Record<EtaReceiptType, string> = {
  sale: "إيصال بيع",
  refund: "إيصال مرتجع",
};

export function getEtaReceiptTypeLabel(type: EtaReceiptType): string {
  return RECEIPT_TYPE_LABELS_AR[type];
}

export type EtaReceiptPaymentMethod =
  | "cash"
  | "card"
  | "wallet"
  | "transfer"
  | "voucher"
  | "gift_card"
  | "points"
  | "other";

export const ETA_RECEIPT_PAYMENT_METHODS: readonly EtaReceiptPaymentMethod[] = [
  "cash",
  "card",
  "wallet",
  "transfer",
  "voucher",
  "gift_card",
  "points",
  "other",
];

/**
 * EXTERNAL CONTRACT: the SDK's Payment Methods code table is C, V, CC, VC, VO,
 * PR, GC, P, O. It has no wallet or bank-transfer code, so both are filed as
 * O (Others) — a letter outside the table is rejected by the code validator.
 */
const PAYMENT_METHOD_CODES: Record<EtaReceiptPaymentMethod, string> = {
  cash: "C",
  card: "V",
  wallet: "O",
  transfer: "O",
  voucher: "VO",
  gift_card: "GC",
  points: "P",
  other: "O",
};

const PAYMENT_METHOD_LABELS_AR: Record<EtaReceiptPaymentMethod, string> = {
  cash: "نقداً",
  card: "بطاقة",
  wallet: "محفظة إلكترونية",
  transfer: "تحويل بنكي",
  voucher: "قسيمة شراء",
  gift_card: "بطاقة هدية",
  points: "نقاط",
  other: "أخرى",
};

export function getEtaReceiptPaymentMethodLabel(method: EtaReceiptPaymentMethod): string {
  return PAYMENT_METHOD_LABELS_AR[method];
}

export function etaReceiptPaymentMethodCode(method: EtaReceiptPaymentMethod): string {
  return PAYMENT_METHOD_CODES[method];
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
  /** الاسم التجاري — mandatory on the receipt's seller block. */
  readonly companyTradeName?: string | null;
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
  /** A payment reference such as a card authorisation code. */
  readonly paymentNumber?: string | null;
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
  /** header.referenceUUID — the SALE receipt a refund returns. Required on a refund, refused on a sale. */
  readonly referenceUuid?: string | null;
  /**
   * header.referenceOldUUID — ONLY for re-issuing a receipt the authority
   * rejected, pointing at the rejected one's UUID. It is not the sale a refund
   * returns; that is {@link referenceUuid}.
   */
  readonly referenceOldUuid?: string | null;
}

const DEFAULT_RECEIPT_CURRENCY = "EGP";
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * EXTERNAL CONTRACT: every receipt amount is "a decimal number up to 5
 * decimal precisions" (SDK Main Calculations). `Money.toString()` carries six,
 * so each figure is rounded half away from zero to a fixed 5 places here — and
 * the same string is what gets hashed and what gets transmitted.
 */
export function etaReceiptDecimal(value: string, places = 5): string {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new RangeError(`Not a decimal amount: "${value}"`);
  const [, sign = "", whole = "0", frac = ""] = match;
  const padded = (frac + "0".repeat(places + 1)).slice(0, places + 1);
  let scaled = BigInt(whole + padded.slice(0, places));
  if (Number(padded[places]) >= 5) scaled += 1n;
  const unit = 10n ** BigInt(places);
  const intPart = scaled / unit;
  const fracPart = (scaled % unit).toString().padStart(places, "0");
  const negative = sign === "-" && scaled !== 0n;
  return `${negative ? "-" : ""}${intPart}${places > 0 ? `.${fracPart}` : ""}`;
}

/** EXTERNAL CONTRACT: dateTimeIssued is UTC, `yyyy-MM-ddTHH:mm:ssZ` — the sale moment, to the second. */
export function etaReceiptDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError(`Not a date-time: "${iso}"`);
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * EXTERNAL CONTRACT: the canonical text keeps a value raw while the JSON body
 * escapes it, so a backslash, a double quote or a control character would hash
 * one way here and could re-serialize another at the authority. Free text is
 * stripped of them before it is hashed; `32"` becomes `32`.
 */
export function etaReceiptText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f"\\]/g, "").replace(/\s+/g, " ").trim();
}

/** SDK Receipt v1.2 buyer: at or above this total (EGP) a natural person needs national ID and name. */
export const ETA_RECEIPT_BUYER_ID_THRESHOLD_EGP = "150000";

function scaled5(value: string): bigint {
  return BigInt(etaReceiptDecimal(value).replace(".", ""));
}

/** Seller data the SDK's core-field validator requires; refused before the UUID is minted. */
function sellerReadiness(input: EtaReceiptInput, config: EtaConfig): BilingualReason[] {
  const reasons: BilingualReason[] = [];
  if (!/^\d{9}$/.test(config.taxRegistrationNumber ?? "")) reasons.push({ ar: "رقم التسجيل الضريبي (9 أرقام)", en: "the tax registration number (9 digits)" });
  if (!present(config.activityCode)) reasons.push({ ar: "كود النشاط", en: "the activity code" });
  if (!config.address) reasons.push({ ar: "عنوان المنشأة", en: "the company address" });
  if (!present(input.seller.companyTradeName)) reasons.push({ ar: "الاسم التجاري للمنشأة", en: "the company trade name" });
  if (!present(input.seller.branchCode)) reasons.push({ ar: "كود الفرع لدى المصلحة", en: "the branch code registered with the authority" });
  return reasons;
}

/**
 * The receipt document, which is NOT the invoice document with different
 * values: it nests its identity under `header`, names the parties `seller`
 * and `buyer` (not issuer/receiver), calls the lines `itemData` (not
 * invoiceLines), and carries `deviceSerialNumber`, `paymentMethod` and
 * `previousUUID`, none of which exist on an invoice. Reusing the invoice
 * builder would file a document the receipt endpoint rejects.
 *
 * EXTERNAL CONTRACT: the UUID is the SHA-256 of THIS object's canonical
 * serialization with `uuid` empty, in THIS key order, so the order below is
 * the SDK's table order and an optional field is omitted rather than sent
 * empty — the authority re-serializes exactly what it receives.
 */
export function buildEtaReceiptPayload(input: EtaReceiptInput, config: EtaConfig): Record<string, unknown> {
  // EXTERNAL CONTRACT: the authority binds an e-receipt to the POS device that
  // issued it. A blank serial is accepted by this builder's own shape and
  // rejected by the authority, so it is refused here instead of being reported.
  if (input.seller.deviceSerialNumber.trim() === "") {
    throw new EtaDeviceSerialNotRegisteredError(input.seller.branchCode);
  }
  if (input.receiptType === "refund" && !present(input.referenceUuid)) {
    throw new EtaRefundReferenceRequiredError(input.internalId);
  }
  const notReady = sellerReadiness(input, config);
  if (notReady.length > 0) throw new EtaReceiptNotReadyError(notReady);
  const currency = input.currency ?? DEFAULT_RECEIPT_CURRENCY;
  if (currency !== DEFAULT_RECEIPT_CURRENCY && !present(input.exchangeRate)) {
    throw new EtaMissingExchangeRateError(currency);
  }
  const dec = (value: string | undefined, fallback = "0") => etaReceiptDecimal(value ?? fallback);
  if (input.buyer.type === "P" && (!present(input.buyer.id) || !present(input.buyer.name))) {
    const totalEgp =
      currency === DEFAULT_RECEIPT_CURRENCY
        ? scaled5(input.totalAmount)
        : (scaled5(input.totalAmount) * scaled5(input.exchangeRate ?? "0")) / 100000n;
    if (totalEgp >= scaled5(ETA_RECEIPT_BUYER_ID_THRESHOLD_EGP)) {
      throw new EtaBuyerIdentityRequiredError(ETA_RECEIPT_BUYER_ID_THRESHOLD_EGP);
    }
  }

  const header: Record<string, unknown> = {
    dateTimeIssued: etaReceiptDateTime(input.issueDateTime),
    receiptNumber: input.internalId,
    uuid: "",
    previousUUID: input.previousUuid ?? "",
  };
  if (input.receiptType === "refund") header.referenceUUID = input.referenceUuid;
  if (present(input.referenceOldUuid)) header.referenceOldUUID = input.referenceOldUuid;
  header.currency = currency;
  header.exchangeRate = currency === DEFAULT_RECEIPT_CURRENCY ? "0" : dec(input.exchangeRate);

  const address = config.address;
  const branchAddress: Record<string, unknown> = {
    country: "EG",
    governate: etaReceiptText(address?.governorate ?? ""),
    regionCity: etaReceiptText(address?.city ?? ""),
    street: etaReceiptText(address?.street ?? ""),
    buildingNumber: etaReceiptText(address?.buildingNumber ?? ""),
  };
  if (present(address?.postalCode)) branchAddress.postalCode = address.postalCode;

  const seller: Record<string, unknown> = {
    rin: config.taxRegistrationNumber ?? "",
    companyTradeName: etaReceiptText(input.seller.companyTradeName ?? ""),
    branchCode: input.seller.branchCode ?? "",
    branchAddress,
    deviceSerialNumber: input.seller.deviceSerialNumber,
  };
  if (present(input.seller.syndicateLicenseNumber)) seller.syndicateLicenseNumber = input.seller.syndicateLicenseNumber;
  seller.activityCode = config.activityCode ?? "";

  const buyer: Record<string, unknown> = { type: input.buyer.type };
  if (present(input.buyer.id)) buyer.id = input.buyer.id;
  if (present(input.buyer.name)) buyer.name = etaReceiptText(input.buyer.name);
  if (present(input.buyer.mobileNumber)) buyer.mobileNumber = input.buyer.mobileNumber;
  if (present(input.buyer.paymentNumber)) buyer.paymentNumber = input.buyer.paymentNumber;

  const itemData = input.lines.map((l) => {
    const line: Record<string, unknown> = {
      internalCode: etaReceiptText(l.internalCode),
      description: etaReceiptText(l.description),
      itemType: l.itemType,
      itemCode: l.itemCode,
      unitType: l.unitType,
      quantity: dec(l.quantity),
      unitPrice: dec(l.unitPrice),
      netSale: dec(l.netSale),
      totalSale: dec(l.totalSale),
      total: dec(l.total),
    };
    if (l.commercialDiscount && etaReceiptDecimal(l.commercialDiscount) !== etaReceiptDecimal("0")) {
      line.commercialDiscountData = [{ amount: dec(l.commercialDiscount), description: "خصم تجاري" }];
    }
    if (l.itemDiscount && etaReceiptDecimal(l.itemDiscount) !== etaReceiptDecimal("0")) {
      line.itemDiscountData = [{ amount: dec(l.itemDiscount), description: "خصم" }];
    }
    line.taxableItems = [
      { taxType: "T1", amount: dec(l.taxAmount), subType: l.taxSubType, rate: etaReceiptDecimal(l.taxRate, 2) },
    ];
    return line;
  });

  return {
    header,
    documentType: {
      receiptType: RECEIPT_TYPE_CODES[input.receiptType],
      typeVersion: ETA_RECEIPT_TYPE_VERSION,
    },
    seller,
    buyer,
    itemData,
    totalSales: dec(input.totalSales),
    totalCommercialDiscount: dec(input.totalCommercialDiscount),
    totalItemsDiscount: dec(input.totalItemsDiscount),
    netAmount: dec(input.netAmount),
    feesAmount: dec(input.feesAmount),
    totalAmount: dec(input.totalAmount),
    taxTotals: input.taxTotals.map((t) => ({ taxType: t.taxType, amount: dec(t.amount) })),
    paymentMethod: PAYMENT_METHOD_CODES[input.paymentMethod],
    adjustment: dec(undefined),
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

/** The receipt fields the SDK types as Decimal. */
const RECEIPT_DECIMAL_KEYS = new Set([
  "exchangeRate",
  "quantity",
  "unitPrice",
  "netSale",
  "totalSale",
  "total",
  "amount",
  "rate",
  "valueDifference",
  "totalSales",
  "totalCommercialDiscount",
  "totalItemsDiscount",
  "netAmount",
  "feesAmount",
  "totalAmount",
  "adjustment",
  "grossWeight",
  "netWeight",
]);

function writeJson(value: unknown, key: string | null): string {
  if (Array.isArray(value)) return `[${value.map((v) => writeJson(v, key)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${JSON.stringify(k)}:${writeJson(v, k)}`);
    return `{${parts.join(",")}}`;
  }
  if (typeof value === "string" && key !== null && RECEIPT_DECIMAL_KEYS.has(key) && DECIMAL.test(value)) {
    return value;
  }
  return JSON.stringify(value ?? null);
}

/**
 * EXTERNAL CONTRACT (SDK, Submit Receipt Documents): the body is
 * `{"receipts":[...],"signatures":[...]}`, with Decimal fields as JSON
 * numbers. Each number is written with exactly the digits the payload holds as
 * a string, so the authority's re-serialization of the number reproduces the
 * canonical text the UUID was hashed from. `signatures` is sent empty, as in
 * the SDK's own batch sample: the SDK states receipt signature validation is
 * not deployed, and a receipt carries no e-seal (D148).
 */
export function serializeEtaReceiptSubmission(receipts: readonly unknown[]): string {
  return `{"receipts":${writeJson(receipts, null)},"signatures":[]}`;
}

/**
 * SHA-256 port. `node:crypto` may not be imported inside @mezan/domain (the
 * same boundary a signing port exists for), so the primitive is
 * injected and this package only decides WHAT gets hashed.
 */
export interface EtaReceiptUuidPort {
  /** Lowercase hex SHA-256 of the UTF-8 bytes of `canonical`. */
  compute(canonical: string): Promise<string>;
}

export class EtaReceiptUuidUnavailableError extends Error {
  readonly code = "ETA_RECEIPT_UUID_UNAVAILABLE";
  readonly messageEn =
    "The e-receipt cannot be issued: the UUID calculation service is not configured in this deployment.";
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

/**
 * EXTERNAL CONTRACT (SDK, Receipt Issuance FAQ): a receipt the authority
 * REJECTED may be corrected and re-issued, referencing header.referenceOldUUID
 * at the rejected receipt's own UUID, only within 96 hours of that rejected
 * receipt's own issuance. Past the window the correction is refused —
 * {@link EtaService.reissueReceipt} is the enforcement point.
 */
export const ETA_RECEIPT_REISSUE_WINDOW_HOURS = 96;

export function etaReceiptReissueDeadline(issuedAt: string): string {
  return new Date(Date.parse(issuedAt) + ETA_RECEIPT_REISSUE_WINDOW_HOURS * HOUR_MS).toISOString();
}

/**
 * SDK, Submit Receipt Documents: `/receiptsubmissions` accepts at most 500
 * receipts per call. {@link EtaService.submitReadyReceipts} chunks a device's
 * queue to this size.
 */
export const ETA_RECEIPT_BATCH_MAX = 500;

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
  /** Consumer sales/returns that should have a receipt and have none; counted in `pending`/`overdue` too. */
  readonly unissued?: number;
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
 * EXTERNAL CONTRACT (SDK, Receipt Issuance FAQ → Receipt QR Code): what the QR
 * on the paper encodes, as one line —
 * `{portal}/receipts/search/{uuid}/share/{dateTimeIssued}#Total:{total},IssuerRIN:{rin}`.
 * Scanning it must land on the receipt at the ETA portal, so neither the host
 * nor the shape is ours to choose.
 */
const ETA_RECEIPT_PORTAL_BASE: Record<EtaConfig["environment"], string> = {
  production: "https://invoicing.eta.gov.eg",
  preproduction: "https://preprod.invoicing.eta.gov.eg",
};

export function etaReceiptQrValue(args: {
  readonly uuid: string;
  readonly issueDateTime: string;
  readonly environment: EtaConfig["environment"];
  readonly totalAmount?: string | null;
  readonly issuerRin?: string | null;
}): string {
  const base = ETA_RECEIPT_PORTAL_BASE[args.environment];
  const url = `${base}/receipts/search/${args.uuid}/share/${args.issueDateTime}`;
  if (!args.totalAmount && !args.issuerRin) return url;
  return `${url}#Total:${args.totalAmount ?? ""},IssuerRIN:${args.issuerRin ?? ""}`;
}
