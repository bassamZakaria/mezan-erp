import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  Money,
  type Department,
  type DepartmentRepository,
  type JobTitle,
  type JobTitleRepository,
  type Employee,
  type EmployeeRepository,
  type EmployeeAddress,
  type EmergencyContact,
  type EmployeeStatus,
  type WorkerCategory,
  type OvertimeEligibility,
  type Gender,
  type MaritalStatus,
  type Contract,
  type ContractRepository,
  type ContractLineItem,
  type ContractType,
  type PayBasis,
  type PayFrequency,
  type ContractStatus,
  type LeaveEntitlementOverrides,
  type Holiday,
  type HolidayRepository,
  type LeaveRequest,
  type LeaveRequestRepository,
  type LeaveType,
  type LeaveRequestStatus,
} from "@mezan/domain";

/**
 * Self-contained SQLite stores for HR master data (docs/catalog/06
 * "الموارد البشرية" — hr/master-data). Mirrors `crm-store.ts`'s single-file,
 * single-table-per-entity style; nested value objects (allowances/deductions/
 * leave-entitlement on Contract, address/emergency-contact on Employee) are
 * stored as JSON TEXT columns, matching `document-store.ts`'s `lines_json`
 * convention.
 */

// --- Department --------------------------------------------------------

const CREATE_DEPARTMENT = `
CREATE TABLE IF NOT EXISTS hr_department (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  name_ar               TEXT,
  parent_department_id  TEXT,
  manager_id            TEXT,
  overtime_eligible     INTEGER NOT NULL,
  standard_work_hours   REAL,
  active                INTEGER NOT NULL,
  created_at            TEXT NOT NULL
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
      INSERT INTO hr_department (id, code, name, name_ar, parent_department_id, manager_id, overtime_eligible, standard_work_hours, active, created_at)
      VALUES (@id, @code, @name, @name_ar, @parent_department_id, @manager_id, @overtime_eligible, @standard_work_hours, @active, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        name_ar = excluded.name_ar,
        parent_department_id = excluded.parent_department_id,
        manager_id = excluded.manager_id,
        overtime_eligible = excluded.overtime_eligible,
        standard_work_hours = excluded.standard_work_hours,
        active = excluded.active
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM hr_department WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM hr_department WHERE code = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM hr_department ORDER BY name`);
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

// --- Job Title -----------------------------------------------------------

const CREATE_JOB_TITLE = `
CREATE TABLE IF NOT EXISTS hr_job_title (
  id             TEXT PRIMARY KEY,
  department_id  TEXT NOT NULL,
  name           TEXT NOT NULL,
  name_ar        TEXT,
  active         INTEGER NOT NULL,
  created_at     TEXT NOT NULL
);
`;

interface JobTitleRow {
  id: string;
  department_id: string;
  name: string;
  name_ar: string | null;
  active: number;
  created_at: string;
}

function toJobTitle(row: JobTitleRow): JobTitle {
  return {
    id: row.id,
    departmentId: row.department_id,
    name: row.name,
    nameAr: row.name_ar,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

class SqliteJobTitleRepository implements JobTitleRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectByDepartment: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO hr_job_title (id, department_id, name, name_ar, active, created_at)
      VALUES (@id, @department_id, @name, @name_ar, @active, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        name_ar = excluded.name_ar,
        active = excluded.active
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM hr_job_title WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM hr_job_title ORDER BY name`);
    this.selectByDepartment = sqlite.prepare(`SELECT * FROM hr_job_title WHERE department_id = ? ORDER BY name`);
  }

  async findById(id: string): Promise<JobTitle | null> {
    const row = this.selectById.get(id) as JobTitleRow | undefined;
    return row ? toJobTitle(row) : null;
  }

  async list(): Promise<JobTitle[]> {
    return (this.selectAll.all() as JobTitleRow[]).map(toJobTitle);
  }

  async listByDepartmentId(departmentId: string): Promise<JobTitle[]> {
    return (this.selectByDepartment.all(departmentId) as JobTitleRow[]).map(toJobTitle);
  }

  async create(jobTitle: JobTitle): Promise<void> {
    this.write(jobTitle);
  }

  async update(jobTitle: JobTitle): Promise<void> {
    this.write(jobTitle);
  }

  private write(jobTitle: JobTitle): void {
    this.upsert.run({
      id: jobTitle.id,
      department_id: jobTitle.departmentId,
      name: jobTitle.name,
      name_ar: jobTitle.nameAr,
      active: jobTitle.active ? 1 : 0,
      created_at: jobTitle.createdAt,
    });
  }
}

// --- Employee ------------------------------------------------------------

const CREATE_EMPLOYEE = `
CREATE TABLE IF NOT EXISTS hr_employee (
  id                            TEXT PRIMARY KEY,
  code                          TEXT NOT NULL UNIQUE,
  first_name                    TEXT NOT NULL,
  last_name                     TEXT NOT NULL,
  first_name_ar                 TEXT,
  last_name_ar                  TEXT,
  email                         TEXT,
  phone                         TEXT,
  birth_date                    TEXT,
  national_id                   TEXT,
  gender                        TEXT,
  marital_status                TEXT,
  department_id                 TEXT,
  job_title_id                  TEXT,
  manager_id                    TEXT,
  branch_id                     TEXT NOT NULL,
  hire_date                     TEXT NOT NULL,
  worker_category               TEXT NOT NULL,
  employment_type               TEXT NOT NULL,
  overtime_eligibility          TEXT NOT NULL,
  standard_work_hours           REAL,
  probation_end_date            TEXT,
  prior_service_years           REAL NOT NULL,
  require_selfie_at_clock_in    INTEGER NOT NULL,
  require_biometric_at_clock_in INTEGER NOT NULL,
  address_json                  TEXT,
  emergency_contact_json        TEXT,
  status                        TEXT NOT NULL,
  terminated_at                 TEXT,
  created_at                    TEXT NOT NULL
);
`;

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
  address_json: string | null;
  emergency_contact_json: string | null;
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
    employmentType: row.employment_type as "full_time" | "part_time",
    overtimeEligibility: row.overtime_eligibility as OvertimeEligibility,
    standardWorkHours: row.standard_work_hours,
    probationEndDate: row.probation_end_date,
    priorServiceYears: row.prior_service_years,
    requireSelfieAtClockIn: row.require_selfie_at_clock_in === 1,
    requireBiometricAtClockIn: row.require_biometric_at_clock_in === 1,
    address: row.address_json ? (JSON.parse(row.address_json) as EmployeeAddress) : null,
    emergencyContact: row.emergency_contact_json ? (JSON.parse(row.emergency_contact_json) as EmergencyContact) : null,
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
      INSERT INTO hr_employee (
        id, code, first_name, last_name, first_name_ar, last_name_ar, email, phone, birth_date, national_id,
        gender, marital_status, department_id, job_title_id, manager_id, branch_id, hire_date, worker_category,
        employment_type, overtime_eligibility, standard_work_hours, probation_end_date, prior_service_years,
        require_selfie_at_clock_in, require_biometric_at_clock_in, address_json, emergency_contact_json,
        status, terminated_at, created_at
      )
      VALUES (
        @id, @code, @first_name, @last_name, @first_name_ar, @last_name_ar, @email, @phone, @birth_date, @national_id,
        @gender, @marital_status, @department_id, @job_title_id, @manager_id, @branch_id, @hire_date, @worker_category,
        @employment_type, @overtime_eligibility, @standard_work_hours, @probation_end_date, @prior_service_years,
        @require_selfie_at_clock_in, @require_biometric_at_clock_in, @address_json, @emergency_contact_json,
        @status, @terminated_at, @created_at
      )
      ON CONFLICT(id) DO UPDATE SET
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        first_name_ar = excluded.first_name_ar,
        last_name_ar = excluded.last_name_ar,
        email = excluded.email,
        phone = excluded.phone,
        birth_date = excluded.birth_date,
        national_id = excluded.national_id,
        gender = excluded.gender,
        marital_status = excluded.marital_status,
        department_id = excluded.department_id,
        job_title_id = excluded.job_title_id,
        manager_id = excluded.manager_id,
        branch_id = excluded.branch_id,
        hire_date = excluded.hire_date,
        worker_category = excluded.worker_category,
        employment_type = excluded.employment_type,
        overtime_eligibility = excluded.overtime_eligibility,
        standard_work_hours = excluded.standard_work_hours,
        probation_end_date = excluded.probation_end_date,
        prior_service_years = excluded.prior_service_years,
        require_selfie_at_clock_in = excluded.require_selfie_at_clock_in,
        require_biometric_at_clock_in = excluded.require_biometric_at_clock_in,
        address_json = excluded.address_json,
        emergency_contact_json = excluded.emergency_contact_json,
        status = excluded.status,
        terminated_at = excluded.terminated_at
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM hr_employee WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM hr_employee ORDER BY created_at`);
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
      address_json: employee.address ? JSON.stringify(employee.address) : null,
      emergency_contact_json: employee.emergencyContact ? JSON.stringify(employee.emergencyContact) : null,
      status: employee.status,
      terminated_at: employee.terminatedAt,
      created_at: employee.createdAt,
    });
  }
}

// --- Contract --------------------------------------------------------------

const CREATE_CONTRACT = `
CREATE TABLE IF NOT EXISTS hr_contract (
  id                    TEXT PRIMARY KEY,
  number                TEXT NOT NULL UNIQUE,
  employee_id           TEXT NOT NULL,
  type                  TEXT NOT NULL,
  pay_basis             TEXT NOT NULL,
  pay_frequency         TEXT NOT NULL,
  start_date            TEXT NOT NULL,
  end_date              TEXT,
  monthly_salary        INTEGER NOT NULL,
  currency              TEXT NOT NULL,
  leave_entitlement_json TEXT NOT NULL,
  allowances_json       TEXT NOT NULL,
  deductions_json       TEXT NOT NULL,
  status                TEXT NOT NULL,
  terminated_at         TEXT,
  created_at            TEXT NOT NULL
);
`;

interface ContractRow {
  id: string;
  number: string;
  employee_id: string;
  type: string;
  pay_basis: string;
  pay_frequency: string;
  start_date: string;
  end_date: string | null;
  monthly_salary: number;
  currency: string;
  leave_entitlement_json: string;
  allowances_json: string;
  deductions_json: string;
  status: string;
  terminated_at: string | null;
  created_at: string;
}

interface SerializedLineItem {
  id: string;
  name: string;
  amount: number;
}

function serializeLineItems(items: readonly ContractLineItem[]): string {
  return JSON.stringify(items.map((i): SerializedLineItem => ({ id: i.id, name: i.name, amount: i.amount.toScaledNumber() })));
}

function deserializeLineItems(json: string): ContractLineItem[] {
  return (JSON.parse(json) as SerializedLineItem[]).map((i) => ({ id: i.id, name: i.name, amount: Money.fromScaled(i.amount) }));
}

function toContract(row: ContractRow): Contract {
  return {
    id: row.id,
    number: row.number,
    employeeId: row.employee_id,
    type: row.type as ContractType,
    payBasis: row.pay_basis as PayBasis,
    payFrequency: row.pay_frequency as PayFrequency,
    startDate: row.start_date,
    endDate: row.end_date,
    monthlySalary: Money.fromScaled(row.monthly_salary),
    currency: row.currency,
    leaveEntitlement: JSON.parse(row.leave_entitlement_json) as LeaveEntitlementOverrides,
    allowances: deserializeLineItems(row.allowances_json),
    deductions: deserializeLineItems(row.deductions_json),
    status: row.status as ContractStatus,
    terminatedAt: row.terminated_at,
    createdAt: row.created_at,
  };
}

class SqliteContractRepository implements ContractRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectByEmployee: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO hr_contract (
        id, number, employee_id, type, pay_basis, pay_frequency, start_date, end_date, monthly_salary, currency,
        leave_entitlement_json, allowances_json, deductions_json, status, terminated_at, created_at
      )
      VALUES (
        @id, @number, @employee_id, @type, @pay_basis, @pay_frequency, @start_date, @end_date, @monthly_salary, @currency,
        @leave_entitlement_json, @allowances_json, @deductions_json, @status, @terminated_at, @created_at
      )
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        pay_basis = excluded.pay_basis,
        pay_frequency = excluded.pay_frequency,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        monthly_salary = excluded.monthly_salary,
        currency = excluded.currency,
        leave_entitlement_json = excluded.leave_entitlement_json,
        allowances_json = excluded.allowances_json,
        deductions_json = excluded.deductions_json,
        status = excluded.status,
        terminated_at = excluded.terminated_at
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM hr_contract WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM hr_contract ORDER BY created_at`);
    this.selectByEmployee = sqlite.prepare(`SELECT * FROM hr_contract WHERE employee_id = ? ORDER BY created_at`);
  }

  async findById(id: string): Promise<Contract | null> {
    const row = this.selectById.get(id) as ContractRow | undefined;
    return row ? toContract(row) : null;
  }

  async list(): Promise<Contract[]> {
    return (this.selectAll.all() as ContractRow[]).map(toContract);
  }

  async listByEmployeeId(employeeId: string): Promise<Contract[]> {
    return (this.selectByEmployee.all(employeeId) as ContractRow[]).map(toContract);
  }

  async create(contract: Contract): Promise<void> {
    this.write(contract);
  }

  async update(contract: Contract): Promise<void> {
    this.write(contract);
  }

  private write(contract: Contract): void {
    this.upsert.run({
      id: contract.id,
      number: contract.number,
      employee_id: contract.employeeId,
      type: contract.type,
      pay_basis: contract.payBasis,
      pay_frequency: contract.payFrequency,
      start_date: contract.startDate,
      end_date: contract.endDate,
      monthly_salary: contract.monthlySalary.toScaledNumber(),
      currency: contract.currency,
      leave_entitlement_json: JSON.stringify(contract.leaveEntitlement),
      allowances_json: serializeLineItems(contract.allowances),
      deductions_json: serializeLineItems(contract.deductions),
      status: contract.status,
      terminated_at: contract.terminatedAt,
      created_at: contract.createdAt,
    });
  }
}

// --- Holiday -------------------------------------------------------------

const CREATE_HOLIDAY = `
CREATE TABLE IF NOT EXISTS hr_holiday (
  id                TEXT PRIMARY KEY,
  date              TEXT NOT NULL,
  name_en           TEXT NOT NULL,
  name_ar           TEXT,
  recurring_annual  INTEGER NOT NULL,
  created_at        TEXT NOT NULL
);
`;

interface HolidayRow {
  id: string;
  date: string;
  name_en: string;
  name_ar: string | null;
  recurring_annual: number;
  created_at: string;
}

function toHoliday(row: HolidayRow): Holiday {
  return {
    id: row.id,
    date: row.date,
    nameEn: row.name_en,
    nameAr: row.name_ar,
    recurringAnnual: row.recurring_annual === 1,
    createdAt: row.created_at,
  };
}

class SqliteHolidayRepository implements HolidayRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly deleteById: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO hr_holiday (id, date, name_en, name_ar, recurring_annual, created_at)
      VALUES (@id, @date, @name_en, @name_ar, @recurring_annual, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        date = excluded.date,
        name_en = excluded.name_en,
        name_ar = excluded.name_ar,
        recurring_annual = excluded.recurring_annual
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM hr_holiday WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM hr_holiday ORDER BY date`);
    this.deleteById = sqlite.prepare(`DELETE FROM hr_holiday WHERE id = ?`);
  }

  async findById(id: string): Promise<Holiday | null> {
    const row = this.selectById.get(id) as HolidayRow | undefined;
    return row ? toHoliday(row) : null;
  }

  async list(): Promise<Holiday[]> {
    return (this.selectAll.all() as HolidayRow[]).map(toHoliday);
  }

  async create(holiday: Holiday): Promise<void> {
    this.write(holiday);
  }

  async update(holiday: Holiday): Promise<void> {
    this.write(holiday);
  }

  async remove(id: string): Promise<void> {
    this.deleteById.run(id);
  }

  private write(holiday: Holiday): void {
    this.upsert.run({
      id: holiday.id,
      date: holiday.date,
      name_en: holiday.nameEn,
      name_ar: holiday.nameAr,
      recurring_annual: holiday.recurringAnnual ? 1 : 0,
      created_at: holiday.createdAt,
    });
  }
}

// --- Leave Request -----------------------------------------------------

const CREATE_LEAVE_REQUEST = `
CREATE TABLE IF NOT EXISTS hr_leave_request (
  id           TEXT PRIMARY KEY,
  number       TEXT NOT NULL UNIQUE,
  employee_id  TEXT NOT NULL,
  leave_type   TEXT NOT NULL,
  half_day     INTEGER NOT NULL,
  start_date   TEXT NOT NULL,
  end_date     TEXT NOT NULL,
  days         REAL NOT NULL,
  reason       TEXT,
  status       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  decided_at   TEXT,
  decided_by   TEXT
);
`;

interface LeaveRequestRow {
  id: string;
  number: string;
  employee_id: string;
  leave_type: string;
  half_day: number;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

function toLeaveRequest(row: LeaveRequestRow): LeaveRequest {
  return {
    id: row.id,
    number: row.number,
    employeeId: row.employee_id,
    leaveType: row.leave_type as LeaveType,
    halfDay: row.half_day === 1,
    startDate: row.start_date,
    endDate: row.end_date,
    days: row.days,
    reason: row.reason,
    status: row.status as LeaveRequestStatus,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
  };
}

class SqliteLeaveRequestRepository implements LeaveRequestRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectByEmployee: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO hr_leave_request (id, number, employee_id, leave_type, half_day, start_date, end_date, days, reason, status, created_at, decided_at, decided_by)
      VALUES (@id, @number, @employee_id, @leave_type, @half_day, @start_date, @end_date, @days, @reason, @status, @created_at, @decided_at, @decided_by)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        decided_at = excluded.decided_at,
        decided_by = excluded.decided_by
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM hr_leave_request WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM hr_leave_request ORDER BY created_at DESC`);
    this.selectByEmployee = sqlite.prepare(`SELECT * FROM hr_leave_request WHERE employee_id = ? ORDER BY created_at DESC`);
  }

  async findById(id: string): Promise<LeaveRequest | null> {
    const row = this.selectById.get(id) as LeaveRequestRow | undefined;
    return row ? toLeaveRequest(row) : null;
  }

  async list(): Promise<LeaveRequest[]> {
    return (this.selectAll.all() as LeaveRequestRow[]).map(toLeaveRequest);
  }

  async listByEmployeeId(employeeId: string): Promise<LeaveRequest[]> {
    return (this.selectByEmployee.all(employeeId) as LeaveRequestRow[]).map(toLeaveRequest);
  }

  async create(request: LeaveRequest): Promise<void> {
    this.write(request);
  }

  async update(request: LeaveRequest): Promise<void> {
    this.write(request);
  }

  private write(request: LeaveRequest): void {
    this.upsert.run({
      id: request.id,
      number: request.number,
      employee_id: request.employeeId,
      leave_type: request.leaveType,
      half_day: request.halfDay ? 1 : 0,
      start_date: request.startDate,
      end_date: request.endDate,
      days: request.days,
      reason: request.reason,
      status: request.status,
      created_at: request.createdAt,
      decided_at: request.decidedAt,
      decided_by: request.decidedBy,
    });
  }
}

// --- Factories -------------------------------------------------------------

export interface SqliteDepartmentRepositoryHandle extends DepartmentRepository {
  close(): void;
}
export interface SqliteJobTitleRepositoryHandle extends JobTitleRepository {
  close(): void;
}
export interface SqliteEmployeeRepositoryHandle extends EmployeeRepository {
  close(): void;
}
export interface SqliteContractRepositoryHandle extends ContractRepository {
  close(): void;
}
export interface SqliteHolidayRepositoryHandle extends HolidayRepository {
  close(): void;
}
export interface SqliteLeaveRequestRepositoryHandle extends LeaveRequestRepository {
  close(): void;
}

/** Open a SQLite-backed DepartmentRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteDepartmentRepository(path: SqliteConnectionInput = ":memory:"): SqliteDepartmentRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_DEPARTMENT);
  const repo = new SqliteDepartmentRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteDepartmentRepositoryHandle;
}

/** Open a SQLite-backed JobTitleRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteJobTitleRepository(path: SqliteConnectionInput = ":memory:"): SqliteJobTitleRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_JOB_TITLE);
  const repo = new SqliteJobTitleRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteJobTitleRepositoryHandle;
}

/** Open a SQLite-backed EmployeeRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteEmployeeRepository(path: SqliteConnectionInput = ":memory:"): SqliteEmployeeRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_EMPLOYEE);
  const repo = new SqliteEmployeeRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteEmployeeRepositoryHandle;
}

/** Open a SQLite-backed ContractRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteContractRepository(path: SqliteConnectionInput = ":memory:"): SqliteContractRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_CONTRACT);
  const repo = new SqliteContractRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteContractRepositoryHandle;
}

/** Open a SQLite-backed HolidayRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteHolidayRepository(path: SqliteConnectionInput = ":memory:"): SqliteHolidayRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_HOLIDAY);
  const repo = new SqliteHolidayRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteHolidayRepositoryHandle;
}

/** Open a SQLite-backed LeaveRequestRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteLeaveRequestRepository(path: SqliteConnectionInput = ":memory:"): SqliteLeaveRequestRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_LEAVE_REQUEST);
  const repo = new SqliteLeaveRequestRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteLeaveRequestRepositoryHandle;
}
