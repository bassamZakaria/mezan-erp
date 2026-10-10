import { afterEach, describe, expect, it } from "vitest";
import { createSqliteFiscalPeriodRepository, type SqliteFiscalPeriodRepositoryHandle } from "@mezan/persistence";
import {
  PERIOD_CLOSE_OVERRIDE_PERMISSION,
  PeriodCloseCheckCode,
  PeriodCloseCheckStatus,
  type AuditEvent,
  type AuditSink,
  type AuditStream,
  type FiscalPeriod,
  type PeriodCloseEvaluation,
} from "@mezan/domain";
import { createFiscalPeriodsRoutes } from "./fiscal-periods-routes.js";
import { createPeriodCloseRoutes, registerPeriodCloseGuard, type PeriodCloseGuard, type PeriodCloseRecord } from "./period-close-routes.js";
import { insecureHeaderAuthContextResolver } from "./permission-gate.js";

const CLOSE = "accounting.period.close";
const CLOSE_AND_OVERRIDE = `${CLOSE},${PERIOD_CLOSE_OVERRIDE_PERMISSION}`;
const REASON = "إقفال مبكر باعتماد المدير المالي";
const PERIOD_ID = "fp-2026-01";

class MemorySink implements AuditSink {
  readonly events: AuditEvent[] = [];
  async append(event: AuditEvent) {
    this.events.push(event);
  }
  async query(stream: AuditStream, limit = 100) {
    return this.events.filter((e) => e.stream === stream).slice(-limit).reverse();
  }
}

class FakeGuard implements PeriodCloseGuard {
  blocking: PeriodCloseCheckCode[] = [];
  evaluations = 0;
  readonly closes: PeriodCloseRecord[] = [];

  async evaluate(period: FiscalPeriod): Promise<PeriodCloseEvaluation> {
    this.evaluations += 1;
    return {
      periodId: period.id,
      year: period.year,
      periodNumber: period.periodNumber,
      startDate: period.startDate,
      endDate: period.endDate,
      evaluatedAt: "2026-02-01T00:00:00.000Z",
      checks: Object.values(PeriodCloseCheckCode).map((code) => ({
        code,
        status: this.blocking.includes(code) ? PeriodCloseCheckStatus.Fail : PeriodCloseCheckStatus.Pass,
        fix: null,
        findings: [],
      })),
      blocking: [...this.blocking],
    };
  }

  async recordClose(record: PeriodCloseRecord) {
    this.closes.push(record);
  }

  async listSummaries() {
    return [];
  }
}

const handles: SqliteFiscalPeriodRepositoryHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

async function setup() {
  const repo = createSqliteFiscalPeriodRepository();
  handles.push(repo);
  const audit = new MemorySink();
  const guard = new FakeGuard();
  registerPeriodCloseGuard(repo, guard);
  const periods = createFiscalPeriodsRoutes(repo, insecureHeaderAuthContextResolver, audit);
  const checklist = createPeriodCloseRoutes({ periods: repo, guard }, insecureHeaderAuthContextResolver);
  await periods.fetch(post("/generate-year", CLOSE, { year: 2026 }));
  audit.events.length = 0;
  return { repo, audit, guard, periods, checklist };
}

function post(path: string, permissions: string, body?: unknown) {
  return new Request(`http://local${path}`, {
    method: "POST",
    headers: { "x-permissions": permissions, "x-user-id": "U-CLOSER", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function statusOf(repo: SqliteFiscalPeriodRepositoryHandle) {
  return (await repo.findById(PERIOD_ID))?.status;
}

describe("closing a period runs the pre-close checks (D176 C-3)", () => {
  it("closes a clear period, records the close with no override, and writes no override event", async () => {
    const { periods, repo, guard, audit } = await setup();
    const res = await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE));
    expect(res.status).toBe(200);
    expect(await statusOf(repo)).toBe("closed");
    expect(guard.closes).toHaveLength(1);
    expect(guard.closes[0]).toMatchObject({ closedBy: "U-CLOSER", overrideReason: null });
    expect(audit.events.map((e) => e.action)).toEqual(["CLOSE"]);
  });

  it("refuses with 409 while a check fails, in Arabic and English, and leaves the period open", async () => {
    const { periods, repo, guard, audit } = await setup();
    guard.blocking = [PeriodCloseCheckCode.Drafts, PeriodCloseCheckCode.SubledgerTies];
    const res = await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE_AND_OVERRIDE));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string; messageEn: string; failedChecks: string[]; checklist: { canOverride: boolean; blocking: string[] } };
    expect(body.error).toBe("PERIOD_CLOSE_BLOCKED");
    expect(body.message).toMatch(/[؀-ۿ]/);
    expect(body.messageEn).toContain("cannot be closed");
    expect(body.failedChecks).toEqual(["drafts", "subledger_ties"]);
    expect(body.checklist).toMatchObject({ canOverride: true, blocking: ["drafts", "subledger_ties"] });
    expect(await statusOf(repo)).toBe("open");
    expect(guard.closes).toEqual([]);
    expect(audit.events).toEqual([]);
  });

  it("refuses an override reason from a caller without the override permission with 403", async () => {
    const { periods, repo, guard } = await setup();
    guard.blocking = [PeriodCloseCheckCode.Drafts];
    const res = await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE, { overrideReason: REASON }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message: string; messageEn: string; checklist: { canOverride: boolean } };
    expect(body.error).toBe("PERIOD_CLOSE_OVERRIDE_NOT_PERMITTED");
    expect(body.message).toMatch(/[؀-ۿ]/);
    expect(body.checklist.canOverride).toBe(false);
    expect(await statusOf(repo)).toBe("open");
  });

  it("closes over a failing check for a permitted caller with a reason, and audits which checks and why at WARNING", async () => {
    const { periods, repo, guard, audit } = await setup();
    guard.blocking = [PeriodCloseCheckCode.BankStatements, PeriodCloseCheckCode.Depreciation];
    const res = await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE_AND_OVERRIDE, { overrideReason: `  ${REASON}  ` }));
    expect(res.status).toBe(200);
    expect(await statusOf(repo)).toBe("closed");
    const override = audit.events.find((e) => e.action === "CLOSE_OVERRIDE");
    expect(override).toMatchObject({ severity: "WARNING", entityType: "FISCAL_PERIOD", entityId: PERIOD_ID, actor: "U-CLOSER" });
    expect(override?.details).toMatchObject({ failedChecks: ["bank_statements", "depreciation"], reason: REASON, year: 2026, periodNumber: 1 });
    expect(guard.closes[0]).toMatchObject({ overrideReason: REASON });
  });

  it("rejects a reason too short to be one, and a body that tries to supply its own verdict", async () => {
    const { periods, repo, guard } = await setup();
    guard.blocking = [PeriodCloseCheckCode.Drafts];
    const short = await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE_AND_OVERRIDE, { overrideReason: "ok" }));
    expect(short.status).toBe(400);
    const forged = await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE_AND_OVERRIDE, { blocking: [], failedChecks: [], checks: [] }));
    expect(forged.status).toBe(400);
    expect(await statusOf(repo)).toBe("open");
  });
});

describe("locking is held to the same checks (the close's twin)", () => {
  it("refuses to lock a closed period while a check fails, and locks with an audited override", async () => {
    const { periods, repo, guard, audit } = await setup();
    await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE));
    guard.blocking = [PeriodCloseCheckCode.Drafts];

    const refused = await periods.fetch(post(`/${PERIOD_ID}/lock`, CLOSE_AND_OVERRIDE));
    expect(refused.status).toBe(409);
    expect(await statusOf(repo)).toBe("closed");

    const locked = await periods.fetch(post(`/${PERIOD_ID}/lock`, CLOSE_AND_OVERRIDE, { overrideReason: REASON }));
    expect(locked.status).toBe(200);
    expect(await statusOf(repo)).toBe("locked");
    expect(audit.events.find((e) => e.action === "LOCK_OVERRIDE")?.details).toMatchObject({ failedChecks: ["drafts"], reason: REASON });
    expect(guard.closes).toHaveLength(1);
  });

  it("a locked period stays terminal: neither close nor lock reaches the checks, even with an override", async () => {
    const { periods, repo, guard } = await setup();
    await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE));
    await periods.fetch(post(`/${PERIOD_ID}/lock`, CLOSE));
    const evaluationsBefore = guard.evaluations;
    for (const action of ["close", "lock"]) {
      const res = await periods.fetch(post(`/${PERIOD_ID}/${action}`, CLOSE_AND_OVERRIDE, { overrideReason: REASON }));
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toBe("INVALID_PERIOD_TRANSITION");
    }
    expect(guard.evaluations).toBe(evaluationsBefore);
    expect(await statusOf(repo)).toBe("locked");
  });

  it("locking an open period is still refused as a transition, before any check runs", async () => {
    const { periods, guard } = await setup();
    const res = await periods.fetch(post(`/${PERIOD_ID}/lock`, CLOSE));
    expect(res.status).toBe(422);
    expect(guard.evaluations).toBe(0);
  });
});

describe("GET /period-close/:periodId/checks", () => {
  function get(path: string, permissions: string) {
    return new Request(`http://local${path}`, { headers: { "x-permissions": permissions } });
  }

  it("serves the checklist with the period status and whether THIS caller may override", async () => {
    const { checklist, guard } = await setup();
    guard.blocking = [PeriodCloseCheckCode.TrialBalance];
    const viewer = (await (await checklist.fetch(get(`/${PERIOD_ID}/checks`, "accounting.period.view"))).json()) as { blocking: string[]; canOverride: boolean; periodStatus: string; checks: unknown[] };
    expect(viewer).toMatchObject({ blocking: ["trial_balance"], canOverride: false, periodStatus: "open" });
    expect(viewer.checks).toHaveLength(Object.values(PeriodCloseCheckCode).length);
    const overrider = (await (await checklist.fetch(get(`/${PERIOD_ID}/checks`, CLOSE_AND_OVERRIDE))).json()) as { canOverride: boolean };
    expect(overrider.canOverride).toBe(true);
  });

  it("needs accounting.period.view and 404s an unknown period", async () => {
    const { checklist } = await setup();
    expect((await checklist.fetch(get(`/${PERIOD_ID}/checks`, "sales.invoice.view"))).status).toBe(403);
    expect((await checklist.fetch(get("/nope/checks", "accounting.period.view"))).status).toBe(404);
  });
});
