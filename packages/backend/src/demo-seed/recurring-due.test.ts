import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE, createEntitlements, MODULE_CATALOG } from "@mezan/domain";
import { createBackend, type BackendHandle } from "../create-backend.js";

const TEMPLATE_ID = "RJT-DEMO-1";

describe("the demo tenant's recurring-journal worklist", () => {
  let handle: BackendHandle;
  let read: (path: string) => Promise<any>;

  beforeAll(async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "mezan-recurring-due-")), "books.db");
    const resolveEntitlements = () => createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null });
    handle = await createBackend({ dbPath, seedDemoData: true, resolveEntitlements });
    const token = handle.sessions.issue({ userId: "USER-ADMIN", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    read = async (path) => {
      const res = await handle.app.fetch(new Request(`http://local${path}`, { headers: { authorization: `Bearer ${token}` } }));
      expect(res.status, path).toBe(200);
      return res.json();
    };
  }, 240_000);

  afterAll(() => handle?.close());

  it("opens with exactly one period genuinely due: this month's, with every earlier one already generated", async () => {
    const worklist = (await read("/gl/recurring/due")) as { asOfDate: string; due: { templateId: string; periods: string[] }[] };
    const thisMonth = worklist.asOfDate.slice(0, 7);
    expect(worklist.due.map((entry) => entry.templateId)).toEqual([TEMPLATE_ID]);
    expect(worklist.due[0]?.periods).toHaveLength(1);
    expect(worklist.due[0]?.periods[0]).toContain(thisMonth);

    const runs = (await read("/gl/recurring/runs")) as { templateId: string; period: string }[];
    const generated = runs.filter((run) => run.templateId === TEMPLATE_ID).map((run) => run.period);
    expect(generated.length).toBeGreaterThan(0);
    expect(generated.some((period) => period.includes(thisMonth))).toBe(false);
  });
});
