import { InvalidHolidayError } from "./errors.js";
import type { ReasonInput } from "../bilingual-reasons.js";

/**
 * Holiday — docs/archive/catalog/06-crm-hr.md "الإجازات الرسمية". Company-wide public
 * holiday calendar, year-scoped in the list UI (2025/2026/2027 tabs). A
 * `recurringAnnual` holiday is stored ONCE with an anchor date; `listForYear`
 * below projects it onto any requested year by month/day, so a single
 * "اليوم الوطني" row shows up under every year tab without duplicate rows.
 */

export interface Holiday {
  readonly id: string;
  /** Anchor date, "YYYY-MM-DD". For a recurring holiday this is just the FIRST year it was entered — `listForYear` re-projects month/day onto other years. */
  readonly date: string;
  readonly nameEn: string;
  readonly nameAr: string | null;
  readonly recurringAnnual: boolean;
  readonly createdAt: string;
}

/** Persistence port for holidays. The domain depends on this interface only. */
export interface HolidayRepository {
  findById(id: string): Promise<Holiday | null>;
  list(): Promise<Holiday[]>;
  create(holiday: Holiday): Promise<void>;
  update(holiday: Holiday): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface CreateHolidayCommand {
  readonly id: string;
  readonly date: string;
  readonly nameEn: string;
  readonly nameAr?: string | null;
  readonly recurringAnnual?: boolean;
}

function validate(command: Pick<CreateHolidayCommand, "date" | "nameEn">): ReasonInput[] {
  const reasons: ReasonInput[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(command.date)) reasons.push({ ar: "التاريخ مطلوب بصيغة YYYY-MM-DD", en: "The date is required in the format YYYY-MM-DD" });
  if (command.nameEn.trim().length === 0) reasons.push({ ar: "الاسم بالإنجليزية مطلوب", en: "The English name is required" });
  return reasons;
}

/** Creates a new holiday (pure — persistence happens in the caller, matching the branch.ts-style pattern for thin master data). */
export function createHoliday(command: CreateHolidayCommand): Holiday {
  const reasons = validate(command);
  if (reasons.length > 0) throw new InvalidHolidayError(reasons);
  return {
    id: command.id,
    date: command.date,
    nameEn: command.nameEn,
    nameAr: command.nameAr ?? null,
    recurringAnnual: command.recurringAnnual ?? false,
    createdAt: new Date().toISOString(),
  };
}

/** Applies a patch to an existing holiday (edit dialog), re-validating. */
export function updateHoliday(current: Holiday, patch: Partial<Pick<Holiday, "date" | "nameEn" | "nameAr" | "recurringAnnual">>): Holiday {
  const next: Holiday = { ...current, ...patch };
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidHolidayError(reasons);
  return next;
}

/** Projects a recurring holiday's month/day onto `year`; a non-recurring holiday only "exists" in its own anchor year. */
function projectToYear(holiday: Holiday, year: number): Holiday | null {
  const [anchorYear, month, day] = holiday.date.split("-");
  if (!holiday.recurringAnnual) {
    return Number(anchorYear) === year ? holiday : null;
  }
  return { ...holiday, date: `${year}-${month}-${day}` };
}

/** Lists the holidays that apply to `year`, projecting recurring holidays onto it (docs/archive/catalog/06 year tabs). */
export function listHolidaysForYear(holidays: readonly Holiday[], year: number): Holiday[] {
  return holidays
    .map((h) => projectToYear(h, year))
    .filter((h): h is Holiday => h !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}
