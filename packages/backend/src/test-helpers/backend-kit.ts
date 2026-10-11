import { expect } from "vitest";
import { ALL_SCOPE, MODULE_CATALOG, createEntitlements } from "@mezan/domain";
import { createBackend, type BackendHandle } from "../create-backend.js";

export interface Reply {
  readonly status: number;
  readonly body: any;
}

export interface BackendKit {
  readonly backend: BackendHandle;
  call(method: string, path: string, body?: unknown, permissions?: readonly string[]): Promise<Reply>;
  invariants(): Promise<LedgerInvariants>;
  journalLines(entryId: string | null | undefined): Promise<readonly JournalLineView[]>;
  auditRows(entityType: string, entityId: string, action: string): Promise<readonly any[]>;
  close(): Promise<void>;
}

export interface LedgerInvariants {
  readonly tb: bigint;
  readonly inventory: bigint;
  readonly ap: bigint;
  readonly ar: bigint;
}

export interface JournalLineView {
  readonly accountId: string;
  readonly debit: string;
  readonly credit: string;
  readonly taxRatePercent: number | null;
  readonly taxRateId: string | null;
}

export const rowsOf = (body: Reply["body"]): Reply["body"][] =>
  Array.isArray(body) ? body : (body?.items ?? body?.rows ?? body?.events ?? body?.controls ?? []);

function scaled(value: unknown): bigint {
  const match = /^(-)?(\d+)(?:\.(\d{0,6}))?$/.exec(String(value ?? "").trim());
  if (!match) throw new Error(`not an exact decimal: ${String(value)}`);
  const units = BigInt(match[2]!) * 1_000_000n + BigInt((match[3] ?? "").padEnd(6, "0"));
  return match[1] ? -units : units;
}

export async function bootBackendKit(): Promise<BackendKit> {
  const backend = await createBackend({
    dbPath: ":memory:",
    seedDemoData: true,
    resolveEntitlements: () => createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null }),
  });
  const admin = backend.sessions.issue({ userId: "USER-ADMIN", permissions: ["*"], roleCode: "*", branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });

  async function call(method: string, path: string, body?: unknown, permissions?: readonly string[]): Promise<Reply> {
    const bearer = permissions
      ? backend.sessions.issue({ userId: "LIMITED", permissions, roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE })
      : admin;
    const res = await backend.app.fetch(
      new Request(`http://local${path}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${bearer}`, "x-branch-scope": "*", "x-warehouse-scope": "*" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await res.text();
    try {
      return { status: res.status, body: text ? JSON.parse(text) : null };
    } catch {
      return { status: res.status, body: text };
    }
  }

  async function invariants(): Promise<LedgerInvariants> {
    const totals = (await call("GET", "/financial-reports/trial-balance")).body?.grandTotals ?? {};
    const controls = rowsOf((await call("GET", "/reconciliation")).body);
    const gap = (key: string): bigint => {
      const row = controls.find((control) => control.key === key);
      if (!row) throw new Error(`no reconciliation control "${key}"`);
      return scaled(row.subLedgerBalance) - scaled(row.glBalance);
    };
    return { tb: scaled(totals.debit) - scaled(totals.credit), inventory: gap("inventory"), ap: gap("ap"), ar: gap("ar") };
  }

  async function journalLines(entryId: string | null | undefined): Promise<readonly JournalLineView[]> {
    if (!entryId) return [];
    const entry = (await call("GET", `/gl/journal-entries/${encodeURIComponent(entryId)}`)).body;
    return (entry?.lines ?? []).map((line: any) => ({
      accountId: line.accountId,
      debit: line.debit,
      credit: line.credit,
      taxRatePercent: line.taxRatePercent ?? null,
      taxRateId: line.taxRateId ?? null,
    }));
  }

  async function auditRows(entityType: string, entityId: string, action: string) {
    const query = `stream=sensitive&entityType=${entityType}&entityId=${encodeURIComponent(entityId)}&action=${action}`;
    return rowsOf((await call("GET", `/audit?${query}`)).body);
  }

  return {
    backend,
    call,
    invariants,
    journalLines,
    auditRows,
    close: async () => {
      await backend.drain();
      backend.close();
    },
  };
}

export enum RaceOutcome {
  ExactlyOneWins = "exactly-one-wins",
  BothLand = "both-land",
  FirstCommitDecides = "first-commit-decides",
}

export enum RaceSchedule {
  FirstThenSecond = "first-then-second",
  SecondThenFirst = "second-then-first",
  ConcurrentFirstLeads = "concurrent-first-leads",
  ConcurrentSecondLeads = "concurrent-second-leads",
}

export interface RaceRun<Fixture> {
  readonly schedule: RaceSchedule;
  readonly fixture: Fixture;
  readonly first: Reply;
  readonly second: Reply;
}

export interface RaceSpec<Fixture> {
  readonly outcome: RaceOutcome;
  arrange(tag: string): Promise<Fixture>;
  first(fixture: Fixture): Promise<Reply>;
  second(fixture: Fixture): Promise<Reply>;
  agree(run: RaceRun<Fixture>): Promise<void>;
}

const succeeded = (reply: Reply) => reply.status >= 200 && reply.status < 300;

export async function raceBothOrders<Fixture>(kit: BackendKit, tag: string, spec: RaceSpec<Fixture>): Promise<readonly RaceRun<Fixture>[]> {
  const runs: RaceRun<Fixture>[] = [];
  const schedules = Object.values(RaceSchedule);
  for (const [index, schedule] of schedules.entries()) {
    const before = await kit.invariants();
    const fixture = await spec.arrange(`${tag}-${index + 1}`);
    const arranged = await kit.invariants();
    let first: Reply;
    let second: Reply;
    switch (schedule) {
      case RaceSchedule.FirstThenSecond:
        first = await spec.first(fixture);
        second = await spec.second(fixture);
        break;
      case RaceSchedule.SecondThenFirst:
        second = await spec.second(fixture);
        first = await spec.first(fixture);
        break;
      case RaceSchedule.ConcurrentFirstLeads:
        [first, second] = await Promise.all([spec.first(fixture), spec.second(fixture)]);
        break;
      case RaceSchedule.ConcurrentSecondLeads:
        [second, first] = await Promise.all([spec.second(fixture), spec.first(fixture)]);
        break;
    }
    const run: RaceRun<Fixture> = { schedule, fixture, first, second };
    const landed = [first, second].filter(succeeded).length;
    const context = `${tag} · ${schedule} · first ${first.status} ${first.body?.error ?? ""} · second ${second.status} ${second.body?.error ?? ""}`;
    switch (spec.outcome) {
      case RaceOutcome.ExactlyOneWins:
        expect(landed, context).toBe(1);
        break;
      case RaceOutcome.BothLand:
        expect(landed, context).toBe(2);
        break;
      case RaceOutcome.FirstCommitDecides:
        expect(landed, context).toBeGreaterThanOrEqual(1);
        break;
    }
    for (const reply of [first, second]) {
      if (!succeeded(reply)) expect(reply.status, context).toBeLessThan(500);
    }
    await spec.agree(run);
    const after = await kit.invariants();
    expect(before.tb, context).toBe(0n);
    expect(arranged.tb, context).toBe(0n);
    expect(after, context).toEqual({ tb: 0n, inventory: before.inventory, ap: before.ap, ar: before.ar });
    runs.push(run);
  }
  return runs;
}
