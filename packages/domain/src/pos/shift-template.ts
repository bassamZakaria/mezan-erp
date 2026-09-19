/**
 * وردية — a named time-of-day period. A reporting taxonomy only: the POS
 * reports bucket sales and cash movements by it, and HR assigns it to people.
 * It is NOT the cash-drawer session a cashier opens and closes.
 */
export interface ShiftTemplate {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  /** `HH:MM`, 24-hour. `toTime` earlier than `fromTime` means the shift runs past midnight. */
  readonly fromTime: string;
  readonly toTime: string;
  /** Null = every branch. */
  readonly branchId: string | null;
  readonly active: boolean;
}

export class InvalidShiftTemplateError extends Error {
  readonly code = "INVALID_SHIFT_TEMPLATE";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidShiftTemplateError";
  }
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function minutesOfDay(time: string): number | null {
  const match = TIME_PATTERN.exec(time);
  if (!match) return null;
  return Number.parseInt(match[1] ?? "0", 10) * 60 + Number.parseInt(match[2] ?? "0", 10);
}

export interface ShiftTemplateInput {
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly fromTime: string;
  readonly toTime: string;
  readonly branchId?: string | null;
  readonly active?: boolean;
}

export function buildShiftTemplate(id: string, input: ShiftTemplateInput): ShiftTemplate {
  const template: ShiftTemplate = {
    id,
    nameAr: input.nameAr.trim(),
    nameEn: input.nameEn?.trim() ? input.nameEn.trim() : null,
    fromTime: input.fromTime.trim(),
    toTime: input.toTime.trim(),
    branchId: input.branchId?.trim() ? input.branchId.trim() : null,
    active: input.active ?? true,
  };
  const reasons: string[] = [];
  if (template.nameAr === "") reasons.push("اسم الوردية مطلوب");
  const from = minutesOfDay(template.fromTime);
  const to = minutesOfDay(template.toTime);
  if (from === null) reasons.push("وقت البداية بالشكل 08:00");
  if (to === null) reasons.push("وقت النهاية بالشكل 16:00");
  if (from !== null && to !== null && from === to) reasons.push("البداية والنهاية لا تتساويان");
  if (reasons.length > 0) throw new InvalidShiftTemplateError(reasons);
  return template;
}

/** Runs into the next calendar day. A shift that ends exactly at 00:00 does not. */
export function shiftCrossesMidnight(template: Pick<ShiftTemplate, "fromTime" | "toTime">): boolean {
  const to = minutesOfDay(template.toTime) ?? 0;
  return to !== 0 && to < (minutesOfDay(template.fromTime) ?? 0);
}

/** Whether a local wall-clock time (`HH:MM`) falls in the shift; the end is exclusive. */
export function shiftCovers(template: Pick<ShiftTemplate, "fromTime" | "toTime">, time: string): boolean {
  const at = minutesOfDay(time);
  const from = minutesOfDay(template.fromTime);
  const to = minutesOfDay(template.toTime);
  if (at === null || from === null || to === null) return false;
  return from < to ? at >= from && at < to : at >= from || at < to;
}

/** Two active templates for the same branch (or both for every branch) must not overlap, or a sale buckets twice. */
export function overlappingShiftTemplate(
  template: ShiftTemplate,
  others: readonly ShiftTemplate[],
): ShiftTemplate | null {
  if (!template.active) return null;
  const from = minutesOfDay(template.fromTime) ?? 0;
  const to = minutesOfDay(template.toTime) ?? 0;
  const minutes: number[] = [];
  for (let m = from; m !== to; m = (m + 1) % 1440) minutes.push(m);
  for (const other of others) {
    if (other.id === template.id || !other.active) continue;
    const sameScope = other.branchId === null || template.branchId === null || other.branchId === template.branchId;
    if (!sameScope) continue;
    const at = (m: number) => `${String(Math.trunc(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    if (minutes.some((m) => shiftCovers(other, at(m)))) return other;
  }
  return null;
}
