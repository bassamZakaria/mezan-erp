import { COMPANY_NAME_MAX_LENGTH, CompanyNameProblem, companyNameProblem } from "@mezan/domain";
import type { AppTranslationKey } from "./i18n";

const COMPANY_NAME_ERROR: Record<CompanyNameProblem, AppTranslationKey> = {
  [CompanyNameProblem.Empty]: "firstRun.companyNameRequired",
  [CompanyNameProblem.TooLong]: "firstRun.companyNameTooLong",
  [CompanyNameProblem.ForbiddenCharacter]: "firstRun.companyNameForbidden",
};

type Translate = (key: AppTranslationKey, vars?: Record<string, string>) => string;

export function companyNameError(name: string, t: Translate): string | null {
  const problem = companyNameProblem(name);
  return problem ? t(COMPANY_NAME_ERROR[problem], { max: String(COMPANY_NAME_MAX_LENGTH) }) : null;
}
