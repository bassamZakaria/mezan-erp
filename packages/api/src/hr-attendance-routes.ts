import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  DEFAULT_SETTINGS,
  InvalidAttendanceRecordError,
  getMonthlyGrid,
  getMonthlySummary,
  markAttendance,
  type AttendanceRecordRepository,
  type EmployeeDirectory,
  type SettingsRepository,
} from "@mezan/domain";
import { markAttendanceSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

export interface HrAttendanceRoutesDeps {
  readonly records: AttendanceRecordRepository;
  readonly employees: EmployeeDirectory;
  readonly settings: SettingsRepository;
  readonly idGen?: () => string;
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof InvalidAttendanceRecordError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

async function resolveWeekendDays(settings: SettingsRepository): Promise<readonly number[]> {
  const current = await settings.get();
  return current?.weekendDays ?? DEFAULT_SETTINGS.weekendDays;
}

/**
 * Attendance routes (docs/catalog/06 §"الحضور والانصراف"), mounted under
 * `/hr/attendance`. The monthly grid is computed on read (explicit records +
 * derived weekly-off from `TenantSettings.weekendDays`) — nothing is
 * pre-materialized.
 */
export function createHrAttendanceRoutes(
  deps: HrAttendanceRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? randomUUID;

  app.get("/grid", gate("hr.attendance.view"), async (c) => {
    const year = Number(c.req.query("year"));
    const month = Number(c.req.query("month"));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return c.json({ error: "VALIDATION_ERROR", message: "year/month query params are required" }, 400);
    }

    const employeeIdsParam = c.req.query("employeeIds");
    const departmentId = c.req.query("departmentId");
    let employeeIds: string[];
    if (employeeIdsParam) {
      employeeIds = employeeIdsParam.split(",").filter(Boolean);
    } else {
      const active = await deps.employees.listActive();
      employeeIds = (departmentId ? active.filter((e) => e.departmentId === departmentId) : active).map((e) => e.id);
    }

    const weekendDays = await resolveWeekendDays(deps.settings);
    const grid = await getMonthlyGrid(employeeIds, year, month, weekendDays, { records: deps.records });
    return c.json(grid);
  });

  app.get("/summary", gate("hr.attendance.view"), async (c) => {
    const employeeId = c.req.query("employeeId");
    const year = Number(c.req.query("year"));
    const month = Number(c.req.query("month"));
    if (!employeeId || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return c.json({ error: "VALIDATION_ERROR", message: "employeeId/year/month query params are required" }, 400);
    }
    const weekendDays = await resolveWeekendDays(deps.settings);
    const summary = await getMonthlySummary(employeeId, year, month, weekendDays, { records: deps.records });
    return c.json(summary);
  });

  app.post("/", gate("hr.attendance.edit"), async (c) => {
    const parsed = markAttendanceSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const record = await markAttendance(
        {
          id: idGen(),
          employeeId: parsed.data.employeeId,
          date: parsed.data.date,
          status: parsed.data.status,
          overtimeHours: parsed.data.overtimeHours,
          notes: parsed.data.notes,
        },
        { records: deps.records },
      );
      return c.json(record, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
