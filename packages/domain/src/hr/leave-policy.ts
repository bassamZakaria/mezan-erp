import { Qty } from "../money/index.js";
import { InvalidLeavePolicyError, UnknownLeavePolicyPresetError } from "./errors.js";
import type { LeaveType } from "./leave-request.js";

/**
 * Leave policies — docs/catalog/06-crm-hr.md "سياسات الإجازات"
 * (`/settings/leave-policies`). One row per leave type carrying the catalog's
 * six matrix columns: نوع الإجازة, الرصيد الأساسي, وتيرة الاستحقاق, الترحيل,
 * صرف عند الإنهاء, إجباري قانوناً.
 *
 * The reference tenant ships this table EMPTY with an "apply a preset" entry
 * point, so nothing here is seeded: `LEAVE_POLICY_PRESETS` is versioned, dated
 * legal reference data (docs/plan.md §6.2 — "model legal constants as
 * versioned, dated data, never as hardcoded logic") that an admin explicitly
 * applies.
 */

export type LeaveAccrualFrequency = "annual" | "monthly" | "none";

export interface LeaveAccrualFrequencyDefinition {
  readonly code: LeaveAccrualFrequency;
  readonly labelAr: string;
  /** Accrual runs per calendar year; 0 means the type never accrues automatically. */
  readonly periodsPerYear: number;
}

export const LEAVE_ACCRUAL_FREQUENCY_DEFINITIONS: readonly LeaveAccrualFrequencyDefinition[] = [
  { code: "annual", labelAr: "سنوياً", periodsPerYear: 1 },
  { code: "monthly", labelAr: "شهرياً", periodsPerYear: 12 },
  { code: "none", labelAr: "بدون استحقاق", periodsPerYear: 0 },
] as const;

export function getLeaveAccrualFrequencyLabel(frequency: LeaveAccrualFrequency): string {
  return LEAVE_ACCRUAL_FREQUENCY_DEFINITIONS.find((d) => d.code === frequency)?.labelAr ?? frequency;
}

export interface LeavePolicy {
  readonly id: string;
  readonly leaveType: LeaveType;
  /** الرصيد الأساسي — entitlement days per year, as an exact scaled quantity (never a float). */
  readonly entitlementDays: Qty;
  readonly accrualFrequency: LeaveAccrualFrequency;
  /** الترحيل — whether an unused balance carries into the next year. */
  readonly carryOver: boolean;
  /** Cap on carried-over days; null means uncapped (only meaningful when `carryOver`). */
  readonly maxCarryOverDays: Qty | null;
  /** صرف عند الإنهاء — whether the remaining balance is cashed out on termination. */
  readonly payoutOnTermination: boolean;
  /** إجباري قانوناً — the row exists because the law requires it. */
  readonly legallyMandated: boolean;
  /** Preset this row came from, or null when hand-authored (تخصيص يدوي). */
  readonly presetCode: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Persistence port for leave policies. The domain depends on this interface only. */
export interface LeavePolicyRepository {
  findById(id: string): Promise<LeavePolicy | null>;
  findByLeaveType(leaveType: LeaveType): Promise<LeavePolicy | null>;
  list(): Promise<LeavePolicy[]>;
  create(policy: LeavePolicy): Promise<void>;
  update(policy: LeavePolicy): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface CreateLeavePolicyCommand {
  readonly id: string;
  readonly leaveType: LeaveType;
  readonly entitlementDays: Qty;
  readonly accrualFrequency: LeaveAccrualFrequency;
  readonly carryOver?: boolean;
  readonly maxCarryOverDays?: Qty | null;
  readonly payoutOnTermination?: boolean;
  readonly legallyMandated?: boolean;
  readonly presetCode?: string | null;
}

function validate(policy: Pick<LeavePolicy, "entitlementDays" | "maxCarryOverDays" | "carryOver">): string[] {
  const reasons: string[] = [];
  if (policy.entitlementDays.isNegative()) reasons.push("الرصيد الأساسي لا يمكن أن يكون سالباً");
  if (policy.maxCarryOverDays && policy.maxCarryOverDays.isNegative()) reasons.push("حد الترحيل لا يمكن أن يكون سالباً");
  if (!policy.carryOver && policy.maxCarryOverDays) reasons.push("لا يمكن تحديد حد ترحيل بدون تفعيل الترحيل");
  return reasons;
}

export function createLeavePolicy(command: CreateLeavePolicyCommand, now: () => string = () => new Date().toISOString()): LeavePolicy {
  const timestamp = now();
  const policy: LeavePolicy = {
    id: command.id,
    leaveType: command.leaveType,
    entitlementDays: command.entitlementDays,
    accrualFrequency: command.accrualFrequency,
    carryOver: command.carryOver ?? false,
    maxCarryOverDays: command.maxCarryOverDays ?? null,
    payoutOnTermination: command.payoutOnTermination ?? false,
    legallyMandated: command.legallyMandated ?? false,
    presetCode: command.presetCode ?? null,
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const reasons = validate(policy);
  if (reasons.length > 0) throw new InvalidLeavePolicyError(reasons);
  return policy;
}

export type LeavePolicyPatch = Partial<
  Pick<LeavePolicy, "entitlementDays" | "accrualFrequency" | "carryOver" | "maxCarryOverDays" | "payoutOnTermination" | "legallyMandated" | "active">
>;

/** Applies a row edit from the matrix table; hand-editing detaches the row from its preset (تخصيص يدوي). */
export function updateLeavePolicy(current: LeavePolicy, patch: LeavePolicyPatch, now: () => string = () => new Date().toISOString()): LeavePolicy {
  const next: LeavePolicy = { ...current, ...patch, presetCode: null, updatedAt: now() };
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidLeavePolicyError(reasons);
  return next;
}

/** Days credited by one accrual period under this policy. Truncating division never over-credits. */
export function accrualDaysPerPeriod(policy: LeavePolicy, frequency: LeaveAccrualFrequency): Qty {
  if (policy.accrualFrequency !== frequency || frequency === "none") return Qty.zero();
  const periods = LEAVE_ACCRUAL_FREQUENCY_DEFINITIONS.find((d) => d.code === frequency)?.periodsPerYear ?? 0;
  if (periods <= 1) return policy.entitlementDays;
  return Qty.fromScaled(policy.entitlementDays.scaled / BigInt(periods));
}

// --- Presets ---------------------------------------------------------------

export interface LeavePolicyPresetLine {
  readonly leaveType: LeaveType;
  /** Exact decimal literal, parsed through `Qty.fromMajor` — never a float. */
  readonly entitlementDays: string;
  readonly accrualFrequency: LeaveAccrualFrequency;
  readonly carryOver: boolean;
  readonly maxCarryOverDays: string | null;
  readonly payoutOnTermination: boolean;
  readonly legallyMandated: boolean;
  /** Article of the cited law this line comes from. */
  readonly noteAr: string;
}

export interface LeavePolicyPreset {
  readonly code: string;
  readonly labelAr: string;
  /** Date the cited law took effect — the "versioned dated data" the plan mandates. */
  readonly effectiveFrom: string;
  readonly lines: readonly LeavePolicyPresetLine[];
}

/**
 * The two dated Egyptian Labour Law presets the catalog's preset dropdown
 * names ("مصر — قانون 12 لسنة 2003" / "مصر — قانون 14 لسنة 2025"). The
 * catalog captured the dropdown labels only — never a populated matrix — so
 * the day counts below come from the cited law articles, not from the source
 * system, and are the tenant's to override via تخصيص يدوي.
 */
export const LEAVE_POLICY_PRESETS: readonly LeavePolicyPreset[] = [
  {
    code: "EG_LABOUR_LAW_12_2003",
    labelAr: "مصر — قانون 12 لسنة 2003",
    effectiveFrom: "2003-07-08",
    lines: [
      {
        leaveType: "annual",
        entitlementDays: "21",
        accrualFrequency: "monthly",
        carryOver: true,
        maxCarryOverDays: null,
        payoutOnTermination: true,
        legallyMandated: true,
        noteAr: "المادة 47 — 21 يوماً بعد سنة خدمة، وترتفع إلى 30 يوماً بعد 10 سنوات أو لمن تجاوز الخمسين",
      },
      {
        leaveType: "sick",
        entitlementDays: "180",
        accrualFrequency: "annual",
        carryOver: false,
        maxCarryOverDays: null,
        payoutOnTermination: false,
        legallyMandated: true,
        noteAr: "المادة 54 — حتى 180 يوماً بقرار من الجهة الطبية المختصة",
      },
      {
        leaveType: "casual",
        entitlementDays: "6",
        accrualFrequency: "annual",
        carryOver: false,
        maxCarryOverDays: null,
        payoutOnTermination: false,
        legallyMandated: true,
        noteAr: "المادة 51 — 6 أيام سنوياً بحد أقصى يومين متصلين، وتخصم من الإجازة السنوية",
      },
      {
        leaveType: "maternity",
        entitlementDays: "90",
        accrualFrequency: "none",
        carryOver: false,
        maxCarryOverDays: null,
        payoutOnTermination: false,
        legallyMandated: true,
        noteAr: "المادة 91 — 90 يوماً بأجر كامل بعد 10 أشهر خدمة، مرتين طوال مدة الخدمة",
      },
      {
        leaveType: "unpaid",
        entitlementDays: "0",
        accrualFrequency: "none",
        carryOver: false,
        maxCarryOverDays: null,
        payoutOnTermination: false,
        legallyMandated: false,
        noteAr: "بدون رصيد مستحق — تُخصم من الأجر ولا تُرحّل",
      },
    ],
  },
  {
    code: "EG_LABOUR_LAW_14_2025",
    labelAr: "مصر — قانون 14 لسنة 2025",
    effectiveFrom: "2025-09-01",
    lines: [
      {
        leaveType: "annual",
        entitlementDays: "21",
        accrualFrequency: "monthly",
        carryOver: true,
        maxCarryOverDays: null,
        payoutOnTermination: true,
        legallyMandated: true,
        noteAr: "21 يوماً بعد سنة خدمة، وترتفع إلى 30 يوماً بعد 10 سنوات أو لمن تجاوز الخمسين",
      },
      {
        leaveType: "sick",
        entitlementDays: "180",
        accrualFrequency: "annual",
        carryOver: false,
        maxCarryOverDays: null,
        payoutOnTermination: false,
        legallyMandated: true,
        noteAr: "حتى 180 يوماً بقرار من الجهة الطبية المختصة",
      },
      {
        leaveType: "casual",
        entitlementDays: "7",
        accrualFrequency: "annual",
        carryOver: false,
        maxCarryOverDays: null,
        payoutOnTermination: false,
        legallyMandated: true,
        noteAr: "7 أيام سنوياً تُخصم من الإجازة السنوية",
      },
      {
        leaveType: "maternity",
        entitlementDays: "120",
        accrualFrequency: "none",
        carryOver: false,
        maxCarryOverDays: null,
        payoutOnTermination: false,
        legallyMandated: true,
        noteAr: "أربعة أشهر بأجر كامل، ثلاث مرات طوال مدة الخدمة",
      },
      {
        leaveType: "paternity",
        entitlementDays: "1",
        accrualFrequency: "none",
        carryOver: false,
        maxCarryOverDays: null,
        payoutOnTermination: false,
        legallyMandated: true,
        noteAr: "يوم واحد بأجر كامل عند وضع الزوجة",
      },
      {
        leaveType: "unpaid",
        entitlementDays: "0",
        accrualFrequency: "none",
        carryOver: false,
        maxCarryOverDays: null,
        payoutOnTermination: false,
        legallyMandated: false,
        noteAr: "بدون رصيد مستحق — تُخصم من الأجر ولا تُرحّل",
      },
    ],
  },
] as const;

export function findLeavePolicyPreset(code: string): LeavePolicyPreset | null {
  return LEAVE_POLICY_PRESETS.find((p) => p.code === code) ?? null;
}

export interface ApplyLeavePolicyPresetResult {
  readonly created: readonly LeavePolicy[];
  readonly updated: readonly LeavePolicy[];
}

/**
 * Projects a preset onto the current matrix: an existing row for the same
 * leave type is rewritten from the preset, a missing one is created. Rows for
 * leave types the preset does not name are left untouched.
 */
export function applyLeavePolicyPreset(
  presetCode: string,
  existing: readonly LeavePolicy[],
  generateId: () => string,
  now: () => string = () => new Date().toISOString(),
): ApplyLeavePolicyPresetResult {
  const preset = findLeavePolicyPreset(presetCode);
  if (!preset) throw new UnknownLeavePolicyPresetError(presetCode);

  const created: LeavePolicy[] = [];
  const updated: LeavePolicy[] = [];
  const timestamp = now();

  for (const line of preset.lines) {
    const entitlementDays = Qty.fromMajor(line.entitlementDays);
    const maxCarryOverDays = line.maxCarryOverDays === null ? null : Qty.fromMajor(line.maxCarryOverDays);
    const current = existing.find((p) => p.leaveType === line.leaveType);
    if (current) {
      updated.push({
        ...current,
        entitlementDays,
        accrualFrequency: line.accrualFrequency,
        carryOver: line.carryOver,
        maxCarryOverDays,
        payoutOnTermination: line.payoutOnTermination,
        legallyMandated: line.legallyMandated,
        presetCode: preset.code,
        active: true,
        updatedAt: timestamp,
      });
    } else {
      created.push(
        createLeavePolicy(
          {
            id: generateId(),
            leaveType: line.leaveType,
            entitlementDays,
            accrualFrequency: line.accrualFrequency,
            carryOver: line.carryOver,
            maxCarryOverDays,
            payoutOnTermination: line.payoutOnTermination,
            legallyMandated: line.legallyMandated,
            presetCode: preset.code,
          },
          () => timestamp,
        ),
      );
    }
  }

  return { created, updated };
}
