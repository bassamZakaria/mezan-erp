import { parentOf } from "../entitlements/sub-modules.js";
import { moduleName } from "./module-catalog.js";
import { QuotaKind } from "./plan.js";

export enum LimitKind {
  Seats = "seats",
  Branches = "branches",
  Warehouses = "warehouses",
  SalesInvoicesPerMonth = "sales_invoices_per_month",
}

export const LIMIT_OF_QUOTA: Readonly<Record<QuotaKind, LimitKind>> = {
  [QuotaKind.SalesInvoicesPerMonth]: LimitKind.SalesInvoicesPerMonth,
};

export enum UsageRefusalCode {
  LimitReached = "PLAN_LIMIT_REACHED",
  ModuleReadOnly = "MODULE_READ_ONLY",
  LocationOverLimit = "LOCATION_OVER_LIMIT",
  SeatsOverLimit = "SEATS_OVER_LIMIT",
}

const LIMIT_NOUN: Readonly<Record<LimitKind, { readonly ar: string; readonly en: string }>> = {
  [LimitKind.Seats]: { ar: "مستخدمين نشطين", en: "active users" },
  [LimitKind.Branches]: { ar: "فروع", en: "branches" },
  [LimitKind.Warehouses]: { ar: "مخازن", en: "warehouses" },
  [LimitKind.SalesInvoicesPerMonth]: { ar: "فاتورة مبيعات في الشهر", en: "sales invoices a month" },
};

export interface PlanLabel {
  readonly nameAr: string;
  readonly nameEn: string;
}

export interface LimitRefusal {
  readonly error: UsageRefusalCode.LimitReached;
  readonly limit: LimitKind;
  readonly allowed: number;
  readonly used: number;
  readonly plan: string;
  readonly message: string;
  readonly messageEn: string;
}

export function limitRefusal(kind: LimitKind, allowed: number, used: number, plan: PlanLabel & { readonly code: string }): LimitRefusal {
  const noun = LIMIT_NOUN[kind];
  const period = kind === LimitKind.SalesInvoicesPerMonth ? { ar: " هذا الشهر", en: " this month" } : { ar: "", en: "" };
  return {
    error: UsageRefusalCode.LimitReached,
    limit: kind,
    allowed,
    used,
    plan: plan.code,
    message: `باقة «${plan.nameAr}» تسمح بـ ${allowed} ${noun.ar}، وقد وصلتم إلى ${used}${period.ar}. ما سُجّل من قبل يبقى كما هو ويمكن إكماله.`,
    messageEn: `The ${plan.nameEn} plan allows ${allowed} ${noun.en}, and you have reached ${used}${period.en}. Everything already recorded stays and can still be completed.`,
  };
}

export interface ModuleReadOnlyRefusal {
  readonly error: UsageRefusalCode.ModuleReadOnly;
  readonly module: string;
  readonly plan: string;
  readonly message: string;
  readonly messageEn: string;
}

export function moduleReadOnlyRefusal(moduleId: string, plan: PlanLabel & { readonly code: string }): ModuleReadOnlyRefusal {
  const name = moduleName(moduleId);
  const parent = parentOf(moduleId);
  if (parent !== null) {
    const parentName = moduleName(parent);
    return {
      error: UsageRefusalCode.ModuleReadOnly,
      module: moduleId,
      plan: plan.code,
      message: `جزء ${name.ar} من ${parentName.ar} ليس ضمن باقة «${plan.nameAr}»، فهو للقراءة فقط: بياناته متاحة للعرض والتصدير، ولا يمكن تسجيل جديد فيه.`,
      messageEn: `The ${name.en} part of ${parentName.en} is not in the ${plan.nameEn} plan, so it is read-only: its data can be viewed and exported, but nothing new can be recorded in it.`,
    };
  }
  return {
    error: UsageRefusalCode.ModuleReadOnly,
    module: moduleId,
    plan: plan.code,
    message: `وحدة ${name.ar} ليست ضمن باقة «${plan.nameAr}»، فهي للقراءة فقط: بياناتها متاحة للعرض والتصدير، ولا يمكن تسجيل جديد فيها.`,
    messageEn: `The ${name.en} module is not in the ${plan.nameEn} plan, so it is read-only: its data can be viewed and exported, but nothing new can be recorded in it.`,
  };
}

export interface LocationOverLimitRefusal {
  readonly error: UsageRefusalCode.LocationOverLimit;
  readonly limit: LimitKind.Branches | LimitKind.Warehouses;
  readonly id: string;
  readonly allowed: number;
  readonly plan: string;
  readonly message: string;
  readonly messageEn: string;
}

export function locationOverLimitRefusal(
  kind: LimitKind.Branches | LimitKind.Warehouses,
  id: string,
  nameAr: string,
  allowed: number,
  plan: PlanLabel & { readonly code: string },
): LocationOverLimitRefusal {
  const noun = LIMIT_NOUN[kind];
  const what = kind === LimitKind.Branches ? { ar: "الفرع", en: "branch" } : { ar: "المخزن", en: "warehouse" };
  return {
    error: UsageRefusalCode.LocationOverLimit,
    limit: kind,
    id,
    allowed,
    plan: plan.code,
    message: `${what.ar} «${nameAr}» خارج حد باقة «${plan.nameAr}» (${allowed} ${noun.ar})، فبياناته متاحة للعرض فقط ولا يُنشأ عليه مستند جديد.`,
    messageEn: `The ${what.en} "${nameAr}" is beyond the ${plan.nameEn} plan's limit of ${allowed} ${noun.en}; its records stay readable, but no new document can be raised on it.`,
  };
}

export interface SeatsOverLimitRefusal {
  readonly error: UsageRefusalCode.SeatsOverLimit;
  readonly allowed: number;
  readonly active: number;
  readonly message: string;
  readonly messageEn: string;
}

export function seatsOverLimitRefusal(allowed: number, active: number, plan: PlanLabel): SeatsOverLimitRefusal {
  return {
    error: UsageRefusalCode.SeatsOverLimit,
    allowed,
    active,
    message: `باقة «${plan.nameAr}» تسمح بـ ${allowed} مستخدمين نشطين وعدد النشطين الآن ${active}. لا يدخل إلا مدير المنشأة حتى يختار من يبقى نشطًا.`,
    messageEn: `The ${plan.nameEn} plan allows ${allowed} active users and ${active} are active. Only a company administrator can sign in until one chooses who stays active.`,
  };
}

/** `YYYY-MM` of a tenant calendar day. */
export function tenantMonthOf(day: string): string {
  return day.slice(0, 7);
}
