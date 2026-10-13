import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE, PERMISSIONS, resolvePermissions } from "@mezan/domain";
import { bootBackendKit, type BackendKit, type Reply } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const JOURNAL_VIEW = "accounting.journal.view";

let kit: BackendKit;

interface Family {
  readonly label: string;
  readonly mount: string;
  readonly permissionPrefix: string;
  readonly broadViews: readonly string[];
  readonly params: Readonly<Record<string, string>>;
  arrange(id: string): Promise<void>;
}

const FAMILIES: readonly Family[] = [
  {
    label: "sales invoices",
    mount: "/sales-invoices",
    permissionPrefix: "sales.invoice.",
    broadViews: ["sales.invoice.view", "sales.invoice.view_all"],
    params: { lineId: "A" },
    arrange: async (id) => {
      const created = await kit.call("POST", "/sales-invoices", {
        id, date: TODAY, dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN",
        arAccountId: "1105", taxAccountId: "2200",
        lines: [{ lineId: "A", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", revenueAccountId: "4100", taxRateId: null, taxRatePercent: 0 }],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect((await kit.call("POST", `/sales-invoices/${id}/confirm`, {})).status).toBe(200);
    },
  },
  {
    label: "purchase invoices",
    mount: "/purchases/invoices",
    permissionPrefix: "purchases.invoice.",
    broadViews: ["purchases.invoice.view"],
    params: { lineId: "0" },
    arrange: async (id) => {
      const created = await kit.call("POST", "/purchases/invoices", {
        id, supplierId: "SUPP-DEMO-1", date: TODAY, dueDate: "2026-09-23", branchId: "BR-MAIN", warehouseId: "WH-MAIN",
        lines: [{ itemId: null, kind: "expense", description: "خدمة", qty: "1", unitCost: "200", taxRateId: null, taxRatePercent: 0 }],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect((await kit.call("POST", `/purchases/invoices/${id}/confirm`, {})).status).toBe(200);
    },
  },
];

function subRoutesOf(mount: string): { readonly method: string; readonly path: string }[] {
  const seen = new Map<string, { method: string; path: string }>();
  for (const route of kit.backend.app.routes) {
    if (route.method === "ALL") continue;
    if (route.path !== `${mount}/:id` && !route.path.startsWith(`${mount}/:id/`)) continue;
    seen.set(`${route.method} ${route.path}`, { method: route.method, path: route.path });
  }
  return [...seen.values()];
}

beforeAll(async () => {
  kit = await bootBackendKit();
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe("every route under one invoice applies that invoice's visibility rule", () => {
  for (const [index, family] of FAMILIES.entries()) {
    it(`${family.label}: an own-records caller holding every action permission is told a colleague's invoice does not exist, on every sub-route`, async () => {
      const id = `VIS-SUB-${index + 1}`;
      await family.arrange(id);
      const before = (await kit.call("GET", `${family.mount}/${id}`)).body;
      const permissions = [
        ...PERMISSIONS.map((permission) => permission.code).filter(
          (code) => code.startsWith(family.permissionPrefix) && !family.broadViews.some((view) => resolvePermissions([code]).has(view)),
        ),
        JOURNAL_VIEW,
      ];
      expect(permissions.length).toBeGreaterThanOrEqual(6);
      const routes = subRoutesOf(family.mount);
      expect(routes.length).toBeGreaterThanOrEqual(6);

      const answers: Record<string, string> = {};
      for (const route of routes) {
        const path = route.path.replace(":id", id).replace(/:(\w+)/g, (_, name: string) => family.params[name] ?? name);
        const reply = await kit.call(route.method, path, route.method === "GET" ? undefined : {}, permissions);
        answers[`${route.method} ${route.path}`] = `${reply.status} ${reply.body?.error ?? ""}`;
      }
      expect(answers).toEqual(Object.fromEntries(routes.map((route) => [`${route.method} ${route.path}`, "404 NOT_FOUND"])));
      expect((await kit.call("GET", `${family.mount}/${id}`)).body).toEqual(before);
    });
  }
});

const WAREHOUSE = "WH-MAIN";
const SUPPLIER = "SUPP-DEMO-1";

interface ScopedFamily {
  readonly label: string;
  readonly mount: string;
  readonly permissionPrefixes: readonly string[];
  readonly params: Readonly<Record<string, string>>;
  arrange(tag: string): Promise<{ readonly draftId: string; readonly postedId: string }>;
}

async function stockItem(id: string) {
  const created = await kit.call("POST", "/items", { id, code: id, nameAr: `صنف ${id}`, type: "stock", baseUnitCode: "PCS", trackInventory: true, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
}

async function purchase(id: string, itemId: string) {
  const created = await kit.call("POST", "/purchases/invoices", {
    id, supplierId: SUPPLIER, date: TODAY, dueDate: "2026-09-23", branchId: "BR-MAIN", warehouseId: WAREHOUSE,
    lines: [{ itemId, kind: "inventory", qty: "10", unitCost: "10", taxRateId: "VAT14" }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await kit.call("POST", `/purchases/invoices/${id}/confirm`, {})).status).toBe(200);
}

async function posted(mount: string, drafted: Reply, id: string) {
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
  const confirmed = await kit.call("POST", `${mount}/${id}/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
}

const SCOPED_FAMILIES: readonly ScopedFamily[] = [
  {
    label: "sales returns",
    mount: "/sales-returns",
    permissionPrefixes: ["sales.return.", "sales.invoice.classify_tax"],
    params: { lineId: "0" },
    arrange: async (tag) => {
      await stockItem(`${tag}-ITEM`);
      await purchase(`${tag}-BUY`, `${tag}-ITEM`);
      const sold = await kit.call("POST", "/sales-invoices", {
        id: `${tag}-INV`, date: TODAY, dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: WAREHOUSE, branchId: "BR-MAIN",
        arAccountId: "1105", taxAccountId: "2200",
        lines: [{ lineId: "A", itemId: `${tag}-ITEM`, itemNameAr: "صنف", isStock: true, qty: "4", unitPrice: "100", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14" }],
      });
      expect(sold.status, JSON.stringify(sold.body)).toBe(201);
      expect((await kit.call("POST", `/sales-invoices/${tag}-INV/confirm`, {})).status).toBe(200);
      const draft = (id: string) =>
        kit.call("POST", "/sales-returns/from-invoice", { id, date: TODAY, memo: "", warehouseId: WAREHOUSE, sourceInvoiceId: `${tag}-INV`, reason: "DEFECTIVE", requested: [{ itemId: `${tag}-ITEM`, sourceLineId: "A", qty: "1" }] });
      await posted("/sales-returns", await draft(`${tag}-POSTED`), `${tag}-POSTED`);
      expect((await draft(`${tag}-DRAFT`)).status).toBe(201);
      return { draftId: `${tag}-DRAFT`, postedId: `${tag}-POSTED` };
    },
  },
  {
    label: "purchase returns",
    mount: "/purchase-returns",
    permissionPrefixes: ["purchases.return.", "purchases.invoice.classify_tax"],
    params: { lineId: "0" },
    arrange: async (tag) => {
      await stockItem(`${tag}-ITEM`);
      await purchase(`${tag}-BUY`, `${tag}-ITEM`);
      const draft = (id: string) =>
        kit.call("POST", "/purchase-returns", {
          id, date: TODAY, memo: "",
          lines: [{ itemId: `${tag}-ITEM`, warehouseId: WAREHOUSE, supplierId: SUPPLIER, sourceInvoiceId: `${tag}-BUY`, sourceInvoiceNumber: null, sourceLineId: "0", reason: "DEFECTIVE", qty: "1" }],
        });
      await posted("/purchase-returns", await draft(`${tag}-POSTED`), `${tag}-POSTED`);
      expect((await draft(`${tag}-DRAFT`)).status).toBe(201);
      return { draftId: `${tag}-DRAFT`, postedId: `${tag}-POSTED` };
    },
  },
  {
    label: "landed costs",
    mount: "/landed-costs",
    permissionPrefixes: ["purchases.landed_cost."],
    params: {},
    arrange: async (tag) => {
      const draft = async (id: string) => {
        await stockItem(`${id}-ITEM`);
        await purchase(`${id}-BUY`, `${id}-ITEM`);
        return kit.call("POST", "/landed-costs", {
          id, date: TODAY, memo: "شحن", distributionMethod: "BY_VALUE",
          costItems: [{ costType: "SHIPPING", description: "شحن", amount: "40", supplierId: SUPPLIER }],
          targets: [{ itemId: `${id}-ITEM`, warehouseId: WAREHOUSE, sourceInvoiceId: `${id}-BUY`, sourceInvoiceNumber: null, qty: "10", unitCost: "10", weight: "1" }],
        });
      };
      await posted("/landed-costs", await draft(`${tag}-POSTED`), `${tag}-POSTED`);
      expect((await draft(`${tag}-DRAFT`)).status).toBe(201);
      return { draftId: `${tag}-DRAFT`, postedId: `${tag}-POSTED` };
    },
  },
];

async function scopedCall(permissions: readonly string[], warehouseScope: readonly string[], method: string, path: string, body?: unknown): Promise<Reply> {
  const bearer = kit.backend.sessions.issue({ userId: "VIS-SCOPED", permissions: [...permissions], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: [...warehouseScope] });
  const response = await kit.backend.app.fetch(
    new Request(`http://local${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` }, body: body === undefined ? undefined : JSON.stringify(body) }),
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

describe("every route under one stock-moving document applies the warehouse scope its list applies", () => {
  for (const [index, family] of SCOPED_FAMILIES.entries()) {
    it(`${family.label}: a caller scoped to another warehouse, holding every action permission, is told the document does not exist on every sub-route`, async () => {
      const { draftId, postedId } = await family.arrange(`VIS-SCOPE-${index + 1}`);
      const elsewhere = ((await kit.call("GET", "/warehouses")).body as { id: string }[]).find((warehouse) => warehouse.id !== WAREHOUSE)?.id;
      expect(elsewhere, "a second seeded warehouse").toBeDefined();
      const permissions = [...PERMISSIONS.map((permission) => permission.code).filter((code) => family.permissionPrefixes.some((prefix) => code.startsWith(prefix))), JOURNAL_VIEW];
      const routes = subRoutesOf(family.mount);
      expect(routes.length).toBeGreaterThanOrEqual(5);
      const stored = async () => [(await kit.call("GET", `${family.mount}/${draftId}`)).body, (await kit.call("GET", `${family.mount}/${postedId}`)).body];
      const before = await stored();
      expect(before.map((doc) => doc.status)).toEqual(["draft", "confirmed"]);
      const listed = await scopedCall(permissions, [elsewhere as string], "GET", family.mount);
      expect((Array.isArray(listed.body) ? listed.body : listed.body.items).filter((row: { id: string }) => row.id === draftId || row.id === postedId)).toEqual([]);

      const answers: Record<string, string> = {};
      for (const id of [draftId, postedId]) {
        for (const route of routes) {
          const path = route.path.replace(":id", id).replace(/:(\w+)/g, (_, name: string) => family.params[name] ?? name);
          const body = route.method === "GET" ? undefined : { reason: "سبب", memo: "سبب", amount: "1", treasuryAccountId: "TR-DEMO-CASH", paymentMethod: "cash", taxRateId: "VAT14" };
          const reply = await scopedCall(permissions, [elsewhere as string], route.method, path, body);
          answers[`${route.method} ${route.path} ${id === draftId ? "draft" : "posted"}`] = `${reply.status} ${reply.body?.error ?? ""}`;
        }
      }

      expect(answers).toEqual(Object.fromEntries(Object.keys(answers).map((key) => [key, "404 NOT_FOUND"])));
      expect(Object.keys(answers)).toHaveLength(routes.length * 2);
      expect(await stored()).toEqual(before);
    });
  }
});
