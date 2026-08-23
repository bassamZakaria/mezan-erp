import { describe, it, expect, afterEach } from "vitest";
import { createDefaultSettings } from "@mezan/domain";
import { createSqliteAttendanceRecordRepository, createSqliteEmployeeRefRepository, createSqliteSettingsStore } from "@mezan/persistence";
import { createHrAttendanceRoutes } from "./hr-attendance-routes.js";

const closers: { close(): void }[] = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function newApp() {
  const records = createSqliteAttendanceRecordRepository();
  const employees = createSqliteEmployeeRefRepository();
  const settings = createSqliteSettingsStore();
  closers.push(records, employees, settings);
  await employees.upsert({ id: "emp-1", code: "EMP-0001", nameAr: "أحمد", departmentId: null, active: true });
  await settings.save(createDefaultSettings());
  let seq = 0;
  return { app: createHrAttendanceRoutes({ records, employees, settings, idGen: () => `rec-${++seq}` }), records };
}

describe("hr attendance router", () => {
  it("rejects grid/mark with no permission", async () => {
    const { app } = await newApp();
    expect((await app.fetch(req("/grid?year=2026&month=8"))).status).toBe(403);
    expect((await app.fetch(req("/", { method: "POST", body: "{}" }))).status).toBe(403);
  });

  it("marks a day then reflects it in the grid and summary", async () => {
    const { app } = await newApp();
    const mark = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "hr.attendance.edit",
        body: JSON.stringify({ employeeId: "emp-1", date: "2026-08-20", status: "ABSENT" }),
      }),
    );
    expect(mark.status).toBe(201);

    const grid = await app.fetch(req("/grid?year=2026&month=8", { permissions: "hr.attendance.view" }));
    expect(grid.status).toBe(200);
    const gridBody = (await grid.json()) as { employeeId: string; days: { date: string; status: string | null }[] }[];
    const day = gridBody[0]!.days.find((d) => d.date === "2026-08-20");
    expect(day?.status).toBe("ABSENT");

    const summary = await app.fetch(
      req("/summary?employeeId=emp-1&year=2026&month=8", { permissions: "hr.attendance.view" }),
    );
    expect(summary.status).toBe(200);
    const summaryBody = (await summary.json()) as { absentDays: number };
    expect(summaryBody.absentDays).toBe(1);
  });

  it("400s the grid endpoint without year/month", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/grid", { permissions: "hr.attendance.view" }));
    expect(res.status).toBe(400);
  });
});
