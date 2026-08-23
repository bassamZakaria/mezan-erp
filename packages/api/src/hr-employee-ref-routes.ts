import { Hono } from "hono";
import type { EmployeeDirectory, EmployeeRef } from "@mezan/domain";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/** Adapts the full `EmployeeRef` (hr/master-data's canonical shape) down to the narrow picker fields hr-time-leave's screens actually use. */
function serialize(ref: EmployeeRef) {
  return {
    id: ref.id,
    code: ref.code,
    nameAr: ref.fullNameAr,
    departmentId: ref.departmentId,
    active: ref.status === "active",
  };
}

/**
 * A read-only employee-picker source for the hr-time-leave screens
 * (Attendance/Leave Requests/Leave Accrual need to pick an employee), mounted
 * under `/hr/employees-ref`. Deliberately NOT `/hr/employees` — that route
 * belongs to `hr/master-data`'s full Employee CRUD API; this is the narrow
 * `EmployeeDirectory` port's own HTTP surface, backed by the SAME underlying
 * employee data (`createEmployeeDirectory(employeeRepo)` at the composition
 * root), just serialized down to a picker-friendly shape.
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
    const list = await (activeOnly ? employees.listActive() : employees.list());
    const filtered = departmentId ? list.filter((e) => e.departmentId === departmentId) : list;
    return c.json(filtered.map(serialize));
  });

  app.get("/:id", gate("hr.employee.view"), async (c) => {
    const ref = await employees.findById(c.req.param("id"));
    if (!ref) return c.json({ error: "EMPLOYEE_NOT_FOUND" }, 404);
    return c.json(serialize(ref));
  });

  return app;
}
