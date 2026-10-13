import type { App } from "@mezan/api";
import { ADMIN_HEADERS, BRANCH_ID, CORE, seedActorHeaders, seedToday, step } from "./shared.js";

/**
 * Seed profile module — see `./shared.ts`. Local and test environments only.
 *
 * الموارد البشرية for مصنع الوادي الأخضر's main branch: a six-department org
 * chart under one general manager, nine employees (the core profile's two
 * salespeople plus seven more), a contract per employee, and the year of
 * activity that hangs off them — holidays, an applied leave-policy preset with
 * its accrual batches and balances, leave requests in every status, two weeks
 * of attendance plus the month the seed runs in, five advances and three monthly payroll runs at different
 * stages of the draft → محتسب → معتمد → مصروف flow.
 *
 * Payroll figures are contractual only: basic salary, contract allowances,
 * contract deductions, wage garnishments and advance recovery. The engine computes NO income tax,
 * social insurance, Article 47 seniority bonus, overtime or end-of-service
 * gratuity — no formula for any of them was ever captured — so nothing here
 * seeds a number that would imply one was.
 */

/** The seeded admin (`packages/backend/src/seed.ts`), whose login إجازاتي reads. */
const SELF_SERVICE_USER = "USER-ADMIN";

const DEPARTMENTS = [
  { id: "DEPT-DEMO-1", code: "DEP-100", name: "General Management", nameAr: "الإدارة العامة", parentDepartmentId: null, overtimeEligible: false, standardWorkHours: 8 },
  { id: "DEPT-DEMO-2", code: "DEP-200", name: "Sales", nameAr: "المبيعات", parentDepartmentId: "DEPT-DEMO-1", overtimeEligible: false, standardWorkHours: 8 },
  { id: "DEPT-DEMO-3", code: "DEP-300", name: "Human Resources", nameAr: "الموارد البشرية", parentDepartmentId: "DEPT-DEMO-1", overtimeEligible: false, standardWorkHours: 8 },
  { id: "DEPT-DEMO-4", code: "DEP-400", name: "Finance", nameAr: "الحسابات", parentDepartmentId: "DEPT-DEMO-1", overtimeEligible: false, standardWorkHours: 8 },
  { id: "DEPT-DEMO-5", code: "DEP-500", name: "Production", nameAr: "الإنتاج", parentDepartmentId: "DEPT-DEMO-1", overtimeEligible: true, standardWorkHours: 8 },
  { id: "DEPT-DEMO-6", code: "DEP-600", name: "Warehouse", nameAr: "المخازن", parentDepartmentId: "DEPT-DEMO-1", overtimeEligible: true, standardWorkHours: 9 },
];

const DEPARTMENT_MANAGERS = [
  { departmentId: "DEPT-DEMO-1", managerId: "EMP-DEMO-3" },
  { departmentId: "DEPT-DEMO-2", managerId: "EMP-DEMO-1" },
  { departmentId: "DEPT-DEMO-3", managerId: "EMP-DEMO-4" },
  { departmentId: "DEPT-DEMO-4", managerId: "EMP-DEMO-5" },
  { departmentId: "DEPT-DEMO-5", managerId: "EMP-DEMO-6" },
  { departmentId: "DEPT-DEMO-6", managerId: "EMP-DEMO-7" },
];

const JOB_TITLES = [
  { id: "JT-DEMO-1", departmentId: "DEPT-DEMO-1", name: "General Manager", nameAr: "مدير عام" },
  { id: "JT-DEMO-2", departmentId: "DEPT-DEMO-2", name: "Sales Supervisor", nameAr: "مشرف مبيعات" },
  { id: "JT-DEMO-3", departmentId: "DEPT-DEMO-2", name: "Sales Representative", nameAr: "مندوب مبيعات" },
  { id: "JT-DEMO-4", departmentId: "DEPT-DEMO-3", name: "HR Specialist", nameAr: "أخصائي موارد بشرية" },
  { id: "JT-DEMO-5", departmentId: "DEPT-DEMO-4", name: "Accountant", nameAr: "محاسب" },
  { id: "JT-DEMO-6", departmentId: "DEPT-DEMO-5", name: "Production Supervisor", nameAr: "مشرف إنتاج" },
  { id: "JT-DEMO-7", departmentId: "DEPT-DEMO-5", name: "Production Worker", nameAr: "عامل إنتاج" },
  { id: "JT-DEMO-8", departmentId: "DEPT-DEMO-6", name: "Storekeeper", nameAr: "أمين مخزن" },
];

function address(street: string, city: string, governorate: string, postalCode: string) {
  return { street, city, governorate, postalCode };
}

function emergencyContact(name: string, relationship: string, phone: string) {
  return { name, relationship, phone, altPhone: null };
}

/** The core profile already created EMP-DEMO-1/2 as bare salespeople; these fill in their HR record. */
const CORE_EMPLOYEE_PATCHES = [
  {
    id: CORE.employees[0],
    patch: {
      deviceBadgeId: "1001",
      departmentId: "DEPT-DEMO-2",
      jobTitleId: "JT-DEMO-2",
      managerId: "EMP-DEMO-3",
      email: "kareem.adel@wadi-akhdar.example",
      phone: "01004556677",
      birthDate: "1991-04-18",
      nationalId: "29104181201573",
      gender: "male",
      maritalStatus: "married",
      standardWorkHours: 8,
      address: address("12 شارع الجلاء", "المنصورة", "الدقهلية", "35511"),
      emergencyContact: emergencyContact("منى عادل", "زوجة", "01004556688"),
    },
  },
  {
    id: CORE.employees[1],
    patch: {
      deviceBadgeId: "1002",
      departmentId: "DEPT-DEMO-2",
      jobTitleId: "JT-DEMO-3",
      managerId: "EMP-DEMO-1",
      email: "salma.fouad@wadi-akhdar.example",
      phone: "01115667788",
      birthDate: "1997-11-02",
      nationalId: "29711021202614",
      gender: "female",
      maritalStatus: "single",
      standardWorkHours: 8,
      address: address("4 شارع بورسعيد", "طنطا", "الغربية", "31511"),
      emergencyContact: emergencyContact("فؤاد إبراهيم", "والد", "01115667799"),
    },
  },
];

const EMPLOYEES = [
  {
    id: "EMP-DEMO-3",
    deviceBadgeId: "1003",
    firstName: "Mohamed",
    lastName: "El-Shehaby",
    firstNameAr: "محمد",
    lastNameAr: "الشهابي",
    email: "admin@cyag.example",
    phone: "01223344556",
    birthDate: "1979-02-09",
    nationalId: "27902091200817",
    gender: "male",
    maritalStatus: "married",
    departmentId: "DEPT-DEMO-1",
    jobTitleId: "JT-DEMO-1",
    managerId: null,
    hireDate: "2023-01-02",
    workerCategory: "staff",
    employmentType: "full_time",
    overtimeEligibility: "not_eligible",
    standardWorkHours: 8,
    probationEndDate: null,
    priorServiceYears: 11,
    address: address("27 شارع الحرية", "المنصورة", "الدقهلية", "35516"),
    emergencyContact: emergencyContact("سهير الشهابي", "زوجة", "01223344557"),
  },
  {
    id: "EMP-DEMO-4",
    deviceBadgeId: "1004",
    firstName: "Hoda",
    lastName: "Mostafa",
    firstNameAr: "هدى",
    lastNameAr: "مصطفى",
    email: "hoda.mostafa@wadi-akhdar.example",
    phone: "01098112233",
    birthDate: "1993-07-21",
    nationalId: "29307211203426",
    gender: "female",
    maritalStatus: "married",
    departmentId: "DEPT-DEMO-3",
    jobTitleId: "JT-DEMO-4",
    managerId: "EMP-DEMO-3",
    hireDate: "2024-09-01",
    workerCategory: "staff",
    employmentType: "full_time",
    overtimeEligibility: "inherit_department",
    standardWorkHours: 8,
    probationEndDate: null,
    priorServiceYears: 3,
    address: address("9 شارع الجمهورية", "المنصورة", "الدقهلية", "35512"),
    emergencyContact: emergencyContact("طارق سعيد", "زوج", "01098112244"),
  },
  {
    id: "EMP-DEMO-5",
    deviceBadgeId: "1005",
    requireSelfieAtClockIn: true,
    firstName: "Ahmed",
    lastName: "El-Shennawy",
    firstNameAr: "أحمد",
    lastNameAr: "الشناوي",
    email: "ahmed.shennawy@wadi-akhdar.example",
    phone: "01277889900",
    birthDate: "1988-12-30",
    nationalId: "28812301201935",
    gender: "male",
    maritalStatus: "married",
    departmentId: "DEPT-DEMO-4",
    jobTitleId: "JT-DEMO-5",
    managerId: "EMP-DEMO-3",
    hireDate: "2023-06-15",
    workerCategory: "staff",
    employmentType: "full_time",
    overtimeEligibility: "not_eligible",
    standardWorkHours: 8,
    probationEndDate: null,
    priorServiceYears: 6,
    address: address("31 شارع قناة السويس", "المنصورة", "الدقهلية", "35514"),
    emergencyContact: emergencyContact("داليا الشناوي", "زوجة", "01277889911"),
  },
  {
    id: "EMP-DEMO-6",
    deviceBadgeId: "1006",
    firstName: "Mostafa",
    lastName: "Rezk",
    firstNameAr: "مصطفى",
    lastNameAr: "رزق",
    email: "mostafa.rezk@wadi-akhdar.example",
    phone: "01066223344",
    birthDate: "1990-05-14",
    nationalId: "29005141203718",
    gender: "male",
    maritalStatus: "married",
    departmentId: "DEPT-DEMO-5",
    jobTitleId: "JT-DEMO-6",
    managerId: "EMP-DEMO-3",
    hireDate: "2026-02-01",
    workerCategory: "staff",
    employmentType: "full_time",
    overtimeEligibility: "eligible",
    standardWorkHours: 8,
    probationEndDate: "2026-04-30",
    priorServiceYears: 8,
    address: address("17 شارع المشاية", "المنصورة", "الدقهلية", "35519"),
    emergencyContact: emergencyContact("إيمان رزق", "زوجة", "01066223355"),
  },
  {
    id: "EMP-DEMO-7",
    deviceBadgeId: "1007",
    firstName: "Yasmin",
    lastName: "Hegazy",
    firstNameAr: "ياسمين",
    lastNameAr: "حجازي",
    email: "yasmin.hegazy@wadi-akhdar.example",
    phone: "01121334455",
    birthDate: "1999-03-08",
    nationalId: "29903081202259",
    gender: "female",
    maritalStatus: "single",
    departmentId: "DEPT-DEMO-6",
    jobTitleId: "JT-DEMO-8",
    managerId: "EMP-DEMO-3",
    hireDate: "2026-06-01",
    workerCategory: "staff",
    employmentType: "full_time",
    overtimeEligibility: "inherit_department",
    standardWorkHours: 9,
    probationEndDate: "2026-08-31",
    priorServiceYears: 0,
    address: address("6 شارع سعد زغلول", "المنصورة", "الدقهلية", "35513"),
    emergencyContact: emergencyContact("سمير حجازي", "والد", "01121334466"),
  },
  {
    id: "EMP-DEMO-8",
    deviceBadgeId: "1008",
    firstName: "Amr",
    lastName: "El-Deeb",
    firstNameAr: "عمرو",
    lastNameAr: "الديب",
    email: null,
    phone: "01003446677",
    birthDate: "1995-08-25",
    nationalId: "29508251203114",
    gender: "male",
    maritalStatus: "married",
    departmentId: "DEPT-DEMO-5",
    jobTitleId: "JT-DEMO-7",
    managerId: "EMP-DEMO-6",
    hireDate: "2025-11-10",
    workerCategory: "worker",
    employmentType: "part_time",
    overtimeEligibility: "eligible",
    standardWorkHours: 6,
    probationEndDate: null,
    priorServiceYears: 2,
    address: address("44 شارع الترعة", "ميت غمر", "الدقهلية", "35611"),
    emergencyContact: emergencyContact("سعاد الديب", "والدة", "01003446688"),
  },
  {
    id: "EMP-DEMO-9",
    deviceBadgeId: "1009",
    firstName: "Nourhan",
    lastName: "Selim",
    firstNameAr: "نورهان",
    lastNameAr: "سليم",
    email: "nourhan.selim@wadi-akhdar.example",
    phone: "01144556677",
    birthDate: "1996-01-19",
    nationalId: "29601191202832",
    gender: "female",
    maritalStatus: "single",
    departmentId: "DEPT-DEMO-2",
    jobTitleId: "JT-DEMO-3",
    managerId: "EMP-DEMO-1",
    hireDate: "2024-02-01",
    workerCategory: "staff",
    employmentType: "full_time",
    overtimeEligibility: "inherit_department",
    standardWorkHours: 8,
    probationEndDate: null,
    priorServiceYears: 1,
    address: address("2 شارع النيل", "المنصورة", "الدقهلية", "35515"),
    emergencyContact: emergencyContact("هالة سليم", "والدة", "01144556688"),
  },
];

/**
 * ECT-DEMO-2 has already run out (a fixed term that ended 2026-01-14) and
 * ECT-DEMO-3 is its renewal, so the contracts screen has a lapsed row next to
 * a live one and payroll picks the successor by itself. Deduction lines are
 * contractual only — no tax or insurance line is seeded, because the payroll
 * engine computes neither.
 */
const PAYROLL_COMPONENTS = [
  { id: "PC-DEMO-TRANSPORT", code: "ALW-TRANSPORT", nameAr: "بدل انتقال", nameEn: "Transport allowance", kind: "earning", glAccountId: "5121" },
  { id: "PC-DEMO-PHONE", code: "ALW-PHONE", nameAr: "بدل هاتف", nameEn: "Phone allowance", kind: "earning", glAccountId: "5121" },
  { id: "PC-DEMO-HOUSING", code: "ALW-HOUSING", nameAr: "بدل سكن", nameEn: "Housing allowance", kind: "earning", glAccountId: "5121" },
  { id: "PC-DEMO-MEAL", code: "ALW-MEAL", nameAr: "بدل وجبة", nameEn: "Meal allowance", kind: "earning", glAccountId: "5121" },
  { id: "PC-DEMO-NATURE", code: "ALW-NATURE", nameAr: "بدل طبيعة عمل", nameEn: "Work-nature allowance", kind: "earning", glAccountId: "5121" },
  { id: "PC-DEMO-WELFARE", code: "DED-WELFARE", nameAr: "اشتراك صندوق الزمالة", nameEn: "Welfare-fund subscription", kind: "deduction", glAccountId: "2190" },
  { id: "PC-DEMO-EMPLOYER-INS", code: "EMP-INSURANCE", nameAr: "حصة صاحب العمل في التأمينات", nameEn: "Employer social-insurance share", kind: "employer_contribution", glAccountId: "5130" },
];

const CONTRACTS = [
  {
    id: "ECT-DEMO-1",
    employeeId: "EMP-DEMO-1",
    type: "indefinite",
    startDate: "2024-03-01",
    endDate: null,
    monthlySalary: "9000",
    allowances: [
      { id: "ECT-DEMO-1-A1", name: "بدل انتقال", amount: "800", componentId: "PC-DEMO-TRANSPORT" },
      { id: "ECT-DEMO-1-A2", name: "بدل هاتف", amount: "200", componentId: "PC-DEMO-PHONE" },
    ],
    deductions: [{ id: "ECT-DEMO-1-D1", name: "اشتراك صندوق الزمالة", amount: "100", componentId: "PC-DEMO-WELFARE" }],
  },
  {
    id: "ECT-DEMO-2",
    employeeId: "EMP-DEMO-2",
    type: "fixed_term",
    startDate: "2025-01-15",
    endDate: "2026-01-14",
    monthlySalary: "6500",
    allowances: [{ id: "ECT-DEMO-2-A1", name: "بدل انتقال", amount: "500", componentId: "PC-DEMO-TRANSPORT" }],
    deductions: [],
  },
  {
    id: "ECT-DEMO-3",
    employeeId: "EMP-DEMO-2",
    type: "indefinite",
    startDate: "2026-01-15",
    endDate: null,
    monthlySalary: "7800",
    allowances: [{ id: "ECT-DEMO-3-A1", name: "بدل انتقال", amount: "600", componentId: "PC-DEMO-TRANSPORT" }],
    deductions: [],
  },
  {
    id: "ECT-DEMO-4",
    employeeId: "EMP-DEMO-3",
    type: "indefinite",
    startDate: "2023-01-02",
    endDate: null,
    monthlySalary: "18000",
    leaveEntitlement: { annualLeaveDays: 30 },
    allowances: [
      { id: "ECT-DEMO-4-A1", name: "بدل سكن", amount: "2500", componentId: "PC-DEMO-HOUSING" },
      { id: "ECT-DEMO-4-A2", name: "بدل انتقال", amount: "1500", componentId: "PC-DEMO-TRANSPORT" },
    ],
    deductions: [],
  },
  {
    id: "ECT-DEMO-5",
    employeeId: "EMP-DEMO-4",
    type: "indefinite",
    startDate: "2024-09-01",
    endDate: null,
    monthlySalary: "7500",
    allowances: [{ id: "ECT-DEMO-5-A1", name: "بدل انتقال", amount: "600", componentId: "PC-DEMO-TRANSPORT" }],
    deductions: [],
  },
  {
    id: "ECT-DEMO-6",
    employeeId: "EMP-DEMO-5",
    type: "indefinite",
    startDate: "2023-06-15",
    endDate: null,
    monthlySalary: "8200",
    allowances: [
      { id: "ECT-DEMO-6-A1", name: "بدل انتقال", amount: "600", componentId: "PC-DEMO-TRANSPORT" },
      { id: "ECT-DEMO-6-A2", name: "بدل طبيعة عمل", amount: "400", componentId: "PC-DEMO-NATURE" },
    ],
    deductions: [{ id: "ECT-DEMO-6-D1", name: "اشتراك صندوق الزمالة", amount: "100", componentId: "PC-DEMO-WELFARE" }],
  },
  {
    id: "ECT-DEMO-7",
    employeeId: "EMP-DEMO-6",
    type: "fixed_term",
    startDate: "2026-02-01",
    endDate: "2027-01-31",
    monthlySalary: "6800",
    allowances: [{ id: "ECT-DEMO-7-A1", name: "بدل وجبة", amount: "450", componentId: "PC-DEMO-MEAL" }],
    deductions: [],
  },
  {
    id: "ECT-DEMO-8",
    employeeId: "EMP-DEMO-7",
    type: "probationary",
    startDate: "2026-06-01",
    endDate: "2026-08-31",
    monthlySalary: "5600",
    allowances: [{ id: "ECT-DEMO-8-A1", name: "بدل انتقال", amount: "400", componentId: "PC-DEMO-TRANSPORT" }],
    deductions: [],
  },
  {
    id: "ECT-DEMO-9",
    employeeId: "EMP-DEMO-8",
    type: "seasonal",
    payBasis: "hourly",
    payFrequency: "weekly",
    startDate: "2025-11-10",
    endDate: "2026-11-09",
    monthlySalary: "32",
    allowances: [],
    deductions: [],
  },
  {
    id: "ECT-DEMO-10",
    employeeId: "EMP-DEMO-9",
    type: "indefinite",
    startDate: "2024-02-01",
    endDate: null,
    monthlySalary: "6200",
    allowances: [{ id: "ECT-DEMO-10-A1", name: "بدل انتقال", amount: "500", componentId: "PC-DEMO-TRANSPORT" }],
    deductions: [],
  },
];

const HOLIDAYS = [
  { id: "HOL-DEMO-1", date: "2026-01-07", nameEn: "Coptic Christmas", nameAr: "عيد الميلاد المجيد", recurringAnnual: true },
  { id: "HOL-DEMO-2", date: "2026-01-25", nameEn: "Revolution Day & Police Day", nameAr: "عيد الشرطة وثورة 25 يناير", recurringAnnual: true },
  { id: "HOL-DEMO-3", date: "2026-03-20", nameEn: "Eid al-Fitr", nameAr: "عيد الفطر المبارك", recurringAnnual: false },
  { id: "HOL-DEMO-4", date: "2026-03-21", nameEn: "Eid al-Fitr Holiday", nameAr: "ثاني أيام عيد الفطر", recurringAnnual: false },
  { id: "HOL-DEMO-5", date: "2026-04-13", nameEn: "Sham El-Nessim", nameAr: "شم النسيم", recurringAnnual: false },
  { id: "HOL-DEMO-6", date: "2026-04-25", nameEn: "Sinai Liberation Day", nameAr: "عيد تحرير سيناء", recurringAnnual: true },
  { id: "HOL-DEMO-7", date: "2026-05-01", nameEn: "Labour Day", nameAr: "عيد العمال", recurringAnnual: true },
  { id: "HOL-DEMO-8", date: "2026-05-27", nameEn: "Eid al-Adha", nameAr: "عيد الأضحى المبارك", recurringAnnual: false },
  { id: "HOL-DEMO-9", date: "2026-06-16", nameEn: "Islamic New Year", nameAr: "رأس السنة الهجرية", recurringAnnual: false },
  { id: "HOL-DEMO-10", date: "2026-07-23", nameEn: "July 23 Revolution Day", nameAr: "عيد ثورة 23 يوليو", recurringAnnual: true },
  { id: "HOL-DEMO-11", date: "2026-08-25", nameEn: "Prophet's Birthday", nameAr: "المولد النبوي الشريف", recurringAnnual: false },
  { id: "HOL-DEMO-12", date: "2026-10-06", nameEn: "Armed Forces Day", nameAr: "عيد القوات المسلحة", recurringAnnual: true },
];

/** The legal matrix comes from the dated preset; these two are the tenant's own additions (تخصيص يدوي). */
const EXTRA_LEAVE_POLICIES = [
  {
    id: "LP-DEMO-PERSONAL",
    leaveType: "personal",
    entitlementDays: "5",
    accrualFrequency: "annual",
    carryOver: false,
    payoutOnTermination: false,
    legallyMandated: false,
  },
  {
    id: "LP-DEMO-EMERGENCY",
    leaveType: "emergency",
    entitlementDays: "3",
    accrualFrequency: "annual",
    carryOver: false,
    payoutOnTermination: false,
    legallyMandated: false,
  },
];

const ACCRUAL_RUNS = [
  { runDate: "2026-01-01", frequency: "annual", runType: "manual", notes: "استحقاق سنوي — بداية 2026" },
  { runDate: "2026-06-30", frequency: "monthly", runType: "scheduled", notes: null },
  { runDate: "2026-07-31", frequency: "monthly", runType: "scheduled", notes: null },
  { runDate: "2026-08-31", frequency: "monthly", runType: "manual", notes: "تشغيل يدوي بعد إضافة موظفي الإنتاج" },
];

/** Last year's closing position, plus the days each employee carried into 2026 under the preset's carry-over rule. */
const LEAVE_BALANCES = [
  { employeeId: "EMP-DEMO-1", leaveType: "annual", year: 2025, entitled: "21", carriedOver: "0", used: "15" },
  { employeeId: "EMP-DEMO-2", leaveType: "annual", year: 2025, entitled: "21", carriedOver: "0", used: "19" },
  { employeeId: "EMP-DEMO-3", leaveType: "annual", year: 2025, entitled: "30", carriedOver: "4", used: "25" },
  { employeeId: "EMP-DEMO-5", leaveType: "annual", year: 2025, entitled: "21", carriedOver: "0", used: "13" },
  // The accrual run alone credits 5.25 annual days for 2026, which does not
  // cover LR-DEMO-6's eight — and an approval may no longer take a balance
  // negative. These are the year's full entitlements, granted up front.
  { employeeId: "EMP-DEMO-4", leaveType: "annual", year: 2026, entitled: "21", carriedOver: "0" },
  { employeeId: "EMP-DEMO-1", leaveType: "annual", year: 2026, carriedOver: "6" },
  { employeeId: "EMP-DEMO-2", leaveType: "annual", year: 2026, carriedOver: "2" },
  { employeeId: "EMP-DEMO-3", leaveType: "annual", year: 2026, carriedOver: "9" },
  { employeeId: "EMP-DEMO-5", leaveType: "annual", year: 2026, carriedOver: "8" },
];

/**
 * Grouped by employee, admin last: each request is filed through the
 * self-service route, which reads the employee off the CALLING USER, so the
 * seeder re-points the admin's user at each employee in turn and leaves it on
 * محمد الشهابي — whose own three requests are what إجازاتي shows on login.
 */
const LEAVE_REQUESTS = [
  { id: "LR-DEMO-1", employeeId: "EMP-DEMO-1", leaveType: "annual", startDate: "2026-07-06", endDate: "2026-07-09", reason: "سفر عائلي", decision: "approved", comment: "مقبول — تمت تغطية خط السير" },
  { id: "LR-DEMO-2", employeeId: "EMP-DEMO-1", leaveType: "casual", startDate: "2026-08-19", endDate: "2026-08-19", reason: "ظرف عائلي طارئ", decision: null, comment: null },
  { id: "LR-DEMO-3", employeeId: "EMP-DEMO-2", leaveType: "annual", startDate: "2026-08-10", endDate: "2026-08-12", reason: "زفاف شقيقتي", decision: "approved", comment: null },
  { id: "LR-DEMO-4", employeeId: "EMP-DEMO-2", leaveType: "unpaid", startDate: "2026-09-01", endDate: "2026-09-05", reason: "سفر خارج البلاد", decision: "rejected", comment: "الفترة تتزامن مع الجرد السنوي" },
  { id: "LR-DEMO-5", employeeId: "EMP-DEMO-4", leaveType: "sick", startDate: "2026-08-03", endDate: "2026-08-04", reason: "وعكة صحية بتقرير طبي", decision: "approved", comment: null },
  { id: "LR-DEMO-6", employeeId: "EMP-DEMO-4", leaveType: "annual", startDate: "2026-08-20", endDate: "2026-08-27", reason: "إجازة سنوية", decision: "approved", comment: null },
  { id: "LR-DEMO-7", employeeId: "EMP-DEMO-5", leaveType: "personal", halfDay: true, startDate: "2026-08-27", endDate: "2026-08-27", reason: "مصلحة حكومية", decision: null, comment: null },
  { id: "LR-DEMO-8", employeeId: "EMP-DEMO-6", leaveType: "unpaid", startDate: "2026-07-13", endDate: "2026-07-14", reason: "مرافقة والدته للعلاج", decision: "approved", comment: "بدون أجر — يُخصم يومان من راتب يوليو" },
  { id: "LR-DEMO-9", employeeId: "EMP-DEMO-3", leaveType: "emergency", startDate: "2026-06-24", endDate: "2026-06-25", reason: "ظرف عائلي", decision: "approved", comment: null },
  { id: "LR-DEMO-10", employeeId: "EMP-DEMO-3", leaveType: "casual", startDate: "2026-07-15", endDate: "2026-07-15", reason: "أعمال شخصية", decision: null, comment: null, cancel: true },
  { id: "LR-DEMO-11", employeeId: "EMP-DEMO-3", leaveType: "annual", startDate: "2026-09-10", endDate: "2026-09-17", reason: "إجازة سنوية", decision: null, comment: null },
];

const SHIFT_START = "09:00";
const GRACE_MINUTES = 10;
const DEFAULT_CHECK_IN = "08:52";
const DEFAULT_CHECK_OUT = "17:06";

const ATTENDANCE_WINDOWS = [
  { from: "2026-07-20", to: "2026-07-23", employeeIds: ["EMP-DEMO-1", "EMP-DEMO-3", "EMP-DEMO-6"] },
  { from: "2026-08-02", to: "2026-08-13", employeeIds: ["EMP-DEMO-1", "EMP-DEMO-2", "EMP-DEMO-3", "EMP-DEMO-4", "EMP-DEMO-5"] },
];

/**
 * The attendance screen opens on the current month, so the fixed windows
 * above leave it empty on any later day. This window runs from the first of
 * the month the seed runs in (or two weeks back, early in a month) to that
 * day, for the employees still at work. Dates a fixed window already holds
 * are skipped — the route refuses a second entry for the same day.
 */
const ROLLING_ATTENDANCE_EMPLOYEES = ["EMP-DEMO-1", "EMP-DEMO-2", "EMP-DEMO-3", "EMP-DEMO-5", "EMP-DEMO-6"];

// Employees with a login (the admin, linked through the leave requests, and أحمد الشناوي) keep the seed's
// own day unpunched: a complete day hides the clock's punch, so the clock could never be exercised (D337).
const UNPUNCHED_ON_SEED_DAY: ReadonlySet<string> = new Set(["EMP-DEMO-3", "EMP-DEMO-5"]);

/** Nth working day of the rolling window → the day that breaks the shift. */
const ROLLING_ATTENDANCE_EXCEPTIONS: readonly {
  workingDay: number;
  employeeId: string;
  checkIn: string | null;
  checkOut?: string | null;
  notes: string;
}[] = [
  { workingDay: 1, employeeId: "EMP-DEMO-1", checkIn: "09:32", checkOut: "17:18", notes: "تأخير — زحام مروري" },
  { workingDay: 2, employeeId: "EMP-DEMO-5", checkIn: null, notes: "غياب — أُبلغ بالهاتف" },
  { workingDay: 3, employeeId: "EMP-DEMO-6", checkIn: "08:40", checkOut: "19:05", notes: "وردية ممتدة — أمر تشغيل عاجل" },
];

function rollingAttendanceWindow(today: string): { from: string; to: string } {
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const twoWeeksBack = shiftDate(today, -13);
  return { from: firstOfMonth < twoWeeksBack ? firstOfMonth : twoWeeksBack, to: today };
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Days that break the ordinary shift. A null `checkIn` leaves the status to
 * the route, which reads the holiday calendar and the employee's approved
 * leave — so 23 يوليو scores holiday and سلمى's approved days score on_leave
 * without this table asserting either.
 */
const ATTENDANCE_EXCEPTIONS: Record<
  string,
  { checkIn: string | null; checkOut?: string | null; halfDay?: boolean; approvedOvertimeMinutes?: number; notes?: string }
> = {
  "EMP-DEMO-1|2026-07-22": { checkIn: "09:28", checkOut: "17:15", notes: "تأخير — زحام مروري" },
  "EMP-DEMO-1|2026-07-23": { checkIn: null },
  "EMP-DEMO-3|2026-07-23": { checkIn: null },
  "EMP-DEMO-6|2026-07-23": { checkIn: null },
  "EMP-DEMO-6|2026-07-21": { checkIn: "08:40", checkOut: "19:20", approvedOvertimeMinutes: 150, notes: "وردية ممتدة — أمر تشغيل عاجل" },
  "EMP-DEMO-1|2026-08-04": { checkIn: "09:35", checkOut: "17:20", notes: "تأخير — عطل بالسيارة" },
  "EMP-DEMO-1|2026-08-05": { checkIn: null, notes: "غياب بدون إذن" },
  "EMP-DEMO-2|2026-08-10": { checkIn: null },
  "EMP-DEMO-2|2026-08-11": { checkIn: null },
  "EMP-DEMO-2|2026-08-12": { checkIn: null },
  "EMP-DEMO-4|2026-08-03": { checkIn: null },
  "EMP-DEMO-4|2026-08-04": { checkIn: null },
  "EMP-DEMO-4|2026-08-06": { checkIn: "09:00", checkOut: "13:00", halfDay: true, notes: "نصف يوم بإذن" },
  "EMP-DEMO-5|2026-08-11": { checkIn: "09:41", checkOut: "17:12", notes: "تأخير" },
  "EMP-DEMO-5|2026-08-13": { checkIn: null, notes: "غياب — أُبلغ بالهاتف" },
  "EMP-DEMO-3|2026-08-06": { checkIn: "08:15", checkOut: "18:40", approvedOvertimeMinutes: 90, notes: "اجتماع مجلس الإدارة" },
  "EMP-DEMO-6|2026-08-07": { checkIn: "16:00", checkOut: "23:30", approvedOvertimeMinutes: 90, notes: "وردية مسائية" },
};

/**
 * Two live orders and one already settled, so the register has an active row, a
 * closed row, and an employee (EMP-DEMO-1) carrying BOTH a garnishment and an
 * advance — which is the case that proves the court order is taken first.
 */
const GARNISHMENTS = [
  {
    id: "GRN-DEMO-1",
    employeeId: "EMP-DEMO-1",
    kind: "court_order",
    reference: "1842/2026 كلي",
    labelAr: "حجز تنفيذي لصالح بنك القاهرة",
    totalAmount: "9000",
    monthlyAmount: "750",
    startDate: "2026-05-01",
    endDate: null,
    notes: "يُخصم شهرياً حتى السداد الكامل",
  },
  {
    id: "GRN-DEMO-2",
    employeeId: "EMP-DEMO-5",
    kind: "alimony",
    reference: "نفقة 337/2025",
    labelAr: "نفقة زوجية ومصروفات",
    totalAmount: "24000",
    monthlyAmount: "1000",
    startDate: "2026-01-01",
    endDate: null,
    notes: null,
  },
  {
    id: "GRN-DEMO-3",
    employeeId: "EMP-DEMO-7",
    kind: "debt_settlement",
    reference: "تسوية 12/2025",
    labelAr: "تسوية دين مع مورد",
    totalAmount: "3000",
    monthlyAmount: "500",
    startDate: "2025-11-01",
    endDate: "2026-04-30",
    notes: "انتهت مدته — رُفع الحجز",
    release: true,
  },
];

const ADVANCES = [
  { id: "ADV-DEMO-1", employeeId: "EMP-DEMO-1", amount: "6000", installmentCount: 6, firstDeductionDate: "2026-06-01", reason: "مصاريف علاج", flow: "disbursed", disburseDate: "2026-05-28" },
  { id: "ADV-DEMO-2", employeeId: "EMP-DEMO-5", amount: "4000", installmentCount: 4, firstDeductionDate: "2026-08-01", reason: "مصاريف دراسية", flow: "disbursed", disburseDate: "2026-07-30" },
  { id: "ADV-DEMO-3", employeeId: "EMP-DEMO-2", amount: "2400", installmentCount: 2, firstDeductionDate: "2026-09-01", reason: "أثاث منزلي", flow: "approved", disburseDate: null },
  { id: "ADV-DEMO-4", employeeId: "EMP-DEMO-4", amount: "3000", installmentCount: 3, firstDeductionDate: "2026-09-01", reason: "مصاريف مدارس", flow: "pending", disburseDate: null },
  { id: "ADV-DEMO-5", employeeId: "EMP-DEMO-6", amount: "10000", installmentCount: 10, firstDeductionDate: "2026-09-01", reason: "شراء دراجة بخارية", flow: "rejected", disburseDate: null },
];

const PAYROLL_RUNS = [
  { id: "PR-DEMO-2026-01", year: 2026, month: 1, stage: "disbursed", disburseDate: "2026-01-31" },
  { id: "PR-DEMO-2026-02", year: 2026, month: 2, stage: "disbursed", disburseDate: "2026-02-28" },
  { id: "PR-DEMO-2026-03", year: 2026, month: 3, stage: "disbursed", disburseDate: "2026-03-31" },
  { id: "PR-DEMO-2026-04", year: 2026, month: 4, stage: "disbursed", disburseDate: "2026-04-30" },
  { id: "PR-DEMO-2026-05", year: 2026, month: 5, stage: "disbursed", disburseDate: "2026-05-31" },
  { id: "PR-DEMO-1", year: 2026, month: 6, stage: "disbursed", disburseDate: "2026-06-30" },
  { id: "PR-DEMO-2", year: 2026, month: 7, stage: "approved", disburseDate: null },
  { id: "PR-DEMO-3", year: 2026, month: 8, stage: "calculated", disburseDate: null },
];

interface AdminUser {
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly roleId: string | null;
  readonly isCompanyAdmin: boolean;
  readonly branchScope: string | string[];
  readonly warehouseScope: string | string[];
  readonly status: string;
}

interface TreasuryAccountRow {
  readonly id: string;
  readonly type: string;
}

/**
 * Same transport as `step`, under a different signed-in user. The self-service
 * leave routes derive the employee from the CALLER, never from the payload, so
 * seeding one employee's own request means being that employee's user.
 */
async function stepAs(app: App, userId: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await app.fetch(
    new Request(`http://demo-seed${path}`, {
      method,
      headers: seedActorHeaders(userId, ["*"]),
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  if (!res.ok) {
    throw new Error(`[demo-seed] ${method} ${path} as ${userId} failed with ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? undefined : await res.json();
}

async function linkSelfServiceUser(app: App, employeeId: string): Promise<void> {
  const user = (await step(app, "GET", `/users/${SELF_SERVICE_USER}`)) as AdminUser;
  await step(app, "PUT", `/users/${SELF_SERVICE_USER}`, {
    nameAr: user.nameAr,
    nameEn: user.nameEn,
    email: user.email,
    phone: user.phone,
    roleId: user.roleId,
    isCompanyAdmin: user.isCompanyAdmin,
    employeeId,
    branchScope: user.branchScope,
    warehouseScope: user.warehouseScope,
    status: user.status,
  });
}

/**
 * Bank, not cash: the treasury voucher engine refuses to take a cash drawer
 * below its posted balance, and no demo drawer holds a month of salaries.
 */
async function bankTreasuryAccountId(app: App): Promise<string> {
  const accounts = (await step(app, "GET", "/treasury-accounts")) as TreasuryAccountRow[];
  const bank = accounts.find((a) => a.type === "bank");
  if (!bank) throw new Error("[demo-seed] hr: no bank treasury account to disburse payroll and advances from.");
  return bank.id;
}

function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= to) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/** Friday and Saturday — nobody clocks in, and the route scores the day إجازة أسبوعية. */
function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 5 || day === 6;
}

export async function seedHr(app: App): Promise<void> {
  for (const department of DEPARTMENTS) {
    await step(app, "POST", "/hr/departments", department);
  }
  for (const jobTitle of JOB_TITLES) {
    await step(app, "POST", "/hr/job-titles", jobTitle);
  }

  // Contract lines bind to these by id, so the registry has to exist first.
  for (const component of PAYROLL_COMPONENTS) {
    await step(app, "POST", "/hr/payroll/components", component);
  }

  for (const employee of EMPLOYEES) {
    await step(app, "POST", "/hr/employees", { ...employee, branchId: BRANCH_ID });
  }
  for (const { id, patch } of CORE_EMPLOYEE_PATCHES) {
    await step(app, "PUT", `/hr/employees/${id}`, patch);
  }

  // Departments carry their manager, so the heads must exist as employees first.
  for (const { departmentId, managerId } of DEPARTMENT_MANAGERS) {
    await step(app, "PUT", `/hr/departments/${departmentId}`, { managerId });
  }

  for (const contract of CONTRACTS) {
    await step(app, "POST", "/hr/contracts", { ...contract, currency: "EGP" });
  }
  await step(app, "POST", "/hr/contracts/ECT-DEMO-10/terminate", {});
  await step(app, "POST", "/hr/employees/EMP-DEMO-9/terminate", { effectiveDate: "2026-05-31" });
  await step(app, "POST", "/hr/employees/EMP-DEMO-8/transition", { status: "suspended" });

  for (const holiday of HOLIDAYS) {
    await step(app, "POST", "/hr/holidays", holiday);
  }

  await step(app, "POST", "/hr/leave-policies/apply-preset", { presetCode: "EG_LABOUR_LAW_14_2025" });
  for (const policy of EXTRA_LEAVE_POLICIES) {
    await step(app, "POST", "/hr/leave-policies", policy);
  }

  // Accrual credits every non-terminated employee against the live policy
  // matrix, so both must be in place before a batch runs.
  for (const run of ACCRUAL_RUNS) {
    await step(app, "POST", "/hr/leave-accrual-batches/run", run);
  }
  for (const balance of LEAVE_BALANCES) {
    await step(app, "POST", "/hr/leave-balances", balance);
  }

  let linkedEmployeeId: string | null = null;
  for (const request of LEAVE_REQUESTS) {
    if (linkedEmployeeId !== request.employeeId) {
      await linkSelfServiceUser(app, request.employeeId);
      linkedEmployeeId = request.employeeId;
    }
    await stepAs(app, SELF_SERVICE_USER, "POST", "/hr/leave-requests", {
      id: request.id,
      leaveType: request.leaveType,
      halfDay: request.halfDay ?? false,
      startDate: request.startDate,
      endDate: request.endDate,
      reason: request.reason,
    });
    if (request.decision) {
      const action = request.decision === "approved" ? "approve" : "reject";
      await step(app, "POST", `/hr/leave-requests/${request.id}/${action}`, { comment: request.comment });
    } else if (request.cancel) {
      await stepAs(app, SELF_SERVICE_USER, "POST", `/hr/leave-requests/${request.id}/cancel`, {});
    }
  }
  await step(app, "POST", "/hr/employees/EMP-DEMO-4/transition", { status: "on_leave" });

  // Attendance reads the approved leave above to score إجازة, so it runs after it.
  for (const window of ATTENDANCE_WINDOWS) {
    for (const date of eachDate(window.from, window.to)) {
      for (const employeeId of window.employeeIds) {
        const exception = ATTENDANCE_EXCEPTIONS[`${employeeId}|${date}`];
        const offDay = isWeekend(date);
        await step(app, "POST", "/hr/attendance", {
          id: `ATT-${employeeId.replace("EMP-DEMO-", "")}-${date}`,
          employeeId,
          date,
          checkIn: exception ? exception.checkIn : offDay ? null : DEFAULT_CHECK_IN,
          checkOut: exception ? (exception.checkOut ?? null) : offDay ? null : DEFAULT_CHECK_OUT,
          halfDay: exception?.halfDay ?? false,
          notes: exception?.notes ?? null,
          approvedOvertimeMinutes: exception?.approvedOvertimeMinutes ?? null,
          expectedCheckIn: SHIFT_START,
          graceMinutes: GRACE_MINUTES,
        });
      }
    }
  }

  const fixedDays = new Set(
    ATTENDANCE_WINDOWS.flatMap((w) => eachDate(w.from, w.to).flatMap((date) => w.employeeIds.map((id) => `${id}|${date}`))),
  );
  const seedDay = seedToday();
  const rolling = rollingAttendanceWindow(seedDay);
  const rollingDates = eachDate(rolling.from, rolling.to);
  const isHoliday = (date: string) =>
    HOLIDAYS.some((h) => h.date === date || (h.recurringAnnual && h.date.slice(5) === date.slice(5)));
  const workingDates = rollingDates.filter((date) => !isWeekend(date) && !isHoliday(date));
  for (const date of rollingDates) {
    for (const employeeId of ROLLING_ATTENDANCE_EMPLOYEES) {
      if (fixedDays.has(`${employeeId}|${date}`)) continue;
      if (date === seedDay && UNPUNCHED_ON_SEED_DAY.has(employeeId)) continue;
      const exception = ROLLING_ATTENDANCE_EXCEPTIONS.find(
        (e) => e.employeeId === employeeId && workingDates[e.workingDay] === date,
      );
      const offDay = isWeekend(date) || isHoliday(date);
      await step(app, "POST", "/hr/attendance", {
        id: `ATT-${employeeId.replace("EMP-DEMO-", "")}-${date}`,
        employeeId,
        date,
        checkIn: exception ? exception.checkIn : offDay ? null : DEFAULT_CHECK_IN,
        checkOut: exception ? (exception.checkOut ?? null) : offDay ? null : DEFAULT_CHECK_OUT,
        halfDay: false,
        notes: exception?.notes ?? null,
        expectedCheckIn: SHIFT_START,
        graceMinutes: GRACE_MINUTES,
      });
    }
  }

  // Garnishments are seeded before the payroll runs, so the runs actually
  // withhold against them and count each order down.
  for (const order of GARNISHMENTS) {
    await step(app, "POST", "/hr/payroll/garnishments", {
      id: order.id,
      employeeId: order.employeeId,
      kind: order.kind,
      reference: order.reference,
      labelAr: order.labelAr,
      totalAmount: order.totalAmount,
      monthlyAmount: order.monthlyAmount,
      currency: "EGP",
      startDate: order.startDate,
      endDate: order.endDate,
      notes: order.notes,
    });
    if (order.release) await step(app, "POST", `/hr/payroll/garnishments/${order.id}/release`, {});
  }

  const treasuryAccountId = await bankTreasuryAccountId(app);

  for (const advance of ADVANCES) {
    await step(app, "POST", "/hr/advances", {
      id: advance.id,
      employeeId: advance.employeeId,
      amount: advance.amount,
      currency: "EGP",
      installmentCount: advance.installmentCount,
      firstDeductionDate: advance.firstDeductionDate,
      reason: advance.reason,
    });
    if (advance.flow === "rejected") {
      await step(app, "POST", `/hr/advances/${advance.id}/reject`, {});
      continue;
    }
    if (advance.flow === "pending") continue;
    await step(app, "POST", `/hr/advances/${advance.id}/approve`, {});
    if (advance.flow === "disbursed") {
      await step(app, "POST", `/hr/advances/${advance.id}/disburse`, {
        treasuryAccountId,
        branchId: BRANCH_ID,
        date: advance.disburseDate,
        paymentMethod: "bank",
      });
    }
  }

  // Payroll recovers the instalments of advances that have actually been paid
  // out, so every advance above is settled before the first run is calculated.
  for (const run of PAYROLL_RUNS) {
    await step(app, "POST", "/hr/payroll/runs", { id: run.id, year: run.year, month: run.month, branchId: BRANCH_ID, currency: "EGP" });
    await step(app, "POST", `/hr/payroll/runs/${run.id}/calculate`, {});
    if (run.stage === "calculated") continue;
    await step(app, "POST", `/hr/payroll/runs/${run.id}/approve`, {});
    if (run.stage === "disbursed") {
      await step(app, "POST", `/hr/payroll/runs/${run.id}/disburse`, {
        treasuryAccountId,
        branchId: BRANCH_ID,
        date: run.disburseDate,
        paymentMethod: "bank",
      });
    }
  }

  // «سداد نقدي» outside payroll, AFTER the runs: August's محتسب run already
  // recovers one instalment of ADV-DEMO-1, and the route refuses to repay into it.
  await step(app, "POST", "/hr/advances/ADV-DEMO-1/repay", {
    repaymentId: "RPY-DEMO-1",
    amount: "1500",
    treasuryAccountId,
    branchId: BRANCH_ID,
    date: seedToday(),
    paymentMethod: "bank",
    note: "سداد جزئي مبكر بتحويل بنكي",
  });
}
