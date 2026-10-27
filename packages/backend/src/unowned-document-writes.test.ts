import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BRANCH_POLICY_TABLE, BranchPolicy, BranchRecordKind, branchPolicyEnforcement, branchPolicyFor, type BranchDirectory, type BranchPolicyEntry } from "@mezan/api";
import { ALL_PERMISSION_CODES, ALL_SCOPE, createAuthContext, type AuthContext } from "@mezan/domain";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

const VIEW_UNATTRIBUTED = "accounting.reports.view_unattributed";
const GRANTED_BRANCH = "BR-ALEX";
const COMPANY_ENTRY = "JE-HIST-FOUNDING-CAPITAL";
const UNOWNED_ID = "UNOWNED-RECORD";
const WRITE_VERBS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

enum Seat {
  HeadOffice = "head-office",
  BranchReadingUnattributed = "branch-session-reading-unattributed",
  Branch = "branch-session",
}

const SEATS: Record<Seat, AuthContext> = {
  [Seat.HeadOffice]: createAuthContext({ userId: "U-HEAD", permissions: [...ALL_PERMISSION_CODES], branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE }),
  [Seat.BranchReadingUnattributed]: createAuthContext({ userId: "U-BRANCH-U", permissions: [...ALL_PERMISSION_CODES], branchScope: [GRANTED_BRANCH], warehouseScope: ALL_SCOPE }),
  [Seat.Branch]: createAuthContext({ userId: "U-BRANCH", permissions: ALL_PERMISSION_CODES.filter((code) => code !== VIEW_UNATTRIBUTED), branchScope: [GRANTED_BRANCH], warehouseScope: ALL_SCOPE }),
};

const nobodysRecords: BranchDirectory = {
  branchesOf: () => [null],
  warehousesOf: () => [],
  actingWarehousesOf: () => null,
};

interface MountedRoute {
  readonly method: string;
  readonly path: string;
  readonly entry: BranchPolicyEntry;
}

let world: SeededWorld;
let byIdRoutes: MountedRoute[];
let probe: Hono;

const namesAStoredDocument = (entry: BranchPolicyEntry, path: string): boolean =>
  path
    .split("/")
    .filter((segment) => segment.startsWith(":"))
    .some((segment) => {
      const kind = entry.params?.[segment.slice(1)];
      return kind !== undefined && kind !== null && kind !== BranchRecordKind.Branch;
    });

beforeAll(async () => {
  world = await seededWorld();
  const seen = new Set<string>();
  byIdRoutes = world.backend.app.routes.flatMap((route) => {
    const key = `${route.method} ${route.path}`;
    if (seen.has(key) || route.path.endsWith("*") || route.method === "ALL") return [];
    seen.add(key);
    const entry = branchPolicyFor(route.path, BRANCH_POLICY_TABLE);
    if (!entry || entry.policy !== BranchPolicy.Scoped || entry.unownedIsCompanys || !namesAStoredDocument(entry, route.path)) return [];
    return [{ method: route.method, path: route.path, entry }];
  });
  probe = new Hono();
  probe.use("*", branchPolicyEnforcement({ resolveAuthContext: async (c) => SEATS[c.req.header("x-seat") as Seat], directory: nobodysRecords }));
  for (const route of byIdRoutes) probe.on(route.method, route.path, (c) => c.json({ reached: true }));
}, 900_000);

afterAll(() => world?.close());

async function ask(seat: Seat, route: MountedRoute): Promise<{ status: number; error: string | null; reached: boolean }> {
  const path = route.path.replace(/:[A-Za-z]+(\{[^}]*\})?\??/g, UNOWNED_ID);
  const res = await probe.fetch(new Request(`http://local${path}`, { method: route.method, headers: { "x-seat": seat, "content-type": "application/json" }, ...(route.method === "GET" ? {} : { body: "{}" }) }));
  const body = (await res.json()) as { reached?: boolean; error?: string };
  return { status: res.status, error: body.error ?? null, reached: body.reached === true };
}

describe("a document no branch owns, on every scoped family the application mounts", () => {
  it("walks the real route table: write routes that name a stored document, across many families", () => {
    const writes = byIdRoutes.filter((route) => WRITE_VERBS.has(route.method));
    expect(writes.length).toBeGreaterThan(120);
    expect(new Set(writes.map((route) => route.entry.prefix)).size).toBeGreaterThan(25);
    expect(writes.map((route) => `${route.method} ${route.path}`)).toContain("POST /gl/journal-entries/:id/reverse");
  });

  it.each([Seat.BranchReadingUnattributed, Seat.Branch])("is never written by a %s — every write verb on every family is refused and never reaches its handler", async (seat) => {
    const reached: string[] = [];
    const notAsAnAbsentRecord: string[] = [];
    for (const route of byIdRoutes.filter((candidate) => WRITE_VERBS.has(candidate.method))) {
      const answer = await ask(seat, route);
      if (answer.reached) reached.push(`${route.method} ${route.path}`);
      else if (answer.status !== 404 && answer.error !== "COMPANY_WIDE_ONLY" && answer.error !== "HEAD_OFFICE_CREATES_ONLY") notAsAnAbsentRecord.push(`${route.method} ${route.path} ${answer.status} ${answer.error}`);
    }
    expect(reached).toEqual([]);
    expect(notAsAnAbsentRecord).toEqual([]);
  });

  it("is read by a branch session holding «غير مخصص» and by no branch session without it", async () => {
    const reads = byIdRoutes.filter((route) => route.method === "GET");
    const withheld: string[] = [];
    const leaked: string[] = [];
    for (const route of reads) {
      const holding = await ask(Seat.BranchReadingUnattributed, route);
      if (!holding.reached && holding.error !== "COMPANY_WIDE_ONLY") withheld.push(`${route.path} ${holding.status} ${holding.error}`);
      if ((await ask(Seat.Branch, route)).reached) leaked.push(route.path);
    }
    expect(withheld).toEqual([]);
    expect(leaked).toEqual([]);
  });

  it("is read and written by head office as before", async () => {
    const refused: string[] = [];
    for (const route of byIdRoutes) if (!(await ask(Seat.HeadOffice, route)).reached) refused.push(`${route.method} ${route.path}`);
    expect(refused).toEqual([]);
  });
});

describe("the founding-capital entry, whose lines no branch owns", () => {
  const session = async (permissions: readonly string[], branchScope: typeof ALL_SCOPE | string[]) => {
    const token = await world.backend.sessions.issue({ userId: "USER-UNOWNED", permissions: [...permissions], roleCode: null, branchScope, warehouseScope: ALL_SCOPE });
    return async (method: string, path: string, body?: unknown) => {
      const res = await world.backend.app.fetch(new Request(`http://local${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
  };
  const statusOf = () => (world.sqlite.prepare("SELECT status FROM journal_entry WHERE id = ?").get(COMPANY_ENTRY) as { status: string }).status;

  it("is read by a branch session that holds «غير مخصص», and its reversal is answered as an entry that is not there", async () => {
    const branch = (await session(ALL_PERMISSION_CODES, [GRANTED_BRANCH]));
    const entries = world.count("journal_entry");

    expect((await branch("GET", `/gl/journal-entries/${COMPANY_ENTRY}`)).status).toBe(200);
    const refused = await branch("POST", `/gl/journal-entries/${COMPANY_ENTRY}/reverse`, {});

    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("NOT_FOUND");
    expect(String(refused.body.message)).toMatch(/[؀-ۿ]/);
    expect(statusOf()).toBe("posted");
    expect(world.count("journal_entry")).toBe(entries);
  });

  it("is reversed by head office, and the reversal is filed under the manual journal like the entry it mirrors", async () => {
    const headOffice = (await session(["*"], ALL_SCOPE));
    const original = (await headOffice("GET", `/gl/journal-entries/${COMPANY_ENTRY}`)).body;
    const reversed = await headOffice("POST", `/gl/journal-entries/${COMPANY_ENTRY}/reverse`, { reversalId: "UNOWNED-REVERSAL" });

    expect(reversed.status, JSON.stringify(reversed.body).slice(0, 300)).toBe(201);
    expect(statusOf()).toBe("reversed");
    const mirror = (await headOffice("GET", "/gl/journal-entries/UNOWNED-REVERSAL")).body;
    expect(original.sourceModule).toBe("manual");
    expect(mirror.sourceModule).toBe("manual");
  });
});

describe("a seeded approval request that names no document, and so no branch", () => {
  const decideAs = async (branchScope: typeof ALL_SCOPE | string[], requestId: string) => {
    const token = await world.backend.sessions.issue({ userId: "USER-APPROVER", permissions: [...ALL_PERMISSION_CODES], roleCode: "SUPERVISOR", branchScope, warehouseScope: ALL_SCOPE });
    const res = await world.backend.app.fetch(new Request(`http://local/workflow/requests/${requestId}/decide`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ decision: "approve", comment: "اعتماد" }) }));
    return res.status;
  };
  const pending = () => world.sqlite.prepare("SELECT id, status FROM approval_request WHERE status = 'pending' AND document_id IS NULL ORDER BY id LIMIT 1").get() as { id: string; status: string } | undefined;

  it("is decided by head office and by no branch-restricted approver, whatever that approver may read", async () => {
    const request = pending();
    expect(request, "the demo tenant seeds a pending request with no document").toBeDefined();

    expect(await decideAs([GRANTED_BRANCH], request!.id)).toBe(404);
    expect(await decideAs(["BR-MAIN"], request!.id)).toBe(404);
    expect((world.sqlite.prepare("SELECT status FROM approval_request WHERE id = ?").get(request!.id) as { status: string }).status).toBe("pending");

    expect(await decideAs(ALL_SCOPE, request!.id)).toBe(200);
  });
});
