import { createBackend } from "../../packages/backend/src/create-backend.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "mezan-pdr-"));
const { app } = await createBackend({ dbPath: join(dir, "s.db"), seedDemoData: true });
const H = { "content-type": "application/json", "x-user-id": "USER-ADMIN", "x-permissions": "*", "x-role-codes": "*", "x-branch-scope": "*", "x-warehouse-scope": "*" };
const req = async (m: string, p: string, b?: unknown) => {
  const r = await app.fetch(new Request(`http://x${p}`, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) }));
  const t = await r.text();
  return { status: r.status, body: (() => { try { return JSON.parse(t); } catch { return t; } })() as any };
};
const inv = (await req("GET", "/purchases/invoices/PI-DEMO-1")).body;
const line = inv.lines.find((l: any) => l.itemId);
console.log(`PI-DEMO-1 line: item ${line.itemId}, invoiced qty ${line.qty}`);
const reasons = ["DAMAGED", "DEFECTIVE", "WRONG_ITEM", "EXCESS_QTY", "OTHER"];
async function mk(id: string, reason: string) {
  const create = await req("POST", "/purchase-returns", {
    id, date: "2026-08-22", memo: `probe ${id}`,
    lines: [{ itemId: line.itemId, warehouseId: "WH-MAIN", supplierId: inv.supplierId,
      sourceInvoiceId: inv.id, sourceInvoiceNumber: inv.number, reason,
      availableQty: String(line.qty), qty: String(line.qty), unitCost: String(line.unitCost), taxAmount: "0" }],
  });
  if (create.status >= 400) return `create ${create.status}: ${JSON.stringify(create.body).slice(0, 130)}`;
  const conf = await req("POST", `/purchase-returns/${id}/confirm`, {});
  return `create ${create.status}, confirm ${conf.status}${conf.status >= 400 ? ": " + JSON.stringify(conf.body).slice(0, 100) : ""}`;
}
for (const r of reasons) {
  const out = await mk(`PDR-${r}`, r);
  if (!out.includes("Invalid enum")) { console.log(`reason ${r}: ${out}`); console.log(`second: ${await mk(`PDR2-${r}`, r)}`); break; }
}
