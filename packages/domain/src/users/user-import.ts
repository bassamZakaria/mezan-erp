import { parseCsv } from "../bank-reconciliation/csv.js";
import { ALL_SCOPE, type ScopeSelection } from "../permissions/auth-context.js";
import { isPlausibleEmail, normalizeEmail } from "./save-user.js";

export const USER_IMPORT_ROW_LIMIT = 100;

export enum UserImportColumn {
  NameAr = "name_ar",
  NameEn = "name_en",
  Email = "email",
  Phone = "phone",
  Role = "role",
  Branches = "branches",
  Warehouses = "warehouses",
}

export const USER_IMPORT_REQUIRED_COLUMNS: readonly UserImportColumn[] = [
  UserImportColumn.NameAr,
  UserImportColumn.Email,
  UserImportColumn.Role,
  UserImportColumn.Branches,
  UserImportColumn.Warehouses,
];

const COLUMN_ALIASES: Readonly<Record<UserImportColumn, readonly string[]>> = {
  [UserImportColumn.NameAr]: ["name_ar", "name", "الاسم", "الاسم_بالعربية"],
  [UserImportColumn.NameEn]: ["name_en", "الاسم_بالانجليزية", "الاسم_بالإنجليزية"],
  [UserImportColumn.Email]: ["email", "e-mail", "البريد", "البريد_الإلكتروني", "البريد_الالكتروني"],
  [UserImportColumn.Phone]: ["phone", "mobile", "الهاتف", "الموبايل", "رقم_الهاتف"],
  [UserImportColumn.Role]: ["role", "role_code", "الدور", "كود_الدور"],
  [UserImportColumn.Branches]: ["branches", "branch", "الفروع", "الفرع"],
  [UserImportColumn.Warehouses]: ["warehouses", "warehouse", "المخازن", "المستودعات", "المخزن"],
};

const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set(["password", "pin", "secret", "كلمة_المرور", "الرقم_السري", "رمز_الدخول"]);
const ADMIN_HEADERS: ReadonlySet<string> = new Set(["iscompanyadmin", "is_company_admin", "admin", "company_admin", "مدير_الشركة", "مدير"]);

export enum UserImportFileProblemCode {
  Empty = "FILE_EMPTY",
  TooManyRows = "FILE_TOO_MANY_ROWS",
  MissingColumn = "FILE_MISSING_COLUMN",
  UnknownColumn = "FILE_UNKNOWN_COLUMN",
  DuplicateColumn = "FILE_DUPLICATE_COLUMN",
  CredentialColumn = "FILE_CREDENTIAL_COLUMN",
  AdminColumn = "FILE_ADMIN_COLUMN",
}

export interface UserImportFileProblem {
  readonly code: UserImportFileProblemCode;
  readonly column?: string;
}

export enum UserImportRowProblemCode {
  NameRequired = "ROW_NAME_REQUIRED",
  InvalidEmail = "ROW_INVALID_EMAIL",
  DuplicateEmailInFile = "ROW_DUPLICATE_EMAIL_IN_FILE",
  EmailTaken = "ROW_EMAIL_TAKEN",
  EmailDomainNotAllowed = "ROW_EMAIL_DOMAIN_NOT_ALLOWED",
  RoleRequired = "ROW_ROLE_REQUIRED",
  UnknownRole = "ROW_UNKNOWN_ROLE",
  RoleNotGrantable = "ROW_ROLE_NOT_GRANTABLE",
  SodConflict = "ROW_SOD_CONFLICT",
  BranchesRequired = "ROW_BRANCHES_REQUIRED",
  UnknownBranch = "ROW_UNKNOWN_BRANCH",
  WarehousesRequired = "ROW_WAREHOUSES_REQUIRED",
  UnknownWarehouse = "ROW_UNKNOWN_WAREHOUSE",
  ScopeNotGrantable = "ROW_SCOPE_NOT_GRANTABLE",
  SeatLimitReached = "ROW_SEAT_LIMIT_REACHED",
}

export interface UserImportRowProblem {
  readonly code: UserImportRowProblemCode;
  readonly detail?: string;
}

export type ImportScopeTokens = typeof ALL_SCOPE | readonly string[];

export interface UserImportRow {
  readonly rowNumber: number;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly roleCode: string;
  readonly branches: ImportScopeTokens;
  readonly warehouses: ImportScopeTokens;
  readonly problems: readonly UserImportRowProblem[];
}

export interface ParsedUserImport {
  readonly rows: readonly UserImportRow[];
  readonly fileProblems: readonly UserImportFileProblem[];
}

function normalizeHeader(raw: string): string {
  return raw.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, "_");
}

function delimiterOf(csv: string): string {
  const firstLine = csv.replace(/^﻿/, "").split(/\r\n|\r|\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((delimiter) => [delimiter, firstLine.split(delimiter).length - 1] as const);
  const best = counts.reduce((winner, candidate) => (candidate[1] > winner[1] ? candidate : winner));
  return best[1] > 0 ? best[0] : ",";
}

function scopeTokens(raw: string): ImportScopeTokens {
  const tokens = raw
    .split(/[|;]/)
    .map((token) => token.trim())
    .filter((token) => token !== "");
  return tokens.includes(ALL_SCOPE) ? ALL_SCOPE : tokens;
}

function columnOf(header: string): UserImportColumn | null {
  const normalized = normalizeHeader(header);
  const hit = (Object.entries(COLUMN_ALIASES) as [UserImportColumn, readonly string[]][]).find(([, aliases]) => aliases.includes(normalized));
  return hit ? hit[0] : null;
}

export function parseUserImportCsv(csv: string, rowLimit: number = USER_IMPORT_ROW_LIMIT): ParsedUserImport {
  if (csv.trim() === "") return { rows: [], fileProblems: [{ code: UserImportFileProblemCode.Empty }] };
  const table = parseCsv(csv.replace(/^﻿/, ""), delimiterOf(csv));
  const fileProblems: UserImportFileProblem[] = [];
  const positions = new Map<UserImportColumn, number>();
  table.headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (normalized === "") return;
    if (CREDENTIAL_HEADERS.has(normalized)) {
      fileProblems.push({ code: UserImportFileProblemCode.CredentialColumn, column: header.trim() });
      return;
    }
    if (ADMIN_HEADERS.has(normalized)) {
      fileProblems.push({ code: UserImportFileProblemCode.AdminColumn, column: header.trim() });
      return;
    }
    const column = columnOf(header);
    if (column === null) {
      fileProblems.push({ code: UserImportFileProblemCode.UnknownColumn, column: header.trim() });
      return;
    }
    if (positions.has(column)) {
      fileProblems.push({ code: UserImportFileProblemCode.DuplicateColumn, column: header.trim() });
      return;
    }
    positions.set(column, index);
  });
  for (const required of USER_IMPORT_REQUIRED_COLUMNS) {
    if (!positions.has(required)) fileProblems.push({ code: UserImportFileProblemCode.MissingColumn, column: required });
  }
  const dataRows = table.rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
  if (dataRows.length === 0) fileProblems.push({ code: UserImportFileProblemCode.Empty });
  if (dataRows.length > rowLimit) fileProblems.push({ code: UserImportFileProblemCode.TooManyRows, column: String(rowLimit) });
  if (fileProblems.length > 0) return { rows: [], fileProblems };

  const cell = (cells: readonly string[], column: UserImportColumn): string => (cells[positions.get(column) ?? -1] ?? "").trim();
  const seenEmails = new Map<string, number>();
  const rows = dataRows.map((cells, index): UserImportRow => {
    const rowNumber = index + 2;
    const problems: UserImportRowProblem[] = [];
    const nameAr = cell(cells, UserImportColumn.NameAr);
    const email = normalizeEmail(cell(cells, UserImportColumn.Email));
    const roleCode = cell(cells, UserImportColumn.Role);
    const branches = scopeTokens(cell(cells, UserImportColumn.Branches));
    const warehouses = scopeTokens(cell(cells, UserImportColumn.Warehouses));
    if (nameAr === "") problems.push({ code: UserImportRowProblemCode.NameRequired });
    if (email === "" || !isPlausibleEmail(email)) problems.push({ code: UserImportRowProblemCode.InvalidEmail, detail: email });
    else if (seenEmails.has(email)) problems.push({ code: UserImportRowProblemCode.DuplicateEmailInFile, detail: String(seenEmails.get(email)) });
    else seenEmails.set(email, rowNumber);
    if (roleCode === "") problems.push({ code: UserImportRowProblemCode.RoleRequired });
    if (branches !== ALL_SCOPE && branches.length === 0) problems.push({ code: UserImportRowProblemCode.BranchesRequired });
    if (warehouses !== ALL_SCOPE && warehouses.length === 0) problems.push({ code: UserImportRowProblemCode.WarehousesRequired });
    return {
      rowNumber,
      nameAr,
      nameEn: cell(cells, UserImportColumn.NameEn) || null,
      email,
      phone: cell(cells, UserImportColumn.Phone) || null,
      roleCode,
      branches,
      warehouses,
      problems,
    };
  });
  return { rows, fileProblems };
}

export function resolveImportScope(
  tokens: ImportScopeTokens,
  known: ReadonlyArray<{ readonly id: string; readonly code: string }>,
): { readonly scope: ScopeSelection; readonly unknown: readonly string[] } {
  if (tokens === ALL_SCOPE) return { scope: ALL_SCOPE, unknown: [] };
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const token of tokens) {
    const lowered = token.toLowerCase();
    const hit = known.find((entry) => entry.id === token || entry.code.toLowerCase() === lowered);
    if (hit) ids.push(hit.id);
    else unknown.push(token);
  }
  return { scope: Array.from(new Set(ids)), unknown };
}

export interface BilingualProblem {
  readonly ar: string;
  readonly en: string;
}

export function userImportFileProblemMessage(problem: UserImportFileProblem): BilingualProblem {
  const column = problem.column ?? "";
  switch (problem.code) {
    case UserImportFileProblemCode.Empty:
      return { ar: "الملف فارغ أو لا يحتوي على صفوف مستخدمين.", en: "The file is empty or has no user rows." };
    case UserImportFileProblemCode.TooManyRows:
      return { ar: `الملف يتجاوز ${column} صفًا؛ قسّمه إلى ملفات أصغر.`, en: `The file has more than ${column} rows; split it into smaller files.` };
    case UserImportFileProblemCode.MissingColumn:
      return { ar: `العمود المطلوب «${column}» غير موجود.`, en: `The required column "${column}" is missing.` };
    case UserImportFileProblemCode.UnknownColumn:
      return { ar: `العمود «${column}» غير معروف.`, en: `The column "${column}" is not recognised.` };
    case UserImportFileProblemCode.DuplicateColumn:
      return { ar: `العمود «${column}» مكرر.`, en: `The column "${column}" appears twice.` };
    case UserImportFileProblemCode.CredentialColumn:
      return {
        ar: `العمود «${column}» غير مسموح: تُولَّد كلمات المرور والرموز السرية عند الاستيراد ولا تُقرأ من الملف.`,
        en: `The column "${column}" is not allowed: passwords and PINs are generated on import and never read from the file.`,
      };
    case UserImportFileProblemCode.AdminColumn:
      return {
        ar: `العمود «${column}» غير مسموح: الاستيراد لا يمنح صلاحية مدير الشركة.`,
        en: `The column "${column}" is not allowed: import never grants company-admin access.`,
      };
  }
}

export function userImportRowProblemMessage(problem: UserImportRowProblem): BilingualProblem {
  const detail = problem.detail ?? "";
  switch (problem.code) {
    case UserImportRowProblemCode.NameRequired:
      return { ar: "الاسم بالعربية مطلوب.", en: "The Arabic name is required." };
    case UserImportRowProblemCode.InvalidEmail:
      return { ar: "البريد الإلكتروني غير صالح.", en: "The email address is not valid." };
    case UserImportRowProblemCode.DuplicateEmailInFile:
      return { ar: `البريد مكرر في الملف (الصف ${detail}).`, en: `The email is repeated in the file (row ${detail}).` };
    case UserImportRowProblemCode.EmailTaken:
      return { ar: "يوجد مستخدم بهذا البريد بالفعل.", en: "A user with this email already exists." };
    case UserImportRowProblemCode.EmailDomainNotAllowed:
      return { ar: "نطاق البريد غير مسموح في إعدادات المنشأة.", en: "The email domain is not allowed by the company settings." };
    case UserImportRowProblemCode.RoleRequired:
      return { ar: "كود الدور مطلوب.", en: "The role code is required." };
    case UserImportRowProblemCode.UnknownRole:
      return { ar: `الدور «${detail}» غير موجود.`, en: `The role "${detail}" does not exist.` };
    case UserImportRowProblemCode.RoleNotGrantable:
      return { ar: `لا يمكنك منح الدور «${detail}» لأنه يتضمن صلاحيات لا تملكها.`, en: `You cannot assign the role "${detail}": it includes permissions you do not hold.` };
    case UserImportRowProblemCode.SodConflict:
      return {
        ar: `الدور «${detail}» يجمع بين طرفي فصل مهام؛ أرسل الاعتراف مع السبب لاستيراده.`,
        en: `The role "${detail}" combines both sides of a segregation-of-duties pair; acknowledge it with a reason to import.`,
      };
    case UserImportRowProblemCode.BranchesRequired:
      return { ar: "فرع واحد على الأقل مطلوب (أو *).", en: "At least one branch is required (or *)." };
    case UserImportRowProblemCode.UnknownBranch:
      return { ar: `الفرع «${detail}» غير موجود.`, en: `The branch "${detail}" does not exist.` };
    case UserImportRowProblemCode.WarehousesRequired:
      return { ar: "مخزن واحد على الأقل مطلوب (أو *).", en: "At least one warehouse is required (or *)." };
    case UserImportRowProblemCode.UnknownWarehouse:
      return { ar: `المخزن «${detail}» غير موجود.`, en: `The warehouse "${detail}" does not exist.` };
    case UserImportRowProblemCode.ScopeNotGrantable:
      return { ar: "لا يمكنك منح نطاق أوسع من نطاقك.", en: "You cannot grant a wider scope than your own." };
    case UserImportRowProblemCode.SeatLimitReached:
      return { ar: "وصلتم إلى الحد الأقصى للمستخدمين في باقتكم.", en: "Your plan's user seat limit has been reached." };
  }
}
