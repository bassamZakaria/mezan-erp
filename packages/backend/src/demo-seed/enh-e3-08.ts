import type { App } from "@mezan/api";
import type { SeedFragment, SeedFragmentContext } from "./fragments.js";
import { seedPersonaPassword, step } from "./shared.js";

const TENANT_DOMAIN = "cyag.example";
const EXTERNAL_AUDITOR_TEMPLATE = "external_auditor";
const ADVANCED_SEQUENCE = "BOM";
const ADVANCED_BY = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_ACCESS_DAYS = 30;

interface Auditor {
  readonly nameAr: string;
  readonly nameEn: string;
  readonly local: string;
  readonly accessExpiresAt: string;
}

async function run(app: App, ctx: SeedFragmentContext): Promise<void> {
  if (!ctx.licensed("accounting")) return;
  const role = (await step(app, "POST", "/roles/from-template", { templateId: EXTERNAL_AUDITOR_TEMPLATE })) as { readonly id: string };
  const now = Date.now();
  const auditors: readonly Auditor[] = [
    { nameAr: "عمرو الدسوقي (مراقب حسابات)", nameEn: "Amr El-Desouky (external auditor)", local: "amr.eldesouky", accessExpiresAt: new Date(now + ACTIVE_ACCESS_DAYS * DAY_MS).toISOString() },
  ];
  for (const auditor of auditors) {
    await step(app, "POST", "/users", {
      nameAr: auditor.nameAr,
      nameEn: auditor.nameEn,
      email: `${auditor.local}@${TENANT_DOMAIN}`,
      phone: null,
      roleId: role.id,
      isCompanyAdmin: false,
      employeeId: null,
      branchScope: "*",
      warehouseScope: "*",
      status: "active",
      password: seedPersonaPassword(),
      accessExpiresAt: auditor.accessExpiresAt,
    });
  }

  const sequence = (await step(app, "GET", `/sequences/${ADVANCED_SEQUENCE}`)) as { readonly currentValue: number };
  await step(app, "POST", `/sequences/${ADVANCED_SEQUENCE}/counter`, { value: sequence.currentValue + ADVANCED_BY, confirm: true });
}

export const seed: SeedFragment = { run };
