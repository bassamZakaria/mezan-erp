import { describe, it, expect } from "vitest";
import { markAttendance } from "./mark-attendance.js";
import { InvalidAttendanceRecordError } from "./attendance.js";
import { createInMemoryAttendanceRepository } from "./test-helpers/in-memory-attendance-repository.js";

describe("markAttendance", () => {
  it("creates a new record", async () => {
    const records = createInMemoryAttendanceRepository();
    const record = await markAttendance(
      { id: "rec-1", employeeId: "emp-1", date: "2026-08-20", status: "ABSENT", now: () => "2026-08-21T00:00:00.000Z" },
      { records },
    );
    expect(record.status).toBe("ABSENT");
    expect(record.overtimeHours).toBe(0);
    expect(record.createdAt).toBe("2026-08-21T00:00:00.000Z");
  });

  it("re-marking the same employee/date replaces the prior record, keeping its original id/createdAt", async () => {
    const records = createInMemoryAttendanceRepository();
    await markAttendance(
      { id: "rec-1", employeeId: "emp-1", date: "2026-08-20", status: "ABSENT", now: () => "2026-08-21T00:00:00.000Z" },
      { records },
    );
    const updated = await markAttendance(
      { id: "rec-2", employeeId: "emp-1", date: "2026-08-20", status: "PRESENT", now: () => "2026-08-22T00:00:00.000Z" },
      { records },
    );

    expect(updated.id).toBe("rec-1");
    expect(updated.status).toBe("PRESENT");
    expect(updated.createdAt).toBe("2026-08-21T00:00:00.000Z");
    expect(updated.updatedAt).toBe("2026-08-22T00:00:00.000Z");

    const all = await records.listForRange(["emp-1"], "2026-08-01", "2026-08-31");
    expect(all).toHaveLength(1);
  });

  it("rejects an invalid date", async () => {
    const records = createInMemoryAttendanceRepository();
    await expect(
      markAttendance({ id: "rec-1", employeeId: "emp-1", date: "not-a-date", status: "PRESENT" }, { records }),
    ).rejects.toBeInstanceOf(InvalidAttendanceRecordError);
  });

  it("rejects negative overtime hours", async () => {
    const records = createInMemoryAttendanceRepository();
    await expect(
      markAttendance(
        { id: "rec-1", employeeId: "emp-1", date: "2026-08-20", status: "PRESENT", overtimeHours: -1 },
        { records },
      ),
    ).rejects.toBeInstanceOf(InvalidAttendanceRecordError);
  });
});
