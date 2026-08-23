import { describe, it, expect, afterEach } from "vitest";
import { markAttendance } from "@mezan/domain";
import { createSqliteAttendanceRecordRepository } from "./hr-attendance-store.js";

const handles: { close(): void }[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

describe("SqliteAttendanceRecordRepository", () => {
  it("round-trips a marked record", async () => {
    const records = createSqliteAttendanceRecordRepository();
    handles.push(records);

    const record = await markAttendance(
      { id: "r1", employeeId: "emp-1", date: "2026-08-20", status: "ABSENT", overtimeHours: 1.5, notes: "بدون إذن" },
      { records },
    );

    const found = await records.findByEmployeeAndDate("emp-1", "2026-08-20");
    expect(found).toEqual(record);
  });

  it("re-marking the same employee/date upserts in place (no duplicate rows)", async () => {
    const records = createSqliteAttendanceRecordRepository();
    handles.push(records);
    await markAttendance({ id: "r1", employeeId: "emp-1", date: "2026-08-20", status: "ABSENT" }, { records });
    await markAttendance({ id: "r2", employeeId: "emp-1", date: "2026-08-20", status: "PRESENT" }, { records });

    const all = await records.listForRange(["emp-1"], "2026-08-01", "2026-08-31");
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("PRESENT");
  });

  it("listForRange scopes by employee ids and date bounds; null employeeIds returns all", async () => {
    const records = createSqliteAttendanceRecordRepository();
    handles.push(records);
    await markAttendance({ id: "r1", employeeId: "emp-1", date: "2026-08-05", status: "PRESENT" }, { records });
    await markAttendance({ id: "r2", employeeId: "emp-2", date: "2026-08-05", status: "ABSENT" }, { records });
    await markAttendance({ id: "r3", employeeId: "emp-1", date: "2026-09-05", status: "PRESENT" }, { records });

    expect(await records.listForRange(["emp-1"], "2026-08-01", "2026-08-31")).toHaveLength(1);
    expect(await records.listForRange(null, "2026-08-01", "2026-08-31")).toHaveLength(2);
    expect(await records.listForRange([], "2026-08-01", "2026-08-31")).toHaveLength(0);
  });
});
