import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BackfilledErrorCode, backfillErrorMessage, issueText } from "./error-message-backfill.js";
import { requestLogging } from "./request-logging.js";

function appAnswering(body: unknown, status: number) {
  const app = new Hono();
  app.use("*", requestLogging());
  app.get("/x", (c) => c.json(body as Record<string, unknown>, status as 400));
  return app;
}

describe("backfillErrorMessage", () => {
  it("names the rejected fields of a zod validation failure in both languages", () => {
    const out = backfillErrorMessage(
      { error: BackfilledErrorCode.ValidationError, details: { formErrors: [], fieldErrors: { quantity: ["Required"], unitPrice: ["Expected string"] } } },
      400,
    );
    expect(out?.message).toBe("بيانات غير صالحة في: quantity، unitPrice.");
    expect(out?.messageEn).toBe("Invalid data in: quantity, unitPrice.");
    expect(out?.details).toBeDefined();
  });

  it("reads field paths from a zod issues list", () => {
    const out = backfillErrorMessage({ error: BackfilledErrorCode.ValidationError, details: [{ path: ["lines", 0, "qty"] }, { path: ["lines", 0, "qty"] }] }, 400);
    expect(out?.messageEn).toBe("Invalid data in: lines.0.qty.");
  });

  it("labels a 503 as busy, not as an internal error", () => {
    const out = backfillErrorMessage({ error: "STARTUP_BUSY" }, 503);
    expect(out?.messageEn).toContain("The service is busy right now.");
    expect(out?.message).toContain("الخدمة مشغولة");
  });

  it("puts an English form-level error in messageEn only and the generic sentence in message", () => {
    const out = backfillErrorMessage({ error: BackfilledErrorCode.ValidationError, details: { formErrors: ["Unrecognized key(s) in object: 'x'"], fieldErrors: {} } }, 400);
    expect(out?.message).toBe("البيانات المُرسلة غير صالحة.");
    expect(out?.messageEn).toBe("Unrecognized key(s) in object: 'x'");
  });

  it("puts an Arabic form-level error in message only and the generic sentence in messageEn", () => {
    const out = backfillErrorMessage({ error: BackfilledErrorCode.ValidationError, details: { formErrors: ["الفترتان متداخلتان"], fieldErrors: {} } }, 400);
    expect(out?.message).toBe("الفترتان متداخلتان");
    expect(out?.messageEn).toBe("The submitted data is not valid.");
  });

  it("splits mixed form-level errors by script", () => {
    const out = backfillErrorMessage({ error: BackfilledErrorCode.ValidationError, details: { formErrors: ["الفترتان متداخلتان", "Dates overlap"], fieldErrors: {} } }, 400);
    expect(out?.message).toBe("الفترتان متداخلتان");
    expect(out?.messageEn).toBe("Dates overlap");
  });

  it("gives a zod issue both languages: a refine's own English, else split by script", () => {
    expect(issueText({ message: "التاريخ مطلوب", params: { messageEn: "The date is required" } } as { message: string })).toEqual({ message: "التاريخ مطلوب", messageEn: "The date is required" });
    expect(issueText({ message: "Required" })).toEqual({ message: "البيانات المُرسلة غير صالحة.", messageEn: "Required" });
    expect(issueText({ message: "التاريخ مطلوب" })).toEqual({ message: "التاريخ مطلوب", messageEn: "The submitted data is not valid." });
  });

  it("covers every *_NOT_FOUND code", () => {
    expect(backfillErrorMessage({ error: "VAN_TRIP_NOT_FOUND" }, 404)?.messageEn).toMatch(/not found/);
  });

  it("falls back by status and keeps an unknown code visible", () => {
    const out = backfillErrorMessage({ error: "SOMETHING_ODD" }, 409);
    expect(out?.message).toContain("(SOMETHING_ODD)");
    expect(out?.messageEn).toContain("(SOMETHING_ODD)");
  });

  it("never overwrites a sentence the route wrote", () => {
    expect(backfillErrorMessage({ error: "X", message: "رسالة" }, 400)).toBeNull();
    expect(backfillErrorMessage({ error: "X", messageEn: "text" }, 400)).toBeNull();
  });
});

describe("requestLogging error bodies", () => {
  it("adds both sentences to a message-less 4xx body", async () => {
    const res = await appAnswering({ error: "NOT_FOUND" }, 404).request("/x");
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(404);
    expect(body).toMatchObject({ error: "NOT_FOUND", message: expect.any(String), messageEn: expect.any(String) });
    expect(body.requestId).toBeUndefined();
  });

  it("leaves a 4xx body that already speaks untouched", async () => {
    const original = { error: "CLOSED", message: "الفترة مغلقة", messageEn: "The period is closed." };
    const res = await appAnswering(original, 409).request("/x");
    expect(await res.json()).toEqual(original);
  });

  it("still stamps the request id on a 5xx", async () => {
    const res = await appAnswering({ error: "INTERNAL" }, 500).request("/x");
    expect(await res.json()).toMatchObject({ error: "INTERNAL", messageEn: "An internal server error occurred.", requestId: expect.any(String) });
  });

  it("leaves success bodies alone", async () => {
    const res = await appAnswering({ ok: true }, 200).request("/x");
    expect(await res.json()).toEqual({ ok: true });
  });
});
