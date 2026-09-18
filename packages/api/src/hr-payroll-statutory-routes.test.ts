import { afterEach, describe, expect, it } from "vitest";
import {
  createSqliteContractRepository,
  createSqliteEmployeeAdvanceRepository,
  createSqliteEmployeeRepository,
  createSqliteLedgerStore,
  createSqlitePayrollRunRepository,
  createSqlitePayrollStatutoryFlagRepository,
  createSqlitePayslipRepository,
  createSqliteStatutoryOverrideRepository,
} from "@mezan/persistence";
import { PAYROLL_GL_ACCOUNTS, type AuditEvent, type AuditSink } from "@mezan/domain";
import { createHrPayrollRoutes } from "./hr-payroll-routes.js";
import { insecureHeaderAuthContextResolver } from "./permission-gate.js";

const handles: { close(): void }[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const employees = createSqliteEmployeeRepository();
  const contracts = createSqliteContractRepository();
  const advances = createSqliteEmployeeAdvanceRepository();
  const runs = createSqlitePayrollRunRepository();
  const payslips = createSqlitePayslipRepository();
  const ledger = createSqliteLedgerStore();
  const statutoryFlag = createSqlitePayrollStatutoryFlagRepository();
  const statutoryOverrides = createSqliteStatutoryOverrideRepository();
  handles.push(employees, contracts, advances, runs, payslips, ledger, statutoryFlag, statutoryOverrides);
  const events: AuditEvent[] = [];
  const audit: AuditSink = {
    async append(event) {
      events.push(event);
    },
    async query() {
      return events;
    },
  };
  const app = createHrPayrollRoutes(
    {
      advances,
      runs,
      payslips,
      employees,
      contracts,
      gl: { ledger, accounts: { findById: async () => null }, periods: { findByDate: async () => null } } as never,
      accounts: PAYROLL_GL_ACCOUNTS,
      numbering: { next: async (code: string) => ({ formatted: `${code}-1` }) },
      statutoryFlag,
      statutoryOverrides,
      audit,
    },
    insecureHeaderAuthContextResolver,
  );
  return { app, events, statutoryFlag };
}

function req(path: string, permissions: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", permissions);
  headers.set("x-user-id", "user-1");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

describe("hr.payroll.statutory — the switch", () => {
  it("is OFF by default, and lists every unverified row a switch-on would compute from", async () => {
    const { app } = newApp();
    const res = await app.request(req("/payroll/statutory-flag", "hr.payroll.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; unverifiedTableCodes: string[] };
    expect(body.enabled).toBe(false);
    expect(body.unverifiedTableCodes).toContain("EG_SALARY_TAX_2024");
  });

  it("refuses anyone but a tenant admin, even one holding every payroll permission", async () => {
    const { app, statutoryFlag } = newApp();
    const res = await app.request(
      req("/payroll/statutory-flag", "hr.payroll.view,hr.payroll.create,hr.payroll.approve,hr.payroll.calculate", {
        method: "PUT",
        body: JSON.stringify({ enabled: true, acknowledged: true }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await statutoryFlag.get()).enabled).toBe(false);
  });

  it("refuses an admin who has not acknowledged the unverified figures", async () => {
    const { app, statutoryFlag, events } = newApp();
    const res = await app.request(req("/payroll/statutory-flag", "*", { method: "PUT", body: JSON.stringify({ enabled: true }) }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("ACKNOWLEDGEMENT_REQUIRED");
    expect((await statutoryFlag.get()).enabled).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("an acknowledged admin switches it on, and the act is audit-logged as CRITICAL with who did it", async () => {
    const { app, statutoryFlag, events } = newApp();
    const res = await app.request(
      req("/payroll/statutory-flag", "*", { method: "PUT", body: JSON.stringify({ enabled: true, acknowledged: true }) }),
    );
    expect(res.status).toBe(200);
    const flag = await statutoryFlag.get();
    expect(flag.enabled).toBe(true);
    expect(flag.changedBy).toBe("user-1");
    expect(flag.acknowledged).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe("enable");
    expect(events[0]!.severity).toBe("CRITICAL");
    expect(events[0]!.actor).toBe("user-1");
  });

  it("switching it off is audit-logged too", async () => {
    const { app, events } = newApp();
    await app.request(req("/payroll/statutory-flag", "*", { method: "PUT", body: JSON.stringify({ enabled: true, acknowledged: true }) }));
    const res = await app.request(req("/payroll/statutory-flag", "*", { method: "PUT", body: JSON.stringify({ enabled: false }) }));
    expect(res.status).toBe(200);
    expect(events.map((e) => e.action)).toEqual(["enable", "disable"]);
  });
});

describe("the admin-entered insurance year", () => {
  it("is audit-logged with the before and after", async () => {
    const { app, events } = newApp();
    const res = await app.request(
      req("/payroll/statutory-tables/insurance-years/2027", "hr.payroll.create", {
        method: "PUT",
        body: JSON.stringify({ monthlyWageFloor: "3100", monthlyWageCeiling: "19200", note: null }),
      }),
    );
    expect(res.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]!.entityId).toBe("2027");
  });

  it("serves the row with its shares taken from the 2027 schedule and marked unverified", async () => {
    const { app } = newApp();
    await app.request(
      req("/payroll/statutory-tables/insurance-years/2027", "hr.payroll.create", {
        method: "PUT",
        body: JSON.stringify({ monthlyWageFloor: "3100", monthlyWageCeiling: "19200" }),
      }),
    );
    const tables = (await (await app.request(req("/payroll/statutory-tables", "hr.payroll.view"))).json()) as {
      socialInsurance: { code: string; verified: boolean; employeeTotalPercent: string; source: string }[];
    };
    const row = tables.socialInsurance.find((r) => r.code === "EG_SOCIAL_INSURANCE_2027_OVERRIDE")!;
    expect(row.verified).toBe(false);
    expect(row.employeeTotalPercent).toBe("11.5");
    expect(row.source).toContain("Art. 19");
  });
});
