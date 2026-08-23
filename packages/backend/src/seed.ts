import {
  seedStandardChartOfAccounts,
  createBranch,
  createWarehouse,
  createDefaultSettings,
  generateFiscalYear,
  saveUser,
  createPipelineStage,
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
} from "@mezan/domain";
import type { BootstrapSeedResultDTO } from "@mezan/contracts";

/**
 * Default tenant identity for a freshly-seeded, EMPTY database. These are seed
 * values only (docs/catalog/09 — "Cyag" / محمد الشهابي); they are NOT sample
 * data driving any screen — once a real tenant edits settings / creates users,
 * the seed is never consulted again.
 */
export const SEED_TENANT_NAME = "Cyag";
export const SEED_ADMIN_NAME = "محمد الشهابي";
export const SEED_ADMIN_EMAIL = "admin@cyag.example";
export const SEED_ADMIN_PIN = "1234";
const SEED_ADMIN_PASSWORD = "change-me-on-first-login";
const SEED_MAIN_BRANCH_ID = "BR-MAIN";
const SEED_MAIN_WAREHOUSE_ID = "WH-MAIN";

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
   * Optional — seeds the 7 standard pipeline stages (docs/catalog/06 "مراحل
   * خط المبيعات") on an empty DB when supplied. Omit it and the CRM pipeline
   * simply starts with zero stages (same as omitting any other optional
   * seed block).
   */
  readonly pipelineStages?: PipelineStageRepository;
}

/** True when the tenant has never been seeded (no chart of accounts yet). */
export async function isEmptyTenant(stores: Pick<SeedStores, "accounts">): Promise<boolean> {
  return (await stores.accounts.list()).length === 0;
}

/**
 * Seeds an EMPTY database with the minimum a tenant needs to operate:
 * a standard Chart of Accounts, the 14% VAT rate, the current fiscal year's
 * periods, one main branch + its main warehouse, tenant settings, one system
 * role, and one company-admin user (username محمد الشهابي, PIN 1234). Numbering
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
      branchId: SEED_MAIN_BRANCH_ID,
      type: "MAIN",
      isDefault: true,
      active: true,
    }),
  );

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

  await saveUser(
    {
      id: "USER-ADMIN",
      fullName: SEED_ADMIN_NAME,
      email: SEED_ADMIN_EMAIL,
      phone: null,
      password: SEED_ADMIN_PASSWORD,
      pin: SEED_ADMIN_PIN,
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

  if (stores.pipelineStages) {
    // Seed values only (docs/catalog/06 "مراحل خط المبيعات") — the same 7
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

async function currentCounts(stores: SeedStores): Promise<BootstrapSeedResultDTO> {
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
