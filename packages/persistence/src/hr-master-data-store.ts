import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type {
  Department,
  DepartmentRepository,
  Employee,
  EmployeeRepository,
  EmployeeStatus,
  WorkerCategory,
  OvertimeEligibility,
  Gender,
  MaritalStatus,
  EmployeeAddress,
  EmergencyContact,
} from "@mezan/domain";

/**
 * SQLite-backed Department/Employee repositories — the Data Migration
 * wizard's steps 1-2 master data (docs/catalog/09 §"نقل البيانات"). Table
 * names (`hr_departments`/`hr_employees`) are deliberately distinct from
 * whatever the in-flight hr/master-data branch's own persistence layer will
 * call its tables, so both can coexist without a SQLite table-name
 * collision — this store is a thin stand-in, reconciled away once that
 * branch's own persistence lands on main.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS hr_departments (
  id                     TEXT PRIMARY KEY,
  code                   TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  name_ar                TEXT,
  parent_department_id   TEXT,
  manager_id             TEXT,
  overtime_eligible      INTEGER NOT NULL,
  standard_work_hours    REAL,
  active                 INTEGER NOT NULL,
  created_at             TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hr_employees (
  id                             TEXT PRIMARY KEY,
  code                           TEXT NOT NULL UNIQUE,
  first_name                     TEXT NOT NULL,
  last_name                      TEXT NOT NULL,
  first_name_ar                  TEXT,
  last_name_ar                   TEXT,
  email                          TEXT,
  phone                          TEXT,
  birth_date                     TEXT,
  national_id                    TEXT,
  gender                         TEXT,
  marital_status                 TEXT,
  department_id                  TEXT,
  job_title_id                   TEXT,
  manager_id                     TEXT,
  branch_id                      TEXT NOT NULL,
  hire_date                      TEXT NOT NULL,
  worker_category                TEXT NOT NULL,
  employment_type                TEXT NOT NULL,
  overtime_eligibility            TEXT NOT NULL,
  standard_work_hours            REAL,
  probation_end_date             TEXT,
  prior_service_years            REAL NOT NULL,
  require_selfie_at_clock_in     INTEGER NOT NULL,
  require_biometric_at_clock_in  INTEGER NOT NULL,
  address                        TEXT,
  emergency_contact               TEXT,
  status                         TEXT NOT NULL,
  terminated_at                  TEXT,
  created_at                     TEXT NOT NULL
);
`;

interface DepartmentRow {
  id: string;
  code: string;
  name: string;
  name_ar: string | null;
  parent_department_id: string | null;
  manager_id: string | null;
  overtime_eligible: number;
  standard_work_hours: number | null;
  active: number;
  created_at: string;
}

function toDepartment(row: DepartmentRow): Department {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameAr: row.name_ar,
    parentDepartmentId: row.parent_department_id,
    managerId: row.manager_id,
    overtimeEligible: row.overtime_eligible === 1,
    standardWorkHours: row.standard_work_hours,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

class SqliteDepartmentRepository implements DepartmentRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO hr_departments (id, code, name, name_ar, parent_department_id, manager_id, overtime_eligible, standard_work_hours, active, created_at)
      VALUES (@id, @code, @name, @name_ar, @parent_department_id, @manager_id, @overtime_eligible, @standard_work_hours, @active, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        name = excluded.name,
        name_ar = excluded.name_ar,
        parent_department_id = excluded.parent_department_id,
        manager_id = excluded.manager_id,
        overtime_eligible = excluded.overtime_eligible,
        standard_work_hours = excluded.standard_work_hours,
        active = excluded.active,
        created_at = excluded.created_at
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM hr_departments WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM hr_departments WHERE code = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM hr_departments`);
  }

  async findById(id: string): Promise<Department | null> {
    const row = this.selectById.get(id) as DepartmentRow | undefined;
    return row ? toDepartment(row) : null;
  }
  async findByCode(code: string): Promise<Department | null> {
    const row = this.selectByCode.get(code) as DepartmentRow | undefined;
    return row ? toDepartment(row) : null;
  }
  async list(): Promise<Department[]> {
    return (this.selectAll.all() as DepartmentRow[]).map(toDepartment);
  }
  async create(department: Department): Promise<void> {
    this.write(department);
  }
  async update(department: Department): Promise<void> {
    this.write(department);
  }
  private write(department: Department): void {
    this.upsert.run({
      id: department.id,
      code: department.code,
      name: department.name,
      name_ar: department.nameAr,
      parent_department_id: department.parentDepartmentId,
      manager_id: department.managerId,
      overtime_eligible: department.overtimeEligible ? 1 : 0,
      standard_work_hours: department.standardWorkHours,
      active: department.active ? 1 : 0,
      created_at: department.createdAt,
    });
  }
}

export interface SqliteDepartmentRepositoryHandle extends DepartmentRepository {
  close(): void;
}

/** Open a SQLite-backed DepartmentRepository. ":memory:" for tests, a path for real. */
export function createSqliteDepartmentRepository(path: SqliteConnectionInput = ":memory:"): SqliteDepartmentRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  const repo = new SqliteDepartmentRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteDepartmentRepositoryHandle;
}

interface EmployeeRow {
  id: string;
  code: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  national_id: string | null;
  gender: string | null;
  marital_status: string | null;
  department_id: string | null;
  job_title_id: string | null;
  manager_id: string | null;
  branch_id: string;
  hire_date: string;
  worker_category: string;
  employment_type: string;
  overtime_eligibility: string;
  standard_work_hours: number | null;
  probation_end_date: string | null;
  prior_service_years: number;
  require_selfie_at_clock_in: number;
  require_biometric_at_clock_in: number;
  address: string | null;
  emergency_contact: string | null;
  status: string;
  terminated_at: string | null;
  created_at: string;
}

function toEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    code: row.code,
    firstName: row.first_name,
    lastName: row.last_name,
    firstNameAr: row.first_name_ar,
    lastNameAr: row.last_name_ar,
    email: row.email,
    phone: row.phone,
    birthDate: row.birth_date,
    nationalId: row.national_id,
    gender: row.gender as Gender | null,
    maritalStatus: row.marital_status as MaritalStatus | null,
    departmentId: row.department_id,
    jobTitleId: row.job_title_id,
    managerId: row.manager_id,
    branchId: row.branch_id,
    hireDate: row.hire_date,
    workerCategory: row.worker_category as WorkerCategory,
    employmentType: row.employment_type as Employee["employmentType"],
    overtimeEligibility: row.overtime_eligibility as OvertimeEligibility,
    standardWorkHours: row.standard_work_hours,
    probationEndDate: row.probation_end_date,
    priorServiceYears: row.prior_service_years,
    requireSelfieAtClockIn: row.require_selfie_at_clock_in === 1,
    requireBiometricAtClockIn: row.require_biometric_at_clock_in === 1,
    address: row.address ? (JSON.parse(row.address) as EmployeeAddress) : null,
    emergencyContact: row.emergency_contact ? (JSON.parse(row.emergency_contact) as EmergencyContact) : null,
    status: row.status as EmployeeStatus,
    terminatedAt: row.terminated_at,
    createdAt: row.created_at,
  };
}

class SqliteEmployeeRepository implements EmployeeRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO hr_employees (
        id, code, first_name, last_name, first_name_ar, last_name_ar, email, phone, birth_date, national_id,
        gender, marital_status, department_id, job_title_id, manager_id, branch_id, hire_date, worker_category,
        employment_type, overtime_eligibility, standard_work_hours, probation_end_date, prior_service_years,
        require_selfie_at_clock_in, require_biometric_at_clock_in, address, emergency_contact, status, terminated_at, created_at
      ) VALUES (
        @id, @code, @first_name, @last_name, @first_name_ar, @last_name_ar, @email, @phone, @birth_date, @national_id,
        @gender, @marital_status, @department_id, @job_title_id, @manager_id, @branch_id, @hire_date, @worker_category,
        @employment_type, @overtime_eligibility, @standard_work_hours, @probation_end_date, @prior_service_years,
        @require_selfie_at_clock_in, @require_biometric_at_clock_in, @address, @emergency_contact, @status, @terminated_at, @created_at
      )
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code, first_name = excluded.first_name, last_name = excluded.last_name,
        first_name_ar = excluded.first_name_ar, last_name_ar = excluded.last_name_ar, email = excluded.email,
        phone = excluded.phone, birth_date = excluded.birth_date, national_id = excluded.national_id,
        gender = excluded.gender, marital_status = excluded.marital_status, department_id = excluded.department_id,
        job_title_id = excluded.job_title_id, manager_id = excluded.manager_id, branch_id = excluded.branch_id,
        hire_date = excluded.hire_date, worker_category = excluded.worker_category,
        employment_type = excluded.employment_type, overtime_eligibility = excluded.overtime_eligibility,
        standard_work_hours = excluded.standard_work_hours, probation_end_date = excluded.probation_end_date,
        prior_service_years = excluded.prior_service_years, require_selfie_at_clock_in = excluded.require_selfie_at_clock_in,
        require_biometric_at_clock_in = excluded.require_biometric_at_clock_in, address = excluded.address,
        emergency_contact = excluded.emergency_contact, status = excluded.status, terminated_at = excluded.terminated_at,
        created_at = excluded.created_at
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM hr_employees WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM hr_employees`);
  }

  async findById(id: string): Promise<Employee | null> {
    const row = this.selectById.get(id) as EmployeeRow | undefined;
    return row ? toEmployee(row) : null;
  }
  async list(): Promise<Employee[]> {
    return (this.selectAll.all() as EmployeeRow[]).map(toEmployee);
  }
  async create(employee: Employee): Promise<void> {
    this.write(employee);
  }
  async update(employee: Employee): Promise<void> {
    this.write(employee);
  }
  private write(employee: Employee): void {
    this.upsert.run({
      id: employee.id,
      code: employee.code,
      first_name: employee.firstName,
      last_name: employee.lastName,
      first_name_ar: employee.firstNameAr,
      last_name_ar: employee.lastNameAr,
      email: employee.email,
      phone: employee.phone,
      birth_date: employee.birthDate,
      national_id: employee.nationalId,
      gender: employee.gender,
      marital_status: employee.maritalStatus,
      department_id: employee.departmentId,
      job_title_id: employee.jobTitleId,
      manager_id: employee.managerId,
      branch_id: employee.branchId,
      hire_date: employee.hireDate,
      worker_category: employee.workerCategory,
      employment_type: employee.employmentType,
      overtime_eligibility: employee.overtimeEligibility,
      standard_work_hours: employee.standardWorkHours,
      probation_end_date: employee.probationEndDate,
      prior_service_years: employee.priorServiceYears,
      require_selfie_at_clock_in: employee.requireSelfieAtClockIn ? 1 : 0,
      require_biometric_at_clock_in: employee.requireBiometricAtClockIn ? 1 : 0,
      address: employee.address ? JSON.stringify(employee.address) : null,
      emergency_contact: employee.emergencyContact ? JSON.stringify(employee.emergencyContact) : null,
      status: employee.status,
      terminated_at: employee.terminatedAt,
      created_at: employee.createdAt,
    });
  }
}

export interface SqliteEmployeeRepositoryHandle extends EmployeeRepository {
  close(): void;
}

/** Open a SQLite-backed EmployeeRepository. ":memory:" for tests, a path for real. */
export function createSqliteEmployeeRepository(path: SqliteConnectionInput = ":memory:"): SqliteEmployeeRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  const repo = new SqliteEmployeeRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteEmployeeRepositoryHandle;
}
