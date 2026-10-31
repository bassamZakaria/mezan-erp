import { DuplicateUserEmailError } from "./save-user.js";

export class EmailInAnotherCompanyError extends DuplicateUserEmailError {
  constructor(email: string) {
    super(email);
    this.message = "هذا البريد الإلكتروني مستخدم في منشأة أخرى على ميزان. استخدم بريدًا آخر.";
    this.name = "EmailInAnotherCompanyError";
  }
}

/** One email signs in to one company. The cloud edition backs this with the platform's sign-in email list. */
export interface SignInEmailGuard {
  /** Throws `EmailInAnotherCompanyError` when another company already holds `email`. */
  claim(email: string): Promise<void>;
  release(email: string): Promise<void>;
  /** Makes the list hold exactly `emails` for this company; answers the emails another company already holds. */
  sync(emails: readonly string[]): Promise<readonly string[]>;
}
