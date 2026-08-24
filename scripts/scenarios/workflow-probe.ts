import { createBackend } from "../../packages/backend/src/create-backend.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "mezan-wf-"));
const { app } = await createBackend({ dbPath: join(dir, "s.db"), seedDemoData: true });
const H = (roles: string, user: string) => ({ "content-type": "application/json", "x-user-id": user, "x-permissions": "*", "x-role-codes": roles, "x-branch-scope": "*", "x-warehouse-scope": "*" });
const req = async (m: string, p: string, roles: string, user: string, b?: unknown) => {
  const r = await app.fetch(new Request(`http://x${p}`, { method: m, headers: H(roles, user), body: b === undefined ? undefined : JSON.stringify(b) }));
  const t = await r.text();
  return { status: r.status, body: (() => { try { return JSON.parse(t); } catch { return t; } })() as any };
};
const before = (await req("GET", "/workflow/requests", "*", "USER-ADMIN")).body;
const beforeN = (Array.isArray(before) ? before : before.items ?? before.requests ?? []).length;
console.log("approval requests before:", beforeN);
// Configure a gate on sales-return confirm, then confirm one as a NON-admin.
const cfg = await req("POST", "/workflow/configs", "*", "USER-ADMIN", {
  actionType: "SALES_RETURN_CONFIRM", steps: [{ role: "ACCOUNTANT", description: "مراجعة محاسبية" }],
});
console.log("config:", cfg.status);
const drafts = (await req("GET", "/sales-returns", "*", "USER-ADMIN")).body;
const draft = (Array.isArray(drafts) ? drafts : drafts.items ?? []).find((d: any) => d.status === "draft");
if (!draft) { console.log("no draft return seeded to test with"); process.exit(0); }
const conf = await req("POST", `/sales-returns/${draft.id}/confirm`, "SALESPERSON", "USER-STAFF", {});
console.log(`confirm as non-admin: ${conf.status}, doc status -> ${conf.body?.status}`);
const after = (await req("GET", "/workflow/requests", "*", "USER-ADMIN")).body;
const list = Array.isArray(after) ? after : after.items ?? after.requests ?? [];
console.log("approval requests after:", list.length);
console.log(list.length > beforeN ? "FIXED — the held document produced a request the inbox can see" : "STILL BROKEN — held document produced no approval request");
