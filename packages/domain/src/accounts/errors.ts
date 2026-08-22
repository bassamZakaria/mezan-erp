/** Raised when an account code already exists (codes are unique across the COA). */
export class DuplicateAccountCodeError extends Error {
  readonly code = "DUPLICATE_ACCOUNT_CODE";
  constructor(readonly accountCode: string) {
    super(`Account code "${accountCode}" already exists.`);
    this.name = "DuplicateAccountCodeError";
  }
}

/** Raised when an operation references an account id that does not exist. */
export class AccountNotFoundError extends Error {
  readonly code = "ACCOUNT_NOT_FOUND";
  constructor(readonly accountId: string) {
    super(`Account "${accountId}" was not found.`);
    this.name = "AccountNotFoundError";
  }
}

/**
 * Raised when a chosen parent cannot be used: it does not exist, or it is
 * itself a detail/postable account (only header accounts may have children).
 */
export class InvalidParentAccountError extends Error {
  readonly code = "INVALID_PARENT_ACCOUNT";
  constructor(message: string) {
    super(message);
    this.name = "InvalidParentAccountError";
  }
}

/** Raised when a journal line (or any posting) targets a header/non-postable account. */
export class HeaderAccountNotPostableError extends Error {
  readonly code = "HEADER_ACCOUNT_NOT_POSTABLE";
  constructor(readonly accountId: string) {
    super(`Account "${accountId}" is a header account and cannot be posted to.`);
    this.name = "HeaderAccountNotPostableError";
  }
}

/** Raised when reparenting an account would create a cycle in the hierarchy. */
export class CircularParentAccountError extends Error {
  readonly code = "CIRCULAR_PARENT_ACCOUNT";
  constructor(readonly accountId: string) {
    super(`Setting this parent would make account "${accountId}" its own ancestor.`);
    this.name = "CircularParentAccountError";
  }
}

/**
 * Raised when a header account cannot be converted to a postable detail
 * account because it still has children.
 */
export class HeaderAccountHasChildrenError extends Error {
  readonly code = "HEADER_ACCOUNT_HAS_CHILDREN";
  constructor(readonly accountId: string) {
    super(`Account "${accountId}" has child accounts and cannot become a detail account.`);
    this.name = "HeaderAccountHasChildrenError";
  }
}
