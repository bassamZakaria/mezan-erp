import type { GateableActionType } from "../workflow/index.js";

/**
 * The 8 leave types the tenant configures a policy for — one-to-one with the
 * workflow engine's 9 granular `HR_LEAVE_APPROVE_*` gates minus the blanket
 * `_ALL` gate (workflow/action-types.ts), so every leave type has its own
 * approval-chain slot.
 */
export const LEAVE_TYPE_CODES = [
  "ANNUAL",
  "SICK",
  "PERSONAL",
  "CASUAL",
  "MATERNITY",
  "PATERNITY",
  "UNPAID",
  "EMERGENCY",
] as const;

export type LeaveTypeCode = (typeof LEAVE_TYPE_CODES)[number];

export interface LeaveTypeDefinition {
  readonly code: LeaveTypeCode;
  readonly labelAr: string;
  /** The specific workflow gate this leave type's requests submit under. */
  readonly gateActionType: GateableActionType;
}

export const LEAVE_TYPE_DEFINITIONS: readonly LeaveTypeDefinition[] = [
  { code: "ANNUAL", labelAr: "إجازة سنوية", gateActionType: "HR_LEAVE_APPROVE_ANNUAL" },
  { code: "SICK", labelAr: "إجازة مرضية", gateActionType: "HR_LEAVE_APPROVE_SICK" },
  { code: "PERSONAL", labelAr: "إجازة شخصية", gateActionType: "HR_LEAVE_APPROVE_PERSONAL" },
  { code: "CASUAL", labelAr: "إجازة عارضة", gateActionType: "HR_LEAVE_APPROVE_CASUAL" },
  { code: "MATERNITY", labelAr: "إجازة أمومة", gateActionType: "HR_LEAVE_APPROVE_MATERNITY" },
  { code: "PATERNITY", labelAr: "إجازة أبوة", gateActionType: "HR_LEAVE_APPROVE_PATERNITY" },
  { code: "UNPAID", labelAr: "إجازة بدون أجر", gateActionType: "HR_LEAVE_APPROVE_UNPAID" },
  { code: "EMERGENCY", labelAr: "إجازة طارئة", gateActionType: "HR_LEAVE_APPROVE_EMERGENCY" },
];

const BY_CODE = new Map(LEAVE_TYPE_DEFINITIONS.map((d) => [d.code, d]));

export function isLeaveTypeCode(code: string): code is LeaveTypeCode {
  return BY_CODE.has(code as LeaveTypeCode);
}

export function getLeaveTypeDefinition(code: LeaveTypeCode): LeaveTypeDefinition {
  const def = BY_CODE.get(code);
  if (!def) throw new RangeError(`Unknown leave type code: "${code}"`);
  return def;
}

export function gateActionTypeForLeaveType(code: LeaveTypeCode): GateableActionType {
  return getLeaveTypeDefinition(code).gateActionType;
}
