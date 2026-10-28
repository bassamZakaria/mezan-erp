import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEntitlements, LAN_MULTI_TILL_FEATURE, MODULE_CATALOG } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import { createBackend, type BackendHandle } from "./create-backend.js";

const ARABIC = /[؀-ۿ]/;
const BEFORE_THE_SPLIT: Readonly<Record<string, readonly string[]>> = {
  FINANCE_MANAGER: ["accounting.journal.post", "treasury.reconciliation.post_entry", "treasury.reconciliation.match"],
  HR_OFFICER: ["hr.leave.approve"],
  TREASURY_CASHIER: ["treasury.cash_voucher.confirm"],
  BRANCH_MANAGER: ["treasury.cash_voucher.create"],
};

let dbPath: string;
let handle: BackendHandle;

const resolveEntitlements = () => createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: { [LAN_MULTI_TILL_FEATURE]: true }, seats: 50, expiresAt: null });
const boot = () => createBackend({ dbPath, seedDemoData: true, lan: { resolveEntitlements }, resolveEntitlements });

function withDb<T>(run: (sqlite: ReturnType<typeof openSqliteConnection>["sqlite"]) => T): T {
  const { sqlite } = openSqliteConnection(dbPath);
  try {
    return run(sqlite);
  } finally {
    sqlite.close();
  }
}

const permissionsOf = (code: string): string[] => withDb((sqlite) => JSON.parse((sqlite.prepare("SELECT permissions FROM role WHERE code = ?").get(code) as { permissions: string }).permissions));
const notices = (): { recipient_user_id: string; title: string; body: string }[] =>
  withDb((sqlite) => sqlite.prepare("SELECT recipient_user_id, title, body FROM notification WHERE event_code = 'SEEDED_ROLE_DUTIES_SEPARATED' ORDER BY recipient_user_id").all() as { recipient_user_id: string; title: string; body: string }[]);
const administrators = (): string[] => withDb((sqlite) => (sqlite.prepare("SELECT id FROM user WHERE is_company_admin = 1 AND status = 'active' ORDER BY id").all() as { id: string }[]).map((row) => row.id));

beforeAll(async () => {
  dbPath = join(mkdtempSync(join(tmpdir(), "mezan-role-notice-")), "books.db");
  handle = await boot();
  handle.close();
}, 240_000);

afterAll(() => handle?.close());

describe("a tenant installed after the duties were separated", () => {
  it("is told nothing: its seeded roles never held the rights that were taken away", () => {
    expect(notices()).toEqual([]);
    expect(permissionsOf("FINANCE_MANAGER")).not.toContain("accounting.journal.post");
  });
});

describe("a tenant upgraded from before the duties were separated", () => {
  beforeAll(async () => {
    withDb((sqlite) => {
      for (const [code, held] of Object.entries(BEFORE_THE_SPLIT)) {
        const row = sqlite.prepare("SELECT permissions FROM role WHERE code = ?").get(code) as { permissions: string };
        sqlite.prepare("UPDATE role SET permissions = ? WHERE code = ?").run(JSON.stringify([...new Set([...JSON.parse(row.permissions), ...held])]), code);
      }
      const accountant = sqlite.prepare("SELECT permissions FROM role WHERE code = 'ACCOUNTANT'").get() as { permissions: string };
      sqlite.prepare("UPDATE role SET permissions = ? WHERE code = 'ACCOUNTANT'").run(JSON.stringify((JSON.parse(accountant.permissions) as string[]).filter((permission) => permission !== "accounting.journal.post")));
      sqlite.prepare("DELETE FROM upgrade_step WHERE id = 'seeded_role_duty_split'").run();
    });
    handle = await boot();
  }, 240_000);

  it("has the rights taken from the roles that held both sides, and posting handed to the accountant", () => {
    for (const [code, taken] of Object.entries(BEFORE_THE_SPLIT)) for (const permission of taken) expect(permissionsOf(code), `${code} ${permission}`).not.toContain(permission);
    expect(permissionsOf("ACCOUNTANT")).toContain("accounting.journal.post");
  });

  it("tells every administrator once, in Arabic, which role lost which right and why", () => {
    const sent = notices();
    expect(administrators().length).toBeGreaterThan(0);
    expect(sent.map((notice) => notice.recipient_user_id)).toEqual(administrators());
    const [notice] = sent;
    expect(notice!.title).toMatch(ARABIC);
    expect(notice!.body).toMatch(ARABIC);
    expect(notice!.body).toContain("الفصل بين المهام");
    for (const code of Object.keys(BEFORE_THE_SPLIT)) expect(notice!.body, code).toContain(withDb((sqlite) => (sqlite.prepare("SELECT name FROM role WHERE code = ?").get(code) as { name: string }).name));
    for (const permission of Object.values(BEFORE_THE_SPLIT).flat()) expect(notice!.body, permission).toContain(permission);
    expect(notice!.body).toContain("accounting.journal.post");
  });

  it("an administrator reads it in the notifications panel", async () => {
    const admin = administrators()[0]!;
    const token = await handle.sessions.issue({ userId: admin, permissions: ["*"], roleCode: null, branchScope: "*", warehouseScope: "*" });
    const res = await handle.app.fetch(new Request("http://local/notifications", { headers: { authorization: `Bearer ${token}` } }));
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { eventCode: string; body: string }[] | { rows: { eventCode: string; body: string }[] };
    const list = Array.isArray(rows) ? rows : rows.rows;
    expect(list.some((row) => row.eventCode === "SEEDED_ROLE_DUTIES_SEPARATED")).toBe(true);
  });

  it("says it once: a later start sends nothing more", async () => {
    const before = notices().length;
    handle.close();
    handle = await boot();
    expect(notices().length).toBe(before);
  });
});
