import type { App } from "@mezan/api";
import { step } from "./shared.js";

/**
 * Seed profile module — see `./shared.ts`. Local and test environments only.
 *
 * Who can get into this tenant: the email-domain policy, the roles a real shop
 * actually separates, and a person holding each one.
 *
 * The base seed creates exactly one account — the owner's — which is correct
 * for a tenant that has just been installed and wrong for a demo: a users
 * screen with a single row cannot show that scoping, deactivation or the
 * domain policy work at all, and neither can a role list with one system role
 * in it.
 *
 * ORDER MATTERS. The domain policy is written FIRST and every account below
 * sits inside it, so seeding is itself a test of the rule: if the guard were
 * wrong, `POST /users` would refuse here and the seed would fail loudly rather
 * than quietly producing accounts the running product would have rejected.
 */

/** The seeded tenant is "Cyag", so its people are at cyag.example (RFC 2606). */
const TENANT_DOMAIN = "cyag.example";

/** Scope targets. `WH-DEMO-2` is Giza and `WH-DEMO-VAN` the delivery van. */
const BRANCH_ID = "BR-MAIN";
const GIZA_WAREHOUSE_ID = "WH-DEMO-2";
const VAN_WAREHOUSE_ID = "WH-DEMO-VAN";

/**
 * Roles a small Egyptian business genuinely separates, each with the narrowest
 * permission set that still lets the person do their job. Deliberately NOT
 * `["*"]` copies: a role list where every row grants everything demonstrates
 * nothing about the permission matrix, and hides the one bug that matters —
 * a screen that opens for someone who should not see it.
 *
 * `saveRole` rejects an unknown code (`UNKNOWN_PERMISSION`) and one whose
 * module the tenant is not licensed for (`UNLICENSED_PERMISSION`), so a typo
 * below fails the seed rather than quietly producing a role that cannot do its
 * job. `pos.*` is the one module this tenant does not hold.
 *
 * SUPERVISOR and FINANCE_MANAGER are not decoration: `platform.ts` configures
 * the approval chains for SALES_INVOICE_CONFIRM and PURCHASE_INVOICE_CONFIRM
 * against those two role CODES, and until now no account held either — every
 * gated document went to an inbox no one who could sign in was able to clear.
 */
const ROLES = [
  {
    code: "ACCOUNTANT",
    name: "محاسب",
    description: "يقيّد ويراجع الحركات المالية ويقفل الفترة.",
    permissions: [
      "dashboard.view",
      "accounting.journal.view",
      "accounting.journal.create",
      "accounting.coa.view",
      "accounting.period.view",
      "accounting.reports.view",
      "treasury.cash_voucher.view",
      "sales.invoice.view",
      "purchases.invoice.view",
    ],
  },
  {
    code: "WAREHOUSE_KEEPER",
    name: "أمين مخزن",
    description: "يستلم ويصرف ويحوّل المخزون ويجري الجرد.",
    permissions: [
      "dashboard.view",
      "inventory.stock.view",
      "inventory.transfer.view",
      "inventory.transfer.create",
      "inventory.count.view",
      "inventory.count.create",
      "inventory.item.view",
      "purchases.receipt.view",
    ],
  },
  {
    code: "SALES_REP",
    name: "مندوب مبيعات",
    description: "يصدر عروض الأسعار والفواتير لعملائه فقط.",
    permissions: [
      "dashboard.view",
      "sales.quote.view_own",
      "sales.quote.create",
      "sales.invoice.view_own",
      "sales.invoice.create",
      "sales.customer.view",
      "inventory.stock.view",
    ],
  },
  {
    code: "SUPERVISOR",
    name: "مشرف المبيعات",
    description: "يراجع فواتير المندوبين ويعتمد ما يحتاج موافقة قبل التأكيد.",
    permissions: [
      "dashboard.view",
      // view_all, where SALES_REP has view_own: the two halves of the
      // visibility model, so a screen that ignores the tier has a control.
      "sales.invoice.view",
      "sales.invoice.view_all",
      "sales.invoice.confirm",
      "sales.invoice.print",
      "sales.quote.view",
      "sales.return.view",
      "sales.return.confirm",
      "sales.customer.view",
      "inventory.stock.view",
      "workflow.view",
      "workflow.approve",
      "workflow.reject",
      "transactions.view",
    ],
  },
  {
    code: "FINANCE_MANAGER",
    name: "المدير المالي",
    description: "يعتمد القيود وفواتير الشراء والرواتب ويقفل الفترة المالية.",
    permissions: [
      "dashboard.view",
      "dashboard.export",
      "accounting.coa.view",
      "accounting.journal.view",
      "accounting.journal.post",
      "accounting.journal.approve",
      "accounting.period.view",
      "accounting.period.close",
      "accounting.reports.view",
      "accounting.exchange_rate.approve",
      "accounting.tax.view",
      "treasury.account.view",
      "treasury.cash_voucher.view",
      "treasury.cash_voucher.confirm",
      // Reversing money is deliberately here and NOT with the cashier who
      // raised it — the whole point of the pair of roles.
      "treasury.cash_voucher.void",
      "treasury.allocation.view",
      "treasury.reconciliation.view",
      "treasury.reconciliation.finalize",
      "purchases.invoice.view",
      "purchases.invoice.confirm",
      "sales.invoice.view",
      "sales.invoice.view_all",
      "sales.invoice.view_cost",
      "hr.employee.view",
      "hr.employee.view_salary",
      "hr.payroll.view",
      "hr.payroll.approve",
      "hr.payroll.pay",
      "workflow.view",
      "workflow.approve",
      "workflow.reject",
      "transactions.view",
      "transactions.view_all",
      "audit.logs.view",
    ],
  },
  {
    code: "PURCHASING_OFFICER",
    name: "مسؤول المشتريات",
    description: "يطلب عروض الأسعار ويصدر أوامر الشراء ويستلم البضاعة.",
    permissions: [
      "dashboard.view",
      "purchases.supplier.view",
      "purchases.supplier.create",
      "purchases.supplier.edit",
      "purchases.supplier360.view",
      "purchases.rfq.view",
      "purchases.rfq.create",
      "purchases.rfq.convert",
      "purchases.order.view",
      "purchases.order.create",
      "purchases.order.edit",
      "purchases.order.confirm",
      "purchases.order.cancel",
      "purchases.receipt.view",
      "purchases.receipt.create",
      "purchases.receipt.confirm",
      "purchases.invoice.view",
      "purchases.invoice.create",
      "purchases.return.view",
      "purchases.return.create",
      "purchases.landed_cost.view",
      "purchases.landed_cost.create",
      "inventory.item.view",
      "inventory.stock.view",
    ],
  },
  {
    code: "TREASURY_CASHIER",
    name: "أمين الخزنة",
    description: "يحصّل ويصرف ويودع الشيكات ويطابق كشف البنك.",
    permissions: [
      "dashboard.view",
      "treasury.account.view",
      "treasury.cash_voucher.view",
      "treasury.cash_voucher.create",
      "treasury.cash_voucher.confirm",
      "treasury.allocation.view",
      "treasury.allocation.manage",
      "treasury.transfer.view",
      "treasury.transfer.create",
      "treasury.customer_refund.view",
      "treasury.customer_refund.create",
      "treasury.reconciliation.view",
      "treasury.reconciliation.import",
      "treasury.reconciliation.match",
      "cheques.view",
      "cheques.create",
      "cheques.deposit",
      "cheques.collect",
      "cheques.bounce",
      "installments.plan.view",
      "installments.collect",
      "installments.collection.create",
      "sales.invoice.view",
      "sales.customer.view",
      "purchases.invoice.view",
      "purchases.supplier.view",
    ],
  },
  {
    code: "HR_OFFICER",
    name: "مسؤول شؤون العاملين",
    description: "يدير ملفات الموظفين والحضور والإجازات — دون رؤية الرواتب.",
    permissions: [
      "dashboard.view",
      // No `hr.employee.view_salary` and no `hr.employee.view_personal`: the
      // two ⚠ sensitive codes belong to PAYROLL_OFFICER. A tenant where the
      // same person holds both cannot show that the flag means anything.
      "hr.employee.view",
      "hr.employee.create",
      "hr.employee.edit",
      "hr.attendance.view",
      "hr.attendance.edit",
      "hr.leave.view",
      "hr.leave.create",
      "hr.leave.approve",
      "hr.advance.view",
      "hr.advance.create",
      "hr.contract.view",
      "hr.contract.create",
      "hr.contract.edit",
      "hr.department.view",
      "hr.department.create",
      "hr.department.edit",
      "hr.job_title.view",
      "hr.job_title.create",
      "hr.job_title.edit",
      "hr.leave_policy.view",
      "hr.leave_policy.edit",
    ],
  },
  {
    code: "PAYROLL_OFFICER",
    name: "مسؤول الرواتب",
    description: "يحسب مسيّر الرواتب ويعرضه للاعتماد — ولا يعتمده ولا يصرفه.",
    permissions: [
      "dashboard.view",
      "hr.employee.view",
      "hr.employee.view_salary",
      "hr.employee.view_personal",
      "hr.payroll.view",
      "hr.payroll.create",
      "hr.payroll.calculate",
      "hr.payroll.run",
      "hr.attendance.view",
      "hr.advance.view",
      "hr.leave.view",
      "accounting.reports.view",
      "treasury.cash_voucher.view",
    ],
  },
  {
    code: "BRANCH_MANAGER",
    name: "مدير الفرع",
    description: "يتابع بيع وشراء ومخزون فرعه ويعتمد إجازات فريقه.",
    permissions: [
      "dashboard.view",
      "dashboard.export",
      "sales.invoice.view",
      "sales.invoice.view_all",
      "sales.invoice.confirm",
      "sales.quote.view",
      "sales.customer.view",
      "purchases.invoice.view",
      "purchases.order.view",
      "inventory.item.view",
      "inventory.stock.view",
      "inventory.transfer.view",
      "inventory.transfer.confirm",
      "inventory.count.view",
      "inventory.count.confirm",
      "inventory.adjustment.view",
      "treasury.cash_voucher.view",
      "accounting.reports.view",
      "hr.employee.view",
      "hr.attendance.view",
      "hr.leave.view",
      "hr.leave.approve",
      "workflow.view",
      "transactions.view",
    ],
  },
  {
    code: "AUDITOR",
    name: "مراجع داخلي",
    description: "يقرأ كل شيء ولا يغيّر أي شيء.",
    permissions: [
      // Every code here is a `.view`. An auditor who can confirm, void or
      // post is not an auditor, and a role list with no read-only row cannot
      // show that a screen opens without its write controls.
      "dashboard.view",
      "dashboard.export",
      "accounting.coa.view",
      "accounting.journal.view",
      "accounting.period.view",
      "accounting.reports.view",
      "accounting.tax.view",
      "accounting.eta.view",
      "sales.invoice.view",
      "sales.invoice.view_all",
      "sales.invoice.view_cost",
      "sales.customer.view",
      "sales.quote.view",
      "sales.return.view",
      "sales.price_list.view",
      "sales.promotion.view",
      "purchases.supplier.view",
      "purchases.supplier360.view",
      "purchases.order.view",
      "purchases.receipt.view",
      "purchases.invoice.view",
      "purchases.return.view",
      "purchases.landed_cost.view",
      "inventory.item.view",
      "inventory.stock.view",
      "inventory.valuation.view",
      "inventory.transfer.view",
      "inventory.count.view",
      "inventory.adjustment.view",
      "inventory.writedown.view",
      "treasury.account.view",
      "treasury.cash_voucher.view",
      "treasury.allocation.view",
      "treasury.transfer.view",
      "treasury.reconciliation.view",
      "cheques.view",
      "crm.customer360.view",
      "installments.plan.view",
      "assets.view",
      "assets.depreciation.view",
      "workflow.view",
      "audit.logs.view",
      "transactions.view",
      "transactions.view_all",
      "admin.users.view",
      "admin.roles.view",
      "admin.settings.view",
    ],
  },
  {
    code: "VAN_SALES",
    name: "مندوب توزيع",
    description: "يبيع من عربة التوزيع ويحصّل نقداً ويسوّي عهدته آخر اليوم.",
    permissions: [
      "dashboard.view",
      "field.van_trip.view_own",
      "field.van_trip.open",
      "field.van_trip.settle",
      "sales.invoice.view_own",
      "sales.invoice.create",
      "sales.invoice.confirm",
      "sales.invoice.print",
      "sales.return.view_own",
      "sales.return.create",
      "sales.customer.view",
      "inventory.stock.view",
      "treasury.cash_voucher.view",
      "treasury.cash_voucher.create",
    ],
  },
  {
    code: "CRM_MANAGER",
    name: "مسؤول علاقات العملاء",
    description: "يتابع العملاء المحتملين والفرص وعروض الأسعار حتى الفاتورة.",
    permissions: [
      "dashboard.view",
      "crm.lead.view",
      "crm.lead.create",
      "crm.lead.edit",
      "crm.lead.assign",
      "crm.lead.convert",
      "crm.opportunity.view",
      "crm.opportunity.create",
      "crm.opportunity.edit",
      "crm.activity.view",
      "crm.activity.create",
      "crm.activity.edit",
      "crm.pipeline.view",
      "crm.pipeline.manage",
      "crm.customer360.view",
      "sales.customer.view",
      "sales.customer.create",
      "sales.customer.edit",
      "sales.quote.view",
      "sales.quote.create",
      "sales.quote.send",
      "sales.invoice.view",
      "installments.plan.view",
      "installments.follow_up.view",
      "installments.follow_up.manage",
    ],
  },
] as const;

/**
 * One person per role, a second company admin, a deactivated account, and two
 * whose scope is genuinely narrowed.
 *
 * The inactive row is the point of `hala.mostafa`: «تعطيل» is a control nobody
 * can prove works on a list where every account is active, and a deactivated
 * user who can still sign in is exactly the defect it would hide.
 *
 * `branchScope` / `warehouseScope` default to `"*"`. Two people below carry a
 * real allow-list instead, because a tenant where every account sees every
 * warehouse cannot show that the selector narrows anything — which is the bug
 * that shipped once already (D8: the shell sent the header, the resolver
 * parsed it, and no route read it).
 *
 * NOTE: `POST /users` mints its own uuid and the wire schema has no `id`, so
 * there is no stable id to reference a seeded person by — the EMAIL is the
 * handle, here and at the login. `employeeId` is the exception: it points at a
 * real `/hr/employees` record, which is what gives that person an HR file,
 * their own leave queue and a name on the commission report.
 */
interface Person {
  readonly nameAr: string;
  readonly nameEn: string;
  /** Local part of the login email, and the suffix of the demo password. */
  readonly local: string;
  /** Role code from ROLES above, or null for a company admin. */
  readonly role: string | null;
  readonly status: "active" | "inactive";
  readonly branchScope?: readonly string[];
  readonly warehouseScope?: readonly string[];
  readonly employeeId?: string;
}

const PEOPLE: readonly Person[] = [
  { nameAr: "منى عبد الرحمن", nameEn: "Mona Abdelrahman", local: "mona.abdelrahman", role: "ACCOUNTANT", status: "active" },
  { nameAr: "سيد جمال", nameEn: "Sayed Gamal", local: "sayed.gamal", role: "WAREHOUSE_KEEPER", status: "active" },
  { nameAr: "كريم فؤاد", nameEn: "Karim Fouad", local: "karim.fouad", role: "SALES_REP", status: "active" },
  { nameAr: "هالة مصطفى", nameEn: "Hala Mostafa", local: "hala.mostafa", role: "SALES_REP", status: "inactive" },

  /**
   * A SECOND company admin — no role, the `"*"` wildcard, every gate bypassed.
   * The owner's own account is the one a demo must not hand out, and an admin
   * bypass that only one account has ever exercised is untested.
   */
  { nameAr: "نادية شفيق", nameEn: "Nadia Shafik", local: "nadia.shafik", role: null, status: "active" },

  { nameAr: "طارق منصور", nameEn: "Tarek Mansour", local: "tarek.mansour", role: "FINANCE_MANAGER", status: "active" },
  { nameAr: "عمر هلال", nameEn: "Omar Hilal", local: "omar.hilal", role: "SUPERVISOR", status: "active" },
  { nameAr: "رانيا عادل", nameEn: "Rania Adel", local: "rania.adel", role: "PURCHASING_OFFICER", status: "active" },
  { nameAr: "يوسف بدر", nameEn: "Youssef Badr", local: "youssef.badr", role: "TREASURY_CASHIER", status: "active" },
  { nameAr: "داليا سعيد", nameEn: "Dalia Saeed", local: "dalia.saeed", role: "HR_OFFICER", status: "active" },
  { nameAr: "أمير زكي", nameEn: "Amir Zaki", local: "amir.zaki", role: "PAYROLL_OFFICER", status: "active" },
  { nameAr: "ليلى إبراهيم", nameEn: "Laila Ibrahim", local: "laila.ibrahim", role: "AUDITOR", status: "active" },
  { nameAr: "سامح فتحي", nameEn: "Sameh Fathy", local: "sameh.fathy", role: "CRM_MANAGER", status: "active" },

  // Scoped to the one branch by an explicit allow-list rather than "*" — the
  // same value a second branch would narrow against.
  { nameAr: "حسام نبيل", nameEn: "Hossam Nabil", local: "hossam.nabil", role: "BRANCH_MANAGER", status: "active", branchScope: [BRANCH_ID] },

  // Sees the Giza warehouse and nothing else, holding the SAME role as the
  // all-warehouse storekeeper above: the scope is the only difference between
  // the two accounts, so anything they see differently is the scope working.
  { nameAr: "مجدي رشاد", nameEn: "Magdy Rashad", local: "magdy.rashad", role: "WAREHOUSE_KEEPER", status: "active", warehouseScope: [GIZA_WAREHOUSE_ID] },

  // The van rep is an EMPLOYEE first — `EMP-DEMO-2`, سلمى فؤاد, already
  // carries seeded invoices as their salesperson — and this is that person's
  // login, scoped to the van she loads from.
  { nameAr: "سلمى فؤاد", nameEn: "Salma Fouad", local: "salma.fouad", role: "VAN_SALES", status: "active", warehouseScope: [VAN_WAREHOUSE_ID], employeeId: "EMP-DEMO-2" },
];

interface SeededRole {
  readonly id: string;
  readonly code: string;
}

export async function seedAccess(app: App): Promise<void> {
  // --- النطاقات المسموحة للبريد ---
  // Read-modify-write: settings is one bag and a PUT replaces it, so writing
  // only this key would blank every other policy the seed has set.
  const settings = (await step(app, "GET", "/settings")) as Record<string, unknown>;
  await step(app, "PUT", "/settings", { ...settings, allowedEmailDomains: [TENANT_DOMAIN] });

  // --- الأدوار ---
  const roleIdByCode = new Map<string, string>();
  for (const role of ROLES) {
    const created = (await step(app, "POST", "/roles", {
      code: role.code,
      name: role.name,
      description: role.description,
      permissions: [...role.permissions],
    })) as SeededRole;
    roleIdByCode.set(role.code, created.id);
  }

  // --- المستخدمون ---
  for (const person of PEOPLE) {
    // Exactly one of roleId / isCompanyAdmin, which is what the wire schema
    // refines on. All but one person here holds a ROLE: an admin bypasses the
    // permission matrix entirely, so a tenant where everyone is one proves
    // nothing about the gates.
    const roleId = person.role === null ? null : roleIdByCode.get(person.role);
    if (roleId === undefined) throw new Error(`[demo-seed] no role "${person.role}" for ${person.local}`);
    await step(app, "POST", "/users", {
      nameAr: person.nameAr,
      nameEn: person.nameEn,
      email: `${person.local}@${TENANT_DOMAIN}`,
      phone: null,
      roleId,
      isCompanyAdmin: roleId === null,
      employeeId: person.employeeId ?? null,
      branchScope: person.branchScope ? [...person.branchScope] : "*",
      warehouseScope: person.warehouseScope ? [...person.warehouseScope] : "*",
      status: person.status,
      password: `Mezan-demo-${person.local}`,
      // Six digits, like every other PIN in the system since the login stopped
      // asking for a typed username — the device supplies the identity, so the
      // PIN is the whole credential. The SAME PIN for every demo account on
      // purpose: a demo whose logins each need a different code is a demo
      // nobody signs into twice.
      pin: "123456",
    });
  }
}
