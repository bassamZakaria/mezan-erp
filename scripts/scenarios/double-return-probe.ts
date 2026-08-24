import { createBackend } from "../../packages/backend/src/create-backend.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "mezan-dr-"));
const { app } = await createBackend({ dbPath: join(dir, "s.db"), seedDemoData: true });
const H = { "content-type": "application/json", "x-user-id": "USER-ADMIN", "x-permissions": "*", "x-role-codes": "*", "x-branch-scope": "*", "x-warehouse-scope": "*" };
const req = async (m: string, p: string, b?: unknown) => {
  const r = await app.fetch(new Request(`http://x${p}`, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) }));
  const t = await r.text();
  return { status: r.status, body: (() => { try { return JSON.parse(t); } catch { return t; } })() as any };
};

const inv = (await req("GET", "/sales-invoices/INV-DEMO-1")).body;
const line = inv.lines[0];
console.log(`invoice INV-DEMO-1 line: item ${line.itemId}, invoiced qty ${line.qty}`);

// Claim the FULL invoiced quantity as "available" — twice, exactly as the screen does.
async function makeReturn(id: string, qty: string) {
  const create = await req("POST", "/sales-returns", {
    id, date: "2026-08-22", memo: `double-return probe ${id}`,
    lines: [{
      itemId: line.itemId, warehouseId: "WH-MAIN", customerId: inv.customerId,
      sourceInvoiceId: inv.id, sourceInvoiceNumber: inv.docNo, reason: "DEFECTIVE",
      availableQty: String(line.qty), qty, unitPrice: String(line.unitPrice),
      unitCost: String(line.unitPrice), taxAmount: "0",
    }],
  });
  if (create.status >= 400) return `create ${create.status}: ${JSON.stringify(create.body).slice(0, 110)}`;
  const conf = await req("POST", `/sales-returns/${id}/confirm`, {});
  return `create ${create.status}, confirm ${conf.status}${conf.status >= 400 ? ": " + JSON.stringify(conf.body).slice(0, 110) : ""}`;
}

console.log(`return #1 of the FULL invoiced qty (${line.qty}): ${await makeReturn("DR-1", String(line.qty))}`);
console.log(`return #2 of the SAME full qty  (${line.qty}): ${await makeReturn("DR-2", String(line.qty))}`);

const rets = (await req("GET", "/sales-returns")).body;
const mine = (Array.isArray(rets) ? rets : rets.items ?? []).filter((r: any) => String(r.id).startsWith("DR-"));
console.log(`\nconfirmed probe returns: ${mine.filter((r: any) => r.status === "confirmed").length} of 2`);
console.log(mine.length === 2 && mine.every((r: any) => r.status === "confirmed")
  ? "DEFECT CONFIRMED — the same goods were returned twice"
  : "the second return was refused");
