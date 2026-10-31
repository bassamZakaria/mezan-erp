import { DuplicateUserEmailError } from "./save-user.js";

export class EmailInAnotherCompanyError extends DuplicateUserEmailError {
  constructor(email: string) {
    super(email);
    this.message = "هذا البريد الإلكتروني مستخدم في منشأة أخرى على ميزان. استخدم بريدًا آخر.";
    this.name = "EmailInAnotherCompanyError";
  }
}

export interface SignInEmailGuard {
  claim(email: string): Promise<void>;
  release(email: string): Promise<void>;
  sync(emails: readonly string[]): Promise<readonly string[]>;
}
