import { randomBytes, randomInt } from "node:crypto";
import {
  seedStandardChartOfAccounts,
  createBranch,
  createWarehouse,
  createDefaultSettings,
  generateFiscalYear,
  saveUser,
  createPipelineStage,
  createLabelLayout,
  ALL_SCOPE,
  type AccountRepository,
  type BranchRepository,
  type WarehouseRepository,
  type SettingsRepository,
  type TaxRateRepository,
  type FiscalPeriodRepository,
  type UnitOfWork,
  type SecretHasher,
  type Role,
  type TaxRate,
  type PipelineStageRepository,
  type ItemUnit,
  type ItemUnitRepository,
  type ItemCategory,
  type ItemCategoryRepository,
  type CreateLabelLayoutCommand,
  type LabelLayoutRepository,
} from "@mezan/domain";
import type { BootstrapSeedResultDTO } from "@mezan/contracts";

/**
 * Default tenant identity for a freshly-seeded, EMPTY database. These are seed
 * values only (docs/archive/catalog/09 — "Cyag" / محمد الشهابي); they are NOT sample
 * data driving any screen — once a real tenant edits settings / creates users,
 * the seed is never consulted again.
 */
export const SEED_TENANT_NAME = "Cyag";
export const SEED_ADMIN_NAME = "محمد الشهابي";
export const SEED_ADMIN_NAME_EN = "Mohamed El Shehaby";
export const SEED_ADMIN_EMAIL = "admin@cyag.example";
/**
 * The fallback admin's FIXED id.
 *
 * Exported because "is this the seeded account or a real one" is a security
 * question — `/bootstrap/admin` asks it — and the id is the only answer that is
 * not editable master data. The email is editable, and the status is editable,
 * and answering with either let a provisioned tenant be walked back to
 * "unclaimed".
 */
export const SEED_ADMIN_USER_ID = "USER-ADMIN";
/**
 * The DEVELOPMENT default PIN — the one docs/TESTING.md, `pnpm smoke`,
 * `pnpm check:seed` and `pnpm scenarios` all sign in with.
 *
 * It is published, so on a real install it is not a credential, it is a door.
 * `resolveSeedAdminSecrets` therefore hands it out only to a development
 * process; a packaged build gets random secrets instead (see below).
 */
export const SEED_ADMIN_PIN = "123456";
const SEED_ADMIN_PASSWORD = "change-me-on-first-login";

export interface SeedAdminSecrets {
  readonly pin: string;
  readonly password: string;
  /** True when the secrets were generated, i.e. nobody knows them yet. */
  readonly generated: boolean;
}

/**
 * The secrets the most recent seed minted, or null when this process has not
 * seeded a tenant.
 *
 * Module state, deliberately: the composition root (`createBackend`) has to be
 * able to hand a generated PIN to the desktop shell so it can be written
 * somewhere a human can read it once, and threading a return value out of
 * `seedIfEmpty` through every caller — smoke, scenarios, apps/server — to reach
 * one of them would change five signatures for one consumer.
 */
let lastSeededAdminSecrets: SeedAdminSecrets | null = null;

/** Reads and CLEARS the generated seed secrets — a one-shot handover, not a store. */
export function takeSeededAdminSecrets(): SeedAdminSecrets | null {
  const held = lastSeededAdminSecrets;
  lastSeededAdminSecrets = null;
  return held;
}

/**
 * What the fallback admin account is created with.
 *
 * A packaged install gets a random PIN and password rather than the published
 * `123456`, which meant every Mezan install in the country shared one working
 * company-admin login — verified against a seeded tenant, which returned
 * `permissions: ["*"]`.
 *
 * The generated PIN IS handed back to the caller, and the desktop shell writes
 * it to a one-time recovery file beside the database. Generating a secret and
 * printing it nowhere closed the only field-recovery door this product had
 * without opening another: a forgotten PIN then bricked the install outright —
 * no reset route, no recovery flag, no admin unlock, and a restored backup on
 * replacement hardware usable only by someone who still knew a PIN from the
 * machine that died. The remaining moves were hand-editing a scrypt hash into
 * the SQLite file or losing the books.
 *
 * `MEZAN_SEED_ADMIN_PIN` overrides it for a deliberate packaged-build test.
 */
export function resolveSeedAdminSecrets(
  env: Record<string, string | undefined> = process.env,
): SeedAdminSecrets {
  const override = env["MEZAN_SEED_ADMIN_PIN"];
  if (override && /^\d{6}$/.test(override)) {
    return { pin: override, password: SEED_ADMIN_PASSWORD, generated: false };
  }
  // Both a packaged desktop build and a headless production deployment get a
  // generated PIN. The objection to including `NODE_ENV=production` was real —
  // it silently seeded an admin nobody could log in as, on deployments with no
  // first-run wizard to recover through — but the answer to that is to PRINT
  // the secret, not to leave a server build on the published `123456`.
  // `takeSeededAdminSecrets()` below is how the composition root gets it.
  const packaged = env["MEZAN_PACKAGED"] === "1" || env["NODE_ENV"] === "production";
  if (!packaged) return { pin: SEED_ADMIN_PIN, password: SEED_ADMIN_PASSWORD, generated: false };
  return {
    pin: String(randomInt(0, 1_000_000)).padStart(6, "0"),
    // `randomInt` refuses a range wider than 2**48-1, so MAX_SAFE_INTEGER
    // (2**53-1) threw — on every packaged build, which is the only build that
    // reaches this branch. 32 hex characters is 128 bits, drawn from the same
    // CSPRNG, and is not a number at all.
    password: `pw-${randomBytes(16).toString("hex")}`,
    generated: true,
  };
}
const SEED_MAIN_BRANCH_ID = "BR-MAIN";
const SEED_MAIN_WAREHOUSE_ID = "WH-MAIN";
/**
 * مستودع التشغيل — the production floor. Seeded for EVERY tenant, not only
 * manufacturing ones: a work order cannot be created without a WIP warehouse
 * (that is what makes issued material countable rather than a value on the
 * order), and a shop that has to go and invent one in Settings before it can
 * write its first أمر تصنيع will instead conclude the module is broken. A
 * tenant that never manufactures can deactivate it.
 */
const SEED_WIP_WAREHOUSE_ID = "WH-WIP";

export interface SeedStores {
  readonly accounts: AccountRepository;
  readonly branches: BranchRepository;
  readonly warehouses: WarehouseRepository;
  readonly settings: SettingsRepository;
  readonly taxRates: TaxRateRepository;
  readonly fiscalPeriods: FiscalPeriodRepository;
  readonly uow: UnitOfWork;
  readonly hasher: SecretHasher;
  /**
   * Optional — seeds the 7 standard pipeline stages (docs/archive/catalog/06 "مراحل
   * خط المبيعات") on an empty DB when supplied. Omit it and the CRM pipeline
   * simply starts with zero stages (same as omitting any other optional
   * seed block).
   */
  readonly pipelineStages?: PipelineStageRepository;
  /**
   * Optional — seeds the standard units of measure and a starter category
   * tree (docs/archive/catalog/03 §"وحدة القياس" / §"تصنيفات الأصناف") on an empty DB
   * when supplied. Omit it and the item catalogs simply start empty.
   */
  readonly itemCatalog?: { readonly units: ItemUnitRepository; readonly categories: ItemCategoryRepository };
  /**
   * Optional — seeds the standard sticker-sheet geometries (docs/archive/catalog/03
   * §"طباعة الباركود والملصقات") on an empty DB when supplied. Configuration
   * every tenant would otherwise have to measure by hand, not demo data; a
   * tenant is free to edit or delete them. Omit it and the layout catalog
   * simply starts empty.
   */
  readonly labelLayouts?: LabelLayoutRepository;
}

/** True when the tenant has never been seeded (no chart of accounts yet). */
/** The unit codes docs/archive/catalog/03's "وحدة القياس" picker ships with. */
const SEED_ITEM_UNITS: readonly ItemUnit[] = [
  { code: "PCS", nameAr: "قطعة", nameEn: "Piece", status: "active" },
  { code: "CTN", nameAr: "كرتونة", nameEn: "Carton", status: "active" },
  { code: "BOX", nameAr: "صندوق", nameEn: "Box", status: "active" },
  { code: "KG", nameAr: "كيلوجرام", nameEn: "Kilogram", status: "active" },
  { code: "G", nameAr: "جرام", nameEn: "Gram", status: "active" },
  { code: "L", nameAr: "لتر", nameEn: "Litre", status: "active" },
  { code: "M", nameAr: "متر", nameEn: "Metre", status: "active" },
  { code: "SVC", nameAr: "خدمة", nameEn: "Service", status: "active" },
];

/** A starter category tree (docs/archive/catalog/03 §"تصنيفات الأصناف"); editable like any other tenant record. */
const SEED_ITEM_CATEGORIES: readonly ItemCategory[] = [
  { id: "cat-food", nameAr: "مواد غذائية", nameEn: "Food", parentId: null, status: "active" },
  { id: "cat-office", nameAr: "مستلزمات مكتبية", nameEn: "Office supplies", parentId: null, status: "active" },
  { id: "cat-spares", nameAr: "قطع غيار", nameEn: "Spare parts", parentId: null, status: "active" },
  { id: "cat-services", nameAr: "خدمات", nameEn: "Services", parentId: null, status: "active" },
];

export async function isEmptyTenant(stores: Pick<SeedStores, "accounts">): Promise<boolean> {
  return (await stores.accounts.list()).length === 0;
}

/**
 * Seeds an EMPTY database with the minimum a tenant needs to operate:
 * a standard Chart of Accounts, the 14% VAT rate, the current fiscal year's
 * periods, one main branch + its main warehouse, tenant settings, one system
 * role, and one fallback company-admin user (admin@cyag.example; PIN 123456 in
 * development, random and unprinted in a packaged build — see
 * `resolveSeedAdminSecrets`). Numbering
 * sequences are initialised lazily by the NextNumber service on first use, so
 * no counters are pre-seeded. Idempotent: a no-op on an already-seeded DB.
 */
export async function seedIfEmpty(stores: SeedStores, now: () => Date = () => new Date()): Promise<BootstrapSeedResultDTO> {
  if (!(await isEmptyTenant(stores))) {
    return currentCounts(stores);
  }

  await seedStandardChartOfAccounts(stores.accounts);

  const vat: TaxRate = {
    id: "VAT14",
    code: "VAT14",
    name: "ضريبة القيمة المضافة",
    rate: 14,
    calculationType: "exclusive",
    isDefault: true,
    outputTaxAccountId: null,
    inputTaxAccountId: null,
    etaSubType: "auto",
    status: "active",
  };
  await stores.taxRates.create(vat);

  await stores.branches.save(
    createBranch({ id: SEED_MAIN_BRANCH_ID, code: "MAIN", name: "الفرع الرئيسي", isMain: true, active: true }),
  );
  await stores.warehouses.save(
    createWarehouse({
      id: SEED_MAIN_WAREHOUSE_ID,
      code: "WH-MAIN",
      name: "المستودع الرئيسي",
      nameEn: "Main Warehouse",
      branchId: SEED_MAIN_BRANCH_ID,
      type: "MAIN",
      isDefault: true,
      active: true,
    }),
  );
  await stores.warehouses.save(
    createWarehouse({
      id: SEED_WIP_WAREHOUSE_ID,
      code: "WH-WIP",
      name: "صالة التشغيل",
      nameEn: "Production Floor",
      branchId: SEED_MAIN_BRANCH_ID,
      type: "PRODUCTION",
      isDefault: false,
      active: true,
    }),
  );

  if (stores.itemCatalog) {
    for (const unit of SEED_ITEM_UNITS) await stores.itemCatalog.units.create(unit);
    for (const category of SEED_ITEM_CATEGORIES) await stores.itemCatalog.categories.create(category);
  }

  await generateFiscalYear(now().getUTCFullYear(), stores.fiscalPeriods);

  await stores.settings.save(
    createDefaultSettings({
      companyName: SEED_TENANT_NAME,
      taxEnabled: true,
      defaultTaxRate: 14,
    }),
  );

  const adminRole: Role = {
    id: "ROLE-ADMIN",
    code: "SYSTEM_ADMIN",
    name: "مدير النظام",
    description: "دور بصلاحيات كاملة على النظام.",
    permissions: ["*"],
    isSystem: true,
    createdAt: now().toISOString(),
  };
  await stores.uow.roles.save(adminRole);

  const adminSecrets = resolveSeedAdminSecrets();
  lastSeededAdminSecrets = adminSecrets;
  await saveUser(
    {
      id: SEED_ADMIN_USER_ID,
      nameAr: SEED_ADMIN_NAME,
      nameEn: SEED_ADMIN_NAME_EN,
      email: SEED_ADMIN_EMAIL,
      phone: null,
      password: adminSecrets.password,
      pin: adminSecrets.pin,
      roleId: null,
      isCompanyAdmin: true,
      employeeId: null,
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
      status: "active",
      createdAt: now().toISOString(),
    },
    stores.uow,
    stores.hasher,
  );

  if (stores.labelLayouts) {
    // Standard off-the-shelf A4 sticker sheets, described once so the label
    // screen has something real to print onto (docs/archive/catalog/03).
    const seedLayouts: readonly CreateLabelLayoutCommand[] = [
      {
        id: "LBL-A4-24",
        code: "A4-24",
        nameAr: "ملصق A4 — 24 ملصقاً (63.5 × 33.9 مم)",
        pageSize: "A4",
        columns: 3,
        rows: 8,
        labelWidthMm: 63.5,
        labelHeightMm: 33.9,
        columnGapMm: 2.5,
        rowGapMm: 0,
        marginBlockMm: 12,
        marginInlineMm: 7,
        barcodeHeightMm: 10,
      },
      {
        id: "LBL-A4-14",
        code: "A4-14",
        nameAr: "ملصق A4 — 14 ملصقاً (99.1 × 38.1 مم)",
        pageSize: "A4",
        columns: 2,
        rows: 7,
        labelWidthMm: 99.1,
        labelHeightMm: 38.1,
        columnGapMm: 2.5,
        rowGapMm: 0,
        marginBlockMm: 15,
        marginInlineMm: 4.5,
        showUnit: true,
        barcodeHeightMm: 12,
      },
      {
        id: "LBL-A4-40",
        code: "A4-40",
        nameAr: "ملصق A4 — 40 ملصقاً (48.5 × 25.4 مم)",
        pageSize: "A4",
        columns: 4,
        rows: 10,
        labelWidthMm: 48.5,
        labelHeightMm: 25.4,
        columnGapMm: 0,
        rowGapMm: 0,
        marginBlockMm: 20,
        marginInlineMm: 7.5,
        showPrice: false,
        showBarcodeText: false,
        barcodeHeightMm: 8,
      },
    ];
    for (const layout of seedLayouts) {
      await createLabelLayout(layout, stores.labelLayouts);
    }
  }

  if (stores.pipelineStages) {
    // Seed values only (docs/archive/catalog/06 "مراحل خط المبيعات") — the same 7
    // stages/probabilities/win-loss flags the reference system ships with.
    const seedStages: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly defaultProbability: number;
      readonly color: string;
      readonly isWinStage?: boolean;
      readonly isLossStage?: boolean;
    }> = [
      { id: "STAGE-LEAD", name: "عميل محتمل", defaultProbability: 10, color: "#94a3b8" },
      { id: "STAGE-CONTACTED", name: "تواصل أولي", defaultProbability: 20, color: "#60a5fa" },
      { id: "STAGE-QUOTE", name: "عرض سعر", defaultProbability: 40, color: "#818cf8" },
      { id: "STAGE-NEGOTIATION", name: "تفاوض", defaultProbability: 60, color: "#f59e0b" },
      { id: "STAGE-FINAL-REVIEW", name: "مراجعة نهائية", defaultProbability: 80, color: "#fb923c" },
      { id: "STAGE-WON", name: "تم الإغلاق", defaultProbability: 100, color: "#22c55e", isWinStage: true },
      { id: "STAGE-LOST", name: "خسارة", defaultProbability: 0, color: "#ef4444", isLossStage: true },
    ];
    let existing: Awaited<ReturnType<PipelineStageRepository["list"]>> = [];
    for (const stage of seedStages) {
      const created = await createPipelineStage(stage, existing, stores.pipelineStages);
      existing = [...existing, created];
    }
  }

  return currentCounts(stores);
}

/** Current tenant counts WITHOUT seeding — what the first-run wizard reads to show which base data already exists. */
export async function currentCounts(stores: SeedStores): Promise<BootstrapSeedResultDTO> {
  const [accounts, taxRates, branches, warehouses, fiscalPeriods, users] = await Promise.all([
    stores.accounts.list(),
    stores.taxRates.list(),
    stores.branches.findAll(),
    stores.warehouses.findAll(),
    stores.fiscalPeriods.list(),
    stores.uow.users.list(),
  ]);
  return {
    accounts: accounts.length,
    taxRates: taxRates.length,
    branches: branches.length,
    warehouses: warehouses.length,
    fiscalPeriods: fiscalPeriods.length,
    users: users.length,
  };
}
