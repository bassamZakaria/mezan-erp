import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS, resolvePermissions } from "@mezan/domain";
import { bootBackendKit, type BackendKit } from "./test-helpers/backend-kit.js";

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
