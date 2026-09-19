import { getProjectStatusLabel, type ProjectStatus } from "./project.js";

/** Raised when a project code already exists (codes are unique across projects). */
export class DuplicateProjectCodeError extends Error {
  readonly code = "DUPLICATE_PROJECT_CODE";
  readonly messageEn: string;
  constructor(readonly projectCode: string) {
    super(`كود المشروع "${projectCode}" مستخدم من قبل.`);
    this.messageEn = `Project code "${projectCode}" already exists.`;
    this.name = "DuplicateProjectCodeError";
  }
}

/** Raised when an operation references a project id that does not exist. */
export class ProjectNotFoundError extends Error {
  readonly code = "PROJECT_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly projectId: string) {
    super(`المشروع "${projectId}" غير موجود.`);
    this.messageEn = `Project "${projectId}" was not found.`;
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

/** Raised when a project status change is not one the project lifecycle allows. */
export class InvalidProjectTransitionError extends Error {
  readonly code = "INVALID_PROJECT_TRANSITION";
  constructor(
    readonly from: ProjectStatus,
    readonly to: ProjectStatus,
  ) {
    super(
      `لا يمكن نقل المشروع من "${getProjectStatusLabel(from)}" إلى "${getProjectStatusLabel(to)}".`,
    );
    this.name = "InvalidProjectTransitionError";
  }
}
