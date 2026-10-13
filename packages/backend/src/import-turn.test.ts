import { monitorEventLoopDelay } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { IMPORT_ROW_LIMIT } from "@mezan/contracts";
import { ALL_SCOPE } from "@mezan/domain";
import { createBackend, type BackendHandle, type CreateBackendOptions } from "./create-backend.js";

const handles: BackendHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

async function open(options: Partial<CreateBackendOptions> = {}) {
  const handle = await createBackend({ dbPath: ":memory:", ...options });
  handles.push(handle);
  const token = handle.sessions.issue({ userId: "admin", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await handle.app.fetch(new Request(`http://local${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) };
    } catch {
      return { status: res.status, body: text };
    }
  };
  const listed = async (path: string): Promise<unknown[]> => {
    const body = (await call("GET", path)).body as { items?: unknown[] } | unknown[];
    return Array.isArray(body) ? body : (body.items ?? []);
  };
  const itemCount = async (): Promise<number> => ((await call("GET", "/items/counts")).body as { all: number }).all;
  return { handle, call, listed, itemCount };
}

const itemRows = (count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => ({ code: `IMP-${from + i}`, nameAr: `صنف ${from + i}`, baseUnitCode: "PCS", type: "stock", salePrice: "10.50", costPrice: "7.25" }));

const HOLD_LIMIT_MS = 500;
const WAIT_LIMIT_MS = 300;
const LARGE_IMPORT = 2000;
const IMPORT_ROW_CAP = IMPORT_ROW_LIMIT;
const NANOSECONDS_PER_MS = 1e6;

describe("a large import and everyone else's writes", () => {
  it.skipIf(process.env.MEZAN_TIMING_TESTS !== "1")("lets a voucher posted during a 2,000-row items import through in under 300 ms, and holds the connection for under 500 ms", async () => {
    const heldTooLong: string[] = [];
    const t = await open({
      connectionTurn: { heldWarningMs: HOLD_LIMIT_MS, onHeldTooLong: (c, heldMs) => heldTooLong.push(`${c.req.method} ${c.req.path} ${heldMs}ms`) },
    });
    expect((await t.call("POST", "/treasury-accounts", { id: "ta-main", code: "TA-MAIN", name: "الخزينة الرئيسية", branchId: "BR-MAIN", glAccountId: "1310" })).status).toBe(201);
    const voucher = (id: string) => ({
      id, date: "2026-08-22", voucherType: "other_income", amount: "50.00", branchId: "BR-MAIN", paymentMethod: "cash",
      treasuryAccountId: "ta-main", treasuryGlAccountId: "1310", counterpartyGlAccountId: "4900",
    });
    const timed = async (id: string) => {
      const startedAt = performance.now();
      const answer = await t.call("POST", "/vouchers", voucher(id));
      return { answer, ms: performance.now() - startedAt };
    };
    const alone = await timed("11111111-aaaa-4bbb-8ccc-0000000000a1");
    expect(alone.answer.status, JSON.stringify(alone.answer.body)).toBe(201);

    const loop = monitorEventLoopDelay({ resolution: 1 });
    loop.enable();
    const importing = t.call("POST", "/data-migration/items/commit", { rows: itemRows(LARGE_IMPORT) });
    const during = await timed("11111111-aaaa-4bbb-8ccc-0000000000a2");
    const imported = await importing;
    loop.disable();

    expect(imported).toMatchObject({ status: 201, body: { validCount: LARGE_IMPORT } });
    expect(during.answer.status).toBe(201);
    expect(during.ms - alone.ms).toBeLessThan(WAIT_LIMIT_MS);
    expect(loop.max / NANOSECONDS_PER_MS).toBeLessThan(WAIT_LIMIT_MS);
    expect(heldTooLong).toEqual([]);
    expect(await t.itemCount()).toBe(LARGE_IMPORT);
  });

  it("holds the connection from the first row of a 2,000-row items import to the last without once giving the event loop back, so a voucher posted meanwhile waits and then posts", async () => {
    const yielded: string[] = [];
    const t = await open({ connectionTurn: { onYield: (c) => yielded.push(`${c.req.method} ${c.req.path}`) } });
    expect((await t.call("POST", "/treasury-accounts", { id: "ta-main", code: "TA-MAIN", name: "الخزينة الرئيسية", branchId: "BR-MAIN", glAccountId: "1310" })).status).toBe(201);
    const finished: string[] = [];

    const importing = t.call("POST", "/data-migration/items/commit", { rows: itemRows(LARGE_IMPORT) }).then((answer) => {
      finished.push("import");
      return answer;
    });
    const posting = t
      .call("POST", "/vouchers", {
        id: "11111111-aaaa-4bbb-8ccc-0000000000b1", date: "2026-08-22", voucherType: "other_income", amount: "50.00", branchId: "BR-MAIN", paymentMethod: "cash",
        treasuryAccountId: "ta-main", treasuryGlAccountId: "1310", counterpartyGlAccountId: "4900",
      })
      .then((answer) => {
        finished.push("voucher");
        return answer;
      });
    const [imported, posted] = await Promise.all([importing, posting]);

    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    expect(imported).toMatchObject({ status: 201, body: { validCount: LARGE_IMPORT } });
    expect(finished).toEqual(["import", "voucher"]);
    expect(yielded).toEqual([]);
    expect(await t.itemCount()).toBe(LARGE_IMPORT);
  });

  it("leaves no item visible when a row far into a 2,000-row import cannot be saved", async () => {
    const t = await open();
    const rows = itemRows(LARGE_IMPORT);
    rows[1500] = { ...rows[1500]!, taxRatePercent: "-5" } as (typeof rows)[number];

    const refused = await t.call("POST", "/data-migration/items/commit", { rows });

    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(await t.itemCount()).toBe(0);
    expect((await t.call("POST", "/data-migration/items/commit", { rows: itemRows(3) })).status).toBe(201);
    expect(await t.itemCount()).toBe(3);
  });

  it.each(["preview", "commit"])("refuses a file over the row limit at %s, in Arabic with the count and the limit, and writes nothing", async (step) => {
    const t = await open();

    const refused = await t.call("POST", `/data-migration/items/${step}`, { rows: itemRows(IMPORT_ROW_CAP + 1) });
    const atTheLimit = await t.call("POST", "/data-migration/items/preview", { rows: itemRows(IMPORT_ROW_CAP) });

    expect(refused).toMatchObject({
      status: 413,
      body: { error: "IMPORT_TOO_LARGE", rows: IMPORT_ROW_CAP + 1, limit: IMPORT_ROW_CAP, message: expect.stringMatching(/5001.*5000|٥٠٠١.*٥٠٠٠/) },
    });
    expect(atTheLimit).toMatchObject({ status: 200, body: { validCount: IMPORT_ROW_CAP } });
    expect(await t.itemCount()).toBe(0);
  });
});

describe("a historical import that fails part-way", () => {
  async function parties(t: Awaited<ReturnType<typeof open>>) {
    const customer = await t.call("POST", "/data-migration/customers/commit", { rows: [{ code: "C-1", nameAr: "عميل" }] });
    const supplier = await t.call("POST", "/data-migration/suppliers/commit", { rows: [{ code: "S-1", nameAr: "مورد" }] });
    return {
      customerId: (customer.body as { createdIds: string[] }).createdIds[0]!,
      supplierId: (supplier.body as { createdIds: string[] }).createdIds[0]!,
    };
  }
  const row = (i: number, docType: string, party: Record<string, string>, date = "2026-08-22") => ({
    rowNumber: i + 1, docType, documentNumber: `H-${i}`, ...party, date, description: "بند", qty: "1", unitCost: "100.00", amountPaid: "0",
  });

  it.each([
    ["/sales/historical-import", "SALES_INVOICE", "customerId"],
    ["/purchases/historical-import", "PURCHASE_INVOICE", "supplierId"],
  ] as const)("archives nothing and posts nothing under %s when a later document's date has no fiscal period, and says why in Arabic", async (mount, docType, partyKey) => {
    const t = await open();
    const ids = await parties(t);
    const party = { [partyKey]: ids[partyKey] };
    const entriesBefore = (await t.listed("/gl/journal-entries")).length;

    const refused = await t.call("POST", `${mount}/commit`, { rows: [row(0, docType, party), row(1, docType, party), row(2, docType, party, "1999-01-01")] });

    expect(refused).toMatchObject({ status: 422, body: { error: "NO_FISCAL_PERIOD_FOR_DATE", message: expect.stringMatching(/[؀-ۿ]/) } });
    expect(await t.listed(`${mount}/archives`)).toEqual([]);
    expect((await t.listed("/gl/journal-entries")).length).toBe(entriesBefore);

    const good = await t.call("POST", `${mount}/commit`, { rows: [row(0, docType, party), row(1, docType, party)] });
    expect(good.status).toBe(201);
    expect(await t.listed(`${mount}/archives`)).toHaveLength(2);
  });

  it.each([
    ["/sales/historical-import", "SALES_INVOICE", "customerId"],
    ["/purchases/historical-import", "PURCHASE_INVOICE", "supplierId"],
  ] as const)("refuses a file over the row limit under %s", async (mount, docType, partyKey) => {
    const t = await open();
    const ids = await parties(t);
    const rows = Array.from({ length: IMPORT_ROW_CAP + 1 }, (_, i) => row(i, docType, { [partyKey]: ids[partyKey] }));

    const refused = await t.call("POST", `${mount}/commit`, { rows });

    expect(refused).toMatchObject({ status: 413, body: { error: "IMPORT_TOO_LARGE", limit: IMPORT_ROW_CAP } });
    expect(await t.listed(`${mount}/archives`)).toEqual([]);
  });
});
