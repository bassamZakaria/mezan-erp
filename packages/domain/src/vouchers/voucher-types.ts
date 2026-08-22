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
}

export const VOUCHER_PAYMENT_METHODS: readonly VoucherPaymentMethodDefinition[] = [
  { code: "cash", labelAr: "نقدي" },
  { code: "bank", labelAr: "بنكي" },
  { code: "cheque", labelAr: "شيك" },
  { code: "card", labelAr: "بطاقة" },
  { code: "wallet", labelAr: "محفظة إلكترونية" },
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
  /** The one-line guiding subtitle from the type-picker. */
  readonly subtitleAr: string;
  readonly direction: VoucherDirection;
  readonly requiresCustomer: boolean;
  readonly requiresSupplier: boolean;
  /** Whether the voucher amount can be allocated across open invoices. */
  readonly allocatable: boolean;
  /** The invoice kind allocations target (only meaningful when allocatable). */
  readonly allocationKind: AllocationInvoiceKind | null;
}

export const VOUCHER_TYPE_DEFINITIONS = [
  {
    code: "customer_collection",
    labelAr: "تحصيل من عميل",
    subtitleAr: "استلام دفعة من عميل وتخصيصها على فواتيره",
    direction: "receipt",
    requiresCustomer: true,
    requiresSupplier: false,
    allocatable: true,
    allocationKind: "sales",
  },
  {
    code: "supplier_payment",
    labelAr: "دفع لمورد",
    subtitleAr: "صرف دفعة لمورد وتخصيصها على فواتيره",
    direction: "payment",
    requiresCustomer: false,
    requiresSupplier: true,
    allocatable: true,
    allocationKind: "purchase",
  },
  {
    code: "customer_refund",
    labelAr: "رد مبلغ لعميل",
    subtitleAr: "إرجاع مبلغ نقدي للعميل (بعد مرتجع أو رصيد دائن)",
    direction: "payment",
    requiresCustomer: true,
    requiresSupplier: false,
    allocatable: false,
    allocationKind: null,
  },
  {
    code: "customer_advance",
    labelAr: "دفعة مقدمة من عميل مقاولات",
    subtitleAr: "دفعة مقدمة يدفعها العميل على عقد مقاولة (تُسترد من المستخلصات)",
    direction: "receipt",
    requiresCustomer: true,
    requiresSupplier: false,
    allocatable: false,
    allocationKind: null,
  },
  {
    code: "supplier_refund",
    labelAr: "استرداد من مورد",
    subtitleAr: "استلام مبلغ نقدي من مورد (بعد مرتجع مشتريات أو رصيد دائن)",
    direction: "receipt",
    requiresCustomer: false,
    requiresSupplier: true,
    allocatable: false,
    allocationKind: null,
  },
  {
    code: "other_income",
    labelAr: "إيراد آخر",
    subtitleAr: "إيراد لا يخص فاتورة (إيجار محصّل، فوائد، خصومات بنكية…)",
    direction: "receipt",
    requiresCustomer: false,
    requiresSupplier: false,
    allocatable: false,
    allocationKind: null,
  },
  {
    code: "other_expense",
    labelAr: "مصروف آخر",
    subtitleAr: "مصروف لا يخص مورّداً (إيجار مدفوع، صيانة، مرافق…)",
    direction: "payment",
    requiresCustomer: false,
    requiresSupplier: false,
    allocatable: false,
    allocationKind: null,
  },
  {
    code: "capital_injection",
    labelAr: "ضخ رأس مال من الشريك",
    subtitleAr: "إيداع شخصي من الشريك إلى الخزينة",
    direction: "receipt",
    requiresCustomer: false,
    requiresSupplier: false,
    allocatable: false,
    allocationKind: null,
  },
  {
    code: "capital_withdrawal",
    labelAr: "سحب شخصي للشريك",
    subtitleAr: "سحب شخصي من الخزينة للشريك",
    direction: "payment",
    requiresCustomer: false,
    requiresSupplier: false,
    allocatable: false,
    allocationKind: null,
  },
  {
    code: "tax_payment",
    labelAr: "دفع لمصلحة الضرائب",
    subtitleAr: "دفعة لمصلحة الضرائب أو جهة حكومية",
    direction: "payment",
    requiresCustomer: false,
    requiresSupplier: false,
    allocatable: false,
    allocationKind: null,
  },
  {
    code: "inter_treasury_transfer",
    labelAr: "تحويل بين الخزائن",
    subtitleAr: "تحويل مبلغ بين خزينتين داخل المنشأة",
    direction: "transfer",
    requiresCustomer: false,
    requiresSupplier: false,
    allocatable: false,
    allocationKind: null,
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
