/** Raised when a project code already exists (codes are unique across projects). */
export class DuplicateProjectCodeError extends Error {
  readonly code = "DUPLICATE_PROJECT_CODE";
  constructor(readonly projectCode: string) {
    super(`Project code "${projectCode}" already exists.`);
    this.name = "DuplicateProjectCodeError";
  }
}

/** Raised when an operation references a project id that does not exist. */
export class ProjectNotFoundError extends Error {
  readonly code = "PROJECT_NOT_FOUND";
  constructor(readonly projectId: string) {
    super(`Project "${projectId}" was not found.`);
    this.name = "ProjectNotFoundError";
  }
}

/** Raised when a project fails validation (e.g. missing name, invalid status). */
export class InvalidProjectError extends Error {
  readonly code = "INVALID_PROJECT";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidProjectError";
  }
}
