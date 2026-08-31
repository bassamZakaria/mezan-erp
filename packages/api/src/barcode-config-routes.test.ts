import { describe, it, expect, afterEach } from "vitest";
import { createSqliteBarcodeConfigStore } from "@mezan/persistence";
import { createBarcodeConfigRoutes } from "./barcode-config-routes.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function newApp() {
  const store = createSqliteBarcodeConfigStore();
  closers.push(store);
  return { app: createBarcodeConfigRoutes({ store }), store };
}

type App = ReturnType<typeof newApp>["app"];

const ADMIN = "*";

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? ADMIN);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function send(app: App, method: string, path: string, payload?: unknown, permissions?: string) {
  return app.fetch(
    req(path, { method, permissions, body: payload === undefined ? undefined : JSON.stringify(payload) }),
  );
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** A 13-digit weight barcode: prefix "21", 5-digit item code, 5-digit value with 3 decimals. */
const weightRule = {
  id: "rule-weight",
  nameAr: "ميزان اللحوم",
  prefix: "21",
  totalLength: 13,
  itemCodeStart: 2,
  itemCodeLength: 5,
  valueStart: 7,
  valueLength: 5,
  valueType: "WEIGHT" as const,
  valueDecimals: 3,
  active: true,
};

describe("barcode-config routes", () => {
  it("403s a caller without the settings permissions", async () => {
    const { app } = newApp();
    expect((await send(app, "GET", "/", undefined, "")).status).toBe(403);
    expect((await send(app, "PUT", "/", {}, "admin.settings.view")).status).toBe(403);
    expect((await send(app, "POST", "/parse", { code: "1" }, "")).status).toBe(403);
  });

  it("serves the computed default before anything has ever been saved", async () => {
    const { app } = newApp();
    const config = await json<{
      defaultSymbology: string;
      itemBarcodeMode: string;
      autoGeneratePrefix: string | null;
      embeddedRules: unknown[];
    }>(await send(app, "GET", "/"));
    expect(config.defaultSymbology).toBe("EAN13");
    expect(config.itemBarcodeMode).toBeDefined();
    expect(config.embeddedRules).toEqual([]);
  });

  it("saves a patch over the default and reads it back", async () => {
    const { app } = newApp();
    const put = await send(app, "PUT", "/", { defaultSymbology: "CODE128", itemBarcodeMode: "MANUAL" });
    expect(put.status).toBe(200);
    expect(await json<{ defaultSymbology: string; itemBarcodeMode: string }>(put)).toMatchObject({
      defaultSymbology: "CODE128",
      itemBarcodeMode: "MANUAL",
    });

    const stored = await json<{ defaultSymbology: string }>(await send(app, "GET", "/"));
    expect(stored.defaultSymbology).toBe("CODE128");
  });

  it("leaves a field the patch did not name alone", async () => {
    const { app } = newApp();
    await send(app, "PUT", "/", { defaultSymbology: "CODE39", autoGeneratePrefix: "200" });
    const next = await json<{ defaultSymbology: string; autoGeneratePrefix: string | null }>(
      await send(app, "PUT", "/", { autoGeneratePrefix: null }),
    );
    expect(next.defaultSymbology).toBe("CODE39");
    expect(next.autoGeneratePrefix).toBeNull();
  });

  it("replaces the whole rule list when a PUT supplies one", async () => {
    const { app } = newApp();
    await send(app, "PUT", "/", { embeddedRules: [weightRule] });
    const cleared = await json<{ embeddedRules: unknown[] }>(await send(app, "PUT", "/", { embeddedRules: [] }));
    expect(cleared.embeddedRules).toEqual([]);
  });

  it("400s a body the schema rejects, on the PUT and on the parse endpoint", async () => {
    const { app } = newApp();
    expect((await send(app, "PUT", "/", { defaultSymbology: "QR" })).status).toBe(400);
    expect((await send(app, "POST", "/parse", { code: "" })).status).toBe(400);
    expect((await send(app, "POST", "/parse", {})).status).toBe(400);
  });

  it("422s a rule whose parts do not fit the barcode it claims to read", async () => {
    const { app } = newApp();
    const res = await send(app, "PUT", "/", {
      embeddedRules: [{ ...weightRule, valueStart: 10, valueLength: 6 }],
    });
    expect(res.status).toBe(422);
    const payload = await json<{ error: string; reasons: string[] }>(res);
    expect(payload.error).toBe("INVALID_BARCODE_CONFIG");
    expect(payload.reasons.join(" ")).toContain("الطول الكلي");
  });

  it("422s an auto-numbering prefix that is not all digits", async () => {
    const { app } = newApp();
    const res = await send(app, "PUT", "/", { itemBarcodeMode: "AUTO", autoGeneratePrefix: "AB2" });
    expect(res.status).toBe(422);
    expect((await json<{ reasons: string[] }>(res)).reasons.join(" ")).toContain("أرقام فقط");
  });

  it("422s two rules sharing an id", async () => {
    const { app } = newApp();
    const res = await send(app, "PUT", "/", { embeddedRules: [weightRule, { ...weightRule, nameAr: "أخرى" }] });
    expect(res.status).toBe(422);
    expect((await json<{ reasons: string[] }>(res)).reasons.join(" ")).toContain("مكرر");
  });

  it("parses a scanned code against the saved rules, returning the item and its value", async () => {
    const { app } = newApp();
    await send(app, "PUT", "/", { embeddedRules: [weightRule] });

    const match = await json<{
      matched: boolean;
      ruleId: string;
      itemCode: string;
      value: number;
      valueType: string;
    }>(await send(app, "POST", "/parse", { code: "2100123014500" }));

    expect(match).toMatchObject({
      matched: true,
      ruleId: "rule-weight",
      itemCode: "00123",
      valueType: "WEIGHT",
    });
    // digits 7..12 are "01450", and the rule says three decimals.
    expect(match.value).toBeCloseTo(1.45, 6);
  });

  it("reports no match for a code of the wrong length, the wrong prefix, or with letters in it", async () => {
    const { app } = newApp();
    await send(app, "PUT", "/", { embeddedRules: [weightRule] });

    for (const code of ["210012301450", "2200123014500", "21001230145AB"]) {
      expect(await json<{ matched: boolean }>(await send(app, "POST", "/parse", { code }))).toEqual({ matched: false });
    }
  });

  it("ignores an inactive rule rather than matching against it", async () => {
    const { app } = newApp();
    await send(app, "PUT", "/", { embeddedRules: [{ ...weightRule, active: false }] });
    expect(await json<{ matched: boolean }>(await send(app, "POST", "/parse", { code: "2100123014500" }))).toEqual({
      matched: false,
    });
  });

  it("reports no match when no rules have been configured at all", async () => {
    const { app } = newApp();
    expect(await json<{ matched: boolean }>(await send(app, "POST", "/parse", { code: "2100123014500" }))).toEqual({
      matched: false,
    });
  });
});
