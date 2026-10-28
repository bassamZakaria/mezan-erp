/**
 * Treasury voucher as a document-framework consumer
 * (docs/archive/catalog/04 §"السندات النقدية") — the unified 10+1-type receipt /
 * payment / transfer document.
 *
 * The voucher is ONE document type ("TREASURY_VOUCHER") with a `voucherType`
 * discriminator carried on its single economic line, so all 11 types reuse the
 * same numbering (CV-), workflow gate (TREASURY_VOUCHER_CONFIRM), audit and
 * lifecycle. On confirm the framework posts a balanced two-line GL entry the
 * type's `buildGlPosting` constructs from the direction:
 *   - receipt  : Dr treasury GL      / Cr counterparty GL
 *   - payment  : Dr counterparty GL  / Cr treasury GL
 *   - transfer : Dr destination GL   / Cr source treasury GL
 *
 * The cash-negative guard is NOT here (it needs the live ledger balance — an
 * I/O concern the `VoucherService` runs before `confirm`); `describeEffects`
 * stays pure so it drives both the UI effects panel and tests.
 */

import { Money, roundMoney } from "../money/index.js";
import { convertToBase } from "../exchange-rates/convert.js";
import { FX_REALISED_LINE_MEMO } from "./realised-fx.js";
import type { DocumentTypeDefinition, FrameworkDocument } from "../documents/document.js";
import { buildEffects } from "../documents/effects.js";
import type { DocumentGlPosting } from "../documents/hooks.js";
import { InvalidDocumentError } from "../documents/errors.js";
import { reversalChainPresenceAsOf } from "../documents/as-of.js";
import type { CostCategory } from "../contracting/cost-category.js";
import {
  getVoucherTypeDefinition,
  type VoucherDirection,
  type VoucherPaymentMethod,
  type VoucherType,
} from "./voucher-types.js";

/**
 * The single economic line of a voucher. A voucher always has exactly one line
 * — the framework's `lines` array holds it — carrying every voucher-specific
 * field (the framework document envelope has no room for them). GL account ids
 * are resolved by the caller (treasury account → its GL account; customer →
 * receivable; income/expense → the picked account) so the domain stays pure.
 */
/**
 * The branch of a voucher raised on an account the company holds and no branch
 * owns. Its journal lines post with no branch — «غير مخصص».
 */
export const COMPANY_LEVEL_VOUCHER_BRANCH = "";

export interface VoucherLine {
  readonly voucherType: VoucherType;
  readonly direction: VoucherDirection;
  /** The amount as the voucher STATES it, in {@link currency} — not necessarily base. */
  readonly amount: Money;
  readonly currency: string;
  /**
   * Base units per one unit of {@link currency}, resolved from the approved
   * rate table at confirm. Null for a base-currency voucher.
   *
   * Without it a USD 1,000 receipt posted 1,000 EGP and settled 1,000 of a
   * 49,350 EGP receivable (B-4), and the untagged AR line left the invoice in
   * the FX revaluation's open position forever (B-5).
   */
  readonly fxRate?: string | null;
  readonly treasuryFx?: TreasuryLegFx | null;
  readonly counterTreasuryFx?: TreasuryLegFx | null;
  readonly branchId: string;
  readonly paymentMethod: VoucherPaymentMethod;
  /** The treasury account the money moves in/out of (source treasury for a transfer). */
  readonly treasuryAccountId: string;
  /** GL (cash/bank) account behind `treasuryAccountId`. */
  readonly treasuryGlAccountId: string;
  /** The other side of the posting for receipt/payment types (AR/AP/income/expense/equity). Null for transfers. */
  readonly counterpartyGlAccountId: string | null;
  /** Destination treasury account for a transfer; null otherwise. */
  readonly counterTreasuryAccountId: string | null;
  /** GL account behind `counterTreasuryAccountId`; null otherwise. */
  readonly counterTreasuryGlAccountId: string | null;
  readonly customerId: string | null;
  readonly supplierId: string | null;
  readonly referenceNo: string | null;
  /** Cost centre the spending/income belongs to; tagged onto the counterparty GL line. */
  readonly costCenterId?: string | null;
  /**
   * بُعد المشروع — the contracting project this voucher's spending/income
   * belongs to. Tagged onto EVERY posted line (cash/bank side included) so a
   * project's cash movements can be traced from either leg of the entry.
   */
  readonly projectId?: string | null;
  /**
   * فئة التكلفة — only meaningful with `projectId`, and tagged ONLY onto the
   * counterparty (expense/income) line: the treasury leg is a cash movement,
   * not a cost, and tagging both would double the spend in a cost report.
   */
  readonly costCategory?: CostCategory | null;
  /**
   * Tax withheld from this payment. `amount` remains what SETTLES the payee —
   * the supplier is discharged in full — while only `amount − withholdingAmount`
   * leaves the treasury and the rest becomes a liability to the authority.
   * Egypt withholds on most local B2B payments (D27).
   */
  readonly withholdingAmount?: Money | null;
  readonly withholdingRatePercent?: number | null;
  readonly withholdingGlAccountId?: string | null;
  /**
   * عمولة تحويل — what the bank or wallet kept from a customer collection.
   * `amount` stays the GROSS that relieves the receivable and settles the
   * invoices; only `amount − commissionAmount` lands in the treasury and the
   * rest is an expense on `commissionGlAccountId`.
   */
  readonly commissionAmount?: Money | null;
  readonly commissionGlAccountId?: string | null;
  /**
   * The invoice allocations a collection asked for while the workflow held its
   * confirm. They are applied in the same transaction as the approved confirm
   * and cleared once applied (D344).
   */
  readonly heldAllocations?: readonly HeldAllocationRequest[] | null;
}

export interface TreasuryLegFx {
  readonly currency: string;
  readonly fxRate: string;
  readonly foreignAmount: Money;
  readonly carryingBase?: Money;
  readonly realised?: Money;
  readonly realisedAccountId?: string;
}

function realisedTreasuryLines(
  treasuryGlAccountId: string,
  leg: TreasuryLegFx | null | undefined,
  projectId: string | null,
  treasuryAccountId: string | null | undefined,
): DocumentGlPosting["lines"] {
  if (!leg?.realised || leg.realised.scaled === 0n || !leg.realisedAccountId) return [];
  const gain = leg.realised.scaled > 0n;
  const amount = gain ? leg.realised : leg.realised.negate();
  const zero = Money.zero();
  const onAccount = { accountId: treasuryGlAccountId, memo: FX_REALISED_LINE_MEMO, projectId, treasuryAccountId: treasuryAccountId ?? null, currency: leg.currency, fxRate: leg.fxRate };
  const onDifference = { accountId: leg.realisedAccountId, memo: FX_REALISED_LINE_MEMO, projectId };
  return gain
    ? [{ ...onAccount, debit: amount, credit: zero }, { ...onDifference, debit: zero, credit: amount }]
    : [{ ...onDifference, debit: amount, credit: zero }, { ...onAccount, debit: zero, credit: amount }];
}

export interface HeldAllocationRequest {
  readonly allocationId: string;
  readonly invoiceId: string;
  /** In BASE; null takes what is left of the voucher. */
  readonly amount: Money | null;
}

export type VoucherDocument = FrameworkDocument<VoucherLine>;

export const VOUCHER_DOC_TYPE = "TREASURY_VOUCHER";

/** The single line of a voucher document (throws if malformed — should never happen post-validate). */
export function voucherLine(doc: VoucherDocument): VoucherLine {
  const line = doc.lines[0];
  if (!line) throw new InvalidVoucherLineError(doc.id);
  return line;
}

/**
 * Whether a voucher still moves its counterparty. Reversing one leaves the
 * original «معكوس» and saves a mirror DOCUMENT in the confirmed status with the
 * same line, so a sub-ledger that sums confirmed vouchers must skip the mirror
 * or it counts the reversed receipt a second time while the GL nets to zero.
 */
export function isStandingVoucher(doc: VoucherDocument): boolean {
  return (doc.status === "confirmed" || doc.status === "posted") && !doc.reversesDocId;
}

export function voucherTakesAllocations(doc: VoucherDocument): boolean {
  return getVoucherTypeDefinition(voucherLine(doc).voucherType).allocatable && doc.status !== "reversed" && !doc.reversesDocId;
}

export function voucherStandsAsOf(doc: VoucherDocument, byId: ReadonlyMap<string, VoucherDocument>, asOfDate: string | undefined): boolean {
  if (doc.reversesDocId) return false;
  const dates = [doc.date];
  const seen = new Set([doc.id]);
  let link = doc;
  while (link.status === "reversed" && link.reversedByDocId) {
    const next = byId.get(link.reversedByDocId);
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    dates.push(next.date);
    link = next;
  }
  if (link.status !== "confirmed" && link.status !== "posted") return false;
  return reversalChainPresenceAsOf(dates, asOfDate) === 1;
}

class InvalidVoucherLineError extends Error {
  constructor(id: string) {
    super(`Voucher "${id}" has no economic line.`);
    this.name = "InvalidVoucherLineError";
  }
}

const RECEIPT_EFFECTS: Partial<Record<VoucherType, [string, string]>> = {
  customer_collection: [
    "تم استلام المبلغ في الخزينة أو البنك",
    "تم تحصيل المبلغ من العميل (يمكن تخصيصه على فواتيره أو يبقى رصيداً دائناً له)",
  ],
  customer_advance: [
    "تم استلام الدفعة المقدمة في الخزينة",
    "سُجّلت دفعة مقدمة على عقد المقاولة تُسترد من المستخلصات",
  ],
  supplier_refund: ["تم استلام المبلغ في الخزينة", "خُفّض رصيد المورد بالمبلغ المسترد"],
  other_income: ["تم استلام المبلغ في الخزينة أو البنك", "سُجّل إيراد في الحساب المحاسبي المحدد"],
  capital_injection: ["تم إيداع المبلغ في الخزينة", "زاد رأس مال الشريك بالمبلغ المودع"],
};

const PAYMENT_EFFECTS: Partial<Record<VoucherType, [string, string]>> = {
  supplier_payment: [
    "تم صرف المبلغ من الخزينة أو البنك",
    "تم سداد المبلغ للمورد (يمكن تخصيصه على فواتيره أو يبقى رصيداً مديناً له)",
  ],
  customer_refund: ["تم صرف المبلغ من الخزينة", "خُفّض الرصيد الدائن للعميل بالمبلغ المرتجع"],
  other_expense: ["تم صرف المبلغ من الخزينة أو البنك", "سُجّل مصروف في الحساب المحاسبي المحدد"],
  capital_withdrawal: ["تم صرف المبلغ من الخزينة", "خُفّض رأس مال الشريك بالمبلغ المسحوب"],
  tax_payment: ["تم صرف المبلغ من الخزينة أو البنك", "خُفّض رصيد الالتزام الضريبي بالمبلغ المسدَّد"],
};

function describeEffectLines(line: VoucherLine): [string, string] {
  if (line.direction === "transfer") {
    return [
      "تم التحويل بين حسابين للخزينة (لا يتغير إجمالي السيولة)",
      "زاد رصيد الخزينة المستقبِلة ونقص رصيد الخزينة المُرسِلة",
    ];
  }
  const table = line.direction === "receipt" ? RECEIPT_EFFECTS : PAYMENT_EFFECTS;
  return (
    table[line.voucherType] ??
    (line.direction === "receipt"
      ? ["تم استلام المبلغ في الخزينة", "تم تسجيل الطرف المقابل في دفتر الأستاذ"]
      : ["تم صرف المبلغ من الخزينة", "تم تسجيل الطرف المقابل في دفتر الأستاذ"])
  );
}

/**
 * Build the balanced two-line GL posting for a voucher from its direction. The
 * caller has already resolved every GL account id onto the line; here we only
 * pick the sides.
 */
/**
 * The voucher's amount in BASE currency — what the GL, the treasury balance
 * and the AR/AP sub-ledger all hold. `amount` is the figure the document
 * states, in its own currency.
 */
export function voucherBaseAmount(line: VoucherLine): Money {
  return line.fxRate ? convertToBase(line.amount, line.fxRate) : line.amount;
}

/** The withheld slice, in base currency. */
export function voucherBaseWithholding(line: VoucherLine): Money {
  const withheld = line.withholdingAmount ?? Money.zero();
  return line.fxRate ? convertToBase(withheld, line.fxRate) : withheld;
}

export function voucherBaseCommission(line: VoucherLine): Money {
  const commission = line.commissionAmount ?? Money.zero();
  return line.fxRate ? convertToBase(commission, line.fxRate) : commission;
}

export function voucherStatedNet(line: VoucherLine): Money {
  return Money.fromScaled(line.amount.scaled - (line.withholdingAmount?.scaled ?? 0n) - (line.commissionAmount?.scaled ?? 0n));
}

function buildVoucherLines(line: VoucherLine): DocumentGlPosting["lines"] {
  const { treasuryGlAccountId } = line;
  const treasuryAccountId = line.treasuryAccountId;
  const amount = voucherBaseAmount(line);
  // The counterparty leg carries the currency and the rate it was booked at,
  // or FX revaluation can never see that this settlement closed the position
  // and books a phantom gain every month-end (B-5).
  const fx = line.fxRate ? { currency: line.currency, fxRate: line.fxRate } : {};
  const zero = Money.zero();
  // Only the counterparty side carries the cost centre: the treasury leg is a
  // cash movement, and tagging both would double the spend in the P&L.
  const cc = line.costCenterId ?? null;
  // بُعد المشروع travels on EVERY line (cash/bank side too); فئة التكلفة only
  // on the counterparty (expense/income) line — see the field docs above.
  const projectId = line.projectId ?? null;
  const costCategory = line.costCategory ?? null;
  const treasuryFx = line.treasuryFx ? { currency: line.treasuryFx.currency, fxRate: line.treasuryFx.fxRate } : {};
  const counterTreasuryFx = line.counterTreasuryFx ? { currency: line.counterTreasuryFx.currency, fxRate: line.counterTreasuryFx.fxRate } : {};
  if (line.direction === "transfer") {
    const destGl = line.counterTreasuryGlAccountId;
    if (!destGl) throw new Error("transfer voucher missing destination GL account");
    return [
      { accountId: destGl, debit: amount, credit: zero, memo: null, projectId, treasuryAccountId: line.counterTreasuryAccountId ?? null, ...counterTreasuryFx },
      { accountId: treasuryGlAccountId, debit: zero, credit: amount, memo: null, projectId, treasuryAccountId, ...treasuryFx },
      ...realisedTreasuryLines(treasuryGlAccountId, line.treasuryFx, projectId, treasuryAccountId),
    ];
  }
  const counter = line.counterpartyGlAccountId;
  if (!counter) throw new Error("voucher missing counterparty GL account");
  if (line.direction === "receipt") {
    const commission = voucherBaseCommission(line);
    if (commission.scaled > 0n) {
      const commissionAccount = line.commissionGlAccountId;
      if (!commissionAccount) throw new Error("a commission voucher needs a commission expense GL account");
      return [
        { accountId: treasuryGlAccountId, debit: Money.fromScaled(amount.scaled - commission.scaled), credit: zero, memo: null, projectId, treasuryAccountId, ...treasuryFx },
        { accountId: commissionAccount, debit: commission, credit: zero, memo: null, costCenterId: cc, projectId },
        { accountId: counter, debit: zero, credit: amount, memo: null, costCenterId: cc, projectId, costCategory, ...fx },
      ];
    }
    return [
      { accountId: treasuryGlAccountId, debit: amount, credit: zero, memo: null, projectId, treasuryAccountId, ...treasuryFx },
      { accountId: counter, debit: zero, credit: amount, memo: null, costCenterId: cc, projectId, costCategory, ...fx },
    ];
  }
  // payment
  const withheld = voucherBaseWithholding(line);
  if (withheld.scaled > 0n) {
    const whtAccount = line.withholdingGlAccountId;
    if (!whtAccount) throw new Error("a withholding voucher needs a withholding-tax GL account");
    return [
      { accountId: counter, debit: amount, credit: zero, memo: null, costCenterId: cc, projectId, costCategory, ...fx },
      { accountId: treasuryGlAccountId, debit: zero, credit: Money.fromScaled(amount.scaled - withheld.scaled), memo: null, projectId, treasuryAccountId, ...treasuryFx },
      { accountId: whtAccount, debit: zero, credit: withheld, memo: null, projectId },
      ...realisedTreasuryLines(treasuryGlAccountId, line.treasuryFx, projectId, treasuryAccountId),
    ];
  }
  return [
    { accountId: counter, debit: amount, credit: zero, memo: null, costCenterId: cc, projectId, costCategory, ...fx },
    { accountId: treasuryGlAccountId, debit: zero, credit: amount, memo: null, projectId, treasuryAccountId, ...treasuryFx },
    ...realisedTreasuryLines(treasuryGlAccountId, line.treasuryFx, projectId, treasuryAccountId),
  ];
}

/** What actually moves through the treasury, in BASE currency: the settling amount less any tax withheld or commission kept. */
export function voucherNetPaid(line: VoucherLine): Money {
  return Money.fromScaled(voucherBaseAmount(line).scaled - voucherBaseWithholding(line).scaled - voucherBaseCommission(line).scaled);
}

function twoDecimals(amount: Money): string {
  const text = roundMoney(amount, 2, "HALF_UP").toString();
  return text.slice(0, text.length - 4);
}

function realisedFxEffect(line: VoucherLine): { kind: "gl"; description: string }[] {
  const leg = line.treasuryFx;
  if (!leg?.realised || leg.realised.scaled === 0n || !leg.carryingBase) return [];
  const gain = leg.realised.scaled > 0n;
  const amount = twoDecimals(gain ? leg.realised : leg.realised.negate());
  return [
    {
      kind: "gl",
      description: `فروق عملة محققة: ${gain ? "ربح" : "خسارة"} ${amount} — خرج ${twoDecimals(leg.foreignAmount)} ${leg.currency} من الحساب بقيمته الدفترية ${twoDecimals(leg.carryingBase)} وسعر السند ${leg.fxRate}`,
    },
  ];
}

function commissionEffect(line: VoucherLine): { kind: "gl"; description: string }[] {
  const commission = line.commissionAmount;
  if (!commission || commission.scaled <= 0n) return [];
  return [
    {
      kind: "gl",
      description: `عمولة تحويل ${twoDecimals(commission)} ${line.currency} تُسجَّل مصروفاً؛ يصل الخزينة ${twoDecimals(voucherStatedNet(line))} ويُخصم من رصيد العميل ${twoDecimals(line.amount)}`,
    },
  ];
}

/** The treasury-voucher document type definition. Plugs into {@link DocumentService}. */
export const voucherDocumentType: DocumentTypeDefinition<VoucherLine> = {
  code: VOUCHER_DOC_TYPE,
  labelAr: "سند نقدي",
  confirmedStatus: "confirmed",
  numberingSequence: "CASH_VOUCHER",
  gateActionType: "TREASURY_VOUCHER_CONFIRM",

  validate(doc) {
    if (doc.lines.length !== 1) {
      throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "السند يجب أن يحمل بنداً اقتصادياً واحداً بالضبط.", "A voucher carries exactly one economic line.");
    }
    const line = doc.lines[0]!;
    const def = getVoucherTypeDefinition(line.voucherType);
    if (line.amount.scaled <= 0n) {
      throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "مبلغ السند يجب أن يكون أكبر من صفر.", "The voucher amount must be greater than zero.");
    }
    if (line.treasuryAccountId.trim() === "" || line.treasuryGlAccountId.trim() === "") {
      throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "حساب الخزينة مطلوب.", "A treasury account is required.");
    }
    if (def.direction === "transfer") {
      if (!line.counterTreasuryAccountId || !line.counterTreasuryGlAccountId) {
        throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "التحويل يتطلب خزينة مستقبِلة.", "A transfer needs a receiving treasury account.");
      }
      if (line.counterTreasuryAccountId === line.treasuryAccountId) {
        throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "لا يمكن التحويل إلى نفس الخزينة.", "A transfer cannot go to the treasury account it comes from.");
      }
    } else if (!line.counterpartyGlAccountId || line.counterpartyGlAccountId.trim() === "") {
      throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "الحساب المقابل مطلوب.", "A counterparty account is required.");
    }
    const withheld = line.withholdingAmount?.scaled ?? 0n;
    if (withheld !== 0n) {
      if (def.direction !== "payment") {
        throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "ضريبة الخصم لا تُطبَّق إلا على سندات الصرف.", "Withholding tax applies to payment vouchers only.");
      }
      if (withheld < 0n || withheld >= line.amount.scaled) {
        throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "قيمة ضريبة الخصم يجب أن تكون أكبر من صفر وأقل من قيمة السند.", "The withholding tax must be greater than zero and less than the voucher amount.");
      }
      if (!line.withholdingGlAccountId) {
        throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "حساب ضريبة الخصم مطلوب.", "A withholding tax account is required.");
      }
    }
    const commission = line.commissionAmount?.scaled ?? 0n;
    if (commission !== 0n) {
      if (line.voucherType !== "customer_collection") {
        throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "عمولة التحويل لا تُطبَّق إلا على سندات تحصيل العملاء.", "A transfer commission applies to customer collections only.");
      }
      if (line.paymentMethod === "cheque") {
        throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "عمولة التحويل لا تُخصم من تحصيل بشيك؛ تُسجَّل عند تحصيل الشيك من البنك.", "A transfer commission cannot be taken from a cheque collection; record it when the bank collects the cheque.");
      }
      if (line.paymentMethod === "cash") {
        throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "عمولة التحويل لا تُخصم من تحصيل نقدي؛ تُسجَّل على التحويل البنكي أو المحفظة أو البطاقة.", "A transfer commission cannot be taken from a cash collection; it belongs on a bank, wallet or card collection.");
      }
      if (commission < 0n || commission >= line.amount.scaled) {
        throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "عمولة التحويل يجب أن تكون أكبر من صفر وأقل من قيمة التحصيل.", "The transfer commission must be greater than zero and less than the collected amount.");
      }
      if (!line.commissionGlAccountId) {
        throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "حساب مصروف عمولة التحويل مطلوب.", "A commission expense account is required.");
      }
    }
    if (def.requiresCustomer && !line.customerId) {
      throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "هذا النوع من السندات يتطلب اختيار عميل.", "This voucher type needs a customer.");
    }
    if (def.requiresSupplier && !line.supplierId) {
      throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "هذا النوع من السندات يتطلب اختيار مورّد.", "This voucher type needs a supplier.");
    }
    const projectId = line.projectId ?? null;
    if (def.requiresProject && !projectId) {
      throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "هذا النوع من السندات يتطلب اختيار مشروع.", "This voucher type needs a project.");
    }
    if (line.costCategory && !projectId) {
      throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "فئة التكلفة تتطلب اختيار مشروع.", "A cost category needs a project.");
    }
  },

  branchOf(doc) {
    return doc.lines[0]?.branchId ?? null;
  },

  buildGlPosting(doc): DocumentGlPosting {
    const line = voucherLine(doc);
    return {
      sourceDocType: VOUCHER_DOC_TYPE,
      sourceDocId: doc.id,
      sourceDocNumber: doc.docNo,
      date: doc.date,
      memo: doc.memo,
      // بُعد الفرع (DEC-20) on both legs: a branch cash statement that saw the
      // counterparty leg but not the treasury one would not balance.
      lines: buildVoucherLines(line).map((l) => ({ ...l, branchId: line.branchId || null })),
    };
  },

  describeEffects(doc) {
    const line = voucherLine(doc);
    const def = getVoucherTypeDefinition(line.voucherType);
    const [a, b] = describeEffectLines(line);
    return buildEffects({
      balanced: true,
      totalDebit: line.amount,
      totalCredit: line.amount,
      blocked: false,
      effects: [
        { kind: "balance", description: a },
        { kind: def.allocatable ? "info" : "gl", description: b },
        ...realisedFxEffect(line),
        ...commissionEffect(line),
        {
          kind: "gl",
          description: `يُنشئ قيداً محاسبياً متوازناً بقيمة ${twoDecimals(line.amount)} ${line.currency} (${def.labelAr})`,
          key: "docEffects.voucher.gl",
          params: { amount: line.amount.toString(), ...(line.fxRate ? { currency: line.currency } : {}), reasonAr: def.labelAr, reasonEn: def.labelEn },
        },
      ],
    });
  },
};
