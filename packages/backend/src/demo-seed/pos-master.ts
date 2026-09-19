import type { App } from "@mezan/api";
import { POS_CARD_METHOD_ID, POS_CASH_METHOD_ID } from "@mezan/domain";
import type { SeedFragment, SeedFragmentContext } from "./fragments.js";
import { ACCOUNTS, BRANCH_ID, WAREHOUSE_ID, step } from "./shared.js";

const GIZA_WAREHOUSE_ID = "WH-DEMO-2";

/**
 * One drawer per till: a shared drawer cannot be reconciled per shift. Card
 * and wallet tenders land in their clearing accounts (1315, 1330) until the
 * acquirer settles to the bank, never in the drawer.
 */
const TREASURY_ACCOUNTS = [
  { id: "TR-POS-DRAWER-1", code: "DRW-001", name: "درج الكاشير ١", nameEn: "Till drawer 1", type: "cash", glAccountId: ACCOUNTS.cash },
  { id: "TR-POS-DRAWER-2", code: "DRW-002", name: "درج الكاشير ٢", nameEn: "Till drawer 2", type: "cash", glAccountId: ACCOUNTS.cash },
  { id: "TR-POS-CARDS", code: "CARD-CLR", name: "مستحقات ماكينة البطاقات", nameEn: "Card clearing", type: "bank", glAccountId: "1315" },
  { id: "TR-POS-WALLETS", code: "WLT-CLR", name: "مستحقات المحافظ الإلكترونية", nameEn: "E-wallet clearing", type: "bank", glAccountId: "1330" },
] as const;

const SHIFT_TEMPLATES = [
  { nameAr: "الوردية الصباحية", nameEn: "Morning shift", fromTime: "08:00", toTime: "16:00", branchId: null, active: true },
  { nameAr: "الوردية المسائية", nameEn: "Evening shift", fromTime: "16:00", toTime: "00:00", branchId: BRANCH_ID, active: true },
  { nameAr: "الوردية الليلية", nameEn: "Night shift", fromTime: "00:00", toTime: "08:00", branchId: BRANCH_ID, active: false },
];

async function run(app: App, ctx: SeedFragmentContext): Promise<void> {
  for (const template of SHIFT_TEMPLATES) await step(app, "POST", "/shift-templates", template);
  if (!ctx.licensed("pos")) return;

  for (const account of TREASURY_ACCOUNTS) {
    await step(app, "POST", "/treasury-accounts", { ...account, currency: "EGP", branchId: BRANCH_ID });
  }

  await step(app, "PUT", `/pos/payment-methods/${POS_CARD_METHOD_ID}`, { defaultTreasuryAccountId: "TR-POS-CARDS" });
  const wallet = (await step(app, "POST", "/pos/payment-methods", {
    code: "VFCASH",
    nameAr: "فودافون كاش",
    nameEn: "Vodafone Cash",
    kind: "wallet",
    accountType: "bank",
    defaultTreasuryAccountId: "TR-POS-WALLETS",
  })) as { id: string };
  const instapay = (await step(app, "POST", "/pos/payment-methods", {
    code: "INSTAPAY",
    nameAr: "إنستاباي",
    nameEn: "InstaPay",
    kind: "transfer",
    accountType: "bank",
    defaultTreasuryAccountId: "TR-DEMO-BANK",
  })) as { id: string };
  const onAccount = (await step(app, "POST", "/pos/payment-methods", {
    code: "ONACCOUNT",
    nameAr: "آجل على حساب العميل",
    nameEn: "On account",
    kind: "on_account",
  })) as { id: string };

  await step(app, "POST", "/pos/terminals", {
    code: "POS-001",
    name: "كاشير ١ — الفرع الرئيسي",
    nameEn: "Till 1 — Main branch",
    kind: "retail",
    branchId: BRANCH_ID,
    warehouseId: WAREHOUSE_ID,
    drawerTreasuryAccountId: "TR-POS-DRAWER-1",
    methods: [
      { methodId: POS_CASH_METHOD_ID, treasuryAccountId: null },
      { methodId: POS_CARD_METHOD_ID, treasuryAccountId: null },
      { methodId: wallet.id, treasuryAccountId: null },
      { methodId: instapay.id, treasuryAccountId: null },
    ],
    defaultMethodId: POS_CASH_METHOD_ID,
    printer: { kind: "escpos-tcp", address: "192.168.1.100:9100", paperWidthMm: 80 },
  });
  // Its own device (DEC-25): the second till must not receipt under POS-001's serial.
  // No credentials: invented ones would reach the real gateway (D284), so this
  // till reads «بيانات الجهاز ناقصة» until the owner registers it.
  await step(app, "POST", "/pos/terminals", {
    code: "POS-002",
    name: "كاشير ٢ — الفرع الرئيسي",
    nameEn: "Till 2 — Main branch",
    kind: "retail",
    branchId: BRANCH_ID,
    warehouseId: WAREHOUSE_ID,
    drawerTreasuryAccountId: "TR-POS-DRAWER-2",
    methods: [
      { methodId: POS_CASH_METHOD_ID, treasuryAccountId: null },
      { methodId: POS_CARD_METHOD_ID, treasuryAccountId: null },
      { methodId: onAccount.id, treasuryAccountId: null },
    ],
    defaultMethodId: POS_CASH_METHOD_ID,
    printer: { kind: "system", address: null, paperWidthMm: 80 },
    etaDeviceSerial: "MEZAN-POS-0002",
  });
  // Disabled, so the list's «غير نشط» filter and the readiness column have a row to show.
  await step(app, "POST", "/pos/terminals", {
    code: "POS-003",
    name: "كشك الجيزة",
    nameEn: "Giza kiosk",
    kind: "retail",
    branchId: BRANCH_ID,
    warehouseId: GIZA_WAREHOUSE_ID,
    drawerTreasuryAccountId: "TR-POS-DRAWER-1",
    methods: [{ methodId: POS_CASH_METHOD_ID, treasuryAccountId: null }],
    defaultMethodId: POS_CASH_METHOD_ID,
    printer: { kind: "system", address: null, paperWidthMm: 58 },
    active: false,
  });

  await step(app, "PUT", "/pos/settings", {
    mealSections: [{ name: "المقبلات" }, { name: "الأطباق الرئيسية" }, { name: "التحلية" }],
  });

}

export const seed: SeedFragment = {
  roles: [
    {
      code: "CASHIER",
      name: "كاشير",
      description: "يبيع على جهاز نقطة البيع ويقفل ورديته — ولا يغيّر إعدادات الأجهزة.",
      permissions: ["pos.terminal.view", "sales.customer.view", "inventory.item.view", "inventory.stock.view"],
    },
  ],
  roleGrants: {
    // The supervisor approves an over-limit discount at the till (plan §3.7).
    SUPERVISOR: ["pos.terminal.view", "pos.discount.approve"],
  },
  people: [
    {
      nameAr: "مروة حسن",
      nameEn: "Marwa Hassan",
      local: "marwa.hassan",
      role: "CASHIER",
      status: "active",
      branchScope: [BRANCH_ID],
      warehouseScope: [WAREHOUSE_ID],
    },
  ],
  run,
};
