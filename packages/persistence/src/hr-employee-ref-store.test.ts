import { describe, it, expect, afterEach } from "vitest";
import { createSqliteEmployeeRefRepository } from "./hr-employee-ref-store.js";

const handles: { close(): void }[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

describe("SqliteEmployeeRefRepository", () => {
  it("upserts and finds by id", async () => {
    const repo = createSqliteEmployeeRefRepository();
    handles.push(repo);
    await repo.upsert({ id: "emp-1", code: "EMP-0001", nameAr: "أحمد محمود", departmentId: "dept-1", active: true });

    const found = await repo.findById("emp-1");
    expect(found?.nameAr).toBe("أحمد محمود");

    await repo.upsert({ id: "emp-1", code: "EMP-0001", nameAr: "أحمد محمود علي", departmentId: "dept-1", active: true });
    expect((await repo.findById("emp-1"))?.nameAr).toBe("أحمد محمود علي");
  });

  it("lists, filtered by department and active-only", async () => {
    const repo = createSqliteEmployeeRefRepository();
    handles.push(repo);
    await repo.upsert({ id: "e1", code: "EMP-0001", nameAr: "a", departmentId: "d1", active: true });
    await repo.upsert({ id: "e2", code: "EMP-0002", nameAr: "b", departmentId: "d2", active: true });
    await repo.upsert({ id: "e3", code: "EMP-0003", nameAr: "c", departmentId: "d1", active: false });

    expect((await repo.list()).map((e) => e.id).sort()).toEqual(["e1", "e2", "e3"]);
    expect((await repo.list({ departmentId: "d1" })).map((e) => e.id).sort()).toEqual(["e1", "e3"]);
    expect((await repo.list({ activeOnly: true })).map((e) => e.id).sort()).toEqual(["e1", "e2"]);
  });

  it("returns null for an unknown id", async () => {
    const repo = createSqliteEmployeeRefRepository();
    handles.push(repo);
    expect(await repo.findById("nope")).toBeNull();
  });
});
