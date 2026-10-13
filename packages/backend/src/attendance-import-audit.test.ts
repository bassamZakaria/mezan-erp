import { afterEach, describe, expect, it } from "vitest";
import { ALL_SCOPE } from "@mezan/domain";
import { createBackend, type BackendHandle } from "./create-backend.js";

const BADGE = "B77";
const DAY = "2026-03-03";
const CSV = `badge,datetime,direction\n${BADGE},${DAY} 09:00,in\n${BADGE},${DAY} 17:00,out\n`;

describe("POST /hr/attendance/import/commit", () => {
  let backend: BackendHandle | undefined;
  afterEach(() => {
    backend?.close();
    backend = undefined;
  });

  async function open() {
    backend = await createBackend({ dbPath: ":memory:" });
    const token = backend.sessions.issue({ userId: "admin", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const app = backend.app;
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await app.fetch(
        new Request(`http://local${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
      return { status: res.status, json: (await res.json()) as never };
    };
    const branches = (await call("GET", "/branches")).json as { id: string }[];
    const employee = await call("POST", "/hr/employees", { firstName: "A", lastName: "B", branchId: branches[0]!.id, hireDate: "2025-01-01", deviceBadgeId: BADGE });
    expect(employee.status).toBe(201);
    const importEvents = async () => {
      const page = (await call("GET", "/audit?module=hr&limit=200")).json as { events: { entityType: string; action: string; details: Record<string, unknown> }[] };
      return page.events.filter((event) => event.entityType === "attendance_import");
    };
    const attendance = async () => (await call("GET", `/hr/attendance?from=${DAY}&to=${DAY}`)).json as { date: string; checkIn: string; checkOut: string }[];
    return { call, importEvents, attendance };
  }

  it("saves the rows and their audit event together, and answers 200", async () => {
    const t = await open();

    const commit = await t.call("POST", "/hr/attendance/import/commit", { csv: CSV });

    expect(commit.status).toBe(200);
    expect(commit.json).toMatchObject({ createdCount: 1, skippedAlreadyRecordedCount: 0 });
    expect(await t.attendance()).toMatchObject([{ date: DAY, checkIn: "09:00", checkOut: "17:00" }]);
    const events = await t.importEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "commit", details: { createdCount: 1, totalPunches: 2 } });
    expect((await t.call("GET", "/audit/verify")).json).toMatchObject({ ok: true });
  });

  it("answers a repeat of the same file with nothing created, not an error", async () => {
    const t = await open();
    await t.call("POST", "/hr/attendance/import/commit", { csv: CSV });

    const again = await t.call("POST", "/hr/attendance/import/commit", { csv: CSV });

    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ createdCount: 0, skippedAlreadyRecordedCount: 1 });
    expect(await t.attendance()).toHaveLength(1);
    expect(await t.importEvents()).toHaveLength(2);
  });

  it("writes nothing on a preview", async () => {
    const t = await open();

    const preview = await t.call("POST", "/hr/attendance/import/preview", { csv: CSV });

    expect(preview.status).toBe(200);
    expect(await t.attendance()).toEqual([]);
    expect(await t.importEvents()).toEqual([]);
  });
});
