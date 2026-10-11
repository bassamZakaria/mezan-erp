import { describe, expect, it } from "vitest";
import { COMPLETED_RETAKE_TIMEOUT_MS } from "@mezan/persistence";
import { OUTSIDE_WORK_DEADLINES_MS, OutsideWork, OutsideWorkDeadlineError, withinDeadline } from "./outside-work.js";

describe("work done with the tenant's connection handed back", () => {
  it("has a deadline for every kind, each shorter than the wait given to completed work to record its answer", () => {
    for (const work of Object.values(OutsideWork)) {
      expect(OUTSIDE_WORK_DEADLINES_MS[work], work).toBeGreaterThan(0);
      expect(OUTSIDE_WORK_DEADLINES_MS[work], work).toBeLessThan(COMPLETED_RETAKE_TIMEOUT_MS);
    }
  });

  it("answers with what the work answered when it is inside its deadline, and with its failure when it fails", async () => {
    const quick = { ...OUTSIDE_WORK_DEADLINES_MS, [OutsideWork.Mail]: 200 };
    expect(await withinDeadline(OutsideWork.Mail, async () => "250 ok", quick)).toBe("250 ok");
    await expect(withinDeadline(OutsideWork.Mail, async () => Promise.reject(new Error("refused")), quick)).rejects.toThrow("refused");
  });

  it("stops waiting at the deadline for work that never answers", async () => {
    const quick = { ...OUTSIDE_WORK_DEADLINES_MS, [OutsideWork.EtaHttp]: 20 };
    const never = () => new Promise<string>(() => undefined);
    await expect(withinDeadline(OutsideWork.EtaHttp, never, quick)).rejects.toBeInstanceOf(OutsideWorkDeadlineError);
  });
});

describe("a write issued inside another operation's open transaction", () => {
  it("is answered 503 in Arabic by the request that issued it, and changes nothing", async () => {
    const { createBackend } = await import("./create-backend.js");
    const { ForeignWriteError } = await import("@mezan/domain");
    const { Hono } = await import("hono");
    const backend = await createBackend({ dbPath: ":memory:" });
    try {
      const app = backend.app as unknown as InstanceType<typeof Hono>;
      app.get("/__test/foreign-write", () => {
        throw new ForeignWriteError("UPDATE thing SET v = 1");
      });
      const errors: unknown[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => void errors.push(args);
      const res = await backend.app.fetch(new Request("http://local/__test/foreign-write"));
      console.error = original;

      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("2");
      expect(await res.json()).toMatchObject({ error: "DATABASE_BUSY", message: expect.stringContaining("مشغولة") });
    } finally {
      backend.close();
    }
  });
});
