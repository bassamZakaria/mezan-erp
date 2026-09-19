/**
 * Attendance-device CSV import — docs/superpowers/plans/2026-09-19-deferred-build-pos-hr-cloud.md
 * §4 (lane 1D). A go-live/monthly upload of the export a fingerprint/RFID
 * terminal produces (ZKTeco-style columns: badge/employee-code, a
 * date-time punch, an optional in/out direction, an optional device/terminal
 * name). Pure — no I/O: parsing and grouping never touch a repository. The
 * caller (the API route) supplies the badge → employee lookup and the set of
 * (employee, date) pairs already recorded, then — for a commit — replays each
 * ready group through the SAME `recordAttendance` domain function the manual
 * attendance form uses, so every invariant that function enforces (including
 * that imported punches never auto-approve overtime — D187) applies here too.
 *
 * Mirrors the shape of `../data-migration/*`: a pure preview pass with no
 * persistence, and a commit that is idempotent per (employee, date) — a
 * group already recorded is reported, never re-created or overwritten.
 */

export interface AttendanceImportRowError {
  readonly rowNumber: number;
  readonly reasons: readonly string[];
}

/** One punch, after CSV parsing but before employee matching. */
export interface AttendanceDevicePunch {
  readonly rowNumber: number;
  readonly badgeId: string;
  /** "YYYY-MM-DD" */
  readonly date: string;
  /** "HH:MM" */
  readonly time: string;
  readonly direction: "in" | "out" | null;
  readonly device: string | null;
}

export interface AttendanceImportParseResult {
  readonly punches: readonly AttendanceDevicePunch[];
  readonly errors: readonly AttendanceImportRowError[];
}

const HEADER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  badge: ["badge", "badgeid", "acno", "ac-no", "employeecode", "empcode", "code", "userid", "userno", "pin", "cardno"],
  datetime: ["datetime", "date_time", "time", "punchtime", "recordtime", "checktime"],
  date: ["date"],
  clock: ["clock", "hour", "clocktime"],
  direction: ["direction", "inout", "in/out", "state", "type", "iotype", "checktype"],
  device: ["device", "deviceid", "terminal", "terminalid", "devicename", "machine"],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_/-]/g, "");
}

function resolveColumns(headerRow: readonly string[]): Partial<Record<keyof typeof HEADER_ALIASES, number>> {
  const normalized = headerRow.map(normalizeHeader);
  const result: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {};
  for (const key of Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]) {
    const aliases = (HEADER_ALIASES[key] ?? []).map(normalizeHeader);
    const index = normalized.findIndex((h) => aliases.includes(h));
    if (index >= 0) result[key] = index;
  }
  return result;
}

/** Splits one CSV line on commas, honouring double-quoted fields (which may themselves contain commas). */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/;
const SLASH_DATETIME = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::\d{2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLASH_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const CLOCK = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

/** Parses a combined date-time cell into `{ date, time }`, accepting ISO or DD/MM/YYYY forms. */
function parseDateTime(value: string): { date: string; time: string } | null {
  const iso = ISO_DATETIME.exec(value);
  if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, time: `${iso[4]}:${iso[5]}` };
  const slash = SLASH_DATETIME.exec(value);
  if (slash) return { date: `${slash[3]}-${slash[2]}-${slash[1]}`, time: `${slash[4]}:${slash[5]}` };
  return null;
}

function parseDateOnly(value: string): string | null {
  if (ISO_DATE.test(value)) return value;
  const slash = SLASH_DATE.exec(value);
  if (slash) return `${slash[3]}-${slash[2]}-${slash[1]}`;
  return null;
}

function parseClockOnly(value: string): string | null {
  const match = CLOCK.exec(value);
  if (!match) return null;
  return `${(match[1] ?? "").padStart(2, "0")}:${match[2] ?? "00"}`;
}

function parseDirection(raw: string | undefined): "in" | "out" | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === "") return null;
  if (v === "0" || v.includes("in") || v === "c/in" || v === "check in") return "in";
  if (v === "1" || v.includes("out") || v === "c/out" || v === "check out") return "out";
  return null;
}

/**
 * Parses a raw CSV export into punch rows. The first non-blank line is the
 * header; every column is matched by alias, case/spacing-insensitive, so the
 * export doesn't have to use Mezan's exact field names. Accepts either one
 * combined date-time column or separate date + clock-time columns.
 */
export function parseAttendanceDeviceCsv(csvText: string): AttendanceImportParseResult {
  const lines = csvText.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { punches: [], errors: [{ rowNumber: 0, reasons: ["الملف فارغ"] }] };

  const header = splitCsvLine(lines[0] as string);
  const columns = resolveColumns(header);
  if (columns.badge === undefined) {
    return { punches: [], errors: [{ rowNumber: 1, reasons: ['لم يتم التعرف على عمود الشارة/كود الموظف (badge/code)'] }] };
  }
  if (columns.datetime === undefined && (columns.date === undefined || columns.clock === undefined)) {
    return {
      punches: [],
      errors: [{ rowNumber: 1, reasons: ["لم يتم التعرف على عمود التاريخ والوقت (datetime، أو date + time منفصلين)"] }],
    };
  }

  const punches: AttendanceDevicePunch[] = [];
  const errors: AttendanceImportRowError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rowNumber = i + 1; // header = row 1, matching the data-migration convention
    const fields = splitCsvLine(lines[i] as string);
    const badgeId = (fields[columns.badge] ?? "").trim();
    const reasons: string[] = [];
    if (badgeId === "") reasons.push("الشارة/كود الموظف مطلوب");

    let date: string | null = null;
    let time: string | null = null;
    if (columns.datetime !== undefined) {
      const parsed = parseDateTime((fields[columns.datetime] ?? "").trim());
      if (parsed) {
        date = parsed.date;
        time = parsed.time;
      } else {
        reasons.push('صيغة التاريخ/الوقت غير صالحة، الصيغة المتوقعة "YYYY-MM-DD HH:MM"');
      }
    } else {
      date = parseDateOnly((fields[columns.date as number] ?? "").trim());
      time = parseClockOnly((fields[columns.clock as number] ?? "").trim());
      if (!date) reasons.push("التاريخ غير صالح");
      if (!time) reasons.push("الوقت غير صالح");
    }

    if (reasons.length > 0) {
      errors.push({ rowNumber, reasons });
      continue;
    }

    punches.push({
      rowNumber,
      badgeId,
      date: date as string,
      time: time as string,
      direction: columns.direction !== undefined ? parseDirection(fields[columns.direction]) : null,
      device: columns.device !== undefined ? (fields[columns.device] ?? "").trim() || null : null,
    });
  }

  return { punches, errors };
}

export type AttendanceImportIssueCode = "unmatched_badge" | "odd_punch_count" | "single_punch" | "already_recorded";

export interface AttendanceImportDayGroup {
  readonly badgeId: string;
  /** Null when no employee carries this badge as `deviceBadgeId`. */
  readonly employeeId: string | null;
  readonly date: string;
  readonly checkIn: string | null;
  readonly checkOut: string | null;
  readonly punchCount: number;
  readonly device: string | null;
  readonly issues: readonly AttendanceImportIssueCode[];
  /** True only when this group has no blocking issue and can be committed. */
  readonly readyToCommit: boolean;
}

export interface AttendanceImportPreview {
  readonly groups: readonly AttendanceImportDayGroup[];
  readonly parseErrors: readonly AttendanceImportRowError[];
  readonly totalPunches: number;
  readonly matchedGroupCount: number;
  readonly unmatchedBadges: readonly string[];
  readonly readyCount: number;
}

/**
 * Groups punches by (badge, date), resolves each badge against the employee
 * directory, pairs check-in/check-out, and flags anything a reviewer must
 * look at before committing. Pure: `existingEntryKeys` and
 * `employeeIdByBadge` are pre-computed snapshots, not live lookups.
 */
export function buildAttendanceImportPreview(
  punches: readonly AttendanceDevicePunch[],
  employeeIdByBadge: ReadonlyMap<string, string>,
  existingEntryKeys: ReadonlySet<string>,
  parseErrors: readonly AttendanceImportRowError[] = [],
): AttendanceImportPreview {
  const byKey = new Map<string, AttendanceDevicePunch[]>();
  for (const punch of punches) {
    const key = `${punch.badgeId}|${punch.date}`;
    const list = byKey.get(key);
    if (list) list.push(punch);
    else byKey.set(key, [punch]);
  }

  const groups: AttendanceImportDayGroup[] = [];
  const unmatchedBadges = new Set<string>();

  for (const [key, dayPunches] of byKey) {
    const [badgeId, date] = key.split("|") as [string, string];
    const sorted = [...dayPunches].sort((a, b) => a.time.localeCompare(b.time));
    const employeeId = employeeIdByBadge.get(badgeId) ?? null;
    const device = sorted.find((p) => p.device)?.device ?? null;
    const issues: AttendanceImportIssueCode[] = [];

    if (!employeeId) {
      unmatchedBadges.add(badgeId);
      issues.push("unmatched_badge");
    }

    let checkIn: string | null = null;
    let checkOut: string | null = null;
    const withDirection = sorted.filter((p) => p.direction !== null);
    if (withDirection.length > 0) {
      const firstIn = withDirection.find((p) => p.direction === "in");
      const lastOut = [...withDirection].reverse().find((p) => p.direction === "out");
      checkIn = firstIn?.time ?? (sorted[0] as AttendanceDevicePunch).time;
      checkOut = lastOut?.time ?? null;
    } else if (sorted.length === 1) {
      checkIn = (sorted[0] as AttendanceDevicePunch).time;
      checkOut = null;
    } else {
      checkIn = (sorted[0] as AttendanceDevicePunch).time;
      checkOut = (sorted[sorted.length - 1] as AttendanceDevicePunch).time;
    }

    if (sorted.length === 1) issues.push("single_punch");
    else if (sorted.length % 2 !== 0 && withDirection.length === 0) issues.push("odd_punch_count");

    const alreadyRecorded = employeeId !== null && existingEntryKeys.has(`${employeeId}|${date}`);
    if (alreadyRecorded) issues.push("already_recorded");

    groups.push({
      badgeId,
      employeeId,
      date,
      checkIn,
      checkOut,
      punchCount: sorted.length,
      device,
      issues,
      readyToCommit: employeeId !== null && !alreadyRecorded,
    });
  }

  groups.sort((a, b) => (a.date === b.date ? a.badgeId.localeCompare(b.badgeId) : a.date.localeCompare(b.date)));

  return {
    groups,
    parseErrors,
    totalPunches: punches.length,
    matchedGroupCount: groups.filter((g) => g.employeeId !== null).length,
    unmatchedBadges: [...unmatchedBadges].sort(),
    readyCount: groups.filter((g) => g.readyToCommit).length,
  };
}
