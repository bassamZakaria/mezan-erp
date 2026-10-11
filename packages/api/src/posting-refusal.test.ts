import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { VatPeriodAlreadyFiledError } from "@mezan/domain";
import { createApp } from "./app.js";
import { createSqliteUnitOfWork } from "@mezan/persistence";

/**
 * D79 round 5: `POST /sales-invoices/:id/confirm` dated inside a filed VAT
 * month answered 500 because its route did not map the refusal. The mapping
 * lives in the app's last net, so ANY route that lets the error escape —
 * including one written tomorrow — answers the Arabic 422.
 */
describe("a posting refused because its VAT return is filed", () => {
  it("is answered 422 in Arabic by the app itself, for a route that maps nothing", async () => {
    const app = createApp(createSqliteUnitOfWork(":memory:"));
    const unmapped = new Hono();
    unmapped.post("/confirm", () => {
      throw new VatPeriodAlreadyFiledError("VATF-2026-05", "2026-05-10");
    });
    app.route("/probe", unmapped);

    const res = await app.fetch(new Request("http://local/probe/confirm", { method: "POST" }));
    const body = (await res.json()) as { error: string; message: string; filingId: string; date: string };
    expect([res.status, body.error, body.filingId, body.date]).toEqual([422, "VAT_PERIOD_ALREADY_FILED", "VATF-2026-05", "2026-05-10"]);
    expect(body.message).toMatch(/[؀-ۿ]/);
  });

  it("still answers 500 for an error nobody knows", async () => {
    const app = createApp(createSqliteUnitOfWork(":memory:"));
    const unmapped = new Hono();
    unmapped.post("/confirm", () => {
      throw new Error("boom");
    });
    app.route("/probe", unmapped);
    const res = await app.fetch(new Request("http://local/probe/confirm", { method: "POST" }));
    expect(res.status).toBe(500);
  });
});
