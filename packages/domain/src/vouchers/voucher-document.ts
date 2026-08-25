/**
 * Treasury voucher as a document-framework consumer
 * (docs/catalog/04 §"السندات النقدية") — the unified 10+1-type receipt /
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

import { Money } from "../money/index.js";
import type { DocumentTypeDefinition, FrameworkDocument } from "../documents/document.js";
import { buildEffects } from "../documents/effects.js";
import type { DocumentGlPosting } from "../documents/hooks.js";
import { InvalidDocumentError } from "../documents/errors.js";
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
export interface VoucherLine {
  readonly voucherType: VoucherType;
  readonly direction: VoucherDirection;
  readonly amount: Money;
  readonly currency: string;
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
}

export type VoucherDocument = FrameworkDocument<VoucherLine>;

export const VOUCHER_DOC_TYPE = "TREASURY_VOUCHER";

/** The single line of a voucher document (throws if malformed — should never happen post-validate). */
export function voucherLine(doc: VoucherDocument): VoucherLine {
  const line = doc.lines[0];
  if (!line) throw new InvalidVoucherLineError(doc.id);
  return line;
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
function buildVoucherLines(line: VoucherLine): DocumentGlPosting["lines"] {
  const { amount, treasuryGlAccountId } = line;
  const zero = Money.zero();
  // Only the counterparty side carries the cost centre: the treasury leg is a
  // cash movement, and tagging both would double the spend in the P&L.
  const cc = line.costCenterId ?? null;
  if (line.direction === "transfer") {
    const destGl = line.counterTreasuryGlAccountId;
    if (!destGl) throw new Error("transfer voucher missing destination GL account");
    return [
      { accountId: destGl, debit: amount, credit: zero, memo: null },
      { accountId: treasuryGlAccountId, debit: zero, credit: amount, memo: null },
    ];
  }
  const counter = line.counterpartyGlAccountId;
  if (!counter) throw new Error("voucher missing counterparty GL account");
  if (line.direction === "receipt") {
    return [
      { accountId: treasuryGlAccountId, debit: amount, credit: zero, memo: null },
      { accountId: counter, debit: zero, credit: amount, memo: null, costCenterId: cc },
    ];
  }
  // payment
  return [
    { accountId: counter, debit: amount, credit: zero, memo: null, costCenterId: cc },
    { accountId: treasuryGlAccountId, debit: zero, credit: amount, memo: null },
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
      throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "السند يجب أن يحمل بنداً اقتصادياً واحداً بالضبط.");
    }
    const line = doc.lines[0]!;
    const def = getVoucherTypeDefinition(line.voucherType);
    if (line.amount.scaled <= 0n) {
      throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "مبلغ السند يجب أن يكون أكبر من صفر.");
    }
    if (line.treasuryAccountId.trim() === "" || line.treasuryGlAccountId.trim() === "") {
      throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "حساب الخزينة مطلوب.");
    }
    if (def.direction === "transfer") {
      if (!line.counterTreasuryAccountId || !line.counterTreasuryGlAccountId) {
        throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "التحويل يتطلب خزينة مستقبِلة.");
      }
      if (line.counterTreasuryAccountId === line.treasuryAccountId) {
        throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "لا يمكن التحويل إلى نفس الخزينة.");
      }
    } else if (!line.counterpartyGlAccountId || line.counterpartyGlAccountId.trim() === "") {
      throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "الحساب المقابل مطلوب.");
    }
    if (def.requiresCustomer && !line.customerId) {
      throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "هذا النوع من السندات يتطلب اختيار عميل.");
    }
    if (def.requiresSupplier && !line.supplierId) {
      throw new InvalidDocumentError(VOUCHER_DOC_TYPE, doc.id, "هذا النوع من السندات يتطلب اختيار مورّد.");
    }
  },

  buildGlPosting(doc): DocumentGlPosting {
    const line = voucherLine(doc);
    return {
      sourceDocType: VOUCHER_DOC_TYPE,
      sourceDocId: doc.id,
      sourceDocNumber: doc.docNo,
      date: doc.date,
      memo: doc.memo,
      lines: buildVoucherLines(line),
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
        {
          kind: "gl",
          description: `يُنشئ قيداً محاسبياً متوازناً بقيمة ${line.amount.toString()} (${def.labelAr})`,
        },
      ],
    });
  },
};
