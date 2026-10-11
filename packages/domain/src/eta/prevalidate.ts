/**
 * فحص مسبق للفاتورة الإلكترونية (ETA pre-validation) — ENH-011b / WF-04.
 *
 * The authority rejects a document for reasons the tenant's own data already
 * knows before it is ever transmitted: a company registration field left
 * blank, an item with no EGS/GS1 code, a unit or a VAT sub-type never mapped,
 * a B2B buyer with no tax number, a natural-person buyer above the legal
 * threshold with no national ID, or a payload whose totals do not foot to the
 * source document's own lines. Every one of those is a fact this app can
 * check locally, which is the entire pitch of client-side pre-validation
 * (ETA SDK "Document Validation"; Odoo `l10n_eg_edi` runs the same shape of
 * check before its own POST).
 *
 * This module mirrors the receipt module's `sellerReadiness` (#93): a small
 * pure function that inspects the INPUT the payload would be built from — not
 * the built JSON — because only the input still knows which fields were left
 * to a fallback (an item's own code standing in for a never-mapped EGS code
 * looks identical to a real one once it is baked into the payload).
 *
 * Severity decides how a finding is USED, not whether it is reported:
 *  - `Warning` — the payload still builds (a safe default applies) but the
 *    default may misdeclare the fact, so it is worth fixing before filing.
 *  - `Blocking` — the authority would refuse the document outright.
 * At confirm time every finding is shown and none stop the confirm
 * (`EtaService.enqueue` only WARNS). Before enqueue/submit, `Blocking`
 * findings refuse the transmit (`EtaService.submit`) until a fix and a
 * `requeue` clear them.
 */

import type { EtaConfig } from "./config.js";
import { EtaVatSubTypeCode } from "../tax-rates/tax-rate.js";
import { etaReceiptDecimal } from "./receipt.js";

export enum EtaPrevalidationRuleCode {
  IssuerTaxRegistrationInvalid = "ISSUER_TAX_REGISTRATION_INVALID",
  IssuerActivityCodeMissing = "ISSUER_ACTIVITY_CODE_MISSING",
  IssuerAddressMissing = "ISSUER_ADDRESS_MISSING",
  BranchCodeMissing = "BRANCH_CODE_MISSING",
  ItemCodeMissing = "ITEM_CODE_MISSING",
  UnitNotMapped = "UNIT_NOT_MAPPED",
  TaxSubtypeNotMapped = "TAX_SUBTYPE_NOT_MAPPED",
  BuyerTinMissing = "BUYER_TIN_MISSING",
  BuyerNationalIdRequired = "BUYER_NATIONAL_ID_REQUIRED",
  TotalsMismatch = "TOTALS_MISMATCH",
}

export enum EtaPrevalidationSeverity {
  /** The document still files — under a safe default that may misclassify the fact. */
  Warning = "warning",
  /** The authority would refuse this document; it must not reach submit. */
  Blocking = "blocking",
}

/** Which screen resolves a finding — the UI turns this into an actual link. */
export enum EtaPrevalidationFixScreen {
  IssuerConfig = "issuer_config",
  BranchCodes = "branch_codes",
  ItemMapping = "item_mapping",
  UnitMapping = "unit_mapping",
  TaxRates = "tax_rates",
  Customer = "customer",
  SourceDocument = "source_document",
}

export interface EtaPrevalidationFinding {
  readonly code: EtaPrevalidationRuleCode;
  readonly severity: EtaPrevalidationSeverity;
  readonly messageAr: string;
  readonly messageEn: string;
  readonly fixHintAr: string;
  readonly fixHintEn: string;
  readonly fixScreen: EtaPrevalidationFixScreen;
  /** The item/customer/etc. id the fix screen should open on, when the fix is row-specific. */
  readonly fixRefId?: string | null;
}

export interface EtaPrevalidationLineInput {
  readonly itemId: string;
  readonly itemLabel: string;
  /** `Item.etaItemCode` — null when never registered (a fallback to the internal code is not a real one). */
  readonly itemCode: string | null;
  readonly itemCodeType: "EGS" | "GPC" | null;
  /** The tenant's own unit code the line was priced in. */
  readonly unitCode: string;
  /** The authority's mapped unit code for {@link unitCode}, null when unmapped. */
  readonly etaUnitCode: string | null;
  readonly taxRatePercent: number;
  /**
   * The VAT sub-type this line would resolve to — `"auto"` when the tax rate
   * carries no explicit classification, null when the line stored no tax rate
   * id and no active tax rate matches its percent unambiguously (D79).
   */
  readonly etaTaxSubType: string | null;
  readonly taxClassificationMissing: boolean;
  readonly netTotal: string;
  readonly taxAmount: string;
}

export interface EtaPrevalidationReceiverInput {
  readonly type: "B" | "P" | "F";
  readonly registrationNumber: string | null;
  readonly customerId: string | null;
}

export interface EtaPrevalidationInput {
  readonly branchCode: string | null;
  readonly receiver: EtaPrevalidationReceiverInput;
  readonly lines: readonly EtaPrevalidationLineInput[];
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalAmount: string;
}

const TAX_REGISTRATION = /^\d{9}$/;

function bi(value: string): bigint {
  const dec = etaReceiptDecimal(value);
  const negative = dec.startsWith("-");
  const digits = (negative ? dec.slice(1) : dec).replace(".", "");
  const n = BigInt(digits);
  return negative ? -n : n;
}

function finding(
  code: EtaPrevalidationRuleCode,
  severity: EtaPrevalidationSeverity,
  messageAr: string,
  messageEn: string,
  fixHintAr: string,
  fixHintEn: string,
  fixScreen: EtaPrevalidationFixScreen,
  fixRefId: string | null = null,
): EtaPrevalidationFinding {
  return { code, severity, messageAr, messageEn, fixHintAr, fixHintEn, fixScreen, fixRefId };
}

/**
 * Run every rule over one document's inputs and return every finding — both
 * severities, every failing line. The caller decides whether to warn or
 * block (see {@link hasBlockingEtaFindings}); this function only observes.
 */
export function prevalidateEtaInvoice(
  input: EtaPrevalidationInput,
  config: EtaConfig,
): readonly EtaPrevalidationFinding[] {
  const out: EtaPrevalidationFinding[] = [];

  if (!TAX_REGISTRATION.test(config.taxRegistrationNumber ?? "")) {
    out.push(
      finding(
        EtaPrevalidationRuleCode.IssuerTaxRegistrationInvalid,
        EtaPrevalidationSeverity.Blocking,
        "الرقم الضريبي للمنشأة غير مسجَّل أو غير صحيح (9 أرقام).",
        "The company's tax registration number is missing or invalid (9 digits).",
        "أدخل الرقم الضريبي في إعدادات الفاتورة الإلكترونية.",
        "Enter the tax registration number in the ETA settings.",
        EtaPrevalidationFixScreen.IssuerConfig,
      ),
    );
  }
  if (!config.activityCode) {
    out.push(
      finding(
        EtaPrevalidationRuleCode.IssuerActivityCodeMissing,
        EtaPrevalidationSeverity.Blocking,
        "كود النشاط لدى المصلحة غير مضبوط.",
        "The taxpayer activity code is not configured.",
        "اختر كود النشاط في إعدادات الفاتورة الإلكترونية.",
        "Choose the activity code in the ETA settings.",
        EtaPrevalidationFixScreen.IssuerConfig,
      ),
    );
  }
  if (!config.address) {
    out.push(
      finding(
        EtaPrevalidationRuleCode.IssuerAddressMissing,
        EtaPrevalidationSeverity.Blocking,
        "عنوان المنشأة غير مسجَّل.",
        "The company address is not registered.",
        "أدخل عنوان المنشأة في إعدادات الفاتورة الإلكترونية.",
        "Enter the company address in the ETA settings.",
        EtaPrevalidationFixScreen.IssuerConfig,
      ),
    );
  }
  if (!input.branchCode) {
    out.push(
      finding(
        EtaPrevalidationRuleCode.BranchCodeMissing,
        EtaPrevalidationSeverity.Blocking,
        "كود الفرع لدى المصلحة غير مسجَّل لهذا الفرع.",
        "This branch has no code registered with the authority.",
        "سجّل كود الفرع في «أكواد الفروع لدى المصلحة».",
        "Register the branch code under ETA branch codes.",
        EtaPrevalidationFixScreen.BranchCodes,
      ),
    );
  }

  for (const line of input.lines) {
    if (!line.itemCode || !line.itemCodeType) {
      out.push(
        finding(
          EtaPrevalidationRuleCode.ItemCodeMissing,
          EtaPrevalidationSeverity.Blocking,
          `الصنف «${line.itemLabel}» بلا كود EGS/GS1 مسجَّل لدى المصلحة.`,
          `Item "${line.itemLabel}" has no EGS/GS1 code registered with the authority.`,
          "سجّل كود الصنف في «ربط الأصناف».",
          "Register the item's code under ETA item mapping.",
          EtaPrevalidationFixScreen.ItemMapping,
          line.itemId,
        ),
      );
    }
    if (!line.etaUnitCode) {
      out.push(
        finding(
          EtaPrevalidationRuleCode.UnitNotMapped,
          EtaPrevalidationSeverity.Blocking,
          `وحدة «${line.unitCode}» (${line.itemLabel}) غير مربوطة بكود وحدة المصلحة.`,
          `Unit "${line.unitCode}" (${line.itemLabel}) is not mapped to an authority unit code.`,
          "اربط الوحدة في «ربط الوحدات».",
          "Map the unit under ETA unit mapping.",
          EtaPrevalidationFixScreen.UnitMapping,
        ),
      );
    }
    if (line.taxClassificationMissing) {
      out.push(
        finding(
          EtaPrevalidationRuleCode.TaxSubtypeNotMapped,
          EtaPrevalidationSeverity.Blocking,
          `سطر «${line.itemLabel}» بنسبة ضريبة 0% دون ضريبة مسماة، ولدى المنشأة تصنيف محدد بنسبة صفر (معفى/تصدير)، فلا يمكن إرساله للمصلحة كـ«غير خاضع» دون تحديد.`,
          `Line "${line.itemLabel}" is taxed at 0% and names no tax rate, while a specific 0% classification (exempt/export) exists, so it cannot be filed as "not subject" by default.`,
          "سمِّ ضريبة البند بإجراء «تصنيف ضريبة البند» على الفاتورة المرحّلة (معفى أو تصدير أو غير خاضع) ثم أعد الإرسال. وإن كان العميل معفى فحدِّد «ضريبة الإعفاء» على بطاقة العميل لتُسمّى تلقائياً في فواتيره القادمة.",
          "Name the line's tax rate with \"Classify line tax\" on the posted invoice (exempt, export or not subject), then resubmit. If the customer is tax-exempt, set the \"Exemption tax rate\" on the customer card so later invoices name it automatically.",
          EtaPrevalidationFixScreen.SourceDocument,
        ),
      );
    } else if (line.taxRatePercent === 0 && (line.etaTaxSubType === null || line.etaTaxSubType === EtaVatSubTypeCode.Auto)) {
      out.push(
        finding(
          EtaPrevalidationRuleCode.TaxSubtypeNotMapped,
          EtaPrevalidationSeverity.Warning,
          `سطر «${line.itemLabel}» بنسبة ضريبة 0% دون تصنيف فرعي صريح (معفى/تصدير/غير خاضع)، وسيُرسل تلقائياً كـ«غير خاضع».`,
          `Line "${line.itemLabel}" is taxed at 0% with no explicit sub-type (exempt/export/not-subject) and will file as "not subject" by default.`,
          "صنّف نوع الضريبة الفرعي على معدل الضريبة في شاشة معدلات الضريبة.",
          "Classify the VAT sub-type on the tax rate in Tax Rates.",
          EtaPrevalidationFixScreen.TaxRates,
        ),
      );
    }
  }

  if (input.receiver.type === "B" && !TAX_REGISTRATION.test(input.receiver.registrationNumber ?? "")) {
    out.push(
      finding(
        EtaPrevalidationRuleCode.BuyerTinMissing,
        EtaPrevalidationSeverity.Blocking,
        "الرقم الضريبي للعميل (B2B) غير مسجَّل أو غير صحيح.",
        "The customer's tax registration number (B2B) is missing or invalid.",
        "أدخل الرقم الضريبي على بطاقة العميل.",
        "Enter the tax number on the customer record.",
        EtaPrevalidationFixScreen.Customer,
        input.receiver.customerId,
      ),
    );
  }
  if (input.receiver.type === "P" && !input.receiver.registrationNumber) {
    const totalAtThreshold = bi(input.totalAmount) >= bi(String(config.buyerDataThreshold));
    if (totalAtThreshold) {
      out.push(
        finding(
          EtaPrevalidationRuleCode.BuyerNationalIdRequired,
          EtaPrevalidationSeverity.Blocking,
          `فاتورة بقيمة ${config.buyerDataThreshold} ج.م أو أكثر لشخص طبيعي تتطلب الرقم القومي.`,
          `An invoice of EGP ${config.buyerDataThreshold} or more to a natural person requires the national ID.`,
          "أدخل الرقم القومي على بطاقة العميل.",
          "Enter the national ID on the customer record.",
          EtaPrevalidationFixScreen.Customer,
          input.receiver.customerId,
        ),
      );
    }
  }

  const linesNet = input.lines.reduce((sum, l) => sum + bi(l.netTotal), 0n);
  const linesTax = input.lines.reduce((sum, l) => sum + bi(l.taxAmount), 0n);
  const statedNet = bi(input.totalNet);
  const statedTax = bi(input.totalTax);
  const statedTotal = bi(input.totalAmount);
  if (linesNet !== statedNet || linesTax !== statedTax || statedNet + statedTax !== statedTotal) {
    out.push(
      finding(
        EtaPrevalidationRuleCode.TotalsMismatch,
        EtaPrevalidationSeverity.Blocking,
        "إجمالي المستند لا يطابق مجموع سطوره (بدقة 5 خانات عشرية).",
        "The document's stated totals do not foot to its own lines (at 5-decimal precision).",
        "افتح المستند المصدر وتحقق من سطوره ثم أعد التأكيد.",
        "Open the source document, check its lines, and re-confirm.",
        EtaPrevalidationFixScreen.SourceDocument,
      ),
    );
  }

  return out;
}

export function hasBlockingEtaFindings(findings: readonly EtaPrevalidationFinding[]): boolean {
  return findings.some((f) => f.severity === EtaPrevalidationSeverity.Blocking);
}

/**
 * Refused BEFORE transmit: listing every failing rule is the point (WF-04
 * "each row shows the ETA rejection reason"), not just the first one, so the
 * accountant fixes a batch in one pass instead of one round trip per rule.
 */
export class EtaPrevalidationFailedError extends Error {
  readonly code = "ETA_PREVALIDATION_FAILED";
  constructor(readonly findings: readonly EtaPrevalidationFinding[]) {
    super(
      `لا يمكن إرسال المستند قبل إصلاح: ${findings.map((f) => f.messageAr).join("، ")} ` +
        `Cannot submit before fixing: ${findings.map((f) => f.messageEn).join("; ")}`,
    );
    this.name = "EtaPrevalidationFailedError";
  }
}
