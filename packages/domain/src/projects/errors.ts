import { getProjectStatusLabel, getProjectStatusLabelEn, type ProjectStatus } from "./project.js";
import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";

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
  readonly reasons: readonly string[];
  readonly messageEn: string;
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "The project data is invalid.");
    super(split.ar.join("، "));
    this.reasons = split.ar;
    this.messageEn = split.en;
    this.name = "InvalidProjectError";
  }
}

/** Raised when a project status change is not one the project lifecycle allows. */
export class InvalidProjectTransitionError extends Error {
  readonly code = "INVALID_PROJECT_TRANSITION";
  readonly messageEn: string;
  constructor(
    readonly from: ProjectStatus,
    readonly to: ProjectStatus,
  ) {
    super(
      `لا يمكن نقل المشروع من "${getProjectStatusLabel(from)}" إلى "${getProjectStatusLabel(to)}".`,
    );
    this.messageEn = `A project cannot move from "${getProjectStatusLabelEn(from)}" to "${getProjectStatusLabelEn(to)}".`;
    this.name = "InvalidProjectTransitionError";
  }
}
