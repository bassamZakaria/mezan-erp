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

/**
 * Roles a small Egyptian business genuinely separates, each with the narrowest
 * permission set that still lets the person do their job. Deliberately NOT
 * `["*"]` copies: a role list where every row grants everything demonstrates
 * nothing about the permission matrix, and hides the one bug that matters —
 * a screen that opens for someone who should not see it.
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
] as const;

/**
 * One person per role, plus a deactivated account.
 *
 * The inactive row is the point of the fourth: «تعطيل» is a control nobody can
 * prove works on a list where every account is active, and a deactivated user
 * who can still sign in is exactly the defect it would hide.
 */
const PEOPLE = [
  { id: "USER-ACCOUNTANT", nameAr: "منى عبد الرحمن", nameEn: "Mona Abdelrahman", local: "mona.abdelrahman", role: "ACCOUNTANT", status: "active" },
  { id: "USER-WAREHOUSE", nameAr: "سيد جمال", nameEn: "Sayed Gamal", local: "sayed.gamal", role: "WAREHOUSE_KEEPER", status: "active" },
  { id: "USER-SALES", nameAr: "كريم فؤاد", nameEn: "Karim Fouad", local: "karim.fouad", role: "SALES_REP", status: "active" },
  { id: "USER-LEAVER", nameAr: "هالة مصطفى", nameEn: "Hala Mostafa", local: "hala.mostafa", role: "SALES_REP", status: "inactive" },
] as const;

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
    const roleId = roleIdByCode.get(person.role);
    if (!roleId) throw new Error(`[demo-seed] no role "${person.role}" for ${person.id}`);
    await step(app, "POST", "/users", {
      id: person.id,
      nameAr: person.nameAr,
      nameEn: person.nameEn,
      email: `${person.local}@${TENANT_DOMAIN}`,
      phone: null,
      // Every seeded person is scoped to a role, never to isCompanyAdmin —
      // an admin bypasses the permission matrix, so a tenant where everyone is
      // one proves nothing about the gates.
      roleId,
      isCompanyAdmin: false,
      employeeId: null,
      branchScope: "*",
      warehouseScope: "*",
      status: person.status,
      password: `Mezan-demo-${person.local}`,
      // Six digits, like every other PIN in the system since the login stopped
      // asking for a typed username — the device supplies the identity, so the
      // PIN is the whole credential.
      pin: "123456",
    });
  }
}
