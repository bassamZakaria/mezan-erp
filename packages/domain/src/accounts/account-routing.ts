/**
 * توجيه الحسابات — which GL account each kind of posting lands in (R6.1).
 *
 * Every one of these mappings already existed, hard-coded at the point of
 * posting: the VAT account inside the invoice document type, the contra
 * account inside each stock-adjustment reason, the equity account inside each
 * voucher type. That works until a tenant's chart of accounts differs from the
 * template — and then the only way to change where a theft loss lands is to
 * edit the source.
 *
 * The slots below are the registry. A tenant overrides the ones it needs; the
 * `defaultAccountId` on each slot is what the standard template ships with, so
 * an empty routing table behaves exactly as the hard-coded version did.
 */

export type AccountRoutingSection =
  | "tax"
  | "leave"
  | "contracting"
  | "sales_discount"
  | "inventory_adjustment"
  | "payroll"
  | "item_type";

export interface AccountRoutingSlot {
  /** Stable key the posting code asks for. Never renamed once shipped. */
  readonly key: string;
  readonly section: AccountRoutingSection;
  readonly labelAr: string;
  readonly labelEn: string;
  /** What the standard chart of accounts ships with. */
  readonly defaultAccountId: string;
}

export const ACCOUNT_ROUTING_SLOTS: readonly AccountRoutingSlot[] = [
  // --- الضرائب ---
  { key: "tax.output_vat", section: "tax", labelAr: "ضريبة القيمة المضافة المستحقة", labelEn: "Output VAT payable", defaultAccountId: "2200" },
  { key: "tax.input_vat", section: "tax", labelAr: "ضريبة القيمة المضافة على المشتريات", labelEn: "Input VAT recoverable", defaultAccountId: "1400" },

  // --- الإجازات (IAS-19 accrual) ---
  { key: "leave.liability", section: "leave", labelAr: "التزام الإجازات المستحقة", labelEn: "Accrued leave liability", defaultAccountId: "2180" },
  { key: "leave.expense", section: "leave", labelAr: "مصروف الإجازات", labelEn: "Leave expense", defaultAccountId: "5110" },

  // --- المقاولات ---
  { key: "contracting.revenue", section: "contracting", labelAr: "إيرادات المقاولات", labelEn: "Contracting revenue", defaultAccountId: "4150" },
  { key: "contracting.retention_receivable", section: "contracting", labelAr: "محتجزات لدى العملاء", labelEn: "Retention receivable", defaultAccountId: "1150" },
  { key: "contracting.customer_advances", section: "contracting", labelAr: "دفعات مقدمة من العملاء", labelEn: "Advances from contracting customers", defaultAccountId: "2160" },
  { key: "contracting.late_penalty", section: "contracting", labelAr: "غرامات التأخير", labelEn: "Late-delivery penalties", defaultAccountId: "5910" },
  { key: "contracting.employer_materials", section: "contracting", labelAr: "استهلاك عهدة المواد", labelEn: "Employer-supplied materials consumed", defaultAccountId: "5157" },
  { key: "contracting.stamp_duty", section: "contracting", labelAr: "دمغات ورسوم", labelEn: "Stamp duty and fees", defaultAccountId: "5158" },
  { key: "contracting.utilities", section: "contracting", labelAr: "مصروفات مرافق الموقع", labelEn: "Site utilities consumed", defaultAccountId: "5159" },
  // The rest of the contracting set (docs/artifacts/mezan-contracting-designs.html D-03,
  // D-04, D-12): billing and revenue are two arrows from two sources, so each needs
  // its own account, and retention has a payable direction.
  { key: "contracting.billings", section: "contracting", labelAr: "فواتير مستخلصات على العقود", labelEn: "Billings on contracts", defaultAccountId: "2165" },
  { key: "contracting.contract_asset", section: "contracting", labelAr: "أصل العقد", labelEn: "Contract asset", defaultAccountId: "1170" },
  { key: "contracting.contract_liability", section: "contracting", labelAr: "التزام العقد", labelEn: "Contract liability", defaultAccountId: "2175" },
  { key: "contracting.wip", section: "contracting", labelAr: "أعمال تحت التنفيذ — مقاولات", labelEn: "Contract work in progress", defaultAccountId: "1230" },
  { key: "contracting.cost_of_revenue", section: "contracting", labelAr: "تكلفة إيراد العقود", labelEn: "Cost of contract revenue", defaultAccountId: "5150" },
  { key: "contracting.wht_receivable", section: "contracting", labelAr: "ضريبة خصم وتحصيل مستردة", labelEn: "Withholding tax receivable", defaultAccountId: "1175" },
  { key: "contracting.social_insurance", section: "contracting", labelAr: "تأمينات اجتماعية — مقاولات", labelEn: "Contracting social insurance", defaultAccountId: "5155" },
  { key: "contracting.retention_payable", section: "contracting", labelAr: "المحتجزات الضمانية المستحقة لمقاولي الباطن", labelEn: "Retention payable to subcontractors", defaultAccountId: "2195" },
  { key: "contracting.onerous_provision", section: "contracting", labelAr: "مخصص عقود خاسرة", labelEn: "Onerous contract provision", defaultAccountId: "2196" },
  { key: "contracting.onerous_loss", section: "contracting", labelAr: "خسائر عقود متوقعة", labelEn: "Foreseeable contract losses", defaultAccountId: "5930" },
  { key: "contracting.plant_recovery", section: "contracting", labelAr: "استرداد تكلفة تشغيل المعدات", labelEn: "Internal plant hire recovery", defaultAccountId: "5160" },
  { key: "contracting.restricted_cash", section: "contracting", labelAr: "غطاء نقدي مقيد لخطابات الضمان", labelEn: "Restricted cash — guarantee margins", defaultAccountId: "1340" },
  { key: "contracting.memo_debit", section: "contracting", labelAr: "حسابات نظامية مدينة — خطابات ضمان", labelEn: "Memorandum debit — letters of guarantee", defaultAccountId: "9100" },
  { key: "contracting.memo_credit", section: "contracting", labelAr: "حسابات نظامية دائنة — خطابات ضمان", labelEn: "Memorandum credit — letters of guarantee", defaultAccountId: "9200" },
  // عقود الباطن. An advance PAID to a subcontractor is an asset until a
  // certificate recovers it; the tax withheld from its certificate is owed to
  // the authority, not to payroll's 2190; and the social insurance withheld
  // from the sub is money held for NOSI, never a credit back to the
  // contractor's own insurance expense.
  { key: "contracting.subcontractor_advances", section: "contracting", labelAr: "سلف مقاولي الباطن", labelEn: "Subcontractor advances", defaultAccountId: "1350" },
  { key: "contracting.wht_payable", section: "contracting", labelAr: "ضريبة خصم وتحصيل مستحقة — مقاولو الباطن", labelEn: "Withholding tax payable — subcontractors", defaultAccountId: "2210" },
  { key: "contracting.social_insurance_withheld", section: "contracting", labelAr: "تأمينات اجتماعية محتجزة من مقاولي الباطن", labelEn: "Social insurance withheld from subcontractors", defaultAccountId: "2197" },

  // --- خصم المبيعات ---
  { key: "sales_discount.contra", section: "sales_discount", labelAr: "حساب خصم المبيعات", labelEn: "Sales discount contra account", defaultAccountId: "4100" },

  // --- تسويات المخزون (one per reason — mirrors reasons.ts) ---
  { key: "inventory_adjustment.INITIAL_STOCK", section: "inventory_adjustment", labelAr: "رصيد افتتاحي", labelEn: "Opening balance", defaultAccountId: "3100" },
  { key: "inventory_adjustment.PHYSICAL_COUNT", section: "inventory_adjustment", labelAr: "تصحيح جرد", labelEn: "Count correction", defaultAccountId: "5074" },
  { key: "inventory_adjustment.DAMAGE", section: "inventory_adjustment", labelAr: "تلف", labelEn: "Damage", defaultAccountId: "5070" },
  { key: "inventory_adjustment.THEFT", section: "inventory_adjustment", labelAr: "سرقة", labelEn: "Theft", defaultAccountId: "5071" },
  { key: "inventory_adjustment.EXPIRY", section: "inventory_adjustment", labelAr: "انتهاء صلاحية", labelEn: "Expiry", defaultAccountId: "5072" },
  { key: "inventory_adjustment.SHORTAGE", section: "inventory_adjustment", labelAr: "نقص / فقدان", labelEn: "Shortage or loss", defaultAccountId: "5073" },
  { key: "inventory_adjustment.SUPPLIER_RETURN", section: "inventory_adjustment", labelAr: "مرتجع للمورد", labelEn: "Return to supplier", defaultAccountId: "2110" },
  { key: "inventory_adjustment.OTHER", section: "inventory_adjustment", labelAr: "أخرى", labelEn: "Other", defaultAccountId: "5075" },

  // --- الرواتب ---
  { key: "payroll.salary_expense", section: "payroll", labelAr: "مصروف الرواتب", labelEn: "Salary expense", defaultAccountId: "5120" },
  { key: "payroll.employer_contributions", section: "payroll", labelAr: "مساهمات صاحب العمل", labelEn: "Employer contributions", defaultAccountId: "5130" },
  { key: "payroll.salaries_payable", section: "payroll", labelAr: "رواتب مستحقة", labelEn: "Salaries payable", defaultAccountId: "2170" },
  { key: "payroll.withholdings_payable", section: "payroll", labelAr: "استقطاعات مستحقة", labelEn: "Withholdings payable", defaultAccountId: "2190" },

  // --- حسب نوع الصنف ---
  { key: "item_type.revenue", section: "item_type", labelAr: "إيرادات المبيعات", labelEn: "Sales revenue", defaultAccountId: "4100" },
  { key: "item_type.cogs", section: "item_type", labelAr: "تكلفة البضاعة المباعة", labelEn: "Cost of goods sold", defaultAccountId: "5100" },
  { key: "item_type.inventory", section: "item_type", labelAr: "المخزون", labelEn: "Inventory", defaultAccountId: "1200" },
  { key: "item_type.service_revenue", section: "item_type", labelAr: "إيرادات الخدمات", labelEn: "Service revenue", defaultAccountId: "4100" },
];

/**
 * The non-account choices that sit beside the routing table, because they
 * change what gets posted rather than where.
 *
 * A late-delivery penalty is either a deduction from contracting revenue (the
 * treatment the standard recommends, since the customer never owed it) or an
 * expense. The two produce different revenue figures from identical facts, so
 * this cannot be inferred — it has to be chosen.
 */
export type LatePenaltyTreatment = "revenue_deduction" | "expense";

export interface AccountRoutingOptions {
  readonly latePenaltyTreatment: LatePenaltyTreatment;
  /** Post sales discounts to their own contra account instead of netting revenue. */
  readonly useSeparateDiscountAccount: boolean;
  /** Extend that contra treatment to line-level discounts, not just invoice-level. */
  readonly applyDiscountAccountToLines: boolean;
}

export const DEFAULT_ACCOUNT_ROUTING_OPTIONS: AccountRoutingOptions = {
  latePenaltyTreatment: "revenue_deduction",
  useSeparateDiscountAccount: false,
  applyDiscountAccountToLines: false,
};

export interface AccountRouting {
  /** Slot key → account id. Only the slots a tenant has overridden. */
  readonly overrides: Readonly<Record<string, string>>;
  readonly options: AccountRoutingOptions;
}

export const EMPTY_ACCOUNT_ROUTING: AccountRouting = {
  overrides: {},
  options: DEFAULT_ACCOUNT_ROUTING_OPTIONS,
};

const SLOT_BY_KEY: ReadonlyMap<string, AccountRoutingSlot> = new Map(
  ACCOUNT_ROUTING_SLOTS.map((slot) => [slot.key, slot]),
);

export function isAccountRoutingKey(key: string): boolean {
  return SLOT_BY_KEY.has(key);
}

/**
 * The account a posting should use. Falls back to the slot's shipped default,
 * so a tenant that has never opened the screen posts exactly where the
 * hard-coded version did.
 */
export function routedAccountId(routing: AccountRouting | null | undefined, key: string): string | null {
  const override = routing?.overrides[key];
  if (override) return override;
  return SLOT_BY_KEY.get(key)?.defaultAccountId ?? null;
}

export interface AccountRoutingRepository {
  get(): Promise<AccountRouting | null>;
  save(routing: AccountRouting): Promise<void>;
}
