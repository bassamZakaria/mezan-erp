/**
 * Treasury voucher types — the "نوع السند" discriminator
 * (docs/catalog/04-accounting-treasury.md §"السندات النقدية").
 *
 * The السندات النقدية screen is ONE unified document with a type discriminator
 * rather than separate receipt/payment/transfer screens. Each type declares its
 * cash DIRECTION (money in = receipt, money out = payment, or a treasury→treasury
 * transfer), which counterparty it needs (customer / supplier / none), and
 * whether its amount can be ALLOCATED across open invoices — and, if so, which
 * invoice kind (sales for a customer collection, purchase for a supplier
 * payment). The list is authoritative: it is exactly the "New Voucher"
 * type-picker grid captured in the catalog.
 */

/** Cash effect of a voucher on treasury liquidity. */
export type VoucherDirection = "receipt" | "payment" | "transfer";

/** How the money physically moved (طريقة الدفع). */
export type VoucherPaymentMethod = "cash" | "bank" | "cheque" | "card" | "wallet";

export interface VoucherPaymentMethodDefinition {
  readonly code: VoucherPaymentMethod;
  readonly labelAr: string;
  readonly labelEn: string;
}

export const VOUCHER_PAYMENT_METHODS: readonly VoucherPaymentMethodDefinition[] = [
  { code: "cash", labelAr: "نقدي", labelEn: "Cash" },
  { code: "bank", labelAr: "بنكي", labelEn: "Bank" },
  { code: "cheque", labelAr: "شيك", labelEn: "Cheque" },
  { code: "card", labelAr: "بطاقة", labelEn: "Card" },
  { code: "wallet", labelAr: "محفظة إلكترونية", labelEn: "E-wallet" },
] as const;

/** The 11 voucher types from the catalog's type-picker grid. */
export type VoucherType =
  | "customer_collection"
  | "supplier_payment"
  | "customer_refund"
  | "customer_advance"
  | "supplier_refund"
  | "other_income"
  | "other_expense"
  | "capital_injection"
  | "capital_withdrawal"
  | "tax_payment"
  | "inter_treasury_transfer";

/** Which sub-ledger invoice kind an allocatable voucher applies against. */
export type AllocationInvoiceKind = "sales" | "purchase";

export interface VoucherTypeDefinition {
  readonly code: VoucherType;
  /** Arabic label as shown in the type-picker grid. */
  readonly labelAr: string;
  /** English label — without it the picker leaks Arabic into the en UI. */
  readonly labelEn: string;
  /** The one-line guiding subtitle from the type-picker. */
  readonly subtitleAr: string;
  readonly subtitleEn: string;
  readonly direction: VoucherDirection;
  readonly requiresCustomer: boolean;
  readonly requiresSupplier: boolean;
  /** Whether the voucher amount can be allocated across open invoices. */
  readonly allocatable: boolean;
  /** The invoice kind allocations target (only meaningful when allocatable). */
  readonly allocationKind: AllocationInvoiceKind | null;
  /**
   * The GL account this type posts against (R8.1). `null` means the type has
   * no opinion at all — a customer collection posts to that customer's own
   * receivable, a transfer to the other treasury — and the caller supplies it.
   */
  readonly counterpartAccountId: string | null;
  /**
   * Whether that account is the type's RULE rather than its default.
   *
   * A partner's capital injection is equity by definition, and a tax payment
   * settles the VAT payable: accepting an account from the request body meant
   * a drawing could be booked as an expense and a tax payment as rent. Those
   * types are fixed.
   *
   * `other_income` and `other_expense` are the opposite case — being a
   * catch-all is the whole point, and an employee-advance disbursement rides
   * on `other_expense` to reach the 1160 advances ASSET account. For those the
   * account here is only what a caller gets when it names none.
   */
  readonly counterpartAccountFixed: boolean;
}

export const VOUCHER_TYPE_DEFINITIONS = [
  {
    code: "customer_collection",
    labelAr: "تحصيل من عميل",
    labelEn: "Collect from customer",
    subtitleAr: "استلام دفعة من عميل وتخصيصها على فواتيره",
    subtitleEn: "Take a payment from a customer and allocate it across their invoices",
    direction: "receipt",
    requiresCustomer: true,
    requiresSupplier: false,
    allocatable: true,
    allocationKind: "sales",
    // The customer's own receivable control account, resolved per customer.
    counterpartAccountId: null,
    counterpartAccountFixed: false,
  },
  {
    code: "supplier_payment",
    labelAr: "دفع لمورد",
    labelEn: "Pay supplier",
    subtitleAr: "صرف دفعة لمورد وتخصيصها على فواتيره",
    subtitleEn: "Pay a supplier and allocate it across their invoices",
    direction: "payment",
    requiresCustomer: false,
    requiresSupplier: true,
    allocatable: true,
    allocationKind: "purchase",
    // The supplier's own payable control account, resolved per supplier.
    counterpartAccountId: null,
    counterpartAccountFixed: false,
  },
  {
    code: "customer_refund",
    labelAr: "رد مبلغ لعميل",
    labelEn: "Refund a customer",
    subtitleAr: "إرجاع مبلغ نقدي للعميل (بعد مرتجع أو رصيد دائن)",
    subtitleEn: "Return cash to a customer after a return or a credit balance",
    direction: "payment",
    requiresCustomer: true,
    requiresSupplier: false,
    allocatable: false,
    allocationKind: null,
    // Back against the customer's receivable.
    counterpartAccountId: null,
    counterpartAccountFixed: false,
  },
  {
    code: "customer_advance",
    labelAr: "دفعة مقدمة من عميل مقاولات",
    labelEn: "Advance from a contracting customer",
    subtitleAr: "دفعة مقدمة يدفعها العميل على عقد مقاولة (تُسترد من المستخلصات)",
    subtitleEn: "An advance paid against a contract, recovered from progress certificates",
    direction: "receipt",
    requiresCustomer: true,
    requiresSupplier: false,
    allocatable: false,
    allocationKind: null,
    // An advance is money owed back until the work is certified — a liability, never revenue.
    counterpartAccountId: "2160",
    counterpartAccountFixed: true,
  },
  {
    code: "supplier_refund",
    labelAr: "استرداد من مورد",
    labelEn: "Refund from supplier",
    subtitleAr: "استلام مبلغ نقدي من مورد (بعد مرتجع مشتريات أو رصيد دائن)",
    subtitleEn: "Receive cash back from a supplier after a purchase return or a credit balance",
    direction: "receipt",
    requiresCustomer: false,
    requiresSupplier: true,
    allocatable: false,
    allocationKind: null,
    // Back against the supplier's payable.
    counterpartAccountId: null,
    counterpartAccountFixed: false,
  },
  {
    code: "other_income",
    labelAr: "إيراد آخر",
    labelEn: "Other income",
    subtitleAr: "إيراد لا يخص فاتورة (إيجار محصّل، فوائد، خصومات بنكية…)",
    subtitleEn: "Income not tied to an invoice — rent received, interest, bank rebates",
    direction: "receipt",
    requiresCustomer: false,
    requiresSupplier: false,
    allocatable: false,
    allocationKind: null,
    // Sundry income.
    counterpartAccountId: "4910",
    counterpartAccountFixed: false,
  },
  {
    code: "other_expense",
    labelAr: "مصروف آخر",
    labelEn: "Other expense",
    subtitleAr: "مصروف لا يخص مورّداً (إيجار مدفوع، صيانة، مرافق…)",
    subtitleEn: "An expense not tied to a supplier — rent paid, maintenance, utilities",
    direction: "payment",
    requiresCustomer: false,
    requiresSupplier: false,
    allocatable: false,
    allocationKind: null,
    // Sundry expense.
    counterpartAccountId: "5910",
    counterpartAccountFixed: false,
  },
  {
    code: "capital_injection",
    labelAr: "ضخ رأس مال من الشريك",
    labelEn: "Partner capital injection",
    subtitleAr: "إيداع شخصي من الشريك إلى الخزينة",
    subtitleEn: "A partner pays money into the treasury",
    direction: "receipt",
    requiresCustomer: false,
    requiresSupplier: false,
    allocatable: false,
    allocationKind: null,
    // Equity, not income: the partner is not a customer (R8.1).
    counterpartAccountId: "3100",
    counterpartAccountFixed: true,
  },
  {
    code: "capital_withdrawal",
    labelAr: "سحب شخصي للشريك",
    labelEn: "Partner drawings",
    subtitleAr: "سحب شخصي من الخزينة للشريك",
    subtitleEn: "A partner takes money out of the treasury",
    direction: "payment",
    requiresCustomer: false,
    requiresSupplier: false,
    allocatable: false,
    allocationKind: null,
    // Drawings — contra-equity, not an expense (R8.1).
    counterpartAccountId: "3200",
    counterpartAccountFixed: true,
  },
  {
    code: "tax_payment",
    labelAr: "دفع لمصلحة الضرائب",
    labelEn: "Payment to the tax authority",
    subtitleAr: "دفعة لمصلحة الضرائب أو جهة حكومية",
    subtitleEn: "A payment to the tax authority or another government body",
    direction: "payment",
    requiresCustomer: false,
    requiresSupplier: false,
    allocatable: false,
    allocationKind: null,
    // Settles the VAT payable the invoices accrued, never an expense (R8.1).
    counterpartAccountId: "2200",
    counterpartAccountFixed: true,
  },
  {
    code: "inter_treasury_transfer",
    labelAr: "تحويل بين الخزائن",
    labelEn: "Transfer between treasuries",
    subtitleAr: "تحويل مبلغ بين خزينتين داخل المنشأة",
    subtitleEn: "Move money between two of the company's own treasuries",
    direction: "transfer",
    requiresCustomer: false,
    requiresSupplier: false,
    allocatable: false,
    allocationKind: null,
    // The destination treasury's own GL account.
    counterpartAccountId: null,
    counterpartAccountFixed: false,
  },
] as const satisfies readonly VoucherTypeDefinition[];

const BY_CODE: ReadonlyMap<string, VoucherTypeDefinition> = new Map(
  VOUCHER_TYPE_DEFINITIONS.map((d) => [d.code, d]),
);

export function getVoucherTypeDefinition(type: string): VoucherTypeDefinition {
  const def = BY_CODE.get(type);
  if (!def) throw new RangeError(`Unknown voucher type: "${type}"`);
  return def;
}

export function isVoucherType(type: string): type is VoucherType {
  return BY_CODE.has(type);
}

/** Whether a voucher of this type can be allocated across open invoices. */
export function isAllocatableType(type: VoucherType): boolean {
  return getVoucherTypeDefinition(type).allocatable;
}

export function getVoucherPaymentMethodLabel(method: VoucherPaymentMethod): string {
  return VOUCHER_PAYMENT_METHODS.find((m) => m.code === method)?.labelAr ?? method;
}
