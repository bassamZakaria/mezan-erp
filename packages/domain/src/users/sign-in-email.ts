import { DuplicateUserEmailError } from "./save-user.js";

export class EmailInAnotherCompanyError extends DuplicateUserEmailError {
  override readonly messageEn = "This email address is already used by another company on Mezan. Use a different email address.";
  constructor(email: string) {
    super(email);
    this.message = "هذا البريد الإلكتروني مستخدم في منشأة أخرى على ميزان. استخدم بريدًا آخر.";
    this.name = "EmailInAnotherCompanyError";
  }
}

export interface SignInEmailGuard {
  claim(email: string): Promise<void>;
  sync(emails: readonly string[]): Promise<readonly string[]>;
}
