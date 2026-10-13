import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { moneyString } from "@mezan/contracts";
import { InvalidDecimalLiteralError, Money } from "@mezan/domain";
import { validationMessages } from "./validation-message.js";

const ARABIC = /[؀-ۿ]/;
const schema = z.object({ amount: moneyString, name: z.string().min(1) });

function app() {
  const hono = new Hono();
  hono.use("*", validationMessages());
  hono.post("/parsed", async (c) => {
    const parsed = schema.safeParse(await c.req.json());
    return parsed.success ? c.json({ ok: true }, 201) : c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
  });
  hono.post("/own-message", (c) => c.json({ error: "VALIDATION_ERROR", message: "رسالة المسار", details: {} }, 400));
  hono.post("/other-400", (c) => c.json({ error: "BRANCH_REQUIRED", details: {} }, 400));
  hono.post("/not-json", (c) => c.text("bad", 400));
  const send = (path: string, body: unknown) => hono.fetch(new Request(`http://local${path}`, { method: "POST", body: JSON.stringify(body) }));
  return send;
}

describe("validationMessages", () => {
  it("gives a refused decimal a top-level Arabic message that names the field and the rule, and keeps the details", async () => {
    const res = await app()("/parsed", { amount: "1e3", name: "x" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string; messageEn: string; details: { fieldErrors: Record<string, string[]> } };
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(body.message).toMatch(ARABIC);
    expect(body.message).toContain("«amount»");
    expect(body.message).toContain("رقماً عشرياً");
    expect(body.details.fieldErrors["amount"]?.[0]).toMatch(ARABIC);
    expect(Number(res.headers.get("content-length") ?? JSON.stringify(body).length)).toBeGreaterThan(0);
  });

  it("gives any other validation failure a generic Arabic message rather than none", async () => {
    const body = (await (await app()("/parsed", { amount: "1", name: "" })).json()) as { message: string };
    expect(body.message).toMatch(ARABIC);
  });

  it("leaves alone a success, a route's own message, another refusal and a body that is not JSON", async () => {
    expect(await (await app()("/parsed", { amount: "1.50", name: "x" })).json()).toEqual({ ok: true });
    expect(((await (await app()("/own-message", {})).json()) as { message: string }).message).toBe("رسالة المسار");
    expect(await (await app()("/other-400", {})).json()).toEqual({ error: "BRANCH_REQUIRED", details: {} });
    expect(await (await app()("/not-json", {})).text()).toBe("bad");
  });
});

describe("InvalidDecimalLiteralError", () => {
  it("is what a malformed literal raises, still a RangeError, with an Arabic message for the caller", () => {
    for (const literal of ["1e3", "abc", "1.0000001"]) {
      let raised: unknown;
      try {
        Money.fromMajor(literal);
      } catch (error) {
        raised = error;
      }
      expect(raised).toBeInstanceOf(InvalidDecimalLiteralError);
      expect(raised).toBeInstanceOf(RangeError);
      expect((raised as InvalidDecimalLiteralError).messageAr).toMatch(ARABIC);
    }
  });
});
