import { Hono } from "hono";
import type { EmployeeDirectory, EmployeeRef } from "@mezan/domain";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

function serialize(ref: EmployeeRef) {
  return { id: ref.id, code: ref.code, nameAr: ref.nameAr, departmentId: ref.departmentId, active: ref.active };
}

/**
 * A read-only employee-picker source for the hr-time-leave screens
 * (Attendance/Leave Requests/Leave Accrual need to pick an employee), mounted
 * under `/hr/employees-ref`. Deliberately NOT `/hr/employees` — that route
 * belongs to `hr/master-data`'s full Employee CRUD API once it lands; this
 * is the narrow `EmployeeDirectory` port's own HTTP surface.
 */
export function createHrEmployeeRefRoutes(
  employees: EmployeeDirectory,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("hr.employee.view"), async (c) => {
    const departmentId = c.req.query("departmentId");
    const activeOnly = c.req.query("activeOnly") !== "false";
    const list = await employees.list({ departmentId: departmentId ?? undefined, activeOnly });
    return c.json(list.map(serialize));
  });

  app.get("/:id", gate("hr.employee.view"), async (c) => {
    const ref = await employees.findById(c.req.param("id"));
    if (!ref) return c.json({ error: "EMPLOYEE_NOT_FOUND" }, 404);
    return c.json(serialize(ref));
  });

  return app;
}
