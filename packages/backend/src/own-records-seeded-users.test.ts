import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

const OWN_INVOICES = "sales.invoice.view_own";
const WIDER_INVOICE_VIEWS: readonly string[] = ["sales.invoice.view", "sales.invoice.view_all", "*"];
const CREATE_INVOICE = "sales.invoice.create";
const SEED_PIN = "123456";
const MAIN_WAREHOUSE = "WH-MAIN";
const ARABIC = /[؀-ۿ]/;

interface SeededUser {
  readonly id: string;
  readonly email: string;
  readonly status: string;
  readonly roleId: string | null;
  readonly employeeId: string | null;
  readonly warehouseScope: "*" | string[];
}

interface SeededRole {
  readonly id: string;
  readonly code: string;
  readonly permissions: string[];
}

let world: SeededWorld;
let users: SeededUser[];
let roles: SeededRole[];

beforeAll(async () => {
  world = await seededWorld();
  users = (await world.request("GET", "/users")).body as unknown as SeededUser[];
  roles = (await world.request("GET", "/roles")).body as unknown as SeededRole[];
}, 900_000);

afterAll(() => world?.close());

const permissionsOf = (user: SeededUser): string[] => roles.find((role) => role.id === user.roleId)?.permissions ?? [];
const holdsOwnTier = (user: SeededUser): boolean => permissionsOf(user).some((code) => code.endsWith(".view_own"));
const seesOnlyOwnInvoices = (user: SeededUser): boolean => permissionsOf(user).includes(OWN_INVOICES) && !permissionsOf(user).some((code) => WIDER_INVOICE_VIEWS.includes(code));

async function signedIn(email: string) {
  const login = await world.backend.app.fetch(new Request("http://local/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: email, pin: SEED_PIN }) }));
  expect(login.status, `${email} signs in`).toBe(200);
  const { token } = (await login.json()) as { token: string };
  return async (method: string, path: string, body?: unknown) => {
    const res = await world.backend.app.fetch(new Request(`http://local${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as any };
  };
}

const invoiceFrom = (warehouseId: string) => ({
  date: "2026-08-24",
  dueDate: "2026-09-23",
  customerId: "CUST-DEMO-2",
  customerNameAr: "مؤسسة النور للمقاولات",
  warehouseId,
  branchId: "BR-MAIN",
  currency: "EGP",
  arAccountId: "1105",
  taxAccountId: "2200",
  lines: [{ lineId: "L1", itemId: "ITEM-DEMO-1", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", taxRatePercent: 14, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" }],
});

describe("a seeded user whose role sees only their own records", () => {
  it("the demo tenant seeds such users, the sales representative among them", () => {
    const own = users.filter((user) => user.status === "active" && holdsOwnTier(user)).map((user) => user.email.split("@")[0]);
    expect(own).toContain("karim.fouad");
    expect(own.length).toBeGreaterThanOrEqual(2);
  });

  it("each is linked to an employee the HR module holds", async () => {
    const employees = ((await world.request("GET", "/hr/employees")).body as unknown as { id: string }[]).map((employee) => employee.id);
    const unlinked = users.filter((user) => holdsOwnTier(user) && (user.employeeId === null || !employees.includes(user.employeeId))).map((user) => user.email);
    expect(unlinked).toEqual([]);
  });

  it("each who may raise an invoice gets it back: created under their own name, read by id, and on their list", async () => {
    const reps = users.filter((user) => user.status === "active" && seesOnlyOwnInvoices(user) && permissionsOf(user).includes(CREATE_INVOICE));
    expect(reps.length).toBeGreaterThanOrEqual(2);
    for (const rep of reps) {
      const as = await signedIn(rep.email);
      const warehouseId = rep.warehouseScope === "*" ? MAIN_WAREHOUSE : rep.warehouseScope[0]!;
      const created = await as("POST", "/sales-invoices", invoiceFrom(warehouseId));
      expect(created.status, `${rep.email} ${JSON.stringify(created.body).slice(0, 300)}`).toBe(201);
      expect(created.body.salespersonId, rep.email).toBe(rep.employeeId);

      const read = await as("GET", `/sales-invoices/${created.body.id}`);
      expect(read.status, rep.email).toBe(200);
      const listed = await as("GET", "/sales-invoices?pageSize=200");
      const rows = (Array.isArray(listed.body) ? listed.body : (listed.body.items ?? listed.body.rows ?? [])) as { id: string }[];
      expect(rows.map((row) => row.id), rep.email).toContain(created.body.id);
    }
  });

  it("one with no employee link is refused in Arabic before any draft is made", async () => {
    const repRole = roles.find((role) => role.code === "SALES_REP")!;
    const made = await world.request("POST", "/users", { nameAr: "مندوب بلا ملف", nameEn: "Unlinked Rep", email: "unlinked.rep@cyag.example", phone: null, roleId: repRole.id, isCompanyAdmin: false, employeeId: null, branchScope: "*", warehouseScope: "*", status: "active", password: "Mezan-demo-unlinked.rep", pin: SEED_PIN });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const as = await signedIn("unlinked.rep@cyag.example");
    const drafts = world.count("sales_invoice");

    const refused = await as("POST", "/sales-invoices", invoiceFrom(MAIN_WAREHOUSE));

    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("USER_NOT_LINKED_TO_EMPLOYEE");
    expect(refused.body.message).toMatch(ARABIC);
    expect(refused.body.messageEn).toMatch(/not linked to an employee/);
    expect(world.count("sales_invoice")).toBe(drafts);
  });
});
