import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertNew } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  DuplicateDeviceBadgeError,
  type SalaryPaymentMethod,
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
 * Stores for HR master data (docs/archive/catalog/06
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
  overtime_eligible: bigint;
  standard_work_hours: number | null;
  active: bigint;
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
    overtimeEligible: Number(row.overtime_eligible) === 1,
    standardWorkHours: row.standard_work_hours === null ? null : Number(row.standard_work_hours),
    active: Number(row.active) === 1,
    createdAt: row.created_at,
  };
}

function departmentParams(department: Department): SqlValue[] {
  return [
    department.id,
    department.code,
    department.name,
    department.nameAr,
    department.parentDepartmentId,
    department.managerId,
    department.overtimeEligible ? 1 : 0,
    department.standardWorkHours,
    department.active ? 1 : 0,
    department.createdAt,
  ];
}

const DEPARTMENT_UPSERT = `
      INSERT INTO hr_department (id, code, name, name_ar, parent_department_id, manager_id, overtime_eligible, standard_work_hours, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        name_ar = excluded.name_ar,
        parent_department_id = excluded.parent_department_id,
        manager_id = excluded.manager_id,
        overtime_eligible = excluded.overtime_eligible,
        standard_work_hours = excluded.standard_work_hours,
        active = excluded.active
    `;

class SqlDepartmentRepository implements DepartmentRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<Department | null> {
    const row = await this.db.get<DepartmentRow>(`SELECT * FROM hr_department WHERE id = ?`, [id]);
    return row ? toDepartment(row) : null;
  }

  async findByCode(code: string): Promise<Department | null> {
    const row = await this.db.get<DepartmentRow>(`SELECT * FROM hr_department WHERE code = ?`, [code]);
    return row ? toDepartment(row) : null;
  }

  async list(): Promise<Department[]> {
    return (await this.db.all<DepartmentRow>(`SELECT * FROM hr_department ORDER BY name`)).map(toDepartment);
  }

  async create(department: Department): Promise<void> {
    await insertNew(this.db, department.id, DEPARTMENT_UPSERT, departmentParams(department));
  }

  async update(department: Department): Promise<void> {
    await this.db.run(DEPARTMENT_UPSERT, departmentParams(department));
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
  active: bigint;
  created_at: string;
}

function toJobTitle(row: JobTitleRow): JobTitle {
  return {
    id: row.id,
    departmentId: row.department_id,
    name: row.name,
    nameAr: row.name_ar,
    active: Number(row.active) === 1,
    createdAt: row.created_at,
  };
}

function jobTitleParams(jobTitle: JobTitle): SqlValue[] {
  return [
    jobTitle.id,
    jobTitle.departmentId,
    jobTitle.name,
    jobTitle.nameAr,
    jobTitle.active ? 1 : 0,
    jobTitle.createdAt,
  ];
}

const JOB_TITLE_UPSERT = `
      INSERT INTO hr_job_title (id, department_id, name, name_ar, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        name_ar = excluded.name_ar,
        active = excluded.active
    `;

class SqlJobTitleRepository implements JobTitleRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<JobTitle | null> {
    const row = await this.db.get<JobTitleRow>(`SELECT * FROM hr_job_title WHERE id = ?`, [id]);
    return row ? toJobTitle(row) : null;
  }

  async list(): Promise<JobTitle[]> {
    return (await this.db.all<JobTitleRow>(`SELECT * FROM hr_job_title ORDER BY name`)).map(toJobTitle);
  }

  async listByDepartmentId(departmentId: string): Promise<JobTitle[]> {
    return (await this.db.all<JobTitleRow>(`SELECT * FROM hr_job_title WHERE department_id = ? ORDER BY name`, [departmentId])).map(toJobTitle);
  }

  async create(jobTitle: JobTitle): Promise<void> {
    await insertNew(this.db, jobTitle.id, JOB_TITLE_UPSERT, jobTitleParams(jobTitle));
  }

  async update(jobTitle: JobTitle): Promise<void> {
    await this.db.run(JOB_TITLE_UPSERT, jobTitleParams(jobTitle));
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
  device_badge_id               TEXT,
  has_pension_entitlement       INTEGER,
  tax_disability_exemption      INTEGER NOT NULL DEFAULT 0,
  address_json                  TEXT,
  emergency_contact_json        TEXT,
  salary_payment_method         TEXT,
  bank_iban                     TEXT,
  bank_account_name             TEXT,
  bank_name                     TEXT,
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
  require_selfie_at_clock_in: bigint;
  require_biometric_at_clock_in: bigint;
  device_badge_id: string | null;
  has_pension_entitlement: bigint | null;
  tax_disability_exemption: bigint;
  address_json: string | null;
  emergency_contact_json: string | null;
  salary_payment_method: string | null;
  bank_iban: string | null;
  bank_account_name: string | null;
  bank_name: string | null;
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
    standardWorkHours: row.standard_work_hours === null ? null : Number(row.standard_work_hours),
    probationEndDate: row.probation_end_date,
    priorServiceYears: Number(row.prior_service_years),
    requireSelfieAtClockIn: Number(row.require_selfie_at_clock_in) === 1,
    requireBiometricAtClockIn: Number(row.require_biometric_at_clock_in) === 1,
    deviceBadgeId: row.device_badge_id,
    hasPensionEntitlement: row.has_pension_entitlement === null || row.has_pension_entitlement === undefined ? null : Number(row.has_pension_entitlement) === 1,
    taxDisabilityExemption: Number(row.tax_disability_exemption) === 1,
    address: row.address_json ? (JSON.parse(row.address_json) as EmployeeAddress) : null,
    emergencyContact: row.emergency_contact_json ? (JSON.parse(row.emergency_contact_json) as EmergencyContact) : null,
    salaryPaymentMethod: (row.salary_payment_method as SalaryPaymentMethod | null) ?? null,
    bankAccount: row.bank_iban ? { iban: row.bank_iban, accountName: row.bank_account_name ?? null, bankName: row.bank_name ?? null } : null,
    status: row.status as EmployeeStatus,
    terminatedAt: row.terminated_at,
    createdAt: row.created_at,
  };
}

function employeeParams(employee: Employee): SqlValue[] {
  return [
    employee.id,
    employee.code,
    employee.firstName,
    employee.lastName,
    employee.firstNameAr,
    employee.lastNameAr,
    employee.email,
    employee.phone,
    employee.birthDate,
    employee.nationalId,
    employee.gender,
    employee.maritalStatus,
    employee.departmentId,
    employee.jobTitleId,
    employee.managerId,
    employee.branchId,
    employee.hireDate,
    employee.workerCategory,
    employee.employmentType,
    employee.overtimeEligibility,
    employee.standardWorkHours,
    employee.probationEndDate,
    employee.priorServiceYears,
    employee.requireSelfieAtClockIn ? 1 : 0,
    employee.requireBiometricAtClockIn ? 1 : 0,
    employee.deviceBadgeId,
    employee.hasPensionEntitlement === null ? null : employee.hasPensionEntitlement ? 1 : 0,
    employee.taxDisabilityExemption ? 1 : 0,
    employee.address ? JSON.stringify(employee.address) : null,
    employee.emergencyContact ? JSON.stringify(employee.emergencyContact) : null,
    employee.salaryPaymentMethod ?? null,
    employee.bankAccount?.iban ?? null,
    employee.bankAccount?.accountName ?? null,
    employee.bankAccount?.bankName ?? null,
    employee.status,
    employee.terminatedAt,
    employee.createdAt,
  ];
}

const EMPLOYEE_UPSERT = `
      INSERT INTO hr_employee (
        id, code, first_name, last_name, first_name_ar, last_name_ar, email, phone, birth_date, national_id,
        gender, marital_status, department_id, job_title_id, manager_id, branch_id, hire_date, worker_category,
        employment_type, overtime_eligibility, standard_work_hours, probation_end_date, prior_service_years,
        require_selfie_at_clock_in, require_biometric_at_clock_in, device_badge_id, has_pension_entitlement, tax_disability_exemption,
        address_json, emergency_contact_json, salary_payment_method, bank_iban, bank_account_name, bank_name, status, terminated_at, created_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?
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
        device_badge_id = excluded.device_badge_id,
        has_pension_entitlement = excluded.has_pension_entitlement,
        tax_disability_exemption = excluded.tax_disability_exemption,
        address_json = excluded.address_json,
        emergency_contact_json = excluded.emergency_contact_json,
        salary_payment_method = excluded.salary_payment_method,
        bank_iban = excluded.bank_iban,
        bank_account_name = excluded.bank_account_name,
        bank_name = excluded.bank_name,
        status = excluded.status,
        terminated_at = excluded.terminated_at
    `;

class SqlEmployeeRepository implements EmployeeRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<Employee | null> {
    const row = await this.db.get<EmployeeRow>(`SELECT * FROM hr_employee WHERE id = ?`, [id]);
    return row ? toEmployee(row) : null;
  }

  async list(): Promise<Employee[]> {
    return (await this.db.all<EmployeeRow>(`SELECT * FROM hr_employee ORDER BY created_at`)).map(toEmployee);
  }

  async create(employee: Employee): Promise<void> {
    await this.write(employee, true);
  }

  async update(employee: Employee): Promise<void> {
    await this.write(employee, false);
  }

  private async write(employee: Employee, insertOnly: boolean): Promise<void> {
    try {
      if (insertOnly) await insertNew(this.db, employee.id, EMPLOYEE_UPSERT, employeeParams(employee));
      else await this.db.run(EMPLOYEE_UPSERT, employeeParams(employee));
    } catch (err) {
      if (employee.deviceBadgeId && isDeviceBadgeClash(err)) throw new DuplicateDeviceBadgeError(employee.deviceBadgeId, null);
      throw err;
    }
  }
}

const DEVICE_BADGE_INDEX = "ux_hr_employee_device_badge";
const CREATE_DEVICE_BADGE_INDEX = `CREATE UNIQUE INDEX IF NOT EXISTS ${DEVICE_BADGE_INDEX} ON hr_employee (device_badge_id) WHERE device_badge_id IS NOT NULL`;

function isDeviceBadgeClash(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const { code, constraint } = err as { code?: string; constraint?: string };
  if (code === "23505") return constraint === DEVICE_BADGE_INDEX;
  return code === "SQLITE_CONSTRAINT_UNIQUE" && err.message.includes("device_badge_id");
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
  monthly_salary: bigint;
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
  componentId?: string | null;
}

function serializeLineItems(items: readonly ContractLineItem[]): string {
  return JSON.stringify(items.map((i): SerializedLineItem => ({ id: i.id, name: i.name, amount: i.amount.toScaledNumber(), componentId: i.componentId })));
}

function deserializeLineItems(json: string): ContractLineItem[] {
  return (JSON.parse(json) as SerializedLineItem[]).map((i) => ({ id: i.id, name: i.name, amount: Money.fromScaled(i.amount), componentId: i.componentId ?? null }));
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

function contractParams(contract: Contract): SqlValue[] {
  return [
    contract.id,
    contract.number,
    contract.employeeId,
    contract.type,
    contract.payBasis,
    contract.payFrequency,
    contract.startDate,
    contract.endDate,
    contract.monthlySalary.scaled,
    contract.currency,
    JSON.stringify(contract.leaveEntitlement),
    serializeLineItems(contract.allowances),
    serializeLineItems(contract.deductions),
    contract.status,
    contract.terminatedAt,
    contract.createdAt,
  ];
}

const CONTRACT_UPSERT = `
      INSERT INTO hr_contract (
        id, number, employee_id, type, pay_basis, pay_frequency, start_date, end_date, monthly_salary, currency,
        leave_entitlement_json, allowances_json, deductions_json, status, terminated_at, created_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
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
    `;

class SqlContractRepository implements ContractRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<Contract | null> {
    const row = await this.db.get<ContractRow>(`SELECT * FROM hr_contract WHERE id = ?`, [id]);
    return row ? toContract(row) : null;
  }

  async list(): Promise<Contract[]> {
    return (await this.db.all<ContractRow>(`SELECT * FROM hr_contract ORDER BY created_at`)).map(toContract);
  }

  async listByEmployeeId(employeeId: string): Promise<Contract[]> {
    return (await this.db.all<ContractRow>(`SELECT * FROM hr_contract WHERE employee_id = ? ORDER BY created_at`, [employeeId])).map(toContract);
  }

  async create(contract: Contract): Promise<void> {
    await insertNew(this.db, contract.id, CONTRACT_UPSERT, contractParams(contract));
  }

  async update(contract: Contract): Promise<void> {
    await this.db.run(CONTRACT_UPSERT, contractParams(contract));
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
  recurring_annual: bigint;
  created_at: string;
}

function toHoliday(row: HolidayRow): Holiday {
  return {
    id: row.id,
    date: row.date,
    nameEn: row.name_en,
    nameAr: row.name_ar,
    recurringAnnual: Number(row.recurring_annual) === 1,
    createdAt: row.created_at,
  };
}

function holidayParams(holiday: Holiday): SqlValue[] {
  return [
    holiday.id,
    holiday.date,
    holiday.nameEn,
    holiday.nameAr,
    holiday.recurringAnnual ? 1 : 0,
    holiday.createdAt,
  ];
}

const HOLIDAY_UPSERT = `
      INSERT INTO hr_holiday (id, date, name_en, name_ar, recurring_annual, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        date = excluded.date,
        name_en = excluded.name_en,
        name_ar = excluded.name_ar,
        recurring_annual = excluded.recurring_annual
    `;

class SqlHolidayRepository implements HolidayRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<Holiday | null> {
    const row = await this.db.get<HolidayRow>(`SELECT * FROM hr_holiday WHERE id = ?`, [id]);
    return row ? toHoliday(row) : null;
  }

  async list(): Promise<Holiday[]> {
    return (await this.db.all<HolidayRow>(`SELECT * FROM hr_holiday ORDER BY date`)).map(toHoliday);
  }

  async create(holiday: Holiday): Promise<void> {
    await insertNew(this.db, holiday.id, HOLIDAY_UPSERT, holidayParams(holiday));
  }

  async update(holiday: Holiday): Promise<void> {
    await this.db.run(HOLIDAY_UPSERT, holidayParams(holiday));
  }

  async remove(id: string): Promise<void> {
    await this.db.run(`DELETE FROM hr_holiday WHERE id = ?`, [id]);
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
  half_day: bigint;
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
    halfDay: Number(row.half_day) === 1,
    startDate: row.start_date,
    endDate: row.end_date,
    days: Number(row.days),
    reason: row.reason,
    status: row.status as LeaveRequestStatus,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
  };
}

function leaveRequestParams(request: LeaveRequest): SqlValue[] {
  return [
    request.id,
    request.number,
    request.employeeId,
    request.leaveType,
    request.halfDay ? 1 : 0,
    request.startDate,
    request.endDate,
    request.days,
    request.reason,
    request.status,
    request.createdAt,
    request.decidedAt,
    request.decidedBy,
  ];
}

const LEAVE_REQUEST_UPSERT = `
      INSERT INTO hr_leave_request (id, number, employee_id, leave_type, half_day, start_date, end_date, days, reason, status, created_at, decided_at, decided_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        decided_at = excluded.decided_at,
        decided_by = excluded.decided_by
    `;

class SqlLeaveRequestRepository implements LeaveRequestRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<LeaveRequest | null> {
    const row = await this.db.get<LeaveRequestRow>(`SELECT * FROM hr_leave_request WHERE id = ?`, [id]);
    return row ? toLeaveRequest(row) : null;
  }

  async list(): Promise<LeaveRequest[]> {
    return (await this.db.all<LeaveRequestRow>(`SELECT * FROM hr_leave_request ORDER BY created_at DESC`)).map(toLeaveRequest);
  }

  async listByEmployeeId(employeeId: string): Promise<LeaveRequest[]> {
    return (await this.db.all<LeaveRequestRow>(`SELECT * FROM hr_leave_request WHERE employee_id = ? ORDER BY created_at DESC`, [employeeId])).map(toLeaveRequest);
  }

  async create(request: LeaveRequest): Promise<void> {
    await insertNew(this.db, request.id, LEAVE_REQUEST_UPSERT, leaveRequestParams(request));
  }

  async update(request: LeaveRequest): Promise<void> {
    await this.db.run(LEAVE_REQUEST_UPSERT, leaveRequestParams(request));
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

export async function ensureHrSchema(db: SqlDb): Promise<void> {
  await db.applySchema(
    [CREATE_DEPARTMENT, CREATE_JOB_TITLE, CREATE_EMPLOYEE, `${CREATE_DEVICE_BADGE_INDEX};`, CREATE_CONTRACT, CREATE_HOLIDAY, CREATE_LEAVE_REQUEST].join("\n"),
  );
}

export function createDepartmentRepository(db: SqlDb): DepartmentRepository {
  return new SqlDepartmentRepository(db);
}

export function createJobTitleRepository(db: SqlDb): JobTitleRepository {
  return new SqlJobTitleRepository(db);
}

export function createEmployeeRepository(db: SqlDb): EmployeeRepository {
  return new SqlEmployeeRepository(db);
}

export function createContractRepository(db: SqlDb): ContractRepository {
  return new SqlContractRepository(db);
}

export function createHolidayRepository(db: SqlDb): HolidayRepository {
  return new SqlHolidayRepository(db);
}

export function createLeaveRequestRepository(db: SqlDb): LeaveRequestRepository {
  return new SqlLeaveRequestRepository(db);
}

/** Open a SQLite-backed DepartmentRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteDepartmentRepository(path: SqliteConnectionInput = ":memory:"): SqliteDepartmentRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_DEPARTMENT);
  const repo = createDepartmentRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteDepartmentRepositoryHandle;
}

/** Open a SQLite-backed JobTitleRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteJobTitleRepository(path: SqliteConnectionInput = ":memory:"): SqliteJobTitleRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_JOB_TITLE);
  const repo = createJobTitleRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteJobTitleRepositoryHandle;
}

/**
 * A books file that already holds two employees on one badge cannot take the
 * index; it is skipped there and the routes' own check still refuses a new clash.
 */
function ensureDeviceBadgeIndex(sqlite: Database.Database): void {
  const clash = sqlite
    .prepare(`SELECT device_badge_id FROM hr_employee WHERE device_badge_id IS NOT NULL GROUP BY device_badge_id HAVING COUNT(*) > 1 LIMIT 1`)
    .get();
  if (clash) return;
  sqlite.exec(CREATE_DEVICE_BADGE_INDEX);
}

/** Open a SQLite-backed EmployeeRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteEmployeeRepository(path: SqliteConnectionInput = ":memory:"): SqliteEmployeeRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_EMPLOYEE);
  const columns = new Set((sqlite.pragma("table_info(hr_employee)") as { name: string }[]).map((c) => c.name));
  if (!columns.has("has_pension_entitlement")) sqlite.exec("ALTER TABLE hr_employee ADD COLUMN has_pension_entitlement INTEGER");
  if (!columns.has("tax_disability_exemption")) sqlite.exec("ALTER TABLE hr_employee ADD COLUMN tax_disability_exemption INTEGER NOT NULL DEFAULT 0");
  if (!columns.has("device_badge_id")) sqlite.exec("ALTER TABLE hr_employee ADD COLUMN device_badge_id TEXT");
  for (const column of ["salary_payment_method", "bank_iban", "bank_account_name", "bank_name"]) {
    if (!columns.has(column)) sqlite.exec(`ALTER TABLE hr_employee ADD COLUMN ${column} TEXT`);
  }
  ensureDeviceBadgeIndex(sqlite);
  const repo = createEmployeeRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteEmployeeRepositoryHandle;
}

/** Open a SQLite-backed ContractRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteContractRepository(path: SqliteConnectionInput = ":memory:"): SqliteContractRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_CONTRACT);
  const repo = createContractRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteContractRepositoryHandle;
}

/** Open a SQLite-backed HolidayRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteHolidayRepository(path: SqliteConnectionInput = ":memory:"): SqliteHolidayRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_HOLIDAY);
  const repo = createHolidayRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteHolidayRepositoryHandle;
}

/** Open a SQLite-backed LeaveRequestRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteLeaveRequestRepository(path: SqliteConnectionInput = ":memory:"): SqliteLeaveRequestRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_LEAVE_REQUEST);
  const repo = createLeaveRequestRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteLeaveRequestRepositoryHandle;
}
