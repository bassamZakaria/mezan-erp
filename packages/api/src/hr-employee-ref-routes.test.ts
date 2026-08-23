import { describe, it, expect, afterEach } from "vitest";
import { createSqliteEmployeeRefRepository } from "@mezan/persistence";
import { createHrEmployeeRefRoutes } from "./hr-employee-ref-routes.js";

const closers: { close(): void }[] = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

async function newApp() {
  const employees = createSqliteEmployeeRefRepository();
  closers.push(employees);
  await employees.upsert({ id: "emp-1", code: "EMP-0001", nameAr: "أحمد محمود", departmentId: "dept-1", active: true });
  return { app: createHrEmployeeRefRoutes(employees), employees };
}

describe("hr employee-ref router", () => {
  it("rejects with no permission", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
  });

  it("lists active employees with the permission", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/", { permissions: "hr.employee.view" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string }[];
    expect(body).toHaveLength(1);
    expect(body[0]!.id).toBe("emp-1");
  });

  it("finds by id, 404s for unknown id", async () => {
    const { app } = await newApp();
    const found = await app.fetch(req("/emp-1", { permissions: "hr.employee.view" }));
    expect(found.status).toBe(200);
    const missing = await app.fetch(req("/nope", { permissions: "hr.employee.view" }));
    expect(missing.status).toBe(404);
  });
});
