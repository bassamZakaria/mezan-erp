import { createBackend } from "../../packages/backend/src/create-backend.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "mezan-lv-"));
const { app } = await createBackend({ dbPath: join(dir, "s.db"), seedDemoData: true });
const get = async (wh: string) => {
  const r = await app.fetch(new Request("http://x/reports/inventory/stock-levels", {
    headers: { "x-user-id": "USER-ADMIN", "x-permissions": "*", "x-warehouse-scope": wh, "x-branch-scope": "*" },
  }));
  const b: any = await r.json();
  return b.grandTotals ?? b.rows?.reduce((s: number, x: any) => s + Number(x.onHand ?? 0), 0);
};
console.log("all      :", JSON.stringify(await get("*")));
console.log("WH-MAIN  :", JSON.stringify(await get("WH-MAIN")));
console.log("WH-DEMO-2:", JSON.stringify(await get("WH-DEMO-2")));
