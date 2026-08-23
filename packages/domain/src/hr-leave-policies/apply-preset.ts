import type { LeavePolicyRepository, LeavePolicyVersion } from "./leave-policy.js";
import { getLeavePolicyPreset } from "./presets.js";
import type { LeavePolicySource } from "./leave-policy.js";
import { InvalidLeavePolicyError } from "./leave-policy.js";

export interface ApplyLeavePolicyPresetCommand {
  readonly source: LeavePolicySource;
  /** Id prefix; one version id per row is generated as `${idPrefix}:${leaveTypeCode}`. */
  readonly idPrefix: string;
  readonly now?: () => string;
}

export interface ApplyLeavePolicyPresetDeps {
  readonly policies: LeavePolicyRepository;
}

/**
 * "تطبيق إعداد جاهز" — applies a named preset (docs/catalog "سياسات
 * الإجازات"): creates one new dated `LeavePolicyVersion` per leave type in
 * the preset, all effective on the preset's own `effectiveDate`. A tenant can
 * still edit any individual leave type afterward via `setLeavePolicy` — that
 * simply layers a newer `MANUAL` version on top from its own effective date.
 */
export async function applyLeavePolicyPreset(
  cmd: ApplyLeavePolicyPresetCommand,
  deps: ApplyLeavePolicyPresetDeps,
): Promise<readonly LeavePolicyVersion[]> {
  const preset = getLeavePolicyPreset(cmd.source);
  if (!preset) {
    throw new InvalidLeavePolicyError(`Unknown leave policy preset: "${cmd.source}"`);
  }
  const now = cmd.now?.() ?? new Date().toISOString();
  const versions: LeavePolicyVersion[] = preset.rows.map((row) => ({
    id: `${cmd.idPrefix}:${row.leaveTypeCode}`,
    leaveTypeCode: row.leaveTypeCode,
    effectiveDate: preset.effectiveDate,
    baseBalanceDays: row.baseBalanceDays,
    accrualFrequency: row.accrualFrequency,
    carryover: row.carryover,
    carryoverMaxDays: row.carryoverMaxDays,
    payoutOnTermination: row.payoutOnTermination,
    legallyMandatory: row.legallyMandatory,
    source: preset.source,
    createdAt: now,
  }));
  for (const version of versions) {
    await deps.policies.create(version);
  }
  return versions;
}
