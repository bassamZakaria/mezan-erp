import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededWorld, type SeededWorld } from "./test-support.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

const employee = (id: string) => world.sqlite.prepare(`SELECT status, terminated_at AS terminatedAt FROM hr_employee WHERE id = ?`).get(id) as { status: string; terminatedAt: string | null };

describe("ending service inside a month whose payroll is already approved", () => {
  it("the seed pays EMP-DEMO-1 for June (disbursed) and July (approved), and August is only calculated", () => {
    const runs = world.sqlite
      .prepare(`SELECT r.month, r.status FROM hr_payslip p JOIN hr_payroll_run r ON r.id = p.run_id WHERE p.employee_id = 'EMP-DEMO-1' ORDER BY r.month`)
      .all();
    expect(runs).toEqual([
      { month: 6, status: "disbursed" },
      { month: 7, status: "approved" },
      { month: 8, status: "calculated" },
    ]);
  });

  it.each(["2026-06-12", "2026-07-30"])("an effective date of %s is refused, naming the last month paid in full and the way forward", async (effectiveDate) => {
    const refused = await world.request("POST", "/hr/employees/EMP-DEMO-1/terminate", { effectiveDate });

    expect(refused.status).toBe(422);
    expect(refused.body).toEqual({
      error: "TERMINATION_BEFORE_PAID_PAYROLL",
      message: `لا يمكن إنهاء الخدمة بتاريخ ${effectiveDate}: راتب «يوليو 2026» اعتُمد للموظف عن الشهر كاملاً حتى 2026-07-31. اجعل تاريخ إنهاء الخدمة 2026-07-31 أو بعده، واخصم أجر الأيام التي لم يعملها في تسوية مستحقات نهاية الخدمة.`,
      messageEn: `Service cannot end on ${effectiveDate}: the July 2026 payroll was approved for this employee for the whole month, to 2026-07-31. End the service on 2026-07-31 or later and recover the unworked days in the end-of-service settlement.`,
    });
    expect(employee("EMP-DEMO-1")).toEqual({ status: "active", terminatedAt: null });
  });

  it("the last day of the last approved month is accepted; a month that is only calculated does not hold the date back", async () => {
    const onPeriodEnd = await world.request("POST", "/hr/employees/EMP-DEMO-1/terminate", { effectiveDate: "2026-07-31" });
    expect(`${onPeriodEnd.status} ${onPeriodEnd.body.terminatedAt}`).toBe("200 2026-07-31");

    const insideCalculated = await world.request("POST", "/hr/employees/EMP-DEMO-2/terminate", { effectiveDate: "2026-08-10" });
    expect(`${insideCalculated.status} ${insideCalculated.body.terminatedAt}`).toBe("200 2026-08-10");
  });
});
