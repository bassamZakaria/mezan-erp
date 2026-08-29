/**
 * JobTitle — docs/archive/catalog/06-crm-hr.md "المسميات الوظيفية". Department-scoped
 * master data (one department per title, per the catalog's dependent-dropdown
 * behaviour on the Employee form) — same thin, edit-dialog-only shape as
 * `Department`.
 */

export interface JobTitle {
  readonly id: string;
  readonly departmentId: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly active: boolean;
  readonly createdAt: string;
}

/** Persistence port for job titles. The domain depends on this interface only. */
export interface JobTitleRepository {
  findById(id: string): Promise<JobTitle | null>;
  list(): Promise<JobTitle[]>;
  listByDepartmentId(departmentId: string): Promise<JobTitle[]>;
  create(jobTitle: JobTitle): Promise<void>;
  update(jobTitle: JobTitle): Promise<void>;
}
