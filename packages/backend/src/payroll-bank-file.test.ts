import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Money } from "@mezan/domain";
import { bootBackendKit, type BackendKit } from "./test-helpers/backend-kit.js";

interface RunRow {
  readonly id: string;
  readonly number: string;
  readonly status: string;
  readonly totalNet: string;
}

let kit: BackendKit;
let payable: RunRow;

beforeAll(async () => {
  kit = await bootBackendKit();
  const runs = (await kit.call("GET", "/hr/payroll/runs")).body as RunRow[];
  const found = runs.find((r) => r.status === "approved" || r.status === "disbursed");
  if (!found) throw new Error("the demo seed has no approved or disbursed payroll run");
  payable = found;
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe("payroll bank file on the seeded tenant", () => {
  it("previews transfer lines and exceptions that add up to the run's net, never the full IBAN", async () => {
    const reply = await kit.call("GET", `/hr/payroll/runs/${payable.id}/bank-file/preview?format=generic_csv&valueDate=2026-09-30`);
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    const body = reply.body as { lines: { ibanMasked: string }[]; exceptions: { reason: string }[]; totals: { runNet: string; bankTotal: string; exceptionsTotal: string } };
    expect(body.lines.length).toBeGreaterThan(0);
    expect(body.lines.every((l) => l.ibanMasked.includes("•"))).toBe(true);
    expect(Money.fromMajor(body.totals.bankTotal).add(Money.fromMajor(body.totals.exceptionsTotal)).equals(Money.fromMajor(payable.totalNet))).toBe(true);
  });

  it("exports the file, records who exported it, and refuses a caller without the permission", async () => {
    const exported = await kit.call("POST", `/hr/payroll/runs/${payable.id}/bank-file`, { format: "egypt_bulk_transfer", valueDate: "2026-09-30" });
    expect(exported.status, JSON.stringify(exported.body)).toBe(200);
    const file = exported.body as { content: string; sha256: string; totals: { lineCount: number } };
    expect(file.content.split("\r\n").filter(Boolean)).toHaveLength(file.totals.lineCount + 1);
    expect(file.content).toContain(",SALA,");
    expect(await kit.auditRows("PAYROLL_RUN", payable.id, "BANK_FILE_EXPORTED")).toHaveLength(1);

    const refused = await kit.call("POST", `/hr/payroll/runs/${payable.id}/bank-file`, { format: "generic_csv" }, ["hr.payroll.view", "hr.payroll.pay"]);
    expect(refused.status).toBe(403);
  });

  it("refuses an invalid IBAN in Arabic and keeps the IBAN out of a reader without view_salary", async () => {
    const bad = await kit.call("PUT", "/hr/employees/EMP-DEMO-10/salary-payment", { method: "bank_transfer", iban: "EG000003010100000000123456701" });
    expect(bad.status).toBe(422);
    expect((bad.body as { message: string }).message).toContain("الآيبان");

    const limited = await kit.call("GET", "/hr/employees/EMP-DEMO-1", undefined, ["hr.employee.view"]);
    const account = (limited.body as { bankAccount: { iban?: string; ibanMasked: string } }).bankAccount;
    expect(account.iban).toBeUndefined();
    expect(account.ibanMasked).toMatch(/^EG•+6701$/);

    const blocked = await kit.call("PUT", "/hr/employees/EMP-DEMO-1/salary-payment", { method: "cash" }, ["hr.employee.view", "hr.employee.edit"]);
    expect(blocked.status).toBe(403);
  });
});
