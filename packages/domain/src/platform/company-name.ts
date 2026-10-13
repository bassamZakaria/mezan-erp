export const COMPANY_NAME_MAX_LENGTH = 200;

export enum CompanyNameProblem {
  Empty = "empty",
  TooLong = "too_long",
  ForbiddenCharacter = "forbidden_character",
}

const FORBIDDEN_CHARACTER = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;

const PROBLEM_AR: Record<CompanyNameProblem, string> = {
  [CompanyNameProblem.Empty]: "اسم المنشأة مطلوب",
  [CompanyNameProblem.TooLong]: `اسم المنشأة أطول من ${COMPANY_NAME_MAX_LENGTH} حرفًا`,
  [CompanyNameProblem.ForbiddenCharacter]: "اسم المنشأة يحتوي على رموز غير مسموح بها",
};

export function companyNameProblem(raw: string): CompanyNameProblem | null {
  const name = raw.trim();
  if (FORBIDDEN_CHARACTER.test(name)) return CompanyNameProblem.ForbiddenCharacter;
  if (name === "") return CompanyNameProblem.Empty;
  if (name.length > COMPANY_NAME_MAX_LENGTH) return CompanyNameProblem.TooLong;
  return null;
}

export function companyNameProblemAr(problem: CompanyNameProblem): string {
  return PROBLEM_AR[problem];
}
