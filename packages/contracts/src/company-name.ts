import { z } from "zod";

// Mirrors `companyNameProblem` in @mezan/domain by hand, because this package cannot import it;
// `apps/server/src/company-name-parity.test.ts` fails when the two disagree.
export const COMPANY_NAME_MAX_LENGTH = 200;

const NO_FORBIDDEN_CHARACTER = /^[^\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]*$/u;

export const companyNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(COMPANY_NAME_MAX_LENGTH)
  .regex(NO_FORBIDDEN_CHARACTER, "must not carry control or direction-override characters");
