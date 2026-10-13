import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, type BackendKit } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const RECODED_INVENTORY = "1750";
const RECODED_COST_OF_SALES = "6100";
const ALLOWANCE = "1190";

let kit: BackendKit;

const scaled = (value: string) => BigInt(value.replace(".", ""));
const inventoryTile = async () => scaled((await kit.call("GET", "/dashboard/summary")).body.gl.inventoryValue);

async function account(id: string, type: string, naturalBalance: string, parentId: string) {
  const created = await kit.call("POST", "/accounts", { id, code: id, nameAr: `حساب ${id}`, type, naturalBalance, parentId, isHeader: false });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
}

async function journal(id: string, debitAccountId: string, creditAccountId: string, amount: string) {
  const posted = await kit.call("POST", "/gl/journal-entries", {
    id,
    date: TODAY,
    memo: "قيد اختبار المجموعات المشتقة",
    source: "manual",
    lines: [
      { accountId: debitAccountId, debit: amount, credit: "0" },
      { accountId: creditAccountId, debit: "0", credit: amount },
    ],
  });
  expect(posted.status, JSON.stringify(posted.body)).toBeLessThan(300);
}

beforeAll(async () => {
  kit = await bootBackendKit();
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe("the dashboard's inventory tile follows the accounts stock is held on, not an account-code prefix", () => {
  it("counts an item's own inventory account wherever the chart puts it", async () => {
    await account(RECODED_INVENTORY, "asset", "debit", "1000");
    const item = await kit.call("POST", "/items", { id: "DAS-ITEM", code: "DAS-ITEM", nameAr: "صنف على حساب مخزون معاد ترميزه", type: "stock", baseUnitCode: "PCS", trackInventory: true, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: RECODED_INVENTORY });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    const before = await inventoryTile();

    await journal("DAS-JE-1", RECODED_INVENTORY, "3100", "1000.00");

    expect(await inventoryTile()).toBe(before + 1_000_000_000n);
  });

  it("nets the write-down allowance, so the tile reads what the stock is carried at", async () => {
    const before = await inventoryTile();

    await journal("DAS-JE-2", "5060", ALLOWANCE, "250.00");

    expect(await inventoryTile()).toBe(before - 250_000_000n);
  });

  it("leaves out an asset that merely shares the old code prefix", async () => {
    await account("1290", "asset", "debit", "1000");
    const before = await inventoryTile();

    await journal("DAS-JE-3", "1290", "3100", "400.00");

    expect(await inventoryTile()).toBe(before);
  });
});

describe("the income statement's cost of sales follows the accounts goods are costed to, not an account-code prefix", () => {
  const window = `periodFrom=${TODAY}&periodTo=${TODAY}`;
  const sectionOf = async (accountId: string) => {
    const report = (await kit.call("GET", `/financial-reports/income-statement?${window}`)).body;
    if (!Array.isArray(report.rows) && !Array.isArray(report.groups)) throw new Error(`unexpected income statement shape: ${JSON.stringify(report).slice(0, 600)}`);
    const rows = (report.rows ?? report.groups?.flatMap((group: { rows: unknown[] }) => group.rows) ?? []) as { accountId: string; sectionKey: string }[];
    return rows.find((row) => row.accountId === accountId)?.sectionKey;
  };

  it("puts an item's own cost-of-sales account under cost of sales wherever the chart puts it", async () => {
    await account(RECODED_COST_OF_SALES, "expense", "debit", "5000");
    const item = await kit.call("POST", "/items", { id: "DAS-ITEM-2", code: "DAS-ITEM-2", nameAr: "صنف على حساب تكلفة معاد ترميزه", type: "stock", baseUnitCode: "PCS", trackInventory: true, revenueAccountId: "4100", cogsAccountId: RECODED_COST_OF_SALES, inventoryAccountId: "1200" });
    expect(item.status, JSON.stringify(item.body)).toBe(201);

    await journal("DAS-JE-4", RECODED_COST_OF_SALES, "2190", "90.00");

    expect(await sectionOf(RECODED_COST_OF_SALES)).toBe("cogs");
  });

  it("keeps an operating expense that merely shares the old code prefix out of cost of sales", async () => {
    await account("5199", "expense", "debit", "5000");

    await journal("DAS-JE-5", "5199", "2190", "30.00");

    expect(await sectionOf("5199")).toBe("opex");
  });
});
